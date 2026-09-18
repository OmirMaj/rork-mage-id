// validate-judges-type-margin.ts — realized margin by job type.
// Run via: bun run scripts/validate-judges-type-margin.ts
import { realizedMarginPct, aggregateTypeMargin } from '../utils/judges/typeMargin';
import type { Project, Commitment, ChangeOrder } from '../types';
import { buildTypeProfitability } from '../utils/portfolio/typeProfitability';
import { gradeJudges } from '../utils/brain/gradePredictions';
import type { GradingCtx } from '../utils/brain/gradePredictions';
import type { BrainPredictionReadRow } from '../utils/brain/types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// A closed renovation: estimate grandTotal 100k, one item with lineTotal 10k.
// Commitment signed at 70k with paidToDate 70k, linked to estimate item 'm1'.
// computeEstimateActuals traces: totalActual = 70000
// realizedMarginPct = (100000 - 70000) / 100000 = 0.30
function closedReno(id: string, grandTotal: number): Project {
  return {
    id, name: id, type: 'renovation', status: 'closed',
    linkedEstimate: { id: `${id}-e`, items: [
      { materialId: 'm1', name: 'Framing', category: 'Framing', unit: 'sf', quantity: 100, unitPrice: 100, bulkPrice: 100, markup: 0, usesBulk: false, lineTotal: 10000, supplier: '' },
    ], globalMarkup: 20, baseTotal: grandTotal, markupTotal: 0, grandTotal, createdAt: '2026-01-01' },
  } as unknown as Project;
}

function commitment(projectId: string, materialId: string, amount: number, paidToDate: number): Commitment {
  return {
    id: `${projectId}-c1`,
    projectId,
    number: 'C-001',
    type: 'subcontract',
    description: 'Framing sub',
    amount,
    changeAmount: 0,
    paidToDate,
    signedDate: '2026-01-15',
    linkedEstimateItems: [materialId],
    status: 'active',
  } as Commitment;
}

console.log('\nJUDGES typeMargin:');

const p = closedReno('R1', 100000);
// Fully paid: totalActual = totalCommitted = 70000 → margin (100k−70k)/100k = 0.30 exact.
const c = commitment('R1', 'm1', 70000, 70000);
const rm = realizedMarginPct(p, [c], []);
expect('realizedMarginPct pinned at 0.30', rm, 0.3);

// Partial paid-to-date must NOT inflate margin: cost = max(actual, committed).
// paid 10k of a signed 70k → cost 70000 → margin still 0.30, never 0.90.
const partial = commitment('R1', 'm1', 70000, 10000);
const rmPartial = realizedMarginPct(p, [partial], []);
expect('partial paid uses committed floor (0.30)', rmPartial, 0.3);

// No payments at all → signed commitment is the cost basis.
const committedOnly = commitment('R1', 'm1', 60000, 0);
const rmCommitted = realizedMarginPct(p, [committedOnly], []);
expect('committed-only cost basis (0.40)', rmCommitted, 0.4);

const agg = aggregateTypeMargin([p], 'renovation', [c], []);
expect('aggregates one renovation', agg.jobCount, 1);
expect('avg present when history', agg.avgMarginPct !== null, true);

// Multi-job average: R1 at 0.30 + R2 at 0.10 → 0.20.
const p2 = closedReno('R2', 100000);
const c2 = commitment('R2', 'm1', 90000, 90000);
const multi = aggregateTypeMargin([p, p2], 'renovation', [c, c2], []);
expect('multi-job count', multi.jobCount, 2);
expect('multi-job average pinned at 0.20', multi.avgMarginPct, 0.2);

// Open (non-closed) projects are excluded from track record.
const open = { ...closedReno('R3', 100000), status: 'in_progress' } as unknown as Project;
const withOpen = aggregateTypeMargin([p, p2, open], 'renovation', [c, c2, commitment('R3', 'm1', 50000, 50000)], []);
expect('in-progress project excluded', withOpen.jobCount, 2);

const other = aggregateTypeMargin([p], 'roofing', [c], []);
expect('filters by type → none', other.jobCount, 0);
expect('null avg when no history', other.avgMarginPct, null);

// JUDGES' track-record sentence must not state a committed-cost-only margin as
// his realized margin (integration round 1, money-accounts; sibling of #16).
{
  const { readFileSync } = await import('node:fs');
  const verdictSrc = readFileSync(new URL('../utils/judges/computeBidVerdict.ts', import.meta.url), 'utf8');
  expect('track-record line names its cost basis, not "realized margin"',
    /% margin on subcontract and PO cost \(crew labor and receipts not counted\)\./.test(verdictSrc)
      && !/% realized margin\./.test(verdictSrc), true);
}

