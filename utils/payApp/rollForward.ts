// utils/payApp/rollForward.ts — the next pay application, started from the
// last one. Easier Pay Applications, Phase 1 ("Bill This Month").
//
// WHAT CARRIES. The schedule of values is the PRIOR APPLICATION'S lines, not a
// rebuild from the estimate: ids, item numbers, descriptions, scheduled values
// and both retainage rates survive the month boundary untouched, because a
// schedule of values is negotiated and a rebuild would undo the negotiation.
// Column D becomes the prior D + E, column F is the stored balance carried,
// and column E starts at ZERO on every line. Nothing is billed by rolling
// forward.
//
// WHAT IS A DEFAULT. Period To is the last day of the month Period From falls
// in. It is a starting value the contractor confirms or retypes; it is not a
// due date and nothing is computed from it but which change orders belong on
// this application.
//
// WHAT IS NOT DONE. Retainage is never stepped down, released or changed. The
// rates carry.
//
// Every figure comes through the functions the pay application screen already
// uses (utils/aiaBilling). Pure: no clock (today is passed in), no storage.
import type { ChangeOrder, Project, SavedAIAPayApp } from '@/types';
import {
  applyApprovedCOsToApplication, carryForwardPriorLines, isCalendarDay,
  nextApplicationNumber, savedLineToSov, seedLessPreviousCertificates, seedPayAppHeader,
  selectPriorApplication, splitApprovedCOsByPeriod,
  type AIAPayApplication, type AIASOVLine, type PayAppContractLike,
} from '@/utils/aiaBilling';
import { roundCents } from '@/utils/invoiceBilling';
import { dayAfter, dayKeyOf, endOfMonth } from '@/utils/payApp/days';

export type RollForwardNote =
  /** Line 1 is the last application's figure, carried as he sent it. */
  | { kind: 'line_one_from_prior'; applicationNumber: number }
  /** Change orders approved through Period To that the last application did not have. */
  | { kind: 'co_added'; count: number }
  /** The last application has no period end, so Period From is left blank. */
  | { kind: 'period_from_unknown' }
  /** The application this one starts from carries no record of being sent (no stamp, no pay link, no payment, no certificate). */
  | { kind: 'prior_not_sent'; applicationNumber: number }
  /** A saved application with a HIGHER number has no period end, so it could not be placed by date and was not the one carried from. */
  | { kind: 'undated_skipped'; applicationNumber: number; carriedFrom: number }
  /** This is the job's first application: the lines are the linked estimate's, nothing is carried. (utils/payApp/firstApplication) */
  | { kind: 'first_application'; lineCount: number; changeOrderLines: number }
  /** The retainage rate on a first application, and where the job's records say it comes from. */
  | { kind: 'retainage_from_record'; percent: number; label: string }
  /** Nothing on the job records a retainage rate: the first application opens at 0 and says so. */
  | { kind: 'retainage_not_on_record' };

export interface RollForwardInput {
  project: Pick<Project, 'id' | 'name' | 'location' | 'description' | 'primaryContact'>;
  /** Every saved application on this project. */
  saved: readonly SavedAIAPayApp[];
  changeOrders: readonly ChangeOrder[];
  contract: PayAppContractLike | null | undefined;
  /** YYYY-MM-DD, passed in. Used only when the last application has no period end. */
  today: string;
}

export interface RollForwardResult {
  /** thisPeriod is 0 on every line. */
  app: AIAPayApplication;
  /** The application this one starts from, or null on the job's first application. */
  carriedFrom: { applicationNumber: number; periodTo?: string } | null;
  period: { from?: string; to: string; toIsDefault: true };
  notes: RollForwardNote[];
}

/**
 * The prior application's lines as this period OPENS: E zeroed, then the one
 * carry-forward rule the screen already uses, applied to the same lines. A
 * suggestion recorded last month belongs to last month and is not carried.
 */
export function carryLinesFromPrior(prior: Pick<SavedAIAPayApp, 'lines'>): AIASOVLine[] {
  const asPrior = prior.lines.map(savedLineToSov);
  const opening: AIASOVLine[] = asPrior.map((l) => {
    const { suggestedPercent: _p, suggestionSource: _s, ...rest } = l;
    void _p; void _s;
    return { ...rest, thisPeriod: 0 };
  });
  return carryForwardPriorLines(opening, asPrior);
}

/**
 * Which saved application is "the last one", and when this period starts.
 * By period end first (the newest dated application), else by number.
 */
