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
//
// LANGUAGE (docs/I18N.md §6): formatCalendarDay takes `lang` (default: the
// app language, i18n getLang()). English is the unchanged en-US path; Spanish
// renders from our own tables (i18n/dateEs.ts), never numeric. Relative
// imports and no React Native: bun validators and the Hermes gate load this.
//
// PHASE 1 GATE (review, fix round 1) — before LANGUAGE_PICKER_ENABLED flips:
// the default `lang` follows the app language, so every statutory, legal or
// outbound document builder that calls this must pass `lang` itself — 'en'
// for statutory/legal text (lien waivers, AIA pay apps, contracts, invoices,
// PDFs) and recipientLanguage() for outbound mail. Inert today: getLang() is
// 'en' in production while the picker is hidden (LanguageProfileSync is
// inert too, so the account cannot switch it).
// i18n/format.ts imports THIS file, so this file must never import
// i18n/format.ts (dateEs.ts exists to break that cycle).

import type { Lang } from '../i18n/types';
import { getLang } from '../i18n/core';
import { esCalendarDate } from '../i18n/dateEs';

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
 *
 * `lang` defaults to the app language. 'es' gives '30 ago 2026' for the same
 * options (never numeric — `month: 'numeric'` becomes the month name).
 */
export function formatCalendarDay(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  lang: Lang = getLang(),
): string {
  if (!value) return '';
  const d = parseCalendarDay(value);
  if (!d) return value;
  if (lang === 'es') return esCalendarDate(d, options);
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

/**
 * THE DAY RULE (2026-10-05). "Today" for jobsite work is the DEVICE'S LOCAL
 * calendar day, and this is the one place that says which day that is.
 * (Audit UX-F3/F11: `new Date().toISOString().slice(0, 10)` is the UTC date —
 * in New York it is already tomorrow from 8 pm, 7 pm in winter, and it
 * stamped evening records, anchors and "expired" labels a day ahead.)
 * scripts/validate-calendar-date.ts fails on any new UTC day key outside its
 * allow-list; the AI caps are the deliberate exception (the server's day).
 */
export function todayCalendarDay(now: Date = new Date()): string {
  return toCalendarDayString(now);
}

/**
 * THE WEEK RULE (2026-10-04). A jobsite week runs Monday → Sunday on the
 * DEVICE'S LOCAL calendar, and "this week" is the week the local day falls
 * in. LOCAL midnight of that Monday.
 *
 * One copy, because there were three: Last Planner took the Monday of the UTC
 * date (utils/lastPlanner `toMonday(new Date())`), while the Summary strip
 * (utils/summaryBriefing computeWeekLoad) and the Friday close
 * (utils/weekClose/composeWeekClose) took the local one. Whenever the local
 * day and the UTC day differ the screens named different weeks — in New York
 * every Sunday from 8 pm (7 pm in winter) to midnight Last Planner had
 * already moved to next week while Summary was still on this one; east of
 * Greenwich (Tokyo) it was Monday from midnight to 9 am, with Last Planner
 * still on LAST week. Every "which week is it now" question asks here.
 *
 * Built from local components, so the week DST starts or ends in is still
 * seven calendar days (never `getTime() - n * 86_400_000`).
 */
export function mondayOfLocalWeek(now: Date = new Date()): Date {
  const sinceMonday = (now.getDay() + 6) % 7; // Mon 0 … Sun 6
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday);
}

/**
 * The 'YYYY-MM-DD' of {@link mondayOfLocalWeek} — the key a week is stored
 * and compared under (last_planner_commitments.week_start, dispatches). A
 * calendar day, so it is moved with calendar arithmetic (lastPlanner
 * `addWeeks`), never re-derived from an instant in another zone.
 */
export function localWeekStart(now: Date = new Date()): string {
  return toCalendarDayString(mondayOfLocalWeek(now));
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
 * A Date for a field that holds an INSTANT from most writers but may hold a
 * bare 'YYYY-MM-DD' from an older one (DailyFieldReport.date: the screen,
 * the mic and photo triage write an instant; the voice daily report wrote a
 * bare local day for a while, and those rows are on devices and in
 * daily_reports, a text column). An instant is returned as-is — its time of
 * day still sorts and still names the right local day. A bare day becomes
 * LOCAL NOON of that day: `new Date('2026-09-17')` is UTC midnight, which
 * prints as Wednesday the 16th anywhere in the Americas, and local midnight
 * would slide to the previous UTC day east of Greenwich if the result is
 * ever re-serialised. Noon survives both. Invalid input gives an Invalid Date
 * exactly as `new Date(value)` did, so existing NaN guards keep working.
 */
export function dayOrInstantDate(value: string | null | undefined): Date {
  if (value && CALENDAR_DAY.test(value)) {
    const d = parseCalendarDay(value);
    if (d) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  }
  return new Date(value ?? NaN);
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

/**
 * THE OVERDUE RULE (2026-10-05). Something due on a day is overdue from the
 * START of the LOCAL day AFTER its due day — never from a time of day.
 *
 * Returns the whole local calendar days past the due day: 0 on the due day
 * itself, before it, and for an unreadable value; 1 from the next local
 * midnight; and so on. "Overdue" is `daysPastDue(...) > 0`.
 *
 * One copy, because `Invoice.dueDate` is stored as an INSTANT (issue time +
 * N days, app/invoice.tsx getDueDate) and every reader compared instants:
 * an invoice issued at 2 pm read "overdue" from 2 pm on its due day, one
 * issued at 9 am was overdue all that day, and the day count was elapsed
 * 24-hour blocks. The due DAY is the local day the stored value names
 * (calendarDayOf: a bare day as written, an instant by the local day it fell
 * on). Nothing stored changes — only the comparison.
 */
export function daysPastDue(dueDate: string | null | undefined, now: Date = new Date()): number {
  const until = daysUntilCalendarDay(calendarDayOf(dueDate), now);
  return until !== null && until < 0 ? -until : 0;
}
