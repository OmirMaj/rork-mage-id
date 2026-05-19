# D3-3 — Portal Client Photo Timeline + Lightbox Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** In the single static file `marketing/portal/index.html`, render the client's Site Photos as a newest-first day-grouped timeline and give the existing lightbox prev/next navigation (arrows + keyboard + caption·date), at parity with the shipped in-app D3-1/D3-2 galleries.

**Architecture:** One file. Rewrite `renderPhotos` to wrap the existing per-figure markup in day groups (keeping `data-photo` = the global index so the lightbox lookup is unchanged); add static prev/next/caption elements + CSS to the existing `#lightbox`; rewrite the lightbox wiring block into an index-aware `showLightboxAt` with nav + a guarded keydown handler, and put the selection-swatch reuse into an explicit single-image no-nav mode. Read-only; no `app/`, snapshot, migration, or RPC change.

**Tech Stack:** Vanilla ES5-style JS + CSS already in `marketing/portal/index.html` (no build, no framework, no dependency). Helpers in-file: `esc()` (:2517), `emptyState()` (:2554), `buildMarkupSvg()` (:3639).

---

## CRITICAL
- Confine ALL changes to `marketing/portal/index.html`. NO `app/` change, NO `utils/portalSnapshot.ts` change, NO migration, NO new/changed RPC. Every other portal section + the H4-hardened write path must be byte-unaffected (the markers `portal_sign_contract` / `portal_choose_selection` must remain present in the file; the legacy `project_contracts?id=eq` raw-PATCH marker must remain absent).
- `data-photo` on each `<figure>` MUST stay the global index into the flat `sections.photos` array (NOT a per-group index) — the existing lightbox lookup depends on it. This is the single most important invariant.
- Build authors code only. **Ship is a controller step AFTER the final opus whole-impl review**, via the proven direct-deploy + `restoreSiteDeploy` path (NOT git-push auto-deploy — that is Netlify-credit-paused).
- Gate: reasoning through spec §6 + `git diff` shows only `marketing/portal/index.html` + the H4-marker grep checks.

## Anchors (verified @ 6cf1ce3, in `marketing/portal/index.html`)
- `renderPhotos` — :3613-3632 (full current body reproduced in Step 1 as the find-target).
- `#lightbox` static HTML — :2315-2322.
- Lightbox CSS block — :1597-1626 (tokens: `var(--radius-md)`; `.lightbox-close` pattern at :1619 = `rgba(255,255,255,0.10)` bg, `#fff`, `1px solid rgba(255,255,255,0.16)`, blur).
- Lightbox + swatch wiring — :4920-4961 (full current block reproduced in Step 3 as the find-target).
- `addSection('photos', …, renderPhotos(sections.photos))` — :4644-4645 (UNCHANGED — `renderPhotos` keeps its `(photos)` signature).
- Existing `document` keydown listeners at :3212 (modal-scoped) and :3770 (drawer Esc) are unrelated and coexist safely with a new guarded one.

---

### Task 1: Day-grouped photo timeline + lightbox prev/next (single file)

**Files:** Modify `marketing/portal/index.html`

- [ ] **Step 1: Rewrite `renderPhotos` into a day-grouped timeline**

