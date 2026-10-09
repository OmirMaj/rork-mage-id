// utils/roomScan/catalogRate.ts — a catalog price for a scan line the contractor has no price for.
//
// The SAME source and the SAME rule as the phone's Visual Takeoff
// (app/area-takeoff.tsx buildEngineRate, private to that screen): the base-tier
// items of one constants/materials category in the EXACT unit, installed cost =
// material + labour + equipment, and the median item for an area or a run. No
// waste is folded in: waste is added once, at pricing. A count line names one
// catalog item instead of taking a category's median, because the median
// "plumbing, each" item is a length of pipe, not a toilet.
//
// A catalog price is a national list price moved by a regional factor. It is
// never the contractor's own number and is always labelled as a catalog price.
//
// Pure: constants/materials has no React Native imports.

import { getLivePrices, getMaterialCostBreakdown, getRegionMultiplier, type MaterialItem } from '@/constants/materials';
import type { ConditionKind } from '@/utils/takeoff/conditions';
import type { RecipeLine } from './recipesCore';

// Fixed, so a catalog rate is the same every time it is asked for (area-takeoff's ENGINE_PRICE_SEED).
const CATALOG_PRICE_SEED = 100;

// Exact units only. A "square" is never converted to square feet by guess.
const CATALOG_UNITS: Record<ConditionKind, string[]> = { area: ['sq ft'], linear: ['lin ft'], count: ['each'] };

const installed = (m: MaterialItem): number => {
  const b = getMaterialCostBreakdown(m);
  return b.materialCost + b.laborCost + b.equipmentCost;
};

export type CatalogRater = (line: Pick<RecipeLine, 'kind' | 'catalog'>) => number | null;

/** A rater for one job location ('' is the US average). Prices are read once. */
export function makeCatalogRater(location: string): CatalogRater {
  const priced = getLivePrices(CATALOG_PRICE_SEED, getRegionMultiplier(location ?? ''));
  return (line) => {
    if (!line.catalog) return null;
    const units = CATALOG_UNITS[line.kind];
    const items = priced.filter((m) =>
      m.specTier === 'base'
      && m.category === line.catalog!.category
      && units.includes(m.unit.toLowerCase().trim()));
    if (line.kind === 'count') {
      const want = line.catalog.item?.toLowerCase();
      if (!want) return null;
      const hit = items.find((m) => m.name.toLowerCase().includes(want));
      if (!hit) return null;
      const rate = Number(installed(hit).toFixed(2));
      return rate > 0 ? rate : null;
    }
    if (items.length === 0) return null;
    const sorted = items.map(installed).sort((p, q) => p - q);
    const rate = Number(sorted[Math.floor(sorted.length / 2)].toFixed(2));
    return rate > 0 ? rate : null;
  };
}
