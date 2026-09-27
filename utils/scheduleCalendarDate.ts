// utils/scheduleCalendarDate.ts — ONE way for a non-engine reader to turn a
// stored `ScheduleTask.startDay` into a date on the calendar.
//
// WHY THIS EXISTS. `startDay` is a WORKING-DAY ORDINAL (day 1 = the schedule's
// start date, and only working days consume a number — see "THE TWO DAY-NUMBER
// SCALES" in utils/cpm.ts). Five readers outside the engine treated it as a
// CALENDAR offset (`start + (startDay - 1) * 86400000`): the weather
// reschedule, the Gantt weather badge, the COI-before-on-site follow-up, the
// Smart Inbox "Starts today" row and the schedule-ical feed. On a Mon-Fri week
// from Mon 2026-03-02, working day 16 is Mon Mar 23 — those readers said Tue
// Mar 17, and could land on a Saturday.
//
// HOW IT READS A SCHEDULE — the same way the engine does, not a third way:
//   • `startDay` is ALWAYS a working ordinal. `runCpmForCalendar` and every
//     `runCpm` call with a `scheduleStartDate` convert it at the `pins` line
//     regardless of `ProjectSchedule.startDayBasis`; that flag only records
//     that the user answered the legacy-scale notice (StartDayBasisNotice) and
//     changes nothing about how the numbers are read. It is accepted here so a
//     caller can hand the schedule's calendar across unchanged, and ignored for
//     the same reason the engine ignores it.
//   • No `startDate` ⇒ the engine runs in RAW-DAY mode, where the two scales
//     are the same numbers and no weekday is known. This helper returns null
//     there; a caller that has its own fallback anchor (Schedule Pro's
//     createdAt) keeps its raw calendar-offset reading, which IS what the
//     engine does for that schedule.
//   • `workingDaysPerWeek` absent ⇒ 5, the same default as
//     `cpm.runCpmForCalendar` and Schedule Pro (`?? 5`). The field is required
//     on ProjectSchedule, so this only matters for malformed rows.
//
// The date walk is `scheduleEngine.addWorkingDays` (what getTaskDateRange, the
// CSV export and icsGenerator render with) and "which working day is today" is
// `scheduleOps.scheduleDayNumberFor` — reused, not re-derived.
//
// PURE — no React, no clock (callers pass `now`). Runs under bun
// (scripts/validate-health-scheddays.ts).

