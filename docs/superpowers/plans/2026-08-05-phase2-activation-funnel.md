# Phase 2 — Activation Funnel Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the 6-step activation funnel end-to-end (filling the aha-grounding, send-to-client, seed-outside-onboarding, and first-project gaps) and stand up the funnel + dashboard in PostHog.

**Architecture:** One pure helper turns a `CostDatabase` into the three aha-grounding event props (permanent-validated). The rest is `track()` emit-wiring at exact completion points, plus new `AnalyticsEvents` enum entries. The PostHog funnel + dashboard are built via the live PostHog connection (controller task, after the code lands).

**Tech Stack:** React Native + Expo, TypeScript strict, `bun`. Analytics = `utils/analytics.ts` `track(event, props)` (OTA-safe HTTP transport). No jest — pure logic validated by a permanent `scripts/validate-*.ts` wired into `ship-check`.

**Reference spec:** `docs/superpowers/specs/2026-08-05-phase2-activation-funnel-instrumentation-design.md`

---

## File structure

- **Create** `utils/activationSignals.ts` — pure `estimateGroundingProps(db)` → `{ used_learned_costs, learned_rate_count, jobs_analyzed }`.
- **Create** `scripts/validate-activation-signals.ts` — permanent validator, wired into `ship-check`.
- **Modify** `utils/analytics.ts` — add `ESTIMATE_SHARED`, `COST_RATES_SEEDED`, `MATERIAL_RECEIPT_SAVED` enum entries.
- **Modify** `app/estimate-wizard.tsx` — reuse a `costDb` memo; emit enriched `estimate_generated` at generation + `estimate_shared` at quick-share.
- **Modify** `contexts/ProjectContext.tsx` — enrich the two `estimate_generated` emits with grounding props; add `is_first_project` to `project_created`.
- **Modify** `app/(tabs)/estimate/review.tsx`, `app/(tabs)/estimate/full.tsx` — `estimate_shared` at proposal-link and email.
- **Modify** `app/cost-seed.tsx`, `app/material-receipt.tsx` — `cost_rates_seeded` / `material_receipt_saved`.
- **Modify** `package.json` — wire the new validator into `ship-check`.

---

## Task 1: Pure grounding-props helper + permanent validator

**Files:**
- Create: `utils/activationSignals.ts`
- Create: `scripts/validate-activation-signals.ts`
- Modify: `package.json` (ship-check chain)

- [ ] **Step 1: Confirm the `CostDatabase` shape**

Open `utils/costDatabase.ts` and confirm `CostDatabase` has `entries: CostBookEntry[]` (each with `provenance: 'earned' | 'seeded' | 'mixed'`) and `jobsAnalyzed: number`. If field names differ, adapt the helper below to the real names (the real type wins).

- [ ] **Step 2: Write the failing validator**

Create `scripts/validate-activation-signals.ts`:

```ts
import { estimateGroundingProps } from '@/utils/activationSignals';
import type { CostDatabase } from '@/utils/costDatabase';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, `\n      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// Minimal CostDatabase fixtures — only the fields the helper reads.
const db = (entries: { provenance: string }[], jobsAnalyzed: number): CostDatabase =>
  ({ entries, jobsAnalyzed } as unknown as CostDatabase);

console.log('\nactivation signals (aha grounding props):');

// empty → not grounded
eq('empty', estimateGroundingProps(db([], 0)),
  { used_learned_costs: false, learned_rate_count: 0, jobs_analyzed: 0 });

// seeded-only → engaged (used_learned_costs true) but NOT measured (learned 0, jobs 0)
eq('seeded-only', estimateGroundingProps(db([{ provenance: 'seeded' }, { provenance: 'seeded' }], 0)),
  { used_learned_costs: true, learned_rate_count: 0, jobs_analyzed: 0 });

// mixed provenance counts as learned (only 'seeded' is excluded)
eq('mixed-and-earned', estimateGroundingProps(db([{ provenance: 'earned' }, { provenance: 'mixed' }, { provenance: 'seeded' }], 3)),
  { used_learned_costs: true, learned_rate_count: 2, jobs_analyzed: 3 });

// all earned
eq('all-earned', estimateGroundingProps(db([{ provenance: 'earned' }, { provenance: 'earned' }], 5)),
  { used_learned_costs: true, learned_rate_count: 2, jobs_analyzed: 5 });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun scripts/validate-activation-signals.ts`
Expected: FAIL — `Cannot find module '@/utils/activationSignals'`.

- [ ] **Step 4: Implement `utils/activationSignals.ts`**

```ts
import type { CostDatabase } from '@/utils/costDatabase';

