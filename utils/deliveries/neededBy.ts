// utils/deliveries/neededBy.ts — Needed On Site By, WORKED OUT ON EVERY READ
// (lane DELIVERIES-1, Deliveries That Follow The Schedule).
//
// THE ONE RULE. A delivery linked to a schedule task is needed on site a number
// of WORKING days before that task starts:
//
//     Needed On Site By = the task's start date, stepped back `bufferDays`
//                         worked days on the schedule's own calendar
//                         (its working days per week and its non-working dates)
//
// It is NEVER stored. There is no column, no AsyncStorage field and no cache on
// disk that holds it, so there is no hook to fire when a task moves and nothing
// that can act without the person: the task moves, the next read gives a new
// date. scripts/validate-deliveries-schedule.ts fails the build if any writer
// in the lane names a needed-by field.
//
// THE TASK'S START IS THE DAY THE SCHEDULE DRAWS. `ScheduleTask.startDay` is a
// PIN (a minimum the person authored), not where the task sits: the engine
// pushes a task later when a predecessor grows (utils/scheduleOps §0d). So the
// start is read from runCpm with the same three calendar options the phone's
// schedule screen passes (components/schedule/mobile/MobileScheduleScreen),
// through scheduleOps.scheduledTaskRange, and falls back to walking the pin
// only for a task the engine could not place (a cycle).
//
// NO START DATE, NO DATE. An undated schedule has real working-day numbers and
// no calendar position (scheduleOps "THERE IS NO FALLBACK ANCHOR"). Needed On
// Site By is then '' with the reason 'schedule_undated'. Never today plus N.
//
// Pure: no React, no storage, no network, no clock.
import type { ScheduleTask } from '@/types';
import { runCpm } from '@/utils/cpm';
import { resolveScheduleAnchor, scheduledPlacements, scheduledTaskRange } from '@/utils/scheduleOps';
import { toCalendarDayString } from '@/utils/calendarDate';
import type { Delivery } from '@/utils/deliverySchedule';
import { stepWorkingDays, type WorkCalendar } from './calendar';

/** The buffer a delivery gets when the person has not chosen one: 2 working days. */
export const DEFAULT_BUFFER_WORKING_DAYS = 2;
/** The most working days a buffer may be (the column's own check). */
export const MAX_BUFFER_WORKING_DAYS = 60;

/** The part of a ProjectSchedule this lane reads. */
export interface ScheduleForDeliveries extends WorkCalendar {
  startDate?: string | null;
  tasks?: readonly ScheduleTask[] | null;
}

export interface TaskDays {
  id: string;
  title: string;
  /** The task's first day as the schedule draws it (YYYY-MM-DD). */
  start: string;
  /** Its last day. */
  finish: string;
}

export interface ScheduleDays {
  /** False when the schedule has no start date: no task has a calendar day. */
  dated: boolean;
  byTask: ReadonlyMap<string, TaskDays>;
  /** True when the engine reported a dependency cycle (the starts of tasks in it are the stored pins). */
  hasCycle: boolean;
}

const EMPTY: ScheduleDays = { dated: false, byTask: new Map(), hasCycle: false };
const cache = new WeakMap<readonly ScheduleTask[], { key: string; days: ScheduleDays }>();

/** The buffer in force for a delivery: its own when it is a whole number from 0 to 60, the default otherwise. */
export function bufferDaysOf(delivery: Pick<Delivery, 'bufferDays'>): number {
  const n = delivery.bufferDays;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_BUFFER_WORKING_DAYS;
  const whole = Math.round(n);
  return whole < 0 || whole > MAX_BUFFER_WORKING_DAYS ? DEFAULT_BUFFER_WORKING_DAYS : whole;
}

/**
 * Every task's first and last calendar day, as the schedule draws them. One
 * engine run per schedule, remembered in memory only for as long as the same
 * task list and calendar are asked about.
 */
export function scheduleDays(schedule: ScheduleForDeliveries | null | undefined): ScheduleDays {
  const tasks = schedule?.tasks;
  if (!schedule || !tasks || tasks.length === 0) return EMPTY;
  const anchor = resolveScheduleAnchor(schedule);
  if (!anchor.dated || !anchor.date || !anchor.iso) return EMPTY;
  const key = `${anchor.iso}|${schedule.workingDaysPerWeek ?? ''}|${(schedule.nonWorkingDates ?? []).join(',')}`;
  const hit = cache.get(tasks);
  if (hit && hit.key === key) return hit.days;

  const nonWorking = schedule.nonWorkingDates ? [...schedule.nonWorkingDates] : undefined;
  const week = schedule.workingDaysPerWeek ?? undefined;
  const cpm = runCpm(tasks as ScheduleTask[], { scheduleStartDate: anchor.iso, workingDaysPerWeek: week, nonWorkingDates: nonWorking });
  const placed = scheduledPlacements(cpm, true);
  const byTask = new Map<string, TaskDays>();
  for (const t of tasks) {
    if (!t || typeof t.id !== 'string') continue;
    const range = scheduledTaskRange(t, placed.get(t.id), anchor.date, week, nonWorking);
    byTask.set(t.id, { id: t.id, title: t.title ?? '', start: toCalendarDayString(range.start), finish: toCalendarDayString(range.end) });
  }
  const days: ScheduleDays = { dated: true, byTask, hasCycle: cpm.conflicts.some((c) => c.kind === 'cycle') };
  cache.set(tasks, { key, days });
  return days;
}

export type NeededByBasis =
  /** Worked out from the task: its start, less the buffer. */
  | { kind: 'task'; taskId: string; taskTitle: string; taskStart: string; taskFinish: string; bufferDays: number }
  /** No date, and why. Never a guess. */
  | { kind: 'none'; why: 'no_task' | 'no_schedule' | 'schedule_undated' | 'task_removed' };

export interface NeededBy {
  /** 'YYYY-MM-DD', or '' when there is no date to give. */
  date: string;
  basis: NeededByBasis;
}

/**
 * Needed On Site By for one delivery, from today's schedule. Read it every
 * time; never keep the answer.
 */
export function neededOnSiteBy(
  delivery: Pick<Delivery, 'taskId' | 'bufferDays'>,
  schedule: ScheduleForDeliveries | null | undefined,
): NeededBy {
  const taskId = (delivery.taskId ?? '').trim();
  if (!taskId) return { date: '', basis: { kind: 'none', why: 'no_task' } };
  if (!schedule || !schedule.tasks || schedule.tasks.length === 0) return { date: '', basis: { kind: 'none', why: 'no_schedule' } };
  const exists = schedule.tasks.some((t) => t && t.id === taskId);
  if (!exists) return { date: '', basis: { kind: 'none', why: 'task_removed' } };
  const days = scheduleDays(schedule);
  if (!days.dated) return { date: '', basis: { kind: 'none', why: 'schedule_undated' } };
  const task = days.byTask.get(taskId);
  if (!task) return { date: '', basis: { kind: 'none', why: 'task_removed' } };
  const bufferDays = bufferDaysOf(delivery);
  const date = stepWorkingDays(task.start, -bufferDays, schedule);
  return { date, basis: { kind: 'task', taskId, taskTitle: task.title, taskStart: task.start, taskFinish: task.finish, bufferDays } };
}

/** The needed-by date a GIVEN task start would give with this delivery's buffer. Used to show "was" beside "now"; never stored. */
export function neededByForStart(delivery: Pick<Delivery, 'bufferDays'>, taskStart: string, calendar: WorkCalendar): string {
  return stepWorkingDays(taskStart, -bufferDaysOf(delivery), calendar);
}
