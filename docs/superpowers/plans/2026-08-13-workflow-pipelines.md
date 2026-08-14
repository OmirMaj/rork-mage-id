# Workflow Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every workflow screen that has a real state machine a visible lifecycle breadcrumb with one-tap advance, and give the two time-based ones an honest derived status badge instead.

**Architecture:** All decisions live in one zero-import pure module, `utils/workflowPipelines.ts`, which `bun` runs directly — the same shape as `utils/costSeedCore.ts`. Screens import `stagesFor(kind)` and render the existing `components/StatusPipeline`, wiring `onAdvance` to the write path that screen already uses. No component changes, no data-model changes, no new persistence path.

**Tech Stack:** TypeScript, React Native / Expo, `bun` for validators. No test framework — this repo has none; validators are plain `bun` scripts.

---

## Spec

`docs/superpowers/specs/2026-08-13-workflow-pipelines-design.md`

## File structure

| File | Responsibility |
|---|---|
| `utils/workflowPipelines.ts` | **Create.** Every stage list, side-branch classification, advance rule, and the two derived statuses. Zero imports. |
| `scripts/validate-workflow-pipelines.ts` | **Create.** Unit tests for the above + the exhaustiveness guard + source-level screen assertions. |
| `app/punch-list.tsx` | **Modify.** Reference wiring. |
| `app/permits.tsx` | **Modify.** Two pipelines (application + inspection). |
| `app/lien-waivers.tsx` | **Modify.** |
| `app/selections.tsx` | **Modify.** |
| `app/prequal-manager.tsx` | **Modify.** |
| `app/oac-meeting.tsx` | **Modify.** |
| `app/buyout-package.tsx` | **Modify.** |
| `app/coi-vault.tsx`, `app/warranties.tsx` | **Modify.** Derived badge, no advance button. |

**Why the pure module imports nothing:** `components/StatusPipeline.tsx` imports `react-native`. If `workflowPipelines.ts` imported `PipelineStage` from it, `bun` would try to resolve React Native to run the validator. Instead the module defines `WorkflowStage` with the identical shape (`{ key, label, terminal? }`); TypeScript's structural typing means it can be passed straight to `<StatusPipeline stages={...} />` with no cast and no duplication of behaviour.

---

### Task 1: The pipeline core

**Files:**
- Create: `utils/workflowPipelines.ts`
- Create: `scripts/validate-workflow-pipelines.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-workflow-pipelines.ts`:

```ts
// validate-workflow-pipelines.ts — pins the workflow lifecycle model.
//
// docs/workflow-audit-roadmap.md proposed stage sequences WITHOUT checking the
// unions in types/index.ts, and four of eight were wrong — it invented
// 'walk_scheduled'/'walked' for warranties, flattened the permit inspection
// cycle into the application path, treated the selections budget flag
// 'exceeded' as a stage, and proposed a bid-response lifecycle that does not
// exist in the codebase at all. The exhaustiveness check at the bottom is what
// makes that class of mistake impossible to repeat.
//
// Run: bun run scripts/validate-workflow-pipelines.ts
import {
  stagesFor, advanceTargetFor, isSideBranch, visualStageFor,
  WORKFLOW_KINDS, type WorkflowKind,
} from '../utils/workflowPipelines';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log('  ✓', name); }
  else {
    fail++;
    console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want));
  }
}

console.log('\nstructure — every kind:');
for (const kind of WORKFLOW_KINDS) {
  const stages = stagesFor(kind);
  ok(`${kind}: has stages`, stages.length > 0);
  ok(`${kind}: exactly one terminal stage, and it is last`,
    stages.filter(s => s.terminal).length === 1 && !!stages[stages.length - 1].terminal);
  ok(`${kind}: every stage key is unique`,
    new Set(stages.map(s => s.key)).size === stages.length);
  ok(`${kind}: advancing the terminal stage goes nowhere`,
    advanceTargetFor(kind, stages[stages.length - 1].key) === null);
  ok(`${kind}: each non-terminal stage advances to its immediate successor`,
    stages.slice(0, -1).every((s, i) => advanceTargetFor(kind, s.key) === stages[i + 1].key));
  ok(`${kind}: no stage is also a side branch`,
    stages.every(s => !isSideBranch(kind, s.key)));
  ok(`${kind}: an unknown status advances nowhere`,
    advanceTargetFor(kind, 'not_a_real_status') === null);
}

console.log('\nside branches never advance:');
expect('a voided lien waiver has no next step', advanceTargetFor('lienWaiver', 'voided'), null);
expect('a denied permit has no next step', advanceTargetFor('permit', 'denied'), null);
expect('a rejected prequal has no next step', advanceTargetFor('prequal', 'rejected'), null);
expect('an over-budget selection has no next step', advanceTargetFor('selection', 'exceeded'), null);
expect('a cancelled bid package has no next step', advanceTargetFor('bidPackage', 'cancelled'), null);

console.log('\nvisual anchoring:');
expect('a normal status anchors to itself', visualStageFor('permit', 'under_review'), 'under_review');
expect('a side branch anchors to the first stage so the breadcrumb still renders',
  visualStageFor('permit', 'denied'), 'applied');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
bun run scripts/validate-workflow-pipelines.ts
```

Expected: fails immediately — `Cannot find module '../utils/workflowPipelines'`.

