# Marketing Coherence + Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MAGE ID marketing site tell one coherent, credible story — a single "Start free" CTA to `https://app.mageid.app`, one offer per surface, the differentiator named "Bid Confidence" and shown, tier bullets reconciled to the app's real gating, competitor pages softened to non-numeric price framing — with zero invented content (owner slots are visible, clearly-marked placeholders).

**Architecture:** Static HTML/CSS/JS with no shared data layer, so consistency is enforced by the Canonical facts table below (single source of truth) plus a grep sweep. Every task ends with a grep assertion proving the change landed and that no banned string / stray price / wrong CTA survived. Owner-provided content lives in explicit `FOUNDER_NOTE` / `GC_QUOTES[]` / `USAGE_STATS` placeholder markup that ships visibly marked, never invented.

**Tech Stack:** Static HTML/CSS/JS (no build system, no test runner); verification via grep assertions + link/CTA audit; deploy via build-free `netlify deploy --dir marketing`.

---

## Canonical facts

Copied verbatim from the approved spec (`docs/superpowers/specs/2026-07-01-marketing-coherence-design.md`) so the executor never re-derives them. Where the spec's tier bullets were marked "verify against the app," Task 2 reconciles them to the code and the reconciled lists below (in **Reconciled tier bullets**) become canonical.

**CTA**
- Primary text: `Start free` → `https://app.mageid.app` (+ App Store badge linking to the listing).
- BANNED strings (must not survive anywhere): `Get early access`, `Request access`, `Request early access`, `Private beta`, `request access`, `early access`.

**Offer / pricing** (RevenueCat tiers, per `CLAUDE.md`)
- Free — **$0 forever · 1 project · no credit card**
- Pro — **$29/mo** (optional "try Pro free 14 days" ONLY on the Pro card)
- Business — **$79/mo**
- Enterprise — **$150/mo** (framed by outcome: "for AI-heavy shops running takeoffs daily", not raw request caps)
- Free/Pro/Business/Enterprise feature bullets must be **identical on `index.html` and `pricing.html`** and reflect actual gating.

**Differentiator**
- Public name: **Bid Confidence** (cost-learning engine). SHOWN (annotated screen/clip), not just asserted.
- Three headline pillars, in this order: **Voice field capture · Bid Confidence · Live client portal.**

**Competitor framing**
- No specific competitor dollar figures. Use "typically several hundred dollars a month, per seat" + the whole-company / flat-rate contrast. Remove every specific `$499`, `$1,099`, `$50k`, `$80M` competitor figure.

**Content slots (owner-provided; NEVER invented)**
- `FOUNDER_NOTE` — 1–2 sentences, "why I built this" / "built by a contractor for contractors."
- `GC_QUOTES[]` — 2–3 real attributed quotes (name/company or "GC, city").
- `USAGE_STATS` — real numbers only; if none provided, the stats bar is CUT (not faked).

### Reconciled tier bullets (Task 2 output — canonical; write IDENTICALLY into index.html + pricing.html)

Derived from `hooks/useTierAccess.ts` (`REQUIRED_TIER`, `FEATURE_LIMITS`), `utils/aiRateLimiterCore.ts` (`LIMITS`), and `supabase/functions/_shared/auth.ts` (`MONTHLY_CAPS`). Verified numbers:
- Daily text-AI caps (`LIMITS`): free 5 · pro 30 · business 80 · enterprise 150. Smart/advanced: free 0 · pro 6 · business 18 · enterprise 40.
- Monthly caps (`MONTHLY_CAPS`): drawing analyses pro 15 / business 50 / enterprise 100; photo analyses pro 50 / business 150 / enterprise 200; PDF conversions pro 50 / business 150 / enterprise 300.
- Free lifetime AI trials (`aiRateLimiterCore` `FEATURE_CONFIG`): Quick Estimate ×3, AI Estimate ×2, AI Takeoff ×1, Voice Capture ×3.
- Free limits (`FEATURE_LIMITS`): 1 project (`maxProjects.free=1`), community bids 2/mo, homeowner requests 2/mo. `voice_commands` = free.
- Pro-gated (`REQUIRED_TIER`='pro'): AI estimate wizard, AI takeoff, AIA pay apps, change orders + job costing, client portal, cash-flow forecaster, plan markup, lien waivers/closeout, schedule scenarios/PDF, proposal templates.
- Business-gated (`REQUIRED_TIER`='business'): subcontractor management, plan viewer, punch list/closeout, RFIs & submittals, full budget dashboard, unlimited bid responses.

**Free — $0 forever · 1 project · no credit card**
- 1 active project
- Client portal (1 homeowner)
- Daily reports + voice-to-log
- Basic schedule (manual Gantt)
- Geo-tagged photo capture
- A few free AI trials (Quick Estimate, AI Estimate, AI Takeoff, voice capture)
- Community bids · 2/mo

**Pro — $29/mo · whole company**
- Everything in Free, plus —
- Unlimited projects · subs always free
- AI estimates + AI takeoff (drawings analyzer)
- AIA G702/G703 pay apps
- Change orders + job costing
- Live client portals (custom-branded, 6 languages)
- Cash-flow forecaster + EVM
- Schedule Pro (CPM, baselines, weather reflow)
- Plans + markup & pinning
- Lien waivers + closeout binder

**Business — $79/mo**
- Everything in Pro, plus —
- Subcontractor management + sub portals
- Punch list & closeout binder
- RFIs & submittals workflow
- Plan viewer (full sheet pinning)
- Full budget dashboard
- CSV export → QuickBooks / Sage / Foundation
- Priority support + named CSM

**Enterprise — $150/mo · for AI-heavy shops running takeoffs, drawing analysis, and photo triage daily**
- Everything in Business, plus —
- 150 daily AI requests (vs 80)
- 40 advanced AI calls / day (vs 18)
- 100 drawing analyses / mo (vs 50)
- 200 photo analyses / mo (vs 150)
- 300 PDF conversions / mo (vs 150)
- Named CSM + priority support

**Two gating notes for the owner (from Task 2 reconciliation; do NOT block copy):**
1. `client_portal` has `REQUIRED_TIER='pro'` in `useTierAccess.ts`, but `FEATURE_LIMITS` documents a "1 free project + client portal" promise (`hooks/useTierAccess.ts:107`). Marketing keeps "Client portal (1 homeowner)" on Free per the documented promise. Flag: confirm the app actually grants a 1-homeowner portal on Free, or tighten the code gate.
2. `photo_documentation` is `REQUIRED_TIER='pro'`, but basic geo-tagged photo capture inside daily reports is ungated. Marketing keeps "Geo-tagged photo capture" on Free (basic capture); advanced photo documentation stays a Pro line.

---

## File map

