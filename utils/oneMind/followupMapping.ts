// utils/oneMind/followupMapping.ts — deterministic follow-up questions.
//
// After MAGE answers, it cites the fact blocks it drew from (ref taxonomy in
// factBlocks.ts: MARGIN / RISK / SCHEDULE / PACE / RFI / MEMORY / CASH / WATCH /
// ACCURACY / LEAKS / RECORDS). We map each ref to one or two natural next
// questions, so the ask screen can render tappable "ask this next" chips under
// the answer — turning a one-shot reply into a guided investigation with ZERO
// extra model calls. Pure lookup; the chips call the same ask() entry.

export const FOLLOWUP_BY_REF: Record<string, string[]> = {
  MARGIN: [
    "What's driving the margin change?",
    'Which line item is eating the margin?',
  ],
  RISK: [
    'What should I do to lower the risk?',
    'Which job is most at risk right now?',
  ],
  SCHEDULE: [
    "What's causing the delay?",
    'Am I ready for next week?',
  ],
  PACE: [
    'Will this job finish on time?',
    'Which task is falling behind pace?',
  ],
  RFI: [
    'Which RFIs are overdue?',
    "What's the fastest one to close?",
  ],
  MEMORY: [
    'What changed since last week?',
    'Why did we make that call?',
  ],
  CASH: [
    'Which weeks are tight?',
    'What happens to cash if an invoice pays late?',
  ],
  WATCH: [
    "What's the fastest thing I can clear today?",
    'What needs me most this week?',
  ],
  ACCURACY: [
    'Where are your estimates usually off?',
    'What should I double-check?',
  ],
  LEAKS: [
    'Where am I losing money?',
    "What's the biggest leak to plug first?",
  ],
  RECORDS: [
    "What's the health of this job?",
    'What needs my attention here?',
  ],
};

/**
 * Up to two follow-up questions for an answer, derived from the refs it cited.
 * De-duplicated and capped so the chip row stays calm.
 */
export function followupsForRefs(refs: string[]): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    for (const q of FOLLOWUP_BY_REF[ref] ?? []) {
      if (!out.includes(q)) out.push(q);
      if (out.length >= 2) return out;
    }
  }
  return out;
}
