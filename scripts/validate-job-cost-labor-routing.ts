// validate-job-cost-labor-routing.ts — a crew-labor overrun reaches the
// estimate-at-completion (LABOR-ROUTE-1, audit round 2, #16 follow-up).
//
// WHY THIS EXISTS. utils/jobCostEngine.ts put priced crew hours (finished
// shifts × the GC's loaded rates) in their own unbudgeted 'Self-perform labor'
// phase, unconditionally. The project-level headline absorbs unbudgeted spend
// into the job's untouched budget — and the untouched budget it found was the
// estimate's own Labor line, the one the hours were spent against. Measured on
// the audit kitchen ($60,000 cost / $78,000 sell, 420 h × $55 = $23,100 against
// a $15,000 Labor line, receipts on budget): EAC $60,000, variance $0, 23.1%
// 'healthy', no alert — on Job Costing and on every margin surface. The engine
// now routes the hours onto the estimate's Labor line when it has one.
//
// Pins:
//   1. THE KITCHEN — hours land on the 'Labor' row, the row and the headline
//      both carry the $8,100 overrun, and nothing is absorbed.
//   2. THE FLOOR — the headline is never below actual + remaining committed,
//      across a sweep of fixtures with and without hours.
//   3. NO PRICED HOURS = TODAY — every fixture without priced hours computes
//      the exact numbers the pre-fix engine did (golden values captured from
//      it), and unrated trades / live shifts / no entries are indistinguishable.
//   4. ROUTING RULES — lowercase 'labor' (assemblies, the smoke world) and
//      'Labour' route too and keep the estimator's label; an estimate with no
//      labor line, or whose labor line a subcontract bought out, keeps the
//      dedicated 'Self-perform labor' row (the documented fallback).
//
// Run via: bun run scripts/validate-job-cost-labor-routing.ts
// (register as test:job-cost-labor-routing)

import { computeJobCost, commitmentUnpaid, type JobCostSummary, type JobCostInput } from '../utils/jobCostEngine';
import type { Project, LinkedEstimate, MaterialReceipt, TimeEntry, Commitment } from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function close(name: string, got: number | undefined, want: number, tol = 0.01) {
  ok(name, got !== undefined && Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}

// ── Fixture builders ──────────────────────────────────────────────────────

function estimate(items: { category: string; cost: number; supplier?: string }[], grandTotal: number): LinkedEstimate {
  const baseTotal = items.reduce((s, i) => s + i.cost, 0);
  return {
    id: 'est', items: items.map((i, n) => ({
      materialId: `m${n}`, name: i.category, category: i.category, unit: 'ls',
      quantity: 1, unitPrice: i.cost, bulkPrice: i.cost, markup: 0,
      usesBulk: false, lineTotal: i.cost, supplier: i.supplier ?? '',
    })),
    globalMarkup: 30, baseTotal, markupTotal: grandTotal - baseTotal, grandTotal,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as LinkedEstimate;
}

function project(linkedEstimate?: LinkedEstimate): Project {
  return { id: 'p1', name: 'Kitchen', status: 'in_progress', linkedEstimate } as unknown as Project;
}

function receipt(lineTotal: number, category: string): MaterialReceipt {
  return {
    id: `r-${category}-${lineTotal}`, projectId: 'p1', vendor: 'Supply Co',
    lines: [{ id: 'rl1', description: 'Material', category, quantity: 1, unit: 'ls', unitPrice: lineTotal, lineTotal }],
    subtotal: lineTotal, total: lineTotal, status: 'reviewed',
  } as unknown as MaterialReceipt;
}

function shift(hours: number, trade: string, status: TimeEntry['status'] = 'clocked_out'): TimeEntry {
  return {
    id: `t-${trade}-${hours}-${status}`, projectId: 'p1', projectName: 'Kitchen',
    workerId: 'w1', workerName: 'Ana', trade,
    clockIn: '2026-03-02T08:00:00.000Z', clockOut: '2026-03-02T16:00:00.000Z',
    breakMinutes: 0, totalHours: hours, overtimeHours: 0,
    status, date: '2026-03-02',
  } as unknown as TimeEntry;
}

function commitment(id: string, over: Partial<Commitment>): Commitment {
  return {
    id, projectId: 'p1', number: id, type: 'subcontract', description: id,
    amount: 0, signedDate: '2026-02-01', status: 'executed',
    createdAt: '2026-02-01', updatedAt: '2026-02-01', ...over,
  } as Commitment;
}

const RATES = { carpenter: 55 };

const KITCHEN = project(estimate([
  { category: 'Labor', cost: 15_000 },
  { category: 'Materials', cost: 25_000 },
  { category: 'Cabinets', cost: 20_000 },
], 78_000));

/** The smoke world's shape: assembly-style lowercase 'labor' lines, a
 *  plumbing sub on a 'subcontractor' line, and real payments. */
const WORLDISH = project(estimate([
  { category: 'labor', cost: 6_800 },
  { category: 'labor', cost: 7_488 },
  { category: 'millwork', cost: 41_250 },
  { category: 'subcontractor', cost: 18_400, supplier: 'Alder Mechanical' },
  { category: 'labor', cost: 26_900 },
], 118_000));
const WORLD_COMMITMENTS = [
  commitment('c-plumb', { vendorName: 'Alder Mechanical', phase: 'Plumbing', amount: 19_600, paidToDate: 9_000 }),
];

const NO_LABOR_LINE = project(estimate([
  { category: 'Materials', cost: 30_000 },
  { category: 'Cabinets', cost: 20_000 },
], 65_000));

const NO_ESTIMATE = project(undefined);

function run(p: Project, extra: Partial<JobCostInput> = {}): JobCostSummary {
  return computeJobCost({ project: p, commitments: [], changeOrders: [], ...extra });
}
const row = (s: JobCostSummary, phase: string) => s.byPhase.find(l => l.phase === phase);

/** The numbers a screen shows, with the clock-stamped `asOf` removed. */
function shape(s: JobCostSummary) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    budget: r2(s.budget), committed: r2(s.committed), actual: r2(s.actual),
    projectedFinal: r2(s.projectedFinal), variance: r2(s.variance), absorbedVariance: s.absorbedVariance,
    byPhase: s.byPhase.map(l => [l.phase, r2(l.budget), r2(l.committed), r2(l.actual), r2(l.projectedFinal), l.status]),
  };
}

