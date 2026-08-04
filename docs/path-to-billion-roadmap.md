# MAGE ID — Path to a Billion (Strategic Roadmap)

_Prepared 2026-08-04. Sources: PostHog product analytics (trailing 180 days), live audits of app.mageid.app + mageid.app, and the 2026-08-03 UX audit. A shareable visual version of this doc lives as an Artifact (see session)._

## The one-sentence reframe

MAGE ID has **more product than a billion-dollar app needs** (~140 screens, a genuine cost-learning moat) and a marketing message pitched at a 9/10 level. What it has almost none of: **a public launch, proof anyone uses it, working monetization, and a growth loop that's actually running.** A cost-learning flywheel with no users closing jobs never spins — so the highest-leverage work is **not another feature.** It's making the app launchable, trustworthy, and monetizable, then turning on the loops that feed it real contractors and real cost data.

**Verdict: pre-launch, not pre-product.**

## 01 — Ground truth (PostHog, trailing 180 days)

| Signal | Count | What it means |
|---|--:|---|
| App installs | 1 | One device — yours. All activity in May. |
| Marketing visitors | 57 | ~93 pageviews across three months. |
| Logins | 3 | You plus two test accounts. |
| People who created a project | 2 | Almost nobody has done the core action. |
| Paywall views | 2 | Two people ever reached pricing. |
| **Paid conversions** | **0** | Nobody has ever paid. Revenue is unproven end-to-end. |

The **web app is strong** (boots fast, real desktop nav, grounded "morning brief" home, low-friction 3-field signup with Apple/Google). The **marketing site is strong** (moat-forward messaging, real competitor pages, a working markup-vs-margin calculator, an embeddable estimate widget). The problem is not craft — it's that the top of the funnel can't convert traffic it never receives, and the handoffs between surfaces are quietly broken (e.g. the marketing CTAs build `?plan=pro&trial=14` links that nothing in the app reads).

## 02 — The billion-dollar equation

Four factors; a zero in any one zeroes the result. MAGE has the two hardest to manufacture and is missing/has broken the two that are mostly execution.

- **Massive market — HAVE.** Millions of SMB residential contractors/remodelers, underserved and software-hungry.
- **Product depth & a moat — HAVE.** Cost-learning loop + margin defense no competitor ships. The message lands.
- **Working monetization — UNPROVEN.** 0 conversions from 2 paywall views. RevenueCat webhook is still an open owner action; web key is sandbox.
- **A compounding loop — MISSING.** The growth playbook exists on paper; nothing runs. 57 visitors in three months is a standing start.

## 03 — The gap map, by tier

Ordered so that fixing a lower tier is wasted if the tier above still leaks.

### Tier 0 — Blockers (fix before a single real user)
1. **You're not launched.** iOS (primary platform) is TestFlight-invite-only behind a 24h human gate. No public App Store listing → no installs, no store-search discovery, no ratings for proof.
2. **Monetization is unproven and possibly unplumbed.** RevenueCat webhook + secrets still listed as an outstanding owner action ("required or paid purchases won't unlock"). Confirm one real purchase unlocks a tier end-to-end.
3. **Integrity bugs that break trust on contact.** Fabricated `bulkSavings` prints in the client estimate PDF by default; prediction/confidence defaults render invented numbers as fact; 7 money screens dead-end from search; `resolveDeepLinkPath` silently rewrites ~99 routes to Home (which is also why the marketing `?plan=/?trial=` handoff is lost). One resolver fix closes a product bug and a conversion leak.

### Tier 1 — The engine (exists on paper; nothing runs)
4. **Zero social proof.** No testimonials, logos, review badges, case studies, or founder story. Highest-leverage marketing fix.
5. **The flagship moat asset is empty.** The MAGE Price Index reads "still building." Programmatic permit + license ingestion populates it *and* the marketplace in one build — and produces the real cost data that is the pitch.
6. **No compounding acquisition.** The "Built with MAGE ID" loop and comparison pages exist, but with ~0 users nothing compounds, and there's no top-of-funnel content/SEO engine.
7. **Flying blind on activation.** Only ~8 event types instrumented. No defined aha funnel. You can't optimize what you can't see.

### Tier 2 — Subtract (the counterintuitive one)
8. **140 screens is a liability at 0 users.** Billion-dollar apps win by nailing one wedge's activation, not breadth. The UX audit found dead-ends and orphan routes.
9. **The cold-start problem is the real product risk.** The moat needs closed jobs to learn, but a new contractor has none. Narrow the day-one path to the one aha — *price one bid off your own numbers* — and defer everything else.

## 04 — The sequence (each phase has one exit condition)

**Phase 1 — Make it launchable.** Exit: a real user can install, use, and pay without hitting a lie or a dead end.
- Delete/compute `bulkSavings`; null-gate prediction/confidence defaults to "—". _(code)_
- Rebuild the deep-link resolver — restores QBO OAuth, crew-claim QR, push, and the marketing plan/trial handoff. _(code)_
- Give the 7 dead-end money screens the picker `field-ticket` already has. _(code)_
- Configure the RevenueCat webhook + swap the sandbox web key; verify a purchase unlocks a tier. _(owner)_
- Ship the public App Store listing. _(owner)_

**Phase 2 — Prove it converts.** Exit: a defined, instrumented activation funnel + the first paying design partners.
- Define + instrument the aha funnel in PostHog; narrow day-one onboarding. _(code)_
- Replace the cold login wall with a value-first landing/demo artifact. _(code)_
- Recruit ~10 design-partner contractors by hand — real data, real testimonials. _(owner)_

**Phase 3 — Seed the moat & the proof.** Exit: the Price Index is a live rankable page and the site shows peer proof.
- Build permit + license ingestion (CSLB/DBPR free files + Socrata cities) → populates Price Index + marketplace, kills two cold-starts. _(code)_
- Wire testimonials + Capterra/G2 badge + App Store rating into the hero. _(code)_
- Publish the Price Index with methodology, even sparse. _(owner)_

**Phase 4 — Open the taps.** Exit: at least one loop with a measured, positive coefficient.
- Verify the "Built with MAGE ID" badge fires on high-frequency client surfaces; measure k. _(code)_
- Ship the content/SEO engine: comparison pages (built) + city/trade cost guides off the calculator. _(owner)_
- Permit-triggered compliant cold email to the ingested list; double-sided referral. _(owner)_

## 05 — The one funnel to instrument first

North star is not signups — it's contractors who reach the moment the moat pays off:

```
Install / land on web
  → Create account
    → Create first project        (core action)
      → Seed rates / import costs  (setup)
        → ★ Price a bid off their own numbers   (AHA)
          → Send it to a client    (value out + viral surface)
```

## 06 — What NOT to do
- **Don't build another feature.** The 141st screen doesn't move a number when the first 140 have two users.
- **Don't spend on acquisition before Phase 1 ships.** Paid traffic into a login wall with a broken plan-link and a fabricated PDF figure is money set on fire.
- **Don't mass-generate SEO doorway pages** — trips Google's scaled-content-abuse policy. The calculator + real cost data earn the pages.
- **Don't let the Price Index stay "still building."** Empty, it reads as vaporware to every prospect who clicks it.

---
_A strategy document, not a launch. Every Phase-1 item is a small, known scope — days, not weeks._