/**
 * The three properties that make the activation funnel's "aha" step measurable.
 * Attached to `estimate_generated`. A SEEDED rate is a self-stated claim, not
 * measured history, so it counts toward engagement (`used_learned_costs`) but
 * NOT toward `learned_rate_count` — a seeded-only user reads as
 * used_learned_costs:true, learned_rate_count:0, jobs_analyzed:0.
 */
export interface EstimateGroundingProps {
  used_learned_costs: boolean;
  learned_rate_count: number;
  jobs_analyzed: number;
}

export function estimateGroundingProps(db: CostDatabase): EstimateGroundingProps {
  const entries = db?.entries ?? [];
  return {
    used_learned_costs: entries.length > 0,
    learned_rate_count: entries.filter((e) => e.provenance !== 'seeded').length,
    jobs_analyzed: db?.jobsAnalyzed ?? 0,
  };
}
```

- [ ] **Step 5: Run the validator to verify it passes**

Run: `bun scripts/validate-activation-signals.ts`
Expected: `4 passed, 0 failed`, exit 0.

- [ ] **Step 6: Wire the validator into ship-check**

In `package.json`, add a script entry near the other `test:*` entries:
```json
"test:activation-signals": "bun run scripts/validate-activation-signals.ts",
```
Then append to the END of the existing `"ship-check": "..."` chain (do not reorder/remove anything else):
```
 && bun run test:activation-signals
```

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` (expect zero errors), then:
```bash
git add utils/activationSignals.ts scripts/validate-activation-signals.ts package.json
git commit -m "feat(activation): grounding-props helper for the aha event + permanent validator"
```

---

## Task 2: New event names in `utils/analytics.ts`

**Files:**
- Modify: `utils/analytics.ts` (the `AnalyticsEvents` const, after `CONTRACTOR_INVITE_SHARED`)

- [ ] **Step 1: Add the three events with a documented banner**

Insert before the closing `} as const;`:

```ts
  // ── Activation funnel: the aha + send-to-client ──
  // ESTIMATE_SHARED fires when a priced estimate/proposal is sent to a
  //   homeowner (the funnel's final step). `method` is 'pdf_share' |
  //   'proposal_link' | 'email'; `source` names the screen.
  // COST_RATES_SEEDED fires when the contractor commits seeded rates OUTSIDE
  //   first-run onboarding (the standalone cost-seed screen). Onboarding rates
  //   already emit ONBOARDING_RATES_COMPLETED.
  // MATERIAL_RECEIPT_SAVED fires when a scanned/entered material receipt is
  //   saved — real cost actuals, a legitimate step-4 "own cost data" input.
  // The aha itself is the EXISTING estimate_generated, now enriched with
  //   used_learned_costs / learned_rate_count / jobs_analyzed (see Tasks 3-4).
  ESTIMATE_SHARED: 'estimate_shared',
  COST_RATES_SEEDED: 'cost_rates_seeded',
  MATERIAL_RECEIPT_SAVED: 'material_receipt_saved',
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expect zero errors), then:
```bash
git add utils/analytics.ts
git commit -m "feat(activation): add estimate_shared / cost_rates_seeded / material_receipt_saved events"
```

---

## Task 3: Wizard — enrich `estimate_generated` + add `estimate_shared`

**Files:**
- Modify: `app/estimate-wizard.tsx` (the `groundingFacts` memo ~282-300; the `generate()` success ~372; the `share()` callback ~447)

- [ ] **Step 1: Expose the cost database as a reusable memo**

The `groundingFacts` memo already calls `buildCostDatabase(projects, commitments, receipts, laborSamples, seeds)`. Refactor so the DB is a memo the emit path can reuse. Add (near the existing memo):

```ts
import { estimateGroundingProps } from '@/utils/activationSignals';
// ...
const costDb = useMemo(
  () => buildCostDatabase(projects, commitments, receipts, laborSamples, seeds),
  [projects, commitments, receipts, laborSamples, seeds],
);
```
Then change the `groundingFacts` memo to derive from `costDb` instead of calling `buildCostDatabase` again (use `costDb.entries` where it currently used the local `db.entries`; keep the calibration logic). Keep the memo's `try/catch`.

- [ ] **Step 2: Emit enriched `estimate_generated` on successful generation**

In `generate()`, immediately after the result is set (the `setResult(data)` line ~372), add:

```ts
track(AnalyticsEvents.ESTIMATE_GENERATED, {
  path: 'wizard_generated',
  grand_total: data.total,
  item_count: data.lineItems?.length ?? 0,
  ...estimateGroundingProps(costDb),
});
```
Ensure `track` and `AnalyticsEvents` are imported (`import { track, AnalyticsEvents } from '@/utils/analytics';`). Use the real field names on `data` (confirm `data.total` / `data.lineItems` in the file; adapt if named differently).

- [ ] **Step 3: Emit `estimate_shared` on quick-estimate share**

In the `share()` callback (~447), after the share succeeds, add:

```ts
track(AnalyticsEvents.ESTIMATE_SHARED, {
  method: 'pdf_share',
  source: 'estimate_wizard',
  grand_total: result?.total ?? 0,
});
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (expect zero errors), then:
```bash
git add app/estimate-wizard.tsx
git commit -m "feat(activation): wizard emits enriched estimate_generated + estimate_shared"
```

