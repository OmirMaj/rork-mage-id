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
  entryHint: 'Start the next pay application from the last one. No progress invoice to make first.',
  carriedHeading: (n: number) => `Carried Forward from Application ${n}`,
  // The job's first application (utils/payApp/firstApplication).
  firstEntryLabel: 'Start the First Pay Application',
  firstEntryHint: 'Starts from the estimate linked to this job, with this period at zero on every line. No progress invoice to make first.',
  firstHasInvoicesHint: 'This job already has an invoice, so the first pay application starts from the invoice. That way what was already billed is counted.',
  firstInvoiceInstead: 'Make a Progress Invoice Instead',
  firstCannotStartTitle: 'Cannot Start Here',
  firstCannotStartBody: 'This job cannot start a pay application on this screen right now. Go back and open it from a progress invoice.',
  firstNoEstimateHint: 'To start the first pay application on one screen, link an estimate to this job. Without one there is no schedule of values to start from.',
  firstHeading: (estimateLines: number, changeOrderLines: number) =>
    `${estimateLines} ${estimateLines === 1 ? 'Line' : 'Lines'} from the Linked Estimate${changeOrderLines > 0 ? ` and ${changeOrderLines} Approved Change ${changeOrderLines === 1 ? 'Order' : 'Orders'}` : ''}`,
  firstLead: 'This is the first application on this job. Nothing is carried in from an earlier one, and nothing is billed until you enter it.',
  firstPeriodNoStart: 'A first application has no earlier period, so the period start is blank. Type it if your owner asks for one.',
  retainageFromRecord: (pct: string, label: string) => `Retainage opens at ${pct}%, ${label}.`,
  retainageNotOnRecord: 'No retainage rate is on record for this job, so this opens at 0%. Set the rate on the pay application before you certify.',
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
  // The footer: the cover's lines 4 to 8 in plain labels, so it adds up when
  // figures carry in from earlier applications.
  completedToDate: 'Completed and Stored to Date',
  retainageToDate: 'Retainage Held to Date',
  completedLessRetainage: 'Completed Less Retainage',
  lessPreviousCertificates: 'Less Previous Certificates',
  paymentDue: 'Payment Due This Application',
  // The draft invoice behind the period, said before he saves.
  invoiceLine: (total: string, taxPct: string | null) => (taxPct
    ? `Saving makes a draft invoice for this period: ${total}, including ${taxPct}% tax.`
    : `Saving makes a draft invoice for this period: ${total}. No tax is set.`),
  invoiceRetainageLine: (held: string) => `It holds ${held} of retainage, the same as this application holds for the period.`,
  termsFromPrior: (label: string) => `Payment terms on it: ${label}, the same as your last invoice on this job.`,
  termsFromSetup: (label: string) => `Payment terms on it: ${label}, from your cash-flow setup.`,
  termsUnconfirmed: 'No payment terms are set yet, so the draft invoice carries no date for payment until you pick terms on the invoice.',
  termsChecking: 'Checking the payment terms in your cash-flow setup.',
  applicationDateFollows: 'Application date is set to the period end. Change it if you date it another day.',
  // A percent he typed that was not entered, and why.
  pctOver: (typed: string) => `${typed} is over 100, so it was not entered. The line is back to where it was.`,
  pctBelowZero: 'A percent below zero was not entered. The line is back to where it was.',
  pctNotNumber: (typed: string) => `"${typed}" is not a percent, so it was not entered. The line is back to where it was.`,
  pctBelowBilled: (typed: string, billedPct: string) => `${typed}% is below the ${billedPct}% already billed, so nothing is entered for this period.`,
  creditLine: 'Credit line. Type the percent of the credit given to date.',
  // Where this period starts from, when that needs saying.
  priorNotSent: (n: number) => `Application ${n} has no record of being sent. This one starts from its figures as they are now, and will not follow if you change Application ${n} later.`,
  undatedSkipped: (n: number, from: number) => `Application ${n} has no period end date, so it could not be placed by date. This one starts from Application ${from}. Check that is the one you mean.`,
  // Leaving with figures entered.
  leaveTitle: 'Leave Bill This Month?',
  leaveBody: (count: number) => `${count} ${count === 1 ? 'line has a figure' : 'lines have figures'} you entered. Nothing is saved yet.`,
  leaveStay: 'Keep Working',
  leaveConfirm: 'Leave',
  // The invoice behind the period and the application, when they differ.
  invoiceFollowed: (invoiceNumber: number) => `Draft Invoice ${invoiceNumber} for this period was updated to these figures.`,
  differsOnApplication: (invoiceNumber: number, invoiceWork: string, appWork: string, invoiceHeld: string, appHeld: string) =>
    `Invoice ${invoiceNumber} for this period and this application differ. The invoice shows ${invoiceWork} of work and ${invoiceHeld} of retainage. This application shows ${appWork} of work and ${appHeld} of retainage.`,
  differsOnInvoice: (applicationNumber: number, invoiceWork: string, appWork: string, invoiceHeld: string, appHeld: string) =>
    `This invoice and Pay Application ${applicationNumber} differ. This invoice shows ${invoiceWork} of work and ${invoiceHeld} of retainage. The application shows ${appWork} of work and ${appHeld} of retainage.`,
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
  savedTitle: 'Period Saved as a Draft',
  // The suggest button on the full pay application screen (replaces Sync).
  suggestButton: 'Suggest from Schedule',
  suggestButtonA11y: 'Show a Suggested Percent for Each Line from the Schedule',
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
    SUGGEST_COPY.notAccepted(1), SUGGEST_COPY.notAccepted(3),
    SUGGEST_COPY.invoiceLine('$1,234.50', '8.25'), SUGGEST_COPY.invoiceLine('$1,234.50', null), SUGGEST_COPY.invoiceRetainageLine('$123.45'),
    SUGGEST_COPY.termsFromPrior('Net 30'), SUGGEST_COPY.termsFromSetup('Net 15'),
    SUGGEST_COPY.pctOver('150'), SUGGEST_COPY.pctNotNumber('12,5'), SUGGEST_COPY.pctBelowBilled('10', '20'),
    SUGGEST_COPY.priorNotSent(3), SUGGEST_COPY.undatedSkipped(5, 4), SUGGEST_COPY.leaveBody(1), SUGGEST_COPY.leaveBody(3),
    SUGGEST_COPY.invoiceFollowed(12),
    SUGGEST_COPY.differsOnApplication(12, '$100.00', '$120.00', '$10.00', '$12.00'),
    SUGGEST_COPY.differsOnInvoice(4, '$100.00', '$120.00', '$10.00', '$12.00'),
    scheduleTaskSentence('Framing', 85), scheduleTaskSentence('Install Beam', 100), scheduleTaskSentence('', 10),
    dailyReportSentence('Framing', 85, '2026-10-28'), dailyReportSentence('Framing', 85, ''),
    weightedTasksSentence(3, 41.7),
    ...Object.values(NO_SUGGESTION),
    wouldGoBackwardsSentence(40, 55), nothingNewSentence(55), changedSentence(40, 35),
  );
  return out;
}
