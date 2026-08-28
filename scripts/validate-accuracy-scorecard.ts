// validate-accuracy-scorecard.ts — pins the estimate accuracy scorecard.
//
// WHY THIS EXISTS. This screen tells a GC to change their prices. If the
// arithmetic is wrong, or if it counts samples the cost engine deliberately
// threw out, it will confidently tell them to raise a rate that was never the
// problem — and the moat's whole credibility rests on this number being one
// they can check against their own bank account.
//
// Pins INTENDED semantics:
//   • missDollars is Σ qty × (actualUnit − bidUnit): the literal dollars over
//     (or under) bid. NOT back-computed from a ratio.
//   • + = underbid (cost you more than you bid); − = overbid.
//   • seeded samples are excluded — a rate you TYPED has no bid to be wrong.
//   • samples with no bid (bidUnit <= 0) are excluded — nothing was predicted.
//   • samples the cost engine flagged excludedFromRate (outlier rejection) are
//     excluded — otherwise the scorecard would tell you to raise a rate the
//     book deliberately ignored, contradicting itself.
//   • the % and the $ are computed over the SAME filtered set, so they can
//     never disagree.
//   • ranking is by |missDollars| — the biggest money problem first, whether
//     that is underbidding or pricing yourself out.
//   • a single job, or a bias inside the noise floor, is NOT a "pattern".
//
// Run via: bun run test:accuracy-scorecard

import { buildCostDatabase, type CostSample } from '../utils/costDatabase';
import {
  computeAccuracyScorecard,
  tradeHeadline,
  tradeAction,
  MIN_JOBS_FOR_PATTERN,
  BIAS_NOISE_FLOOR,
} from '../utils/accuracyScorecard';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) { console.error(`  FAIL: ${label}`); failures++; }
}
const approx = (a: number, b: number, eps = 0.51) => Math.abs(a - b) < eps;

/** Labor samples are the cleanest injection path into buildCostDatabase. */
const s = (
  projectId: string, trade: string, qty: number, bidUnit: number, actualUnit: number,
): CostSample => ({
  projectId, projectName: projectId, trade, unit: 'sf',
  quantity: qty, bidUnit, actualUnit, basis: 'actual', closedAt: '2026-01-01',
});

// ── underbid: bid $10, cost $12, 100sf × 3 jobs = +$600 ─────────────────────
{
  const db = buildCostDatabase([], [], [], [
    s('p1', 'Labor — drywall', 100, 10, 12),
    s('p2', 'Labor — drywall', 100, 10, 12),
    s('p3', 'Labor — drywall', 100, 10, 12),
  ], []);
  const sc = computeAccuracyScorecard(db);
  const t = sc.trades.find(x => x.trade === 'Labor — drywall');
  check('underbid trade present', !!t);
  if (t) {
    check('missDollars = +600', approx(t.missDollars, 600));
    check('direction under', t.direction === 'under');
    check('bidBias ≈ +0.20', Math.abs(t.bidBias - 0.2) < 0.001);
    check('jobCount 3', t.jobCount === 3);
    check('isPattern', t.isPattern);
    check('break-even rate = 12', approx(t.suggestedRate, 12, 0.01));
    check('headline names light + jobs', (tradeHeadline(t) ?? '').includes('light') && (tradeHeadline(t) ?? '').includes('3 jobs'));
    check('action tells you to bid the break-even', (tradeAction(t) ?? '').includes('break even'));
  }
  check('underbidDollars = 600', approx(sc.underbidDollars, 600));
  check('overbidDollars = 0', approx(sc.overbidDollars, 0));
  check('net = +600', approx(sc.netMissDollars, 600));
  check('jobsAnalyzed 3', sc.jobsAnalyzed === 3);
}

// ── overbid: bid $10, cost $8 → −$600, and it is NOT netted away ────────────
{
  const db = buildCostDatabase([], [], [], [
    s('p1', 'Labor — paint', 100, 10, 8),
    s('p2', 'Labor — paint', 100, 10, 8),
    s('p3', 'Labor — paint', 100, 10, 8),
    s('q1', 'Labor — framing', 100, 10, 12),
    s('q2', 'Labor — framing', 100, 10, 12),
    s('q3', 'Labor — framing', 100, 10, 12),
  ], []);
  const sc = computeAccuracyScorecard(db);
  check('net cancels to ~0', approx(sc.netMissDollars, 0));
  // …but the two sides are reported separately, which is the point: a GC who
  // pads one trade and starves another has TWO problems, not zero.
  check('underbid side still 600', approx(sc.underbidDollars, 600));
  check('overbid side still 600', approx(sc.overbidDollars, 600));
  const paint = sc.trades.find(x => x.trade === 'Labor — paint');
  check('overbid direction', !!paint && paint.direction === 'over');
  check('overbid headline says heavy', (tradeHeadline(paint!) ?? '').includes('heavy'));
}

