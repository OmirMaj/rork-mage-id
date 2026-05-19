# D3-3 — Portal Client Photo Timeline + Lightbox Navigation — Design

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` item **D3** ("photos demo deep, deliver shallow"). The final decomposed follow-on, defined in `docs/superpowers/specs/2026-05-18-d3-1-client-gallery-lightbox-design.md` §7 ("D3-3: portal client gallery / shareable live timeline in `marketing/portal/index.html` — inherits H4's Netlify block") and `…d3-2-durable-photo-library-design.md` §7. **The H4 Netlify block is now resolved** (hardened portal live; deploy path proven), so D3-3 is buildable.

Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`. The homeowner portal is the single static file `marketing/portal/index.html` (pure HTML/CSS/JS, no build step). **App-only-on-the-portal-file**: no `app/` change, no `utils/portalSnapshot.ts` change, no migration, no new RPC. Ships via the **proven direct-deploy + `restoreSiteDeploy` path** (NOT git-push auto-deploy — that is Netlify-credit-paused).

## 1. Scope decision (read first — the snapshot-data reality)

D3-1 (in-app client-view) and D3-2 (in-app project-detail) shipped: uncap + tappable + swipeable lightbox, and free-text search + auto-album-by-date. The audit/§7 frames D3-3 as the **portal** equivalent. Investigation of the actual portal data path:

- `utils/portalSnapshot.ts` (:535-556) builds `sections.photos` **gated by `portal.showPhotos`**, **sorted newest-first by `timestamp`**, **capped at `maxPhotos` (default 24)** — the cap exists explicitly "to prevent URL bloat" (the snapshot is base64 in the URL hash; the homeowner portal has no live photo read — it renders the snapshot). Each item is `{ url, caption: (tag ?? location), timestamp, markup[] }`.
- `marketing/portal/index.html` `renderPhotos` (:3613-3632) already renders **all** snapshot photos (no extra cap) as a flat masonry `.photo-wall`; a `.lightbox` exists (:2316-2320, wired :4921-4947) that opens one photo by index with its markup SVG, but has **no photo-to-photo navigation** (any click closes it) and there is **no date grouping and no search**.

**Decision:** D3-3 brings the portal client gallery to parity with the shipped in-app galleries **within the data the snapshot already provides** — i.e. (a) a date-grouped *timeline* (the snapshot already carries `timestamp`) and (b) lightbox prev/next navigation (D3-1 parity). Raising the 24-photo cap is **explicitly out of scope**: it is an `app/`-side `utils/portalSnapshot.ts` change with a real URL-length constraint (deferred, §7). Portal-side free-text search is **out of scope** (≤24 photos visible at once, and the snapshot collapses tag/location into one `caption` — search adds negligible value at this scale; honest YAGNI). This keeps D3-3 a single-file, read-only, proportionate completion of the D3 trilogy.

## 2. Problem

The shipped in-app galleries (D3-1/D3-2) give the GC a real photo experience; the **client**, who sees the project through `marketing/portal/index.html`, gets a flat undifferentiated masonry wall and a dead-end lightbox:

- **No timeline.** `renderPhotos` (:3619-3631) emits one flat `.photo-wall` of all snapshot photos with no chronological structure — a 24-photo project is an undated wall. The audit explicitly wants a "shareable live photo **timeline**." The data (`timestamp` per photo) is already in the snapshot and unused for grouping.
- **Lightbox is a dead-end.** Opening a photo (:4922-4944) shows that one image; the only interaction is "click anywhere → close" (:4946). To see the next photo the client must close and hunt for the next thumb — the same dead-end D3-1 fixed in-app. No prev/next, no keyboard, no caption/date shown full-screen.

## 3. Goal / Non-goals

