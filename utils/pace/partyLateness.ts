// utils/pace/partyLateness.ts — which subs run long, learned from the GC's own
// finished work, and the extra days that evidence supports on a new task.
//
// The pace book (./paceBook.ts) learns how long a TRADE takes this GC. This
// learns how far a named SUBCONTRACTOR runs past the plan they were given, so
// the schedule can OFFER (never apply) a few extra days on that sub's next
// task, with the evidence stated: "ran a median 2 working days over plan on
// your last 4 jobs". Below LATE_MIN_JOBS it says "not enough history yet" and
// offers nothing.
//
// WHAT IS MEASURED. One sample per finished task assigned to the sub, with the
// SAME eligibility as utils/subScorecard.ts collectSubTasks (and the pace
// book): status done, both as-built day stamps, not a milestone, a positive
// planned duration, not inverted. Overrun = the as-built span in WORKING days
// (actualWorkingDays, through that schedule's own calendar) minus the planned
// working days, max(1, round(durationDays)). That is the sub's own work.
// Finish-vs-baseline is NOT used: predecessor slips flow into it, and
// baselineEndDay is a working ordinal while the as-builts are calendar indices.
//
// WHAT IS NOT MEASURED, and why (said here so nobody "adds" it later):
//   • Daily-log delays: DailyFieldReport.issuesAndDelays is free text with no
//     party on it. It cannot be attributed to a sub.
//   • Time entries: TimeEntry.workerId is the GC's own crew, not a sub.
//   • Suppliers: a Delivery has a free-text supplier and no task link, so there
//     is no task to pad. Suppliers get an advisory line only
//     (supplierAdvisoryFor, below), built from utils/supplierScorecard.
//
// ATTRIBUTION never guesses: a task's assignedSubId counts when it IS a
// Subcontractor id, or when it is a legacy Contact id whose company name
// matches exactly ONE Subcontractor's company name (trimmed, lowercased).
// Anything else is dropped.
//
// EXCUSED: a task listed on a logged DelayEvent of the same project whose cause
// was not the sub's doing (weather, owner change, late RFI answer, differing
// site condition, owner-supplied item, permit/inspection, design revision) is
// left out and counted, so the screen can say "N tasks left out".
//
// NO DOUBLE COUNT: the schedule generator already grounds durations in the
// trade pace. When the pace book has a usable entry for the task's trade, the
// pad is only the RESIDUAL beyond the trade's usual overrun. If the sub is the
// only framer, the trade pace already holds their lateness and the pad is ~0.
//
// Pure: no React, React Native, storage, network or clock.
import type {
  Contact, DelayCause, DelayEvent, Project, ScheduleTask, Subcontractor,
} from '@/types';
import { actualWorkingDays, type PaceBookEntry } from '@/utils/pace/paceBook';

/** Finished jobs needed before a sub's track record is used (founder Q1). */
export const LATE_MIN_JOBS = 3;
/** Most recent jobs considered. */
export const LATE_WINDOW_JOBS = 6;
/** Largest pad, as a share of the task's planned length (founder Q3). */
export const LATE_PAD_CAP_RATIO = 0.5;

/** Logged delay causes that stop a task counting against the sub (founder Q2):
 *  everything except "contractor caused" and "other". */
export const EXCUSED_CAUSES: ReadonlySet<DelayCause> = new Set<DelayCause>([
  'weather',
  'owner_directed_change',
  'late_rfi_response',
  'differing_site_condition',
  'owner_supplied_item',
  'permit_or_inspection',
  'design_revision',
]);

export interface LatenessJob {
  projectId: string;
  projectName: string;
  /** Median overrun (working days) of this sub's tasks on this project. */
  medianOverrunDays: number;
  tasks: number;
  /** Latest actualEndDate among those tasks; null when none carried one. */
  lastFinishISO: string | null;
}

export interface PartyLateness {
  subId: string;
  subName: string;
  status: 'learned' | 'on_plan' | 'not_enough_history';
  /** Jobs inside the recency window (≤ LATE_WINDOW_JOBS). */
  jobsMeasured: number;
  /** Tasks across those jobs. */
  tasksMeasured: number;
  /** Eligible tasks left out because a logged, excused delay names them. */
  excusedTasks: number;
  /** Working days, median of the per-job medians. Null below LATE_MIN_JOBS. */
  medianOverrunDays: number | null;
  /** Per-task overruns inside the window (for the residual and the record). */
  overrunSamples: number[];
  /** Newest first, ≤ LATE_WINDOW_JOBS. */
  jobs: LatenessJob[];
  /** The ids that attribute to this sub: its own id plus any legacy Contact id
   *  that maps to it unambiguously. latenessPadFor resolves a task through it. */
  attributedIds: string[];
}