import type { ScheduleTask } from '@/types';
import { addWorkingDays } from '@/utils/scheduleEngine';
import { scheduleDayNumberFor } from '@/utils/scheduleOps';
import { parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

/** The four fields of a ProjectSchedule that decide where a startDay lands. */
export interface ScheduleCalendar {
  /** 'YYYY-MM-DD' anchor (day 1). Absent ⇒ raw-day mode ⇒ no dates. */
  startDate?: string | null;
  workingDaysPerWeek?: number | null;
  nonWorkingDates?: readonly string[] | null;
  /** Accepted, deliberately not read — see the header. */
  startDayBasis?: 'workingOrdinal';
}

/** Pull the calendar off anything shaped like a ProjectSchedule. */
export function scheduleCalendarOf(
  schedule: {
    startDate?: string | null;
    workingDaysPerWeek?: number | null;
    nonWorkingDates?: readonly string[] | null;
    startDayBasis?: 'workingOrdinal';
  } | null | undefined,
): ScheduleCalendar | undefined {
  if (!schedule) return undefined;
  return {
    startDate: schedule.startDate ?? undefined,
    workingDaysPerWeek: schedule.workingDaysPerWeek ?? undefined,
    nonWorkingDates: schedule.nonWorkingDates ?? undefined,
    startDayBasis: schedule.startDayBasis,
  };
}

function wdOf(cal: ScheduleCalendar): number {
  const wd = cal.workingDaysPerWeek;
  return typeof wd === 'number' && Number.isFinite(wd) && wd > 0 ? wd : 5;
}

function closuresOf(cal: ScheduleCalendar): string[] | undefined {
  return cal.nonWorkingDates && cal.nonWorkingDates.length > 0 ? [...cal.nonWorkingDates] : undefined;
}

/** Local-midnight Date of the anchor, or null in raw-day mode / bad data. */
export function scheduleAnchorDate(cal: ScheduleCalendar | null | undefined): Date | null {
  if (!cal?.startDate) return null;
  return parseCalendarDay(cal.startDate);
}

/**
 * The calendar date of working ordinal `startDay`, advanced by
 * `offsetWorkingDays` further WORKING days. Offset 0 is the task's first day;
 * offset `durationDays - 1` is its last. Every date this returns is a working
 * day of the schedule (except day 1 itself when the anchor sits on a closed
 * day — `addWorkingDays(start, 0)` is `start`, and the engine agrees).
 *
 * Returns null when the schedule has no anchor or `startDay` is not a number.
 */
export function taskCalendarDate(
  cal: ScheduleCalendar | null | undefined,
  startDay: number | null | undefined,
  offsetWorkingDays = 0,
): Date | null {
  const anchor = scheduleAnchorDate(cal);
  if (!anchor || !cal) return null;
  if (typeof startDay !== 'number' || !Number.isFinite(startDay)) return null;
  const ordinal = Math.max(1, Math.floor(startDay));
  const offset = Math.max(0, Math.floor(Number.isFinite(offsetWorkingDays) ? offsetWorkingDays : 0));
  return addWorkingDays(anchor, ordinal - 1 + offset, wdOf(cal), closuresOf(cal));
}

/** {@link taskCalendarDate} as a local 'YYYY-MM-DD', or null. */
export function taskCalendarDay(
  cal: ScheduleCalendar | null | undefined,
  startDay: number | null | undefined,
  offsetWorkingDays = 0,
): string | null {
  const d = taskCalendarDate(cal, startDay, offsetWorkingDays);
  return d ? toCalendarDayString(d) : null;
}

/**
 * "Which working day is the job on today?" on the `startDay` scale, so it can
 * be compared with a stored `startDay` directly. A date on/before the anchor is
 * 1; a weekend or closure folds back onto the working day before it
 * (`scheduleOps.scheduleDayNumberFor` semantics). In raw-day mode (no anchor)
 * there is no working scale to be on — returns 1, the "nothing is in the past"
 * floor; callers with their own raw anchor count calendar days themselves.
 */
export function todayWorkingOrdinal(cal: ScheduleCalendar | null | undefined, now: Date): number {
  const anchor = scheduleAnchorDate(cal);
  if (!anchor || !cal) return 1;
  return scheduleDayNumberFor(anchor, now, wdOf(cal), closuresOf(cal));
}

/**
 * Smart Inbox "Starts today". The not-started tasks whose PINNED start
 * (stored working ordinal, walked on the schedule's own calendar) is `today`.
 * Pinned, not the CPM early start: the inbox hook runs no engine, and this is
 * the date the schedule list prints beside the task. Never fires on a weekend
 * or closure on a schedule that does not work it, because no working ordinal
 * lands there.
 */
export function tasksStartingOn<T extends Pick<ScheduleTask, 'startDay' | 'status'>>(
  cal: ScheduleCalendar | null | undefined,
  tasks: readonly T[] | null | undefined,
  today: Date,
): { task: T; startsOn: Date }[] {
  if (!scheduleAnchorDate(cal)) return [];
  const todayIso = toCalendarDayString(today);
  const out: { task: T; startsOn: Date }[] = [];
  for (const task of tasks ?? []) {
    if (task.status !== 'not_started') continue;
    const d = taskCalendarDate(cal, task.startDay);
    if (d && toCalendarDayString(d) === todayIso) out.push({ task, startsOn: d });
  }
  return out;
}
