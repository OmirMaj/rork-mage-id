// financialReports.ts — pure data computations behind the Reports hub.
//
// Three reports, all derived from the same project + invoices + commitments
// + change-orders inputs:
//
//   • WIP (work-in-progress) — bank-ready: contract, change-orders,
//     revised contract, % complete, billed, paid, retainage, EAC, profit.
//   • Profit-per-project — revenue (estimate + approved COs) minus
//     projected final cost (from the job-cost engine), running margin %.
//   • AR aging — open invoices bucketed by days-past-due (0-30, 31-60,
//     61-90, 90+). Uses dueDate vs today. Excludes DRAFTS (never sent, so
//     never owed) and anything fully collected. ("ignores closed/canceled",
//     which this line used to say, described statuses InvoiceStatus has never
//     had — and no filter of any kind was actually applied.)
//
// All amounts in USD. All return shapes are PURE so the screen can
// memoize them and the PDF builders can serialize them as-is.

import type { Project, Invoice, ChangeOrder, Commitment } from '@/types';
import { computeJobCost, type JobCostActualSources } from './jobCostEngine';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { invoiceOutstanding, pendingRetentionHeld } from '@/utils/invoiceBilling';

// ─── WIP ─────────────────────────────────────────────────────────────

export interface WIPRow {
  projectId: string;
  projectName: string;
  contractValue: number;        // original signed contract (linked estimate grand total or estimate.grandTotal)
  approvedChangeOrders: number; // sum of approved CO change amounts
  revisedContract: number;      // contractValue + approvedChangeOrders
  percentComplete: number;      // 0–100, cost basis (job actual / EAC) like utils/wip.ts; schedule progress when no cost yet
  billedToDate: number;         // sum of every invoice's totalDue (issued amount)
  paidToDate: number;           // sum of every invoice's amountPaid
  unbilled: number;             // revisedContract * %complete - billed (≥ 0)
  retainageHeld: number;        // sum of (retentionAmount - retentionReleased) on every invoice
  estimatedFinalCost: number;   // job-cost engine projectedFinal
  projectedProfit: number;      // revisedContract - estimatedFinalCost
  projectedMargin: number;      // projectedProfit / revisedContract * 100
  status: Project['status'];
}

export interface WIPReport {
  asOf: string;
  rows: WIPRow[];
  totals: {
    contractValue: number;
    approvedChangeOrders: number;
    revisedContract: number;
    billedToDate: number;
    paidToDate: number;
    retainageHeld: number;
    estimatedFinalCost: number;
    projectedProfit: number;
    projectedMargin: number;
  };
}