Find this exact current block (`marketing/portal/index.html:3613-3632`):
```js
  function renderPhotos(photos) {
    if (!photos || !photos.length) return emptyState('No photos shared yet.');
    // Masonry-style grid via CSS column-count. Each photo gets a
    // randomized "tall / standard / wide" hint so the wall feels
    // organic instead of a uniform grid. Hint is deterministic per
    // index so re-renders don't reflow.
    var grid = photos.map(function (p, idx) {
      var cap = p.caption ? '<div class="photo-caption">'+esc(p.caption)+'</div>' : '';
      var badge = (p.markup && p.markup.length) ? '<span class="photo-markup-badge" title="Has markup">✏️</span>' : '';
      // Hash idx to a tall (1 in 3) / wide (1 in 4) / default ratio
      var sizeClass = (idx % 7 === 0) ? ' photo-tall' : (idx % 5 === 0) ? ' photo-wide' : '';
      var animDelay = (idx * 35);
      return '<figure class="photo'+sizeClass+'" data-photo="'+idx+'" style="animation-delay:'+animDelay+'ms">' +
               '<img loading="lazy" src="'+esc(p.url)+'" alt="'+esc(p.caption||'')+'"/>' +
               badge +
               cap +
             '</figure>';
    }).join('');
    return '<div class="photo-wall">'+grid+'</div>';
  }
```
Replace it **entirely** with (per-figure markup byte-identical; `data-photo` stays the GLOBAL index via the `.forEach` index; groups wrap around it; `unknown` last):
```js
  function renderPhotos(photos) {
    if (!photos || !photos.length) return emptyState('No photos shared yet.');
    // One figure, byte-identical to the pre-D3-3 markup. data-photo stays
    // the GLOBAL index into the flat photos array so the lightbox wiring
    // (photoData[idx]) is unchanged.
    function figure(p, idx) {
      var cap = p.caption ? '<div class="photo-caption">'+esc(p.caption)+'</div>' : '';
      var badge = (p.markup && p.markup.length) ? '<span class="photo-markup-badge" title="Has markup">✏️</span>' : '';
      var sizeClass = (idx % 7 === 0) ? ' photo-tall' : (idx % 5 === 0) ? ' photo-wide' : '';
      var animDelay = (idx * 35);
      return '<figure class="photo'+sizeClass+'" data-photo="'+idx+'" style="animation-delay:'+animDelay+'ms">' +
               '<img loading="lazy" src="'+esc(p.url)+'" alt="'+esc(p.caption||'')+'"/>' +
               badge +
               cap +
             '</figure>';
    }
    // Group by calendar day, preserving the snapshot's newest-first order.
    // Photos with no timestamp -> a single 'unknown' group emitted LAST.
    var order = [];
    var byDay = {};
    photos.forEach(function (p, idx) {
      var key = (((p && p.timestamp) || '') + '').slice(0, 10) || 'unknown';
      if (!byDay[key]) { byDay[key] = []; order.push(key); }
      byDay[key].push(figure(p, idx));
    });
    order = order.filter(function (k) { return k !== 'unknown'; });
    if (byDay['unknown']) order.push('unknown');
    function dayLabel(key) {
      if (key === 'unknown') return 'Undated';
      var d = new Date(key + 'T00:00:00');
      return isNaN(d.getTime())
        ? 'Undated'
        : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
    return order.map(function (key) {
      return '<div class="photo-day">'+esc(dayLabel(key))+'</div>' +
             '<div class="photo-wall">'+byDay[key].join('')+'</div>';
    }).join('');
  }
```

- [ ] **Step 2: Add static prev/next/caption elements to `#lightbox` + CSS**

Find this exact current block (`marketing/portal/index.html:2315-2322`):
```html
  <!-- Lightbox -->
  <div class="lightbox" id="lightbox">
    <button class="lightbox-close" id="lightbox-close" aria-label="Close">×</button>
    <div class="lightbox-stage" id="lightbox-stage">
      <img id="lightbox-img" alt="" />
      <svg id="lightbox-svg" preserveAspectRatio="none"></svg>
    </div>
  </div>
```
Replace it **entirely** with:
```html
  <!-- Lightbox -->
  <div class="lightbox" id="lightbox">
    <button class="lightbox-close" id="lightbox-close" aria-label="Close">×</button>
    <button class="lightbox-nav lightbox-prev" id="lightbox-prev" aria-label="Previous photo">‹</button>
    <div class="lightbox-stage" id="lightbox-stage">
      <img id="lightbox-img" alt="" />
      <svg id="lightbox-svg" preserveAspectRatio="none"></svg>
    </div>
    <button class="lightbox-nav lightbox-next" id="lightbox-next" aria-label="Next photo">›</button>
    <div class="lightbox-cap" id="lightbox-cap"></div>
  </div>
```