/** Provenance stored on a padded task (ScheduleTask.latenessPad). */
export interface LatenessPadRecord {
  subId: string;
  days: number;
  jobs: number;
  medianOverrunDays: number;
  residualOfPace: boolean;
}

/** A ScheduleTask that may carry the pad provenance. Written as an
 *  intersection so this module compiles before and after the field lands on
 *  ScheduleTask in types/index.ts. */
export type TaskWithLatenessPad = ScheduleTask & { latenessPad?: LatenessPadRecord };

export interface LatenessPadSuggestion {
  padDays: number;
  /** True when the trade pace was subtracted (the pad is only the residual). */
  residualOfPace: boolean;
  medianOverrunDays: number;
  jobs: number;
  /** The trade whose usual pace was subtracted, when residualOfPace. */
  paceTrade: string | null;
}

// ── helpers ───────────────────────────────────────────────────────────────

/** Median; an even count takes the mean of the middle two. Empty → 0. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const normName = (s: string | undefined | null): string => (s ?? '').trim().toLowerCase();

/** assignedSubId → Subcontractor id, or null (dropped). Never guesses. */
export function buildSubResolver(
  subcontractors: Subcontractor[],
  contacts: Contact[] = [],
): (assignedSubId: string | undefined | null) => string | null {
  const subIds = new Set((subcontractors ?? []).map(s => s.id));
  const byName = new Map<string, string[]>();
  for (const s of subcontractors ?? []) {
    const k = normName(s.companyName);
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), s.id]);
  }
  const contactToSub = new Map<string, string>();
  for (const c of contacts ?? []) {
    if (!c?.id || subIds.has(c.id)) continue;
    const matches = byName.get(normName(c.companyName));
    if (matches && matches.length === 1) contactToSub.set(c.id, matches[0]);
  }
  return (id) => {
    if (!id) return null;
    if (subIds.has(id)) return id;
    return contactToSub.get(id) ?? null;
  };
}

// ── the engine ────────────────────────────────────────────────────────────

