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
import { computeLivingEstimate } from '../utils/livingEstimate';
import { billFromEstimateLine, billFromEstimateUnitPrice } from '../utils/billFromEstimateCore';
import type { LinkedEstimate, Project, Commitment } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
const round2 = (n: number): number => Math.round(n * 100) / 100;
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

// ── 4. MONEY-F11: an at-cost buyout moves nothing in Living Estimate or Job Costing ──
// The closed sweep (#2) fixed estimateActuals only. Living Estimate's buyout
// driver and Job Costing's "overcommitted" check still compared an at-cost
// commitment against the marked-up lineTotal. Line cost $10,000 at 15%
// (lineTotal $11,500), sub signed at exactly $10,000: pre-fix, TWO fake
// offsetting drivers ("Favorable buyout +$1,500" and "Cost growth −$1,500") on
// a job with zero movement, and a sub at $11,700 (17% over cost) was not
// flagged overcommitted until it passed $11,730.
{
  const est = {
    id: 'est-2',
    items: [{
      materialId: 'm0', name: 'Tile', category: 'Finishes', unit: 'sf',
      quantity: 100, unitPrice: 100, bulkPrice: 100, markup: MARKUP,
      usesBulk: false, lineTotal: 11_500, supplier: 'Acme',
    }],
    globalMarkup: MARKUP, baseTotal: 10_000, markupTotal: 1_500, grandTotal: 11_500,
    createdAt: '2026-01-02T00:00:00.000Z',
  } as unknown as LinkedEstimate;
  const proj = { id: 'p2', name: 'Tile Job', linkedEstimate: est } as unknown as Project;
  // `phase` matches the estimate category so the engine files the commitment
  // against the budget it bought out (an unphased commitment lands in
  // "(Uncategorized)" as an unbudgeted phase — a different, real signal).
  const atCost = [{
    id: 'c3', projectId: 'p2', status: 'signed', phase: 'Finishes',
    amount: 10_000, changeAmount: 0, paidToDate: 0, linkedEstimateItems: ['m0'],
  }] as unknown as Commitment[];

  const living = computeLivingEstimate({ project: proj, changeOrders: [], commitments: atCost, invoices: [] });
  ok('the Living Estimate fixture has a margin basis', living.hasMarginBasis);
  expect('an at-cost buyout produces NO margin drivers', living.drivers.map(d => d.key), []);
  expect('…and the projected margin equals the bid margin', Math.round(living.marginErosionDollars), 0);

  const jc = computeJobCost({ project: proj, commitments: atCost, invoices: [], changeOrders: [] });
  expect('a sub signed AT COST is not overcommitted', jc.overcommittedCommitments.length, 0);

  const over = [{ ...atCost[0], id: 'c4', amount: 11_700 }] as unknown as Commitment[];
  const jcOver = computeJobCost({ project: proj, commitments: over, invoices: [], changeOrders: [] });
  expect('a sub signed 17% over COST is flagged overcommitted (pre-fix threshold was $11,730)',
    jcOver.overcommittedCommitments.map(c => c.id), ['c4']);
}

