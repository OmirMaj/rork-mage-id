# MAGE ID — Launch-Readiness & Orientation Audit

Date: 2026-05-16
Method: 4 parallel agents — (1) first-run/orientation code trace, (2) full project-lifecycle code trace, (3) money + funding + RFI code trace, (4) external research on contractor-software onboarding & time-to-value. Every code finding has a `file:line` and the real path. External findings are cited.
Status: findings + ranked fix list + a go/no-go gate. Not yet implemented.
Scope: this is the **final audit before broader TestFlight** with real contractors.

---

## Launch-readiness verdict (read this first)

**Not yet — but the gap is narrow and almost entirely wiring, not building.**

A brand-new contractor today is **LOST within 2 minutes** and, if they push through, can be **stranded at "I made an invoice but can't get paid."** Both are launch-blockers for a money app handed to strangers.

The good news: the backend, data model, Stripe Connect, RFI ball-in-court, and the *content* of onboarding are genuinely built and correct. The failures are at the **seams** — context dropped between screens, and a first-run that smothers its own golden path. ~3–4 focused days of wiring + de-cluttering converts "powerful but I'm lost" into "guided golden path." No new features required to be launch-ready.

---

## The root pattern (why this audit matters)

Every agent independently found the same single defect in two costumes:

**Pattern A — context dropped between screens.** The user has the project, then navigates to a screen that doesn't receive `projectId`, so they re-pick, land on the wrong project, or hit a dead-end. The estimate→project hop is fully severed; the global "+" menu strips context on ~20 items; the post-create modal `router.replace`s without the id *and* nukes the new project from the back stack.

**Pattern B — the one good spine is smothered at first run.** Onboarding → seeded sample project → CreateMenu *is* a sound orientation spine. But on landing, a 20-step Tutorial quiz modal, a checklist, a demo seed, and (next cold boot) a gesture-locked paywall all fire over it, and the home screen renders ~8 stacked dashboard sections with **no single primary action**.

External research says this is not a MAGE quirk — it is the construction-software industry's #1 adoption-failure mode (overwhelming UI before any value is seen; Procore is the cautionary tale). Fixing A and B *as a class* is far higher-leverage than chasing 25 one-offs.

---

## P0 — Launch-blockers. Fix before broader TestFlight.

| # | Finding | Where | Fix | Effort |
|---|---|---|---|---|
| 1 | **Quick Invoice sends with NO Pay button on first send.** Auto pay-link gen is gated on `existingInvoice`, but a brand-new invoice is `null` until *after* send. Stripe-connected users get zero feedback; the "Stripe not connected" nudge also never fires (same block). This is the exact "I made an invoice but can't get paid" trap — the worst thing a money app can do to a tester. | `app/invoice.tsx:359` (gate), `:301-332` (save-after-send) | In `handleConfirmSend`, if `!existingInvoice`, create + `addInvoice` first, then run the existing pay-link block against the new id. Mirror `bill-from-estimate.tsx:260-265`'s create-then-edit pattern. | M |
| 2 | **First-run smother: 3 onboarding systems fire at once + forced paywall.** Full-screen 20-step Tutorial quiz auto-opens on home; checklist + demo seed also present; next cold boot shows a `gestureEnabled:false` paywall to a user who hasn't made a project. Converts a good spine into chaos. | `app/(tabs)/(home)/index.tsx:92-100` (Tutorial auto-open), `Tutorial.tsx:316-572` (20 quiz steps), `app/_layout.tsx:461-468,258-286` (forced paywall gate) | Kill Tutorial auto-open (move to Help/Settings only) or cut it to ≤4 orientation steps; gate the paywall re-show behind "≥1 real project created," not `tier==='free'`. | M (~1.5d) |
| 3 | **Estimate wizard cannot save to a project.** The 8-step AI wizard's only terminal actions are "Download PDF" / "Start new." A code comment admits the save was "left as a follow-up." Every downstream money feature (contract value, progress billing) depends on a linked estimate this path never produces. | `app/estimate-wizard.tsx:18,534-563` | Add "Save to project" CTA → project picker → `updateProject(id,{ linkedEstimate, status:'estimated' })`. | M |
| 4 | **Post-creation modal drops project context.** "Project Created!" → `router.replace('/(tabs)/estimate'|'/schedule')` with no `projectId`, and `replace` destroys the new project from the back stack. Estimate tab defaults to `null`; schedule tab defaults to `projects[0]` — the *wrong* project. The single most-guided moment leaks context. | `app/(tabs)/(home)/index.tsx:302-314`; `schedule-wizard.tsx:71` already reads `projectId` | Route to `/estimate-wizard` / `/schedule-wizard` with `params:{ projectId }` (push, not replace). | M |
| 5 | **Global "+" CreateMenu strips project context on ~20 items.** Invoice/Change Order/Daily Report/RFI/Submittal/Closeout/Lien Waiver all push bare routes; every target needs `projectId` and falls to a dead-end EmptyState telling the user to start over. The app's headline discovery surface is decorative for these. | `components/CreateMenu.tsx:59-94`; e.g. dead-end at `app/invoice.tsx:743-760` | When projects exist, interpose a project-picker step (or push to project-detail with the target tile pre-opened). | M |

