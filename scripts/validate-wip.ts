// validate-wip.ts — unit tests for the pure WIP engine (utils/wip.ts).
// Run via: bun run scripts/validate-wip.ts
//
// Bun executes TypeScript natively — we import the module and exercise the
// pure functions directly. No mocking: utils/wip.ts has zero React Native deps.

import {
  computeWipRow,
  computeWipPortfolio,
  suggestCostToDate,
  suggestBilledToDate,
  suggestRetainageHeld,
  suggestBillingsWithSource,
  wipBillablePayApps,
  payAppPortalStatus,
  contractVsEstimateNote,
  payAppContractHistoryNote,
  wipRowCostAtCompletion,
  wipRowHasCostBasis,
  sumApprovedChangeOrders,
  deriveOriginalContract,
  deriveOriginalContractWithSource,
  deriveEstimatedCost,
  flagWipRow,
  assertPeriodEditable,
  WIP_SOURCE_LABELS,
} from '../utils/wip';
import { wipPeriodToCSV, buildWipHtml, wipLiveAsOfNote } from '../utils/wipExport';
import type {
  WipRowInput, WipRow, WipSnapshotRow, WipPeriod,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project, MaterialReceipt,
} from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n   got:', got, '\n   want:', want); }
}

console.log('\nWIP engine validation:');

// ── Base row: chosen so every output is a clean number ──────────────────────
const base: WipRowInput = {
  originalContract: 100000,
  approvedChangeOrders: 0,
  totalEstimatedCost: 75000,
  costToDate: 30000,
  billedToDate: 45000,
};
const baseRow = computeWipRow(base);

expect('revisedContract = original + approvedCO', baseRow.revisedContract, 100000);
expect('percentComplete = cost/est', baseRow.percentComplete, 0.4);
expect('earnedRevenue = revised * %', baseRow.earnedRevenue, 40000);
expect('overbilling = billed − earned', baseRow.overbilling, 5000);
expect('underbilling = 0 when overbilled', baseRow.underbilling, 0);
expect('estGrossProfit = revised − cost', baseRow.estGrossProfit, 25000);
expect('estGrossMarginPct = profit/revised', baseRow.estGrossMarginPct, 0.25);
expect('profitToDate = earned − cost', baseRow.profitToDate, 10000);
expect('costToComplete = est − cost', baseRow.costToComplete, 45000);
expect('backlog = revised − earned', baseRow.backlog, 60000);

// ── revised contract adds approved change orders ────────────────────────────
expect('revisedContract includes approvedCO',
  computeWipRow({ ...base, approvedChangeOrders: 20000 }).revisedContract, 120000);

// ── ESTIMATED COST TO COMPLETE drives cost at completion ────────────────────
//
// THE DEFECT THIS CLOSES (audit 2026-09-11, the top finding in the WIP area).
// Cost at completion is floored at cost already paid out, because a job cannot
// finish for less than what it has already cost. Correct — and once that floor
// binds, EAC == costToDate, so percentComplete is EXACTLY 1.0 by construction
// and costToComplete and backlog are 0. Measured against the shipped engine
// before the fix: a $550,000 contract with $620,000 incurred returned
// percentComplete 1, earnedRevenue $550,000, costToComplete $0, backlog $0 —
// the engine forecasting that an overrun job will incur no further cost, on
// the document a bank and a surety underwrite, while the job may be 60% built.
{
  const overrun = {
    originalContract: 550_000, approvedChangeOrders: 0,
    // The incurred floor has already bound: EAC == cost to date.
    totalEstimatedCost: 620_000, costToDate: 620_000, billedToDate: 400_000,
  };
  const stale = computeWipRow(overrun);
  expect('WITHOUT an ETC an overrun job still reads 100% complete', stale.percentComplete, 1);
  expect('…the whole contract earned', stale.earnedRevenue, 550_000);
  expect('…nothing left to spend', stale.costToComplete, 0);
  expect('…and no backlog', stale.backlog, 0);

  // The GC says $180,000 of work is still left. EAC = 620,000 + 180,000.
  const revised = computeWipRow({ ...overrun, estimatedCostToComplete: 180_000 });
  expect('an entered ETC sets cost at completion to cost-to-date + ETC',
    revised.estimatedCostAtCompletion, 800_000);
  expect('…percent complete stops being 1 by construction', revised.percentComplete, 620_000 / 800_000);
  expect('…earned revenue follows the real ratio', revised.earnedRevenue, 550_000 * (620_000 / 800_000));
  expect('…cost to complete is what the GC said, not zero', revised.costToComplete, 180_000);
  expect('…backlog reappears', Math.round(revised.backlog), Math.round(550_000 - 550_000 * (620_000 / 800_000)));
  // And the job is now correctly forecast to LOSE money: 800,000 of cost
  // against a 550,000 contract. The stale row reported a 110,000 loss; the
  // revised one reports the whole 250,000.
  expect('…the forecast loss is the real one', revised.estGrossProfit, -250_000);
  expect('…and it is flagged', revised.anticipatedLoss, true);

  // ZERO IS A FORECAST, NOT AN ABSENCE. "Nothing left to spend" must record,
  // or a genuinely finished job cannot be stated.
  const finished = computeWipRow({ ...overrun, estimatedCostToComplete: 0 });
  expect('an ETC of zero is honoured', finished.estimatedCostAtCompletion, 620_000);
  expect('…and reads 100% complete, this time because it IS', finished.percentComplete, 1);
  // A negative cost to complete is not a forecast — fall back to the derivation
  // rather than let it poison the row.
  const negative = computeWipRow({ ...overrun, estimatedCostToComplete: -5_000 });
  expect('a negative ETC is rejected', negative.estimatedCostAtCompletion, 620_000);
  // An ETC can also say a job will cost LESS than a stale estimate says.
  const under = computeWipRow({ ...base, estimatedCostToComplete: 10_000 });
  expect('an ETC below the derived forecast is honoured too',
    under.estimatedCostAtCompletion, 40_000);
  expect('…and every row reports the cost it was actually struck against',
    computeWipRow(base).estimatedCostAtCompletion, 75_000);
}

// ── percentComplete caps at 1 (cost overruns estimate) ──────────────────────
expect('percentComplete caps at 1',
  computeWipRow({ ...base, costToDate: 150000 }).percentComplete, 1);

// ── totalEstimatedCost === 0 guard → percentComplete 0, no NaN ──────────────
const zeroEst = computeWipRow({ ...base, totalEstimatedCost: 0 });
expect('zero est cost → percentComplete 0', zeroEst.percentComplete, 0);
expect('zero est cost → earnedRevenue 0', zeroEst.earnedRevenue, 0);

// ── zero revised contract → estGrossMarginPct 0 (no NaN) ────────────────────
const zeroContract = computeWipRow({
  originalContract: 0, approvedChangeOrders: 0,
  totalEstimatedCost: 5000, costToDate: 1000, billedToDate: 0,
});
expect('zero contract → estGrossMarginPct 0', zeroContract.estGrossMarginPct, 0);
expect('zero contract → backlog 0', zeroContract.backlog, 0);

// ── under-billing branch (billed < earned) ──────────────────────────────────
const under = computeWipRow({ ...base, billedToDate: 25000 });
expect('underbilling = earned − billed', under.underbilling, 15000);
expect('overbilling 0 when underbilled', under.overbilling, 0);

// ── costToComplete never negative ───────────────────────────────────────────
expect('costToComplete floors at 0',
  computeWipRow({ ...base, costToDate: 999999 }).costToComplete, 0);

// ── deductive (negative) change order shrinks the revised contract ──────────
const deductive = computeWipRow({ ...base, approvedChangeOrders: -10000 });
expect('deductive CO → revisedContract 90000', deductive.revisedContract, 90000);
// earnedRevenue scales with the smaller revised contract (0.4 * 90000).
expect('deductive CO → earnedRevenue scales', deductive.earnedRevenue, 36000);

