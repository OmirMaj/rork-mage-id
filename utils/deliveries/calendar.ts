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
// is never counted.
//
// Pure: no React, no storage, no network, no clock.
import { addCalendarDays, parseCalendarDay, toCalendarDayString } from '../calendarDate';
import { isWorkingDayOfWeek } from '../cpm';

/** The two fields of a schedule that decide which days are worked. */
export interface WorkCalendar {
  workingDaysPerWeek?: number | null;
  nonWorkingDates?: readonly string[] | null;
}

/** How long a walk may run before it gives up (a calendar with no working day at all). */
const WALK_LIMIT_DAYS = 3660;

function weekOf(cal: WorkCalendar): number {
  const n = cal.workingDaysPerWeek;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 5;
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
