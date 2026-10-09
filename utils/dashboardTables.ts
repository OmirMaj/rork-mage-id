// utils/dashboardTables.ts — the money cells the desktop dashboard tables
// print (wave 6d, lane B1; the WIP / Reports cells, d6r lane B2).
//
// Pure. Every cell is an ENGINE field or helper the phone card already prints;
// nothing is re-derived here (contract D8). An unknown value is `null`, which
// the table renders as '—', never $0. Footers are the engine's own totals, not
// a sum of the visible rows (scripts/validate-dashboard-tables.ts proves it).
//
// Scope: lane B1's job-costing tables (jobCostPhaseCells / jobCostFooter /
// pctSpentText), and — built in the d6r restore by lane B2, which wave 6d cut
// — the desktop tables of the two bank-facing reports: the WIP schedule's
// projects table on /wip-report (wipScheduleCells / wipCostSourceTag /
// wipScheduleFooter, off utils/wip's snapshot rows and computeWipPortfolio),
// and the WIP, Profit and A/R Aging tables on /reports (reportsWipCells /
// reportsWipFooter, profitCells / profitFooter, agingCells / agingFooter, off
// utils/financialReports). marginCellText is the only way /reports prints a
// margin cell.

import type { JobCostLine, JobCostSummary } from './jobCostEngine';
import type { WipPortfolio, WipSnapshotRow } from '@/types';
import { wipRowCostAtCompletion, type WipRowSources } from './wip';
import {
  profitRowHasCostBasis, wipReportRowHasCostBasis, wipRowEarned, wipRowOverbilled,
  type ARAgingReport, type ARAgingRow, type ProfitRow, type WIPReport, type WIPRow,
} from './financialReports';

export interface JobCostPhaseCells {
  budget: number;
  committed: number;
  actual: number;
  /** The engine's projected final (EAC) for the phase. */
  eac: number;
  /** projectedFinal − budget: positive = over (describeVariance owns words). */
  variance: number;
  /** actual / budget; null when the phase carries no budget (unbudgeted). */
  pctSpent: number | null;
}

export function jobCostPhaseCells(l: JobCostLine): JobCostPhaseCells {
  return {
    budget: l.budget,
    committed: l.committed,
    actual: l.actual,
    eac: l.projectedFinal,
    variance: l.variance,
    pctSpent: l.budget > 0 ? l.actual / l.budget : null,
  };
}

export interface JobCostFooterCells {
  budget: number;
  committed: number;
  actual: number;
  eac: number;
  variance: number;
  /** Σ phase overage the job headline absorbs into uncommitted budget. */
  absorbed: number;
}

/** The job's own totals — the KPI cards' figures, not Σ of the rows. */
export function jobCostFooter(s: JobCostSummary): JobCostFooterCells {
  return {
    budget: s.budget,
    committed: s.committed,
    actual: s.actual,
    eac: s.projectedFinal,
    variance: s.variance,
    absorbed: s.absorbedVariance,
  };
}

/** '% spent' cell text: a ratio → whole percent; unknown → '—'. */
export function pctSpentText(pct: number | null): string {
  return pct === null || !Number.isFinite(pct) ? '—' : `${Math.round(pct * 100)}%`;
}

// ─── /wip-report — the projects table (d6r B2) ───────────────────────────

/** The one signed billing position of a row: the phone cell's own ternary
 *  (over first, then under, else nothing measured). */
export type WipBillingCell =
  | { kind: 'over'; amount: number }
  | { kind: 'under'; amount: number }
  | { kind: 'none' };

export interface WipScheduleCells {
  /** Revised contract (original + approved change orders). */
  contract: number;
  /** The cost at completion the row was struck against (wipRowCostAtCompletion). */
  estCost: number;
  costToDate: number;
  /** 0..1, cost-to-cost. */
  pctComplete: number;
  earned: number;
  billed: number;
  billing: WipBillingCell;
}

/** One WIP snapshot row's cells — the same engine fields the phone row and the
 *  CSV print. */
