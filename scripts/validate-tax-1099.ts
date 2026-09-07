// scripts/validate-tax-1099.ts — the 1099-NEC export reports the right year,
// the right threshold, and cash actually paid.
//
// Audit 2026-09-03 MONEY-F4 (worked example):
//   • 2026 export: a sub paid $1,500 was flagged "1099 Required: Yes". Under
//     P.L. 119-21 §70433 (IRC §6041(a) as amended) the threshold for payments
//     made after 12/31/2025 is $2,000 — so NOT required.
//   • A $10,000 sub invoice with $1,000 retainage held, marked paid in Dec
//     2026, showed "Total Paid $10,000.00" — cash actually paid was $9,000.
//   • A check cut 12/30/2026 (paid_on) but logged 1/3/2027 (paid_at) was
//     reported in 2027; the year is decided by paid_on.
//
// Run via: bun run scripts/validate-tax-1099.ts

import {
  buildTax1099Dataset, tax1099DatasetToCsv, thresholdForYear, thresholdInfoForYear, cashPaidOf, paymentDateOf,
  THRESHOLD_PROVISIONAL_NOTE,
} from '../utils/tax1099Export';
import type { Subcontractor, SubSubmittedInvoice } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}

const sub = (id: string, over: Partial<Subcontractor> = {}): Subcontractor => ({
  id, companyName: `Sub ${id}`, legalName: `Sub ${id} LLC`, contactName: 'Pat', taxIdLast4: '1234',
  address: '1 Main St', w9OnFile: true, ...over,
} as Subcontractor);

const inv = (over: Partial<SubSubmittedInvoice>): SubSubmittedInvoice => ({
  id: over.id ?? 'x', subPortalId: 'sp', subcontractorId: 's1', invoiceNumber: '1',
  amount: 0, status: 'paid', createdAt: '2026-06-01T12:00:00.000Z', ...over,
} as SubSubmittedInvoice);

const build = (year: number, invoices: SubSubmittedInvoice[], subs = [sub('s1')]) =>
  buildTax1099Dataset({ year, subcontractors: subs, commitments: [], subSubmittedInvoices: invoices });

console.log('\n1099-NEC export (MONEY-F4):');

// ── threshold by year ────────────────────────────────────────────────────────
ok('2025 threshold is $600', thresholdForYear(2025) === 600);
ok('2026 threshold is $2,000 (P.L. 119-21 §70433)', thresholdForYear(2026) === 2000);
ok('2027 keeps the $2,000 floor until the indexed figure is confirmed', thresholdForYear(2027) === 2000);
// Review 2026-09-05 (A2): the floor for 2027+ is PROVISIONAL and must say so
// wherever the Y/N is read — the row, the CSV column, and the screen copy.
ok('2026 threshold is not provisional', thresholdInfoForYear(2026).provisional === false);
ok('2027 threshold is the $2,000 floor flagged provisional',
  thresholdInfoForYear(2027).amount === 2000 && thresholdInfoForYear(2027).provisional === true);
