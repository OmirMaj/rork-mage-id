# Estimate Versioning + F0 Money-Spine Unify — Design Spec

Date: 2026-05-17
Status: design approved (user delegated final review; sections confirmed)
Source: feature-depth audit `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` — item **D1a** (estimate versioning) with **F0** (financial-spine unify) folded in. D1b (GC-authored assemblies) and D1c (e-signable proposal) are explicitly OUT — separate later cycles.
Approach: A — a single `commitEstimate()` chokepoint that all estimate writes route through.

## 1. Problem

`project.linkedEstimate` (a single `LinkedEstimate` object) is overwritten in
7+ places (`app/estimate-wizard.tsx:179`, `app/takeoff-estimate.tsx:295`,
`app/drawing-analyzer.tsx:190`, `app/(tabs)/estimate/index.tsx:803/:814/:871/
:931`) via raw `updateProject(id, { linkedEstimate })`. No prior version is
ever kept. Real jobs re-price 2–4× (scope changes, value-engineering); every
regenerate/takeoff silently destroys the previous number. The GC cannot show
"what changed since the version I sent you," cannot revert, and has no paper
trail in a dispute.

Separately (**F0**): `utils/projectFinancials.ts:20,32` reads the *legacy*
`project.estimate?.grandTotal`, while every estimator writes
`project.linkedEstimate`. `utils/contractEngine.ts:131` already reads
`linkedEstimate ?? estimate`. So budget and contract can display two
different totals for the same job — a trust-killer.

## 2. Goals / non-goals

**Goals**
- Immutable, milestone-driven estimate revisions; no estimate write ever
  silently destroys the prior number.
- A revision list + per-CSI-category "what changed" delta + one-tap restore.
- One shared estimate-total accessor so budget, contract, and AIA never
  disagree (F0).
- One DRY estimate-write chokepoint replacing the 7+ scattered writes.
- Offline-first, consistent with existing `updateProject` persistence.

**Non-goals (YAGNI)**
- Full line-by-line diff between revisions (category-level only in v1).
- GC-authored assemblies / rate overrides (D1b — separate cycle).
- E-signable proposal (D1c — separate cycle; will later reference a
  specific `EstimateRevision`).
- Auto-rewriting already-generated contracts/invoices/AIA on restore.
- A separate `estimate_versions` table (jsonb array on the project instead).

## 3. Data model

`types/index.ts`:

```ts
export type EstimateChangeReason =
  | 'manual'                 // GC tapped "Save as revision"
  | 'sent_to_client'         // estimate emailed to homeowner
  | 'converted_to_contract'  // estimate turned into a contract
  | 'pre_overwrite'          // a regenerate/takeoff/edit was about to overwrite
  | 'restore';               // outgoing current, snapshotted before a restore

export interface EstimateRevision {
  id: string;                // generated id
  revNumber: number;         // 1-based, monotonic per project; display "Rev N"
  snapshot: LinkedEstimate;  // full immutable estimate at that point
  grandTotal: number;        // denormalized from snapshot for fast list render
  reason: EstimateChangeReason;
  note?: string;             // optional GC note (manual saves)
  createdAt: string;         // ISO
  createdBy?: string;        // user id/name if available at the call site
}
// Project gains:  estimateVersions?: EstimateRevision[];
```

- Persisted as a new `estimate_versions jsonb` column on `public.projects`
  via a committed migration (repo `<timestamp>_*.sql` convention, never the
  dashboard). Mirrors how `linked_estimate` is persisted: added to the
  project read-map in `contexts/ProjectContext.tsx` (~line 136 region) and
  to the `syncProjectToSupabase` upsert column list; writes flow through the
  existing offline queue via `updateProject` (optimistic + queued).
- **Cap rule:** `manual`, `sent_to_client`, `converted_to_contract`, and
  `restore` revisions are retained indefinitely. If total length exceeds 30,
  drop the **oldest `pre_overwrite`** revisions first until ≤30. Never
  silently drop a milestone/manual/restore revision (correctness over
  storage; per-project counts are small in practice).
- `revNumber` = `(max existing revNumber on the project) + 1`, monotonic;
  never reused even if a lower revision is capped out.

## 4. The chokepoint — `utils/estimateCommit.ts` (NEW)

Pure-ish helpers operating via the existing `getProject` / `updateProject`
from `ProjectContext` (passed in or imported the same way other utils reach
project state — match the codebase's existing pattern; do not add a new
context).

- `commitEstimate(projectId, next: LinkedEstimate, opts: { reason: EstimateChangeReason; note?: string }): void`
  Reads the project. If a current `project.linkedEstimate` exists AND it is
  not equal to the latest revision's snapshot (per the §6 de-dupe equality),
  build an `EstimateRevision` from the **current** estimate (reason from
  `opts`, default `pre_overwrite`),
  append it, apply the cap rule, then a single
  `updateProject(projectId, { linkedEstimate: next, estimateVersions })`.
  If no current estimate exists, just set `next` (nothing to preserve, no
  revision). One write → offline-safe.

- `snapshotEstimate(projectId, reason, note?): void`
  Captures the current `linkedEstimate` into `estimateVersions` WITHOUT
  changing `linkedEstimate`. No-op if there is no current estimate or it is
  identical to the latest snapshot. Used for milestone events
  (`sent_to_client`, `converted_to_contract`) and the manual
  "Save as revision" (`manual`, with `note`).

- `restoreEstimateRevision(projectId, revisionId): void`
  Looks up the revision. First `snapshotEstimate(projectId, 'restore')` of
  the outgoing current (so restore is itself undoable), then
  `updateProject(projectId, { linkedEstimate: <that revision's snapshot> })`.
  Does NOT modify any existing contract/invoice/AIA pay-app.

