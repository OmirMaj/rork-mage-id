// lastPlanner.ts — the production-control layer (Lean construction / Last
// Planner System) that sits ON TOP of the CPM schedule.
//
// The CPM engine answers "what's the plan" (Gantt, critical path, baseline).
// Last Planner answers "what will actually get done, and did it" — the loop
// that prevents residential jobs from slipping:
//
//   SHOULD  → the CPM schedule (already built elsewhere)
//   CAN     → LOOKAHEAD: the next 3 weeks, with each task's readiness gated by
//             a CONSTRAINT LOG (waiting on materials / permit / prior trade /
//             selection / inspection). A task isn't "ready" until its
//             constraints clear.
//   WILL    → WEEKLY WORK PLAN: the crew/sub commitments for THIS week —
//             only ready tasks should be committed.
//   DID     → at week's end, mark each commitment kept or missed.
//   LEARN   → PPC (Percent Plan Complete) = kept / committed. Target 80-85%.
//             Missed commitments carry a variance reason so the team gets more
//             reliable over time.
//
// This module is the PURE engine — date math, readiness, lookahead/WWP
// assembly, PPC + variance analytics, and the cloud-mirror row mapping at the
// bottom. No storage, no network (hooks/useLastPlanner owns
// the I/O and injects it into createLastPlannerLoader). All "now" is injected.
//
// NOTE: ScheduleTask already has `anchorType`/`anchorDate` — those are CPM
// scheduling constraints (date pins), a DIFFERENT concept. Our readiness
// Constraints live in their own store and never touch the CPM engine.

import type { ScheduleTask } from '@/types';
// Type-only (erased at runtime): the loader below is handed the app's client.
import type { QueryClient } from '@tanstack/react-query';
// The same working-day predicate the CPM engine uses, so the lookahead and the
// Gantt cannot disagree about which days count.
import { isWorkingDay, runCpm } from '@/utils/cpm';

// ── Constraint log (the "make ready" list) ──────────────────────────────────
export type ConstraintCategory =
  | 'materials' | 'labor' | 'equipment' | 'permit' | 'design_info'
  | 'prior_work' | 'inspection' | 'selection' | 'access' | 'other';

export const CONSTRAINT_LABELS: Record<ConstraintCategory, string> = {
  materials: 'Materials', labor: 'Labor / crew', equipment: 'Equipment',
  permit: 'Permit', design_info: 'Design info / RFI', prior_work: 'Prior work',
  inspection: 'Inspection', selection: 'Owner selection', access: 'Site access',
  other: 'Other',
};

export interface Constraint {
  id: string;
  taskId: string;
  category: ConstraintCategory;
  description: string;
  status: 'open' | 'cleared';
  /** ISO date (yyyy-mm-dd) the constraint must clear by to protect the task start. */
  needBy?: string;
  /** Who owns clearing it (free text: sub name, "office", supplier). */
  owner?: string;
  createdAt: string;
  clearedAt?: string;
}

// ── Weekly commitments + variance (the WILL / DID / LEARN) ───────────────────
export type VarianceReason =
  | 'prereq' | 'materials' | 'labor' | 'weather' | 'rework'
  | 'owner_decision' | 'permit' | 'inspection' | 'scope_change' | 'other';

export const VARIANCE_LABELS: Record<VarianceReason, string> = {
  prereq: 'Prior work not done', materials: 'Materials late', labor: 'Crew unavailable',
  weather: 'Weather', rework: 'Rework / quality', owner_decision: 'Owner decision pending',
  permit: 'Permit / approval', inspection: 'Failed / pending inspection',
  scope_change: 'Scope change', other: 'Other',
};

export interface WeeklyCommitment {
  taskId: string;
  /** ISO Monday (yyyy-mm-dd) of the committed week. */
  weekStart: string;
  committed: boolean;
  /** Set at week close. */
  outcome?: 'done' | 'missed';
  varianceReason?: VarianceReason;
  note?: string;
}

export interface PpcRecord {
  weekStart: string;
  committed: number;
  completed: number;
  ppc: number; // 0..1
}

