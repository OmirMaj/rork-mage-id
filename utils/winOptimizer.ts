// winOptimizer.ts — the bid price that makes you the most money.
//
// Every estimate in MAGE ends at "cost + your markup". But the question a GC
// actually loses sleep over is "what do I BID to win this *and* still profit?"
// Bid too high → lose the job (zero profit). Bid too low → win it but bleed.
// The sweet spot is the price that maximizes EXPECTED profit:
//
//     EV(markup) = profit(markup) × P(win | that price)
//
// where profit = cost × markup and P(win) falls as the markup rises. We don't
// guess that curve — we calibrate it from the GC's own Lead outcomes (the app
// already tracks won/lost proposals and *why* they were lost). The same
// A→B→A learning loop as the cost engine: the more jobs you close, the sharper
// the curve, the better the next bid.
//
// This is intentionally a TRANSPARENT model, not a black-box ML one — a GC
// will only trust a number they can see the reasoning behind. Every output
// carries its drivers ("price was the dealbreaker in 60% of your losses").
//
// No competitor in the residential / light-commercial space prices bids by
// expected value. This is the moat feature: it grows revenue directly.

import type { Lead, LeadStage } from '@/types';

export interface BidPoint {
  /** Markup over cost, as a fraction (0.18 = 18%). */
  markup: number;
  /** Bid price = cost × (1 + markup). */
  price: number;
  /** Gross profit at this price = cost × markup. */
  profit: number;
  /** Modeled probability of winning the job at this price, 0..1. */
  winProbability: number;
  /** profit × winProbability — the number we maximize. */
  expectedProfit: number;
}

export interface WinOptimizerResult {
  cost: number;
  /** The markup/price that maximizes expected profit. */
  recommended: BidPoint;
  /** Price-to-win: a lower price with materially higher odds. */
  aggressive: BidPoint;
  /** Hold-margin: a higher price, accepting lower odds. */
  premium: BidPoint;
  /** The point at the GC's own typical markup, for "what you'd have bid" framing. */
  atTypical: BidPoint;
  /** Sampled curve (ascending markup) for charting. */
  curve: BidPoint[];
  /** Calibrated base win rate (Bayesian-smoothed), 0..1. */
  winRate: number;
  /** Share of losses where price was the stated dealbreaker, 0..1. */
  priceLossShare: number;
  /** How many won/lost proposals informed the calibration. */
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  /** Plain-English reasons behind the recommendation. */
  drivers: string[];
}

export interface WinOptimizerInput {
  /** True job cost — the estimate's cost basis BEFORE markup. Must be > 0. */
  cost: number;
  /** The GC's lead history. Only won/lost proposals calibrate the curve. */
  leads: Pick<Lead, 'stage' | 'lostReason'>[];
  /** The markup the GC would otherwise apply (fraction). Anchors the curve. Default 0.18. */
  typicalMarkup?: number;
  /** Other bidders the GC believes they're up against. More → lower odds at a given price. */
  competitorCount?: number;
  /** Markup sweep bounds (fractions). Default 0.02 .. 0.6. */
  minMarkup?: number;
  maxMarkup?: number;
}

const logit = (p: number): number => {
  const c = Math.min(0.999, Math.max(0.001, p));
  return Math.log(c / (1 - c));
};
const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
const round2 = (n: number): number => Math.round(n * 100) / 100;

const WON: LeadStage = 'won';
const LOST: LeadStage = 'lost';

/**
 * Compute the expected-value-optimal bid for a job.
 *
 * Pure function — all data in, no storage/network. The win curve is a
 * logistic in markup, anchored so that at the GC's *typical* markup the
 * modeled win probability equals their calibrated base win rate, with a slope
 * that steepens the more often price is the reason they lose.
 */
