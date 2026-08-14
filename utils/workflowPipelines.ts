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
  // Application path only. Ends at approved — the permit is issued. The labels
  // are the ones app/permits.tsx already renders; changing user-visible text is
  // not this module's job.
  permit: [
    { key: 'applied', label: 'Applied' },
    { key: 'under_review', label: 'In Review' },
    { key: 'approved', label: 'Approved', terminal: true },
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

// Both return copies. The arrays are module-level and live for the whole
// process, so handing out the original lets one caller's `.push()` corrupt the
// model for everyone — including the exhaustiveness guard, which would then
// cheerfully report invented states as legitimate.
export function stagesFor(kind: WorkflowKind): WorkflowStage[] {
  return PIPELINES[kind].slice();
}

export function sideBranchesFor(kind: WorkflowKind): string[] {
  return SIDE_BRANCHES[kind].slice();
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

/**
 * Whole days remaining, rounded UP — `Math.ceil`, not `Math.floor`.
 *
 * This is not a taste call. `app/warranties.tsx:62` and
 * `contexts/ProjectContext.tsx:4082` already compute a warranty's remaining
 * days with `Math.ceil`, and the warranty screen renders BOTH that number and
 * (once wired) the status derived here. Rounding down would put them one day
 * apart for any partial day: a warranty with 30.4 days left would read
 * "Expiring soon" in the breadcrumb and "Active" in the summary card beside
 * it, on the same screen, for the same warranty.
 *
 * Callers must check `end < now` for expiry BEFORE calling this. Ceil alone
 * cannot decide expiry — something that lapsed 12 hours ago gives
 * `ceil(-0.5) === -0`, which is not negative, so it would read "expires in 0d"
 * instead of expired. ProjectContext orders it the same way.
 */
function daysLeft(end: number, now: number): number {
  return Math.ceil((end - now) / DAY_MS);
}

export type DerivedTone = 'neutral' | 'good' | 'warn' | 'bad';

/**
 * NOTE the two different "expiring" keys: `coiStatus` returns `'expiring'`,
 * `warrantyStatus` returns `'expiring_soon'` (matching the warranty union's own
 * spelling in types/index.ts). A consumer testing `key === 'expiring'` will
 * silently miss every warranty. Branch on `tone` when you want "is this a
 * warning", and on `key` only when you know which function produced it.
 */
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
  const earliest = Math.min(...stamps);
  // Expiry is decided by the INSTANT, not the day count — see daysLeft below.
  if (earliest < now) return { key: 'expired', label: 'Expired', tone: 'bad' };
  const days = daysLeft(earliest, now);
  if (days <= DEFAULT_EXPIRY_WINDOW_DAYS) {
    return { key: 'expiring', label: `Expires in ${days}d`, tone: 'warn' };
  }
  return { key: 'active', label: 'Active', tone: 'good' };
}

/**
 * Void first (an explicit decision outranks the calendar), then an open claim,
 * then the dates. The warning window is the warranty's OWN `reminderDays` when
 * set — a GC who asked for 90 days' notice should be warned at 90, not 30.
 *
 * Pass the WHOLE Warranty. `claims` is optional here only so the parameter type
 * stays structural (this module imports nothing), but a partial object without
 * it silently skips the `claimed` branch and reports a date-derived status for
 * a warranty that is actually under claim.
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
  // Same order as contexts/ProjectContext.tsx's warranty rollup: the instant
  // decides expiry, THEN the rounded day count decides the warning window.
  if (end < now) return { key: 'expired', label: 'Expired', tone: 'bad' };
  const days = daysLeft(end, now);
  const windowDays = Number.isFinite(w.reminderDays) && (w.reminderDays as number) > 0
    ? (w.reminderDays as number)
    : DEFAULT_EXPIRY_WINDOW_DAYS;
  if (days <= windowDays) {
    return { key: 'expiring_soon', label: `Expires in ${days}d`, tone: 'warn' };
  }
  return { key: 'active', label: 'Active', tone: 'good' };
}