Primary CTA / banned-string files (Task 1): `marketing/index.html`, `marketing/pricing.html`, `marketing/access.html`, `marketing/buildertrend-alternative.html`, `marketing/jobtread-alternative.html`, `marketing/houzz-pro-alternative.html`, `marketing/compare/procore.html`, `marketing/features/index.html`, `marketing/features/bids.html`, `marketing/features/field.html`, `marketing/features/post-a-project.html`, `marketing/features/financials.html`, `marketing/features/marketplace.html`, `marketing/features/scheduling.html`, `marketing/features/vs-takeoff.html`, `marketing/features/vs-competitors.html`.

Reference-only (read, do not invent from): `hooks/useTierAccess.ts`, `utils/aiRateLimiterCore.ts`, `utils/aiRateLimiter.ts`, `supabase/functions/_shared/auth.ts`.

New file (Task 5): `marketing/compare/index.html`.

Nav-bearing files touched for nav trim / Compare repoint (Task 5): `marketing/index.html`, `marketing/pricing.html`, `marketing/demo.html`, `marketing/playbook.html`, and every `features/*.html` + `*-alternative.html` + `compare/procore.html` whose nav points at `/features/vs-other-tools.html`.

Shared, no change needed: `marketing/nav-mobile.js` (injects a hamburger by cloning `.nav-links`; it hard-codes no destinations, so trimming the HTML nav is sufficient — do NOT edit this file).

---

### Task 1: Sitewide CTA + banned-string sweep

Replace every beta / request-access CTA with a single **Start free** → `https://app.mageid.app`, and scrub all banned strings. This spans 16 files; work file-by-file, then prove zero banned strings + zero `/access.html` primary CTAs remain.

**Files:** all 16 listed under "Primary CTA / banned-string files" in the File map.

