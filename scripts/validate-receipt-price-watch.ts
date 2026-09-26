// scripts/validate-receipt-price-watch.ts
//
// Wave 4 W1: PRICE WATCH from his own reviewed receipts (utils/receiptPriceWatch).
// Key normalisation, no fuzzy match, unit safety, reviewed-only, the window,
// the thresholds, integer cents, open-estimates-only drift, labor skipped, and
// repriceEstimate keeping each line's markup and footing by delta.
// Pure — no React, no network, no AsyncStorage. Exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  receiptLineKey, vendorKey, supplierSpreads, estimateDrift, repriceEstimate, keptKeyFor, PRICE_WATCH_KEPT_KEY,
} from '../utils/receiptPriceWatch';
import type { LinkedEstimate, LinkedEstimateItem, MaterialReceipt, MaterialReceiptLine, Project } from '../types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let n = 0;
function line(description: string, unit: string, quantity: number, unitPrice: number): MaterialReceiptLine {
  n++;
  return { id: `l${n}`, description, unit, quantity, unitPrice, lineTotal: quantity * unitPrice };
}
function receipt(id: string, vendor: string, date: string, lines: MaterialReceiptLine[], status: MaterialReceipt['status'] = 'reviewed'): MaterialReceipt {
  return {
    id, projectId: 'p1', vendor, receiptDate: date, lines, subtotal: 0, total: 0, status,
    createdAt: `${date}T15:00:00.000Z`, updatedAt: `${date}T15:00:00.000Z`,
  };
}
// "Now" = local noon, 2026-09-26.
const NOW = new Date(2026, 8, 26, 12).getTime();

console.log('\n── receiptLineKey / vendorKey');
assert(receiptLineKey('2x4x8 SPF Stud', 'ea') === receiptLineKey('2X4X8  spf stud', 'EA'), "'2x4x8 SPF Stud' == '2X4X8  spf stud'");
assert(receiptLineKey('2x4x8 stud', 'ea') !== receiptLineKey('2x6x8 stud', 'ea'), "'2x4x8 stud' ≠ '2x6x8 stud' (no fuzzy match)");
assert(receiptLineKey('5/8" Type X board', 'sheet') === '5/8" type x board|sheet', `sizes survive: ${receiptLineKey('5/8" Type X board', 'sheet')}`);
assert(receiptLineKey('1/2in CDX plywood', 'sheet')!.startsWith('1/2in cdx plywood|'), '1/2in survives');
assert(receiptLineKey('Stud, SPF (premium)!', 'ea') === 'stud spf premium|ea', 'punctuation other than / . - x " \' is dropped');
assert(receiptLineKey('Drywall', 'SF') === receiptLineKey('drywall', 'sq ft'), "'SF' and 'sq ft' are the same unit (cost-book normalisation)");
assert(receiptLineKey('Drywall', 'sf') !== receiptLineKey('Drywall', 'ea'), 'a different unit is a different key');
assert(receiptLineKey('   ', 'ea') === null && receiptLineKey('', 'ea') === null, 'an empty description has no key');
assert(vendorKey('Home Depot, Inc.') === 'home depot' && vendorKey('  HOME   depot ') === 'home depot', 'vendorKey folds case, spaces, ", Inc."');
assert(vendorKey('Yard A LLC') === 'yard a', "vendorKey strips ' llc'");

