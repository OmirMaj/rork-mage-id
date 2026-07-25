// validate-bid-history-facts.ts — unit tests for bidHistoryFacts.
//
// Pins INTENDED semantics:
//   • empty records → { facts: [], decidedCount: 0, overallWinRate: null }
//   • pending records excluded — they don't count as decided
//   • fewer than 3 decided bids → overallWinRate:null (no fake percentage)
//   • exactly 3 decided → rate emitted
//   • per-size bucket only emitted when ≥ 2 decided bids in that bucket
//   • bidHistoryFactsBlock returns '' when no facts
//   • bidHistoryFactsBlock returns non-empty string with instruction when facts exist
//
// Run via: bun scripts/validate-bid-history-facts.ts
import { bidHistoryFacts, bidHistoryFactsBlock } from '../utils/bidHistoryFacts';
import type { SubBidRecord } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}
function expect<T>(name: string, got: T, want: T) {
  const ok2 = JSON.stringify(got) === JSON.stringify(want);
  if (ok2) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

function rec(outcome: SubBidRecord['outcome'], bidAmount: number): SubBidRecord {
  return { id: Math.random().toString(36).slice(2), projectId: 'P1', projectName: 'Test', bidAmount, outcome, date: '2025-01-01' };
}

// ── Test: empty input ──
console.log('\n[1] Empty input');
{
  const r = bidHistoryFacts([]);
  expect('facts = []', r.facts, []);
  expect('decidedCount = 0', r.decidedCount, 0);
  expect('overallWinRate = null', r.overallWinRate, null);
}

// ── Test: only pending records ──
console.log('\n[2] Only pending records');
{
  const records = [rec('pending', 100_000), rec('pending', 200_000), rec('pending', 300_000), rec('pending', 400_000)];
  const r = bidHistoryFacts(records);
  expect('decidedCount = 0', r.decidedCount, 0);
  expect('overallWinRate = null (pending never counts)', r.overallWinRate, null);
  ok('no facts', r.facts.length === 0);
}

// ── Test: 2 decided — below threshold ──
console.log('\n[3] 2 decided bids (below MIN_DECIDED=3)');
{
  const records = [rec('won', 100_000), rec('lost', 200_000)];
  const r = bidHistoryFacts(records);
  expect('decidedCount = 2', r.decidedCount, 2);
  expect('overallWinRate = null (< MIN_DECIDED)', r.overallWinRate, null);
  ok('no facts emitted below threshold', r.facts.length === 0);
}

// ── Test: exactly 3 decided ──
console.log('\n[4] Exactly 3 decided bids');
{
  const records = [rec('won', 100_000), rec('won', 150_000), rec('lost', 200_000)];
  const r = bidHistoryFacts(records);
  expect('decidedCount = 3', r.decidedCount, 3);
  ok('overallWinRate is not null at MIN_DECIDED', r.overallWinRate !== null);
  // 2 of 3 won = 0.666...
  ok('overallWinRate ≈ 0.667', Math.abs((r.overallWinRate ?? 0) - 2/3) < 0.001);
  ok('overall fact line present', r.facts.length >= 1);
  ok('fact mentions "won"', r.facts[0].includes('won'));
}

// ── Test: size-bucket only when ≥2 in bucket ──
console.log('\n[5] Size-bucket emission threshold');
{
  // 3 mid-small ($50K–$200K) + 1 large ($500K–$2M) → mid-small bucket emitted, large not
  const records = [
    rec('won', 80_000), rec('won', 90_000), rec('lost', 100_000),
    rec('won', 750_000), // only 1 in large bucket
  ];
  const r = bidHistoryFacts(records);
  ok('has overall fact', r.facts.some(f => f.startsWith('Overall')));
  ok('mid-small bucket emitted (3 records)', r.facts.some(f => f.includes('$50K') || f.includes('Mid-small')));
  ok('large bucket NOT emitted (only 1)', !r.facts.some(f => f.includes('$500K') || f.includes('Large')));
}

// ── Test: bidHistoryFactsBlock ──
console.log('\n[6] bidHistoryFactsBlock rendering');
{
  const empty = bidHistoryFacts([]);
  expect('block empty when no facts', bidHistoryFactsBlock(empty), '');

  const records = [rec('won', 100_000), rec('won', 120_000), rec('lost', 150_000)];
  const full = bidHistoryFacts(records);
  const block = bidHistoryFactsBlock(full);
  ok('block non-empty when facts', block.length > 0);
  ok('block starts with YOUR BID WIN HISTORY', block.startsWith('YOUR BID WIN HISTORY'));
  ok('block contains win-rate instruction', block.includes('Derive winProbability'));
}

// ── Summary ──
console.log(`\n${'─'.repeat(40)}`);
console.log(`bid-history-facts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
