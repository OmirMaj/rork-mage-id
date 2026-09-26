#!/usr/bin/env bun
// scripts/validate-money-grids.ts — wave 6d, lane M1 ("test:money-grids").
//
// The AIA pay application's G703 continuation sheet became an editable grid on
// the web app, and its GRAND TOTAL row became the G702 cover's own math; the
// change-order editor got the same grid. Money on a certificate a GC signs, so
// this EXECUTES the rules rather than grepping for them:
//
//  a) THE PDF REFACTOR. generateAIAPayAppPDF's G703 rows and footer now come
//     from g703LineFigures / g703Footer. On 40 cent-exact applications the
//     rows and the tfoot are compared, character for character, with a FROZEN
//     copy of the pre-refactor inline math. On 500 seeded applications with
//     sub-cent D, E and F, the tfoot's G equals G702 line 4 (it used to be
//     roundCents(ΣD)+roundCents(ΣE)+roundCents(ΣF), a cent off line 4 — the
//     fixture proves that split really occurs under the old math), the tfoot's
//     I equals line 5, and Σ line I === Total Retainage.
//  b) planG703CellEdit, as an exhaustive table.
//  c) g703DraftBlocker, g703PastePlan, g703MoneyColumnWidth, g703GridMinWidth.
//  d) The change-order grid: coGridFooter === persistCO's committedAmount (the
//     statement is LIFTED from app/change-order.tsx and executed) on random
//     line sets with half-cent drafts; coUnnamedLineBlocker; coLinesFromPaste;
//     coPrefillLines never yields a blank name.
//  e) Source pins (comment-stripped): the grid mounts only on desktop web in
//     grid view, read-only follows the certificate, the grid's handlers never
//     call setApp, no Cmd+S / Cmd+Enter on the pay app, cents on the KPI strip
//     and the G702 card, the phone fragment, the change-order cards branch,
//     and the two early-access cards' honest copy (contract D8).
//
// Run: bun scripts/validate-money-grids.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAIAPayAppHtml,
  computeAIATotals,
  g703LineFigures,
  g703Footer,
  planG703CellEdit,
  g703DraftBlocker,
  g703PastePlan,
  g703MoneyColumnWidth,
  g703GridMinWidth,
  roundCents,
  retainageOnWorkValue,
  storedRetainagePercentForLine,
  type AIAPayApplication,
  type AIASOVLine,
} from '../utils/aiaBilling';
import type { CompanyBranding } from '../types';

const ROOT = join(__dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let pass = 0;
let fail = 0;
function ok(label: string, cond: unknown, detail = ''): void {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}
const eq = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(label, g === w, `got ${g}\n        want ${w}`);
};

// ── seeded randomness (mulberry32) ──────────────────────────────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRANDING = {
  companyName: 'Smoke GC', contactName: 'Pat', email: 'pat@example.test', phone: '555-0100',
  address: '1 Main St', licenseNumber: 'CCB 1', tagline: '',
} as CompanyBranding;

function makeApp(r: () => number, i: number, subCent: boolean): AIAPayApplication {
  const cents = (max: number) => Math.round(r() * max * 100) / 100;
  const odd = (max: number) => Math.round(r() * max * 10000) / 10000; // sub-cent
  const n = 1 + Math.floor(r() * 12);
  const rates = [0, 5, 10, 7.5];
  const lines: AIASOVLine[] = Array.from({ length: n }, (_, k) => {
    // A deductive CO line (negative C) and a zero line now and then.
    const kind = r();
    const scheduledValue = kind < 0.08 ? -cents(4000) : kind < 0.12 ? 0 : cents(90000);
    const val = (max: number) => (subCent ? odd(max) : cents(max));
    return {
      id: `l${i}-${k}`,
      itemNo: String(k + 1),
      description: k % 5 === 0 ? `Scope <${k}> & "quoted"` : `Line ${k + 1}`,
      scheduledValue,
      fromPreviousApp: r() < 0.3 ? 0 : val(30000),
      thisPeriod: kind < 0.08 ? -cents(4000) : val(30000),
      materialsPresentlyStored: r() < 0.5 ? 0 : val(12000),
      retainagePercent: rates[Math.floor(r() * rates.length)],
      ...(r() < 0.4 ? { storedRetainagePercent: rates[Math.floor(r() * rates.length)] } : {}),
    };
  });
  const scheduled = roundCents(lines.reduce((s, l) => s + l.scheduledValue, 0));
  return {
    applicationNumber: 1 + (i % 9), applicationDate: '2026-03-31', periodTo: '2026-03-31',
    ownerName: 'Owner', contractorName: 'GC', projectName: `Job ${i}`,
    originalContractSum: scheduled, netChangeByCO: 0, contractSumToDate: scheduled,
    retainagePercent: 10, lessPreviousCertificates: cents(5000), lines,
  };
}

