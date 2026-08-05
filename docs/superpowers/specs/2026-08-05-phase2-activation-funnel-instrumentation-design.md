# Phase 2 — Activation Funnel Instrumentation (Design Spec)

_Date: 2026-08-05. Derives from `docs/path-to-billion-roadmap.md` (Phase 2 — "prove it converts"). Scope: instrument the activation funnel end-to-end and stand up the funnel + dashboard in PostHog. The other two Phase 2 threads (narrow day-one onboarding; value-first landing) are separate and out of scope here._

## Goal & exit condition

**A defined activation funnel, fully instrumented, watchable as a PostHog funnel + dashboard — so we can see where new contractors drop off on the way to the moat moment and optimize it.**

The north star is not signups; it's contractors who reach the **aha**: *pricing a bid off their own numbers.* Today only a subset of the funnel emits events, and the aha step is unmeasurable because `estimate_generated` carries no signal of whether the estimate was priced from the contractor's own cost data.

## The funnel (6 steps)

```
1. Land / install        → $pageview (web) / Application Opened (native)   [exists]
2. Create account        → user_signed_up                                  [exists]
3. Create first project  → project_created (is_first_project=true)         [exists; add flag]
4. Seed / import costs    → onboarding_rates_completed | cost_rates_seeded  [partial; add non-onboarding]
                            | onboarding_import_completed | material_receipt_saved
5. ★ AHA — price a bid    → estimate_generated (used_learned_costs=true)    [exists; ENRICH]
   off their OWN numbers
6. Send to a client      → estimate_shared                                  [MISSING; add]
```

The funnel counts a user as reaching a step if they fire its event at least once. Step 5's aha filter is `used_learned_costs = true`; the un-filtered `estimate_generated` rate vs. the filtered rate exposes the **cold-start leak** (users generating estimates on market defaults because they never seeded).

## Current state (already instrumented — do NOT rebuild)

`utils/analytics.ts` is a clean provider-backed `track(event, props)` wrapper; `utils/posthog.ts` is an OTA-safe HTTP transport with persistent `distinct_id` + `$identify` on login. The `AnalyticsEvents` enum already defines and fires: `user_signed_up`, `user_logged_in`, `persona_selected`, `onboarding_import_*`, `onboarding_rates_*`, `project_created` (with `total_projects`), `estimate_generated` (from `ProjectContext`, paths `created_with_estimate` / `linked_to_project`, with `grand_total`), paywall/subscription events, `schedule_generated`, `contractor_invite_shared`. Naming convention: `snake_case`. Events are client-side only.

## Design decision (locked)

**The aha = an enriched `estimate_generated`.** Add `used_learned_costs` (+ `learned_rate_count`, `jobs_analyzed`) to the event and fire it from the estimate wizard too. The funnel aha-step filters `used_learned_costs = true`. (Chosen over a separate dedicated event so one event measures both the estimate rate and the grounded rate, surfacing the cold-start gap.)

## The grounding signal (how "own numbers" is determined)

Fully available at estimate time, no derivation needed:
- `app/estimate-wizard.tsx` computes `groundingFacts: string[]` from `buildCostDatabase(projects, commitments, receipts, laborSamples, seeds)`. `groundingFacts.length > 0` ⇔ the estimate was priced with the contractor's own cost history.
- `buildCostDatabase()` (`utils/costDatabase.ts`) returns `jobsAnalyzed` (real closed jobs), `tradesTracked`, `tradesSeededOnly`, and per-entry `provenance: 'earned' | 'seeded' | 'mixed'`.
- **Honesty note (respect the existing provenance discipline):** a *seeded* rate is a contractor's self-stated claim, not measured history — it still counts as "own numbers" for activation (they've engaged the moat), but the event MUST distinguish it: `learned_rate_count` counts only non-seeded (`provenance !== 'seeded'`) rates, and `jobs_analyzed` reflects real closed jobs. So a fresh user who only seeded reads as `used_learned_costs=true, learned_rate_count=0, jobs_analyzed=0` — engaged, but not yet measured. Do not conflate seeded with measured.

## Changes

