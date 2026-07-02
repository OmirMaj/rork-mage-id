# Marketing Coherence + Proof — Design Spec

**Date:** 2026-07-01
**Status:** Approved design, ready for implementation plan
**Thread:** 4 of 4 from the app/marketing/onboarding audit (threads 1 [value-first activation] built; 2 [reveal the moat in-app] and 3 [estimating → margin pricing] queued).
**Scope:** Approach B — full-funnel coherence + proof (messaging/structure). NOT the visual overhaul (thread 2).

---

## Problem

The MAGE ID marketing site (static HTML/CSS/JS in `marketing/`) undercuts a genuinely strong product by contradicting itself and hiding the moat. Confirmed in current copy:

- **Three conflicting start paths** coexist: "Get early access" (`index.html:156,757`), "Request access" / "Private beta" (`index.html:643–656`), and "Start free" + "app.mageid.app · no download" (`index.html:573,664`).
- **Two contradictory offers** on the pricing page: "14-day free trial · No credit card" (`pricing.html:298`) and "$0 forever · 1 project" (`pricing.html:308–309`).
- **Inflated/unverifiable competitor price:** "$1,099/mo" (`index.html:556`) / "$499–$1,099/mo" (`buildertrend-alternative.html:8`) vs. the product bible's ~$299–399 — a prospect who checks feels misled.
- **The differentiator is asserted, never named or shown:** "the only app that learns your…" (`index.html:149`), "Nobody else" (`index.html:263`) — no memorable name, no proof.
- **Zero social proof** anywhere; a vanity count-up stats bar stands in for evidence.
- **Fragmented compare IA:** three near-identical "vs." nav axes + competitor pages scattered across `/features/`, `/compare/`, and root `*-alternative.html`.

## Goal

One coherent, credible top-of-funnel that tells the SAME differentiator story the product now delivers — everywhere a prospect looks.

## Decisions (locked)

1. **GTM: live self-serve.** One CTA sitewide: **"Start free"** → `https://app.mageid.app` (+ App Store badge). All "early access / request access / private beta" language removed.
2. **Offer: free-forever is the hook.** Free = **$0 forever, 1 project, no card.** Pro $29 is the upgrade (optional small "try Pro free 14 days" on the Pro card only). No standalone "14-day trial" headline.
3. **Trust: founder story + real GC quotes.** Honest founder-led angle PLUS a testimonials block filled with REAL quotes the owner provides. **No invented quotes or fake numbers** — the build scaffolds clearly-marked content slots.
4. **Differentiator name: "Bid Confidence"** (matches the in-app `BidConfidenceBadge`), and it is SHOWN (annotated screen/clip), not just asserted.
5. **Competitor prices: soften to non-numeric, defensible framing** ("typically several hundred dollars/month, billed per seat / whole-company"). Remove the specific "$499–$1,099" figures. Win on the flat-vs-per-seat structural argument.
6. **Scope: Approach B.** Homepage + pricing + competitor pages + nav. Out: visual/motion overhaul, new pages, backend/form changes, calculator/playbook rework.

---

## Canonical facts (single source of truth — every page MUST match)

Static HTML has no shared data layer, so consistency is enforced by this table + a grep sweep in the plan.

**CTA**
- Primary text: `Start free` → `https://app.mageid.app` (+ App Store badge linking to the listing).
- BANNED strings (must not survive anywhere): `Get early access`, `Request access`, `Private beta`, `request access`, `early access`.

**Offer / pricing** (RevenueCat tiers, per `CLAUDE.md`)
- Free — **$0 forever · 1 project · no credit card**
- Pro — **$29/mo** (optional "try free 14 days" ONLY on the Pro card)
- Business — **$79/mo**
- Enterprise — **$150/mo** (framed by outcome: "for AI-heavy shops running takeoffs daily", not raw request caps)
- The Free/Pro/Business/Enterprise **feature bullets must be identical on `index.html` and `pricing.html`**, and must reflect the app's ACTUAL gating. Canonical bullets to VERIFY against the app during build (`hooks/useTierAccess.ts` FEATURE_LIMITS, `utils/aiRateLimiter*` caps, `_shared/auth.ts` MONTHLY_CAPS):
  - Free: 1 project · client portal (1 homeowner) · a few free AI trials (voice/estimate/takeoff) · basic schedule
  - Pro: unlimited projects · AI estimates + takeoffs · pay apps · higher AI caps
  - Business: everything in Pro · subcontractor management · higher AI caps
  - Enterprise: everything in Business · highest AI caps · priority support
  - (The plan MUST reconcile these to the real numbers, not ship the placeholders above verbatim if the code differs.)

