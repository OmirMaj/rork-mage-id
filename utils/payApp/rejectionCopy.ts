// utils/payApp/rejectionCopy.ts — every word the Rejection Check shows, in one
// table so scripts/validate-pay-app-easy.ts can execute it.
//
// THE RULES (design-previews/pay-apps/EASIER-PAY-APPS.md, rules 2, 4 and 5):
//   • Every sentence states a FACT about the contractor's own numbers. None
//     says what a reviewer will do, and none gives a verdict.
//   • A check that found nothing reads "Nothing flagged". There is no tick, no
//     score, no percent, and none of the words in REJECTION_BANNED_WORDS.
//   • Two narrow exceptions, both pinned by the validator: the lead sentence
//     says what the check does NOT say ("correct", "accepted", negated), and
//     the change order rules name a change order's own status in the
//     contractor's log ("approved" is that status, not the app's opinion).
//   • No deadline is computed or named. Dates shown are ones he typed.
//
// Pure: strings in, strings out.
import { formatMoney } from '@/utils/formatters';
import { fmtPct } from '@/utils/payApp/suggestCopy';
import { longDay } from '@/utils/payApp/days';

/** Words that would read as the app passing judgement. */
export const REJECTION_BANNED_WORDS: readonly string[] = [
  'approved', 'compliant', 'valid', 'passed', 'pass', 'ready', 'verified', 'certified',
  'accepted', 'sufficient', 'guaranteed', 'will be paid', 'correct', 'all clear', 'ok',
  'deadline', 'due date',
];

const money = (n: number): string => formatMoney(n, 2);

export const REJECTION_COPY = {
  title: 'Rejection Check',
  subtitle: 'Things a Reviewer May Question',
  /** Always shown, flagged or not. */
  lead: 'Sums and comparisons run on your own numbers. They do not say this application is correct or that it will be accepted.',
  flaggedHeading: (n: number) => (n === 0 ? 'Nothing Flagged' : n === 1 ? '1 Thing to Look At' : `${n} Things to Look At`),
  cleanHeading: (n: number) => (n === 1 ? '1 Check Ran and Flagged Nothing' : `${n} Checks Ran and Flagged Nothing`),
  notRunHeading: (n: number) => (n === 1 ? '1 Check Did Not Run' : `${n} Checks Did Not Run`),
  nothingFlagged: 'Nothing flagged',
  /** The fixed block. Always shown, word for word. */
  notCheckedHeading: 'Not Checked by MAGE ID',
  notCheckedLabel: 'Not checked by MAGE ID:',
  notCheckedBody: 'what your contract allows, whether the work is done, lien and notice deadlines, which waiver form applies. Ask your attorney.',
  goToLine: (itemNo: string) => `Go to Line ${itemNo}`,
  fixLine: (itemNo: string) => `Fix Line ${itemNo}`,
  continueAnyway: 'Continue Anyway',
  back: 'Back',
  open: 'Rejection Check',
  openA11y: 'Open the Rejection Check',
} as const;

/** Why a check did not run. */
export const NOT_RUN_WHY = {
  no_prior: 'No earlier application on this project.',
  needs_dates: 'Needs dates the app can read.',
  needs_period_from: 'Needs a period from date.',
  needs_prior_period: 'The last application has no period end date.',
  needs_checklist: 'Needs your owner checklist.',
} as const;

