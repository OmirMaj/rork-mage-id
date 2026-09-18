// livingEstimate.ts — the estimate's margin is not frozen at bid time.
//
// A GC bids a job at, say, 22% margin. Then reality happens: change orders get
// approved, subs buy out above or below the estimate, and actual costs post.
// Each of those moves the margin the GC will actually walk away with — but the
// number on the estimate never changes. By the time anyone notices the job is
// underwater, it's too late to do anything about it.
//
// The "Living Estimate" recomputes projected margin AT COMPLETION every time
// any of those inputs change, and decomposes the move so the PM can see WHY
// margin drifted — not just that it did.
//
// ── How the numbers tie together ───────────────────────────────────────────
//
// REVENUE side (from utils/projectFinancials):
//   projectedRevenue = base estimate grandTotal + approved change-order revenue
//
// COST side (from utils/jobCostEngine — the SAME EAC the Job Costing screen
// shows, so the two screens never contradict each other):
//   jobCost.projectedFinal is the cost EAC. The job-cost engine books an
//   approved CO into the cost budget at its full SELL value (changeAmount).
//   For a margin view that's wrong — a CO carries the GC's markup just like
//   base scope — so we credit back the profit portion of CO revenue at the
//   job's bid margin. That's the only adjustment between the two screens, and
//   it's documented on `projectedCost` below.
//
// MARGIN:
//   originalMargin$  = grandTotal − baseTotal   (= the estimate's markupTotal)
//   projectedMargin$ = projectedRevenue − projectedCost
//   erosion          = originalMarginPct − projectedMarginPct   (in points)
//
// The driver breakdown reconciles EXACTLY to (projectedMargin$ − originalMargin$)
// by construction — see `buildDrivers`. The last driver ("cost growth")
// absorbs every cost movement not explained by COs or traced buyout, which is
// the correct home for untraced commitment overruns and posted actuals.
//
// Pure function, no storage side effects — callers wire it from ProjectContext
// and recompute on every mutation (inputs are already in memory, so it's cheap).

import type { Project, ChangeOrder, Commitment, Invoice } from '@/types';
import { getContractValue, getPendingChangeOrderValue } from '@/utils/projectFinancials';
import { computeJobCost, type JobCostActualSources } from '@/utils/jobCostEngine';

export type MarginHealth = 'healthy' | 'watch' | 'critical';

/**
 * Which cost streams the projected cost was built from.
 *
 *   'all_sources' — the caller forwarded `costSources` (material receipts,
 *     priced crew hours, equipment, permits, the sub roster): the SAME inputs
 *     app/job-costing.tsx hands computeJobCost, so this EAC is Job Costing's.
 *   'subs_only'   — it did not. Only commitments reached the engine, so every
 *     dollar of self-perform labor and every material receipt is missing, and
 *     with no direct actuals each phase's EAC collapses back to its budget.
 *
 * WHY THIS IS ON THE SNAPSHOT (audit round 2, #16). Every margin surface used
 * to be the second kind without saying so. A remodeler whose crew ran 420 hours
 * against a $15,000 labor line and whose receipts ran $6,000 over materials saw
 * Job Costing report the overrun while the Margin Board, the project hero,
 * Margin Risk, the push alert and the AI's margin fact all read the bid margin
 * back to him as 'healthy'. A caller that cannot reach the cost hooks must now
 * SAY its number is subcontracts-only instead of stating health as fact.
 */
export type MarginCostBasis = 'all_sources' | 'subs_only';

/** Plain-English caveat for a subs-only snapshot, shared by every surface that
 *  prints one (AI fact lines, alert copy) so the wording cannot drift. */
export const hasFullCostBasis = (s: { costBasis?: MarginCostBasis }): boolean =>
  s.costBasis === 'all_sources';

export const SUBS_ONLY_COST_CAVEAT =
  'counts subcontracts and purchase orders only — crew labor, material receipts, equipment and permits are not in this figure';

export interface MarginPoint {
  /** Total contract / sell value. */
  revenue: number;
  /** Total cost (EAC on the projected side, baseTotal on the original side). */
  cost: number;
  /** revenue − cost. */
  margin: number;
  /** margin / revenue, 0–1. 0 when revenue is 0. */
  marginPct: number;
}

