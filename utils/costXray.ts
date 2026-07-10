// Cost X-Ray — pure pricing logic. No React, no I/O. Detection happens in the
// analyze-photos edge fn (task 'conditionRisk'); this module turns detected tells
// into probability-weighted allowance bands on the contractor's learned costs.
import { lookupRate } from './costDatabase';
import type { CostDatabase, CostBookEntry } from './costDatabase';
import type { XrayCategory, BBox } from '@/types';

/** Closed set of v1 "priceable core" tells the model must classify into. */
export type TellKey =
  | 'panel_fpe_zinsco' | 'wiring_knob_tube' | 'outlets_two_prong'
  | 'supply_galvanized' | 'waste_cast_iron' | 'supply_polybutylene'
  | 'structural_cracks' | 'floor_sloped'
  | 'moisture_efflorescence' | 'moisture_staining';

export interface ConditionTell {
  key: TellKey;
  category: XrayCategory;
  tell: string;          // human label
  severity: 'low' | 'med' | 'high';
  confidence: number;    // 0..100
  likelihood: number;    // 0..100 base probability of the condition
  photoIndex: number;
  bbox: BBox;
}

interface Remediation { trade: string; unit: string; typicalQty: number; baseAllowance: number }

/** Tell → remediation trade/unit/qty + catalog fallback allowance ($). `trade` is the
 *  contractor's price-book CATEGORY label — that is how buildCostDatabase keys entries
 *  (costDatabase.ts: `trade = l.category`), so learnedRate() personalizes the cost from
 *  their own history. When they have no history for that category we fall back to
 *  baseAllowance. */
export const REMEDIATION: Record<TellKey, Remediation> = {
  panel_fpe_zinsco:      { trade: 'Electrical', unit: 'ea', typicalQty: 1, baseAllowance: 2500 },
  wiring_knob_tube:      { trade: 'Electrical', unit: 'ea', typicalQty: 1, baseAllowance: 8000 },
  outlets_two_prong:     { trade: 'Electrical', unit: 'ea', typicalQty: 1, baseAllowance: 1500 },
  supply_galvanized:     { trade: 'Plumbing',   unit: 'ea', typicalQty: 1, baseAllowance: 6000 },
  waste_cast_iron:       { trade: 'Plumbing',   unit: 'ea', typicalQty: 1, baseAllowance: 5000 },
  supply_polybutylene:   { trade: 'Plumbing',   unit: 'ea', typicalQty: 1, baseAllowance: 6000 },
  structural_cracks:     { trade: 'General',    unit: 'ea', typicalQty: 1, baseAllowance: 3500 },
  floor_sloped:          { trade: 'General',    unit: 'ea', typicalQty: 1, baseAllowance: 3000 },
  moisture_efflorescence:{ trade: 'General',    unit: 'ea', typicalQty: 1, baseAllowance: 2500 },
  moisture_staining:     { trade: 'General',    unit: 'ea', typicalQty: 1, baseAllowance: 1500 },
};

/** Band width used when the contractor has no learned rate for the trade/unit. */
export const DEFAULT_VARIABILITY = 0.35;
/** Below this detection confidence, a tell becomes field-verify-only (no priced line). */
export const CONFIDENCE_THRESHOLD = 55;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export interface PricedTell {
  tell: ConditionTell;
  remediation: Remediation | null;
  band: { low: number; expected: number; high: number };
  hasLearnedRate: boolean;
}

/** The contractor's learned rate for a trade category. Prefers an exact trade+unit
 *  match; falls back to the richest-sampled entry for that category (any unit) so
 *  personalization still fires when the unit differs. Null when they have no history. */
export function learnedRate(db: CostDatabase, trade: string, unit: string): CostBookEntry | null {
  const exact = lookupRate(db, trade, unit);
  if (exact) return exact;
  const t = trade.toLowerCase();
  const byTrade = db.entries.filter((e) => e.trade.toLowerCase() === t);
  if (byTrade.length === 0) return null;
  return byTrade.reduce((a, b) => (b.sampleCount > a.sampleCount ? b : a));
}

/** Price a tell as a probability-weighted allowance on learned costs (catalog fallback). */
export function priceTell(tell: ConditionTell, db: CostDatabase): PricedTell {
  const rem = REMEDIATION[tell.key] ?? null;
  const learned = rem ? learnedRate(db, rem.trade, rem.unit) : null;
  const unitCost = learned?.suggestedRate ?? rem?.baseAllowance ?? 0;
  const qty = rem?.typicalQty ?? 1;
  const p = clamp01(tell.likelihood / 100);
  const expected = Math.round(p * unitCost * qty);
  const variability = learned?.variability ?? DEFAULT_VARIABILITY;
  const low = Math.max(0, Math.round(expected * (1 - variability)));
  const high = Math.round(expected * (1 + variability));
  return { tell, remediation: rem, band: { low, expected, high }, hasLearnedRate: !!learned };
}

/** Low-confidence tells become a field-verify task instead of a priced line. */
export function routeByConfidence(tell: ConditionTell): 'price' | 'verify-only' {
  return tell.confidence < CONFIDENCE_THRESHOLD ? 'verify-only' : 'price';
}

/** Defensive client-side coercion of the edge response (belt-and-suspenders). */
export function normalizeTells(raw: unknown): ConditionTell[] {
  if (!Array.isArray(raw)) return [];
  const keys = Object.keys(REMEDIATION) as TellKey[];
  const cats: XrayCategory[] = ['electrical', 'plumbing', 'structural', 'moisture'];
  const out: ConditionTell[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (!keys.includes(o.key as TellKey)) continue;
    if (!cats.includes(o.category as XrayCategory)) continue;
    const b = (o.bbox ?? {}) as Record<string, unknown>;
    out.push({
      key: o.key as TellKey,
      category: o.category as XrayCategory,
      tell: String(o.tell ?? '').slice(0, 120),
      severity: (['low', 'med', 'high'].includes(String(o.severity)) ? o.severity : 'med') as ConditionTell['severity'],
      confidence: Math.max(0, Math.min(100, Number(o.confidence) || 0)),
      likelihood: Math.max(0, Math.min(100, Number(o.likelihood) || 0)),
      photoIndex: Number.isFinite(Number(o.photoIndex)) ? Number(o.photoIndex) : 0,
      bbox: { x: Number(b.x) || 0, y: Number(b.y) || 0, w: Number(b.w) || 0, h: Number(b.h) || 0 },
    });
  }
  return out;
}
