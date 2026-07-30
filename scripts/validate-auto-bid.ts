// validate-auto-bid.ts — pins utils/autoBid.ts ("MAGE bids for you").
// Run: bun run scripts/validate-auto-bid.ts
import { buildPricedBids, deriveCostBasis, sizeFit } from '../utils/autoBid';
import type { BidOpportunity, JobHistoryPoint } from '../utils/autoBid';
import type { Lead } from '../types';

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

const NOW = Date.parse('2026-02-01T00:00:00');
const leads = [
  { stage: 'won', lostReason: undefined },
  { stage: 'won', lostReason: undefined },
  { stage: 'lost', lostReason: 'price' },
  { stage: 'lost', lostReason: 'timing' },
] as unknown as Pick<Lead, 'stage' | 'lostReason'>[];

const history: JobHistoryPoint[] = [
  { category: 'kitchen', cost: 40000 },
  { category: 'kitchen', cost: 60000 },
  { category: 'bath', cost: 20000 },
];

const opp = (o: Partial<BidOpportunity>): BidOpportunity =>
  ({ id: 'o1', title: 'Job', ...o } as BidOpportunity);

console.log('\nauto bid (MAGE bids for you):');

// ── cost basis ──
expect('basis your_history when category matches (blended with signalled size)',
  deriveCostBasis(opp({ category: 'kitchen', budgetMin: 50000, budgetMax: 70000 }), history, 0.18).basis,
  'your_history');
expect('basis their_budget when no category history',
  deriveCostBasis(opp({ category: 'roofing', estimatedValue: 118000 }), history, 0.18),
  { cost: 100000, basis: 'their_budget' });
expect('basis none when no signal at all',
  deriveCostBasis(opp({ category: 'roofing' }), history, 0.18),
  { cost: 0, basis: 'none' });
expect('history-only (no signalled value) → median of that category',
  deriveCostBasis(opp({ category: 'kitchen' }), history, 0.18),
  { cost: 50000, basis: 'your_history' });

// ── size fit ──
expect('fit 1.0 at typical job size', sizeFit(40000, history), 1);
ok('fit < 1 for a job 10x typical', sizeFit(400000, history) < 1, `got ${sizeFit(400000, history)}`);
ok('fit never below 0.15', sizeFit(50_000_000, history) >= 0.15);

// ── priced bids ──
const bids = buildPricedBids({
  opportunities: [
    opp({ id: 'big', title: 'Kitchen remodel', category: 'kitchen', budgetMin: 90000, budgetMax: 110000, deadline: '2026-03-01' }),
    opp({ id: 'small', title: 'Bath refresh', category: 'bath', budgetMin: 18000, budgetMax: 22000, deadline: '2026-02-20' }),
    opp({ id: 'nosignal', title: 'Mystery job', category: 'unknown-trade' }),
  ],
  history, leads, nowMs: NOW,
});
expect('unpriceable opportunity skipped', bids.map(b => b.id).includes('nosignal'), false);
expect('two priced bids returned', bids.length, 2);
ok('sorted by score desc', bids[0].score >= bids[1].score);
ok('recommended price exceeds cost (has markup)', bids.every(b => b.recommendedPrice > b.cost));
ok('win probability within 0..1', bids.every(b => b.winProbability >= 0 && b.winProbability <= 1));
ok('drivers explain the price', bids.every(b => Array.isArray(b.drivers)));

// deadline math
const dl = bids.find(b => b.id === 'small');
// Date-only deadlines anchor at noon, so Feb 1 00:00 → Feb 20 12:00 is 19.5d → ceil 20.
expect('daysToDeadline computed (Feb 1 → Feb 20 = 20)', dl?.daysToDeadline, 20);

// past-due excluded by default, included when asked
const pastOpp = [opp({ id: 'old', category: 'kitchen', budgetMax: 100000, deadline: '2026-01-01' })];
expect('past-due excluded by default',
  buildPricedBids({ opportunities: pastOpp, history, leads, nowMs: NOW }).length, 0);
expect('past-due included when excludePastDue=false',
  buildPricedBids({ opportunities: pastOpp, history, leads, nowMs: NOW, excludePastDue: false }).length, 1);

// over-budget flag: tiny budget cap vs our win-optimal price
const over = buildPricedBids({
  opportunities: [opp({ id: 'tight', category: 'kitchen', budgetMin: 40000, budgetMax: 41000, deadline: '2026-03-01' })],
  history, leads, nowMs: NOW,
})[0];
ok('overBudget flags when win-optimal price tops their cap',
  over.overBudget === over.recommendedPrice > 41000, `price=${over.recommendedPrice} cap=41000 flag=${over.overBudget}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
