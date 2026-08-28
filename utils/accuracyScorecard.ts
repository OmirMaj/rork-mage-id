// accuracyScorecard.ts — where your estimates are wrong, in dollars.
//
// THE GAP THIS FILLS. The cost book (utils/costDatabase) already knows each
// trade's bidBias — the weighted mean of (actualUnit/bidUnit − 1). But it sorts
// the book by EXPOSURE (totalActual) and renders bias as a sentence at the
// bottom of a card. So the number a GC actually needs is present but never
// asked: "which trades are systematically costing me money, and how much?"
//
// A percentage does not motivate. "You bid drywall 12% light" is a statistic;
// "drywall has cost you $18,400 more than you bid across 7 jobs" is a decision.
// This module turns the same verified samples into that dollar figure and ranks
// by it.
//
// THE MATH IS DELIBERATELY DIRECT, not derived from bidBias. For every sample
// that carries a real bid, the miss is:
//
//     quantity × (actualUnit − bidUnit)
//
// i.e. exactly the dollars the job came in over (positive) or under (negative)
// what was bid for that scope. Summing that is honest in a way that
// back-computing from a ratio is not — no compounding, no division by a bid
// that might be near zero.
//
// WHAT IS EXCLUDED, and why it matters:
//   • seeded samples — a rate the GC TYPED is not a job they closed, so it has
//     no bid-vs-actual to be wrong about.
//   • samples with bidUnit <= 0 — nothing was predicted, so nothing missed.
//   • samples flagged excludedFromRate — the outlier rejection in costDatabase
//     already refuses to let a weather/scope blowout teach the learned rate.
//     Letting that same job dominate the scorecard would contradict the engine
//     it reports on: the GC would be told to raise a rate the book deliberately
//     ignored.
//
// Pure — no storage, no network. Testable (scripts/validate-accuracy-scorecard).

import type { CostBookEntry, CostDatabase, CostSample } from '@/utils/costDatabase';
import { isSeedSample } from '@/utils/costSeedCore';

/** Below this many earned jobs, a trade's bias is noise, not a pattern. */
export const MIN_JOBS_FOR_PATTERN = 2;

/** |bias| under this reads as "on the money" — don't cry wolf over 1%. */
export const BIAS_NOISE_FLOOR = 0.03;

export interface TradeAccuracy {
  key: string;
  trade: string;
  unit: string;
  /** Distinct earned jobs behind the comparison. */
  jobCount: number;
  /** Samples that actually carried a bid to compare against. */
  ratedSamples: number;
  /** Weighted mean of (actualUnit/bidUnit − 1). + = you bid LOW. */
  bidBias: number;
  /** Σ qty × (actualUnit − bidUnit). + = it cost MORE than you bid. */
  missDollars: number;
  /** What you'd have had to bid to break even on these samples. */
  suggestedRate: number;
  /** The rate the book currently suggests you bid. */
  currentBaseline: number;
  confidence: CostBookEntry['confidence'];
  /** True when the sample count clears MIN_JOBS_FOR_PATTERN and the bias
   *  clears the noise floor — i.e. worth showing as a finding. */
  isPattern: boolean;
  direction: 'under' | 'over' | 'on';
}

export interface AccuracyScorecard {
  /** Ranked by |missDollars| — biggest money problem first. */
  trades: TradeAccuracy[];
  /** Net across every rated sample. + = you've underbid overall. */
  netMissDollars: number;
  /** Sum of only the trades you underbid — the money genuinely left behind,
   *  not netted out by the ones you padded. */
  underbidDollars: number;
  /** Sum of the trades you overbid (as a positive number). */
  overbidDollars: number;
  /** Exposure-weighted accuracy from the book, 0..1, or null. */
  overallAccuracy: number | null;
  /** Earned jobs behind the whole scorecard. */
  jobsAnalyzed: number;
  /** Trades that have a bid to compare against at all. */
  tradesRated: number;
}

/** Samples that can legitimately be scored: earned, bid-carrying, not an
 *  outlier the cost engine already threw out. */
function ratedSamples(entry: CostBookEntry): CostSample[] {
  return entry.samples.filter(
    s => !isSeedSample(s) && s.bidUnit > 0 && s.quantity > 0 && !s.excludedFromRate,
  );
}

export function computeAccuracyScorecard(db: CostDatabase): AccuracyScorecard {
  const trades: TradeAccuracy[] = [];

  for (const entry of db.entries) {
    const ss = ratedSamples(entry);
    if (ss.length === 0) continue;

    const missDollars = ss.reduce((a, s) => a + s.quantity * (s.actualUnit - s.bidUnit), 0);
    const qty = ss.reduce((a, s) => a + s.quantity, 0);
    // Recompute bias over the SAME filtered set so the % and the $ can never
    // disagree — entry.bidBias is computed over a slightly different set.
    const bidBias = qty > 0
      ? ss.reduce((a, s) => a + s.quantity * (s.actualUnit / s.bidUnit - 1), 0) / qty
      : 0;
    // Break-even rate: what these samples actually cost per unit.
    const breakEven = qty > 0 ? ss.reduce((a, s) => a + s.actualUnit * s.quantity, 0) / qty : 0;

    const jobCount = new Set(ss.map(s => s.projectId)).size;
    const direction: TradeAccuracy['direction'] =
      Math.abs(bidBias) < BIAS_NOISE_FLOOR ? 'on' : bidBias > 0 ? 'under' : 'over';

    trades.push({
      key: entry.key,
      trade: entry.trade,
      unit: entry.unit,
      jobCount,
      ratedSamples: ss.length,
      bidBias,
      missDollars,
      suggestedRate: breakEven,
      currentBaseline: entry.baseline,
      confidence: entry.confidence,
      isPattern: jobCount >= MIN_JOBS_FOR_PATTERN && direction !== 'on',
      direction,
    });
  }

  // Biggest money problem first — magnitude, so a large overbid (leaving work
  // on the table by pricing yourself out) ranks alongside a large underbid.
  trades.sort((a, b) => Math.abs(b.missDollars) - Math.abs(a.missDollars));

  const netMissDollars = trades.reduce((a, t) => a + t.missDollars, 0);
  const underbidDollars = trades.reduce((a, t) => a + (t.missDollars > 0 ? t.missDollars : 0), 0);
  const overbidDollars = trades.reduce((a, t) => a + (t.missDollars < 0 ? -t.missDollars : 0), 0);
  const jobsAnalyzed = new Set(
    db.entries.flatMap(e => ratedSamples(e).map(s => s.projectId)),
  ).size;

  return {
    trades,
    netMissDollars,
    underbidDollars,
    overbidDollars,
    overallAccuracy: db.overallBidAccuracy,
    jobsAnalyzed,
    tradesRated: trades.length,
  };
}

/** One-line finding for a trade, or null when there's no pattern worth stating. */
export function tradeHeadline(t: TradeAccuracy): string | null {
  if (!t.isPattern) return null;
  const pct = Math.abs(Math.round(t.bidBias * 100));
  const jobs = `${t.jobCount} job${t.jobCount === 1 ? '' : 's'}`;
  return t.direction === 'under'
    ? `Bid ${pct}% light across ${jobs}`
    : `Bid ${pct}% heavy across ${jobs}`;
}

/** The action to take, or null when nothing is actionable. */
export function tradeAction(t: TradeAccuracy): string | null {
  if (!t.isPattern || t.suggestedRate <= 0) return null;
  const money = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;
  return t.direction === 'under'
    ? `Bid ${money(t.suggestedRate)}/${t.unit} to break even here`
    : `You could bid as low as ${money(t.suggestedRate)}/${t.unit} and still cover cost`;
}
