// validate-judges-verdict.ts — unit tests for the JUDGES pricing + verdict engine.
// Run via: bun run scripts/validate-judges-verdict.ts
import { priceLines } from '../utils/judges/priceLines';
import type { CostDatabase, CostBookEntry } from '../utils/costDatabase';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// Minimal cost-book entry factory.
function entry(trade: string, unit: string, suggestedRate: number, confidence: CostBookEntry['confidence']): CostBookEntry {
  return {
    key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit,
    sampleCount: 5, jobCount: 5, personalRate: suggestedRate, variability: 0.1,
    bidBias: 0, baseline: suggestedRate, suggestedRate, confidence,
    totalActual: 1000, lastSeen: '2026-01-01', samples: [],
  };
}
function db(entries: CostBookEntry[]): CostDatabase {
  return { entries, jobsAnalyzed: 5, tradesTracked: entries.length, overallBidAccuracy: 0.9, asOf: '2026-01-01' };
}

console.log('\nJUDGES priceLines:');

const d = db([entry('Framing', 'sf', 12, 'high')]);
const priced = priceLines([{ category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 10 }], d);
expect('uses learned rate when history exists', priced[0].usedUnit, 12);
expect('marks fromHistory true', priced[0].fromHistory, true);
expect('lineTrueCost = qty * learnedUnit', priced[0].lineTrueCost, 1200);
expect('carries cost-book confidence', priced[0].confidence, 'high');

const priced2 = priceLines([{ category: 'Tile', unit: 'sf', quantity: 50, bidUnit: 8 }], d);
expect('falls back to bidUnit when no history', priced2[0].usedUnit, 8);
expect('fallback is low confidence', priced2[0].confidence, 'low');
expect('fallback fromHistory false', priced2[0].fromHistory, false);
expect('fallback lineTrueCost = qty * bidUnit', priced2[0].lineTrueCost, 400);

import { computeBidVerdict } from '../utils/judges/computeBidVerdict';
import type { BidVerdictInput } from '../utils/judges/types';

console.log('\nJUDGES computeBidVerdict:');

const baseDb = db([entry('Framing', 'sf', 12, 'high'), entry('Tile', 'sf', 20, 'high')]);
const strongInput: BidVerdictInput = {
  lines: [
    { category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 }, // 1200
    { category: 'Tile', unit: 'sf', quantity: 100, bidUnit: 20 },    // 2000
  ],
  costDb: baseDb,
  targetMargin: 0.20,
  typeMargin: { avgMarginPct: 0.22, jobCount: 6 },
  capacity: { loadPct: 0.2, bookedSolid: false, overlappingProjects: 1 },
};
const v = computeBidVerdict(strongInput);
expect('trueCost sums priced lines', v.trueCost, 3200);
expect('recommendedMid = trueCost/(1-targetMargin)', Math.round(v.recommendedMid), 4000);
expect('marginAtMid ≈ target', Math.round(v.marginAtMid * 100), 20);
expect('strong job → take', v.verdict, 'take');
expect('coverage full when all from history', v.coveragePct, 1);
expect('fitScore 0..100', v.fitScore >= 0 && v.fitScore <= 100, true);
expect('drivers ranked by weight desc', v.drivers.every((d, i, a) => i === 0 || a[i - 1].weight >= d.weight), true);

// Cold-start: no history → fallback pricing, low coverage, disclaimer present.
const coldInput: BidVerdictInput = {
  lines: [{ category: 'Excavation', unit: 'cy', quantity: 50, bidUnit: 40 }],
  costDb: db([]), targetMargin: 0.20,
};
const cold = computeBidVerdict(coldInput);
expect('cold-start coverage 0', cold.coveragePct, 0);
expect('cold-start disclaimer present', cold.disclaimers.length > 0, true);

// Empty scope → walk, zero cost, disclaimer, no throw.
const empty = computeBidVerdict({ lines: [], costDb: db([]), targetMargin: 0.20 });
expect('empty → walk', empty.verdict, 'walk');
expect('empty → 0 true cost', empty.trueCost, 0);

// bidBias nudge: an entry where you bid low (bidBias>0) raises the range.
const lowBidder = entry('Framing', 'sf', 12, 'high'); lowBidder.bidBias = 0.10;
const nudged = computeBidVerdict({ lines: [{ category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 }], costDb: db([lowBidder]), targetMargin: 0.20 });
expect('bidBiasNudge > 0 when you bid low', nudged.bidBiasNudge > 0, true);

import { buildNarrationPrompt } from '../utils/judges/narrateVerdict';

console.log('\nJUDGES narration prompt:');
const promptStr = buildNarrationPrompt(v); // reuse `v` from the strong case above
expect('prompt names the verdict', promptStr.includes('take'), true);
expect('prompt includes the recommended price', promptStr.includes(String(Math.round(v.recommendedMid))), true);
expect('prompt forbids inventing numbers', /do not invent|only.*numbers|use only the numbers/i.test(promptStr), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
