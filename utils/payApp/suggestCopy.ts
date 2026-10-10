// utils/payApp/suggestCopy.ts — every sentence Bill This Month shows about a
// suggested percent, in one table so scripts/validate-pay-app-easy.ts can
// execute it.
//
// THE RULE (design-previews/pay-apps/EASIER-PAY-APPS.md, rule 10): a
// suggestion is labelled with where it came from and is never applied by
// itself. So every sentence here names a source the contractor can open, and
// none of them says what the percent "is". The verbs are "reported", "marked"
// and "suggested". The words in SUGGEST_BANNED_WORDS never appear.
//
// Pure: strings in, strings out.
import { formatMoney } from '@/utils/formatters';
import { shortDay } from '@/utils/payApp/days';

/** Words that would turn a suggestion into the app's finding. */
export const SUGGEST_BANNED_WORDS: readonly string[] = [
  'verified', 'confirmed', 'earned', 'approved', 'certified', 'compliant',
  'correct', 'valid', 'accurate', 'guaranteed',
];

/** 85 → "85", 42.5 → "42.5", 33.333 → "33.3". One decimal, never a whole-percent round. */
export function fmtPct(n: number): string {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export const SUGGEST_COPY = {
  screenTitle: 'Bill This Month',
  ownerPreview: 'Owner Preview',
  carriedHeading: (n: number) => `Carried Forward From Application ${n}`,
  wasTo: (wasPct: string) => `Was ${wasPct}%`,
  to: 'to',
  accept: 'Accept',
  accepted: 'Accepted',
  yours: 'Yours',
  acceptAll: 'Accept All Suggestions',
  acceptAllTitle: 'Accept All Suggestions?',
  acceptAllBody: (count: number, total: number) =>
    `${count} ${count === 1 ? 'suggestion' : 'suggestions'} adding up to ${formatMoney(total, 2)} will be entered as this period's work. `
    + 'Each one came from your schedule or your daily reports. Look at each line before you send.',
  acceptAllConfirm: 'Accept All',
  cancel: 'Cancel',
  workThisApplication: 'Work This Application',
  retainageAt: (pct: string) => `Retainage at ${pct}%, your rate`,
  retainageMixed: 'Retainage, your rates',
  paymentDue: 'Payment Due This Application',
  next: 'Next: Rejection Check',
  notAccepted: (count: number) =>
    `${count} ${count === 1 ? 'suggestion is' : 'suggestions are'} not accepted and not in the total.`,
  periodToDefault: 'Period to is set to the end of the month. Change it if your period ends on another day.',
  periodNoStart: 'The last application has no period end date, so the period start is blank. Type it if your owner asks for one.',
  // What a suggestion is, said once at the top of the list.
  lead: 'Each suggested percent shows where it came from. Nothing counts until you accept it or type your own.',
  // Bill This Month has nothing to roll forward.
  noPriorTitle: 'No Earlier Application On This Project',
  noPriorBody: 'Bill This Month starts from the last pay application. Make the first one from a progress invoice.',
  nothingEntered: 'Accept or type at least one line before you save this period.',
  ownerOnly: 'Only the project owner bills.',
  savedTitle: 'Period Saved As A Draft',
  // The suggest button on the full pay application screen (replaces Sync).
  suggestButton: 'Suggest From Schedule',
  suggestButtonA11y: 'Show A Suggested Percent For Each Line From The Schedule',
  noScheduleTitle: 'No Schedule On This Project',
  noScheduleBody: 'Suggestions come from schedule tasks linked to your lines, and this project has no schedule yet.',
  noneFoundTitle: 'No Suggestions',
  noneFoundBody: 'No line has a linked schedule task with new progress. Lines without one say why.',
} as const;

// ── Where a percent came from ───────────────────────────────────────────────

export function scheduleTaskSentence(taskTitle: string, progress: number): string {
  const name = taskTitle.trim() || 'Linked task';
  return progress >= 100
    ? `Schedule: ${name} is marked done.`
    : `Schedule: ${name} is marked ${fmtPct(progress)}%.`;
}

export function dailyReportSentence(taskTitle: string, pct: number, reportDate: string): string {
  const name = taskTitle.trim() || 'Linked task';
  const day = shortDay(reportDate);
  return `Daily report: ${name} reported ${fmtPct(pct)}%${day ? ` on ${day}` : ''}.`;
}

export function weightedTasksSentence(count: number, percent: number): string {
  return `Schedule: ${count} linked tasks, weighted by duration, come to ${fmtPct(percent)}%.`;
}

// ── Why there is no suggestion ──────────────────────────────────────────────

export const NO_SUGGESTION = {
  no_linked_task: 'No suggestion. No schedule task is linked to this line.',
  no_progress_reported: 'No suggestion. The linked schedule task shows no progress yet.',
  billed_in_full: 'Billed in full. Nothing to enter.',
  not_positive_value: 'No suggestion. This line has no positive scheduled value.',
} as const;

export function wouldGoBackwardsSentence(suggestedPct: number, billedPct: number): string {
  return `Schedule shows ${fmtPct(suggestedPct)}%. Already billed ${fmtPct(billedPct)}%. Nothing suggested.`;
}

export function nothingNewSentence(suggestedPct: number): string {
  return `Schedule shows ${fmtPct(suggestedPct)}%. That is already billed. Nothing suggested.`;
}

// ── After the contractor acts ───────────────────────────────────────────────

/** Shown under a line he typed over: the suggestion stays visible. */
export function changedSentence(suggestedPct: number, enteredPct: number): string {
  return `Schedule suggested ${fmtPct(suggestedPct)}%. You entered ${fmtPct(enteredPct)}%.`;
}

/** Every static sentence above, for the wording guard. */
export function allSuggestCopy(): string[] {
  const out: string[] = [];
  for (const v of Object.values(SUGGEST_COPY)) {
    if (typeof v === 'string') out.push(v);
  }
  out.push(
    SUGGEST_COPY.carriedHeading(3), SUGGEST_COPY.wasTo('60'), SUGGEST_COPY.acceptAllBody(1, 100), SUGGEST_COPY.acceptAllBody(4, 12345.6),
    SUGGEST_COPY.retainageAt('10'), SUGGEST_COPY.notAccepted(1), SUGGEST_COPY.notAccepted(3),
    scheduleTaskSentence('Framing', 85), scheduleTaskSentence('Install Beam', 100), scheduleTaskSentence('', 10),
    dailyReportSentence('Framing', 85, '2026-10-28'), dailyReportSentence('Framing', 85, ''),
    weightedTasksSentence(3, 41.7),
    ...Object.values(NO_SUGGESTION),
    wouldGoBackwardsSentence(40, 55), nothingNewSentence(55), changedSentence(40, 35),
  );
  return out;
}
