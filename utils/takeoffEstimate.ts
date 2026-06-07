// takeoffEstimate.ts — price a drawn takeoff from YOUR cost database.
//
// This is the join that no competitor has: a quantity lassoed off a plan, priced
// not from generic regional data but from what that trade has actually cost YOU
// (utils/costDatabase, Build A2). Pure function over the cost DB — no network.

import { lookupRate, type CostDatabase, type CostBookEntry } from '@/utils/costDatabase';

export type TakeoffUnit = 'SF' | 'LF' | 'EA';

export interface TakeoffPricing {
  matched: boolean;
  entry: CostBookEntry | null;
  /** Suggested unit rate from the cost DB (blended), or null when no history. */
  rate: number | null;
  /** quantity × rate, or null when unmatched. */
  amount: number | null;
  /** ± variability band as a fraction, for the low/high range. */
  variability: number | null;
  /** Low/high amount from the variability band, for an honest range. */
  low: number | null;
  high: number | null;
  confidence: CostBookEntry['confidence'] | 'no_history';
}

/**
 * Price a quantity of a trade+unit against the cost database. When the trade has
 * history, returns the blended suggested rate, the extended amount, and an honest
 * low/high band from the trade's own variability. When it doesn't, `matched` is
 * false so the UI can show the quantity and ask for a manual rate.
 */
export function priceTakeoff(
  db: CostDatabase,
  trade: string,
  unit: TakeoffUnit,
  quantity: number,
): TakeoffPricing {
  const entry = lookupRate(db, trade, unit);
  if (!entry || entry.suggestedRate <= 0) {
    return {
      matched: false,
      entry: null,
      rate: null,
      amount: null,
      variability: null,
      low: null,
      high: null,
      confidence: 'no_history',
    };
  }
  const rate = entry.suggestedRate;
  const amount = quantity * rate;
  const band = Math.max(0, entry.variability);
  return {
    matched: true,
    entry,
    rate,
    amount,
    variability: band,
    low: amount * (1 - band),
    high: amount * (1 + band),
    confidence: entry.confidence,
  };
}

/** Trades in the cost DB that carry the given unit — drives the trade picker. */
export function tradesForUnit(db: CostDatabase, unit: TakeoffUnit): CostBookEntry[] {
  const u = unit.toLowerCase();
  return db.entries.filter(e => e.unit.toLowerCase() === u);
}
