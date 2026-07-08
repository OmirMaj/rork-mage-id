// utils/wip.ts — pure WIP (Work-In-Progress) schedule engine.
// NO React / React Native imports. Every function is deterministic and
// side-effect-free so scripts/validate-wip.ts can exercise it directly.
import type {
  WipRowInput, WipRow, WipPortfolio, WipSnapshotRow,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project,
} from '@/types';

/** Clamp with NaN → lo, so divide-by-zero never leaks a NaN downstream. */
export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Turn explicit inputs into a fully computed WIP row. */
export function computeWipRow(input: WipRowInput): WipRow {
  const {
    originalContract, approvedChangeOrders, totalEstimatedCost,
    costToDate, billedToDate, percentCompleteOverride,
  } = input;

  const revisedContract = originalContract + approvedChangeOrders;

  const percentComplete = percentCompleteOverride != null
    ? clamp(percentCompleteOverride, 0, 1)
    : (totalEstimatedCost === 0 ? 0 : clamp(costToDate / totalEstimatedCost, 0, 1));

  const earnedRevenue = revisedContract * percentComplete;
  const overbilling = Math.max(0, billedToDate - earnedRevenue);
  const underbilling = Math.max(0, earnedRevenue - billedToDate);
  const estGrossProfit = revisedContract - totalEstimatedCost;
  const estGrossMarginPct = revisedContract === 0 ? 0 : estGrossProfit / revisedContract;
  const profitToDate = earnedRevenue - costToDate;
  const costToComplete = Math.max(0, totalEstimatedCost - costToDate);
  const backlog = revisedContract - earnedRevenue;

  return {
    revisedContract, percentComplete, earnedRevenue, overbilling, underbilling,
    estGrossProfit, estGrossMarginPct, profitToDate, costToComplete, backlog,
  };
}

/** Sum a set of snapshot rows into a portfolio roll-up with weighted margin. */
export function computeWipPortfolio(rows: WipSnapshotRow[]): WipPortfolio {
  const acc: WipPortfolio = {
    revisedContract: 0, totalEstimatedCost: 0, costToDate: 0, earnedRevenue: 0,
    billedToDate: 0, overbilling: 0, underbilling: 0, backlog: 0, weightedMarginPct: 0,
  };
  for (const r of rows) {
    acc.revisedContract += r.output.revisedContract;
    acc.totalEstimatedCost += r.input.totalEstimatedCost;
    acc.costToDate += r.input.costToDate;
    acc.earnedRevenue += r.output.earnedRevenue;
    acc.billedToDate += r.input.billedToDate;
    acc.overbilling += r.output.overbilling;
    acc.underbilling += r.output.underbilling;
    acc.backlog += r.output.backlog;
  }
  acc.weightedMarginPct = acc.revisedContract === 0
    ? 0
    : (acc.revisedContract - acc.totalEstimatedCost) / acc.revisedContract;
  return acc;
}

/** Σ approved change-order value deltas → the revised-contract adjustment. */
export function sumApprovedChangeOrders(changeOrders: ChangeOrder[]): number {
  return changeOrders
    .filter((co) => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount || 0), 0);
}

/**
 * Recover the original (pre-change-order) contract value. `Project` has no
 * direct contract field, so fall back through the best available sources.
 */
export function deriveOriginalContract(
  project: Pick<Project, 'targetBudget' | 'gmpCap'> | null | undefined,
  changeOrders: ChangeOrder[],
  payApps: SavedAIAPayApp[],
): number {
  const fromPayApp = payApps[0]?.originalContractSum;
  if (typeof fromPayApp === 'number' && fromPayApp > 0) return fromPayApp;
  const fromCo = changeOrders[0]?.originalContractValue;
  if (typeof fromCo === 'number' && fromCo > 0) return fromCo;
  const fromBudget = project?.targetBudget?.amount;
  if (typeof fromBudget === 'number' && fromBudget > 0) return fromBudget;
  return project?.gmpCap ?? 0;
}

/** Auto-suggested cost-to-date: Σ incurred commitment cost (paidToDate). */
export function suggestCostToDate(commitments: Commitment[]): number {
  return commitments.reduce((sum, c) => sum + (c.paidToDate ?? 0), 0);
}

/**
 * Auto-suggested billed-to-date from a SINGLE source to avoid double counting:
 * a project bills via pay-apps OR invoices (a pay-app is itself the invoice).
 * Prefer pay-apps when any exist, else fall back to invoices.
 */
export function suggestBilledToDate(
  invoices: Invoice[],
  payApps: SavedAIAPayApp[],
): number {
  if (payApps.length > 0) {
    return payApps.reduce((sum, p) => sum + (p.totals?.currentPaymentDue ?? 0), 0);
  }
  return invoices.reduce((sum, i) => sum + (i.totalDue ?? 0), 0);
}
