// utils/coScheduleReflowCore.ts — make an approved change order actually move
// the schedule.
//
// THE BUG THIS CLOSES
// -------------------
// Approving a CO used to do exactly three things:
//     totalDurationDays += bumpDays
//     criticalPathDays  += bumpDays
//     bufferDays        += impactDays
// No task's startDay moved, nothing was reflowed, CPM never re-ran. The owner
// signed "+8 days", the contract said +8 days, and every sub still saw the
// original dates. There was no baseline event recording when or why the
// schedule moved, which is precisely the record a delay claim lives or dies on.
//
// WHAT THIS DOES INSTEAD
// ----------------------
//   1. Picks ONE anchor task that absorbs the added days (see ANCHOR RULE).
//   2. Extends that task's duration by exactly `scheduleImpactDays`.
//   3. Re-runs the real CPM engine (utils/cpm.ts — untouched, just called) so
//      successors shift, float is recomputed, and the critical path is
//      re-derived rather than left stale.
//   4. Captures a baseline BEFORE the first mutation (if the schedule has none)
//      and writes a ScheduleAuditEntry linking the CO id.
//   5. Refuses to move anything twice (see IDEMPOTENCY).
//
// ANCHOR RULE (deliberate, in priority order)
// -------------------------------------------
//   1. `user_picked`    — an explicit task the user chose in the preview, or
//                         `co.scheduleAnchorTaskId`. A human decision always
//                         beats a machine one.
//   2. `ai_identified`  — `co.scheduleImpactTaskIds`, resolved from the
//                         `affectedTasks[]` the AI impact analysis already
//                         computes (components/AIChangeOrderImpact.tsx). That
//                         output used to be rendered and thrown away.
//   3. `estimate_link`  — schedule tasks whose `linkedEstimateItems` intersect
//                         estimate items matching this CO's line-item names.
//   4. otherwise        — NO anchor. We do not invent a trailing task. Adding a
//                         row nobody asked for to a GC's Gantt is worse than
//                         saying "I can't place these days"; the plan carries a
//                         `no_anchor` status plus the candidate list so the UI
//                         can ask the user which activity absorbs them.
//
// Within a tier, ties break on: earliest CPM early-start (the *cause* of a
// delay precedes its consequences — the AI's affectedTasks[] mixes both, and
// re-running CPM from the cause reproduces the consequences through real
// network logic instead of trusting the model's arithmetic), then longest
// duration, then task id for total determinism.
//
// Ineligible as an anchor: summary rows (their dates roll up from children),
// milestones and other zero-duration markers (nothing to stretch),
// level-of-effort tasks (duration is computed, not authored), and finished
// work (you cannot add days to a task that is already done).
//
// IDEMPOTENCY
// -----------
// Two independent guards, checked before anything is computed:
//   • `ChangeOrder.scheduleImpactApplied === true`
//   • an `auditTrail` entry with action === CO_REFLOW_ACTION
// The audit marker is the durable one — it rides a synced column and survives
// a cache wipe, so a re-approval, a sync from a second device, or an offline
// queue replay all resolve to `already_applied`. This mirrors the dedupe
// marker precedent in utils/brain/leakCoDraft.ts. A double-applied CO silently
// adds phantom weeks to a schedule; there is no acceptable failure mode here.
//
// PURITY
// ------
// No React, no react-native, no storage, no network — Bun can parse this file,
// so scripts/validate-co-schedule-reflow.ts exercises it directly. Same split
// as utils/alertCore.ts. Callers persist the returned schedule + CO patch
// through the existing context / offline-queue path.

import type {
  ChangeOrder,
  COAuditEntry,
  ProjectSchedule,
  ScheduleAuditEntry,
  ScheduleTask,
} from '@/types';
import { runCpm, type CpmResult, type RunCpmOptions } from '@/utils/cpm';
import { resolveCalendarForTask } from '@/utils/scheduleResourceCalendars';
import { captureBaseline } from '@/utils/scheduleOps';

