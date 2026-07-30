// utils/widgetEstimate.ts
//
// The engine behind the embeddable "Instant Estimate" widget — the one a
// contractor drops on their OWN website so a homeowner gets a ballpark number
// in ten seconds instead of waiting three days for a callback.
//
// WHY THIS IS DELIBERATELY COARSE. Everywhere else in MAGE, a price comes from
// the contractor's real history (utils/costDatabase.ts learns rates from closed
// jobs; utils/autoBid.ts prices off that history and labels its `basis` so the
// UI can be honest about it). This engine has none of that: it gets four inputs
// from a stranger on a stranger's website. So it does NOT pretend to be an
// estimate. It publishes a BAND, names every assumption it had to make, and
// refuses outright when the inputs can't support a defensible number.
//
// The model, in one line:
//   total = rate($/sf for this scope at standard finish)
//         × quality multiplier × regional factor × size-scaling factor
//         × size,  floored at a mobilization minimum
// and the band around it widens for every input we had to guess.
//
// Rates are published U.S. residential remodel/build ranges (national, 2026
// dollars), NOT the MAGE Price Index — the index is per-trade unit costs from
// opted-in contractors, which is a different (and much narrower) thing. When
// index coverage is deep enough per project type this should be re-anchored
// on it; until then the honest label is "typical published range".
//
// PURE: no React, no network, no clock. Callers that want an `asOf` stamp pass
// `nowMs`. The only import is the shared regional cost index, and only the
// zip→factor helper touches it — `estimateWidgetRange` itself is dependency-free.
//
// A copy of the rate table is inlined in supabase/functions/widget-estimate so
// the public endpoint stays a single self-contained Deno file. scripts/
// validate-widget-estimate.ts asserts the two never drift.

import { REGIONS, CITY_ADJUSTMENTS } from '@/constants/regions';

export type WidgetQuality = 'budget' | 'standard' | 'premium' | 'luxury';
export type WidgetConfidence = 'low' | 'medium' | 'high';

export interface WidgetProjectType {
  id: string;
  label: string;
  /** What the square-footage field means for this scope (shown as the hint). */
  measure: string;
  /** $/sq ft at `standard` finish, national (factor 1.0), at `typicalSizeSqft`. */
  rateLow: number;
  rateLikely: number;
  rateHigh: number;
  /** Used when the visitor leaves size blank — and as the size-scaling anchor. */
  typicalSizeSqft: number;
  /** Sizes we have a defensible rate for. Outside this we clamp and widen. */
  minSizeSqft: number;
  maxSizeSqft: number;
  /** Mobilization floor: the smallest total this scope realistically closes at. */
  floorTotal: number;
  /** <1 ⇒ economies of scale: $/sf drifts down as the job gets bigger. */
  sizeExponent: number;
}

/**
 * Scopes a homeowner can actually pick off a dropdown. Deliberately short —
 * a longer list is a worse form and buys no accuracy at this resolution.
 *
 * Bands are wide on purpose. A "kitchen remodel" spans a $28k cabinet-refresh
 * and a $140k gut with a structural wall move; the band has to contain both or
 * the number is a lie.
 */
