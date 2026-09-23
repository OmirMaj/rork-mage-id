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

// Pipelines that only BEGIN once another pipeline has finished. A permit's
// inspection cycle starts where the application path ends (`approved`), and
// app/permits.tsx renders both on the same sheet from one status field — so
// each pipeline is routinely handed a status belonging to the other.
//
// This map is what tells us WHICH END an unrecognized status sits past, and
// that is the whole fix. `inspection_scheduled` is past the END of `permit`
// (the permit was applied for, reviewed and approved to get there), while
// `approved` is before the START of `permitInspection` (no inspection has
// happened yet). Guessing without this direction is how the bug happened:
// anchoring everything unrecognized at the FIRST stage draws a permit under
// inspection as never filed, and anchoring everything at the TERMINAL stage
// draws an approved permit as already inspected. Both are lies, in opposite
// directions, so neither blanket rule is available.
const CONTINUES_FROM: Partial<Record<WorkflowKind, WorkflowKind>> = {
  permitInspection: 'permit',
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

/** True when the status is a stage OR a declared side branch of this kind. */
function belongsTo(kind: WorkflowKind, status: string): boolean {
  return PIPELINES[kind].some(s => s.key === status) || SIDE_BRANCHES[kind].includes(status);
}

/**
 * Where a status sits RELATIVE TO THE PIPELINE BEING RENDERED — which is a
 * different question from "is this status classified", and the difference is
 * the bug. `inspection_scheduled` is perfectly classified (a stage of
 * `permitInspection`) and still had no position at all in `permit`, so the
 * permit application breadcrumb resolved to index -1 and drew three empty dots
 * for a permit that had been approved for two months.
 *
 * Every screen renders a pipeline, and every status it can hand that pipeline
 * must land in one of these five buckets. `unknown` is the failure case: the
 * model does not claim the status, so nothing can be drawn honestly and the
 * screen must not be showing it. scripts/validate-workflow-pipelines.ts asserts
 * no screen can produce one.
 */
export type PipelinePosition =
  /** The status IS one of this pipeline's steps. */
  | 'stage'
  /** A declared off-path state of THIS pipeline (denied, voided, expired…). */
  | 'side_branch'
  /** Belongs to the pipeline this one continues from — this one has not begun. */
  | 'not_started'
  /** Belongs to a pipeline that continues from this one — this one is finished. */
  | 'completed'
  /** Nothing in the model claims it. */
  | 'unknown';

export function pipelinePositionFor(kind: WorkflowKind, status: string): PipelinePosition {
  if (PIPELINES[kind].some(s => s.key === status)) return 'stage';
  if (SIDE_BRANCHES[kind].includes(status)) return 'side_branch';
  const from = CONTINUES_FROM[kind];
  if (from && belongsTo(from, status)) return 'not_started';
  for (const k of WORKFLOW_KINDS) {
    if (CONTINUES_FROM[k] === kind && belongsTo(k, status)) return 'completed';
  }
  return 'unknown';
}

/**
 * The next stage, or null when there isn't one — at a terminal stage, on a side
 * branch, past the end of the pipeline, or for a status this kind doesn't
 * recognize. Returning null rather than guessing is what keeps "Advance" from
 * appearing on a denied permit.
 *
 * The one status that is NOT on the pipeline and still advances is the
 * predecessor's terminal stage: an `approved` permit's next step on the
 * inspection cycle is to schedule it. That is the "Schedule inspection" button,
 * and it never appeared because the old lookup treated "hasn't started" and
 * "not a real status" as the same thing. A permit still `under_review` gets
 * nothing — the application path has to finish first.
 */
export function advanceTargetFor(kind: WorkflowKind, current: string): string | null {
  const stages = PIPELINES[kind];
  switch (pipelinePositionFor(kind, current)) {
    case 'stage': {
      const i = stages.findIndex(s => s.key === current);
      return stages[i].terminal ? null : (stages[i + 1]?.key ?? null);
    }
    case 'not_started': {
      const from = CONTINUES_FROM[kind];
      const previous = from ? PIPELINES[from] : null;
      const previousIsDone = !!previous && previous[previous.length - 1].key === current;
      return previousIsDone ? stages[0].key : null;
    }
    default:
      return null;
  }
}

/**
 * Which stage the breadcrumb should highlight.
 *
 * - `stage` → itself.
 * - `side_branch` → the FIRST stage, with the screen rendering a side-branch
 *   badge alongside: the badge carries the meaning, the breadcrumb just stays
 *   rendered instead of collapsing. (Same approach app/rfi.tsx already takes
 *   with `current={status === 'void' ? 'open' : status}`.)
 * - `completed` → the TERMINAL stage. A permit sitting in `inspection_failed`
 *   necessarily completed the application path to get there, so the application
 *   breadcrumb reads Applied ✓ In Review ✓ Approved, which is the truth. This
 *   used to return the status unchanged, land at index -1, and draw three empty
 *   grey dots next to "61d in pipeline" — a permit that was approved two months
 *   ago, drawn as one that was never filed.
 * - `not_started` / `unknown` → returned unchanged, so no dot highlights. For a
 *   pipeline that has not begun, every empty dot IS the honest picture: an
 *   approved permit has reached no inspection stage. The way IN is
 *   `advanceTargetFor`, not a filled dot — filling one here would claim the
 *   inspection is already scheduled.
 */
export function visualStageFor(kind: WorkflowKind, status: string): string {
  const stages = PIPELINES[kind];
  switch (pipelinePositionFor(kind, status)) {
    case 'stage': return status;
    case 'side_branch': return stages[0].key;
    case 'completed': return stages[stages.length - 1].key;
    default: return status;
  }
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
 * Whole days remaining for an INSTANT, rounded UP — `Math.ceil`, not
 * `Math.floor`.
 *
 * Only a full ISO timestamp reaches this now (see readEnd below). A rounded-
 * down count would put the breadcrumb and a summary card beside it one day
 * apart for any partial day: a warranty with 30.4 days left would read
 * "Expiring soon" in one and "Active" in the other.
 *
 * Callers must check `end < now` for expiry BEFORE calling this. Ceil alone
 * cannot decide expiry — something that lapsed 12 hours ago gives
 * `ceil(-0.5) === -0`, which is not negative, so it would read "expires in 0d"
 * instead of expired.
 */
function daysLeft(end: number, now: number): number {
  return Math.ceil((end - now) / DAY_MS);
}

// ── Calendar-day ends (#135) ───────────────────────────────────────────────
//
// A warranty's end_date and a COI coverage's expiry are CALENDAR DAYS — bare
// 'YYYY-MM-DD' out of a Postgres `date` column (app/warranties.tsx stores
// addCalendarMonths(start, months)). `Date.parse` reads a bare day as UTC
// MIDNIGHT, which is 8 pm the evening BEFORE in New York: a warranty ending
// Sep 22 read "Expired" from 8 pm on the 21st and all through the 22nd, its
// last covered day — the day a homeowner calls with a valid claim. The end
// date itself is covered, so a bare day expires only once LOCAL today is past
// it, and the days left are whole local calendar days (Math.round across the
// two local midnights, so a 23- or 25-hour DST day cannot add or drop one).
//
// Parsed inline rather than through utils/calendarDate: this module imports
// nothing (see the header — bun has to be able to load it bare), so the regex
// and the rolled-over-date check are repeated here on purpose. A full ISO
// timestamp keeps the instant logic it always had.
const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

type EndRead =
  | { kind: 'none' }
  | { kind: 'day'; end: Date }
  | { kind: 'instant'; end: number };

function readEnd(value: unknown): EndRead {
  if (typeof value !== 'string') return { kind: 'none' };
  const v = value.trim();
  const m = BARE_DAY.exec(v);
  if (m) {
    const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
    const end = new Date(y, mo - 1, d);
    // new Date(2026, 1, 30) is a real Date in March — a rolled-over day is
    // not the day that was written, so it reads as no date at all.
    if (end.getFullYear() !== y || end.getMonth() !== mo - 1 || end.getDate() !== d) return { kind: 'none' };
    return { kind: 'day', end };
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? { kind: 'none' } : { kind: 'instant', end: t };
}

/** Expired, and whole days left (0 = the last covered day, for a bare day). */
function remainingOf(r: Exclude<EndRead, { kind: 'none' }>, now: number): { expired: boolean; days: number } {
  if (r.kind === 'instant') {
    // Expiry is decided by the INSTANT, not the day count — see daysLeft.
    return r.end < now ? { expired: true, days: -1 } : { expired: false, days: daysLeft(r.end, now) };
  }
  const n = new Date(now);
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const days = Math.round((r.end.getTime() - today.getTime()) / DAY_MS);
  return { expired: days < 0, days };
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Sep 22, 2026' — the LOCAL day an end names (no Intl: this module is bare). */
function endDayLabel(r: Exclude<EndRead, { kind: 'none' }>): string {
  const d = r.kind === 'day' ? r.end : new Date(r.end);
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Expires today" on the last day — "Expires in 0d" is not a sentence. */
function expiresLabel(days: number): string {
  return days <= 0 ? 'Expires today' : `Expires in ${days}d`;
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
 * expiry across coverages decides. No parseable expiry reads 'unknown' —
 * never 'active', because "we have no idea" must not look like "you're covered".
 *
 * A bare 'YYYY-MM-DD' expiry is a calendar day and covers that whole local day
 * (#135 — the same UTC-midnight bug as warrantyStatus); an ISO timestamp keeps
 * its instant.
 */
export function coiStatus(
  coi: { coverages?: { expiresAt?: string }[] },
  now: number,
): DerivedStatus {
  const ends = (coi.coverages ?? [])
    .map(c => readEnd(c.expiresAt))
    .filter((r): r is Exclude<EndRead, { kind: 'none' }> => r.kind !== 'none')
    .map(r => remainingOf(r, now));

  if (ends.length === 0) {
    return { key: 'unknown', label: 'No expiry on file', tone: 'neutral' };
  }
  if (ends.some(e => e.expired)) return { key: 'expired', label: 'Expired', tone: 'bad' };
  const days = Math.min(...ends.map(e => e.days));
  if (days <= DEFAULT_EXPIRY_WINDOW_DAYS) {
    return { key: 'expiring', label: expiresLabel(days), tone: 'warn' };
  }
  return { key: 'active', label: 'Active', tone: 'good' };
}

/**
 * Void first (an explicit decision outranks the calendar), then an OPEN claim,
 * then the dates. The warning window is the warranty's OWN `reminderDays` when
 * set — a GC who asked for 90 days' notice should be warned at 90, not 30.
 *
 * #144: only a claim WITHOUT `resolvedAt` is open. Keyed on `claims.length`,
 * one logged claim pinned the warranty to "Claim open" forever — after the fix,
 * after the warranty ended — and nothing could mark it resolved. Once every
 * claim is resolved the warranty is graded on its dates again. An unresolved
 * claim still outranks expiry, though: a claim filed inside the term is still
 * owed after the end date, so it reads "Claim open · warranty ended <date>"
 * (still a warning) rather than hiding behind "Expired".
 *
 * Pass the WHOLE Warranty. `claims` is optional here only so the parameter type
 * stays structural (this module imports nothing), but a partial object without
 * it silently skips the `claimed` branch and reports a date-derived status for
 * a warranty that is actually under claim.
 */
export function warrantyStatus(
  w: {
    status?: string;
    endDate?: string;
    reminderDays?: number;
    claims?: readonly { id?: string; resolvedAt?: string | null }[];
  },
  now: number,
): DerivedStatus {
  if (w.status === 'void') return { key: 'void', label: 'Void', tone: 'neutral' };
  const end = readEnd(w.endDate);
  const left = end.kind === 'none' ? null : remainingOf(end, now);
  const openClaims = (w.claims ?? []).filter(c => !(typeof c?.resolvedAt === 'string' && c.resolvedAt.trim() !== ''));
  if (openClaims.length > 0) {
    return {
      key: 'claimed',
      label: left?.expired && end.kind !== 'none' ? `Claim open · warranty ended ${endDayLabel(end)}` : 'Claim open',
      tone: 'warn',
    };
  }
  if (!left) {
    return { key: 'unknown', label: 'No end date', tone: 'neutral' };
  }
  if (left.expired) return { key: 'expired', label: 'Expired', tone: 'bad' };
  const windowDays = Number.isFinite(w.reminderDays) && (w.reminderDays as number) > 0
    ? (w.reminderDays as number)
    : DEFAULT_EXPIRY_WINDOW_DAYS;
  if (left.days <= windowDays) {
    return { key: 'expiring_soon', label: expiresLabel(left.days), tone: 'warn' };
  }
  return { key: 'active', label: 'Active', tone: 'good' };
}