**Goal:** In `marketing/portal/index.html` only: (a) render the Site Photos section as a **newest-first, day-grouped timeline** — a date header per day above that day's existing `.photo-wall` — using the `timestamp` already in each snapshot photo; (b) give the existing lightbox **prev/next navigation** (on-screen arrows + keyboard ← / → + Esc) and a caption line showing the current photo's caption · date. Read-only. Every other portal section, the snapshot, the GC app, the H4-hardened write RPCs — byte-unaffected. When photos lack `timestamp` they fall into a single "Undated" group rendered last (no crash, no regression).

**Non-goals (YAGNI / scope / independence):**
- NOT raising the snapshot's 24-photo `maxPhotos` cap — that is an `app/` `utils/portalSnapshot.ts` change with a real URL-size reason; deferred (§7). D3-3 works with exactly the photos the snapshot already provides.
- NO portal-side search/filter (≤24 photos, caption-only data — negligible value; honest YAGNI).
- NO portal-side markup editing, photo upload, or download — read-only timeline; existing GC markup stays shown read-only exactly as today.
- NO `app/` change, NO `utils/portalSnapshot.ts` change, NO migration, NO new/changed RPC, NO new portal auth surface. The gallery is read-only off the existing snapshot; the H4-hardened write path is untouched.
- NO new dependency / no framework — vanilla JS in the existing file, mirroring its current style. `groupPhotosByDay` logic is reimplemented inline (the portal is a standalone static file and cannot import `utils/`); it is ~10 trivial lines.
- NO change to the activity-feed photo aggregation (:2586), the hero photo, or the selection-swatch lightbox reuse (:4951) beyond what the shared lightbox-navigation change inherently touches (which must remain correct for swatches — see §5).

## 4. Architecture

Single-file change to `marketing/portal/index.html`: one render-function rewrite, one lightbox-wiring extension, a few CSS rules. Mirrors the file's existing vanilla-JS conventions (`esc()`, `emptyState()`, string-built HTML, `addSection`).

### 4.1 Day-grouped timeline (`renderPhotos`, ~:3613-3632)
Replace the flat `.photo-wall` build with: group `photos` (already newest-first from the snapshot) by `timestamp`'s calendar day, preserving the incoming order within and across groups, then for each day emit a date-header element followed by that day's existing `.photo-wall` (the per-photo `<figure data-photo="idx">` markup, sizing hints, caption, markup badge stay **byte-identical**, and `data-photo` stays the **global index into `sections.photos`** so the existing lightbox wiring keeps working unchanged). Photos with missing/blank `timestamp` → one `"Undated"` group emitted **last**. Day key = `timestamp.slice(0,10)` (ISO `YYYY-MM-DD`) or `"unknown"`; header label = a human date (e.g. `Mon, May 19, 2026`) via `new Date(key + 'T00:00:00')` (local-tz parse — no off-by-one) and `"Undated"` for `unknown`. Empty/no-photos path returns the existing `emptyState('No photos shared yet.')` unchanged. This mirrors the proven `groupPhotosByDay` (sorted newest-day-first; `unknown` bucket) and the sibling `app/shared-photos.tsx`/`utils/photoShareToken.ts` day-grouping already shipped.

### 4.2 Lightbox prev/next (wiring ~:4920-4947)
Keep the existing open-by-index behavior. Add module-scoped `lbIndex` + a `showLightboxAt(i)` that sets the image, markup SVG (same logic as today), and a new caption line (`photoData[i].caption` · formatted `photoData[i].timestamp`), clamping `i` into `[0, photoData.length-1]`. Add two on-screen controls (`‹` / `›`) and `keydown` (`ArrowLeft`/`ArrowRight` step, `Escape` close) active only while open. The current "click backdrop closes" stays, but the image, the nav arrows, and the caption must `stopPropagation` so navigating doesn't close (today the whole overlay closes on any click — §5). Wrap-around is not required (clamp at ends). The selection-swatch reuse of the same lightbox (:4951-4961) opens a single image with no `photoData` context → it must set a "single, no-nav" mode (hide arrows, ignore arrow keys) so swatch zoom is byte-unchanged.