export const WIDGET_PROJECT_TYPES: WidgetProjectType[] = [
  {
    id: 'kitchen_remodel', label: 'Kitchen remodel', measure: 'kitchen floor area',
    rateLow: 180, rateLikely: 300, rateHigh: 475,
    typicalSizeSqft: 180, minSizeSqft: 60, maxSizeSqft: 800,
    floorTotal: 14000, sizeExponent: 0.88,
  },
  {
    id: 'bathroom_remodel', label: 'Bathroom remodel', measure: 'bathroom floor area',
    rateLow: 220, rateLikely: 380, rateHigh: 600,
    typicalSizeSqft: 60, minSizeSqft: 25, maxSizeSqft: 300,
    floorTotal: 9000, sizeExponent: 0.85,
  },
  {
    id: 'whole_home_remodel', label: 'Whole-home remodel', measure: 'finished area being remodeled',
    rateLow: 95, rateLikely: 165, rateHigh: 260,
    typicalSizeSqft: 2000, minSizeSqft: 600, maxSizeSqft: 12000,
    floorTotal: 60000, sizeExponent: 0.93,
  },
  {
    id: 'home_addition', label: 'Home addition', measure: 'new conditioned area',
    rateLow: 180, rateLikely: 275, rateHigh: 420,
    typicalSizeSqft: 600, minSizeSqft: 100, maxSizeSqft: 5000,
    floorTotal: 40000, sizeExponent: 0.92,
  },
  {
    id: 'new_construction', label: 'New home construction', measure: 'conditioned area',
    rateLow: 165, rateLikely: 260, rateHigh: 400,
    typicalSizeSqft: 2400, minSizeSqft: 500, maxSizeSqft: 15000,
    floorTotal: 150000, sizeExponent: 0.95,
  },
  {
    id: 'adu', label: 'ADU / garage conversion', measure: 'ADU floor area',
    rateLow: 200, rateLikely: 320, rateHigh: 480,
    typicalSizeSqft: 700, minSizeSqft: 200, maxSizeSqft: 1500,
    floorTotal: 60000, sizeExponent: 0.9,
  },
  {
    id: 'basement_finish', label: 'Basement finish', measure: 'basement floor area',
    rateLow: 45, rateLikely: 85, rateHigh: 145,
    typicalSizeSqft: 900, minSizeSqft: 200, maxSizeSqft: 4000,
    floorTotal: 15000, sizeExponent: 0.9,
  },
  {
    id: 'deck_patio', label: 'Deck or patio', measure: 'deck / patio area',
    rateLow: 30, rateLikely: 60, rateHigh: 110,
    typicalSizeSqft: 350, minSizeSqft: 60, maxSizeSqft: 2500,
    floorTotal: 4500, sizeExponent: 0.9,
  },
  {
    id: 'roof_replacement', label: 'Roof replacement', measure: 'roof area (≈ footprint × 1.2)',
    rateLow: 5.5, rateLikely: 9.5, rateHigh: 17,
    typicalSizeSqft: 2200, minSizeSqft: 400, maxSizeSqft: 20000,
    floorTotal: 6500, sizeExponent: 0.94,
  },
  {
    id: 'siding_replacement', label: 'Siding replacement', measure: 'wall area being resided',
    rateLow: 7, rateLikely: 13, rateHigh: 24,
    typicalSizeSqft: 1800, minSizeSqft: 300, maxSizeSqft: 15000,
    floorTotal: 6000, sizeExponent: 0.94,
  },
  {
    id: 'flooring', label: 'Flooring replacement', measure: 'floor area',
    rateLow: 5, rateLikely: 11, rateHigh: 20,
    typicalSizeSqft: 900, minSizeSqft: 100, maxSizeSqft: 8000,
    floorTotal: 2500, sizeExponent: 0.92,
  },
  {
    id: 'commercial_ti', label: 'Commercial tenant improvement', measure: 'leased area',
    rateLow: 55, rateLikely: 110, rateHigh: 200,
    typicalSizeSqft: 3000, minSizeSqft: 400, maxSizeSqft: 60000,
    floorTotal: 35000, sizeExponent: 0.93,
  },
];

/**
 * Finish level. These move the whole job, not just the fixtures — a luxury
 * kitchen buys different cabinets AND a longer schedule AND more trades.
 */
export const WIDGET_QUALITY_MULTIPLIERS: Record<WidgetQuality, number> = {
  budget: 0.78,
  standard: 1.0,
  premium: 1.32,
  luxury: 1.85,
};

export const WIDGET_QUALITY_LABELS: Record<WidgetQuality, string> = {
  budget: 'Budget — keep it simple, stock finishes',
  standard: 'Standard — mid-range finishes',
  premium: 'Premium — high-end finishes',
  luxury: 'Luxury — custom, no compromises',
};

