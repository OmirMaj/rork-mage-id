// scripts/validate-copilot-estimate-edit.ts — pure-fn validator for the
// estimate edit-op normalizer, the money-math recompute, and the interpreter.
import { normalizeEstimateOps, recomputeEstimate, applyGlobalMarkupToItems } from '../utils/copilot/estimateEdit/estimateOps';
import { interpretEstimateOps } from '../utils/copilot/estimateEdit/interpretEstimateOps';
import type { LinkedEstimate, LinkedEstimateItem } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const mkItem = (id: string, over: Partial<LinkedEstimateItem> = {}): LinkedEstimateItem => ({
  materialId: id, name: id, category: 'General', unit: 'ea', quantity: 2, unitPrice: 100,
  bulkPrice: 100, markup: 0, usesBulk: false, lineTotal: 200, supplier: '', ...over,
});
// Fixture shaped like a real buildLinkedEstimate result (full.tsx:930-998):
// markup lives ON each material line and lineTotal is markup-INCLUSIVE, so
// baseTotal (2400 + 2500) + markupTotal (10%) === grandTotal.
const base = (): LinkedEstimate => ({
  id: 'est1', createdAt: '2026-01-01T00:00:00Z', globalMarkup: 10,
  items: [
    mkItem('m1', { name: 'Tile', quantity: 200, unitPrice: 12, markup: 10, lineTotal: 2640 }),
    mkItem('m2', { name: 'Demolition', quantity: 1, unitPrice: 2500, markup: 10, lineTotal: 2750 }),
  ],
  baseTotal: 4900, markupTotal: 490, grandTotal: 5390,
});

// $100K of materials at 15% plus $50K of self-perform labor priced AT COST —
// the estimator stamps labor markup: 0 because adjustedRate is the all-in rate.
// This is the fixture that catches re-marking-up at-cost work.
const mixed = (): LinkedEstimate => ({
  id: 'est2', createdAt: '2026-01-01T00:00:00Z', globalMarkup: 15,
  items: [
    mkItem('mat', { name: 'Materials', quantity: 1000, unitPrice: 100, markup: 15, lineTotal: 115000 }),
    mkItem('lab', { name: 'Carpenter', category: 'Labor', unit: 'hrs', quantity: 500, unitPrice: 100, bulkPrice: 100, markup: 0, lineTotal: 50000 }),
  ],
  baseTotal: 150000, markupTotal: 15000, grandTotal: 165000,
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
  ok('recompute markupTotal = Σ per-line markup', r.markupTotal === 490);
  ok('recompute grandTotal = Σ markup-inclusive lineTotal', r.grandTotal === 5390);
  ok('recompute lineTotal carries the line’s own markup', r.items.find(i => i.materialId === 'm1')!.lineTotal === 2640);
}

// --- at-cost lines (finding #22) ---
// Recomputing an UNTOUCHED estimate must not move a dollar. Before the fix this
// discarded each line's markup and re-applied globalMarkup to the whole base,
// so labor priced at cost was marked up 15% and grandTotal came back 172500 —
// a silent $7,500 raise on the contract value.
{
  const r = recomputeEstimate(mixed());
  ok('recompute is idempotent on an untouched estimate', r.baseTotal === 150000 && r.markupTotal === 15000 && r.grandTotal === 165000);
  ok('labor stays at cost through a recompute', r.items.find(i => i.materialId === 'lab')!.lineTotal === 50000);
}
ok('an unrelated quantity edit does not re-mark-up labor', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'setQuantity', item: 'mat', quantity: 900 }], mixed());
  const lab = nextEstimate.items.find(i => i.materialId === 'lab')!;
  // materials 900×100×1.15 = 103500, labor untouched at 50000.
  return lab.lineTotal === 50000 && nextEstimate.baseTotal === 140000 && nextEstimate.grandTotal === 153500 && nextEstimate.markupTotal === 13500;
})());
ok('a stray markup on an at-cost line is zeroed, not charged', (() => {
  const est = mixed();
  est.items = est.items.map(i => (i.materialId === 'lab' ? { ...i, markup: 15 } : i));
  const r = recomputeEstimate(est);
  const lab = r.items.find(i => i.materialId === 'lab')!;
  return lab.markup === 0 && lab.lineTotal === 50000 && r.grandTotal === 165000;
})());
ok('assembly lines are at-cost too', (() => {
  const est = mixed();
  est.items = est.items.map(i => (i.materialId === 'lab' ? { ...i, category: 'Assemblies', markup: 25 } : i));
  return recomputeEstimate(est).grandTotal === 165000;
})());
ok('applyGlobalMarkupToItems reprices materials only', (() => {
  const est = mixed();
  const r = recomputeEstimate({ ...est, globalMarkup: 25, items: applyGlobalMarkupToItems(est.items, 25) });
  // materials 100000×1.25 = 125000 + labor at cost 50000.
  return r.grandTotal === 175000 && r.items.find(i => i.materialId === 'lab')!.markup === 0;
})());