- [ ] **Step 3: Write the implementation**

Create `utils/workflowPipelines.ts`:

```ts
// utils/workflowPipelines.ts — the lifecycle model behind every StatusPipeline.
//
// WHY THIS IS A PURE MODULE. components/StatusPipeline.tsx imports react-native,
// so anything importing it is unreachable from `bun`. This repo has no runtime
// test tooling at all (no jest, no detox, no testing-library), which means the
// only logic that can be tested is logic that lives somewhere bun can run.
// Every decision therefore lives here and the screens stay at three lines each.
//
// WorkflowStage is declared here rather than imported from the component for
// the same reason. It is structurally identical to PipelineStage<string>, so it
// passes straight to <StatusPipeline stages={...} /> with no cast.
//
// THE MODEL. A workflow is a happy path plus side branches. The happy path is
// an ordered list ending in exactly one terminal stage; side branches (denied,
// void, exceeded…) are real states the item can hold but are NOT steps toward
// completion, so they are reachable via each screen's existing status picker
// and never via "Advance".
//
// Permits are TWO pipelines, not one. The application path ends at `approved`;
// inspections are a separate cycle that starts afterward and can repeat
// (inspection_failed goes back to inspection_scheduled). Rendering all eight
// permit states as one line would claim a permit passes through `denied` on the
// way to an inspection, which is false.

export type WorkflowKind =
  | 'punch'
  | 'permit'
  | 'permitInspection'
  | 'lienWaiver'
  | 'prequal'
  | 'oac'
  | 'selection'
  | 'bidPackage';

export const WORKFLOW_KINDS: WorkflowKind[] = [
  'punch', 'permit', 'permitInspection', 'lienWaiver',
  'prequal', 'oac', 'selection', 'bidPackage',
];

/** Structurally identical to PipelineStage<string> in components/StatusPipeline. */
export interface WorkflowStage {
  key: string;
  label: string;
  terminal?: boolean;
}

const PIPELINES: Record<WorkflowKind, WorkflowStage[]> = {
  punch: [
    { key: 'open', label: 'Open' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'ready_for_review', label: 'Ready for Review' },
    { key: 'closed', label: 'Closed', terminal: true },
  ],
  // Application path only. Ends at approved — the permit is issued.
  permit: [
    { key: 'applied', label: 'Applied' },
    { key: 'under_review', label: 'Under Review' },
    { key: 'approved', label: 'Issued', terminal: true },
  ],
  // The second loop, rendered separately once a permit is issued.
  permitInspection: [
    { key: 'inspection_scheduled', label: 'Scheduled' },
    { key: 'inspection_passed', label: 'Passed', terminal: true },
  ],
  lienWaiver: [
    { key: 'requested', label: 'Requested' },
    { key: 'signed', label: 'Signed' },
    { key: 'received', label: 'Received', terminal: true },
  ],
  prequal: [
    { key: 'draft', label: 'Draft' },
    { key: 'invited', label: 'Invited' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'approved', label: 'Approved', terminal: true },
  ],
  oac: [
    { key: 'draft', label: 'Draft' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'concluded', label: 'Concluded' },
    { key: 'distributed', label: 'Distributed', terminal: true },
  ],
  selection: [
    { key: 'pending', label: 'Pending' },
    { key: 'browsing', label: 'Browsing' },
    { key: 'chosen', label: 'Chosen', terminal: true },
  ],
  bidPackage: [
    { key: 'open', label: 'Open' },
    { key: 'leveling', label: 'Leveling' },
    { key: 'awarded', label: 'Awarded', terminal: true },
  ],
};

// States the item can really hold that are NOT steps toward completion.
const SIDE_BRANCHES: Record<WorkflowKind, string[]> = {
  punch: [],
  permit: ['denied', 'expired'],
  permitInspection: ['inspection_failed'],
  lienWaiver: ['voided'],
  prequal: ['needs_changes', 'rejected', 'expired'],
  oac: [],
  selection: ['exceeded'],
  bidPackage: ['cancelled'],
};

export function stagesFor(kind: WorkflowKind): WorkflowStage[] {
  return PIPELINES[kind];
}

export function sideBranchesFor(kind: WorkflowKind): string[] {
  return SIDE_BRANCHES[kind];
}

export function isSideBranch(kind: WorkflowKind, status: string): boolean {
  return SIDE_BRANCHES[kind].includes(status);
}

/**
 * The next stage, or null when there isn't one — at a terminal stage, on a side
 * branch, or for a status this kind doesn't recognize. Returning null rather
 * than guessing is what keeps "Advance" from appearing on a denied permit.
 */
export function advanceTargetFor(kind: WorkflowKind, current: string): string | null {
  if (isSideBranch(kind, current)) return null;
  const stages = PIPELINES[kind];
  const i = stages.findIndex(s => s.key === current);
  if (i < 0 || stages[i].terminal) return null;
  return stages[i + 1]?.key ?? null;
}

/**
 * Which stage the breadcrumb should highlight. A side branch has no position in
 * the sequence, so it anchors at the first stage and the screen renders a
 * side-branch badge alongside — the badge carries the meaning, the breadcrumb
 * just stays rendered instead of collapsing. (Same approach app/rfi.tsx already
 * takes with `current={status === 'void' ? 'open' : status}`.)
 */
export function visualStageFor(kind: WorkflowKind, status: string): string {
  if (!isSideBranch(kind, status)) return status;
  return PIPELINES[kind][0].key;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
bun run scripts/validate-workflow-pipelines.ts
```