// ── equal billing (billed == earned) → both over- and under-billing are 0 ───
// base is 40% complete on a $100,000 contract → earned $40,000 == billedToDate.
const equalBilling = computeWipRow({ ...base, billedToDate: 40000 });
expect('equal billing → overbilling 0', equalBilling.overbilling, 0);
expect('equal billing → underbilling 0', equalBilling.underbilling, 0);

// ── negative costToDate floors percentComplete at 0 (no negative %) ─────────
const negCost = computeWipRow({ ...base, costToDate: -5000 });
expect('negative costToDate → percentComplete 0', negCost.percentComplete, 0);
expect('negative costToDate → earnedRevenue 0', negCost.earnedRevenue, 0);

// ── negative revised contract → estGrossMarginPct guarded, backlog signed ───
const negContract = computeWipRow({
  originalContract: 100000, approvedChangeOrders: -120000,
  totalEstimatedCost: 50000, costToDate: 10000, billedToDate: 0,
});
expect('negative revised contract computes', negContract.revisedContract, -20000);
expect('negative revised → estGrossMarginPct not NaN',
  Number.isNaN(negContract.estGrossMarginPct), false);

// ── divide-by-zero NaN guard: 0/0 must yield 0, never NaN ───────────────────
const nanGuard = computeWipRow({
  originalContract: 100000, approvedChangeOrders: 0,
  totalEstimatedCost: 0, costToDate: 0, billedToDate: 0,
});
expect('0 cost / 0 est → percentComplete 0 (NaN guard)', nanGuard.percentComplete, 0);
expect('NaN guard → earnedRevenue not NaN', Number.isNaN(nanGuard.earnedRevenue), false);

// ── GAAP anticipated-loss provision: full loss booked immediately ───────────
// revised 100000, est cost 130000 → estGrossProfit -30000 (loss job).
// costToDate 26,000 ÷ EAC 130,000 = 20% complete, from the cost basis itself.
const lossJob = computeWipRow({
  originalContract: 100000, approvedChangeOrders: 0,
  totalEstimatedCost: 130000, costToDate: 26000, billedToDate: 0,
});
expect('loss job flagged anticipatedLoss', lossJob.anticipatedLoss, true);
// Pro-rata would be 20000 - 26000 = -6000; GAAP books the full -30000 loss now.
expect('loss job books full estimated loss', lossJob.profitToDate, -30000);
expect('loss job estGrossProfit = revised − cost', lossJob.estGrossProfit, -30000);
// A profit job keeps the plain earned − cost and is not flagged.
expect('profit job not flagged loss', baseRow.anticipatedLoss, false);
expect('profit job profitToDate = earned − cost', baseRow.profitToDate, 10000);
// When actual loss-to-date already exceeds the total estimated loss, book the
// worse (more negative) actual — provision is a floor, not a cap.
// costToDate 120,000 past an EAC of 110,000 → clamped to 100% complete.
const deepLoss = computeWipRow({
  originalContract: 100000, approvedChangeOrders: 0,
  totalEstimatedCost: 110000, costToDate: 120000, billedToDate: 0,
});
expect('loss provision takes the worse of pro-rata / estimate',
  deepLoss.profitToDate, 100000 - 120000); // earned 100000 − cost 120000 = -20000 (< -10000 est loss)

// ── A LOSS JOB IS NAMED, NOT NETTED ─────────────────────────────────────────
//
// The engine was right at the row level and the roll-up hid it: a $1,000,000
// job at $800,000 of cost beside a $300,000 job at $500,000 returned
// weightedMarginPct 0 — "Weighted margin 0%" printed over a book carrying a
// $200,000 forecast loss, with nothing in WipPortfolio or in either export
// naming it. ASC 605-35-25-46 books the provision per contract and forbids
// offsetting it against a profitable one.
{
  const good = computeWipRow({
    originalContract: 1_000_000, approvedChangeOrders: 0,
    totalEstimatedCost: 800_000, costToDate: 400_000, billedToDate: 0,
  });
  const bad = computeWipRow({
    originalContract: 300_000, approvedChangeOrders: 0,
    totalEstimatedCost: 500_000, costToDate: 250_000, billedToDate: 0,
  });
  const book = computeWipPortfolio([
    { projectId: 'g', projectName: 'Good', input: { originalContract: 1_000_000, approvedChangeOrders: 0, totalEstimatedCost: 800_000, costToDate: 400_000, billedToDate: 0 }, output: good },
    { projectId: 'b', projectName: 'Bad', input: { originalContract: 300_000, approvedChangeOrders: 0, totalEstimatedCost: 500_000, costToDate: 250_000, billedToDate: 0 }, output: bad },
  ]);
  expect('the loss row itself is right', bad.estGrossProfit, -200_000);
  expect('…and flagged', bad.anticipatedLoss, true);
  expect('the weighted margin still nets it away (a WIP total row does sum)',
    book.weightedMarginPct, 0);
  expect('…but the roll-up now COUNTS the loss jobs', book.lossJobCount, 1);
  expect('…names the whole forecast loss, positive', book.totalForecastLoss, 200_000);
  // 50% complete: earned 150,000 − cost 250,000 = −100,000 already incurred;
  // the forecast loss is −200,000; the accrual is the −100,000 not yet spent.
  expect('…and the provision is the part not yet run through cost',
    book.lossProvision, 100_000);
  expect('a healthy book books no provision',
    computeWipPortfolio([{ projectId: 'g', projectName: 'Good', input: { originalContract: 1_000_000, approvedChangeOrders: 0, totalEstimatedCost: 800_000, costToDate: 400_000, billedToDate: 0 }, output: good }]).lossProvision, 0);

  // The roll-up must sum the cost each ROW was struck against, not the
  // derivation it started from — otherwise one ETC-revised job puts a
  // denominator in the total that none of its own margins were measured with.
  const revisedInput = {
    originalContract: 550_000, approvedChangeOrders: 0,
    totalEstimatedCost: 620_000, costToDate: 620_000, billedToDate: 0,
    estimatedCostToComplete: 180_000,
  };
  const revisedRow = { projectId: 'r', projectName: 'R', input: revisedInput, output: computeWipRow(revisedInput) };
  expect('the roll-up sums the cost the row was struck against',
    computeWipPortfolio([revisedRow]).totalEstimatedCost, 800_000);
  expect('…and one helper answers that question everywhere',
    wipRowCostAtCompletion(revisedRow), 800_000);
  // A legacy snapshot has no estimatedCostAtCompletion; the input is what it
  // WAS computed with, so that is the honest fallback.
  expect('a legacy row falls back to the input it was computed with',
    wipRowCostAtCompletion({ projectId: 'l', projectName: 'L', input: base, output: { ...baseRow, estimatedCostAtCompletion: undefined } }), 75_000);
}

// ── portfolio roll-up sums ──────────────────────────────────────────────────
const rows: WipSnapshotRow[] = [
  { projectId: 'a', projectName: 'A', input: base, output: baseRow },
  { projectId: 'b', projectName: 'B',
    input: { ...base, approvedChangeOrders: 20000 },
    output: computeWipRow({ ...base, approvedChangeOrders: 20000 }) },
];
const port = computeWipPortfolio(rows);
expect('portfolio revisedContract sum', port.revisedContract, 220000);
expect('portfolio totalEstimatedCost sum', port.totalEstimatedCost, 150000);
expect('portfolio earnedRevenue sum', port.earnedRevenue, 88000);
expect('portfolio billedToDate sum', port.billedToDate, 90000);
expect('portfolio weightedMarginPct', port.weightedMarginPct, (220000 - 150000) / 220000);
expect('portfolio empty → weightedMarginPct 0', computeWipPortfolio([]).weightedMarginPct, 0);

