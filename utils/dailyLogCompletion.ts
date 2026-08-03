// utils/dailyLogCompletion.ts — how complete the daily log is over the
// project's own working days, counting a "nothing happened" report as a
// COMPLETION rather than a gap.
//
// WHY COMPLETENESS, NOT QUALITY
// ------------------------------------------------------------------------
// Daily reports are business records. Under FRE 803(6) they come in if they
// were made at or near the time by someone with knowledge, kept in the course
// of a regularly conducted activity (B), and — the part that actually decides
// cases — if making them was a REGULAR PRACTICE (C).
//
// Two things follow, and both are counter-intuitive:
//
// 1. "Self-serving" is not a ground for exclusion. The Advisory Committee is
//    explicit that "absence of motivation to misrepresent has not
//    traditionally been a requirement of the rule; that records might be
//    self-serving has not been a ground for exclusion." A contractor's own
//    log is not excluded for being the contractor's. So there is nothing to
//    be gained by making the log read more neutrally.
//
// 2. Routineness is where logs die. In Meltech Corp., ASBCA No. 61765, the PM
//    "did not 'make[] a habit of noting'" problems and the later testimony got
//    "little credence." A superintendent who logs only on eventful days
//    satisfies (B) and fails (C).
//
// Therefore: a gap-free boring log beats a sparse detailed one. A missing
// Tuesday is worse than a Tuesday that says "rain, no work." The metric that
// matters is completion over expected working days — and a report recording
// that nothing happened is the behaviour worth reinforcing, so it counts as a
// completion here and is reported separately so the surface can say so.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ------------------------------------------------------------------------
// It does not reward backfilling. A report typed weeks later for a day that
// was missed is not contemporaneous, and retro-annotating the record is how
// Vistas Construction (ASBCA Nos. 58479-58488) destroyed its own witnesses:
// it "did not merely add notations ... it essentially re-wrote these
// documents." Gaps are reported as facts about the record, never as a to-do
// list to go fill in. The only action a surface should offer is filing
// TODAY'S log.
//
// It also does not reward volume. Nothing here reads report length, and there
// is no score to raise by typing more. If the fastest path to a complete
// record is inventing content, the metric is worse than nothing.
//
// CALENDAR
// ------------------------------------------------------------------------
// Expected days come from the project's own schedule configuration
// (`ProjectSchedule.workingDaysPerWeek`, `ProjectSchedule.nonWorkingDates`),
// matching utils/cpm.ts `isWorkingDay`: fewer than 7 days per week excludes
// Saturday and Sunday, and any date in `nonWorkingDates` is off. A Sunday is
// never a miss on a 5-day project.
//
// Unlike cpm.ts, which indexes days off a schedule anchor in UTC, this module
// works in LOCAL calendar days. It compares a user's local "today" against
// reports the user filed locally, and `nonWorkingDates` are bare YYYY-MM-DD
// strings with no timezone, so local is the only reading that does not drift a
// day for anyone west of Greenwich.
//
// Pure: no React, no React Native, no network, no ambient clock (`todayISO` is
// injectable). Safe to import from a bun validator script.

import type { DailyFieldReport, ProjectSchedule } from '@/types';

/** Default rolling window. Long enough to show a habit, short enough that an
 *  old gap stops being news. */
export const DEFAULT_WINDOW_DAYS = 30;
/** Cap on how many missed dates we hand back for display. */
export const MAX_MISSED_LISTED = 6;

export interface WorkingDayCalendar {
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
}

/** The DFR fields this metric touches. Kept narrow so callers can pass partial
 *  rows and so the validator does not have to build a full DailyFieldReport.
 *  `workPerformed` / `issuesAndDelays` are accepted and then deliberately NOT
 *  read — see isNoWorkReport. Reading the prose would turn a completeness
 *  metric into a word count, and a word count is a reason to type filler. */
export type DailyLogReport = Pick<DailyFieldReport, 'date'> &
  Partial<Pick<DailyFieldReport,
    'manpower' | 'workProgress' | 'materialsDelivered' | 'photos' | 'workPerformed' | 'issuesAndDelays'>>;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad2 = (n: number) => String(n).padStart(2, '0');

function keyOfLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Local YYYY-MM-DD for any ISO timestamp, bare date, epoch ms, or Date.
 * A bare YYYY-MM-DD is returned untouched — `new Date('2026-07-01')` parses as
 * UTC midnight, which reads as June 30 for most of the Americas, and silently
 * moving a filed day back one is exactly the bug this metric cannot afford.
 */
export function localDayKey(input: string | number | Date | null | undefined): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'string' && DAY_KEY_RE.test(input)) return input;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isFinite(d.getTime()) ? keyOfLocalDate(d) : null;
}

