// utils/copilot/dailyReport/dfrGaps.ts — daily-report interview gap rules.
//
// One end-of-day dictation fans out into a full report (parsed in apply). The
// interview asks only the two things a dictation usually leaves open: the
// progress on today's critical-path task (which rolls the schedule forward when
// saved — the moat) and whether it was a clean day. Weather is auto-filled;
// manpower/work come from the dictation and are never asked.
import type { Gap, Grounding } from '../types';

export interface DFRDraft {
  /** The spoken end-of-day update — parsed into fields in apply(). */
  transcript?: string | null;
  /** Did the dictation flag an issue? Set from the AI extraction. */
  issuesMentioned?: boolean | null;
  /** Answer to the clean-day question (true = no issues). */
  cleanDay?: boolean | null;
  /** Answer to the critical-task progress question (0-100). */
  criticalTaskPct?: number | null;
}

export interface DFRGroundData {
  criticalTask?: { id: string; title: string; phase: string; progress: number };
}

export function dfrGaps(draft: DFRDraft, grounding: Grounding): Gap[] {
  const d = grounding.data as DFRGroundData;
  const gaps: Gap[] = [];

  // 1. Critical-path progress — the schedule-linkage moat. Confirm the % on the
  //    critical in-progress task; saving the DFR propagates it to the schedule.
  if (draft.criticalTaskPct == null && d.criticalTask) {
    const t = d.criticalTask;
    const bump = Math.min(100, t.progress + 10);
    const push = Math.min(100, t.progress + 25);
    const choices = [
      { label: `Still ${t.progress}%`, value: t.progress },
      { label: `${bump}%`, value: bump, recommended: true, basis: 'nudged forward a bit' },
      { label: `${push}%`, value: push },
      { label: 'Done — 100%', value: 100 },
    ].filter((c, i, a) => a.findIndex((x) => x.value === c.value) === i);
    gaps.push({
      field: 'criticalTaskPct', impact: 0.6, kind: 'choice',
      question: `${t.title} is on today's critical path — where'd it land?`,
      groundedDefault: { value: bump, basis: `was ${t.progress}% — saving this moves the schedule` },
      choices,
    });
  }

  // 2. Issues / clean day — ask only when nothing in the dictation flagged one.
  if (draft.cleanDay == null && draft.issuesMentioned === false) {
    gaps.push({
      field: 'cleanDay', impact: 0.45, kind: 'choice',
      question: 'Any issues or delays to note, or a clean day?',
      groundedDefault: { value: true, basis: 'nothing flagged in your update' },
      choices: [
        { label: 'Clean day', value: true, recommended: true },
        { label: 'Had an issue', value: false },
      ],
    });
  }

  return gaps;
}
