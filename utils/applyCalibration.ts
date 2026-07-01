// applyCalibration.ts — apply the contractor's persisted per-category cost
// corrections (from useEstimateCalibration) to a LinkedEstimate.
//
// The calibration engine learns "you under-estimate Tile by 12% across 4 jobs"
// and the GC can persist a correction factor per category. This util is what
// finally *spends* that learning: it scales each line's price by its category's
// multiplier and recomputes the estimate totals with the app's own math
// (lineTotal = base·(1+markup/100)·qty, grandTotal = Σ lineTotal,
//  baseTotal = Σ base·qty), so the corrected estimate stays internally
// consistent. This is the payoff of the cost-learning moat.

import type { LinkedEstimate, LinkedEstimateItem } from '@/types';
import type { AppliedCalibration } from '@/hooks/useEstimateCalibration';

export interface CalibrationApplyResult {
  estimate: LinkedEstimate;
  /** Number of line items whose price was actually changed. */
  changedCount: number;
  /** Distinct categories that matched a correction. */
  changedCategories: string[];
  oldGrandTotal: number;
  newGrandTotal: number;
}

const norm = (s: string) => (s || '').trim().toLowerCase();

/**
 * Returns a NEW LinkedEstimate with corrections applied. Never mutates the
 * input. When no correction matches, returns the estimate unchanged with
 * changedCount 0 (caller can skip the write).
 */
export function applyCalibrationToEstimate(
  estimate: LinkedEstimate,
  corrections: AppliedCalibration[],
): CalibrationApplyResult {
  const byCategory = new Map<string, number>();
  for (const c of corrections) {
    if (c && c.category && typeof c.multiplier === 'number' && c.multiplier > 0) {
      byCategory.set(norm(c.category), c.multiplier);
    }
  }

  let changedCount = 0;
  const changedCategories = new Set<string>();

  const items: LinkedEstimateItem[] = estimate.items.map(item => {
    const m = byCategory.get(norm(item.category));
    if (!m || m === 1) return item;
    changedCount += 1;
    changedCategories.add(item.category);
    return {
      ...item,
      unitPrice: item.unitPrice * m,
      bulkPrice: item.bulkPrice * m,
      lineTotal: item.lineTotal * m,
    };
  });

  if (changedCount === 0) {
    return {
      estimate,
      changedCount: 0,
      changedCategories: [],
      oldGrandTotal: estimate.grandTotal,
      newGrandTotal: estimate.grandTotal,
    };
  }

  // Recompute totals from the corrected items using the app's own formula.
  const baseTotal = items.reduce((s, it) => {
    const base = it.usesBulk ? it.bulkPrice : it.unitPrice;
    return s + base * it.quantity;
  }, 0);
  const grandTotal = items.reduce((s, it) => s + it.lineTotal, 0);
  const markupTotal = grandTotal - baseTotal;

  return {
    estimate: { ...estimate, items, baseTotal, markupTotal, grandTotal },
    changedCount,
    changedCategories: Array.from(changedCategories),
    oldGrandTotal: estimate.grandTotal,
    newGrandTotal: grandTotal,
  };
}
