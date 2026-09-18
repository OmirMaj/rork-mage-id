// morning-digest/scheduleToday.ts — "what is on site today" for the server brief.
//
// A PORT, not a new rule. The app answers this question with three pure
// functions in utils/scheduleOps.ts — resolveScheduleAnchor (the start date as
// a calendar day, never a fallback), scheduleDayOnCalendar (the MEMBERSHIP
// test: which working day is this calendar day, or null) and
// isTaskActiveOnScheduleDay (is the task on site that day and not done). Edge
// functions cannot import '@/utils/*', so the three are re-stated here and
// scripts/validate-digest-schedule-today.ts runs both copies over the same
// grid of anchors, calendars and dates and fails the build on any day where
// they disagree.
//
// Why it had to change (audit 2026-09-18 #14): the brief counted CALENDAR days
// from the start (`floor((now - start) / 86_400_000) + 1`) against task
// startDay values that are WORKING days. On a 5-day week the two drift two
// days per week, so two weeks in, the 6 AM push listed Thursday's tasks on
// Monday, and on Saturday it listed a closed site's "3 tasks today". It also
// skipped tasks whose status was 'completed' — a status TaskStatus does not
// have ('done' is the finished state), so no finished task ever dropped out.
//
// Deliberately NOT a port of scheduleDayNumberFor: that one clamps every date
// before the start to day 1 and folds a weekend back onto Friday, which is how
// the app once put a crew on site before a job broke ground (summaryBriefing.ts
// scheduleDayFor). A closed day here is null, and the brief says so instead of
// listing tasks.
//
// Everything is done on CALENDAR DAYS ('YYYY-MM-DD') held as UTC midnights, so
// the answer does not depend on the server's clock zone. "Today" is computed
// by the caller in the user's own digest_timezone (calendarDayInZone).

export interface DigestScheduleTask {
  startDay: number;
  durationDays: number;
  status?: string;
  progress?: number;
  isMilestone?: boolean;
}

export interface DigestScheduleSource<T extends DigestScheduleTask = DigestScheduleTask> {
  tasks?: T[] | null;
  startDate?: string | null;
  workingDaysPerWeek?: number | null;
  nonWorkingDates?: string[] | null;
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/**
 * A stored day value → epoch-day number (UTC midnight / DAY_MS), or null.
 * Same acceptance as utils/calendarDate.parseCalendarDay: the first ten
 * characters must be a real calendar day, so a bare '2026-09-01' and a
 * round-tripped '2026-09-01T04:00:00.000Z' both mean September 1st.
 */
export function epochDayOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = CALENDAR_DAY.exec(String(value).slice(0, 10));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / DAY_MS);
}