/** Regional cost factors outside this band are almost certainly a bad input. */
const REGION_FACTOR_MIN = 0.7;
const REGION_FACTOR_MAX = 1.6;

/** Beyond this multiple of the priceable size band we refuse rather than guess. */
const ABSURD_SIZE_MULTIPLE = 3;

/** How much each guessed input widens the band, as a fraction. */
const WIDEN_NO_SIZE = 0.18;
const WIDEN_SIZE_CLAMPED = 0.12;
const WIDEN_NO_QUALITY = 0.1;
const WIDEN_NO_REGION = 0.08;

export const WIDGET_RATE_BASIS =
  'Typical published U.S. cost ranges for this scope, adjusted for size, finish level and region. Not a quote.';

export interface WidgetEstimateInput {
  projectType?: string | null;
  sizeSqft?: number | null;
  quality?: string | null;
  /** 1.0 = national. Use regionFactorForZip() to derive one from a zip. */
  regionFactor?: number | null;
  /** Optional — only used to stamp `asOf`. Kept out of the math so this is pure. */
  nowMs?: number | null;
}

export interface WidgetRange {
  low: number;
  likely: number;
  high: number;
}

export interface WidgetEstimate {
  /** False when the inputs can't support a defensible number. Then `range` is null. */
  priceable: boolean;
  range: WidgetRange | null;
  /** Per-square-foot view of the same band — null when not priceable. */
  perSqft: WidgetRange | null;
  projectTypeId: string | null;
  projectLabel: string | null;
  quality: WidgetQuality;
  /** The size actually priced (defaulted or clamped), not necessarily the input. */
  sizeSqft: number | null;
  regionFactor: number;
  confidence: WidgetConfidence;
  /** Plain-English "how we got here". Every guess we made shows up in here. */
  assumptions: string[];
  /** Set only when priceable is false. */
  cannotPriceReason: string | null;
  basis: string;
  /** ISO stamp when the caller supplied nowMs; null otherwise. */
  asOf: string | null;
}

// ── helpers ───────────────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Shared rounding granularity so low/likely/high can never cross after rounding. */
function roundStep(likely: number): number {
  if (likely >= 250000) return 10000;
  if (likely >= 100000) return 5000;
  if (likely >= 20000) return 1000;
  if (likely >= 5000) return 500;
  return 100;
}

const floorTo = (n: number, step: number): number => Math.floor(n / step) * step;
const ceilTo = (n: number, step: number): number => Math.ceil(n / step) * step;
const roundTo = (n: number, step: number): number => Math.round(n / step) * step;

/** Accepts ids, labels and the obvious synonyms a hand-written embed will send. */
export function normalizeProjectType(raw: string | null | undefined): WidgetProjectType | null {
  const s = (raw ?? '').trim().toLowerCase().replace(/[\s\-/]+/g, '_');
  if (!s) return null;
  const exact = WIDGET_PROJECT_TYPES.find((p) => p.id === s);
  if (exact) return exact;
  const byLabel = WIDGET_PROJECT_TYPES.find(
    (p) => p.label.toLowerCase().replace(/[\s\-/]+/g, '_') === s,
  );
  if (byLabel) return byLabel;
  const synonyms: Record<string, string> = {
    kitchen: 'kitchen_remodel',
    bath: 'bathroom_remodel',
    bathroom: 'bathroom_remodel',
    remodel: 'whole_home_remodel',
    whole_home: 'whole_home_remodel',
    gut_renovation: 'whole_home_remodel',
    addition: 'home_addition',
    new_home: 'new_construction',
    new_build: 'new_construction',
    custom_home: 'new_construction',
    accessory_dwelling_unit: 'adu',
    garage_conversion: 'adu',
    basement: 'basement_finish',
    deck: 'deck_patio',
    patio: 'deck_patio',
    roof: 'roof_replacement',
    roofing: 'roof_replacement',
    siding: 'siding_replacement',
    floors: 'flooring',
    tenant_improvement: 'commercial_ti',
    ti: 'commercial_ti',
  };
  const mapped = synonyms[s];
  return mapped ? (WIDGET_PROJECT_TYPES.find((p) => p.id === mapped) ?? null) : null;
}

