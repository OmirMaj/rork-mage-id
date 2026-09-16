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
import {
  buildQuickLinkedEstimate, priceCostBreakdown, isAtCost, marginOf,
  markupForMargin, estimateMarginPct, cartTotals, applyMarkupToItems,
  isMarkupSet, markupFactor, markupDecidedFromStorage,
} from '../utils/estimateMarkup';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { billFromEstimateLine, billFromEstimateUnitPrice } from '../utils/billFromEstimateCore';
import type { LinkedEstimate, Project, Commitment } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with comments dropped — this file's structural checks are about the
 *  arithmetic a screen ships, not the arithmetic its comments describe. */
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

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

// ── 6. THE COST-LEARNING LOOP ───────────────────────────────────────────────
//
// Everything above is about one estimate. This section is about what the book
// LEARNS from a finished one, which is where the same cost-vs-sell class and
// three of its cousins were still live:
//
//   • computeEstimateConfidence divided lineTotal (SELL) by quantity and
//     compared it to a learned rate that is pure COST. With the cart's 15%
//     default markup and DEVIATION_THRESHOLD at 0.1, EVERY cart-built line
//     with history was flagged 'overpriced' and the estimate scored 0, while a
//     line priced 17% BELOW cost scored 100 — "Well-backed estimate" over a
//     bid that loses money on every unit. Third instance of the class 96d3a295
//     fixed in estimateActuals and jobCostEngine.
//   • `hasActual` is literally `actual > 0` and the book preferred it over the
//     contract sum with no proximity test, so ONE mobilization deposit taught
//     a tenth of the real rate and the screen said so in green.
//   • an approved sub change order put its dollars over the ORIGINAL bid
//     quantity, so buying more scope at the RIGHT price read as a 40% price
//     rise (the SCOPE confound utils/varianceDecomposition names).
//   • a package buyout split across lines reproduces the estimator's own guess
//     times one scalar — the quantity cancels algebraically.
//
// Every fixture here carries a real markup for the same reason the header
// gives: a markup:0 fixture is structurally blind to half of this.
{
  const { buildCostDatabase, lookupRate } = await import('../utils/costDatabase');
  const { computeEstimateConfidence } = await import('../utils/estimateConfidence');
  const { computeCalibration } = await import('../utils/estimateCalibration');
  const { applyCalibrationToEstimate } = await import('../utils/applyCalibration');
  const { SETTLED_PAYMENT_RATIO } = await import('../utils/estimateActuals');

  const mkEstimate = (over: Record<string, unknown>[]): LinkedEstimate => {
    const items = over.map((o, n) => ({
      materialId: `m${n}`, name: 'Line', category: 'Other', unit: 'SF', quantity: 1,
      unitPrice: 1, bulkPrice: 1, markup: 0, usesBulk: false, lineTotal: 1, supplier: '', ...o,
    }));
    return {
      id: 'e', items, globalMarkup: 0,
      baseTotal: items.reduce((s, i) => s + (i.unitPrice as number) * (i.quantity as number), 0),
      markupTotal: 0,
      grandTotal: items.reduce((s, i) => s + (i.lineTotal as number), 0),
      createdAt: '2026-01-02T00:00:00.000Z',
    } as unknown as LinkedEstimate;
  };
  const closedJob = (id: string, e: LinkedEstimate, closedAt = '2026-01-10') =>
    ({ id, name: id, status: 'completed', closedAt, linkedEstimate: e } as unknown as Project);
  const commitment = (o: Record<string, unknown>) =>
    ({ id: 'c', projectId: 'p', status: 'signed', amount: 0, changeAmount: 0, paidToDate: 0, linkedEstimateItems: [], ...o } as unknown as Commitment);

  // ── 6a. Estimate Confidence scores COST against COST ──────────────────────
  // A 4-job drywall book measuring exactly $2.00/SF.
  const drywallBook = buildCostDatabase([], [], [], [1, 2, 3, 4].map(i => ({
    projectId: `d${i}`, projectName: `Job ${i}`, trade: 'Drywall', unit: 'SF',
    quantity: 1000, bidUnit: 2, actualUnit: 2, basis: 'actual' as const, closedAt: `2026-01-0${i}`,
  })), []);
  const priced = (cost: number, mk = 20) => ({
    id: 'bid', name: 'Bid', linkedEstimate: mkEstimate([{
      materialId: 'm0', name: 'Board', category: 'Drywall', unit: 'SF', quantity: 1000,
      unitPrice: cost, bulkPrice: cost, markup: mk, usesBulk: false, lineTotal: cost * (1 + mk / 100) * 1000,
    }]),
  } as unknown as Project);

  const atCost = computeEstimateConfidence(priced(2), drywallBook);
  expect('a line priced AT the learned cost reads its unit as cost, not sell', atCost.lines[0].bidUnit, 2);
  expect('…so it is aligned, not "overpriced"', atCost.lines[0].flag, 'aligned');
  expect('…and the estimate scores 100, not 0', atCost.score, 100);

  const belowCost = computeEstimateConfidence(priced(2 / 1.2), drywallBook);
  expect('a line priced 17% BELOW cost is flagged underpriced', belowCost.lines[0].flag, 'underpriced');
  expect('…and scores 0 — the screen no longer rewards bidding under cost', belowCost.score, 0);
  ok('…and its exposure is reported as margin risk',
    belowCost.underpricedExposure > 0 && belowCost.underpricedCount === 1);

  // The markup must not be able to move the verdict at all.
  const flags = [0, 10, 15, 18, 20, 35].map(m => computeEstimateConfidence(priced(2, m), drywallBook).lines[0].flag);
  expect('the flag is identical at every markup from 0% to 35%', new Set(flags).size, 1);
  // A bulk-priced line reads the BULK cost, which is the basis full.tsx uses.
  const bulk = computeEstimateConfidence({
    id: 'b', name: 'B', linkedEstimate: mkEstimate([{
      materialId: 'm0', name: 'Board', category: 'Drywall', unit: 'SF', quantity: 1000,
      unitPrice: 9, bulkPrice: 2, markup: 20, usesBulk: true, lineTotal: 2 * 1.2 * 1000,
    }]),
  } as unknown as Project, drywallBook);
  expect('a usesBulk line is scored on bulkPrice, not unitPrice', bulk.lines[0].bidUnit, 2);

  // ── 6b. A partial payment is not a completed cost ─────────────────────────
  const roofEst = mkEstimate([{ materialId: 'm0', name: 'Roof', category: 'Roofing', unit: 'SQ', quantity: 30, unitPrice: 400, bulkPrice: 400, markup: MARKUP, lineTotal: 400 * (1 + MARKUP / 100) * 30 }]);
  const roofJob = closedJob('p-roof', roofEst);
  const roofBook = (paid: number) => buildCostDatabase([roofJob], [commitment({ id: 'cr', projectId: 'p-roof', amount: 12_000, paidToDate: paid, linkedEstimateItems: ['m0'] })]);

  const deposit = lookupRate(roofBook(1_200), 'Roofing', 'SQ')!;
  expect('a 10% mobilization deposit does NOT become the learned rate', deposit.personalRate, 400);
  expect('…the sample is labelled signed, never "paid"', deposit.samples[0].basis, 'committed');
  expect('…bid bias reports no error, because there is none', deposit.bidBias, 0);
  expect('…and the headline Bid-accuracy KPI is not 10%', roofBook(1_200).overallBidAccuracy, 1);
  ok('…which is what it read before: a 10x error shown in green as good news',
    Math.abs((1_200 / 30) - 40) < 0.001);
  const settledBook = roofBook(12_000);
  const settled = lookupRate(settledBook, 'Roofing', 'SQ')!;
  expect('a SETTLED payment is still learned as paid', settled.samples[0].basis, 'actual');
  expect('…and still teaches the right number', settled.personalRate, 400);
  const retained = lookupRate(roofBook(10_800), 'Roofing', 'SQ')!;
  expect('10% retention outstanding falls back to the contract sum', retained.personalRate, 400);
  ok('the settled threshold is a documented judgement call, not a standard',
    SETTLED_PAYMENT_RATIO > 0.5 && SETTLED_PAYMENT_RATIO < 1);

  // …AND THE DOOR THE THRESHOLD LEFT OPEN. `settled` used to read
  // `committed > 0 ? actual >= committed * RATIO : actual > 0`, on the
  // reasoning that a payment with nothing committed has no contract sum to be
  // measured against and so stands on its own. But every dollar of `actual`
  // in this module comes from a commitment's paidToDate — there is no other
  // source — so committed <= 0 never means "an untracked direct expense". It
  // means the commitment's amount is blank, or a deductive change order
  // cancelled it out. The same $1,200 deposit on the same 30 SQ roof, filed
  // against an amount-less commitment, therefore came back at $40/SQ, basis
  // 'actual', bidBias -0.90, KPI 10% — byte-identical to the bug above,
  // through the one door it left open.
  const zeroSumBook = buildCostDatabase([roofJob], [commitment({ id: 'cz', projectId: 'p-roof', amount: 0, paidToDate: 1_200, linkedEstimateItems: ['m0'] })]);
  expect('a payment against a commitment with NO contract sum is not a settled cost',
    computeEstimateActuals(roofJob, [commitment({ id: 'cz', projectId: 'p-roof', amount: 0, paidToDate: 1_200, linkedEstimateItems: ['m0'] })]).lines[0].settled,
    false);
  expect('…so it teaches no rate at all (it taught $40/SQ against a $400 bid)',
    lookupRate(zeroSumBook, 'Roofing', 'SQ'), null);
  expect('…and cannot drag the headline Bid-accuracy KPI to 10%',
    zeroSumBook.overallBidAccuracy, null);
  // A deductive change order that cancels the whole commitment is the same
  // shape reached from the other side, and must land the same way.
  const deductiveBook = buildCostDatabase([roofJob], [commitment({ id: 'cdd', projectId: 'p-roof', amount: 12_000, changeAmount: -12_000, paidToDate: 1_200, linkedEstimateItems: ['m0'] })]);
  expect('a commitment zeroed out by a deductive change order teaches nothing either',
    lookupRate(deductiveBook, 'Roofing', 'SQ'), null);
  // And the control: this must not have quietly deleted the normal path.
  expect('a signed commitment with a real sum still teaches, paid or not',
    [lookupRate(roofBook(0), 'Roofing', 'SQ')?.personalRate, lookupRate(roofBook(12_000), 'Roofing', 'SQ')?.personalRate],
    [400, 400]);

  // ── 6c. A change order is scope, not price ────────────────────────────────
  const paintEst = mkEstimate([{ materialId: 'm0', name: 'Paint', category: 'Painting', unit: 'SF', quantity: 5_000, unitPrice: 2, bulkPrice: 2, markup: MARKUP, lineTotal: 2 * (1 + MARKUP / 100) * 5_000 }]);
  const paintJob = closedJob('p-paint', paintEst);
  const coBook = buildCostDatabase([paintJob], [commitment({ id: 'cp', projectId: 'p-paint', amount: 10_000, changeAmount: 4_000, paidToDate: 14_000, linkedEstimateItems: ['m0'] })]);
  expect('a change-order-bearing line teaches NO rate (it was $2.80/SF against a true $2.00)',
    lookupRate(coBook, 'Painting', 'SF'), null);
  const coRow = (coBook.entriesAwaitingEvidence ?? []).find(e => e.trade === 'Painting');
  ok('…but the job is still shown, with the reason', !!coRow && coRow.samples[0].excludedReason === 'change_order');
  expect('…and nothing quotes a $0.00 rate', coBook.entries.filter(e => e.personalRate <= 0).length, 0);

  // ── 6d. A package price carries no unit rate ──────────────────────────────
  const pkgEst = mkEstimate([
    { materialId: 'm0', name: 'Walls', category: 'Framing', unit: 'SF', quantity: 1_000, unitPrice: 5, bulkPrice: 5, markup: MARKUP, lineTotal: 5 * (1 + MARKUP / 100) * 1_000 },
    { materialId: 'm1', name: 'Roof', category: 'Framing', unit: 'SF', quantity: 500, unitPrice: 12, bulkPrice: 12, markup: MARKUP, lineTotal: 12 * (1 + MARKUP / 100) * 500 },
  ]);
  const pkgJob = closedJob('p-pkg', pkgEst);
  const pkgCommit = [commitment({ id: 'cg', projectId: 'p-pkg', amount: 13_200, paidToDate: 13_200, linkedEstimateItems: ['m0', 'm1'] })];
  const pkgLines = computeEstimateActuals(pkgJob, pkgCommit).lines;
  const ratios = pkgLines.map(l => (l.actualUnit! / l.bidUnit!).toFixed(6));
  expect('both lines of a package buyout come back at the SAME ratio — the quantity cancels',
    new Set(ratios).size, 1);
  ok('…so both are stamped fromSharedCommitment', pkgLines.every(l => l.fromSharedCommitment));
  const pkgBook = buildCostDatabase([pkgJob], pkgCommit);
  expect('a package allocation teaches no unit rate (it was $8.80/SF ±45%, all of it invented)',
    lookupRate(pkgBook, 'Framing', 'SF'), null);
  expect('…and the variability it used to publish is gone with it',
    (pkgBook.entriesAwaitingEvidence ?? [])[0]?.samples[0].excludedReason, 'package_allocation');
  // A single-line commitment is NOT a package and must still teach.
  const soloEst = mkEstimate([{ materialId: 'm0', name: 'Walls', category: 'Framing', unit: 'SF', quantity: 1_000, unitPrice: 5, bulkPrice: 5, markup: MARKUP, lineTotal: 5 * (1 + MARKUP / 100) * 1_000 }]);
  const soloBook = buildCostDatabase([closedJob('p-solo', soloEst)], [commitment({ id: 'cs', projectId: 'p-solo', amount: 6_000, paidToDate: 6_000, linkedEstimateItems: ['m0'] })]);
  expect('a one-line buyout still learns its rate', lookupRate(soloBook, 'Framing', 'SF')?.personalRate, 6);

  // ── 6e. Calibration measures FINISHED work only ───────────────────────────
  const tileEst = mkEstimate([{ materialId: 'm0', name: 'Tile', category: 'Tile', unit: 'SF', quantity: 100, unitPrice: 100, bulkPrice: 100, markup: MARKUP, lineTotal: 100 * (1 + MARKUP / 100) * 100 }]);
  const liveJob = { id: 'p-live', name: 'Live', status: 'in_progress', linkedEstimate: tileEst } as unknown as Project;
  const part = [commitment({ id: 'cl', projectId: 'p-live', amount: 10_000, paidToDate: 3_000, linkedEstimateItems: ['m0'] })];
  const liveCal = computeCalibration({ projects: [liveJob], commitments: part });
  expect('an in-progress job proves NOTHING about estimating bias', liveCal.hasData, false);
  ok('…it used to say "You over-estimate Tile by 70% — Suggested correction: ×0.80"',
    liveCal.categories.length === 0);
  const doneJob = closedJob('p-done', tileEst);
  const overrun = [commitment({ id: 'cd', projectId: 'p-done', amount: 12_000, paidToDate: 12_000, linkedEstimateItems: ['m0'] })];
  const doneCal = computeCalibration({ projects: [doneJob], commitments: overrun });
  expect('a CLOSED, settled job still calibrates — real signal is not muted', doneCal.hasData, true);
  expect('…at the right bias', round2(doneCal.categories[0].bias), 1.2);
  expect('a closed job with only a deposit paid proves nothing either',
    computeCalibration({ projects: [doneJob], commitments: [commitment({ id: 'cx', projectId: 'p-done', amount: 12_000, paidToDate: 1_200, linkedEstimateItems: ['m0'] })] }).hasData, false);
  expect('…and neither does a settled job whose overrun was bought by a change order',
    computeCalibration({ projects: [doneJob], commitments: [commitment({ id: 'cy', projectId: 'p-done', amount: 10_000, changeAmount: 4_000, paidToDate: 14_000, linkedEstimateItems: ['m0'] })] }).hasData, false);
  // And the book and the calibrator must answer from the SAME population.
  expect('the price book agrees: an in-progress job is not in it',
    buildCostDatabase([liveJob], part).entries.length, 0);
  // THE STATUS FILTER, PINNED ON ITS OWN. Every assertion above is satisfied
  // by the `settled` gate alone — deleting `if (!isClosedProject(project))
  // continue;` from computeCalibration left this whole file green while a LIVE
  // job started producing corrections again. The distinguishing fixture is an
  // in-progress job whose sub is fully bought out and FULLY PAID: settled is
  // true, so only the status filter can stop it.
  const liveSettled = [commitment({ id: 'cls', projectId: 'p-live', amount: 14_000, paidToDate: 14_000, linkedEstimateItems: ['m0'] })];
  ok('an in-progress job with a FULLY PAID sub still proves nothing — it is not finished',
    computeCalibration({ projects: [liveJob], commitments: liveSettled }).hasData === false,
    JSON.stringify(computeCalibration({ projects: [liveJob], commitments: liveSettled }).categories.map(c => `${c.category} x${c.suggestedMultiplier}`)));
  expect('…while the SAME numbers on a closed job do calibrate (so the fixture is live, not inert)',
    round2(computeCalibration({
      projects: [closedJob('p-live', tileEst)],
      commitments: [commitment({ id: 'cls', projectId: 'p-live', amount: 14_000, paidToDate: 14_000, linkedEstimateItems: ['m0'] })],
    }).categories[0]?.bias ?? 0), 1.4);
  expect('…and the price book refuses the live job on the same grounds',
    buildCostDatabase([liveJob], liveSettled).entries.length, 0);

  // ── 6f. The prior is the most recent bid, not the first in the array ──────
  const cyJob = (id: string, closedAt: string, bid: number, actual: number) => ({
    p: closedJob(id, mkEstimate([{ materialId: 'm0', name: 'Slab', category: 'Concrete', unit: 'CY', quantity: 100, unitPrice: bid, bulkPrice: bid, markup: MARKUP, lineTotal: bid * (1 + MARKUP / 100) * 100 }]), closedAt),
    c: commitment({ id: `c-${id}`, projectId: id, amount: actual * 100, paidToDate: actual * 100, linkedEstimateItems: ['m0'] }),
  });
  const j2019 = cyJob('j2019', '2019-06-01', 100, 100);
  const j2026 = cyJob('j2026', '2026-06-01', 200, 200);
  const orderA = lookupRate(buildCostDatabase([j2019.p, j2026.p], [j2019.c, j2026.c]), 'Concrete', 'CY')!;
  const orderB = lookupRate(buildCostDatabase([j2026.p, j2019.p], [j2026.c, j2019.c]), 'Concrete', 'CY')!;
  expect('the baseline is the 2026 bid whichever order the projects arrive in',
    [orderA.baseline, orderB.baseline], [200, 200]);
  expect('…so the suggested rate is stable (it was $120 one way and $180 the other)',
    [round2(orderA.suggestedRate), round2(orderB.suggestedRate)], [180, 180]);
  expect('lastSeen reports the newest measured sample', orderA.lastSeen, '2026-06-01');

  // …AND FOR THE JOBS THAT CARRY NO CLOSEOUT DATE AT ALL. The fixture above
  // sets project.closedAt, which is the ONE path where the sort had something
  // to sort on. A GC who closes a job by advancing the lifecycle stage
  // (app/project-detail.tsx: `updateProject(id, { status: STAGE_TO_STATUS[stage] })`)
  // gets status 'completed' and no date, every sample got closedAt '', and the
  // baseline fell straight back to array order: $200/$180 one way, $100/$120
  // the other — the exact defect, still live, with the guard green.
  const cyJobNoDate = (id: string, updatedAt: string, bid: number, actual: number) => ({
    p: {
      id, name: id, status: 'completed', updatedAt,
      linkedEstimate: mkEstimate([{ materialId: 'm0', name: 'Slab', category: 'Concrete', unit: 'CY', quantity: 100, unitPrice: bid, bulkPrice: bid, markup: MARKUP, lineTotal: bid * (1 + MARKUP / 100) * 100 }]),
    } as unknown as Project,
    c: commitment({ id: `c-${id}`, projectId: id, amount: actual * 100, paidToDate: actual * 100, linkedEstimateItems: ['m0'] }),
  });
  const n2019 = cyJobNoDate('n2019', '2019-06-01T00:00:00.000Z', 100, 100);
  const n2026 = cyJobNoDate('n2026', '2026-06-01T00:00:00.000Z', 200, 200);
  const noDateA = lookupRate(buildCostDatabase([n2019.p, n2026.p], [n2019.c, n2026.c]), 'Concrete', 'CY')!;
  const noDateB = lookupRate(buildCostDatabase([n2026.p, n2019.p], [n2026.c, n2019.c]), 'Concrete', 'CY')!;
  expect('a closed job with no closeout date still orders by a real date, both ways',
    [noDateA.baseline, noDateB.baseline], [200, 200]);
  expect('…so its suggested rate is stable too', [round2(noDateA.suggestedRate), round2(noDateB.suggestedRate)], [180, 180]);
  // …BUT "Last measured" MUST STAY BLANK FOR THEM. The sort's third fallback
  // is project.updatedAt, and ProjectContext.updateProject stamps
  // `updatedAt: new Date().toISOString()` on EVERY write — so the date these
  // books sort on is "last touched", not "last measured". This assertion used
  // to demand the opposite ("it can finally render"), which PINNED a 2019 job
  // into reporting "Last measured <this month>": a row added to disclose
  // staleness, asserting freshness. Ordering by a real-but-wrong date is fine;
  // printing it is not. `measuredAt` carries only a genuine closeout date.
  expect('a closed job with NO closeout date reports no measurement date at all',
    noDateA.lastSeen, '');
  expect('…both ways round, so it is not an ordering artefact', noDateB.lastSeen, '');
  ok('…while the sort still used the real date (the baseline above proves it)',
    noDateA.baseline === 200);
  // …and a job that DOES carry a closeout date still reports it, so the fix is
  // "only attest what we can", not "never attest".
  expect('a job with a real closeout date still reports it', orderA.lastSeen, '2026-06-01');
  // MIXED: one dated 2019 job and one undated job. The undated one sorts first
  // (updatedAt = a 2026 stamp) and has nothing to attest, so the row falls
  // through to the newest date we CAN vouch for rather than claiming this
  // month. Understating age is the safe direction; overstating freshness is
  // the one that gets a four-year-old rate trusted.
  const mixedDate = lookupRate(
    buildCostDatabase([j2019.p, n2026.p], [j2019.c, n2026.c]), 'Concrete', 'CY')!;
  expect('a book mixing a dated and an undated job reports the dated one, never today',
    mixedDate.lastSeen, '2019-06-01');

  // …AND WHEN TWO JOBS CLOSED ON THE SAME DAY. The comparator returned -1 for
  // EQUAL keys, which is not an ordering: `a before b` AND `b before a`, so a
  // same-day pair reproduced the $200-vs-$100 flip with both dates present.
  const tieA = cyJob('tie-a', '2024-06-01', 100, 100);
  const tieB = cyJob('tie-b', '2024-06-01', 200, 200);
  expect('two jobs closed on the SAME DAY give one answer, not two',
    [
      lookupRate(buildCostDatabase([tieA.p, tieB.p], [tieA.c, tieB.c]), 'Concrete', 'CY')!.baseline,
      lookupRate(buildCostDatabase([tieB.p, tieA.p], [tieB.c, tieA.c]), 'Concrete', 'CY')!.baseline,
    ],
    [100, 100]);

  // ── 6g. A correction is idempotent against the estimate it corrected ──────
  const calEst = mkEstimate([{ materialId: 'm0', name: 'Tile', category: 'Tile', unit: 'SF', quantity: 100, unitPrice: 10, bulkPrice: 10, markup: MARKUP, lineTotal: 10 * (1 + MARKUP / 100) * 100 }]);
  const corr = [{ category: 'Tile', multiplier: 1.2, appliedAt: '2026-01-02T00:00:00.000Z' }] as never[];
  const totals: number[] = [];
  let cur = calEst;
  for (let i = 0; i < 3; i++) { const r = applyCalibrationToEstimate(cur, corr); cur = r.estimate; totals.push(round2(r.newGrandTotal)); }
  expect('applying the same correction three times changes the price ONCE (was 1440→1728→2073.6)',
    new Set(totals).size, 1);
  expect('…and the repeat reports itself as already applied, not as "nothing matched"',
    applyCalibrationToEstimate(cur, corr).alreadyApplied, true);
  const different = applyCalibrationToEstimate(cur, [{ category: 'Tile', multiplier: 1.3, appliedAt: 'x' }] as never[]);
  expect('a genuinely different correction still applies on top', different.changedCount, 1);
  ok('…and the corrected estimate stays internally consistent (Σ lineTotal === grandTotal)',
    Math.abs(different.estimate.items.reduce((s, i) => s + i.lineTotal, 0) - different.estimate.grandTotal) < 0.005);

  // A CORRECTION IS IDEMPOTENT PER CATEGORY, NOT PER SET.
  //
  // The first fix stamped a fingerprint of the whole correction SET, so it
  // only blocked a byte-identical replay. The assertions above could not see
  // that, because they replay the same set. Closing ONE more job is enough to
  // change the set — and every already-corrected category was then multiplied
  // again: [Tile ×1.2] took Tile to $12; adding a Painting correction took the
  // same Tile line to $14.40 while reporting alreadyApplied false.
  const twoCat = mkEstimate([
    { materialId: 'm0', name: 'Tile', category: 'Tile', unit: 'SF', quantity: 100, unitPrice: 10, bulkPrice: 10, markup: MARKUP, lineTotal: 10 * (1 + MARKUP / 100) * 100 },
    { materialId: 'm1', name: 'Paint', category: 'Painting', unit: 'SF', quantity: 100, unitPrice: 5, bulkPrice: 5, markup: MARKUP, lineTotal: 5 * (1 + MARKUP / 100) * 100 },
  ]);
  const step1 = applyCalibrationToEstimate(twoCat, [{ category: 'Tile', multiplier: 1.2, appliedAt: 'x' }] as never[]);
  expect('Tile takes its correction', round2(step1.estimate.items[0].unitPrice), 12);
  const step2 = applyCalibrationToEstimate(step1.estimate, [
    { category: 'Tile', multiplier: 1.2, appliedAt: 'x' },
    { category: 'Painting', multiplier: 1.1, appliedAt: 'x' },
  ] as never[]);
  expect('a NEW category joining the set does not re-multiply the old one (Tile was $14.40)',
    round2(step2.estimate.items[0].unitPrice), 12);
  expect('…while the new category is applied exactly once', round2(step2.estimate.items[1].unitPrice), 5.5);
  expect('…and only that one line is reported as changed', step2.changedCount, 1);
  ok('…with the grand total matching Σ lineTotal after the partial apply',
    Math.abs(step2.estimate.items.reduce((s, i) => s + i.lineTotal, 0) - step2.estimate.grandTotal) < 0.005);
  // A REFINED factor applies only the residual.
  const refined = applyCalibrationToEstimate(step1.estimate, [{ category: 'Tile', multiplier: 1.25, appliedAt: 'x' }] as never[]);
  expect('refining ×1.20 to ×1.25 lands on 1.25× the ORIGINAL price, not 1.5× (it was $15.00)',
    round2(refined.estimate.items[0].unitPrice), 12.5);
  // THE SEQUENCE THAT SURVIVED THE FIRST TWO FIXES. `corrections` is recomputed
  // from the cost book by useEstimateCalibration on every visit, so the
  // multiplier for a category MOVES as jobs close — and both earlier versions
  // of this module only blocked a factor identical to the last one. Apply
  // ×1.2, then ×1.1, then ×1.2 again, and a $1,200 Tile estimate landed on
  // $1,900.80 with alreadyApplied false and changedCount 1: a screen the GC
  // simply revisited had inflated his own bid by 58%. Every step is a
  // multiple of the ORIGINAL, never of the last result.
  const seqEst = mkEstimate([{ materialId: 'm0', name: 'Tile', category: 'Tile', unit: 'SF', quantity: 100, unitPrice: 10, bulkPrice: 10, markup: 20, lineTotal: 12 * 100 }]);
  const seqTotals: number[] = [];
  let seqCur = seqEst;
  for (const m of [1.2, 1.1, 1.2]) {
    const r = applyCalibrationToEstimate(seqCur, [{ category: 'Tile', multiplier: m, appliedAt: 'x' }] as never[]);
    seqCur = r.estimate;
    seqTotals.push(round2(r.newGrandTotal));
  }
  expect('a MOVING correction re-prices from the original each time (it compounded to $1,900.80)',
    seqTotals, [1440, 1320, 1440]);
  ok('…and specifically never reaches the compounded number',
    !seqTotals.includes(1900.8), JSON.stringify(seqTotals));
  expect('…and refining again to the same 1.25 is a no-op',
    applyCalibrationToEstimate(refined.estimate, [{ category: 'Tile', multiplier: 1.25, appliedAt: 'x' }] as never[]).changedCount, 0);
  // A correction for a category this estimate does not contain must not be
  // recorded as applied — the line could be added tomorrow.
  const absent = applyCalibrationToEstimate(step1.estimate, [
    { category: 'Tile', multiplier: 1.2, appliedAt: 'x' },
    { category: 'Roofing', multiplier: 1.3, appliedAt: 'x' },
  ] as never[]);
  expect('a correction that matches no line changes nothing…', absent.changedCount, 0);
  ok('…and is not silently banked as applied',
    !((absent.estimate as unknown as { calibrationApplied?: Record<string, number> }).calibrationApplied ?? {}).roofing);

  // ── 6h. Self-perform: the book learns the trade, not just hours and lumber ─
  const spEst = mkEstimate([{ materialId: 'm0', name: 'Framing', category: 'Framing', unit: 'SF', quantity: 2_400, unitPrice: 4, bulkPrice: 4, markup: MARKUP, lineTotal: 4 * (1 + MARKUP / 100) * 2_400 }]);
  const spJob = closedJob('p-sp', spEst);
  const spLabor = [{
    projectId: 'p-sp', projectName: 'p-sp', trade: 'Labor — Framing', unit: 'hour',
    quantity: 80, bidUnit: 0, actualUnit: 65, basis: 'actual' as const, closedAt: '2026-01-10',
    source: 'labor_rate' as const,
  }];
  const spReceipt = {
    id: 'r', projectId: 'p-sp', vendor: 'Lumber', receiptDate: '2026-01-06',
    createdAt: '2026-01-06T00:00:00.000Z', status: 'reviewed',
    lines: [{ id: 'l', description: '2x6', category: 'Framing', quantity: 900, unit: 'ea', unitPrice: 6.2, lineTotal: 5_580 }],
  } as never;
  const spBook = buildCostDatabase([spJob], [], [spReceipt], spLabor);
  const spRate = lookupRate(spBook, 'Framing', 'SF');
  ok('a self-performed trade now has a rate at all (it was null)', !!spRate);
  expect('…and it is ($5,200 labor + $5,580 material) / 2,400 SF',
    round2(spRate?.personalRate ?? 0), round2((80 * 65 + 5_580) / 2_400));
  expect('…stamped with its own basis, never "paid to a sub"',
    spRate?.samples[0].basis ?? 'none', 'self_perform');
  // A trade that was SUBBED must not absorb crew hours that belong elsewhere.
  const mixedJob = closedJob('p-mix', mkEstimate([
    { materialId: 'm0', name: 'Framing', category: 'Framing', unit: 'SF', quantity: 2_400, unitPrice: 4, bulkPrice: 4, markup: MARKUP, lineTotal: 4 * (1 + MARKUP / 100) * 2_400 },
  ]));
  const mixedBook = buildCostDatabase([mixedJob], [commitment({ id: 'cm', projectId: 'p-mix', amount: 9_600, paidToDate: 9_600, linkedEstimateItems: ['m0'] })], [spReceipt], [{ ...spLabor[0], projectId: 'p-mix', projectName: 'p-mix' }]);
  expect('a subbed framing line still learns the SUB price, not sub+crew+lumber',
    lookupRate(mixedBook, 'Framing', 'SF')?.personalRate, 4);
  // …AND THE FIXTURE THAT ACTUALLY EXERCISES THE SKIP. The one above has no
  // self-performed line at all, so `if (subbedTrades.has(tradeKey)) continue;`
  // is never reached: deleting that line left this file green. The trade has
  // to be PART subbed and PART self-performed, which is the real job — one
  // framing scope bought out, another swung by the crew.
  const partSubJob = closedJob('p-part', mkEstimate([
    { materialId: 'm0', name: 'Framing (sub)', category: 'Framing', unit: 'SF', quantity: 1_000, unitPrice: 4, bulkPrice: 4, markup: MARKUP, lineTotal: 4 * (1 + MARKUP / 100) * 1_000 },
    { materialId: 'm1', name: 'Framing (crew)', category: 'Framing', unit: 'SF', quantity: 2_400, unitPrice: 4, bulkPrice: 4, markup: MARKUP, lineTotal: 4 * (1 + MARKUP / 100) * 2_400 },
  ]));
  const partSubBook = buildCostDatabase(
    [partSubJob],
    [commitment({ id: 'cps', projectId: 'p-part', amount: 4_000, paidToDate: 4_000, linkedEstimateItems: ['m0'] })],
    [{ ...(spReceipt as unknown as Record<string, unknown>), projectId: 'p-part' } as never],
    [{ ...spLabor[0], projectId: 'p-part', projectName: 'p-part' }],
  );
  expect('a PART-subbed trade learns the sub price only — crew hours are not absorbed into it (it was $4.35)',
    lookupRate(partSubBook, 'Framing', 'SF')?.personalRate, 4);
  expect('…from exactly one sample, the signed sub', lookupRate(partSubBook, 'Framing', 'SF')?.samples.filter(s => !s.excludedFromRate).length, 1);
  ok('…and no self-perform sample was emitted for it at all',
    (lookupRate(partSubBook, 'Framing', 'SF')?.samples ?? []).every(s => s.basis !== 'self_perform'));

  // …AND THE COLLISION THE 'ea' LUMBER FIXTURE ABOVE DODGES. §6h prices its
  // receipt in 'ea' against an SF scope, so the material sample and the
  // installed rate land in DIFFERENT book rows and never meet. Give the
  // receipt the SAME unit as the scope — the ordinary case for drywall,
  // sheathing, flooring, siding and roofing — and they land in the same row,
  // where the engine quantity-averaged a total with one of its own parts:
  // 2,000 SF of drywall costing $2,600 of crew time plus $1,000 of board is
  // $1.80/SF installed, and the book learned $1.15 with a manufactured ±57%
  // band, stamped 'earned'/'paid', jobCount 1 — i.e. through the
  // cross-contractor publish gate. 36% low is the direction that makes a
  // correctly-priced bid look padded, exactly like the deposit blocker.
  // The derivation's own BOTH-STREAMS rule makes a matching-category receipt
  // MANDATORY, so this raises the odds of the collision rather than lowering
  // them.
  const dwEst = mkEstimate([{ materialId: 'm0', name: 'Hang + finish', category: 'Drywall', unit: 'SF', quantity: 2_000, unitPrice: 1.8, bulkPrice: 1.8, markup: MARKUP, lineTotal: 1.8 * (1 + MARKUP / 100) * 2_000 }]);
  const dwJob = closedJob('p-dw', dwEst);
  const dwLabor = [{
    projectId: 'p-dw', projectName: 'p-dw', trade: 'Labor — Drywall', unit: 'hour',
    quantity: 40, bidUnit: 0, actualUnit: 65, basis: 'actual' as const, closedAt: '2026-01-10',
    source: 'labor_rate' as const,
  }];
  const dwReceipt = {
    id: 'rdw', projectId: 'p-dw', vendor: 'Supply', receiptDate: '2026-01-06',
    createdAt: '2026-01-06T00:00:00.000Z', status: 'reviewed',
    lines: [{ id: 'l', description: 'Board', category: 'Drywall', quantity: 2_000, unit: 'sf', unitPrice: 0.5, lineTotal: 1_000 }],
  } as never;
  const dwBook = buildCostDatabase([dwJob], [], [dwReceipt], dwLabor);
  const dwRate = lookupRate(dwBook, 'Drywall', 'SF');
  ok('the fixture really does collide (the material is priced in the scope unit)',
    (dwRate?.samples.length ?? 0) === 2 && (dwRate?.samples ?? []).some(s => s.basis === 'self_perform')
      && (dwRate?.samples ?? []).some(s => s.source === 'receipt'),
    JSON.stringify((dwRate?.samples ?? []).map(s => [s.basis, s.source, s.actualUnit])));
  expect('a same-unit material receipt does not drag the installed rate down (it learned $1.15)',
    round2(dwRate?.personalRate ?? 0), round2((40 * 65 + 1_000) / 2_000));
  expect('…and the suggested rate follows it, not the blend', round2(dwRate?.suggestedRate ?? 0), 1.8);
  expect('…the board price is kept, labelled, and never averaged',
    (dwRate?.samples ?? []).filter(s => s.excludedReason === 'material_component').map(s => s.actualUnit), [0.5]);
  expect('…and counted on its own, not as a one-off blowout', dwRate?.materialComponentCount, 1);
  expect('…so the one-off counter stays clean', dwRate?.excludedSampleCount, 0);
  ok('…and the ± band it manufactured (a total vs one of its parts) is gone',
    dwRate?.spreadMeaningful === false, `spreadMeaningful=${dwRate?.spreadMeaningful} variability=${dwRate?.variability}`);
  // The material row this receipt legitimately teaches must still be a rate on
  // its own key when nothing installed shares it.
  expect('a receipts-only book still learns the board price itself',
    lookupRate(buildCostDatabase([], [], [dwReceipt], []), 'Drywall', 'SF')?.personalRate, 0.5);

  // …AND THE GENERIC-TRADE SINK. normalizeTradeKey (utils/laborSamples
  // GENERIC_TRADES) folds '', 'crew', 'general' and 'labor' onto ONE key,
  // 'general'. So every receipt line the GC left uncategorised, and every hour
  // clocked without a trade set, pooled under that key — and a scope line
  // categorised "Crew"/"Labor"/"General" absorbed the lot as its own installed
  // rate. Here $9,000 of un-attributed material and 40 generic hours funded a
  // 1,000 SF "Crew" line at $11.60/SF, stamped MEASURED. The main book loop
  // does not even agree that blank means 'general' (it defaults to 'Other'),
  // so the two namespaces disagreed about what an uncategorised line is.
  const genEst = mkEstimate([{ materialId: 'm0', name: 'Misc', category: 'Crew', unit: 'SF', quantity: 1_000, unitPrice: 5, bulkPrice: 5, markup: MARKUP, lineTotal: 5 * (1 + MARKUP / 100) * 1_000 }]);
  const genBook = buildCostDatabase(
    [closedJob('p-gen', genEst)],
    [],
    [{
      id: 'rg', projectId: 'p-gen', vendor: 'Supply', receiptDate: '2026-01-06',
      createdAt: '2026-01-06T00:00:00.000Z', status: 'reviewed',
      lines: [{ id: 'l', description: 'Misc material', category: '', quantity: 100, unit: 'ea', unitPrice: 90, lineTotal: 9_000 }],
    } as never],
    [{
      projectId: 'p-gen', projectName: 'p-gen', trade: 'Labor — Crew', unit: 'hour',
      quantity: 40, bidUnit: 0, actualUnit: 65, basis: 'actual' as const, closedAt: '2026-01-10',
      source: 'labor_rate' as const,
    }],
  );
  expect('un-named material dollars never become a named scope\u2019s installed rate ($11.60/SF)',
    lookupRate(genBook, 'Crew', 'SF'), null);
  ok('…and no self-perform sample was emitted anywhere on that book',
    genBook.entries.every(e => e.samples.every(x => x.basis !== 'self_perform')),
    JSON.stringify(genBook.entries.map(e => [e.key, e.personalRate])));

  // ── 6i. ONE BOOK, ONE ANSWER — the partial-book trap self-perform opens ────
  // Self-perform sums the direct dollars the CALLER handed the engine, and most
  // callers hand it a partial world: app/cost-xray, app/area-takeoff,
  // app/daily-report, utils/bidLevelingEngine and components/BidConfidenceBadge
  // pass receipts with `[]` for labor. (app/takeoff-estimate was the worst of
  // them — it passed NEITHER — and was fixed on 2026-09-12; the four above are
  // still partial and are held one-directionally by validate-cost-seed §17e.)
  // Before the completeness gate, the SAME trade+unit key came back at $4.49/SF
  // on the price book, $2.33/SF with receipts only and $2.17/SF with labor only
  // — every wrong one short by an entire cost stream, in the direction that
  // makes a correctly-priced bid look padded. A rate that depends on which
  // screen asked is not a rate.
  //
  // WHAT THE GATE DID AND DID NOT CLOSE. It turns "wrong rate" into "no rate"
  // only where the receipt's unit differs from the scope's. When they match —
  // the ordinary case for board, sheathing, flooring, siding and roofing — a
  // receipts-only book still answers `framing|SF`, with the material price,
  // 48% under the full book. That case is measured at the end of this block;
  // the residual on the four remaining partial callers is a wrong price, not
  // silence.
  expect('the full book prices the self-performed trade',
    round2(lookupRate(spBook, 'Framing', 'SF')?.personalRate ?? 0), round2((80 * 65 + 5_580) / 2_400));
  const spReceiptsOnly = buildCostDatabase([spJob], [], [spReceipt], []);
  // Scoped to THIS fixture on purpose: the lumber is bought in 'ea', so it
  // cannot land on the scope's key at all. The same-unit case is the opposite
  // answer and is measured at the end of this block.
  expect('a receipts-only book publishes NO materials-only "installed rate" ($2.33/SF) when the receipt is in another unit',
    lookupRate(spReceiptsOnly, 'Framing', 'SF'), null);
  ok('…while the material unit price it CAN measure is still learned',
    (lookupRate(spReceiptsOnly, 'Framing', 'ea')?.personalRate ?? 0) === 6.2,
    String(lookupRate(spReceiptsOnly, 'Framing', 'ea')?.personalRate));
  // …AND THE MIRROR CASE, WHICH THE CLOCKED-HOURS GATE COULD NOT SEE. A book
  // with LABOR and no receipts published $2.17/SF against a true $4.49 —
  // labor-only, 52% short, stamped 'earned'/'paid' and eligible for the public
  // index. The enumeration below omitted it, so the invariant it asserts
  // ("every book that prices this trade at all returns the same number") was
  // false as stated: the labor-only book was the one that disagreed.
  const spLaborOnly = buildCostDatabase([spJob], [], [], spLabor);
  expect('a labor-only book publishes NO labor-only "installed rate" ($2.17/SF)',
    lookupRate(spLaborOnly, 'Framing', 'SF'), null);
  ok('…while the hourly rate it CAN measure is still learned',
    (lookupRate(spLaborOnly, 'Labor — Framing', 'hour')?.personalRate ?? 0) === 65);
  // …AND THE SAME HOLE ON A FULL BOOK. A receipt line's `category` is free text
  // the GC types (app/material-receipt.tsx, placeholder "Category (e.g.
  // Framing)"), defaulted to 'Materials' by utils/materialReceipt. File the
  // lumber under 'Materials' instead of 'Framing' and every stream is present
  // — so a clocked-hours-only gate passes — while the trade's material dollars
  // are somewhere else entirely and the "installed rate" is labor alone.
  const miscatReceipt = {
    id: 'r2', projectId: 'p-sp', vendor: 'Lumber', receiptDate: '2026-01-06',
    createdAt: '2026-01-06T00:00:00.000Z', status: 'reviewed',
    lines: [{ id: 'l', description: '2x6', category: 'Materials', quantity: 900, unit: 'ea', unitPrice: 6.2, lineTotal: 5_580 }],
  } as never;
  expect('a FULL book whose receipt is filed under another category publishes nothing either',
    lookupRate(buildCostDatabase([spJob], [], [miscatReceipt], spLabor), 'Framing', 'SF'), null);
  expect('a book with neither stream prices nothing, exactly as before the feature',
    lookupRate(buildCostDatabase([spJob], [], [], []), 'Framing', 'SF'), null);
  // …AND THE INVARIANT'S REAL SCOPE, MEASURED (audit repair 2026-09-12, F1).
  // Every book above agrees only because this fixture buys its lumber in 'ea'
  // against an SF scope: the material lands on `framing|ea` and can never
  // surface as an installed rate. File the SAME lumber in the scope's own unit
  // — which is how sheathing, board, flooring, siding and roofing are actually
  // bought — and a receipts-only book DOES answer on `framing|SF`, with the
  // board price:
  //     full book      $4.49/SF   (crew hours + material over 2,400 SF)
  //     receipts-only  $2.33/SF   (the material price, on the scope's own key)
  // 48% apart, same trade, same unit, on the four consumers that still pass
  // receipts with [] for labor. So "every book that prices this trade at all
  // returns the same number" was a property of the FIXTURE, not of the engine,
  // and it is restated below over the books that derive an INSTALLED rate.
  //
  // The material row is not a bug — §6h pins it deliberately ("a receipts-only
  // book still learns the board price itself"). It is a different quantity
  // wearing the same key, and the fix is the labor stream reaching those four
  // callers (validate-cost-seed §17e holds the list one-directionally), not a
  // change to the engine.
  const sameUnitReceipt = {
    id: 'r3', projectId: 'p-sp', vendor: 'Lumber', receiptDate: '2026-01-06',
    createdAt: '2026-01-06T00:00:00.000Z', status: 'reviewed',
    lines: [{ id: 'l', description: 'Sheathing', category: 'Framing', quantity: 2_400, unit: 'sf', unitPrice: 5_580 / 2_400, lineTotal: 5_580 }],
  } as never;
  const spFullSameUnit = buildCostDatabase([spJob], [], [sameUnitReceipt], spLabor);
  const spReceiptsOnlySameUnit = buildCostDatabase([spJob], [], [sameUnitReceipt], []);
  expect('a same-unit receipt leaves the FULL book’s installed rate alone',
    round2(lookupRate(spFullSameUnit, 'Framing', 'SF')?.personalRate ?? 0),
    round2((80 * 65 + 5_580) / 2_400));
  expect('…but a receipts-only book answers that SAME key with the material price',
    round2(lookupRate(spReceiptsOnlySameUnit, 'Framing', 'SF')?.personalRate ?? 0),
    round2(5_580 / 2_400));
  ok('…so the residual on a partial book is a WRONG PRICE, not silence, whenever the receipt shares the scope unit',
    (lookupRate(spReceiptsOnlySameUnit, 'Framing', 'SF')?.personalRate ?? 0)
      < (lookupRate(spFullSameUnit, 'Framing', 'SF')?.personalRate ?? 0) * 0.6,
    `full ${lookupRate(spFullSameUnit, 'Framing', 'SF')?.personalRate}, `
    + `receipts-only ${lookupRate(spReceiptsOnlySameUnit, 'Framing', 'SF')?.personalRate}`);

  // The invariant, restated to what actually holds: of the books that derive an
  // INSTALLED rate for this trade — a self-perform sample, i.e. cost of the
  // whole scope over the scope quantity — they all agree, over every
  // combination of the streams and both receipt units. A book answering with a
  // bare material price is excluded by the PREDICATE, not by hand, and is
  // asserted above on its own.
  const installedRate = (b: ReturnType<typeof buildCostDatabase>): number | null => {
    const e = lookupRate(b, 'Framing', 'SF');
    if (!e || !e.samples.some(x => x.basis === 'self_perform')) return null;
    return round2(e.personalRate);
  };
  const spAnswers = [
    spBook,
    spReceiptsOnly,
    spLaborOnly,
    spFullSameUnit,
    spReceiptsOnlySameUnit,
    buildCostDatabase([spJob], [], [miscatReceipt], spLabor),
    buildCostDatabase([spJob], [], [], []),
  ]
    .map(installedRate)
    .filter((n): n is number => typeof n === 'number');
  expect('every book that derives an INSTALLED rate for this trade returns the same number',
    new Set(spAnswers).size, 1);
  ok('…and at least one of them does derive it, so the invariant is not vacuous',
    spAnswers.length >= 1 && spAnswers[0] === round2((80 * 65 + 5_580) / 2_400), JSON.stringify(spAnswers));

  // ── 6j. A DISQUALIFIED SAMPLE MUST NOT MOVE THE OUTLIER THRESHOLD ─────────
  // The derivation exclusions (a change-order-bearing commitment, a package
  // split) are removed from the statistics BEFORE flagOutliers runs, and the
  // comment argues the point at length: they are not evidence that happens to
  // look odd, they are numbers with no unit-price content, and feeding them to
  // the median/MAD lets them move the very threshold meant to catch the real
  // outlier. Nothing tested it — no fixture had 4+ clean samples AND a
  // disqualified one — so restoring the old ordering left the file green.
  //
  // Four clean Painting jobs at $10/11/12/13/SF, one genuine blowout at $40,
  // and two change-order jobs at $200. Feed all seven to flagOutliers and the
  // reject count (3) exceeds MAX_REJECT_FRACTION of 7 (2), so it abandons
  // rejection entirely — and the $40 blowout teaches the rate.
  const sfLine = (bid: number) => mkEstimate([{ materialId: 'm0', name: 'Paint', category: 'Painting', unit: 'SF', quantity: 100, unitPrice: bid, bulkPrice: bid, markup: MARKUP, lineTotal: bid * (1 + MARKUP / 100) * 100 }]);
  const cleanJobs = [10, 11, 12, 13, 40].map((rate, i) => ({
    p: closedJob(`ol${i}`, sfLine(12), `2026-0${i + 1}-01`),
    c: commitment({ id: `col${i}`, projectId: `ol${i}`, amount: rate * 100, paidToDate: rate * 100, linkedEstimateItems: ['m0'] }),
  }));
  const coJobs = [0, 1].map(i => ({
    p: closedJob(`co${i}`, sfLine(12), `2026-0${i + 6}-01`),
    c: commitment({ id: `cco${i}`, projectId: `co${i}`, amount: 10_000, changeAmount: 10_000, paidToDate: 20_000, linkedEstimateItems: ['m0'] }),
  }));
  const olBook = buildCostDatabase(
    [...cleanJobs, ...coJobs].map(j => j.p),
    [...cleanJobs, ...coJobs].map(j => j.c),
  );
  const olEntry = lookupRate(olBook, 'Painting', 'SF')!;
  expect('the change-order jobs are disqualified as unit-rate evidence', olEntry.notRateEvidenceCount, 2);
  expect('…and the $40 blowout is still rejected as a one-off', olEntry.excludedSampleCount, 1);
  expect('…so the learned rate is the mean of the four clean jobs, not $17.20',
    round2(olEntry.personalRate), 11.5);

  // ── 6k. COST DIVIDED BY A MEASUREMENT, NOT BY A DRAWING (audit F6) ────────
  //
  // The engine's whole claim is `cost / quantity` where the quantity is the
  // size of the scope. On the takeoff path that quantity is whatever an AI read
  // off a PDF — and the app was already storing a better number: the GC stands
  // in the room, measures the wall, types it into
  // components/TakeoffFieldVerifyButton, and it went to AsyncStorage where a
  // full-repo grep found NOTHING reading it. So a plan that says 2,400 SF over
  // a wall that is really 2,600 SF taught a rate 8.3% high forever, with the
  // right denominator sitting two storage keys away.
  //
  // utils/fieldMeasuredQuantity decides; the GC's tap writes the row's quantity
  // of record; the priced estimate carries it; a commitment links to that line;
  // and this section measures what the book then learns. Both ends are here
  // because either alone is hollow: the pure verdict without the engine proves
  // nothing reaches the rate, and the engine without the verdict proves nothing
  // about whether a tape measure can ever get in.
  const {
    measurementVerdict, pendingMeasuredRows, adoptMeasurementCopy, adoptOffer,
    MEASUREMENT_AGREEMENT_TOLERANCE,
  } = await import('../utils/fieldMeasuredQuantity');

  const PLAN_SF = 2_400;
  const FIELD_SF = 2_600;
  const BID_UNIT = 2.5;
  const SUB_PRICE = 6_000;
  const fmEst = (qty: number) => mkEstimate([{
    materialId: 'm0', name: 'Hang + finish', category: 'Drywall', unit: 'SF',
    quantity: qty, unitPrice: BID_UNIT, bulkPrice: BID_UNIT, markup: MARKUP,
    lineTotal: BID_UNIT * (1 + MARKUP / 100) * qty,
  }]);
  const fmCommitment = commitment({
    id: 'c-dw', projectId: 'p-dw', amount: SUB_PRICE, paidToDate: SUB_PRICE,
    linkedEstimateItems: ['m0'],
  });
  const bookFor = (qty: number) =>
    lookupRate(buildCostDatabase([closedJob('p-dw', fmEst(qty))], [fmCommitment]), 'Drywall', 'SF')!;

  const planBook = bookFor(PLAN_SF);
  const fieldBook = bookFor(FIELD_SF);
  expect('the plan quantity teaches $2.50/SF — the sub\'s price over the DRAWING',
    round2(planBook.personalRate), round2(SUB_PRICE / PLAN_SF));
  expect('the measured quantity teaches $2.31/SF — the same price over the TAPE',
    round2(fieldBook.personalRate), round2(SUB_PRICE / FIELD_SF));
  ok('…so adopting the measurement is worth 8.3% of the learned rate on ONE job',
    round2((planBook.personalRate / fieldBook.personalRate - 1) * 100) === 8.33,
    `${round2((planBook.personalRate / fieldBook.personalRate - 1) * 100)}%`);
  // And it is not a cosmetic difference: the blended number that prices the
  // NEXT bid moves, and the bid-bias sentence flips from "you were exactly
  // right" to the truth — you bought this out under your own unit price.
  expect('the plan quantity reports zero bid bias, because it cancels',
    round2(planBook.bidBias), 0);
  ok('the measured quantity reveals a 7.7% over-bid that the drawing hid',
    round2(fieldBook.bidBias) === -0.08 && fieldBook.bidBias < 0,
    `bidBias ${fieldBook.bidBias}`);
  ok('…and the rate carried into the next bid moves with it',
    round2(planBook.suggestedRate) !== round2(fieldBook.suggestedRate),
    `plan ${round2(planBook.suggestedRate)} vs field ${round2(fieldBook.suggestedRate)}`);

  // THE ENGINE HAS NO BACK DOOR. buildCostDatabase cannot see a measurement —
  // it only ever divides by the estimate line — so a measurement that the GC
  // has not adopted changes NOTHING. That is the property that makes explicit
  // adoption safe, and it is why a partial measurement ("used 25 ft tape" typed
  // into a row that aggregates a whole elevation) cannot publish a 19x rate.
  const strandedRate = bookFor(PLAN_SF).personalRate;
  expect('a captured-but-unadopted measurement moves the rate by nothing',
    round2(strandedRate), round2(SUB_PRICE / PLAN_SF));

  // ── the verdict that decides whether the tap is even offered ──────────────
  const cap = (measuredQuantity: number | undefined, capturedAt = '2026-02-01T00:00:00.000Z') =>
    ({ rowKey: 'walls:w1', measuredQuantity, capturedAt });
  expect('a photo with no number typed offers nothing',
    measurementVerdict(PLAN_SF, cap(undefined)).kind, 'none');
  expect('a zero is not a measurement — reject the row instead',
    measurementVerdict(PLAN_SF, cap(0)).kind, 'none');
  expect('a NaN (an empty decimal box) is not a measurement',
    measurementVerdict(PLAN_SF, cap(Number.NaN)).kind, 'none');
  expect('2,600 against a 2,400 plan disagrees',
    measurementVerdict(PLAN_SF, cap(FIELD_SF)).kind, 'disagrees');
  expect('…by +200', measurementVerdict(PLAN_SF, cap(FIELD_SF)).kind === 'disagrees'
    ? (measurementVerdict(PLAN_SF, cap(FIELD_SF)) as { delta: number }).delta : 0, 200);
  // The tolerance is the SAME number the pill has always used to colour a
  // delta green, so what the contractor sees and what the app does agree.
  expect('the agreement tolerance is 5%', MEASUREMENT_AGREEMENT_TOLERANCE, 0.05);
  expect('a 4% difference is agreement — nothing to decide',
    measurementVerdict(1_000, cap(1_040)).kind, 'agrees');
  expect('a 6% difference is a decision',
    measurementVerdict(1_000, cap(1_060)).kind, 'disagrees');
  // A measurement ALREADY adopted must read as agreement, not offer itself a
  // second time — which is why the button is handed the override-aware
  // quantity of record rather than the AI's original read.
  expect('an adopted measurement stops asking',
    measurementVerdict(FIELD_SF, cap(FIELD_SF)).kind, 'agrees');

  // ── the rows still resting on the drawing, counted out loud ──────────────
  const verifs = [
    cap(FIELD_SF),                                             // disagrees
    { rowKey: 'floor:f1', measuredQuantity: 500, capturedAt: '2026-02-01T00:00:00.000Z' },
    { rowKey: 'doors:d1', measuredQuantity: 4, capturedAt: '2026-02-01T00:00:00.000Z' },
    { rowKey: 'walls:w9', measuredQuantity: 99, capturedAt: '2026-02-01T00:00:00.000Z' },
  ];
  const qtyOfRecord = (rowKey: string): number | null => {
    if (rowKey === 'walls:w1') return PLAN_SF;   // plan 2,400 vs field 2,600
    if (rowKey === 'floor:f1') return 500;       // identical — agreement
    if (rowKey === 'doors:d1') return 4;         // identical — agreement
    return null;                                 // rejected / row is gone
  };
  const pending = pendingMeasuredRows({ verifications: verifs, quantityOfRecord: qtyOfRecord });
  expect('only the row that DISAGREES is pending a decision', pending.map(r => r.rowKey), ['walls:w1']);
  // `?.` deliberately: widening the tolerance emptied this list and the guard
  // died on a TypeError instead of printing a failure. A guard that crashes
  // still exits non-zero, but it stops the assertions after it from ever being
  // reached, which is how one regression hides five.
  expect('…with the delta the screen will show', pending[0]?.delta, 200);
  ok('a rejected row is not a pending decision — it prices nothing and teaches nothing',
    !pending.some(r => r.rowKey === 'walls:w9'));
  // Newest capture wins by STAMP, not by array order.
  const reMeasured = pendingMeasuredRows({
    verifications: [
      { rowKey: 'walls:w1', measuredQuantity: FIELD_SF, capturedAt: '2026-02-01T00:00:00.000Z' },
      { rowKey: 'walls:w1', measuredQuantity: PLAN_SF, capturedAt: '2026-03-01T00:00:00.000Z' },
    ],
    quantityOfRecord: qtyOfRecord,
  });
  expect('a re-measurement that agrees clears the row, whatever order it arrives in',
    reMeasured.length, 0);

  // ── WHETHER THE TAP IS OFFERED AT ALL, executed rather than grepped ──────
  // This is the rule that decides whether F6 is closed on screen, and it used
  // to live inline in the component as a ternary, pinned only by a regex over
  // JSX. It is now a function, so it can be run — including the case that IS
  // the defect: a call site that forgets the writer gets no button, silently,
  // and the measurement is a caption again.
  const disagreeing = measurementVerdict(PLAN_SF, cap(FIELD_SF));
  const agreeing = measurementVerdict(PLAN_SF, cap(PLAN_SF));
  const nothing = measurementVerdict(PLAN_SF, cap(undefined));
  ok('a disagreeing measurement with a writer wired in IS offered for adoption',
    adoptOffer(disagreeing, 'SF', true) !== null);
  expect('…carrying the number the tap will write',
    adoptOffer(disagreeing, 'SF', true)?.measured, FIELD_SF);
  expect('…and the module’s own label, so the screen cannot promise something else',
    adoptOffer(disagreeing, 'SF', true)?.label, adoptMeasurementCopy(FIELD_SF, 'SF').label);
  expect('a measurement that AGREES is never offered — there is nothing to change',
    adoptOffer(agreeing, 'SF', true), null);
  expect('a photo with no number is never offered', adoptOffer(nothing, 'SF', true), null);
  expect('and WITHOUT a writer wired in there is no offer at all — that is F6 itself',
    adoptOffer(disagreeing, 'SF', false), null);

  // ── and the promise the button makes is the promise this section proves ───
  const copy = adoptMeasurementCopy(FIELD_SF, 'SF');
  expect('the button names the number it will adopt', copy.label, 'Use 2,600 SF as the quantity');
  // EXACT, not two greps. Two substring tests survived mangling the sentence
  // around them: replacing the first half with "Prices this scope off what you
  // measured. " left "…measured. cost book divides the sub's price by…" — a
  // broken sentence that still matched both patterns, and the guard stayed
  // green. This promise is the only place the invisible half of the tap is
  // stated, so it is pinned verbatim; a rewording is a deliberate edit here.
  expect('…and the sentence under it names the cost-book consequence, which is the invisible half',
    copy.consequence,
    'Prices this scope off what you measured \u2014 and when the job closes, your cost book '
    + 'divides the sub\u2019s price by the measured quantity instead of the plan\u2019s.');

  // ── 6l. A PAYMENT WITH NO CONTRACT SUM IS REFUSED — AND NOW SAID OUT LOUD ──
  // The ladder in utils/costDatabase deliberately teaches NOTHING from a
  // payment on a commitment whose amount is blank (or cancelled out by a
  // deductive change order): taking the raw draw is the mobilization-deposit
  // 10x error reached from the other side — a $1,200 payment on a 30 SQ roof
  // bid at $400/SQ once taught $40/SQ, stamped 'actual', and drove the headline
  // Bid-accuracy KPI to 10% on an account whose estimating was perfect.
  //
  // Silence is right for the RATE and wrong for the CONTRACTOR, and that was
  // the open half of the audit's Issue 8: he paid a sub, closed the job, and
  // his prices learned nothing with no sentence anywhere naming the blank
  // field. Both halves are asserted here, because the notice is only honest if
  // the silence it explains is real.
  const { commitmentsMissingContractSum, missingContractSumNotice } =
    await import('../utils/costDatabase');

  const sumlessEst = mkEstimate([{
    materialId: 'm0', name: 'Roof', category: 'Roofing', unit: 'SQ', quantity: 30,
    unitPrice: 400, bulkPrice: 400, markup: MARKUP, lineTotal: 400 * (1 + MARKUP / 100) * 30,
  }]);
  const sumlessJob = closedJob('p-sumless', sumlessEst);
  const sumless = commitment({
    id: 'c-sumless', projectId: 'p-sumless', vendorName: 'Apex Roofing',
    description: 'Tear-off + re-roof', amount: 0, paidToDate: 1_200,
    linkedEstimateItems: ['m0'],
  });
  expect('the $1,200 draw with no contract sum still teaches no rate',
    lookupRate(buildCostDatabase([sumlessJob], [sumless]), 'Roofing', 'SQ'), null);
  const flagged = commitmentsMissingContractSum([sumlessJob], [sumless]);
  expect('…and the contractor is told which commitment caused the silence',
    flagged.map(r => r.commitmentId), ['c-sumless']);
  expect('…with the money he actually paid', flagged[0].paidToDate, 1_200);
  expect('…and the vendor he paid it to', flagged[0].vendorName, 'Apex Roofing');
  expect('the notice names the fix, not just the fault',
    missingContractSumNotice(flagged),
    'One commitment on a finished job has money paid against it and no contract amount. '
    + 'A payment with no contract sum behind it cannot say what the scope cost, so it teaches '
    + 'your prices nothing — fill in the amount and that job will start correcting your rates.');

  // A DEDUCTIVE CHANGE ORDER IS THE SAME HOLE. `(amount + changeAmount) <= 0`
  // is what estimateActuals allocates, so a $10,000 sub with a −$10,000 CO
  // silences the line exactly as a blank amount does.
  const cancelled = commitment({
    id: 'c-cancelled', projectId: 'p-sumless', amount: 10_000, changeAmount: -10_000,
    paidToDate: 4_000, linkedEstimateItems: ['m0'],
  });
  expect('a commitment cancelled out by a deductive CO is flagged too',
    commitmentsMissingContractSum([sumlessJob], [cancelled]).map(r => r.commitmentId),
    ['c-cancelled']);

  // AND THE THREE THINGS THAT ARE NOT THIS DEFECT, so the notice never cries
  // wolf: a commitment that HAS an amount, one with nothing paid yet, and a
  // draft (which is not a hole in the record, it is a commitment that does not
  // exist yet). Plus a live job — this book only reads closed ones.
  expect('a commitment with a real contract sum is not flagged',
    commitmentsMissingContractSum([sumlessJob], [commitment({ id: 'c-ok', projectId: 'p-sumless', amount: 12_000, paidToDate: 12_000 })]), []);
  expect('a sum-less commitment nobody has paid is not flagged',
    commitmentsMissingContractSum([sumlessJob], [commitment({ id: 'c-unpaid', projectId: 'p-sumless', amount: 0, paidToDate: 0 })]), []);
  expect('a DRAFT is not a hole in the record',
    commitmentsMissingContractSum([sumlessJob], [commitment({ id: 'c-draft', projectId: 'p-sumless', status: 'draft', amount: 0, paidToDate: 900 })]), []);
  expect('a job still running is not this book\'s business',
    commitmentsMissingContractSum(
      [{ id: 'p-live', name: 'Live', status: 'active', linkedEstimate: sumlessEst } as unknown as Project],
      [commitment({ id: 'c-live', projectId: 'p-live', amount: 0, paidToDate: 900 })]),
    []);
  expect('an empty account produces no notice at all', missingContractSumNotice([]), '');
  // Worst first, so the row the GC sees is the one worth fixing.
  expect('the biggest unexplained payment is listed first',
    commitmentsMissingContractSum([sumlessJob], [
      commitment({ id: 'c-small', projectId: 'p-sumless', amount: 0, paidToDate: 300 }),
      commitment({ id: 'c-big', projectId: 'p-sumless', amount: 0, paidToDate: 9_000 }),
    ]).map(r => r.commitmentId), ['c-big', 'c-small']);
}

