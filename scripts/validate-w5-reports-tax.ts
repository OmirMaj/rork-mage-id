// scripts/validate-w5-reports-tax.ts — the 1099-NEC export after audit wave 5
// (2026-09-22): card payments are not 1099-NEC money (#100), a sub deleted from
// the roster still gets his row (#17), a failed portal read is not an empty
// year (#101), and each row's coverage sentence describes that row (#105).
//
// Run via: bun run scripts/validate-w5-reports-tax.ts

import {
  buildTax1099Dataset, tax1099DatasetToCsv, COVERAGE_NOTE, COVERAGE_NOTE_WITH_RECORDED_BILLS,
  DELETED_SUB_NOTE,
} from '../utils/tax1099Export';
import type { Subcontractor, SubSubmittedInvoice, Commitment } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const csvCells = (line: string): string[] => {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

const sub = (id: string, over: Partial<Subcontractor> = {}): Subcontractor => ({
  id, companyName: `Sub ${id}`, legalName: `Sub ${id} LLC`, contactName: 'Pat', taxIdLast4: '1234',
  address: '1 Main St', w9OnFile: true, ...over,
} as Subcontractor);
const inv = (over: Partial<SubSubmittedInvoice>): SubSubmittedInvoice => ({
  id: over.id ?? 'x', subPortalId: 'sp', subcontractorId: 's1', invoiceNumber: '1',
  amount: 0, status: 'paid', createdAt: '2026-06-01T12:00:00.000Z', ...over,
} as SubSubmittedInvoice);
const build = (invoices: SubSubmittedInvoice[], subs = [sub('s1')], commitments: Commitment[] = []) =>
  buildTax1099Dataset({ year: 2026, subcontractors: subs, commitments, subSubmittedInvoices: invoices, gcRecordedPayments: [] });

// ── #100 — card payments go on the processor's 1099-K ────────────────────────
console.log('\n#100 card-paid invoices are disclosed, not counted:');
{
  const card = build([inv({ id: 'c', amount: 3_000, paidOn: '2026-04-01', paymentMethod: 'card' })]);
  ok('a $3,000 card-paid 2026 invoice → Total Paid $0', card[0].totalPaid === 0, JSON.stringify(card[0]));
  ok('…1099 Required: No', card[0].required1099 === false);
  ok('…payment count 0', card[0].paymentCount === 0);
  ok('…cardPaid $3,000', card[0].cardPaid === 3_000, String(card[0].cardPaid));
  ok('…with the 1099-K note', /\$3,000 paid by card — reported by the card processor on Form 1099-K, excluded from this 1099-NEC total/.test(card[0].notes), card[0].notes);
  const check = build([inv({ id: 'k', amount: 3_000, paidOn: '2026-04-01', paymentMethod: 'check' })]);
  ok('the same $3,000 paid by CHECK is counted and required', check[0].totalPaid === 3_000 && check[0].required1099 === true);
  const upper = build([inv({ id: 'u', amount: 3_000, paidOn: '2026-04-01', paymentMethod: ' Card ' })]);
  ok('the method is matched case- and space-insensitively', upper[0].cardPaid === 3_000 && upper[0].totalPaid === 0);
  const mixed = build([
    inv({ id: 'a', amount: 3_000, paidOn: '2026-04-01', paymentMethod: 'check' }),
    inv({ id: 'b', amount: 5_000, retentionAmount: 500, paidOn: '2026-05-01', paymentMethod: 'card' }),
  ]);
  ok('card money is net of retention, like counted money', mixed[0].cardPaid === 4_500 && mixed[0].totalPaid === 3_000, JSON.stringify(mixed[0]));
  const legacy = build([inv({ id: 'l', amount: 2_500, paidOn: '2026-04-01' })]);
  ok('a null / legacy method stays counted (an unreconciled row is not evidence of a card)',
    legacy[0].totalPaid === 2_500 && legacy[0].required1099 === true && legacy[0].cardPaid === 0);
  const other = build([inv({ id: 'o', amount: 2_500, paidOn: '2026-04-01', paymentMethod: 'other' })]);
  ok("'other' stays counted", other[0].totalPaid === 2_500 && other[0].required1099 === true);
  ok("…with a CPA note about PayPal / Venmo and Form 1099-K",
    /1 invoice recorded as "other" — counted above\. If paid through PayPal, Venmo or another payment app, the processor reports it on Form 1099-K/.test(other[0].notes), other[0].notes);
  const csv = tax1099DatasetToCsv(mixed);
  const header = csvCells(csv.split('\n')[0]);
  ok('the CSV APPENDS a card column last — every existing position unchanged',
    header.length === 13 && header[12] === 'Paid by card (Form 1099-K, NOT counted)'
    && header[0] === 'Sub ID' && header[10] === 'Commitment Paid To Date (undated — NOT counted)'
    && header[11] === 'Of which: bills you recorded (document date basis)', JSON.stringify(header));
  ok('…and the value lands in it', csvCells(csv.split('\n')[1])[12] === '4500.00', csv.split('\n')[1]);
  ok('…with the counted total beside it unchanged', csvCells(csv.split('\n')[1])[4] === '3000.00');
  ok('both coverage sentences say card payments are shown separately (Form 1099-K)',
    /card/.test(COVERAGE_NOTE) && /1099-K/.test(COVERAGE_NOTE)
    && /card/.test(COVERAGE_NOTE_WITH_RECORDED_BILLS) && /1099-K/.test(COVERAGE_NOTE_WITH_RECORDED_BILLS));
  ok('…and neither holds a semicolon (the screen splits notes on "; ")',
    !COVERAGE_NOTE.includes(';') && !COVERAGE_NOTE_WITH_RECORDED_BILLS.includes(';'));
}

// ── #17 — a sub deleted from the roster keeps his 1099 row ───────────────────
console.log('\n#17 a deleted sub still gets a row:');
{
  const rows = build([
    inv({ id: 'a', subcontractorId: 'dead-sub-uuid-1234', amount: 9_000, paidOn: '2026-03-01', submittedByName: 'Old Name' }),
    inv({ id: 'b', subcontractorId: 'dead-sub-uuid-1234', amount: 6_000, paidOn: '2026-11-01', submittedByName: 'Framing Bros' }),
  ], [sub('s1')]);
  const orphan = rows.find(r => r.subcontractorId === 'dead-sub-uuid-1234');
  ok('the paid-but-deleted sub has a row', !!orphan, JSON.stringify(rows.map(r => r.subcontractorId)));
  ok('…with his full $15,000', orphan?.totalPaid === 15_000, String(orphan?.totalPaid));
  ok('…flagged 1099 Required: Yes', orphan?.required1099 === true);
  ok('…named from the NEWEST invoice he submitted, marked deleted',
    orphan?.recipientName === 'Framing Bros (deleted from your Subs list)', orphan?.recipientName);
  ok('…with no TIN, no address and no W-9 claimed', orphan?.tinLast4 === '' && orphan?.address === '' && orphan?.w9OnFile === false);
  ok('…and the deletion note', orphan?.notes.split('; ').join('; ').includes(DELETED_SUB_NOTE) ?? false, orphan?.notes);
  ok('…plus the TIN / address gaps a required row carries',
    /TIN missing/.test(orphan?.notes ?? '') && /Address missing/.test(orphan?.notes ?? ''));
  ok('orphan rows are sorted with the rest, by amount (built before the sort)', rows[0].subcontractorId === 'dead-sub-uuid-1234');
  ok('…and reach the CSV', tax1099DatasetToCsv(rows).includes('Framing Bros (deleted from your Subs list)'));

  const nameless = build([inv({ id: 'n', subcontractorId: 'abcdef12-3456', amount: 700, paidOn: '2026-03-01' })], []);
  ok('with no submitter name the row reads "Deleted sub (<id8>)"', nameless[0]?.recipientName === 'Deleted sub (abcdef12)', nameless[0]?.recipientName);
  const cardOnly = build([inv({ id: 'k', subcontractorId: 'gone', amount: 700, paidOn: '2026-03-01', paymentMethod: 'card' })], []);
  ok('a deleted sub paid only by card still appears (disclosed card money)', cardOnly[0]?.cardPaid === 700 && cardOnly[0]?.totalPaid === 0);
  const undated = build([], [], [{ id: 'c1', projectId: 'p1', subcontractorId: 'gone2', paidToDate: 4_000, status: 'active', type: 'subcontract' } as unknown as Commitment]);
  ok('a deleted sub carrying only undated commitment money appears too', undated[0]?.subcontractorId === 'gone2' && undated[0]?.uncountedCommitmentPaid === 4_000);
  const rostered = build([inv({ id: 'r', amount: 2_500, paidOn: '2026-03-01' })], [sub('s1')]);
  ok('a rostered sub gets exactly one row, never an orphan twin', rostered.filter(r => r.subcontractorId === 's1').length === 1 && rostered.length === 1);
  const priorYear = build([inv({ id: 'p', subcontractorId: 'gone3', amount: 2_500, paidOn: '2025-03-01' })], []);
  ok('a deleted sub with nothing in THIS year gets no row', priorYear.length === 0, JSON.stringify(priorYear));
}

// ── #105 — the row's coverage sentence matches the row ───────────────────────
console.log('\n#105 per-row coverage sentence:');
{
  const rows = buildTax1099Dataset({
    year: 2026, subcontractors: [sub('s1'), sub('s2')], commitments: [], subSubmittedInvoices: [],
    gcRecordedPayments: [{ subcontractorId: 's1', amount: 5_000, date: '2026-05-01' }],
  });
  const s1 = rows.find(r => r.subcontractorId === 's1')!;
  const s2 = rows.find(r => r.subcontractorId === 's2')!;
  ok('a row counting recorded bills carries the wide sentence', s1.notes.split('; ').includes(COVERAGE_NOTE_WITH_RECORDED_BILLS), s1.notes);
  ok('…and not the narrow one', !s1.notes.split('; ').includes(COVERAGE_NOTE));
  ok('a row without recorded bills keeps the narrow one', s2.notes.split('; ').includes(COVERAGE_NOTE) && !s2.notes.includes(COVERAGE_NOTE_WITH_RECORDED_BILLS));
}

// ── #101 — the screen: a failed read is not an empty year ────────────────────
console.log('\n#101 the screen refuses to export a portal-less total:');
{
  const src = readFileSync(join(ROOT, 'app', 'tax-1099-export.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the select reads payment_method, submitted_by_name and submitted_by_email',
    /\.select\('[^']*payment_method[^']*'\)/.test(code) && /\.select\('[^']*submitted_by_name[^']*'\)/.test(code)
    && /\.select\('[^']*submitted_by_email[^']*'\)/.test(code));
  ok('…and maps them onto the invoice',
    /paymentMethod: \(r\.payment_method as string \| null\) \?\? undefined/.test(code)
    && /submittedByName: \(r\.submitted_by_name as string \| null\) \?\? undefined/.test(code));
  const catchAt = code.indexOf("console.warn('[1099 export] sub invoice fetch failed', err);");
  const catchBody = catchAt < 0 ? '' : code.slice(catchAt, code.indexOf('} finally {', catchAt));
  ok('the catch records a load error', /setLoadError\(message\)/.test(catchBody), catchBody);
  ok('the dev path (!isSupabaseConfigured) still reads as an empty, error-free list',
    /if \(!isSupabaseConfigured\) \{\s*setSubInvoices\(\[\]\);\s*return;\s*\}/.test(code));
  ok('Export is disabled while the read has failed, and says why',
    /const exportBlockedReason = loadError\s*\?/.test(code)
    && /disabled=\{generating \|\| !!exportBlockedReason\}/.test(code)
    && /testID="tax-1099-export-blocked"/.test(code));
  ok('…the handler refuses too (belt to the disabled state)',
    /if \(exportBlockedReason\) \{ showAlert\('Export not ready', exportBlockedReason\); return; \}/.test(code));
  ok('a warning card with Retry replaces the summary tiles',
    /loadError \? \(\s*<View style=\{styles\.errorCard\} testID="tax-1099-load-error">/.test(code)
    && /onPress=\{\(\) => \{ void loadSubInvoices\(\); \}\}/.test(code));
  ok('rows say "Sub-portal payments not loaded" instead of "No sub-portal payments this year"',
    /loadError \? 'Sub-portal payments not loaded' : 'No sub-portal payments this year'/.test(code));
  ok("…and the engine's 'nothing this year' note is dropped from the row while unloaded",
    /notesForScreen\(r\.notes, !loadError\)/.test(code));
  ok('card money is shown on the row', /testID=\{`card-paid-\$\{r\.subcontractorId\}`\}/.test(code));
  ok('a failed read retries when the screen regains focus', /useFocusEffect\(useCallback\(\(\) => \{\s*if \(loadErrorRef\.current\) void loadSubInvoices\(\);/.test(code));
  ok('the year total is to the cent', /\{cents\(totals\.totalPaid\)\}/.test(code) && !/maximumFractionDigits: 0/.test(code));
}

console.log(`\nvalidate-w5-reports-tax: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
