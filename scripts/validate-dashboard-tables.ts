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
//
// Run via: bun run test:dashboard-tables

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DASHBOARD_GUTTER, DASHBOARD_MAIN_MIN, DASHBOARD_RAIL, dashboardColumnsFit, dashboardMainWidth,
} from '../utils/dashboardColumns';
import { jobCostFooter, jobCostPhaseCells, pctSpentText } from '../utils/dashboardTables';
import { MENU_MAX_WIDTH, MENU_OFFSET } from '../utils/popoverPosition';
import { computeJobCost } from '../utils/jobCostEngine';
import type { Commitment, LinkedEstimate, Project } from '../types';

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('✗ validate-dashboard-tables'); process.exit(1); }
console.log('✓ validate-dashboard-tables: the rail geometry matches the tokens, and every job-cost cell and footer is the engine figure');