Then find this exact current line (end of the `.lightbox` rule, `marketing/portal/index.html:1608`):
```css
  .lightbox.open { display: flex; }
```
Insert these rules immediately **after** that line (matches the `.lightbox-close` token style at :1619; `.photo-day` uses a literal muted slate so it does not depend on an unverified CSS var; `.lightbox-cap` is `pointer-events:none` so a click in the caption band falls through to the backdrop = close, which is the intended/expected behavior — only the image and arrows are click-protected):
```css
  .photo-day {
    margin: 18px 0 8px; font-size: 12px; font-weight: 700;
    letter-spacing: 0.4px; text-transform: uppercase; color: #64748b;
  }
  .photo-day:first-child { margin-top: 0; }
  .lightbox-nav {
    position: absolute; top: 50%; transform: translateY(-50%);
    width: 46px; height: 46px; border-radius: 50%;
    background: rgba(255,255,255,0.10); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 26px; line-height: 1;
    border: 1px solid rgba(255,255,255,0.16); cursor: pointer;
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
    z-index: 101;
  }
  .lightbox-prev { left: 20px; }
  .lightbox-next { right: 20px; }
  .lightbox-cap {
    position: absolute; left: 0; right: 0; bottom: 22px;
    text-align: center; color: #fff; font-size: 13px; font-weight: 600;
    padding: 0 70px; pointer-events: none;
    text-shadow: 0 1px 4px rgba(0,0,0,0.6);
  }
```

- [ ] **Step 3: Rewrite the lightbox + swatch wiring (index-aware nav + guarded keydown + swatch no-nav)**

Find this exact current block (`marketing/portal/index.html:4920-4961`):
```js
    // Lightbox for photos
    var photoData = (sections.photos || []);
    document.querySelectorAll('.photo').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = parseInt(el.getAttribute('data-photo'), 10);
        var p = photoData[idx];
        if (!p) return;
        document.getElementById('lightbox-img').src = p.url;
        // Populate the SVG overlay with whatever markup the GC drew.
        // viewBox 0 0 1 1 makes our normalized coords map cleanly to
        // any rendered image size.
        var svg = document.getElementById('lightbox-svg');
        if (svg) {
          if (p.markup && p.markup.length) {
            svg.setAttribute('viewBox', '0 0 1 1');
            svg.style.display = 'block';
            svg.innerHTML = buildMarkupSvg(p.markup);
          } else {
            svg.innerHTML = '';
            svg.style.display = 'none';
          }
        }
        document.getElementById('lightbox').classList.add('open');
      });
    });
    function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
    document.getElementById('lightbox').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);

    // Selection swatches → lightbox. Same overlay as photos. We don't
    // have markup data for selections, so the SVG layer is hidden.
    document.querySelectorAll('[data-zoom]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation(); // don't trigger the parent .sel-opt's choose-selection
        var url = el.getAttribute('data-zoom');
        if (!url) return;
        document.getElementById('lightbox-img').src = url;
        var svg = document.getElementById('lightbox-svg');
        if (svg) { svg.innerHTML = ''; svg.style.display = 'none'; }
        document.getElementById('lightbox').classList.add('open');
      });
    });
```
Replace it **entirely** with:
```js
    // Lightbox for photos — index-aware so the client can page through
    // the whole set without closing. Swatch zoom reuses the overlay in a
    // single-image, no-nav mode (byte-identical to pre-D3-3 swatch UX).
    var photoData = (sections.photos || []);
    var lbIndex = 0;
    var lbMode = 'photo'; // 'photo' = nav enabled; 'single' = swatch (no nav)
    var lbEl   = document.getElementById('lightbox');
    var lbImg  = document.getElementById('lightbox-img');
    var lbSvg  = document.getElementById('lightbox-svg');
    var lbCap  = document.getElementById('lightbox-cap');
    var lbPrev = document.getElementById('lightbox-prev');
    var lbNext = document.getElementById('lightbox-next');

    function fmtPhotoDate(ts) {
      if (!ts) return '';
      var d = new Date(ts);
      return isNaN(d.getTime())
        ? ''
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function showLightboxAt(i) {
      if (!photoData.length) return;
      lbIndex = Math.max(0, Math.min(i, photoData.length - 1));
      var p = photoData[lbIndex];
      if (!p) return;
      lbImg.src = p.url;
      if (lbSvg) {
        if (p.markup && p.markup.length) {
          lbSvg.setAttribute('viewBox', '0 0 1 1');
          lbSvg.style.display = 'block';
          lbSvg.innerHTML = buildMarkupSvg(p.markup);
        } else {
          lbSvg.innerHTML = '';
          lbSvg.style.display = 'none';
        }
      }
      if (lbCap) {
        var parts = [];
        if (p.caption) parts.push(p.caption);
        var ds = fmtPhotoDate(p.timestamp);
        if (ds) parts.push(ds);
        lbCap.textContent = parts.join('  ·  ');
        lbCap.style.display = '';
      }
      var multi = photoData.length > 1;
      if (lbPrev) lbPrev.style.display = multi ? '' : 'none';
      if (lbNext) lbNext.style.display = multi ? '' : 'none';
    }
    document.querySelectorAll('.photo').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = parseInt(el.getAttribute('data-photo'), 10);
        if (isNaN(idx) || !photoData[idx]) return;
        lbMode = 'photo';
        showLightboxAt(idx);
        lbEl.classList.add('open');
      });
    });
    function closeLightbox() { lbEl.classList.remove('open'); }
    lbEl.addEventListener('click', closeLightbox);
    document.getElementById('lightbox-close').addEventListener('click', function (e) {
      e.stopPropagation(); closeLightbox();
    });
    lbImg.addEventListener('click', function (e) { e.stopPropagation(); });
    if (lbPrev) lbPrev.addEventListener('click', function (e) {
      e.stopPropagation(); if (lbMode === 'photo') showLightboxAt(lbIndex - 1);
    });
    if (lbNext) lbNext.addEventListener('click', function (e) {
      e.stopPropagation(); if (lbMode === 'photo') showLightboxAt(lbIndex + 1);
    });
    document.addEventListener('keydown', function (e) {
      if (!lbEl.classList.contains('open')) return;
      if (e.key === 'Escape') { closeLightbox(); return; }
      if (lbMode !== 'photo') return;
      if (e.key === 'ArrowLeft') showLightboxAt(lbIndex - 1);
      else if (e.key === 'ArrowRight') showLightboxAt(lbIndex + 1);
    });

    // Selection swatches → same overlay, single image, NO nav (no
    // photoData/markup context). Byte-identical UX to pre-D3-3.
    document.querySelectorAll('[data-zoom]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation(); // don't trigger the parent .sel-opt's choose-selection
        var url = el.getAttribute('data-zoom');
        if (!url) return;
        lbMode = 'single';
        lbImg.src = url;
        if (lbSvg) { lbSvg.innerHTML = ''; lbSvg.style.display = 'none'; }
        if (lbCap) { lbCap.textContent = ''; lbCap.style.display = 'none'; }
        if (lbPrev) lbPrev.style.display = 'none';
        if (lbNext) lbNext.style.display = 'none';
        lbEl.classList.add('open');
      });
    });
```

