// utils/scopePricing.ts — THE one pricing path shared by Scope Code Gaps and
// the RFI scope check, so one trade can never show two prices.
//
// The cost book stores trades under the CATEGORY_META LABEL ('Lumber &
// Framing', 'Windows & Doors') because estimate/full.tsx writes the label; an
// AI trade such as 'Electrical' has no CATEGORY_META key and falls through
// as-is (bookKey lowercases both sides). This is the exact key
// app/(tabs)/estimate/review.tsx uses.
//
// EXACT KEY ONLY. Never utils/costXray's any-unit fallback: a rate in another
// unit cannot price this quantity.
//
// Pure — no React, no storage, no network.
import { CATEGORY_META } from '@/constants/materials';
import { lookupRate, type CostBookEntry, type CostDatabase } from '@/utils/costDatabase';

export function scopeRateFor(db: CostDatabase, trade: string, unit: string): CostBookEntry | null {
  return lookupRate(db, CATEGORY_META[trade]?.label ?? trade, unit);
}

/** Where the rate came from, in his words. Never reads as a measured rate when it is not one. */
export function scopeRateCaption(entry: CostBookEntry | null): string {
  if (!entry) return 'No price of yours yet';
  if (entry.provenance === 'seeded') return 'a rate you set';
  const n = entry.jobCount;
  if (entry.earnedBasis === 'contracted') {
    return `from ${n} signed sub price${n === 1 ? '' : 's'}, not yet paid`;
  }
  return `your rate · ${n} job${n === 1 ? '' : 's'}`;
}
