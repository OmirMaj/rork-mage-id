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

import type { DailyFieldReport, Project, PunchItem } from '@/types';
import { punchAttention, scopePunchToProject, type AttentionItem } from '@/utils/brainWatch';
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
    // UX A5: a day whose only report is a voice-created draft is neither filed
    // nor missing — it is "finish it", and it keeps the row.
    if (!needsToday && c.missedDays === 0 && c.voiceOnlyDays.length === 0) continue;
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

/** UX A5 — the words for a day that has only a voice note. */
export const VOICE_NOTE_ONLY = 'Voice note only · finish it';

/**
 * UX A5 — the voice draft a row should open, or null when the row is about
 * something else. Today's voice-only draft wins (today is the day to finish);
 * otherwise, on a row with no today-owed log and no missing day, the most
 * recent voice-only day's draft. A missed day outranks an older voice note —
 * the hole is the bigger fact.
 */
export function dailyLogVoiceDraft(row: DailyLogGapRow): { date: string; reportId: string | null } | null {
  const c = row.c;
  const vod = c.voiceOnlyDays ?? [];
  const todayVoice = vod.find(v => v.date === c.today);
  if (c.todayExpected && !c.todayFiled && todayVoice) return todayVoice;
  const needsToday = c.todayExpected && !c.todayFiled;
  if (!needsToday && c.missedDays === 0 && vod.length > 0) return vod[0];
  return null;
}

/** The one-line state a daily-log gap row shows (rail and /attention). */
export function dailyLogGapLine(row: DailyLogGapRow): string {
  if (dailyLogVoiceDraft(row)) return `${row.projectName}: ${VOICE_NOTE_ONLY.toLowerCase()}`;
  const needsToday = row.c.todayExpected && !row.c.todayFiled;
  if (needsToday) return `${row.projectName}: today's log not filed`;
  const n = row.c.missedDays;
  return `${row.projectName}: ${n} ${n === 1 ? 'day' : 'days'} missing in last 30`;
}

/** Where a daily-log gap row opens: the voice draft to finish (UX A5), today's
 *  report (a NEW one — on desktop web a bare projectId opens the log, lane H),
 *  or the most recent missing day. */
export function dailyLogGapTarget(row: DailyLogGapRow): { projectId: string; date?: string; new?: '1'; reportId?: string } {
  const voice = dailyLogVoiceDraft(row);
  if (voice) {
    // With no id on the rows, the day still opens (the report screen warns
    // that the day already has a report).
    return voice.reportId ? { projectId: row.projectId, reportId: voice.reportId } : { projectId: row.projectId, date: voice.date };
  }
  const needsToday = row.c.todayExpected && !row.c.todayFiled;
  const gapDay = needsToday ? undefined : row.c.missedDates[0];
  return gapDay ? { projectId: row.projectId, date: gapDay } : { projectId: row.projectId, new: '1' };
}

// ─── Punch rows for the canonical attention set (UX A7) ─────────────────────

/**
 * The punch rows for the attention set: the SAME population punchAttention
 * always counted (every punch item, whatever the job's stage), grouped per job.
 * A job in Post-Con ('completed') is exactly where punch matters, so no stage
 * is skipped here. Items whose job is known get the per-job row
 * (scopePunchToProject); items on a job this device does not know stay in one
 * unscoped rollup, as before.
 */
export function punchAttentionByJob(
  punchItems: PunchItem[],
  projects: Pick<Project, 'id' | 'name'>[],
): AttentionItem[] {
  const byId = new Map(projects.map((p) => [p.id, p] as const));
  const groups = new Map<string, PunchItem[]>();
  const orphans: PunchItem[] = [];
  for (const pi of punchItems) {
    if (!byId.has(pi.projectId)) { orphans.push(pi); continue; }
    const g = groups.get(pi.projectId);
    if (g) g.push(pi); else groups.set(pi.projectId, [pi]);
  }
  const out: AttentionItem[] = [];
  for (const [projectId, items] of groups) {
    const project = byId.get(projectId)!;
    out.push(...punchAttention(items).map((it) => scopePunchToProject(it, project)));
  }
  out.push(...punchAttention(orphans));
  return out;
}