### 4.3 CSS
A date-header style (small, muted, sticky-optional — non-sticky to stay simple) and prev/next button styles, matching the file's existing token vars (`--radius-md`, the lightbox close-button styling at :1619). No design-system change.

## 5. Error handling / correctness

- **No-photos / section gating:** unchanged — `renderPhotos` still returns `emptyState(...)` for empty, and the section is still only added when `sections.photos.length` (:4644-4645) and `portal.showPhotos` gated it into the snapshot. Zero behavior change when there are no photos.
- **Missing `timestamp`:** grouped into a single trailing "Undated" group; `new Date('…T00:00:00')` is never called on `unknown`. No crash, no NaN date.
- **`data-photo` index integrity:** the per-figure `data-photo` must remain the index into the flat `sections.photos` array (not a per-group index) so the existing lightbox lookup `photoData[idx]` (:4925) stays correct after grouping. This is the single most important invariant — verified explicitly (§6).
- **Lightbox close vs navigate regression:** today any click on `#lightbox` closes it (:4946). Adding in-overlay controls requires `stopPropagation` on the image + arrows + caption; the backdrop itself still closes. Must verify backdrop-click still closes and arrow-click does NOT close.
- **Selection-swatch lightbox reuse:** the swatch path (:4951-4961) shares `#lightbox` but has no photo list. It must explicitly enter "no-nav" mode (arrows hidden, arrow-keys inert, no caption) so swatch zoom is byte-identical to today. Verified (§6).
- **Markup overlay:** unchanged — the existing `buildMarkupSvg` + viewBox logic is reused as-is per displayed photo, including while navigating (markup must update per photo, not stick from the previously viewed one).
- Read-only: no writes, no RPC, no snapshot/app/migration change → the H4-hardened write path, `utils/portalSnapshot.ts`, and the GC app are provably unaffected (this file is not imported by them).

## 6. Verification (no unit runner)

Static-file change; gate = reasoning + a local open of `marketing/portal/index.html` with a representative snapshot, plus the deployed-URL check post-ship:
- Multi-day photo set → photos render under correct newest-first day headers; within a day, snapshot order preserved; an `"Undated"` group (photo with no `timestamp`) renders last; single-day set → one header, no crash; **0 photos → existing empty state, section still gated exactly as before**.
- `data-photo` indices still map to `sections.photos` (open the 1st and last photo via the wall → lightbox shows the right image+markup).
- Lightbox: opens at clicked photo; `›`/`ArrowRight` and `‹`/`ArrowLeft` move through **all** photos with caption·date updating and markup overlay updating per photo; clamp at both ends (no wrap, no crash); `Esc` and backdrop-click close; arrow/image click does NOT close.
- Selection-swatch zoom (a `[data-zoom]` swatch) → opens single image, **no arrows, arrow-keys inert**, closes — byte-identical to today.
- Every other portal section (schedule, invoices, COs, daily reports, activity feed incl. its photo events, hero photo) and the snapshot decode are byte-unaffected.
- `git diff` shows ONLY `marketing/portal/index.html` changed.
- Post-ship: `curl https://mageid.app/portal/index.html` contains the timeline/nav additions and still contains the H4 markers (`portal_sign_contract`, `portal_choose_selection`) and NOT the legacy raw-PATCH marker (no regression of the H4-hardened live portal); a real portal URL renders the timeline.
- Final whole-impl review (opus): confirm single-file, read-only, `data-photo` invariant, swatch no-nav, H4 markers intact, no `app/`/snapshot/migration touch.

## 7. Out of scope / future

- **Raising the snapshot's 24-photo cap** — `utils/portalSnapshot.ts` `maxPhotos`; an `app/`-side change bounded by URL-hash length. If the client must see >24, that needs a live scoped portal photo read (anon SELECT scoped by enabled `portalId`, mirroring the H4 read pattern) or a different transport — its own brainstorm/spec. Deferred.
- Portal-side search/filter, photo download/share, client-side markup, per-photo comments — future, not planned.
- Live (non-snapshot) portal photo feed — future; would pair with the cap-raise above.
