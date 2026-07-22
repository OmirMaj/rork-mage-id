// utils/judges/priceLines.ts — price each scope line against the contractor's
// learned costs; fall back to the estimate's own price when there's no history.
import { lookupRate, type CostDatabase } from '@/utils/costDatabase';
import type { JudgesLine, PricedLine } from './types';

export function priceLines(lines: JudgesLine[], costDb: CostDatabase): PricedLine[] {
  return lines.map((l) => {
    const qty = Number.isFinite(l.quantity) && l.quantity > 0 ? l.quantity : 0;
    const bidUnit = Number.isFinite(l.bidUnit) && l.bidUnit > 0 ? l.bidUnit : 0;
    const hit = lookupRate(costDb, l.category, l.unit);
    const fromHistory = !!hit && hit.suggestedRate > 0;
    const learnedUnit = fromHistory ? hit!.suggestedRate : null;
    const usedUnit = fromHistory ? (learnedUnit as number) : bidUnit;
    return {
      category: l.category,
      unit: l.unit,
      quantity: qty,
      bidUnit,
      learnedUnit,
      usedUnit,
      lineTrueCost: qty * usedUnit,
      confidence: fromHistory ? hit!.confidence : 'low',
      fromHistory,
    };
  });
}
