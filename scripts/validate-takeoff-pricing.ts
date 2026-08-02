// validate-takeoff-pricing.ts — pins utils/takeoffPricing.ts.
//
// This is the module that makes PDF→estimate better than the generic AI
// estimators: it prices each takeoff line from the contractor's OWN closed-job
// history instead of a catalog. A wrong match here puts a confident, specific,
// WRONG number on a bid, so the matcher is pinned hard.
// Run: bun run scripts/validate-takeoff-pricing.ts
import {
  matchOwnRate, normalizeUnit, words, priceSourceLabel, pricingProvenance,
} from '../utils/takeoffPricing';
import type { CostBookEntry } from '../utils/costDatabase';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const entry = (trade: string, unit: string, rate: number, jobCount = 4): CostBookEntry => ({
  key: `${trade}|${unit}`, trade, unit, sampleCount: jobCount * 2, jobCount,
  personalRate: rate, variability: 0.12, bidBias: 0, baseline: rate,
  suggestedRate: rate, confidence: 'high', totalActual: rate * 100,
  lastSeen: '2026-01-01', samples: [],
} as unknown as CostBookEntry);

const BOOK = [
  entry('Framing', 'SF', 12.5),
  entry('Drywall', 'SF', 3.2),
  entry('Electrical', 'EA', 145),
  entry('Interior Paint', 'SF', 1.85),
];

console.log('\ntakeoff pricing (your rates, not a catalog):');

// ── unit normalization ──
expect('sqft → sf', normalizeUnit('SQFT'), 'sf');
expect('LN FT → lf', normalizeUnit('LN-FT'), 'lf');
expect('each → ea', normalizeUnit('Each'), 'ea');
expect('unknown unit passes through', normalizeUnit('BF'), 'bf');

// ── word extraction ──
ok('splits camelCase and drops stopwords',
  JSON.stringify(words('installTheFramingWork')) === JSON.stringify(['framing']),
  JSON.stringify(words('installTheFramingWork')));

// ── the happy path: line matches the contractor's own trade ──
const m = matchOwnRate({ csiDivision: '06 - Wood, Plastics & Composites', description: 'Exterior wall framing', unit: 'SF' }, BOOK);
expect('matches Framing and returns YOUR rate', [m?.trade, m?.rate], ['Framing', 12.5]);
expect('carries the evidence (job count)', m?.jobCount, 4);

// ── UNIT SAFETY: an $/SF rate on an EA line is WRONG, not cheap ──
expect('never matches across units',
  matchOwnRate({ description: 'Framing', unit: 'EA' }, [entry('Framing', 'SF', 12.5)]), null);
expect('EA line matches the EA entry',
  matchOwnRate({ description: 'Electrical outlets', unit: 'EA' }, BOOK)?.rate, 145);

// ── no history → no claim. Must fall through to catalog/AI, not guess. ──
expect('unrelated trade returns null',
  matchOwnRate({ description: 'Asphalt paving', unit: 'SF' }, BOOK), null);
expect('empty book returns null',
  matchOwnRate({ description: 'Framing', unit: 'SF' }, []), null);
expect('entry with zero jobs is not trusted',
  matchOwnRate({ description: 'Framing', unit: 'SF' }, [entry('Framing', 'SF', 12.5, 0)]), null);
expect('entry with no rate is skipped',
  matchOwnRate({ description: 'Framing', unit: 'SF' }, [{ ...entry('Framing', 'SF', 0), suggestedRate: 0 } as CostBookEntry]), null);
expect('blank description cannot match anything',
  matchOwnRate({ description: '', unit: 'SF' }, BOOK), null);

// ── stopwords must not carry a match on their own ──
expect('a line of only stopwords matches nothing',
  matchOwnRate({ description: 'install the new work', unit: 'SF' }, BOOK), null);

// ── multi-word trade needs real overlap ──
const paint = matchOwnRate({ description: 'Interior paint, walls', unit: 'SF' }, BOOK);
expect('two-word trade matches when both words hit', paint?.trade, 'Interior Paint');

// ── tie-break prefers the trade with more of YOUR jobs behind it ──
const tie = matchOwnRate({ description: 'Framing', unit: 'SF' }, [
  entry('Framing', 'SF', 10, 2),
  entry('Framing', 'SF', 14, 9),
]);
expect('more jobs wins the tie', tie?.rate, 14);

// ── provenance labels are honest about where a number came from ──
ok('yours label names the trade + evidence',
  priceSourceLabel('yours', m).startsWith('Your rate — Framing, 4 jobs'), priceSourceLabel('yours', m));
ok('engine label admits it is NOT your history',
  /not your history/.test(priceSourceLabel('engine')));
ok('ai label admits there is no history',
  /no history/.test(priceSourceLabel('ai')));

// ── rollup drives the "X% priced from your jobs" headline ──
const prov = pricingProvenance(['yours', 'yours', 'engine', 'ai']);
expect('counts by source', [prov.yours, prov.engine, prov.ai], [2, 1, 1]);
expect('own share is the honest fraction', prov.ownShare, 0.5);
expect('empty estimate has no own-share', pricingProvenance([]).ownShare, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