- [ ] **Baseline assertion (currently FAILS).** Run:
  `cd marketing && grep -ricE "get early access|request access|request early access|private beta|early access" index.html pricing.html access.html buildertrend-alternative.html jobtread-alternative.html houzz-pro-alternative.html compare/procore.html features/*.html | grep -v ':0'`
  Expected AFTER task: no output (every file `:0`). It currently lists index.html, access.html, and 8 features/* files — confirm that before editing.

- [ ] **index.html — nav CTA (lines 110-113).** Before:
  ```html
      <a class="nav-cta" href="#cta">
        <span>Get access</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
  ```
  After:
  ```html
      <a class="nav-cta" href="https://app.mageid.app">
        <span>Start free</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
  ```

- [ ] **index.html — hero CTA (lines 154-158).** Before:
  ```html
          <a class="btn btn-primary magnetic" href="#cta">
            <span>Get early access</span>
  ```
  After:
  ```html
          <a class="btn btn-primary magnetic" href="https://app.mageid.app">
            <span>Start free</span>
  ```

- [ ] **index.html — A/B tracking comment (lines 756-758).** This comment names the old buttons and is what makes `grep "early access"` still hit after the visible copy is fixed. Before:
  ```html
  <!-- Track CTA clicks per A/B arm. Captures every primary + ghost
       button in the hero (Get early access, See how it works, nav
       Get access) so we can measure click-through per variant. -->
  ```
  After:
  ```html
  <!-- Track CTA clicks per A/B arm. Captures every primary + ghost
       button in the hero (Start free, See how it works, nav
       Start free) so we can measure click-through per variant. -->
  ```
  (The final-CTA form at lines 643-659 is rewritten in Task 3; leave it for now — Task 1's grep target is banned strings + the primary hero/nav CTA. The form's `Request access` strings will be cleared in Task 3. If running Task 1 standalone, also apply the Task 3 hero-form edit so the grep passes.)

- [ ] **pricing.html — 4 tier CTAs (lines 311, 337, 368, 393).** All four currently point at `/access.html`. Repoint each to `https://app.mageid.app`. Before/after (repeat for each of the 4 lines):
  - Line 311: `<a href="/access.html" class="tier-cta tier-cta-ghost">Start free</a>` → `<a href="https://app.mageid.app" class="tier-cta tier-cta-ghost">Start free</a>`
  - Line 337: `<a href="/access.html" class="tier-cta tier-cta-primary">Start 14-day trial</a>` → `<a href="https://app.mageid.app" class="tier-cta tier-cta-primary">Start free · try Pro 14 days</a>`  (this is the ONE allowed trial mention — Pro card only; finalized in Task 4)
  - Line 368: `<a href="/access.html" class="tier-cta tier-cta-ghost">Start 14-day trial</a>` → `<a href="https://app.mageid.app" class="tier-cta tier-cta-ghost">Start free</a>`
  - Line 393: `<a href="/access.html" class="tier-cta tier-cta-ghost">Start 14-day trial</a>` → `<a href="https://app.mageid.app" class="tier-cta tier-cta-ghost">Start free</a>`

- [ ] **Competitor pages — repoint all `/access.html` primary CTAs to `https://app.mageid.app`.** Button text is already "Start free" on these; only the href changes. Files + lines:
  - `buildertrend-alternative.html:83` and `:174` — `href="/access.html"` → `href="https://app.mageid.app"`
  - `jobtread-alternative.html:85` and `:174` — same
  - `houzz-pro-alternative.html` (hero cta-row `href="/access.html"`) and its cta-band — same
  - `compare/procore.html:117` and `:316` — same
  Run the batch check: `grep -rn 'href="/access.html"' buildertrend-alternative.html jobtread-alternative.html houzz-pro-alternative.html compare/procore.html` → expected `0` lines after edits.

- [ ] **features/bids.html (lines 170-171).** Before:
  ```html
        <p>Get early access and we'll help you set up your first saved searches to match your business.</p>
        <a class="btn btn-primary" href="/access.html">Request early access</a>
  ```
  After:
  ```html
        <p>Start free and set up your first saved searches to match your business.</p>
        <a class="btn btn-primary" href="https://app.mageid.app">Start free</a>
  ```

- [ ] **features/field.html (lines 264-265).** Before:
  ```html
        <p>Get early access and we'll import your in-progress projects with you.</p>
        <a class="btn btn-primary" href="/access.html">Request early access</a>
  ```
  After:
  ```html
        <p>Start free and bring your in-progress projects with you.</p>
        <a class="btn btn-primary" href="https://app.mageid.app">Start free</a>
  ```

- [ ] **features/post-a-project.html (line 195).** Before:
  `<a class="btn btn-primary" href="/access.html">Request early access</a>`
  After:
  `<a class="btn btn-primary" href="https://app.mageid.app">Start free</a>`

- [ ] **features/financials.html (lines 382-383).** Before:
  ```html
        <p>Get early access and we'll help you import your first project's financials.</p>
        <a class="btn btn-primary" href="/access.html">Request early access</a>
  ```
  After:
  ```html
        <p>Start free and import your first project's financials.</p>
        <a class="btn btn-primary" href="https://app.mageid.app">Start free</a>
  ```

- [ ] **features/marketplace.html (lines 157-158).** Before:
  ```html
        <p>Get early access and see the supplier directory for your metro.</p>
        <a class="btn btn-primary" href="/access.html">Request early access</a>
  ```
  After:
  ```html
        <p>Start free and see the supplier directory for your metro.</p>
        <a class="btn btn-primary" href="https://app.mageid.app">Start free</a>
  ```

- [ ] **features/scheduling.html (lines 195-196).** Before:
  ```html
        <p>Get early access and we'll walk you through setting up your first project.</p>
        <a class="btn btn-primary" href="/access.html">Request early access</a>
  ```
  After:
  ```html
        <p>Start free and set up your first project in minutes.</p>
        <a class="btn btn-primary" href="https://app.mageid.app">Start free</a>
  ```

- [ ] **features/vs-takeoff.html (lines 635-637).** Before:
  ```html
          <a class="btn btn-ghost" href="/#cta" style="border-color: rgba(255,255,255,0.3); color: var(--cream);">
            <span>Get early access</span>
          </a>
  ```
  After:
  ```html
          <a class="btn btn-ghost" href="https://app.mageid.app" style="border-color: rgba(255,255,255,0.3); color: var(--cream);">
            <span>Start free</span>
          </a>
  ```

- [ ] **features/vs-competitors.html (line 702).** Before:
  `<a class="btn btn-primary" href="/access.html">Request early access</a>`
  After:
  `<a class="btn btn-primary" href="https://app.mageid.app">Start free</a>`

- [ ] **features/index.html (line 755).** Before:
  `<a class="btn btn-primary" href="/access.html">Request access</a>`
  After:
  `<a class="btn btn-primary" href="https://app.mageid.app">Start free</a>`
  Also fix the nav "Get access" CTA if present at line ~771 (`<a href="/access.html">Get access</a>` → `<a href="https://app.mageid.app">Start free</a>`).

- [ ] **access.html — scrub banned strings, demote to secondary "concierge onboarding" (not the primary CTA).** Edits:
  - Line 6: `<title>Request access — MAGE ID</title>` → `<title>Get set up — MAGE ID</title>`
  - Line 12: `content="Request access — MAGE ID"` → `content="Get set up — MAGE ID"`
  - Line 181: `<span ...>Private beta</span>` → `<span ...>Concierge onboarding</span>`
  - Line 201: `<span class="eyebrow">Request access</span>` → `<span class="eyebrow">Talk to a builder</span>`
  - Line 205: `aria-label="Request access"` → `aria-label="Concierge onboarding request"`
  - Line 259: button text `Request access` → `Send it over`
  - Optionally soften the pitch copy (lines 182-196) so it reads as an optional white-glove path, not the only way in. Keep the Formspree form working.

- [ ] **Confirm the sweep.** Run all four:
  1. `grep -ricE "get early access|request access|request early access|private beta|early access" *.html compare/*.html features/*.html | grep -v ':0'` → **no output.**
  2. `grep -rn 'href="/access.html"' index.html pricing.html buildertrend-alternative.html jobtread-alternative.html houzz-pro-alternative.html compare/procore.html features/*.html` → **no output** (all primary CTAs repointed; nav links to access.html were converted too).
  3. `grep -rc "https://app.mageid.app" index.html pricing.html buildertrend-alternative.html jobtread-alternative.html houzz-pro-alternative.html compare/procore.html features/bids.html features/field.html features/financials.html features/marketplace.html features/scheduling.html features/vs-takeoff.html features/vs-competitors.html features/index.html features/post-a-project.html` → every file `>=1`.
  4. `grep -rc "Start free" index.html pricing.html` → both `>=1`.

- [ ] Commit: `Marketing: sitewide CTA sweep — single "Start free" → app.mageid.app, remove all beta/request-access strings`.

---

### Task 2: Reconcile tier bullets from the app

Read the three gating sources and confirm the **Reconciled tier bullets** in the Canonical facts section match the code. This task produces NO edits of its own — it validates the numbers that Tasks 3 and 4 write. (Kept separate so the reconciliation is a reviewable checkpoint before the bullets are duplicated into two files.)

**Files (read-only):** `hooks/useTierAccess.ts`, `utils/aiRateLimiterCore.ts`, `utils/aiRateLimiter.ts`, `supabase/functions/_shared/auth.ts`.

- [ ] Confirm daily caps: `grep -nE "free:|pro:|business:|enterprise:" utils/aiRateLimiterCore.ts` shows `free {daily:5,smart:0}`, `pro {30,6}`, `business {80,18}`, `enterprise {150,40}`. Matches the Enterprise "150 vs 80" / "40 vs 18" bullets.
- [ ] Confirm monthly caps: read `MONTHLY_CAPS` in `supabase/functions/_shared/auth.ts` — drawing analyses 15/50/100, photo analyses 50/150/200, convert_pdf 50/150/300. Matches Enterprise "100 vs 50" / "200 vs 150" / "300 vs 150" bullets.
- [ ] Confirm free lifetime trials: `grep -n "freeLifetimeCap" utils/aiRateLimiterCore.ts` — Quick Estimate 3, AI Estimate 2, AI Takeoff 1, Voice Capture 3. Matches Free "a few free AI trials" bullet.
- [ ] Confirm `REQUIRED_TIER` buckets in `hooks/useTierAccess.ts`: Pro-gated vs Business-gated lists match the Pro/Business bullet split.
- [ ] Record the two gating notes (client_portal on Free; photo capture on Free) verbatim from the Canonical facts section into the PR/commit description so the owner sees them.
- [ ] If ANY number in the Reconciled tier bullets disagrees with the code as read today, STOP and update the Canonical facts table (code wins) before proceeding to Task 3/4.
- [ ] No commit (validation only) — or an empty doc commit noting reconciliation confirmed. Proceed to Task 3.

---

### Task 3: Homepage (index.html)

Rewrite the hero around the spine, convert `#moat` into a SHOWN "Bid Confidence" proof block, re-order the three pillars to the canonical order, replace the vanity stats + insert the trust block scaffold, align the pricing-section bullets, and remove the "$1,099/mo" figure.

**Files:** `marketing/index.html` (hero 125-172, moat 254-277, product pillars intro 282-287, proof/stats 519-542, pricing intro 549-559, pricing tiers 561-627, final CTA 634-666).

- [ ] **Hero lede (lines 148-152) — name the differentiator.** Before:
  ```html
        <p class="lede reveal">
          MAGE ID is the only app that learns your real costs from finished jobs, prices your next bid
          off your own numbers, and warns you the moment a live job starts losing margin. Everything
          else organizes the chaos &mdash; we defend your profit.
        </p>
  ```
  After:
  ```html
        <p class="lede reveal">
          MAGE ID learns your real costs from finished jobs and gives every bid a <strong>Bid Confidence</strong>
          score &mdash; priced off your own numbers, not a catalog &mdash; then warns you the moment a live job
          starts losing margin. Voice capture in the field, Bid Confidence on the estimate, a live portal for
          your client. Everything else organizes the chaos; we defend your profit.
        </p>
  ```

- [ ] **Hero subline (lines 165-167) — remove the "$1,000-a-month" figure (banned competitor $).** Before:
  ```html
        <p class="reveal" style="margin-top:16px;font-size:14px;line-height:1.5;color:rgba(244,239,230,0.62);">
          One flat price. Your subs are free. No per-seat fees. No $1,000-a-month back office.
        </p>
  ```
  After:
  ```html
        <p class="reveal" style="margin-top:16px;font-size:14px;line-height:1.5;color:rgba(244,239,230,0.62);">
          One flat price. Your subs are free. No per-seat fees. No back office you have to pay by the head.
        </p>
  ```

- [ ] **Hero — add an App Store badge slot next to Start free (after line 158, inside `.cta-row`).** Insert after the primary Start free anchor:
  ```html
          <!-- App Store badge slot. ascAppId 6762229238 (per CLAUDE.md). Verify the
               listing is live before shipping; if not live, DELETE this anchor. -->
          <a class="btn btn-ghost magnetic" href="https://apps.apple.com/app/id6762229238" aria-label="Download MAGE ID on the App Store">
            <span>Download on the App Store</span>
          </a>
  ```

- [ ] **Grep assertion (hero).** `grep -c "Bid Confidence" index.html` → `>=1`; `grep -c '\$1,000-a-month' index.html` → `0`.

- [ ] **`#moat` → SHOWN Bid Confidence proof (lines 254-277).** Replace the three-card `.moat-grid` inner block with a two-column "shown" layout: a labeled screenshot slot on one side, the differentiator explainer on the other. Before (the `<div class="moat-grid">…</div>` at 259-275) is the three `moat-card`s. After:
  ```html
        <div class="moat-grid" style="grid-template-columns: 1fr 1fr; align-items:center;">
          <div class="moat-card reveal" style="padding:0;overflow:hidden;">
            <!-- BID CONFIDENCE PROOF — replace with an annotated capture/clip of the
                 cost-learning loop + margin-risk alert (the in-app BidConfidenceBadge).
                 Until the annotated asset exists, the closest real screen is the
                 budget/EVM screen. Owner to supply the annotated version. -->
            <img src="/screenshots/screens/18-budget-evm.png" alt="MAGE ID Bid Confidence — a bid priced off your real costs with a live margin-risk score" loading="lazy" style="width:100%;display:block;" />
            <p style="font-size:12px;color:rgba(244,239,230,0.5);margin:8px 12px;">[[ Bid Confidence — annotated demo clip, owner to provide ]]</p>
          </div>
          <div class="moat-card reveal">
            <span class="moat-num">Bid Confidence</span>
            <h3>Every bid, scored against <em>your</em> real costs.</h3>
            <p>Each finished job teaches MAGE your true prices &mdash; your subs, your supply house, your market. Your next estimate gets a <b>Bid Confidence</b> score calibrated to your actual numbers, not a generic catalog. Then a live <b>margin-risk alert</b> flags erosion <b>during</b> the job &mdash; not after the final invoice tells you the profit is gone. Nobody else does this.</p>
          </div>
        </div>
  ```
  (Keep the surrounding `<section class="moat" id="moat">`, eyebrow, `moat-h`, and `moat-sub` — just retarget the heading copy in the next step.)

- [ ] **`#moat` heading (lines 256-258) — name it.** Before:
  ```html
        <p class="eyebrow reveal">The difference</p>
        <h2 class="moat-h reveal">Three things no other contractor app does.</h2>
        <p class="moat-sub reveal">Not "all-in-one." Everyone says that. This is the part that actually keeps you in business.</p>
  ```
  After:
  ```html
        <p class="eyebrow reveal">The difference · Bid Confidence</p>
        <h2 class="moat-h reveal">See the number before you send the bid.</h2>
        <p class="moat-sub reveal">Not "all-in-one." Everyone says that. Bid Confidence is the part that actually keeps you in business.</p>
  ```

- [ ] **Three pillars order (lines 282-287 intro).** The five-pillar tour stays, but the intro must lead with the canonical trio in order (Voice field capture · Bid Confidence · Live client portal). Before:
  ```html
        <p class="eyebrow">The product</p>
        <h2 class="product-intro-h">Five pillars. One system of record.</h2>
        <p class="product-intro-sub">Every pillar is production — not a roadmap. Scroll to tour the whole project lifecycle. The portal pillar at the bottom is the story most homeowners actually live in.</p>
  ```
  After:
  ```html
        <p class="eyebrow">The product</p>
        <h2 class="product-intro-h">Three that matter most: voice field capture, Bid Confidence, the live client portal.</h2>
        <p class="product-intro-sub">Voice capture on site, Bid Confidence on every estimate, and a portal your client actually opens &mdash; wrapped in a full production system of record. Every pillar below is shipping, not a roadmap. Scroll to tour the whole lifecycle.</p>
  ```

- [ ] **PROOF section (lines 519-542) → trust block scaffold (USAGE_STATS + FOUNDER_NOTE + GC_QUOTES).** Replace the entire `.stats-row` vanity count-up with clearly-marked owner slots. Before is the `<div class="stats-row">…</div>` (523-540). Replace the whole `<section class="proof">…</section>` (519-542) with:
  ```html
    <section class="proof">
      <div class="wrap">
        <p class="eyebrow reveal">Why we built it</p>
        <!-- FOUNDER_NOTE — 1–2 sentences from the founder. Owner to provide.
             Do NOT invent. This visible placeholder ships until filled. -->
        <h2 class="proof-h reveal">[[ FOUNDER_NOTE — "why I built this," owner to provide ]]</h2>

        <!-- GC_QUOTES[] — 2–3 REAL attributed quotes (name/company or "GC, city").
             Owner to provide. Do NOT invent. These visible placeholders ship until filled. -->
        <div class="stats-row">
          <div class="stat-card"><div class="stat-label">[[ GC_QUOTE 1 — quote + name/company, owner to provide ]]</div></div>
          <div class="stat-card"><div class="stat-label">[[ GC_QUOTE 2 — quote + name/company, owner to provide ]]</div></div>
          <div class="stat-card"><div class="stat-label">[[ GC_QUOTE 3 — optional, owner to provide ]]</div></div>
        </div>

        <!-- USAGE_STATS — REAL numbers only. If none provided, DELETE this block
             (do not fake). Owner to provide. -->
        <p class="reveal" style="margin-top:24px;font-size:13px;color:rgba(244,239,230,0.5);">[[ USAGE_STATS — real numbers only, or delete this line; owner to provide ]]</p>
      </div>
    </section>
  ```

- [ ] **Pricing intro (lines 555-559) — remove the "$499–$1,099/mo" figure, soften.** Before:
  ```html
        <p class="pricing-sub reveal" style="margin-top:8px;">
          For comparison: Buildertrend now runs <strong>$499&ndash;$1,099/mo</strong> and roughly doubles
          after the intro period. MAGE is <strong style="color:#FF6A1A;">$29&ndash;$79 flat</strong> &mdash;
          for your whole company.
        </p>
  ```
  After:
  ```html
        <p class="pricing-sub reveal" style="margin-top:8px;">
          The legacy platforms typically run several hundred dollars a month, billed per seat. MAGE is
          <strong style="color:#FF6A1A;">$29&ndash;$79 flat</strong> &mdash; for your whole company, subs free.
        </p>
  ```

- [ ] **Pricing-section tier bullets (lines 561-627) — replace with the Reconciled tier bullets.** Rewrite the four `<ul class="tier-list">` blocks to match the Canonical facts "Reconciled tier bullets" exactly. Free (566-572), Pro (581-591), Business (599-608), Enterprise (616-624). Example — Free before:
  ```html
            <ul class="tier-list">
              <li>1 active project</li>
              <li>Basic estimates</li>
              <li>Voice commands</li>
              <li>Federal bid discovery (read-only)</li>
              <li>Community bids · 2 / mo</li>
            </ul>
  ```
  Free after:
  ```html
            <ul class="tier-list">
              <li>1 active project</li>
              <li>Client portal (1 homeowner)</li>
              <li>Daily reports + voice-to-log</li>
              <li>Basic schedule (manual Gantt)</li>
              <li>Geo-tagged photo capture</li>
              <li>A few free AI trials (estimate, takeoff, voice)</li>
              <li>Community bids · 2/mo</li>
            </ul>
  ```
  Apply the Pro / Business / Enterprise lists from the Canonical facts section identically (Enterprise numbers stay as verified in Task 2; keep the `<small>(vs 80)</small>` etc. inline notes). Also reframe the Enterprise `.tier-cap` (line 615) `AI-heavy GCs · highest quotas` → `For AI-heavy shops · takeoffs daily`.

- [ ] **Pricing tier CTAs (573, 592, 609, 625) — point to app.mageid.app.** These currently use `href="#cta"`. Change all four to `href="https://app.mageid.app"`. Keep the labels (`Start free`, `Go Pro`, `Choose Business`, `Choose Enterprise`).

- [ ] **Final CTA form (lines 634-666) — remove "Private beta / Request access", convert to Start free.** Before (642-665):
  ```html
        <p class="cta-sub reveal">
          Private beta is live. Request access and we'll onboard you &mdash; cost database and active
          pipeline &mdash; in a 15-minute call.
        </p>
        <form class="cta-form reveal" action="https://formspree.io/f/mblabgzr" method="POST" aria-label="Request access">
          ...
          <button type="submit" class="btn btn-primary magnetic">
            <span>Request access</span>
            ...
          </button>
        </form>
        <p class="cta-foot reveal" style="margin-top: 6px; font-size: 13px;">
          Want a longer form with details? <a href="/access.html">Use the full request form →</a>
        </p>
        <p class="cta-foot reveal">
          Or try it right now on <a href="https://app.mageid.app">app.mageid.app</a> — no download.
        </p>
  ```
  After (drop the Formspree form entirely; single Start free button + optional concierge link):
  ```html
        <p class="cta-sub reveal">
          Your first project is free &mdash; $0 forever, no credit card. Start now on the web, or grab it from the App Store.
        </p>
        <div class="cta-row reveal" style="justify-content:center;">
          <a class="btn btn-primary magnetic" href="https://app.mageid.app">
            <span>Start free</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </a>
        </div>
        <p class="cta-foot reveal" style="margin-top: 10px; font-size: 13px;">
          Want us to set up your cost database with you? <a href="/access.html">Book concierge onboarding →</a>
        </p>
  ```

- [ ] **Grep assertions (homepage).** All must hold:
  - `grep -cE "\$499|\$1,099|\$1,000-a-month" index.html` → `0`
  - `grep -c "Bid Confidence" index.html` → `>=3` (lede, moat eyebrow/heading, pillar intro)
  - `grep -c "FOUNDER_NOTE" index.html` → `>=1`; `grep -c "GC_QUOTE" index.html` → `>=2`; `grep -c "USAGE_STATS" index.html` → `>=1`
  - `grep -c 'data-count' index.html` → `0` (vanity count-up removed)
  - `grep -c 'href="#cta"' index.html` → `0` (all pricing/hero CTAs repointed)
  - `grep -cE "Private beta|Request access" index.html` → `0`

- [ ] Commit: `Marketing(index): name+show Bid Confidence, reorder pillars, trust-block scaffold, reconcile tier bullets, soften competitor price, single Start free CTA`.

---

### Task 4: Pricing page (pricing.html)

Remove the standalone 14-day trial headline, keep Free = $0 forever · 1 project · no card, put the ONLY "try Pro free 14 days" on the Pro card, reconcile all bullets to the canonical table, and reframe Enterprise by outcome.

**Files:** `marketing/pricing.html` (hero 290-300, Free card 303-324, Pro card 326-355, Business card 357-380, Enterprise card 382-403, FAQ 454-506).

- [ ] **Remove the standalone trial headline (lines 297-299).** Before:
  ```html
      <p style="font-size: 0.85rem; color: var(--fog); margin-top: 18px;">
        14-day free trial · No credit card required · Cancel anytime
      </p>
  ```
  After:
  ```html
      <p style="font-size: 0.85rem; color: var(--fog); margin-top: 18px;">
        Free forever on your first project · No credit card · Cancel anytime
      </p>
  ```

- [ ] **Free card (303-324) — reconcile to canonical Free bullets + confirm price line.** Keep price `$0` / `/ forever · 1 project` (308-309). Replace the `<ul class="tier-features">` (312-323) with the canonical Free list (using existing `.muted` styling for the not-included rows is optional). Canonical Free after:
  ```html
        <ul class="tier-features">
          <li>1 active project</li>
          <li>Client portal (1 homeowner)</li>
          <li>Daily reports + voice-to-log</li>
          <li>Basic schedule (manual Gantt)</li>
          <li>Geo-tagged photo capture</li>
          <li>A few free AI trials (estimate, takeoff, voice)</li>
          <li>Community bids · 2/mo</li>
          <li class="muted">AI estimating &amp; takeoff (unlimited)</li>
          <li class="muted">AIA pay apps · job costing</li>
          <li class="muted">Vetted sub directory</li>
        </ul>
  ```

- [ ] **Pro card — the ONE allowed trial mention (line 337).** After Task 1 this already reads `Start free · try Pro 14 days`. Confirm it's the only "14 day" string on the page: `grep -c "14 day" pricing.html` → expected `1` (only the Pro card CTA; the FAQ "Refunds" line at 504 must be edited next).

- [ ] **Pro card bullets (338-354) — reconcile.** Replace the `<ul class="tier-features">` with the canonical Pro list ("Everything in Free, plus —" section-break kept). Canonical Pro after:
  ```html
        <ul class="tier-features">
          <li>Unlimited projects · subs always free</li>
          <li class="section-break">Everything in Free, plus —</li>
          <li><strong>AI estimates + AI takeoff</strong> · drawings analyzer, LF/SF/EA</li>
          <li><strong>AIA G702/G703 pay apps</strong> with retainage</li>
          <li><strong>Change orders + job costing</strong></li>
          <li><strong>Live client portals</strong> (custom branded, 6 languages)</li>
          <li><strong>Cash flow + EVM</strong> · CPI, SPI, 12-week forecast</li>
          <li><strong>Schedule Pro</strong> · CPM, baselines, weather reflow</li>
          <li><strong>Plans + markup &amp; pinning</strong></li>
          <li><strong>Lien waivers + closeout binder</strong></li>
        </ul>
  ```

- [ ] **Business card (369-379) — reconcile.** Replace `<ul>` with canonical Business list:
  ```html
        <ul class="tier-features">
          <li class="section-break">Everything in Pro, plus —</li>
          <li>Subcontractor management + sub portals</li>
          <li>Punch list &amp; closeout binder</li>
          <li>RFIs &amp; submittals workflow</li>
          <li>Plan viewer (full sheet pinning)</li>
          <li>Full budget dashboard</li>
          <li>CSV export → QuickBooks / Sage / Foundation</li>
          <li>Priority support + named CSM</li>
        </ul>
  ```

- [ ] **Enterprise card — reframe by outcome (385, 391) + reconcile bullets (394-402).** Pitch (385) before `For GCs running AI-heavy workflows — drawing analyses, photo triage, spec extraction at scale.` → keep (already outcome-led). Price-extra (391) `Highest AI quotas. Same features as Business.` → `For AI-heavy shops running takeoffs daily. Highest quotas.` Bullets stay as-is (they already match `MONTHLY_CAPS`/`LIMITS` per Task 2) but ensure "Everything in Business, plus —" leads and the vs-numbers match: 150 vs 80, 40 vs 18, 100 vs 50, 200 vs 150, 300 vs 150.

- [ ] **FAQ "Refunds" (line 504) — drop the trial framing.** Before:
  `<p>14-day free trial means you don't pay until day 15. After that, monthly plans don't refund partial months; annual plans get a prorated refund within 30 days.</p>`
  After:
  `<p>Start free on your first project — no card required. On paid plans, monthly plans don't refund partial months; annual plans get a prorated refund within 30 days.</p>`

- [ ] **FAQ "Starter free forever" (473-474) — align wording to Free = $0 forever · 1 project.** Confirm it still says "One active project … client portal for one homeowner." Keep; no contradiction.

- [ ] **Grep assertions (pricing).** All must hold:
  - `grep -cE "14-day free trial" pricing.html` → `0` (standalone headline gone)
  - `grep -c "14 day" pricing.html` → `1` (only the Pro card CTA)
  - `grep -c "forever" pricing.html` → `>=1` (Free = $0 forever)
  - `grep -c "For AI-heavy shops running takeoffs" pricing.html` → `>=1` (Enterprise outcome framing)
  - Cross-file bullet parity spot-check: `grep -c "Subcontractor management" index.html pricing.html` → both `>=1`; `grep -c "AI estimates + AI takeoff" pricing.html` and `grep -c "AI estimates + takeoff" index.html` resolve to the same feature (accept minor wording; the FEATURE SET must match).

- [ ] Commit: `Marketing(pricing): one offer — $0 forever free, single Pro-only 14-day trial, reconciled bullets, outcome-framed Enterprise`.

---

### Task 5: Compare hub + nav trim

Create a lightweight Compare hub linking the four named-competitor pages, collapse the three redundant "vs." nav links into one "Compare" on index.html, and repoint every page's "Compare" nav link (currently `/features/vs-other-tools.html`) to the new hub.

**Files:** new `marketing/compare/index.html`; nav edits in `marketing/index.html` (100-109), `marketing/pricing.html` (278-285), `marketing/demo.html` (~352-353), `marketing/playbook.html` (~263-264), and every `features/*.html` + `*-alternative.html` + `compare/procore.html` nav that references `/features/vs-other-tools.html`.

- [ ] **Create `marketing/compare/index.html`.** A minimal page reusing the site's existing classes (nav + `wrap-wide` + `styles.css`). Full content:
  ```html
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Compare MAGE ID — vs. Procore, Buildertrend, JobTread, Houzz Pro</title>
    <link rel="canonical" href="https://mageid.app/compare/" />
    <meta name="description" content="How MAGE ID compares to Procore, Buildertrend, JobTread, and Houzz Pro — flat pricing for your whole company, Bid Confidence, and live margin protection." />
    <meta name="theme-color" content="#0B0D10" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon-180.png" />
    <link rel="stylesheet" href="/styles.css?v=2026-06-20" />
  </head>
  <body>
    <header class="nav">
      <div class="nav-inner">
        <a href="/" class="brand"><img class="brand-mark" src="/assets/logo-mark-light.png" alt="" width="32" height="32" /><span>MAGE&nbsp;ID</span></a>
        <nav class="links">
          <a href="/playbook.html">How it works</a>
          <a href="/compare/" class="active">Compare</a>
          <a href="/pricing.html">Pricing</a>
          <a href="/demo.html">Demo</a>
          <a href="https://app.mageid.app">Start free</a>
        </nav>
      </div>
    </header>
    <main>
      <section class="sub-hero wrap">
        <span class="eyebrow">Compare</span>
        <h1>How MAGE ID stacks up.</h1>
        <p>
          The legacy platforms typically cost several hundred dollars a month, billed per seat. MAGE ID is a flat
          price for your whole company &mdash; with two things none of them do: <strong>Bid Confidence</strong>
          (bids priced off your own real costs) and live margin-erosion alerts. Pick a head-to-head:
        </p>
      </section>
      <section class="section wrap-wide">
        <div class="feature-row" style="gap:16px;flex-wrap:wrap;">
          <a class="btn btn-ghost" href="/compare/procore.html">MAGE ID vs. Procore</a>
          <a class="btn btn-ghost" href="/buildertrend-alternative.html">MAGE ID vs. Buildertrend</a>
          <a class="btn btn-ghost" href="/jobtread-alternative.html">MAGE ID vs. JobTread</a>
          <a class="btn btn-ghost" href="/houzz-pro-alternative.html">MAGE ID vs. Houzz Pro</a>
        </div>
        <div class="cta-band" style="margin-top:40px;">
          <h2>Try the one built for your size of business.</h2>
          <p>Free to start. $29/mo when you're ready for Pro. Subs free, no per-seat math.</p>
          <a class="btn btn-primary" href="https://app.mageid.app">Start free</a>
        </div>
      </section>
    </main>
    <script src="/nav-mobile.js" defer></script>
    <script src="/motion.js" defer></script>
  </body>
  </html>
  ```

- [ ] **index.html nav (lines 100-109) — trim to ~5.** Before:
  ```html
      <nav class="nav-links" aria-label="Primary">
        <a href="/playbook.html">How it works</a>
        <a href="/features/">Explore</a>
        <a href="/features/vs-takeoff.html">vs. Takeoff Tools</a>
        <a href="/features/vs-other-tools.html">vs. Other Apps</a>
        <a href="/features/vs-competitors.html">vs. Software</a>
        <a href="/demo.html">Demo</a>
        <a href="#pricing">Pricing</a>
        <a href="/support.html">Support</a>
      </nav>
  ```
  After (5 items: How it works · Compare · Pricing · Demo · Start free):
  ```html
      <nav class="nav-links" aria-label="Primary">
        <a href="/playbook.html">How it works</a>
        <a href="/compare/">Compare</a>
        <a href="#pricing">Pricing</a>
        <a href="/demo.html">Demo</a>
        <a href="https://app.mageid.app">Start free</a>
      </nav>
  ```
  (The `.nav-cta` "Start free" button at 110-113, already fixed in Task 1, stays.)

- [ ] **Repoint every "Compare" nav link to `/compare/`.** In `pricing.html:281`, `demo.html:353`, `playbook.html:264`, and each `features/*.html`, `buildertrend-alternative.html:65`, `jobtread-alternative.html:65`, `houzz-pro-alternative.html:65`, `compare/procore.html:83`, change `<a href="/features/vs-other-tools.html" ...>Compare</a>` → `<a href="/compare/" ...>Compare</a>` (preserve any `class="active"`). Batch find: `grep -rln '/features/vs-other-tools.html' *.html features/*.html compare/*.html`.

- [ ] **Grep assertions (nav / hub).**
  - `test -f compare/index.html && echo ok` → `ok`
  - index nav item count: `grep -oE '<a href="[^"]+">[^<]+</a>' index.html | sed -n '/nav-links/,/\/nav/p'` is awkward for a one-liner; instead assert the removed links are gone: `grep -cE "vs\. Takeoff Tools|vs\. Other Apps|vs\. Software" index.html` → `0`.
  - `grep -rc '/features/vs-other-tools.html' *.html features/*.html compare/*.html | grep -v ':0'` → **no output** (all "Compare" nav links repointed to /compare/). NOTE: the fragmented `features/vs-takeoff.html`, `features/vs-other-tools.html`, `features/vs-competitors.html` pages remain as content but are delisted from nav.

- [ ] Commit: `Marketing: add /compare hub, trim homepage nav to 5, collapse the three "vs" links into one Compare`.

---

### Task 6: Competitor-page consistency + price softening

Each competitor page carries the same one CTA (done in Task 1) + one offer + a named differentiator, and NO specific competitor `$` figures. Remove `$499`, `$1,099`, `$50k`, `$80M` and replace with the canonical non-numeric framing.

**Files:** `marketing/buildertrend-alternative.html`, `marketing/jobtread-alternative.html`, `marketing/houzz-pro-alternative.html`, `marketing/compare/procore.html`, `marketing/features/vs-competitors.html`.

- [ ] **buildertrend-alternative.html — remove all `$499–$1,099` figures (7 occurrences: lines 8, 12, 49, 77, 96, 141, 163).** Replacements:
  - Line 8 (meta description): `Buildertrend now runs $499–$1,099/mo. MAGE ID is a flat $29–$79 for your whole company` → `Buildertrend is priced per seat and typically runs several hundred dollars a month. MAGE ID is a flat $29–$79 for your whole company`
  - Line 12 (og:description): `Priced out by Buildertrend's $499–$1,099/mo?` → `Priced out by Buildertrend's per-seat plans?`
  - Line 49 (FAQ JSON-LD answer): `versus Buildertrend's reported $499–$1,099/mo that rises after the intro period.` → `versus Buildertrend's per-seat pricing that typically runs several hundred dollars a month and rises after the intro period.`
  - Line 77 (hero): `but in 2026 its plans run <strong>$499&ndash;$1,099/mo</strong>, and reviewers report the price roughly doubles after the intro period.` → `but it's billed per seat &mdash; typically several hundred dollars a month &mdash; and reviewers report the price rises after the intro period.`
  - Line 96 (table Price row): `<td class="compare-no">$499&ndash;$1,099/mo; rises after ~2 mo<sup>1</sup></td>` → `<td class="compare-no">Per-seat; typically several hundred $/mo, rises after intro<sup>1</sup></td>`
  - Line 141: `no $499&ndash;$1,099/mo, no per-seat math.` → `no per-seat math.`
  - Line 163 (FAQ): `vs. a reported $499&ndash;$1,099/mo that rises after the intro period.` → `vs. per-seat pricing that typically runs several hundred dollars a month and rises after the intro period.`
  - Line 49 methodology note `<sup>1</sup>` (line 211) already reads "Pricing varies; verify current plans directly" — keep.

- [ ] **jobtread-alternative.html — no specific figures to remove (grep shows only MAGE's own $29–$79).** Confirm named differentiator present (hero already: "prices your next bid off your own finished jobs" + margin warning). Add the "Bid Confidence" name to the hero paragraph (line 78 area): change `it <strong>prices your next bid off your own finished jobs</strong>` → `it gives every bid a <strong>Bid Confidence</strong> score &mdash; priced off your own finished jobs`. Verify: `grep -c "Bid Confidence" jobtread-alternative.html` → `>=1`.

- [ ] **houzz-pro-alternative.html — no `$###` competitor figure (grep clean).** Add the named differentiator: in the hero paragraph change `a tool that defends your margin` → `Bid Confidence &mdash; bids priced off your real costs &mdash; and a tool that defends your margin`. Verify `grep -c "Bid Confidence" houzz-pro-alternative.html` → `>=1`.

- [ ] **compare/procore.html — remove `$50k` and `$80M` figures.**
  - Line 8 (meta): `Procore was built for the $80M commercial GC with a finance team.` → `Procore was built for the large commercial GC with a finance team.`
  - Line 13 (og): `No $50k onboarding. No sales call.` → `No enterprise onboarding fee. No sales call.`
  - Line 315 (cta-band `<p>`): `No sales call, no contract, no $50k onboarding.` → `No sales call, no contract, no enterprise onboarding fee.`
  - Any in-body `$50k`/`$80M` mentions: `grep -nE "\$50k|\$80M|\$80 ?million|\$50,000" compare/procore.html` — replace each with "enterprise onboarding fee" / "large commercial GC" framing. Add "Bid Confidence" to the differentiator line if absent: `grep -c "Bid Confidence" compare/procore.html` → target `>=1`.

- [ ] **features/vs-competitors.html — fix the stray `$24/mo` claim (line 700) and confirm the CTA (fixed in Task 1).** Before: `<p>Five minutes to your first WIP report. $24/mo when you're ready to bring on Pro features.</p>` → After: `<p>Five minutes to your first WIP report. Free to start; $29/mo Pro when you're ready.</p>` ($24 was the annual-effective Pro price and contradicts the canonical $29 offer.)

- [ ] **Grep assertions (competitor consistency).**
  - `grep -rnE "\$499|\$1,099|\$50k|\$80M|\$80 ?million" *.html compare/*.html features/*.html` → **no output.**
  - `grep -rc "typically several hundred" buildertrend-alternative.html` → `>=1`.
  - `grep -rc "Bid Confidence" buildertrend-alternative.html jobtread-alternative.html houzz-pro-alternative.html compare/procore.html` → each `>=1`.
  - `grep -c '\$24/mo' features/vs-competitors.html` → `0`.
  - Each competitor page has exactly one Start-free offer statement: `grep -c "Start free" buildertrend-alternative.html` etc. → `>=1`, and `grep -cE "Request|Private beta" <file>` → `0`.

- [ ] Commit: `Marketing(compare): soften competitor prices to non-numeric framing, name Bid Confidence on every head-to-head, fix stray $24 Pro claim`.

---

### Task 7: Content-slot scaffold verification

Confirm the three owner-content slots ship as visible, clearly-marked placeholders (so nothing invented goes live and the owner can find them). Most slot markup is inserted in Task 3; this task is the gate.

**Files:** `marketing/index.html` (trust block from Task 3), and the Bid Confidence proof image slot (Task 3 moat block).

- [ ] Assert `FOUNDER_NOTE` slot is present and visible: `grep -c "FOUNDER_NOTE" index.html` → `>=1`, and the visible `[[ FOUNDER_NOTE` text is inside a rendered element (the `<h2 class="proof-h">`), not only an HTML comment.
- [ ] Assert `GC_QUOTES[]` slots: `grep -c "GC_QUOTE" index.html` → `>=2` and each is inside a visible `.stat-label` (renders on the page).
- [ ] Assert `USAGE_STATS` slot: `grep -c "USAGE_STATS" index.html` → `>=1`, inside a visible `<p>` (or the block is deleted if the owner confirms no real numbers).
- [ ] Assert the Bid Confidence proof carries a visible "owner to provide" annotation marker: `grep -c "annotated demo clip, owner to provide" index.html` → `>=1`.
- [ ] Assert the App Store badge slot carries its verify-before-ship note: `grep -c "Verify the" index.html` → `>=1` (from the Task 3 badge comment).
- [ ] **Deploy gate reminder (do NOT auto-deploy):** per the spec's risk mitigation, the site must not go live with unfilled invented content, but the visible `[[ … owner to provide ]]` placeholders are acceptable to ship IF the owner explicitly approves stubs. Surface this in the PR description; do not deploy without owner go-ahead (see Task 8).
- [ ] Commit (if any tweak needed): `Marketing: verify owner content slots are visible, clearly-marked placeholders`.

---

### Task 8: Full-site grep + link verification sweep

The final gate. Prove every spec invariant across the whole `marketing/` tree, then hand off to the owner for deploy.

**Files:** all of `marketing/`.

- [ ] **Zero banned strings anywhere:** `cd marketing && grep -ricE "get early access|request access|request early access|private beta|early access" *.html compare/*.html features/*.html | grep -v ':0'` → **no output.**
- [ ] **Every primary CTA points to app.mageid.app; no orphan `/access.html` primary CTAs:** `grep -rn 'href="/access.html"' *.html features/*.html compare/*.html` → only the intentional "Book concierge onboarding" secondary link(s) may remain (index final CTA); confirm each remaining hit is a clearly-secondary link, not a primary button. `grep -rc "https://app.mageid.app" *.html features/*.html compare/*.html | grep -v ':0'` → every user-facing page `>=1`.
- [ ] **No specific competitor dollar figures:** `grep -rnE "\$499|\$1,099|\$50k|\$80M|\$80 ?million|\$1,000-a-month" *.html compare/*.html features/*.html` → **no output.**
- [ ] **"Bid Confidence" used consistently:** `grep -rc "Bid Confidence" index.html jobtread-alternative.html houzz-pro-alternative.html buildertrend-alternative.html compare/procore.html compare/index.html` → each `>=1`.
- [ ] **One offer per surface (no contradictory trial headline):** `grep -rn "14-day free trial" *.html` → **no output**; `grep -c "14 day" pricing.html` → `1` (Pro card only).
- [ ] **Nav ~5 items + Compare hub resolves:** `test -f compare/index.html && echo ok` → `ok`; `grep -cE "vs\. Takeoff Tools|vs\. Other Apps|vs\. Software" index.html` → `0`; `grep -rc '/features/vs-other-tools.html' *.html features/*.html compare/*.html | grep -v ':0'` → **no output.**
- [ ] **Link audit:** grep every `href="/…"` internal link and confirm the target file exists: `for l in $(grep -rhoE 'href="/[a-z0-9/_-]+\.html"' *.html features/*.html compare/*.html | sed -E 's/href="//;s/"//' | sort -u); do [ -f ".${l}" ] || echo "MISSING: $l"; done` → no `MISSING:` output. Also confirm `/compare/` resolves (directory index).
- [ ] **Tier-bullet parity spot-check:** the Free/Pro/Business/Enterprise FEATURE SETS on index.html and pricing.html match the Reconciled tier bullets. Manually diff the two `tier-list`/`tier-features` blocks; confirm no bullet exists on one page and contradicts the other.
- [ ] **Visual spot-check** (per spec §Verification): open index.html, pricing.html, and one competitor page in a browser (or Chrome MCP) — confirm the Bid Confidence proof image renders, the trust-block placeholders are visibly marked, and the single Start free CTA is present in hero + nav + final CTA.
- [ ] **Hand off for deploy — do NOT auto-deploy.** Per `MEMORY.md` netlify procedure: mageid.app builds are credit-paused; deploy is build-free `netlify deploy --dir marketing` and needs the owner's PAT + explicit go-ahead. Report the grep results and the unfilled content slots (FOUNDER_NOTE, GC_QUOTES, USAGE_STATS, Bid Confidence annotated clip, App Store listing URL) to the owner and wait for approval before any deploy.
- [ ] Commit: `Marketing: full-site coherence verification sweep — zero banned strings, single Start free CTA, softened competitor pricing`.
