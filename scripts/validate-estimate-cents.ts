#!/usr/bin/env bun
// validate-estimate-cents.ts — ONE CENT RULE for the estimator, everywhere.
//
// Founder, 2026-09-24: "Are estimates dynamic?? Went up a cent after I left a
// material. How is that monitored?" Prices had not moved. The Full Estimator
// worked each line out to fractions of a cent, rounded each ROW on its own to
// print it, and rounded the RAW SUM once for the footer — so at Houston prices
// and the default 15% markup, a 2x4x8 stud ($6.53) plus a 2x8x16 ($20.72) put
// $27.26 on the bar: the total moved $20.73 for a $20.72 row. The PDF and the
// email then nudged rows so they added up (the client saw $20.73), and the
// pop-up's "cart total after adding" said $27.25.
//
// The rule now (utils/estimateMarkup cartLineSell / priceEstimatorCart): each
// line's sell is rounded to the cent ONCE, and every total is the sum of those
// rounded lines. This file proves it on the SHIPPED functions:
//
//   A. the founder's exact cart: adding the row moves the total by the row
//   B. screen rows === PDF rows === email rows, and the totals agree
//   C. the item, labor and assembly pop-ups preview exactly what the cart
//      shows after Add, and print the unit prices that line is priced at
//   D. 5,000+ random carts at 10/15/25%: every surface agrees to the cent,
//      invoices / change orders / AIA reconcile to the estimate
//   E. a market change is a QUESTION with the right count and delta, and an
//      unchanged cart plans nothing
//   F. the screens are wired to those functions, not a re-typed formula
//
// Run: bun scripts/validate-estimate-cents.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCatalogPrices, resolvePricingMarket, type MaterialItem } from '../constants/materials';
import {
  cartLineSell, priceEstimatorCart, priceMaterialLine, priceLaborLine, priceAssemblyLine,
  popupCartAfter, popupUnitPrices, planCartReprice,
  retotal, round2, lineCost, type EstimatorMaterialLine, type EstimatorLaborLine, type EstimatorAssemblyLine,
} from '../utils/estimateMarkup';
import { formatMoney, parseLenientNumber } from '../utils/formatters';
import { footLines, buildEstimateEmailBody } from '../utils/estimateEmailBody';
import { clientEstimateLineRows, toClientEstimateView } from '../utils/clientEstimateView';
import { roundCents } from '../utils/invoiceBilling';
import { reconcileAIASov } from '../utils/aiaBilling';
import type { LinkedEstimate, LinkedEstimateItem } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with comments removed — a pin must match code, not a note about it. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── Stubs so the real PDF generator can be imported and its HTML captured ──
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
const BunG = (globalThis as unknown as { Bun?: { plugin: (p: { name: string; setup: (b: BunPluginBuilder) => void }) => void } }).Bun;
if (!BunG) { console.error('must run under bun'); process.exit(1); }
let printedHtml = '';
BunG.plugin({
  name: 'estimate-cents-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default } }, loader: 'object' }));
    build.module('expo-print', () => ({ exports: {
      printToFileAsync: async ({ html }: { html: string }) => { printedHtml = html; return { uri: 'file:///cache/out.pdf' }; },
      printAsync: async () => {},
    }, loader: 'object' }));
    build.module('expo-sharing', () => ({ exports: { isAvailableAsync: async () => false, shareAsync: async () => {} }, loader: 'object' }));
    build.module('expo-mail-composer', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: { cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' } }, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
    build.module('@/utils/storage', () => ({ exports: { resolvePhotoUrls: async () => new Map() }, loader: 'object' }));
  },
});
const pdf = await import('../utils/pdfGenerator');

// ── The screen's own shapes, built from the shared pricer ──────────────────
const HOUSTON = getCatalogPrices(resolvePricingMarket('Houston, TX').multiplier);
const US_AVG = getCatalogPrices(resolvePricingMarket('United States').multiplier);
const base = (cat: MaterialItem[]) => cat.filter(m => (m as { specTier?: string }).specTier === 'base' || !(m as { specTier?: string }).specTier);
const byName = (cat: MaterialItem[], name: string): MaterialItem => {
  const m = base(cat).find(x => x.name === name);
  if (!m) throw new Error(`catalog has no '${name}'`);
  return m;
};
type Row = EstimatorMaterialLine<MaterialItem>;
const row = (m: MaterialItem, quantity: number, markup: number): Row =>
  ({ material: m, quantity, markup, usesBulk: quantity >= m.bulkMinQty });
type Labor = EstimatorLaborLine & { id: string; trade: string };
type Assembly = EstimatorAssemblyLine & { id: string; name: string };

/** The LinkedEstimate app/(tabs)/estimate/full.tsx buildLinkedEstimate writes:
 *  every lineTotal is the priced row's sell, the totals are cartTotals'. */
function linkedFrom(cart: Row[], labor: Labor[], asm: Assembly[], pct: number): LinkedEstimate {
  const p = priceEstimatorCart(cart, labor, asm, pct);
  const items: LinkedEstimateItem[] = [
    ...cart.map((it, i) => ({
      materialId: it.material.id, name: it.material.name, category: 'Lumber', unit: it.material.unit,
      quantity: it.quantity, unitPrice: p.materials[i].base, bulkPrice: it.material.baseBulkPrice,
      markup: it.markup, usesBulk: it.usesBulk, lineTotal: p.materials[i].sell, supplier: '',
    })),
    ...labor.map((l, i) => ({
      materialId: l.id, name: l.trade, category: 'Labor', unit: 'hrs', quantity: l.hours,
      unitPrice: l.adjustedRate, bulkPrice: l.adjustedRate, markup: pct, usesBulk: false,
      lineTotal: p.labor[i].sell, supplier: '',
    })),
    ...asm.map((a, i) => ({
      materialId: a.id, name: a.name, category: 'Assemblies', unit: 'ea', quantity: 1,
      unitPrice: a.totalCost, bulkPrice: a.totalCost, markup: pct, usesBulk: false,
      lineTotal: p.assemblies[i].sell, supplier: '',
    })),
  ];
  return { id: 'e', items, globalMarkup: pct, baseTotal: p.directCostTotal, markupTotal: p.markupTotal, grandTotal: p.grandTotal, createdAt: '' };
}
/** Every row the estimator's cart sheet prints, in order. */
const screenRows = (cart: Row[], labor: Labor[], asm: Assembly[], pct: number): number[] => {
  const p = priceEstimatorCart(cart, labor, asm, pct);
  return [...p.materials, ...p.labor, ...p.assemblies].map(l => l.sell);
};
const cents = (n: number) => Math.round(n * 100);
const sumFormatted = (xs: number[]) => xs.reduce((s, x) => s + cents(Number(formatMoney(x, 2).replace(/[$,]/g, ''))), 0);
const fmtCents = (c: number) => formatMoney(c / 100, 2);

async function pdfRowsAndTotal(est: LinkedEstimate): Promise<{ rows: string[]; total: string }> {
  printedHtml = '';
  await pdf.generateEstimatePDFUri({ id: 'p', name: 'Job', type: 'renovation', location: 'Houston, TX', squareFootage: 0, quality: 'standard', description: '', createdAt: '', updatedAt: '', estimate: null, linkedEstimate: est, status: 'estimated' } as never, { companyName: 'GC' } as never);
  const body = printedHtml.slice(printedHtml.indexOf('<tbody>'), printedHtml.indexOf('</tbody>'));
  const rows = [...body.matchAll(/font-weight:600">([^<]+)<\/td>/g)].map(m => m[1]);
  const total = (printedHtml.match(/Estimate Total<\/span><span>([^<]+)</) ?? [])[1] ?? '';
  return { rows, total };
}

// ── A. the founder's cart ───────────────────────────────────────────────────
console.log('\nA. "went up a cent after I left a material" — Houston, 15% markup');
{
  const stud = byName(HOUSTON, '2x4x8 Stud (Douglas Fir)');
  const lumber = byName(HOUSTON, '2x8x16 Framing Lumber');
  const one = [row(stud, 1, 15)];
  const two = [row(stud, 1, 15), row(lumber, 1, 15)];
  const p1 = priceEstimatorCart(one, [], [], 15);
  const p2 = priceEstimatorCart(two, [], [], 15);
  const addedRow = formatMoney(p2.materials[1].sell, 2);
  eq('the stud row and the total both read $6.53', [formatMoney(p1.materials[0].sell, 2), formatMoney(p1.grandTotal, 2)], ['$6.53', '$6.53']);
  eq('the 2x8x16 row reads $20.72', addedRow, '$20.72');
  eq('adding it moves the total by EXACTLY the row it added (was +$20.73 → $27.26)',
    fmtCents(cents(p2.grandTotal) - cents(p1.grandTotal)), addedRow);
  eq('…so the bar reads $27.25', formatMoney(p2.grandTotal, 2), '$27.25');
  eq('the rows on screen add up to the bar', fmtCents(sumFormatted(screenRows(two, [], [], 15))), formatMoney(p2.grandTotal, 2));
  // Removing works the same way.
  eq('removing it moves the total back by exactly that row',
    fmtCents(cents(p2.grandTotal) - cents(priceEstimatorCart(one, [], [], 15).grandTotal)), addedRow);
  // The portable (engine-independent) case: no half-cent tie anywhere.
  const cdx = byName(HOUSTON, '1/2" Plywood 4x8 CDX');
  const d = [row(stud, 1, 15), row(cdx, 1, 15)];
  const pd = priceEstimatorCart(d, [], [], 15);
  eq('stud + 1/2" CDX: rows $6.53 + $46.95 and the bar $53.48 (was $53.49 under them)',
    [...pd.materials.map(l => formatMoney(l.sell, 2)), formatMoney(pd.grandTotal, 2)], ['$6.53', '$46.95', '$53.48']);
}

// ── B. screen rows === PDF rows === email rows ────────────────────────────────
console.log('\nB. the client sees the GC\'s cents — PDF, text PDF, email, portal');
{
  const stud = byName(HOUSTON, '2x4x8 Stud (Douglas Fir)');
  const lumber = byName(HOUSTON, '2x8x16 Framing Lumber');
  const joist = byName(HOUSTON, 'I-Joist 9.5" x 20ft TJI');
  const cart = [row(stud, 1, 15), row(lumber, 1, 15), row(joist, 3, 25)];
  const labor: Labor[] = [{ id: 'lab1', trade: 'Carpenter', adjustedRate: 65.25, hours: 2.5 }];
  const asm: Assembly[] = [{ id: 'as1', name: 'Wall', totalCost: 412.337 }];
  const est = linkedFrom(cart, labor, asm, 15);
  const screen = screenRows(cart, labor, asm, 15).map(x => formatMoney(x, 2));
  const { rows: pdfRows, total: pdfTotal } = await pdfRowsAndTotal(est);
  eq('PDF rows === screen rows', pdfRows, screen);
  eq('PDF total === the estimator bar', pdfTotal, formatMoney(est.grandTotal, 2));
  const text = pdf.buildEstimateTextForEmail({ name: 'Job', location: 'x', squareFootage: 0, description: '', linkedEstimate: est } as never, {} as never);
  eq('text PDF rows === screen rows', [...text.matchAll(/Line Total: (\S+)/g)].map(m => m[1]), screen);
  eq('text PDF total === the bar', (text.match(/TOTAL:\s+(\S+)/) ?? [])[1], formatMoney(est.grandTotal, 2));
  const mail = buildEstimateEmailBody({ rows: est.items.map(i => ({ name: i.name, qtyLabel: '', lineTotal: i.lineTotal })), grandTotal: est.grandTotal });
  eq('email-draft rows === screen rows', [...mail.matchAll(/Total: (\S+)/g)].map(m => m[1]), screen);
  eq('email-draft TOTAL === the bar', (mail.match(/\nTOTAL: (\S+)/) ?? [])[1], formatMoney(est.grandTotal, 2));
  eq('portal proposal total === the bar', formatMoney(toClientEstimateView(est).projectTotal, 2), formatMoney(est.grandTotal, 2));
  eq('Σ lineTotal === grandTotal to the cent (retotal changes nothing)', retotal(est).grandTotal, est.grandTotal);
  eq('labor rows are sold, not printed at cost (2.5 h × $65.25 +15%)', screen[3], formatMoney(round2(65.25 * 1.15 * 2.5), 2));
  // An estimate saved BEFORE this rule: raw fractional-cent lines on a
  // half-cent tie. The PDF's total is printed in the cents its rows foot to.
  const legacy: LinkedEstimate = { ...est, items: est.items.slice(0, 2).map((it, i) => ({ ...it, lineTotal: [6.532, 60.053][i] })), grandTotal: 66.585, baseTotal: 57.9, markupTotal: 8.685 };
  const lp = await pdfRowsAndTotal(legacy);
  const lpSum = lp.rows.reduce((s, r) => s + cents(Number(r.replace(/[$,]/g, ''))), 0);
  eq('a legacy raw estimate: the PDF\'s rows add up to the PDF\'s own total', fmtCents(lpSum), lp.total);
}

// ── C. the pop-up previews the cart after the press ─────────────────────────
console.log('\nC. the item pop-up shows what Add / Update will do');
{
  const stud = byName(HOUSTON, '2x4x8 Stud (Douglas Fir)');
  const lumber = byName(HOUSTON, '2x8x16 Framing Lumber');
  const cart = [row(stud, 1, 15)];
  const labor: Labor[] = [{ id: 'lab1', trade: 'Carpenter', adjustedRate: 60, hours: 3 }];
  // New row: previews at the global markup, and the WHOLE estimate total.
  const add = popupCartAfter(cart, lumber, parseLenientNumber('1'), 15);
  const afterAdd = priceEstimatorCart(add.next, labor, [], 15);
  // What MaterialCartContext.addToCart does with the same press:
  const ctxAdded = [...cart, { material: lumber, quantity: 1, markup: 15, usesBulk: 1 >= lumber.bulkMinQty }];
  eq('"Estimate total after adding" === the bar after Add (materials AND labor)',
    formatMoney(afterAdd.grandTotal, 2), formatMoney(priceEstimatorCart(ctxAdded, labor, [], 15).grandTotal, 2));
  eq('…and the pop-up line total === the row the cart then shows',
    formatMoney(priceMaterialLine(add.line!).sell, 2), formatMoney(priceEstimatorCart(ctxAdded, labor, [], 15).materials[1].sell, 2));
  // Existing row at its OWN 25% markup, qty typed "2.5" (the press commits 2.5).
  const tuned = [row(stud, 1, 15), row(lumber, 1, 25)];
  const upd = popupCartAfter(tuned, lumber, parseLenientNumber('2.5'), 15);
  const ctxUpdated = tuned.map(i => i.material.id === lumber.id ? { ...i, quantity: 2.5, usesBulk: 2.5 >= i.material.bulkMinQty } : i);
  eq('an existing row previews at ITS markup (25%), not the global 15%',
    priceMaterialLine(upd.line!).sell, cartLineSell(lumber.baseRetailPrice, 2.5, 25));
  eq('…at the typed 2.5, not parseInt\'s 2',
    formatMoney(priceEstimatorCart(upd.next, [], [], 15).grandTotal, 2), formatMoney(priceEstimatorCart(ctxUpdated, [], [], 15).grandTotal, 2));
  // A row the GC chose to KEEP at its old market price previews at that price.
  const oldPriced = [row(byName(US_AVG, '2x8x16 Framing Lumber'), 1, 15)];
  const kept = popupCartAfter(oldPriced, lumber, 2, 15);
  eq('a kept (older-market) row previews at its own snapshot, the price Update keeps',
    priceMaterialLine(kept.line!).base, oldPriced[0].material.baseRetailPrice);
  eq('an unusable quantity previews no change', popupCartAfter(cart, lumber, parseLenientNumber('abc'), 15).line, null);
  // …and the unit prices printed ABOVE that line total are the ones it uses.
  const shown = popupUnitPrices(oldPriced, lumber);
  eq('a kept row\'s pop-up prints ITS snapshot prices, not the catalog\'s',
    [shown.material.baseRetailPrice, shown.material.baseBulkPrice],
    [oldPriced[0].material.baseRetailPrice, oldPriced[0].material.baseBulkPrice]);
  ok('…says it is kept, and names the price book price', shown.kept && shown.catalog.baseRetailPrice === lumber.baseRetailPrice
    && shown.material.baseRetailPrice !== lumber.baseRetailPrice);
  eq('…and the line total is that printed price × qty × its markup',
    priceMaterialLine(kept.line!).sell, cartLineSell(shown.material.baseRetailPrice, 2, 15));
  const fresh = popupUnitPrices(tuned, lumber);
  ok('a row at the current price book is not flagged as kept', !fresh.kept && fresh.material === tuned[1].material);
  ok('a new item prints the catalog prices', popupUnitPrices(cart, lumber).material === lumber && !popupUnitPrices(cart, lumber).kept);

  // Labor pop-up: handleAddLabor commits { adjustedRate, hours } from
  // parseLenientNumber; the row then prints priceEstimatorCart's labor sell.
  // Reviewer's repro: $65/hr × 8 hrs at 15% — the pop-up said $520.00 (cost),
  // the row after Add said $598.00 (sell).
  for (const pct of [0, 10, 15, 25]) {
    const rate = parseLenientNumber('65'), hours = parseLenientNumber('8');
    const preview = priceLaborLine({ adjustedRate: rate!, hours: hours! }, pct).sell;
    const laborCartAfter: Labor[] = [{ id: 'lab1', trade: 'Carpenter', adjustedRate: rate!, hours: hours! }];
    eq(`labor pop-up Line Total === the labor row after Add (${pct}%)`,
      formatMoney(preview, 2), formatMoney(priceEstimatorCart(cart, laborCartAfter, [], pct).labor[0].sell, 2));
  }
  eq('…the reviewer\'s case reads $598.00, with the $520.00 cost under it',
    [formatMoney(priceLaborLine({ adjustedRate: 65, hours: 8 }, 15).sell, 2), formatMoney(priceLaborLine({ adjustedRate: 65, hours: 8 }, 15).cost, 2)],
    ['$598.00', '$520.00']);
  // Assembly pop-up: handleAddAssembly stores calculateAssemblyCost(...) on the
  // row; the pop-up's Total prices that same cost with the same function.
  for (const totalCost of [0.005, 123.456, 1049.995, 4321.1]) {
    const asm: Assembly[] = [{ id: 'a1', name: 'Wall', totalCost }];
    eq(`assembly pop-up Total === the assembly row after Add ($${totalCost})`,
      formatMoney(priceAssemblyLine({ totalCost }, 15).sell, 2), formatMoney(priceEstimatorCart([], [], asm, 15).assemblies[0].sell, 2));
  }
}

// ── D. every surface agrees, on thousands of random carts ────────────────────
console.log('\nD. random carts — every surface agrees to the cent');
{
  let seed = 20260924;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pool = base(HOUSTON);
  const fails: Record<string, number> = {};
  const bump = (k: string) => { fails[k] = (fails[k] ?? 0) + 1; };
  let carts = 0;
  for (const pct of [10, 15, 25]) {
    for (let n = 0; n < 1800; n++) {
      carts++;
      const lines = 1 + Math.floor(rnd() * 6);
      const cart: Row[] = [];
      const used = new Set<string>();
      for (let k = 0; k < lines; k++) {
        const m = pool[Math.floor(rnd() * pool.length)];
        if (used.has(m.id)) continue;
        used.add(m.id);
        const q = rnd() < 0.2 ? Math.round(rnd() * 400) / 10 : 1 + Math.floor(rnd() * 30);
        cart.push(row(m, q, rnd() < 0.15 ? 40 : pct));
      }
      const labor: Labor[] = rnd() < 0.4 ? [{ id: 'l', trade: 'Crew', adjustedRate: Math.round(rnd() * 9000) / 100 + 20, hours: Math.round(rnd() * 80) / 2 }] : [];
      const asm: Assembly[] = rnd() < 0.3 ? [{ id: 'a', name: 'Asm', totalCost: rnd() * 5000 }] : [];
      const p = priceEstimatorCart(cart, labor, asm, pct);
      const est = linkedFrom(cart, labor, asm, pct);
      const rows = screenRows(cart, labor, asm, pct);
      const bar = formatMoney(p.grandTotal, 2);
      if (fmtCents(sumFormatted(rows)) !== bar) bump('rows on screen do not add up to the bar');
      if (`$${p.grandTotal.toFixed(2)}` !== bar.replace(/,/g, '')) bump('toFixed (SMS) disagrees with the bar');
      if (Math.round(p.grandTotal * 100) !== cents(p.grandTotal) || fmtCents(Math.round(p.grandTotal * 100)) !== bar) bump('Math.round disagrees with the bar');
      if (formatMoney(p.directCostTotal, 2) !== fmtCents(cents(p.materialsCost) + cents(p.laborCost) + cents(p.assembliesCost))) bump('cost rows do not add up to direct cost');
      if (fmtCents(cents(p.directCostTotal) + cents(p.markupTotal)) !== bar) bump('cost + overhead & profit !== grand total');
      // The job-cost budget / buyout side reads each row's cost back with
      // lineCost (round2(unitPrice × qty)); those must add to baseTotal.
      if (est.items.reduce((s, i) => s + cents(lineCost(i)), 0) !== cents(est.baseTotal)) bump('Σ lineCost of the linked rows !== baseTotal');
      const foot = footLines(rows, p.grandTotal);
      if (foot.some((c, i) => c !== cents(rows[i]))) bump('footLines moved a row (PDF/email row !== screen row)');
      const clientRows = clientEstimateLineRows(est.items);
      if (clientRows.map(r => formatMoney(r.lineTotal, 2)).join() !== rows.map(r => formatMoney(r, 2)).join()) bump('client document rows !== screen rows');
      if (formatMoney(toClientEstimateView(est).projectTotal, 2) !== bar) bump('portal total !== bar');
      if (retotal(est).grandTotal !== est.grandTotal) bump('retotal moves the grand total');
      // Billing it: a 100% invoice seeds roundCents(lineTotal) per line.
      if (fmtCents(est.items.reduce((s, i) => s + cents(roundCents(i.lineTotal)), 0)) !== bar) bump('a 100% invoice !== the estimate');
      // A change order's "contract sum prior" is the estimate total on the cent.
      if (formatMoney(roundCents(est.grandTotal), 2) !== bar) bump('change-order contract sum !== the estimate');
      // AIA: the SOV is roundCents(lineTotal) per line against the contract sum.
      const aia = reconcileAIASov({ lines: est.items.map(i => ({ scheduledValue: roundCents(i.lineTotal) })), contractSumToDate: est.grandTotal } as never);
      if (aia.difference !== 0) bump('AIA schedule of values does not reconcile');
      // Removing any one row moves the total by exactly that row.
      if (cart.length > 1) {
        const k = Math.floor(rnd() * cart.length);
        const less = priceEstimatorCart(cart.filter((_, i) => i !== k), labor, asm, pct);
        if (cents(p.grandTotal) - cents(less.grandTotal) !== cents(p.materials[k].sell)) bump('removing a row moved the total by something else');
      }
    }
  }
  ok(`${carts} carts at 10%, 15% and 25% (with 40% hand-tuned rows, labor, assemblies): zero disagreements`,
    Object.keys(fails).length === 0, fails);
}

// ── E. a market change asks, with the right numbers ──────────────────────────
console.log('\nE. a market change is a question, not a silent reprice');
{
  const osbH = byName(HOUSTON, '3/4" OSB Sheathing 4x8');
  const osbUS = byName(US_AVG, '3/4" OSB Sheathing 4x8');
  const stud = byName(HOUSTON, '2x4x8 Stud (Douglas Fir)');
  const custom = { ...stud, id: 'custom-1', name: 'Custom thing', baseRetailPrice: 12.34, baseBulkPrice: 11.11 };
  const cart = [row(osbH, 1, 15), row(stud, 4, 15), row(custom, 2, 15)];
  eq('Houston → US average: OSB goes $37.02 → $38.97 (the investigation\'s figures)', [osbH.baseRetailPrice, osbUS.baseRetailPrice], [37.02, 38.97]);
  const plan = planCartReprice(cart, US_AVG);
  eq('the plan counts the rows whose price would change (custom rows are never touched)', plan.changedCount, 2);
  eq('its delta is exactly the grand-total change the reprice would make',
    plan.sellDelta, round2(priceEstimatorCart(plan.next, [], [], 15).grandTotal - priceEstimatorCart(cart, [], [], 15).grandTotal));
  ok('…and it is a real move, not a cent', plan.sellDelta > 1, plan.sellDelta);
  eq('the custom row is left as it was', plan.next[2], cart[2]);
  const same = planCartReprice(cart, HOUSTON);
  eq('a cart already at this market plans ZERO changes (so the mount does not write)', [same.changedCount, same.sellDelta], [0, 0]);
  ok('…and keeps every row by identity', same.next.every((r, i) => r === cart[i]));
  ok('the signature names what would change, so a "Keep" answer is remembered against it',
    plan.signature.length > 0 && plan.signature !== planCartReprice([row(osbH, 1, 15)], US_AVG).signature);
  // A row priced at BULK whose RETAIL price alone moved: its line total does
  // not change, so it is not "priced differently" and must not raise
  // "Reprice 1 line … +$0.00". It is still refreshed if he reprices.
  const bulkRow = row(osbH, osbH.bulkMinQty, 15);
  const retailOnly = { ...osbH, baseRetailPrice: round2(osbH.baseRetailPrice + 1) };
  const quiet = planCartReprice([bulkRow], [retailOnly]);
  eq('a bulk row whose retail price alone changed: no question, no delta', [quiet.changedCount, quiet.sellDelta, quiet.signature], [0, 0, '']);
  ok('…but it is stale, and a Reprice / Refresh carries the new retail price', quiet.staleCount === 1 && quiet.next[0].material === retailOnly);
  const retailRow = row(osbH, 1, 15);
  const bulkOnly = { ...osbH, baseBulkPrice: round2(osbH.baseBulkPrice - 1) };
  eq('…and the same for a retail row whose bulk price alone changed', [planCartReprice([retailRow], [bulkOnly]).changedCount, planCartReprice([retailRow], [bulkOnly]).sellDelta], [0, 0]);
  const both = planCartReprice([bulkRow, retailRow], [{ ...osbH, baseBulkPrice: round2(osbH.baseBulkPrice + 2) }]);
  eq('a row whose USED price moved is counted, with its real delta', [both.changedCount, both.staleCount, both.sellDelta],
    [1, 2, round2(cartLineSell(osbH.baseBulkPrice + 2, osbH.bulkMinQty, 15) - cartLineSell(osbH.baseBulkPrice, osbH.bulkMinQty, 15))]);
  ok('…so the notice never says "+$0.00": every counted plan here has a non-zero delta', both.sellDelta !== 0 && plan.sellDelta !== 0);
}

// ── F. the screens are wired to the shared functions ─────────────────────────
console.log('\nF. wiring — no screen re-types the line formula');
{
  const RAW = /\(1 \+ (?:item|i|existing)\.markup \/ 100\) \* (?:item|i|existing)\.quantity|\* \(1 \+ globalMarkup \/ 100\)/;
  const full = code('app/(tabs)/estimate/full.tsx');
  const review = code('app/(tabs)/estimate/review.tsx');
  const comparison = code('components/EstimateComparison.tsx');
  for (const [f, src] of [['full.tsx', full], ['review.tsx', review], ['EstimateComparison.tsx', comparison]] as const) {
    ok(`${f} has no raw base × (1 + markup) × qty line formula`, !RAW.test(src), (src.match(RAW) ?? [''])[0]);
  }
  ok('full.tsx prices the cart with priceEstimatorCart', /priceEstimatorCart\(cart, laborCart, assemblyCart, globalMarkup\)/.test(full));
  ok('…and hands cartTotals the row sums', /laborSell: pricedCart\.laborSell/.test(full) && /assemblySell: pricedCart\.assemblySell/.test(full));
  ok('the linked estimate stores each row\'s priced sell', /lineTotal: pricedCart\.labor\[i\]\.sell/.test(full) && /pricedCart\.materials\[i\]/.test(full) && /lineTotal: pricedCart\.assemblies\[i\]\.sell/.test(full));
  ok('the email draft rows are the priced rows', (full.match(/lineTotal: pricedCart\.(materials|labor|assemblies)\[i\]\.sell/g) ?? []).length >= 5);
  ok('the pop-up previews popupCartAfter through the same pricer, with the committed parser',
    /popupCartAfter\(cart, selectedMaterial, parseLenientNumber\(itemQty\), globalMarkup\)/.test(full) && !/popupLineTotal/.test(full));
  ok('…and no pop-up total uses toFixed', !/popupPreview\.[a-zA-Z]+\)?\.toFixed/.test(full) && !/Cart total after adding/.test(full));
  ok('the market effect no longer writes the cart', (() => {
    const at = full.indexOf('useEffect(() => {\n    setMaterials(getCatalogPrices(locationMultiplier));');
    return at > -1 && !/ctxReplaceCart/.test(full.slice(at, full.indexOf('}, [locationMultiplier]);', at)));
  })());
  ok('…the reprice is a question with Keep / Reprice', /testID="reprice-keep"/.test(full) && /testID="reprice-apply"/.test(full) && /planCartReprice\(cart, materials\)/.test(full));
  ok('…a zero delta reads "No change to the total", never "+$0.00"',
    /repricePlan\.sellDelta === 0 \?/.test(full) && /No change to the total\./.test(full) && /repricePlan\.sellDelta > 0 \? '\+' : '−'/.test(full));
  ok('…the Refresh button carries every stale snapshot', /if \(plan\.staleCount > 0\) ctxReplaceCart\(plan\.next\);/.test(full));
  ok('the item pop-up prints the unit prices of the line it prices (popupUnitPrices)',
    /popupUnitPrices\(cart, selectedMaterial\)/.test(full)
    && /\(popupPrices\?\.material \?\? selectedMaterial\)\.baseRetailPrice\.toFixed\(2\)/.test(full)
    && /\(popupPrices\?\.material \?\? selectedMaterial\)\.baseBulkPrice\.toFixed\(2\)/.test(full)
    && /testID="popup-kept-price-note"/.test(full));
  ok('…and its bulk banner follows the previewed line', /\{popupPreview\.usesBulk && \(/.test(full) && !/\(parseInt\(itemQty, 10\) \|\| 0\) >= selectedMaterial\.bulkMinQty/.test(full));
  ok('the labor pop-up previews the row\'s sell via priceLaborLine, parsed as Add parses',
    /priceLaborLine\(\{ adjustedRate: rate, hours \}, globalMarkup\)/.test(full)
    && /const rate = parseLenientNumber\(laborRateInput\);/.test(full)
    && /testID="labor-popup-line-total">\{formatMoney\(laborPopupPreview\.sell, 2\)\}/.test(full)
    && !/\(parseFloat\(laborRateInput\) \|\| 0\) \*/.test(full));
  ok('the assembly pop-up Total is priceAssemblyLine of the costs Add stores',
    /const priced = priceAssemblyLine\(costs, globalMarkup\);/.test(full)
    && /testID="assembly-popup-total">\{formatMoney\(priced\.sell, 2\)\}/.test(full)
    && !/costs\.totalCost\.toFixed/.test(full));
  ok('the labor tab\'s in-cart chip prints the row\'s sell', /formatMoney\(priceLaborLine\(inCart, globalMarkup\)\.sell, 2\)/.test(full)
    && !/inCart\.adjustedRate \* inCart\.hours/.test(full));
  ok('AI / custom / recent bulk prices sit on the cent grid',
    /round2\(aiMat\.unitPrice \* 0\.85\)/.test(full) && /round2\(price \* 0\.9\)/.test(full) && /round2\(recent\.unitPrice \* 0\.85\)/.test(full));
  ok('the email subject prints the total in cents, not a raw float', !/\$\{v\.toLocaleString\('en-US'\)\}/.test(full));
  ok('review.tsx prices with priceEstimatorCart', /priceEstimatorCart\(cart, laborCart, assemblyCart, globalMarkup\)/.test(review));
  ok('…and its client projection uses the priced SELL rows', /lineTotal: priced\.materials\[i\]\.sell/.test(review));
  ok('EstimateComparison uses priceMaterialLine', (comparison.match(/priceMaterialLine\(i\)\.sell/g) ?? []).length === 2);
  const pdfSrc = code('utils/pdfGenerator.ts');
  ok('the PDF prints its total in the cents its rows foot to', (pdfSrc.match(/formatCurrency\(totalCents \/ 100\)/g) ?? []).length === 2 && !/formatCurrency\(est\.grandTotal\)/.test(pdfSrc));
  ok('bill-from-estimate bills a line at its cent value', /const full = roundCents\(item\.lineTotal\);/.test(code('app/bill-from-estimate.tsx')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
