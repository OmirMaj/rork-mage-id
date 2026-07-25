// validate-bid-history-facts.ts — unit tests for bidHistoryFacts.
//
// Pins INTENDED semantics, including the POPULATION RULE corrected by the
// 2026-07 tribunal ("Bid win-probability grounded on the wrong population"):
//   • facts are built ONLY from the GC's OWN outbound bids — today the
//     bid_responses rows THEY submitted, mapped via
//     outboundBidRecordsFromResponses (awarded→won, declined→lost,
//     submitted/shortlisted→pending, withdrawn→excluded). Sub bids INTO the
//     GC's packages (Subcontractor.bidHistory) must never feed this.
//   • empty records → { facts: [], decidedCount: 0, overallWinRate: null }
//   • pending records excluded — they don't count as decided
//   • fewer than 3 decided bids → overallWinRate:null (no fake percentage)
//   • exactly 3 decided → rate emitted
//   • per-size bucket only emitted when ≥ 2 decided bids in that bucket;
//     unknown-amount records (bid_amount null) count overall, never in buckets
//   • bidHistoryFactsBlock returns '' when no facts; when present, its
//     instruction names the EXACT schema field (estimatedWinProbability)
//   • normalizeWinProbability maps percent-scale echoes (44) → 0.44 and
//     rejects garbage to null — never renders "4400%"
//
// Run via: bun scripts/validate-bid-history-facts.ts
import {
  bidHistoryFacts, bidHistoryFactsBlock, normalizeWinProbability,
  outboundBidRecordsFromResponses, type OutboundBidRecord,
} from '../utils/bidHistoryFacts';

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

function rec(outcome: OutboundBidRecord['outcome'], bidAmount: number): OutboundBidRecord {
  return { bidAmount, outcome };
}

// ── Test: population mapping from bid_responses ──
console.log('\n[0] outboundBidRecordsFromResponses population rule');
{
  const rows = [
    { bid_amount: 100_000, status: 'awarded' },     // → won
    { bid_amount: 200_000, status: 'declined' },    // → lost
    { bid_amount: 300_000, status: 'submitted' },   // → pending
    { bid_amount: 150_000, status: 'shortlisted' }, // → pending
    { bid_amount: 400_000, status: 'withdrawn' },   // → excluded entirely
    { bid_amount: null,    status: 'awarded' },     // → won, amount unknown (0)
  ];
  const recs = outboundBidRecordsFromResponses(rows);
  expect('withdrawn excluded → 5 records', recs.length, 5);
  expect('awarded → won', recs[0], { bidAmount: 100_000, outcome: 'won' });
  expect('declined → lost', recs[1], { bidAmount: 200_000, outcome: 'lost' });
  expect('submitted → pending', recs[2].outcome, 'pending');
  expect('shortlisted → pending', recs[3].outcome, 'pending');
  expect('null amount → 0 (kept for overall rate)', recs[4], { bidAmount: 0, outcome: 'won' });
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

// ── Test: unknown-amount records count overall but never in buckets ──
console.log('\n[6] Unknown-amount records');
{
  const records = [
    rec('won', 0), rec('won', 0), rec('lost', 0), // 3 decided, no amounts
  ];
  const r = bidHistoryFacts(records);
  expect('decidedCount = 3', r.decidedCount, 3);
  ok('overall rate computed from amount-less bids', Math.abs((r.overallWinRate ?? 0) - 2/3) < 0.001);
  ok('no size buckets from amount-less bids (would all pool into Small)',
    !r.facts.some(f => f.includes('<$50K') || f.includes('Small')));
}

// ── Test: bidHistoryFactsBlock ──
console.log('\n[7] bidHistoryFactsBlock rendering');
{
  const empty = bidHistoryFacts([]);
  expect('block empty when no facts', bidHistoryFactsBlock(empty), '');

  const records = [rec('won', 100_000), rec('won', 120_000), rec('lost', 150_000)];
  const full = bidHistoryFacts(records);
  const block = bidHistoryFactsBlock(full);
  ok('block non-empty when facts', block.length > 0);
  ok('block starts with YOUR BID WIN HISTORY', block.startsWith('YOUR BID WIN HISTORY'));
  ok('block instruction names the EXACT schema field estimatedWinProbability',
    block.includes('estimatedWinProbability'));
  ok('block never instructs the non-schema field name "winProbability"',
    !/[^d]winProbability/.test(block));
}

// ── Test: normalizeWinProbability scale handling ──
console.log('\n[8] normalizeWinProbability');
{
  expect('0.44 passes through', normalizeWinProbability(0.44), 0.44);
  expect('0 passes through', normalizeWinProbability(0), 0);
  expect('1 passes through', normalizeWinProbability(1), 1);
  expect('44 (percent echo) → 0.44', normalizeWinProbability(44), 0.44);
  expect('100 → 1', normalizeWinProbability(100), 1);
  expect('101 → null (garbage never clamped to confidence)', normalizeWinProbability(101), null);
  expect('-0.2 → null', normalizeWinProbability(-0.2), null);
  expect('null → null', normalizeWinProbability(null), null);
  expect('undefined → null', normalizeWinProbability(undefined), null);
  expect('NaN → null', normalizeWinProbability(NaN), null);
  expect('"44%" (string) → null', normalizeWinProbability('44%'), null);
}

// ── Summary ──
console.log(`\n${'─'.repeat(40)}`);
console.log(`bid-history-facts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