// ── 1. The audit kitchen ───────────────────────────────────────────────────

console.log('\nThe audit kitchen: a crew-labor overrun reaches the EAC:');
{
  const withHours = run(KITCHEN, {
    receipts: [receipt(25_000, 'Materials')], timeEntries: [shift(420, 'carpenter')], laborRates: RATES,
  });
  const noHours = run(KITCHEN, { receipts: [receipt(25_000, 'Materials')], laborRates: RATES });
  close('the 420 h are priced at $23,100 of actual', withHours.actual - noHours.actual, 23_100);
  const labor = row(withHours, 'Labor');
  close('…and land on the estimate\'s Labor row', labor?.actual, 23_100);
  ok('…which names the shift in its drill-down', (labor?.sources.timeEntries.length ?? 0) === 1,
    JSON.stringify(labor?.sources.timeEntries));
  ok('…with no separate unbudgeted "Self-perform labor" row', !row(withHours, 'Self-perform labor'),
    JSON.stringify(withHours.byPhase.map(l => l.phase)));
  close('the Labor row reads the $8,100 overrun', labor?.variance, 8_100);
  ok('…and is not "on track"', labor?.status !== 'on_track', String(labor?.status));
  close('Job Costing EAC is $68,100, not $60,000', withHours.projectedFinal, 68_100);
  close('…variance +$8,100', withHours.variance, 8_100);
  close('…the headline absorbs nothing the rows show', withHours.absorbedVariance, 0);
  ok('…and it is ABOVE the same job with no hours', withHours.projectedFinal > noHours.projectedFinal + 1,
    `${withHours.projectedFinal} vs ${noHours.projectedFinal}`);

  // The audit's full repro: receipts ALSO over ($31,000 vs $25,000).
  const full = run(KITCHEN, {
    receipts: [receipt(31_000, 'Materials')], timeEntries: [shift(420, 'carpenter')], laborRates: RATES,
  });
  close('with receipts $6,000 over too, EAC carries both overruns ($74,100)', full.projectedFinal, 74_100);
}

// ── 2. The floor: never below actual + remaining committed ───────────────

console.log('\nThe headline never drops below actual + remaining committed:');
{
  const cases: [string, Project, Partial<JobCostInput>][] = [];
  const hourSets = [[], [shift(420, 'carpenter')], [shift(1_000, 'carpenter')], [shift(40, 'carpenter')]];
  const receiptSets = [[], [receipt(25_000, 'Materials')], [receipt(31_000, 'Materials')], [receipt(4_000, 'labor')]];
  for (const [name, p, commitments] of [
    ['kitchen', KITCHEN, []], ['worldish', WORLDISH, WORLD_COMMITMENTS],
    ['no labor line', NO_LABOR_LINE, []], ['no estimate', NO_ESTIMATE, WORLD_COMMITMENTS],
  ] as [string, Project, Commitment[]][]) {
    for (const [h, hours] of hourSets.entries()) {
      for (const [r, receipts] of receiptSets.entries()) {
        cases.push([`${name} h${h} r${r}`, p, { commitments, timeEntries: hours, receipts, laborRates: RATES }]);
      }
    }
  }
  let worst = '';
  for (const [name, p, extra] of cases) {
    const s = run(p, extra);
    // No fixture here snaps a receipt to a commitment, so what is still owed
    // on the commitments is exactly Σ (value − paidToDate).
    const remaining = (extra.commitments ?? []).reduce((acc, c) => acc + commitmentUnpaid(c), 0);
    if (s.projectedFinal + 0.005 < s.actual + remaining && !worst) {
      worst = `${name}: projectedFinal ${s.projectedFinal} < actual ${s.actual} + remaining committed ${remaining}`;
    }
  }
  ok(`EAC ≥ actual + unpaid commitments, on ${cases.length} fixtures`, worst === '', worst);
}

