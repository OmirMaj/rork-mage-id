// validate-dashboard-tables.ts — the money dashboards' desktop layer (wave 6d,
// lane B1): the main | rail geometry and the job-costing table cells.
//
// WHAT IT PINS
//   1. utils/dashboardColumns: the rail drops under main below 984 px
//      (600 main + 24 gutter + 360 rail), and the constants equal the tokens
//      in constants/designTokens.ts (Layout.column.rail, Layout.gutter,
//      Layout.menu) — a token edit that forgot the pure copy fails here.
//   2. utils/dashboardTables: every job-cost phase cell IS the engine's field
//      (contract D8 — nothing re-derived), '% spent' is null (→ '—', never 0%)
//      on a phase with no budget, and the footer is the ENGINE's job total —
//      NOT the sum of the visible rows. The two differ by exactly
//      absorbedVariance on a job with unbudgeted spend, which is the whole
//      reason the footer may not be a column sum.
//   3. app/job-costing.tsx (source-level; bun cannot import a .tsx): the phase
//      table's cells and footer are read through those helpers, and its
//      variance colour goes through describeVariance.
//   4–6. d6r B2 (contract D20): the WIP report's projects table and the /reports
//      WIP, Profit and A/R Aging tables. Every cell helper returns the engine
//      field the phone card or the CSV prints (run through the real
//      utils/wip and utils/financialReports engines on fixture books), an
//      unknown is null, the billing kinds follow the cards' ternaries, the
//      footers ARE computeWipPortfolio / report.totals (the /reports WIP footer
//      equals the CSV TOTAL row cell for cell), the aging words and inks are
//      the card's, and the screens read through the helpers — marginCellText
//      the only way /reports prints a margin cell, and the header Print built
//      by components/desktop/printAction.
//
// Run via: bun run test:dashboard-tables

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DASHBOARD_GUTTER, DASHBOARD_MAIN_MIN, DASHBOARD_RAIL, dashboardColumnsFit, dashboardMainWidth,
} from '../utils/dashboardColumns';
import {
  jobCostFooter, jobCostPhaseCells, pctSpentText,
  agingCells, agingFooter, marginCellText, profitCells, profitFooter, reportsWipCells, reportsWipFooter,
  wholeDollars, wipCostSourceTag, wipScheduleCells, wipScheduleFooter,
} from '../utils/dashboardTables';
import { computeWipPortfolio, computeWipRow, wipRowCostAtCompletion } from '../utils/wip';
import {
  computeARAgingReport, computeProfitReport, computeWIPReport, profitRowHasCostBasis, wipReportRowHasCostBasis,
  wipReportToCSV, wipRowEarned, wipRowOverbilled, type WIPRow,
} from '../utils/financialReports';
import { MENU_MAX_WIDTH, MENU_OFFSET } from '../utils/popoverPosition';
import { computeJobCost } from '../utils/jobCostEngine';
import type { Commitment, Invoice, LinkedEstimate, Project, WipRowInput, WipSnapshotRow } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}

// ── 1. Geometry + token parity ─────────────────────────────────────────────
console.log('dashboard columns — geometry:');
ok('dashboardColumnsFit(983) is false', dashboardColumnsFit(983) === false);
ok('dashboardColumnsFit(984) is true', dashboardColumnsFit(984) === true);
ok('dashboardColumnsFit(NaN) and (Infinity) are false', !dashboardColumnsFit(NaN) && !dashboardColumnsFit(Infinity));
ok('the fit threshold is main-min + gutter + rail', DASHBOARD_MAIN_MIN + DASHBOARD_GUTTER + DASHBOARD_RAIL === 984);
ok('main at 1240 (the 1512 column) is 856', dashboardMainWidth(1240) === 856);
ok('main at 1008 (the 1280 column) is 624', dashboardMainWidth(1008) === 624);

console.log('dashboard columns — token parity with constants/designTokens.ts:');
{
  const tokens = read('constants/designTokens.ts');
  const column = tokens.match(/\bcolumn:\s*\{\s*index:\s*(\d+),\s*rail:\s*(\d+)\s*\}/);
  ok('Layout declares `column: { index: 220, rail: 360 }`', !!column && column[1] === '220' && column[2] === '360', column?.[0] ?? 'missing');
  ok('DASHBOARD_RAIL equals Layout.column.rail', !!column && Number(column[2]) === DASHBOARD_RAIL);
  const gutter = tokens.match(/\bgutter:\s*(\d+)/);
  ok('Layout declares `gutter: 24` and DASHBOARD_GUTTER equals it', !!gutter && Number(gutter[1]) === 24 && DASHBOARD_GUTTER === 24, gutter?.[0]);
  const menu = tokens.match(/\bmenu:\s*\{[^}]*\bmaxWidth:\s*(\d+)[^}]*\boffset:\s*(\d+)[^}]*\}/);
  ok('Layout.menu holds `maxWidth: 280, offset: 4`', !!menu && menu[1] === '280' && menu[2] === '4', menu?.[0] ?? 'missing');
  ok('popoverPosition MENU_MAX_WIDTH / MENU_OFFSET equal Layout.menu', !!menu && Number(menu[1]) === MENU_MAX_WIDTH && Number(menu[2]) === MENU_OFFSET);
}

