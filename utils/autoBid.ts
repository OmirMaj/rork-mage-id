// utils/autoBid.ts
//
// "MAGE bids for you" — turns inbound opportunities into PRE-PRICED bids.
//
// The 2026 AI bidding tools (Downtobid, ConstructionBids.ai, et al.) find and
// match opportunities but explicitly do NOT price them — they can't, because
// they don't know your costs. MAGE does: the price book learns your real rates
// and the Win Optimizer knows your win history. So this goes the last mile:
//   opportunity → cost basis from YOUR history → win-optimal price → ranked
// so the contractor wakes up to bids that are already priced, ready to review.
//
// Pure: no React/network/clock (caller passes nowMs). The cost basis carries a
// `basis` label so the UI can be honest about where the number came from.

import { computeWinOptimizer } from '@/utils/winOptimizer';
import type { Lead } from '@/types';

/** Minimal shape of an opportunity (a PublicBid row, incl. homeowner RFPs). */
export interface BidOpportunity {
  id: string;
  title: string;
  category?: string;
  /** Agency/scraped bids carry this. */
  estimatedValue?: number;
  /** Homeowner RFPs carry a range instead. */
  budgetMin?: number;
  budgetMax?: number;
  deadline?: string;
  city?: string;
  state?: string;
}

/** One completed job of the contractor's, for the cost anchor. */
export interface JobHistoryPoint {
  category: string;
  /** Actual cost (not price) of that job. */
  cost: number;
}

export type CostBasis = 'your_history' | 'their_budget' | 'none';

export interface PricedBid {
  id: string;
  title: string;
  category: string;
  /** Cost we priced from, and where it came from (honesty). */
  cost: number;
  basis: CostBasis;
  /** Win-optimal price (maximizes expected profit). */
  recommendedPrice: number;
  winProbability: number;
  expectedProfit: number;
  profit: number;
  confidence: 'low' | 'medium' | 'high';
  /** Days until the bid is due; null when no deadline. Negative = past due. */
  daysToDeadline: number | null;
  /** True when our win-optimal price exceeds the owner's stated budget cap. */
  overBudget: boolean;
  /** Fit 0..1 — how close this job is to the contractor's typical size. */
  fit: number;
  /** Ranking score = expectedProfit × fit. */
  score: number;
  /** Plain-English "why this price" lines from the Win Optimizer. */
  drivers: string[];
}

const DAY_MS = 86400000;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Opportunity value the owner/agency signalled (midpoint of a range). */
function signalledValue(o: BidOpportunity): number {
  if (o.budgetMin != null && o.budgetMax != null && o.budgetMax > 0) {
    return (o.budgetMin + o.budgetMax) / 2;
  }
  if (o.budgetMax != null && o.budgetMax > 0) return o.budgetMax;
  if (o.estimatedValue != null && o.estimatedValue > 0) return o.estimatedValue;
  return 0;
}

/**
 * Derive the cost basis for an opportunity.
 *  1. YOUR HISTORY — median actual cost of your completed jobs in this
 *     category, scaled toward the opportunity's signalled size when both exist.
 *  2. THEIR BUDGET — back out an implied cost from the posted value using your
 *     typical markup (price ÷ (1 + markup)).
 * Returns cost 0 / basis 'none' when neither signal exists (caller skips).
 */
export function deriveCostBasis(
  o: BidOpportunity,
  history: JobHistoryPoint[],
  typicalMarkup: number,
): { cost: number; basis: CostBasis } {
  const cat = (o.category ?? '').trim().toLowerCase();
  const sameCat = history.filter((h) => (h.category ?? '').trim().toLowerCase() === cat && h.cost > 0);
  const value = signalledValue(o);

  if (sameCat.length > 0) {
    const hist = median(sameCat.map((h) => h.cost));
    if (value > 0) {
      // Blend: your historical cost, nudged toward this job's signalled size.
      const impliedFromValue = value / (1 + typicalMarkup);
      return { cost: (hist + impliedFromValue) / 2, basis: 'your_history' };
    }
    return { cost: hist, basis: 'your_history' };
  }

  if (value > 0) return { cost: value / (1 + typicalMarkup), basis: 'their_budget' };
  return { cost: 0, basis: 'none' };
}

/** Fit 0..1 — 1.0 when the job matches your typical (median) job size. */
export function sizeFit(cost: number, history: JobHistoryPoint[]): number {
  const costs = history.map((h) => h.cost).filter((c) => c > 0);
  if (costs.length === 0 || cost <= 0) return 0.6; // unknown → neutral-ish
  const typical = median(costs);
  if (typical <= 0) return 0.6;
  const ratio = cost / typical;
  // Full credit within 0.5×..2× your typical job; tapering outside.
  if (ratio >= 0.5 && ratio <= 2) return 1;
  const off = ratio < 0.5 ? 0.5 / ratio : ratio / 2; // >1
  return Math.max(0.15, Math.min(1, 1 / off));
}

export function buildPricedBids(opts: {
  opportunities: BidOpportunity[];
  history: JobHistoryPoint[];
  leads: Pick<Lead, 'stage' | 'lostReason'>[];
  typicalMarkup?: number;
  nowMs: number;
  /** Drop opportunities already past their deadline. Default true. */
  excludePastDue?: boolean;
}): PricedBid[] {
  const { opportunities, history, leads, nowMs } = opts;
  const typicalMarkup = opts.typicalMarkup ?? 0.18;
  const excludePastDue = opts.excludePastDue ?? true;

  const out: PricedBid[] = [];

  for (const o of opportunities) {
    const { cost, basis } = deriveCostBasis(o, history, typicalMarkup);
    if (basis === 'none' || cost <= 0) continue; // nothing honest to price from

    let daysToDeadline: number | null = null;
    if (o.deadline) {
      const ms = Date.parse(o.deadline.length === 10 ? o.deadline + 'T12:00:00' : o.deadline);
      if (Number.isFinite(ms)) daysToDeadline = Math.ceil((ms - nowMs) / DAY_MS);
    }
    if (excludePastDue && daysToDeadline != null && daysToDeadline < 0) continue;

    const wo = computeWinOptimizer({ cost, leads, typicalMarkup });
    const rec = wo.recommended;
    const fit = sizeFit(cost, history);
    const cap = o.budgetMax ?? 0;

    out.push({
      id: o.id,
      title: o.title,
      category: o.category ?? 'General',
      cost: Math.round(cost),
      basis,
      recommendedPrice: Math.round(rec.price),
      winProbability: rec.winProbability,
      expectedProfit: Math.round(rec.expectedProfit),
      profit: Math.round(rec.profit),
      confidence: wo.confidence,
      daysToDeadline,
      overBudget: cap > 0 && rec.price > cap,
      fit,
      score: Math.round(rec.expectedProfit * fit),
      drivers: wo.drivers,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}
