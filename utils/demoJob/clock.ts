// utils/demoJob/clock.ts — the Demo Job's calendar (pure).
//
// "Today" is the device's local day when the owner taps Create. Everything in
// the demo is dated from it: the job started DATA_DAY - 1 working days earlier,
// so the demo is always "in month 11 of an 18-month job" whenever it is made.
//
// A schedule day is a WORKING-DAY ORDINAL, 1-based, Monday to Friday, exactly
// as utils/scheduleEngine reads `startDay` (day 1 is the start date itself).
// Local calendar days only (utils/calendarDate): never a UTC date key.
import { addCalendarDays, parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

/** The working-day ordinal that "today" is on the demo's schedule. */
export const DATA_DAY = 228;

const isWorkday = (d: Date): boolean => d.getDay() !== 0 && d.getDay() !== 6;

export interface DemoClock {
  /** 'YYYY-MM-DD', the device's local day at creation. */
  today: string;
  /** The last working day on or before today: the schedule's data date. */
  dataDate: string;
  /** Schedule day 1. */
  startDate: string;
  /** The calendar day of a working-day ordinal (1 = startDate). Any integer. */
  dayOf: (ordinal: number) => string;
  /** A local-time instant on a working-day ordinal, as ISO. */
  at: (ordinal: number, hour?: number, minute?: number) => string;
  /** A local-time instant on a calendar day, as ISO. */
  atDay: (day: string, hour?: number, minute?: number) => string;
  /** A calendar day `n` calendar days from today (negative = before). */
  fromToday: (n: number) => string;
}

function stepWorkdays(from: Date, steps: number): Date {
  let d = from;
  let left = Math.abs(steps);
  const dir = steps < 0 ? -1 : 1;
  while (left > 0) {
    d = addCalendarDays(d, dir);
    if (isWorkday(d)) left -= 1;
  }
  return d;
}

export function makeDemoClock(todayDay: string): DemoClock {
  const parsed = parseCalendarDay(todayDay);
  if (!parsed) throw new Error('makeDemoClock needs a YYYY-MM-DD day');
  let data = parsed;
  while (!isWorkday(data)) data = addCalendarDays(data, -1);
  const start = stepWorkdays(data, -(DATA_DAY - 1));
  const dayDate = (ordinal: number): Date => stepWorkdays(start, Math.round(ordinal) - 1);
  const iso = (d: Date, hour: number, minute: number): string =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).toISOString();
  return {
    today: toCalendarDayString(parsed),
    dataDate: toCalendarDayString(data),
    startDate: toCalendarDayString(start),
    dayOf: (ordinal) => toCalendarDayString(dayDate(ordinal)),
    at: (ordinal, hour = 9, minute = 0) => iso(dayDate(ordinal), hour, minute),
    atDay: (day, hour = 9, minute = 0) => iso(parseCalendarDay(day) ?? parsed, hour, minute),
    fromToday: (n) => toCalendarDayString(addCalendarDays(parsed, n)),
  };
}