// ── a) THE PDF REFACTOR ─────────────────────────────────────────────────────
// FROZEN: the G703 row and footer math exactly as generateAIAPayAppPDF
// computed them inline before wave 6d (utils/aiaBilling.ts @ 439e119a,
// buildAIAPayAppHtml). Never edit this copy to make a check pass.
function frozenEscapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function frozenFmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function frozenG703(app: AIAPayApplication): { rows: string; tfoot: string } {
  const totals = computeAIATotals(app);
  const rows = app.lines.map((l, i) => {
    const totalCompleted = l.fromPreviousApp + l.thisPeriod;
    const totalCompletedAndStored = totalCompleted + l.materialsPresentlyStored;
    const pct = l.scheduledValue > 0
      ? (totalCompletedAndStored / l.scheduledValue) * 100
      : 0;
    const balanceToFinish = roundCents(l.scheduledValue - totalCompletedAndStored);
    const retainage = roundCents(
      retainageOnWorkValue(totalCompleted, l.retainagePercent)
      + retainageOnWorkValue(l.materialsPresentlyStored, storedRetainagePercentForLine(l)),
    );
    return `
      <tr class="${i % 2 === 0 ? 'alt' : ''}">
        <td class="ctr">${frozenEscapeHtml(l.itemNo)}</td>
        <td>${frozenEscapeHtml(l.description)}</td>
        <td class="num">${frozenFmt(l.scheduledValue)}</td>
        <td class="num">${frozenFmt(l.fromPreviousApp)}</td>
        <td class="num">${frozenFmt(l.thisPeriod)}</td>
        <td class="num">${frozenFmt(l.materialsPresentlyStored)}</td>
        <td class="num">${frozenFmt(totalCompletedAndStored)}</td>
        <td class="num">${pct.toFixed(1)}%</td>
        <td class="num">${frozenFmt(balanceToFinish)}</td>
        <td class="num">${frozenFmt(retainage)}</td>
      </tr>
    `;
  }).join('');
  const sumCol = (key: 'scheduledValue' | 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored') =>
    roundCents(app.lines.reduce((s, l) => s + (l[key] as number), 0));
  const g703TotalScheduled = sumCol('scheduledValue');
  const g703TotalFromPrev = sumCol('fromPreviousApp');
  const g703TotalThisPeriod = sumCol('thisPeriod');
  const g703TotalStored = sumCol('materialsPresentlyStored');
  const g703TotalCompletedStored = roundCents(g703TotalFromPrev + g703TotalThisPeriod + g703TotalStored);
  const g703TotalRetainage = totals.totalRetainage;
  const tfoot = `<tfoot>
      <tr>
        <td colspan="2" class="ctr">GRAND TOTAL</td>
        <td class="num">${frozenFmt(g703TotalScheduled)}</td>
        <td class="num">${frozenFmt(g703TotalFromPrev)}</td>
        <td class="num">${frozenFmt(g703TotalThisPeriod)}</td>
        <td class="num">${frozenFmt(g703TotalStored)}</td>
        <td class="num">${frozenFmt(g703TotalCompletedStored)}</td>
        <td class="num">${totals.percentComplete.toFixed(1)}%</td>
        <td class="num">${frozenFmt(roundCents(g703TotalScheduled - g703TotalCompletedStored))}</td>
        <td class="num">${frozenFmt(g703TotalRetainage)}</td>
      </tr>
    </tfoot>`;
  return { rows, tfoot };
}
const tbodyOf = (html: string): string | null => {
  const t = html.lastIndexOf('<tfoot>');
  const b = t < 0 ? -1 : html.lastIndexOf('<tbody>', t);
  const e = t < 0 ? -1 : html.lastIndexOf('</tbody>', t);
  return b < 0 || e < 0 ? null : html.slice(b + '<tbody>'.length, e);
};
const tfootOf = (html: string): string | null => {
  const b = html.indexOf('<tfoot>');
  const e = html.indexOf('</tfoot>');
  return b < 0 || e < 0 ? null : html.slice(b, e + '</tfoot>'.length);
};
const tds = (s: string): string[] => [...s.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);

console.log('\na) the PDF refactor');
{
  const r = rng(6_0421);
  const mismatches: string[] = [];
  for (let i = 0; i < 40; i++) {
    const app = makeApp(r, i, false);
    const html = buildAIAPayAppHtml(app, BRANDING);
    const want = frozenG703(app);
    const body = tbodyOf(html);
    const foot = tfootOf(html);
    if (body === null || !body.includes(want.rows) || foot !== want.tfoot) mismatches.push(`app ${i}`);
  }
  ok('40 cent-exact applications: the G703 rows and GRAND TOTAL print byte-identical to the pre-refactor math', mismatches.length === 0, mismatches.join(', '));

  const r2 = rng(500_17);
  const bad: string[] = [];
  let oldSplit = 0;
  for (let i = 0; i < 500; i++) {
    const app = makeApp(r2, i, true);
    const totals = computeAIATotals(app);
    const html = buildAIAPayAppHtml(app, BRANDING);
    const foot = tds(tfootOf(html) ?? '');
    const line4 = /4\. Total Completed &amp; Stored to Date \(Column G on G703\)<\/td>\s*<td class="num">\$ ([^<]+)<\/td>/.exec(html)?.[1];
    // [GRAND TOTAL, C, D, E, F, G, %, H, I]
    const g = foot[5];
    const iCol = foot[foot.length - 1];
    if (g !== frozenFmt(totals.totalCompletedAndStored) || g !== line4) bad.push(`app ${i}: G ${g} vs line 4 ${line4}`);
    if (iCol !== frozenFmt(totals.totalRetainage)) bad.push(`app ${i}: I ${iCol} vs ${totals.totalRetainage}`);
    const sumI = roundCents(app.lines.reduce((s, l) => s + roundCents(g703LineFigures(l).retainage), 0));
    if (sumI !== totals.totalRetainage) bad.push(`app ${i}: Σ I ${sumI} vs ${totals.totalRetainage}`);
    if (tds(frozenG703(app).tfoot)[5] !== g) oldSplit++;
  }
  ok('500 sub-cent applications: tfoot G === G702 line 4, tfoot I === line 5, Σ line I === Total Retainage', bad.length === 0, bad.slice(0, 5).join('; '));
  ok(`…and the fixture really exercises the old 1¢ split (${oldSplit} of 500 would have printed G a cent off line 4)`, oldSplit > 0);

  // The footer helper IS the cover's math.
  const app = makeApp(rng(9), 1, true);
  const f = g703Footer(app);
  const t = computeAIATotals(app);
  eq('g703Footer: G, %, I are the G702 figures', [f.completedAndStored, f.percent, f.retainage], [t.totalCompletedAndStored, t.percentComplete, t.totalRetainage]);
  eq('g703Footer: H = C total − G702 line 4', f.balanceToFinish, roundCents(t.totalScheduledValue - t.totalCompletedAndStored));
  eq('g703LineFigures: % is null (not 0) on a deductive line',
    g703LineFigures({ scheduledValue: -500, fromPreviousApp: 0, thisPeriod: -500, materialsPresentlyStored: 0, retainagePercent: 10 }).percent, null);
}

// ── b) planG703CellEdit ─────────────────────────────────────────────────────
console.log('\nb) planG703CellEdit');
{
  const L = { scheduledValue: 10_000, thisPeriod: 250, materialsPresentlyStored: 40 };
  const neg = { scheduledValue: -1_200, thisPeriod: -1_200, materialsPresentlyStored: 0 };
  const E = { sovEditing: false };
  const S = { sovEditing: true };
  const table: [string, unknown, unknown][] = [
    ['blank This period is $0 (MoneyField parity)', planG703CellEdit(L, 'thisPeriod', '', E), { kind: 'patch', patch: { thisPeriod: 0 } }],
    ['blank Stored is $0', planG703CellEdit(L, 'stored', '   ', E), { kind: 'patch', patch: { materialsPresentlyStored: 0 } }],
    ['"abc" is refused with the figure the line still bills', planG703CellEdit(L, 'thisPeriod', 'abc', E), { kind: 'invalid', reason: '"abc" is not an amount — this line still bills $250.00' }],
    ['"abc" in Stored quotes Stored', planG703CellEdit(L, 'stored', 'abc', E), { kind: 'invalid', reason: '"abc" is not an amount — this line still bills $40.00' }],
    ['"(250)" is the accountant\'s negative', planG703CellEdit(L, 'thisPeriod', '(250)', E), { kind: 'patch', patch: { thisPeriod: -250 } }],
    ['"1,234.567" is rounded to the cent at entry', planG703CellEdit(L, 'thisPeriod', '1,234.567', E), { kind: 'patch', patch: { thisPeriod: 1234.57 } }],
    ['"$4,500" is 4500', planG703CellEdit(L, 'stored', '$4,500', E), { kind: 'patch', patch: { materialsPresentlyStored: 4500 } }],
    ['Scheduled is ignored unless the SOV is being edited', planG703CellEdit(L, 'scheduled', '12000', E), { kind: 'ignore' }],
    ['Scheduled while editing the SOV', planG703CellEdit(L, 'scheduled', '12000.005', S), { kind: 'patch', patch: { scheduledValue: 12000.01 } }],
    ['percent 101 is refused', planG703CellEdit(L, 'percent', '101', E), { kind: 'invalid', reason: 'Percent complete is 0–100.' }],
    ['percent -1 is refused', planG703CellEdit(L, 'percent', '-1', E), { kind: 'invalid', reason: 'Percent complete is 0–100.' }],
    ['percent on C ≤ 0 is refused (a deductive CO line)', planG703CellEdit(neg, 'percent', '50', E), { kind: 'invalid', reason: 'Percent needs a positive scheduled value — type This period instead.' }],
    ['percent on C = 0 is refused', planG703CellEdit({ ...L, scheduledValue: 0 }, 'percent', '50', E), { kind: 'invalid', reason: 'Percent needs a positive scheduled value — type This period instead.' }],
    ['percent blank is nothing yet', planG703CellEdit(L, 'percent', '', E), { kind: 'ignore' }],
    ['percent "x" is refused', planG703CellEdit(L, 'percent', 'x', E), { kind: 'invalid', reason: '"x" is not a percent — type a number from 0 to 100.' }],
    ['percent "62.5%" applies 62.5', planG703CellEdit(L, 'percent', '62.5%', E), { kind: 'percent', percent: 62.5 }],
    ['percent 100 is allowed', planG703CellEdit(L, 'percent', '100', E), { kind: 'percent', percent: 100 }],
    ['itemNo when not editing the SOV is ignored', planG703CellEdit(L, 'itemNo', '3.1', E), { kind: 'ignore' }],
    ['itemNo while editing the SOV', planG703CellEdit(L, 'itemNo', '3.1', S), { kind: 'patch', patch: { itemNo: '3.1' } }],
    ['description when not editing is ignored', planG703CellEdit(L, 'description', 'Framing', E), { kind: 'ignore' }],
    ['description while editing', planG703CellEdit(L, 'description', 'Framing', S), { kind: 'patch', patch: { description: 'Framing' } }],
  ];
  for (const [label, got, want] of table) eq(label, got, want);
}

// ── c) blocker, paste, widths ───────────────────────────────────────────────
console.log('\nc) g703DraftBlocker, g703PastePlan, widths');
{
  const lines = [
    { id: 'a', itemNo: '1', scheduledValue: 1000, thisPeriod: 100, materialsPresentlyStored: 0, fromPreviousApp: 0 },
    { id: 'b', itemNo: '2', scheduledValue: 2000, thisPeriod: 200, materialsPresentlyStored: 0, fromPreviousApp: 0 },
    { id: 'c', itemNo: '3', scheduledValue: -300, thisPeriod: -300, materialsPresentlyStored: 0, fromPreviousApp: 0 },
  ];
  eq('no drafts, no blocker', g703DraftBlocker({}, lines), null);
  eq('valid drafts, no blocker', g703DraftBlocker({ 'a:thisPeriod': '120.5', 'b:percent': '40' }, lines), null);
  eq('an invalid draft names the line and the column',
    g703DraftBlocker({ 'b:stored': '12,5o' }, lines),
    { title: 'Line 2 — Stored', message: '"12,5o" is not an amount — this line still bills $0.00' });
  eq('the first invalid draft in LINE order wins',
    g703DraftBlocker({ 'c:percent': '10', 'a:thisPeriod': 'x' }, lines)?.title, 'Line 1 — This period');
  eq('a percent on a deductive line blocks, named',
    g703DraftBlocker({ 'c:percent': '10' }, lines), { title: 'Line 3 — % complete', message: 'Percent needs a positive scheduled value — type This period instead.' });

  eq('paste at This period: E then F, one merged patch per line, the past-end row counted',
    g703PastePlan(lines, [['10', '20'], ['30', 'x'], ['40'], ['50']], { rowKey: 'a', colKey: 'thisPeriod' }, { sovEditing: false }),
    { patches: [{ lineId: 'a', patch: { thisPeriod: 10, materialsPresentlyStored: 20 } }, { lineId: 'b', patch: { thisPeriod: 30 } }, { lineId: 'c', patch: { thisPeriod: 40 } }], invalid: 1, extraRows: 1 });
  eq('paste at Stored: a third column has nowhere to land (% and computed are skipped)',
    g703PastePlan(lines, [['5', '6', '7']], { rowKey: 'b', colKey: 'stored' }, { sovEditing: false }),
    { patches: [{ lineId: 'b', patch: { materialsPresentlyStored: 5 } }], invalid: 2, extraRows: 0 });
  eq('paste at Item while editing the SOV: A, B, C, E, F',
    g703PastePlan(lines, [['9', 'Roofing', '5,000', '1,234.567', '']], { rowKey: 'a', colKey: 'itemNo' }, { sovEditing: true }),
    { patches: [{ lineId: 'a', patch: { itemNo: '9', description: 'Roofing', scheduledValue: 5000, thisPeriod: 1234.57, materialsPresentlyStored: 0 } }], invalid: 0, extraRows: 0 });
  eq('paste at Item when NOT editing: only E and F take it (Item/Description/Scheduled are left alone), "Roofing" in F is refused',
    g703PastePlan(lines, [['9', 'Roofing']], { rowKey: 'a', colKey: 'itemNo' }, { sovEditing: false }),
    { patches: [{ lineId: 'a', patch: { thisPeriod: 9 } }], invalid: 1, extraRows: 0 });
  eq('paste at the % column lands nowhere',
    g703PastePlan(lines, [['50']], { rowKey: 'a', colKey: 'percent' }, { sovEditing: false }),
    { patches: [], invalid: 1, extraRows: 0 });

  const longest = (12_345_678.9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length;
  eq('a $12,345,678.90 figure is 13 characters', longest, 13);
  ok('g703MoneyColumnWidth(13) ≥ 128, so it never ellipsizes', g703MoneyColumnWidth(13) >= 128, String(g703MoneyColumnWidth(13)));
  eq('g703MoneyColumnWidth floors at 112 (0 and 10 characters)', [g703MoneyColumnWidth(0), g703MoneyColumnWidth(10)], [112, 112]);
  ok('g703MoneyColumnWidth grows with the figure', g703MoneyColumnWidth(16) > g703MoneyColumnWidth(13));
  eq('g703GridMinWidth: 1088 (1124 with the delete column) at 112', [g703GridMinWidth(112, false), g703GridMinWidth(112, true)], [1088, 1124]);
}

// ── d) the change-order grid ────────────────────────────────────────────────
console.log('\nd) the change-order grid');
type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
const coSrc = read('app/change-order.tsx');
function evalBlock<T>(marker: string, names: string[], prelude = ''): T | null {
  const start = coSrc.indexOf(`// >>> ${marker}`);
  const end = coSrc.indexOf(`// <<< ${marker}`);
  ok(`app/change-order.tsx carries the ${marker} block`, start > -1 && end > start);
  if (!(start > -1 && end > start)) return null;
  const js = new Transpiler({ loader: 'ts' }).transformSync(coSrc.slice(start, end).replace(/^export /gm, ''));
  return new Function(`${prelude}\n${js}\nreturn { ${names.join(', ')} };`)() as T;
}
type CoLine = { id: string; name: string; quantity: number; unitPrice: number; total: number; priceSource?: string; unit?: string };
const W3 = evalBlock<{
  coRoundCents: (n: number) => number;
  coCommitLineItems: <T extends CoLine>(i: T[]) => T[];
  coParseLineDraft: (s: string) => number | null;
  coUnnamedLineBlocker: (i: { name: string }[]) => { title: string; message: string } | null;
  coGridLineTotal: (i: CoLine) => number;
  coGridFooter: (i: CoLine[]) => number;
  coLinesFromPaste: (c: string[][], id: () => string) => (CoLine & { unit: string; isNew: boolean })[];
}>('co-wave3', ['coRoundCents', 'coCommitLineItems', 'coParseLineDraft', 'coUnnamedLineBlocker', 'coGridLineTotal', 'coGridFooter', 'coLinesFromPaste']);
const W4 = evalBlock<{ coPrefillLines: (raw: string | undefined, legacy: { amount?: string; reason?: string; description?: string }, id: () => string) => { name: string }[] | null }>(
  'co-w4', ['coPrefillLines'],
);
if (W3) {
  // persistCO's committedAmount, LIFTED from the screen and executed.
  const persist = /const committedLines = coCommitLineItems\(lineItems\);\s*const committedAmount = coRoundCents\(committedLines\.reduce\(\(sum, i\) => sum \+ i\.total, 0\)\);/.exec(strip(coSrc))?.[0];
  ok('persistCO still commits its amount through coCommitLineItems (the statement the footer must equal)', !!persist);
  const committedAmount = persist
    ? (new Function('coCommitLineItems', 'coRoundCents', 'lineItems', `${persist}\nreturn committedAmount;`) as (a: unknown, b: unknown, c: CoLine[]) => number)
    : null;
  const r = rng(12_345);
  const bad: string[] = [];
  let draftCases = 0;
  for (let n = 0; n < 400; n++) {
    const lines: CoLine[] = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, k) => {
      const quantity = [1, 2, 3, 12.5, 0.75, -1][Math.floor(r() * 6)];
      // A half-typed price the way handleUpdateItemPrice leaves it: the
      // parsed draft ('12.345') on unitPrice, total rounded off THAT.
      const draft = r() < 0.5 ? (Math.round(r() * 100_000) / 1000).toFixed(3) : (Math.round(r() * 10_000) / 100).toFixed(2);
      const unitPrice = W3.coParseLineDraft(draft) ?? 0;
      if (draft.endsWith('5') && draft.split('.')[1]?.length === 3) draftCases++;
      return { id: `i${k}`, name: `L${k}`, quantity, unitPrice, total: W3.coRoundCents(quantity * unitPrice) };
    });
    const want = committedAmount ? committedAmount(W3.coCommitLineItems, W3.coRoundCents, lines) : NaN;
    if (W3.coGridFooter(lines) !== want) bad.push(`set ${n}: grid ${W3.coGridFooter(lines)} vs persistCO ${want}`);
    for (const l of lines) {
      if (W3.coGridLineTotal(l) !== W3.coCommitLineItems([l])[0].total) bad.push(`set ${n}: line total`);
    }
  }
  ok(`coGridFooter === persistCO's committedAmount on 400 random line sets (${draftCases} half-cent drafts)`, bad.length === 0 && draftCases > 0, bad.slice(0, 3).join('; '));
  const twelve = [{ id: 'x', name: 'Trim', quantity: 3, unitPrice: 12.345, total: W3.coRoundCents(3 * 12.345) }];
  eq("a '12.345' price draft × 3: the footer is the saved 37.05, not the typed line's 37.04",
    [W3.coGridFooter(twelve), twelve[0].total], [37.05, 37.04]);

  eq('coUnnamedLineBlocker: every line named → null', W3.coUnnamedLineBlocker([{ name: 'A' }, { name: 'B' }]), null);
  eq('coUnnamedLineBlocker names the first blank line',
    W3.coUnnamedLineBlocker([{ name: 'A' }, { name: '   ' }, { name: '' }]),
    { title: 'Line 2 has no name', message: 'Name every line before saving — it prints on the change order.' });

  let seq = 0;
  const pasted = W3.coLinesFromPaste([
    ['Outlet circuit', '2', 'ea', '$650.50'],
    ['', '3', 'ea', '10'],
    ['Pendant rough-in', '', '', ''],
    ['Credit: shelving', '1', 'ls', '(400)'],
    ['Drywall', '1,200', 'sf', '0'],
  ], () => `p${++seq}`);
  eq('coLinesFromPaste: blank names skipped; qty/unit/price parsed; $0 or blank price → needs_price; a credit is a real price',
    pasted.map((l) => [l.name, l.quantity, l.unit, l.unitPrice, l.total, l.priceSource ?? null, l.isNew]),
    [
      ['Outlet circuit', 2, 'ea', 650.5, 1301, null, true],
      ['Pendant rough-in', 1, 'ea', 0, 0, 'needs_price', true],
      ['Credit: shelving', 1, 'ls', -400, -400, null, true],
      ['Drywall', 1200, 'sf', 0, 0, 'needs_price', true],
    ]);
  eq('coLinesFromPaste: fresh ids from the screen', pasted.map((l) => l.id), ['p1', 'p2', 'p3', 'p4']);
}
if (W4) {
  const r = rng(77);
  const names = ['', ' ', '  \t', 'Outlet', 'Voice line item', 'x'];
  let blank = 0;
  for (let n = 0; n < 300; n++) {
    const arr = Array.from({ length: 1 + Math.floor(r() * 5) }, () => ({ name: names[Math.floor(r() * names.length)], quantity: r() < 0.5 ? 0 : 2, unitPrice: r() < 0.5 ? 0 : 12.5 }));
    const out = W4.coPrefillLines(JSON.stringify(arr), {}, () => 'id') ?? [];
    for (const l of out) if (!l.name.trim()) blank++;
  }
  for (const reason of [undefined, 'out_of_scope']) {
    for (const l of W4.coPrefillLines(undefined, { amount: '500', reason }, () => 'id') ?? []) if (!l.name.trim()) blank++;
  }
  eq('coPrefillLines never yields a blank name (so coUnnamedLineBlocker is inert on the phone)', blank, 0);
}