- `diffEstimates(a: LinkedEstimate, b: LinkedEstimate): { categories: { key: string; label: string; delta: number }[]; netDelta: number }`
  Pure. Group each estimate's `items` by `csiDivision` (fallback
  `category`), sum `lineTotal` per group, compute per-group delta (b − a) and
  the net total delta. Sorted by descending `abs(delta)`.

- `effectiveEstimateTotal(project): number` — **F0**
  Returns `project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0`.

### Refactor / wiring

Replace raw `updateProject({ linkedEstimate })` with `commitEstimate(...)`:
- `app/estimate-wizard.tsx:179` (AI generate → fold) — reason `pre_overwrite`.
- `app/takeoff-estimate.tsx:295` — reason `pre_overwrite`.
- `app/drawing-analyzer.tsx:190` — reason `pre_overwrite`.
- `app/(tabs)/estimate/index.tsx:803, :814, :871, :931` (estimator
  build/save) — reason `pre_overwrite`; the explicit "Save as revision"
  button instead calls `snapshotEstimate(projectId, 'manual', note)`.

Milestone hooks (call `snapshotEstimate`): the estimate "send to client"
path in `app/(tabs)/estimate/index.tsx` → `sent_to_client`; the
estimate→contract conversion in `app/contract.tsx` / `utils/contractEngine.ts`
→ `converted_to_contract`. (Exact lines pinned in the implementation plan.)

**Explicitly NOT wrapped:** `contexts/ProjectContext.tsx:1850` mutates
`linkedEstimate.items` in place for buyout allowance→firm-price locking. That
is a targeted item edit, not a re-estimate; wrapping it would create noise
revisions. Leave it untouched.

**F0 routing:** `utils/projectFinancials.ts:20,32` (and any other money read
of `project.estimate?.grandTotal` for estimate base) route through
`effectiveEstimateTotal`. `contractEngine.ts:131` already does
`linkedEstimate ?? estimate` — align it to call the shared accessor so there
is a single source of truth. F0 changes only the estimate-*base* read; the
CO roll-up (contract value = estimate + approved COs) is unchanged, so no
double-count.

## 5. UI (small, additive)

On the estimate surface (estimate screen + the project-detail estimate
section):
- A **Revisions** list: rows of `Rev {revNumber} · {grandTotal} ·
  {createdAt} · {reason→friendly label}` (e.g. "Sent to client",
  "Before re-estimate", "Manual", "Converted to contract", "Restored").
- Tap a row → revision detail: its total, the per-category delta vs the
  immediately-previous revision (via `diffEstimates`), the `note`, and
  actions: **Restore this revision** (confirm dialog including the one-line
  caution that existing contract/invoices are not auto-changed) and
  **View line items** (read-only render of `snapshot.items`).
- A **Save as revision** action on the estimate screen (optional note),
  calling `snapshotEstimate(projectId, 'manual', note)`.
Reuse existing list/row/modal styles on those screens; no new design system.

## 6. Edge cases / errors

- First-ever estimate → `commitEstimate` sets it, creates no revision.
- De-dupe: `commitEstimate`/`snapshotEstimate` skip creating a revision when
  the current estimate equals the latest revision's snapshot. Equality =
  stable-key JSON serialization of the `LinkedEstimate` (ignore the
  volatile `id`/`createdAt` fields on the estimate object itself; compare
  `items` + totals + `globalMarkup`).
- Restore is forward-only for the *estimate of record*; downstream
  contract/invoice/AIA documents are untouched (GC regenerates if desired).
- Offline: all paths are `updateProject` → existing offline queue
  (optimistic + queued); no new sync path.
- Cap never drops milestone/manual/restore revisions.
- `csiDivision` may be absent on legacy items → `diffEstimates` falls back
  to `category`, and to a single "Uncategorized" bucket if both absent.

## 7. Verification

No unit-test runner in this repo. Gate = `npx tsc --noEmit` clean across
changed files + manual walkthrough:
1. Create an estimate; regenerate via the wizard → prior auto-saved as a
   `pre_overwrite` revision; new estimate is current.
2. "Save as revision" with a note → appears as a `manual` revision.
3. Send estimate to client → a `sent_to_client` revision is captured.
4. Revision list shows correct totals / dates / friendly reasons.
5. Open a revision → per-category delta vs previous is correct; net delta
   equals total difference.
6. Restore an older revision → it becomes current; the outgoing current is
   preserved as a `restore` revision; no contract/invoice changed.
7. Budget-screen total == contract-screen total (F0) for a project that has
   only `linkedEstimate` (no legacy `estimate`).
8. Offline: regenerate while offline still queues and still snapshots.

## 8. Files touched (summary)

- `types/index.ts` — `EstimateChangeReason`, `EstimateRevision`,
  `Project.estimateVersions?`.
- `utils/estimateCommit.ts` — NEW (commit/snapshot/restore/diff/
  effectiveEstimateTotal).
- `supabase/migrations/<ts>_estimate_versions.sql` — NEW: add
  `estimate_versions jsonb` to `public.projects`.
- `contexts/ProjectContext.tsx` — read-map + `syncProjectToSupabase` upsert
  include `estimate_versions`.
- The 7 estimate-write sites (above) → `commitEstimate`; the manual
  save + milestone hooks → `snapshotEstimate`.
- `utils/projectFinancials.ts` (+ `utils/contractEngine.ts` alignment) →
  `effectiveEstimateTotal`.
- Estimate UI surface (`app/(tabs)/estimate/index.tsx` and/or the
  project-detail estimate section) — revisions list, detail+delta, restore,
  save-as-revision.

Single subsystem → single implementation plan.
