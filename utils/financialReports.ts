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
//     61-90, 90+). Uses dueDate vs today, ignores closed/canceled.
//
// All amounts in USD. All return shapes are PURE so the screen can
// memoize them and the PDF builders can serialize them as-is.

import type { Project, Invoice, ChangeOrder, Commitment } from '@/types';
import { computeJobCost } from './jobCostEngine';

// ─── WIP ─────────────────────────────────────────────────────────────

export interface WIPRow {
  projectId: string;
  projectName: string;
  contractValue: number;        // original signed contract (linked estimate grand total or estimate.grandTotal)
  approvedChangeOrders: number; // sum of approved CO change amounts
  revisedContract: number;      // contractValue + approvedChangeOrders
  percentComplete: number;      // 0–100, derived from billed-to-date / revised contract
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

export function computeWIPReport(
  projects: Project[],
  invoices: Invoice[],
  changeOrders: ChangeOrder[],
  commitments: Commitment[],
): WIPReport {
  const rows: WIPRow[] = [];
  for (const project of projects) {
    if (project.status === 'closed') continue;

    const contractValue =
      project.linkedEstimate?.grandTotal
      ?? project.estimate?.grandTotal
      ?? 0;
    const projectCOs = changeOrders.filter(co => co.projectId === project.id && co.status === 'approved');
    const approvedChangeOrders = projectCOs.reduce((s, co) => s + co.changeAmount, 0);
    const revisedContract = contractValue + approvedChangeOrders;

    const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
    const billedToDate = projectInvoices.reduce((s, inv) => s + (inv.totalDue || 0), 0);
    const paidToDate = projectInvoices.reduce((s, inv) => s + (inv.amountPaid || 0), 0);
    const retainageHeld = projectInvoices.reduce(
      (s, inv) => s + Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0)),
      0,
    );

    const job = computeJobCost({ project, commitments, invoices, changeOrders });
    const estimatedFinalCost = job.projectedFinal;

    // Percent complete by billed value vs revised contract — the most
    // common bank/architect convention. If there's no contract at all,
    // fall back to schedule progress (avg task progress) so the row isn't
    // useless for a project that was estimated outside the app.
    let percentComplete: number;
    if (revisedContract > 0) {
      percentComplete = Math.min(100, (billedToDate / revisedContract) * 100);
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

export function computeProfitReport(
  projects: Project[],
  invoices: Invoice[],
  changeOrders: ChangeOrder[],
  commitments: Commitment[],
): { rows: ProfitRow[]; totalRevenue: number; totalProfit: number; weightedMargin: number } {
  const rows: ProfitRow[] = [];
  for (const project of projects) {
    const contractValue =
      project.linkedEstimate?.grandTotal
      ?? project.estimate?.grandTotal
      ?? 0;
    const approvedCOs = changeOrders
      .filter(co => co.projectId === project.id && co.status === 'approved')
      .reduce((s, co) => s + co.changeAmount, 0);
    const revenue = contractValue + approvedCOs;

    const job = computeJobCost({ project, commitments, invoices, changeOrders });
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
    // Outstanding = totalDue - amountPaid. Skip if fully paid or canceled.
    const outstanding = (inv.totalDue || 0) - (inv.amountPaid || 0);
    if (outstanding <= 0.5) continue;

    const dueMs = new Date(inv.dueDate).getTime();
    const daysPastDue = isNaN(dueMs) ? 0 : Math.max(0, Math.floor((now - dueMs) / DAY));

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
  };
  for (const r of rows) {
    if (r.bucket === 'current') totals.current += r.outstanding;
    else totals[r.bucket] += r.outstanding;
    totals.totalOutstanding += r.outstanding;
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
  const headers = [
    'Project', 'Invoice #', 'Issue Date', 'Due Date',
    'Total Due', 'Paid', 'Outstanding', 'Days Past Due', 'Bucket', 'Status',
  ];
  const rows = report.rows.map(r => [
    r.projectName, r.invoiceNumber, r.issueDate, r.dueDate,
    r.totalDue.toFixed(2), r.amountPaid.toFixed(2), r.outstanding.toFixed(2),
    r.daysPastDue, r.bucket, r.status,
  ]);
  return [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
}
