// bidLeveling.ts — turn a pile of sub bids into an honest, ranked decision.
//
// A GC gets three bids on the framing package: $42k, $51k, $38k. The $38k looks
// best — until you read the exclusions and realize it leaves out blocking, the
// dumpster, and the permit, which the other two carry. Leveling is the
// apples-to-apples adjustment that turns raw bids into a real comparison, and
// it's where GCs leave the most money (or get burned by a lowball that balloons
// in change orders). This engine ranks bids by their LEVELED cost (raw +
// normalized adjustment for excluded scope), flags suspiciously-low outliers,
// surfaces every exclusion, and recommends the best honest value vs. the budget.
//
// The adjustment per bid is BidPackageBid.normalizedAdjustment — set manually or
// by the optional AI pass (buildLevelingPrompt → mageAI → updateBidPackageBid).
// This module is pure: deterministic ranking the screen renders + the AI layer
// writes into. No network here.

import type { BidPackage, BidPackageBid } from '@/types';

export interface LeveledBid {
  bid: BidPackageBid;
  vendor: string;
  /** As-submitted dollar amount. */
  rawAmount: number;
  /** Normalized adjustment ($ added for excluded/missing scope). */
  adjustment: number;
  /** rawAmount + adjustment — the honest, comparable cost. */
  leveledAmount: number;
  excludes: string;
  terms: string;
  /** leveledAmount − package budget. Negative = under budget (savings). */
  vsBudget: number;
  /** Suspiciously low vs the field — likely missing scope. */
  outlierLow: boolean;
  /** 1 = best leveled value. */
  rank: number;
  isCheapestRaw: boolean;
  isRecommended: boolean;
}

export interface BidLevelingReport {
  hasBids: boolean;
  budget: number;
  bids: LeveledBid[];
  recommendedId: string | null;
  cheapestRawId: string | null;
  /** Median leveled amount across the field. */
  median: number;
  /** max − min leveled (the range of the field). */
  spread: number;
  spreadPct: number;
  outlierCount: number;
  withExclusions: number;
  /** True once every bid carries a normalized adjustment (fully AI/hand-leveled). */
  fullyLeveled: boolean;
  asOf: string;
}

const OUTLIER_FLOOR = 0.7; // below 70% of median = "too good to be true"

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeBidLeveling(
  pkg: BidPackage,
  allBids: BidPackageBid[],
  resolveVendor: (bid: BidPackageBid) => string,
): BidLevelingReport {
  const budget = pkg.estimateBudget || 0;
  // Disqualified bids are out of the running; everything else competes.
  const bids = allBids.filter(b => b.packageId === pkg.id && b.status !== 'disqualified');

  if (bids.length === 0) {
    return {
      hasBids: false, budget, bids: [], recommendedId: null, cheapestRawId: null,
      median: 0, spread: 0, spreadPct: 0, outlierCount: 0, withExclusions: 0,
      fullyLeveled: false, asOf: new Date().toISOString(),
    };
  }

  const enriched = bids.map(b => {
    const rawAmount = b.amount || 0;
    const adjustment = b.normalizedAdjustment ?? 0;
    return {
      bid: b,
      vendor: resolveVendor(b),
      rawAmount,
      adjustment,
      leveledAmount: rawAmount + adjustment,
      excludes: (b.excludes ?? '').trim(),
      terms: (b.terms ?? '').trim(),
    };
  });

  const med = median(enriched.map(e => e.leveledAmount));
  const cheapestRaw = [...enriched].sort((a, b) => a.rawAmount - b.rawAmount)[0];

  // Rank by leveled cost; the recommendation is the lowest leveled bid that
  // isn't a suspicious outlier (a lowball that's missing scope shouldn't "win").
  const ranked = [...enriched].sort((a, b) => a.leveledAmount - b.leveledAmount);
  const withOutlier = ranked.map(e => ({
    ...e,
    outlierLow: med > 0 && e.leveledAmount < med * OUTLIER_FLOOR,
  }));
  const recommended = withOutlier.find(e => !e.outlierLow) ?? withOutlier[0];

  const leveled: LeveledBid[] = withOutlier.map((e, i) => ({
    bid: e.bid,
    vendor: e.vendor,
    rawAmount: e.rawAmount,
    adjustment: e.adjustment,
    leveledAmount: e.leveledAmount,
    excludes: e.excludes,
    terms: e.terms,
    vsBudget: e.leveledAmount - budget,
    outlierLow: e.outlierLow,
    rank: i + 1,
    isCheapestRaw: e.bid.id === cheapestRaw.bid.id,
    isRecommended: e.bid.id === recommended.bid.id,
  }));

  const leveledAmts = leveled.map(l => l.leveledAmount);
  const spread = Math.max(...leveledAmts) - Math.min(...leveledAmts);

  return {
    hasBids: true,
    budget,
    bids: leveled,
    recommendedId: recommended.bid.id,
    cheapestRawId: cheapestRaw.bid.id,
    median: med,
    spread,
    spreadPct: med > 0 ? spread / med : 0,
    outlierCount: leveled.filter(l => l.outlierLow).length,
    withExclusions: leveled.filter(l => l.excludes.length > 0).length,
    fullyLeveled: leveled.every(l => l.adjustment !== 0 || l.excludes.length === 0),
    asOf: new Date().toISOString(),
  };
}

// ── AI leveling layer (the screen calls mageAI with this, applies via
//    updateBidPackageBid). Pure prompt builder + result type. ──────────────

export interface AILevelSuggestion {
  bidId: string;
  /** Dollar adjustment to add for excluded/missing scope (>= 0). */
  adjustment: number;
  reason: string;
}

/** JSON shape we ask the model for (schemaHint for mageAI). */
export const BID_LEVELING_SCHEMA_HINT = {
  suggestions: [{ bidId: 'string', adjustment: 0, reason: 'string' }],
};

/**
 * Build the prompt that asks the model to estimate, per bid, the dollar value of
 * the scope it EXCLUDES (relative to the package scope + what the other bids
 * include), so all bids can be compared on equal footing.
 */
export function buildLevelingPrompt(
  pkg: BidPackage,
  bids: BidPackageBid[],
  resolveVendor: (bid: BidPackageBid) => string,
): string {
  const lines = bids
    .filter(b => b.status !== 'disqualified')
    .map(b => {
      const v = resolveVendor(b);
      return `- bidId ${b.id} · ${v} · bid $${Math.round(b.amount || 0)}` +
        (b.includes ? ` · INCLUDES: ${b.includes}` : '') +
        (b.excludes ? ` · EXCLUDES: ${b.excludes}` : ' · EXCLUDES: (none stated)');
    })
    .join('\n');

  return (
    'You are leveling subcontractor bids for a general contractor so they can be ' +
    'compared apples-to-apples. For EACH bid, estimate the dollar value of the scope ' +
    'it EXCLUDES that the package needs (and that other bidders include) — this is the ' +
    "amount to ADD to that bid to level it. If a bid excludes nothing material, use 0. " +
    'Base the dollar values on the other bids and typical residential costs. Be ' +
    'conservative and concrete; give a one-line reason citing what was excluded.\n\n' +
    `PACKAGE: ${pkg.name}${pkg.csiDivision ? ` (CSI ${pkg.csiDivision})` : ''}\n` +
    `BUDGET: $${Math.round(pkg.estimateBudget || 0)}\n` +
    (pkg.scopeDescription ? `SCOPE: ${pkg.scopeDescription}\n` : '') +
    `\nBIDS:\n${lines}\n\n` +
    'Return one suggestion per bidId.'
  );
}
