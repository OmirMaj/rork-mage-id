// utils/wip.ts — pure WIP (Work-In-Progress) schedule engine.
// NO React / React Native imports. Every function is deterministic and
// side-effect-free so scripts/validate-wip.ts can exercise it directly.
import type {
  WipRowInput, WipRow, WipPortfolio, WipSnapshotRow, WipFlags, WipPeriod,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project, MaterialReceipt,
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
  const costToComplete = Math.max(0, totalEstimatedCost - costToDate);
  const backlog = revisedContract - earnedRevenue;

  // Profit-to-date. GAAP (ASC 606 / 605-35) requires the FULL anticipated loss
  // to be recognized as soon as a job is forecast to lose money, not pro-rated
  // by percent complete. So for a loss job (estGrossProfit < 0) we book the
  // greater of the pro-rata result and the total estimated loss — whichever is
  // worse (more negative). Profit jobs keep the spec's simple earned − cost.
  const anticipatedLoss = estGrossProfit < 0;
  const profitToDate = anticipatedLoss
    ? Math.min(earnedRevenue - costToDate, estGrossProfit)
    : earnedRevenue - costToDate;

  return {
    revisedContract, percentComplete, earnedRevenue, overbilling, underbilling,
    estGrossProfit, estGrossMarginPct, profitToDate, costToComplete, backlog,
    anticipatedLoss,
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

/**
 * Auto-suggested cost-to-date. Cost-to-date in a WIP schedule is cost
 * INCURRED, so we sum the two actual-cost sources MAGE tracks:
 *   1. Σ commitment.paidToDate — approved + paid sub-submitted invoices against
 *      subcontracts / POs (server-maintained rollup).
 *   2. Σ material-receipt totals — direct material cost captured via
 *      MaterialReceipt. Receipts are NEVER posted into commitment.paidToDate
 *      (see types/index.ts MaterialReceipt doc), so there is no double count.
 *
 * NOT captured automatically: self-performed / direct labor and any incurred-
 * but-not-yet-invoiced sub work. This is therefore a LOWER BOUND — the screen
 * surfaces it as an editable suggestion the user tops up before locking, so a
 * seeded figure is never presented as the authoritative total incurred cost.
 */
export function suggestCostToDate(
  commitments: Commitment[],
  materialReceipts: MaterialReceipt[] = [],
): number {
  const committed = commitments.reduce((sum, c) => sum + (c.paidToDate ?? 0), 0);
  const materials = materialReceipts.reduce((sum, r) => sum + (r.total ?? 0), 0);
  return committed + materials;
}

/**
 * Estimated cost at completion (the WIP "Total Estimated Cost" input) — the
 * GC's COST budget, which MUST be sourced separately from the contract value
 * (revenue). Precedence:
 *   1. linkedEstimate.baseTotal — cost before markup (the true cost budget;
 *      grandTotal there is the PRICED figure and must not be used as cost).
 *   2. legacy project.estimate.grandTotal — no markup split exists, so this is
 *      the best-available cost estimate.
 *   3. Σ signed commitment amounts (subs + POs, incl. CO revisions).
 *   4. 0 — no cost basis recorded; the engine's zero-est guard yields 0%
 *      complete and the screen prompts manual entry (never silently wrong).
 * targetBudget / gmpCap are deliberately NOT used here — those are contract
 * (revenue) figures reserved for deriveOriginalContract.
 */
export function deriveEstimatedCost(
  project: Pick<Project, 'linkedEstimate' | 'estimate'> | null | undefined,
  commitments: Commitment[],
): number {
  const base = project?.linkedEstimate?.baseTotal;
  if (typeof base === 'number' && base > 0) return base;
  const legacy = project?.estimate?.grandTotal;
  if (typeof legacy === 'number' && legacy > 0) return legacy;
  const committed = commitments.reduce(
    (sum, c) => sum + (c.amount ?? 0) + (c.changeAmount ?? 0), 0);
  if (committed > 0) return committed;
  return 0;
}

/**
 * Auto-suggested billed-to-date from a SINGLE source to avoid double counting:
 * a project bills via pay-apps OR invoices (a pay-app is itself the invoice).
 * Prefer pay-apps when any exist, else fall back to invoices.
 *
 * AIA billings are CUMULATIVE (G703 "Total Completed & Stored to Date"), so we
 * take the LATEST application's gross cumulative figure — NOT a sum of each
 * app's currentPaymentDue. currentPaymentDue is a per-period increment NET of
 * retainage; summing it telescopes to totalEarnedLessRetainage (billings minus
 * retainage held) AND silently depends on every historical app being saved.
 * Both failure modes understate billings and flip an overbilled job to
 * apparent underbilling on a bank/CPA-facing schedule. The invoices fallback
 * sums totalDue (gross), keeping both billing sources on the same gross basis.
 */
export function suggestBilledToDate(
  invoices: Invoice[],
  payApps: SavedAIAPayApp[],
): number {
  if (payApps.length > 0) {
    const latest = payApps.reduce((a, b) =>
      (b.applicationNumber ?? 0) >= (a.applicationNumber ?? 0) ? b : a);
    return latest.totals?.totalCompletedAndStored ?? 0;
  }
  return invoices.reduce((sum, i) => sum + (i.totalDue ?? 0), 0);
}

// Thresholds for the profit-fade watch. Exported so the screen can reference
// the same constants in copy/tooltips.
export const WIP_PROFIT_FADE_THRESHOLD = 0.02;         // 2 margin points
export const WIP_BILLING_SWING_THRESHOLD = 0.05;       // 5% of revised contract
export const WIP_SCHEDULE_DIVERGENCE_THRESHOLD = 0.10; // 10 percentage points

/**
 * Classify a WIP row against the prior locked period and (optionally) EVM
 * schedule-% for early over/under-billing detection.
 */
export function flagWipRow(
  row: WipRow,
  prev?: WipRow,
  evm?: { schedulePercent: number },
): WipFlags {
  const reasons: string[] = [];
  let profitFade = false;
  let billingSwing = false;
  let scheduleDivergence = false;

  if (prev && row.estGrossMarginPct < prev.estGrossMarginPct - WIP_PROFIT_FADE_THRESHOLD) {
    profitFade = true;
    const dropPts = (prev.estGrossMarginPct - row.estGrossMarginPct) * 100;
    reasons.push(`Gross margin faded ${dropPts.toFixed(1)} pts vs prior period`);
  }

  if (prev && row.revisedContract > 0) {
    const netNow = row.overbilling - row.underbilling;
    const netPrev = prev.overbilling - prev.underbilling;
    if (Math.abs(netNow - netPrev) > WIP_BILLING_SWING_THRESHOLD * row.revisedContract) {
      billingSwing = true;
      reasons.push('Large swing in over/under-billing vs prior period');
    }
  }

  if (evm && Math.abs(row.percentComplete - evm.schedulePercent) > WIP_SCHEDULE_DIVERGENCE_THRESHOLD) {
    scheduleDivergence = true;
    const costPct = (row.percentComplete * 100).toFixed(0);
    const schedPct = (evm.schedulePercent * 100).toFixed(0);
    reasons.push(`Cost %-complete (${costPct}%) diverges from schedule (${schedPct}%)`);
  }

  return { profitFade, billingSwing, scheduleDivergence, reasons };
}

/**
 * Immutability guard, mirroring the invoice-immutability precedent. A locked
 * period must not be edited — callers route the user to "create a new period".
 */
export function assertPeriodEditable(
  period: Pick<WipPeriod, 'lockedAt'>,
): { blocked: boolean; reason?: string } {
  if (period.lockedAt) {
    return { blocked: true, reason: 'This period is locked. Create a new period instead.' };
  }
  return { blocked: false };
}
