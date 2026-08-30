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
// assembly, PPC + variance analytics. No storage, no network (the screen owns
// I/O via hooks/useLastPlanner). All "now" is injected so it's deterministic.
//
// NOTE: ScheduleTask already has `anchorType`/`anchorDate` — those are CPM
// scheduling constraints (date pins), a DIFFERENT concept. Our readiness
// Constraints live in their own store and never touch the CPM engine.

import type { ScheduleTask } from '@/types';
// The same working-day predicate the CPM engine uses, so the lookahead and the
// Gantt cannot disagree about which days count.
import { isWorkingDay } from '@/utils/cpm';

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
 *   • `startDay`     is a CALENDAR day index once a start date exists
 *                    (utils/scheduleRebase converts working-day ordinals to
 *                    calendar indices at the moment one is assigned).
 *   • `durationDays` is a WORKING-day COUNT and stays one — scheduleRebase
 *                    passes durations through untouched.
 *
 * So `startMs` was always right and `endMs` was always wrong: it added
 * (dur - 1) CALENDAR days. utils/cpm computes the same finish with
 *     walkWorkingDays(es, dur - 1, 1, ...)
 * — a WORKING-day walk — so a 10-day task finished 2 days early here, a 20-day
 * task 4 days early, and the error compounded with duration.
 *
 * That matters most where this is used: the Last Planner lookahead is the
 * screen a superintendent commits next week's crews from. Tasks ended early,
 * and tasks whose real window reached into the horizon were filtered out of it
 * entirely by the `win.endMs < thisMondayMs` overlap test.
 *
 * Default workingDaysPerWeek is 7 (every day works), matching cpm's own
 * `?? 7`, so omitting the calendar reproduces the previous arithmetic exactly
 * rather than silently shifting a caller that has no calendar to give.
 */
export function taskWindow(
  task: ScheduleTask,
  projectStartDate?: string | null,
  calendar?: TaskWindowCalendar,
): { startMs: number; endMs: number } | null {
  if (!projectStartDate) return null;
  const base = new Date(projectStartDate);
  if (isNaN(base.getTime())) return null;

  const baseMs = atUtcMidnight(base);
  const startDayIndex = Math.max(1, task.startDay || 1);
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

  const entries: LookaheadEntry[] = [];
  let constrainedCount = 0;
  for (const task of tasks) {
    if (!isWorkTask(task)) continue;
    if (task.status === 'done' || (task.progress ?? 0) >= 100) continue;
    const win = taskWindow(task, projectStartDate, opts?.calendar);
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
      entries: es.sort((a, b) => (a.task.startDay || 0) - (b.task.startDay || 0)),
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

  const out: WwpEntry[] = [];
  for (const task of tasks) {
    if (!isWorkTask(task)) continue;
    const win = taskWindow(task, projectStartDate, calendar);
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
