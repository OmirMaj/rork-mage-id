# MAGE ID — Pre-TestFlight UX Audit

**Date:** 2026-05-14
**Persona:** Solo / small GC, owner-operator, 1-5 employees, residential remodel
**Method:** Walked 5 critical workflows in the codebase + 8 web searches across competitors (JobTread, Houzz Pro, Buildertrend, CompanyCam) and 2026 SaaS onboarding research.
**Goal:** Ship the top 3-5 highest-leverage fixes before the wider TestFlight push.

---

## Headline finding

The app has **every feature a small GC could want**, but the path from sign-up to first paid invoice isn't surfaced as a single coherent journey. The user has to know which of 28 project-detail tiles to tap, which of 3 estimate paths to take, and is only told about Stripe Connect *reactively* (when they hit "Send invoice" and get blocked).

The 5-step `OnboardingChecklist` on the home tab is the right idea, but its items mix *user workflows* ("create project", "send invoice") with *feature trials* ("try voice", "run AI takeoff") — diluting the activation funnel that the research says matters most.

**Recommendation:** rework the checklist around the canonical first-week journey, surface Stripe Connect proactively, and add "what's next" guidance after a project is created. These three changes ship in this session.

---

## Research highlights

| Source | Takeaway |
|---|---|
| 2024 AGC survey | **47% of contractors** cite "getting employees to use new technology" as their #1 challenge — bigger than cost. (See [Construction Dive on KPMG](https://www.constructiondive.com/news/kpmg-report-construction-industry-slow-to-adopt-new-technology/426268/) and [Remato](https://remato.com/blog/mobile-first-construction-software-adoption/).) |
| Construction SaaS abandonment | Workflow mismatch with field operations is the dominant failure mode. Crews "won't sit at a desk to log into complex software." |
| 2026 SaaS onboarding | **Time-to-first-value 2-5 min; full onboarding 5-15 min.** Every extra minute drops trial-to-paid conversion ~3%. ([Arcade](https://www.arcade.software/post/customer-onboarding-best-practices), [DAR Design](https://dardesign.io/blog/saas-onboarding-2026-activation-checklist-reduce-churn)) |
| Activation benchmarks | Strong activation rate = 40-60%. Every 1% activation improvement → ~2% lower churn. ([Amplitude](https://amplitude.com/explore/digital-analytics/what-is-activation-rate), [Userorbit](https://userorbit.com/blog/complete-guide-saas-user-onboarding-2026)) |
| 7-day retention | **Users engaging core workflows 3+ times in first 7 days have 3.2× higher retention.** Top 25% of B2B SaaS hit 7% Day-7 retention. ([SaaSFactor](https://www.saasfactor.co/blogs/saas-user-activation-proven-onboarding-strategies-to-increase-retention-and-mrr), [Amplitude](https://amplitude.com/blog/7-percent-retention-rule)) |
| Checklist sizing | 3-7 items max. Median checklist completion is 19.2%. Interactive flows see 50% higher activation. ([Userorbit](https://userorbit.com/blog/complete-guide-saas-user-onboarding-2026), [Pixxen](https://pixxen.com/blog/saas-onboarding-ux/)) |

### Competitor onboarding patterns

- **[JobTread](https://www.jobtread.com/blog/getting-started-with-jobtread):** "Getting Started" punch list on the Home tab, plus a dedicated customer-success specialist for setup.
- **[Houzz Pro](https://pro.houzz.com/pro-help/r/how-to-get-started-in-houzz-pro-contractors):** Explicit checklist — *logo, MFA, team invites, mobile app, first project, QuickBooks sync, **online payments**, help center.* Payments live in onboarding, not as a reactive step.
- **[Buildertrend](https://helpcenter.buildertrend.net/en/articles/6231630-buildertrend-onboarding-guide):** Two-tier hands-on onboarding with a dedicated manager who configures real data, connects accounting (QuickBooks/Xero), and completes payments setup.
- **[CompanyCam](https://companycam.com/user-guides/account-owners):** Role-based guides. The first project is the foundation for everything else. Phone-permission setup for location-aware photos is the first technical step.

**Pattern across all four competitors:** "Create your first project" is universally the activation event, and **online payments setup is bundled into onboarding**, not deferred until the user tries to send an invoice.

---

## Workflow-by-workflow scoring

### Workflow 1 — Sign-up → Home tab `(3/5)`

**Path today:** `/onboarding` (2 screens) → `/(tabs)/(home)` → `OnboardingChecklist` (5 items) + project list (or empty state with "Build something" CTA + demo seed option).

**What works**
- Two-step splash is short and on-brand (research says shorter is better)
- Empty state has clear primary CTA + demo-seed escape hatch
- `OnboardingChecklist` is dismissable + auto-hides at 4/5 done
- Routing question (project-size band) captures persona

**What's missing**
- **Checklist items mix workflows and feature trials.** Today: project / estimate / takeoff / invoice / voice. Research says the items should map to *user goals* (get to first paid invoice), not feature trials. "Try voice" doesn't unblock anything.
- **No Stripe Connect step.** Getting paid is *the* business outcome, and it's nowhere in the checklist.
- **No Company Profile step.** Sending an invoice with `companyName: ""` makes the recipient's email look unfinished.
- **Routing-question data isn't used.** The band is captured but the home doesn't reflect persona-specific guidance.

**Fix in this session →** redesign the 5 items to match the canonical first-week journey: company info → first project → first estimate → Stripe Connect → first invoice.

---

### Workflow 2 — Creating the first project `(4/5)`

**Path today:** Home empty state → "Create your first project" button → modal with voice-fill + manual form (name, location, type, budget) → save → land on `/project-detail`.

**What works**
- Voice-fill is the differentiator and the placeholder copy reads naturally ("Smith kitchen remodel at 123 Main Street, budget eighty thousand").
- Demo seed alternative is genuinely useful for testers.
- Required fields are minimal.

**What's missing**
- **Project-detail has 28 section tiles.** A user who just created their first project lands on a wall of tiles with no signal of *which one to tap next*. (Sections: linkedEstimate, materials, labor, summary, schedule, notes, collaborators, changeOrders, invoices, dailyReports, punchList, rfis, submittals, oacMeetings, budget, photos, clientPortal, communications, activity, calendar, plans, permits, contract, selections, lienWaivers, closeoutBinder, handover, timeTracking, projectFiles.)
- **No "next step" recommendation** based on project state (e.g., a fresh project should highlight "Build estimate" first).

**Fix in this session →** add a small "Recommended next" callout on project-detail when the project has 0 estimates AND 0 invoices: surface 2-3 most-likely-next tiles (Build estimate → Add daily report → Schedule).

---

### Workflow 3 — First estimate `(2/5)`

**Three paths to create an estimate today:**
1. **Estimator tab** (Discover → Estimator) — project-agnostic line-item builder.
2. **Quick Estimate Wizard** — 8 questions → AI-generated estimate → creates project.
3. **Project Detail → Linked Estimate tile** — line items inside a specific project.

**What's wrong**
- No clear primary recommendation. The Discover screen lists Estimator and Quick Estimate Wizard side-by-side with similar visual weight.
- Routing is confusing: Estimator can be opened *without* a project; Quick Wizard creates one; Linked Estimate requires one. A first-time user can't predict where they'll land.
- The user (the *creator*) said this is one of the confusing spots, which matches a paying-user view.

**Fix later** (too big for one session — needs design judgment) → Promote Quick Estimate Wizard as the primary entry point on Discover. Move the Estimator and Linked Estimate behind a "More ways to estimate" expander.

---

### Workflow 4 — Invoice + getting paid `(2/5)`

**Path today:** Project detail → Invoices tile → "New invoice" → fill in line items → "Send" → if Stripe Connect not set up, alert blocks with "Set up Stripe" button → `/payments-setup`.

**What works**
- `/payments-setup.tsx` is well-built: hosted Stripe Express onboarding, status polling, friendly states for pending / connected.
- AIA pay applications (G702/G703) live next to the regular invoice for commercial work.

**What's wrong**
- **Stripe Connect is purely reactive.** The user only encounters it *after* drafting an invoice they're about to send. By research benchmarks, this is the #1 fix: payments setup should be a Day-1 step, not a Day-3 surprise.
- **`/payments` on Discover → Tools → Payments goes to history**, not to the setup flow. A new user clicking "Payments" sees an empty list with no obvious "Set this up" path.
- Houzz Pro and Buildertrend both surface payments in onboarding. We're an outlier here.

**Fix in this session →** (a) Add a Stripe Connect step to the OnboardingChecklist. (b) Add a banner to the Discover → Payments screen + the Home tab when Connect status is `'none'`, with a one-tap CTA to `/payments-setup`.

---

### Workflow 5 — First RFI `(2/5)`

**Path today:** Project detail → scroll until you find the RFIs tile → tap → empty state → "New RFI" → fill form → save → log view.

**What works**
- Full RFI lifecycle exists: create, log, respond, PDF export.
- Status filter defaults to `'open'` so the user lands on actionable items.

**What's wrong**
- **Discoverability is terrible.** The RFI tile is 1 of 28 tiles in project-detail with no visual elevation. A small-GC tester who's never run an RFI before won't know to look there.
- **No first-time education.** "RFI" is industry jargon — a homeowner-renovation GC may have never written one. Tapping the tile drops them into a form with no context.
- **Not in OnboardingChecklist.** That's actually correct — small GCs may not use RFIs daily — but at least one moment of "this is what RFIs are for" would help when they first encounter the tile.

**Fix later** (P1) → first-time tooltip on the RFI tile that says: *"RFI = Request For Information. Send a question to the architect / homeowner and log their answer for the record."* One-time, dismissable.

---

## Punch list (ranked by impact × effort)

### P0 — ship this session

| # | Fix | Why | Effort |
|---|---|---|---|
| 1 | **Rebuild `OnboardingChecklist` items** around the 5-step journey: company profile → first project → first estimate → Stripe Connect → first invoice | Matches the activation funnel competitors use and the 4-6 step research norm. Today's items mix workflows + feature trials. | M |
| 2 | **Surface Stripe Connect proactively** — add a "Get paid: connect Stripe" home-screen banner when `connectStatus === 'none'` AND the user has ≥1 project. Dismissable. | Eliminates the "surprise wall" when sending the first invoice. Houzz Pro / Buildertrend both do this in onboarding. | S |
| 3 | **"Recommended next" callout on project-detail** for projects with 0 estimates AND 0 invoices. Three suggestions: Build estimate, Add daily report, Open schedule. | Fixes the "28 tiles, where do I start?" problem on first project. | S |

### P1 — next session

| # | Fix | Why |
|---|---|---|
| 4 | Promote Quick Estimate Wizard as the primary entry point on Discover. Move Estimator and Linked Estimate behind "More ways to estimate" | Three estimate paths is confusing even to the creator. |
| 5 | Add one-time "what is this?" tooltips to: RFIs, Change Orders, Submittals, AIA Pay App, Lien Waivers, Closeout Binder | Industry jargon needs a 1-sentence definition the first time you encounter it. Pattern from Procore's first-time-feature tooltips. |
| 6 | Reduce project-detail tile count via "More" expander | 28 tiles is overload. Group most-used (Estimate / Daily / Invoices / Schedule) at the top, hide the rest behind a tap. |

### P2 — longer-term

| # | Fix | Why |
|---|---|---|
| 7 | Add lifecycle-stage-aware tile sorting (pre-con vs construction vs closeout shows different "next" tiles) | Already have the stage strip (Phase 28); just isn't wired to surface different content per stage. |
| 8 | Demo seed available beyond first-run | Veteran users want to "try a sample big-project" to explore unfamiliar features like AIA pay apps without polluting their real projects. |
| 9 | Track activation funnel events to Supabase | Build instrumentation so the next TestFlight cycle has data, not anecdotes. Funnel events: signup → first_project → first_estimate → stripe_connected → first_invoice → first_paid_invoice. |

---

## TestFlight recommendations (for the bigger rollout)

1. **Bias to demo-seeded onboarding.** Auto-seed a demo project for every TestFlight user so they can explore *with* data. Hide the seed prompt behind a "or start from scratch" link.
2. **Day-1 feedback prompt.** 24 hours after signup, surface a single dismissable card: *"What's the most confusing thing so far?"* with a free-text field. Save to `feedback_submissions` table.
3. **Activation funnel dashboard.** Before TestFlight, wire the events above to a Supabase view so you can see at a glance how many testers hit each step. Industry benchmark: 40-60% reach the activation event.
4. **In-app "Ask the maker" channel.** Free-text channel that emails you directly. Testers will report things they wouldn't write up in a survey.

---

## What ships in this session

1. **Onboarding checklist v2** — items: Company info · First project · First estimate · Connect Stripe · Send first invoice. Replaces voice/takeoff/etc.
2. **Home banner: "Get paid in 1 tap — connect Stripe"** — shows only when `connectStatus === 'none'` AND `projectCount >= 1`. Dismissable.
3. **Project-detail "Recommended next" callout** — appears when project has 0 estimates AND 0 invoices. Three quick links.

Estimate: ~45 min of implementation + testing. Type-check + commit + OTA to production.