// RETAINAGE ROLLS UP (adversarial review 2026-09-11 — a green-but-broken
// guard). Nothing pinned this: replacing the accumulation with
// `acc.retainageHeld = (acc.retainageHeld ?? 0);` left NINE validators at
// baseline while the Portfolio strip, the CSV TOTAL and the PDF TOTAL all
// printed $0 retainage held — and types/index.ts says in as many words that
// absent must read as NOT RECORDED rather than zero. $0 is the one figure that
// cell must never assert, because it says the owner is holding nothing back.
{
  const withRet = (id: string, held: number): WipSnapshotRow => ({
    projectId: id, projectName: id,
    input: { ...base, retainageHeld: held },
    output: computeWipRow({ ...base, retainageHeld: held }),
  });
  expect('portfolio retainageHeld sums the rows',
    computeWipPortfolio([withRet('a', 15_000), withRet('b', 5_000)]).retainageHeld, 20_000);
  // A MIXED book — one row frozen before the column shipped — still sums the
  // rows that have it. Absent is not zero on the ROW, but it is the only
  // honest contribution to a SUM, and the sum must not collapse to 0 because
  // one row is legacy.
  expect('…and a mixed legacy/new book sums the rows that have it',
    computeWipPortfolio([
      withRet('a', 15_000),
      { projectId: 'legacy', projectName: 'legacy', input: base, output: baseRow },
    ]).retainageHeld, 15_000);
  expect('…a book with no retainage anywhere rolls up to 0, not undefined',
    computeWipPortfolio([{ projectId: 'l', projectName: 'l', input: base, output: baseRow }]).retainageHeld, 0);
  // …and it reaches the TOTAL cell of the document that leaves the building.
  const retPeriod = {
    id: 'p-ret', periodEndDate: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z',
    rows: [withRet('a', 15_000), withRet('b', 5_000)],
    portfolioTotals: computeWipPortfolio([withRet('a', 15_000), withRet('b', 5_000)]),
  };
  const retLines = wipPeriodToCSV(retPeriod).split('\n');
  const retHeader = retLines[0].split(',');
  expect('…and the CSV TOTAL line prints it',
    retLines[3].split(',')[retHeader.indexOf('Retainage Held')], '20000');
  expect('…and so does the PDF TOTAL',
    buildWipHtml(retPeriod, 'X').includes('<td>$20,000</td>'), true);
}

// ── suggestCostToDate: commitment paidToDate + material-receipt totals ──────
const commitments = [
  { paidToDate: 1000 }, { paidToDate: 500 }, {},
] as unknown as Commitment[];
expect('suggestCostToDate sums paidToDate', suggestCostToDate(commitments), 1500);
expect('suggestCostToDate empty → 0', suggestCostToDate([]), 0);
// Material receipts are never posted into commitment.paidToDate, so they add
// on top with no double-count. Cost-to-date is cost INCURRED, not just sub-paid.
const receipts = [
  { total: 400 }, { total: 120 }, {},
] as unknown as MaterialReceipt[];
expect('suggestCostToDate adds material receipts',
  suggestCostToDate(commitments, receipts), 2020);
expect('suggestCostToDate receipts only', suggestCostToDate([], receipts), 520);

// ── deriveEstimatedCost: cost budget from estimate, NOT the contract value ──
expect('estimated cost from linkedEstimate.baseTotal',
  deriveEstimatedCost(
    { linkedEstimate: { baseTotal: 780000, grandTotal: 1000000 } } as unknown as Project, []),
  780000);
expect('estimated cost falls back to legacy estimate.grandTotal',
  deriveEstimatedCost({ estimate: { grandTotal: 650000 } } as unknown as Project, []),
  650000);
expect('estimated cost falls back to signed commitments',
  deriveEstimatedCost({} as unknown as Project,
    [{ amount: 300000, changeAmount: 20000 }] as unknown as Commitment[]),
  320000);
expect('estimated cost → 0 when no cost basis (prompts manual entry)',
  deriveEstimatedCost({} as unknown as Project, []), 0);
// Regression guard: cost must NOT be sourced from targetBudget (the contract
// value / revenue) — that collapse is what zeroed est gross profit.
expect('estimated cost ignores targetBudget (revenue field)',
  deriveEstimatedCost({ targetBudget: { amount: 1000000 } } as unknown as Project, []), 0);

// ── suggestBilledToDate: pay-apps win when present ──────────────────────────
// AIA billings are CUMULATIVE: take the LATEST app's gross totalCompletedAndStored,
// NOT a sum of currentPaymentDue (which telescopes to net-of-retainage and
// understates billings). Array intentionally out of order to prove max-by-app#.
const payApps = [
  { applicationNumber: 3, totals: { currentPaymentDue: 50000, totalCompletedAndStored: 600000 } },
  { applicationNumber: 6, totals: { currentPaymentDue: 55000, totalCompletedAndStored: 1000000 } },
  { applicationNumber: 4, totals: { currentPaymentDue: 52000, totalCompletedAndStored: 720000 } },
] as unknown as SavedAIAPayApp[];
const invoices = [
  { totalDue: 9999 }, { totalDue: 1 },
] as unknown as Invoice[];
expect('billed: latest pay-app gross (not retainage-net sum of currentPaymentDue)',
  suggestBilledToDate(invoices, payApps), 1000000);
expect('billed: invoices when no pay-apps',
  suggestBilledToDate(invoices, []), 10000);
expect('billed: both empty → 0', suggestBilledToDate([], []), 0);

// ── DRAFT AND RECALLED PAY APPS ARE NOT BILLINGS ────────────────────────────
//
// Axis 1 closed this for invoices and left the PREFERRED branch untouched: a
// G702 saved but never sent, or recalled from the client, still set
// billed-to-date on both bank-facing schedules.
//
// The condition on "draft" is the care in it. app/aia-pay-app.tsx stamps
// `{ status: 'draft' }` on EVERY save, and Generate PDF — how most of this
// product's users actually issue a G702 — routes through the same save. So a
// draft only stops counting once the project has shown it USES the portal.
{
  const app = (n: number, total: number, status?: 'draft' | 'sent' | 'recalled') => ({
    applicationNumber: n,
    totals: { totalCompletedAndStored: total, totalRetainage: total * 0.1 },
    ...(status ? { portalState: { status } } : {}),
  }) as unknown as SavedAIAPayApp;

  expect('a pay app with no portalState at all is a billing (predates the portal)',
    payAppPortalStatus(app(1, 100_000)), 'sent');
  // OFF THE PORTAL: every save is a draft, so every save counts.
  expect('with no application ever sent, a draft still counts',
    suggestBilledToDate([], [app(1, 100_000, 'draft'), app(2, 250_000, 'draft')]), 250_000);
  // ON THE PORTAL: #2 was sent, #3 is a draft the client has never seen.
  expect('once the portal is this job\u2019s channel, an unsent draft stops counting',
    suggestBilledToDate([], [app(1, 100_000, 'sent'), app(2, 250_000, 'sent'), app(3, 400_000, 'draft')]),
    250_000);
  expect('…and would have read $400,000 with no status test at all',
    [app(1, 100_000, 'sent'), app(2, 250_000, 'sent'), app(3, 400_000, 'draft')]
      .reduce((a, b) => (b.applicationNumber >= a.applicationNumber ? b : a)).totals.totalCompletedAndStored,
    400_000);
  // RECALLED is out unconditionally — the GC withdrew it from the client.
  expect('a recalled application is never a billing',
    suggestBilledToDate([], [app(1, 100_000, 'sent'), app(2, 250_000, 'recalled')]), 100_000);
  expect('…and recall alone proves the portal is the channel, so drafts drop too',
    suggestBilledToDate([], [app(1, 100_000, 'recalled'), app(2, 250_000, 'draft')]), 0);
  expect('every application excluded → fall through to the invoices',
    suggestBilledToDate(invoices, [app(1, 100_000, 'recalled')]), 10_000);
  expect('the filter itself keeps the right applications',
    wipBillablePayApps([app(1, 1, 'sent'), app(2, 2, 'draft'), app(3, 3, 'recalled')]).map(a => a.applicationNumber),
    [1]);
}

