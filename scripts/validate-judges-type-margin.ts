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
// With a signed commitment of 70k paidToDate, totalActual = 70000
// realized margin = (100000 - 70000) / 100000 = 0.30
const c = commitment('R1', 'm1', 70000, 70000);
const rm = realizedMarginPct(p, [c]);
expect('realizedMarginPct in [-1,1]', rm !== null && rm <= 1 && rm >= -1, true);
// Assert it's in a plausible band around 0.30
expect('realizedMarginPct is a real number (not null)', rm !== null, true);
expect('realizedMarginPct in plausible 20-40% band', rm !== null && rm >= 0.20 && rm <= 0.40, true);

const agg = aggregateTypeMargin([p], 'renovation', [c]);
expect('aggregates one renovation', agg.jobCount, 1);
expect('avg present when history', agg.avgMarginPct !== null, true);

const other = aggregateTypeMargin([p], 'roofing', [c]);
expect('filters by type → none', other.jobCount, 0);
expect('null avg when no history', other.avgMarginPct, null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