export function buildPartyLateness(input: {
  projects: Project[];
  subcontractors: Subcontractor[];
  contacts?: Contact[];
  delayEvents?: DelayEvent[];
}): Map<string, PartyLateness> {
  const { projects, subcontractors, contacts = [], delayEvents = [] } = input;
  const resolve = buildSubResolver(subcontractors, contacts);

  const excused = new Set<string>();
  for (const ev of delayEvents ?? []) {
    if (!ev || !EXCUSED_CAUSES.has(ev.cause)) continue;
    for (const taskId of ev.impactedTaskIds ?? []) excused.add(`${ev.projectId}|${taskId}`);
  }

  // subId → projectId → { overruns, lastFinish }
  type JobAcc = { projectName: string; overruns: number[]; last: string | null };
  const bySub = new Map<string, Map<string, JobAcc>>();
  const excusedBySub = new Map<string, number>();
  const aliases = new Map<string, Set<string>>();

  for (const project of projects ?? []) {
    const schedule = project?.schedule;
    if (!schedule?.tasks?.length) continue;
    const startDate = schedule.startDate;
    const workingDaysPerWeek = schedule.workingDaysPerWeek ?? 7;
    const closures = new Set(schedule.nonWorkingDates ?? []);
    for (const task of schedule.tasks) {
      if (!task?.assignedSubId) continue;
      const subId = resolve(task.assignedSubId);
      if (!subId) continue;
      if (task.assignedSubId !== subId) {
        const set = aliases.get(subId) ?? new Set<string>();
        set.add(task.assignedSubId);
        aliases.set(subId, set);
      }
      // Eligibility: identical to utils/subScorecard.ts collectSubTasks.
      if (task.isMilestone || !(task.durationDays > 0)) continue;
      if (task.status !== 'done') continue;
      if (typeof task.actualStartDay !== 'number' || typeof task.actualEndDay !== 'number') continue;
      if (task.actualEndDay < task.actualStartDay) continue;
      if (excused.has(`${project.id}|${task.id}`)) {
        excusedBySub.set(subId, (excusedBySub.get(subId) ?? 0) + 1);
        continue;
      }
      const planned = Math.max(1, Math.round(task.durationDays));
      const actual = actualWorkingDays(task.actualStartDay, task.actualEndDay, workingDaysPerWeek, startDate, closures);
      const jobs = bySub.get(subId) ?? new Map<string, JobAcc>();
      const acc = jobs.get(project.id) ?? { projectName: project.name, overruns: [], last: null };
      acc.overruns.push(actual - planned);
      const end = task.actualEndDate ?? null;
      if (end && (acc.last === null || end > acc.last)) acc.last = end;
      jobs.set(project.id, acc);
      bySub.set(subId, jobs);
    }
  }

  const out = new Map<string, PartyLateness>();
  for (const sub of subcontractors ?? []) {
    const jobsMap = bySub.get(sub.id) ?? new Map<string, JobAcc>();
    const all: (LatenessJob & { overruns: number[] })[] = [...jobsMap.entries()].map(([projectId, acc]) => ({
      projectId,
      projectName: acc.projectName,
      medianOverrunDays: median(acc.overruns),
      tasks: acc.overruns.length,
      lastFinishISO: acc.last,
      overruns: acc.overruns,
    }));
    // Newest first by last finish; undated jobs sort oldest. Ties keep a
    // stable order by project id so the window never flickers.
    all.sort((a, b) => {
      if (a.lastFinishISO && b.lastFinishISO) {
        if (a.lastFinishISO !== b.lastFinishISO) return a.lastFinishISO > b.lastFinishISO ? -1 : 1;
      } else if (a.lastFinishISO) return -1;
      else if (b.lastFinishISO) return 1;
      return a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0;
    });
    const kept = all.slice(0, LATE_WINDOW_JOBS);
    const overrunSamples = kept.flatMap(j => j.overruns);
    const jobsMeasured = kept.length;
    let status: PartyLateness['status'] = 'not_enough_history';
    let medianOverrunDays: number | null = null;
    if (jobsMeasured >= LATE_MIN_JOBS) {
      medianOverrunDays = median(kept.map(j => j.medianOverrunDays));
      status = medianOverrunDays >= 1 ? 'learned' : 'on_plan';
    }
    out.set(sub.id, {
      subId: sub.id,
      subName: sub.companyName,
      status,
      jobsMeasured,
      tasksMeasured: overrunSamples.length,
      excusedTasks: excusedBySub.get(sub.id) ?? 0,
      medianOverrunDays,
      overrunSamples,
      jobs: kept.map(({ overruns: _o, ...j }) => j),
      attributedIds: [sub.id, ...[...(aliases.get(sub.id) ?? [])].sort()],
    });
  }
  return out;
}

/** The task's stored pad, if any. */
export function readLatenessPad(task: ScheduleTask | null | undefined): LatenessPadRecord | undefined {
  return (task as TaskWithLatenessPad | null | undefined)?.latenessPad;
}

/**
 * The pad to OFFER on one task, or null to stay silent. See the header for the
 * rules; the residual subtracts the trade's median overrun whenever the pace
 * book has a usable entry (medium+ confidence, not the 'general' fallback),
 * because the generator already grounded the duration in that pace.
 */
export function latenessPadFor(
  entry: PartyLateness | undefined,
  task: ScheduleTask,
  opts: { paceEntry: PaceBookEntry | null; offSubIds: ReadonlySet<string> },
): LatenessPadSuggestion | null {
  if (!entry || entry.status !== 'learned' || entry.medianOverrunDays === null) return null;
  if (opts.offSubIds.has(entry.subId)) return null;
  if (task.isMilestone || task.isSummary || task.isLevelOfEffort || !(task.durationDays > 0)) return null;
  if (!task.assignedSubId || !entry.attributedIds.includes(task.assignedSubId)) return null;
  if (readLatenessPad(task)) return null; // never re-offer on a padded task

  const subMedian = entry.medianOverrunDays;
  const pace = opts.paceEntry;
  let padDays: number;
  let residualOfPace = false;
  let paceTrade: string | null = null;
  if (pace && pace.confidence !== 'low' && pace.trade !== 'general') {
    const tradeMedian = median(pace.samples.map(s => s.actualDays - s.plannedDays));
    padDays = Math.round(subMedian - tradeMedian);
    residualOfPace = true;
    paceTrade = pace.trade;
  } else {
    padDays = Math.round(subMedian);
  }
  padDays = Math.min(padDays, Math.max(1, Math.ceil(task.durationDays * LATE_PAD_CAP_RATIO)));
  if (padDays < 1) return null;
  return { padDays, residualOfPace, medianOverrunDays: subMedian, jobs: entry.jobsMeasured, paceTrade };
}

