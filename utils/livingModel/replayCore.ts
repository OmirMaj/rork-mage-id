// utils/livingModel/replayCore.ts — the job played from start to finish (pure).
//
// The Living Model, Phase 1. Time here is a WORKING-DAY offset from the start
// of the schedule: 0 is the morning of day 1, 5 is the end of the first week on
// a five-day week. It is the same basis as ScheduleTask.startDay (which is
// 1-indexed), so a task spans [startDay - 1, startDay - 1 + durationDays].
// utils/livingModel/replayInput.ts turns calendar dates into this offset with
// the schedule's own calendar.
//
// TWO READINGS, NEVER MIXED.
//   PLANNED is the schedule: how far along a task should be at a moment.
//   REPORTED is only what was reported in MAGE ID: a daily report that gave the
//   task a percent on a day, and the task's own progress, status and actual
//   finish in the schedule. Where a task has neither, the answer is 0 and
//   `hasReport` is false, and the views say "No progress reported". REPORTED
//   NEVER FALLS BACK TO THE PLAN. scripts/validate-living-model.ts plants that
//   fallback and must go red.
//
// PAST TODAY. Nothing after today has happened, so nothing after today is
// drawn solid. `solid` is held at today's value and `ghost` is the plan for the
// moment being looked at, drawn faint.

import { BUILD_STAGES, stageOrder, type BuildStage, type RoomStage, type TaskStage } from './stageCore';

export type ReplayMode = 'planned' | 'reported';

/** One schedule task, cut down to what the replay reads. */
export interface ReplayTask {
  id: string;
  title: string;
  stage: TaskStage;
  /** 1-indexed working day, as in the schedule. */
  startDay: number;
  durationDays: number;
  /** The schedule's own progress field, 0 to 100. */
  progress: number;
  status: 'not_started' | 'in_progress' | 'on_hold' | 'done';
  /** Working-day offset of the actual finish, when the schedule holds one. */
  actualEndOffset?: number | null;
  /** Working-day offset of the actual start, when the schedule holds one. */
  actualStartOffset?: number | null;
}

/** One percent reported for one task in one daily report. */
export interface ReportPoint {
  taskId: string;
  /** Working-day offset of the END of the report's day. */
  offset: number;
  /** 0 to 100. */
  pct: number;
}