// ── 12. THE MARGIN BUG: an estimate must not ship at cost, silently ─────────
//
// The most expensive defect this file has ever had to guard. Measured on the
// shipped code before the fix: the Quick Estimate wizard produced a $59,132
// estimate with baseTotal $59,132, grandTotal $59,132, markupTotal $0 — a
// 0.0% gross margin — and utils/livingEstimate reported hasMarginBasis FALSE
// on it, so utils/marginAlerts skipped the job and nothing caught it at close
// either. The number a contractor emailed a homeowner was his cost.
//
// These assertions call the SHIPPED functions. buildQuickLinkedEstimate and
// priceCostBreakdown are the exact ones app/estimate-wizard.tsx imports; the
// mapper used to be a screen-local closure inside the .tsx, which no validator
// could reach and which is why nothing here could have caught this before.
{
  console.log('\nthe margin bug (an estimate must not ship at cost):');

  let n = 0;
  const seq = () => `id${n++}`;
  const breakdown = () => ({
    lineItems: [
      { category: 'Demolition', description: 'Gut kitchen', quantity: 1, unit: 'ls', unitCost: 4_800, total: 4_800 },
      { category: 'Labor', description: 'Carpentry crew', quantity: 240, unit: 'hrs', unitCost: 78, total: 18_720 },
      { category: 'Finishes', description: 'Cabinets + tops', quantity: 1, unit: 'ls', unitCost: 22_400, total: 22_400 },
    ],
    subtotal: 45_920, contingency: 4_592, permits: 1_800, total: 52_312,
  });
  const COST_TOTAL = 52_312;

  // ── 12a. the mapper actually applies the markup ──────────────────────────
  {
    n = 0;
    const est = buildQuickLinkedEstimate(breakdown(), 20, seq);
    expect('the wizard mapper prices at cost basis + markup', est.baseTotal, COST_TOTAL);
    expect('…and sells at cost x 1.20', est.grandTotal, round2(COST_TOTAL * 1.2));
    ok('…so the estimate carries real profit', est.markupTotal > 0,
      `markupTotal ${est.markupTotal} — a wizard estimate with no profit in it is THE defect`);
    ok('…and it is not at cost', !isAtCost(est));
    // The exact pre-fix state, asserted as a NEGATIVE so the guard fails if the
    // hard-coded `markup: 0` ever comes back.
    ok('no line is left at markup 0', est.items.every(i => i.markup === 20),
      `markups seen: ${JSON.stringify([...new Set(est.items.map(i => i.markup))])}`);
    expect('globalMarkup records what was applied', est.globalMarkup, 20);
    // Contingency and permits are priced too, not carried at cost — see the
    // argument in utils/estimateMarkup.applyMarkupToItems.
    const cont = est.items.find(i => i.name === 'Contingency');
    ok('contingency carries the markup as well', !!cont && cont.markup === 20 && cont.lineTotal > cont.unitPrice,
      'a contingency carried at cost is spent at 0% margin and drags realized margin below the bid');
  }

  // A hand-tuned per-line markup survives a global pass, and `force` overrides
  // it. Unguarded until this was mutated (`keepOwn = false` left all 214 green),
  // and it is a promise the estimator's per-item markup chips depend on.
  {
    const tuned = [{
      materialId: 'x', name: 'Tile', category: 'Tile', unit: 'sf', quantity: 100,
      unitPrice: 10, bulkPrice: 10, markup: 40, usesBulk: false, lineTotal: 1_400, supplier: '',
    }, {
      materialId: 'y', name: 'Paint', category: 'Painting', unit: 'sf', quantity: 100,
      unitPrice: 5, bulkPrice: 5, markup: 0, usesBulk: false, lineTotal: 500, supplier: '',
    }];
    const soft = applyMarkupToItems(tuned, 20);
    expect('a hand-tuned 40% line keeps its markup through a global pass', soft[0].markup, 40);
    expect('…and its sell price is still cost x 1.40', soft[0].lineTotal, 1_400);
    expect('…while the untouched line takes the global 20%', soft[1].markup, 20);
    const forced = applyMarkupToItems(tuned, 20, { force: true });
    expect('force overrides even a hand-tuned line', forced[0].markup, 20);
    expect('…and reprices it', forced[0].lineTotal, 1_200);
  }

  // ── 12b. the two invariants every downstream engine reads ────────────────
  {
    n = 0;
    const est = buildQuickLinkedEstimate(breakdown(), 18, seq);
    expect('sum of lineTotal === grandTotal',
      round2(est.items.reduce((t, i) => t + i.lineTotal, 0)), round2(est.grandTotal));
    expect('baseTotal + markupTotal === grandTotal',
      round2(est.baseTotal + est.markupTotal), round2(est.grandTotal));
    expect('sum of unitPrice x quantity === baseTotal',
      round2(est.items.reduce((t, i) => t + i.unitPrice * i.quantity, 0)), round2(est.baseTotal));
    // THE COST BASIS MUST SURVIVE. jobCostEngine seeds the budget from
    // unitPrice, estimateActuals compares buyouts to it, estimateCalibration
    // divides by it. Marking up unitPrice would teach the cost engine that his
    // costs rose by his profit, and the calibration loop compounds that.
    const demo = est.items[0];
    expect('unitPrice is untouched COST, never the marked-up figure', demo.unitPrice, 4_800);
    ok('lineTotal is the marked-up SELL figure', demo.lineTotal > demo.unitPrice * demo.quantity);
  }

  // ── 12c. zero is a real answer and it is honoured, not overridden ────────
  {
    n = 0;
    const est = buildQuickLinkedEstimate(breakdown(), 0, seq);
    expect('a 0% markup quotes exactly cost', est.grandTotal, COST_TOTAL);
    ok('…and isAtCost says so out loud', isAtCost(est),
      'the UI band that warns him depends on this predicate');
    // An UNSET markup must behave identically to zero in the arithmetic — the
    // app must never invent a percentage for a contractor who has not chosen.
    n = 0;
    const unset = buildQuickLinkedEstimate(breakdown(), null, seq);
    expect('an UNSET markup invents nothing', unset.grandTotal, COST_TOTAL);
  }

  // ── 12d. markup is not margin, and the app knows the difference ──────────
  expect('25% markup is 20% margin', Math.round(marginOf(25) * 1000) / 10, 20);
  expect('50% markup is 33.3% margin', Math.round(marginOf(50) * 1000) / 10, 33.3);
  expect('20% margin needs a 25% markup', Math.round(markupForMargin(0.2)), 25);
  ok('the two are NOT the same number', marginOf(25) * 100 !== 25,
    'conflating them is how a contractor aiming for 25 points walks away with 20');
  {
    n = 0;
    const est = buildQuickLinkedEstimate(breakdown(), 25, seq);
    expect('a 25% markup yields a 20.0% realized gross margin',
      Math.round(estimateMarginPct(est) * 1000) / 10, 20);
  }

  // ── 12e. the client-facing document is priced, not costed ────────────────
  // priceCostBreakdown is what the hero total, the category breakdown, the
  // payment schedule AND utils/pdfGenerator all read. If it returned cost, the
  // homeowner's PDF would quote cost no matter what the LinkedEstimate said.
  {
    const priced = priceCostBreakdown(breakdown(), 20);
    expect('the PDF/on-screen total is the SELL price', priced.total, round2(COST_TOTAL * 1.2));
    ok('every client-visible unit price carries the markup',
      priced.lineItems.every((li, i) => li.unitCost > breakdown().lineItems[i].unitCost));
    ok('the priced doc and the linked estimate agree on the total', (() => {
      n = 0;
      const est = buildQuickLinkedEstimate(breakdown(), 20, seq);
      return Math.abs(est.grandTotal - priced.total) < 0.05;
    })(), 'the client PDF and the project budget must not quote two different numbers');
    expect('an unset markup leaves the document untouched', priceCostBreakdown(breakdown(), null).total, COST_TOTAL);
  }

  // ── 12f. livingEstimate can SEE a job bid at cost ────────────────────────
  // The blindness clause. `hasMarginBasis` used to require
  // `baseTotal < grandTotal`, so a job with no margin failed the test for
  // HAVING a margin basis, and utils/marginAlerts `continue`d straight past
  // the only jobs that needed the alarm.
  {
    n = 0;
    const atCostEst = buildQuickLinkedEstimate(breakdown(), 0, seq);
    const atCostJob = { id: 'p-atcost', name: 'At cost', status: 'in_progress', linkedEstimate: atCostEst } as unknown as Project;
    const le = computeLivingEstimate({ project: atCostJob, changeOrders: [], commitments: [], invoices: [] });
    ok('a job bid at cost HAS a margin basis', le.hasMarginBasis,
      'false here means utils/marginAlerts, marginRiskScore and portfolio-margin all skip it');
    ok('…and is named as bid-at-cost', le.bidAtCost);
    expect('…its bid margin is zero', Math.round(le.original.marginPct * 1000), 0);
    expect('…and its health is critical', le.health, 'critical');

    // Priced below cost is worse, and must not be filtered out either.
    n = 0;
    const underEst = buildQuickLinkedEstimate(breakdown(), 0, seq);
    underEst.grandTotal = round2(underEst.baseTotal * 0.9);
    underEst.markupTotal = round2(underEst.grandTotal - underEst.baseTotal);
    const underJob = { id: 'p-under', name: 'Under', status: 'in_progress', linkedEstimate: underEst } as unknown as Project;
    const under = computeLivingEstimate({ project: underJob, changeOrders: [], commitments: [], invoices: [] });
    ok('a job priced BELOW cost is still seen', under.hasMarginBasis);
    expect('…and is critical', under.health, 'critical');
    ok('…with a negative bid margin', under.original.marginPct < 0);

    // …and the genuinely blind case still reports blind: no cost basis at all.
    const legacy = { id: 'p-legacy', name: 'Legacy', status: 'in_progress',
      estimate: { grandTotal: 90_000 } } as unknown as Project;
    ok('a legacy single-total estimate still has NO margin basis',
      !computeLivingEstimate({ project: legacy, changeOrders: [], commitments: [], invoices: [] }).hasMarginBasis,
      'one number cannot be split into cost and margin — this case must stay excluded');
    ok('…and is not mislabelled as bid-at-cost',
      !computeLivingEstimate({ project: legacy, changeOrders: [], commitments: [], invoices: [] }).bidAtCost);
  }

  // ── 12g. a marked-up job is not misreported as at-cost ───────────────────
  // The other direction, so the band and the alert cannot cry wolf.
  {
    n = 0;
    const good = buildQuickLinkedEstimate(breakdown(), 22, seq);
    const goodJob = { id: 'p-good', name: 'Good', status: 'in_progress', linkedEstimate: good } as unknown as Project;
    const le = computeLivingEstimate({ project: goodJob, changeOrders: [], commitments: [], invoices: [] });
    ok('a properly marked-up job is not flagged at cost', !le.bidAtCost);
    expect('…and is healthy with nothing spent', le.health, 'healthy');
  }

  // ── 12h. labor and assemblies carry the markup too ───────────────────────
  // app/(tabs)/estimate/full.tsx wrote `markup: 0` on every labor and assembly
  // row while materials carried the contractor's percentage, so a labor-heavy
  // job realized a fraction of the margin he set. This asserts the arithmetic
  // that file now uses — a mixed cart must yield the markup he chose ACROSS
  // the whole cost base, not just the materials slice.
  {
    const MK = 20;
    const materialsCost = 40_000, laborCost = 50_000, assembliesCost = 10_000;
    // cartTotals is the function BOTH estimator screens call — not a re-typed
    // copy of their formula. Deleting the markup from labor inside it turns
    // every assertion below red, which is the only reason they mean anything.
    const t = cartTotals({
      materialsCost,
      materialsSell: materialsCost * (1 + MK / 100),
      laborCost, assembliesCost, markupPct: MK,
    });
    expect('the shared cart total marks up the WHOLE cost base',
      round2(t.markupTotal), round2(t.directCostTotal * MK / 100));
    expect('…which is 20,000 on a 100k job, not the 8,000 materials-only gave',
      Math.round(t.markupTotal), 20_000);
    expect('…labor is sold above its loaded cost', round2(t.laborSell), round2(laborCost * 1.2));
    expect('…and so are assemblies', round2(t.assemblySell), round2(assembliesCost * 1.2));
    expect('…the realized margin equals marginOf(markup)',
      Math.round((t.markupTotal / t.grandTotal) * 1000) / 10, Math.round(marginOf(MK) * 1000) / 10);
    ok('the materials-only rule would have under-margined this job',
      materialsCost * MK / 100 < t.markupTotal,
      'materials-only markup on a labor-heavy job is 8,000 against the 20,000 he set');
    // Zero must stay zero — the shared function must not invent a floor.
    const none = cartTotals({ materialsCost, materialsSell: materialsCost, laborCost, assembliesCost, markupPct: 0 });
    expect('a 0% cart totals to exactly cost', round2(none.grandTotal), round2(none.directCostTotal));
    expect('…with no markup', round2(none.markupTotal), 0);
    // The NaN guard inside cartTotals. Unguarded until this was written:
    // deleting `Number.isFinite(input.markupPct) ? input.markupPct : 0` left
    // all 219 assertions green while every total on the estimator screen
    // rendered NaN the moment the custom-percent field held a non-number.
    const bad = cartTotals({
      materialsCost, materialsSell: materialsCost, laborCost, assembliesCost,
      markupPct: Number.NaN,
    });
    ok('a NaN markup produces finite totals, not NaN on every row',
      Number.isFinite(bad.grandTotal) && Number.isFinite(bad.markupTotal) && Number.isFinite(bad.laborSell),
      `grandTotal ${bad.grandTotal} — the estimator's custom-percent field can hold "" or "2o"`);
    expect('…and is treated as no markup, never as an invented one',
      round2(bad.grandTotal), round2(bad.directCostTotal));

    // THE RATE PRINTED ON THE ROW. "Overhead & profit ({globalMarkup}%)" was
    // stated unconditionally, so a cart with one material line hand-tuned to
    // 40% showed a bigger dollar figure under a percentage that did not
    // produce it. The realized rate is the only one that footed.
    expect('a clean cart realizes exactly the global percent',
      round2(t.effectiveMarkupPct), MK);
    const tuned = cartTotals({
      materialsCost,
      // One line pulled up: the materials SELL side is 40% over cost, not 20%.
      materialsSell: materialsCost * 1.4,
      laborCost, assembliesCost, markupPct: MK,
    });
    ok('a hand-tuned line moves the rate the row must print',
      tuned.effectiveMarkupPct > MK,
      `effective ${tuned.effectiveMarkupPct} — printing the global 20% here understates what he is charging`);
    expect('…and the printed rate still foots to the dollars',
      round2(tuned.markupTotal), round2(tuned.directCostTotal * tuned.effectiveMarkupPct / 100));
    expect('an empty cart falls back to the percent he set, not NaN',
      round2(cartTotals({ materialsCost: 0, materialsSell: 0, laborCost: 0, assembliesCost: 0, markupPct: MK })
        .effectiveMarkupPct), MK);
  }

  // ── 12i. "he answered zero" is not "he was never asked" ──────────────────
  //
  // isMarkupSet is the predicate app/estimate-wizard.tsx's requireMarkup()
  // gates the PDF and the project write on, and the one that decides whether
  // the red "This number is your cost" band is shown. It is the single most
  // load-bearing line in the whole markup change, and section 12c above could
  // not see it: BOTH branches produce grandTotal === COST_TOTAL, so every
  // arithmetic assertion there stays green whichever way the predicate goes.
  // Mutating `pct >= 0` to `pct > 0` — which makes a recorded "I quote at
  // cost" indistinguishable from "never asked" and re-opens the hard gate on
  // every single share, forever — left 219 passed / 0 failed. These are the
  // assertions that can tell the two apart.
  {
    ok('a recorded ZERO is a decision the app must honour', isMarkupSet(0),
      'false here re-asks the markup question on every share for a cost-plus contractor');
    ok('…and an unanswered markup is not', !isMarkupSet(null));
    ok('…nor is a NaN one', !isMarkupSet(Number.NaN));
    ok('…nor a negative one', !isMarkupSet(-5), 'a negative markup is a price below cost, not a decision');
    ok('a real percentage is set', isMarkupSet(20));
    // The tautology this breaks: decided-zero and never-asked PRICE the same.
    // Only the predicate separates them, so only the predicate can be guarded.
    expect('decided-zero and never-asked price identically', markupFactor(0), markupFactor(null));
    ok('…which is exactly why the arithmetic cannot guard this and the predicate must',
      isMarkupSet(0) !== isMarkupSet(null));
  }

  // ── 12j. the clamps and zero-guards inside the conversions ───────────────
  // Each of these was mutated out and left 219 green.
  {
    // markupForMargin's clamp. Without it a 100% margin asks for an infinite
    // markup and a negative margin returns a negative one, both of which then
    // reach a UI field as "Infinity" / "-33".
    ok('a 100% margin clamps to a finite markup', Number.isFinite(markupForMargin(1)),
      `got ${markupForMargin(1)}`);
    ok('…as does an impossible 200% margin', Number.isFinite(markupForMargin(2)));
    expect('a negative margin asks for no markup, not a negative one', markupForMargin(-0.5), 0);
    // estimateMarginPct's zero guard: 0/0 is NaN, and NaN renders on the
    // margin band as "NaN%" and compares false against every threshold.
    expect('an empty estimate has 0% margin, not NaN',
      estimateMarginPct({ baseTotal: 0, grandTotal: 0 }), 0);
    ok('…and the result is a number', Number.isFinite(estimateMarginPct({ baseTotal: 0, grandTotal: 0 })));
  }

  // ── 12k. a negative contingency cannot split the PDF from the budget ─────
  //
  // Measured on the pre-fix functions with {subtotal 1000, contingency -200,
  // permits 0} at 20%: priceCostBreakdown.total = 960 (what the homeowner is
  // quoted) while buildQuickLinkedEstimate.grandTotal = 1200 (what the project
  // budget, the WIP report and the client portal read) — because the row was
  // dropped on `> 0` but still folded into the priced total. The gap is the
  // contingency times the markup factor, so it GREW with the markup. Neither
  // the zod schema (`.catch(0)`) nor the wizard's normalizer clamps it.
  {
    const negative = () => ({
      lineItems: [{ category: 'Framing', description: 'Frame', quantity: 1, unit: 'ls', unitCost: 1_000, total: 1_000 }],
      subtotal: 1_000, contingency: -200, permits: 0, total: 800,
    });
    for (const pct of [0, 20, 35]) {
      n = 0;
      const est = buildQuickLinkedEstimate(negative(), pct, seq);
      const priced = priceCostBreakdown(negative(), pct);
      expect(`a negative contingency: PDF and budget agree at ${pct}%`,
        round2(priced.total), round2(est.grandTotal));
    }
    n = 0;
    expect('…and the negative is clamped away rather than quoted as a discount',
      priceCostBreakdown(negative(), 20).contingency, 0);
    expect('…so the client total is cost x 1.20 on the real scope',
      priceCostBreakdown(negative(), 20).total, 1_200);
    ok('…and no line item carries a negative price into the job budget',
      buildQuickLinkedEstimate(negative(), 20, seq).items.every(i => i.unitPrice >= 0 && i.lineTotal >= 0),
      'a negative unitPrice seeds a negative jobCostEngine budget line and a negative buyout target');
    // A negative PERMITS figure is the same defect on the other add-on.
    const negPermits = () => ({ ...negative(), contingency: 0, permits: -50, total: 950 });
    n = 0;
    expect('the same holds for a negative permits figure',
      round2(priceCostBreakdown(negPermits(), 20).total),
      round2(buildQuickLinkedEstimate(negPermits(), 20, seq).grandTotal));
    // …and for a non-finite one. A model that divides by a zero quantity can
    // emit Infinity; carried into a LinkedEstimateItem it makes the whole job
    // budget Infinity, and the two totals disagree about which one is broken.
    const infinite = () => ({ ...negative(), contingency: Number.POSITIVE_INFINITY, total: 1_000 });
    n = 0;
    const infEst = buildQuickLinkedEstimate(infinite(), 20, seq);
    ok('a non-finite contingency never reaches the job budget',
      infEst.items.every(i => Number.isFinite(i.unitPrice) && Number.isFinite(i.lineTotal))
        && Number.isFinite(infEst.grandTotal),
      `grandTotal ${infEst.grandTotal}`);
    expect('…and the PDF and the budget still agree',
      round2(priceCostBreakdown(infinite(), 20).total), round2(infEst.grandTotal));
  }

  // ── 12l. the client total is RE-FOOTED, never the model's total scaled ────
  // The AI returns `total` as its own arithmetic and it does not always agree
  // with subtotal + contingency + permits. Mutating priceCostBreakdown's
  // `total: round2(subtotal + contingency + permits)` to
  // `total: round2(data.total * f)` left 219 green, because every fixture in
  // this file is internally consistent. This one is not, on purpose.
  {
    const inconsistent = () => ({
      lineItems: [{ category: 'Framing', description: 'Frame', quantity: 1, unit: 'ls', unitCost: 1_000, total: 1_000 }],
      subtotal: 1_000, contingency: 100, permits: 50,
      // The model's own total, wrong by 850. This happens.
      total: 300,
    });
    const priced = priceCostBreakdown(inconsistent(), 20);
    expect('the priced total is re-footed from its parts', priced.total, round2(1_150 * 1.2));
    ok('…not the model\'s wrong total scaled by the markup', priced.total !== round2(300 * 1.2),
      `got ${priced.total}; 360 means the wrong number is being carried through to the homeowner`);
    n = 0;
    expect('…and the linked estimate lands on the same figure',
      round2(buildQuickLinkedEstimate(inconsistent(), 20, seq).grandTotal), round2(priced.total));
  }

  // ── 12m. an existing user does not lose the markup he already set ────────
  //
  // `mageid_markup_decided` is younger than `mageid_material_cart_markup`.
  // Without a seed, every contractor who set 25% in the estimator months ago
  // hydrates as "never asked" on his first launch after this ships:
  // app/quick-quote.tsx stops prefilling it (the quote goes out at 0%), and
  // app/estimate-wizard.tsx shows him the red at-cost band and blocks his PDF
  // behind a question he has already answered. That is a regression for every
  // existing user, and the one this whole change was supposed to prevent.
  {
    ok('a brand-new install has not answered', !markupDecidedFromStorage(null, null));
    ok('a contractor with 25% already on disk HAS answered',
      markupDecidedFromStorage(null, '25'),
      'false here is the upgrade regression: his saved markup vanishes and quick-quote sends at cost');
    ok('…and so has one whose saved markup is zero',
      markupDecidedFromStorage(null, '0'),
      'a cost-plus contractor must not be re-asked forever');
    ok('the explicit flag alone is enough', markupDecidedFromStorage('"1"', null));
    ok('…in either encoding', markupDecidedFromStorage('1', null));
    ok('a corrupt markup value is not a decision', !markupDecidedFromStorage(null, 'not-json'));
    ok('…nor is a stored null', !markupDecidedFromStorage(null, 'null'));
    ok('…nor an empty string', !markupDecidedFromStorage(null, ''));
    // JSON.stringify(NaN) is the string "null", so a corrupted numeric write
    // lands in the branch above rather than parsing to a number.
    ok('a negative saved markup is not a decision', !markupDecidedFromStorage(null, '-10'));
  }

  // ── 12n. one screen, one markup ──────────────────────────────────────────
  //
  // components/CostBreakdownReport renders directly above the Estimate Summary
  // card in app/(tabs)/estimate/full.tsx. It used to compute its own
  // `markupAmount = materialTotal * globalMarkup / 100` — materials only —
  // while the summary four inches below had been corrected to mark up the
  // whole cost base. On a $40k/$50k/$10k cart at 20% the two cards read
  // $8,000 ("Markup 7%") and $20,000 on one scroll. This is structural because
  // the contradiction is structural: the report must not own an arithmetic
  // that the summary also owns.
  {
    const report = stripComments(read('components/CostBreakdownReport.tsx'));
    ok('the cost report does not derive its own markup',
      !/globalMarkup/.test(report),
      'the materials-only markup rule is back, and this screen now shows two answers to "what am I making"');
    ok('…it is handed the whole-job figure instead',
      /markupTotal:\s*number/.test(report),
      'CostBreakdownReportProps must declare markupTotal');
    const screen = stripComments(read('app/(tabs)/estimate/full.tsx'));
    ok('…and the estimator passes it the same number the summary renders',
      /markupTotal=\{markupTotal\}/.test(screen),
      'full.tsx must hand CostBreakdownReport the markupTotal it got from cartTotals');
    ok('…which comes from the shared cartTotals, not a re-typed formula',
      /cartTotals\(\{/.test(screen));
    // The RATE on the markup row. Stating the global percent next to a figure
    // that per-item markups actually produced is the same defect one level
    // down: a cart with a 40% tile line read "Overhead & profit (20%)".
    ok('the markup row prints the realized rate, not the global chip',
      !/Overhead &amp; profit \(\{globalMarkup\}/.test(screen) && /shownMarkupPct/.test(screen),
      'both the mobile and the desktop summary must interpolate the effective percent');
    // The at-cost band on the review screen fires on the REALIZED markup, so
    // it must not quote a percentage the estimator's control contradicts.
    const review = stripComments(read('app/(tabs)/estimate/review.tsx'));
    ok('the at-cost band does not quote a percentage it did not measure',
      !/markup is 0%/.test(review),
      'a materials-only cart with hand-zeroed lines fires this band while the global chip reads 20%');
    ok('…and it still names the money, which is the part that was always true',
      /exactly\s*\n?\s*what the work costs you/.test(review) || /what the\s*\n?\s*work costs you/.test(review));
  }

  // ── 12o. "Saved to <project>" must mean the write happened ───────────────
  //
  // The wizard defers the ?projectId link-back until the contractor says what
  // he charges, so the project is not handed an at-cost estimate a beat before
  // the question is asked. The result screen, though, derived "is this
  // attached?" from the ROUTE PARAM — `(projectId && scopedProject) ? projectId
  // : savedProjectId` — and rendered a green check reading "Saved to Henderson
  // Kitchen — open project" over a project that had received nothing. A
  // first-run contractor who dismissed the markup sheet got a positive
  // confirmation of a write that never happened, and the estimate was gone the
  // moment he left the screen. This is structural because the defect is: the
  // label has to read the write, and there is no arithmetic to assert.
  {
    const wizard = stripComments(read('app/estimate-wizard.tsx'));
    ok('the attached-project label is not derived from the route param',
      !/\(projectId && scopedProject\) \? projectId : savedProjectId/.test(wizard),
      'this expression is true before commitAutoLink has run, and it is what put "Saved to X" over an empty project');
    ok('…it is derived from the project actually written to',
      /committedProjectId \?\? savedProjectId/.test(wizard));
    ok('…and that state is set inside the commit, after updateProject',
      /setCommittedProjectId\(targetId\)/.test(wizard));
    ok('…while a deferred link renders as NOT saved, with the way out',
      /Not saved to \{parkedProject\.name\}/.test(wizard),
      'dismissing the markup sheet must leave a visible "not attached yet", not a green check');
  }

  // ── 12p. the AI takeoff prices at HIS markup, not at a screen default ────
  //
  // app/takeoff-estimate.tsx is the screen onboarding sells him on ("AI
  // takeoffs from a PDF"): drop in plans, get a priced estimate, send it. It
  // opened on `useState(15)` and offered four pills — 10/15/20/25 — so a GC
  // whose real markup is 22% could not express it, and whichever pill happened
  // to be lit was multiplied into every line and then written onto the project
  // as `linkedEstimate.globalMarkup`. On a $250K takeoff that is ~$17,500 of
  // overhead and profit given away in a document he believes MAGE priced from
  // his own numbers — and because the value is SAVED, every margin figure the
  // app later reports back to him inherits it.
  //
  // Structural because the defect is structural: there is no arithmetic to
  // assert here, only "does this screen read the answer he already gave". The
  // wizard, Quick Quote and the Full Estimator all read `markupDecided` +
  // `globalMarkup` from MaterialCartContext; this screen read neither, and
  // that is exactly what made it dangerous — every other estimating path gets
  // it right, so he has no reason to check this one.
  {
    const takeoff = stripComments(read('app/takeoff-estimate.tsx'));
    ok('the takeoff estimate does not seed a markup of its own',
      !/useState\(15\)/.test(takeoff),
      'the hardcoded 15% is back: a GC who told the wizard 22% ships this takeoff at 15%');
    ok('…it reads the markup he already gave us',
      /useMaterialCart\(\)/.test(takeoff),
      'this screen must consume MaterialCartContext, not invent a percentage');
    ok('…and only treats it as HIS when he actually answered',
      /markupDecided === true \?/.test(takeoff),
      'markupDecided is null while AsyncStorage answers; reading globalMarkup unconditionally asserts DEFAULT_MARKUP as his choice');
    ok('…the pill ladder is the shared one, not a screen-local four',
      /MARKUP_CHOICES/.test(takeoff) && !/\[10, 15, 20, 25\]/.test(takeoff),
      '10/15/20/25 cannot express 22%, and a second ladder is a second menu for one decision');
    ok('…a free-entry percent exists so any number is reachable',
      /takeoff-markup-custom/.test(takeoff));
    ok('…and every change routes through the single writer',
      /recordMarkupDecision/.test(takeoff),
      'answering here must also answer the wizard and Quick Quote — one decision, one writer');
    // THE WRITE. This is the line that put a guessed percentage on the project.
    ok('the saved estimate carries his markup, not a local default',
      /globalMarkup: markupPct/.test(takeoff),
      'linkedEstimate.globalMarkup is read by the proposal, the contract value and every margin figure downstream');
    ok('…and the Replace path refuses to write an unanswered one',
      /if \(!isMarkupSet\(markupPct\)\)/.test(takeoff),
      'seeding the initial state alone still prices him at whatever pill is lit; the write itself has to refuse');
    // A disabled control that does not say why is just a broken control.
    ok('…with the blocked Save button stating why it is blocked',
      /saveBlocked/.test(takeoff) && /Set your markup to save/.test(takeoff));
    ok('…and the at-cost total says so instead of implying a markup',
      /This total is your cost/.test(takeoff),
      'a cost total with nothing saying so is the defect, not the zero');
  }
}

// ── 13. the CHANGE ORDER prices at his rate, not at his cost ───────────────
//
// The last surface still selling at cost, and the most expensive one to get
// wrong. A base contract gets competed down; the extras are where a small GC's
// margin actually lives. app/change-order.tsx had three ways to put money on a
// change order and all three opened at 0%:
//
//   "Add from Estimate"  copied LinkedEstimateItem.unitPrice — documented COST
//                        per unit, never touched by the markup pass — straight
//                        onto the CO line. Pulling three lines out of his own
//                        estimate priced the added scope at exactly what it
//                        costs him to build.
//   "Add New Item"       had Name / Description / Quantity / Unit / Unit Price
//                        and NO markup control at all, so whatever he typed was
//                        the price. This is the path he uses when the change is
//                        real work rather than a catalogue item.
//   "Search Materials"   had the only markup box on the screen, defaulted to 0
//                        and RESET to 0 after every add, so the percentage did
//                        not survive between two lines of one change order.
//
// And the totals card showed one number, so a $12,000 CO at cost and a $12,000
// CO at 30 points were visually identical — he had no way to notice.
//
// THE RATE ON AN ESTIMATE LINE IS THE LINE'S OWN. The fix deliberately does NOT
// re-run a global markup over a copied estimate line: `lineTotal` already
// carries the rate the owner signed for that item, including a line the
// contractor hand-tuned to 40% in the estimator (the case applyMarkupToItems'
// keep-your-own-markup clause exists to protect). The cart's answered markup is
// the fallback for the two paths with no estimate line behind them.
//
// Structural, because bun cannot import a .tsx screen — same technique and same
// reason as 12p above. The one arithmetic assertion pins the identity the
// screen's division depends on, using the REAL applyMarkupToItems.
{
  const co = stripComments(read('app/change-order.tsx'));

  // The identity the screen divides on. If lineTotal ever stops being
  // "cost x qty x (1 + markup/100)" for the WHOLE quantity, `lineTotal / qty`
  // silently stops being the signed per-unit rate and every CO copied from an
  // estimate is mispriced by a factor of the quantity.
  {
    const priced = applyMarkupToItems([{
      materialId: 'x', name: 'Tile', category: 'Finishes', unit: 'sf',
      quantity: 250, unitPrice: 4, bulkPrice: 4, markup: 40, usesBulk: false,
      lineTotal: 0, supplier: 'Acme',
    }], 15)[0];
    expect('an estimate line\u2019s lineTotal is the WHOLE quantity at its own rate',
      priced.lineTotal, round2(4 * 250 * 1.4));
    expect('\u2026so lineTotal / quantity is the per-unit price the owner signed',
      round2(priced.lineTotal / priced.quantity), round2(4 * 1.4));
    ok('\u2026and that is NOT the cost the CO screen used to copy',
      round2(priced.lineTotal / priced.quantity) !== priced.unitPrice,
      'if these two are ever equal the fixture has no markup and proves nothing');
  }

  // THE COPY ITSELF. Anchored on the picker row shape so a rename cannot leave
  // a stale assertion passing on a field nobody reads any more.
  ok('the estimate picker carries the SELL basis, not just the cost',
    /unitSell: number \| null/.test(co) && /unitCost: number/.test(co),
    'the memo used to emit unitPrice (cost) alone and drop lineTotal, markup ' +
    'and quantity on the floor — there was nothing left to price the CO with');
  ok('\u2026derived per unit from the line the owner signed',
    /item\.lineTotal \/ qty/.test(co),
    'the signed rate is lineTotal / quantity; anything else re-prices a line ' +
    'the owner has already agreed to');
  ok('\u2026with a fallback for a zero quantity, not a division by it',
    /qty > 0 && Number\.isFinite\(item\.lineTotal\)/.test(co));
  ok('\u2026and the add path takes that rate rather than re-running a global markup',
    /pick\.unitSell\s*$/m.test(co) || /const price = pick\.unitSell/.test(co),
    'flattening a hand-tuned 40% line to the cart default is the exact case ' +
    'applyMarkupToItems refuses to do on an estimate');
  ok('the CO screen no longer copies the estimate\u2019s cost onto a line',
    !/unitPrice: item\.unitPrice,\s+total: item\.unitPrice,/.test(co),
    'this is the literal line that sent added scope out at cost');

  // THE TWO PATHS WITH NO ESTIMATE LINE BEHIND THEM.
  ok('the from-scratch paths read the markup he already answered',
    /useMaterialCart\(\)/.test(co),
    'Add New Item and Search Materials must not invent a percentage, and must ' +
    'not ask him a second, contradictory version of a question he has answered');
  ok('\u2026and only treat it as his when he actually answered it',
    /markupDecided === true \?/.test(co),
    'markupDecided is null while AsyncStorage answers; reading globalMarkup ' +
    'unconditionally asserts DEFAULT_MARKUP as his decision');
  ok('the Add New Item modal has a markup control at all',
    /testID="co-new-item-markup"/.test(co),
    'without one, whatever he types in this modal IS the price — and this is ' +
    'the modal he reaches for when the change is labour, not a catalogue item');
  ok('\u2026and the materials markup box no longer resets to zero after each add',
    !/setItemMarkup\('0'\)/.test(co),
    'resetting to 0 meant the second line of a change order went on at cost ' +
    'even when he had just set a percentage for the first');
  ok('\u2026nor opens at a percentage he never chose',
    !/useState\('0'\)/.test(co) && !/useState\(15\)/.test(co),
    'the seed is his answered markup or nothing');

  // THE TOTALS CARD. One number per change order is what made this invisible.
  ok('the totals card splits cost from overhead & profit',
    /Your cost/.test(co) && /Overhead &amp; profit/.test(co),
    'a $12,000 CO at cost and a $12,000 CO at 30 points looked identical');
  ok('\u2026and states the margin as well as the markup',
    /marginFraction/.test(co) && /markup is a share of the cost/.test(co),
    'a contractor who types 25 into a MARKUP field walks away with 20 points ' +
    'of margin; printing one and calling it the other is the confusion itself');
  ok('\u2026computed off a recorded cost basis, not off the price',
    /i\.unitCost \?\? 0\) \* i\.quantity/.test(co),
    'deriving cost from unitPrice makes every margin exactly zero by construction');
  // Anchored on the DERIVATION, not on the word. A bare /basisKnown/ still
  // matched after the flag was pinned to `true`, which re-creates the exact
  // fabricated-0%-margin claim this assertion is here to forbid (caught while
  // mutation-testing this guard).
  ok('a line with NO recorded cost is reported as unknown, never as zero margin',
    /basisKnown: unpriced\.length === 0/.test(co) &&
    /coMargin && !coMargin\.basisKnown/.test(co) &&
    /cannot be shown/.test(co),
    'voice-dictated and allowance-prefill lines carry no cost basis; claiming ' +
    '0% margin on them is an invented fact, which is worse than saying nothing');
  ok('\u2026and an at-cost change order says so in the wizard\u2019s own words',
    /This change order is your cost/.test(co) && /atCost/.test(co),
    'the defect is a cost total with nothing saying so — not the zero itself, ' +
    'which a contractor is entitled to choose');
  ok('\u2026using the same half-cent floor as isAtCost',
    /Math\.abs\(overheadProfit\) < 0\.005/.test(co),
    'an exact equality reads rounding noise on a marked-up CO as at-cost');
}

// ── 14. the change order records WHO is approving it, and by WHEN ──────────
//
// Sending a CO opens a sheet that asks for the approver's name and email and
// even offers the device Contacts. Those two values were used for exactly one
// thing — the string "submitted for approval to Dave (dave@...)" in a toast —
// and the saved ChangeOrder carried no `approvers` and no
// `approvalDeadlineDays`. Four things that are already built went blind:
// followUp/rules.ts R1 (basis 'none', and with no holder its drafted nudge is
// suppressed by guard G4), systemOfAction's chase list, clientBook's
// approval-speed stats, and aiaBilling's pay-application period dating.
//
// The shape is pinned to what app/client-view.tsx merges against, which is the
// part that is easy to get subtly wrong: it finds the FIRST approver with
// `role === 'Client' && status === 'pending'` and stamps the response onto that
// row. Miss the predicate and the portal appends a second approver instead,
// which breaks aiaBilling's last-signature rule.
{
  const co = stripComments(read('app/change-order.tsx'));
  const portal = stripComments(read('app/client-view.tsx'));

  ok('the CO screen writes the approver it just collected',
    /approvers/.test(co) && /role: 'Client'/.test(co) && /status: 'pending'/.test(co),
    'the name and email were collected, emailed, and dropped');
  ok('\u2026in the shape the portal merges against',
    /a\.role === 'Client' && a\.status === 'pending'/.test(co) &&
    /a\.role === 'Client' && a\.status === 'pending'/.test(portal),
    'the writer and the reader must agree on the predicate, or a portal ' +
    'approval pushes a duplicate approver and aiaBilling dates the CO off it');
  ok('\u2026on the UPDATE path too, not only on a brand-new change order',
    /const idx = existing\.findIndex/.test(co),
    're-sending a saved draft is the common case and recorded nothing at all');
  ok('\u2026merging rather than replacing what is already there',
    /\[\.\.\.existing, \{ \.\.\.pendingClientApprover\(\)/.test(co),
    'an approver who has already answered is a signed record');
  ok('\u2026and never clobbering it on a plain draft save',
    /\.\.\.\(approversPatch \? \{ approvers: approversPatch \} : \{\}\)/.test(co),
    'updateChangeOrder spreads the patch over the record, so an explicit ' +
    'undefined key wipes the field');

  ok('the send sheet asks how long this owner gets to respond',
    /approvalDeadlineDays/.test(co) && /testID="co-turnaround-custom"/.test(co),
    'approvalDeadlineDays existed in the type and in the row mapper and had ' +
    'never once been written by the app');
  ok('\u2026without inventing a default when he does not answer',
    /parsedDeadline > 0 \? parsedDeadline : undefined/.test(co),
    'an invented turnaround has the follow-up engine calling an owner late ' +
    'against a deadline the owner never agreed to');
  ok('\u2026and says plainly what happens when it is left blank',
    /not call it late against a deadline nobody agreed to/.test(co),
    'a blank field with no explanation reads as a field he forgot');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
