// validate-judges-verdict.ts — unit tests for the JUDGES pricing + verdict engine.
// Pins the money math to independently computed expected values (post
// adversarial review): residual bias nudge, neutral-anchored fit score,
// coverage damping, booked-solid cap, unit aliasing, unpriced-line disclosure.
// Run via: bun run scripts/validate-judges-verdict.ts
import { priceLines } from '../utils/judges/priceLines';
import { computeBidVerdict } from '../utils/judges/computeBidVerdict';
import { buildNarrationPrompt } from '../utils/judges/narrateVerdict';
import type { BidVerdictInput } from '../utils/judges/types';
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
expect('records the matched book key', priced[0].bookKey, 'framing|sf');

const priced2 = priceLines([{ category: 'Tile', unit: 'sf', quantity: 50, bidUnit: 8 }], d);
expect('falls back to bidUnit when no history', priced2[0].usedUnit, 8);
expect('fallback is low confidence', priced2[0].confidence, 'low');
expect('fallback fromHistory false', priced2[0].fromHistory, false);
expect('fallback lineTrueCost = qty * bidUnit', priced2[0].lineTrueCost, 400);
expect('fallback has no book key', priced2[0].bookKey, null);

// Unit aliasing: free-text 'sqft' finds the 'sf' book entry (case-messy category too).
const aliased = priceLines([{ category: '  framing ', unit: 'sqft', quantity: 10, bidUnit: 8 }], d);
expect('alias sqft→sf matches the book', aliased[0].fromHistory, true);
expect('alias match prices at learned rate', aliased[0].usedUnit, 12);
expect('alias match records canonical key', aliased[0].bookKey, 'framing|sf');

console.log('\nJUDGES computeBidVerdict:');

// Strong case, independently computed:
//   trueCost = 100×12 + 100×20 = 3200; mid = 3200/0.8 = 4000; marginAtMid = 20%.
//   parts: track_record w=0.35 (6 jobs ≥ 3) score=1; capacity w=0.35 score=0.8.
//   base = 100×(0.5×1 + 0.5×0.8) = 90; coverage=1 → confWeight=1.
//   fitScore = 55 + (90−55)×1 = 90 → take.
const baseDb = db([entry('Framing', 'sf', 12, 'high'), entry('Tile', 'sf', 20, 'high')]);
const strongInput: BidVerdictInput = {
  lines: [
    { category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 },
    { category: 'Tile', unit: 'sf', quantity: 100, bidUnit: 20 },
  ],
  costDb: baseDb,
  targetMargin: 0.20,
  typeMargin: { avgMarginPct: 0.22, jobCount: 6 },
  capacity: { loadPct: 0.2, bookedSolid: false, overlappingProjects: 1 },
};
const v = computeBidVerdict(strongInput);
expect('trueCost sums priced lines', v.trueCost, 3200);
expect('recommendedMid = trueCost/(1-targetMargin)', Math.round(v.recommendedMid), 4000);
expect('marginAtMid = target when no nudge', Math.round(v.marginAtMid * 100), 20);
expect('range ordered low < mid < high', v.recommendedLow < v.recommendedMid && v.recommendedMid < v.recommendedHigh, true);
expect('strong-case fitScore pinned at 90', v.fitScore, 90);
expect('strong job → take', v.verdict, 'take');
expect('coverage full when all from history', v.coveragePct, 1);
expect('drivers ranked by weight desc', v.drivers.every((dr, i, a) => i === 0 || a[i - 1].weight >= dr.weight), true);
expect('capacity driver positive when room', v.drivers.find(dr => dr.kind === 'capacity')?.polarity, 'positive');
expect('margin renders as non-scoring chip', v.drivers.find(dr => dr.kind === 'margin')?.weight, 0);
expect('cost confidence renders as chip', v.drivers.some(dr => dr.kind === 'cost_confidence'), true);

// Cold-start: no history → neutral hold_firm, never an inflated take.
//   No signals → base = 55; fitScore = 55 → hold_firm; coverage 0 → disclaimer.
const coldInput: BidVerdictInput = {
  lines: [{ category: 'Excavation', unit: 'cy', quantity: 50, bidUnit: 40 }],
  costDb: db([]), targetMargin: 0.20,
};
const cold = computeBidVerdict(coldInput);
expect('cold-start coverage 0', cold.coveragePct, 0);
expect('cold-start fitScore is neutral 55', cold.fitScore, 55);
expect('cold-start → hold_firm, not take', cold.verdict, 'hold_firm');
expect('cold-start disclaimer present', cold.disclaimers.some(s => s.includes('not yet your history')), true);