export function isoOfEpochDay(epochDay: number): string {
  const dt = new Date(epochDay * DAY_MS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** cpm.isWorkingDayOfWeek — the one weekend rule (0 = Sunday). */
function isWorkingDow(dow: number, workingDaysPerWeek: number): boolean {
  if (workingDaysPerWeek >= 7) return true;
  if (workingDaysPerWeek === 6) return dow !== 0;
  return dow !== 0 && dow !== 6;
}

/**
 * scheduleOps.scheduleDayOnCalendar on calendar-day strings: the 1-indexed
 * WORKING day `targetIso` is on this schedule, or null when the job has not
 * started, or the day is a weekend / site closure. The anchor itself is day 1
 * even when it falls on a closed day (addWorkingDays(start, 0) is `start`).
 */
export function scheduleDayOnCalendarIso(
  startIso: string,
  targetIso: string,
  workingDaysPerWeek: number = 5,
  nonWorkingDates?: string[] | null,
): number | null {
  const start = epochDayOf(startIso);
  const target = epochDayOf(targetIso);
  if (start == null || target == null) return null;
  if (target < start) return null;
  if (target === start) return 1;
  const blocked = nonWorkingDates && nonWorkingDates.length > 0 ? new Set(nonWorkingDates) : null;
  const works = (day: number) =>
    // Epoch day 0 (1970-01-01) was a Thursday → (day + 4) % 7 is the weekday.
    isWorkingDow(((day + 4) % 7 + 7) % 7, workingDaysPerWeek) && !(blocked && blocked.has(isoOfEpochDay(day)));
  if (!works(target)) return null;
  let n = 1;
  for (let day = start + 1; day <= target; day++) if (works(day)) n++;
  return n;
}

/**
 * Finished. The app's catch-up planner already treats 100% as done
 * (scheduleOps isTaskDone) and isTaskActiveOnScheduleDay uses the same test,
 * so a task the super dragged to 100% without flipping the status is not
 * "on site today" on either surface.
 */
export function isTaskFinished(t: Pick<DigestScheduleTask, 'status' | 'progress'>): boolean {
  return t.status === 'done' || (t.progress ?? 0) >= 100;
}

/** scheduleOps.isTaskActiveOnScheduleDay. */
export function isTaskActiveOnDay(t: DigestScheduleTask, dayNumber: number): boolean {
  if (isTaskFinished(t)) return false;
  const start = Math.max(1, t.startDay ?? 1);
  const dur = Math.max(0, t.durationDays ?? 0);
  return dayNumber >= start && dayNumber <= start + dur - 1;
}

/** scheduleOps.isMilestoneOnScheduleDay. */
export function isMilestoneOnDay(t: DigestScheduleTask, dayNumber: number): boolean {
  if (isTaskFinished(t)) return false;
  if (!t.isMilestone) return false;
  return dayNumber === Math.max(1, t.startDay ?? 1);
}

export type TodayOnSite<T extends DigestScheduleTask = DigestScheduleTask> =
  /** Tasks exist but the schedule has no start date — no calendar day is knowable. */
  | { state: 'undated'; tasks: []; milestones: [] }
  /** Today is before the schedule's first day. */
  | { state: 'not_started'; startIso: string; tasks: []; milestones: [] }
  /** A weekend or a site closure on this job's own calendar. */
  | { state: 'closed_day'; tasks: []; milestones: [] }
  | { state: 'working'; dayNumber: number; tasks: T[]; milestones: T[] }
  /** No schedule tasks at all. */
  | { state: 'no_schedule'; tasks: []; milestones: [] };

/** The job's answer for calendar day `todayIso` (already in the user's zone). */
export function todayOnSite<T extends DigestScheduleTask>(
  schedule: DigestScheduleSource<T> | null | undefined,
  todayIso: string,
): TodayOnSite<T> {
  const tasks = (schedule?.tasks ?? []) as T[];
  if (tasks.length === 0) return { state: 'no_schedule', tasks: [], milestones: [] };
  const start = epochDayOf(schedule?.startDate ?? null);
  if (start == null) return { state: 'undated', tasks: [], milestones: [] };
  const startIso = isoOfEpochDay(start);
  const today = epochDayOf(todayIso);
  if (today != null && today < start) return { state: 'not_started', startIso, tasks: [], milestones: [] };
  const n = scheduleDayOnCalendarIso(startIso, todayIso, schedule?.workingDaysPerWeek ?? 5, schedule?.nonWorkingDates ?? null);
  if (n == null) return { state: 'closed_day', tasks: [], milestones: [] };
  return {
    state: 'working',
    dayNumber: n,
    tasks: tasks.filter(t => isTaskActiveOnDay(t, n)),
    milestones: tasks.filter(t => isMilestoneOnDay(t, n)),
  };
}

/**
 * The calendar day it is right now in `timeZone`, as 'YYYY-MM-DD'. An invalid
 * zone falls back to the same zone the cron's hour filter assumes.
 */
export function calendarDayInZone(now: Date, timeZone: string | null | undefined): string {
  const fmt = (tz: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try { parts = fmt(timeZone || DEFAULT_DIGEST_TIMEZONE); } catch { parts = fmt(DEFAULT_DIGEST_TIMEZONE); }
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The hour (0-23) it is right now in `timeZone`. */
export function localHourInZone(now: Date, timeZone: string | null | undefined): number {
  const fmt = (tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now);
  let raw: string;
  try { raw = fmt(timeZone || DEFAULT_DIGEST_TIMEZONE); } catch { raw = fmt(DEFAULT_DIGEST_TIMEZONE); }
  const h = parseInt(raw, 10);
  return Number.isFinite(h) ? h % 24 : 0;
}

/** The zone the cron's digest-hour filter already assumes when none is stored. */
export const DEFAULT_DIGEST_TIMEZONE = 'America/New_York';

/**
 * "Good morning" only when it is morning where he is. The settings screen
 * offers 12 PM, 5 PM and 8 PM; an 8 PM Pacific brief said "Good morning" —
 * with tomorrow's UTC date on it.
 */
export function digestGreeting(localHour: number, firstName: string): { title: string; subjectPrefix: string } {
  if (localHour < 12) {
    return { title: firstName ? `Good morning, ${firstName}.` : 'Good morning.', subjectPrefix: 'Morning briefing' };
  }
  return { title: firstName ? `Your daily brief, ${firstName}.` : 'Your daily brief.', subjectPrefix: 'Daily briefing' };
}
