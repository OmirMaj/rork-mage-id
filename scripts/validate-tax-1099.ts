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
  THRESHOLD_PROVISIONAL_NOTE, COVERAGE_NOTE, COVERAGE_NOTE_WITH_RECORDED_BILLS, coverageNoteFor,
  gcRecordedSubPaymentsFromReceipts,
  type GcRecordedSubPayment,
} from '../utils/tax1099Export';
import type { Subcontractor, SubSubmittedInvoice, Commitment, MaterialReceipt } from '../types';
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

const build = (year: number, invoices: SubSubmittedInvoice[], subs = [sub('s1')], commitments: Commitment[] = [],
  gcRecordedPayments: GcRecordedSubPayment[] = []) =>
  buildTax1099Dataset({ year, subcontractors: subs, commitments, subSubmittedInvoices: invoices, gcRecordedPayments });

/** A signed sub with a server-maintained paidToDate rollup — no payment dates. */
const commitment = (id: string, subcontractorId: string, paidToDate: number): Commitment => ({
  id, projectId: 'p1', number: 'SC-1', type: 'subcontract', subcontractorId,
  description: 'Framing', amount: paidToDate, paidToDate, status: 'active',
  signedDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as unknown as Commitment);

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
  // MONEY-1099-COV-1 widened this header cell to name its source; the
  // net-of-retention and Threshold Applied disclosures both still ride on it.
  ok('CSV header states the total is net of retention and carries the threshold column',
    csv.split('\n')[0].includes('net of retention held') && csv.split('\n')[0].includes('Threshold Applied'));
  ok('CSV rows carry the 2,000.00 threshold', csv.split('\n').slice(1).every(l => l.includes('2000.00')));
}

// ── the export states what it does NOT cover (MONEY-1099-COV-1) ─────────────
// Audit 2026-09-07 #28: the only payment source is the sub portal, and there
// is no INSERT path for a sub_submitted_invoice in the GC app. A GC who pays
// by check got eleven names reading "No payments this year" and under-filed.
// The penalty is per form, so until commitment-level payment entry exists the
// copy has to say what it is speaking for.