// MONEY-DEF-1 (audit 2026-09-07): both reports below call the job-cost engine,
// and both used to call it with NO receipts and NO time entries — so their
// cost-to-date was subs-and-POs only, missing every dollar of materials and
// self-perform labor. On the WIP tab that lands in front of a bank; on the
// Profit report it prints a margin the job does not have. The screen already
// holds these (app/job-costing.tsx wires useMaterialReceipts / time entries /
// useLaborRates), so they are forwarded here rather than re-derived. Default
// `{}` keeps a caller that has not been wired yet compiling — and honest: it
// gets the same lower bound it got before, not a silently different number.
//
// `costSources` is spread WHOLE into the engine at both call sites, so it
// carries every field of JobCostActualSources — including the `equipment` and
// `permits` that MONEY-EQP-1 / MONEY-PMT-1 added after this was written. There
// is no per-field list here to fall behind the type: widening
// JobCostActualSources widens these reports the same day.
//
// HOW FAR THE GUARD ACTUALLY REACHES, measured rather than assumed (mutation-
// tested 2026-09-08). scripts/validate-money-definitions.ts regex-counts the
// engine calls in this file against the ones carrying a `...costSources`
// spread, so DELETING a spread fails it immediately, three assertions at once.
// What it does not catch is a spread that is kept and then overridden: append
// `, equipment: [], permits: []` after the spread at both call sites and the
// regex still matches, while every arithmetic assertion in that guard is built
// from receipts / timeEntries / laborRates alone — it passes 89/89 with
// machine time and permit fees silently deleted from a page a bank reads.
// validate-job-cost and validate-wip-parity pass on that mutation too.
//
// So the spread is protected against removal, not against narrowing. If you
// override a field of it, only review will stop you — do not read a green
// guard as permission. (That regex also counts occurrences in PROSE, which is
// why this paragraph talks around the call's name instead of quoting it.)
//
// WHICH MEANS THE UNDERSTATEMENT THAT REMAINS IS ENTIRELY AT THE CALL SITES.
// A caller that omits the argument gets subs-and-POs only, and the omission
// compiles silently because the parameter is optional and positional. As of
// this pass the callers still passing nothing are app/reports.tsx (the WIP tab
// and the Profit tab) and utils/portfolio/pipelineHorizon.ts — so those three
// reports understate cost-to-date by exactly the materials, self-perform
// labour, machine time and permit fees the engine now counts, and overstate
// margin by the same. Fixing them is a matter of building the object from the
// context data the screen already holds; nothing in this file can do it,
// because the receipts, time entries, equipment and permits live in React
// context and never reach a pure module on their own.
export function computeWIPReport(
  projects: Project[],
  invoices: Invoice[],
  changeOrders: ChangeOrder[],
  commitments: Commitment[],
  costSources: JobCostActualSources = {},
): WIPReport {
  const rows: WIPRow[] = [];
  for (const project of projects) {
    if (project.status === 'closed') continue;

    const contractValue = effectiveEstimateTotal(project);
    const projectCOs = changeOrders.filter(co => co.projectId === project.id && co.status === 'approved');
    const approvedChangeOrders = projectCOs.reduce((s, co) => s + co.changeAmount, 0);
    const revisedContract = contractValue + approvedChangeOrders;

    const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
    // DRAFTS ARE NOT BILLINGS. This summed every invoice regardless of status,
    // so an unsent draft counted as billed — on a report that goes to a BANK or
    // a SURETY. Overstating billings understates underbilling (or invents
    // overbilling), which is precisely the number a lender reads to judge
    // whether a job is being financed by its own client.
    //
    // A draft is a document the client has never seen. Everything else — sent,
    // partially_paid, paid, overdue — has genuinely been billed.
    const billedInvoices = projectInvoices.filter(inv => inv.status !== 'draft');
    const billedToDate = billedInvoices.reduce((s, inv) => s + (inv.totalDue || 0), 0);
    const paidToDate = billedInvoices.reduce((s, inv) => s + (inv.amountPaid || 0), 0);
    // Retention is only withheld from money actually billed, so it follows the
    // same population — a draft withholds nothing.
    // MONEY-05: the withholding is the percentage of the work value, via the
    // shared helper — not the stored column, which on legacy rows is retainage
    // computed on the tax-inclusive total. A WIP report that held one figure
    // while the A/R aging on the same screen collected against another does not
    // foot for the banker reading both.
    const retainageHeld = billedInvoices.reduce(
      (s, inv) => s + pendingRetentionHeld(inv),
      0,
    );

    const job = computeJobCost({ project, commitments, changeOrders, ...costSources });
    const estimatedFinalCost = job.projectedFinal;

    // MONEY-F13 (audit 2026-09-03): percent complete on a COST basis —
    // job actual ÷ estimate-at-completion — the same basis utils/wip.ts uses
    // (costToDate / totalEstimatedCost). The old basis was billed ÷ revised,
    // which makes earned ≡ billed, so the Unbilled column below was
    // identically zero: no input could make it non-zero, and a banker reading
    // it concluded the contractor was never underbilled. When the job has no
    // cost picture yet, fall back to schedule progress (avg task progress);
    // with neither, 0 — the honest answer, not "as billed".
    let percentComplete: number;
    if (job.projectedFinal > 0 && job.actual > 0) {
      percentComplete = Math.min(100, Math.max(0, (job.actual / job.projectedFinal) * 100));
    } else {
      const tasks = project.schedule?.tasks ?? [];
      percentComplete = tasks.length > 0
        ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
        : 0;
    }

    const earned = (revisedContract * percentComplete) / 100;
    const unbilled = Math.max(0, earned - billedToDate);

    const projectedProfit = revisedContract - estimatedFinalCost;
    const projectedMargin = revisedContract > 0 ? (projectedProfit / revisedContract) * 100 : 0;

    rows.push({
      projectId: project.id,
      projectName: project.name,
      contractValue,
      approvedChangeOrders,
      revisedContract,
      percentComplete,
      billedToDate,
      paidToDate,
      unbilled,
      retainageHeld,
      estimatedFinalCost,
      projectedProfit,
      projectedMargin,
      status: project.status,
    });
  }

  // Sort largest contract first — banks read top-down.
  rows.sort((a, b) => b.revisedContract - a.revisedContract);

  const totals = rows.reduce(
    (t, r) => ({
      contractValue:        t.contractValue + r.contractValue,
      approvedChangeOrders: t.approvedChangeOrders + r.approvedChangeOrders,
      revisedContract:      t.revisedContract + r.revisedContract,
      billedToDate:         t.billedToDate + r.billedToDate,
      paidToDate:           t.paidToDate + r.paidToDate,
      retainageHeld:        t.retainageHeld + r.retainageHeld,
      estimatedFinalCost:   t.estimatedFinalCost + r.estimatedFinalCost,
      projectedProfit:      t.projectedProfit + r.projectedProfit,
      projectedMargin:      0, // computed below
    }),
    {
      contractValue: 0, approvedChangeOrders: 0, revisedContract: 0,
      billedToDate: 0, paidToDate: 0, retainageHeld: 0,
      estimatedFinalCost: 0, projectedProfit: 0, projectedMargin: 0,
    },
  );
  totals.projectedMargin = totals.revisedContract > 0
    ? (totals.projectedProfit / totals.revisedContract) * 100
    : 0;

  return { asOf: new Date().toISOString(), rows, totals };
}

