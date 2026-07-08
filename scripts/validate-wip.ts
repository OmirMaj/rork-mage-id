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
  flagWipRow,
  assertPeriodEditable,
} from '../utils/wip';
import { wipPeriodToCSV } from '../utils/wipExport';
import type {
  WipRowInput, WipRow, WipSnapshotRow, WipPeriod,
  Commitment, Invoice, SavedAIAPayApp, ChangeOrder, Project,
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

// ── suggestCostToDate: sum of commitment paidToDate ─────────────────────────
const commitments = [
  { paidToDate: 1000 }, { paidToDate: 500 }, {},
] as unknown as Commitment[];
expect('suggestCostToDate sums paidToDate', suggestCostToDate(commitments), 1500);
expect('suggestCostToDate empty → 0', suggestCostToDate([]), 0);

// ── suggestBilledToDate: pay-apps win when present ──────────────────────────
const payApps = [
  { totals: { currentPaymentDue: 2000 } },
  { totals: { currentPaymentDue: 500 } },
] as unknown as SavedAIAPayApp[];
const invoices = [
  { totalDue: 9999 }, { totalDue: 1 },
] as unknown as Invoice[];
expect('billed: pay-apps preferred (no double count)',
  suggestBilledToDate(invoices, payApps), 2500);
expect('billed: invoices when no pay-apps',
  suggestBilledToDate(invoices, []), 10000);
expect('billed: both empty → 0', suggestBilledToDate([], []), 0);

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
