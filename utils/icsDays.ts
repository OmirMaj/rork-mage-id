// utils/icsDays.ts — which CALENDAR DAY an exported .ics event falls on.
//
// Split out of utils/icsGenerator.ts (which imports react-native and the file
// system at module scope) so the day rules can be run, not just read, by
// scripts/validate-calendar-date.ts under four time zones.
//
// THE RULE (2026-10-06). An event in the exported calendar falls on the day
// the contractor sees for that record IN THE APP — never on the UTC date of a
// stored instant. The old helper did `new Date(t).toISOString().slice(0, 10)`
// on anything that was not a bare day: an invoice issued at 6 pm in New York
// and due in 30 days is stored as `…T22:00:00.000Z` … `…T02:00:00.000Z`
// depending on the season and the hour, and from 8 pm (7 pm in winter) its
// UTC date is the NEXT day — the calendar said "due the 5th" while every
// screen in the app said the 4th. East of Greenwich the same thing ran a day
// EARLY for anything saved before 9 am Tokyo time.
//
// Every event is all-day (`DTSTART;VALUE=DATE:YYYYMMDD`), which RFC 5545
// defines as a floating calendar date with no zone — so once the right day is
// chosen here, Apple / Google / Outlook show that same day in every zone.
//
// Pure. Relative imports only (bun validators load this).

import { calendarDayOf, parseCalendarDay, toCalendarDayString } from './calendarDate';

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day an invoice is due, as the app shows it: `Invoice.dueDate` is an
 * INSTANT (issue time + N days, app/invoice.tsx getDueDate), and THE OVERDUE
 * RULE (utils/calendarDate daysPastDue) reads it as the LOCAL day it fell on.
 * A bare 'YYYY-MM-DD' is that day as written. Null when it is neither.
 */
export function icsInvoiceDueDay(dueDate: string | null | undefined): string | null {
  return calendarDayOf(dueDate);
}

/**
 * The day a warranty ends, as the app shows it: `Warranty.endDate` is a
 * CALENDAR DAY that may come back from the server as that day at UTC midnight
 * ('2026-08-30T00:00:00.000Z'); app/warranties.tsx reads its date part
 * (parseCalendarDay), so the export does too — the same day in every zone.
 * Anything without a leading day ('Aug 30, 2026') is read as the local day
 * of whatever instant it parses to. Null when it is not a date at all.
 */
export function icsWarrantyEndDay(endDate: string | null | undefined): string | null {
  const day = parseCalendarDay(endDate);
  return day ? toCalendarDayString(day) : calendarDayOf(endDate);
}

/**
 * `days` calendar days after the bare day `iso`, as a bare day — the
 * EXCLUSIVE all-day DTEND is `icsAddDays(endDate, 1)`. Calendar arithmetic on
 * local components (never `+ 86_400_000`), so the days either side of a clock
 * change and the ends of months and years come out right in every zone. Null
 * when `iso` is not a real 'YYYY-MM-DD'.
 */
export function icsAddDays(iso: string, days: number): string | null {
  if (!BARE_DAY.test(iso)) return null;
  const d = parseCalendarDay(iso);
  if (!d) return null;
  return toCalendarDayString(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** '2026-04-24' → '20260424', the RFC 5545 DATE value. */
export function icsCompactDate(iso: string): string {
  return iso.replace(/-/g, '');
}
