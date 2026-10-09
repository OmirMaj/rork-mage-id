// utils/livingModel/replayInput.ts — the schedule and the daily reports, cut
// down to what the replay reads.
//
// The one place calendar dates become the replay's working-day offsets, with
// the schedule's own calendar (utils/scheduleOps.scheduleDayNumberFor, the
// inverse of the engine's addWorkingDays). Everything it returns is plain data
// for utils/livingModel/replayCore.ts.
//
// DATES ARE LOCAL CALENDAR DAYS. A task's actual start and finish
// (ScheduleTask.actualStartDate / actualEndDate, stamped with toISOString() by
// utils/pace/stampActuals.ts) and a daily report's date (an instant from the
// screen, a bare day from older writers) are both read with
// utils/calendarDate.calendarDayStart: the LOCAL day the moment fell on. A task
// finished at 9 pm in New York is finished that day, though its UTC text
// already shows the next one. The stamped day numbers beside the dates
// (actualStartDay / actualEndDay) are not read: they are missing when the
// schedule had no start date at the time, and older ones are on two scales.
//
// A DAILY REPORT DATED AFTER TODAY DOES NOT COUNT: nothing after today has
// happened, so a report filed against a later day is left out until that day.
//
// It reads: each task's title, trade, start day, duration, progress, status and
// actual start and finish dates; and each daily report's per-task percent
// (DailyFieldReport.workProgress). It reads no money and writes nothing.

import type { DailyFieldReport, ProjectSchedule, ScheduleTask } from '@/types';
import { calendarDayStart, parseCalendarDay } from '@/utils/calendarDate';
import { tradeKeyForTask } from '@/utils/scheduleColors';
import { addWorkingDays } from '@/utils/scheduleEngine';
import { scheduleDayNumberFor } from '@/utils/scheduleOps';
import type { LinkTask } from './linkCore';
import { totalDaysOf, type ReplayClock, type ReplayTask, type ReportPoint } from './replayCore';
import { resolveStage, type StageAnswer, type TaskStage } from './stageCore';

export interface ReplayInput {
  tasks: ReplayTask[];
  linkTasks: LinkTask[];
  points: ReportPoint[];
  clock: ReplayClock;
  /** The first day of the schedule, when it has one. */
  startDate: Date | null;
  /** The schedule's own closed days ('YYYY-MM-DD'), so a date worked out here matches the schedule screen. */
  nonWorkingDates: string[];
  /** How each task's stage was decided ('person' = picked on the Tasks tab). */
  stageBy: Record<string, StageAnswer['by']>;
  /** Daily reports left out because they are dated after today. */
  futureReports: number;
}

/** The calendar day a working-day offset falls on, by the schedule's own calendar (its week and its closed days). null with no start date. */
export function dateOfOffset(input: Pick<ReplayInput, 'startDate' | 'clock' | 'nonWorkingDates'>, offset: number): Date | null {
  if (!input.startDate) return null;
  return addWorkingDays(input.startDate, Math.max(0, Math.round(offset)), input.clock.workingDaysPerWeek, input.nonWorkingDates);
}

function activeTasks(schedule: ProjectSchedule | null | undefined): ScheduleTask[] {
  if (!schedule) return [];
  const scenario = schedule.activeScenarioId ? schedule.scenarios?.find((s) => s.id === schedule.activeScenarioId) : undefined;
  const tasks = (scenario?.tasks ?? schedule.tasks ?? []) as ScheduleTask[];
  // A summary row's dates are its children's: it is not work in a room of its own.
  return tasks.filter((t) => !t.isSummary);
}

export function buildReplayInput(
  schedule: ProjectSchedule | null | undefined,
  reports: readonly DailyFieldReport[],
  now: Date,
  /** The stages a person picked on the Tasks tab (JobModel.stages). */
  chosenStages: Readonly<Record<string, TaskStage>> = {},
): ReplayInput {
  const src = activeTasks(schedule);
  const wpw = schedule?.workingDaysPerWeek && schedule.workingDaysPerWeek > 0 ? schedule.workingDaysPerWeek : 5;
  const nonWorking = schedule?.nonWorkingDates;
  const startDate = schedule?.startDate ? parseCalendarDay(schedule.startDate) : null;
  const start = startDate && !Number.isNaN(startDate.getTime()) ? startDate : null;

  /** The end of a calendar day as a working-day offset. null with no start date or no readable date. A full instant is read as the LOCAL day it fell on. */
  const offsetOf = (value: string | undefined | null): number | null => {
    if (!start || !value) return null;
    const d = calendarDayStart(value);
    if (!d || Number.isNaN(d.getTime())) return null;
    const day0 = new Date(start.getTime());
    day0.setHours(0, 0, 0, 0);
    const dd = new Date(d.getTime());
    dd.setHours(0, 0, 0, 0);
    if (dd.getTime() < day0.getTime()) return 0;
    return scheduleDayNumberFor(start, d, wpw, nonWorking);
  };

  const stageBy: Record<string, StageAnswer['by']> = {};
  const tasks: ReplayTask[] = src.map((t) => {
    const answer = resolveStage(t.title, tradeKeyForTask(t), chosenStages[t.id]);
    stageBy[t.id] = answer.by;
    return {
    id: t.id,
    title: t.title,
    stage: answer.stage,
    startDay: t.startDay,
    durationDays: t.durationDays,
    progress: typeof t.progress === 'number' ? t.progress : 0,
    status: t.status,
    actualStartOffset: t.actualStartDate ? offsetOf(t.actualStartDate) : null,
    actualEndOffset: t.actualEndDate ? offsetOf(t.actualEndDate) : null,
    };
  });
  const linkTasks: LinkTask[] = src.map((t) => ({ id: t.id, title: t.title, trade: tradeKeyForTask(t) }));

  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ids = new Set(tasks.map((t) => t.id));
  const points: ReportPoint[] = [];
  let futureReports = 0;
  for (const r of reports) {
    const day = calendarDayStart(r.date);
    if (day && day.getTime() > today0.getTime()) { futureReports += 1; continue; }
    const at = offsetOf(r.date);
    if (at == null) continue;
    for (const w of r.workProgress ?? []) {
      if (!ids.has(w.taskId) || typeof w.pct !== 'number' || !Number.isFinite(w.pct)) continue;
      points.push({ taskId: w.taskId, offset: at, pct: Math.max(0, Math.min(100, w.pct)) });
    }
  }

  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const clock: ReplayClock = {
    totalDays: totalDaysOf(tasks),
    workingDaysPerWeek: wpw,
    todayOffset: offsetOf(todayIso) ?? 0,
    hasStartDate: !!start,
  };
  return { tasks, linkTasks, points, clock, startDate: start, nonWorkingDates: nonWorking ?? [], stageBy, futureReports };
}