export interface MarginDriver {
  key: 'change_orders' | 'buyout' | 'cost_growth';
  label: string;
  /** Dollar impact on margin. Positive = margin up, negative = margin down. */
  marginImpact: number;
  /** One-line plain-English explanation for the UI. */
  detail: string;
}

export interface LivingEstimateSnapshot {
  /** True only when the estimate carries a real cost/markup split we can
   *  build a margin from. Legacy single-total estimates return false and the
   *  UI should show the "add markup to enable live margin" empty state. */
  hasMarginBasis: boolean;
  /** True when the job was BID at or below cost — original.margin <= 0. There
   *  is no profit in the contract to erode, so erosion language is the wrong
   *  story to tell about it; the story is "this bid has no profit in it".
   *  Always false when hasMarginBasis is false (nothing is known). */
  bidAtCost: boolean;
  /** Margin as bid — the frozen baseline. */
  original: MarginPoint;
  /** Margin projected at completion — the living number. */
  projected: MarginPoint;
  /** projected.marginPct − original.marginPct, in PERCENTAGE POINTS (e.g. -3.5
   *  means margin eroded three and a half points). Negative = erosion. */
  marginErosionPoints: number;
  /** projected.margin − original.margin, in dollars. Negative = lost profit. */
  marginErosionDollars: number;
  /** Ordered largest-impact-first. Reconciles to marginErosionDollars. */
  drivers: MarginDriver[];
  /** Approved CO revenue, surfaced for the header. */
  approvedChangeOrders: number;
  /** Pending CO revenue — potential upside, NOT booked into projected. */
  pendingChangeOrders: number;
  /** Commitments that were bought out (signed) but carry no estimate-item
   *  links, so their over/under-estimate variance can't be traced into the
   *  buyout driver. Surfaced so the user knows the buyout number is partial. */
  untracedCommitments: number;
  /** Health classification for the headline chip. Read it together with
   *  `costBasis`: on 'subs_only' a 'healthy' only means the subcontracts are. */
  health: MarginHealth;
  /** See MarginCostBasis. The engine always sets it; it is optional only so
   *  hand-built snapshots (validator fixtures) compile, and a reader must treat
   *  ABSENT exactly like 'subs_only' — unknown provenance is not a full basis. */
  costBasis?: MarginCostBasis;
  asOf: string;
}

/** Cost basis of one commitment: signed amount plus approved CO revisions. */
function commitmentCost(c: Commitment): number {
  return (c.amount ?? 0) + (c.changeAmount ?? 0);
}

/**
 * Buyout variance against the estimate, for commitments we can trace.
 *
 * For every commitment that names the estimate line items it fulfils, compare
 * what we signed the sub for against what we'd budgeted (cost) for that exact
 * scope. Positive = subs came in OVER the estimate (margin down); negative =
 * UNDER (margin up). Untraced commitments are counted separately so the UI can
 * disclose that the buyout figure is partial.
 */
function buyoutVariance(
  project: Project,
  commitments: Commitment[],
): { variance: number; traced: number; untraced: number } {
  const estimate = project.linkedEstimate;
  if (!estimate) return { variance: 0, traced: 0, untraced: commitments.length };

  let variance = 0;
  let traced = 0;
  let untraced = 0;
  for (const c of commitments) {
    const links = c.linkedEstimateItems ?? [];
    if (links.length === 0) {
      untraced += 1;
      continue;
    }
    // MONEY-F11: COST basis — unitPrice × quantity — not `lineTotal`, which is
    // the marked-up SELL figure. Commitments are at cost, so comparing them to
    // sell made a sub signed EXACTLY at the estimate read as a "favorable
    // buyout" by the markup, with an equal and opposite fake "cost growth"
    // driver. Same basis as utils/estimateActuals and the job-cost budget.
    const estimatedCost = links.reduce((s, id) => {
      const item = estimate.items.find(it => it.materialId === id);
      return s + (item ? (item.unitPrice ?? 0) * (item.quantity ?? 0) : 0);
    }, 0);
    if (estimatedCost <= 0) {
      untraced += 1;
      continue;
    }
    variance += commitmentCost(c) - estimatedCost;
    traced += 1;
  }
  return { variance, traced, untraced };
}

