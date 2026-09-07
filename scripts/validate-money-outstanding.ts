// scripts/validate-money-outstanding.ts — one definition of "outstanding".
//
// WHY THIS EXISTS. Audit 2026-09-03 MONEY-F5: eighteen surfaces computed an
// invoice's outstanding balance as `totalDue - amountPaid` — GROSS of the
// retention the contract lets the client hold — and tested "paid" as
// `amountPaid >= totalDue`. So a $100,000 invoice holding $10,000 retention,
// paid down to the $90,000 actually asked for, showed "$10,000 outstanding" on
// the A/R aging report, the home strip, the client portal, the PDF, the Stripe
// receipt, the weekly client email and the week-close — and could never reach
// `paid` until retention was released and re-collected.
//
// THE RULE: utils/invoiceBilling.ts owns the arithmetic (netBalanceDue /
// invoiceOutstanding / invoiceIsSettled). Nothing else in the client tree may
// subtract amountPaid from totalDue, or compare amountPaid against totalDue.
//
// Two halves:
//   1. SOURCE SCAN — every .ts/.tsx under app/ components/ utils/ hooks/
//      contexts/ (invoiceBilling.ts excepted, comments stripped) is searched
//      for the gross forms. Any hit not on the dated allow-list fails.
//   2. EXECUTING FIXTURES — the worked numbers from the audit, run against the
//      real helpers, so the shared definition cannot quietly regress either.
//
// Run via: bun run scripts/validate-money-outstanding.ts

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  invoiceOutstanding, invoiceIsSettled, netBalanceDue,
  effectiveRetentionHeld, pendingRetentionHeld,
} from '../utils/invoiceBilling';
import {
  getEffectiveInvoiceStatus, pendingRetentionOf, getRetentionHeld, getOutstandingBalance,
} from '../utils/projectFinancials';
import { pendingRetention } from '../utils/cashFlowEngine';
import { computeARAgingReport } from '../utils/financialReports';
import type { Invoice, Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['app', 'components', 'utils', 'hooks', 'contexts'];
const OWNER = 'utils/invoiceBilling.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n   ${detail}` : ''); }
}