Expected: `48 passed, 0 failed` (8 kinds × 6 structural checks recorded per kind, ≈48; the exact count will differ — what matters is `0 failed`).

- [ ] **Step 5: Commit**

```bash
git add utils/workflowPipelines.ts scripts/validate-workflow-pipelines.ts
git commit -m "feat(workflows): pure lifecycle model for the seven pipeline workflows"
```

---

### Task 2: Derived statuses for COI and warranties

Neither has an action to take, so neither gets an advance button. Both compute from dates.

**Files:**
- Modify: `utils/workflowPipelines.ts`
- Modify: `scripts/validate-workflow-pipelines.ts`

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-workflow-pipelines.ts`, immediately before the final `console.log`:

```ts
console.log('\nderived — COI (earliest coverage expiry wins):');
const NOW = Date.UTC(2026, 7, 13, 12, 0, 0); // fixed clock — no flaky tests
const day = (n: number) => new Date(NOW + n * 86400000).toISOString();

expect('no coverages reads unknown, never active',
  coiStatus({ coverages: [] }, NOW).key, 'unknown');
expect('coverages with no expiry date read unknown',
  coiStatus({ coverages: [{}] }, NOW).key, 'unknown');
expect('an unparseable expiry is ignored, not treated as expired',
  coiStatus({ coverages: [{ expiresAt: 'not-a-date' }] }, NOW).key, 'unknown');
expect('an expired coverage reads expired',
  coiStatus({ coverages: [{ expiresAt: day(-1) }] }, NOW).key, 'expired');
expect('31 days out is still active',
  coiStatus({ coverages: [{ expiresAt: day(31) }] }, NOW).key, 'active');
expect('29 days out is expiring',
  coiStatus({ coverages: [{ expiresAt: day(29) }] }, NOW).key, 'expiring');
// One lapsed policy makes the whole certificate untrustworthy.
expect('the EARLIEST coverage decides the certificate',
  coiStatus({ coverages: [{ expiresAt: day(300) }, { expiresAt: day(-2) }] }, NOW).key, 'expired');

console.log('\nderived — warranties (honours the user\'s own reminder window):');
expect('a void warranty reads void',
  warrantyStatus({ status: 'void', endDate: day(400) }, NOW).key, 'void');
expect('an open claim outranks the calendar',
  warrantyStatus({ endDate: day(400), claims: [{ id: 'c1' }] }, NOW).key, 'claimed');
expect('past its end date reads expired',
  warrantyStatus({ endDate: day(-1) }, NOW).key, 'expired');
expect('default window is 30 days — 31 out is active',
  warrantyStatus({ endDate: day(31) }, NOW).key, 'active');
// A GC who asked for 90 days' notice must see the warning at 90, not 30.
expect('reminderDays 90 reports expiring at 60 days out',
  warrantyStatus({ endDate: day(60), reminderDays: 90 }, NOW).key, 'expiring_soon');
expect('...and the same warranty is active with the default window',
  warrantyStatus({ endDate: day(60) }, NOW).key, 'active');
expect('a missing end date reads unknown, never active',
  warrantyStatus({}, NOW).key, 'unknown');
```

Extend the import at the top of the file to:

```ts
import {
  stagesFor, advanceTargetFor, isSideBranch, visualStageFor,
  coiStatus, warrantyStatus,
  WORKFLOW_KINDS, type WorkflowKind,
} from '../utils/workflowPipelines';
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun run scripts/validate-workflow-pipelines.ts
```

Expected: fails — `coiStatus is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

Append to `utils/workflowPipelines.ts`:

