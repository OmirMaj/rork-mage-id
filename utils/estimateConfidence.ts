// estimateConfidence.ts — score a NEW estimate against your proven costs.
//
// A1 (estimateActuals) and A2 (costDatabase) look backward — what jobs cost. This
// closes the loop forward: take the estimate you're about to send and check each
// line against your learned cost database. Are you pricing framing below what it
// has actually cost you on 6 past jobs? That line is quietly eating margin before
// the job even starts. Is a trade brand-new to you (no history)? That's where the
// risk is — flag it.
//
// Deep-research finding: NO competitor ships a per-line "estimate confidence"
// derived from a contractor's own variance history. Generic tools show a number;
// none tell you how much to trust it. This does.
//
// Pure function over the cost database — no storage, no network.

import type { Project } from '@/types';
import { lookupRate, type CostDatabase } from '@/utils/costDatabase';

/** How aligned the line's price is with your learned actual (±10% = aligned). */
const DEVIATION_THRESHOLD = 0.1;

export type LineConfidence = 'no_history' | 'low' | 'medium' | 'high';
export type PriceFlag = 'underpriced' | 'overpriced' | 'aligned' | 'unknown';

export interface EstimateLineCheck {
  materialId: string;
  name: string;
  trade: string;
  unit: string;
  quantity: number;
  /**
   * This estimate's unit COST — `usesBulk ? bulkPrice : unitPrice`, the same
   * basis app/(tabs)/estimate/full.tsx builds a line from.
   *
   * It used to be `lineTotal / quantity`, which is the SELL price: full.tsx
   * writes `lineTotal = base × (1 + markup/100) × quantity`, and the cart's
   * default markup is 15% (contexts/MaterialCartContext.tsx DEFAULT_MARKUP).
   * `learnedRate` is pure cost (commitment amounts and settled payments), so
   * the comparison was cost-plus-markup against cost. With
   * DEVIATION_THRESHOLD at 0.1 that flagged EVERY cart-built line with history
   * as 'overpriced' and scored the estimate 0, while a line priced 17% BELOW
   * cost plus 20% markup came out 'aligned' and scored 100 — "Well-backed
   * estimate" over a bid that loses money on every unit. This is the third
   * instance of the cost-vs-sell class commit 96d3a295 fixed in
   * estimateActuals and jobCostEngine; scripts/validate-estimate-cost-basis.ts
   * now covers this file too.
   *
   * Note the AI paths (wizard, copilot, drawing-analyzer) all write markup 0
   * with lineTotal already at cost, so this is a no-op there — which is why
   * the bug survived: it was invisible on every fixture built that way.
   */
  bidUnit: number;
  /** The SELL price of the line — exposure/ranking dollars only, never a rate. */
  lineTotal: number;
  /** Suggested rate from the cost DB (blended), or null when no history. */
  learnedRate: number | null;
  /** (bidUnit − learnedRate)/learnedRate. Negative = bidding below actual. */
  deviation: number | null;
  variability: number | null;
  jobCount: number;
  confidence: LineConfidence;
  flag: PriceFlag;
}

export interface EstimateConfidenceReport {
  hasEstimate: boolean;
  /** True once the cost DB has any entry to check against. */
  hasHistory: boolean;
  lines: EstimateLineCheck[];
  totalCost: number;
  /** $ of lines priced in line with proven history (medium/high + aligned). */
  backedCost: number;
  backedPct: number;
  /** $ of lines priced below your learned actual — margin risk. */
  underpricedExposure: number;
  underpricedCount: number;
  /** $ of lines with no cost history at all — unknown risk. */
  noHistoryExposure: number;
  noHistoryCount: number;
  /** 0–100: share of estimate $ backed by aligned, proven costs. */
  score: number;
  asOf: string;
}

function emptyReport(hasEstimate: boolean, hasHistory: boolean): EstimateConfidenceReport {
  return {
    hasEstimate,
    hasHistory,
    lines: [],
    totalCost: 0,
    backedCost: 0,
    backedPct: 0,
    underpricedExposure: 0,
    underpricedCount: 0,
    noHistoryExposure: 0,
    noHistoryCount: 0,
    score: 0,
    asOf: new Date().toISOString(),
  };
}

export function computeEstimateConfidence(
  project: Project,
  db: CostDatabase,
): EstimateConfidenceReport {
  const estimate = project.linkedEstimate;
  if (!estimate || estimate.items.length === 0) {
    return emptyReport(false, db.entries.length > 0);
  }

  const lines: EstimateLineCheck[] = estimate.items.map(it => {
    const qty = it.quantity || 0;
    const lineTotal = it.lineTotal || 0;
    // COST, not sell — see the bidUnit field doc. The quantity cancels, so
    // this is also immune to a line whose lineTotal and quantity disagree.
    const bidUnit = (it.usesBulk ? it.bulkPrice : it.unitPrice) || 0;
    // Category-first so the lookup key matches the cost database's grouping.
    const trade = (it.category || it.csiDivision || 'Other').trim() || 'Other';
    const unit = (it.unit || 'unit').trim() || 'unit';

    const entry = lookupRate(db, trade, unit);
    if (!entry || entry.suggestedRate <= 0 || bidUnit <= 0) {
      return {
        materialId: it.materialId,
        name: it.name,
        trade,
        unit,
        quantity: qty,
        bidUnit,
        lineTotal,
        learnedRate: entry?.suggestedRate ?? null,
        deviation: null,
        variability: entry?.variability ?? null,
        jobCount: entry?.jobCount ?? 0,
        confidence: entry ? entry.confidence : 'no_history',
        flag: 'unknown',
      };
    }

    const deviation = (bidUnit - entry.suggestedRate) / entry.suggestedRate;
    const flag: PriceFlag =
      deviation < -DEVIATION_THRESHOLD ? 'underpriced'
        : deviation > DEVIATION_THRESHOLD ? 'overpriced'
          : 'aligned';

    return {
      materialId: it.materialId,
      name: it.name,
      trade,
      unit,
      quantity: qty,
      bidUnit,
      lineTotal,
      learnedRate: entry.suggestedRate,
      deviation,
      variability: entry.variability,
      jobCount: entry.jobCount,
      confidence: entry.confidence,
      flag,
    };
  });

  // Risk first: underpriced, then no-history, then by line size.
  const flagRank: Record<PriceFlag, number> = { underpriced: 3, unknown: 2, overpriced: 1, aligned: 0 };
  lines.sort((a, b) => flagRank[b.flag] - flagRank[a.flag] || b.lineTotal - a.lineTotal);

  const totalCost = lines.reduce((s, l) => s + l.lineTotal, 0);
  const backedCost = lines
    .filter(l => l.flag === 'aligned' && (l.confidence === 'medium' || l.confidence === 'high'))
    .reduce((s, l) => s + l.lineTotal, 0);
  const underpriced = lines.filter(l => l.flag === 'underpriced');
  const noHistory = lines.filter(l => l.flag === 'unknown');
  const underpricedExposure = underpriced.reduce((s, l) => s + l.lineTotal, 0);
  const noHistoryExposure = noHistory.reduce((s, l) => s + l.lineTotal, 0);

  return {
    hasEstimate: true,
    hasHistory: db.entries.length > 0,
    lines,
    totalCost,
    backedCost,
    backedPct: totalCost > 0 ? backedCost / totalCost : 0,
    underpricedExposure,
    underpricedCount: underpriced.length,
    noHistoryExposure,
    noHistoryCount: noHistory.length,
    score: totalCost > 0 ? Math.round((backedCost / totalCost) * 100) : 0,
    asOf: new Date().toISOString(),
  };
}