export function computeWinOptimizer(input: WinOptimizerInput): WinOptimizerResult {
  const cost = Math.max(1, input.cost);
  const typicalMarkup = clampMarkup(input.typicalMarkup ?? 0.18);
  const minMarkup = clampMarkup(input.minMarkup ?? 0.02);
  const maxMarkup = Math.max(minMarkup + 0.05, clampMarkup(input.maxMarkup ?? 0.6));

  // ── Calibrate from history ──────────────────────────────────────────
  // Only leads that reached a decision (won/lost) carry pricing signal.
  let wins = 0;
  let losses = 0;
  let priceLosses = 0;
  for (const l of input.leads) {
    if (l.stage === WON) wins += 1;
    else if (l.stage === LOST) {
      losses += 1;
      if (isPriceLoss(l.lostReason)) priceLosses += 1;
    }
  }
  const sampleSize = wins + losses;

  // Bayesian-smoothed win rate — a weak Beta(2,2) prior keeps a 1-of-1 or
  // 0-of-3 sample from producing an absurd 100%/0% curve.
  const PRIOR_WINS = 2;
  const PRIOR_LOSSES = 2;
  const winRate = (wins + PRIOR_WINS) / (sampleSize + PRIOR_WINS + PRIOR_LOSSES);
  const priceLossShare = losses > 0 ? priceLosses / losses : 0;

  // Slope: how fast odds fall as markup rises. Steeper when price is often the
  // dealbreaker. Units are "per unit of markup fraction"; over a realistic
  // 0.05 markup swing this moves the odds by a believable amount.
  const K_MIN = 6;
  const K_MAX = 22;
  let slope = K_MIN + (K_MAX - K_MIN) * priceLossShare;

  // Competitor pressure: each additional known bidder beyond the first nudges
  // the whole curve down (you need to be sharper to win a crowded bid).
  const competitorCount = Math.max(0, input.competitorCount ?? 0);
  const competitorDrag = competitorCount > 1 ? Math.min(0.18, (competitorCount - 1) * 0.05) : 0;

  // Anchor: P(win | typicalMarkup) == winRate (minus competitor drag). Solve
  // for the 50%-win markup m0 from the logistic identity.
  const anchorWin = Math.min(0.97, Math.max(0.03, winRate - competitorDrag));
  const m0 = typicalMarkup + logit(anchorWin) / slope;

  const winProbAt = (markup: number): number => logistic(-slope * (markup - m0));

  const pointAt = (markupRaw: number): BidPoint => {
    const markup = clampMarkup(markupRaw, minMarkup, maxMarkup);
    const price = cost * (1 + markup);
    const profit = cost * markup;
    const winProbability = winProbAt(markup);
    return {
      markup,
      price: round2(price),
      profit: round2(profit),
      winProbability,
      expectedProfit: round2(profit * winProbability),
    };
  };

  // ── Sweep the curve and pick the max-EV point ───────────────────────
  const STEP = 0.005;
  const curve: BidPoint[] = [];
  let recommended = pointAt(minMarkup);
  for (let m = minMarkup; m <= maxMarkup + 1e-9; m += STEP) {
    const pt = pointAt(m);
    curve.push(pt);
    if (pt.expectedProfit > recommended.expectedProfit) recommended = pt;
  }

  // Aggressive (price-to-win) and premium (hold-margin) anchored off the
  // recommended point's odds, then snapped to the curve.
  const aggressive = nearestByWin(curve, Math.min(0.9, recommended.winProbability + 0.15), 'below', recommended.markup);
  const premium = nearestByWin(curve, Math.max(0.25, recommended.winProbability - 0.15), 'above', recommended.markup);
  const atTypical = pointAt(typicalMarkup);

  const confidence: WinOptimizerResult['confidence'] =
    sampleSize >= 15 ? 'high' : sampleSize >= 5 ? 'medium' : 'low';

  return {
    cost: round2(cost),
    recommended,
    aggressive,
    premium,
    atTypical,
    curve,
    winRate,
    priceLossShare,
    sampleSize,
    confidence,
    drivers: buildDrivers({
      wins, losses, winRate, priceLossShare, sampleSize, confidence,
      recommended, atTypical, typicalMarkup, competitorCount,
    }),
  };
}

function clampMarkup(m: number, lo = 0.0, hi = 1.0): number {
  if (!Number.isFinite(m)) return lo;
  return Math.min(hi, Math.max(lo, m));
}

/** Loss reason counts as price-driven when the GC tagged it price/cost/budget/expensive. */
function isPriceLoss(reason?: string): boolean {
  if (!reason) return false;
  return /price|cost|budget|expensive|too high|cheaper/i.test(reason);
}

/**
 * Find the curve point whose win probability is closest to `target`, searching
 * only on the requested side of the recommended markup so "aggressive" is
 * always cheaper than "recommended" and "premium" always dearer.
 */
function nearestByWin(
  curve: BidPoint[],
  target: number,
  side: 'below' | 'above',
  pivotMarkup: number,
): BidPoint {
  const pool = curve.filter(p => (side === 'below' ? p.markup <= pivotMarkup : p.markup >= pivotMarkup));
  const search = pool.length > 0 ? pool : curve;
  let best = search[0];
  let bestDelta = Math.abs(best.winProbability - target);
  for (const p of search) {
    const d = Math.abs(p.winProbability - target);
    if (d < bestDelta) { best = p; bestDelta = d; }
  }
  return best;
}

function buildDrivers(a: {
  wins: number; losses: number; winRate: number; priceLossShare: number;
  sampleSize: number; confidence: WinOptimizerResult['confidence'];
  recommended: BidPoint; atTypical: BidPoint; typicalMarkup: number; competitorCount: number;
}): string[] {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const drivers: string[] = [];

  if (a.sampleSize === 0) {
    drivers.push('No closed proposals yet — using sensible defaults. The recommendation sharpens as you mark leads won or lost.');
  } else {
    drivers.push(`Your proposal win rate is ${pct(a.winRate)} (${a.wins} of ${a.wins + a.losses} closed).`);
  }

  if (a.losses > 0) {
    if (a.priceLossShare >= 0.5) {
      drivers.push(`Price was the dealbreaker in ${pct(a.priceLossShare)} of your losses — buyers here are price-sensitive, so odds fall fast as you mark up.`);
    } else if (a.priceLossShare > 0) {
      drivers.push(`Only ${pct(a.priceLossShare)} of your losses were about price — you have room to hold margin.`);
    } else {
      drivers.push('None of your losses were tagged "price" — price isn\'t what\'s costing you jobs, so don\'t leave margin on the table.');
    }
  }

  if (a.competitorCount > 1) {
    drivers.push(`${a.competitorCount} bidders in play — the curve is shifted down to reflect a crowded bid.`);
  }

  const dMarkup = a.recommended.markup - a.typicalMarkup;
  if (Math.abs(dMarkup) >= 0.01) {
    const dir = dMarkup > 0 ? 'higher' : 'lower';
    const evGain = a.recommended.expectedProfit - a.atTypical.expectedProfit;
    drivers.push(
      `Recommended markup ${Math.round(a.recommended.markup * 100)}% is ${Math.round(Math.abs(dMarkup) * 100)} pts ${dir} than your usual ${Math.round(a.typicalMarkup * 100)}%` +
      (evGain > 0 ? ` — worth ~$${Math.round(evGain).toLocaleString()} more in expected profit.` : '.'),
    );
  } else {
    drivers.push(`Your usual ${Math.round(a.typicalMarkup * 100)}% markup is already near the expected-value optimum — nice instincts.`);
  }

  if (a.confidence === 'low') {
    drivers.push('Confidence: low — fewer than 5 closed proposals. Treat this as a starting point, not gospel.');
  }

  return drivers;
}