---

## Task 4: ProjectContext — grounding on `estimate_generated` + first-project flag

**Files:**
- Modify: `contexts/ProjectContext.tsx` (`project_created` ~1782; the two `estimate_generated` emits ~1788 and ~1815)

- [ ] **Step 1: Add `is_first_project` to `project_created`**

At the `project_created` emit (~1782), add the flag to the existing props:

```ts
track(AnalyticsEvents.PROJECT_CREATED, {
  total_projects: updated.length,
  type: project.type,
  has_estimate: !!project.linkedEstimate,
  is_first_project: updated.length === 1,
});
```

- [ ] **Step 2: Enrich the two `estimate_generated` emits with grounding**

For BOTH emit sites (~1788 `path:'created_with_estimate'`, ~1815 `path:'linked_to_project'`), compute grounding from the inputs available in `ProjectContext` and spread the props. First confirm which of `projects, commitments, receipts, laborSamples, seeds` are in scope in `ProjectContext` (grep the file). Build the DB from whatever is available and summarize:

```ts
import { estimateGroundingProps } from '@/utils/activationSignals';
import { buildCostDatabase } from '@/utils/costDatabase';
// ...at each emit site:
const _db = buildCostDatabase(projects, commitments, receipts, laborSamples, seeds);
track(AnalyticsEvents.ESTIMATE_GENERATED, {
  project_type: /* existing */,
  grand_total: /* existing */,
  path: /* existing 'created_with_estimate' | 'linked_to_project' */,
  ...estimateGroundingProps(_db),
});
```
If any of `receipts / laborSamples / seeds` are NOT available in `ProjectContext`, call `buildCostDatabase` with what IS available (its signature tolerates the core `projects, commitments`; pass empty arrays for the rest) and note in the commit body which inputs were omitted. Do NOT add new context subscriptions or providers just for analytics — if the inputs aren't cheaply in scope, ground from `projects+commitments` only and report it as DONE_WITH_CONCERNS.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect zero errors), then:
```bash
git add contexts/ProjectContext.tsx
git commit -m "feat(activation): ground estimate_generated + flag first project in ProjectContext"
```

---

## Task 5: `estimate_shared` at the proposal-link and email send points

**Files:**
- Modify: `app/(tabs)/estimate/review.tsx` (`handleShareProposal` ~109-129)
- Modify: `app/(tabs)/estimate/full.tsx` (`handlePDFSend` email success ~1019)

- [ ] **Step 1: Proposal-link share (`review.tsx`)**

After the link is built/copied in `handleShareProposal`, add:

```ts
track(AnalyticsEvents.ESTIMATE_SHARED, {
  method: 'proposal_link',
  source: 'estimate_review',
  grand_total: clientView?.projectTotal ?? 0,
});
```
Confirm `track`/`AnalyticsEvents` imported; use the real total field on `clientView` (adapt if named differently).

- [ ] **Step 2: Email send (`full.tsx`)**

In `handlePDFSend`, inside the `result.success` branch of the email path (~1019), add:

