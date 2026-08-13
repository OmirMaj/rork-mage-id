// utils/judges/priceLines.ts — price each scope line against the contractor's
// learned costs; fall back to the estimate's own price when there's no history.
//
// Unit aliasing: AI-drafted scopes and hand-typed estimates use free-text units
// ('sqft', 'each', 'sq ft'); the cost book keys on whatever unit the closed
// jobs used. Both sides are normalized through the alias map before matching so
// 'Framing sqft' still finds the 'framing|sf' entry.
import { lookupRate, type CostDatabase } from '@/utils/costDatabase';
import type { JudgesLine, PricedLine } from './types';

const UNIT_ALIASES: Record<string, string> = {
  'sqft': 'sf', 'sq ft': 'sf', 'sq.ft.': 'sf', 'sq. ft.': 'sf', 'square feet': 'sf', 'square foot': 'sf', 'ft2': 'sf',
  'sqyd': 'sy', 'sq yd': 'sy', 'square yard': 'sy', 'square yards': 'sy',
  'each': 'ea', 'item': 'ea', 'unit': 'ea', 'count': 'ea',
  'linear ft': 'lf', 'linear feet': 'lf', 'linear foot': 'lf', 'lin ft': 'lf', 'lnft': 'lf',
  'cubic yard': 'cy', 'cubic yards': 'cy', 'cu yd': 'cy', 'yd3': 'cy',
  'hours': 'hour', 'hrs': 'hour', 'hr': 'hour',
  'days': 'day',
};

function normUnit(u: string): string {
  const k = (u || 'unit').trim().toLowerCase();
  return UNIT_ALIASES[k] ?? k;
}

function normKey(trade: string, unit: string): string {
  return `${(trade || '').trim().toLowerCase()}|${normUnit(unit)}`;
}

export function priceLines(lines: JudgesLine[], costDb: CostDatabase): PricedLine[] {
  return lines.map((l) => {
    const qty = Number.isFinite(l.quantity) && l.quantity > 0 ? l.quantity : 0;
    const bidUnit = Number.isFinite(l.bidUnit) && l.bidUnit > 0 ? l.bidUnit : 0;
    // Fast path: exact key. Fallback: alias-normalized comparison on both sides.
    const hit =
      lookupRate(costDb, l.category, l.unit) ??
      costDb.entries.find((e) => normKey(e.trade, e.unit) === normKey(l.category, l.unit)) ??
      null;
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
      // Entries built before the seeding feature (and the hand-built literals in
      // the validators) have no provenance — those are all earned by
      // construction, so an absent value reads 'earned', never 'seeded'.
      provenance: fromHistory ? (hit!.provenance ?? 'earned') : null,
      bookKey: fromHistory ? hit!.key : null,
    };
  });
}
