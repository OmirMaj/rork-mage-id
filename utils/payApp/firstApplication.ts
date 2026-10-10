// utils/payApp/firstApplication.ts — the FIRST pay application on a job,
// started on the Bill This Month screen with no progress invoice made first.
// Easier Pay Applications, Phase 1b.
//
// Until now Bill This Month only opened when an earlier application existed to
// roll forward. A job's first application still began in Bill From Estimate:
// make an invoice, then open the pay application from it. This file lets the
// first one start the same way every later one does.
//
// WHERE THE LINES COME FROM. The job's LINKED ESTIMATE, one line per estimate
// item, plus one line per change order approved on or before Period To. It is
// built by the function the pay application screen itself uses for a first
// period (utils/aiaBilling seedAIAPayApplicationFromInvoice), handed an
// invoice that bills NOTHING, so every figure and every line id is the one
// that screen would have produced, and this period is ZERO on every line.
// Nothing is billed by starting.
//
// WHAT IT REFUSES. A job with no linked estimate has no schedule of values to
// start from, and one is not invented: the first application then stays on the
// invoice path, and the screen says why. A job that already has an application
// with lines rolls forward instead (utils/payApp/rollForward).
//
// A JOB THAT ALREADY HAS AN INVOICE IS REFUSED TOO. This path opens every line
// with nothing billed before, and saving it makes a NEW draft invoice for the
// period. On a job where work was already invoiced (Bill From Estimate, never
// turned into a pay application) that would bill the same work a second time.
// So any invoice on the job, of any kind or status, sends the first
// application back to the invoice path, where the period IS that invoice.
//
// RETAINAGE IS NEVER MADE UP. The rate is the one on record for the job
// (utils/retainageSource: the rate typed on the job, or an earlier saved
// application's). When nothing records a rate the application opens at 0
// and SAYS that no rate is on record; the contractor sets it on the pay
// application before he certifies. There is no default percent.
//
// Period To opens on the last day of this month, a starting value he confirms
// or retypes. Period From is blank: a first application has no earlier period
// to start after.
//
// Pure: no clock (today is passed in), no storage, no network.
import type { ChangeOrder, CompanyBranding, Invoice, Project, SavedAIAPayApp } from '@/types';
import {
  nextApplicationNumber, seedAIAPayApplicationFromInvoice, splitApprovedCOsByPeriod,
  type PayAppContractLike,
} from '@/utils/aiaBilling';
import { resolveRetainagePercent } from '@/utils/retainageSource';
import { endOfMonth } from '@/utils/payApp/days';
import { defaultApplicationDate, type RollForwardResult } from '@/utils/payApp/rollForward';
import { billKeyOfLineId } from '@/utils/payApp/periodInvoice';
import { CO_BILL_KEY_PREFIX } from '@/utils/changeOrderBilling';

/** How many of these lines are approved change orders (the rest are the estimate's). */
export function changeOrderLineCount(lines: readonly { id: string }[]): number {
  return lines.filter(l => (billKeyOfLineId(l.id) ?? '').startsWith(CO_BILL_KEY_PREFIX)).length;
}

/** Why Bill This Month can or cannot start a first application on this job. */
export type FirstApplicationState =
  | 'can_start'
  /** An application with lines exists: the next one rolls forward from it. */
  | 'has_application'
  /** The job already has an invoice: starting at zero here could bill work a second time. */
  | 'has_invoices'
  /** No linked estimate, or one with no items: there is no schedule of values to start from. */
  | 'no_estimate';

export function firstApplicationState(
  project: Pick<Project, 'id' | 'linkedEstimate'>,
  saved: readonly Pick<SavedAIAPayApp, 'projectId' | 'lines'>[],
  invoices: readonly Pick<Invoice, 'projectId'>[],
): FirstApplicationState {
  if (saved.some(a => a.projectId === project.id && a.lines.length > 0)) return 'has_application';
  if (invoices.some(i => i.projectId === project.id)) return 'has_invoices';
  return (project.linkedEstimate?.items?.length ?? 0) > 0 ? 'can_start' : 'no_estimate';
}

export interface FirstApplicationInput {
  project: Project;
  /** Every saved application on this project. */
  saved: readonly SavedAIAPayApp[];
  changeOrders: readonly ChangeOrder[];
  contract: PayAppContractLike | null | undefined;
  branding: CompanyBranding;
  /** Every invoice the account holds (any job). Only asked whether THIS job has one. */
  invoices: readonly Pick<Invoice, 'projectId'>[];
  /** YYYY-MM-DD, passed in. */
  today: string;
}

/**
 * Application 1 for this job, with this period at zero on every line, or null
 * when the job cannot start one here (see firstApplicationState).
 */
export function startFirstApplication(input: FirstApplicationInput): RollForwardResult | null {
  const { project, today } = input;
  if (firstApplicationState(project, input.saved, input.invoices) !== 'can_start') return null;
  const to = endOfMonth(today);
  if (!to) return null;

  const mine = input.saved.filter(a => a.projectId === project.id);
  // No invoice exists on this job (see above), so the rate is the one typed on the job, else one an earlier saved
  // application recorded (a record saved with no lines still carries its rate).
  const rate = resolveRetainagePercent({ priorInvoices: [], project, payApps: mine });
  // An invoice that bills nothing: the seeder reads its lines (none), and takes
  // every date and the rate from the options below, not from it.
  const nothingBilled = {
    id: '', projectId: project.id, number: 0, type: 'progress', progressPercent: 0,
    issueDate: today, dueDate: '', lineItems: [], notes: '', retentionPercent: rate.percent,
  } as unknown as Invoice;
  const approvedThroughPeriod = splitApprovedCOsByPeriod([...input.changeOrders], to).inPeriod;

  const app = seedAIAPayApplicationFromInvoice(nothingBilled, project, approvedThroughPeriod, input.branding, {
    // 1 on a clean job. A record saved with no lines still used its number, so the sequence goes on from it.
    applicationNumber: nextApplicationNumber(mine, undefined),
    retainagePercent: rate.percent,
    contract: input.contract,
    periodTo: to,
    applicationDate: defaultApplicationDate(today, to),
    periodFrom: undefined,
    lessPreviousCertificates: 0,
  });
  // The seeder's fallback when a job has no linked estimate is to rebuild the schedule from the invoice's own
  // lines. This invoice has none, so that basis can only be an empty schedule: refuse it rather than open one.
  if (app.sovBasis !== 'linked_estimate' || app.lines.length === 0) return null;
  // Belt and braces on the one promise this file makes: starting bills nothing.
  if (app.lines.some(l => l.thisPeriod !== 0 || l.fromPreviousApp !== 0 || l.materialsPresentlyStored !== 0)) return null;

  return {
    app: { ...app, notes: undefined },
    carriedFrom: null,
    period: { from: undefined, to, toIsDefault: true },
    notes: [
      { kind: 'first_application', lineCount: app.lines.length, changeOrderLines: changeOrderLineCount(app.lines) },
      rate.needsAsk
        ? { kind: 'retainage_not_on_record' }
        : { kind: 'retainage_from_record', percent: rate.percent, label: rate.label },
    ],
  };
}
