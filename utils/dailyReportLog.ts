// utils/dailyReportLog.ts — the daily-report LOG on desktop web (wave 6c, lane H).
//
// WHY. On a 1512 px MacBook /daily-report opened a brand-new report for today
// every time: 2.4 screens of 1,022 px inputs and no list of the reports
// already filed on the job. A PM reviewing a week of dailies had to leave and
// come back once per day. On desktop web a bare `?projectId=` now opens the
// LOG — every report on the job in a table, the open one read beside it — and
// anything that names a report or a day still opens the editor.
//
// Pure: no react-native, no contexts (scripts/validate-dfr-log.ts runs it
// under bun). The one import is utils/calendarDate, which is pure too.

import { calendarDayOf } from '@/utils/calendarDate';
import type { DailyFieldReport, ManpowerEntry } from '@/types';

/**
 * Which surface /daily-report shows.
 *
 * 'log' only on desktop WEB (isDesktop is also true on a native tablet at
 * >= 1024, which keeps the editor it has today), for a project that exists,
 * and only when nothing in the link asks for a specific report or a new one:
 *   reportId   — open that report;
 *   date       — start a report on that day (Home's missing-day card, the
 *                tutorial);
 *   fieldIssue — a collaborator's scope, handed over from the CO screen;
 *   isNew      — the log's own "New report" (new=1).
 * The phone never sees the log.
 */
export function dfrScreenMode(o: {
  desktopWeb: boolean;
  projectId: string | null | undefined;
  projectExists: boolean;
  reportId: string | null | undefined;
  date: string | null | undefined;
  fieldIssue: string | null | undefined;
  isNew: boolean;
}): 'log' | 'editor' {
  if (!o.desktopWeb) return 'editor';
  if (!o.projectId || !o.projectExists) return 'editor';
  if (o.reportId || o.date || o.fieldIssue || o.isNew) return 'editor';
  return 'log';
}

/** A report's calendar day (YYYY-MM-DD) whatever shape `date` was saved in. */
export function dfrDayKey(date: string | null | undefined): string | null {
  return calendarDayOf(date);
}

/**
 * The report the log opens on when nothing is open: today's (the latest
 * updatedAt when there are two), else the latest by day and then updatedAt.
 * Null when the job has no reports.
 */
export function defaultDfrSelection(
  reports: readonly Pick<DailyFieldReport, 'id' | 'date' | 'updatedAt'>[],
  todayKey: string,
): string | null {
  let best: { id: string; day: string; updated: string; today: boolean } | null = null;
  for (const r of reports) {
    const day = dfrDayKey(r.date) ?? '';
    const cand = { id: r.id, day, updated: r.updatedAt ?? '', today: day === todayKey };
    if (!best) { best = cand; continue; }
    if (cand.today !== best.today) { if (cand.today) best = cand; continue; }
    if (cand.day !== best.day) { if (cand.day > best.day) best = cand; continue; }
    if (cand.updated > best.updated) best = cand;
  }
  return best ? best.id : null;
}

/** The editor's man-hour rule: headcount × hours worked, summed over the crew. */
export function dfrManHours(manpower: readonly Pick<ManpowerEntry, 'headcount' | 'hoursWorked'>[] | null | undefined): number {
  return (manpower ?? []).reduce((sum, m) => sum + (m.headcount * m.hoursWorked), 0);
}

export interface DfrLogRow {
  crew: number;
  hours: number;
  /** False when the report lists no crew: crew and hours are then unknown, and
   *  the table shows '—' rather than 0 (crew/hours stay 0 for sorting only). */
  crewRecorded: boolean;
  /** 'temp · conditions', or null when neither was recorded (the table shows '—'). */
  weather: string | null;
  issue: 'Incident' | 'Issue' | null;
  photos: number;
  status: DailyFieldReport['status'];
}

/** One report as the log's table reads it. Nothing invented: an unrecorded
 *  weather is null, never "Clear". */
export function dfrLogRow(
  r: Pick<DailyFieldReport, 'manpower' | 'weather' | 'incident' | 'issuesAndDelays' | 'photos' | 'status'>,
): DfrLogRow {
  const manpower = r.manpower ?? [];
  const temp = (r.weather?.temperature ?? '').trim();
  const cond = (r.weather?.conditions ?? '').trim();
  const weather = [temp, cond].filter(Boolean).join(' · ') || null;
  const issue = r.incident?.hasIncident ? 'Incident' : (r.issuesAndDelays ?? '').trim() ? 'Issue' : null;
  return {
    crew: manpower.reduce((s, m) => s + (m.headcount || 0), 0),
    hours: dfrManHours(manpower),
    crewRecorded: manpower.length > 0,
    weather,
    issue,
    photos: (r.photos ?? []).length,
    status: r.status,
  };
}
