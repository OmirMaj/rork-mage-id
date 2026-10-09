// utils/livingModel/replayInput.ts — the schedule and the daily reports, cut
// down to what the replay reads.
//
// The one place calendar dates become the replay's working-day offsets, with
// the schedule's own calendar (utils/scheduleOps.scheduleDayNumberFor, the
// inverse of the engine's addWorkingDays). Everything it returns is plain data
// for utils/livingModel/replayCore.ts.
//
// It reads: each task's title, trade, start day, duration, progress, status and
// actual start and finish dates; and each daily report's per-task percent
// (DailyFieldReport.workProgress). It reads no money and writes nothing.

import type { DailyFieldReport, ProjectSchedule, ScheduleTask } from '@/types';
import { parseCalendarDay } from '@/utils/calendarDate';
import { tradeKeyForTask } from '@/utils/scheduleColors';
import { scheduleDayNumberFor } from '@/utils/scheduleOps';
import type { LinkTask } from './linkCore';
import { totalDaysOf, type ReplayClock, type ReplayTask, type ReportPoint } from './replayCore';
import { stageForTask } from './stageCore';

export interface ReplayInput {
  tasks: ReplayTask[];
  linkTasks: LinkTask[];
  points: ReportPoint[];
  clock: ReplayClock;
  /** The first day of the schedule, when it has one. */
  startDate: Date | null;
}

function activeTasks(schedule: ProjectSchedule | null | undefined): ScheduleTask[] {
  if (!schedule) return [];
  const scenario = schedule.activeScenarioId ? schedule.scenarios?.find((s) => s.id === schedule.activeScenarioId) : undefined;
  const tasks = (scenario?.tasks ?? schedule.tasks ?? []) as ScheduleTask[];
  // A summary row's dates are its children's: it is not work in a room of its own.
  return tasks.filter((t) => !t.isSummary);
}

export function buildReplayInput(schedule: ProjectSchedule | null | undefined, reports: readonly DailyFieldReport[], now: Date): ReplayInput {
  const src = activeTasks(schedule);
  const wpw = schedule?.workingDaysPerWeek && schedule.workingDaysPerWeek > 0 ? schedule.workingDaysPerWeek : 5;
  const nonWorking = schedule?.nonWorkingDates;
  const startDate = schedule?.startDate ? parseCalendarDay(schedule.startDate) : null;
  const start = startDate && !Number.isNaN(startDate.getTime()) ? startDate : null;

  /** The end of a calendar day as a working-day offset. null with no start date or no readable date. */
  const offsetOf = (iso: string | undefined | null): number | null => {
    if (!start || !iso) return null;
    const d = parseCalendarDay(iso.slice(0, 10));
    if (!d || Number.isNaN(d.getTime())) return null;
    const day0 = new Date(start.getTime());
    day0.setHours(0, 0, 0, 0);
    const dd = new Date(d.getTime());
    dd.setHours(0, 0, 0, 0);
    if (dd.getTime() < day0.getTime()) return 0;
    return scheduleDayNumberFor(start, d, wpw, nonWorking);
  };

  const tasks: ReplayTask[] = src.map((t) => ({
    id: t.id,
    title: t.title,
    stage: stageForTask(t.title, tradeKeyForTask(t)).stage,
    startDay: t.startDay,
    durationDays: t.durationDays,
    progress: typeof t.progress === 'number' ? t.progress : 0,
    status: t.status,
    actualStartOffset: t.actualStartDate ? offsetOf(t.actualStartDate) : null,
    actualEndOffset: t.actualEndDate ? offsetOf(t.actualEndDate) : null,
  }));
  const linkTasks: LinkTask[] = src.map((t) => ({ id: t.id, title: t.title, trade: tradeKeyForTask(t) }));

  const ids = new Set(tasks.map((t) => t.id));
  const points: ReportPoint[] = [];
  for (const r of reports) {
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
  return { tasks, linkTasks, points, clock, startDate: start };
}