```ts
// ---------------------------------------------------------------------------
// Derived statuses — for the two workflows that have no action to advance.
// ---------------------------------------------------------------------------
// A certificate of insurance has no status field at all; a warranty's status
// union is `active|expiring_soon|expired|claimed|void`, of which the first
// three are facts about the calendar rather than steps anyone takes. Showing
// an "Advance →" button on either would invite the user to perform an action
// that does not exist. Both compute instead, and `now` is injected so these
// stay pure and the tests stay deterministic.

const DAY_MS = 86400000;

/** Days before expiry at which we start warning, when nothing else is set. */
export const DEFAULT_EXPIRY_WINDOW_DAYS = 30;

export type DerivedTone = 'neutral' | 'good' | 'warn' | 'bad';

export interface DerivedStatus {
  key: 'unknown' | 'active' | 'expiring' | 'expiring_soon' | 'expired' | 'claimed' | 'void';
  label: string;
  tone: DerivedTone;
}

/**
 * A certificate is only as good as its soonest-lapsing policy, so the EARLIEST
 * `expiresAt` across coverages decides. No parseable expiry reads 'unknown' —
 * never 'active', because "we have no idea" must not look like "you're covered".
 */
export function coiStatus(
  coi: { coverages?: { expiresAt?: string }[] },
  now: number,
): DerivedStatus {
  const stamps = (coi.coverages ?? [])
    .map(c => (typeof c.expiresAt === 'string' ? Date.parse(c.expiresAt) : NaN))
    .filter(t => !Number.isNaN(t));

  if (stamps.length === 0) {
    return { key: 'unknown', label: 'No expiry on file', tone: 'neutral' };
  }
  const days = Math.floor((Math.min(...stamps) - now) / DAY_MS);
  if (days < 0) return { key: 'expired', label: 'Expired', tone: 'bad' };
  if (days <= DEFAULT_EXPIRY_WINDOW_DAYS) {
    return { key: 'expiring', label: `Expires in ${days}d`, tone: 'warn' };
  }
  return { key: 'active', label: 'Active', tone: 'good' };
}

/**
 * Void first (an explicit decision outranks the calendar), then an open claim,
 * then the dates. The warning window is the warranty's OWN `reminderDays` when
 * set — a GC who asked for 90 days' notice should be warned at 90, not 30.
 */
export function warrantyStatus(
  w: { status?: string; endDate?: string; reminderDays?: number; claims?: unknown[] },
  now: number,
): DerivedStatus {
  if (w.status === 'void') return { key: 'void', label: 'Void', tone: 'neutral' };
  if ((w.claims?.length ?? 0) > 0) {
    return { key: 'claimed', label: 'Claim open', tone: 'warn' };
  }
  const end = typeof w.endDate === 'string' ? Date.parse(w.endDate) : NaN;
  if (Number.isNaN(end)) {
    return { key: 'unknown', label: 'No end date', tone: 'neutral' };
  }
  const days = Math.floor((end - now) / DAY_MS);
  const windowDays = Number.isFinite(w.reminderDays) && (w.reminderDays as number) > 0
    ? (w.reminderDays as number)
    : DEFAULT_EXPIRY_WINDOW_DAYS;
  if (days < 0) return { key: 'expired', label: 'Expired', tone: 'bad' };
  if (days <= windowDays) {
    return { key: 'expiring_soon', label: `Expires in ${days}d`, tone: 'warn' };
  }
  return { key: 'active', label: 'Active', tone: 'good' };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
bun run scripts/validate-workflow-pipelines.ts
```

Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils/workflowPipelines.ts scripts/validate-workflow-pipelines.ts
git commit -m "feat(workflows): derived COI and warranty status from dates, not actions"
```

---

### Task 3: The exhaustiveness guard

This is the check that would have caught the roadmap's four wrong sequences. TypeScript unions don't exist at runtime, so it reads the union members out of `types/index.ts` and asserts every one is classified.

**Files:**
- Modify: `scripts/validate-workflow-pipelines.ts`

- [ ] **Step 1: Write the failing test**

Append to `scripts/validate-workflow-pipelines.ts`, immediately before the final `console.log`:

```ts
// ── EXHAUSTIVENESS. The one that earns its keep.
// Every value in every real status union must be either on a happy path or
// explicitly classified as a side branch. The roadmap this work came from
// proposed stages that do not exist ('walk_scheduled', 'walked') and missed
// states that do ('exceeded', the whole permit inspection cycle). A union that
// grows later now fails this check until someone classifies the new value.
console.log('\nexhaustiveness — every real status is classified:');

const TYPES_SRC = readFileSync(join(ROOT, 'types/index.ts'), 'utf8');

function unionValues(typeName: string): string[] {
  const m = new RegExp(`export type ${typeName} =([\\s\\S]*?);`).exec(TYPES_SRC);
  if (!m) return [];
  return Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map(x => x[1]);
}

// kind(s) that together must cover the union
const COVERAGE: { union: string; kinds: WorkflowKind[] }[] = [
  { union: 'PunchItemStatus', kinds: ['punch'] },
  { union: 'PermitStatus', kinds: ['permit', 'permitInspection'] },
  { union: 'LienWaiverStatus', kinds: ['lienWaiver'] },
  { union: 'PrequalStatus', kinds: ['prequal'] },
  { union: 'OACMeetingStatus', kinds: ['oac'] },
  { union: 'SelectionCategoryStatus', kinds: ['selection'] },
  { union: 'BidPackageStatus', kinds: ['bidPackage'] },
];

for (const { union, kinds } of COVERAGE) {
  const values = unionValues(union);
  ok(`${union}: found in types/index.ts`, values.length > 0,
    'the union was renamed or removed — update COVERAGE above');

  const classified = new Set<string>();
  for (const k of kinds) {
    for (const s of stagesFor(k)) classified.add(s.key);
    for (const b of sideBranchesFor(k)) classified.add(b);
  }
  const unclassified = values.filter(v => !classified.has(v));
  ok(`${union}: every value is a stage or a side branch`,
    unclassified.length === 0,
    unclassified.length ? `unclassified: ${unclassified.join(', ')}` : undefined);

  // The other direction: we must not invent stages the union doesn't have.
  // This is the exact failure the roadmap made with 'walk_scheduled'/'walked'.
  const invented = [...classified].filter(c => !values.includes(c));
  ok(`${union}: no invented states`, invented.length === 0,
    invented.length ? `not in the union: ${invented.join(', ')}` : undefined);
}
```

Extend the imports at the top of the file:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  stagesFor, sideBranchesFor, advanceTargetFor, isSideBranch, visualStageFor,
  coiStatus, warrantyStatus,
  WORKFLOW_KINDS, type WorkflowKind,
} from '../utils/workflowPipelines';

// fileURLToPath + join because the repo path contains a space.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
```

