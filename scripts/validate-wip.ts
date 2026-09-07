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
  sumApprovedChangeOrders,
  deriveOriginalContract,
  deriveEstimatedCost,
  flagWipRow,
  assertPeriodEditable,
} from '../utils/wip';
import { wipPeriodToCSV } from '../utils/wipExport';
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

// ── percentCompleteOverride wins over cost-based ratio ──────────────────────
const overridden = computeWipRow({ ...base, percentCompleteOverride: 0.6 });
expect('override sets percentComplete', overridden.percentComplete, 0.6);
expect('override → earnedRevenue', overridden.earnedRevenue, 60000);
expect('override → underbilling (billed < earned)', overridden.underbilling, 15000);
expect('override → overbilling 0', overridden.overbilling, 0);

// ── percentComplete caps at 1 (cost overruns estimate) ──────────────────────
expect('percentComplete caps at 1',
  computeWipRow({ ...base, costToDate: 150000 }).percentComplete, 1);
expect('override caps at 1',
  computeWipRow({ ...base, percentCompleteOverride: 1.5 }).percentComplete, 1);
expect('override floors at 0',
  computeWipRow({ ...base, percentCompleteOverride: -0.2 }).percentComplete, 0);

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
// percentCompleteOverride 0.45 → earned = 100000 * 0.45 = 45000 == billedToDate.
const equalBilling = computeWipRow({ ...base, billedToDate: 45000, percentCompleteOverride: 0.45 });
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
const lossJob = computeWipRow({
  originalContract: 100000, approvedChangeOrders: 0,
  totalEstimatedCost: 130000, costToDate: 26000, billedToDate: 0,
  percentCompleteOverride: 0.20,
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
const deepLoss = computeWipRow({
  originalContract: 100000, approvedChangeOrders: 0,
  totalEstimatedCost: 110000, costToDate: 120000, billedToDate: 0,
  percentCompleteOverride: 1,
});
expect('loss provision takes the worse of pro-rata / estimate',
  deepLoss.profitToDate, 100000 - 120000); // earned 100000 − cost 120000 = -20000 (< -10000 est loss)

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
