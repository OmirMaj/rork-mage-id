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
 * Human label for a calendar day — 'Aug 30, 2026' by default; pass `options`
 * for another shape ({ weekday: 'short', month: 'short', day: 'numeric' }).
 *
 * Unparseable input is returned UNCHANGED rather than replaced with a dash:
 * showing the reader the raw value is honest, and hiding it makes a data bug
 * invisible. Empty input yields ''; callers already gate on truthiness.
 */
export function formatCalendarDay(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  if (!value) return '';
  const d = parseCalendarDay(value);
  if (!d) return value;
  return d.toLocaleDateString('en-US', options);
}

/**
 * The inverse of parseCalendarDay: a Date's LOCAL year/month/day as
 * 'YYYY-MM-DD'. Never `toISOString().slice(0, 10)` — that re-projects the
 * instant into UTC and names TOMORROW from about 5–7 pm anywhere west of
 * Greenwich (and yesterday in the small hours east of it).
 */
export function toCalendarDayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's calendar day from LOCAL components (audit UX-F3/F11: the
 *  `new Date().toISOString().slice(0, 10)` idiom stamped evening records with
 *  tomorrow's date). */
export function todayCalendarDay(now: Date = new Date()): string {
  return toCalendarDayString(now);
}

/**
 * `months` calendar months after the day named by `value`, as a calendar day.
 * The day-of-month is CLAMPED to the target month's length: Jan 31 + 1 month
 * is Feb 28 (Feb 29 in a leap year), not Mar 3 — which is what a bare
 * `setMonth()` produces by overflowing the 31st into the next month. Warranty
 * terms are written this way (B4 review item 1: app/warranties.tsx stored
 * '2026-03-03' for a one-month warranty starting Jan 31). Null when `value` is
 * not a calendar day.
 */
export function addCalendarMonths(value: string | null | undefined, months: number): string | null {
  const d = parseCalendarDay(value);
  if (!d) return null;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return toCalendarDayString(d);
}

/**
 * The calendar day `days` days after `d` (negative for before), from LOCAL
 * components — never `getTime() + days * 86_400_000`, which lands an hour
 * short on the day US DST ends and names the previous day from then on.
 */
export function addCalendarDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/**
 * The calendar day a stored value names, for fields that hold EITHER shape:
 * a bare 'YYYY-MM-DD' is returned as-is, while a full ISO instant becomes
 * the LOCAL day it fell on (the day the record was made, not its UTC date —
 * an invoice issued at 9 pm in Denver is a Sep 4 invoice, though its
 * toISOString() starts with Sep 5). Null when it is neither. Used where a
 * screen receives an instant from one writer and a day from another
 * (lien-waiver through-dates, the "today's draft" DFR match).
 */
export function calendarDayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (CALENDAR_DAY.test(value)) return parseCalendarDay(value) ? value : null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? toCalendarDayString(instant) : null;
}

/**
 * LOCAL midnight of the day `value` names — the Date form of calendarDayOf:
 * a bare 'YYYY-MM-DD' is that day, a full instant is the local day it fell
 * on. Null when neither. For readers of a MIXED-shape field that compare or
 * format days (RFI.dateRequired: bare from the voice/photo writers and the
 * two-week default, noon UTC from DatePickerModal). `new Date(value)` read
 * the bare shape as UTC midnight — the previous evening west of Greenwich —
 * while a blanket parseCalendarDay would read a true instant by its UTC date
 * part, a day early east of Greenwich. This does neither (B4 review A2).
 */
export function calendarDayStart(value: string | null | undefined): Date | null {
  const day = calendarDayOf(value);
  return day ? parseCalendarDay(day) : null;
}

/**
 * Whole calendar days from local "today" to the day named by `value`:
 * 0 = today, 1 = tomorrow, negative = already past. Null when `value` is not a
 * calendar day. Computed on the UTC day grid of the LOCAL components, so a DST
 * change between the two days cannot produce a 23- or 25-hour "day" that
 * floors to the wrong count.
 */
export function daysUntilCalendarDay(value: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseCalendarDay(value);
  if (!d) return null;
  const target = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}
