// marginRiskScore.ts — how likely is this job to still bleed margin?
//
// The Living Estimate (utils/livingEstimate) tells you what has ALREADY moved
// your margin. This is the forward-looking companion: a weighted scorecard over
// the signals that predict whether margin is about to erode further —
// thin bid margin, an erosion trend already in motion, unbought-out price
// exposure, open allowances the homeowner can blow, a cost-overrun trend,
// unsigned change-order scope, and overcommitted subs.
//
// Output is a 0–100 risk score (higher = riskier) plus the ranked factors
// driving it, each with a one-line recommendation the PM can act on. Every
// factor is computed from data already in memory (estimate + COs + commitments
// + invoices via the Living Estimate and Job Cost engines) — no AI, no network.
//
// Scoring shape: each factor yields a raw risk in [0,1] and a fixed weight.
//   score = round( Σ(risk·weight) / Σ(weight) · 100 )
// Inactive factors (risk 0) stay in the denominator so a clean job scores low.

import type { Project, ChangeOrder, Commitment, Invoice } from '@/types';
import { computeLivingEstimate } from '@/utils/livingEstimate';
import { computeJobCost } from '@/utils/jobCostEngine';
import { getContractValue } from '@/utils/projectFinancials';

export type RiskBand = 'low' | 'moderate' | 'elevated' | 'high';

export interface RiskFactor {
  key: string;
  label: string;
  /** Raw risk 0–1. */
  risk: number;
  /** Fixed weight in the blend. */
  weight: number;
  /** Share of total weighted risk this factor accounts for (0–1). */
  contribution: number;
  detail: string;
  recommendation: string;
}

export interface MarginRiskScore {
  /** 0–100, higher = riskier. */
  score: number;
  band: RiskBand;
  /** All factors, sorted by contribution desc. */
  factors: RiskFactor[];
  /** Factors carrying meaningful risk (>= 0.15), for the headline. */
  topFactors: RiskFactor[];
  /** False when the estimate has no margin basis to score against. */
  hasBasis: boolean;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function bandFor(score: number): RiskBand {
  if (score < 18) return 'low';
  if (score < 38) return 'moderate';
  if (score < 62) return 'elevated';
  return 'high';
}

function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `$${(abs / 1000).toFixed(1)}K`;
  return `$${Math.round(abs).toLocaleString('en-US')}`;
}
const pct = (r: number): string => `${(r * 100).toFixed(0)}%`;
const pct1 = (r: number): string => `${(r * 100).toFixed(1)}%`;

export interface MarginRiskInput {
  project: Project;
  changeOrders: ChangeOrder[];
  commitments: Commitment[];
  invoices: Invoice[];
}

