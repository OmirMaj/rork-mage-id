// utils/portfolio/attentionRows.ts — the pure half of the attention surfaces.
//
// PURE: no React, no react-native (bun-executable; scripts/validate-attention-rows.ts).
//
// WHY (wave 6c, lane F). At 1512 px the desktop Home showed the same attention
// list twice — the action rail AND the Brain Watch card — and '+N more' was
// plain text that went nowhere. The rail is now the one list, with sections
// for money ready to bill, daily-log gaps and warranty walks, each capped at
// three rows and linked to a real /attention page. These are the rules both
// read, so the rail and the page can never disagree:
//
//   • buildDailyLogGaps — lifted VERBATIM from components/home/DailyLogCard
//     (the card now calls it), including its sort: today's unfiled logs first,
//     then the biggest holes;
//   • railSection — the first N rows and how many are hidden;
//   • parseAttentionView — the ?view= param of /attention.
//
// Whether the rail shows at all is lane S's utils/sidebarRail actionRailVisible
// (Home calls it too); there is deliberately no second rule here.

import type { DailyFieldReport, Project } from '@/types';
import {
  computeDailyLogCompletion,
  calendarOfSchedule,
  type DailyLogCompletion,
} from '@/utils/dailyLogCompletion';

export interface DailyLogGapRow {
  projectId: string;
  projectName: string;
  c: DailyLogCompletion;
}

/** Active jobs whose daily log owes today or has a hole in the last 30 days. */
export function buildDailyLogGaps(
  projects: readonly Project[] | null | undefined,
  dailyReports: readonly DailyFieldReport[] | null | undefined,
  todayISO: string,
): DailyLogGapRow[] {
  const out: DailyLogGapRow[] = [];
  for (const p of projects ?? []) {
    if (p.status !== 'in_progress') continue;
    const reports = (dailyReports ?? []).filter(r => r.projectId === p.id);
    const c = computeDailyLogCompletion({
      reports,
      calendar: calendarOfSchedule(p.schedule),
      startDateISO: p.schedule?.startDate ?? null,
      todayISO,
    });
    // hasRecord is false until the GC has filed at least one report on this
    // job. Nagging someone about a log they have not started is noise.
    if (!c.hasRecord) continue;
    const needsToday = c.todayExpected && !c.todayFiled;
    if (!needsToday && c.missedDays === 0) continue;
    out.push({ projectId: p.id, projectName: p.name, c });
  }
  // Today's unfiled logs first — that is the only action that can still be
  // taken contemporaneously. Then the biggest holes.
  return out.sort((a, b) => {
    const aToday = a.c.todayExpected && !a.c.todayFiled ? 1 : 0;
    const bToday = b.c.todayExpected && !b.c.todayFiled ? 1 : 0;
    if (aToday !== bToday) return bToday - aToday;
    return b.c.missedDays - a.c.missedDays;
  });
}

/** The first `max` rows of a rail section, and how many it hides. */
export function railSection<T>(rows: readonly T[], max = 3): { shown: T[]; hidden: number } {
  const cap = Math.max(0, Math.floor(max));
  const shown = rows.slice(0, cap);
  return { shown, hidden: rows.length - shown.length };
}

export type AttentionView = 'needs' | 'bill' | 'logs' | 'warranty';

export const ATTENTION_VIEWS: readonly AttentionView[] = ['needs', 'bill', 'logs', 'warranty'];

/** /attention?view= — an unknown, missing or repeated value reads as 'needs'. */
export function parseAttentionView(raw: unknown): AttentionView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && (ATTENTION_VIEWS as readonly string[]).includes(v)
    ? (v as AttentionView)
    : 'needs';
}

/** The one-line state a daily-log gap row shows (rail and /attention). */
export function dailyLogGapLine(row: DailyLogGapRow): string {
  const needsToday = row.c.todayExpected && !row.c.todayFiled;
  if (needsToday) return `${row.projectName}: today's log not filed`;
  const n = row.c.missedDays;
  return `${row.projectName}: ${n} ${n === 1 ? 'day' : 'days'} missing in last 30`;
}

/** Where a daily-log gap row opens: today's report (a NEW one — on desktop web
 *  a bare projectId opens the log, lane H), or the most recent missing day. */
export function dailyLogGapTarget(row: DailyLogGapRow): { projectId: string; date?: string; new?: '1' } {
  const needsToday = row.c.todayExpected && !row.c.todayFiled;
  const gapDay = needsToday ? undefined : row.c.missedDates[0];
  return gapDay ? { projectId: row.projectId, date: gapDay } : { projectId: row.projectId, new: '1' };
}