// ── 3. No priced hours computes exactly as the pre-fix engine ─────────────
// GOLDEN values were captured by running THESE fixtures through the engine
// with LABOR-ROUTE-1 reverted (phase hard-wired to 'Self-perform labor').
// They are literals on purpose: comparing the engine to itself would pass on
// any change. If one of these moves, a job with no crew hours changed its
// numbers — that is a regression, not a golden to refresh.

console.log('\nNo priced hours: identical to the pre-fix engine:');
const GOLDEN: Record<string, ReturnType<typeof shape>> = {
  kitchen: {"budget": 60000, "committed": 0, "actual": 31000, "projectedFinal": 66000, "variance": 6000, "absorbedVariance": 0, "byPhase": [["Materials", 25000, 0, 31000, 31000, "over"], ["Cabinets", 20000, 0, 0, 20000, "on_track"], ["Labor", 15000, 0, 0, 15000, "on_track"]]},
  worldish: {"budget": 100838, "committed": 19600, "actual": 13000, "projectedFinal": 102038, "variance": 1200, "absorbedVariance": 0, "byPhase": [["millwork", 41250, 0, 0, 41250, "on_track"], ["labor", 41188, 0, 4000, 41188, "on_track"], ["Plumbing", 18400, 19600, 9000, 19600, "over"]]},
  noLaborLine: {"budget": 50000, "committed": 0, "actual": 30000, "projectedFinal": 50000, "variance": 0, "absorbedVariance": 0, "byPhase": [["Materials", 30000, 0, 30000, 30000, "on_track"], ["Cabinets", 20000, 0, 0, 20000, "on_track"]]},
  noEstimate: {"budget": 0, "committed": 19600, "actual": 9000, "projectedFinal": 19600, "variance": 19600, "absorbedVariance": 0, "byPhase": [["Plumbing", 0, 19600, 9000, 19600, "unbudgeted"]]},
  noLaborLineWithHours: {"budget": 50000, "committed": 0, "actual": 53100, "projectedFinal": 53100, "variance": 3100, "absorbedVariance": 20000, "byPhase": [["Materials", 30000, 0, 30000, 30000, "on_track"], ["Cabinets", 20000, 0, 0, 20000, "on_track"], ["Self-perform labor", 0, 0, 23100, 23100, "unbudgeted"]]},
};

const NO_HOUR_FIXTURES: Record<string, () => JobCostSummary> = {
  kitchen: () => run(KITCHEN, { receipts: [receipt(31_000, 'Materials')], laborRates: RATES }),
  worldish: () => run(WORLDISH, { commitments: WORLD_COMMITMENTS, receipts: [receipt(4_000, 'labor')], laborRates: RATES }),
  noLaborLine: () => run(NO_LABOR_LINE, { receipts: [receipt(30_000, 'Materials')], laborRates: RATES }),
  noEstimate: () => run(NO_ESTIMATE, { commitments: WORLD_COMMITMENTS, laborRates: RATES }),
};
// The fallback path WITH hours is also pre-fix behavior (no labor line to
// route to), so it is golden too. Its absorbedVariance of $20,000 is the
// documented unbudgeted-spend trade-off in jobCostEngine's totals block, NOT
// an endorsement of it: if that trade-off is deliberately changed, update
// this one golden with the reason; the four no-hours goldens must never move.
const FALLBACK_FIXTURES: Record<string, () => JobCostSummary> = {
  noLaborLineWithHours: () => run(NO_LABOR_LINE, {
    receipts: [receipt(30_000, 'Materials')], timeEntries: [shift(420, 'carpenter')], laborRates: RATES,
  }),
};

if (process.env.PRINT_GOLDEN === '1') {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries({ ...NO_HOUR_FIXTURES, ...FALLBACK_FIXTURES })) out[k] = shape(f());
  console.log(JSON.stringify(out));
  process.exit(0);
}