// ─── Markers ────────────────────────────────────────────────────────────────

/** Stamped into `ChangeOrder.auditTrail` the moment a reflow is applied. The
 *  durable half of the idempotency guard. */
export const CO_REFLOW_ACTION = 'schedule_reflow_applied';

/** Stamped when an approved CO carried impact days we could not place on any
 *  task. Keeps the "we did nothing" case visible instead of silent. */
export const CO_REFLOW_UNANCHORED_ACTION = 'schedule_reflow_no_anchor';

/** Name of the baseline captured immediately before the first CO-driven
 *  mutation of a schedule. */
export const PRE_CO_BASELINE_PREFIX = 'Pre-CO';

// ─── Public types ───────────────────────────────────────────────────────────

export type ReflowAnchorReason = 'user_picked' | 'ai_identified' | 'estimate_link' | 'none';

export type CoReflowStatus =
  /** Everything resolved — `applyCoScheduleReflow` will produce a new schedule. */
  | 'ready'
  /** Already applied once. Applying again is a no-op, by design. */
  | 'already_applied'
  /** No (or non-positive) `scheduleImpactDays`. Nothing to move. */
  | 'no_impact'
  /** No schedule, or a schedule with no tasks. */
  | 'no_schedule'
  /** Impact days exist but nothing on the schedule can absorb them. */
  | 'no_anchor'
  /** The dependency network has a cycle — CPM can't run, so we refuse to
   *  guess. Fixing the loop is the user's move, not ours. */
  | 'blocked';

export interface CoReflowShift {
  id: string;
  title: string;
  fromDay: number;
  toDay: number;
  deltaDays: number;
}

export interface CoReflowTaskRef {
  id: string;
  title: string;
}

export interface CoReflowCandidate {
  id: string;
  title: string;
  phase: string;
  startDay: number;
  durationDays: number;
}

export interface CoReflowPlan {
  status: CoReflowStatus;
  /** One sentence, safe to render verbatim. Populated for every status —
   *  this is what keeps the UI copy honest in the branches that do nothing. */
  message: string;
  /** Days this CO adds, normalized (integer, >= 0). */
  impactDays: number;
  anchorTaskId: string | null;
  anchorTaskTitle: string | null;
  anchorReason: ReflowAnchorReason;
  anchorDurationBefore: number;
  anchorDurationAfter: number;
  /** Tasks the user could pick as the anchor. Present on `ready` AND
   *  `no_anchor` so the preview can always offer a different choice. */
  candidates: CoReflowCandidate[];
  /** Only tasks whose start actually moves. Empty is a legitimate result
   *  (the anchor has no successors — the project just finishes later). */
  shifts: CoReflowShift[];
  finishBefore: number;
  finishAfter: number;
  finishDeltaDays: number;
  becameCritical: CoReflowTaskRef[];
  noLongerCritical: CoReflowTaskRef[];
  /** True when applying will snapshot a baseline first. */
  willCaptureBaseline: boolean;
}

export interface CoReflowOptions {
  /** Explicit anchor (from the preview's task picker). Highest priority. */
  anchorTaskId?: string;
  /** Estimate line items (id + name) used by the `estimate_link` tier. CO line
   *  items carry no estimate id, so we bridge on name. */
  estimateItems?: { id: string; name: string }[];
  /** Who is applying this — lands in both audit trails. */
  actor?: string;
  /** Injectable clock, for deterministic tests. */
  now?: string;
  /** Injectable id factory, for deterministic tests. */
  newId?: () => string;
}

export interface CoReflowApplication {
  plan: CoReflowPlan;
  /** The schedule to persist. Null unless `plan.status === 'ready'`. */
  nextSchedule: ProjectSchedule | null;
  /** Patch to merge onto the ChangeOrder — carries both idempotency guards.
   *  Null unless `plan.status === 'ready'`. */
  coPatch: Partial<ChangeOrder> | null;
  /** Schedule-side audit row linking the CO. Null unless applied. */
  auditEntry: ScheduleAuditEntry | null;
}