/** The label a check carries when it ran and flagged nothing, and when it did not run. */
export const CHECK_LABELS = {
  line_over_value: () => 'No line is billed past its scheduled value',
  total_over_contract: () => 'Total billed is not over the contract sum to date',
  sov_not_footing: () => 'Schedule of values sums to contract sum',
  previous_mismatch: (n?: number) => (n ? `Previous billing equals Application ${n}` : 'Previous billing equals the last application'),
  previous_line_missing: (n?: number) => (n ? `Every line billed on Application ${n} is on this one` : 'Every line billed before is on this one'),
  line7_mismatch: (n?: number) => (n ? `Less previous certificates carries from Application ${n}` : 'Less previous certificates carries from the last application'),
  stored_in_previous: () => 'Stored materials that came down moved into work',
  went_backwards: () => 'No line goes backwards',
  retainage: (rate?: number) => (rate != null ? `Retainage equals your ${fmtPct(rate)}% rate` : 'Lines carry one retainage rate'),
  co_billed_not_approved: () => 'Every change order billed is approved in your log',
  co_approved_missing: () => 'Every change order approved in this period is on the schedule of values',
  co_summary_mismatch: () => 'Net change by change orders equals your change order log',
  contract_sum_math: () => 'Contract sum to date is the original sum plus change orders',
  cover_vs_sheet: () => 'Totals add up, cover and sheet agree',
  payment_not_positive: () => 'Payment due on this application is above zero',
  dates_invalid: () => 'Dates can be read',
  period_order: () => 'Period from is on or before period to',
  period_sequence: () => 'Period starts the day after the last one',
  app_date_before_period_end: () => 'Application date is on or after the period end',
  number_sequence: (m?: number) => (m != null ? `Application number follows ${m}` : 'Application number is 1'),
  nothing_billed: () => 'Work or stored materials are entered for this period',
  stored_no_backup: () => 'Stored materials have backup attached',
  checklist_missing: () => 'Everything on your owner checklist is in the package',
  notary_checklist: () => 'Notary block matches your owner checklist',
} as const;

const lineName = (itemNo: string, description: string): string =>
  (description.trim() ? `Line ${itemNo}, ${description.trim()},` : `Line ${itemNo}`);

/** The findings. Each returns the summary and the detail of one flagged thing: sentences about his
 *  numbers, in sentence case (they are not labels). */
