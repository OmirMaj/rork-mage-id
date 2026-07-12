// utils/scheduleVerdict.ts — pure plain-language schedule verdict. No React, no I/O.
// Turns CPM/baseline outputs into a one-line human verdict for the Overview tab
// and a compact chip in the header. Covered by scripts/validate-schedule-verdict.ts.

export type VerdictTone = 'onPace' | 'ahead' | 'slightlyBehind' | 'behind' | 'noBaseline';

export interface VerdictInput {
  /** Days behind the saved baseline. null = no baseline set. Negative = ahead. */
  slipDaysVsBaseline: number | null;
  /** Preformatted finish date, e.g. "Aug 14, 2026", or "—" when unknown. */
  finishDateLabel: string;
  /** Title of the task currently driving the finish date, if any. */
  criticalDriverTitle?: string;
  /** Count of not-done tasks past their deadline. */
  overdueCount: number;
}

export interface ScheduleVerdict {
  tone: VerdictTone;
  headline: string;
  detail: string;
}

const hasFinish = (label: string) => {
  const t = label.trim();
  return t.length > 0 && t !== '—';
};

const dayWord = (n: number) => (Math.abs(n) === 1 ? 'day' : 'days');

/** Pure: map CPM/baseline numbers to a plain-language verdict. */
export function scheduleVerdict(input: VerdictInput): ScheduleVerdict {
  const { slipDaysVsBaseline: slip, finishDateLabel, criticalDriverTitle, overdueCount } = input;
  const finishClause = hasFinish(finishDateLabel) ? ` — finishing about ${finishDateLabel}` : '';

  let tone: VerdictTone;
  let headline: string;
  if (slip == null) {
    tone = 'noBaseline';
    headline = hasFinish(finishDateLabel)
      ? `On track to finish about ${finishDateLabel}`
      : 'Schedule in progress';
  } else if (slip <= -1) {
    tone = 'ahead';
    headline = `${Math.abs(slip)} ${dayWord(slip)} ahead of plan${finishClause}`;
  } else if (slip === 0) {
    tone = 'onPace';
    headline = `On pace${finishClause}`;
  } else if (slip <= 3) {
    tone = 'slightlyBehind';
    headline = `${slip} ${dayWord(slip)} behind plan${finishClause}`;
  } else {
    tone = 'behind';
    headline = `${slip} ${dayWord(slip)} behind plan${finishClause}`;
  }

  const parts: string[] = [];
  if (criticalDriverTitle && criticalDriverTitle.trim()) {
    parts.push(`${criticalDriverTitle.trim()} is your finish-date driver.`);
  }
  if (overdueCount > 0) {
    parts.push(`${overdueCount} task${overdueCount === 1 ? '' : 's'} overdue.`);
  }

  return { tone, headline, detail: parts.join(' ') };
}