// ── 5. MONEY-F14: the invoice line bills the CONTRACT quantity at the SELL price ──
// bill-from-estimate kept the pre-markup unit price and inflated the quantity
// so the row footed: 100 sf tile @ $10.00 cost, 15% markup → estimate line
// 100 sf @ $11.50 = $1,150. Billed at 100% it printed "115 sf @ $10.00 =
// $1,150.00", and at 50% "57.5 sf @ $10.00 = $575.00" — the PDF, the portal
// and QBO all showed a quantity 15% above scope.
{
  const row = { quantity: 100, lineTotal: 1_150, fallbackUnitPrice: 10 };
  expect('the billed unit price is the markup-inclusive sell price ($11.50, not $10.00)',
    billFromEstimateUnitPrice(row.lineTotal, row.quantity, row.fallbackUnitPrice), 11.5);
  expect('billing 100% → 100 sf @ $11.50 = $1,150.00',
    billFromEstimateLine({ ...row, billAmount: 1_150 }), { quantity: 100, unitPrice: 11.5, total: 1_150 });
  expect('billing 50% → 50 sf @ $11.50 = $575.00 (was 57.5 sf @ $10.00)',
    billFromEstimateLine({ ...row, billAmount: 575 }), { quantity: 50, unitPrice: 11.5, total: 575 });
  expect('the remaining 50% after a 50% bill → 50 sf again, never the whole scope',
    billFromEstimateLine({ ...row, billAmount: 575 }).quantity, 50);
  ok('quantity × unitPrice foots to the billed total',
    Math.abs(50 * 11.5 - billFromEstimateLine({ ...row, billAmount: 575 }).total) < 0.005);
  ok('the billed quantity can never exceed the contract scope',
    billFromEstimateLine({ ...row, billAmount: 9_999 }).quantity <= row.quantity);
  expect('a quantity-less (lump-sum) line keeps its fallback price and bills no phantom units',
    billFromEstimateLine({ quantity: 0, lineTotal: 1_150, fallbackUnitPrice: 1_150, billAmount: 575 }),
    { quantity: 0, unitPrice: 1_150, total: 575 });
  expect('a $0 line cannot divide by zero',
    billFromEstimateLine({ quantity: 10, lineTotal: 0, fallbackUnitPrice: 0, billAmount: 0 }),
    { quantity: 0, unitPrice: 0, total: 0 });

  // THE FOOT IS THE INVARIANT (review follow-up). Rounding the unit price to
  // cents before multiplying broke it on any sell price that is not cent-exact
  // per unit: 1,000 lf at a $1,234.56 line is $1.23456/lf; at $1.23 the PDF
  // printed 1,000 × $1.23 beside $1,234.56 and QuickBooks (Qty × UnitPrice,
  // verbatim) booked $1,230. Even four decimals ($1.2346) is off by $0.04 here.
  const foots = (l: { quantity: number; unitPrice: number; total: number }) =>
    Math.abs(l.quantity * l.unitPrice - l.total) <= 0.005;
  const lf = { quantity: 1_000, lineTotal: 1_234.56, fallbackUnitPrice: 1.2 };
  const lfFull = billFromEstimateLine({ ...lf, billAmount: 1_234.56 });
  ok('1,000 lf at a $1,234.56 line keeps the unrounded $1.23456/lf',
    Math.abs(lfFull.unitPrice - 1.23456) < 1e-9, `got ${lfFull.unitPrice}`);
  expect('…bills the whole 1,000 lf', lfFull.quantity, 1_000);
  ok('…and 1,000 × unitPrice foots to $1,234.56 within half a cent (not $1,230 or $1,234.60)',
    foots(lfFull), `got ${lfFull.quantity * lfFull.unitPrice}`);
  const lfPart = billFromEstimateLine({ ...lf, billAmount: 500 });
  ok('a $500 partial bill of that line still foots within half a cent',
    foots(lfPart) && lfPart.total === 500, `got ${lfPart.quantity} × ${lfPart.unitPrice} = ${lfPart.quantity * lfPart.unitPrice}`);
  // A 1-unit $5,000 lump sum billed a third: three-decimal quantity rounding
  // (0.333 × $5,000 = $1,665) would miss the $1,666.65 total by $1.65.
  const lump = billFromEstimateLine({ quantity: 1, lineTotal: 5_000, fallbackUnitPrice: 5_000, billAmount: 1_666.65 });
  ok('a lump-sum partial bill foots within half a cent (quantity keeps enough decimals)',
    foots(lump) && lump.unitPrice === 5_000, `got ${lump.quantity} × ${lump.unitPrice} = ${lump.quantity * lump.unitPrice}`);
  expect('the line total is rounded to cents', billFromEstimateLine({ ...row, billAmount: 575.004 }).total, 575);
  expect('…half-cent up', billFromEstimateLine({ ...row, billAmount: 575.006 }).total, 575.01);
  // Sweep: every (unit price, share) combination must foot — the invariant
  // holds by construction, not by luck on the examples above.
  let fails = 0;
  for (const unit of [0.37, 1.23456, 11.5, 99.99, 1_234.5, 25_000]) {
    for (const qty of [1, 7, 100, 1_000]) {
      for (const pct of [7, 33.333, 50, 66.7, 100]) {
        const lineTotal = round2(unit * qty);
        const l = billFromEstimateLine({ quantity: qty, lineTotal, fallbackUnitPrice: unit, billAmount: round2(lineTotal * pct / 100) });
        if (!foots(l) || l.quantity > qty) fails++;
      }
    }
  }
  expect('120 unit-price × quantity × percent combinations all foot within $0.005 and stay within scope', fails, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
