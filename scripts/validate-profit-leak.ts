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

import { buildLeakPrompt, coerceLeakResult, hashLeakText, LEAK_SCHEMA_HINT, MAX_LEAK_ITEMS } from '../utils/profitLeak/leakPrompt';

console.log('\nprofitLeak buildLeakPrompt:');

const report = {
  workPerformed: 'Framed pantry wall. Also trenched 40 lf for the new gas line the owner asked for.',
  issuesAndDelays: 'Inspector wants a second GFCI at the island.',
  materialsDelivered: ['40 lf gas pipe'],
};
const prompt = buildLeakPrompt(summary, report);

expect('prompt embeds the scope summary', prompt.includes('Henderson Kitchen'), true);
expect('prompt embeds work performed', prompt.includes('trenched 40 lf'), true);
expect('prompt embeds issues and delays', prompt.includes('second GFCI'), true);
expect('prompt embeds materials delivered', prompt.includes('40 lf gas pipe'), true);
expect('rule: compare only against provided scope', /ONLY against the scope provided/i.test(prompt), true);
expect('rule: approved additions are in scope', /already approved additions/i.test(prompt), true);
expect('rule: quote the exact report phrase', /exact phrase/i.test(prompt), true);
expect('rule: prefer empty over speculation', /empty items list over speculation/i.test(prompt), true);
expect('schema hint carries the item shape', Object.keys(LEAK_SCHEMA_HINT.items[0]).sort(), ['confidence', 'description', 'quantity', 'reportQuote', 'trade', 'unit']);

console.log('\nprofitLeak hashLeakText:');
expect('stable for identical input', hashLeakText('framed walls', 'none') === hashLeakText('framed walls', 'none'), true);
expect('changes when text changes', hashLeakText('framed walls', 'none') === hashLeakText('framed walls today', 'none'), false);
expect('ignores case and outer whitespace', hashLeakText('  Framed Walls ', 'None') === hashLeakText('framed walls', 'none'), true);

console.log('\nprofitLeak coerceLeakResult:');
const goodItem = { description: 'Gas line trench', trade: 'Plumbing', unit: 'lf', quantity: 40, confidence: 'high', reportQuote: 'trenched 40 lf' };
expect('accepts the {items:[...]} envelope', coerceLeakResult({ items: [goodItem] }).length, 1);
expect('accepts a bare array', coerceLeakResult([goodItem])[0].description, 'Gas line trench');
expect('fills defaults for missing fields', coerceLeakResult({ items: [{ description: 'Extra paint' }] })[0], { description: 'Extra paint', trade: 'General', unit: 'ls', quantity: 1, confidence: 'low', reportQuote: '' });
expect('drops items without a description', coerceLeakResult({ items: [{ trade: 'Electrical' }] }).length, 0);
expect('returns [] for junk input', coerceLeakResult('nope').length, 0);
expect('caps the item count', coerceLeakResult({ items: Array.from({ length: 25 }, (_, i) => ({ description: `x${i}` })) }).length, MAX_LEAK_ITEMS);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