// ── Date helpers (UTC, ISO yyyy-mm-dd to avoid TZ drift) ─────────────────────
const DAY_MS = 86_400_000;

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function atUtcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** ISO Monday (yyyy-mm-dd) of the week containing `d`. */
export function toMonday(d: Date): string {
  const ms = atUtcMidnight(d);
  const dow = new Date(ms).getUTCDay(); // 0 Sun .. 6 Sat
  const shift = dow === 0 ? -6 : 1 - dow;
  return isoDate(new Date(ms + shift * DAY_MS));
}
export function currentWeekStart(asOf: Date = new Date()): string {
  return toMonday(asOf);
}
export function addWeeks(weekStartIso: string, n: number): string {
  return isoDate(new Date(atUtcMidnight(new Date(weekStartIso)) + n * 7 * DAY_MS));
}
export function weeksBetween(aMondayIso: string, bMondayIso: string): number {
  return Math.round((atUtcMidnight(new Date(bMondayIso)) - atUtcMidnight(new Date(aMondayIso))) / (7 * DAY_MS));
}
export function formatWeekRange(weekStartIso: string): string {
  const start = new Date(weekStartIso);
  const end = new Date(atUtcMidnight(start) + 6 * DAY_MS);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Working calendar for window math. Mirrors the CPM engine's defaults so the
 * lookahead cannot disagree with the Gantt about when a task finishes.
 */
export interface TaskWindowCalendar {
  /** Defaults to 7 — same as utils/cpm, i.e. every day works (identity). */
  workingDaysPerWeek?: number;
  /** Holidays / shutdown days, ISO yyyy-mm-dd. */
  nonWorkingDates?: string[];
}

/**
 * Calendar window of a task. Null when the project has no schedule start date.
 *
 * THE TWO FIELDS HAVE DIFFERENT UNITS, which is what made this wrong:
 *   • `startDay`     is a WORKING-day ORDINAL — "the Nth day of work" — which
 *                    is what every writer in the app stores (scheduleAI's
 *                    generator, scheduleEngine.recalculateStartDays, the grid's
 *                    date cell via scheduleOps.scheduleDayNumberFor).
 *   • `durationDays` is a WORKING-day COUNT.
 *
 * So `endMs` was wrong because it added (dur - 1) CALENDAR days, and `startMs`
 * was wrong because it read the ordinal as a calendar offset. utils/cpm walks
 * the finish with `walkWorkingDays(es, dur - 1, 1, ...)`, so a 10-day task
 * finished 2 days early here, a 20-day task 4 days early, and a task pinned to
 * the 11th working day started ~4 days early on top.
 *
 * `scheduledStartDay` (a CALENDAR index, normally `cpm.es`) overrides the
 * stored pin. Prefer it: the pin is where the task was AUTHORED, the CPM early
 * start is where it is SCHEDULED, and they diverge the moment anything upstream
 * changes. The Last Planner lookahead is the screen a superintendent commits
 * next week's crews from — planning it off the pin while the Pro scheduler
 * plans off CPM means the two boards disagree about what happens next week.
 * {@link buildScheduledStartDays} produces the map.
 *
 * Default workingDaysPerWeek is 7 (every day works), matching cpm's own
 * `?? 7`, so omitting the calendar reproduces the previous arithmetic exactly
 * rather than silently shifting a caller that has no calendar to give.
 */
export function taskWindow(
  task: ScheduleTask,
  projectStartDate?: string | null,
  calendar?: TaskWindowCalendar,
  scheduledStartDay?: number,
): { startMs: number; endMs: number } | null {
  if (!projectStartDate) return null;
  const base = new Date(projectStartDate);
  if (isNaN(base.getTime())) return null;

  const baseMs = atUtcMidnight(base);
  const startDayIndex = scheduledStartDay != null
    ? Math.max(1, Math.round(scheduledStartDay))
    // LEGACY FALLBACK — reads `startDay` as a CALENDAR offset. That is not what
    // the field holds (every writer in the app stores a WORKING ordinal), but
    // utils/crossProjectLoad.ts and utils/judges/capacityLoad.ts deliberately
    // stay on it: their day grid is shared across projects and their guard pins
    // five edge semantics to it (see crossProjectLoad's header note, decided
    // 2026-09-11). Every Last Planner caller — buildLookahead,
    // buildWeeklyWorkPlan and app/last-planner.tsx's own startLabelFor — passes
    // `scheduledStartDay`, so this branch never runs on that screen.
    : Math.max(1, task.startDay || 1);
  const startMs = baseMs + (startDayIndex - 1) * DAY_MS;
  const dur = Math.max(1, task.durationDays || 1);

  const wd = calendar?.workingDaysPerWeek ?? 7;
  const closures = calendar?.nonWorkingDates;
  // 7-day weeks with no closures → working days ARE calendar days; skip the walk.
  if (wd >= 7 && (!closures || closures.length === 0)) {
    return { startMs, endMs: startMs + (dur - 1) * DAY_MS };
  }

  const closureSet = new Set(closures ?? []);
  const isoStart = projectStartDate.slice(0, 10);
  // Walk dur-1 working days forward, exactly as cpm's EF does.
  // Hard stop: a task cannot span more than 7x its duration in calendar days
  // plus a year of closures. Hitting it means the calendar is degenerate (e.g.
  // every day closed) — fall back to the calendar-day span rather than spin.
  const HARD_STOP = dur * 7 + 366;
  let dayIndex = startDayIndex;
  let counted = 0;
  let steps = 0;
  while (counted < dur - 1 && steps < HARD_STOP) {
    dayIndex += 1;
    steps += 1;
    if (isWorkingDay(dayIndex, wd, isoStart, closureSet)) counted += 1;
  }
  if (counted < dur - 1) {
    return { startMs, endMs: startMs + (dur - 1) * DAY_MS };
  }
  return { startMs, endMs: baseMs + (dayIndex - 1) * DAY_MS };
}

/**
 * CPM early start (a CALENDAR index) per task id, for feeding
 * {@link taskWindow}'s `scheduledStartDay`. One engine run for the whole set.
 *
 * Returns an empty map when there is no schedule start date (the engine's
 * raw-day mode gives day numbers that are not calendar indices) or when the
 * network has a cycle (perTask comes back empty and every caller should fall
 * back to the stored pin rather than collapse the board to day 1).
 */
export function buildScheduledStartDays(
  tasks: ScheduleTask[],
  projectStartDate?: string | null,
  calendar?: TaskWindowCalendar,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!projectStartDate || tasks.length === 0) return out;
  const res = runCpm(tasks, {
    scheduleStartDate: projectStartDate.slice(0, 10),
    workingDaysPerWeek: calendar?.workingDaysPerWeek,
    nonWorkingDates: calendar?.nonWorkingDates,
  });
  res.perTask.forEach((r, id) => out.set(id, r.es));
  return out;
}

// ── Readiness ────────────────────────────────────────────────────────────────
export type Readiness = 'done' | 'in_progress' | 'ready' | 'constrained';

export function taskReadiness(task: ScheduleTask, openConstraintCount: number): Readiness {
  if (task.status === 'done' || (task.progress ?? 0) >= 100) return 'done';
  if (task.status === 'in_progress' || (task.progress ?? 0) > 0) return 'in_progress';
  return openConstraintCount > 0 ? 'constrained' : 'ready';
}

function openConstraintsFor(taskId: string, constraints: Constraint[]): Constraint[] {
  return constraints.filter(c => c.taskId === taskId && c.status === 'open');
}

/** A schedulable task (skip summaries — they're rollups, not work). */
function isWorkTask(t: ScheduleTask): boolean {
  return !t.isSummary;
}

// ── Lookahead (CAN) ──────────────────────────────────────────────────────────
export interface LookaheadEntry {
  task: ScheduleTask;
  /** ISO Monday of the week the task is scheduled to start (clamped to this week if already underway). */
  weekStart: string;
  /** 0 = this week, 1 = next week, … within the window. */
  weeksOut: number;
  readiness: Readiness;
  openConstraints: Constraint[];
  /** True if any open constraint's needBy is on/after today AND before the task start (i.e. at risk). */
  atRisk: boolean;
}

export interface LookaheadResult {
  /** weekStart → entries, ascending by week then start day. */
  weeks: { weekStart: string; weeksOut: number; entries: LookaheadEntry[] }[];
  hasSchedule: boolean;
  totalTasks: number;
  constrainedCount: number;
}