console.log('\n── supplierSpreads');
{
  const rs = [
    receipt('r1', 'Yard A', '2026-09-10', [line('2x4x8 SPF stud', 'ea', 100, 4.50)]),
    receipt('r2', 'Yard B', '2026-09-12', [line('2X4X8 spf stud', 'EA', 100, 4.00)]),
    receipt('r3', 'Yard A, Inc.', '2026-09-20', [line('2x4x8 SPF stud', 'ea', 50, 4.60)]),
  ];
  const f = supplierSpreads(rs, NOW);
  assert(f.length === 1, `one spread found (${f.length})`);
  const s = f[0];
  // Yard A weighted mean: (100×450 + 50×460)/150 = 453.33 → 453
  assert(s.cheapVendor === 'Yard B' && s.cheapUnitCents === 400, `cheap = Yard B @ 400¢ (${s.cheapVendor} ${s.cheapUnitCents})`);
  assert(s.dearUnitCents === 453, `dear = qty-weighted mean 453¢ (${s.dearUnitCents})`);
  assert(s.pctMore === 13, `pctMore 13 (${s.pctMore})`);
  // overpaid = 100×(450−400) + 50×(460−400) = 5000 + 3000 = 8000
  assert(s.overpaidCents === 8000, `overpaid 8000¢ (${s.overpaidCents})`);
  assert(Number.isInteger(s.overpaidCents) && Number.isInteger(s.cheapUnitCents) && Number.isInteger(s.dearUnitCents), 'money is integer cents');
  assert(s.evidence.length === 3 && s.evidence[0].date === '2026-09-20', 'evidence is every line in window, newest first');
  assert(s.dearVendor === 'Yard A, Inc.', `dear vendor shows as printed on the newest receipt (${s.dearVendor})`);

  const extracted = [rs[0], { ...rs[1], status: 'extracted' as const }];
  assert(supplierSpreads(extracted, NOW).length === 0, "'extracted' receipts are ignored");
  const oldB = [rs[0], receipt('r2', 'Yard B', '2026-08-01', [line('2x4x8 SPF stud', 'ea', 100, 4.00)])];
  assert(supplierSpreads(oldB, NOW).length === 0, 'a line outside the 30-day window does not count');
  assert(supplierSpreads(oldB, NOW, 90).length === 1, 'a wider window includes it');
  const future = [rs[0], receipt('r2', 'Yard B', '2026-10-10', [line('2x4x8 SPF stud', 'ea', 100, 4.00)])];
  assert(supplierSpreads(future, NOW).length === 0, 'a receipt dated after now does not count');
  const unitMismatch = [rs[0], receipt('r2', 'Yard B', '2026-09-12', [line('2x4x8 SPF stud', 'bundle', 100, 4.00)])];
  assert(supplierSpreads(unitMismatch, NOW).length === 0, 'a unit mismatch never matches');
  const sameVendor = [rs[0], receipt('r2', 'YARD A', '2026-09-12', [line('2x4x8 SPF stud', 'ea', 100, 4.00)])];
  assert(supplierSpreads(sameVendor, NOW).length === 0, 'one vendor under two spellings is one vendor');
  // 4% more: below threshold.
  const small = [receipt('a', 'Yard A', '2026-09-10', [line('Rebar #4', 'lf', 5000, 1.04)]), receipt('b', 'Yard B', '2026-09-10', [line('Rebar #4', 'lf', 5000, 1.00)])];
  assert(supplierSpreads(small, NOW).length === 0, 'pctMore < 5 is not reported (even with $200 overpaid)');
  // 50% more but only $5 overpaid.
  const tiny = [receipt('a', 'Yard A', '2026-09-10', [line('Wire nut', 'ea', 10, 0.75)]), receipt('b', 'Yard B', '2026-09-10', [line('Wire nut', 'ea', 10, 0.25)])];
  assert(supplierSpreads(tiny, NOW).length === 0, 'overpaid < $25 is not reported');
  // exactly 5% and exactly $25 → reported
  const edge = [receipt('a', 'Yard A', '2026-09-10', [line('Plywood', 'sheet', 10, 52.50)]), receipt('b', 'Yard B', '2026-09-10', [line('Plywood', 'sheet', 10, 50.00)])];
  assert(supplierSpreads(edge, NOW).length === 1, 'exactly 5% and exactly $25 is reported');
  // zero price / zero qty lines never count
  const zero = [receipt('a', 'Yard A', '2026-09-10', [line('Plywood', 'sheet', 10, 60)]), receipt('b', 'Yard B', '2026-09-10', [line('Plywood', 'sheet', 0, 50), line('Plywood', 'sheet', 10, 0)])];
  assert(supplierSpreads(zero, NOW).length === 0, 'a zero-quantity or zero-price line never counts');
  // cents rounding: 3 × $1.335 → unit 134¢ (Math.round), qty-weighted
  const r = [receipt('a', 'Yard A', '2026-09-10', [line('Bolt', 'ea', 1000, 1.335)]), receipt('b', 'Yard B', '2026-09-10', [line('Bolt', 'ea', 1000, 1.20)])];
  const rf = supplierSpreads(r, NOW)[0];
  assert(rf?.dearUnitCents === 134 && rf?.overpaidCents === 14000, `cents rounding (${rf?.dearUnitCents}, ${rf?.overpaidCents})`);
  // sorted by overpaid desc
  const two = [...rs, ...edge];
  const sf = supplierSpreads(two, NOW);
  assert(sf.length === 2 && sf[0].overpaidCents >= sf[1].overpaidCents, 'sorted by overpaidCents desc');
}