// ─── Profit per project ──────────────────────────────────────────────

export interface ProfitRow {
  projectId: string;
  projectName: string;
  status: Project['status'];
  revenue: number;             // revised contract
  costToDate: number;          // job-cost actual
  estimatedFinalCost: number;  // job-cost EAC
  projectedProfit: number;
  projectedMargin: number;     // %
  health: 'green' | 'yellow' | 'red';
}

/**
 * Revenue minus projected final cost, per project.
 *
 * `costSources` carries the same contract as computeWIPReport above and is
 * spread whole into the engine: pass it and `costToDate` is the engine's full
 * ACTUAL (commitment payments + material receipts + priced crew hours +
 * equipment days + permit fees); omit it and every one of those but the
 * commitment payments is missing, which shows as margin the job has not
 * earned. The health chip is derived from that margin, so an omitted argument
 * paints a bleeding job green.
 */
export function computeProfitReport(
  projects: Project[],
  invoices: Invoice[],
  changeOrders: ChangeOrder[],
  commitments: Commitment[],
  costSources: JobCostActualSources = {},
): { rows: ProfitRow[]; totalRevenue: number; totalProfit: number; weightedMargin: number } {
  const rows: ProfitRow[] = [];
  for (const project of projects) {
    const contractValue = effectiveEstimateTotal(project);
    const approvedCOs = changeOrders
      .filter(co => co.projectId === project.id && co.status === 'approved')
      .reduce((s, co) => s + co.changeAmount, 0);
    const revenue = contractValue + approvedCOs;

    const job = computeJobCost({ project, commitments, changeOrders, ...costSources });
    const estimatedFinalCost = job.projectedFinal;
    const projectedProfit = revenue - estimatedFinalCost;
    const projectedMargin = revenue > 0 ? (projectedProfit / revenue) * 100 : 0;

    let health: 'green' | 'yellow' | 'red';
    if (projectedMargin >= 12)      health = 'green';
    else if (projectedMargin >= 5)  health = 'yellow';
    else                            health = 'red';

    rows.push({
      projectId: project.id,
      projectName: project.name,
      status: project.status,
      revenue,
      costToDate: job.actual,
      estimatedFinalCost,
      projectedProfit,
      projectedMargin,
      health,
    });
  }

  rows.sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit  = rows.reduce((s, r) => s + r.projectedProfit, 0);
  const weightedMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  return { rows, totalRevenue, totalProfit, weightedMargin };
}