function pickPrior(saved: readonly SavedAIAPayApp[], nextNumber: number, today: string): {
  prior: SavedAIAPayApp | null; from: string | undefined; to: string | null;
} {
  const list = [...saved];
  const latestDay = list
    .map(a => dayKeyOf(a.periodTo))
    .filter((d): d is string => d != null)
    .sort()
    .pop();
  if (latestDay) {
    const from = dayAfter(latestDay) ?? undefined;
    const to = endOfMonth(from);
    return {
      prior: selectPriorApplication(list, { thisApplicationNumber: nextNumber, thisPeriodTo: to ?? undefined }),
      from,
      to,
    };
  }
  return {
    prior: selectPriorApplication(list, { thisApplicationNumber: nextNumber }),
    from: undefined,
    to: endOfMonth(today),
  };
}

/**
 * The application date a new period opens with: today, or the period end when
 * that is later. An application is ordinarily dated on or after the last day
 * it bills through, and opening on today would put a date before the period
 * end on every application started before the month is out. A default he can
 * retype; nothing is computed from it.
 */
export function defaultApplicationDate(today: string, periodTo: string | null | undefined): string {
  const t = dayKeyOf(today) ?? today;
  const to = dayKeyOf(periodTo);
  return to && to > t ? to : t;
}

/** Does the record carry any sign that it went out? Old records were never stamped, so this is "no record of", not "was not". */
export function hasRecordOfSend(a: Pick<SavedAIAPayApp, 'sentLockedAt' | 'payLinkUrl' | 'paidAt' | 'amountCertified' | 'paymentPendingAt'>): boolean {
  return !!a.sentLockedAt || !!a.payLinkUrl || !!a.paidAt || !!a.paymentPendingAt || a.amountCertified != null;
}

/**
 * The next application on this project, or null when there is no earlier one
 * to start from (the first application keeps the invoice path).
 */
export function rollForwardNextApplication(input: RollForwardInput): RollForwardResult | null {
  const saved = input.saved.filter(a => a.projectId === input.project.id);
  if (saved.length === 0) return null;
  const applicationNumber = nextApplicationNumber(saved, undefined);
  const { prior, from, to } = pickPrior(saved, applicationNumber, input.today);
  if (!prior || prior.lines.length === 0 || !to) return null;

  const header = seedPayAppHeader(prior, input.contract, input.project);
  const notes: RollForwardNote[] = [{ kind: 'line_one_from_prior', applicationNumber: prior.applicationNumber }];
  if (!from) notes.push({ kind: 'period_from_unknown' });
  if (!hasRecordOfSend(prior)) notes.push({ kind: 'prior_not_sent', applicationNumber: prior.applicationNumber });
  // A newer application (by number) that has no period end cannot be placed
  // by date. It is not carried from, and that is SAID.
  for (const a of saved) {
    if (a.id !== prior.id && a.applicationNumber > prior.applicationNumber && !dayKeyOf(a.periodTo)) {
      notes.push({ kind: 'undated_skipped', applicationNumber: a.applicationNumber, carriedFrom: prior.applicationNumber });
    }
  }

  const base: AIAPayApplication = {
    sovBasis: prior.sovBasis,
    applicationNumber,
    applicationDate: defaultApplicationDate(input.today, to),
    periodTo: to,
    periodFrom: from,
    contractDate: header.contractDate,
    ownerName: header.ownerName,
    contractorName: prior.contractorName,
    architectName: header.architectName,
    projectName: prior.projectName || input.project.name,
    projectLocation: prior.projectLocation ?? input.project.location,
    contractForDescription: prior.contractForDescription ?? input.project.description,
    originalContractSum: roundCents(prior.originalContractSum),
    netChangeByCO: roundCents(prior.netChangeByCO),
    contractSumToDate: roundCents(prior.contractSumToDate),
    retainagePercent: prior.retainagePercent,
    storedRetainagePercent: prior.storedRetainagePercent,
    lessPreviousCertificates: seedLessPreviousCertificates(prior),
    notarize: prior.notarize,
    notaryState: prior.notaryState,
    notaryCounty: prior.notaryCounty,
    lines: carryLinesFromPrior(prior),
  };

  const before = base.lines.length;
  const app = restatePeriodTo(base, input.changeOrders, to);
  const added = app.lines.length - before;
  if (added > 0) notes.push({ kind: 'co_added', count: added });

  return {
    app,
    carriedFrom: { applicationNumber: prior.applicationNumber, periodTo: prior.periodTo || undefined },
    period: { from, to, toIsDefault: true },
    notes,
  };
}

/**
 * Period To changed: restate the change orders that belong on this
 * application, exactly as the pay application screen's own Period To field
 * does. A value that is not a date changes the field and nothing else.
 */
export function restatePeriodTo(
  app: AIAPayApplication,
  changeOrders: readonly ChangeOrder[],
  periodTo: string,
): AIAPayApplication {
  const next = { ...app, periodTo };
  if (!isCalendarDay(periodTo)) return next;
  return applyApprovedCOsToApplication(next, splitApprovedCOsByPeriod([...changeOrders], periodTo).inPeriod);
}
