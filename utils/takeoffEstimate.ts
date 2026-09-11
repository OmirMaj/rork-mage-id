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
  /** ± variability band as a fraction, for the low/high range. NULL when the
   *  entry has no OBSERVED spread — see the note in priceTakeoff. */
  variability: number | null;
  /** Low/high amount from the variability band, for an honest range. Both null
   *  when there is no observed spread; render no range at all then, never
   *  "$X–$X". */
  low: number | null;
  high: number | null;
  /** Whether the entry's spread is a measurement (mirrors
   *  CostBookEntry.spreadMeaningful). Exposed so a caller can keep showing the
   *  job count / confidence sentence when it suppresses the range. */
  spreadMeaningful: boolean;
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
      spreadMeaningful: false,
      confidence: 'no_history',
    };
  }
  const rate = entry.suggestedRate;
  const amount = quantity * rate;
  // THE BAND IS ONLY HONEST WHEN THE SPREAD WAS OBSERVED.
  //
  // `Math.max(0, entry.variability)` printed a range for two kinds of entry
  // that have no measured spread at all: a single sample (variability is
  // exactly 0, so the "range" collapsed to $X–$X and claimed a precision
  // nobody measured), and an entry whose every sample carries a price the GC
  // STATED — two seeds at $4 and $6, or clocked hours at one typed rate —
  // which manufactures a real-looking ±20% band out of typed numbers.
  // CostBookEntry.spreadMeaningful is the engine's own answer to that
  // question; the `?? > 0` fallback keeps a caller holding a pre-flag entry
  // behaving exactly as before. app/cost-database, utils/takeoffPricing and
  // components/estimate/RateProvenanceChip read the same flag, so all four
  // surfaces now agree about whether a spread is real.
  const hasSpread = (entry.spreadMeaningful ?? (entry.variability > 0)) && entry.variability > 0;
  const band = hasSpread ? Math.max(0, entry.variability) : 0;
  return {
    matched: true,
    entry,
    rate,
    amount,
    variability: hasSpread ? band : null,
    low: hasSpread ? amount * (1 - band) : null,
    high: hasSpread ? amount * (1 + band) : null,
    spreadMeaningful: hasSpread,
    confidence: entry.confidence,
  };
}

/** Trades in the cost DB that carry the given unit — drives the trade picker. */
export function tradesForUnit(db: CostDatabase, unit: TakeoffUnit): CostBookEntry[] {
  const u = unit.toLowerCase();
  return db.entries.filter(e => e.unit.toLowerCase() === u);
}