/** Local midnight Date for a YYYY-MM-DD key. */
function dateOfKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Shift a day key by n calendar days (local, DST-safe via Date arithmetic). */
export function shiftDayKey(key: string, n: number): string {
  const d = dateOfKey(key);
  d.setDate(d.getDate() + n);
  return keyOfLocalDate(d);
}

/**
 * Is this local calendar day one the project expects work on?
 * Mirrors utils/cpm.ts `isWorkingDay`: workingDaysPerWeek < 7 excludes Sat and
 * Sun; anything in nonWorkingDates is off regardless of weekday. Defaults to a
 * 5-day week, which is the forgiving direction — a wrong default here would
 * manufacture misses.
 */
export function isExpectedWorkingDay(key: string, cal?: WorkingDayCalendar | null): boolean {
  if (!DAY_KEY_RE.test(key)) return false;
  const wpw = cal?.workingDaysPerWeek ?? 5;
  const dow = dateOfKey(key).getDay();
  if (wpw < 7 && (dow === 0 || dow === 6)) return false;
  return !(cal?.nonWorkingDates ?? []).includes(key);
}

/** Pull the working-day calendar off a ProjectSchedule. */
export function calendarOfSchedule(schedule: ProjectSchedule | null | undefined): WorkingDayCalendar {
  return {
    workingDaysPerWeek: schedule?.workingDaysPerWeek,
    nonWorkingDates: schedule?.nonWorkingDates,
  };
}

/**
 * Did this report record any work on site?
 *
 * "Nothing happened" means no crew, no task progress, no deliveries, no
 * photos. Free text is deliberately NOT read: a report that says "rain, no
 * work" is still a no-work day, and reading the prose would turn the metric
 * into a word-count game. A report with a photo and no crew is not a no-work
 * day — something was documented.
 */
export function isNoWorkReport(r: DailyLogReport): boolean {
  const heads = (r.manpower ?? []).reduce((s, m) => s + (Number(m?.headcount) || 0), 0);
  if (heads > 0) return false;
  if ((r.workProgress ?? []).length > 0) return false;
  if ((r.materialsDelivered ?? []).filter(m => (m ?? '').trim().length > 0).length > 0) return false;
  if ((r.photos ?? []).length > 0) return false;
  return true;
}

export interface DailyLogCompletionInput {
  reports: DailyLogReport[];
  calendar?: WorkingDayCalendar | null;
  /** Project/schedule start. The window never reaches back past it. */
  startDateISO?: string | null;
  /** "Now", injectable. Defaults to the current local day. */
  todayISO?: string | number | Date;
  /** Rolling window length in calendar days, inclusive of today. */
  windowDays?: number;
}

export interface DailyLogCompletion {
  /** Local YYYY-MM-DD the window opens on. */
  windowStart: string;
  /** Local YYYY-MM-DD of today. */
  today: string;
  /** False until at least one report exists — before that there is no record
   *  to be complete or incomplete, and surfaces should render nothing. */
  hasRecord: boolean;
  /** Expected working days in the window, today included. */
  expectedDays: number;
  /** Expected days that are over. Today is excluded until it is filed, so the
   *  metric does not report a gap at 12:01am for a day still in progress. */
  closedExpectedDays: number;
  /** Closed expected days with at least one report. */
  filedDays: number;
  /** Of those, days whose report records no work. Completions, not gaps. */
  emptyDayFilings: number;
  /** Closed expected days with no report. */
  missedDays: number;
  /** Missed days, most recent first, capped at MAX_MISSED_LISTED. */
  missedDates: string[];
  /** Consecutive filed expected days ending at the most recent closed
   *  expected day (or today, when today is already filed). */
  currentStreak: number;
  /** Longest run of consecutive filed expected days inside the window. */
  longestStreak: number;
  /** filedDays / closedExpectedDays. 1 when there is nothing to measure. */
  completionRate: number;
  todayExpected: boolean;
  todayFiled: boolean;
}

const EMPTY_RESULT = (today: string): DailyLogCompletion => ({
  windowStart: today,
  today,
  hasRecord: false,
  expectedDays: 0,
  closedExpectedDays: 0,
  filedDays: 0,
  emptyDayFilings: 0,
  missedDays: 0,
  missedDates: [],
  currentStreak: 0,
  longestStreak: 0,
  completionRate: 1,
  todayExpected: false,
  todayFiled: false,
});