export function buildLookahead(
  tasks: ScheduleTask[],
  projectStartDate: string | null | undefined,
  constraints: Constraint[],
  opts?: { weeks?: number; asOf?: Date; calendar?: TaskWindowCalendar },
): LookaheadResult {
  const weeks = Math.max(1, opts?.weeks ?? 3);
  const asOf = opts?.asOf ?? new Date();
  const thisMonday = toMonday(asOf);
  const horizonEndMs = atUtcMidnight(new Date(addWeeks(thisMonday, weeks))) - DAY_MS; // last day of the window
  const thisMondayMs = atUtcMidnight(new Date(thisMonday));

  if (!projectStartDate) {
    return { weeks: [], hasSchedule: false, totalTasks: 0, constrainedCount: 0 };
  }

  // Plan against where CPM SCHEDULES each task, not where it was pinned.
  const scheduledEs = buildScheduledStartDays(tasks, projectStartDate, opts?.calendar);

  const entries: LookaheadEntry[] = [];
  let constrainedCount = 0;
  for (const task of tasks) {
    if (!isWorkTask(task)) continue;
    if (task.status === 'done' || (task.progress ?? 0) >= 100) continue;
    const win = taskWindow(task, projectStartDate, opts?.calendar, scheduledEs.get(task.id));
    if (!win) continue;
    // Include if the task's window overlaps [thisMonday, horizonEnd].
    if (win.endMs < thisMondayMs || win.startMs > horizonEndMs) continue;

    const open = openConstraintsFor(task.id, constraints);
    const readiness = taskReadiness(task, open.length);
    if (readiness === 'constrained') constrainedCount += 1;

    // Bucket by the start week, clamped to this week if it already started.
    const startWeek = win.startMs < thisMondayMs ? thisMonday : toMonday(new Date(win.startMs));
    const weeksOut = Math.max(0, weeksBetween(thisMonday, startWeek));
    const taskStartIso = isoDate(new Date(win.startMs));
    const atRisk = open.some(c => !!c.needBy && c.needBy <= taskStartIso);

    entries.push({ task, weekStart: startWeek, weeksOut, readiness, openConstraints: open, atRisk });
  }

  // Group by week.
  const byWeek = new Map<string, LookaheadEntry[]>();
  for (const e of entries) {
    const arr = byWeek.get(e.weekStart) ?? [];
    arr.push(e);
    byWeek.set(e.weekStart, arr);
  }
  const weekList = Array.from(byWeek.entries())
    .map(([weekStart, es]) => ({
      weekStart,
      weeksOut: weeksBetween(thisMonday, weekStart),
      entries: es.sort((a, b) => (
        (scheduledEs.get(a.task.id) ?? a.task.startDay ?? 0)
        - (scheduledEs.get(b.task.id) ?? b.task.startDay ?? 0)
      )),
    }))
    .sort((a, b) => a.weeksOut - b.weeksOut);

  return { weeks: weekList, hasSchedule: true, totalTasks: entries.length, constrainedCount };
}

// ── Weekly Work Plan (WILL / DID) ────────────────────────────────────────────
export interface WwpEntry {
  task: ScheduleTask;
  readiness: Readiness;
  openConstraints: number;
  committed: boolean;
  outcome?: 'done' | 'missed';
  varianceReason?: VarianceReason;
}

/** Tasks active during `weekStart`, joined to their commitment state for that week. */
export function buildWeeklyWorkPlan(
  tasks: ScheduleTask[],
  projectStartDate: string | null | undefined,
  weekStart: string,
  constraints: Constraint[],
  commitments: WeeklyCommitment[],
  calendar?: TaskWindowCalendar,
): WwpEntry[] {
  const weekStartMs = atUtcMidnight(new Date(weekStart));
  const weekEndMs = weekStartMs + 6 * DAY_MS;
  const commitFor = (taskId: string) =>
    commitments.find(c => c.taskId === taskId && c.weekStart === weekStart);

  const scheduledEs = buildScheduledStartDays(tasks, projectStartDate, calendar);

  const out: WwpEntry[] = [];
  for (const task of tasks) {
    if (!isWorkTask(task)) continue;
    const win = taskWindow(task, projectStartDate, calendar, scheduledEs.get(task.id));
    // Active this week = window overlaps the week. If no schedule dates, include
    // anything explicitly committed to this week so the feature still works.
    const active = win ? (win.startMs <= weekEndMs && win.endMs >= weekStartMs) : false;
    const commit = commitFor(task.id);
    if (!active && !commit) continue;
    // Done work has nothing left to commit — drop it from the plan, unless it
    // carries a commitment for this week (preserve the DID record for review).
    const isDone = task.status === 'done' || (task.progress ?? 0) >= 100;
    if (isDone && !commit) continue;

    const open = openConstraintsFor(task.id, constraints).length;
    out.push({
      task,
      readiness: taskReadiness(task, open),
      openConstraints: open,
      committed: !!commit?.committed,
      outcome: commit?.outcome,
      varianceReason: commit?.varianceReason,
    });
  }
  // Committed first, then ready, then constrained; done sinks.
  const rank: Record<Readiness, number> = { ready: 0, in_progress: 1, constrained: 2, done: 3 };
  return out.sort((a, b) => {
    if (a.committed !== b.committed) return a.committed ? -1 : 1;
    return rank[a.readiness] - rank[b.readiness];
  });
}

// ── PPC + variance analytics (LEARN) ─────────────────────────────────────────
export function computePpc(commitments: WeeklyCommitment[], weekStart: string): PpcRecord {
  const wk = commitments.filter(c => c.weekStart === weekStart && c.committed);
  const committed = wk.length;
  const completed = wk.filter(c => c.outcome === 'done').length;
  return { weekStart, committed, completed, ppc: committed > 0 ? completed / committed : 0 };
}

export type PpcBand = 'strong' | 'ok' | 'weak';
/** LPS target is 80-85%. */
export function ppcBand(ppc: number): PpcBand {
  if (ppc >= 0.85) return 'strong';
  if (ppc >= 0.6) return 'ok';
  return 'weak';
}

/** PPC for every week that has at least one reviewed commitment, ascending. */
export function ppcHistory(commitments: WeeklyCommitment[]): PpcRecord[] {
  const weeks = Array.from(new Set(
    commitments.filter(c => c.committed && c.outcome).map(c => c.weekStart),
  )).sort();
  return weeks.map(w => computePpc(commitments, w));
}

