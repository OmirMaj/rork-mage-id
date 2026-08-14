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