/**
 * Completion of the daily log over the project's expected working days.
 *
 * The window opens at the later of (today - windowDays + 1), the project start
 * date, and the day of the first filed report. That last clamp matters: MAGE
 * can only speak to the stretch it was actually keeping the log, and reporting
 * thirty "misses" for the month before the GC adopted daily reports would be
 * both untrue and the fastest way to teach them to ignore the number.
 *
 * Reports filed on non-working days are ignored rather than credited — they
 * neither extend a streak nor were ever expected.
 */
export function computeDailyLogCompletion(input: DailyLogCompletionInput): DailyLogCompletion {
  const today = localDayKey(input?.todayISO ?? new Date()) ?? localDayKey(new Date())!;
  const cal = input?.calendar ?? null;
  const windowDays = Math.max(1, input?.windowDays ?? DEFAULT_WINDOW_DAYS);

  // One entry per day that has at least one report; true = the day recorded
  // no work. A day with several reports counts once, and counts as "work
  // happened" if any of them recorded work.
  const filedByDay = new Map<string, boolean>();
  let firstFiledKey: string | null = null;
  for (const r of input?.reports ?? []) {
    const key = localDayKey(r?.date);
    if (!key) continue;
    const noWork = isNoWorkReport(r);
    filedByDay.set(key, (filedByDay.get(key) ?? true) && noWork);
    if (firstFiledKey === null || key < firstFiledKey) firstFiledKey = key;
  }

  if (filedByDay.size === 0) return EMPTY_RESULT(today);

  let windowStart = shiftDayKey(today, -(windowDays - 1));
  const projectStart = localDayKey(input?.startDateISO ?? null);
  if (projectStart && projectStart > windowStart) windowStart = projectStart;
  if (firstFiledKey && firstFiledKey > windowStart) windowStart = firstFiledKey;
  if (windowStart > today) windowStart = today;

  const todayExpected = isExpectedWorkingDay(today, cal);
  const todayFiled = filedByDay.has(today);

  // Expected days, oldest first.
  const expected: string[] = [];
  for (let k = windowStart; k <= today; k = shiftDayKey(k, 1)) {
    if (isExpectedWorkingDay(k, cal)) expected.push(k);
  }

  // Today is "closed" only once it has been filed; otherwise the day is still
  // in progress and is neither a completion nor a miss.
  const closed = expected.filter(k => k !== today || todayFiled);

  let filedDays = 0;
  let emptyDayFilings = 0;
  const missedDates: string[] = [];
  let longestStreak = 0;
  let run = 0;

  for (const k of closed) {
    if (filedByDay.has(k)) {
      filedDays++;
      if (filedByDay.get(k) === true) emptyDayFilings++;
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      missedDates.push(k);
      run = 0;
    }
  }

  // Current streak: walk back from the most recent closed expected day.
  let currentStreak = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    if (!filedByDay.has(closed[i])) break;
    currentStreak++;
  }

  return {
    windowStart,
    today,
    hasRecord: true,
    expectedDays: expected.length,
    closedExpectedDays: closed.length,
    filedDays,
    emptyDayFilings,
    missedDays: missedDates.length,
    missedDates: missedDates.slice(-MAX_MISSED_LISTED).reverse(),
    currentStreak,
    longestStreak,
    completionRate: closed.length === 0 ? 1 : filedDays / closed.length,
    todayExpected,
    todayFiled,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The standing number. States it; does not congratulate anyone for it.
 * Null before there is a record to describe.
 */
export function dailyLogHeadline(c: DailyLogCompletion): string | null {
  if (!c.hasRecord || c.closedExpectedDays === 0) return null;
  return `Daily log covers ${c.filedDays} of ${plural(c.closedExpectedDays, 'working day')}.`;
}

/** The "nothing happened days still count" line. Null when there are none. */
export function dailyLogEmptyDayLine(c: DailyLogCompletion): string | null {
  if (!c.hasRecord || c.emptyDayFilings === 0) return null;
  const n = c.emptyDayFilings;
  return `${n} of those ${n === 1 ? 'days was' : 'days were'} logged with no work on site. Those count — a filed day with nothing on it is what makes the log routine.`;
}

/** The gap statement. A fact about the record, not a to-do list. */
export function dailyLogGapLine(c: DailyLogCompletion): string | null {
  if (!c.hasRecord || c.missedDays === 0) return null;
  const n = c.missedDays;
  return `${plural(n, 'working day')} in this stretch ${n === 1 ? 'has' : 'have'} no log. A gap is what gets a log attacked as not routine, and filing it late does not close it.`;
}

/** The only action worth offering: today. Null when today is not owed. */
export function dailyLogTodayLine(c: DailyLogCompletion): string | null {
  if (!c.hasRecord || !c.todayExpected || c.todayFiled) return null;
  return 'Today has no log yet. If nothing happened on site, that is still the day to record.';
}