export function wipScheduleCells(r: WipSnapshotRow): WipScheduleCells {
  const o = r.output;
  return {
    contract: o.revisedContract,
    estCost: wipRowCostAtCompletion(r),
    costToDate: r.input.costToDate,
    pctComplete: o.percentComplete,
    earned: o.earnedRevenue,
    billed: r.input.billedToDate,
    billing: o.overbilling > 0
      ? { kind: 'over', amount: o.overbilling }
      : o.underbilling > 0
        ? { kind: 'under', amount: o.underbilling }
        : { kind: 'none' },
  };
}

/** Whole dollars, exactly as app/wip-report.tsx's own money() prints them. */
export function wholeDollars(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * The short provenance tag under a cost-to-date cell. It mirrors, branch for
 * branch and in the same order, the sentence the phone row prints after
 * "Cost-to-date $X" (app/wip-report.tsx): a typed figure first (synced or
 * not), then the automatic chain when it holds a figure, then a zero that sits
 * beside signed commitments, then nothing at all. `committedFloor` is the
 * row's signed-commitment floor on a LIVE row; pass null on a frozen one (the
 * phone has no floor to read there either). `fmt` is the screen's money().
 */
export function wipCostSourceTag(
  sources: Pick<WipRowSources, 'costToDate'> | undefined,
  costToDate: number,
  committedFloor: number | null | undefined,
  fmt: (n: number) => string = wholeDollars,
): string {
  const src = sources?.costToDate;
  if (src === 'entered_and_synced') return 'entered · synced';
  if (src === 'entered_on_this_device') return 'entered · not synced yet';
  if (costToDate > 0) return src === 'recorded_actual_cost' ? 'every recorded cost' : 'subs + materials only';
  if (committedFloor != null && committedFloor > 0) return `nothing paid · ${fmt(committedFloor)} signed`;
  return 'nothing recorded';
}

export interface WipScheduleFooterCells {
  contract: number;
  estCost: number;
  costToDate: number;
  earned: number;
  billed: number;
  over: number;
  under: number;
}

/** The schedule's totals row — computeWipPortfolio's own figures (the
 *  Portfolio card's), never a sum of the visible rows. */
export function wipScheduleFooter(p: WipPortfolio): WipScheduleFooterCells {
  return {
    contract: p.revisedContract,
    estCost: p.totalEstimatedCost,
    costToDate: p.costToDate,
    earned: p.earnedRevenue,
    billed: p.billedToDate,
    over: p.overbilling,
    under: p.underbilling,
  };
}

// ─── /reports — WIP, Profit and A/R Aging tables (d6r B2) ─────────────────

/** A /reports WIP row's billing position: the phone KV's own ternary
 *  (Overbilled / Underbilled / "On earned value"). */
export type ReportsBillingCell =
  | { kind: 'over'; amount: number }
  | { kind: 'under'; amount: number }
  | { kind: 'even' };

export interface ReportsWipCells {
  contract: number;
  estFinal: number;
  /** null = the row cannot say what it has cost (unknown, never $0). */
  costToDate: number | null;
  /** 0..100. */
  pctComplete: number;
  earned: number;
  billed: number;
  billing: ReportsBillingCell;
  retainage: number;
  /** null without a cost basis (no estimate, no commitment, nothing spent). */
  profit: number | null;
  /** Percent; null without a cost basis. */
  margin: number | null;
}

export function reportsWipCells(r: WIPRow): ReportsWipCells {
  const hasBasis = wipReportRowHasCostBasis(r);
  const over = wipRowOverbilled(r);
  return {
    contract: r.revisedContract,
    estFinal: r.estimatedFinalCost,
    costToDate: r.costToDate == null ? null : r.costToDate,
    pctComplete: r.percentComplete,
    earned: wipRowEarned(r),
    billed: r.billedToDate,
    billing: over > 0
      ? { kind: 'over', amount: over }
      : r.unbilled > 0
        ? { kind: 'under', amount: r.unbilled }
        : { kind: 'even' },
    retainage: r.retainageHeld,
    profit: hasBasis ? r.projectedProfit : null,
    margin: hasBasis ? r.projectedMargin : null,
  };
}

export interface ReportsWipFooterCells {
  revisedContract: number;
  costToDate: number;
  estimatedFinalCost: number;
  earnedRevenue: number;
  billedToDate: number;
  overbilled: number;
  unbilled: number;
  retainageHeld: number;
  /** Profit over the MEASURABLE jobs — the CSV TOTAL's Projected Profit. */
  measurableProjectedProfit: number;
  projectedMargin: number;
  /** false when no job on the report has a cost basis: the profit and margin
   *  totals are then unmeasured (the table prints '—'), not zero. */
  measurable: boolean;
}

