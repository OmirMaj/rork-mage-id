// utils/profitLeak/priceLeakItems.ts — deterministic pricing of AI-flagged
// leak items against the contractor's learned cost book. The engine prices;
// no history → null ("price it yourself"). Never invents a number, never throws.
import { lookupRate, type CostDatabase } from '@/utils/costDatabase';
import type { LeakItem, PricedLeakItem } from '@/types';

export function priceLeakItems(items: LeakItem[], costDb: CostDatabase): PricedLeakItem[] {
  return (items ?? []).map((item) => {
    const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
    const hit = lookupRate(costDb, item.trade, item.unit);
    const fromHistory = !!hit && hit.suggestedRate > 0;
    return {
      ...item,
      quantity: qty,
      estimatedPrice: fromHistory ? Math.round(hit!.suggestedRate * qty) : null,
      rateUsed: fromHistory ? hit!.suggestedRate : null,
      rateConfidence: fromHistory ? hit!.confidence : null,
      fromHistory,
    };
  });
}