- [ ] **Step 2: Run it to verify it fails or passes for the right reason**

```bash
bun run scripts/validate-workflow-pipelines.ts
```

Expected: PASSES. If any line fails, the message names the exact unclassified or invented state — fix `PIPELINES`/`SIDE_BRANCHES` in `utils/workflowPipelines.ts` to match reality, never edit the union to match the plan.

- [ ] **Step 3: Prove the guard actually guards**

Temporarily add a fake state to the punch pipeline in `utils/workflowPipelines.ts`:

```ts
  punch: [
    { key: 'open', label: 'Open' },
    { key: 'walk_scheduled', label: 'Walk Scheduled' },   // TEMPORARY
    { key: 'in_progress', label: 'In Progress' },
    { key: 'ready_for_review', label: 'Ready for Review' },
    { key: 'closed', label: 'Closed', terminal: true },
  ],
```

Run it:

```bash
bun run scripts/validate-workflow-pipelines.ts
```

Expected: FAILS with `PunchItemStatus: no invented states … not in the union: walk_scheduled`.

Now revert that line. Re-run and confirm `0 failed`.

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-workflow-pipelines.ts
git commit -m "test(workflows): exhaustiveness guard — no unclassified or invented states"
```

---

### Task 4: Wire punch-list (reference implementation)

Every remaining screen follows this exact shape. `app/punch-list.tsx` already has `updatePunchItem` from `useProjects()`, so it is the cleanest one to establish the pattern.

**Files:**
- Modify: `app/punch-list.tsx`

- [ ] **Step 1: Find the item-detail render and the updater**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
grep -n "updatePunchItem" app/punch-list.tsx
grep -n "PunchItemStatus\|status ===" app/punch-list.tsx | head -20
```

Note the line where a single punch item's detail is rendered (a modal or an expanded row) — the pipeline goes at the TOP of that detail view, above the existing status control. Do not remove the existing status picker; it is how side branches stay reachable.

- [ ] **Step 2: Add the import**

At the top of `app/punch-list.tsx`, alongside the other `@/components` imports:

```ts
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor, advanceTargetFor } from '@/utils/workflowPipelines';
```

- [ ] **Step 3: Render the pipeline**

At the top of the single-item detail view, where `item` is the `PunchItem` being shown:

```tsx
<StatusPipeline
  stages={stagesFor('punch')}
  current={visualStageFor('punch', item.status)}
  startedAt={item.createdAt}
  dueAt={item.dueDate || undefined}
  onAdvance={(next) => {
    updatePunchItem(item.projectId, item.id, {
      status: next as PunchItem['status'],
      updatedAt: new Date().toISOString(),
    });
  }}
/>
```

If `advanceTargetFor('punch', item.status)` is `null` the component renders no advance button on its own — `StatusPipeline` derives that from the `terminal` flag, so no extra guard is needed here.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no output. If `updatePunchItem`'s signature differs from the call above, fix the call to match the real signature — do not cast.

- [ ] **Step 5: Commit**

```bash
git add app/punch-list.tsx
git commit -m "feat(punch): visible lifecycle on a punch item"
```

---

### Task 5: CORRECT the permits pipeline — it is already wired, and wrong

> **This task changed after the plan was written.** `docs/workflow-audit-roadmap.md`
> lists permits as TODO. It is not — `app/permits.tsx` has been wired to
> `StatusPipeline` since before this work started, as exactly the flattened
> single line the spec argued against. This is a **correction of shipped UI that
> currently lies to the user**, not a new feature.

**Files:**
- Modify: `app/permits.tsx`

#### What is there now, and why it is wrong

`app/permits.tsx:163-168`:

```ts
const PERMIT_PIPELINE_STAGES: PipelineStage<PermitStatus>[] = [
  { key: 'applied', label: 'Applied' },
  { key: 'under_review', label: 'In Review' },
  { key: 'approved', label: 'Approved' },
  { key: 'inspection_passed', label: 'Inspected', terminal: true },
];

function mapPermitStatus(s: PermitStatus): PermitStatus {
  if (s === 'denied') return 'under_review';
  if (s === 'expired' || s === 'inspection_scheduled' || s === 'inspection_failed') return 'approved';
  return s;
}
```

Four of the eight real states are misrepresented, two of them dangerously:

| Real state | Currently displays as | Why it matters |
|---|---|---|
| `denied` | "In Review" | The application was refused; the UI says it's still pending |
| `expired` | **"Approved"** | An expired permit reads as a live one — work could proceed uninspected |
| `inspection_scheduled` | "Approved" | Loses the distinction entirely |
| `inspection_failed` | **"Approved"** | A FAILED inspection reads as approved |

The advance button (`app/permits.tsx:607-612`) also jumps `approved → inspection_passed`,
skipping `inspection_scheduled`, so an inspection cannot be scheduled through the
pipeline at all.