P0 total ≈ **3–4 focused days**. All JS-only / OTA-able. Fixing #2 alone flips the first-run verdict LOST → ORIENTED; #1 removes the worst money failure; #3–#5 make the lifecycle actually completable by following on-screen affordances.

---

## P1 — High-value, include if time / immediate fast-follow

| # | Finding | Where | Fix |
|---|---|---|---|
| 6 | **No single primary CTA on home + no forward rail anywhere.** Home stacks ~8 sections (SmartInbox, AI-briefing, QuickFieldUpdate, chips…) before the project list; detail screens all end in `router.back()`, never "next step." The proven competitor pattern (CompanyCam/Jobber) is one big "Create your first project" then a stage-aware "Next." | `app/(tabs)/(home)/index.tsx:409-613`; `app/project-detail.tsx:1191-1222` (flat 30-tile grid) | When `projects.length<=1`, suppress SmartInbox/AI-briefing/QuickFieldUpdate; show one primary CTA. Add a stage-aware "Next" banner on project-detail keyed off `status` + which artifacts exist. |
| 7 | **OnboardingChecklist step 1 is a visible no-op; "Send invoice" dead-ends.** "Create project" pushes `/?openCreate=1` — a param home never reads; "voice" step `return`s with no nav; "Send an invoice" hits the P0-5 dead-end. The first thing we ask a new user to do does nothing. | `components/OnboardingChecklist.tsx:99,153-163,162` | Read `openCreate` in home and open the create modal; deep-link or remove the voice step; route invoice step through the picker from #5. |
| 8 | **Desktop/web sidebar = 37 destinations, 7 sections, lock badges, no "start here."** Web testers see a 37-row nav wall. (Mobile tab bar is fine — 4 visible.) | `components/DesktopSidebar.tsx:40-93` | Collapse non-PROJECT sections by default; lead with a "Get started" item. |
| 9 | **RFI "Response Required By" is raw `YYYY-MM-DD` text input.** Field GC hand-typing a date is error-prone; a malformed string silently breaks the overdue math. RFI workflow is otherwise built and discoverable. | `app/rfi.tsx:490-497` | Swap to the date-picker component already used elsewhere; feeds the status pipeline a real Date too. |

---

## P2 — Polish (opportunistic)

| # | Finding | Where | Fix |
|---|---|---|---|
| 10 | "Summary" vs "Your Projects" are two near-identical dashboards — confusing for a 1-project new user. | `app/(tabs)/_layout.tsx:167-213` | Merge/relabel; default new users to "Your Projects". |
| 11 | Seeded sample project has no in-context "this is a sample, remove it" affordance (only buried in Settings → Reset). | `app/onboarding.tsx:201-214`; `(home)/index.tsx:76-86` | Badge the card "SAMPLE — tap to remove." |
| 12 | RFI answered-by-email has no inbound capture — GC must notice email, reopen, paste. Portal-reply path exists; plain email reply does nothing. | `app/rfi.tsx:300,632-635` | Fast-follow; not a TestFlight blocker. |
| 13 | Pay-link client-email match is brittle string `includes` on company vs project name. | `app/invoice.tsx:640-645` | Prefer an explicit `project.clientContactId` join. |

---

## "Where to get funding" — explicit scope decision (NOT a code fix)

