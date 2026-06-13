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
import { computeJobCost } from '@/utils/jobCostEngine';

export type MarginHealth = 'healthy' | 'watch' | 'critical';

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
  /** Health classification for the headline chip. */
  health: MarginHealth;
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
    const estimatedCost = links.reduce((s, id) => {
      const item = estimate.items.find(it => it.materialId === id);
      return s + (item?.lineTotal ?? 0);
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
}

export function computeLivingEstimate({
  project,
  changeOrders,
  commitments,
  invoices,
}: LivingEstimateInput): LivingEstimateSnapshot {
  const estimate = project.linkedEstimate;
  const projectCOs = changeOrders.filter(co => co.projectId === project.id);
  const approvedCORevenue = projectCOs
    .filter(co => co.status === 'approved')
    .reduce((s, co) => s + (co.changeAmount ?? 0), 0);
  const pendingCORevenue = getPendingChangeOrderValue(projectCOs);

  // ── Original baseline ────────────────────────────────────────────────
  // We need a real cost/markup split. linkedEstimate carries baseTotal (cost)
  // and grandTotal (sell). A legacy `project.estimate` only has grandTotal —
  // no margin can be derived, so we flag hasMarginBasis = false.
  const grandTotal = estimate?.grandTotal ?? 0;
  const baseTotal = estimate?.baseTotal ?? 0;
  const hasMarginBasis = !!estimate && grandTotal > 0 && baseTotal > 0 && baseTotal < grandTotal;

  const originalRevenue = grandTotal;
  const originalCost = baseTotal;
  const originalMargin = originalRevenue - originalCost;
  const marginPct0 = originalRevenue > 0 ? originalMargin / originalRevenue : 0;

  // ── Projected at completion ──────────────────────────────────────────
  const projectedRevenue = getContractValue(project, projectCOs);

  // Cost EAC from the shared job-cost engine, adjusted so COs are costed at
  // the bid margin rather than at full sell value (see file header).
  const jobCost = computeJobCost({ project, commitments, invoices, changeOrders: projectCOs });
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