export function ppcTrend(history: PpcRecord[]): { latest: number | null; average: number | null; direction: 'up' | 'down' | 'flat' } {
  if (history.length === 0) return { latest: null, average: null, direction: 'flat' };
  const latest = history[history.length - 1].ppc;
  const average = history.reduce((s, r) => s + r.ppc, 0) / history.length;
  let direction: 'up' | 'down' | 'flat' = 'flat';
  if (history.length >= 2) {
    const prev = history[history.length - 2].ppc;
    direction = latest > prev + 0.02 ? 'up' : latest < prev - 0.02 ? 'down' : 'flat';
  }
  return { latest, average, direction };
}

/** The "learn" view: which reasons cause the most missed commitments, ranked. */
export function varianceBreakdown(commitments: WeeklyCommitment[]): { reason: VarianceReason; count: number }[] {
  const counts = new Map<VarianceReason, number>();
  for (const c of commitments) {
    if (c.outcome === 'missed') {
      const r = c.varianceReason ?? 'other';
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Cloud mirror (row mapping + reconcile) ───────────────────────────────────
// WHY THIS EXISTS. The whole loop — constraints, commitments, kept/missed with
// reasons, PPC, crew dispatches — used to live in ONE AsyncStorage key
// (`mageid_last_planner`). That key is under the `mageid_` prefix, so
// AuthContext.wipeLocalUserCache sweeps it on every sign-out and tenant switch,
// and there was no server copy to come back from: PPC, the number that proves
// to an owner that the crews do what they say, was one logout away from gone.
// It also never left the device, so a commitment meeting run on the laptop
// left the phone's This Week tab empty on site on Friday.
//
// The mirror is three tables (supabase/migrations/20260916150000_last_planner_
// cloud_mirror.sql). Everything below is PURE — hooks/useLastPlanner owns the I/O — so
// the two properties that decide whether the mirror helps or hurts can be
// pinned by scripts/validate-last-planner.ts:
//
//   1. ONE ROW PER (project, task, week). WeeklyCommitment and dispatches have
//      no id of their own. A random id per write would let an offline-queue
//      replay, or the same week edited on laptop and phone, create a second
//      commitment row — and computePpc would count it twice. A double-counted
//      PPC is worse than a lost one, because it is shown to a GC as fact. So
//      the row id is DERIVED from the natural key, the table carries a UNIQUE
//      on that key as well, and every write is an upsert on the id.
//   2. THE CLOUD COPY WINS, EXCEPT OVER WORK THAT HAS NOT LANDED YET. A row
//      with a write still in the offline queue keeps its local value; every
//      other row takes the server's. Local rows the server has never seen are
//      kept and sent up (the backfill that rescues history recorded before
//      the table existed).

export const LAST_PLANNER_TABLES = {
  constraints: 'last_planner_constraints',
  commitments: 'last_planner_commitments',
  dispatches: 'last_planner_dispatches',
} as const;
export type LastPlannerTable = typeof LAST_PLANNER_TABLES[keyof typeof LAST_PLANNER_TABLES];

/** Structurally identical to hooks/useLastPlanner CrewDispatchRecord. */
export interface LastPlannerDispatch {
  crewKey: string;
  weekStart: string;
  channel: 'email' | 'share';
  sentAt: string;
}

/** Structurally identical to hooks/useLastPlanner's per-project bucket. */
export interface LastPlannerBucket {
  constraints: Constraint[];
  commitments: WeeklyCommitment[];
  dispatches?: LastPlannerDispatch[];
}
export type LastPlannerStore = Record<string, LastPlannerBucket>;

export interface LastPlannerRowWrite {
  table: LastPlannerTable;
  /** The row's primary key — also the offline queue's per-record group key. */
  id: string;
  row: Record<string, unknown>;
}

export interface LastPlannerCloudRows {
  constraints: Record<string, unknown>[];
  commitments: Record<string, unknown>[];
  dispatches: Record<string, unknown>[];
}

// `::` cannot occur in a uuid, an ISO date, or a crew key built by
// utils/crewDispatch, so the join is unambiguous. The id carries no user: the
// SERVER's key is (user_id, id) (20260918160000), so a collaborator committing
// the same task and week gets his own row instead of colliding with the GC's.
export function commitmentRowId(projectId: string, taskId: string, weekStart: string): string {
  return `${projectId}::${taskId}::${weekStart}`;
}
/** Key for the `pending` map: a derived id alone does not say which table. */
export function pendingRowKey(table: string, id: string): string {
  return `${table}|${id}`;
}
export function dispatchRowId(projectId: string, crewKey: string, weekStart: string): string {
  return `${projectId}::${crewKey}::${weekStart}`;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
// timestamptz comes back as `…+00:00`; the app writes `…Z`. Normalise on read so
// a row that round-trips is byte-identical and never looks "changed".
const isoTs = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : s;
};
// A `date` column comes back as yyyy-mm-dd already; slice defends a timestamp.
const isoDay = (v: unknown): string => (str(v) ?? '').slice(0, 10);

export function constraintToRow(projectId: string, userId: string, c: Constraint): Record<string, unknown> {
  return {
    id: c.id, user_id: userId, project_id: projectId,
    task_id: c.taskId, category: c.category, description: c.description,
    status: c.status, need_by: c.needBy ?? null, owner: c.owner ?? null,
    // An empty createdAt would be an invalid timestamptz (a terminal write
    // error); omitted, the column default stamps it instead.
    ...(c.createdAt ? { created_at: c.createdAt } : {}),
    cleared_at: c.clearedAt ?? null, deleted_at: null,
  };
}
export function commitmentToRow(projectId: string, userId: string, c: WeeklyCommitment): Record<string, unknown> {
  return {
    id: commitmentRowId(projectId, c.taskId, c.weekStart), user_id: userId, project_id: projectId,
    task_id: c.taskId, week_start: c.weekStart, committed: c.committed,
    outcome: c.outcome ?? null, variance_reason: c.varianceReason ?? null,
    note: c.note ?? null, deleted_at: null,
  };
}
export function dispatchToRow(projectId: string, userId: string, d: LastPlannerDispatch): Record<string, unknown> {
  return {
    id: dispatchRowId(projectId, d.crewKey, d.weekStart), user_id: userId, project_id: projectId,
    crew_key: d.crewKey, week_start: d.weekStart, channel: d.channel,
    sent_at: d.sentAt, deleted_at: null,
  };
}

export function rowToConstraint(r: Record<string, unknown>): Constraint {
  return {
    id: String(r.id), taskId: String(r.task_id),
    category: (str(r.category) ?? 'other') as ConstraintCategory,
    description: typeof r.description === 'string' ? r.description : '',
    status: r.status === 'cleared' ? 'cleared' : 'open',
    needBy: str(r.need_by)?.slice(0, 10), owner: str(r.owner),
    createdAt: isoTs(r.created_at) ?? '', clearedAt: isoTs(r.cleared_at),
  };
}
export function rowToCommitment(r: Record<string, unknown>): WeeklyCommitment {
  const outcome = r.outcome === 'done' || r.outcome === 'missed' ? r.outcome : undefined;
  return {
    taskId: String(r.task_id), weekStart: isoDay(r.week_start), committed: r.committed === true,
    outcome, varianceReason: outcome === 'missed' ? (str(r.variance_reason) as VarianceReason | undefined) : undefined,
    note: str(r.note),
  };
}
export function rowToDispatch(r: Record<string, unknown>): LastPlannerDispatch {
  return {
    crewKey: String(r.crew_key), weekStart: isoDay(r.week_start),
    channel: r.channel === 'email' ? 'email' : 'share', sentAt: isoTs(r.sent_at) ?? '',
  };
}

// Same-shape comparison that ignores key order and undefined-vs-absent.
function sameRow(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

/**
 * The upserts that carry one project's bucket from `prev` to `next`: every row
 * that is new or whose content changed.
 *
 * A row that DISAPPEARS produces nothing. A disappearance here can be a cache
 * race (a hook write built on a snapshot from before a hydrate), not a user's
 * delete — and turning it into a server delete would erase the other device's
 * record. Deletes are server tombstones (`deleted_at`) that the merge honours;
 * nothing in the app issues one today (useLastPlanner.removeConstraint has no
 * UI caller).
 */
export function diffBucketWrites(
  projectId: string, userId: string,
  prev: LastPlannerBucket | undefined, next: LastPlannerBucket,
): LastPlannerRowWrite[] {
  const out: LastPlannerRowWrite[] = [];
  const push = <T,>(
    table: LastPlannerTable, before: T[], after: T[],
    toRow: (projectId: string, userId: string, item: T) => Record<string, unknown>,
  ) => {
    const prior = new Map<string, Record<string, unknown>>();
    for (const item of before) { const r = toRow(projectId, userId, item); prior.set(String(r.id), r); }
    const seen = new Set<string>();
    for (const item of after) {
      const row = toRow(projectId, userId, item);
      const id = String(row.id);
      // A bucket that somehow holds the same natural key twice sends it once.
      if (seen.has(id)) continue;
      seen.add(id);
      const old = prior.get(id);
      if (!old || !sameRow(old, row)) out.push({ table, id, row });
    }
  };
  push(LAST_PLANNER_TABLES.constraints, prev?.constraints ?? [], next.constraints, constraintToRow);
  push(LAST_PLANNER_TABLES.commitments, prev?.commitments ?? [], next.commitments, commitmentToRow);
  push(LAST_PLANNER_TABLES.dispatches, prev?.dispatches ?? [], next.dispatches ?? [], dispatchToRow);
  return out;
}

/**
 * The writes one store change is allowed to push: the diff, narrowed to the
 * rows the mutator NAMED (`touched`, as pendingRowKey values).
 *
 * WHY. A hook write is built on a cache snapshot. If that snapshot predates a
 * hydrate, it can hold stale copies of rows the change never touched, and the
 * whole diff would upload those over another device's newer ones. Only the
 * rows the user actually changed may reach the server.
 */
export function touchedWrites(
  projectId: string, userId: string,
  prev: LastPlannerBucket | undefined, next: LastPlannerBucket, touched: readonly string[],
): LastPlannerRowWrite[] {
  const allowed = new Set(touched);
  return diffBucketWrites(projectId, userId, prev, next)
    .filter(w => allowed.has(pendingRowKey(w.table, w.id)));
}

/**
 * Reconcile the device's store with the server's rows (see rule 2 above).
 * `pending` maps pendingRowKey(table, id) → the row data of a write still
 * waiting in the offline queue (the newest one per row). Returns the merged store plus the local-only rows the server has never seen,
 * which the caller sends up.
 */
export function mergeCloudIntoStore(
  local: LastPlannerStore, cloud: LastPlannerCloudRows,
  pending: ReadonlyMap<string, Record<string, unknown>>, userId: string,
): { store: LastPlannerStore; backfill: LastPlannerRowWrite[] } {
  const projectIds = new Set<string>(Object.keys(local));
  for (const list of [cloud.constraints, cloud.commitments, cloud.dispatches, Array.from(pending.values())]) {
    for (const r of list) if (typeof r.project_id === 'string') projectIds.add(r.project_id);
  }

  const store: LastPlannerStore = {};
  const backfill: LastPlannerRowWrite[] = [];

  const mergeOne = <T,>(
    projectId: string, table: LastPlannerTable, localItems: T[],
    cloudRows: Record<string, unknown>[],
    toRow: (projectId: string, userId: string, item: T) => Record<string, unknown>,
    fromRow: (r: Record<string, unknown>) => T,
  ): T[] => {
    const cloudById = new Map<string, Record<string, unknown>>();
    for (const r of cloudRows) if (r.project_id === projectId) cloudById.set(String(r.id), r);
    const merged = new Map<string, T>();
    // Local first, in local order, so the screen's ordering does not reshuffle.
    for (const item of localItems) {
      const row = toRow(projectId, userId, item);
      const id = String(row.id);
      if (merged.has(id)) continue; // a duplicated natural key collapses to one
      const remote = cloudById.get(id);
      if (pending.has(pendingRowKey(table, id))) { merged.set(id, item); continue; }
      if (!remote) { merged.set(id, item); backfill.push({ table, id, row }); continue; }
      if (remote.deleted_at) continue;
      merged.set(id, fromRow(remote));
    }
    // Queued writes the local bucket no longer holds. This is the same-user
    // re-auth case: the sign-in sweep emptied the store but KEPT the offline
    // queue, so the queued row is the newest copy that exists anywhere — newer
    // than the server's, which it has not reached yet.
    const prefix = `${table}|`;
    for (const [key, row] of pending) {
      if (!key.startsWith(prefix) || row.project_id !== projectId || row.deleted_at) continue;
      const id = key.slice(prefix.length);
      if (!merged.has(id)) merged.set(id, fromRow(row));
    }
    for (const [id, remote] of cloudById) {
      if (merged.has(id) || remote.deleted_at) continue;
      merged.set(id, fromRow(remote));
    }
    return Array.from(merged.values());
  };

  for (const projectId of projectIds) {
    const b = local[projectId] ?? { constraints: [], commitments: [], dispatches: [] };
    const constraints = mergeOne(projectId, LAST_PLANNER_TABLES.constraints, b.constraints ?? [], cloud.constraints, constraintToRow, rowToConstraint)
      // Newest first, the order addConstraint prepends in.
      .sort((a, c) => (c.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const commitments = mergeOne(projectId, LAST_PLANNER_TABLES.commitments, b.commitments ?? [], cloud.commitments, commitmentToRow, rowToCommitment);
    const dispatches = mergeOne(projectId, LAST_PLANNER_TABLES.dispatches, b.dispatches ?? [], cloud.dispatches, dispatchToRow, rowToDispatch);
    store[projectId] = { constraints, commitments, dispatches };
  }
  return { store, backfill };
}

// ── Hydrate orchestration (I/O injected) ────────────────────────────────────
// WHY THIS IS HERE AND NOT IN A SCREEN. The hydrate used to run inside
// app/last-planner.tsx, so every OTHER reader of the store — the Friday Close
// card (hooks/useWeekClose) and Ask (app/ask.tsx) — saw an empty planner on a
// fresh device or after a sign-out until someone happened to open that screen.
// hooks/useLastPlanner's query now runs this for every reader. The I/O is
// passed in so the rules that decide whether the mirror helps or hurts are
// pinned by scripts/validate-last-planner.ts without a device:
//   - a row with a write still waiting (queued, or sent while the read ran)
//     keeps its local value — the server's older copy must not revert it;
//   - an UNREADABLE queue means "we could not look", so give up and stay on
//     the device's copy rather than let the server win blind;
//   - the backfill stops when the server stops answering, and skips (and
//     stops re-offering) a row it refused;
//   - duplicate natural keys collapse (mergeCloudIntoStore).

export type LastPlannerSyncState = 'pending' | 'synced' | 'local-only';
export type LastPlannerWriteOutcome = 'synced' | 'queued' | 'failed';

/** Minimal shape of an offline-queue entry this module reads. */
export interface LastPlannerQueueEntry { table: string; data?: Record<string, unknown> }

const MIRROR_TABLE_NAMES: readonly string[] = Object.values(LAST_PLANNER_TABLES);

/**
 * Rows this session has sent, remembered until a hydrate that STARTED after
 * the write settled has run. A hydrate whose SELECT began before a push lands
 * reads the server's older copy; without this, that copy would overwrite the
 * checkbox the user just ticked. Keyed per user so a tenant switch cannot carry
 * one account's rows into the next account's merge.
 */
export class LastPlannerSentLog {
  private entries = new Map<string, { row: Record<string, unknown>; settledAt: number | null }>();
  private userId: string | null = null;

  private forUser(userId: string) {
    if (this.userId !== userId) { this.entries.clear(); this.userId = userId; }
  }
  /** Record a row as about to be sent. Returns the settle callback. */
  begin(userId: string, key: string, row: Record<string, unknown>, now: () => number): () => void {
    this.forUser(userId);
    const entry = { row, settledAt: null as number | null };
    this.entries.set(key, entry);
    return () => { entry.settledAt = now(); };
  }
  /** Rows a hydrate that started at `startedAt` must not let the server revert. */
  pendingSince(userId: string, startedAt: number): Map<string, Record<string, unknown>> {
    this.forUser(userId);
    const out = new Map<string, Record<string, unknown>>();
    for (const [k, e] of this.entries) {
      if (e.settledAt === null || e.settledAt >= startedAt) out.set(k, e.row);
    }
    return out;
  }
  /** Drop rows a completed hydrate (started at `startedAt`) has already seen land. */
  prune(userId: string, startedAt: number): void {
    this.forUser(userId);
    for (const [k, e] of this.entries) {
      if (e.settledAt !== null && e.settledAt < startedAt) this.entries.delete(k);
    }
  }
}

/** Oldest-first queue → newest pending row per pendingRowKey, mirror tables only. */
export function pendingFromQueue(entries: readonly LastPlannerQueueEntry[]): Map<string, Record<string, unknown>> {
  const pending = new Map<string, Record<string, unknown>>();
  for (const e of entries) {
    if (MIRROR_TABLE_NAMES.includes(e.table) && typeof e.data?.id === 'string') {
      pending.set(pendingRowKey(e.table, e.data.id), e.data);
    }
  }
  return pending;
}

/**
 * Send a backfill one row at a time and STOP when the server stops answering.
 * A backfill can be hundreds of rows; if a write comes back 'queued' (offline,
 * a transient error), each unsent row stays local-only and the next hydrate
 * offers it again, instead of flooding the FIFO-capped offline queue and
 * pushing out someone's daily report.
 *
 * A write that comes back 'failed' is different: the server ANSWERED and
 * refused THIS row (an RLS rejection — e.g. a collaborator's commitment that
 * collided with the owner's row before 20260918160000 keyed rows per person —
 * or a check violation). That says nothing about the rows behind it, so skip
 * it and keep going. Stopping there (the old rule) let one refused commitment
 * keep every later row — his constraints, dispatches, his own projects — off
 * the server on every load. `MAX_CONSECUTIVE_FAILED` refusals in a row do stop
 * the run: that is a server refusing everything, not one bad row.
 *
 * `onFailed` names each refused row so the caller can stop re-offering it.
 * `shouldContinue` is asked before every row: a backfill that outlives its
 * session (sign-out, account switch) must not keep uploading the old account's
 * rows. Returns how many rows were attempted.
 */
export const BACKFILL_MAX_CONSECUTIVE_FAILED = 3;
export async function sendBackfillUntilUnsynced(
  writes: readonly LastPlannerRowWrite[],
  send: (w: LastPlannerRowWrite) => Promise<LastPlannerWriteOutcome>,
  shouldContinue: () => boolean | Promise<boolean> = () => true,
  onFailed: (w: LastPlannerRowWrite) => void = () => {},
): Promise<number> {
  let attempted = 0;
  let failedInARow = 0;
  for (const w of writes) {
    if (!(await shouldContinue())) break;
    attempted++;
    const outcome = await send(w);
    if (outcome === 'synced') { failedInARow = 0; continue; }
    if (outcome === 'queued') break;
    onFailed(w);
    if (++failedInARow >= BACKFILL_MAX_CONSECUTIVE_FAILED) break;
  }
  return attempted;
}

/**
 * Rows the server refused during a backfill, remembered for this app session
 * so the next hydrate does not send them again. Each re-send raised the queue's
 * "Couldn't save" toast, on every load, for a row that could not land — which
 * teaches a super to ignore the toast that matters when a daily report fails.
 * Keyed by the row's CONTENT too: once he edits it (a review, a new outcome)
 * it is a different write and gets its own try. The row stays on the device
 * either way. In memory only and per user, so a tenant switch forgets it.
 */
export class LastPlannerRefusedLog {
  private keys = new Set<string>();
  private userId: string | null = null;
  private key(w: LastPlannerRowWrite): string {
    const row = Object.keys(w.row).sort().map(k => [k, w.row[k] ?? null]);
    return `${pendingRowKey(w.table, w.id)}#${JSON.stringify(row)}`;
  }
  private forUser(userId: string) {
    if (this.userId !== userId) { this.keys.clear(); this.userId = userId; }
  }
  add(userId: string, w: LastPlannerRowWrite): void { this.forUser(userId); this.keys.add(this.key(w)); }
  /** The backfill minus the rows already refused in this session. */
  filter(userId: string, writes: readonly LastPlannerRowWrite[]): LastPlannerRowWrite[] {
    this.forUser(userId);
    return writes.filter(w => !this.keys.has(this.key(w)));
  }
}

export interface LastPlannerHydrateDeps {
  /** The three tables' rows. Throws on any read error (incl. "not migrated"). */
  fetchCloud: () => Promise<LastPlannerCloudRows>;
  readQueue: () => Promise<{ entries: readonly LastPlannerQueueEntry[]; readFailed: boolean }>;
  /** Rows sent this session that the server copy must not overwrite. */
  recentlySent: () => ReadonlyMap<string, Record<string, unknown>>;
  /** Resolves once in-flight store writes have settled (bounded). */
  settleWrites: () => Promise<void>;
  /** The device's store as it stands NOW (cache first, storage fallback). */
  readLocal: () => Promise<LastPlannerStore>;
}

/**
 * Merge the server's copy into the device's store. Never throws: any failure
 * (no network, table missing, queue unreadable) returns the device's own store
 * as `local-only`, and no backfill — a merge we could not trust must not upload.
 */
export async function hydrateLastPlannerStore(
  userId: string, deps: LastPlannerHydrateDeps,
): Promise<{ store: LastPlannerStore; sync: LastPlannerSyncState; backfill: LastPlannerRowWrite[] }> {
  try {
    const cloud = await deps.fetchCloud();
    const queue = await deps.readQueue();
    // Unreadable queue = unknown pending work; letting the server win blind
    // could revert a checkbox that simply has not landed yet.
    if (queue.readFailed) throw new Error('offline queue unreadable');
    // Let an in-flight store write settle first, so the merged store is not
    // immediately overwritten by a write built on the pre-merge snapshot.
    await deps.settleWrites();
    const pending = pendingFromQueue(queue.entries);
    for (const [k, v] of deps.recentlySent()) pending.set(k, v);
    const local = await deps.readLocal();
    const { store, backfill } = mergeCloudIntoStore(local, cloud, pending, userId);
    return { store, sync: 'synced', backfill };
  } catch (err) {
    console.warn('[lastPlanner] cloud mirror unavailable, staying on-device:', err);
    let store: LastPlannerStore = {};
    try { store = await deps.readLocal(); } catch { /* nothing readable → empty */ }
    return { store, sync: 'local-only', backfill: [] };
  }
}

// ── The shared loader (query cache + I/O injected) ──────────────────────────
// hooks/useLastPlanner builds ONE of these with the real AsyncStorage/Supabase
// I/O; scripts/validate-last-planner.ts builds one with in-memory I/O and runs
// it against the real @tanstack/query-core, because the two bugs this section
// exists for live in how the cache and the hydrate interleave, not in the merge:
//
//   1. OVERLAPPING READERS. The device copy is put in the cache before the
//      network read so the screen is usable meanwhile. Written with a normal
//      timestamp it made the query FRESH, and queryClient.fetchQuery returns
//      fresh data without waiting for the fetch in flight — so a second reader
//      (the Friday Close card re-running as invoices load, Ask opened during
//      Home's hydrate) got `{}` on a fresh device and never ran again. The
//      device copy is therefore written with updatedAt 0: it is data, not a
//      server-fresh answer, and a reader that arrives during the hydrate joins it.
//   2. A HYDRATE THAT OUTLIVES ITS SESSION. Sign-out runs wipeLocalUserCache and
//      then queryClient.clear(); neither stops a queryFn already waiting on the
//      network. When it returned, it wrote the signed-out account's planner back
//      to disk after the sweep and kept backfilling under the next session. Every
//      side effect now checks the hydrate is still current first: the Query it
//      belongs to is still the one in the cache (clear() removes it) and the
//      signed-in account is still the one it ran for.

/**
 * The planner's react-query keys. Defined here (not in the hook) so the
 * validator can run the loader with the SAME mutation key the hook's
 * useMutation carries: the hydrate only waits for writes under this key, so a
 * mismatch silently loses a tap made mid-hydrate. hooks/useLastPlanner
 * re-exports them; nothing else should re-type them.
 */
export const LAST_PLANNER_QUERY_KEY = ['last-planner'] as const;
/** Scoped per user, so one account's cached planner is never another's. */
export function lastPlannerQueryKey(userId: string | null | undefined) {
  return [...LAST_PLANNER_QUERY_KEY, userId ?? 'signed-out'] as const;
}
/** Every store mutation runs under this key; the loader's settle waits on it. */
export const LAST_PLANNER_MUTATION_KEY = [...LAST_PLANNER_QUERY_KEY, 'write'] as const;

/** What the query cache holds: the store plus whether it reflects the server. */
export interface LastPlannerSnapshot {
  store: LastPlannerStore;
  sync: LastPlannerSyncState;
}

export interface LastPlannerLoaderIo {
  queryKey: (userId: string | null) => readonly unknown[];
  /** Key every store mutation runs under, so a hydrate can wait for them. */
  mutationKey: readonly unknown[];
  cloudEnabled: () => boolean;
  loadLocal: () => Promise<LastPlannerStore>;
  /** Must START its write synchronously (see commit, below). */
  persist: (store: LastPlannerStore) => Promise<void>;
  /** Remove the device copy only if it is still exactly `written`. */
  unpersistIfUnchanged: (written: LastPlannerStore) => Promise<void>;
  fetchCloud: LastPlannerHydrateDeps['fetchCloud'];
  readQueue: LastPlannerHydrateDeps['readQueue'];
  /** The signed-in account's id right now (null = signed out). May throw. */
  sessionUserId: () => Promise<string | null>;
  upsert: (w: LastPlannerRowWrite) => Promise<LastPlannerWriteOutcome>;
  now: () => number;
}

/**
 * Write a store into the cache WITHOUT changing how fresh the query is. A tap
 * during the hydrate must not turn the device copy into a "fresh" answer (that
 * is bug 1 again, reached through a mutation instead of the seed).
 */
export function writeStoreToCache(
  queryClient: QueryClient, key: readonly unknown[], store: LastPlannerStore,
): void {
  queryClient.setQueryData<LastPlannerSnapshot>(
    key,
    prev => ({ store, sync: prev?.sync ?? 'pending' }),
    { updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? 0 },
  );
}

export function createLastPlannerLoader(io: LastPlannerLoaderIo) {
  // Module-lifetime (one loader per app) so a push from the screen protects its
  // rows from a hydrate started by ANY reader.
  const sentLog = new LastPlannerSentLog();
  const refusedLog = new LastPlannerRefusedLog();
  // One backfill at a time: two readers hydrating together would otherwise
  // both walk the same local-only rows.
  let backfillRunning = false;
  let lastCommit: Promise<void> = Promise.resolve();

  async function sendRow(userId: string, w: LastPlannerRowWrite): Promise<LastPlannerWriteOutcome> {
    const settle = sentLog.begin(userId, pendingRowKey(w.table, w.id), w.row, io.now);
    try {
      return await io.upsert(w);
    } finally {
      settle();
    }
  }

  /** 'unknown' = the session could not be read; neither trust nor undo on it. */
  async function sessionIs(userId: string): Promise<'same' | 'other' | 'unknown'> {
    try {
      return (await io.sessionUserId()) === userId ? 'same' : 'other';
    } catch {
      return 'unknown';
    }
  }

  async function commit(
    userId: string, store: LastPlannerStore, backfill: LastPlannerRowWrite[], isCurrent: () => boolean,
  ): Promise<void> {
    // Started before the first await, so it is issued before any tap made after
    // the merge persists its own (newer) store.
    await io.persist(store);
    const session = await sessionIs(userId);
    if (!isCurrent() || session === 'other') {
      // Signed out (or switched account) while this was on the network: the
      // sweep may already have run, so take back what we just wrote. Only if
      // it is still ours — the next account may have written its own since.
      await io.unpersistIfUnchanged(store);
      return;
    }
    const toSend = refusedLog.filter(userId, backfill);
    if (session === 'unknown' || toSend.length === 0 || backfillRunning) return;
    // History recorded before the table existed, or offline and never queued —
    // the rows that made a logout destructive. Send them up, as this user only.
    backfillRunning = true;
    try {
      await sendBackfillUntilUnsynced(toSend, w => sendRow(userId, w),
        async () => isCurrent() && (await sessionIs(userId)) === 'same',
        w => refusedLog.add(userId, w));
    } catch (err) {
      console.warn('[lastPlanner] backfill failed:', err);
    } finally {
      backfillRunning = false;
    }
  }

  async function loadSnapshot(queryClient: QueryClient, userId: string | null): Promise<LastPlannerSnapshot> {
    const key = io.queryKey(userId);
    const cache = queryClient.getQueryCache();
    // The Query this fetch belongs to. queryClient.clear() on sign-out removes
    // it (and a later reader builds a new one), so identity = "still current".
    const self = cache.find({ queryKey: key, exact: true });
    const isCurrent = () => self !== undefined && cache.find({ queryKey: key, exact: true }) === self;
    const cached = () => queryClient.getQueryData<LastPlannerSnapshot>(key);

    // The device copy first, so the screen is usable (and a tap builds on the
    // real store, not on `{}`) while the network read runs. updatedAt 0: see
    // bug 1 above. isCurrent: a seed after clear() would resurrect the entry.
    if (!cached()) {
      const local = await io.loadLocal();
      if (!cached() && isCurrent()) {
        queryClient.setQueryData<LastPlannerSnapshot>(key, { store: local, sync: 'pending' }, { updatedAt: 0 });
      }
    }
    if (!userId || !io.cloudEnabled()) {
      return { store: cached()?.store ?? await io.loadLocal(), sync: 'local-only' };
    }

    const startedAt = io.now();
    const { store, sync, backfill } = await hydrateLastPlannerStore(userId, {
      fetchCloud: io.fetchCloud,
      readQueue: io.readQueue,
      recentlySent: () => sentLog.pendingSince(userId, startedAt),
      settleWrites: async () => {
        for (let i = 0; i < 20 && queryClient.isMutating({ mutationKey: io.mutationKey }) > 0; i++) {
          await new Promise(r => setTimeout(r, 50));
        }
      },
      // Read AFTER the settle: a tap made during the network read is in the cache.
      readLocal: async () => cached()?.store ?? io.loadLocal(),
    });

    if (sync === 'synced' && isCurrent()) {
      sentLog.prune(userId, startedAt);
      // Not awaited: the query resolves with the merged store synchronously
      // after it is built, so no tap can land between the merge and the cache.
      lastCommit = commit(userId, store, backfill, isCurrent)
        .catch(err => console.warn('[lastPlanner] saving the merged store failed:', err));
    }
    return { store, sync };
  }

  return {
    loadSnapshot,
    sendRow,
    /** Resolves when the latest hydrate's persist/backfill has finished (tests). */
    whenIdle: () => lastCommit,
  };
}