// ── 2. Job-cost cells and footer against the engine ────────────────────────
function estimate(items: { category: string; lineTotal: number }[]): LinkedEstimate {
  const baseTotal = items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    id: 'est1',
    items: items.map((i, n) => ({
      materialId: `m${n}`, name: `Item ${n}`, category: i.category, unit: 'ls',
      quantity: 1, unitPrice: i.lineTotal, bulkPrice: i.lineTotal, markup: 0,
      usesBulk: false, lineTotal: i.lineTotal, supplier: 'Acme',
    })),
    globalMarkup: 0, baseTotal, markupTotal: 0, grandTotal: baseTotal,
    createdAt: '2026-01-02T00:00:00.000Z',
  } as LinkedEstimate;
}
const project = { id: 'p1', name: 'Fixture', linkedEstimate: estimate([
  { category: 'Framing', lineTotal: 30_000 }, { category: 'Electrical', lineTotal: 18_000 },
]) } as unknown as Project;
const commitments = [
  // Framing: signed 32K, 20K paid — over its 30K line.
  { id: 'c1', projectId: 'p1', status: 'active', type: 'subcontract', amount: 32_000, paidToDate: 20_000, phase: 'Framing' },
  // Roofing: never estimated — 5K paid on a phase with NO budget line.
  { id: 'c2', projectId: 'p1', status: 'active', type: 'purchase_order', amount: 5_000, paidToDate: 5_000, phase: 'Roofing' },
] as unknown as Commitment[];
const s = computeJobCost({ project, commitments, changeOrders: [] });

console.log('job-cost cells — every cell is the engine field:');
ok('premise: the fixture has an unbudgeted phase and a budgeted one',
  s.byPhase.some(l => l.budget === 0 && l.actual > 0) && s.byPhase.some(l => l.budget > 0));
for (const l of s.byPhase) {
  const c = jobCostPhaseCells(l);
  ok(`${l.phase}: budget / committed / actual / EAC / variance are the line's own fields`,
    c.budget === l.budget && c.committed === l.committed && c.actual === l.actual
      && c.eac === l.projectedFinal && c.variance === l.variance,
    JSON.stringify({ c, l: { budget: l.budget, committed: l.committed, actual: l.actual, projectedFinal: l.projectedFinal, variance: l.variance } }));
  if (l.budget > 0) ok(`${l.phase}: % spent = actual / budget`, c.pctSpent === l.actual / l.budget, String(c.pctSpent));
  else ok(`${l.phase}: % spent is null at budget 0 (unknown, never 0%)`, c.pctSpent === null, String(c.pctSpent));
}
ok("pctSpentText(null) is '—', never '0%'", pctSpentText(null) === '—');
ok("pctSpentText(NaN) is '—'", pctSpentText(NaN) === '—');
ok('pctSpentText(0.667) is 67%', pctSpentText(0.667) === '67%');

console.log('job-cost footer — the engine job total, not a column sum:');
const foot = jobCostFooter(s);
ok('footer equals the summary (budget, committed, actual, EAC, variance, absorbed)',
  foot.budget === s.budget && foot.committed === s.committed && foot.actual === s.actual
    && foot.eac === s.projectedFinal && foot.variance === s.variance && foot.absorbed === s.absorbedVariance,
  JSON.stringify(foot));
const rowEac = s.byPhase.reduce((a, l) => a + l.projectedFinal, 0);
ok('premise: this job absorbs unbudgeted spend (absorbedVariance > 0)', s.absorbedVariance > 0, String(s.absorbedVariance));
ok('the footer EAC is NOT the sum of the rows — it differs by exactly absorbedVariance',
  foot.eac !== rowEac && Math.abs((rowEac - foot.eac) - s.absorbedVariance) < 0.005,
  `rows ${rowEac}, footer ${foot.eac}, absorbed ${s.absorbedVariance}`);
ok('footer variance = footer EAC − footer budget (the engine sign: + is over)',
  Math.abs(foot.variance - (foot.eac - foot.budget)) < 0.005);

