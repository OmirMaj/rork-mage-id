// utils/deliveries/calendar.ts — working-day arithmetic on LOCAL calendar days
// (lane DELIVERIES-1, Deliveries That Follow The Schedule).
//
// Every date in and out is a 'YYYY-MM-DD' calendar day. Nothing here parses a
// bare day with `new Date('2026-11-13')` (that is UTC midnight, the day before
// in every American time zone) and nothing slices an ISO instant: days go
// through utils/calendarDate (parseCalendarDay, toCalendarDayString,
// addCalendarDays), which work on local midnight.
//
// THE WORKING-DAY RULE IS THE SCHEDULE'S OWN: cpm.isWorkingDayOfWeek (the one
// weekend rule the engine, addWorkingDays and scheduleDayNumberFor share) plus
// the schedule's nonWorkingDates. A 6-day week counts Saturdays; a closed day
// is never counted. A schedule that does not SAY how many days it works is
// counted the way the engine counts it (cpm.ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK,
// the constant runCpm itself falls back to), never on a default of this file's
// own: a second default here once made Needed On Site By step back over a
// weekend the drawn schedule was working.
//
// Pure: no React, no storage, no network, no clock.
import { addCalendarDays, parseCalendarDay, toCalendarDayString } from '../calendarDate';
import { ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK, isWorkingDayOfWeek } from '../cpm';

/** The two fields of a schedule that decide which days are worked. */
export interface WorkCalendar {
  workingDaysPerWeek?: number | null;
  nonWorkingDates?: readonly string[] | null;
}

/** How long a walk may run before it gives up (a calendar with no working day at all). */
const WALK_LIMIT_DAYS = 3660;

/** The schedule's working week, exactly as the engine reads it: `workingDaysPerWeek ?? the engine's default`. */
export function weekOf(cal: WorkCalendar): number {
  return cal.workingDaysPerWeek ?? ENGINE_DEFAULT_WORKING_DAYS_PER_WEEK;
}

function closedSet(cal: WorkCalendar): ReadonlySet<string> | null {
  const list = cal.nonWorkingDates;
  return list && list.length > 0 ? new Set(list) : null;
}

/** True when `day` (a local calendar day) is worked on this calendar. */
export function isWorkedDay(day: string, cal: WorkCalendar): boolean {
  const d = parseCalendarDay(day);
  if (!d) return false;
  if (!isWorkingDayOfWeek(d.getDay(), weekOf(cal))) return false;
  const closed = closedSet(cal);
  return !(closed && closed.has(toCalendarDayString(d)));
}

/**
 * `day` moved by `n` WORKING days: negative steps back, positive forward, 0
 * returns the day unchanged (even when it is a closed day: zero steps is zero
 * steps). Each step lands on a worked day. '' when the day cannot be read.
 */
export function stepWorkingDays(day: string, n: number, cal: WorkCalendar): string {
  const start = parseCalendarDay(day);
  if (!start) return '';
  const steps = Math.trunc(Number.isFinite(n) ? n : 0);
  if (steps === 0) return toCalendarDayString(start);
  const dir = steps > 0 ? 1 : -1;
  const week = weekOf(cal);
  const closed = closedSet(cal);
  let cur = start;
  let left = Math.abs(steps);
  let walked = 0;
  while (left > 0) {
    if (++walked > WALK_LIMIT_DAYS) return '';
    cur = addCalendarDays(cur, dir);
    if (!isWorkingDayOfWeek(cur.getDay(), week)) continue;
    if (closed && closed.has(toCalendarDayString(cur))) continue;
    left--;
  }
  return toCalendarDayString(cur);
}

/**
 * Signed count of WORKED days from `from` to `to`: the worked days in
 * (from, to] when `to` is later, minus the worked days in (to, from] when it
 * is earlier, 0 on the same day. So Fri to the next Mon is 1 on a 5-day week,
 * and stepWorkingDays(from, workingDaysFromTo(from, to)) is `to` whenever `to`
 * is a worked day. Null when either day cannot be read.
 */
export function workingDaysFromTo(from: string, to: string, cal: WorkCalendar): number | null {
  const a = parseCalendarDay(from);
  const b = parseCalendarDay(to);
  if (!a || !b) return null;
  if (a.getTime() === b.getTime()) return 0;
  const forward = b.getTime() > a.getTime();
  const lo = forward ? a : b;
  const hi = forward ? b : a;
  const week = weekOf(cal);
  const closed = closedSet(cal);
  let count = 0;
  let cur = lo;
  let walked = 0;
  while (cur.getTime() < hi.getTime()) {
    if (++walked > WALK_LIMIT_DAYS * 4) break;
    cur = addCalendarDays(cur, 1);
    if (!isWorkingDayOfWeek(cur.getDay(), week)) continue;
    if (closed && closed.has(toCalendarDayString(cur))) continue;
    count++;
  }
  return forward ? count : -count;
}

/** The first worked day strictly after `day`. '' when the day cannot be read. */
export function nextWorkedDayAfter(day: string, cal: WorkCalendar): string {
  return stepWorkingDays(day, 1, cal);
}

/**
 * THE ONE RULE BETWEEN A SUPPLIER DATE AND A TASK'S START (the flag and the
 * proposal both stand on it):
 *
 *     a supplier date raises NO flag  when  supplierDate <= start stepped back
 *                                           `bufferDays` worked days
 *                                           (that day is Needed On Site By)
 *
 * This is the EARLIEST start that raises no flag for `supplierDate`: the first
 * worked day whose Needed On Site By is on or after the supplier date. So a
 * supplier date that raises no flag today gives a day on or before today's
 * start (nothing to propose), and the first date that does raise one gives
 * the smallest move that clears it.
 *   buffer 0: the supplier date itself (the next worked day when it is closed)
 *   buffer 1: the worked day after it
 *   buffer 3: three worked days after it
 * '' when the day cannot be read or the calendar has no worked day.
 */
export function earliestStartFor(supplierDate: string, bufferDays: number, cal: WorkCalendar): string {
  const supplier = dayOrEmpty(supplierDate);
  if (!supplier) return '';
  const buffer = Math.max(0, Math.trunc(Number.isFinite(bufferDays) ? bufferDays : 0));
  let start = isWorkedDay(supplier, cal) ? supplier : nextWorkedDayAfter(supplier, cal);
  for (let i = 0; start && i <= WALK_LIMIT_DAYS; i++) {
    const needed = stepWorkingDays(start, -buffer, cal);
    if (!needed) return '';
    if ((compareDays(needed, supplier) ?? -1) >= 0) return start;
    start = nextWorkedDayAfter(start, cal);
  }
  return '';
}

/** `day` moved by `n` CALENDAR days (suppliers quote lead times in calendar days and weeks). */
export function stepCalendarDays(day: string, n: number): string {
  const d = parseCalendarDay(day);
  if (!d) return '';
  return toCalendarDayString(addCalendarDays(d, Math.trunc(Number.isFinite(n) ? n : 0)));
}

/** -1, 0 or 1 for two calendar days; null when either cannot be read. */
export function compareDays(a: string, b: string): number | null {
  const x = parseCalendarDay(a);
  const y = parseCalendarDay(b);
  if (!x || !y) return null;
  return x.getTime() === y.getTime() ? 0 : x.getTime() < y.getTime() ? -1 : 1;
}

/** A value that is a readable calendar day, as 'YYYY-MM-DD'; '' otherwise. */
export function dayOrEmpty(value: string | null | undefined): string {
  const d = parseCalendarDay(value ?? null);
  return d ? toCalendarDayString(d) : '';
}