// ── SALES TAX IS NOT CONTRACT REVENUE ───────────────────────────────────────
//
// The invoice branch summed totalDue (subtotal + tax) while the pay-app branch
// takes the tax-free G703 cumulative figure — and earned revenue is struck
// against a contract derived from tax-free estimate totals. $300,000 of work at
// 8.25% read $324,750 billed, which understates underbilling or flips an
// underbilled job to apparent overbilling on the page a lender reads.
{
  const taxed = [{
    status: 'sent', subtotal: 300_000, taxRate: 8.25, taxAmount: 24_750, totalDue: 324_750,
  }] as unknown as Invoice[];
  expect('billings are net of sales tax', suggestBilledToDate(taxed, []), 300_000);
  expect('…and would have read $324,750 on the old basis', taxed[0].totalDue, 324_750);
  const untaxed = [{ status: 'sent', subtotal: 300_000, taxRate: 0, taxAmount: 0, totalDue: 300_000 }] as unknown as Invoice[];
  expect('a zero-rate invoice is unchanged', suggestBilledToDate(untaxed, []), 300_000);
}

// ── RETAINAGE COMES OFF THE SAME BRANCH AS THE BILLINGS ─────────────────────
//
// Retainage held is a receivable a surety asks for by name, and it was absent
// from the flagship schedule entirely. Billings from the pay apps and retainage
// from the invoices would report a figure a bank cannot reconcile to anything
// on the page, so one branch decides both.
{
  const withRetainage = [{
    applicationNumber: 4,
    totals: { totalCompletedAndStored: 500_000, totalRetainage: 50_000 },
  }] as unknown as SavedAIAPayApp[];
  const billings = suggestBillingsWithSource([], withRetainage);
  expect('the pay-app branch carries its own cumulative retainage', billings.retainageHeld, 50_000);
  expect('…and says which branch answered', billings.basis, 'pay_apps');
  expect('the wrapper reads the same figure', suggestRetainageHeld([], withRetainage), 50_000);
  expect('no billings at all is reported as no branch',
    suggestBillingsWithSource([], []).basis, 'none');
}

// ── THE CONTRACT BRANCH IS DEFENSIVE ────────────────────────────────────────
//
// It read payApps[0].originalContractSum and trusted it. [0] is only "latest"
// because one caller happens to sort; a recalled application is withdrawn; and
// one contract has ONE original sum, so applications that disagree about it
// mean a phantom or a re-seed, not a figure to pick a winner from.
{
  const pa = (n: number, sum: number, status?: 'draft' | 'sent' | 'recalled') => ({
    applicationNumber: n, originalContractSum: sum,
    ...(status ? { portalState: { status } } : {}),
  }) as unknown as SavedAIAPayApp;
  const proj = { linkedEstimate: { grandTotal: 550_000, baseTotal: 400_000 } } as unknown as Project;

  // Sums that AGREE (within the $1 tolerance) still resolve to the latest
  // application by number, not to whatever sits at index 0 — this module is
  // pure and takes an array from any caller, and only one of them sorts.
  expect('the LATEST application by number answers, not array position',
    deriveOriginalContract(proj, [], [pa(1, 700_000), pa(3, 700_000.4), pa(2, 700_000.2)]), 700_000.4);
  expect('…and a scrambled array of identical sums is stable',
    deriveOriginalContract(proj, [], [pa(3, 700_000), pa(1, 700_000)]), 700_000);
  expect('a recalled application does not set the contract',
    deriveOriginalContract(proj, [], [pa(1, 700_000), pa(2, 999_000, 'recalled')]), 700_000);
  // APPLICATIONS THAT DISAGREE — THE LATEST ONE WINS, AND THE DISAGREEMENT IS
  // DISCLOSED (adversarial review 2026-09-11). An earlier pass ABANDONED the
  // whole branch here whenever two surviving applications differed by more than
  // a dollar, ran the estimate chain instead and stamped a
  // `pay_app_contract_conflict` source on the export. That looked defensive and
  // was a regression on a bank document, because the disagreement is the
  // ORDINARY case: seedAIAPayApplicationFromInvoice re-derives
  // `originalContractSum` from `effectiveEstimateTotal(project)` on every new
  // application, so two saved certificates disagree whenever the estimate moved
  // between them (a re-price, a committed change order). Measured on the old
  // code: apps #1 $550,000 and #2 $700,000 with the estimate now at $600,000
  // returned $600,000 — a $100,000 understatement of a contract the GC had
  // certified to the owner, under a source cell telling a banker to check the
  // G702s on a job with nothing wrong with it.
  const disagreeing = [pa(1, 550_000), pa(2, 700_000)];
  const resolved = deriveOriginalContractWithSource(proj, [], disagreeing);
  expect('applications that disagree resolve to the LATEST certified sum',
    resolved.value, 700_000);
  expect('…on the clean branch, because that IS where the figure came from',
    resolved.source, 'pay_app_contract_sum');
  expect('…and it is NOT the estimate the old conflict branch fell through to',
    resolved.value === 550_000, false);
  expect('…the disagreement is disclosed in words instead',
    /550,000 to \$700,000/.test(payAppContractHistoryNote(disagreeing))
      && /application #2/.test(payAppContractHistoryNote(disagreeing)),
    true);
  expect('…and there is no conflict source left to stamp on an export',
    Object.keys(WIP_SOURCE_LABELS).filter((k) => /conflict/.test(k)), []);
  expect('a one-dollar rounding difference is not a disagreement',
    payAppContractHistoryNote([pa(1, 700_000), pa(2, 700_000.5)]), '');
  expect('…and neither is a single application',
    payAppContractHistoryNote([pa(1, 700_000)]), '');
  expect('…nor two that agree',
    payAppContractHistoryNote([pa(1, 700_000), pa(2, 700_000)]), '');
  // The note reads the SAME population the branch does, so an unissued draft
  // cannot manufacture a disclosure any more than it can manufacture a figure.
  expect('an unissued draft raises no disagreement note',
    payAppContractHistoryNote([
      { applicationNumber: 1, originalContractSum: 700_000,
        portalState: { status: 'sent', sentAt: '2026-02-01', sentVersion: 1 } },
      { applicationNumber: 2, originalContractSum: 800_000, portalState: { status: 'draft' } },
    ] as unknown as SavedAIAPayApp[]),
    '');

  // AN UNISSUED DRAFT CANNOT MANUFACTURE A CONFLICT (adversarial review
  // 2026-09-11). This branch filtered `recalled` only, while the BILLINGS
  // branch beside it goes through `wipBillablePayApps`. Measured on a portal
  // job with #1 and #2 SENT at a certified $700,000 and #3 a mid-edit draft
  // re-seeded at $800,000: the draft entered the disagreement test, no two
  // issued documents disagreed about anything, and the whole chain fell through
  // to the estimate under `pay_app_contract_conflict` — the revised contract on
  // a surety schedule dropped 21%, entirely on the strength of a document the
  // client has never seen.
  const sent = (n: number, sum: number) => ({
    applicationNumber: n, originalContractSum: sum,
    portalState: { status: 'sent', sentAt: '2026-02-01', sentVersion: 1 },
  }) as unknown as SavedAIAPayApp;
  const withDraft = deriveOriginalContractWithSource(
    proj, [], [sent(1, 700_000), sent(2, 700_000), pa(3, 800_000, 'draft')],
  );
  expect('a disagreeing DRAFT does not become the latest certified sum',
    withDraft.value, 700_000);
  expect('…and the source is the clean branch',
    withDraft.source, 'pay_app_contract_sum');
  expect('…which is what the same book without the draft returns',
    deriveOriginalContractWithSource(proj, [], [sent(1, 700_000), sent(2, 700_000)]).value, 700_000);
  // …and the OFF-PORTAL GC keeps his drafts here exactly as he keeps them in
  // the billings: `wipBillablePayApps` owns that distinction, and this branch
  // now reads the same population rather than carrying a second rule.
  expect('an off-portal GC\'s drafts still set the contract',
    deriveOriginalContract(proj, [], [pa(1, 700_000, 'draft'), pa(2, 700_000, 'draft')]), 700_000);
  expect('…and the latest of them answers even when they disagree',
    deriveOriginalContract(proj, [], [pa(1, 700_000, 'draft'), pa(2, 550_000, 'draft')]), 550_000);
  expect('…with the disagreement disclosed rather than acted on',
    /700,000/.test(payAppContractHistoryNote([pa(1, 700_000, 'draft'), pa(2, 550_000, 'draft')])), true);
  expect('…while a recalled one proves the portal IS the channel, so a draft is out',
    deriveOriginalContract(proj, [], [pa(1, 700_000, 'recalled'), pa(2, 800_000, 'draft'), sent(3, 700_000)]),
    700_000);

  // A pay-app contract that merely differs from the estimate is ORDINARY and
  // is NOT overridden — it is disclosed.
  const wide = deriveOriginalContractWithSource(proj, [], [pa(1, 700_000)]);
  expect('a contract above the estimate still wins', wide.value, 700_000);
  expect('…and the disagreement is disclosed in words',
    /150,000 ABOVE/.test(contractVsEstimateNote(wide, 550_000)), true);
  expect('…a contract in line with the estimate says nothing',
    contractVsEstimateNote({ value: 552_000, source: 'pay_app_contract_sum' }, 550_000), '');
  expect('…and a contract that did NOT come off a pay app says nothing either',
    contractVsEstimateNote({ value: 900_000, source: 'target_budget' }, 550_000), '');
}