// ── 3. The screen reads through the helpers ─────────────────────────────────
console.log('app/job-costing.tsx — the desktop tables read the helpers:');
{
  const src = read('app/job-costing.tsx');
  ok('imports jobCostPhaseCells / jobCostFooter from utils/dashboardTables',
    /import \{[^}]*\bjobCostFooter\b[^}]*\bjobCostPhaseCells\b[^}]*\} from '@\/utils\/dashboardTables'/.test(src));
  ok('the footer is built from jobCostFooter(summary)', /jobCostFooter\(summary\)/.test(src));
  ok('the phase table is keyed jobcost-phases with footerTotals', /tableId="jobcost-phases"/.test(src) && /footerTotals=\{\{/.test(src));
  ok('the commitments table is keyed jobcost-commitments with hotkeys off',
    /tableId="jobcost-commitments"[\s\S]{0,120}hotkeys=\{false\}/.test(src));
  ok('every money column of the phase table reads jobCostPhaseCells',
    ['budget', 'committed', 'actual', 'eac', 'variance'].every(k => new RegExp(`jobCostPhaseCells\\(p\\)\\.${k}\\b`).test(src)));
  ok('the variance colour goes through describeVariance, never a sign test',
    /varianceColor\(describeVariance\(phaseFooter\.variance\)/.test(src) && !/variance\s*>=\s*0/.test(src));
  ok("'% spent' prints through pctSpentText", /pctSpentText\(jobCostPhaseCells\(p\)\.pctSpent\)/.test(src));
}

// ════════════════════════════════════════════════════════════════════════════
// d6r B2 — the WIP report and Bank-Ready Reports desktop tables (contract D8,
// D20). The WIP / Reports / Profit / Aging cell helpers wave 6d never built:
// every cell is the engine field the phone card or the CSV prints, an unknown
// is null ('—'), and every footer is the engine's own total — proved here on
// fixture rows run through the real engines (utils/wip, utils/financialReports).
// ════════════════════════════════════════════════════════════════════════════
{
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

  // ── 4. /wip-report — wipScheduleCells / wipScheduleFooter / wipCostSourceTag
  console.log('\nd6r B2 — /wip-report projects table (utils/wip engine):');
  const input = (o: Partial<WipRowInput>): WipRowInput => ({
    originalContract: 100_000, approvedChangeOrders: 0, totalEstimatedCost: 80_000,
    costToDate: 0, billedToDate: 0, ...o,
  });
  const snap = (projectId: string, i: WipRowInput): WipSnapshotRow =>
    ({ projectId, projectName: projectId, input: i, output: computeWipRow(i) });
  const wipRows: WipSnapshotRow[] = [
    // 50% through cost, 70% billed → OVER.
    snap('over', input({ costToDate: 40_000, billedToDate: 70_000, retainageHeld: 3_500 })),
    // 50% through cost, 20% billed → UNDER; a $5,000 change order.
    snap('under', input({ approvedChangeOrders: 5_000, costToDate: 40_000, billedToDate: 20_000 })),
    // Nothing spent, nothing billed → neither.
    snap('none', input({ costToDate: 0, billedToDate: 0 })),
    // An ETC in force: cost at completion is cost-to-date + ETC, NOT the
    // derived 80,000 on the input — the column must print the former.
    snap('etc', input({ costToDate: 60_000, billedToDate: 50_000, estimatedCostToComplete: 50_000 })),
  ];
  const kindOf = (id: string) => wipScheduleCells(wipRows.find(r => r.projectId === id)!).billing.kind;
  ok('premise: the fixture has an over, an under and a neither row',
    kindOf('over') === 'over' && kindOf('under') === 'under' && kindOf('none') === 'none',
    `${kindOf('over')} / ${kindOf('under')} / ${kindOf('none')}`);
  const etcRow = wipRows.find(r => r.projectId === 'etc')!;
  ok('premise: the ETC row is struck against a cost at completion that differs from its derived input',
    etcRow.output.estimatedCostAtCompletion != null && !near(etcRow.output.estimatedCostAtCompletion, etcRow.input.totalEstimatedCost));
  for (const r of wipRows) {
    const c = wipScheduleCells(r);
    ok(`${r.projectId}: contract / est. cost / cost to date / % / earned / billed are the engine fields`,
      c.contract === r.output.revisedContract && c.estCost === wipRowCostAtCompletion(r)
        && c.costToDate === r.input.costToDate && c.pctComplete === r.output.percentComplete
        && c.earned === r.output.earnedRevenue && c.billed === r.input.billedToDate,
      JSON.stringify(c));
    const want = r.output.overbilling > 0 ? { kind: 'over', amount: r.output.overbilling }
      : r.output.underbilling > 0 ? { kind: 'under', amount: r.output.underbilling } : { kind: 'none' };
    ok(`${r.projectId}: the billing cell follows the phone's ternary (over, then under, else —)`,
      JSON.stringify(c.billing) === JSON.stringify(want), JSON.stringify(c.billing));
  }
  ok('the ETC row\'s est. cost cell is the struck cost at completion (60,000 + 50,000)',
    near(wipScheduleCells(etcRow).estCost, 110_000), String(wipScheduleCells(etcRow).estCost));

  const portfolio = computeWipPortfolio(wipRows);
  const wf = wipScheduleFooter(portfolio);
  ok('the footer IS computeWipPortfolio (contract, est. cost, cost to date, earned, billed, over, under)',
    wf.contract === portfolio.revisedContract && wf.estCost === portfolio.totalEstimatedCost
      && wf.costToDate === portfolio.costToDate && wf.earned === portfolio.earnedRevenue
      && wf.billed === portfolio.billedToDate && wf.over === portfolio.overbilling && wf.under === portfolio.underbilling,
    JSON.stringify(wf));
  ok('…whose est. cost sums the STRUCK costs, not the derived inputs (the ETC row counts 110,000)',
    near(wf.estCost, wipRows.reduce((a, r) => a + wipRowCostAtCompletion(r), 0))
      && !near(wf.estCost, wipRows.reduce((a, r) => a + r.input.totalEstimatedCost, 0)));
  ok('…and over and under are totalled apart, never netted',
    wf.over > 0 && wf.under > 0 && near(wf.over, wipRows.reduce((a, r) => a + r.output.overbilling, 0)));

  const tag = wipCostSourceTag;
  ok("cost tag: a typed, synced figure reads 'entered · synced' (even at $0)",
    tag({ costToDate: 'entered_and_synced' }, 0, 42_200) === 'entered · synced');
  ok("cost tag: a typed figure still on this device reads 'entered · not synced yet'",
    tag({ costToDate: 'entered_on_this_device' }, 5_000, 0) === 'entered · not synced yet');
  ok("cost tag: the full recorded chain reads 'every recorded cost'",
    tag({ costToDate: 'recorded_actual_cost' }, 5_000, 0) === 'every recorded cost');
  ok("cost tag: a legacy two-source floor reads 'subs + materials only'",
    tag({ costToDate: 'commitments_and_receipts' }, 5_000, 0) === 'subs + materials only');
  ok("cost tag: $0 beside signed commitments names what is signed, in the screen's money()",
    tag(undefined, 0, 42_200) === 'nothing paid · $42,200 signed', tag(undefined, 0, 42_200));
  ok("cost tag: $0 with nothing signed (or a frozen row, floor null) reads 'nothing recorded'",
    tag(undefined, 0, null) === 'nothing recorded' && tag({ costToDate: 'commitments_and_receipts' }, 0, 0) === 'nothing recorded');
  ok('wholeDollars is the screen\'s money(): whole dollars, en-US grouping',
    wholeDollars(1234567.49) === '$1,234,567' && wholeDollars(0.5) === '$1');
  {
    // The tag mirrors the phone sentence branch for branch, IN ORDER — the
    // screen's own row text is the source of truth it abbreviates.
    const WIP = read('app/wip-report.tsx');
    const at = (t: string) => WIP.indexOf(t);
    const order = [
      "' · entered by you, synced'", "' · entered here, not synced yet'",
      "' · every cost recorded on this project", "' · subs paid + material receipts only",
      ': nothing paid out yet, though', "': nothing recorded yet.",
    ].map(at);
    ok('the phone row still prints the six-branch cost sentence the tag abbreviates, in the same order',
      order.every(i => i >= 0) && order.every((i, n) => n === 0 || i > order[n - 1]), JSON.stringify(order));
  }

  // ── 5. /reports — the WIP, Profit and Aging tables (utils/financialReports)
  console.log('\nd6r B2 — /reports tables (utils/financialReports engine):');
  const est = (id: string, base: number, grand: number) => ({
    id, items: [], globalMarkup: 0, baseTotal: base, markupTotal: grand - base, grandTotal: grand, createdAt: '2026-01-01',
  });
  const proj = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id, name, status: 'in_progress', estimate: null, linkedEstimate: est(`e-${id}`, 400_000, 500_000),
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
  }) as unknown as Project;
  const commit = (id: string, projectId: string, amount: number, paidToDate: number) => ({
    id, projectId, number: id, type: 'subcontract', description: 'Work', amount, paidToDate,
    signedDate: '2026-01-01', phase: 'Framing', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }) as unknown as Commitment;
  const bill = (id: string, projectId: string, totalDue: number, amountPaid = 0, retentionAmount = 0, dueDate = '2026-03-31') => ({
    id, number: Number(id.replace(/\D/g, '')) || 1, projectId, type: 'progress',
    issueDate: '2026-03-01', dueDate, paymentTerms: 'net_30', notes: '',
    lineItems: [{ id: `${id}-l1`, name: 'Progress', description: '', quantity: 1, unit: 'ls', unitPrice: totalDue, total: totalDue }],
    subtotal: totalDue, taxRate: 0, taxAmount: 0, totalDue, amountPaid,
    ...(retentionAmount > 0 ? { retentionPercent: 10, retentionAmount } : {}),
    status: amountPaid > 0 ? 'partially_paid' : 'sent', payments: [], createdAt: '2026-03-01', updatedAt: '2026-03-01',
  }) as unknown as Invoice;
  const projects = [
    proj('pA', 'Alpha'),                                   // 50% spent, 70% billed → over
    proj('pB', 'Bravo'),                                   // 50% spent, 10% billed → under
    proj('pD', 'Delta'),                                   // signed, nothing spent or billed → even
    proj('pC', 'Charlie', { linkedEstimate: undefined, targetBudget: { amount: 900_000, setBy: 'client' } }), // no cost basis
  ];
  const commitments = [
    commit('cA', 'pA', 400_000, 200_000), commit('cB', 'pB', 400_000, 200_000), commit('cD', 'pD', 50_000, 0),
  ];
  const invoices = [bill('i1', 'pA', 350_000), bill('i2', 'pB', 50_000), bill('i3', 'pC', 90_000)];
  const report = computeWIPReport(projects, invoices, [], commitments);
  const rowOf = (id: string) => report.rows.find(r => r.projectId === id)!;
  ok('premise: all four jobs are on the schedule', report.rows.length === 4, String(report.rows.length));
  ok('premise: one over, one under, one even, one without a cost basis',
    reportsWipCells(rowOf('pA')).billing.kind === 'over' && reportsWipCells(rowOf('pB')).billing.kind === 'under'
      && reportsWipCells(rowOf('pD')).billing.kind === 'even' && !wipReportRowHasCostBasis(rowOf('pC')),
    report.rows.map(r => `${r.projectId}:${reportsWipCells(r).billing.kind}`).join(' '));
  for (const r of report.rows) {
    const c = reportsWipCells(r);
    const basis = wipReportRowHasCostBasis(r);
    ok(`${r.projectName}: contract / est. final / cost to date / % / earned / billed / retainage are the row's own`,
      c.contract === r.revisedContract && c.estFinal === r.estimatedFinalCost && c.costToDate === r.costToDate
        && c.pctComplete === r.percentComplete && c.earned === wipRowEarned(r) && c.billed === r.billedToDate
        && c.retainage === r.retainageHeld, JSON.stringify(c));
    ok(`${r.projectName}: profit and margin are the row's, or null exactly when it has no cost basis`,
      basis ? c.profit === r.projectedProfit && c.margin === r.projectedMargin : c.profit === null && c.margin === null);
    const over = wipRowOverbilled(r);
    const want = over > 0 ? 'over' : r.unbilled > 0 ? 'under' : 'even';
    ok(`${r.projectName}: the billing cell follows the card's KV ternary (Overbilled / Underbilled / On earned value)`,
      c.billing.kind === want && (c.billing.kind === 'even' || near(c.billing.amount, over > 0 ? over : r.unbilled)));
  }
  {
    const unknown = { ...rowOf('pA'), costToDate: undefined } as WIPRow;
    ok('an unknown cost to date is null (the table prints —), never 0', reportsWipCells(unknown).costToDate === null);
  }

  const rf = reportsWipFooter(report.totals);
  const t = report.totals;
  ok('the WIP footer IS report.totals (contract, cost to date, est. final, earned, billed, over, under, retainage, measurable profit, margin)',
    rf.revisedContract === t.revisedContract && rf.costToDate === t.costToDate && rf.estimatedFinalCost === t.estimatedFinalCost
      && rf.earnedRevenue === t.earnedRevenue && rf.billedToDate === t.billedToDate && rf.overbilled === t.overbilled
      && rf.unbilled === t.unbilled && rf.retainageHeld === t.retainageHeld
      && rf.measurableProjectedProfit === t.measurableProjectedProfit && rf.projectedMargin === t.projectedMargin,
    JSON.stringify(rf));
  {
    // …and equals the CSV's own TOTAL line, cell for cell.
    const lines = wipReportToCSV(report).split('\n');
    const head = lines[0].split(',');
    const total = (lines.find(l => l.startsWith('TOTAL,')) ?? '').split(',');
    const cell = (h: string) => total[head.indexOf(h)];
    const pairs: [string, string][] = [
      ['Revised Contract', rf.revisedContract.toFixed(2)], ['Cost to Date', rf.costToDate.toFixed(2)],
      ['Estimated Final Cost', rf.estimatedFinalCost.toFixed(2)], ['Earned Revenue', rf.earnedRevenue.toFixed(2)],
      ['Billed to Date', rf.billedToDate.toFixed(2)], ['Overbilled', rf.overbilled.toFixed(2)],
      ['Underbilled', rf.unbilled.toFixed(2)], ['Retainage Held', rf.retainageHeld.toFixed(2)],
      ['Projected Profit', rf.measurableProjectedProfit.toFixed(2)], ['Projected Margin %', rf.projectedMargin.toFixed(1)],
    ];
    const bad = pairs.filter(([h, v]) => cell(h) !== v);
    ok('the WIP footer equals the CSV TOTAL row, cell for cell', total.length > 1 && bad.length === 0,
      bad.map(([h, v]) => `${h}: csv ${cell(h)} vs footer ${v}`).join('; '));
  }
  ok('premise: the measurable profit is NOT the column sum of projected profit (the no-basis job would add its whole contract)',
    !near(rf.measurableProjectedProfit, report.rows.reduce((a, r) => a + r.projectedProfit, 0)));
  ok('the footer margin is measured on this book (at least one job has a cost basis)', rf.measurable === true);
  {
    const onlyBudget = computeWIPReport([projects[3]], [invoices[2]], [], []);
    ok('…and unmeasured when no job has a cost basis (the table prints —, not 0.0%)',
      reportsWipFooter(onlyBudget.totals).measurable === false);
  }

  const profit = computeProfitReport(projects, invoices, [], commitments);
  ok('premise: the profit report carries a job without a cost basis', profit.rows.some(r => !profitRowHasCostBasis(r)));
  for (const r of profit.rows) {
    const c = profitCells(r);
    const basis = profitRowHasCostBasis(r);
    ok(`profit ${r.projectName}: revenue / cost / est. final / health are the row's, profit+margin null exactly without a basis`,
      c.revenue === r.revenue && c.costToDate === r.costToDate && c.estFinal === r.estimatedFinalCost && c.health === r.health
        && (basis ? c.profit === r.projectedProfit && c.margin === r.projectedMargin : c.profit === null && c.margin === null));
  }
  const pf = profitFooter(profit);
  ok('the Profit footer IS the headline (totalProfit, weightedMargin)',
    pf.projectedProfit === profit.totalProfit && pf.margin === profit.weightedMargin, JSON.stringify(pf));
  ok('…and unmeasured (null) when nothing on the report has a cost basis',
    JSON.stringify(profitFooter({ totalProfit: 0, weightedMargin: 0, measurableRevenue: 0 })) === JSON.stringify({ projectedProfit: null, margin: null }));

  // Aging: one long late, one far in the future, one paid down to retention.
  const agingInvoices = [
    bill('i11', 'pA', 18_250.5, 0, 0, '2020-01-31'),
    bill('i12', 'pB', 9_400, 0, 0, '2099-12-31'),
    bill('i13', 'pD', 11_000, 9_900, 1_100, '2020-01-31'),
  ];
  const aging = computeARAgingReport(agingInvoices, projects);
  const aOf = (id: string) => aging.rows.find(r => r.invoiceId === id)!;
  ok('premise: a late row, a current row and a retainage-only row',
    aging.rows.length === 3 && aOf('i11').bucket === '90+' && aOf('i12').bucket === 'current' && aOf('i13').outstanding <= 0.5);
  {
    // The card's words and inks, as the phone prints them (app/reports.tsx).
    const cardWord = (r: typeof aging.rows[number]) => {
      const isRetainageOnly = r.outstanding <= 0.5;
      return isRetainageOnly ? 'Retainage only' : r.bucket === 'current' ? 'Current' : `${r.daysPastDue}d past due`;
    };
    for (const r of aging.rows) {
      const c = agingCells(r);
      ok(`aging #${r.invoiceNumber}: the bucket word is the card's ('${cardWord(r)}')`, c.bucketWord === cardWord(r), c.bucketWord);
      ok(`aging #${r.invoiceNumber}: total / paid / retainage / outstanding are the row's own`,
        c.total === r.totalDue && c.paid === r.amountPaid && c.retainage === r.retainageHeld && c.outstanding === r.outstanding);
    }
    ok('a retainage-only row is not aged (days past due null), muted, not late',
      agingCells(aOf('i13')).daysPastDue === null && agingCells(aOf('i13')).bucketTone === 'muted' && !agingCells(aOf('i13')).late);
    ok('a late row is danger ink with its days; a current row is neither',
      agingCells(aOf('i11')).late && agingCells(aOf('i11')).bucketTone === 'bad' && agingCells(aOf('i11')).daysPastDue === aOf('i11').daysPastDue
        && !agingCells(aOf('i12')).late && agingCells(aOf('i12')).bucketTone === 'muted');
    const tone = (b: string, outstanding = 100) => agingCells({ ...aOf('i11'), bucket: b, outstanding } as typeof aging.rows[number]).bucketTone;
    ok("the pill tone follows the card's bucketStyle ternary (0-30 / 31-60 warn, 61-90 / 90+ bad)",
      tone('0-30') === 'warn' && tone('31-60') === 'warn' && tone('61-90') === 'bad' && tone('90+') === 'bad' && tone('current') === 'muted');
    const REP = read('app/reports.tsx');
    ok("…and the card still prints exactly that word ternary and that ink ternary",
      REP.includes("{isRetainageOnly ? 'Retainage Only' : r.bucket === 'current' ? 'Current' : `${r.daysPastDue}d past due`}")
        && /isRetainageOnly\s+\? styles\.bucketPillMuted :\s*r\.bucket === 'current'\s+\? styles\.bucketPillMuted :\s*r\.bucket === '0-30'\s+\? styles\.bucketPillWarn :\s*r\.bucket === '31-60'\s+\? styles\.bucketPillWarn :\s*styles\.bucketPillBad;/.test(REP));
  }
  const af = agingFooter(aging.totals);
  ok('the aging footer IS the report totals (outstanding, retainage held)',
    af.outstanding === aging.totals.totalOutstanding && af.retainage === aging.totals.retainageHeld && af.retainage > 0);

  ok("marginCellText is one decimal and a percent sign", marginCellText(12.345) === '12.3%' && marginCellText(-11.94) === '-11.9%' && marginCellText(0) === '0.0%');

  // ── 6. The screens read through the helpers (source-level; bun cannot import a .tsx)
  console.log('\nd6r B2 — the desktop tables read the helpers:');
  const REPORTS = read('app/reports.tsx');
  const WIPS = read('app/wip-report.tsx');
  const PRINT = read('components/desktop/printAction.ts');
  ok('/reports prints a margin cell only through marginCellText (both tables, both footers)',
    (REPORTS.match(/marginCellText\(m\)/g) ?? []).length === 2 && /marginCellText\(wipFoot\.projectedMargin\)/.test(REPORTS)
      && /marginCellText\(profitFoot\.margin\)/.test(REPORTS)
      // Any one-decimal percent written by hand must carry the noun (the pills).
      && !/toFixed\(1\)\}%(?! margin)/.test(REPORTS));
  ok('…and never a bare `projectedMargin.toFixed(1)}%` (the pill keeps its noun, twice)',
    !/projectedMargin\.toFixed\(1\)\}%(?! margin)/.test(REPORTS)
      && (REPORTS.match(/\{r\.projectedMargin\.toFixed\(1\)\}% margin/g) ?? []).length === 2);
  ok('/reports WIP table: tableId reports-wip, cells from reportsWipCells, footer from reportsWipFooter(report.totals)',
    /tableId="reports-wip"/.test(REPORTS) && /const wipFoot = reportsWipFooter\(report\.totals\)/.test(REPORTS)
      && ['contract', 'estFinal', 'costToDate', 'pctComplete', 'earned', 'billed', 'billing', 'retainage', 'margin']
        .every(k => new RegExp(`reportsWipCells\\(r\\)\\.${k}\\b`).test(REPORTS))
      && /contract: formatMoney\(wipFoot\.revisedContract\)/.test(REPORTS));
  ok('/reports Profit table: tableId reports-profit, footer from profitFooter(profit), no revenue total',
    /tableId="reports-profit"/.test(REPORTS) && /const profitFoot = profitFooter\(profit\)/.test(REPORTS)
      && !/formatMoney\(profit\.totalRevenue\)/.test(REPORTS));
  ok('/reports Aging table: tableId reports-aging, footer from agingFooter, rows link to /invoice?projectId&invoiceId',
    /tableId="reports-aging"/.test(REPORTS) && /const agingFoot = agingFooter\(report\.totals\)/.test(REPORTS)
      && /getRowHref=\{\(r\) => routeHref\('\/invoice', \{ projectId: r\.projectId, invoiceId: r\.invoiceId \}\)\}/.test(REPORTS)
      && /defaultSort=\{\{ key: 'daysPastDue', dir: 'desc' \}\}/.test(REPORTS));
  ok('/wip-report: the wip-projects DataTable renders behind isDesktopWeb, the phone rows otherwise',
    /\) : isDesktopWeb \? \([\s\S]{0,200}<DataTable\s+tableId="wip-projects"/.test(WIPS) && /\) : displayRows\.map\(\(r\) => \{/.test(WIPS));
  ok('…its cells read wipScheduleCells and its footer is wipScheduleFooter(displayPortfolio)',
    ['contract', 'estCost', 'costToDate', 'pctComplete', 'earned', 'billed', 'billing'].every(k => new RegExp(`wipScheduleCells\\(r\\)\\.${k}\\b`).test(WIPS))
      && /const scheduleFooter = wipScheduleFooter\(displayPortfolio\)/.test(WIPS)
      && /wipCostSourceTag\(r\.sources, r\.input\.costToDate, rowFlagState\(r\)\.rowCost\?\.committedFloor, money\)/.test(WIPS));
  ok('…and the phone row and the table share one flag derivation (rowFlagState)',
    /const \{ rowCost, flagged \} = rowFlagState\(r\);/.test(WIPS) && /rowFlagState\(r\)\.flagged/.test(WIPS)
      && (WIPS.match(/flagWipRow\(r\.output, prior, evm\)/g) ?? []).length === 1);
  ok('header Print on both screens: printToolbarAction, object form, synchronous press',
    /printToolbarAction\(\{\s*onPrint: \(\) => \{ void handleExportPdf\(\); \}/.test(WIPS)
      && /printToolbarAction\(\{\s*onPrint: \(\) => \{ void handleSharePdf\(\); \}/.test(REPORTS)
      && /\{isDesktop && <ToolbarActions actions=\{toolbar\} testID="wip-toolbar" \/>\}/.test(WIPS)
      && /\{isDesktop && <ToolbarActions actions=\{toolbar\} testID="reports-toolbar" \/>\}/.test(REPORTS));
  // ── Each footer KEY reads the matching helper FIELD. The helpers are proven
  //    equal to the engine totals above; these pins prove the screen puts each
  //    total under its own column (a swapped field would otherwise stay green).
  //    Every block is extracted by its own anchor, and each line is pinned whole.
  const block = (src: string, start: RegExp, end: RegExp): string => {
    const s = src.search(start);
    if (s < 0) return '';
    const rest = src.slice(s);
    const e = rest.search(end);
    return e < 0 ? '' : rest.slice(0, e);
  };
  const pinsAll = (b: string, lines: string[]) => b.length > 0 && lines.every(l => b.includes(l));
  /** The money keys a footer block writes — so an extra or renamed key is red too. */
  const footKeys = (b: string) => [...b.matchAll(/^\s*([A-Za-z]+): /gm)].map(m => m[1]).sort().join(',');

  const wipFootBlock = block(WIPS, /const projectFooter: Record<string, React\.ReactNode> = \{/, /\n {2}\};\n/);
  ok('/wip-report footer: every key reads scheduleFooter.<same field> (contract, estCost, costToDate, earned, billed)',
    pinsAll(wipFootBlock, [
      "job: 'Portfolio total',",
      'contract: money(scheduleFooter.contract),',
      'estCost: money(scheduleFooter.estCost),',
      'costToDate: money(scheduleFooter.costToDate),',
      'earned: money(scheduleFooter.earned),',
      'billed: money(scheduleFooter.billed),',
      '{scheduleFooter.over > 0 ? <Text style={[styles.over, styles.tableCellEndText]}>{`Over ${money(scheduleFooter.over)}`}</Text> : null}',
      '{scheduleFooter.under > 0 ? <Text style={[styles.under, styles.tableCellEndText]}>{`Under ${money(scheduleFooter.under)}`}</Text> : null}',
    ]) && footKeys(wipFootBlock) === 'billed,billing,contract,costToDate,earned,estCost,job');

  const rWipBlock = block(REPORTS, /tableId="reports-wip"/, /renderCard=/);
  ok('/reports WIP footer: contract→revisedContract, estFinal→estimatedFinalCost, costToDate, earned→earnedRevenue, billed→billedToDate, retainage→retainageHeld, margin gated on measurable',
    pinsAll(rWipBlock, [
      "job: 'Total',",
      'contract: formatMoney(wipFoot.revisedContract),',
      'estFinal: formatMoney(wipFoot.estimatedFinalCost),',
      'costToDate: formatMoney(wipFoot.costToDate),',
      'earned: formatMoney(wipFoot.earnedRevenue),',
      'billed: formatMoney(wipFoot.billedToDate),',
      '{wipFoot.overbilled > 0 ? <Text style={styles.tableFootText}>{`Over ${formatMoney(wipFoot.overbilled)}`}</Text> : null}',
      '{wipFoot.unbilled > 0 ? <Text style={styles.tableFootText}>{`Under ${formatMoney(wipFoot.unbilled)}`}</Text> : null}',
      'retainage: formatMoney(wipFoot.retainageHeld),',
      'margin: wipFoot.measurable ? marginCellText(wipFoot.projectedMargin) : null,',
    ]) && footKeys(block(rWipBlock, /footerTotals=\{\{/, /\n {8}\}\}\n/)) === 'billed,billing,contract,costToDate,earned,estFinal,job,margin,retainage');

  const rProfitBlock = block(REPORTS, /tableId="reports-profit"/, /renderCard=/);
  ok('/reports Profit footer: projectedProfit→profitFoot.projectedProfit, margin→profitFoot.margin, nothing else',
    pinsAll(rProfitBlock, [
      "job: 'Portfolio',",
      'projectedProfit: profitFoot.projectedProfit == null ? null : formatMoney(profitFoot.projectedProfit),',
      'margin: profitFoot.margin == null ? null : marginCellText(profitFoot.margin),',
    ]) && footKeys(block(rProfitBlock, /footerTotals=\{\{/, /\n {8}\}\}\n/)) === 'job,margin,projectedProfit');

  const rAgingBlock = block(REPORTS, /tableId="reports-aging"/, /renderCard=/);
  ok('/reports Aging footer: outstanding→agingFoot.outstanding, retainage→agingFoot.retainage, nothing else',
    pinsAll(rAgingBlock, [
      "job: 'Total',",
      'retainage: formatMoney(agingFoot.retainage),',
      'outstanding: formatMoney(agingFoot.outstanding),',
    ]) && footKeys(block(rAgingBlock, /footerTotals=\{\{/, /\n {8}\}\}\n/)) === 'job,outstanding,retainage');

  // ── Each BODY column reads its own helper FIELD, and nothing else. A columns
  //    array is cut out by its anchor and split at each `key: '…'`; per column
  //    we collect every helper field it touches (`xCells(r).<f>`, or `c.<f>`
  //    after `const c = xCells(r)`) and every raw row field (`r.<f>`). Both
  //    sets must EQUAL the expected ones exactly — so a `value:` pointed at a
  //    neighbour's field (earned → billed) adds a field and goes red, even
  //    when its `sortValue:` still names the right one. The key list itself is
  //    pinned in order, so a renamed, added, dropped or reordered column is red.
  type ColSpec = { fields: string[]; raw?: string[] };
  const columnsOf = (src: string, anchor: RegExp): Array<{ key: string; body: string }> => {
    const b = block(src, anchor, /\n {2}\];\n/);
    const hits = [...b.matchAll(/key: '(\w+)'/g)];
    return hits.map((h, i) => ({ key: h[1], body: b.slice(h.index!, i + 1 < hits.length ? hits[i + 1].index! : b.length) }));
  };
  const uniq = (xs: string[]) => [...new Set(xs)].sort().join(',');
  const columnsRead = (src: string, anchor: RegExp, helper: string, spec: Record<string, ColSpec>): string[] => {
    const cols = columnsOf(src, anchor);
    const bad: string[] = [];
    if (cols.map(c => c.key).join(',') !== Object.keys(spec).join(',')) bad.push(`keys ${cols.map(c => c.key).join(',')}`);
    for (const { key, body } of cols) {
      const want = spec[key];
      if (!want) continue;
      const helpers = [...body.matchAll(/\b(\w+Cells)\(r\)/g)].map(m => m[1]);
      const fields = [...body.matchAll(/\b\w+Cells\(r\)\.(\w+)/g)].map(m => m[1]);
      for (const a of body.matchAll(/const (\w+) = \w+Cells\(r\);/g)) {
        fields.push(...[...body.matchAll(new RegExp(`\\b${a[1]}\\.(\\w+)`, 'g'))].map(m => m[1]));
      }
      const raw = [...body.matchAll(/(?<![\w.])r\.(\w+)/g)].map(m => m[1]);
      if (helpers.some(h => h !== helper)) bad.push(`${key}: helper ${uniq(helpers)}`);
      if (uniq(fields) !== uniq(want.fields)) bad.push(`${key}: fields ${uniq(fields)}`);
      if (uniq(raw) !== uniq(want.raw ?? [])) bad.push(`${key}: raw ${uniq(raw)}`);
    }
    if (bad.length) console.log(`    ${bad.join(' | ')}`);
    return bad;
  };
  ok('/wip-report body: every column reads wipScheduleCells(r).<its own field> and nothing else',
    columnsRead(WIPS, /const projectColumns: DataTableColumn/, 'wipScheduleCells', {
      job: { fields: [], raw: ['output', 'projectName'] },
      contract: { fields: ['contract'] },
      estCost: { fields: ['estCost'] },
      costToDate: { fields: ['costToDate'], raw: ['input', 'sources'] },
      pct: { fields: ['pctComplete'] },
      earned: { fields: ['earned'] },
      billed: { fields: ['billed'] },
      billing: { fields: ['billing'] },
    }).length === 0);
  ok('/reports WIP body: every column reads reportsWipCells(r).<its own field> and nothing else',
    columnsRead(REPORTS, /const wipColumns: DataTableColumn/, 'reportsWipCells', {
      job: { fields: [], raw: ['projectName'] },
      contract: { fields: ['contract'] },
      estFinal: { fields: ['estFinal'] },
      costToDate: { fields: ['costToDate'] },
      pct: { fields: ['pctComplete'] },
      earned: { fields: ['earned'] },
      billed: { fields: ['billed'] },
      billing: { fields: ['billing'] },
      retainage: { fields: ['retainage'] },
      margin: { fields: ['margin'] },
    }).length === 0);
  ok('/reports Profit body: every column reads profitCells(r).<its own field> and nothing else',
    columnsRead(REPORTS, /const profitColumns: DataTableColumn/, 'profitCells', {
      job: { fields: [], raw: ['health', 'projectName'] },
      revenue: { fields: ['revenue'] },
      costToDate: { fields: ['costToDate'] },
      estFinal: { fields: ['estFinal'] },
      projectedProfit: { fields: ['profit'] },
      margin: { fields: ['margin'] },
      health: { fields: ['health'], raw: ['health'] },
    }).length === 0);
  ok('/reports Aging body: every column reads agingCells(r).<its own field> and nothing else',
    columnsRead(REPORTS, /const agingColumns: DataTableColumn/, 'agingCells', {
      invoiceNumber: { fields: ['invoiceNumber'] },
      job: { fields: ['job'] },
      issued: { fields: ['issued'], raw: ['issueDate'] },
      due: { fields: ['due'], raw: ['dueDate'] },
      total: { fields: ['total'] },
      paid: { fields: ['paid'] },
      retainage: { fields: ['retainage'] },
      outstanding: { fields: ['late', 'outstanding', 'retainageOnly'] },
      daysPastDue: { fields: ['daysPastDue'] },
      bucket: { fields: ['bucketTone', 'bucketWord'] },
    }).length === 0);

  ok("/wip-report: a frozen period's table rows open nothing (onRowOpen is undefined while viewingFrozen)",
    (WIPS.match(/onRowOpen=/g) ?? []).length === 1
      && /onRowOpen=\{viewingFrozen \? undefined : \(r\) => openDrill\(r\.projectId\)\}/.test(WIPS));

  ok('printToolbarAction: key print, Printer icon, blocked exactly when a reason is given, reason passed through',
    /key: 'print'/.test(PRINT) && /icon: Printer/.test(PRINT) && /onPress: o\.onPrint,/.test(PRINT)
      && /disabled: !!o\.blockedReason,/.test(PRINT) && /disabledReason: o\.blockedReason \?\? null,/.test(PRINT)
      && /label: o\.label \?\? 'Print'/.test(PRINT));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('✗ validate-dashboard-tables'); process.exit(1); }
console.log('✓ validate-dashboard-tables: the rail geometry matches the tokens, and every job-cost cell and footer is the engine figure');