**Differentiator**
- Public name: **Bid Confidence** (cost-learning engine).
- Three headline pillars, in this order: **Voice field capture · Bid Confidence · Live client portal.**

**Competitor framing**
- No specific competitor dollar figures. Use "typically several hundred dollars a month, per seat" + the whole-company/flat-rate contrast.

**Content slots (owner-provided; NEVER invented)**
- `FOUNDER_NOTE` — 1–2 sentences, "why I built this" / "built by a contractor for contractors."
- `GC_QUOTES[]` — 2–3 real attributed quotes (name/company or "GC, city").
- `USAGE_STATS` — real numbers only; if none provided, the stats bar is CUT (not faked).

---

## Per-file changes

### `index.html` (homepage)
- **Hero:** rewrite headline around the spine (§ "one true story"); single **Start free** CTA + App Store badge; remove "Get early access" (156/757) and the secondary access asks.
- **Moat → proof:** convert the `#moat` section (263) into a **shown** demo — an annotated screenshot or short clip of the cost-learning loop + margin-risk alert; label it **Bid Confidence**.
- **Three pillars** section maps to Voice field capture · Bid Confidence · Live client portal (promote voice out of a sub-bullet).
- **Trust block:** insert `FOUNDER_NOTE` + `GC_QUOTES[]` scaffold.
- **Stats:** replace the vanity count-up with `USAGE_STATS` (real) or remove.
- **Pricing section:** align tier bullets to the canonical table (currently disagrees with pricing.html).
- **Competitor mention (556):** remove the "$1,099/mo" figure; use the softened framing.

### `pricing.html`
- Remove the standalone "14-day free trial · No credit card" headline (298); Free = $0 forever · 1 project · no card (308–309 kept/clarified).
- Optional "try Pro free 14 days" on the Pro card ONLY.
- Reconcile all tier bullets to the canonical table (identical to index.html).
- Reframe Enterprise around the outcome, not request caps.

### Competitor pages + nav
- **New Compare hub** (reuse an existing page or a lightweight `compare/index.html`) linking the named-competitor pages; collapse the three redundant "vs." nav links.
- **Trim nav to ~5:** How it works · Compare · Pricing · Demo · Start free.
- Each `*-alternative.html` (buildertrend, jobtread, houzz-pro) + `compare/procore.html`: same one CTA + one offer + named differentiator; competitor prices softened per the canonical framing.

---

## Non-goals (out of scope — queued/other threads)
Visual/motion/glass overhaul + progressive-enhancement (thread 2); new marketing pages; backend or form/endpoint changes beyond pointing CTAs at `app.mageid.app`; calculator/playbook rework; the in-app portal showcase build (thread 2/3).

## Risks & mitigations
- **Facts drift:** the canonical table + grep sweep prevent re-introducing contradictions.
- **Empty content slots shipping live:** the plan gates deploy on slots being filled OR explicitly stubbed with visible placeholder text the owner approves — never invented content.
- **Competitor claims:** non-numeric framing avoids publishing unverifiable figures.

## Verification (static site, no build system)
- **Grep sweep:** zero banned CTA strings remain; exactly one offer statement per surface; prices match the canonical table across all pages; "Bid Confidence" used consistently.
- **Link/CTA audit:** every primary CTA points to `https://app.mageid.app`; nav has ~5 items; Compare hub links resolve.
- **Visual spot-check** of index + pricing + one competitor page.
- **Deploy:** build-free `netlify deploy --dir marketing` per the saved procedure (mageid.app builds are credit-paused; needs owner PAT). No auto-deploy without owner go-ahead.
