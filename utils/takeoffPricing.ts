// utils/takeoffPricing.ts
//
// Prices a takeoff line from the contractor's OWN cost book.
//
// WHY THIS IS THE WHOLE POINT. app/takeoff-estimate already had two price
// sources: an LLM guess (`aiUnitPrice`) and a deterministic rate from
// constants/materials.ts (`engineRate`). Both are GENERIC — the catalog knows
// what framing costs somewhere, not what it costs *you*. That is precisely the
// failure mode the AI-estimator products get mocked for (publicly over-bidding
// $7,500 to paint eight doors).
//
// MAGE has the thing they don't: utils/costDatabase learns each contractor's
// real installed rate per trade + unit from their own closed jobs. This module
// matches a takeoff line to that history, so the price on the estimate is the
// number that contractor actually paid last time.
//
// Priority the caller should apply: YOURS > engine catalog > AI guess.
//
// Pure: no React, no network, no clock.

import type { CostBookEntry } from '@/utils/costDatabase';

export type PriceSource = 'yours' | 'engine' | 'ai' | 'manual';

export interface OwnRateMatch {
  /** The rate to use — the cost book's blended suggestion. */
  rate: number;
  /** The trade label it matched, for display ("matched to Framing"). */
  trade: string;
  unit: string;
  /** How many of the contractor's jobs back this rate. */
  jobCount: number;
  confidence: CostBookEntry['confidence'];
  /** Spread across jobs, as a fraction (0.12 = ±12%). */
  variability: number;
  /** 0..1 — how confident we are this line IS that trade (not the rate itself). */
  matchScore: number;
}

/** Words that carry no trade meaning, so they can't earn a match on their own. */
const STOPWORDS = new Set([
  'and', 'the', 'of', 'for', 'with', 'per', 'new', 'install', 'installed',
  'installation', 'supply', 'labor', 'material', 'materials', 'work', 'misc',
  'miscellaneous', 'allowance', 'each', 'total', 'other', 'general',
]);

/** Split any identifier/label into comparable lowercase words. */
export function words(input: string): string[] {
  return (input ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

/** Units that mean the same thing, so a book entry in SF matches a line in SQFT. */
const UNIT_ALIASES: Record<string, string> = {
  sqft: 'sf', sf: 'sf', 'ft2': 'sf',
  lnft: 'lf', lf: 'lf', lin: 'lf',
  ea: 'ea', each: 'ea', unit: 'ea',
  cy: 'cy', cuyd: 'cy',
  hr: 'hr', hour: 'hr', hrs: 'hr',
  ls: 'ls', lot: 'ls',
};

export function normalizeUnit(unit: string): string {
  const u = (unit ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return UNIT_ALIASES[u] ?? u;
}

/**
 * Find the contractor's own rate for a takeoff line.
 *
 * Units must agree — an $/SF rate on an EA line is not a cheaper price, it's a
 * wrong one, and silently applying it would be worse than having no history at
 * all. Beyond that, we score word overlap between the line (its CSI division +
 * description) and the book's trade label, and require a real signal rather
 * than a single incidental word.
 */
export function matchOwnRate(
  line: { csiDivision?: string; description?: string; unit: string },
  book: CostBookEntry[],
  opts?: { minJobs?: number; minScore?: number },
): OwnRateMatch | null {
  const minJobs = opts?.minJobs ?? 1;
  const minScore = opts?.minScore ?? 0.34;
  const unit = normalizeUnit(line.unit);
  if (!unit) return null;

  const lineWords = new Set([...words(line.description ?? ''), ...words(line.csiDivision ?? '')]);
  if (lineWords.size === 0) return null;

  let best: OwnRateMatch | null = null;

  for (const entry of book) {
    if (normalizeUnit(entry.unit) !== unit) continue;      // unit must agree
    if ((entry.jobCount ?? 0) < minJobs) continue;          // no history, no claim
    if (!(entry.suggestedRate > 0)) continue;

    const tradeWords = words(entry.trade);
    if (tradeWords.length === 0) continue;
    const hits = tradeWords.filter(w => lineWords.has(w)).length;
    if (hits === 0) continue;

    // Score against the trade label's own length, so a one-word trade matched
    // exactly ("Framing") beats a two-word trade half-matched.
    const score = hits / tradeWords.length;
    if (score < minScore) continue;

    if (
      !best ||
      score > best.matchScore ||
      // Tie-break on evidence: more of the contractor's jobs behind it wins.
      (score === best.matchScore && (entry.jobCount ?? 0) > best.jobCount)
    ) {
      best = {
        rate: entry.suggestedRate,
        trade: entry.trade,
        unit: entry.unit,
        jobCount: entry.jobCount ?? 0,
        confidence: entry.confidence,
        variability: entry.variability ?? 0,
        matchScore: score,
      };
    }
  }

  return best;
}

/** Human provenance line shown under a priced row. */
export function priceSourceLabel(source: PriceSource, match?: OwnRateMatch | null): string {
  if (source === 'yours' && match) {
    const jobs = `${match.jobCount} job${match.jobCount === 1 ? '' : 's'}`;
    const spread = match.variability > 0 ? ` · ±${Math.round(match.variability * 100)}%` : '';
    return `Your rate — ${match.trade}, ${jobs}${spread}`;
  }
  if (source === 'engine') return 'Catalog rate — not your history';
  if (source === 'ai') return 'AI estimate — no history for this yet';
  return 'You set this';
}

/** Roll up how much of an estimate is backed by the contractor's own numbers. */
export function pricingProvenance(sources: PriceSource[]): {
  yours: number; engine: number; ai: number; manual: number; ownShare: number;
} {
  const count = { yours: 0, engine: 0, ai: 0, manual: 0 };
  for (const s of sources) count[s] += 1;
  const total = sources.length;
  return { ...count, ownShare: total > 0 ? count.yours / total : 0 };
}