// ── change-order COST tracks change-order REVENUE ───────────────────────────
// computeWipRow adds approved COs to revisedContract (revenue). If the cost
// budget stays frozen at the original estimate, every CO books at 100% margin.
// A WIP schedule is what a surety and a bank underwrite against, so an
// overstated profit here is not cosmetic.
//
// ChangeOrder has no cost field (lineItems carry PRICED unitPrice/total), so
// CO cost is estimated at the job's own cost ratio — the standard convention.
{
  // $1,000,000 contract, $800,000 cost budget → 20% margin, ratio 0.8.
  const proj = { linkedEstimate: { baseTotal: 800_000 } } as unknown as Project;

  expect('no COs → cost budget unchanged',
    deriveEstimatedCost(proj, [], { approvedChangeOrders: 0, originalContract: 1_000_000 }),
    800_000);

  // $100k of approved COs at the same 0.8 cost ratio → +$80k cost.
  expect('CO cost is added at the job cost ratio',
    deriveEstimatedCost(proj, [], { approvedChangeOrders: 100_000, originalContract: 1_000_000 }),
    880_000);

  // The whole point: margin must stay ~20%, not jump because COs were free.
  const row = computeWipRow({
    originalContract: 1_000_000,
    approvedChangeOrders: 100_000,
    totalEstimatedCost: deriveEstimatedCost(proj, [], {
      approvedChangeOrders: 100_000, originalContract: 1_000_000,
    }),
    costToDate: 0, billedToDate: 0,
  });
  expect('revised contract still includes CO revenue', row.revisedContract, 1_100_000);
  expect('est gross profit is the REAL margin on the whole job',
    row.estGrossProfit, 220_000);
  expect('margin holds at 20% rather than inflating',
    Math.round(row.estGrossMarginPct * 10_000) / 10_000, 0.2);

  // For reference, the OLD behaviour left the cost budget at 800k and reported
  // $300k profit / 27.3% margin on this exact job. The two assertions above
  // fail if that returns.

  // Loss jobs: ratio > 1 means the CO correctly deepens the loss.
  const lossProj = { linkedEstimate: { baseTotal: 1_200_000 } } as unknown as Project;
  expect('a loss job carries its loss ratio onto the CO',
    deriveEstimatedCost(lossProj, [], { approvedChangeOrders: 100_000, originalContract: 1_000_000 }),
    1_320_000);

  // No contract basis → 1.0 ratio (zero margin on the CO). Understating profit
  // is the safe direction on a surety document; 0 cost would be the unsafe one.
  expect('no contract basis falls back to zero-margin, never zero-cost',
    deriveEstimatedCost(proj, [], { approvedChangeOrders: 100_000, originalContract: 0 }),
    900_000);

  // The commitments branch ALREADY includes CO cost via c.changeAmount, so it
  // must not be topped up again.
  expect('commitments branch is not double counted',
    deriveEstimatedCost({} as unknown as Project,
      [{ amount: 500_000, changeAmount: 50_000 } as unknown as Commitment],
      { approvedChangeOrders: 50_000, originalContract: 1_000_000 }),
    550_000);

  // Omitting opts keeps the original-scope cost — used for baseline compares.
  expect('omitting opts returns original-scope cost', deriveEstimatedCost(proj, []), 800_000);
}

// ── sumApprovedChangeOrders: only approved status counts ────────────────────
const cos = [
  { status: 'approved', changeAmount: 5000 },
  { status: 'draft', changeAmount: 9999 },
  { status: 'approved', changeAmount: 1500 },
  { status: 'rejected', changeAmount: 7777 },
] as unknown as ChangeOrder[];
expect('sumApprovedChangeOrders only approved', sumApprovedChangeOrders(cos), 6500);

// ── deriveOriginalContract precedence: pay-app > CO > targetBudget > gmpCap ──
expect('originalContract from pay-app',
  deriveOriginalContract(
    { targetBudget: { amount: 111 }, gmpCap: 222 } as unknown as Project,
    [{ originalContractValue: 333 }] as unknown as ChangeOrder[],
    [{ originalContractSum: 88000 }] as unknown as SavedAIAPayApp[]),
  88000);
expect('originalContract falls back to CO',
  deriveOriginalContract(
    { targetBudget: { amount: 111 }, gmpCap: 222 } as unknown as Project,
    [{ originalContractValue: 333 }] as unknown as ChangeOrder[], []),
  333);
expect('originalContract falls back to targetBudget',
  deriveOriginalContract(
    { targetBudget: { amount: 111 }, gmpCap: 222 } as unknown as Project, [], []),
  111);
expect('originalContract falls back to gmpCap',
  deriveOriginalContract({ gmpCap: 222 } as unknown as Project, [], []), 222);
expect('originalContract → 0 when nothing available',
  deriveOriginalContract({} as unknown as Project, [], []), 0);

