// validate-estimate-cost-basis.ts — cost is cost; sell is sell.
//
// WHY THIS EXISTS. LinkedEstimateItem carries BOTH figures and they are one
// character apart at the call site:
//
//   unitPrice  — the COST basis, already bulk-aware
//                (app/(tabs)/estimate/full.tsx:932 assigns
//                 `usesBulk ? baseBulkPrice : baseRetailPrice`)
//   lineTotal  — the SELL price
//                (full.tsx:933: `base * (1 + markup / 100) * quantity`)
//
// Two separate money paths reached for lineTotal where they needed cost, and
// both compared it against figures that ARE cost (commitment amounts,
// paidToDate). Neither failed loudly; both just produced a plausible wrong
// number:
//
//   utils/jobCostEngine.ts   seeded the job-cost BUDGET from lineTotal, so
//                            budget === revenue, projectedFinal ===
//                            projectedRevenue, and every job reported $0
//                            projected profit before anything happened. Real
//                            cost erosion was indistinguishable from that
//                            baseline. The same inflated EAC fed the profit
//                            report and the bank-facing WIP row.
//
//   utils/estimateActuals.ts set `bid` from lineTotal, so a line bought out
//                            EXACTLY at cost looked like a win by the markup
//                            percentage. estimateCalibration then computes
//                            `bias = actual / estimated` and suggests a
//                            multiplier below 1.0 — repricing future estimates
//                            BELOW cost, compounding on every accepted
//                            correction. That loop is the product's cost moat.
//
// scripts/validate-job-cost-variance.ts could not catch the first one: every
// fixture it had was built with markup: 0, so cost and sell were the same
// number and the guard was structurally blind. A fixture that cannot tell the
// two apart cannot guard the difference. Everything here carries real markup.
//
// Run via: bun run test:estimate-cost-basis

import { computeJobCost } from '../utils/jobCostEngine';
import { computeEstimateActuals } from '../utils/estimateActuals';
import type { LinkedEstimate, Project, Commitment } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

// $100,000 cost at 15% markup = $115,000 contract.
const MARKUP = 15;
const COST = 100_000;
const SELL = COST * (1 + MARKUP / 100);

function estimate(): LinkedEstimate {
  return {
    id: 'est-1',
    items: [{
      materialId: 'm0', name: 'Framing package', category: 'Framing', unit: 'ls',
      quantity: 4, unitPrice: COST / 4, bulkPrice: COST / 4, markup: MARKUP,
      usesBulk: false, lineTotal: (COST / 4) * (1 + MARKUP / 100) * 4, supplier: 'Acme',
    }],
    globalMarkup: MARKUP, baseTotal: COST, markupTotal: SELL - COST, grandTotal: SELL,
    createdAt: '2026-01-02T00:00:00.000Z',
  } as unknown as LinkedEstimate;
}

const project = { id: 'p1', name: 'Markup Job', linkedEstimate: estimate() } as unknown as Project;

console.log('\nestimate cost basis (cost is not sell):');

// Sanity: the fixture must actually distinguish the two, or nothing below means
// anything. This is the assertion the old job-cost fixtures could not make.
ok('the fixture has a real markup (cost !== sell)', COST !== SELL,
  'a markup:0 fixture cannot guard this invariant at all');

// ── 1. job-cost budget is COST ──────────────────────────────────────────────
{
  const s = computeJobCost({ project, commitments: [], invoices: [], changeOrders: [] });
  expect('job-cost budget is the cost basis', s.budget, COST);
  ok('job-cost budget is NOT the sell price', s.budget !== SELL,
    `budget === ${SELL} means budget === revenue and every job reports $0 profit`);
  expect('per-phase budgets sum to the same basis',
    s.byPhase.reduce((t, l) => t + l.budget, 0), COST);
  expect('budget reconciles with the estimate baseTotal', s.budget, estimate().baseTotal);
}

// ── 2. a buyout AT COST is neither a win nor a loss ─────────────────────────
// The defining case. A sub signed for exactly the estimated cost must show zero
// variance. Under the old code it showed a saving equal to the markup, and the
// calibration loop learned to price down.
{
  const commitments = [{
    id: 'c1', projectId: 'p1', status: 'signed',
    amount: COST, changeAmount: 0, paidToDate: COST,
    linkedEstimateItems: ['m0'],
  }] as unknown as Commitment[];

  const actuals = computeEstimateActuals(project, commitments);
  const line = actuals.lines[0];

  expect('bid is the cost basis, not the marked-up total', line.bid, COST);
  ok('bid is NOT the sell price', line.bid !== SELL,
    'comparing a marked-up bid against at-cost actuals fabricates a saving');
  expect('a buyout at cost shows ZERO variance', Math.round(line.committed - line.bid), 0);

  // This is what estimateCalibration divides. 1.0 means "estimated correctly".
  const bias = line.actual / line.bid;
  expect('calibration bias on an at-cost buyout is 1.0', Math.round(bias * 1000) / 1000, 1);
  ok('bias is NOT the pre-fix 0.87 (which suggests pricing BELOW cost)',
    Math.abs(bias - COST / SELL) > 0.01,
    `pre-fix bias was ${(COST / SELL).toFixed(3)}, which drives a x0.87 multiplier`);
}

// ── 3. a genuine overrun still reads as an overrun ──────────────────────────
// The fix must not mute real signal — only remove the fabricated one.
{
  const over = [{
    id: 'c2', projectId: 'p1', status: 'signed',
    amount: COST * 1.2, changeAmount: 0, paidToDate: COST * 1.2,
    linkedEstimateItems: ['m0'],
  }] as unknown as Commitment[];
  const line = computeEstimateActuals(project, over).lines[0];
  ok('a 20% overrun still reports positive variance', line.committed - line.bid > 0);
  expect('and its bias is 1.2', Math.round((line.actual / line.bid) * 100) / 100, 1.2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
