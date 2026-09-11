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
  // pass receipts with `[]` for labor; app/takeoff-estimate passes neither.
  // Before the completeness gate, the SAME trade+unit key came back at $4.49/SF
  // on the price book, $2.33/SF with receipts only and $2.17/SF with labor only
  // — every wrong one short by an entire cost stream, in the direction that
  // makes a correctly-priced bid look padded. A rate that depends on which
  // screen asked is not a rate.
  expect('the full book prices the self-performed trade',
    round2(lookupRate(spBook, 'Framing', 'SF')?.personalRate ?? 0), round2((80 * 65 + 5_580) / 2_400));
  const spReceiptsOnly = buildCostDatabase([spJob], [], [spReceipt], []);
  expect('a receipts-only book publishes NO materials-only "installed rate" ($2.33/SF)',
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
  // The invariant, stated once: of the books that answer at all, they all
  // agree — over EVERY combination of the streams, not a chosen three.
  const spAnswers = [
    spBook,
    spReceiptsOnly,
    spLaborOnly,
    buildCostDatabase([spJob], [], [miscatReceipt], spLabor),
    buildCostDatabase([spJob], [], [], []),
  ]
    .map(b => lookupRate(b, 'Framing', 'SF')?.personalRate)
    .filter((n): n is number => typeof n === 'number')
    .map(round2);
  expect('every book that prices this trade at all returns the same number',
    new Set(spAnswers).size, 1);
  ok('…and at least one of them does price it, so the invariant is not vacuous',
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
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
