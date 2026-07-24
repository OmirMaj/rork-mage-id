// validate-judges-type-margin.ts — realized margin by job type.
// Run via: bun run scripts/validate-judges-type-margin.ts
import { realizedMarginPct, aggregateTypeMargin } from '../utils/judges/typeMargin';
import type { Project, Commitment } from '../types';

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
const rm = realizedMarginPct(p, [c]);
expect('realizedMarginPct pinned at 0.30', rm, 0.3);

// Partial paid-to-date must NOT inflate margin: cost = max(actual, committed).
// paid 10k of a signed 70k → cost 70000 → margin still 0.30, never 0.90.
const partial = commitment('R1', 'm1', 70000, 10000);
const rmPartial = realizedMarginPct(p, [partial]);
expect('partial paid uses committed floor (0.30)', rmPartial, 0.3);

// No payments at all → signed commitment is the cost basis.
const committedOnly = commitment('R1', 'm1', 60000, 0);
const rmCommitted = realizedMarginPct(p, [committedOnly]);
expect('committed-only cost basis (0.40)', rmCommitted, 0.4);

const agg = aggregateTypeMargin([p], 'renovation', [c]);
expect('aggregates one renovation', agg.jobCount, 1);
expect('avg present when history', agg.avgMarginPct !== null, true);

// Multi-job average: R1 at 0.30 + R2 at 0.10 → 0.20.
const p2 = closedReno('R2', 100000);
const c2 = commitment('R2', 'm1', 90000, 90000);
const multi = aggregateTypeMargin([p, p2], 'renovation', [c, c2]);
expect('multi-job count', multi.jobCount, 2);
expect('multi-job average pinned at 0.20', multi.avgMarginPct, 0.2);

// Open (non-closed) projects are excluded from track record.
const open = { ...closedReno('R3', 100000), status: 'in_progress' } as unknown as Project;
const withOpen = aggregateTypeMargin([p, p2, open], 'renovation', [c, c2, commitment('R3', 'm1', 50000, 50000)]);
expect('in-progress project excluded', withOpen.jobCount, 2);

const other = aggregateTypeMargin([p], 'roofing', [c]);
expect('filters by type → none', other.jobCount, 0);
expect('null avg when no history', other.avgMarginPct, null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