### A. Enrich `estimate_generated` (the aha)
Add properties everywhere it fires, computed from the cost database at emit time:
- `used_learned_costs: boolean` — `db.entries.length > 0` (own data exists and was usable).
- `learned_rate_count: number` — count of entries with `provenance !== 'seeded'` (measured rates only).
- `jobs_analyzed: number` — `db.jobsAnalyzed`.
- keep existing `grand_total`, `path`, `project_type`.
Fire it from **`app/estimate-wizard.tsx`** at successful generation (new `path: 'wizard_generated'`), in addition to the two existing `ProjectContext` emit sites (which should also gain the three grounding props — compute the db there as the wizard does). Per-user double-firing across paths is fine for a funnel.

### B. New event `estimate_shared` (send-to-client)
Add `ESTIMATE_SHARED: 'estimate_shared'` and fire at the three share completion points:
- `app/estimate-wizard.tsx` quick-estimate share → `{ method: 'pdf_share', source: 'estimate_wizard', grand_total }`.
- `app/(tabs)/estimate/review.tsx` proposal-link copy → `{ method: 'proposal_link', source: 'estimate_review', grand_total }`.
- `app/(tabs)/estimate/full.tsx` email send success → `{ method: 'email', source: 'estimate_full', grand_total }`.

### C. New event `cost_rates_seeded` (seed outside onboarding)
Add `COST_RATES_SEEDED: 'cost_rates_seeded'` and fire in `app/cost-seed.tsx` after `addSeeds()` succeeds → `{ count: added + replaced, method, source: 'cost_seed' }`. (Onboarding rates already emit `onboarding_rates_completed`; this covers the standalone screen.)

### D. New event `material_receipt_saved` (cost actuals)
Add `MATERIAL_RECEIPT_SAVED: 'material_receipt_saved'` and fire in `app/material-receipt.tsx` after `addReceipt()` → `{ item_count: draft.lines.length, source: 'material_receipt' }`. (Material receipts post as job-cost actuals — a legitimate "own cost data" input for step 4.)

### E. `project_created` first-project flag
Add `is_first_project: updated.length === 1` to the existing `project_created` props in `contexts/ProjectContext.tsx` (keeps the funnel step from counting a power user's 5th project as an activation).

All new events get an `AnalyticsEvents` enum entry with a comment in the file's existing documented style, grouped under an "── Activation funnel: the aha + send ──" banner.

### F. PostHog deliverable (via the live PostHog connection)
- Create a **Funnel insight** "Activation Funnel (contractor)" over the 6 steps, aha-step filtered on `used_learned_costs = true`, ordered, with a sensible conversion window (e.g. 14 days).
- Create a **Dashboard** "Activation" containing: the funnel; a trend of `estimate_generated` split by `used_learned_costs` (the cold-start gap); step-conversion tiles (signup→first project, first project→seeded, seeded→aha, aha→shared).
- **Data reality:** these render empty until real users flow through post-deploy — this is forward instrumentation. The insight/dashboard definitions are the deliverable; populate over time.

## Non-goals / deferred
- Narrowing day-one onboarding to the aha, and the value-first marketing landing (separate Phase 2 threads).
- Server-side event capture from edge functions (the app is client-emit; not needed for this funnel).
- Retroactive backfill (events are forward-only).

## Testing & ship discipline
- The changes are mostly emit-wiring; correctness is by inspection + `npx tsc --noEmit` + `bun run lint` + `bun run ship-check`.
- Any pure helper extracted (e.g. a `groundingSummary(db)` used by the wizard and ProjectContext to avoid duplicating the property computation) ships with a throwaway `scripts/verify-*.ts` harness (deleted before commit) OR a permanent `scripts/validate-*.ts` if it encodes a real contract worth pinning.
- Keep event names/props consistent across the app and this spec; the enum is the single source of truth.

## Risks
- **Double-emit / miscount:** firing `estimate_generated` from both the wizard and ProjectContext could inflate a raw count — mitigated because a funnel counts distinct users per step, not event volume. Note it so a later raw-count insight de-dupes by user.
- **Grounding computation cost:** `buildCostDatabase` runs at emit time in ProjectContext; it already runs in the wizard memo. Confirm it's cheap enough to call on the emit path (it's pure over already-loaded arrays) — if not, thread the wizard's memoized value through instead of recomputing.
- **Seeded-vs-measured honesty:** the property split must not let a seeded-only user read as "measured" — enforced by `learned_rate_count` counting non-seeded only.