export function computeMarginRisk({
  project,
  changeOrders,
  commitments,
  invoices,
}: MarginRiskInput): MarginRiskScore {
  const le = computeLivingEstimate({ project, changeOrders, commitments, invoices });

  if (!le.hasMarginBasis) {
    return { score: 0, band: 'low', factors: [], topFactors: [], hasBasis: false };
  }

  const jc = computeJobCost({ project, commitments, invoices, changeOrders });
  const estimate = project.linkedEstimate!;
  const grandTotal = estimate.grandTotal || 1;
  const contract = getContractValue(project, changeOrders) || 1;
  const isClosed = project.status === 'completed' || project.status === 'closed';

  // 1 — Thin bid margin. Below ~18% leaves no cushion; 0% is max risk.
  const m = le.original.marginPct;
  const thinMargin: RiskFactor = {
    key: 'thin_margin',
    label: 'Thin bid margin',
    risk: clamp01((0.18 - m) / 0.18),
    weight: 1.4,
    contribution: 0,
    detail: `Bid at ${pct1(m)} margin`,
    recommendation:
      m < 0.1
        ? 'Razor-thin to start — protect scope and price every change.'
        : 'Little cushion; defend margin on buyout and COs.',
  };

  // 2 — Erosion already in motion (points off the bid). 6 pts = max.
  const erosionMag = Math.max(0, -le.marginErosionPoints);
  const erosion: RiskFactor = {
    key: 'erosion',
    label: 'Margin eroding',
    risk: clamp01(erosionMag / 6),
    weight: 1.5,
    contribution: 0,
    detail: erosionMag > 0.05 ? `Projected margin down ${erosionMag.toFixed(1)} pts from bid` : 'Holding bid margin so far',
    recommendation: 'Trace the biggest variance in Job Costing and recover it now.',
  };

  // 3 — Buyout price exposure: budget not yet locked by signed subs/POs.
  // Irrelevant once the job is closed.
  const cov = jc.commitmentCoverage; // 0–100
  const buyoutExposure: RiskFactor = {
    key: 'buyout_exposure',
    label: 'Unbought-out scope',
    risk: isClosed ? 0 : clamp01((75 - cov) / 75),
    weight: 1.0,
    contribution: 0,
    detail: `${cov.toFixed(0)}% of budget locked by signed subs/POs`,
    recommendation: 'Lock remaining trades before prices move against you.',
  };

  // 4 — Open allowances: estimate $ still in unfirmed allowance lines.
  const openAllowance = estimate.items
    .filter(it => it.isAllowance && !it.firmPricedAt)
    .reduce((s, it) => s + (it.lineTotal ?? 0), 0);
  const allowanceShare = openAllowance / grandTotal;
  const allowance: RiskFactor = {
    key: 'allowances',
    label: 'Open allowances',
    risk: clamp01(allowanceShare / 0.15),
    weight: 1.0,
    contribution: 0,
    detail:
      allowanceShare > 0.005
        ? `${pct(allowanceShare)} of the estimate still in open allowances`
        : 'No open allowances',
    recommendation: 'Firm allowances at buyout before selections run high.',
  };

  // 5 — Cost-overrun trend: projected cost above the cost budget. 5% = max.
  // Computed directly from EAC vs budget to avoid sign-convention ambiguity.
  const overrun = jc.budget > 0 ? Math.max(0, jc.projectedFinal - jc.budget) / jc.budget : 0;
  const overrunTrend: RiskFactor = {
    key: 'overrun',
    label: 'Cost-overrun trend',
    risk: clamp01(overrun / 0.05),
    weight: 1.2,
    contribution: 0,
    detail: overrun > 0.002 ? `Projecting ${pct(overrun)} over cost budget` : 'Costs within budget',
    recommendation: 'Address the largest phase variance before it compounds.',
  };

  // 6 — Scope volatility: unapproved change-order value relative to contract.
  const pendingShare = le.pendingChangeOrders / contract;
  const scopeVolatility: RiskFactor = {
    key: 'scope_volatility',
    label: 'Unsigned change orders',
    risk: clamp01(pendingShare / 0.1),
    weight: 0.6,
    contribution: 0,
    detail:
      le.pendingChangeOrders > 0
        ? `${money(le.pendingChangeOrders)} in unapproved change orders`
        : 'No pending change orders',
    recommendation: 'Get pending COs signed — unbanked scope is margin at risk.',
  };

  // 7 — Overcommitted subs: commitments signed above their linked estimate.
  const overCount = jc.overcommittedCommitments.length;
  const overcommitted: RiskFactor = {
    key: 'overcommitted',
    label: 'Overcommitted subs',
    risk: clamp01(overCount / 3),
    weight: 0.8,
    contribution: 0,
    detail:
      overCount > 0
        ? `${overCount} commitment${overCount === 1 ? '' : 's'} signed above the estimate`
        : 'No overcommitted subs',
    recommendation: 'Reconcile overcommitted subs against the estimate scope.',
  };

  const factors = [
    thinMargin, erosion, buyoutExposure, allowance, overrunTrend, scopeVolatility, overcommitted,
  ];

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const weightedRisk = factors.reduce((s, f) => s + f.risk * f.weight, 0);
  const score = Math.round((weightedRisk / totalWeight) * 100);

  const totalWeightedRisk = weightedRisk || 1;
  for (const f of factors) {
    f.contribution = (f.risk * f.weight) / totalWeightedRisk;
  }
  factors.sort((a, b) => b.contribution - a.contribution);

  return {
    score,
    band: bandFor(score),
    factors,
    topFactors: factors.filter(f => f.risk >= 0.15),
    hasBasis: true,
  };
}

export function riskBandLabel(band: RiskBand): string {
  switch (band) {
    case 'low': return 'Low risk';
    case 'moderate': return 'Moderate risk';
    case 'elevated': return 'Elevated risk';
    case 'high': return 'High risk';
  }
}