// ── MONEY-F10: two approved COs must not count the first one twice ──────────
// app/change-order.tsx stamps each CO's originalContractValue as
//   estimate grandTotal + Σ OTHER approved COs at save time
// and getChangeOrdersForProject hands them out newest-first, so
// `changeOrders[0]` (CO#2) already contained CO#1. $500,000 estimate, CO#1
// +$20,000, CO#2 +$30,000: pre-fix original = $520,000 → revised $570,000,
// earned revenue at 40% $228,000, underbilling $8,000 — on the schedule a
// surety underwrites. The truth is $550,000 / $220,000 / $0.
{
  const proj = { linkedEstimate: { grandTotal: 500_000, baseTotal: 400_000 } } as unknown as Project;
  const twoCOs = [ // newest first, exactly as the context sorts them
    { id: 'co2', number: 2, status: 'approved', changeAmount: 30_000, originalContractValue: 520_000, createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'co1', number: 1, status: 'approved', changeAmount: 20_000, originalContractValue: 500_000, createdAt: '2026-02-01T00:00:00.000Z' },
  ] as unknown as ChangeOrder[];
  const original = deriveOriginalContract(proj, twoCOs, []);
  expect('original contract is the base contract, not the newest CO\'s CO-inclusive snapshot',
    original, 500_000);
  const row = computeWipRow({
    originalContract: original,
    approvedChangeOrders: sumApprovedChangeOrders(twoCOs),
    totalEstimatedCost: 440_000, costToDate: 176_000, billedToDate: 220_000,
  });
  expect('revised contract = $550,000 (was $570,000)', row.revisedContract, 550_000);
  expect('earned revenue at 40% = $220,000 (was $228,000)', row.earnedRevenue, 220_000);
  expect('underbilling is $0, not the $8,000 the double count invented', row.underbilling, 0);

  // A deductive CO approved first: the later CO's snapshot sits BELOW the base
  // contract, so "smallest snapshot" alone would shrink the original by $10k.
  const deductiveFirst = [
    { id: 'co2', number: 2, status: 'approved', changeAmount: 30_000, originalContractValue: 490_000 },
    { id: 'co1', number: 1, status: 'approved', changeAmount: -10_000, originalContractValue: 500_000 },
  ] as unknown as ChangeOrder[];
  expect('a deductive CO approved first does not shrink the original contract',
    deriveOriginalContract(proj, deductiveFirst, []), 500_000);

  // No estimate on the project — nothing to reconstruct from — so the least
  // CO-inclusive snapshot is the closest thing to the base contract.
  expect('without an estimate, the smallest positive CO snapshot wins, never the newest',
    deriveOriginalContract({} as unknown as Project, twoCOs, []), 500_000);
  expect('a pay app still outranks the CO reconstruction',
    deriveOriginalContract(proj, twoCOs, [{ originalContractSum: 505_000 }] as unknown as SavedAIAPayApp[]),
    505_000);
  // The CO cost ratio inherits the corrected base: 0.8 × $50,000 of CO revenue.
  expect('deriveEstimatedCost prices the COs at the corrected cost ratio',
    deriveEstimatedCost(proj, [], { approvedChangeOrders: 50_000, originalContract: original }), 440_000);
}

// ── flagWipRow: profit fade (margin drops > 2 pts vs prior) ─────────────────
const prevHiMargin = computeWipRow({ ...base, totalEstimatedCost: 70000 }); // 0.30 margin
const curLoMargin  = computeWipRow({ ...base, totalEstimatedCost: 75000 }); // 0.25 margin
const fade = flagWipRow(curLoMargin, prevHiMargin);
expect('profit fade detected', fade.profitFade, true);
expect('profit fade produces a reason', fade.reasons.length > 0, true);

const steady = flagWipRow(baseRow, baseRow);
expect('no profit fade when margin steady', steady.profitFade, false);

// ── flagWipRow: billing swing (> 5% of revised contract) ────────────────────
const prevBalanced = computeWipRow({ ...base, billedToDate: 40000 }); // net 0
const curOverbill  = computeWipRow({ ...base, billedToDate: 55000 }); // overbilled 15000
const swing = flagWipRow(curOverbill, prevBalanced);
expect('billing swing detected', swing.billingSwing, true);

const smallSwing = flagWipRow(
  computeWipRow({ ...base, billedToDate: 41000 }), // overbilled 1000
  computeWipRow({ ...base, billedToDate: 40000 })); // net 0 → swing 1000 < 5000
expect('no billing swing under threshold', smallSwing.billingSwing, false);

// ── flagWipRow: schedule divergence (cost% vs EVM schedule% > 10 pts) ───────
const diverge = flagWipRow(baseRow, undefined, { schedulePercent: 0.65 }); // cost 0.40
expect('schedule divergence detected', diverge.scheduleDivergence, true);
const aligned = flagWipRow(baseRow, undefined, { schedulePercent: 0.45 });
expect('no divergence when aligned', aligned.scheduleDivergence, false);
expect('no divergence without EVM', flagWipRow(baseRow).scheduleDivergence, false);

// ── assertPeriodEditable: locked period is immutable ────────────────────────
expect('locked period blocked',
  assertPeriodEditable({ lockedAt: '2026-07-08T00:00:00.000Z' }).blocked, true);
expect('unlocked period editable',
  assertPeriodEditable({ lockedAt: undefined }).blocked, false);

// ── wipPeriodToCSV: header + one row + TOTAL line ───────────────────────────
const csvPeriod: WipPeriod = {
  id: 'p1', periodEndDate: '2026-07-08', createdAt: '2026-07-08T00:00:00.000Z',
  rows: [{ projectId: 'a', projectName: 'Alpha, LLC', input: base, output: baseRow }],
  portfolioTotals: computeWipPortfolio([{ projectId: 'a', projectName: 'Alpha, LLC', input: base, output: baseRow }]),
};
const csv = wipPeriodToCSV(csvPeriod);
const csvLines = csv.split('\n');
expect('CSV has header + 1 row + TOTAL', csvLines.length, 3);
expect('CSV header first column', csvLines[0].split(',')[0], 'Project');
expect('CSV quotes commas in project name', csvLines[1].startsWith('"Alpha, LLC"'), true);
expect('CSV last line is TOTAL', csvLines[2].startsWith('TOTAL'), true);

