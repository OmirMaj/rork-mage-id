// utils/calendarDate.ts — formatting for CALENDAR DAYS (due dates, applied
// dates, warranty start/end), as opposed to instants.
//
// Why this exists: several domain fields are DECLARED 'YYYY-MM-DD' but come
// back from Supabase as a full ISO timestamp ('2026-08-30T00:00:00.000Z').
// Screens that printed the raw field showed one thing for a locally created
// record and another for the same record after a sync. Each screen that did
// format grew its own local helper (app/warranties.tsx, app/permits.tsx), and
// all of them used `new Date(value)`, which the spec parses a bare
// 'YYYY-MM-DD' as UTC midnight — so in any negative-offset zone the label
// renders the PREVIOUS day. A due date is a day on a calendar, not a moment,
// and must not move when the reader changes timezone.

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse the calendar-day prefix of `value` into a Date at LOCAL midnight.
 *
 * Accepts a bare 'YYYY-MM-DD' or anything that starts with one (a full ISO
 * timestamp is truncated to its date part — the same normalisation the punch
 * list and permit edit forms apply with `.slice(0, 10)`).
 *
 * Returns null when the prefix is not a real calendar day. Note that the Date
 * constructor ROLLS OVER out-of-range components — `new Date(2026, 12, 45)`
 * is a valid Date in February 2027, not NaN — so the components are
 * round-tripped rather than trusting `getTime()`.
 */
export function parseCalendarDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = CALENDAR_DAY.exec(value.slice(0, 10));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * Human label for a calendar day — 'Aug 30, 2026'.
 *
 * Unparseable input is returned UNCHANGED rather than replaced with a dash:
 * showing the reader the raw value is honest, and hiding it makes a data bug
 * invisible. Empty input yields ''; callers already gate on truthiness.
 */
export function formatCalendarDay(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseCalendarDay(value);
  if (!d) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