/** Returns null (not a default) when the caller said nothing usable — the
 *  caller needs to know it was a guess so the band can widen. */
export function normalizeQuality(raw: string | null | undefined): WidgetQuality | null {
  const s = (raw ?? '').trim().toLowerCase().replace(/[\s\-_]+/g, '');
  if (!s) return null;
  if (['budget', 'economy', 'basic', 'value', 'low'].includes(s)) return 'budget';
  if (['standard', 'mid', 'midrange', 'midgrade', 'average', 'normal'].includes(s)) return 'standard';
  if (['premium', 'highend', 'upscale', 'high'].includes(s)) return 'premium';
  if (['luxury', 'custom', 'ultra', 'bespoke'].includes(s)) return 'luxury';
  return null;
}

// ── zip → regional cost factor ────────────────────────────────────────────

/**
 * ZIP3 ranges → USPS state. Coarse on purpose: we only need it to land in the
 * right entry of constants/regions.ts REGIONS, which is itself a 10-bucket
 * model. Ranges are contiguous and ordered; anything unmatched falls through
 * to the national factor.
 */
const ZIP3_TO_STATE: [number, number, string][] = [
  [5, 5, 'NY'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'],
  [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'],
  [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'],
  [270, 289, 'NC'], [290, 299, 'SC'],
  [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'],
  [386, 397, 'MS'], [398, 399, 'GA'],
  [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'],
  [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'],
  [580, 588, 'ND'], [590, 599, 'MT'],
  [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'],
  [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'],
  [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'],
  [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'],
  [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'],
  [995, 999, 'AK'],
];

/**
 * The handful of metros where the state-level factor is badly wrong. Values
 * come straight from CITY_ADJUSTMENTS so there is one number per city in the
 * codebase, not two.
 */
const ZIP3_TO_CITY: [number, number, string][] = [
  [100, 104, 'New York City'], [110, 119, 'New York City'],
  [21, 22, 'Boston'],
  [200, 200, 'Washington DC'], [202, 205, 'Washington DC'],
  [190, 191, 'Philadelphia'],
  [606, 608, 'Chicago'],
  [900, 908, 'Los Angeles'],
  [940, 941, 'San Francisco'], [944, 944, 'San Francisco'],
  [980, 981, 'Seattle'],
  [331, 331, 'Miami'], [770, 772, 'Houston'], [752, 753, 'Dallas'],
  [303, 303, 'Atlanta'], [802, 802, 'Denver'], [850, 853, 'Phoenix'],
  [372, 372, 'Nashville'], [282, 282, 'Charlotte'],
];

export interface ZipRegion {
  /** Multiplier to feed `regionFactor`. 1.0 when we couldn't place the zip. */
  factor: number;
  /** Human label for the assumption line, or null when unplaced. */
  label: string | null;
  /** How we placed it — metro beats state beats nothing. */
  basis: 'metro' | 'region' | 'national';
}

const lookupRange = (table: [number, number, string][], z3: number): string | null => {
  for (const [lo, hi, v] of table) if (z3 >= lo && z3 <= hi) return v;
  return null;
};

/**
 * Coarse regional cost factor for a US zip. Honest about its own resolution:
 * `basis` tells the caller whether this was a metro hit, a 10-bucket regional
 * hit, or a shrug.
 */
export function regionFactorForZip(zip: string | null | undefined): ZipRegion {
  const digits = (zip ?? '').replace(/\D/g, '');
  if (digits.length < 5) return { factor: 1, label: null, basis: 'national' };
  const z3 = Number(digits.slice(0, 3));
  if (!Number.isFinite(z3)) return { factor: 1, label: null, basis: 'national' };

  const city = lookupRange(ZIP3_TO_CITY, z3);
  if (city && CITY_ADJUSTMENTS[city] != null) {
    return { factor: CITY_ADJUSTMENTS[city], label: city, basis: 'metro' };
  }
  const state = lookupRange(ZIP3_TO_STATE, z3);
  if (state) {
    const region = REGIONS.find((r) => r.states.includes(state));
    if (region) return { factor: region.costIndex, label: region.label, basis: 'region' };
  }
  return { factor: 1, label: null, basis: 'national' };
}

// ── the engine ────────────────────────────────────────────────────────────

function emptyEstimate(reason: string, asOf: string | null, extra: string[] = []): WidgetEstimate {
  return {
    priceable: false,
    range: null,
    perSqft: null,
    projectTypeId: null,
    projectLabel: null,
    quality: 'standard',
    sizeSqft: null,
    regionFactor: 1,
    confidence: 'low',
    assumptions: extra,
    cannotPriceReason: reason,
    basis: WIDGET_RATE_BASIS,
    asOf,
  };
}

/**
 * Ballpark a project from four inputs. Never throws; when the inputs are too
 * thin it returns `priceable: false` with a reason rather than inventing a
 * number that looks authoritative.
 */
export function estimateWidgetRange(input: WidgetEstimateInput): WidgetEstimate {
  const asOf =
    typeof input.nowMs === 'number' && Number.isFinite(input.nowMs)
      ? new Date(input.nowMs).toISOString()
      : null;

  const type = normalizeProjectType(input.projectType);
  if (!type) {
    return emptyEstimate(
      input.projectType
        ? `We don't publish a defensible rate for "${String(input.projectType).slice(0, 60)}". Pick the closest scope, or send the details straight to the contractor.`
        : 'Tell us what kind of project it is and we can put a range on it.',
      asOf,
    );
  }

  const assumptions: string[] = [];
  let widen = 0;

  // ── finish level ──
  const parsedQuality = normalizeQuality(input.quality);
  const quality: WidgetQuality = parsedQuality ?? 'standard';
  if (!parsedQuality) {
    widen += WIDEN_NO_QUALITY;
    assumptions.push('Assumed mid-range finishes — premium or custom work runs meaningfully higher.');
  }

  // ── region ──
  const rawRegion = input.regionFactor;
  const regionKnown =
    typeof rawRegion === 'number' && Number.isFinite(rawRegion) && rawRegion > 0;
  const regionFactor = regionKnown ? clamp(rawRegion, REGION_FACTOR_MIN, REGION_FACTOR_MAX) : 1;
  if (!regionKnown) {
    widen += WIDEN_NO_REGION;
    assumptions.push('Priced at national average labor and material costs — no location given.');
  } else if (regionFactor !== rawRegion) {
    assumptions.push(
      `Regional factor clamped to ${regionFactor.toFixed(2)} — anything outside ${REGION_FACTOR_MIN}–${REGION_FACTOR_MAX} is outside what this model can defend.`,
    );
    widen += WIDEN_NO_REGION;
  } else if (regionFactor !== 1) {
    const dir = regionFactor > 1 ? 'above' : 'below';
    assumptions.push(
      `Adjusted ${Math.round(Math.abs(regionFactor - 1) * 100)}% ${dir} national average for your area.`,
    );
  }

  // ── size ──
  const rawSize = input.sizeSqft;
  const sizeGiven = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize > 0;
  if (sizeGiven) {
    const s = rawSize as number;
    if (s < type.minSizeSqft / ABSURD_SIZE_MULTIPLE || s > type.maxSizeSqft * ABSURD_SIZE_MULTIPLE) {
      return emptyEstimate(
        `${s.toLocaleString('en-US')} sq ft is outside anything we can honestly ballpark for a ${type.label.toLowerCase()} (we price ${type.minSizeSqft.toLocaleString('en-US')}–${type.maxSizeSqft.toLocaleString('en-US')} sq ft). Send the details to the contractor instead.`,
        asOf,
      );
    }
  }

  let sizeSqft: number;
  if (!sizeGiven) {
    sizeSqft = type.typicalSizeSqft;
    widen += WIDEN_NO_SIZE;
    assumptions.push(
      `No size given — priced a typical ${type.label.toLowerCase()} at ${type.typicalSizeSqft.toLocaleString('en-US')} sq ft. Give us the real ${type.measure} and this range tightens.`,
    );
  } else {
    const s = rawSize as number;
    sizeSqft = clamp(s, type.minSizeSqft, type.maxSizeSqft);
    if (sizeSqft !== s) {
      widen += WIDEN_SIZE_CLAMPED;
      assumptions.push(
        `${s.toLocaleString('en-US')} sq ft is outside our priced band, so we used ${sizeSqft.toLocaleString('en-US')} sq ft and widened the range.`,
      );
    }
  }

  // ── the math ──
  // Economies of scale: $/sf drifts as the job moves away from a typical one.
  // Bounded so a tiny or enormous job can't run away with the rate.
  const scale = clamp(
    Math.pow(sizeSqft / type.typicalSizeSqft, type.sizeExponent - 1),
    0.7,
    1.6,
  );
  const qualityMult = WIDGET_QUALITY_MULTIPLIERS[quality];
  const common = qualityMult * regionFactor * scale;

  // Mobilization floor scales with finish and region but not with the size
  // curve — showing up, permitting and staging costs what it costs.
  const floor = type.floorTotal * qualityMult * regionFactor;

  let likely = Math.max(type.rateLikely * common * sizeSqft, floor);
  const spreadLow = type.rateLow / type.rateLikely;
  const spreadHigh = type.rateHigh / type.rateLikely;
  let low = likely * spreadLow * (1 - widen);
  let high = likely * spreadHigh * (1 + widen);

  if (likely <= floor) {
    assumptions.push(
      `At this size the number is driven by the minimum it takes to mobilize a ${type.label.toLowerCase()}, not by square footage.`,
    );
    // The floor is a floor on the whole job, so it pulls the bottom up too.
    low = Math.max(low, floor * 0.85);
    high = Math.max(high, floor * 1.35);
    likely = Math.max(likely, floor);
  }

  const step = roundStep(likely);
  const range: WidgetRange = {
    low: Math.max(floorTo(low, step), step),
    likely: roundTo(likely, step),
    high: ceilTo(high, step),
  };
  // Belt and braces: a shared step already guarantees this, but the widget
  // renders "low – high" and must never print an inverted band.
  range.low = Math.min(range.low, range.likely);
  range.high = Math.max(range.high, range.likely);

  const perSqft: WidgetRange = {
    low: Math.round((range.low / sizeSqft) * 100) / 100,
    likely: Math.round((range.likely / sizeSqft) * 100) / 100,
    high: Math.round((range.high / sizeSqft) * 100) / 100,
  };

  const confidence: WidgetConfidence = widen === 0 ? 'high' : widen <= 0.12 ? 'medium' : 'low';

  // Always last, always present. This is the line that keeps the widget honest.
  assumptions.push(
    'This is a ballpark from a few inputs, not a quote. The real number depends on scope, finishes, site conditions and access.',
  );

  return {
    priceable: true,
    range,
    perSqft,
    projectTypeId: type.id,
    projectLabel: type.label,
    quality,
    sizeSqft,
    regionFactor,
    confidence,
    assumptions,
    cannotPriceReason: null,
    basis: WIDGET_RATE_BASIS,
    asOf,
  };
}

/** "$42,000 – $78,000" — the one string the widget actually renders big. */
export function formatWidgetRange(range: WidgetRange | null): string {
  if (!range) return '—';
  const f = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  return `${f(range.low)} – ${f(range.high)}`;
}