console.log('\ncoverage is stated, not implied (MONEY-1099-COV-1):');
{
  const rows = build(2026, []);
  ok('a sub with nothing in the portal is not told "no payments this year"',
    !/No payments this year/.test(rows[0].notes), rows[0].notes);
  ok('…it names the source it is speaking for, and the year',
    /No sub-portal payments recorded in 2026/.test(rows[0].notes), rows[0].notes);
  ok('…and the row carries the coverage disclosure', rows[0].notes.includes(COVERAGE_NOTE), rows[0].notes);
  ok('the disclosure names the payment kinds it misses',
    /checks?/i.test(COVERAGE_NOTE) && /ACH/i.test(COVERAGE_NOTE) && /cash/i.test(COVERAGE_NOTE), COVERAGE_NOTE);

  // On EVERY row, not only the empty ones: an understated "Yes" misstates the
  // form just as surely as a wrong "No".
  const paidRows = build(2026, [inv({ id: 'a', amount: 9_000, paidOn: '2026-03-01' })]);
  ok('a sub who IS over the threshold gets the same disclosure',
    paidRows[0].required1099 === true && paidRows[0].notes.includes(COVERAGE_NOTE), paidRows[0].notes);
}
{
  // The one thing the app does know about check payments: the commitment
  // rollup. It has no dates, so it is disclosed — never counted, never
  // allowed to flip the Y/N.
  const rows = build(2026, [], [sub('s1')], [commitment('c1', 's1', 42_000), commitment('c2', 's1', 8_000)]);
  ok('commitment paidToDate is surfaced as undated money', rows[0].uncountedCommitmentPaid === 50_000,
    String(rows[0].uncountedCommitmentPaid));
  ok('…and is NOT added to Total Paid', rows[0].totalPaid === 0, String(rows[0].totalPaid));
  ok('…and does NOT flip 1099 Required (undated money has no tax year)', rows[0].required1099 === false);
  ok('…and the note tells the CPA where to look',
    /Commitments record \$50,000 paid to date with no payment dates/.test(rows[0].notes), rows[0].notes);
  ok('another sub’s commitment does not land on this row',
    build(2026, [], [sub('s1'), sub('s2')], [commitment('c1', 's2', 9_000)])
      .find(r => r.subcontractorId === 's1')?.uncountedCommitmentPaid === 0);
  ok('a commitment with no subcontractorId is skipped, not attributed to someone',
    build(2026, [], [sub('s1')], [{ ...commitment('c9', 's1', 5_000), subcontractorId: undefined } as Commitment])[0]
      .uncountedCommitmentPaid === 0);
}
{
  const rows = build(2026, [inv({ id: 'a', amount: 3_000, paidOn: '2026-02-01' })], [sub('s1')], [commitment('c1', 's1', 12_500)]);
  const csv = tax1099DatasetToCsv(rows);
  const header = csv.split('\n')[0];
  // THE HEADER DESCRIBES THE DATA, NOT THE FEATURE (audit 2026-09-11, review
  // round 2). MONEY-1099-GC-1 CAN widen the population this column sums, but
  // only for a caller that passes `gcRecordedPayments`. This export did not,
  // so the header must still say "sub-portal invoices" — the first cut renamed
  // it unconditionally and told a CPA, in writing, that the column counted
  // bills the screen never fetched. The widened header is asserted separately
  // below, against a dataset that actually contains them.
  // The Total Paid header cell contains a comma and is therefore QUOTED, so a
  // bare split(',') shreds it — parse the row the way a CSV reader would.
  const cells = (line: string): string[] =>
    (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
      .map(c => c.replace(/,$/, ''))
      .filter((_, i, a) => i < a.length - 1 || a[i] !== '')
      .map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
  const headerCells = cells(header);
  ok('the CSV Total Paid header names the ONE source this export actually summed',
    headerCells[4] === 'Total Paid (sub-portal invoices, net of retention held)', header);
  ok('…and the undated commitment money gets its own column, after the original nine',
    headerCells[10] === 'Commitment Paid To Date (undated — NOT counted)', header);
  ok('…and the GC-recorded slice is APPENDED after it, disturbing no position',
    headerCells[11] === 'Of which: bills you recorded (document date basis)', header);
  ok('…with the existing nine columns still in their original positions',
    header.split(',').slice(0, 4).join(',') === 'Sub ID,Recipient Name,TIN (last 4),Address'
    && header.split('","').length > 1 || header.startsWith('Sub ID,Recipient Name,TIN (last 4),Address,'), header);
  ok('…and the value lands in that column',
    csv.split('\n')[1].trimEnd().split(',').slice(-2)[0] === '12500.00', csv.split('\n')[1]);
  ok('the coverage sentence reaches the CSV', csv.includes(COVERAGE_NOTE));
}

// ── MONEY-1099-GC-1: the sub paid by CHECK ───────────────────────────────────
//
// The residential norm: the framer texts a photo of an invoice and gets a
// check. There is no sub_submitted_invoices row, and `Commitment.paidToDate` is
// written only by the trigger on that table, so it is $0 too. Before this fix
// the export printed "1099 Required: No" for a sub the GC paid $30,000.
console.log('\na sub paid by check (MONEY-1099-GC-1):');
{
  const receipt = (over: Partial<MaterialReceipt>): MaterialReceipt => ({
    id: 'r1', projectId: 'p1', vendor: 'Northline Electric', lines: [],
    subtotal: 0, total: 0, status: 'reviewed',
    createdAt: '2026-06-01T12:00:00.000Z', updatedAt: '2026-06-01T12:00:00.000Z',
    ...over,
  } as MaterialReceipt);
  const subcontract = commitment('c1', 's1', 0);
  const po = { ...commitment('c2', 's1', 0), id: 'c2', type: 'purchase_order' } as Commitment;

  const bills = gcRecordedSubPaymentsFromReceipts(
    [
      receipt({ id: 'r1', commitmentId: 'c1', total: 18_000, receiptDate: '2026-03-14' }),
      receipt({ id: 'r2', commitmentId: 'c1', total: 12_000, receiptDate: '2026-09-02' }),
      // A PURCHASE ORDER is a supplier, not a 1099-NEC recipient.
      receipt({ id: 'r3', commitmentId: 'c2', total: 9_000, receiptDate: '2026-04-01' }),
      // Unlinked: material, not a sub payment.
      receipt({ id: 'r4', total: 5_000, receiptDate: '2026-04-01' }),
      // Different year.
      receipt({ id: 'r5', commitmentId: 'c1', total: 7_000, receiptDate: '2025-12-30' }),
    ],
    [subcontract, po],
  );
  ok('only subcontract-linked receipts become sub payments', bills.length === 3, JSON.stringify(bills));
  ok('…and a purchase order does not', !bills.some(b => b.amount === 9_000));
  ok('…and an unlinked receipt does not', !bills.some(b => b.amount === 5_000));

  const before = build(2026, [], [sub('s1')], [subcontract]);
  ok('BEFORE: a check-paid sub reports $0', before[0].totalPaid === 0, String(before[0].totalPaid));
  ok('BEFORE: …and the Y/N column says No', before[0].required1099 === false);

  const after = build(2026, [], [sub('s1')], [subcontract], bills);
  ok('AFTER: the two 2026 bills are counted', after[0].totalPaid === 30_000, String(after[0].totalPaid));
  ok('AFTER: …the 2025 bill is not', !after.some(r => r.totalPaid === 37_000));
  ok('AFTER: …and the Y/N column now says Yes', after[0].required1099 === true);
  ok('…the basis is broken out rather than blended away', after[0].gcRecordedPaid === 30_000);
  ok('…and the row says the tax year came from the DOCUMENT date',
    /DATE ON THE DOCUMENT/.test(after[0].notes), after[0].notes);
  ok('…and it reaches the CSV in its own column',
    tax1099DatasetToCsv(after).split('\n')[1].trimEnd().endsWith('30000.00'),
    tax1099DatasetToCsv(after).split('\n')[1]);

  // Retention held on a GC-recorded bill is not money the sub received.
  const held = build(2026, [], [sub('s1')], [subcontract],
    [{ subcontractorId: 's1', amount: 10_000, retentionHeld: 1_000, date: '2026-05-01' }]);
  ok('retention held on a GC-recorded bill is netted off, like a portal invoice',
    held[0].totalPaid === 9_000, String(held[0].totalPaid));

  // An omitted argument must reproduce the old behaviour EXACTLY.
  const omitted = buildTax1099Dataset({
    year: 2026, subcontractors: [sub('s1')], commitments: [subcontract],
    subSubmittedInvoices: [inv({ id: 'a', amount: 3_000, paidOn: '2026-02-01' })],
  });
  ok('omitting gcRecordedPayments reproduces the portal-only figure',
    omitted[0].totalPaid === 3_000 && omitted[0].gcRecordedPaid === 0, JSON.stringify(omitted[0]));

  // ── EVERY STRING MUST BE TRUE OF THE RUN THAT PRODUCED IT ──────────────
  //
  // The first cut of MONEY-1099-GC-1 rewrote COVERAGE_NOTE, the CSV header and
  // the "nothing this year" note to describe GC-recorded bills as counted —
  // while app/tax-1099-export.tsx, the screen a CPA opens, was deliberately
  // left unwired. The live export then asserted in writing that it counted
  // bills recorded against a subcontract AND printed "no bills recorded
  // against a subcontract either" for a sub who had them. On a deliverable
  // with an IRS deadline that is worse than the narrow sentence it replaced.
  //
  // So the wording is derived from the DATA, and both worlds are pinned here.
  // `build` above always passes an array, so use the raw builder to model a
  // caller that has not been widened — which is every screen today.
  const noBills = buildTax1099Dataset({
    year: 2026, subcontractors: [sub('s1')], commitments: [subcontract], subSubmittedInvoices: [],
  });
  ok('an export built WITHOUT recorded bills does not claim to have looked for them',
    /No sub-portal payments recorded in 2026$/.test(noBills[0].notes)
    || noBills[0].notes.split('; ').includes('No sub-portal payments recorded in 2026'),
    noBills[0].notes);
  ok('…and its coverage sentence is the narrow one', coverageNoteFor(noBills) === COVERAGE_NOTE);
  ok('…and COVERAGE_NOTE itself still describes only portal invoices',
    /^Counts sub-portal invoices marked paid —/.test(COVERAGE_NOTE), COVERAGE_NOTE);

  const withBillsButNone = buildTax1099Dataset({
    year: 2026, subcontractors: [sub('s1')], commitments: [subcontract],
    subSubmittedInvoices: [], gcRecordedPayments: [],
  });
  ok('an export that DID look and found none says so',
    withBillsButNone[0].notes.split('; ')
      .includes('No sub-portal payments recorded in 2026, and no bills recorded against a subcontract either'),
    withBillsButNone[0].notes);

  ok('the widened coverage sentence appears only where bills were actually counted',
    coverageNoteFor(after) === COVERAGE_NOTE_WITH_RECORDED_BILLS
    && /bills you recorded against a subcontract/.test(COVERAGE_NOTE_WITH_RECORDED_BILLS));
  const widened = tax1099DatasetToCsv(after).split('\n')[0];
  ok('…and so does the widened CSV column heading',
    widened.includes('Total Paid (portal invoices + bills you recorded, net of retention held)'), widened);
  const narrow = tax1099DatasetToCsv(noBills).split('\n')[0];
  ok('…while an export with none keeps the heading it always had',
    narrow.includes('Total Paid (sub-portal invoices, net of retention held)'), narrow);

  // ── THE SCREEN. UNCONDITIONALLY. ──────────────────────────────────────
  //
  // This block used to be `const wired = /gcRecordedPayments/.test(screen)`
  // followed by a ternary that asserted one thing when wired and its opposite
  // when not. It passed in BOTH worlds by construction — a consistency check
  // dressed as a coverage check — while the whole engine above it sat
  // unreachable from the only screen a user can open, and the shipped export
  // still returned $0 for every check-paid sub. A guard that cannot fail for
  // the defect it is named after certifies the defect.
  //
  // Source-level, because bun cannot import a .tsx.
  const screenSrc = readFileSync(join(ROOT, 'app/tax-1099-export.tsx'), 'utf8');
  const screen = screenSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the 1099 screen PASSES gc-recorded bills to the engine',
    /gcRecordedPayments:\s*gcRecordedSubPaymentsFromReceipts\(/.test(screen),
    'app/tax-1099-export.tsx called buildTax1099Dataset without gcRecordedPayments, so the '
    + 'blocker carve-out was written and never reached: $0 and "1099 Required: No" for every '
    + 'check-paid sub');
  ok('…from the material receipts it actually holds, not an empty literal',
    /useMaterialReceipts\(\)/.test(screen)
    && /gcRecordedSubPaymentsFromReceipts\(receipts, commitments\)/.test(screen),
    screen.match(/gcRecordedSubPaymentsFromReceipts\([^)]*\)/)?.[0] ?? 'no call found');
  ok('…and renders the coverage sentence DERIVED from the rows, never a bare constant',
    /testID="coverage-note">\{coverageNoteFor\(rows\)\}/.test(screen),
    'the screen must render coverageNoteFor(rows) so the sentence and the numbers agree');
  ok('…and the receipts it passes are a dependency of the memo that builds the rows',
    /\}, \[year, subcontractors, commitments, subInvoices, receipts\]\);/.test(screen),
    'a stale memo would show yesterday\u2019s dataset after a bill is recorded');

  // AND THE CALL MUST BE REACHED, NOT MERELY PRESENT (close-out pass
  // 2026-09-11). Every assertion above greps for the call. A grep cannot see a
  // guard clause added ABOVE it — the exact blindness that let a blocker
  // survive two review layers elsewhere in this campaign — so the wiring can be
  // present in a memo that returns before reaching it. Pin the preamble
  // instead: between the memo's first line and the call there is exactly ONE
  // return, and it is the documented "portal invoices still loading" bail.
  const rowsMemo = screen.indexOf('const rows: Tax1099Row[] = useMemo(');
  // Anchored at the `return`, so the call's OWN return is not counted as a bail.
  const datasetCall = screen.indexOf('return buildTax1099Dataset({', rowsMemo);
  const rowsPreamble = rowsMemo >= 0 && datasetCall > rowsMemo ? screen.slice(rowsMemo, datasetCall) : '';
  const rowsReturns = rowsPreamble.match(/\breturn\b/g) ?? [];
  ok('…and nothing returns ahead of that call but the documented loading bail',
    rowsPreamble !== '' && rowsReturns.length === 1 && /if \(!subInvoices\) return \[\];/.test(rowsPreamble),
    'a tier gate, a role gate or a second bail in front of buildTax1099Dataset would leave every '
    + `assertion above green on a screen that never calls it — preamble returns: ${rowsReturns.length}, `
    + `text: ${JSON.stringify(rowsPreamble.trim())}`);

  // Now that the screen IS wired, rendered copy elsewhere may reference the
  // 1099 — but only because the export actually produces it. This assertion
  // exists so the pairing stays true if the wiring is ever pulled.
  const receiptCopy = readFileSync(join(ROOT, 'app/material-receipt.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('…and no other screen promises a 1099 outcome the export does not produce',
    /gcRecordedPayments:/.test(screen) || !/1099/.test(receiptCopy),
    'app/material-receipt.tsx claimed a linked sub bill "lands in the 1099 export"');
}

console.log(`\nvalidate-tax-1099: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