```ts
track(AnalyticsEvents.ESTIMATE_SHARED, {
  method: 'email',
  source: 'estimate_full',
  grand_total: pendingLinkProject?.linkedEstimate?.grandTotal ?? 0,
});
```
Use the real grand-total in scope at that point (adapt to the file's variable; it must be the estimate total being sent).

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect zero errors), then:
```bash
git add "app/(tabs)/estimate/review.tsx" "app/(tabs)/estimate/full.tsx"
git commit -m "feat(activation): emit estimate_shared on proposal-link + email send"
```

---

## Task 6: `cost_rates_seeded` + `material_receipt_saved`

**Files:**
- Modify: `app/cost-seed.tsx` (after `addSeeds()` succeeds ~105-118)
- Modify: `app/material-receipt.tsx` (after `addReceipt()` ~172-187)

- [ ] **Step 1: cost-seed emit**

After `addSeeds()` returns `result` (before/after the success alert), add:

```ts
track(AnalyticsEvents.COST_RATES_SEEDED, {
  count: (result?.added ?? 0) + (result?.replaced ?? 0),
  method: 'paste',
  source: 'cost_seed',
});
```
If the screen also has a manual (non-paste) commit path, add the same call there with `method: 'manual'`. Confirm `track`/`AnalyticsEvents` imported.

- [ ] **Step 2: material-receipt emit**

In `save()`, after `addReceipt(...)` (~175), add:

```ts
track(AnalyticsEvents.MATERIAL_RECEIPT_SAVED, {
  item_count: draft.lines.length,
  source: 'material_receipt',
});
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect zero errors), then:
```bash
git add app/cost-seed.tsx app/material-receipt.tsx
git commit -m "feat(activation): emit cost_rates_seeded + material_receipt_saved"
```

---

## Task 7: Ship-check green

**Files:** none (verification)

- [ ] **Step 1: Full ship-check**

Run: `bun run ship-check`
Expected: green (exit 0), including `test:activation-signals` (4 passed).

- [ ] **Step 2: Sanity-grep the new emitters**

Run: `grep -rn "ESTIMATE_SHARED\|COST_RATES_SEEDED\|MATERIAL_RECEIPT_SAVED\|is_first_project\|used_learned_costs\|wizard_generated" app contexts utils`
Expected: each new event/prop appears at its intended call site(s) and nowhere spurious.

- [ ] **Step 3: Commit any fixes**

If ship-check flagged anything, fix and:
```bash
git add -A && git commit -m "chore(activation): ship-check green"
```

---

## Task 8: PostHog funnel + dashboard (CONTROLLER task — via the live PostHog connection)

**Not a code subagent task.** After the code lands (and ideally after a build/OTA so events start flowing), the controller builds these in PostHog via the MCP tools:

- [ ] **Funnel insight** "Activation Funnel (contractor)" — ordered steps: `user_signed_up` → `project_created` (breakdown/filter `is_first_project = true`) → (`onboarding_rates_completed` OR `cost_rates_seeded` OR `onboarding_import_completed` OR `material_receipt_saved`) → `estimate_generated` (filter `used_learned_costs = true`) → `estimate_shared`. Conversion window 14 days.
- [ ] **Dashboard** "Activation" containing: the funnel; a `query-trends` of `estimate_generated` broken down by `used_learned_costs` (the cold-start gap); and step-conversion tiles (signup→first-project, first-project→seeded, seeded→aha, aha→shared).
- [ ] Note in the hand-off that the funnel is **empty until real users flow through** post-deploy — this is forward instrumentation; the definitions are the deliverable.

---

## Self-review — spec coverage

- Aha = enriched `estimate_generated` (used_learned_costs/learned_rate_count/jobs_analyzed), fired from the wizard too → Tasks 1, 3, 4. ✓
- `estimate_shared` at all 3 send points → Tasks 3, 5. ✓
- `cost_rates_seeded` + `material_receipt_saved` → Task 6. ✓
- `is_first_project` flag → Task 4. ✓
- Seeded-vs-measured honesty (seeded ⇒ learned_rate_count 0) → enforced by the helper + validator (Task 1). ✓
- PostHog funnel + dashboard → Task 8 (controller). ✓
- Non-goals (onboarding-narrowing, value-first landing, server-side, backfill) → excluded, not tasked. ✓

No placeholders; the property names (`used_learned_costs`, `learned_rate_count`, `jobs_analyzed`, `is_first_project`, event names) are consistent across the helper (Task 1), the enum (Task 2), and every emit site (Tasks 3-6).