- [ ] **Step 1: Confirm the current state before changing it**

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
sed -n '163,175p' app/permits.tsx     # the stages + mapPermitStatus
sed -n '596,616p' app/permits.tsx     # the JSX usage
```

Confirm both match what is quoted above. If they have drifted, adapt — but do not
delete a state distinction to make the code simpler.

- [ ] **Step 2: Replace the local constant with the shared model**

Delete `PERMIT_PIPELINE_STAGES` and `mapPermitStatus` entirely (lines ~163-175),
and remove the now-unused `PipelineStage` type import if nothing else in the file
uses it. Add:

```ts
import { stagesFor, visualStageFor, isSideBranch } from '@/utils/workflowPipelines';
```

- [ ] **Step 3: Render the application path, then the inspection cycle**

Replace the single `<StatusPipeline>` block at `app/permits.tsx:598-614` with:

```tsx
{/* The application path. Ends at Approved — the permit is issued.
    Inspections are a SEPARATE cycle below, not a continuation: a permit does
    not pass through `denied` on its way to an inspection, and collapsing them
    onto one line is what made `expired` and `inspection_failed` both render
    as "Approved". */}
<StatusPipeline
  stages={stagesFor('permit')}
  current={visualStageFor('permit', form.status)}
  startedAt={form.appliedDate ? new Date(form.appliedDate).toISOString() : undefined}
  onAdvance={isSideBranch('permit', form.status) ? undefined : (next) => {
    setForm(f => ({ ...f, status: next as PermitStatus }));
  }}
  advanceLabel={
    form.status === 'applied' ? 'Move to review'
    : form.status === 'under_review' ? 'Mark approved'
    : undefined
  }
/>

{/* The second loop, shown once the permit is issued. inspection_failed is a
    side branch of THIS pipeline — a failed inspection gets rescheduled, so it
    anchors back at Scheduled rather than pretending to be Passed. */}
{(form.status === 'approved' || form.status.startsWith('inspection_')) && (
  <StatusPipeline
    stages={stagesFor('permitInspection')}
    current={visualStageFor('permitInspection', form.status)}
    dueAt={form.inspectionDate ? new Date(form.inspectionDate).toISOString() : undefined}
    onAdvance={isSideBranch('permitInspection', form.status) ? undefined : (next) => {
      setForm(f => ({ ...f, status: next as PermitStatus }));
    }}
    advanceLabel={
      form.status === 'approved' ? 'Schedule inspection'
      : form.status === 'inspection_scheduled' ? 'Mark inspection passed'
      : undefined
    }
  />
)}
```

Note the `approved` case now advances to `inspection_scheduled` (schedule it)
rather than leaping to `inspection_passed`.

- [ ] **Step 4: Verify no state is silently collapsed any more**

```bash
grep -n "mapPermitStatus" app/permits.tsx    # expect: no matches
npx tsc --noEmit
```

Expected: `mapPermitStatus` is gone, tsc silent. Then read the file and confirm
`denied`, `expired`, and `inspection_failed` are each still reachable through the
existing status picker further down the form — the point is that they stop being
*misdisplayed*, not that they stop being *settable*.

- [ ] **Step 5: Commit**

```bash
git add app/permits.tsx
git commit -m "fix(permits): stop showing denied, expired and failed inspections as Approved

The pipeline was one flattened line with a mapPermitStatus() that folded four
of the eight real states onto two visual ones — an expired permit and a FAILED
inspection both rendered as 'Approved', and a denied one as 'In Review'. It also
advanced approved -> inspection_passed, so an inspection could never be
scheduled through the pipeline.

Now two pipelines, from the shared model: the application path (applied ->
under_review -> approved, with denied/expired as side branches) and the
inspection cycle (scheduled -> passed, with failed as a side branch that
anchors back to scheduled for rescheduling)."
```

---

### Task 6: Wire lien waivers

`app/lien-waivers.tsx:175` already has a status-change handler using `saveLienWaiver({ ...w, id: w.id, status })` — reuse it.

**Files:**
- Modify: `app/lien-waivers.tsx`

- [ ] **Step 1: Read the existing status handler**

```bash
sed -n '165,190p' app/lien-waivers.tsx
```

- [ ] **Step 2: Add imports**

```ts
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor, isSideBranch } from '@/utils/workflowPipelines';
```

- [ ] **Step 3: Render the pipeline**

At the top of the waiver detail/row-expanded view, where `w` is the `LienWaiver` and `handleStatusChange` is the existing handler found in Step 1:

```tsx
<StatusPipeline
  stages={stagesFor('lienWaiver')}
  current={visualStageFor('lienWaiver', w.status)}
  startedAt={w.requestedAt}
  onAdvance={isSideBranch('lienWaiver', w.status) ? undefined : (next) => {
    handleStatusChange(w, next as LienWaiver['status']);
  }}
/>
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no output. Match `handleStatusChange`'s real name and signature from Step 1, and the real date field on `LienWaiver`.

- [ ] **Step 5: Commit**

```bash
git add app/lien-waivers.tsx
git commit -m "feat(lien-waivers): visible lifecycle on a waiver"
```

---

### Task 7: Wire selections, prequal, OAC, and bid package

Four screens, identical shape. Do them one at a time, type-checking and committing after each — not as one batch.

**Files:**
- Modify: `app/selections.tsx`, `app/prequal-manager.tsx`, `app/oac-meeting.tsx`, `app/buyout-package.tsx`

- [ ] **Step 1: Confirm each persistence call still exists**

```bash
grep -n "saveSelectionCategory" app/selections.tsx
grep -n "upsertPrequalPacket" app/prequal-manager.tsx
grep -n "updateOACMeeting" app/oac-meeting.tsx
grep -n "updateBidPackage\|awardBidPackage" app/buyout-package.tsx
```