// ─── Idempotency ────────────────────────────────────────────────────────────

/** True when this CO's schedule impact has already been folded into a
 *  schedule. Checks BOTH guards — the boolean can be lost by a partial sync,
 *  the audit marker rides a synced column. */
export function isCoScheduleReflowApplied(co: Pick<ChangeOrder, 'scheduleImpactApplied' | 'auditTrail'>): boolean {
  if (co.scheduleImpactApplied === true) return true;
  return (co.auditTrail ?? []).some(e => e.action === CO_REFLOW_ACTION);
}

/** True when we already recorded that this CO's days could not be placed. */
export function hasUnanchoredMarker(co: Pick<ChangeOrder, 'auditTrail'>): boolean {
  return (co.auditTrail ?? []).some(e => e.action === CO_REFLOW_UNANCHORED_ACTION);
}

/** Normalized impact days: whole days, never negative. A CO that shortens the
 *  job is a different (unbuilt) feature — we do not silently compress a
 *  schedule off a negative number. */
export function normalizeImpactDays(days: number | undefined | null): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return 0;
  return Math.max(0, Math.trunc(days));
}

// ─── Anchor eligibility + selection ─────────────────────────────────────────

/** Tasks that can legitimately absorb added days. See ANCHOR RULE above. */
export function eligibleAnchorTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  return tasks.filter(t => {
    if (t.isSummary) return false;
    if (t.isMilestone) return false;
    if (t.isLevelOfEffort) return false;
    if ((t.durationDays ?? 0) <= 0) return false;
    if (t.status === 'done') return false;
    if ((t.progress ?? 0) >= 100) return false;
    if (t.actualEndDay != null) return false;
    return true;
  });
}

function toCandidate(t: ScheduleTask): CoReflowCandidate {
  return {
    id: t.id,
    title: t.title,
    phase: t.phase,
    startDay: t.startDay,
    durationDays: t.durationDays,
  };
}

/**
 * Deterministic pick among equally-valid anchors: earliest CPM early start,
 * then longest duration, then id. Earliest-first because the AI's
 * `affectedTasks[]` lists the activity doing the work AND the activities it
 * pushes; the earliest one is the cause, and re-running CPM from the cause
 * regenerates the consequences through real dependency logic.
 */