// ── the forbidden shapes ─────────────────────────────────────────────────────
// Each pattern is applied per line AFTER comments are stripped, so a comment
// that explains the bug ("`totalDue - amountPaid` forecast that money…") does
// not trip the guard, but code does.
const GROSS_PATTERNS: { name: string; re: RegExp }[] = [
  // `totalDue - x`, `.totalDue - (`, `totalDue ?? 0) - x`
  { name: 'totalDue minus', re: /\btotalDue\b\s*(?:\|\|\s*0\s*\)|\?\?\s*0\s*\))?\s*-(?![-=>])/ },
  // anything on the line that reads `totalDue … - … amountPaid`
  { name: 'totalDue … - amountPaid', re: /\btotalDue\b[^;\n]{0,80}?-\s*\(?\s*(?:[\w$.]+\.)?amountPaid\b/ },
  // `total - amountPaid` where total was aliased from totalDue one line up
  { name: 'total - amountPaid alias', re: /\btotal\s*-\s*\(?\s*(?:[\w$.]+\.)?amountPaid\b/ },
  // settled / partial tests against the gross figure
  { name: 'amountPaid >= totalDue', re: /\bamountPaid\b[^;\n]{0,60}>=\s*[^;\n]{0,60}\btotalDue\b/ },
  { name: 'totalDue <= amountPaid', re: /\btotalDue\b[^;\n]{0,60}<=\s*[^;\n]{0,60}\bamountPaid\b/ },
  { name: 'amountPaid < totalDue', re: /\bamountPaid\b\s*(?:\?\?\s*0\s*\))?\s*<\s*\(?\s*(?:[\w$.]+\.)?totalDue\b/ },
  { name: '>= totalDue threshold', re: />=\s*\(?\s*(?:[\w$.]+\.)?totalDue\b/ },
  // Review 2026-09-05 — the mirror images the first cut missed: an "is open"
  // test written as `totalDue > amountPaid` (or `>=`), and an overpayment /
  // credit computed as `amountPaid - totalDue`. Both are the gross figure.
  { name: 'totalDue > amountPaid', re: /\btotalDue\b\s*(?:\|\|\s*0\s*\)|\?\?\s*0\s*\))?\s*>=?\s*\(?\s*(?:[\w$.]+\.)?amountPaid\b/ },
  { name: 'amountPaid - totalDue', re: /\bamountPaid\b\s*(?:\|\|\s*0\s*\)|\?\?\s*0\s*\))?\s*-(?![-=>])\s*\(?\s*(?:[\w$.]+\.)?totalDue\b/ },
  // MONEY-05 (runtime audit 2026-09-07) — the STORED-COLUMN retainage basis.
  //
  // MISS-04 fixed the basis the invoice editor computes retainage on, but every
  // shared reader kept deriving the held figure from the stored
  // `retentionAmount` column, which on pre-fix rows is retainage taken on the
  // TAX-INCLUSIVE total. Twelve surfaces wrote this same subtraction by hand, so
  // the founder's Houston invoice #1 read $77,201 on Summary's NEEDS YOU row and
  // $77,484.88 on the invoice screen and the Stripe pay-link row — one invoice,
  // $283.48 apart, and the smaller (wrong) one was what a contractor chasing the
  // money was shown.
  //
  // The held figure now has ONE definition: effectiveRetentionHeld /
  // pendingRetentionHeld in utils/invoiceBilling.ts. Any line that reconstructs
  // it from the stored columns is a reader going back to the column.
  { name: 'stored retention basis', re: /\bretentionAmount\b[^;\n]{0,40}?-(?![-=>])\s*\(?\s*(?:[\w$.]+\.)?retentionReleased\b/ },
  // The gross withholding read straight off the row — `inv.retentionAmount ?? 0`
  // as a dollar figure — without going through the helper.
  { name: 'stored retentionAmount as the withholding', re: /\.retentionAmount\s*\?\?\s*0\b/ },
];

// Sites READ and judged correct. Every entry needs a date, the exact code, and
// a reason a reviewer can check in under a minute. The entry below is the NET
// formula written out by hand (gross − held retention) — right today, but a
// second definition; migrate it to invoiceOutstanding() when the file is next
// touched and delete the entry.
const ALLOW: { file: string; code: string; reason: string; dated: string }[] = [
  // utils/paymentPrediction.ts held the last hand-written copy of the
  // invoiceOutstanding formula. MONEY-05 (2026-09-07) replaced its body with a
  // call to the helper, so the entry is gone rather than re-dated — an
  // allow-list entry that can be deleted is better than one that can be renewed.
  //
  // The three below are PASS-THROUGHS: the stored column travels INTO
  // effectiveRetentionHeld as one of its inputs (where it is the documented
  // fallback), it is not being used as the withholding.
  {
    file: 'app/invoice.tsx',
    code: 'retentionAmount: existingInvoice.retentionAmount ?? 0,',
    reason: 'reminderEligibility input — handed to invoiceOutstanding alongside subtotal + retentionPercent, which take precedence',
    dated: '2026-09-07',
  },
  {
    file: 'utils/billingFlowCore.ts',
    code: 'retentionAmount: input.retentionAmount ?? 0,',
    reason: 'reminderEligibility forwards its whole input to invoiceOutstanding, subtotal + retentionPercent included',
    dated: '2026-09-07',
  },
  {
    file: 'utils/tax1099Export.ts',
    code: 'const held = Math.max(0, inv.retentionAmount ?? 0);',
    reason: 'SubSubmittedInvoice — retainage the GC holds from a SUB. That table stores a dollar amount and carries no retention_percent or subtotal, so there is no work-value basis to recompute from; the stored column is the only figure that exists.',
    dated: '2026-09-07',
  },
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))   // keep line numbers
    .replace(/(^|[^:'"`])\/\/.*$/gm, (_m, lead) => lead);            // `//` to EOL, not `https://`
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
}

console.log('\nmoney outstanding — one definition (MONEY-F5):');

const files: string[] = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

const hits: string[] = [];
for (const abs of files) {
  const rel = relative(ROOT, abs);
  if (rel === OWNER) continue;
  const lines = stripComments(readFileSync(abs, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const { name, re } of GROSS_PATTERNS) {
      if (!re.test(line)) continue;
      const allowed = ALLOW.find(a => a.file === rel && line.includes(a.code));
      if (allowed) continue;
      hits.push(`${rel}:${i + 1}  [${name}]  ${line.trim().slice(0, 140)}`);
      break;
    }
  });
}

ok(`scanned ${files.length} source files under ${SCAN_DIRS.join(', ')}`, files.length > 100);
ok('no gross `totalDue - amountPaid` / `amountPaid >= totalDue` outside utils/invoiceBilling.ts',
  hits.length === 0,
  hits.length ? `${hits.length} site(s) — replace with invoiceOutstanding(inv) / invoiceIsSettled(inv):\n   ` + hits.join('\n   ') : '');
ok('the owner file still exports both helpers',
  /export function invoiceOutstanding\(/.test(readFileSync(join(ROOT, OWNER), 'utf8')) &&
  /export function invoiceIsSettled\(/.test(readFileSync(join(ROOT, OWNER), 'utf8')));
ok('every allow-list entry is dated and still present', ALLOW.every(a =>
  /^\d{4}-\d{2}-\d{2}$/.test(a.dated) && readFileSync(join(ROOT, a.file), 'utf8').includes(a.code)));

// ── executing fixtures — the audit's worked invoice ──────────────────────────
// Invoice #7: subtotal $93,023.26 + tax $6,976.74 = totalDue $100,000, 10%
// retention $10,000 held. The client pays the $90,000 they were asked for.
const paidWhatWasAsked = { totalDue: 100_000, retentionAmount: 10_000, amountPaid: 90_000 };
ok('paid-to-retention: outstanding is $0, not $10,000', invoiceOutstanding(paidWhatWasAsked) === 0,
  `got ${invoiceOutstanding(paidWhatWasAsked)}`);
ok('paid-to-retention: the invoice IS settled', invoiceIsSettled(paidWhatWasAsked) === true);

// Before any payment: $90,000 is owed today, and the invoice is open.
const unpaid = { totalDue: 100_000, retentionAmount: 10_000, amountPaid: 0 };
ok('unpaid: outstanding is the retention-net $90,000', invoiceOutstanding(unpaid) === 90_000,
  `got ${invoiceOutstanding(unpaid)}`);
ok('unpaid: not settled', invoiceIsSettled(unpaid) === false);

// Release retention (MONEY-F7: released = now collectible). The $10,000 flows
// back into what the client owes, and the invoice reopens until it is paid.
const released = { ...paidWhatWasAsked, retentionReleased: 10_000 };
ok('released retention becomes outstanding again ($10,000)', invoiceOutstanding(released) === 10_000,
  `got ${invoiceOutstanding(released)}`);
ok('released-and-unpaid retention keeps the invoice open', invoiceIsSettled(released) === false);
ok('…and paying it settles the invoice', invoiceIsSettled({ ...released, amountPaid: 100_000 }) === true);

// Code-health test #9: gross 10,000, retention 1,000, paid 9,000 → 0, never negative.
ok('gross 10,000 / retention 1,000 / paid 9,000 → 0', netBalanceDue({ totalDue: 10_000, retentionAmount: 1_000, amountPaid: 9_000 }) === 0);
ok('overpaid never goes negative', invoiceOutstanding({ totalDue: 1_000, amountPaid: 2_000 }) === 0);
ok('no retention: outstanding is the plain balance', invoiceOutstanding({ totalDue: 5_000, amountPaid: 1_500 }) === 3_500);
ok('a $0 invoice is settled (nothing collectible)', invoiceIsSettled({ totalDue: 0, amountPaid: 0 }) === true);
ok('half-a-cent rounding on split payments still settles',
  invoiceIsSettled({ totalDue: 100, amountPaid: 99.995 }) === true);
ok('invoiceOutstanding and netBalanceDue are the same number',
  invoiceOutstanding({ totalDue: 4_321.5, retentionAmount: 432.15, amountPaid: 1_000 }) ===
  netBalanceDue({ totalDue: 4_321.5, retentionAmount: 432.15, amountPaid: 1_000 }));

// ── MONEY-05 · ONE held figure, so ONE outstanding ──────────────────────────
// The founder's live row, byte for byte (Houston Phone Booth Ad, invoice #1).
// Its stored retention_amount is 5% of the TAX-INCLUSIVE total; the defensible
// withholding is 5% of the $75,595 of work. Before the fix the invoice screen
// and the Stripe pay-link row said $77,484.88 while Summary's NEEDS YOU row,
// the A/R aging, cash flow, the portal and the webhook all said $77,201.39.
const HOUSTON = {
  subtotal: 75_595,
  taxAmount: 5_669.625,
  totalDue: 81_264.625,
  retentionPercent: 5,
  retentionAmount: 4_063.2312500000003, // what production actually stores
  retentionReleased: 0,
  amountPaid: 0,
};
ok('Houston #1 — held is 5% of the WORK value, not of the taxed total',
  effectiveRetentionHeld(HOUSTON) === 3_779.75, `got ${effectiveRetentionHeld(HOUSTON)}`);
ok('…and pendingRetentionHeld agrees (nothing released)',
  pendingRetentionHeld(HOUSTON) === 3_779.75, `got ${pendingRetentionHeld(HOUSTON)}`);
ok('Houston #1 — outstanding is $77,484.88 on every reader',
  invoiceOutstanding(HOUSTON) === 77_484.88, `got ${invoiceOutstanding(HOUSTON)}`);
ok('…which is NOT the stored-column figure the old readers reported',
  invoiceOutstanding(HOUSTON) !== 77_201.39375 && invoiceOutstanding(HOUSTON) !== 77_201.39,
  `got ${invoiceOutstanding(HOUSTON)}`);
ok('…and the two halves foot: held + outstanding === totalDue',
  Math.abs(pendingRetentionHeld(HOUSTON) + invoiceOutstanding(HOUSTON) - 81_264.63) <= 0.01,
  `${pendingRetentionHeld(HOUSTON)} + ${invoiceOutstanding(HOUSTON)}`);
ok('…and it is not settled at zero paid', invoiceIsSettled(HOUSTON) === false);
ok('…paying exactly the $77,484.88 asked for settles it',
  invoiceIsSettled({ ...HOUSTON, amountPaid: 77_484.88 }) === true);
ok('…paying the OLD $77,201.39 does NOT settle it (that is the under-collection)',
  invoiceIsSettled({ ...HOUSTON, amountPaid: 77_201.39 }) === false);

// The whole point of the guard above: a reader that goes back to the stored
// column reports a DIFFERENT number. Pin the gap so the regression is loud.
const storedBasisOutstanding =
  81_264.625 - Math.max(0, 4_063.2312500000003 - 0) - 0;
ok('the stored column and the work basis really do disagree by $283.48',
  Math.abs((storedBasisOutstanding - invoiceOutstanding(HOUSTON)) + 283.48) <= 0.01,
  `stored ${storedBasisOutstanding} vs correct ${invoiceOutstanding(HOUSTON)}`);

// Every surface that reports "held" must report the SAME held figure. These call
// the REAL readers, not re-implementations, so a reader routed back to the
// stored column fails here rather than in a contractor's account.
{
  const houstonInvoice = {
    id: 'houston', number: 1, projectId: 'phone-booth', type: 'progress',
    issueDate: '2026-08-01T12:00:00.000Z', dueDate: '2026-08-31T12:00:00.000Z',
    paymentTerms: 'net_30', notes: '', lineItems: [], taxRate: 7.5,
    status: 'sent', payments: [], createdAt: '2026-08-01', updatedAt: '2026-08-01',
    ...HOUSTON,
  } as unknown as Invoice;
  const houstonProject = { id: 'phone-booth', name: 'Houston Phone Booth Ad' } as unknown as Project;

  const aging = computeARAgingReport([houstonInvoice], [houstonProject]);
  const agingRow = aging.rows.find(r => r.invoiceId === 'houston');

  const surfaces: [string, number][] = [
    ['utils/invoiceBilling.pendingRetentionHeld', pendingRetentionHeld(houstonInvoice)],
    ['utils/projectFinancials.pendingRetentionOf', pendingRetentionOf(houstonInvoice)],
    ['utils/projectFinancials.getRetentionHeld', getRetentionHeld([houstonInvoice])],
    ['utils/cashFlowEngine.pendingRetention', pendingRetention([houstonInvoice])],
    ['utils/financialReports A/R aging row', agingRow?.retainageHeld ?? -1],
    ['utils/financialReports A/R aging totals', aging.totals.retainageHeld],
  ];
  for (const [name, got] of surfaces) {
    ok(`${name} holds $3,779.75`, Math.abs(got - 3_779.75) <= 0.005, `got ${got}`);
  }

  const owed: [string, number][] = [
    ['utils/invoiceBilling.invoiceOutstanding', invoiceOutstanding(houstonInvoice)],
    ['utils/projectFinancials.getOutstandingBalance', getOutstandingBalance([houstonInvoice])],
    ['utils/financialReports A/R aging row', agingRow?.outstanding ?? -1],
    ['utils/financialReports A/R aging totals', aging.totals.totalOutstanding],
  ];
  for (const [name, got] of owed) {
    ok(`${name} asks for $77,484.88`, Math.abs(got - 77_484.88) <= 0.005, `got ${got}`);
  }
}

// A row the app has no percentage for keeps its stored amount: there is nothing
// to recompute from, and inventing 0 would raise the bill by the whole figure.
ok('no retentionPercent → the stored column still stands',
  effectiveRetentionHeld({ subtotal: 10_000, retentionAmount: 500 }) === 500);
ok('retentionPercent 0 with a stored amount → the stored column still stands',
  effectiveRetentionHeld({ subtotal: 10_000, retentionPercent: 0, retentionAmount: 500 }) === 500);
ok('no subtotal → the stored column still stands',
  effectiveRetentionHeld({ retentionPercent: 5, retentionAmount: 500 }) === 500);
ok('a NaN subtotal falls back rather than poisoning the balance',
  effectiveRetentionHeld({ subtotal: NaN, retentionPercent: 5, retentionAmount: 500 }) === 500);
ok('nothing at all → nothing held', effectiveRetentionHeld({}) === 0);
ok('a credit-memo subtotal withholds nothing',
  effectiveRetentionHeld({ subtotal: -5_000, retentionPercent: 5 }) === 0);

// retentionReleased nets off the EFFECTIVE figure, not the stored one — and a
// GC who released against the old (larger) basis has released everything.
ok('a release against the OLD basis leaves nothing held, never a negative',
  pendingRetentionHeld({ ...HOUSTON, retentionReleased: 4_063.23 }) === 0);
ok('…and the client then owes the whole $81,264.63',
  invoiceOutstanding({ ...HOUSTON, retentionReleased: 4_063.23 }) === 81_264.63,
  `got ${invoiceOutstanding({ ...HOUSTON, retentionReleased: 4_063.23 })}`);
ok('a partial release nets off the work-basis figure',
  pendingRetentionHeld({ ...HOUSTON, retentionReleased: 1_000 }) === 2_779.75);

// ── the effective status must not trust a stored 'paid' over the money ──────
// Review of B3a (2026-09-05): the $100,000 invoice was settled at $90,000 with
// $10,000 held; the GC released the $10,000. The row still said 'paid', and
// getEffectiveInvoiceStatus short-circuited on it — so cash-flow, the portal
// and the invoice screen all treated the released money as collected.
const DAY = 86_400_000;
const invoiceRow = (over: Partial<Invoice>): Invoice => ({
  id: 'i', number: 7, projectId: 'p', type: 'progress', issueDate: new Date(Date.now() - 60 * DAY).toISOString(),
  dueDate: new Date(Date.now() - 30 * DAY).toISOString(), paymentTerms: 'net_30', notes: '', lineItems: [],
  subtotal: 0, taxRate: 0, taxAmount: 0, totalDue: 0, amountPaid: 0, status: 'sent', payments: [],
  createdAt: '', updatedAt: '', ...over,
});
const releasedOnPaid = invoiceRow({ status: 'paid', totalDue: 100_000, retentionAmount: 10_000, retentionReleased: 10_000, amountPaid: 90_000 });
ok('stored paid + released-and-unpaid retention is NOT paid', getEffectiveInvoiceStatus(releasedOnPaid) !== 'paid',
  `got ${getEffectiveInvoiceStatus(releasedOnPaid)}`);
ok('…it reads partially_paid (money was received, balance is open)', getEffectiveInvoiceStatus(releasedOnPaid) === 'partially_paid',
  `got ${getEffectiveInvoiceStatus(releasedOnPaid)}`);
ok('stored paid with nothing collectible stays paid',
  getEffectiveInvoiceStatus(invoiceRow({ status: 'paid', totalDue: 100_000, retentionAmount: 10_000, amountPaid: 90_000 })) === 'paid');
ok('stored paid with NOTHING paid and a past due date heals to overdue',
  getEffectiveInvoiceStatus(invoiceRow({ status: 'paid', totalDue: 5_000, amountPaid: 0 })) === 'overdue');
ok('stored paid with nothing paid and a future due date heals to sent',
  getEffectiveInvoiceStatus(invoiceRow({ status: 'paid', totalDue: 5_000, amountPaid: 0, dueDate: new Date(Date.now() + 10 * DAY).toISOString() })) === 'sent');
ok('a stored sent that is settled net of retention reads paid',
  getEffectiveInvoiceStatus(invoiceRow({ status: 'sent', totalDue: 100_000, retentionAmount: 10_000, amountPaid: 90_000 })) === 'paid');
ok('…and paying the released retention settles it again',
  getEffectiveInvoiceStatus(invoiceRow({ status: 'partially_paid', totalDue: 100_000, retentionAmount: 10_000, retentionReleased: 10_000, amountPaid: 100_000 })) === 'paid');

console.log(`\nvalidate-money-outstanding: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