// ── THE EXPORT CARRIES WHAT THE ROW CARRIES ─────────────────────────────────
//
// Six columns were dropped, every one of them already on the row being
// iterated: original contract and approved change orders separately (how an
// underwriter sees scope growth), cost to complete and gross profit to date
// (how he detects fade and ties the schedule to an income statement),
// retainage held (asked for by name on every surety submission), and the loss
// marker (the app's flagship ASC 605-35 claim, which appeared in NO export).
{
  const header = csvLines[0].split(',');
  for (const col of [
    'Loss Job', 'Original Contract', 'Approved Change Orders', 'Cost to Complete',
    'Retainage Held', 'Gross Profit to Date',
  ]) {
    expect(`CSV prints "${col}"`, header.includes(col), true);
  }
  // The three Source columns must still sit immediately after their figures —
  // scripts/validate-wip-provenance.ts pins that too, and a reordering that
  // separated them would put a CPA's eye on the wrong number.
  for (const [figure, source] of [
    ['Revised Contract', 'Revised Contract Source'],
    ['Total Est Cost', 'Total Est Cost Source'],
    ['Cost to Date', 'Cost to Date Source'],
  ]) {
    expect(`"${source}" still sits immediately after "${figure}"`,
      header.indexOf(source) === header.indexOf(figure) + 1, true);
  }

  // A LOSS JOB IS NAMED IN THE EXPORT, and the provision gets its own line —
  // the TOTAL row nets the loss against profitable jobs, which is correct for a
  // WIP total and exactly why the accrual cannot be left inside it.
  const lossInput = {
    originalContract: 300_000, approvedChangeOrders: 0,
    totalEstimatedCost: 500_000, costToDate: 250_000, billedToDate: 0,
    retainageHeld: 12_500,
  };
  const lossRow = { projectId: 'l', projectName: 'Underwater', input: lossInput, output: computeWipRow(lossInput) };
  const lossCsv = wipPeriodToCSV({
    id: 'p2', periodEndDate: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z',
    rows: [lossRow], portfolioTotals: computeWipPortfolio([lossRow]),
  });
  const lossLines = lossCsv.split('\n');
  const lossCells = lossLines[1].split(',');
  expect('a loss job is named in words, not left to a negative number',
    lossCells[header.indexOf('Loss Job')], 'LOSS JOB');
  expect('…retainage held reaches the cell',
    lossCells[header.indexOf('Retainage Held')], '12500');
  expect('…and gross profit to date carries the FULL provisioned loss',
    lossCells[header.indexOf('Gross Profit to Date')], '-200000');
  expect('the TOTAL line counts the loss jobs', lossLines[2].split(',')[1], '1 LOSS JOB');
  expect('…and a provision line follows it',
    lossLines[3].startsWith('PROVISION FOR LOSS ON UNCOMPLETED CONTRACTS'), true);
  expect('…carrying the accrual, not the whole forecast loss',
    lossLines[3].split(',')[header.indexOf('Gross Profit to Date')], '-100000');
  // A healthy book prints no provision line at all — a "$0 provision" invites
  // the question of which job it is for.
  expect('a healthy book prints no provision line',
    csvLines.some((l) => l.startsWith('PROVISION')), false);

  // A snapshot frozen before the retainage column existed says NOTHING, never
  // $0 — printing zero asserts the owner is holding nothing back, which is the
  // opposite of the truth on most contracts.
  // (Built fresh with a comma-free name so a naive split lines up — the row
  // above is deliberately named "Alpha, LLC" to prove the quoting.)
  const legacyRow = { projectId: 'x', projectName: 'Pre-retainage', input: base, output: baseRow };
  const legacyCells = wipPeriodToCSV({
    id: 'p3', periodEndDate: '2026-06-30', createdAt: '2026-06-30T00:00:00.000Z',
    rows: [legacyRow], portfolioTotals: computeWipPortfolio([legacyRow]),
  }).split('\n')[1].split(',');
  expect('a period frozen before retainage shipped leaves the cell blank',
    legacyCells[header.indexOf('Retainage Held')], '');
}

// ── THE EXPORTS PRINT THE COST THE ROW WAS STRUCK AGAINST ───────────────────
//
// THE HOLE THIS CLOSES (adversarial review 2026-09-11). `wipRowCostAtCompletion`
// was pinned on computeWipPortfolio and on the helper itself, and NOWHERE on the
// two documents that leave the building: reverting BOTH export call sites to
// `r.input.totalEstimatedCost` left test:wip, test:money-basis-parity and
// test:wip-provenance all green, and the PDF would then print the pre-ETC
// $620,000 denominator beside a margin measured against $800,000. Three places
// read it now — the CSV cell, the PDF table cell, and the PDF's "where these
// figures come from" footnote, which was still printing the input regardless.
/**
 * Split one CSV line into fields, honouring RFC-4180 quoting.
 *
 * A naive `split(',')` misaligns the moment a Source cell carries a comma —
 * and several WIP_SOURCE_LABELS do, at length. An assertion reading the wrong
 * column is worse than no assertion, because it passes on the wrong figure.
 */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