- [ ] **Step 4: Gate (reasoning + invariant greps)**

Run from the worktree root:
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" && \
echo "H4 sign RPC marker: $(grep -c 'portal_sign_contract' marketing/portal/index.html)" && \
echo "H4 choose RPC marker: $(grep -c 'portal_choose_selection' marketing/portal/index.html)" && \
echo "legacy raw-PATCH marker (must be 0): $(grep -c 'project_contracts?id=eq' marketing/portal/index.html)" && \
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" diff --stat
```
Expected: `portal_sign_contract` ≥ 1, `portal_choose_selection` ≥ 1, `project_contracts?id=eq` = 0, and `git diff --stat` lists ONLY `marketing/portal/index.html`.

Then reason through (report), per spec §6:
- **Timeline:** photos render under newest-first day headers (`Wed, May 19, 2026` style); within a day, snapshot order preserved; a photo with no/blank `timestamp` → single `Undated` group rendered LAST; single-day set → one header, no crash; **0 photos → `emptyState('No photos shared yet.')` unchanged and the section is still only added by the unchanged `addSection` gate at :4644-4645**.
- **`data-photo` invariant:** the `.forEach(p, idx)` index is the global index into `sections.photos`; `figure(p, idx)` emits `data-photo="<global idx>"`; the lightbox click reads `photoData[idx]` → still the right photo (first and last photo open correctly).
- **Lightbox nav:** click a photo → opens at that index, caption = `caption · Mon Day, Year`; `›`/`ArrowRight` and `‹`/`ArrowLeft` page through ALL photos (markup overlay + caption update per photo); clamps at both ends (no wrap, no out-of-range); single-photo set → arrows hidden; `Esc` and backdrop click close; clicking the image or an arrow does NOT close.
- **Swatch no-nav:** a `[data-zoom]` swatch → `lbMode='single'`, single image, no markup, arrows hidden, arrow keys inert (mode guard), `Esc`/backdrop close — byte-identical to pre-D3-3.
- **No regression:** every other portal section, the activity-feed photo events, hero photo, the snapshot decode, and the H4-hardened write path are untouched (only `renderPhotos`, the `#lightbox` element, its CSS, and the lightbox-wiring block changed; `renderPhotos` signature unchanged so :4644-4645 is untouched).