/**
 * Decompose the move from original margin → projected margin into named
 * drivers. The three impacts sum EXACTLY to (projectedMargin − originalMargin):
 *
 *   change_orders : +coRev × m0        (COs carry the bid margin)
 *   buyout        : −tracedBuyoutVar   (signed over/under estimate, traceable)
 *   cost_growth   : the remainder      (untraced commitments + posted actuals
 *                                       running over budget — everything else)
 */
function buildDrivers(args: {
  originalCost: number;
  projectedCost: number;
  coRevenue: number;
  marginPct0: number;
  tracedBuyoutVar: number;
  untraced: number;
}): MarginDriver[] {
  const { originalCost, projectedCost, coRevenue, marginPct0, tracedBuyoutVar, untraced } = args;

  const coImpact = coRevenue * marginPct0; // profit COs add at the bid margin
  const buyoutImpact = -tracedBuyoutVar; // over estimate = cost up = margin down
  // Total cost change not explained by CO cost or traced buyout.
  const coCost = coRevenue * (1 - marginPct0);
  const costGrowth = (projectedCost - originalCost) - coCost - tracedBuyoutVar;
  const costGrowthImpact = -costGrowth;

  const drivers: MarginDriver[] = [];

  if (Math.abs(coImpact) >= 1) {
    drivers.push({
      key: 'change_orders',
      label: 'Approved change orders',
      marginImpact: coImpact,
      detail:
        coRevenue > 0
          ? `${formatPct(marginPct0)} margin on ${money(coRevenue)} of approved COs`
          : `Net ${money(coRevenue)} in approved COs`,
    });
  }
  if (Math.abs(buyoutImpact) >= 1) {
    drivers.push({
      key: 'buyout',
      label: buyoutImpact >= 0 ? 'Favorable buyout' : 'Buyout over estimate',
      marginImpact: buyoutImpact,
      detail:
        buyoutImpact >= 0
          ? `Subs signed ${money(Math.abs(tracedBuyoutVar))} under estimate`
          : `Subs signed ${money(Math.abs(tracedBuyoutVar))} over estimate` +
            (untraced > 0 ? ` · ${untraced} untraced commitment${untraced === 1 ? '' : 's'}` : ''),
    });
  }
  if (Math.abs(costGrowthImpact) >= 1) {
    drivers.push({
      key: 'cost_growth',
      label: costGrowthImpact >= 0 ? 'Cost coming in under' : 'Cost growth',
      marginImpact: costGrowthImpact,
      detail:
        costGrowthImpact >= 0
          ? `Committed + actual costs tracking ${money(Math.abs(costGrowth))} under budget`
          : `Committed + actual costs ${money(Math.abs(costGrowth))} over budget` +
            (untraced > 0 ? ` (incl. ${untraced} untraced)` : ''),
    });
  }

  return drivers.sort((a, b) => Math.abs(b.marginImpact) - Math.abs(a.marginImpact));
}

function classifyHealth(originalPct: number, projectedPct: number): MarginHealth {
  const erosionPoints = (originalPct - projectedPct) * 100;
  if (projectedPct <= 0) return 'critical';
  if (erosionPoints >= 5) return 'critical';
  if (erosionPoints >= 2) return 'watch';
  return 'healthy';
}

export interface LivingEstimateInput {
  project: Project;
  changeOrders: ChangeOrder[];
  commitments: Commitment[];
  invoices: Invoice[];
  /**
   * The direct-cost streams Job Costing prices: receipts (incl. QBO bills
   * confirmed into receipts), time entries + loaded rates + OT multiplier,
   * equipment, permits, the sub roster. Forwarded WHOLE into computeJobCost so
   * this EAC is the Job Costing EAC. Optional so a caller that cannot reach
   * those hooks still compiles — its snapshot then reads costBasis 'subs_only'
   * and must be labelled as such (validate-margin-cost-sources pins both).
   */
  costSources?: JobCostActualSources;
}