for (const [name, f] of Object.entries({ ...NO_HOUR_FIXTURES, ...FALLBACK_FIXTURES })) {
  const got = JSON.stringify(shape(f()));
  const want = JSON.stringify(GOLDEN[name]);
  ok(`${name}: byte-identical to the pre-fix engine`, got === want, `got  ${got}\n      want ${want}`);
}
{
  // Three ways a job can have entries and still no PRICED hours. Each must be
  // indistinguishable from passing no entries at all.
  const base = { receipts: [receipt(31_000, 'Materials')], laborRates: RATES };
  const none = JSON.stringify(shape(run(KITCHEN, base)));
  ok('an unrated trade (hours, no rate) moves nothing',
    JSON.stringify(shape(run(KITCHEN, { ...base, timeEntries: [shift(420, 'plumber')] }))) === none);
  ok('a live shift (still clocked in) moves nothing',
    JSON.stringify(shape(run(KITCHEN, { ...base, timeEntries: [shift(420, 'carpenter', 'clocked_in')] }))) === none);
  ok('a zero-hour shift moves nothing',
    JSON.stringify(shape(run(KITCHEN, { ...base, timeEntries: [shift(0, 'carpenter')] }))) === none);
}

// ── 4. Routing rules ──────────────────────────────────────────────────────

console.log('\nRouting rules:');
{
  const w = run(WORLDISH, {
    commitments: WORLD_COMMITMENTS, timeEntries: [shift(1_000, 'carpenter')], laborRates: RATES,
  });
  const labor = row(w, 'labor');
  close('lowercase "labor" (assemblies, the smoke world) receives the hours', labor?.actual, 55_000);
  ok('…under the label the estimator wrote', !!labor && !row(w, 'Labor') && !row(w, 'Self-perform labor'),
    JSON.stringify(w.byPhase.map(l => l.phase)));
  close('…and the $13,812 labor overrun is on the headline', w.variance, 1_200 + (55_000 - 41_188));

  const uk = run(project(estimate([{ category: 'Labour', cost: 15_000 }, { category: 'Materials', cost: 25_000 }], 50_000)), {
    timeEntries: [shift(420, 'carpenter')], laborRates: RATES,
  });
  close('"Labour" is the same line', row(uk, 'Labour')?.actual, 23_100);
  close('…and its overrun is on the headline', uk.variance, 8_100);

  const fallback = FALLBACK_FIXTURES.noLaborLineWithHours();
  ok('no labor line → the dedicated "Self-perform labor" row (unchanged)',
    row(fallback, 'Self-perform labor')?.actual === 23_100, JSON.stringify(fallback.byPhase.map(l => l.phase)));
  ok('…and no trade bucket is charged for it (Materials is a materials line)',
    (row(fallback, 'Materials')?.sources.timeEntries.length ?? 0) === 0);

  // A labor subcontract that bought the Labor line out: its budget moved to
  // the sub's phase, so the GC's own hours are not spent against it.
  const boughtOut = run(project(estimate([
    { category: 'Labor', cost: 15_000, supplier: 'Crew Rental LLC' },
    { category: 'Materials', cost: 25_000 },
  ], 50_000)), {
    commitments: [commitment('c-lab', { vendorName: 'Crew Rental LLC', phase: 'Framing', amount: 15_000 })],
    timeEntries: [shift(40, 'carpenter')], laborRates: RATES,
  });
  // A 'Labor' row the ESTIMATE never budgeted — here a labor-broker PO the GC
  // typed as phase 'Labor' — is not the estimate's labor line. Merging the
  // crew's hours into it would present them as spend against that PO.
  const brokerOnly = run(NO_LABOR_LINE, {
    commitments: [commitment('c-broker', { vendorName: 'Temp Crew Co', phase: 'Labor', amount: 5_000 })],
    timeEntries: [shift(40, 'carpenter')], laborRates: RATES,
  });
  ok('an unbudgeted "Labor" row (a broker PO) does not take the GC\'s hours',
    (row(brokerOnly, 'Labor')?.sources.timeEntries.length ?? 0) === 0
      && row(brokerOnly, 'Self-perform labor')?.actual === 2_200,
    JSON.stringify(brokerOnly.byPhase.map(l => [l.phase, l.budget, l.actual])));

  ok('a Labor line bought out by a subcontract does not take the GC\'s hours',
    (row(boughtOut, 'Framing')?.sources.timeEntries.length ?? 0) === 0
      && row(boughtOut, 'Self-perform labor')?.actual === 2_200,
    JSON.stringify(boughtOut.byPhase.map(l => [l.phase, l.budget, l.actual])));
}

// ── 5. Source: the routing sits behind the priced-hours gate ──────────────
{
  const src = readFileSync(join(ROOT, 'utils/jobCostEngine.ts'), 'utf8');
  const gate = src.indexOf('if (laborActual > 0) {');
  const route = src.indexOf('LABOR_PHASE_KEYS\n');
  ok('the Labor-line lookup runs only inside `if (laborActual > 0)`', gate > 0 && route > gate,
    `gate ${gate}, lookup ${route}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