ok('2030 is still provisional (the flag does not expire on its own)', thresholdInfoForYear(2030).provisional === true);
{
  const rows2027 = build(2027, [inv({ id: 'a', amount: 2_500, paidOn: '2027-04-10' })]);
  ok('2027 rows carry thresholdProvisional', rows2027[0].thresholdProvisional === true && rows2027[0].threshold === 2000);
  ok('…and still flag $2,500 as required against the floor', rows2027[0].required1099 === true);
  const csv2027 = tax1099DatasetToCsv(rows2027);
  const thresholdCol = csv2027.split('\n')[1].split('","').find(c => c.includes('2000.00')) ?? csv2027.split('\n')[1];
  ok('2027 CSV "Threshold Applied" carries the provisional disclosure',
    csv2027.includes(`(provisional: ${THRESHOLD_PROVISIONAL_NOTE})`), thresholdCol);
  ok('…naming the $2,000 floor and the CPA', /\$2,000 floor applied; confirm with your CPA/.test(csv2027));
  const rows2026 = build(2026, [inv({ id: 'a', amount: 2_500, paidOn: '2026-04-10' })]);
  ok('2026 rows are not provisional and the CSV says nothing of the kind',
    rows2026[0].thresholdProvisional === false && !tax1099DatasetToCsv(rows2026).includes('provisional'));
}
{
  const screen = readFileSync(join(ROOT, 'app', 'tax-1099-export.tsx'), 'utf8');
  ok('the screen renders the provisional note from the shared constant',
    /thresholdInfo\.provisional/.test(screen) && /THRESHOLD_PROVISIONAL_NOTE/.test(screen) && /threshold-provisional-note/.test(screen));
  // Comments stripped: the header comment legitimately names thresholdForYear.
  const screenCode = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  ok('the screen derives the threshold from thresholdInfoForYear, not the bare number',
    /thresholdInfoForYear\(year\)/.test(screenCode) && !/thresholdForYear\(/.test(screenCode));
}

{
  const rows = build(2026, [inv({ id: 'a', amount: 1500, paidOn: '2026-05-10' })]);
  ok('2026: a sub paid $1,500 is NOT 1099-required', rows[0].required1099 === false, JSON.stringify(rows[0]));
  ok('…the row still discloses the $1,500', rows[0].totalPaid === 1500);
  ok('…and the note names the $2,000 threshold and the statute',
    /Below \$2,000/.test(rows[0].notes) && /119-21/.test(rows[0].notes), rows[0].notes);
  ok('…the row carries the threshold it applied', rows[0].threshold === 2000);
}
{
  const rows = build(2025, [inv({ id: 'a', amount: 1500, paidOn: '2025-05-10' })]);
  ok('2025: the same $1,500 IS 1099-required (old $600 threshold)', rows[0].required1099 === true);
}
{
  const rows = build(2026, [inv({ id: 'a', amount: 2000, paidOn: '2026-05-10' })]);
  ok('2026: exactly $2,000 is required (at-or-above)', rows[0].required1099 === true);
}

// ── net of retention held ────────────────────────────────────────────────────
{
  const rows = build(2026, [inv({ id: 'a', amount: 10_000, retentionAmount: 1_000, paidOn: '2026-12-15' })]);
  ok('$10,000 invoice with $1,000 retainage held → Total Paid $9,000', rows[0].totalPaid === 9_000, `got ${rows[0].totalPaid}`);
  // Review 2026-09-05 (A3): a release is cash on ITS OWN date. The defensive
  // `retentionReleased` add-back this function used to carry would have
  // attributed a March release to the original invoice's December year the
  // day such a column appeared — so the field is ignored outright.
  const withRelease = { amount: 10_000, retentionAmount: 1_000, retentionReleased: 1_000 } as Parameters<typeof cashPaidOf>[0];
  ok('cashPaidOf ignores a retentionReleased field (a release is its own dated payment, never an add-back)',
    cashPaidOf(withRelease) === 9_000, `got ${cashPaidOf(withRelease)}`);
  const decInvoice = inv({ id: 'dec', amount: 10_000, retentionAmount: 1_000, paidOn: '2026-12-15' });
  const releasedLater = { ...decInvoice, retentionReleased: 1_000 } as SubSubmittedInvoice;
  ok('…so a release recorded the following March cannot inflate the December year', build(2026, [releasedLater])[0].totalPaid === 9_000);
  ok('cashPaidOf never goes negative', cashPaidOf({ amount: 500, retentionAmount: 900 }) === 0);
}

// ── the year is decided by paid_on ───────────────────────────────────────────
{
  const check = inv({ id: 'chk', amount: 5_000, paidOn: '2026-12-30', paidAt: '2027-01-03T15:00:00.000Z', reviewedAt: '2026-12-20T10:00:00.000Z' });
  ok('paymentDateOf prefers paidOn', paymentDateOf(check) === '2026-12-30');
  ok('check cut 12/30/2026, logged 1/3/2027 → reported in 2026', build(2026, [check])[0].totalPaid === 5_000);
  ok('…and NOT in 2027', build(2027, [check])[0].totalPaid === 0);
  const logged = inv({ id: 'log', amount: 700, paidAt: '2026-03-03T15:00:00.000Z', reviewedAt: '2025-12-29T10:00:00.000Z' });
  ok('without paidOn, paidAt decides (not reviewedAt)', build(2026, [logged])[0].totalPaid === 700 && build(2025, [logged])[0].totalPaid === 0);
  const approvedOnly = inv({ id: 'app', amount: 300, reviewedAt: '2026-08-01T10:00:00.000Z' });
  ok('without paidOn/paidAt, reviewedAt decides', build(2026, [approvedOnly])[0].totalPaid === 300);
}

// ── status + roster + CSV ────────────────────────────────────────────────────
{
  const rows = build(2026, [
    inv({ id: 'a', amount: 3_000, paidOn: '2026-02-01' }),
    inv({ id: 'b', amount: 3_000, paidOn: '2026-02-01', status: 'approved' }),   // not paid → excluded
    inv({ id: 'c', amount: 3_000, paidOn: '2026-02-01', subcontractorId: 's2' }),
  ], [sub('s1'), sub('s2', { taxIdLast4: '' }), sub('s3')]);
  ok('only paid invoices count', rows.find(r => r.subcontractorId === 's1')?.totalPaid === 3_000);
  ok('a sub with no payments is still on the roster', rows.some(r => r.subcontractorId === 's3' && r.totalPaid === 0));
  ok('a required sub with no TIN is flagged', /TIN missing/.test(rows.find(r => r.subcontractorId === 's2')?.notes ?? ''));
  const csv = tax1099DatasetToCsv(rows);
  ok('CSV header states the total is net of retention and carries the threshold column',
    csv.split('\n')[0].includes('Total Paid (net of retention held)') && csv.split('\n')[0].includes('Threshold Applied'));
  ok('CSV rows carry the 2,000.00 threshold', csv.split('\n').slice(1).every(l => l.includes('2000.00')));
}

console.log(`\nvalidate-tax-1099: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