export function computeLivingEstimate({
  project,
  changeOrders,
  commitments,
  invoices,
  costSources,
}: LivingEstimateInput): LivingEstimateSnapshot {
  const estimate = project.linkedEstimate;
  const projectCOs = changeOrders.filter(co => co.projectId === project.id);
  const approvedCORevenue = projectCOs
    .filter(co => co.status === 'approved')
    .reduce((s, co) => s + (co.changeAmount ?? 0), 0);
  const pendingCORevenue = getPendingChangeOrderValue(projectCOs);

  // ── Original baseline ────────────────────────────────────────────────
  // We need a real COST BASIS. linkedEstimate carries baseTotal (cost) and
  // grandTotal (sell). A legacy `project.estimate` only has grandTotal — no
  // margin can be derived from one number, so hasMarginBasis stays false.
  //
  // `baseTotal < grandTotal` USED TO BE PART OF THIS TEST, and that clause is
  // why the most expensive defect in the product had no alarm on it. Every
  // estimate the Quick Estimate wizard produced was written at exactly cost
  // (baseTotal === grandTotal, measured 0.0% margin), which made this
  // expression false, which made computeCurrentBaselines in utils/marginAlerts
  // `continue` past the job, which meant the margin-monitoring subsystem was
  // STRUCTURALLY BLIND to precisely the jobs that had no margin. The worse the
  // bid, the quieter the alarm. utils/marginRiskScore, app/portfolio-margin
  // and the OneMind margin fact block all skip on the same flag.
  //
  // A zero-margin bid is not a missing margin basis. It is a margin basis
  // whose value is zero, and it is the single most alarming thing this engine
  // can be handed. A NEGATIVE one (priced below cost, baseTotal > grandTotal)
  // is worse still and must not be filtered out either. The real question this
  // flag has to answer is "do I know this job's cost?" — so that is what it
  // now asks. `classifyHealth` sends both cases straight to 'critical' via its
  // `projectedPct <= 0` rule.
  const grandTotal = estimate?.grandTotal ?? 0;
  const baseTotal = estimate?.baseTotal ?? 0;
  const hasMarginBasis = !!estimate && grandTotal > 0 && baseTotal > 0;
  /** Bid at (or below) cost: there is no profit in the contract to protect.
   *  Surfaced separately because "you bid this at cost" and "you have eroded
   *  four points since bid" are different sentences for the UI to say. */
  const bidAtCost = hasMarginBasis && baseTotal >= grandTotal - 0.005;

  const originalRevenue = grandTotal;
  const originalCost = baseTotal;
  const originalMargin = originalRevenue - originalCost;
  const marginPct0 = originalRevenue > 0 ? originalMargin / originalRevenue : 0;

  // ── Projected at completion ──────────────────────────────────────────
  const projectedRevenue = getContractValue(project, projectCOs);

  // Cost EAC from the shared job-cost engine, adjusted so COs are costed at
  // the bid margin rather than at full sell value (see file header).
  // `...costSources` is spread whole (the utils/financialReports.ts pattern),
  // so a field added to JobCostActualSources reaches this EAC the same day.
  const jobCost = computeJobCost({ project, commitments, invoices, changeOrders: projectCOs, ...costSources });
  const projectedCost = Math.max(0, jobCost.projectedFinal - approvedCORevenue * marginPct0);

  const projectedMargin = projectedRevenue - projectedCost;
  const projectedMarginPct = projectedRevenue > 0 ? projectedMargin / projectedRevenue : 0;

  const projectCommitments = commitments.filter(
    c => c.projectId === project.id && c.status !== 'draft',
  );
  const { variance: tracedBuyoutVar, untraced } = buyoutVariance(project, projectCommitments);

  const drivers = hasMarginBasis
    ? buildDrivers({
        originalCost,
        projectedCost,
        coRevenue: approvedCORevenue,
        marginPct0,
        tracedBuyoutVar,
        untraced,
      })
    : [];

  return {
    hasMarginBasis,
    bidAtCost,
    original: {
      revenue: originalRevenue,
      cost: originalCost,
      margin: originalMargin,
      marginPct: marginPct0,
    },
    projected: {
      revenue: projectedRevenue,
      cost: projectedCost,
      margin: projectedMargin,
      marginPct: projectedMarginPct,
    },
    marginErosionPoints: (projectedMarginPct - marginPct0) * 100,
    marginErosionDollars: projectedMargin - originalMargin,
    drivers,
    approvedChangeOrders: approvedCORevenue,
    pendingChangeOrders: pendingCORevenue,
    untracedCommitments: untraced,
    health: hasMarginBasis ? classifyHealth(marginPct0, projectedMarginPct) : 'healthy',
    costBasis: costSources ? 'all_sources' : 'subs_only',
    asOf: new Date().toISOString(),
  };
}

// ── Small formatters used in driver copy ──────────────────────────────────

function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
