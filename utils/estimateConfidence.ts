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
  /** This estimate's unit cost (lineTotal / quantity). */
  bidUnit: number;
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
    const bidUnit = qty > 0 ? lineTotal / qty : 0;
    const trade = (it.csiDivision || it.category || 'Other').trim() || 'Other';
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