// ── APPROVED OWNER CHANGE ORDERS ARE REVENUE (audit round 2, #3) ──────────
// A closed kitchen: estimate $80,000; owner CO +$15,000 approved; the framing
// sub's commitment was edited from $64,000 to $76,000 in Job Costing to buy
// that scope, and settled. True margin (95,000 − 76,000) / 95,000 = 20%. The
// old math read (80,000 − 76,000) / 80,000 = 5% — JUDGES' track record,
// /business's margin by type, and Bid Advisor's own grading all said so.
{
  const k = { ...closedReno('K1', 80000), type: 'remodel' } as unknown as Project;
  const sub = commitment('K1', 'm1', 76000, 76000);
  const co = { id: 'co1', projectId: 'K1', number: 1, description: 'Add island + pantry', lineItems: [],
    originalContractValue: 80000, changeAmount: 15000, newContractTotal: 95000, status: 'approved',
    date: '2026-03-01', createdAt: '2026-03-01', updatedAt: '2026-03-01' } as unknown as ChangeOrder;
  const pendingCo = { ...co, id: 'co2', changeAmount: 9000, status: 'submitted' } as unknown as ChangeOrder;
  const otherJobCo = { ...co, id: 'co3', projectId: 'OTHER', changeAmount: 50000 } as unknown as ChangeOrder;
  const cos = [co, pendingCo, otherJobCo];
  const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1e-9;

  expect('CO-1 realized margin counts the approved owner CO (20%, not 5%)', near(realizedMarginPct(k, [sub], cos), 0.2), true);
  expect('CO-2 without COs the figure is the estimate basis (5%) — the argument is what fixes it',
    near(realizedMarginPct(k, [sub], []), 0.05), true);
  const agg3 = aggregateTypeMargin([k], 'remodel', [sub], cos);
  expect('CO-3 JUDGES track record averages 20%', near(agg3.avgMarginPct, 0.2), true);

  const k2 = { ...k, id: 'K2' } as unknown as Project;
  const sub2 = commitment('K2', 'm1', 76000, 76000);
  const tp = buildTypeProfitability([k, k2], [sub, sub2], [...cos, { ...co, id: 'co4', projectId: 'K2' } as unknown as ChangeOrder]);
  const row = tp.rows.find(r => r.type === ('remodel'));
  expect('CO-4 /business margin by type reads 20%', near(row?.avgMarginPct, 0.2), true);
  expect('CO-5 /business weights by the same revenue base (95k × 2)', row?.totalRevenue, 190000);
  expect('CO-6 definition note no longer claims COs are excluded', /Excludes approved change orders/.test(tp.definitionNote), false);

  const pred = { id: 'pr1', kind: 'judges_verdict', project_id: 'K1', predicted_at: '2026-01-01T00:00:00Z',
    payload: { mode: 'pick', verdict: 'take', targetMarginPct: 20, projectId: 'K1' } } as unknown as BrainPredictionReadRow;
  const ctx = { projects: [k], changeOrders: cos, commitments: [sub] } as unknown as GradingCtx;
  const graded = gradeJudges(pred, ctx);
  expect('CO-7 gradeJudges realized margin counts the CO (20%)', near(graded?.realizedMarginPct, 0.2), true);
  expect('CO-8 a take at a 20% target on a 20% job grades RIGHT', graded?.verdictWasRight, true);

  const { readFileSync } = await import('node:fs');
  const rd = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  expect('CO-9 runJudges threads ctx.changeOrders into aggregateTypeMargin',
    /aggregateTypeMargin\([^)]*params\.ctx\.changeOrders/.test(rd('utils/judges/runJudges.ts')), true);
  expect('CO-10 /business passes changeOrders to buildTypeProfitability',
    /buildTypeProfitability\(projects, commitments, changeOrders\)/.test(rd('app/business.tsx')), true);
  // The AI's "margin by job type" fact must be the same CO-inclusive figure
  // /business prints; the parameter is no longer defaulted, so tsc also holds it.
  expect('CO-10b the AI fact block passes bundle.changeOrders to buildTypeProfitability',
    /buildTypeProfitability\(bundle\.projects, bundle\.commitments, bundle\.changeOrders\)/.test(rd('utils/oneMind/factBlocks.ts')), true);
  expect('CO-11 gradeJudges uses the shared realizedMarginPct, not an inline copy',
    /realizedMarginPct\(project, ctx\.commitments, ctx\.changeOrders\)/.test(rd('utils/brain/gradePredictions.ts'))
      && !/linkedEstimate\?\.grandTotal \?\? 0;\s*if \(revenue <= 0\) return null;\s*const report = computeEstimateActuals\(project, ctx\.commitments\)/.test(rd('utils/brain/gradePredictions.ts')), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
