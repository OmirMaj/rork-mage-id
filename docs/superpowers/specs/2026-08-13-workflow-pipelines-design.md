# Workflow Pipelines — visible lifecycle on every workflow screen

_Design, 2026-08-13._

## The problem

`components/StatusPipeline.tsx` gives a workflow a visible lifecycle: a
breadcrumb of where the item sits now, a days-in-status counter, and a one-tap
advance. It is wired to six screens — RFI, Submittal, Change Order, Invoice,
Contract, Lead — and `docs/workflow-audit-roadmap.md` names eleven more that
should have it.

On the eleven, status is still a dropdown halfway down a form. The user scrolls,
taps, and picks from a list, which is three steps for the most-mutated field on
the screen and tells them nothing about what comes next.

## What this design is NOT

Out of scope, deliberately:

- **AIA pay apps and the closeout binder.** `SavedAIAPayApp` has no status field
  and no `CloseoutBinder` interface exists at all. Both need a data model, a
  persistence path, and probably a migration — a different size of job than the
  rest, and each deserves its own spec.
- **The roadmap's other three patterns** — carry-forward, progress indicators,
  voice-everywhere. Separate specs.

This spec is one pattern applied across the workflows that can already carry it.

## The finding that shaped this

The roadmap proposed stage sequences without checking the state machines that
exist. Three of them do not survive contact with `types/index.ts`:

| Workflow | Roadmap proposed | Actual union |
|---|---|---|
| Warranties | Active → Walk Scheduled → Walked → Closed | `active \| expiring_soon \| expired \| claimed \| void` |
| Permits | Applied → In Review → Issued | 8 states including an inspection sub-cycle |
| Selections | Pending → Picked → Confirmed | `pending \| browsing \| chosen \| exceeded` |
| Bid response | Drafted → Submitted → Awarded/Lost | no such union exists anywhere |

"Walk Scheduled" and "Walked" do not exist. Warranty status is not a sequence of
actions at all — `expiring_soon` and `expired` are facts about the calendar, and
`claimed` / `void` are branches off the side. Permits carry a second loop
(`inspection_scheduled → inspection_passed | inspection_failed`) that begins
*after* the application path finishes. `exceeded` on a selection is a budget
condition, orthogonal to how far along the choice is.

"Bid response" is the sharpest case: there is no bid-response lifecycle in the
codebase at all. `BidStatus` is `'open' | 'closed'` — a marketplace posting
toggle, not a lifecycle. The real sequence lives one level up on the package,
`BidPackageStatus = 'open' | 'leveling' | 'awarded' | 'cancelled'`, already
documented in `types/index.ts` as *"open → leveling → awarded (creates a
Commitment)"*. A sub submitting a response is a one-shot action; the thing with
a lifecycle is the package the GC is running. So the pipeline goes on the
package — which also covers the roadmap's separate "buyout" row, since both
screens read the same union.

So the work is not "wire eleven pipelines." It is: pipeline where the domain is
a sequence, derive where the domain is a date, branch where the domain branches,
and decline where there is no lifecycle to show.

## Architecture

One pure module, `utils/workflowPipelines.ts` — no React, no React Native, no
storage, no clock beyond what the caller passes in. `bun` runs it directly, the
same shape as `utils/costSeedCore.ts` and `utils/portalOwnerCore.ts`.

```ts
export type WorkflowKind =
  | 'punch' | 'permit' | 'lienWaiver' | 'prequal' | 'oac' | 'selection'
  | 'bidPackage';

/** The happy path, in order. Terminal stage last. */
export function stagesFor(kind: WorkflowKind): PipelineStage<string>[];

/** The next stage, or null at a terminal stage or on a side branch. */
export function advanceTargetFor(kind: WorkflowKind, current: string): string | null;

/** True for states that sit outside the sequence (denied, void, exceeded…). */
export function isSideBranch(kind: WorkflowKind, status: string): boolean;

/** Time-derived, never advanceable. `now` injected to keep these pure. */
export function coiStatus(coi: CertificateOfInsurance, now: number): DerivedStatus;
export function warrantyStatus(w: Warranty, now: number): DerivedStatus;
```

`PipelineStage<S>` already exists in `components/StatusPipeline.tsx` and already
has the `terminal?` flag this needs. No component work.

Screens stay thin — import `stagesFor`, render `StatusPipeline`, point
`onAdvance` at the write path that screen already uses. Nothing else moves.

## Per-workflow treatment