export const FINDING_COPY = {
  line_over_value: (itemNo: string, description: string, billed: number, scheduled: number, over: number) => ({
    summary: `${lineName(itemNo, description)} is billed past its scheduled value`,
    detail: `Billed to date ${money(billed)} against ${money(scheduled)}. Over by ${money(over)}.`,
  }),
  total_over_contract: (billed: number, contract: number, over: number) => ({
    summary: 'Total billed is over the contract sum to date',
    detail: `Total completed and stored is ${money(billed)}. Contract sum to date is ${money(contract)}. Over by ${money(over)}.`,
  }),
  sov_not_footing: (sum: number, contract: number, diff: number) => ({
    summary: 'The schedule of values does not add up to the contract sum',
    detail: `The schedule of values adds up to ${money(sum)}. Contract sum to date is ${money(contract)}. They differ by ${money(Math.abs(diff))}.`,
  }),
  previous_mismatch: (itemNo: string, shown: number, n: number, ended: number) => ({
    summary: `Line ${itemNo}: previous work does not equal Application ${n}`,
    detail: `Previous work shows ${money(shown)}. Application ${n} ended at ${money(ended)}.`,
  }),
  previous_line_missing: (n: number, amount: number, description: string, itemNo: string) => ({
    summary: `A line billed on Application ${n} is not on this one`,
    detail: `Application ${n} billed ${money(amount)} on ${description.trim() || `Item ${itemNo}`}. That line is not on this application.`,
  }),
  line7_mismatch: (shown: number, n: number, carries: number) => ({
    summary: `Less previous certificates does not equal Application ${n}`,
    detail: `Less previous certificates shows ${money(shown)}. Application ${n} carries ${money(carries)}.`,
  }),
  stored_in_previous: (itemNo: string, fell: number) => ({
    summary: `Line ${itemNo}: stored materials fell without the same work added`,
    detail: `Stored materials fell by ${money(fell)} and work this period did not rise by the same amount.`,
  }),
  went_backwards_negative: (itemNo: string, amount: number) => ({
    summary: `Line ${itemNo}: work this period is below zero`,
    detail: `Work this period shows ${money(amount)}.`,
  }),
  went_backwards_total: (itemNo: string, n: number, now: number, before: number) => ({
    summary: `Line ${itemNo}: total to date is lower than on Application ${n}`,
    detail: `Total to date is ${money(now)}. Application ${n} showed ${money(before)}.`,
  }),
  retainage_rate: (count: number, rates: number[], stated: number, origin: string, stored: boolean) => ({
    summary: stored ? 'Stored material retainage differs from the rate on record' : 'Retainage differs from the rate on record',
    detail: `Retainage on ${count} ${count === 1 ? 'line' : 'lines'} is ${rates.map(r => `${fmtPct(r)}%`).join(', ')}. `
      + `The rate on this project is recorded as ${fmtPct(stated)}%${origin ? ` (${origin})` : ''}.`,
  }),
  retainage_mixed: (rates: number[]) => ({
    summary: 'Lines carry different retainage rates',
    detail: `Lines carry different retainage rates: ${rates.map(r => `${fmtPct(r)}%`).join(', ')}.`,
  }),
  co_billed_status: (itemNo: string, coNumber: number, status: string) => ({
    summary: `Line ${itemNo} bills a change order that is not approved in your log`,
    detail: `Line ${itemNo} bills Change Order ${coNumber}. Its status is ${status}.`,
  }),
  co_billed_after_period: (itemNo: string, coNumber: number, approvedOn: string) => ({
    summary: `Line ${itemNo} bills a change order approved after this period`,
    detail: `Line ${itemNo} bills Change Order ${coNumber}. It was approved on ${longDay(approvedOn) || approvedOn}, after this period ends.`,
  }),
  co_billed_not_in_log: (itemNo: string) => ({
    summary: `Line ${itemNo} bills a change order that is not in your log`,
    detail: `Line ${itemNo} is a change order line with money on it, and your change order log has no change order for it.`,
  }),
  co_approved_missing: (coNumber: number, amount: number) => ({
    summary: `Change Order ${coNumber} is approved and is not on the schedule of values`,
    detail: `Change Order ${coNumber} for ${money(amount)} is approved and is not on the schedule of values.`,
  }),
  co_summary_mismatch: (shown: number, log: number) => ({
    summary: 'Net change by change orders does not equal your change order log',
    detail: `Net change by change orders shows ${money(shown)}. The change order summary adds up to ${money(log)}.`,
  }),
  contract_sum_math: (l1: number, l2: number, l3: number) => ({
    summary: 'Contract sum to date is not the original sum plus change orders',
    detail: `Original contract sum ${money(l1)} plus change orders ${money(l2)} is ${money(l1 + l2)}. Contract sum to date shows ${money(l3)}.`,
  }),
  cover_vs_sheet: (field: string, cover: number, sheet: number) => ({
    summary: `The cover and the continuation sheet do not agree on ${field}`,
    detail: `The cover shows ${money(cover)}. The lines add up to ${money(sheet)}.`,
  }),
  payment_not_positive: (due: number) => ({
    summary: 'Payment due is not above zero',
    detail: `Payment due on this application is ${money(due)}.`,
  }),
  dates_invalid: (field: string) => ({
    summary: `${field} is not a date the app can read`,
    detail: `${field} is not a date the app can read. Type it as year, month, day, like 2026-10-31.`,
  }),
  period_order: () => ({
    summary: 'Period from is after period to',
    detail: 'Period from is after period to.',
  }),
  period_overlap: (from: string, n: number, through: string) => ({
    summary: `This period starts before Application ${n} ended`,
    detail: `This period starts ${longDay(from)}. Application ${n} ran through ${longDay(through)}.`,
  }),
  period_gap: (days: number, n: number) => ({
    summary: `There is a gap after Application ${n}`,
    detail: `There ${days === 1 ? 'is 1 day' : `are ${days} days`} between the end of Application ${n} and the start of this one.`,
  }),
  app_date_before_period_end: () => ({
    summary: 'The application date is before the period ends',
    detail: 'The application date is before the period ends.',
  }),
  number_duplicate: (n: number) => ({
    summary: `Application ${n} is used twice on this project`,
    detail: `This is Application ${n}. Another saved application on this project has the same number.`,
  }),
  number_sequence: (n: number, m: number) => ({
    summary: `Application ${n} does not follow ${m}`,
    detail: `This is Application ${n}. The last one on this project is ${m}.`,
  }),
  number_first: (n: number) => ({
    summary: `Application ${n} has no earlier application`,
    detail: `This is Application ${n}. No earlier application is saved on this project.`,
  }),
  nothing_billed: () => ({
    summary: 'Nothing is entered for this period',
    detail: 'No work or stored materials are entered for this period.',
  }),
} as const;

export const DATE_FIELD_NAMES = {
  applicationDate: 'Application date',
  periodTo: 'Period to',
  periodFrom: 'Period from',
} as const;

