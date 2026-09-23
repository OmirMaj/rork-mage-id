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

// OLD SHAPE: $100K of materials at 15% plus $50K of self-perform labor saved
// at markup 0 — what the estimator wrote before it marked labor up. Such an
// estimate must recompute byte-identical: the line's stored markup is the
// contract, so a 0 stays a 0.
const mixed = (): LinkedEstimate => ({
  id: 'est2', createdAt: '2026-01-01T00:00:00Z', globalMarkup: 15,
  items: [
    mkItem('mat', { name: 'Materials', quantity: 1000, unitPrice: 100, markup: 15, lineTotal: 115000 }),
    mkItem('lab', { name: 'Carpenter', category: 'Labor', unit: 'hrs', quantity: 500, unitPrice: 100, bulkPrice: 100, markup: 0, lineTotal: 50000 }),
  ],
  baseTotal: 150000, markupTotal: 15000, grandTotal: 165000,
});

// CURRENT SHAPE (#6): what app/(tabs)/estimate/full.tsx:1061/:1078 writes now —
// Labor and Assemblies lines stamped `markup: globalMarkup` with a
// markup-inclusive lineTotal. $40K materials + $50K labor + $10K assemblies at
// 20% = $120,000. A voice edit used to strip labor and assemblies to 0 here and
// drop the contract by $12,000.
const fullShape = (): LinkedEstimate => ({
  id: 'est3', createdAt: '2026-01-01T00:00:00Z', globalMarkup: 20,
  items: [
    mkItem('tile', { name: 'Tile', quantity: 400, unitPrice: 100, bulkPrice: 100, markup: 20, lineTotal: 48000 }),
    mkItem('lab', { name: 'Carpenter', category: 'Labor', unit: 'hrs', quantity: 500, unitPrice: 100, bulkPrice: 100, markup: 20, lineTotal: 60000 }),
    mkItem('asm', { name: 'Bath assembly', category: 'Assemblies', unit: 'ea', quantity: 1, unitPrice: 10000, bulkPrice: 10000, markup: 20, lineTotal: 12000 }),
  ],
  baseTotal: 100000, markupTotal: 20000, grandTotal: 120000,
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

// --- per-line markup is the contract (finding #22, then #6) ---
// Recomputing an UNTOUCHED estimate must not move a dollar, whichever shape it
// was saved in. #22 fixed a recompute that re-applied globalMarkup to at-cost
// labor; the fix zeroed labor BY CATEGORY, which became #6 once the estimator
// started marking labor up. The rule now: each line keeps its own markup.
{
  const r = recomputeEstimate(mixed());
  ok('old shape (labor at 0) recomputes byte-identical', JSON.stringify(r) === JSON.stringify(mixed()));
  ok('old shape: labor stays at its stored 0 through a recompute', r.items.find(i => i.materialId === 'lab')!.lineTotal === 50000);
}
{
  const r = recomputeEstimate(fullShape());
  ok('recompute keeps labor’s stored 20% markup', r.items.find(i => i.materialId === 'lab')!.markup === 20
    && r.items.find(i => i.materialId === 'lab')!.lineTotal === 60000);
  ok('recompute keeps assemblies’ stored 20% markup', r.items.find(i => i.materialId === 'asm')!.lineTotal === 12000);
  ok('recompute of a full.tsx estimate at 20% is a no-op', r.grandTotal === 120000 && r.markupTotal === 20000 && r.baseTotal === 100000);
}
ok('a materials quantity edit leaves Labor/Assemblies lineTotals unchanged at 20%', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'setQuantity', item: 'Tile', quantity: 300 }], fullShape());
  const lab = nextEstimate.items.find(i => i.materialId === 'lab')!;
  const asm = nextEstimate.items.find(i => i.materialId === 'asm')!;
  // tile 300×100×1.2 = 36000; labor 60000 and assemblies 12000 untouched.
  return lab.lineTotal === 60000 && lab.markup === 20 && asm.lineTotal === 12000 && asm.markup === 20
    && nextEstimate.grandTotal === 108000 && nextEstimate.baseTotal === 90000;
})());
ok('an unrelated quantity edit on the old shape does not re-mark-up labor', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'setQuantity', item: 'mat', quantity: 900 }], mixed());
  const lab = nextEstimate.items.find(i => i.materialId === 'lab')!;
  // materials 900×100×1.15 = 103500, labor untouched at 50000.
  return lab.lineTotal === 50000 && nextEstimate.baseTotal === 140000 && nextEstimate.grandTotal === 153500 && nextEstimate.markupTotal === 13500;
})());
ok('setGlobalMarkup 25 on $100K materials + $50K labor reprices every line → $187,500', (() => {
  const { nextEstimate, results } = interpretEstimateOps([{ op: 'setGlobalMarkup', markupPct: 25 }], mixed());
  const lab = nextEstimate.items.find(i => i.materialId === 'lab')!;
  return results[0].ok && nextEstimate.grandTotal === 187500 && lab.markup === 25 && lab.lineTotal === 62500
    && nextEstimate.markupTotal === 37500;
})());
ok('applyGlobalMarkupToItems stamps every line, labor and assemblies included', (() => {
  const items = applyGlobalMarkupToItems(fullShape().items, 25);
  return items.every(i => i.markup === 25);
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
ok('setGlobalMarkup 20 on the full.tsx shape keeps labor and assemblies at 20', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'setGlobalMarkup', markupPct: 20 }], fullShape());
  // "Bump the markup to 20%" on an estimate already at 20% everywhere must be
  // a no-op — it used to take labor and assemblies to 0% ($12,000 lower).
  return nextEstimate.grandTotal === 120000 && nextEstimate.items.every(i => i.markup === 20);
})());
ok('removeLine drops the line + recomputes', (() => {
  const { nextEstimate } = interpretEstimateOps([{ op: 'removeLine', item: 'Demolition' }], base());
  return nextEstimate.items.length === 1 && nextEstimate.baseTotal === 2400 && nextEstimate.grandTotal === 2640;
})());
ok('addLine appends + recomputes, carrying the estimate’s markup', (() => {
  const { nextEstimate, results } = interpretEstimateOps([{ op: 'addLine', name: 'Paint', category: 'Finishes', unit: 'gal', quantity: 5, unitPrice: 40 }], base());
  const paint = nextEstimate.items.find(i => i.name === 'Paint')!;
  // 5 × $40 × 1.10 = 220 — a voice-added line used to be written at markup 0
  // (priced at cost next to neighbours at 10%). The result reports the markup
  // it applied so the diff can say it.
  return nextEstimate.items.length === 3 && paint.markup === 10 && paint.lineTotal === 220
    && nextEstimate.baseTotal === 5100 && nextEstimate.grandTotal === 5610
    && results[0].addedMarkup === 10 && results[0].addedId === paint.materialId;
})());
ok('addLine after setGlobalMarkup in the same request takes the new markup', (() => {
  const { nextEstimate } = interpretEstimateOps([
    { op: 'setGlobalMarkup', markupPct: 20 },
    { op: 'addLine', name: 'Paint', category: 'Finishes', unit: 'gal', quantity: 5, unitPrice: 40 },
  ], base());
  return nextEstimate.items.find(i => i.name === 'Paint')!.lineTotal === 240;
})());
ok('op results name the diff row they touched', (() => {
  const { results } = interpretEstimateOps([{ op: 'setQuantity', item: 'Tile', quantity: 300 }], fullShape());
  return results[0].lineKey === 'General';
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