// ─── AR aging ────────────────────────────────────────────────────────

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface ARAgingRow {
  invoiceId: string;
  invoiceNumber: number;
  projectId: string;
  projectName: string;
  issueDate: string;
  dueDate: string;
  totalDue: number;
  amountPaid: number;
  /** Retention still held on the invoice — not due, so not aged (MONEY-F5). */
  retainageHeld: number;
  /** Collectible today: totalDue − retainageHeld − amountPaid, never negative. */
  outstanding: number;
  daysPastDue: number;
  bucket: AgingBucket | 'current';
  status: Invoice['status'];
}

export interface ARAgingReport {
  asOf: string;
  rows: ARAgingRow[];
  totals: {
    current: number;
    '0-30': number;
    '31-60': number;
    '61-90': number;
    '90+': number;
    totalOutstanding: number;
    /** Retention still held across the listed invoices — a receivable, not aged. */
    retainageHeld: number;
  };
}

export function computeARAgingReport(
  invoices: Invoice[],
  projects: Project[],
): ARAgingReport {
  const projectName = new Map(projects.map(p => [p.id, p.name]));
  const now = Date.now();
  const DAY = 86_400_000;

  const rows: ARAgingRow[] = [];
  for (const inv of invoices) {
    // DRAFTS ARE NOT RECEIVABLES. A draft is a document the client has never
    // seen: nobody owes it, so it cannot be outstanding and it cannot be past
    // due. This loop had NO status filter at all — and the comment that used to
    // sit here claimed it skipped "canceled", a status `InvoiceStatus` does not
    // even have (draft | sent | partially_paid | paid | overdue). So a $40K
    // invoice staged by Bill-from-Estimate and never sent showed up as
    // OUTSTANDING in danger red, aged into the 31-60 past-due bucket, and rode
    // out on the exported CSV/PDF — while the WIP tab of the same Reports
    // screen (computeWIPReport above, whose `billedInvoices` does exclude
    // drafts) reported nothing billed. Two tabs of one screen contradicting
    // each other, with the collections number overstated by every staged draft.
    //
    // Same population as WIP billings, deliberately: sent / partially_paid /
    // paid / overdue have genuinely been billed; draft has not.
    if (inv.status === 'draft') continue;
    // MONEY-F5: outstanding is NET of the retention the contract lets the
    // client hold (utils/invoiceBilling.invoiceOutstanding). Aging held
    // retention as "past due" told the bank a client was late on money that
    // is not due until closeout. Skip anything already collected (half-dollar
    // floor absorbs rounding on split payments).
    const outstanding = invoiceOutstanding(inv);
    // MONEY-05: same helper invoiceOutstanding nets out, so the aged balance and
    // the Retainage Held column are two halves of one total_due.
    const retainageHeld = pendingRetentionHeld(inv);
    // Nothing collectible AND nothing held → fully collected, no receivable.
    // A settled invoice that still HOLDS retainage stays on the report as a
    // zero-current row: the $10,000 the client keeps until closeout is a
    // receivable the bank needs to see (review of B3a, 2026-09-05) — disclosed
    // under Retainage Held, never aged, never in a bucket.
    if (outstanding <= 0.5 && retainageHeld <= 0.5) continue;

    const dueMs = new Date(inv.dueDate).getTime();
    // Only a collectible balance ages; held retainage is not past due.
    const daysPastDue = outstanding <= 0.5 || isNaN(dueMs) ? 0 : Math.max(0, Math.floor((now - dueMs) / DAY));

    let bucket: AgingBucket | 'current';
    if (daysPastDue === 0)        bucket = 'current';
    else if (daysPastDue <= 30)   bucket = '0-30';
    else if (daysPastDue <= 60)   bucket = '31-60';
    else if (daysPastDue <= 90)   bucket = '61-90';
    else                          bucket = '90+';

    rows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      projectId: inv.projectId,
      projectName: projectName.get(inv.projectId) ?? '—',
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      totalDue: inv.totalDue || 0,
      amountPaid: inv.amountPaid || 0,
      retainageHeld,
      outstanding,
      daysPastDue,
      bucket,
      status: inv.status,
    });
  }

  // Worst-aged first.
  rows.sort((a, b) => b.daysPastDue - a.daysPastDue);

  const totals = {
    current: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0,
    totalOutstanding: 0,
    retainageHeld: 0,
  };
  for (const r of rows) {
    if (r.bucket === 'current') totals.current += r.outstanding;
    else totals[r.bucket] += r.outstanding;
    totals.totalOutstanding += r.outstanding;
    totals.retainageHeld += r.retainageHeld;
  }

  return { asOf: new Date().toISOString(), rows, totals };
}