function earliestOf(tasks: ScheduleTask[], cpm: CpmResult | null): ScheduleTask | null {
  if (tasks.length === 0) return null;
  return [...tasks].sort((a, b) => {
    const aEs = cpm?.perTask.get(a.id)?.es ?? a.startDay;
    const bEs = cpm?.perTask.get(b.id)?.es ?? b.startDay;
    if (aEs !== bEs) return aEs - bEs;
    if (a.durationDays !== b.durationDays) return b.durationDays - a.durationDays;
    return a.id.localeCompare(b.id);
  })[0];
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Map the AI's `affectedTasks[].taskName` strings onto real task ids. The model
 * returns names, not ids, so this runs at CAPTURE time (in the CO screen, where
 * the schedule is in hand) and the resolved ids are persisted on the CO.
 *
 * Matching ladder, each step stricter-to-looser but never ambiguous:
 *   1. exact normalized equality
 *   2. unique containment (one and only one task contains the name, or vice
 *      versa) — a name that matches two tasks is dropped rather than guessed.
 */
export function resolveAiAffectedTaskIds(tasks: ScheduleTask[], taskNames: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const normalized = tasks.map(t => ({ id: t.id, key: normalizeName(t.title) }));

  for (const raw of taskNames) {
    const key = normalizeName(raw ?? '');
    if (!key) continue;

    const exact = normalized.filter(t => t.key === key);
    let hit: string | null = exact.length === 1 ? exact[0].id : null;

    if (!hit && exact.length === 0) {
      const contains = normalized.filter(t => t.key.includes(key) || key.includes(t.key));
      if (contains.length === 1) hit = contains[0].id;
    }

    if (hit && !seen.has(hit)) {
      seen.add(hit);
      out.push(hit);
    }
  }
  return out;
}

/** Estimate-link tier: CO line-item names → estimate item ids → tasks whose
 *  `linkedEstimateItems` reference them. */
function estimateLinkedTasks(
  eligible: ScheduleTask[],
  co: Pick<ChangeOrder, 'lineItems'>,
  estimateItems: { id: string; name: string }[],
): ScheduleTask[] {
  if (estimateItems.length === 0) return [];
  const coNames = new Set(
    (co.lineItems ?? []).map(li => normalizeName(li.name ?? '')).filter(Boolean),
  );
  if (coNames.size === 0) return [];
  const estIds = new Set(
    estimateItems.filter(e => coNames.has(normalizeName(e.name ?? ''))).map(e => e.id),
  );
  if (estIds.size === 0) return [];
  return eligible.filter(t => (t.linkedEstimateItems ?? []).some(id => estIds.has(id)));
}

export interface AnchorSelection {
  taskId: string | null;
  reason: ReflowAnchorReason;
}

/** The anchor rule, isolated so it can be tested (and read) on its own. */
export function selectReflowAnchor(
  tasks: ScheduleTask[],
  co: Pick<ChangeOrder, 'lineItems' | 'scheduleAnchorTaskId' | 'scheduleImpactTaskIds'>,
  opts: { anchorTaskId?: string; estimateItems?: { id: string; name: string }[]; cpm?: CpmResult | null } = {},
): AnchorSelection {
  const eligible = eligibleAnchorTasks(tasks);
  if (eligible.length === 0) return { taskId: null, reason: 'none' };
  const byId = new Map(eligible.map(t => [t.id, t]));
  const cpm = opts.cpm ?? null;

  // 1. Explicit human choice.
  const explicit = opts.anchorTaskId ?? co.scheduleAnchorTaskId;
  if (explicit && byId.has(explicit)) return { taskId: explicit, reason: 'user_picked' };

  // 2. AI-identified affected tasks.
  const ai = (co.scheduleImpactTaskIds ?? [])
    .map(id => byId.get(id))
    .filter((t): t is ScheduleTask => !!t);
  const aiPick = earliestOf(ai, cpm);
  if (aiPick) return { taskId: aiPick.id, reason: 'ai_identified' };

  // 3. Estimate-linked tasks.
  const linkedPick = earliestOf(estimateLinkedTasks(eligible, co, opts.estimateItems ?? []), cpm);
  if (linkedPick) return { taskId: linkedPick.id, reason: 'estimate_link' };

  // 4. Nothing we can honestly point at.
  return { taskId: null, reason: 'none' };
}

// ─── CPM plumbing ───────────────────────────────────────────────────────────

/** Build the exact CPM options the rest of the app runs with, so a reflow can
 *  never disagree with what schedule-pro renders (calendar, closures, critical
 *  float threshold, per-resource calendars). */
export function cpmOptionsForSchedule(schedule: ProjectSchedule): RunCpmOptions {
  const taskCalendars = new Map<string, { workingDaysPerWeek: number; closures: string[] }>();
  for (const task of schedule.tasks) {
    if (!task.resourceIds || task.resourceIds.length === 0) continue;
    const resolved = resolveCalendarForTask(task, schedule);
    if (resolved.source !== 'project') {
      taskCalendars.set(task.id, {
        workingDaysPerWeek: resolved.workingDaysPerWeek,
        closures: resolved.closures,
      });
    }
  }
  return {
    scheduleStartDate: schedule.startDate,
    workingDaysPerWeek: schedule.workingDaysPerWeek,
    nonWorkingDates: schedule.nonWorkingDates,
    criticalFloatThresholdDays: schedule.criticalFloatThresholdDays,
    taskCalendars: taskCalendars.size > 0 ? taskCalendars : undefined,
  };
}

function pluralDays(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

function emptyPlan(status: CoReflowStatus, message: string, impactDays: number, candidates: CoReflowCandidate[] = []): CoReflowPlan {
  return {
    status,
    message,
    impactDays,
    anchorTaskId: null,
    anchorTaskTitle: null,
    anchorReason: 'none',
    anchorDurationBefore: 0,
    anchorDurationAfter: 0,
    candidates,
    shifts: [],
    finishBefore: 0,
    finishAfter: 0,
    finishDeltaDays: 0,
    becameCritical: [],
    noLongerCritical: [],
    willCaptureBaseline: false,
  };
}

// ─── Plan (the preview) ─────────────────────────────────────────────────────

/**
 * Compute — without mutating anything — exactly what approving this CO would
 * do to the schedule. The preview modal renders this; `applyCoScheduleReflow`
 * consumes the same function, so what the GC sees IS what gets written.
 */
export function planCoScheduleReflow(
  schedule: ProjectSchedule | null | undefined,
  co: ChangeOrder,
  opts: CoReflowOptions = {},
): CoReflowPlan {
  const impactDays = normalizeImpactDays(co.scheduleImpactDays);

  // Idempotency first, so a re-approval reports the true reason.
  if (isCoScheduleReflowApplied(co)) {
    return emptyPlan(
      'already_applied',
      `CO #${co.number}'s ${pluralDays(impactDays)} are already in the schedule. Approving again will not add them twice.`,
      impactDays,
    );
  }

  if (impactDays <= 0) {
    return emptyPlan(
      'no_impact',
      'This change order carries no schedule impact, so no dates move.',
      impactDays,
    );
  }

  if (!schedule || !schedule.tasks || schedule.tasks.length === 0) {
    return emptyPlan(
      'no_schedule',
      `There is no schedule on this project yet, so the ${pluralDays(impactDays)} stay recorded on the change order only.`,
      impactDays,
    );
  }

  const options = cpmOptionsForSchedule(schedule);
  const before = runCpm(schedule.tasks, options);
  if (before.conflicts.some(c => c.kind === 'cycle')) {
    return emptyPlan(
      'blocked',
      'This schedule has a dependency loop, so the critical path cannot be computed. Fix the loop and the days can be applied.',
      impactDays,
    );
  }

  const candidates = eligibleAnchorTasks(schedule.tasks).map(toCandidate);
  const { taskId: anchorId, reason: anchorReason } = selectReflowAnchor(schedule.tasks, co, {
    anchorTaskId: opts.anchorTaskId,
    estimateItems: opts.estimateItems,
    cpm: before,
  });

  if (!anchorId) {
    return emptyPlan(
      'no_anchor',
      candidates.length > 0
        ? `Nothing on this schedule is linked to this change order, so the ${pluralDays(impactDays)} have no place to land. Pick the activity that absorbs them, or approve the money now and place the days later.`
        : `Every task on this schedule is finished, a milestone, or a summary row, so there is nothing that can absorb the ${pluralDays(impactDays)}.`,
      impactDays,
      candidates,
    );
  }

  const anchor = schedule.tasks.find(t => t.id === anchorId)!;
  const nextTasks = schedule.tasks.map(t =>
    t.id === anchorId ? { ...t, durationDays: t.durationDays + impactDays } : t,
  );
  const after = runCpm(nextTasks, options);

  // Only the INCREMENTAL effect of this CO moves dates. We shift each task by
  // (afterES - beforeES) rather than snapping startDay to ES, so a schedule
  // that was already out of step with CPM does not get silently normalized on
  // the back of a change order.
  const shifts: CoReflowShift[] = [];
  for (const t of schedule.tasks) {
    if (t.isSummary) continue; // dates roll up from children — never written directly
    const b = before.perTask.get(t.id);
    const a = after.perTask.get(t.id);
    if (!b || !a) continue;
    const delta = a.es - b.es;
    if (delta === 0) continue;
    shifts.push({
      id: t.id,
      title: t.title,
      fromDay: t.startDay,
      toDay: t.startDay + delta,
      deltaDays: delta,
    });
  }

  const becameCritical: CoReflowTaskRef[] = [];
  const noLongerCritical: CoReflowTaskRef[] = [];
  for (const t of schedule.tasks) {
    const b = before.perTask.get(t.id);
    const a = after.perTask.get(t.id);
    if (!b || !a) continue;
    if (!b.isCritical && a.isCritical) becameCritical.push({ id: t.id, title: t.title });
    if (b.isCritical && !a.isCritical) noLongerCritical.push({ id: t.id, title: t.title });
  }

  const finishDeltaDays = after.projectFinish - before.projectFinish;
  const willCaptureBaseline = (schedule.baselines?.length ?? 0) === 0;

  return {
    status: 'ready',
    message:
      `"${anchor.title}" absorbs ${pluralDays(impactDays)} (${anchor.durationDays}d → ${anchor.durationDays + impactDays}d). ` +
      `${shifts.length} downstream task${shifts.length === 1 ? '' : 's'} shift and the finish moves ` +
      `${finishDeltaDays === 0 ? 'not at all' : `${finishDeltaDays > 0 ? '+' : ''}${pluralDays(Math.abs(finishDeltaDays))}`}.`,
    impactDays,
    anchorTaskId: anchor.id,
    anchorTaskTitle: anchor.title,
    anchorReason,
    anchorDurationBefore: anchor.durationDays,
    anchorDurationAfter: anchor.durationDays + impactDays,
    candidates,
    shifts,
    finishBefore: before.projectFinish,
    finishAfter: after.projectFinish,
    finishDeltaDays,
    becameCritical,
    noLongerCritical,
    willCaptureBaseline,
  };
}

// ─── Apply ──────────────────────────────────────────────────────────────────

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Short human label for why a given task was chosen. Rendered in the preview
 *  and stored in the audit trail — "who decided this" is half the record. */
export function describeAnchorReason(reason: ReflowAnchorReason): string {
  switch (reason) {
    case 'user_picked': return 'you picked it';
    case 'ai_identified': return 'AI impact analysis flagged it';
    case 'estimate_link': return 'linked to this change order\'s estimate items';
    default: return 'no linked activity';
  }
}

/**
 * Produce the schedule to persist, the CO patch that makes a second
 * application impossible, and the audit row linking the two. Pure — the caller
 * commits both through the normal context / offline-queue path.
 *
 * When `plan.status !== 'ready'` every output but `plan` is null. Callers must
 * branch on the status and say something true to the user.
 */
export function applyCoScheduleReflow(
  schedule: ProjectSchedule | null | undefined,
  co: ChangeOrder,
  opts: CoReflowOptions = {},
): CoReflowApplication {
  const plan = planCoScheduleReflow(schedule, co, opts);
  if (plan.status !== 'ready' || !schedule || !plan.anchorTaskId) {
    return { plan, nextSchedule: null, coPatch: null, auditEntry: null };
  }

  const now = opts.now ?? new Date().toISOString();
  const newId = opts.newId ?? defaultId;
  const actor = opts.actor ?? 'anonymous';
  const shiftById = new Map(plan.shifts.map(s => [s.id, s]));

  // Re-run once on the mutated set so the persisted isCriticalPath flags come
  // from the same pass the plan reported.
  const options = cpmOptionsForSchedule(schedule);
  const mutated = schedule.tasks.map(t =>
    t.id === plan.anchorTaskId ? { ...t, durationDays: t.durationDays + plan.impactDays } : t,
  );
  const after = runCpm(mutated, options);

  const nextTasks: ScheduleTask[] = mutated.map(t => {
    const shift = shiftById.get(t.id);
    const cpmTask = after.perTask.get(t.id);
    const next: ScheduleTask = { ...t };
    if (shift && !t.isSummary) next.startDay = shift.toDay;
    if (cpmTask) next.isCriticalPath = cpmTask.isCritical;
    return next;
  });

  // Baseline BEFORE the mutation — this is the artifact a delay claim rests
  // on. We only capture when the schedule has none: if an as-planned baseline
  // already exists it IS the contractual reference, and quietly re-baselining
  // on every CO would erase the very slip the claim is about.
  const baselines = plan.willCaptureBaseline
    ? [
        ...(schedule.baselines ?? []),
        captureBaseline(
          schedule.tasks,
          `${PRE_CO_BASELINE_PREFIX} #${co.number}`,
          `Captured automatically before CO #${co.number} added ${pluralDays(plan.impactDays)}.`,
          { reasonCode: 'scope_change', capturedBy: actor },
        ),
      ]
    : schedule.baselines;

  const nextSchedule: ProjectSchedule = {
    ...schedule,
    tasks: nextTasks,
    // Derived from the engine, not incremented by hand. bufferDays is
    // deliberately untouched: contingency is a separate commitment from
    // contract time, and folding CO days into it hides the slip.
    totalDurationDays: after.projectFinish,
    criticalPathDays: after.projectFinish,
    baselines,
    updatedAt: now,
  };

  const auditEntry: ScheduleAuditEntry = {
    id: newId(),
    at: now,
    user: actor,
    changeOrderId: co.id,
    taskId: plan.anchorTaskId,
    taskTitle: plan.anchorTaskTitle ?? undefined,
    kind: 'reflow',
    summary:
      `CO #${co.number} approved: +${pluralDays(plan.impactDays)} on "${plan.anchorTaskTitle}" ` +
      `(${describeAnchorReason(plan.anchorReason)}). ${plan.shifts.length} task(s) shifted, ` +
      `finish ${plan.finishBefore} → ${plan.finishAfter}.`,
    before: {
      anchorDurationDays: plan.anchorDurationBefore,
      projectFinishDay: plan.finishBefore,
    },
    after: {
      anchorDurationDays: plan.anchorDurationAfter,
      projectFinishDay: plan.finishAfter,
      shiftedTaskIds: plan.shifts.map(s => s.id),
      becameCriticalTaskIds: plan.becameCritical.map(t => t.id),
      noLongerCriticalTaskIds: plan.noLongerCritical.map(t => t.id),
      changeOrderId: co.id,
      changeOrderNumber: co.number,
      impactDays: plan.impactDays,
      anchorReason: plan.anchorReason,
      baselineCaptured: plan.willCaptureBaseline,
    },
  };

  const coAudit: COAuditEntry = {
    id: newId(),
    action: CO_REFLOW_ACTION,
    actor,
    timestamp: now,
    detail:
      `+${pluralDays(plan.impactDays)} applied to "${plan.anchorTaskTitle}" ` +
      `(${describeAnchorReason(plan.anchorReason)}); finish ${plan.finishBefore} → ${plan.finishAfter}.`,
  };

  const coPatch: Partial<ChangeOrder> = {
    scheduleImpactApplied: true,
    scheduleAnchorTaskId: plan.anchorTaskId,
    auditTrail: [...(co.auditTrail ?? []), coAudit],
  };

  return { plan, nextSchedule, coPatch, auditEntry };
}

/**
 * Marker for an approved CO whose days could not be placed — nothing on the
 * schedule links to it (`no_anchor`), or the dependency network has a loop the
 * engine refuses to guess through (`blocked`). Stamped once (callers check
 * `hasUnanchoredMarker` first) so the gap stays visible in the CO's own history
 * instead of vanishing. `detail` carries the plan's own explanation.
 */
export function buildUnanchoredCoAuditEntry(
  plan: CoReflowPlan,
  opts: CoReflowOptions = {},
): COAuditEntry {
  const newId = opts.newId ?? defaultId;
  return {
    id: newId(),
    action: CO_REFLOW_UNANCHORED_ACTION,
    actor: opts.actor ?? 'anonymous',
    timestamp: opts.now ?? new Date().toISOString(),
    detail: `${pluralDays(plan.impactDays)} not applied to the schedule — ${plan.message}`,
  };
}