/** The stored record for an accepted suggestion. */
export function padRecordFor(subId: string, s: LatenessPadSuggestion): LatenessPadRecord {
  return {
    subId,
    days: s.padDays,
    jobs: s.jobs,
    medianOverrunDays: s.medianOverrunDays,
    residualOfPace: s.residualOfPace,
  };
}

/** Apply: the duration grows by the pad and the provenance is stored. */
export function applyLatenessPad(task: ScheduleTask, pad: LatenessPadRecord): ScheduleTask {
  const next: TaskWithLatenessPad = { ...task, durationDays: task.durationDays + pad.days, latenessPad: pad };
  return next;
}

/** Revert: the duration shrinks by the stored pad (never below 1) and the
 *  provenance is removed. A task with no pad is returned unchanged. */
export function revertLatenessPad(task: ScheduleTask): ScheduleTask {
  const pad = readLatenessPad(task);
  if (!pad) return task;
  const { latenessPad: _drop, ...rest } = task as TaskWithLatenessPad;
  return { ...rest, durationDays: Math.max(1, task.durationDays - pad.days) };
}

/**
 * Which pad survives a task-editor save — one simple rule each way:
 *   • a pad applied in this editor session survives only when the saved
 *     duration is still exactly the padded one and the sub is unchanged;
 *   • a pad stored on the task survives only when the sub is unchanged and the
 *     duration was not edited down (editing it down is how a pad is removed).
 */
export function carryLatenessPadOnSave(input: {
  stored?: LatenessPadRecord;
  storedDuration?: number;
  pending?: PendingLatenessPad;
  savedDuration: number;
  savedSubId?: string;
}): LatenessPadRecord | undefined {
  const { stored, storedDuration, pending, savedDuration, savedSubId } = input;
  if (pending) {
    return pending.pad.subId === savedSubId && savedDuration === pending.appliedDuration ? pending.pad : undefined;
  }
  if (stored) {
    return stored.subId === savedSubId && typeof storedDuration === 'number' && savedDuration >= storedDuration
      ? stored
      : undefined;
  }
  return undefined;
}

/** A pad applied in the task editor but not yet saved. */
export interface PendingLatenessPad {
  pad: LatenessPadRecord;
  /** The duration the apply produced. The pad survives the save only while
   *  the duration is still exactly this. */
  appliedDuration: number;
}

/** The field patch a save spreads into the task: `{ latenessPad }`, where
 *  undefined removes a stored pad. A spread (not a literal key) so the save
 *  sites compile before and after ScheduleTask declares the field. */
export function latenessPadPatch(input: Parameters<typeof carryLatenessPadOnSave>[0]): { latenessPad?: LatenessPadRecord } {
  return { latenessPad: carryLatenessPadOnSave(input) };
}

/** Undo an unsaved editor pad: the duration goes back down by the pad when it
 *  still holds the applied value (a duration he typed since is left alone),
 *  and the pending pad is forgotten. */
export function releasePendingPad<D extends { durationDays: string; latenessPad?: PendingLatenessPad }>(d: D): D {
  if (!d.latenessPad) return d;
  const dur = parseInt(d.durationDays, 10);
  const back = dur === d.latenessPad.appliedDuration
    ? String(Math.max(1, dur - d.latenessPad.pad.days))
    : d.durationDays;
  return { ...d, durationDays: back, latenessPad: undefined };
}

// ── suppliers: advisory only ──────────────────────────────────────────────

export interface SupplierAdvisory {
  supplier: string;
  late: number;
  loads: number;
  avgSlipDays: number;
}

const normSupplier = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * One advisory line for the supplier being typed on a new delivery, or null.
 * Matches case-insensitively (same normalization as utils/supplierScorecard),
 * needs at least `minSettled` settled loads, and says nothing about a supplier
 * who has never been late. No schedule change: a delivery has no task link.
 */
export function supplierAdvisoryFor(
  supplier: string,
  cards: readonly { supplier: string; settledCount: number; lateCount: number; avgSlipDays: number | null }[],
  minSettled: number,
): SupplierAdvisory | null {
  const key = normSupplier(supplier ?? '');
  if (!key) return null;
  const card = cards.find(c => normSupplier(c.supplier) === key);
  if (!card || card.settledCount < minSettled || card.lateCount < 1 || card.avgSlipDays === null) return null;
  return { supplier: card.supplier, late: card.lateCount, loads: card.settledCount, avgSlipDays: card.avgSlipDays };
}