export const COVER_FIELD_NAMES = {
  completed: 'total completed and stored',
  retainage: 'retainage',
  payment: 'payment due',
} as const;

/** One of every sentence above, for the wording guard. */
export function allRejectionCopy(): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const add = (id: string, ...texts: string[]) => texts.forEach(text => out.push({ id, text }));
  const R = REJECTION_COPY;
  add('static', R.title, R.subtitle, R.flaggedHeading(0), R.flaggedHeading(1), R.flaggedHeading(4),
    R.cleanHeading(1), R.cleanHeading(7), R.notRunHeading(1), R.notRunHeading(3), R.nothingFlagged,
    R.notCheckedHeading, R.notCheckedLabel, R.goToLine('9'), R.fixLine('9'), R.continueAnyway, R.back, R.open, R.openA11y);
  add('lead', R.lead);
  add('not_checked', R.notCheckedBody);
  add('static', ...Object.values(NOT_RUN_WHY));
  for (const [id, fn] of Object.entries(CHECK_LABELS)) {
    add(`label:${id}`, (fn as (a?: number) => string)(), (fn as (a?: number) => string)(3));
  }
  const F = FINDING_COPY;
  const pair = (id: string, f: { summary: string; detail: string }) => add(id, f.summary, f.detail);
  pair('line_over_value', F.line_over_value('9', 'Tile', 29120, 28000, 1120));
  pair('line_over_value', F.line_over_value('9', '', 29120, 28000, 1120));
  pair('total_over_contract', F.total_over_contract(101, 100, 1));
  pair('sov_not_footing', F.sov_not_footing(101, 100, 1));
  pair('previous_mismatch', F.previous_mismatch('2', 10, 3, 12));
  pair('previous_line_missing', F.previous_line_missing(3, 500, 'Framing', '2'));
  pair('previous_line_missing', F.previous_line_missing(3, 500, '', '2'));
  pair('line7_mismatch', F.line7_mismatch(10, 3, 12));
  pair('stored_in_previous', F.stored_in_previous('7', 600));
  pair('went_backwards', F.went_backwards_negative('4', -50));
  pair('went_backwards', F.went_backwards_total('4', 3, 900, 1000));
  pair('retainage_rate', F.retainage_rate(2, [5], 10, 'from your contract', false));
  pair('retainage_rate', F.retainage_rate(1, [5, 7.5], 10, '', true));
  pair('retainage_mixed', F.retainage_mixed([5, 10]));
  pair('co_billed_not_approved', F.co_billed_status('14', 3, 'submitted'));
  pair('co_billed_not_approved', F.co_billed_after_period('14', 3, '2026-11-03'));
  pair('co_billed_not_approved', F.co_billed_not_in_log('14'));
  pair('co_approved_missing', F.co_approved_missing(3, 6400));
  pair('co_summary_mismatch', F.co_summary_mismatch(100, 200));
  pair('contract_sum_math', F.contract_sum_math(100, 20, 130));
  pair('cover_vs_sheet', F.cover_vs_sheet(COVER_FIELD_NAMES.completed, 10, 11));
  pair('cover_vs_sheet', F.cover_vs_sheet(COVER_FIELD_NAMES.retainage, 10, 11));
  pair('cover_vs_sheet', F.cover_vs_sheet(COVER_FIELD_NAMES.payment, 10, 11));
  pair('payment_not_positive', F.payment_not_positive(0));
  pair('dates_invalid', F.dates_invalid(DATE_FIELD_NAMES.applicationDate));
  pair('dates_invalid', F.dates_invalid(DATE_FIELD_NAMES.periodTo));
  pair('dates_invalid', F.dates_invalid(DATE_FIELD_NAMES.periodFrom));
  pair('period_order', F.period_order());
  pair('period_overlap', F.period_overlap('2026-10-01', 3, '2026-10-05'));
  pair('period_gap', F.period_gap(1, 3));
  pair('period_gap', F.period_gap(12, 3));
  pair('app_date_before_period_end', F.app_date_before_period_end());
  pair('number_sequence', F.number_duplicate(4));
  pair('number_sequence', F.number_sequence(6, 4));
  pair('number_sequence', F.number_first(3));
  pair('nothing_billed', F.nothing_billed());
  return out;
}
