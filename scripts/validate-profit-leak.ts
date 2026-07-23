// validate-profit-leak.ts — unit tests for the Profit Leak faculty:
// scope summary, leak prompt, deterministic pricing, sub-bid check.
// Run via: bun run test:profit-leak
import { buildScopeSummary, MAX_SCOPE_CHARS } from '../utils/profitLeak/scopeSummary';
import type { ChangeOrder, ChangeOrderStatus, LinkedEstimateItem, Project } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// ── Fixtures ──
function li(materialId: string, category: string, name: string, unit: string, quantity: number, lineTotal: number, csiDivision?: string): LinkedEstimateItem {
  return { materialId, name, category, unit, quantity, unitPrice: quantity > 0 ? lineTotal / quantity : lineTotal, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal, supplier: '', csiDivision };
}
function proj(items: LinkedEstimateItem[], over: Record<string, unknown> = {}): Project {
  return {
    id: 'P1', name: 'Henderson Kitchen', type: 'renovation', status: 'in_progress',
    squareFootage: 400, quality: 'standard', description: '',
    linkedEstimate: items.length > 0 ? {
      id: 'e1', items, globalMarkup: 20, baseTotal: 0, markupTotal: 0,
      grandTotal: items.reduce((s, it) => s + it.lineTotal, 0), createdAt: '2026-06-01',
    } : undefined,
    ...over,
  } as unknown as Project;
}
function co(number: number, description: string, status: ChangeOrderStatus): ChangeOrder {
  return {
    id: `co-${number}`, number, projectId: 'P1', date: '2026-07-01', description, reason: 'Field change',
    lineItems: [], originalContractValue: 0, changeAmount: 0, newContractTotal: 0, status,
    createdAt: '2026-07-01', updatedAt: '2026-07-01',
  };
}

const ITEMS = [
  li('m1', 'Electrical', 'Panel upgrade', 'ea', 1, 4200, '26'),
  li('m2', 'Framing', 'Wall framing', 'sf', 400, 4800, '06'),
];

console.log('\nprofitLeak buildScopeSummary:');

const scopeProj = proj(ITEMS, {
  scope: { projectType: 'renovation', sizeSqft: '400', location: '', quality: 'standard', scope: 'Full kitchen remodel per plans', timelineWeeks: '8', specialRequirements: 'Keep fridge circuit live', targetBudget: '', updatedAt: '2026-06-01' },
});
const cos = [co(1, 'Added exterior GFCI outlet', 'approved'), co(2, 'Skylight over island', 'rejected')];
const summary = buildScopeSummary(scopeProj, cos);

expect('names the project', summary.includes('Henderson Kitchen'), true);
expect('groups items under the CSI division label', summary.includes('Div 26 — Electrical'), true);
expect('formats item as category — name (qty unit)', summary.includes('- Electrical — Panel upgrade (1 ea)'), true);
expect('includes the scope free text', summary.includes('Full kitchen remodel per plans'), true);
expect('includes special requirements', summary.includes('Keep fridge circuit live'), true);
expect('includes approved CO as already-approved addition', summary.includes('CO #1: Added exterior GFCI outlet'), true);
expect('excludes rejected CO', summary.includes('Skylight over island'), false);
expect('says so when no line-item estimate exists', buildScopeSummary(proj([]), []).includes('No line-item estimate'), true);

const bigItems = Array.from({ length: 400 }, (_, i) => li(`b${i}`, 'Finishes', `Very long descriptive line item name number ${i} with extra words`, 'sf', 10, 100, '09'));
expect('caps output length', buildScopeSummary(proj(bigItems), []).length <= MAX_SCOPE_CHARS, true);
expect('never throws on a bare project', typeof buildScopeSummary({} as Project, []) === 'string', true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