- [ ] **Step 5: Commit**
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add marketing/portal/index.html
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D3-3): portal client photo timeline (day groups) + lightbox prev/next nav"
```

---

## Ship (controller, AFTER final opus whole-impl review — NOT build, NOT git-push)
git-push auto-deploy is Netlify-credit-paused. Use the proven direct-deploy + promote path. After FF-merging `claude/p0-launch-on-main` → `main` and pushing (for source-of-truth parity):
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/marketing" && rm -rf dist && mkdir -p dist && \
rsync -a --exclude=dist --exclude=netlify.toml --exclude=node_modules --exclude=.git --exclude=.DS_Store ./ dist/ && \
NETLIFY_AUTH_TOKEN=<session PAT> netlify deploy --dir=dist --site=bd8356d7-81ea-4baf-a628-9ae75bcddc61 --message "D3-3 portal photo timeline + lightbox nav"
# capture the draft deploy id from the output, then promote:
NETLIFY_AUTH_TOKEN=<session PAT> netlify api restoreSiteDeploy --data '{"site_id":"bd8356d7-81ea-4baf-a628-9ae75bcddc61","deploy_id":"<draft id>"}'
```
Then verify live: `curl -s https://mageid.app/portal/index.html` contains `photo-day` / `lightbox-prev` AND still contains `portal_sign_contract` + `portal_choose_selection` AND does NOT contain `project_contracts?id=eq` (no H4 regression). Remind the user to revoke the PAT once D3-3 is live (last use).

## Self-Review
**Spec coverage:** §1 scope (single-file, ≤24 snapshot photos as-is, no cap raise, no search) → CRITICAL + Step 1 (no cap added) ; §3 goal (day-grouped timeline + lightbox prev/next + caption·date, read-only) → Steps 1-3 ; §4.1 timeline w/ global `data-photo`, `unknown` last, local-tz label → Step 1 ; §4.2 `showLightboxAt`/clamp/arrows/keyboard/caption + stopPropagation + backdrop-still-closes + swatch no-nav mode → Steps 2-3 ; §4.3 CSS near lightbox block, token-matched → Step 2 ; §5 error handling (no-photos unchanged, missing timestamp→Undated-last, data-photo integrity, close-vs-nav, swatch byte-identical, markup per-photo) → Steps 1,3 + Step 4 reasoning ; §6 verification → Step 4 ; §7 (cap raise / search deferred) → CRITICAL + Step 1 leaves cap untouched. No gaps.
**Placeholder scan:** No TBD/TODO. Full replacement code given for `renderPhotos`, the `#lightbox` HTML, the CSS, and the entire wiring+swatch block. The only non-literal token (`<session PAT>`) is a ship-time controller secret, not build code. Exact line anchors throughout.
**Type/name consistency:** `figure`, `order`, `byDay`, `dayLabel` (Step 1); `lbEl/lbImg/lbSvg/lbCap/lbPrev/lbNext`, `lbIndex`, `lbMode` ('photo'|'single'), `showLightboxAt`, `fmtPhotoDate`, `closeLightbox`, `photoData` (Step 3) — all consistent and self-contained within the single replaced block. `#lightbox-prev/#lightbox-next/#lightbox-cap` ids match between Step 2 (HTML+CSS) and Step 3 (JS getElementById). `renderPhotos(photos)` signature unchanged → :4644-4645 untouched. Single task → no cross-task drift.