console.log('\nthe exports print the cost the row was struck against:');
{
  const etcInput: WipRowInput = {
    originalContract: 550_000, approvedChangeOrders: 0,
    totalEstimatedCost: 620_000, costToDate: 620_000, billedToDate: 400_000,
    retainageHeld: 40_000, estimatedCostToComplete: 180_000,
  };
  const etcRow: WipSnapshotRow = {
    projectId: 'etc', projectName: 'Ridgeline', input: etcInput, output: computeWipRow(etcInput),
    sources: {
      originalContract: 'estimate_grand_total',
      totalEstimatedCost: 'cost_to_complete_entered',
      costToDate: 'commitments_and_receipts',
    },
  } as WipSnapshotRow;
  const etcPeriod = {
    id: 'p-etc', periodEndDate: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z',
    rows: [etcRow], portfolioTotals: computeWipPortfolio([etcRow]),
  };
  const etcCsv = wipPeriodToCSV(etcPeriod).split('\n');
  const etcHeader = csvFields(etcCsv[0]);
  const etcCells = csvFields(etcCsv[1]);
  expect('the CSV Total Est Cost cell is the ETC-struck figure, not the input',
    etcCells[etcHeader.indexOf('Total Est Cost')], '800000');
  expect('…and the derivation it replaced was 620000', etcInput.totalEstimatedCost, 620_000);
  const etcHtml = buildWipHtml(etcPeriod, 'Harlow Construction LLC');
  expect('the PDF Est Cost at Completion cell is the ETC-struck figure',
    /<td>\$800,000<\/td>/.test(etcHtml), true);
  // Narrow on purpose: $620,000 IS the cost-to-date and belongs on the page.
  // What must not appear is a SECOND $620,000 in the est-cost-at-completion
  // position, which is what `input.totalEstimatedCost` would have printed.
  expect('…and it is not the input figure repeated beside cost-to-date',
    /<td>\$620,000<\/td>\s*<td>\$620,000<\/td>/.test(etcHtml), false);
  expect('…including in the provenance footnote, which read the input',
    /Total estimated cost \$800,000/.test(etcHtml), true);
  expect('…and the footnote names whose forecast it is',
    /cost to complete YOU entered/.test(etcHtml), true);

  // ── THE LIVE EXPORT DISCLOSES ITS OWN BACKDATING ──────────────────────────
  // `defaultPeriodEnd` returns the PRIOR month end on days 1-14 and
  // `exportPeriod` stamps it onto the live period, so a PDF headed "As of
  // 2026-08-31" left the building carrying September 11 figures with nothing
  // saying so. MAGE has no as-of ledger; the document has to say it.
  const live = { ...etcPeriod, id: 'live', periodEndDate: '2026-08-31' };
  expect('a live period dated before today discloses it',
    /as they stand on 2026-09-11/.test(wipLiveAsOfNote(live, '2026-09-11')), true);
  expect('…and says it is not restated',
    /NOT restated/.test(wipLiveAsOfNote(live, '2026-09-11')), true);
  expect('a live period dated TODAY says nothing', wipLiveAsOfNote({ ...live, periodEndDate: '2026-09-11' }, '2026-09-11'), '');
  expect('a SAVED period says nothing either — its rows really were frozen then',
    wipLiveAsOfNote(etcPeriod, '2026-09-11'), '');
  expect('…and the note reaches the PDF subtitle',
    /class="asof">Figures are as they stand on 2026-09-11/.test(buildWipHtml(live, 'X', '2026-09-11')), true);
  expect('…and the CSV', wipPeriodToCSV(live, '2026-09-11').includes('as they stand on 2026-09-11'), true);

  // ── F14: A CONTRACT WITH NO COST BASIS PRINTS NO GROSS PROFIT ─────────────
  const bareInput: WipRowInput = {
    originalContract: 900_000, approvedChangeOrders: 0,
    totalEstimatedCost: 0, costToDate: 0, billedToDate: 0,
  };
  const bareRow: WipSnapshotRow = {
    projectId: 'bare', projectName: 'Budget only', input: bareInput, output: computeWipRow(bareInput),
  };
  expect('the ROW still reports the fabricated margin (the engine is unchanged)',
    bareRow.output.estGrossMarginPct, 1);
  expect('…but the schedule knows it has no cost basis', wipRowHasCostBasis(bareRow), false);
  expect('…and a job that has only SPENT money does have one',
    wipRowHasCostBasis({ ...bareRow, input: { ...bareInput, costToDate: 1 } }), true);
  const barePeriod = {
    id: 'p-bare', periodEndDate: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z',
    rows: [bareRow, etcRow], portfolioTotals: computeWipPortfolio([bareRow, etcRow]),
  };
  const bareCsv = wipPeriodToCSV(barePeriod).split('\n');
  const bareHeader = csvFields(bareCsv[0]);
  expect('the CSV prints NOTHING for its est gross profit, never $900,000',
    csvFields(bareCsv[1])[bareHeader.indexOf('Est Gross Profit')], '');
  expect('…the measurable job still prints its own',
    csvFields(bareCsv[2])[bareHeader.indexOf('Est Gross Profit')], '-250000');
  expect('…the TOTAL excludes the unmeasurable one',
    csvFields(bareCsv[3])[bareHeader.indexOf('Est Gross Profit')], '-250000');
  expect('…and a memo line names it rather than suppressing it silently',
    bareCsv.some((l) => l.startsWith('"NO COST BASIS — 1 contract (Budget only)')), true);
  const bareHtml = buildWipHtml(barePeriod, 'Harlow Construction LLC');
  expect('the PDF prints an em dash for it', /<td>—<\/td>/.test(bareHtml), true);
  expect('…and $900,000 of fabricated profit appears nowhere',
    bareHtml.includes('$900,000</td>\n    <td>$900,000'), false);
  expect('…and the page carries the no-cost-basis disclosure',
    /class="nobasis"/.test(bareHtml) && /No cost basis — 1 contract\s+totalling \$900,000/.test(bareHtml), true);
  const barePortfolio = computeWipPortfolio([bareRow, etcRow]);
  expect('the weighted margin excludes it from BOTH sides',
    Math.round(barePortfolio.weightedMarginPct * 10_000) / 10_000,
    Math.round(((550_000 - 800_000) / 550_000) * 10_000) / 10_000);
  expect('…and the roll-up counts what it could not measure', barePortfolio.noCostBasisCount, 1);
  expect('…and the contract it cannot speak for', barePortfolio.noCostBasisContract, 900_000);

  // ── THE TOTAL ROW MUST CROSS-FOOT, OR A LINE MUST SAY WHY IT DOES NOT
  // (adversarial review 2026-09-11). A surety cross-foots the total line of a
  // WIP schedule: Revised Contract − Total Est Cost = Est Gross Profit. On a
  // book with a costless job it cannot, because the contract column sums the
  // whole book (correct) and Est Gross Profit is struck on the measurable
  // subset (also correct) — 1,900,000 − 800,000 = 1,100,000 beside a cell
  // reading 200,000, a $900,000 discrepancy inside one row. The reconciling
  // line is what closes it, and it has to actually foot.
  const bareTotalCells = csvFields(bareCsv[3]);
  const subLine = bareCsv.find((l) => l.startsWith('MEASURABLE SUBTOTAL'));
  expect('a book with an unmeasurable job carries a measurable subtotal line',
    subLine != null, true);
  const subCells = csvFields(subLine ?? '');
  const num = (v: string) => Number(v || '0');
  expect('…and THAT line cross-foots exactly',
    num(subCells[bareHeader.indexOf('Revised Contract')])
      - num(subCells[bareHeader.indexOf('Total Est Cost')]),
    num(subCells[bareHeader.indexOf('Est Gross Profit')]));
  expect('…on the measurable contract, not the whole book',
    num(subCells[bareHeader.indexOf('Revised Contract')]), 550_000);
  expect('…while the TOTAL row itself deliberately does NOT foot, which is why the line exists',
    num(bareTotalCells[bareHeader.indexOf('Revised Contract')])
      - num(bareTotalCells[bareHeader.indexOf('Total Est Cost')])
      !== num(bareTotalCells[bareHeader.indexOf('Est Gross Profit')]),
    true);
  expect('…and the PDF carries the same reconciling line',
    /MEASURABLE SUBTOTAL \(1 of 2 jobs\)/.test(bareHtml), true);
  // A fully measurable book already foots, so no second line is printed.
  expect('a fully measurable book prints no subtotal line',
    wipPeriodToCSV(etcPeriod).split('\n').some((l) => l.startsWith('MEASURABLE SUBTOTAL')), false);
  expect('…and neither does its PDF',
    /MEASURABLE SUBTOTAL/.test(buildWipHtml(etcPeriod, 'X')), false);

  // ── THE PDF's ASC 605-35 DISCLOSURE IS PINNED, NOT JUST THE CSV's
  // (adversarial review 2026-09-11 — a green-but-broken guard). The CSV
  // provision line was asserted above; `provisionHtml` was not, so forcing it
  // to return '' deleted the flagship accounting disclosure from the exported
  // PDF with all four WIP validators still green.
  const provisionHtml = buildWipHtml({
    id: 'p-loss', periodEndDate: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z',
    rows: [bareRow, etcRow], portfolioTotals: barePortfolio,
  }, 'Harlow Construction LLC');
  expect('the PDF prints the loss provision as its own disclosure',
    /class="provision"/.test(provisionHtml)
      && /Provision for loss on uncompleted contracts/.test(provisionHtml), true);
  expect('…carrying the accrual figure, not just the words',
    provisionHtml.includes(`$${Math.round(barePortfolio.lossProvision ?? 0).toLocaleString('en-US')}`), true);
  expect('…and naming the contract it is for',
    /class="provision"[\s\S]*?Ridgeline[\s\S]*?<\/div>/.test(provisionHtml), true);
  // A healthy book renders neither block — a "$0 provision" invites the
  // question of which job it is for, and a "no jobs excluded" note is noise.
  const healthyInput: WipRowInput = {
    originalContract: 1_000_000, approvedChangeOrders: 0,
    totalEstimatedCost: 800_000, costToDate: 400_000, billedToDate: 400_000,
  };
  const healthyRow: WipSnapshotRow = {
    projectId: 'h', projectName: 'Healthy', input: healthyInput, output: computeWipRow(healthyInput),
  };
  const healthyHtml = buildWipHtml({
    id: 'p-ok', periodEndDate: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z',
    rows: [healthyRow], portfolioTotals: computeWipPortfolio([healthyRow]),
  }, 'X');
  expect('a healthy book renders no provision block', /class="provision"/.test(healthyHtml), false);
  expect('…and no no-cost-basis block', /class="nobasis"/.test(healthyHtml), false);

  // ── F8 PART 2: THE WATCH FLAGS REACH BOTH EXPORTS ─────────────────────────
  const fadedPrior = computeWipRow({
    originalContract: 550_000, approvedChangeOrders: 0,
    totalEstimatedCost: 400_000, costToDate: 200_000, billedToDate: 100_000,
  });
  const flaggedRow: WipSnapshotRow = { ...etcRow, flags: flagWipRow(etcRow.output, fadedPrior) };
  const flaggedPeriod = { ...etcPeriod, rows: [flaggedRow] };
  const flaggedCsv = wipPeriodToCSV(flaggedPeriod).split('\n');
  const flaggedHeader = csvFields(flaggedCsv[0]);
  expect('the CSV has a Watch Flags column', flaggedHeader.includes('Watch Flags'), true);
  expect('…carrying the row\'s OWN reasons, frozen with it',
    /Gross margin faded/.test(flaggedCsv[1]), true);
  expect('…and the PDF footnote carries them too',
    /<span class="flag">Gross margin faded/.test(buildWipHtml(flaggedPeriod, 'X')), true);
  // A row that predates the column must print NOTHING, never "none" — "none"
  // asserts the fade watch ran and found nothing.
  expect('a row frozen before the column leaves the cell blank, never "none"',
    etcCells[etcHeader.indexOf('Watch Flags')], '');
  expect('…while a row that WAS watched and fired nothing says so',
    /No watch flags/.test(wipPeriodToCSV({ ...etcPeriod, rows: [{ ...etcRow, flags: flagWipRow(etcRow.output, undefined) }] })), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
