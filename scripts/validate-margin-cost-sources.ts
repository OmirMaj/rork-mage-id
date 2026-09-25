// validate-margin-cost-sources.ts — every margin surface prices the job on the
// SAME cost streams Job Costing does, or says out loud that it did not.
//
// WHY THIS EXISTS (audit round 2, #16). utils/livingEstimate.ts and
// utils/marginRiskScore.ts called computeJobCost with commitments only — no
// receipts, no time entries, no labor rates, no equipment, no permits. With no
// direct actuals the engine's per-phase EAC collapses to the budget, so a
// self-perform kitchen whose crew ran 420 h at $55 against a $15,000 labor line
// and whose receipts ran $31,000 against $25,000 of materials read 23.1%
// 'healthy' on the Margin Board, the project hero, Margin Risk, Margin Alerts
// and the AI's margin fact — while Job Costing showed it over. The push alert
// that exists to warn about margin fade was silent on the overruns an
// owner-operator can still fix.
//
// Pins:
//   1. PARITY — on a self-perform fixture (receipts + priced hours, no sub),
//      Living Estimate projected cost === Job Costing projectedFinal, and the
//      job does not read 'healthy'.
//   1b. HOURS — on a labor-only overrun too large for jobCostEngine's
//      project-level floor to absorb, each engine's EAC equals Job Costing's
//      AND moves when timeEntries is removed (the 1. fixture cannot see that).
//   2. RISK + ALERTS see the same overrun (overrun factor fires; the alert
//      baseline is not 'healthy'; a first-sight alert is raised).
//   3. HONESTY — a snapshot built without costSources is tagged 'subs_only',
//      and the AI fact block never states its health or risk band bare.
//   4. WIRING — every production call site of computeLivingEstimate /
//      computeMarginRisk / computeCurrentBaselines in this lane forwards
//      costSources, every UI bundle names all seven streams, and runJudges
//      withholds a subs-only risk from the verdict; Margin Alerts shows a
//      loading state rather than a false all-clear while the stores load, and
//      so do Portfolio Margin, Margin Risk, Living Estimate and ProjectHero
//      (no number, no count-up, no unread-alert count off empty stores).
//
// 1b also pins the audit kitchen's OWN labor overrun (420 h × $55 = $23,100
// against the $15,000 Labor line, receipts on budget). It used to be NOT
// pinned, because it was not fixed: the engine absorbed that $8,100 into the
// untouched Labor budget and read $60,000 / 'healthy' on Job Costing and every
// margin surface. jobCostEngine now routes priced hours onto the estimate's
// Labor line (LABOR-ROUTE-1; engine-level pins in
// scripts/validate-job-cost-labor-routing.ts).
//
// Run via: bun run scripts/validate-margin-cost-sources.ts