The creator flagged confusion about **funding/financing**. Code reality: **this feature does not exist.** A full grep (`funding|financ|capital|advance|lending|factoring`) across `app/`, `components/`, `contexts/` returns only an unrelated cash-flow projection category (`app/cash-flow.tsx:105`) and boilerplate strings. No screen, route, stub, or "coming soon."

There is **nothing to launch-gate or hide.** Recommendation: do **not** build or surface a funding flow before TestFlight — a non-functional "Get Funding" entry point is worse than its absence. This is a roadmap/positioning decision, not a bug. Decide explicitly: (a) accept out-of-scope and don't mention it to testers, or (b) add one honest "Financing — coming soon" roadmap affordance so the creator/testers stop hunting for it.

---

## Verified working — do NOT touch for this batch

- Onboarding *content* (3 clean screens, good copy) and the auto-seed of a sample project.
- The data/model chain once an estimate is linked: linked estimate → contract value (`contractEngine.ts:130`) → progress/full invoice (`bill-from-estimate.tsx:89-98`).
- `bill-from-estimate` / progress-invoice path: create-then-edit, pay link generated correctly.
- Stripe Connect onboarding (Settings → Payments) + server-side paid reconciliation (`supabase/functions/stripe-webhook`).
- RFI core: project tile → "New RFI" → save → "Send to Architect/Engineer", ball-in-court, handoff log, token reply portal.
- `CreateMenu` content itself (26 items, plain-English subtitles, grouped, searchable) — it's a *good* surface; only its context-passing and discoverability are broken.
- Mobile tab bar (4 visible, 8 hidden) — honest and fine.

---

## External benchmark (condensed — full sources below)

- Median product activation ≈ 37.5%; B2B target 60–70%. Value within ~5 min → ~40% higher 30-day retention; aha within 3 days → ~90% more likely to stay active. A new contractor staring at 30+ capabilities will not hit that window.
- Choice overload is empirically an *inaction* mechanism (Hick's Law; the jam study: 24 options → 3% act, 6 options → 30%). "Lots of abilities, no clear start" is itself the abandonment cause.
- Short setup checklist + progress bar = documented 40–75% activation lift — *but* completion craters past ~5 items, so keep it ≤5.
- Field crews abandon dense, multi-tap, tutorial-requiring UIs: "One screen. Big buttons. Clear labels." Office-vs-jobsite context mismatch is a named churn cause.
- Construction-software's #1 failure: overwhelming UI / gated modules before any value (Procore = 3–6 mo to proficiency, "overwhelming for smaller teams").
- Winning competitor pattern is identical across CompanyCam & Jobber: **one concrete first action — "create your first job (name + address)" — minutes to value, zero tutorial.** Knowify's own guidance: "do not implement everything at once."

Sources: agilegrowthlabs.com/blog/user-activation-rate-benchmarks-2025 · userpilot.com/blog/onboarding-checklist-completion-rate-benchmarks · lawsofux.com/hicks-law · nngroup.com/articles/progressive-disclosure · remato.com/blog/mobile-first-construction-software-adoption · linarc.com/buildspace/why-construction-software-fails · capterra.com/p/56250/Procore/reviews · companycam.com/resources/blog/how-easy-is-it-to-get-started-with-companycam · help.getjobber.com (Jobber App Basics) · knowify.com/resources/onboarding-knowify

---

## Recommended sequencing & launch gate

1. **Ship the P0 batch as one coherent "First-Run + Lifecycle Wiring" pass (~3–4 days, all OTA-able).** This is the launch gate. It is mostly `params:{projectId}` plumbing + removing auto-fired first-run systems — low risk, high leverage, no new surface area.
2. **Add P1 #6 (single primary CTA + stage-aware Next rail) in the same pass if time allows** — it is the evidence-backed core of the "where do I start" fix and pairs structurally with the P0 wiring.
3. **Make the funding scope call explicitly** (above) before testers ask.
4. **Instrument one activation event** (first project + one meaningful action) and watch time-to-it during TestFlight; target <15 min. You can't gate launch-readiness on a number you don't measure.
5. P1 #7–#9 as immediate fast-follow; P2 opportunistically.

**Go/no-go:** Do not widen TestFlight until P0 #1 (can't get paid) and P0 #2 (lost in 2 min) are fixed. #3–#5 should ship in the same batch — a tester who can't get an estimate onto a project will conclude the app doesn't work, which is indistinguishable from a real defect.