/** Exactly the CSV TOTAL row's fields (utils/financialReports wipReportToCSV). */
export function reportsWipFooter(t: WIPReport['totals']): ReportsWipFooterCells {
  return {
    revisedContract: t.revisedContract,
    costToDate: t.costToDate,
    estimatedFinalCost: t.estimatedFinalCost,
    earnedRevenue: t.earnedRevenue,
    billedToDate: t.billedToDate,
    overbilled: t.overbilled,
    unbilled: t.unbilled,
    retainageHeld: t.retainageHeld,
    measurableProjectedProfit: t.measurableProjectedProfit,
    projectedMargin: t.projectedMargin,
    measurable: t.revisedContract - t.noCostBasisContract > 0,
  };
}

export interface ProfitCells {
  revenue: number;
  costToDate: number;
  estFinal: number;
  profit: number | null;
  margin: number | null;
  health: ProfitRow['health'];
}

export function profitCells(r: ProfitRow): ProfitCells {
  const hasBasis = profitRowHasCostBasis(r);
  return {
    revenue: r.revenue,
    costToDate: r.costToDate,
    estFinal: r.estimatedFinalCost,
    profit: hasBasis ? r.projectedProfit : null,
    margin: hasBasis ? r.projectedMargin : null,
    health: r.health,
  };
}

/** The Profit report's two totals — the headline figures the phone card
 *  prints (totalProfit and weightedMargin, both struck on the measurable
 *  jobs). Revenue has no total on purpose (validate-wip-parity). */
export function profitFooter(p: { totalProfit: number; weightedMargin: number; measurableRevenue: number }): {
  projectedProfit: number | null;
  margin: number | null;
} {
  const measured = p.measurableRevenue > 0;
  return { projectedProfit: measured ? p.totalProfit : null, margin: measured ? p.weightedMargin : null };
}

export type AgingTone = 'muted' | 'warn' | 'bad';

export interface AgingCells {
  invoiceNumber: number;
  job: string;
  issued: string;
  due: string;
  total: number;
  paid: number;
  retainage: number;
  outstanding: number;
  /** null on a retainage-only row: held retention is never aged. */
  daysPastDue: number | null;
  /** Nothing collectible: the row is only the retention held to closeout. */
  retainageOnly: boolean;
  /** Collectible money that is actually late (danger ink). */
  late: boolean;
  /** The phone pill's own words: 'Retainage Only' / 'Current' / 'Nd past due'. */
  bucketWord: string;
  bucketTone: AgingTone;
}

/** The same $0.50 floor computeARAgingReport and the phone card use. */
const COLLECTIBLE_FLOOR = 0.5;

export function agingCells(r: ARAgingRow): AgingCells {
  const retainageOnly = r.outstanding <= COLLECTIBLE_FLOOR;
  return {
    invoiceNumber: r.invoiceNumber,
    job: r.projectName,
    issued: r.issueDate,
    due: r.dueDate,
    total: r.totalDue,
    paid: r.amountPaid,
    retainage: r.retainageHeld,
    outstanding: r.outstanding,
    daysPastDue: retainageOnly ? null : r.daysPastDue,
    retainageOnly,
    late: !retainageOnly && r.bucket !== 'current',
    bucketWord: retainageOnly ? 'Retainage Only' : r.bucket === 'current' ? 'Current' : `${r.daysPastDue}d past due`,
    bucketTone: retainageOnly || r.bucket === 'current' ? 'muted'
      : r.bucket === '0-30' || r.bucket === '31-60' ? 'warn' : 'bad',
  };
}

/** The aging report's totals row: outstanding and retainage held. */
export function agingFooter(t: ARAgingReport['totals']): { outstanding: number; retainage: number } {
  return { outstanding: t.totalOutstanding, retainage: t.retainageHeld };
}

/** A margin cell: one decimal and a percent sign. The ONLY way /reports prints
 *  a margin cell (the phone pill keeps its noun: `… % margin`). */
export function marginCellText(pct: number): string {
  return `${pct.toFixed(1)}%`;
}
