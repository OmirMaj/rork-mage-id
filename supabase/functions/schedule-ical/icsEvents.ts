// schedule-ical/icsEvents.ts — the pure half of the schedule-ical feed: task
// rows → all-day VEVENT text. No Deno APIs and no imports, so the edge
// function and scripts/validate-health-scheddays.ts (bun) run the SAME code.
//
// WHY. The feed used to build `projectStart + startDay * 86400000` — off by one
// (startDay is 1-based), counted CALENDAR days where `startDay` is a WORKING
// ordinal (utils/cpm.ts "THE TWO DAY-NUMBER SCALES"), stretched the duration
// across weekends, and emitted `new Date('YYYY-MM-DD')` (UTC midnight) as a
// TIMED UTC event, i.e. the previous evening in every US zone. Working day 16
// on a Mon-Fri week from Mon 2026-03-02 (Mon Mar 23) came out as the evening of
// Tue Mar 17.
//
// NOW. Each task is an all-day `VALUE=DATE` event, exactly like
// utils/icsGenerator.ts: DTSTART is the task's first working day, DTEND is
// EXCLUSIVE (the day after its last working day — RFC 5545 §3.6.1). The dates
// come from the same working-day walk as scheduleEngine.addWorkingDays, with
// THE weekend rule of cpm.isWorkingDayOfWeek and the schedule's closures,
// inlined here because an edge function cannot import app code. Dates are
// pure calendar days handled at UTC noon, so the server's clock zone cannot
// move them. No start date ⇒ no task events (icsGenerator's SCHED-NO-ANCHOR
// rule): a plan anchored on "today" re-dates itself on every fetch.

export interface IcalScheduleTask {
  id: string;
  title?: string;
  startDay?: number;
  durationDays?: number;
  status?: string;
  crew?: string;
  progress?: number;
  isMilestone?: boolean;
  isCriticalPath?: boolean;
  phase?: string;
}

export interface IcalSchedule {
  startDate?: string;
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
  tasks?: IcalScheduleTask[];
}

const CAL_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** 'YYYY-MM-DD…' → epoch ms at UTC noon of that calendar day, or null. */
function dayNoonUtc(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = CAL_DAY.exec(iso);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

function isoOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** cpm.isWorkingDayOfWeek, verbatim. */
function isWorkingDayOfWeek(dayOfWeek: number, workingDaysPerWeek: number): boolean {
  if (workingDaysPerWeek >= 7) return true;
  if (workingDaysPerWeek === 6) return dayOfWeek !== 0;
  return dayOfWeek !== 0 && dayOfWeek !== 6;
}

/**
 * scheduleEngine.addWorkingDays on calendar-day strings: advance `startIso` by
 * `days` working days (weekends per the rule above, plus `closures`). Zero
 * days returns the start itself, even when it is a closed day — the same quirk
 * the app helper and the engine share.
 */
export function addWorkingDaysIso(
  startIso: string,
  days: number,
  workingDaysPerWeek: number,
  closures?: readonly string[],
): string | null {
  const start = dayNoonUtc(startIso);
  if (start === null) return null;
  const blocked = closures && closures.length > 0 ? new Set(closures) : null;
  let ms = start;
  let added = 0;
  const want = Math.max(0, Math.floor(days));
  while (added < want) {
    ms += 86_400_000;
    if (!isWorkingDayOfWeek(new Date(ms).getUTCDay(), workingDaysPerWeek)) continue;
    if (blocked && blocked.has(isoOf(ms))) continue;
    added++;
  }
  return isoOf(ms);
}

/** The task's first and last calendar day ('YYYY-MM-DD', inclusive), or null. */
export function icalTaskRange(
  schedule: IcalSchedule,
  task: IcalScheduleTask,
): { start: string; end: string } | null {
  const anchor = schedule.startDate ? schedule.startDate.slice(0, 10) : '';
  if (dayNoonUtc(anchor) === null) return null;
  const wd = typeof schedule.workingDaysPerWeek === 'number' && schedule.workingDaysPerWeek > 0
    ? schedule.workingDaysPerWeek : 5;
  const closures = schedule.nonWorkingDates ?? [];
  const ordinal = Math.max(1, Math.floor(Number(task.startDay) || 1));
  const start = addWorkingDaysIso(anchor, ordinal - 1, wd, closures);
  if (!start) return null;
  // A milestone is a single day; any other task spans durationDays working
  // days (at least one).
  const dur = task.isMilestone ? 1 : Math.max(1, Math.floor(Number(task.durationDays) || 1));
  const end = addWorkingDaysIso(start, dur - 1, wd, closures);
  if (!end) return null;
  return { start, end };
}

/** The exclusive all-day DTEND for an inclusive last day. */
function nextDay(iso: string): string {
  const ms = dayNoonUtc(iso);
  return ms === null ? iso : isoOf(ms + 86_400_000);
}

function compact(iso: string): string {
  return iso.replace(/-/g, '');
}

export function escapeIcs(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** 'YYYYMMDDTHHMMSSZ' for DTSTAMP (an instant, so UTC is right here). */
export function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** Every task's VEVENT block (CRLF-joined lines), in task order. */
export function buildScheduleIcalEvents(
  projectId: string,
  schedule: IcalSchedule | null | undefined,
  now: Date,
): string[] {
  const events: string[] = [];
  if (!schedule) return events;
  const stamp = icsStamp(now);
  for (const t of schedule.tasks ?? []) {
    if (!t.title) continue;
    const range = icalTaskRange(schedule, t);
    if (!range) continue;

    const descParts = [
      t.phase ? `Phase: ${t.phase}` : null,
      t.crew ? `Crew: ${t.crew}` : null,
      `Progress: ${t.progress ?? 0}%`,
      t.isCriticalPath ? 'Critical path' : null,
      'Exported from MAGE ID Pro Scheduler',
    ].filter(Boolean).map((p) => escapeIcs(p as string)).join('\\n');

    events.push(
      [
        'BEGIN:VEVENT',
        `UID:${projectId}-${t.id}@mageid.app`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compact(range.start)}`,
        `DTEND;VALUE=DATE:${compact(nextDay(range.end))}`,
        `SUMMARY:${escapeIcs(t.isMilestone ? `★ ${t.title}` : t.title)}`,
        `DESCRIPTION:${descParts}`,
        `STATUS:${t.status === 'done' ? 'COMPLETED' : 'CONFIRMED'}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ].join('\r\n'),
    );
  }
  return events;
}