All four were identified during design: `saveSelectionCategory`, `upsertPrequalPacket(updated)` (takes a whole packet — see `handleApprove` at `app/prequal-manager.tsx:136`), `ctx.updateOACMeeting?.(id, patch)`, and `updateBidPackage` / `awardBidPackage` (both destructured from the context at `app/buyout-package.tsx:69-71`). If any has been renamed, use the real name — do not cast.

- [ ] **Step 2: Wire each screen**

Same shape every time. Imports:

```ts
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor, isSideBranch } from '@/utils/workflowPipelines';
```

`app/selections.tsx`, where `cat` is the `SelectionCategory`:

```tsx
<StatusPipeline
  stages={stagesFor('selection')}
  current={visualStageFor('selection', cat.status)}
  onAdvance={isSideBranch('selection', cat.status) ? undefined : (next) => {
    saveSelectionCategory({ ...cat, status: next as SelectionCategory['status'] });
  }}
/>
```

`app/prequal-manager.tsx`, where `packet` is the `PrequalPacket`. `upsertPrequalPacket` takes a whole packet, matching `handleApprove` at line 136:

```tsx
<StatusPipeline
  stages={stagesFor('prequal')}
  current={visualStageFor('prequal', packet.status)}
  startedAt={packet.createdAt}
  dueAt={packet.expiresAt || undefined}
  onAdvance={isSideBranch('prequal', packet.status) ? undefined : (next) => {
    upsertPrequalPacket({
      ...packet,
      status: next as PrequalPacket['status'],
      updatedAt: new Date().toISOString(),
    });
  }}
/>
```

Note: advancing to `approved` this way does NOT run the auto-review findings or
compute `expiresAt` the way `handleApprove` does. So the pipeline must stop
short of it — pass `stagesFor('prequal').slice(0, -1)` is wrong (it would drop
the terminal flag), so instead suppress the advance at `submitted` and let the
existing Approve button own that transition:

```tsx
  onAdvance={
    isSideBranch('prequal', packet.status) || packet.status === 'submitted'
      ? undefined
      : (next) => { /* the upsert above */ }
  }
```

`app/oac-meeting.tsx`, where `active` is the meeting (note the existing optional-chained context call):

```tsx
<StatusPipeline
  stages={stagesFor('oac')}
  current={visualStageFor('oac', active.status)}
  startedAt={active.createdAt}
  onAdvance={(next) => {
    ctx.updateOACMeeting?.(active.id, {
      status: next as OACMeeting['status'],
      updatedAt: new Date().toISOString(),
    });
  }}
/>
```

`app/buyout-package.tsx`, where `pkg` is the `BidPackage`.

**Awarding is not a status write.** `types/index.ts:1993` documents the lifecycle
as *"open → leveling → awarded (creates a Commitment)"*, and the context exposes
`awardBidPackage` separately from `updateBidPackage` for exactly that reason —
awarding needs to know WHICH bid won. Writing `status: 'awarded'` directly would
mark the package awarded and silently create no Commitment.

So the pipeline advances `open → leveling` only, and hands `leveling → awarded`
back to the existing award flow:

```tsx
<StatusPipeline
  stages={stagesFor('bidPackage')}
  current={visualStageFor('bidPackage', pkg.status)}
  startedAt={pkg.createdAt}
  dueAt={pkg.dueDate || undefined}
  advanceLabel="Start leveling"
  onAdvance={
    // Only the open -> leveling step is a plain status change. Awarding runs
    // through awardBidPackage (it creates the Commitment), which needs a
    // winning bid — so the pipeline stops offering "Advance" at leveling and
    // the existing Award action owns that transition.
    pkg.status === 'open'
      ? (next) => {
          updateBidPackage(pkg.id, { status: next as BidPackage['status'] });
        }
      : undefined
  }
/>
```

- [ ] **Step 3: Type-check after each screen**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit after each screen**

```bash
git add app/selections.tsx && git commit -m "feat(selections): visible lifecycle per selection category"
git add app/prequal-manager.tsx && git commit -m "feat(prequal): visible lifecycle on a prequal packet"
git add app/oac-meeting.tsx && git commit -m "feat(oac): visible lifecycle on a meeting"
git add app/buyout-package.tsx && git commit -m "feat(buyout): visible lifecycle on a bid package"
```

---

### Task 8: Derived badges on COI vault and warranties

No pipeline, no advance button — a status chip.

**Files:**
- Modify: `app/coi-vault.tsx`, `app/warranties.tsx`

- [ ] **Step 1: Locate the row renderers**

```bash
grep -n "CertificateOfInsurance\|coverages" app/coi-vault.tsx | head
grep -n "WarrantyStatus\|endDate" app/warranties.tsx | head
```

- [ ] **Step 2: Add the import to both**

```ts
import { coiStatus, warrantyStatus, type DerivedStatus } from '@/utils/workflowPipelines';
```

- [ ] **Step 3: Render the badge**

In `app/coi-vault.tsx`, in the certificate row, where `coi` is the certificate:

