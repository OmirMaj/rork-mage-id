// Pure-fn validator for utils/costXray.ts — run via `bun run scripts/validate-cost-xray.ts`.
// Mirrors scripts/validate-safety-risk.ts (no jest in this repo).
import { priceTell, routeByConfidence, normalizeTells, learnedRate, REMEDIATION, CONFIDENCE_THRESHOLD } from '../utils/costXray';
import type { ConditionTell } from '../utils/costXray';
import type { CostDatabase, CostBookEntry } from '../utils/costDatabase';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

const emptyDb: CostDatabase = { entries: [], jobsAnalyzed: 0, tradesTracked: 0, overallBidAccuracy: null, asOf: '2026-01-01' };

const fpe: ConditionTell = { key: 'panel_fpe_zinsco', category: 'electrical', tell: 'Federal Pacific panel', severity: 'high', confidence: 80, likelihood: 90, photoIndex: 0, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 } };

// No learned rate → uses REMEDIATION baseAllowance, default variability band.
const pricedFpe = priceTell(fpe, emptyDb);
expect('fpe expected = round(0.9 * 2500 * 1)', pricedFpe.band.expected, 2250);
expect('fpe low = round(2250 * (1 - 0.35))', pricedFpe.band.low, 1463);
expect('fpe high = round(2250 * (1 + 0.35))', pricedFpe.band.high, 3038);
expect('fpe hasLearnedRate false', pricedFpe.hasLearnedRate, false);

// Learned rate present for the "Electrical" category (how the cost DB keys entries)
// at unit ea → suggestedRate 3000, variability 0.10.
const entry = (over: Partial<CostBookEntry>): CostBookEntry => ({ key: 'electrical|ea', trade: 'Electrical', unit: 'ea', sampleCount: 6, jobCount: 6, personalRate: 3000, variability: 0.10, bidBias: 0, baseline: 2500, suggestedRate: 3000, confidence: 'high', totalActual: 18000, lastSeen: '2026-01-01', samples: [], ...over });
const learnedDb: CostDatabase = { ...emptyDb, tradesTracked: 1, entries: [entry({})] };
const pricedLearned = priceTell(fpe, learnedDb);
expect('learned expected = round(0.9 * 3000 * 1)', pricedLearned.band.expected, 2700);
expect('learned low = round(2700 * (1 - 0.10))', pricedLearned.band.low, 2430);
expect('learned hasLearnedRate true', pricedLearned.hasLearnedRate, true);

// learnedRate falls back to the richest-sampled entry for the category when the
// exact unit is absent (contractor priced Electrical by 'ls', not 'ea').
const lsDb: CostDatabase = { ...emptyDb, tradesTracked: 1, entries: [
  entry({ key: 'electrical|ls', unit: 'ls', sampleCount: 2, suggestedRate: 4000 }),
  entry({ key: 'electrical|ls', unit: 'ls', sampleCount: 9, suggestedRate: 5000 }),
] };
expect('learnedRate picks richest-sampled entry for category', learnedRate(lsDb, 'Electrical', 'ea')?.suggestedRate, 5000);
expect('priceTell uses category fallback rate', priceTell(fpe, lsDb).band.expected, 4500); // round(0.9 * 5000)
expect('learnedRate null when category absent', learnedRate(lsDb, 'Roofing', 'ea'), null);

// Band low is floored at 0 even when variability >= 1.0.
const wildDb: CostDatabase = { ...emptyDb, tradesTracked: 1, entries: [entry({ variability: 1.5 })] };
expect('band low floored at 0 (variability 1.5)', priceTell(fpe, wildDb).band.low, 0);

// Confidence routing.
expect('below threshold → verify-only', routeByConfidence({ ...fpe, confidence: CONFIDENCE_THRESHOLD - 1 }), 'verify-only');
expect('at threshold → price', routeByConfidence({ ...fpe, confidence: CONFIDENCE_THRESHOLD }), 'price');

// Normalization drops junk + unknown keys, clamps confidence.
const normalized = normalizeTells([
  { key: 'panel_fpe_zinsco', category: 'electrical', tell: 'FPE', severity: 'high', confidence: 250, likelihood: 90, photoIndex: 0, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } },
  { key: 'not_a_real_key', category: 'electrical', tell: 'x', severity: 'low', confidence: 50, likelihood: 10, photoIndex: 0, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } },
  'garbage',
]);
expect('normalize keeps 1 valid tell', normalized.length, 1);
expect('normalize clamps confidence to 100', normalized[0].confidence, 100);

expect('REMEDIATION covers all 10 v1 keys', Object.keys(REMEDIATION).length, 10);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