// Coverage damping: strong signals cannot pull a zero-coverage job to 'take'.
//   base=90, coverage 0 → confWeight=0.3 → fitScore = 55 + 35×0.3 = 66 (round) → hold_firm.
const dampedInput: BidVerdictInput = {
  lines: [{ category: 'Excavation', unit: 'cy', quantity: 50, bidUnit: 40 }],
  costDb: db([]), targetMargin: 0.20,
  typeMargin: { avgMarginPct: 0.22, jobCount: 6 },
  capacity: { loadPct: 0.2, bookedSolid: false, overlappingProjects: 1 },
};
const damped = computeBidVerdict(dampedInput);
expect('zero coverage damps strong signals to 66', damped.fitScore, 66);
expect('zero coverage cannot reach take', damped.verdict, 'hold_firm');

// Empty scope → walk, zero cost, disclaimer, no throw.
const empty = computeBidVerdict({ lines: [], costDb: db([]), targetMargin: 0.20 });
expect('empty → walk', empty.verdict, 'walk');
expect('empty → 0 true cost', empty.trueCost, 0);

// Residual bias nudge: suggestedRate already absorbs w = jobCount/(jobCount+3)
// of the bias; only the residual (1−w) nudges the price.
//   jobCount 5 → w = 0.625; residual = 0.10×0.375 = 0.0375.
//   mid = (1200/0.8)×1.0375 = 1556.25.
const lowBidder = entry('Framing', 'sf', 12, 'high'); lowBidder.bidBias = 0.10;
const nudged = computeBidVerdict({ lines: [{ category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 }], costDb: db([lowBidder]), targetMargin: 0.20 });
expect('bidBiasNudge > 0 when you bid low', nudged.bidBiasNudge > 0, true);
expect('nudge is the residual only (0.0375)', Math.round(nudged.bidBiasNudge * 10000), 375);
expect('nudged mid pinned at 1556', Math.round(nudged.recommendedMid), 1556);
expect('marginAtMid honest after nudge (23%)', Math.round(nudged.marginAtMid * 100), 23);

// Long history absorbs the bias almost fully — no double-count for moat users.
//   jobCount 50 → w = 50/53; residual = 0.10×(3/53) ≈ 0.0057.
const absorbed = entry('Framing', 'sf', 12, 'high'); absorbed.bidBias = 0.10; absorbed.jobCount = 50;
const nudged50 = computeBidVerdict({ lines: [{ category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 }], costDb: db([absorbed]), targetMargin: 0.20 });
expect('long history → residual nudge < 1%', nudged50.bidBiasNudge > 0 && nudged50.bidBiasNudge < 0.01, true);

// Degenerate targetMargin is clamped to a sane band (0.02–0.6), never Infinity.
const extreme = computeBidVerdict({ lines: [{ category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 }], costDb: d, targetMargin: 1.0 });
expect('targetMargin 1.0 clamps to 0.6', extreme.targetMargin, 0.6);
expect('clamped mid is finite (3000)', Math.round(extreme.recommendedMid), 3000);

// Booked solid can never be a confident take.
const solid = computeBidVerdict({
  lines: strongInput.lines, costDb: baseDb, targetMargin: 0.20,
  typeMargin: { avgMarginPct: 0.25, jobCount: 6 },
  capacity: { loadPct: 0.9, bookedSolid: true, overlappingProjects: 2 },
});
expect('booked solid caps fitScore ≤ 65', solid.fitScore <= 65, true);
expect('booked solid never yields take', solid.verdict !== 'take', true);
expect('booked-solid capacity driver negative', solid.drivers.find(dr => dr.kind === 'capacity')?.polarity, 'negative');

// Unpriced lines are disclosed, not silently dropped.
const unpriced = computeBidVerdict({
  lines: [
    { category: 'Framing', unit: 'sf', quantity: 100, bidUnit: 12 },
    { category: 'Custom Millwork', unit: 'ea', quantity: 5, bidUnit: 0 },
  ],
  costDb: d, targetMargin: 0.20,
});
expect('unpriced line excluded from trueCost', unpriced.trueCost, 1200);
expect('unpriced line disclosed in disclaimers', unpriced.disclaimers.some(s => s.includes('no price')), true);

console.log('\nJUDGES narration prompt:');
const promptStr = buildNarrationPrompt(v);
expect('prompt names the verdict', promptStr.includes('take'), true);
expect('prompt includes the recommended price', promptStr.includes(String(Math.round(v.recommendedMid))), true);
expect('prompt forbids inventing numbers', /do not invent|only.*numbers|use only the numbers/i.test(promptStr), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