console.log('\n── estimateDrift');
function item(o: Partial<LinkedEstimateItem>): LinkedEstimateItem {
  return { materialId: 'm', name: 'x', category: 'lumber', unit: 'ea', quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 0, supplier: '', ...o };
}
function footed(items: LinkedEstimateItem[], extraCents = 0): LinkedEstimate {
  const withTotals = items.map((it) => ({ ...it, lineTotal: Math.round(it.quantity * (it.usesBulk ? it.bulkPrice : it.unitPrice) * (1 + it.markup / 100) * 100) / 100 }));
  const base = Math.round(withTotals.reduce((s, it) => s + it.quantity * (it.usesBulk ? it.bulkPrice : it.unitPrice), 0) * 100);
  const grand = Math.round(withTotals.reduce((s, it) => s + it.lineTotal, 0) * 100) + extraCents;
  return { id: 'e1', items: withTotals, globalMarkup: 15, baseTotal: base / 100, markupTotal: (grand - base) / 100, grandTotal: grand / 100, createdAt: '2026-09-01' };
}
function project(id: string, status: Project['status'], est: LinkedEstimate): Project {
  return { id, name: `Job ${id}`, status, linkedEstimate: est } as unknown as Project;
}
const items = [
  item({ materialId: 'stud', name: '2x4x8 SPF Stud', unit: 'ea', quantity: 200, unitPrice: 4.00, markup: 15 }),
  item({ materialId: 'ply', name: '1/2in CDX plywood', unit: 'sheet', quantity: 40, unitPrice: 60, bulkPrice: 50, usesBulk: true, markup: 20 }),
  item({ materialId: 'lab', name: '2x4x8 SPF Stud', unit: 'ea', category: 'Framing Labor', quantity: 10, unitPrice: 4.00 }),
  item({ materialId: 'nails', name: 'Framing nails', unit: 'box', quantity: 5, unitPrice: 40, markup: 10 }),
];
const rcpts = [
  receipt('r1', 'Yard A', '2026-09-10', [line('2x4x8 spf stud', 'EA', 50, 4.30), line('1/2in CDX plywood', 'sheet', 10, 54.00)]),
  receipt('r2', 'Yard B', '2026-09-15', [line('2x4x8 SPF stud', 'ea', 50, 4.40)]),
  receipt('r3', 'Yard C', '2026-09-16', [line('Framing nails', 'box', 1, 41.00)]), // 2.5% → no finding
  receipt('r4', 'Yard D', '2026-09-20', [line('2x4x8 SPF stud', 'ea', 50, 3.00)], 'extracted'), // unreviewed → ignored
];
{
  const d = estimateDrift([project('open', 'estimated', footed(items))], rcpts);
  const stud = d.find((x) => x.materialId === 'stud');
  const ply = d.find((x) => x.materialId === 'ply');
  assert(d.length === 2, `two drifts (stud, ply) — labor, nails skipped (${d.map((x) => x.materialId).join(',')})`);
  assert(stud?.latestUnitCents === 440 && stud?.latestReceiptId === 'r2', `stud: latest reviewed receipt wins (${stud?.latestUnitCents} ${stud?.latestReceiptId})`);
  assert(stud?.pct === 10 && stud?.deltaCents === 200 * 40, `stud: +10%, delta 8000¢ (${stud?.pct}, ${stud?.deltaCents})`);
  assert(ply?.pricedUnitCents === 5000 && ply?.pct === 8 && ply?.deltaCents === 40 * 400, `ply: priced at the BULK price he uses (${ply?.pricedUnitCents}, ${ply?.pct}, ${ply?.deltaCents})`);
  assert(!d.some((x) => x.materialId === 'lab'), 'a labor-looking item never drifts');
  assert(estimateDrift([project('draft', 'draft', footed(items))], rcpts).length === 2, "'draft' estimates are open");
  for (const st of ['in_progress', 'completed', 'closed'] as const) {
    assert(estimateDrift([project('x', st, footed(items))], rcpts).length === 0, `a '${st}' project never drifts`);
  }
  assert(estimateDrift([project('open', 'estimated', footed(items))], rcpts, 20).length === 0, 'minPct is respected');
  const down = estimateDrift([project('open', 'estimated', footed([item({ materialId: 'stud', name: '2x4x8 SPF Stud', unit: 'ea', quantity: 10, unitPrice: 5 })]))], rcpts);
  assert(down.length === 1 && down[0].pct === -12 && down[0].deltaCents === -600, `a price that went DOWN is a finding too (${down[0]?.pct}, ${down[0]?.deltaCents})`);
  const otherUnit = estimateDrift([project('open', 'estimated', footed([item({ materialId: 'stud', name: '2x4x8 SPF Stud', unit: 'bundle', quantity: 10, unitPrice: 5 })]))], rcpts);
  assert(otherUnit.length === 0, 'an estimate line in another unit never matches a receipt line');
}

