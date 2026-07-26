// scripts/validate-autonomy-gate.ts
// Run: bun scripts/validate-autonomy-gate.ts
//
// Tests for utils/brain/autonomyGate.ts:
//   - computeTradeGates: per-trade split, beat/tie logic, n≥5 + rate≥0.60 gate
//   - computeLeakGate: billedRate formula matches accuracyReport.ts:125 verbatim,
//     n≥5 + rate≥0.50 gate
//   - computeAutonomyGates: combined convenience function
//   - Edge cases: n < 5 (gate locked), empty input, single trade, multiple trades

import {
  computeTradeGates,
  computeLeakGate,
  computeAutonomyGates,
} from '../utils/brain/autonomyGate';
import type { BrainPredictionReadRow } from '../utils/brain/types';

let failures = 0;
function assert(cond: boolean, msg: string, extra?: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}${extra ? ` — ${extra}` : ''}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function assertClose(a: number, b: number, tolerance: number, msg: string) {
  assert(Math.abs(a - b) <= tolerance, msg, `got ${a}, expected ~${b}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idSeq = 0;
function makePaceRow(
  trade: string,
  paceBeatAi: boolean,
  tie: boolean,
): BrainPredictionReadRow {
  idSeq++;
  return {
    id: `pace-${idSeq}`,
    user_id: 'u1',
    kind: 'pace_suggestion_applied',
    subject_id: `task-${idSeq}`,
    payload: { trade, aiOriginalDays: 5, paceDays: 4, taskId: `task-${idSeq}`, jobCount: 3, confidence: 'high' },
    predicted_at: new Date().toISOString(),
    resolved_at: new Date().toISOString(),
    outcome: { paceBeatAi, tie, paceErrVsAi: paceBeatAi ? -1 : 1, trade },
  };
}

function makeLeakRow(itemsBilled: number, itemsEaten: number): BrainPredictionReadRow {
  idSeq++;
  return {
    id: `leak-${idSeq}`,
    user_id: 'u1',
    kind: 'leak_flag',
    subject_id: `report-${idSeq}`,
    payload: { reportId: `report-${idSeq}`, items: [] },
    predicted_at: new Date().toISOString(),
    resolved_at: new Date().toISOString(),
    outcome: { itemsBilled, itemsEaten, dollarsBilled: 100, dollarsEaten: 0, closedNoMatch: false },
  };
}

// ─── computeTradeGates tests ──────────────────────────────────────────────────

{
  console.log('\n── computeTradeGates ──');

  // Empty input → no gates
  const empty = computeTradeGates([]);
  assert(empty.length === 0, 'empty input → no trade gates');

  // n < 5 → gate does not pass even if rate is 100%
  const tooFew: BrainPredictionReadRow[] = [
    makePaceRow('framing', true, false),
    makePaceRow('framing', true, false),
    makePaceRow('framing', true, false),
    makePaceRow('framing', true, false),
  ]; // 4 rows, all beat
  const tooFewResult = computeTradeGates(tooFew);
  const framingTooFew = tooFewResult.find(r => r.trade === 'framing');
  assert(!!framingTooFew, 'framing present with n=4');
  assert(framingTooFew!.n === 4, 'n=4');
  assert(!framingTooFew!.passed, 'n < 5 → gate locked (100% but too few)');

  // n = 5, rate = 60% (3 beat + 2 loss) → exactly passes
  const exactPass: BrainPredictionReadRow[] = [
    makePaceRow('drywall', true, false),
    makePaceRow('drywall', true, false),
    makePaceRow('drywall', true, false),
    makePaceRow('drywall', false, false),
    makePaceRow('drywall', false, false),
  ];
  const exactPassResult = computeTradeGates(exactPass);
  const drywallExact = exactPassResult.find(r => r.trade === 'drywall');
  assert(!!drywallExact, 'drywall present');
  assert(drywallExact!.n === 5, 'n=5');
  assertClose(drywallExact!.rate, 0.60, 0.001, 'rate = 0.60');
  assert(drywallExact!.passed, 'n≥5 and rate=0.60 → gate passes');

  // n = 5, rate = 59.9% → does NOT pass
  const justBelow: BrainPredictionReadRow[] = [
    makePaceRow('tile', true, false),
    makePaceRow('tile', true, false),
    makePaceRow('tile', true, false),
    makePaceRow('tile', false, false),
    makePaceRow('tile', false, false),
    // Override the last one to tip below 60%
  ];
  // 3 beat / 5 = 60% exactly — add one more loss to tip to 3/6 = 50%
  justBelow.push(makePaceRow('tile', false, false));
  const tileBelowResult = computeTradeGates(justBelow);
  const tileBelow = tileBelowResult.find(r => r.trade === 'tile');
  assert(!!tileBelow, 'tile present');
  assertClose(tileBelow!.rate, 0.5, 0.001, 'tile rate = 0.50 (3/6)');
  assert(!tileBelow!.passed, 'rate < 0.60 → gate locked');

  // Tie rows count as beatOrTie
  const withTies: BrainPredictionReadRow[] = [
    makePaceRow('concrete', true, false),  // beat
    makePaceRow('concrete', false, true),  // tie
    makePaceRow('concrete', false, true),  // tie
    makePaceRow('concrete', true, false),  // beat
    makePaceRow('concrete', false, false), // loss
  ];
  const tiesResult = computeTradeGates(withTies);
  const concreteTies = tiesResult.find(r => r.trade === 'concrete');
  assert(!!concreteTies, 'concrete present');
  assertClose(concreteTies!.rate, 4 / 5, 0.001, 'concrete rate = 0.80 (4 beatOrTie / 5)');
  assert(concreteTies!.passed, 'ties count toward gate — concrete passes');

  // Multi-trade: two trades in the same row set
  const multiTrade: BrainPredictionReadRow[] = [
    ...Array.from({ length: 5 }, () => makePaceRow('paint', true, false)),
    ...Array.from({ length: 3 }, () => makePaceRow('roofing', false, false)),
  ];
  const multiResult = computeTradeGates(multiTrade);
  const paint = multiResult.find(r => r.trade === 'paint');
  const roofing = multiResult.find(r => r.trade === 'roofing');
  assert(!!paint && paint.passed, 'paint: n=5, rate=1.0 → passes');
  assert(!!roofing && !roofing.passed, 'roofing: n=3 → locked');

  // Rows with null outcome are skipped
  const withNull: BrainPredictionReadRow[] = [
    ...Array.from({ length: 5 }, () => makePaceRow('electrical', true, false)),
    {
      id: 'null-row',
      user_id: 'u1',
      kind: 'pace_suggestion_applied',
      subject_id: 'task-null',
      payload: { trade: 'electrical', aiOriginalDays: 5, paceDays: 4, taskId: 'task-null', jobCount: 2, confidence: 'medium' },
      predicted_at: new Date().toISOString(),
      resolved_at: null, // open, not resolved
      outcome: null,
    },
  ];
  const withNullResult = computeTradeGates(withNull);
  const electrical = withNullResult.find(r => r.trade === 'electrical');
  assert(!!electrical && electrical.n === 5, 'null-outcome rows excluded from n');
}

// ─── computeLeakGate tests ────────────────────────────────────────────────────

{
  console.log('\n── computeLeakGate ──');

  // Empty → n=0, billedRate=0, not passed
  const emptyLeak = computeLeakGate([]);
  assert(emptyLeak.n === 0, 'empty → n=0');
  assert(emptyLeak.billedRate === 0, 'empty → billedRate=0');
  assert(!emptyLeak.passed, 'empty → not passed');

  // n < 5 → not passed even at 100%
  const few = [
    makeLeakRow(3, 0),
    makeLeakRow(2, 0),
    makeLeakRow(4, 0),
    makeLeakRow(1, 0),
  ];
  const fewResult = computeLeakGate(few);
  assert(fewResult.n === 4, 'n=4');
  assertClose(fewResult.billedRate, 1.0, 0.001, 'billedRate=1.0 (all billed)');
  assert(!fewResult.passed, 'n < 5 → not passed');

  // n = 5, billedRate = exactly 0.50 → passes
  // 5 items billed, 5 items eaten across 5 scans
  const exactHalf = [
    makeLeakRow(1, 1),
    makeLeakRow(1, 1),
    makeLeakRow(1, 1),
    makeLeakRow(1, 1),
    makeLeakRow(1, 1),
  ]; // totalBilled=5, totalItems=10 → 0.50
  const halfResult = computeLeakGate(exactHalf);
  assert(halfResult.n === 5, 'n=5');
  assertClose(halfResult.billedRate, 0.50, 0.001, 'billedRate = 0.50 (5/10)');
  assert(halfResult.passed, 'n≥5, billedRate=0.50 → passes');

  // billedRate < 0.50 → not passed
  const lowPrecision = [
    makeLeakRow(1, 3), // 1/4
    makeLeakRow(1, 3),
    makeLeakRow(1, 3),
    makeLeakRow(1, 3),
    makeLeakRow(1, 3),
  ]; // totalBilled=5, totalItems=20 → 0.25
  const lowResult = computeLeakGate(lowPrecision);
  assertClose(lowResult.billedRate, 0.25, 0.001, 'billedRate = 0.25');
  assert(!lowResult.passed, 'billedRate < 0.50 → not passed');

  // billedRate formula: totalBilled / (totalBilled + totalEaten) verbatim from accuracyReport.ts:125
  const mixedScans = [
    makeLeakRow(3, 1),  // +4 items, 3 billed
    makeLeakRow(2, 2),  // +4 items, 2 billed
    makeLeakRow(5, 0),  // +5 items, 5 billed
    makeLeakRow(0, 4),  // +4 items, 0 billed
    makeLeakRow(4, 1),  // +5 items, 4 billed
  ]; // totalBilled=14, totalItems=22 → 14/22 ≈ 0.636
  const mixedResult = computeLeakGate(mixedScans);
  assertClose(mixedResult.billedRate, 14 / 22, 0.001, 'billedRate formula matches accuracyReport.ts:125');
  assert(mixedResult.passed, 'n=5, billedRate=0.636 → passes');
}

// ─── computeAutonomyGates convenience ─────────────────────────────────────────

{
  console.log('\n── computeAutonomyGates ──');

  const combined: BrainPredictionReadRow[] = [
    ...Array.from({ length: 5 }, () => makePaceRow('hvac', true, false)),
    ...Array.from({ length: 5 }, (_, i) => makeLeakRow(i < 3 ? 1 : 0, i < 3 ? 0 : 1)),
    // 3 billed, 2 eaten across 5 scans → billedRate = 3/5 = 0.60 → passes
  ];
  const result = computeAutonomyGates(combined);
  const hvac = result.paceTradeGates.get('hvac');
  assert(!!hvac && hvac.passed, 'hvac pace gate passes via computeAutonomyGates');
  assert(result.leakGate.n === 5, 'leak n=5 via computeAutonomyGates');
  assert(result.leakGate.passed, 'leak gate passes (3/5=0.60) via computeAutonomyGates');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} autonomy gate test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll autonomy gate tests passed.');
}