```tsx
{(() => {
  const d = coiStatus(coi, Date.now());
  return (
    <View style={[styles.derivedBadge, { backgroundColor: toneBg(d.tone, themeColors) }]}>
      <Text style={[styles.derivedBadgeText, { color: toneFg(d.tone, themeColors) }]}>
        {d.label}
      </Text>
    </View>
  );
})()}
```

In `app/warranties.tsx`, same shape with `warrantyStatus(w, Date.now())`.

Add these two helpers near the top of each file (they map a tone to the theme's existing semantic colors — no hex literals, per the repo lint rule):

```ts
function toneBg(tone: DerivedStatus['tone'], c: ThemeColors): string {
  if (tone === 'bad') return c.errorSurface ?? c.surfaceAlt;
  if (tone === 'warn') return c.warningSurface ?? c.surfaceAlt;
  if (tone === 'good') return c.successSurface ?? c.surfaceAlt;
  return c.surfaceAlt;
}
function toneFg(tone: DerivedStatus['tone'], c: ThemeColors): string {
  if (tone === 'bad') return c.error;
  if (tone === 'warn') return c.warning;
  if (tone === 'good') return c.success;
  return c.textMuted;
}
```

Confirm the real token names first:

```bash
grep -n "errorSurface\|warningSurface\|successSurface\|  error:\|  warning:\|  success:" constants/colors.ts | head
```

If a `*Surface` token doesn't exist, use `c.surfaceAlt` for all four backgrounds rather than inventing a token.

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npx eslint app/coi-vault.tsx app/warranties.tsx
```

Expected: `tsc` silent; eslint reports 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/coi-vault.tsx app/warranties.tsx
git commit -m "feat(coi,warranties): derived status badge instead of a false advance action"
```

---

### Task 9: Pin the screen wiring and verify everything

**Files:**
- Modify: `scripts/validate-workflow-pipelines.ts`

- [ ] **Step 1: Add the source-level assertions**

Append before the final `console.log`:

```ts
// Source-level, matching this repo's convention: a screen must not silently
// drop the wiring. Grep-level only — it proves the call exists, not that it
// renders, which is the known limit of having no runtime harness.
console.log('\nscreens consume the model:');
const WIRED: { file: string; kind: string }[] = [
  { file: 'app/punch-list.tsx', kind: 'punch' },
  { file: 'app/permits.tsx', kind: 'permit' },
  { file: 'app/lien-waivers.tsx', kind: 'lienWaiver' },
  { file: 'app/selections.tsx', kind: 'selection' },
  { file: 'app/prequal-manager.tsx', kind: 'prequal' },
  { file: 'app/oac-meeting.tsx', kind: 'oac' },
  { file: 'app/buyout-package.tsx', kind: 'bidPackage' },
];
for (const { file, kind } of WIRED) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  ok(`${file} renders the ${kind} pipeline`,
    src.includes(`stagesFor('${kind}')`) && /<StatusPipeline/.test(src));
  ok(`${file} anchors side branches through visualStageFor`,
    src.includes(`visualStageFor('${kind}'`));
}
ok('app/permits.tsx also renders the inspection cycle',
  readFileSync(join(ROOT, 'app/permits.tsx'), 'utf8').includes("stagesFor('permitInspection')"));
for (const [file, fn] of [['app/coi-vault.tsx', 'coiStatus'], ['app/warranties.tsx', 'warrantyStatus']]) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  ok(`${file} uses ${fn} and offers no advance action`,
    src.includes(`${fn}(`) && !/<StatusPipeline/.test(src));
}
```

- [ ] **Step 2: Run the new validator**

```bash
bun run scripts/validate-workflow-pipelines.ts
```

Expected: `0 failed`.

- [ ] **Step 3: Run the whole suite**

```bash
npx tsc --noEmit
failed=0; for f in scripts/validate-*.ts; do bun run "$f" >/dev/null 2>&1 || { echo "NONZERO: $f"; failed=$((failed+1)); }; done; echo "$failed failing"
bun run lint 2>&1 | tail -2
```

Expected: `tsc` silent, `0 failing`, eslint `0 errors`.

- [ ] **Step 4: Update the roadmap**

In `docs/workflow-audit-roadmap.md`, change the `TODO` in the Tier 1 table to `shipped` for: punch list, permits, COI vault, prequal, warranties, OAC meetings, selections, lien waivers, and the buyout/bid rows. Leave AIA pay apps and closeout binder as `TODO` and add a note under each:

```markdown
> Deferred from the 2026-08-13 workflow-pipelines work: `SavedAIAPayApp` has no
> status field and no `CloseoutBinder` interface exists. Both need a data model
> before a pipeline means anything. See
> docs/superpowers/specs/2026-08-13-workflow-pipelines-design.md.
```

Also correct the four wrong sequences in the "Should be wired next" list so the doc stops proposing states that do not exist.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-workflow-pipelines.ts docs/workflow-audit-roadmap.md
git commit -m "test(workflows): pin screen wiring; correct the roadmap's invented states"
```

---

## Done when

1. All seven pipeline workflows show a lifecycle breadcrumb and advance in one tap.
2. COI and warranties show a derived status and no advance affordance.
3. Permits show the application path and the inspection cycle as separate pipelines.
4. The exhaustiveness guard passes, and fails when a state is added unclassified (proved in Task 3 Step 3).
5. `tsc --noEmit` clean, every validator passes, `bun run lint` reports 0 errors.