// ─── CSV helpers ─────────────────────────────────────────────────────

function csvEscape(s: string | number | null | undefined): string {
  const v = s == null ? '' : String(s);
  // Wrap in quotes if it contains a comma, quote, or newline; double up internal quotes.
  if (/[,"\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function wipReportToCSV(report: WIPReport): string {
  const headers = [
    'Project', 'Status',
    'Contract', 'Approved COs', 'Revised Contract',
    '% Complete',
    'Billed to Date', 'Paid to Date', 'Unbilled', 'Retainage Held',
    'Estimated Final Cost', 'Projected Profit', 'Projected Margin %',
  ];
  const rows = report.rows.map(r => [
    r.projectName, r.status,
    r.contractValue.toFixed(2), r.approvedChangeOrders.toFixed(2), r.revisedContract.toFixed(2),
    r.percentComplete.toFixed(1),
    r.billedToDate.toFixed(2), r.paidToDate.toFixed(2), r.unbilled.toFixed(2), r.retainageHeld.toFixed(2),
    r.estimatedFinalCost.toFixed(2), r.projectedProfit.toFixed(2), r.projectedMargin.toFixed(1),
  ]);
  const totals = [
    'TOTAL', '',
    report.totals.contractValue.toFixed(2),
    report.totals.approvedChangeOrders.toFixed(2),
    report.totals.revisedContract.toFixed(2),
    '',
    report.totals.billedToDate.toFixed(2),
    report.totals.paidToDate.toFixed(2),
    '',
    report.totals.retainageHeld.toFixed(2),
    report.totals.estimatedFinalCost.toFixed(2),
    report.totals.projectedProfit.toFixed(2),
    report.totals.projectedMargin.toFixed(1),
  ];
  return [headers, ...rows, totals].map(r => r.map(csvEscape).join(',')).join('\n');
}

export function arAgingReportToCSV(report: ARAgingReport): string {
  // MONEY-F5: Total Due − Paid − Retainage Held = Outstanding, so the CSV foots
  // for the banker who reads it (held retention is disclosed, not aged).
  const headers = [
    'Project', 'Invoice #', 'Issue Date', 'Due Date',
    'Total Due', 'Paid', 'Retainage Held', 'Outstanding', 'Days Past Due', 'Bucket', 'Status',
  ];
  const rows = report.rows.map(r => [
    r.projectName, r.invoiceNumber, r.issueDate, r.dueDate,
    r.totalDue.toFixed(2), r.amountPaid.toFixed(2), r.retainageHeld.toFixed(2), r.outstanding.toFixed(2),
    r.daysPastDue, r.bucket, r.status,
  ]);
  // A TOTAL line that foots the same way, so the held retainage the report
  // discloses is also visible as one number.
  const sumTotalDue = report.rows.reduce((s, r) => s + r.totalDue, 0);
  const sumPaid = report.rows.reduce((s, r) => s + r.amountPaid, 0);
  const totals = [
    'TOTAL', '', '', '',
    sumTotalDue.toFixed(2), sumPaid.toFixed(2), report.totals.retainageHeld.toFixed(2), report.totals.totalOutstanding.toFixed(2),
    '', '', '',
  ];
  return [headers, ...rows, totals].map(r => r.map(csvEscape).join(',')).join('\n');
}