console.log('\n── repriceEstimate');
const sumLines = (e: LinkedEstimate) => Math.round(e.items.reduce((s, it) => s + it.lineTotal, 0) * 100);
{
  const est = footed(items);
  assert(sumLines(est) === Math.round(est.grandTotal * 100), 'fixture foots before');
  const drifts = estimateDrift([project('open', 'estimated', est)], rcpts);
  const { next, costDeltaCents, sellDeltaCents } = repriceEstimate(est, drifts);
  assert(sumLines(next) === Math.round(next.grandTotal * 100), `foots after: Σ lineTotal ${sumLines(next)} === grand ${Math.round(next.grandTotal * 100)}`);
  const stud = next.items.find((i) => i.materialId === 'stud')!;
  const ply = next.items.find((i) => i.materialId === 'ply')!;
  assert(stud.unitPrice === 4.40 && stud.markup === 15 && stud.lineTotal === 1012, `stud repriced, keeps its 15% markup (${stud.unitPrice} ${stud.markup} ${stud.lineTotal})`);
  assert(ply.bulkPrice === 54 && ply.unitPrice === 60 && ply.markup === 20 && ply.lineTotal === 2592, `ply: the BULK price moves, unitPrice untouched, 20% kept (${ply.bulkPrice} ${ply.unitPrice} ${ply.lineTotal})`);
  assert(next.items.find((i) => i.materialId === 'lab')!.unitPrice === 4.00, 'the labor line is untouched');
  assert(costDeltaCents === 8000 + 16000, `cost delta = 8000 + 16000 (${costDeltaCents})`);
  // sell: stud 920→1012 (+9200), ply 2400→2592 (+19200)
  assert(sellDeltaCents === 9200 + 19200, `sell delta = 28400 (${sellDeltaCents})`);
  assert(Math.round(next.baseTotal * 100) === Math.round(est.baseTotal * 100) + costDeltaCents, 'baseTotal moves by the cost delta');
  assert(Math.round(next.markupTotal * 100) === Math.round(next.grandTotal * 100) - Math.round(next.baseTotal * 100), 'markupTotal = grand − base');
  assert(Number.isInteger(costDeltaCents) && Number.isInteger(sellDeltaCents), 'deltas are integer cents');
  const noop = repriceEstimate(est, []);
  assert(noop.next === est && noop.sellDeltaCents === 0, 'no drifts → the same estimate');

  // A contingency carried OUTSIDE the lines is kept.
  const withCont = footed(items, 150000);
  const r2 = repriceEstimate(withCont, drifts);
  assert(Math.round(r2.next.grandTotal * 100) - sumLines(r2.next) === 150000, 'a $1,500 contingency outside the lines survives the reprice');
  assert(Math.round(r2.next.grandTotal * 100) === Math.round(withCont.grandTotal * 100) + r2.sellDeltaCents, 'grand moves by the sell delta only');
}

console.log('\n── Keep memory + card wiring');
assert(PRICE_WATCH_KEPT_KEY.startsWith('mageid_'), `Keep key is under mageid_ (${PRICE_WATCH_KEPT_KEY})`);
assert(keptKeyFor({ projectId: 'p', materialId: 'm', latestReceiptLineId: 'l' }) === 'p|m|l', 'kept key shape = projectId|materialId|latestReceiptLineId');
{
  const src = read('components/priceWatch/PriceWatchCard.tsx');
  assert(/testID="pricewatch-card"/.test(src), "card root testID 'pricewatch-card'");
  assert(/From receipts you reviewed/.test(src), 'card says the source: receipts you reviewed');
  assert(/on this device until you sign out/.test(src), 'Keep says it is device-only');
  assert(/commitEstimatePatch\(/.test(src) && /reason: 'manual'/.test(src), 'Reprice writes through commitEstimatePatch (reason manual)');
  assert(!/useTierAccess|canAccess\(/.test(src), 'no new tier gate');
  const lib = read('utils/receiptPriceWatch.ts');
  assert(!/Date\.now\(|new Date\(\)/.test(lib), 'the pure module never reads the clock');
  assert(!/recomputeEstimate\(/.test(lib), 'repriceEstimate never recomputes the whole estimate');
  const screen = read('app/material-receipt.tsx');
  assert(/<PriceWatchCard projectId=\{projectId\} \/>[\s\S]{0,40}\{\/\* Existing receipts for this project \*\/\}/.test(screen), 'the receipts screen mounts PriceWatchCard directly above the existing-receipts list');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