export interface ReplayClock {
  /** The end of the last task, in working days. At least 1. */
  totalDays: number;
  workingDaysPerWeek: number;
  /** Working-day offset of now. 0 when the job has not started or has no start date. */
  todayOffset: number;
  /** False when the schedule has no start date: then nothing can be placed against today. */
  hasStartDate: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const taskStartOffset = (t: Pick<ReplayTask, 'startDay'>): number => Math.max(0, num(t.startDay, 1) - 1);
export const taskEndOffset = (t: Pick<ReplayTask, 'startDay' | 'durationDays'>): number => taskStartOffset(t) + Math.max(1, num(t.durationDays, 1));

/** How far along the PLAN says a task is at a moment, 0 to 1. */
export function plannedAt(t: ReplayTask, offset: number): number {
  const s = taskStartOffset(t);
  return clamp01((offset - s) / (taskEndOffset(t) - s));
}

/** True when the schedule itself holds something reported for the task (no date comes with it). */
export function hasUndatedReport(t: ReplayTask): boolean {
  return num(t.progress) > 0 || t.status === 'done' || t.status === 'in_progress' || t.actualEndOffset != null || t.actualStartOffset != null;
}

/** True when anything at all was reported for the task. */
export function hasAnyReport(t: ReplayTask, points: readonly ReportPoint[]): boolean {
  return hasUndatedReport(t) || points.some((p) => p.taskId === t.id);
}

/**
 * How far along a task was REPORTED to be at a moment, 0 to 1.
 *
 *   A daily report's percent counts from the end of its day.
 *   An actual finish in the schedule counts as 100 from that day.
 *   The schedule's own progress field has no date, so it counts from today.
 *   Before the first of those, the answer is 0: nothing had been reported yet.
 *
 * A moment after today is read as today. The plan is never consulted.
 */
export function reportedAt(t: ReplayTask, points: readonly ReportPoint[], offset: number, todayOffset: number): number {
  const at = Math.min(offset, todayOffset);
  let best: ReportPoint | null = null;
  for (const p of points) {
    if (p.taskId !== t.id || p.offset > at + 1e-9) continue;
    if (!best || p.offset >= best.offset) best = p;
  }
  let v = best ? clamp01(num(best.pct) / 100) : 0;
  if (t.actualEndOffset != null && t.actualEndOffset <= at + 1e-9) v = 1;
  if (at >= todayOffset - 1e-9 && hasUndatedReport(t)) {
    // Today: the schedule's own field is the newest thing reported, when it holds a number.
    if (t.status === 'done') v = 1;
    else if (num(t.progress) > 0) v = clamp01(num(t.progress) / 100);
  }
  return v;
}

export interface TaskMoment {
  /** Drawn solid. */
  solid: number;
  /** Drawn faint: the plan, where it is ahead of `solid`. Equal to `solid` when there is nothing more to show. */
  ghost: number;
}

/** What to draw for one task at one moment in one mode. */
export function taskMoment(t: ReplayTask, points: readonly ReportPoint[], offset: number, clock: ReplayClock, mode: ReplayMode): TaskMoment {
  const today = clock.todayOffset;
  const held = Math.min(offset, today);
  const solid = mode === 'planned' ? plannedAt(t, held) : reportedAt(t, points, held, today);
  if (offset <= today) return { solid, ghost: solid };
  return { solid, ghost: Math.max(solid, plannedAt(t, offset)) };
}

export type StageAmounts = Record<TaskStage, number | null>;

const emptyAmounts = (): StageAmounts => ({ demolition: null, framing: null, rough_in: null, insulation: null, drywall: null, finishes: null, other: null });

export interface RoomMoment {
  stage: RoomStage;
  /** Average of the room's tasks in each stage, 0 to 1. null when the room has no task in that stage. */
  solid: StageAmounts;
  ghost: StageAmounts;
  /** Average over every ticked task, 0 to 1. */
  overall: number;
  /** The stage a faint (planned) shape is showing, when one is ahead of what is solid. */
  ghostStage: RoomStage | null;
  /** How many ticked tasks have nothing reported. Only counted in Reported. */
  unreported: number;
  taskCount: number;
}

function pickStage(amounts: StageAmounts, taskCount: number, allDone: boolean): RoomStage {
  if (taskCount === 0) return 'no_tasks';
  if (allDone) return 'done';
  let top: BuildStage | null = null;
  for (const s of BUILD_STAGES) {
    const v = amounts[s];
    if (v != null && v > 0 && (top === null || stageOrder(s) > stageOrder(top))) top = s;
  }
  if (top) return top;
  if ((amounts.other ?? 0) > 0) return 'other';
  return 'not_started';
}

/** What one room shows at one moment: its stage, how far each stage has come, and what the plan shows ahead of it. */
export function roomMoment(tasks: readonly ReplayTask[], points: readonly ReportPoint[], offset: number, clock: ReplayClock, mode: ReplayMode): RoomMoment {
  const sumS = emptyAmounts();
  const sumG = emptyAmounts();
  const count: Record<TaskStage, number> = { demolition: 0, framing: 0, rough_in: 0, insulation: 0, drywall: 0, finishes: 0, other: 0 };
  let totalS = 0;
  let totalG = 0;
  let unreported = 0;
  for (const t of tasks) {
    const m = taskMoment(t, points, offset, clock, mode);
    sumS[t.stage] = (sumS[t.stage] ?? 0) + m.solid;
    sumG[t.stage] = (sumG[t.stage] ?? 0) + m.ghost;
    count[t.stage] += 1;
    totalS += m.solid;
    totalG += m.ghost;
    if (mode === 'reported' && !hasAnyReport(t, points)) unreported += 1;
  }
  const solid = emptyAmounts();
  const ghost = emptyAmounts();
  for (const k of Object.keys(count) as TaskStage[]) {
    if (count[k] > 0) {
      solid[k] = (sumS[k] as number) / count[k];
      ghost[k] = (sumG[k] as number) / count[k];
    }
  }
  const n = tasks.length;
  const stage = pickStage(solid, n, n > 0 && totalS >= n - 1e-9);
  const ghostPick = pickStage(ghost, n, n > 0 && totalG >= n - 1e-9);
  return {
    stage,
    solid,
    ghost,
    overall: n ? totalS / n : 0,
    ghostStage: totalG > totalS + 1e-9 && ghostPick !== stage ? ghostPick : null,
    unreported,
    taskCount: n,
  };
}

/**
 * What the walls of a room look like for a set of stage amounts, each 0 to 1.
 * A drawing rule, not a claim: it only decides which schematic layers show.
 *
 *   skin        the wall as it stood before any work. Comes off with demolition.
 *               With no demolition task it comes off when the first of framing,
 *               rough-in, insulation or drywall begins, and a room that starts
 *               from framing has none.
 *   studs       the frame. Follows framing when the room has a framing task,
 *               and is simply there once the skin is off when it has none.
 *   roughIn     pipes and wires in the open wall.
 *   insulation  batts in the open wall.
 *   board       new drywall. Follows drywall; with no drywall task the wall is
 *               shown closed once finishes begin.
 *   finish      trim, colour on the walls and the finished floor.
 */
export interface RoomLayers { skin: number; studs: number; roughIn: number; insulation: number; board: number; finish: number }

export function roomLayers(a: StageAmounts): RoomLayers {
  const v = (k: TaskStage): number => a[k] ?? 0;
  const opens = a.demolition != null || a.framing != null || a.rough_in != null || a.insulation != null || a.drywall != null;
  if (!opens) return { skin: 1, studs: 0, roughIn: 0, insulation: 0, board: 0, finish: v('finishes') };
  const begun = v('framing') > 0 || v('rough_in') > 0 || v('insulation') > 0 || v('drywall') > 0 || v('finishes') > 0;
  let skin: number;
  if (a.demolition != null) skin = 1 - v('demolition');
  else if (a.framing != null) skin = 0;
  else skin = begun ? 0 : 1;
  const board = a.drywall != null ? v('drywall') : (v('finishes') > 0 ? 1 : 0);
  return {
    skin: clamp01(skin),
    studs: a.framing != null ? v('framing') : 1,
    roughIn: v('rough_in'),
    insulation: v('insulation'),
    board: clamp01(board),
    finish: v('finishes'),
  };
}

// ── the clock and the weeks ──────────────────────────────────────────────────

/** How long the job runs, from every task in the schedule (not only the ticked ones). */
export function totalDaysOf(tasks: readonly Pick<ReplayTask, 'startDay' | 'durationDays'>[]): number {
  let end = 1;
  for (const t of tasks) end = Math.max(end, taskEndOffset(t));
  return end;
}

export function weekCount(clock: ReplayClock): number {
  return Math.max(1, Math.ceil(clock.totalDays / Math.max(1, clock.workingDaysPerWeek) - 1e-9));
}

/** The week a moment falls in, 1-indexed. */
export function weekOf(offset: number, clock: ReplayClock): number {
  const w = Math.ceil(offset / Math.max(1, clock.workingDaysPerWeek) - 1e-9);
  return Math.max(1, Math.min(weekCount(clock), w));
}

/** The moment at the END of a week. */
export function offsetOfWeek(week: number, clock: ReplayClock): number {
  return Math.max(0, Math.min(clock.totalDays, week * Math.max(1, clock.workingDaysPerWeek)));
}

// ── the room card ────────────────────────────────────────────────────────────

export interface RoomTaskRow {
  id: string;
  title: string;
  stage: TaskStage;
  startOffset: number;
  endOffset: number;
  /** 0 to 100, at today. null when nothing was reported: the row then says "No progress reported". */
  reportedPct: number | null;
  /** 0 to 100: where the plan says the task should be today. */
  plannedPctToday: number;
}

export interface RoomCard {
  rows: RoomTaskRow[];
  /** The first ticked task, in plan order, that is not reported finished. null when all are, or there are none. */
  next: RoomTaskRow | null;
}

export function roomCard(tasks: readonly ReplayTask[], points: readonly ReportPoint[], clock: ReplayClock): RoomCard {
  const rows: RoomTaskRow[] = [...tasks]
    .sort((p, q) => taskStartOffset(p) - taskStartOffset(q) || p.title.localeCompare(q.title))
    .map((t) => ({
      id: t.id,
      title: t.title,
      stage: t.stage,
      startOffset: taskStartOffset(t),
      endOffset: taskEndOffset(t),
      reportedPct: hasAnyReport(t, points) ? Math.round(reportedAt(t, points, clock.todayOffset, clock.todayOffset) * 100) : null,
      plannedPctToday: Math.round(plannedAt(t, clock.todayOffset) * 100),
    }));
  const next = rows.find((r) => (r.reportedPct ?? 0) < 100) ?? null;
  return { rows, next };
}
