// scripts/validate-copilot-estimate-edit.ts — pure-fn validator for the
// estimate edit-op normalizer, the money-math recompute, and the interpreter.
import { normalizeEstimateOps, recomputeEstimate } from '../utils/copilot/estimateEdit/estimateOps';
import { interpretEstimateOps } from '../utils/copilot/estimateEdit/interpretEstimateOps';
import type { LinkedEstimate, LinkedEstimateItem } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const mkItem = (id: string, over: Partial<LinkedEstimateItem> = {}): LinkedEstimateItem => ({
  materialId: id, name: id, category: 'General', unit: 'ea', quantity: 2, unitPrice: 100,
  bulkPrice: 100, markup: 0, usesBulk: false, lineTotal: 200, supplier: '', ...over,
});
const base = (): LinkedEstimate => ({
  id: 'est1', createdAt: '2026-01-01T00:00:00Z', globalMarkup: 10,
  items: [
    mkItem('m1', { name: 'Tile', quantity: 200, unitPrice: 12, lineTotal: 2400 }),
    mkItem('m2', { name: 'Demolition', quantity: 1, unitPrice: 2500, lineTotal: 2500 }),
  ],
  baseTotal: 4900, markupTotal: 490, grandTotal: 5390,
});

// --- normalizeEstimateOps ---
ok('non-array → []', normalizeEstimateOps(null).length === 0);
ok('keeps setQuantity', normalizeEstimateOps([{ op: 'setQuantity', item: 'm1', quantity: 150 }]).length === 1);
ok('drops setQuantity with no item', normalizeEstimateOps([{ op: 'setQuantity', quantity: 5 }]).length === 0);
ok('drops negative price', normalizeEstimateOps([{ op: 'setUnitPrice', item: 'm1', unitPrice: -5 }]).length === 0);
ok('accepts price as .price alias', (() => { const o = normalizeEstimateOps([{ op: 'setUnitPrice', item: 'm1', price: 9 }])[0] as any; return o.unitPrice === 9; })());
ok('clamps out-of-range markup (drops 600%)', normalizeEstimateOps([{ op: 'setGlobalMarkup', markupPct: 600 }]).length === 0);
ok('addLine needs name+qty+price', normalizeEstimateOps([{ op: 'addLine', name: 'Paint', quantity: 3, unitPrice: 40 }]).length === 1 && normalizeEstimateOps([{ op: 'addLine', quantity: 3, unitPrice: 40 }]).length === 0);

// --- recomputeEstimate (money math) ---
{
  const r = recomputeEstimate(base());
  ok('recompute baseTotal = Σ qty·price', r.baseTotal === 4900);
  ok('recompute markupTotal = base·globalMarkup/100', r.markupTotal === 490);
  ok('recompute grandTotal = base + markup', r.grandTotal === 5390);
}

// --- interpretEstimateOps ---
ok('setQuantity recomputes line + totals', (() => {
  const { nextEstimate, results } = interpretEstimateOps([{ op: 'setQuantity', item: 'm1', quantity: 100 }], base());
  const tile = nextEstimate.items.find(i => i.materialId === 'm1')!;
  return results[0].ok && tile.lineTotal === 1200 && nextEstimate.baseTotal === 3700 && nextEstimate.grandTotal === 4070;
})());
ok('resolves a line by name', (() => interpretEstimateOps([{ op: 'setUnitPrice', item: 'tile', unitPrice: 10 }], base()).results[0].ok)());
ok('rejects an unresolved ref', (() => { const r = interpretEstimateOps([{ op: 'setQuantity', item: 'ghost', quantity: 1 }], base()); return !r.results[0].ok && !!r.results[0].reason; })());
ok('setGlobalMarkup changes markup/grand only', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'setGlobalMarkup', markupPct: 20 }], base());
  return nextEstimate.globalMarkup === 20 && nextEstimate.baseTotal === 4900 && nextEstimate.markupTotal === 980 && nextEstimate.grandTotal === 5880;
})());
ok('removeLine drops the line + recomputes', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'removeLine', item: 'Demolition' }], base());
  return nextEstimate.items.length === 1 && nextEstimate.baseTotal === 2400 && nextEstimate.grandTotal === 2640;
})());
ok('addLine appends + recomputes', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'addLine', name: 'Paint', category: 'Finishes', unit: 'gal', quantity: 5, unitPrice: 40 }], base());
  const paint = nextEstimate.items.find(i => i.name === 'Paint')!;
  return nextEstimate.items.length === 3 && paint.lineTotal === 200 && nextEstimate.baseTotal === 5100;
})());
ok('partial application: valid applies, invalid reported', (() => {
  const { nextEstimate, results } = interpretEstimateOps([
    { op: 'setQuantity', item: 'm1', quantity: 50 },
    { op: 'removeLine', item: 'nope' },
  ], base());
  return nextEstimate.items.find(i => i.materialId === 'm1')!.quantity === 50 && results[0].ok && !results[1].ok;
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