// --- interpretEstimateOps ---
ok('setQuantity recomputes line + totals', (() => {
  const { nextEstimate, results } = interpretEstimateOps([{ op: 'setQuantity', item: 'm1', quantity: 100 }], base());
  const tile = nextEstimate.items.find(i => i.materialId === 'm1')!;
  // 100 × $12 × 1.10 = 1320. The pre-fix recompute returned the pre-markup 1200
  // on the line while still charging markup in the grand total.
  return results[0].ok && tile.lineTotal === 1320 && nextEstimate.baseTotal === 3700 && nextEstimate.grandTotal === 4070;
})());
ok('resolves a line by name', (() => interpretEstimateOps([{ op: 'setUnitPrice', item: 'tile', unitPrice: 10 }], base()).results[0].ok)());
ok('rejects an unresolved ref', (() => { const r = interpretEstimateOps([{ op: 'setQuantity', item: 'ghost', quantity: 1 }], base()); return !r.results[0].ok && !!r.results[0].reason; })());
// --- setGlobalMarkup moves money (AI-F5) ---
// "Set the markup to 20%" used to reassign estimate.globalMarkup and nothing
// else: money is per line, so the grand total did not move, the diff showed
// the same number, and the header disagreed with every line it summarised.
ok('setGlobalMarkup 10% → 20% on a 2-line estimate raises the grand total accordingly', (() => {
  const { nextEstimate, results } = interpretEstimateOps([{ op: 'setGlobalMarkup', markupPct: 20 }], base());
  // base 4900 × 1.20 = 5880; markup 980 (was 490).
  return results[0].ok && nextEstimate.globalMarkup === 20 && nextEstimate.baseTotal === 4900
    && nextEstimate.markupTotal === 980 && nextEstimate.grandTotal === 5880;
})());
ok('setGlobalMarkup stamps every material line with the new markup', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'setGlobalMarkup', markupPct: 20 }], base());
  return nextEstimate.items.every(i => i.markup === 20)
    && nextEstimate.items.find(i => i.materialId === 'm1')!.lineTotal === 2880   // 200 × 12 × 1.2
    && nextEstimate.items.find(i => i.materialId === 'm2')!.lineTotal === 3000;  // 1 × 2500 × 1.2
})());
ok('setGlobalMarkup leaves cost and at-cost labor alone', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'setGlobalMarkup', markupPct: 20 }], mixed());
  const lab = nextEstimate.items.find(i => i.materialId === 'lab')!;
  // materials 100000 × 1.2 = 120000 + labor at cost 50000.
  return nextEstimate.globalMarkup === 20 && nextEstimate.baseTotal === 150000
    && lab.markup === 0 && lab.lineTotal === 50000 && nextEstimate.grandTotal === 170000;
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
