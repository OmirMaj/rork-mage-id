// validate-cost-variance-decomposition.ts — pins outlier rejection in the
// cost-learning core.
//
// WHY THIS EXISTS. costDatabase learns a trade's rate from actualUnit =
// cost/quantity, which conflates repeatable signal (price, your crew's real
// productivity) with one-off noise (a weather week, scope piled on by a change
// order, a fat-fingered actual). Averaging a blowout job into the mean teaches
// the book to bid that trade high forever. utils/varianceDecomposition rejects
// gross outliers from the learned rate using median/MAD — the median shrugs off
// the blowout the mean would swallow — while keeping the job visible to the GC.
//
// Pins INTENDED semantics:
//   • the pure median / MAD helpers are correct
//   • a group with < ROBUST_MIN_SAMPLES is never touched (cold-start safe)
//   • a flat distribution rejects nothing
//   • never reject more than a minority of a group (a variable trade is not a
//     contaminated one)
//   • end-to-end: a 3× blowout among clean jobs is dropped from personalRate,
//     bidBias, and jobCount, but stays in `samples` flagged excludedFromRate,
//     and still counts toward totalActual (real dollars spent)
//
// Run via: bun run test:cost-variance-decomposition

import {
  median,
  medianAbsoluteDeviation,
  flagOutliers,
  ROBUST_MIN_SAMPLES,
} from '../utils/varianceDecomposition';
import { buildCostDatabase, type CostSample } from '../utils/costDatabase';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}
function approx(a: number, b: number, eps = 0.01) {
  return Math.abs(a - b) < eps;
}

// --- pure helpers -----------------------------------------------------------
check('median of odd list', median([3, 1, 2]) === 2);
check('median of even list', median([1, 2, 3, 4]) === 2.5);
check('median of empty is 0', median([]) === 0);
check('median does not mutate input', (() => { const x = [3, 1, 2]; median(x); return x[0] === 3; })());
check('MAD of [10,10,10,10] is 0', medianAbsoluteDeviation([10, 10, 10, 10]) === 0);
check('MAD of [1,2,3,4,5] is 1', medianAbsoluteDeviation([1, 2, 3, 4, 5]) === 1);

// --- flagOutliers guarantees ------------------------------------------------
check('below ROBUST_MIN_SAMPLES flags nothing',
  flagOutliers([10, 10, 10, 999].slice(0, ROBUST_MIN_SAMPLES - 1)).every(f => !f));
check('flat distribution flags nothing',
  flagOutliers([10, 10, 10, 10, 10]).every(f => !f));
check('a lone 3x blowout among clean jobs is flagged',
  (() => {
    const flags = flagOutliers([10, 11, 10.5, 9.5, 10, 30]);
    return flags[5] === true && flags.slice(0, 5).every(f => !f);
  })());
check('never rejects a majority (wide trade kept whole)',
  (() => {
    // half the group is "high" — that's a variable trade, not contamination
    const flags = flagOutliers([10, 10, 10, 40, 40, 40]);
    return flags.every(f => !f);
  })());
check('degenerate spread: ratio test catches a doubled job',
  (() => {
    const flags = flagOutliers([20, 20, 20, 20, 41]);
    return flags[4] === true;
  })());

// --- end-to-end through buildCostDatabase (labor-sample path) ---------------
const laborSample = (projectId: string, actualUnit: number): CostSample => ({
  projectId,
  projectName: projectId,
  trade: 'Labor — framing',
  unit: 'sf',
  quantity: 100,
  bidUnit: 10,
  actualUnit,
  basis: 'actual',
  closedAt: '2026-01-01',
});

// five honest jobs around $10/sf, one weather-blown job at $30/sf.
const samples = [
  laborSample('p1', 10),
  laborSample('p2', 11),
  laborSample('p3', 10.5),
  laborSample('p4', 9.5),
  laborSample('p5', 10),
  laborSample('p6', 30),
];
const db = buildCostDatabase([], [], [], samples, []);
const entry = db.entries.find(e => e.key === 'labor — framing|sf');

check('entry exists', !!entry);
if (entry) {
  // qty-weighted mean of the FIVE clean jobs = 51/5 = 10.2 — NOT 13.5 (all six)
  check('personalRate excludes the blowout (~10.2, not ~13.5)', approx(entry.personalRate, 10.2, 0.05));
  check('exactly one sample excluded', entry.excludedSampleCount === 1);
  check('jobCount counts only the clean jobs (5)', entry.jobCount === 5);
  check('all six samples still present', entry.sampleCount === 6);
  check('the blowout is flagged in samples', entry.samples.some(s => s.excludedFromRate && s.actualUnit === 30));
  check('clean samples are NOT flagged', entry.samples.filter(s => s.actualUnit !== 30).every(s => !s.excludedFromRate));
  // totalActual still includes the blowout's real dollars: sum(actualUnit*qty)
  check('totalActual still counts the blowout dollars',
    approx(entry.totalActual, (10 + 11 + 10.5 + 9.5 + 10 + 30) * 100, 1));
  // bidBias over clean jobs only: mean(actualUnit/10 - 1) ≈ 0.02, not 0.35
  check('bidBias reflects clean jobs (~0.02, not ~0.35)', Math.abs(entry.bidBias) < 0.1);
}

// --- cold-start: three jobs incl. a "blowout" are all kept ------------------
const few = [laborSample('a', 10), laborSample('b', 10), laborSample('c', 30)];
const dbFew = buildCostDatabase([], [], [], few, []);
const entryFew = dbFew.entries.find(e => e.key === 'labor — framing|sf');
check('cold-start (n<4) keeps every sample', !!entryFew && entryFew.excludedSampleCount === 0);

if (failures > 0) {
  console.error(`\n✗ validate-cost-variance-decomposition: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-cost-variance-decomposition: all checks passed');