// ── seeded rates carry no bid → excluded entirely ───────────────────────────
{
  const db = buildCostDatabase([], [], [], [], [
    { trade: 'Labor — tile', unit: 'sf', rate: 14, reportedJobs: 5, method: 'typed' } as never,
  ]);
  const sc = computeAccuracyScorecard(db);
  check('a seeded-only book scores no trades', sc.tradesRated === 0);
  check('seeded-only net is 0', sc.netMissDollars === 0);
}

// ── a sample with no bid is not a miss ──────────────────────────────────────
{
  const db = buildCostDatabase([], [], [], [
    { ...s('p1', 'Labor — roofing', 100, 0, 12) },
    { ...s('p2', 'Labor — roofing', 100, 0, 12) },
  ], []);
  const sc = computeAccuracyScorecard(db);
  check('no-bid samples produce no rated trade', sc.tradesRated === 0);
}

// ── the outlier the cost engine rejected must not drive the scorecard ───────
{
  // 5 honest jobs at cost≈bid, plus one 3× blowout that costDatabase flags
  // excludedFromRate. If the scorecard counted it, missDollars would be huge.
  const db = buildCostDatabase([], [], [], [
    s('p1', 'Labor — elec', 100, 10, 10),
    s('p2', 'Labor — elec', 100, 10, 11),
    s('p3', 'Labor — elec', 100, 10, 10.5),
    s('p4', 'Labor — elec', 100, 10, 9.5),
    s('p5', 'Labor — elec', 100, 10, 10),
    s('p6', 'Labor — elec', 100, 10, 30),
  ], []);
  const entry = db.entries.find(e => e.trade === 'Labor — elec');
  check('cost engine flagged the blowout', !!entry && (entry.excludedSampleCount ?? 0) === 1);
  const sc = computeAccuracyScorecard(db);
  const t = sc.trades.find(x => x.trade === 'Labor — elec');
  check('scorecard exists for elec', !!t);
  if (t) {
    // clean five: (10+11+10.5+9.5+10) = 51 vs 50 bid → +$100 over 500sf
    check('blowout excluded → miss is +100, not +2100', approx(t.missDollars, 100));
    check('blowout excluded from jobCount', t.jobCount === 5);
    check('bias stays inside the noise floor', Math.abs(t.bidBias) < BIAS_NOISE_FLOOR);
    check('and so it is NOT reported as a pattern', !t.isPattern);
  }
}

// ── ranking is by magnitude, biggest money problem first ────────────────────
{
  const db = buildCostDatabase([], [], [], [
    s('a1', 'Labor — small', 10, 10, 12), s('a2', 'Labor — small', 10, 10, 12),
    s('b1', 'Labor — big', 1000, 10, 11), s('b2', 'Labor — big', 1000, 10, 11),
  ], []);
  const sc = computeAccuracyScorecard(db);
  check('bigger dollar miss ranks first', sc.trades[0].trade === 'Labor — big');
  check('…even though its % bias is smaller', sc.trades[0].bidBias < sc.trades[1].bidBias);
}

// ── one job is not a pattern ────────────────────────────────────────────────
{
  const db = buildCostDatabase([], [], [], [s('solo', 'Labor — hvac', 100, 10, 15)], []);
  const sc = computeAccuracyScorecard(db);
  const t = sc.trades[0];
  check('single job still reports dollars', !!t && approx(t.missDollars, 500));
  check('but is not a pattern', !!t && !t.isPattern);
  check('and yields no headline', tradeHeadline(t) === null);
  check(`MIN_JOBS_FOR_PATTERN is ${MIN_JOBS_FOR_PATTERN}`, MIN_JOBS_FOR_PATTERN === 2);
}

// ── empty book is safe ──────────────────────────────────────────────────────
{
  const sc = computeAccuracyScorecard(buildCostDatabase([], [], [], [], []));
  check('empty: no trades', sc.trades.length === 0);
  check('empty: zero net', sc.netMissDollars === 0);
  check('empty: zero jobs', sc.jobsAnalyzed === 0);
  check('empty: null accuracy', sc.overallAccuracy === null);
}

if (failures > 0) {
  console.error(`\n✗ validate-accuracy-scorecard: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-accuracy-scorecard: all checks passed');