// ── e) source pins ──────────────────────────────────────────────────────────
console.log('\ne) source pins');
const aia = strip(read('app/aia-pay-app.tsx'));
const aiaRaw = read('app/aia-pay-app.tsx');
const co = strip(coSrc);
const grid = strip(read('components/desktop/LineItemGrid.tsx'));
/** The body of `const name = useCallback(` up to its dependency array. */
function callback(src: string, name: string): string | null {
  const i = src.indexOf(`const ${name} = useCallback(`);
  if (i < 0) return null;
  const rest = src.slice(i);
  const end = rest.search(/\n {2}\}, \[/);
  return end < 0 ? null : rest.slice(0, end);
}
/** The text of the JSX element opened at `start` (to its matching `/>` or close tag). */
function tagSpan(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0 && src.startsWith('/>', i)) return src.slice(start, i + 2);
  }
  return src.slice(start);
}
/** Each formatMoney( … ) call's full argument text. */
function moneyCalls(span: string): string[] {
  const out: string[] = [];
  let at = span.indexOf('formatMoney(');
  while (at >= 0) {
    let depth = 0;
    let i = at + 'formatMoney'.length;
    for (; i < span.length; i++) {
      if (span[i] === '(') depth++;
      else if (span[i] === ')') { depth--; if (depth === 0) break; }
    }
    out.push(span.slice(at, i + 1));
    at = span.indexOf('formatMoney(', i);
  }
  return out;
}
{
  ok('the G703 grid mounts only on desktop web in grid view: const gridOn = isDesktopWeb && sovView === \'grid\'',
    /const gridOn = isDesktopWeb && sovView === 'grid';/.test(aia) && /const isDesktopWeb = useIsDesktopWeb\(\);/.test(aia));
  const gridCalls = [...aia.matchAll(/renderG703Grid\(\)/g)].map((m) => m.index ?? 0);
  const branch = aia.indexOf('{gridOn ? (\n            sovBox.width < gridMin ?');
  const cards = aia.indexOf(') : app.lines.map((line, lineIdx) => {');
  ok('…the grid is rendered only inside the {gridOn ? … : app.lines.map(…)} branch, and the phone cards are its else',
    branch > 0 && cards > branch && gridCalls.length === 2 && gridCalls.every((i) => i > branch && i < cards),
    `branch ${branch}, cards ${cards}, calls ${gridCalls.join(',')}`);
  ok('…and the wide grid scrolls inside its card without hiding the scrollbar',
    /<ScrollView horizontal contentContainerStyle=\{\{ minWidth: gridMin \}\}>/.test(aia) && !/showsHorizontalScrollIndicator=\{false\}[\s\S]{0,80}minWidth: gridMin/.test(aia));
  const gridTag = aia.indexOf('<LineItemGrid<AIASOVLine>');
  const span = gridTag < 0 ? '' : tagSpan(aia, gridTag);
  ok('the G703 grid is read-only exactly when the certificate is: readOnly={isReadOnly}', /readOnly=\{isReadOnly\}/.test(span));
  ok('…and its footer IS the engine (footerTotals from g703Footer, completed: g703Foot.completedAndStored)',
    /const g703Foot = g703Footer\(app\);/.test(aia) && /completed: g703Foot\.completedAndStored/.test(span) && /retainage: g703Foot\.retainage/.test(span));
  for (const h of ['onGridCell', 'onGridBlur', 'onGridAdd', 'onGridDelete', 'onGridPaste']) {
    const body = callback(aiaRaw, h);
    ok(`${h} exists and never calls setApp (every write goes through a guarded mutator)`, !!body && !/\bsetApp\(/.test(body));
  }
  for (const h of ['onGridCell', 'onGridAdd', 'onGridDelete', 'onGridPaste']) {
    const body = callback(aiaRaw, h) ?? '';
    ok(`${h} refuses a read-only certificate first`, /^[^]*?\{\s*if \(isReadOnly/.test(body.slice(body.indexOf('=>'))));
  }
  ok('NO usePrimaryAction on the AIA pay app — Save mints a Stripe pay link and locks the period, so Cmd+S / Cmd+Enter would issue a certificate (contract C10)',
    !/usePrimaryAction\(/.test(aia) && !/useSheetPrimaryHotkey\(/.test(aia));
  const save = callback(aiaRaw, 'handleSave') ?? '';
  const gen = callback(aiaRaw, 'requestGenerate') ?? '';
  ok('handleSave refuses an invalid grid draft before it builds (and mints) anything',
    /g703DraftBlocker\(gridDraftsRef\.current/.test(save) && save.indexOf('g703DraftBlocker') < save.indexOf('buildSavedRecord()') && save.indexOf('if (isReadOnly)') < save.indexOf('g703DraftBlocker'));
  ok('requestGenerate refuses an invalid grid draft before the certify dialog',
    /g703DraftBlocker\(gridDraftsRef\.current/.test(gen) && gen.indexOf('g703DraftBlocker') < gen.indexOf('setShowPreExportConfirm(true)') && gen.indexOf('if (isLocked)') < gen.indexOf('g703DraftBlocker'));

  const kpiAt = aia.indexOf('<KpiStrip');
  const kpi = kpiAt < 0 ? '' : tagSpan(aia, kpiAt);
  const kpiMoney = moneyCalls(kpi);
  ok(`the G702 KPI strip is in cents: all ${kpiMoney.length} formatMoney calls pass 2 decimals`,
    kpiMoney.length === 9 && kpiMoney.every((c) => /, 2\)$/.test(c)), kpiMoney.filter((c) => !/, 2\)$/.test(c)).join(' | '));
  ok('…it is desktop-only: {isDesktop ? (<KpiStrip … ) : null}', /\{isDesktop \? \(\s*<KpiStrip/.test(aia));
  const coverAt = aia.indexOf('Summary (G702 Cover)');
  const coverEnd = aia.indexOf('</View>', aia.indexOf('<Row label="Balance to Finish"', coverAt));
  const cover = coverAt < 0 || coverEnd < 0 ? '' : aia.slice(coverAt, coverEnd);
  const coverMoney = moneyCalls(cover);
  ok(`the G702 summary card prints cents on every platform (founder default 2): ${coverMoney.length} formatMoney calls, all with 2`,
    coverMoney.length === 10 && coverMoney.every((c) => /, 2\)$/.test(c)), coverMoney.filter((c) => !/, 2\)$/.test(c)).join(' | '));
  ok('…and so does the SOV card\'s Scheduled value', /<Text style=\{styles\.sovValueNum\}>\{formatMoney\(line\.scheduledValue, 2\)\}<\/Text>/.test(aia));

  ok('LineItemGrid still renders the phone line cards in a bare fragment',
    /if \(!isDesktop\) \{\s*return \(\s*<>\s*\{props\.rows\.map\(\(row, i\) => \(\s*<React\.Fragment key=\{props\.rowKey\(row\)\}>\{props\.renderCard\(row, i\)\}<\/React\.Fragment>/.test(grid));
  ok('change-order: the grid is desktop-web only, and the phone line cards are the else branch (`) : lineItems.map(`)',
    /const coGridOn = isDesktopWeb && linesView === 'grid';/.test(co) && /\{coGridOn \? \([\s\S]*?<LineItemGrid<ChangeOrderLineItem>[\s\S]*?\) : lineItems\.map\(\(item\) => \(/.test(co));
  ok('change-order: the grid footer is coGridFooter (persistCO\'s committed amount)', /footerTotals=\{\{ total: coGridFooter\(lineItems\) \}\}/.test(co));
  eq('change-order: coUnnamedLineBlocker is chained after coEmptyLineDraftBlocker at all three save / send / CCD refusals',
    (co.match(/coEmptyLineDraftBlocker\(lineDrafts, lineItems\) \?\? coUnnamedLineBlocker\(lineItems\)/g) ?? []).length, 3);
}

// Contract D8 — the two early-access cards say nothing that is not true.
{
  const D8: Record<string, { headline: string; body: string }> = {
    'aia-factoring-cta': {
      headline: 'Advances on certified pay apps',
      body: 'Pay-app money waits with the owner until they certify and release it. We are looking at a factoring partner that could advance part of a certified amount. No partner is signed yet, so there are no rates or timelines to show.',
    },
    'aia-lienwaiver-cta': {
      headline: 'Lien waivers drafted when a pay app is paid',
      body: 'We are working on drafting conditional and unconditional waivers for every sub paid out of a funded pay app. Bank-held escrow would need a partner bank, and none is signed. For now, request and track waivers in Lien waivers.',
    },
  };
  const FOOTER = 'Not available yet — tap to be told when it is';
  const spans = [...aiaRaw.matchAll(/<RevenueEarlyAccessCard\b/g)].map((m) => tagSpan(aiaRaw, m.index ?? 0));
  eq('the AIA pay app renders exactly the two early-access cards', spans.map((s) => /testID="([^"]+)"/.exec(s)?.[1] ?? null).sort(), Object.keys(D8).sort());
  for (const span of spans) {
    const id = /testID="([^"]+)"/.exec(span)?.[1] ?? '?';
    const want = D8[id];
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(span)?.[1] ?? null;
    ok(`${id}: headline, body and footer are contract D8's exact copy`,
      !!want && attr('headline') === want.headline && attr('body') === want.body && attr('footer') === FOOTER,
      `headline ${attr('headline')} | footer ${attr('footer')}`);
    const banned = ['today', 'LOI', '* 0.9', 'Q3 2026', 'early access shipping'].filter((b) => (b === 'today' ? /today/i.test(span) : span.includes(b)));
    eq(`${id}: no "today", LOI, * 0.9, Q3 2026 or "early access shipping"`, banned, []);
    ok(`${id}: no rate, percentage or speed claim`, !/\d\s*%|\bper 30 days\b|\b\d+\s*(hours|seconds|minutes)\b/i.test(span));
    ok(`${id}: keeps its interest capture (eventKey)`, /eventKey="revenue\.(factoring\.altline|lien_waiver\.escrow)"/.test(span));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error(`\n✗ validate-money-grids: ${fail} failure(s)`);
  process.exit(1);
}
console.log('\n✓ validate-money-grids');