import { computeJobCost, type JobCostActualSources } from '../utils/jobCostEngine';
import { computeLivingEstimate } from '../utils/livingEstimate';
import { computeMarginRisk } from '../utils/marginRiskScore';
import { computeCurrentBaselines, computeAlerts } from '../utils/marginAlerts';
import { buildMarginBlock, buildRiskBlock } from '../utils/oneMind/factBlocks';
import type { Project, LinkedEstimate, MaterialReceipt, TimeEntry, ChangeOrder } from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function close(name: string, got: number, want: number, tol = 0.01) {
  ok(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}

// ── Fixture: the audit's remodeler kitchen ───────────────────────────────
// $60,000 cost / $78,000 sell (23.1% margin), self-performed, no subs.

function estimate(items: { category: string; cost: number }[], grandTotal: number): LinkedEstimate {
  const baseTotal = items.reduce((s, i) => s + i.cost, 0);
  return {
    id: 'est', items: items.map((i, n) => ({
      materialId: `m${n}`, name: i.category, category: i.category, unit: 'ls',
      quantity: 1, unitPrice: i.cost, bulkPrice: i.cost, markup: 0,
      usesBulk: false, lineTotal: i.cost, supplier: '',
    })),
    globalMarkup: 30, baseTotal, markupTotal: grandTotal - baseTotal, grandTotal,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as LinkedEstimate;
}

const PROJECT = {
  id: 'p1', name: 'Kitchen', status: 'in_progress',
  linkedEstimate: estimate([
    { category: 'Labor', cost: 15_000 },
    { category: 'Materials', cost: 25_000 },
    { category: 'Cabinets', cost: 20_000 },
  ], 78_000),
} as unknown as Project;

function receipt(lineTotal: number, category: string): MaterialReceipt {
  return {
    id: `r-${category}-${lineTotal}`, projectId: 'p1', vendor: 'Supply Co',
    lines: [{ id: 'rl1', description: 'Material', category, quantity: 1, unit: 'ls', unitPrice: lineTotal, lineTotal }],
    subtotal: lineTotal, total: lineTotal, status: 'reviewed',
  } as unknown as MaterialReceipt;
}

function shift(hours: number, trade: string): TimeEntry {
  return {
    id: `t-${trade}-${hours}`, projectId: 'p1', projectName: 'Kitchen',
    workerId: 'w1', workerName: 'Ana', trade,
    clockIn: '2026-03-02T08:00:00.000Z', clockOut: '2026-03-02T16:00:00.000Z',
    breakMinutes: 0, totalHours: hours, overtimeHours: 0,
    status: 'clocked_out', date: '2026-03-02',
  } as unknown as TimeEntry;
}

const SOURCES: JobCostActualSources = {
  receipts: [receipt(31_000, 'Materials')],
  timeEntries: [shift(420, 'carpenter')],
  laborRates: { carpenter: 55 },
  overtimeMultiplier: 1.5,
  // #65: the fixture's single 420 h row pools one 'worker'; no threshold keeps
  // the figures about WHICH SOURCES are read, not how overtime is allocated.
  overtimeRule: { weeklyThreshold: null, dailyThreshold: null, weekStartsOn: 1 },
  equipment: [],
  permits: [],
  subcontractors: [],
};

// ── 1. Parity with Job Costing ───────────────────────────────────────────

console.log('\nLiving Estimate EAC is the Job Costing EAC on a self-perform job:');
{
  // Exactly what app/job-costing.tsx hands the engine.
  const jc = computeJobCost({ project: PROJECT, commitments: [], changeOrders: [], ...SOURCES });
  close('the fixture really priced the crew hours and receipts (actual $54,100)', jc.actual, 23_100 + 31_000);
  ok('…and Job Costing projects above the $60,000 cost budget', jc.projectedFinal > 60_000 + 1,
    `projectedFinal ${jc.projectedFinal}`);

  const le = computeLivingEstimate({
    project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: SOURCES,
  });
  close('Living Estimate projected cost === Job Costing projectedFinal', le.projected.cost, jc.projectedFinal);
  ok('…tagged all_sources', le.costBasis === 'all_sources', String(le.costBasis));
  ok('…and the overrun job does not read healthy', le.health !== 'healthy', le.health);
  ok('…projected margin is below the 23.1% bid', le.projected.marginPct < le.original.marginPct - 0.02,
    `${le.projected.marginPct} vs ${le.original.marginPct}`);

  // An approved CO: the only documented gap between the two is the CO's
  // profit credited back at the bid margin (utils/livingEstimate header).
  const co = {
    id: 'co1', projectId: 'p1', number: 1, status: 'approved', changeAmount: 5_000,
    description: 'Island', lineItems: [], createdAt: '2026-03-01', updatedAt: '2026-03-01',
  } as unknown as ChangeOrder;
  const jcCo = computeJobCost({ project: PROJECT, commitments: [], changeOrders: [co], ...SOURCES });
  const leCo = computeLivingEstimate({
    project: PROJECT, changeOrders: [co], commitments: [], invoices: [], costSources: SOURCES,
  });
  close('with an approved CO, EAC differs only by the CO profit at bid margin',
    leCo.projected.cost, Math.max(0, jcCo.projectedFinal - 5_000 * (18_000 / 78_000)));
}

// ── 1b. Priced crew hours reach the engines on their own ────────────────
// The kitchen above cannot tell whether timeEntries reached the margin
// engines: its $6,000 materials overrun alone sets the EAC ($66,000 with or
// without the 420 h), because jobCostEngine's project-level floor absorbs the
// $8,100 labor overrun into the untouched $15,000 'Labor' budget line (hours
// land in a separate unbudgeted 'Self-perform labor' phase). A mutation that
// forwarded receipts but dropped timeEntries passed 52/52 (round-2 review).
// So this fixture runs labor PAST anything the floor could absorb — 1,000 h ×
// $55 = $55,000 with receipts on budget, total actual $80,000 on a $60,000
// cost budget — and asserts, THROUGH each engine, that the EAC equals Job
// Costing's and moves when timeEntries is removed.
//
// (That absorption was the engine's bug, since fixed by LABOR-ROUTE-1: the
// hours now land ON the Labor line. The second block below pins the audit's
// own 420 h case — the one the floor used to swallow whole.)

console.log('\nPriced crew hours move every margin engine (labor-only overrun):');
{
  const LABOR: JobCostActualSources = {
    ...SOURCES,
    receipts: [receipt(25_000, 'Materials')],
    timeEntries: [shift(1_000, 'carpenter')],
  };
  const NO_HOURS: JobCostActualSources = { ...LABOR, timeEntries: [] };
  const jc = computeJobCost({ project: PROJECT, commitments: [], changeOrders: [], ...LABOR });
  const jcNoHours = computeJobCost({ project: PROJECT, commitments: [], changeOrders: [], ...NO_HOURS });
  ok('the fixture: Job Costing EAC exceeds the no-hours EAC', jc.projectedFinal > jcNoHours.projectedFinal + 1,
    `${jc.projectedFinal} vs ${jcNoHours.projectedFinal}`);

  const le = computeLivingEstimate({ project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: LABOR });
  const leNoHours = computeLivingEstimate({ project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: NO_HOURS });
  close('Living Estimate projected cost === Job Costing projectedFinal (labor-only)', le.projected.cost, jc.projectedFinal);
  ok('…and it is above the same run with timeEntries removed', le.projected.cost > leNoHours.projected.cost + 1,
    `${le.projected.cost} vs ${leNoHours.projected.cost}`);
  ok('…and the labor-overrun job does not read healthy', le.health !== 'healthy', le.health);

  // Margin Risk: its projected margin comes off its own internal living
  // estimate, and its overrun factor off its own job-cost call — both must
  // see the hours.
  const sell = le.projected.revenue;
  const risk = computeMarginRisk({ project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: LABOR });
  const riskNoHours = computeMarginRisk({ project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: NO_HOURS });
  const overrun = risk.factors.find(f => f.key === 'overrun');
  ok('Margin Risk overrun factor fires on labor alone', (overrun?.risk ?? 0) > 0, JSON.stringify(overrun));
  ok('…and the risk score is higher than with timeEntries removed', risk.score > riskNoHours.score,
    `${risk.score} vs ${riskNoHours.score}`);

  const withHours = computeCurrentBaselines({ projects: [PROJECT], changeOrders: [], commitments: [], invoices: [], costSources: LABOR });
  const withoutHours = computeCurrentBaselines({ projects: [PROJECT], changeOrders: [], commitments: [], invoices: [], costSources: NO_HOURS });
  close('the alert baseline margin is priced on Job Costing\'s EAC',
    withHours.baselines.p1?.marginPct ?? NaN, sell > 0 ? (sell - jc.projectedFinal) / sell : NaN, 0.0005);
  ok('…and is lower than with timeEntries removed',
    (withHours.baselines.p1?.marginPct ?? 1) < (withoutHours.baselines.p1?.marginPct ?? 0) - 0.01,
    `${withHours.baselines.p1?.marginPct} vs ${withoutHours.baselines.p1?.marginPct}`);
  ok('…and a first-sight alert is raised on labor alone',
    computeAlerts(withHours.baselines, withHours.names, {}).some(a => a.projectId === 'p1' && a.direction === 'worsened'));

  // The basis switch is not a change on the job (integration round 1). An
  // acknowledged baseline stored before costSources existed (no costBasis,
  // subs-only) must not turn into "risk rose — climbed from X to Y".
  const legacy = computeCurrentBaselines({ projects: [PROJECT], changeOrders: [], commitments: [], invoices: [] });
  // The critic's case, built directly: 22/low acknowledged on the old basis,
  // 61/high on the new one with nothing changed on the job.
  const base = { projectId: 'p9', health: 'watch' as const, marginPct: 0.1, erosionPoints: -3, erosionStep: 2, bidAtCost: false, asOf: '2026-09-18' };
  const legacyAck = { p9: { ...base, band: 'low' as const, score: 22 } };
  const nowHigh = { p9: { ...base, band: 'high' as const, score: 61, costBasis: 'all_sources' as const } };
  const afterSwitch = computeAlerts(nowHigh, { p9: 'Kitchen' }, legacyAck);
  ok('a baseline on the old cost basis is compared as first sight, not as a "climb"',
    JSON.stringify(afterSwitch) === JSON.stringify(computeAlerts(nowHigh, { p9: 'Kitchen' }, {}))
      && !afterSwitch.some(a => /climbed/.test(a.detail)), JSON.stringify(afterSwitch.map(a => a.detail)));
  ok('…while a same-basis 22 → 61 is still a climb',
    computeAlerts(nowHigh, { p9: 'Kitchen' }, { p9: { ...legacyAck.p9, costBasis: 'all_sources' } }).some(a => /climbed from 22 to 61/.test(a.detail)));
  ok('…the current baselines carry their basis', withHours.baselines.p1?.costBasis === 'all_sources' && legacy.baselines.p1?.costBasis === 'committed_only');
  ok('…and a same-basis baseline still suppresses a repeat', computeAlerts(withHours.baselines, withHours.names, withHours.baselines).length === 0);
}

console.log('\nThe audit kitchen\'s own labor overrun (420 h, receipts on budget) is not absorbed:');
{
  // 420 h × $55 = $23,100 against the $15,000 Labor line: an $8,100 overrun
  // SMALLER than the $20,000 of untouched Cabinets budget. Before LABOR-ROUTE-1
  // the engine charged the hours to an unbudgeted 'Self-perform labor' phase
  // and the project floor absorbed them into the untouched Labor line itself:
  // EAC $60,000 with or without the hours, 23.1% 'healthy', no alert.
  const KITCHEN_HOURS: JobCostActualSources = {
    ...SOURCES,
    receipts: [receipt(25_000, 'Materials')],
    timeEntries: [shift(420, 'carpenter')],
  };
  const KITCHEN_NO_HOURS: JobCostActualSources = { ...KITCHEN_HOURS, timeEntries: [] };
  const jc = computeJobCost({ project: PROJECT, commitments: [], changeOrders: [], ...KITCHEN_HOURS });
  close('Job Costing carries the $8,100 labor overrun (EAC $68,100)', jc.projectedFinal, 68_100);
  const le = computeLivingEstimate({ project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: KITCHEN_HOURS });
  const leNoHours = computeLivingEstimate({ project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: KITCHEN_NO_HOURS });
  close('Living Estimate projected cost === Job Costing projectedFinal', le.projected.cost, jc.projectedFinal);
  ok('…above the same run with timeEntries removed', le.projected.cost > leNoHours.projected.cost,
    `${le.projected.cost} vs ${leNoHours.projected.cost}`);
  ok('…and the job does not read healthy', le.health !== 'healthy', `${le.health} at ${le.projected.marginPct}`);
  const b = computeCurrentBaselines({ projects: [PROJECT], changeOrders: [], commitments: [], invoices: [], costSources: KITCHEN_HOURS });
  ok('…and a first-sight margin alert is raised',
    computeAlerts(b.baselines, b.names, {}).some(a => a.projectId === 'p1' && a.direction === 'worsened'));
}

// ── 2. Risk and alerts see the same overrun ──────────────────────────────

console.log('\nMargin Risk and Margin Alerts see the overrun:');
{
  const risk = computeMarginRisk({
    project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: SOURCES,
  });
  const overrun = risk.factors.find(f => f.key === 'overrun');
  ok('the cost-overrun factor fires', (overrun?.risk ?? 0) > 0, JSON.stringify(overrun));
  ok('…and risk is tagged all_sources', risk.costBasis === 'all_sources', String(risk.costBasis));

  const { baselines, names } = computeCurrentBaselines({
    projects: [PROJECT], changeOrders: [], commitments: [], invoices: [], costSources: SOURCES,
  });
  ok('the alert baseline is not healthy', baselines.p1 && baselines.p1.health !== 'healthy',
    JSON.stringify(baselines.p1));
  const alerts = computeAlerts(baselines, names, {});
  ok('…and a first-sight margin alert is raised', alerts.some(a => a.projectId === 'p1' && a.direction === 'worsened'),
    JSON.stringify(alerts.map(a => a.id)));
}

// ── 3. Honesty when the caller could not pass the streams ────────────────

console.log('\nA subs-only snapshot says so:');
{
  const le = computeLivingEstimate({ project: PROJECT, changeOrders: [], commitments: [], invoices: [] });
  ok('no costSources → costBasis subs_only', le.costBasis === 'subs_only', String(le.costBasis));
  close('…and (the defect, measured) its EAC collapses to the $60,000 budget', le.projected.cost, 60_000);

  const block = buildMarginBlock('p1', 'Kitchen', le);
  const projectedLine = block.facts.find(f => /^Projected margin/.test(f)) ?? '';
  ok('the AI projected-margin fact carries the subs-only caveat inline', /subs only/i.test(projectedLine), projectedLine);
  ok('the AI never gets a bare "Margin health: healthy."',
    !block.facts.some(f => /^Margin health: /.test(f)), block.facts.join(' | '));
  ok('…its health line names the limited basis',
    block.facts.some(f => /subcontracts only/i.test(f)), block.facts.join(' | '));

  const risk = computeMarginRisk({ project: PROJECT, changeOrders: [], commitments: [], invoices: [] });
  ok('subs-only risk is tagged', risk.costBasis === 'subs_only', String(risk.costBasis));
  const overrun = risk.factors.find(f => f.key === 'overrun');
  ok('…and never claims "Costs within budget" for money it never saw',
    overrun?.detail !== 'Costs within budget', overrun?.detail);
  const rb = buildRiskBlock('p1', risk);
  ok('…and the AI risk line carries the caveat', !!rb && /subs only/i.test(rb.facts[0]), rb?.facts[0]);

  // Full basis stays clean — the caveat is not noise on every answer.
  const full = buildMarginBlock('p1', 'Kitchen', computeLivingEstimate({
    project: PROJECT, changeOrders: [], commitments: [], invoices: [], costSources: SOURCES,
  }));
  ok('a full-basis block carries no subs-only caveat', !full.facts.some(f => /subs only|subcontracts only/i.test(f)),
    full.facts.join(' | '));
}

// ── 4. Wiring at every call site ─────────────────────────────────────────

console.log('\nEvery call site forwards costSources:');
{
  const CALLERS = [
    'app/portfolio-margin.tsx', 'app/margin-alerts.tsx', 'app/margin-risk.tsx',
    // ProjectHero's streams moved into hooks/useProjectPulse (wave 6c, lane E):
    // the phone hero and the desktop KPI strip read ONE pulse.
    'app/living-estimate.tsx', 'hooks/useProjectPulse.ts', 'components/MarginAlertManager.tsx',
    'utils/marginAlerts.ts', 'utils/marginRiskScore.ts', 'utils/oneMind/factBlocks.ts',
    'utils/judges/runJudges.ts',
  ];
  // Each call's argument list is cut out by paren balance (a lazy regex runs
  // past the first `})` into the next call and can pass on a neighbour's
  // costSources). Function DEFINITIONS are skipped.
  const CALL = /\b(computeLivingEstimate|computeMarginRisk|computeCurrentBaselines|computeJobCost)\(/g;
  const argsAt = (src: string, open: number): string => {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1);
    }
    return src.slice(open);
  };
  for (const file of CALLERS) {
    const src = stripComments(read(file));
    const calls = [...src.matchAll(CALL)]
      .filter(m => !/function\s+$/.test(src.slice(Math.max(0, m.index! - 12), m.index!)));
    ok(`${file} has engine calls to check`, calls.length > 0);
    for (const m of calls) {
      const args = argsAt(src, m.index! + m[1].length);
      ok(`${file}: ${m[1]}(…) forwards costSources`, /costSources/.test(args), args.slice(0, 200));
    }
  }
  // The engine files spread it into computeJobCost, not just accept it.
  for (const file of ['utils/livingEstimate.ts', 'utils/marginRiskScore.ts']) {
    const src = stripComments(read(file));
    ok(`${file} spreads costSources into computeJobCost`,
      /computeJobCost\(\{[^}]*\.\.\.costSources[^}]*\}\)/.test(src));
  }
  // A memo that silently drops one stream (say timeEntries) still "forwards
  // costSources" by name, and the engine then prices the job without it. So
  // every UI bundle must name all seven streams Job Costing hands the engine.
  const STREAMS = ['receipts', 'timeEntries', 'laborRates', 'overtimeMultiplier', 'overtimeRule', 'equipment', 'permits', 'subcontractors'];
  for (const file of [
    'app/portfolio-margin.tsx', 'app/margin-alerts.tsx', 'app/margin-risk.tsx',
    'app/living-estimate.tsx', 'hooks/useProjectPulse.ts', 'components/MarginAlertManager.tsx',
  ]) {
    const src = stripComments(read(file));
    const memo = /const costSources = useMemo<JobCostActualSources>\(\(\) => \(\{([^}]*)\}\)/.exec(src);
    const fields = new Set((memo?.[1] ?? '').split(',').map(f => f.trim().split(':')[0].trim()).filter(Boolean));
    const missing = STREAMS.filter(f => !fields.has(f));
    ok(`${file}: the costSources bundle carries all seven streams`, !!memo && missing.length === 0,
      memo ? `missing ${missing.join(', ')}` : 'no costSources memo found');
  }
  const judges = stripComments(read('utils/judges/runJudges.ts'));
  ok('runJudges only lets a whole-job risk reading vote',
    /if \(params\.project && params\.ctx\.costSources\)/.test(judges));
  // The two baseline writers must not stamp a reading taken before the
  // local cost stores loaded.
  ok('MarginAlertManager holds evaluation until the cost stores load',
    /if \(!enabled \|\| !costSourcesReady\) return;/.test(stripComments(read('components/MarginAlertManager.tsx'))));
  ok('Margin Alerts will not mark read on a partial reading',
    /if \(!costSourcesReady\) return;/.test(stripComments(read('app/margin-alerts.tsx'))));
  // …and will not flash "No new margin alerts" while it cannot yet know.
  {
    const src = stripComments(read('app/margin-alerts.tsx'));
    const loadingAt = src.indexOf('!loaded || !costSourcesReady ?');
    const emptyAt = src.indexOf('<EmptyState');
    ok('Margin Alerts renders a loading state, not the all-clear, until the stores load',
      loadingAt > 0 && emptyAt > loadingAt && /testID="margin-alerts-loading"/.test(src));
  }
  // The four READ surfaces were missing that gate: for one pass on the
  // empty-default stores a self-perform job read its bid margin as a reading
  // (ProjectHero counted up to it under HEALTHY) and the board's unread-alerts
  // banner was counted off the same partial picture (round-2 final review).
  // Each must derive readiness from all three stores, by the EXPORTED mirror
  // key, and branch to a loading state BEFORE the first number renders.
  const READY = /const costSourcesReady = !receiptsLoading && !ratesLoading && mirrorLoaded;/;
  const MIRROR = /const mirrorLoaded = queryClient\.getQueryState\(TIME_ENTRIES_MIRROR_QUERY_KEY\)\?\.data !== undefined;/;
  // The 4th element names where the READINESS is derived when that is not
  // the drawing file: ProjectHero reads costSourcesReady from the pulse
  // (hooks/useProjectPulse), and still draws its loading state first.
  const SURFACES: [file: string, testId: string, firstNumber: string, readyFile?: string][] = [
    ['app/portfolio-margin.tsx', 'portfolio-margin-loading', '{formatMoney(totalRevenue)}'],
    ['app/margin-risk.tsx', 'margin-risk-loading', '{risk.score}'],
    ['app/living-estimate.tsx', 'living-estimate-loading', '{pct(snapshot.projected.marginPct)}'],
    ['components/ProjectHero.tsx', 'project-hero-loading', '{shown.toFixed(1)}', 'hooks/useProjectPulse.ts'],
  ];
  for (const [file, testId, firstNumber, readyFile] of SURFACES) {
    const src = stripComments(read(file));
    const readySrc = readyFile ? stripComments(read(readyFile)) : src;
    ok(`${readyFile ?? file}: readiness covers receipts, rates AND the time-entry mirror`, READY.test(readySrc) && MIRROR.test(readySrc));
    const loadingAt = src.indexOf(`testID="${testId}"`);
    const numberAt = src.indexOf(firstNumber);
    ok(`${file}: shows a loading state before the first margin number`,
      loadingAt > 0 && numberAt > loadingAt, `loading ${loadingAt}, number ${numberAt}`);
  }
  for (const file of [...SURFACES.map(s => s[0]), 'hooks/useProjectPulse.ts', 'components/MarginAlertManager.tsx', 'app/margin-alerts.tsx', 'app/client-portal-setup.tsx']) {
    ok(`${file}: reads the mirror by the exported key, not a copied literal`,
      !/\['time-entries-mirror'\]/.test(stripComments(read(file))));
  }
  {
    const board = stripComments(read('app/portfolio-margin.tsx'));
    ok('the Margin Board counts unread alerts only once the stores load',
      /const unreadAlerts = useMemo\(\(\) => \{\s*if \(!costSourcesReady\) return 0;/.test(board));
    const hero = stripComments(read('components/ProjectHero.tsx'));
    ok('ProjectHero does not count up toward a partial reading',
      /useEffect\(\(\) => \{\s*if \(!costSourcesReady\) return;\s*const id = anim\.addListener/.test(hero));
    // …and the readiness it waits on is the pulse's (the one derived above),
    // not a second, looser copy of its own.
    ok('ProjectHero takes costSourcesReady from the pulse and computes no margin of its own',
      /const \{ living, risk, costSourcesReady, role, roleError \} = pulse;/.test(hero)
      && !/\bcomputeLivingEstimate\(|\bcomputeMarginRisk\(|\bconst costSourcesReady\b/.test(hero));
  }
  // The client portal DISCLOSES this number: on a GMP / open-book job the rich
  // snapshot carries cost-to-date to the homeowner, and it auto-publishes to
  // portal_snapshots 200 ms after the first ready snapshot. Published before
  // receipts / rates / the mirror loaded, it went out subcontract-only — and
  // project-detail's lite writer then carried that block forward (round 3).
  {
    const setup = stripComments(read('app/client-portal-setup.tsx'));
    ok('client-portal-setup: readiness covers receipts, rates AND the time-entry mirror', READY.test(setup) && MIRROR.test(setup));
    const memo = /const costSources = useMemo<JobCostActualSources>\(\(\) => \(\{([^}]*)\}\)/.exec(setup);
    const missing = STREAMS.filter(f => !new Set((memo?.[1] ?? '').split(',').map(x => x.trim())).has(f));
    ok('client-portal-setup: the costSources bundle carries all seven streams', !!memo && missing.length === 0, `missing ${missing.join(', ')}`);
    const persistAt = setup.indexOf(".from('portal_snapshots')\n        .upsert(");
    const effectAt = setup.lastIndexOf('useEffect(() => {', persistAt);
    const effect = setup.slice(effectAt, persistAt);
    ok('client-portal-setup: an open-book / GMP snapshot is not published until the cost streams load',
      persistAt > 0
        && /const disclosesCost = project\.contractMode === 'gmp' \|\| project\.contractMode === 'open_book';/.test(effect)
        && /if \(disclosesCost && !costSourcesReady\) return;/.test(effect),
      effect.slice(0, 300));
    const depsEnd = setup.indexOf(']);', persistAt);
    ok('…and re-runs when they do (costSourcesReady is a dependency)',
      /costSourcesReady/.test(setup.slice(persistAt, depsEnd)));
    // The hash invite link embeds the snapshot and is never refreshed from the
    // server — so it must not be built from a GMP / open-book snapshot whose
    // cost streams have not loaded (short link instead).
    const linkAt = setup.indexOf('const buildInviteLink = useCallback(');
    const link = linkAt >= 0 ? setup.slice(linkAt, setup.indexOf('}, [', linkAt)) : '';
    ok('client-portal-setup: an invite link built before the cost streams load is the short (server-read) link',
      /const snapshotHeldForCosts = \(project\?\.contractMode === 'gmp' \|\| project\?\.contractMode === 'open_book'\) && !costSourcesReady;/.test(setup)
        && /if \(!snapshot \|\| snapshotHeldForCosts\) return buildShortPortalUrl\(/.test(link)
        && /snapshotHeldForCosts/.test(setup.slice(setup.indexOf('}, [', linkAt), setup.indexOf(']);', linkAt))),
      link.slice(0, 300));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