| Workflow | Happy path | Side branches (reachable via the existing picker, outside the visual) |
|---|---|---|
| Punch | `open → in_progress → ready_for_review → closed` | — |
| Lien waivers | `requested → signed → received` | `voided` |
| Prequal | `draft → invited → in_progress → submitted → approved` | `needs_changes`, `rejected`, `expired` |
| OAC | `draft → scheduled → in_progress → concluded → distributed` | — |
| Selections | `pending → browsing → chosen` | `exceeded` (budget badge) |
| Bid package | `open → leveling → awarded` | `cancelled` |
| Permits | `applied → under_review → approved` | `denied`, `expired`, + the inspection cycle |
| COI | **derived badge** | — |
| Warranties | **derived badge** | `claimed`, `void` |

That is seven pipelines and two derived badges. Against the roadmap's list of
eleven, the remaining two — AIA pay apps and the closeout binder — are deferred
above, and "bid response" is folded into the bid package for the reason given.
Every roadmap item is accounted for.

### Permits — two loops, not one line

The application path ends at `approved`. Inspections are a second cycle that
starts afterward and can repeat (`inspection_failed` goes back to
`inspection_scheduled`). Rendering them as one eight-stage line would claim the
permit moves through `denied` on its way to an inspection, which is false.

The application pipeline renders first. When a permit is `approved` or beyond, an
inspection state renders as its own short pipeline below it. A permit that is
`denied` or `expired` shows the application pipeline with a side-branch badge and
no advance button.

### COI and warranties — derived, not advanceable

Neither has an action to take, so neither gets an advance button. Both compute
their status from dates:

- **COI** — a certificate has no status field; its coverages carry
  `expiresAt`. The certificate's status is driven by the **earliest** expiry
  across `coverages[]`, because one lapsed policy makes the whole certificate
  untrustworthy. No coverages with an `expiresAt` → `unknown`, never `active`.
- **Warranty** — from `endDate`, with the "expiring soon" window taken from the
  warranty's own `reminderDays` when set, falling back to 30. A user who asked
  for 90 days' notice should see "expiring soon" at 90 days, not 30.
  `claims.length > 0` surfaces as the `claimed` branch.

Both take `now` as a parameter. No module-level clock.

## Data flow

`onAdvance` calls the write path the screen already has. That differs per
screen and this design does not unify it:

- `app/punch-list.tsx` already writes through `supabaseWrite` (the offline queue).
- `app/permits.tsx` and `app/lien-waivers.tsx` persist through `useProjects()`.

Introducing a new persistence path here would be a second change riding along
with this one, and the repo rule is that Supabase writes go through
`utils/offlineQueue.ts` — which the ProjectContext path already honours
internally. Advancing a status is an ordinary field update on an existing
object; it does not need special handling.

## Testing

`scripts/validate-workflow-pipelines.ts`, run by `bun` like the other 136.

Structural, per kind:

- stages are non-empty and ordered, and the last one is `terminal`
- `advanceTargetFor` returns the immediate next stage, and `null` at a terminal
- `advanceTargetFor` never returns a side branch
- `isSideBranch` and the happy path are disjoint

**Exhaustiveness — the check that earns its keep.** Every value in every real
status union must be either on the happy path or explicitly classified as a side
branch. This is what the roadmap got wrong: it invented `walk_scheduled` and
`walked` for a union that has neither. Adding a new status to any union later
fails the validator until someone classifies it.

Derived statuses, at the boundaries:

- COI: expired yesterday; expiring in 29 vs 31 days; the earliest of several
  coverages wins; no coverages at all → `unknown`, not `active`
- Warranty: `reminderDays: 90` reports expiring at 90 days, not 30; missing
  `reminderDays` falls back to 30; a warranty with claims reads `claimed`

Source-level, matching the repo's convention: each touched screen imports
`stagesFor` and passes it to `StatusPipeline`, so a screen cannot silently drop
the wiring.

There is no runtime test in this repo — no jest, no detox, no testing-library.
That is a known gap and its own separate project. Keeping the logic in a pure
module and the screens at three lines each is what makes it testable without
that harness: everything with a decision in it lives where `bun` can reach it.

## Success criteria

1. All seven pipeline workflows show a lifecycle breadcrumb and advance in one tap.
2. COI and warranties show an honest derived status and no advance affordance.
3. Permits show the application path and the inspection cycle as separate things.
4. No status value anywhere is unclassified — the validator proves it.
5. `tsc` clean, all validators pass, lint 0 errors.
