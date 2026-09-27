// scripts/validate-health-moneyreport.ts — health lane MONEYREPORT (2026-09-26).
//
// Four money defects, each pinned by EXECUTING the real code on the repro
// numbers (plus the source wiring a pure test cannot see):
//
//   1. MONEY-CSV-PROGRESS        the QuickBooks/Xero CSV exported a native-editor
//                                progress invoice at FULL line totals (a 30%
//                                bill of $30,000 exported $30,000), taxed item
//                                rows twice, and ignored retainage.
//   2. MONEY-DRAFTS-COUNTED      drafts counted as invoiced/unpaid/billed on the
//                                Owner Confidence card, the weekly snapshot and
//                                the AI project report; the report also summed
//                                every change order (rejected/void included).
//   3. MONEY-CASH-SUB-APPROVED   the cash forecast treated an APPROVED-but-unpaid
//                                sub bill and the retainage withheld from subs as
//                                cash already out (commitments.paid_to_date).
//   4. MONEY-CLIENTVIEW-DUE-NOW  the client view's "Due now" was gross of held
//                                retention while the portal was net.
//
// FAIL-BEFORE: MONEYREPORT_SRC=<dir> points the loader at a tree holding the
// 2859f55b copies of the owned files (with a tsconfig mapping `@/*` back to the
// worktree); every section below must go red there.
//
// Run: bun scripts/validate-health-moneyreport.ts

import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Declared locally: the app tsconfig carries no bun types (same as the other
// validators that register a Bun plugin).
declare const Bun: {
  plugin: (p: { name: string; setup: (build: { module: (spec: string, cb: () => never) => void }) => void }) => void;
};

Bun.plugin({
  name: 'moneyreport-stubs',
  setup(build) {
    const inert = {
      exports: {
        default: {}, Platform: { OS: 'ios' }, supabase: {}, isSupabaseConfigured: false,
        SUPABASE_URL: '', SUPABASE_ANON_KEY: '', deliverTextFile: async () => null,
      },
      loader: 'object',
    } as never;
    for (const s of [
      'react-native', '@/lib/supabase', '@react-native-async-storage/async-storage',
      'expo-sharing', 'expo-file-system/legacy', '@/utils/platformFile',
    ]) build.module(s, () => inert);
  },
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.MONEYREPORT_SRC ?? ROOT;

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n     ${detail}` : ''); }
}
const near = (a: number, b: number, tol = 0.005) => Number.isFinite(a) && Math.abs(a - b) <= tol;

async function load<T = Record<string, unknown>>(rel: string): Promise<T | null> {
  const p = join(SRC, rel);
  if (!existsSync(p)) { ok(`load ${rel}`, false, `missing in ${SRC}`); return null; }
  try { return (await import(p)) as T; } catch (e) { ok(`load ${rel}`, false, String(e)); return null; }
}
function src(rel: string): string {
  const p = join(SRC, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}
function fn<F>(mod: Record<string, unknown> | null, name: string): F | null {
  const f = mod?.[name];
  if (typeof f !== 'function') { ok(`${name} is exported`, false); return null; }
  return f as F;
}

// Shared money helpers are NOT owned by this lane — always the worktree copy.
const billing = await import(join(ROOT, 'utils/invoiceBilling.ts'));
const { progressSubtotal, pendingRetentionHeld, roundCents } = billing;

// ─────────────────────────────────────────────────────────────────────────────
// 1. MONEY-CSV-PROGRESS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. accounting CSV — billed amounts, one tax line, retainage like the QuickBooks push');
{
  const acct = await load('utils/accountingExport.ts');
  const build = fn<(f: 'quickbooks' | 'xero', p: unknown, i: unknown[]) => { csv: string; rowCount: number }>(acct, 'buildAccountingCsv');
  const project = { name: 'Henderson', primaryContact: { name: 'Owner' } };
  // Tiny RFC-4180 reader (quoted cells may hold commas).
  const parse = (csv: string) => csv.split('\n').map(line => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  });
  if (build) {
    // The repro: native-editor progress invoice, 30% of one $30,000 line.
    const lines = [{ id: 'a', name: 'Framing', description: 'Framing', quantity: 1, unitPrice: 30_000, total: 30_000 }];
    const inv = { id: 'i1', number: 7, status: 'sent', type: 'progress', progressPercent: 30, lineItems: lines,
      subtotal: 9_000, taxRate: 0, taxAmount: 0, totalDue: 9_000, issueDate: '2026-09-01', dueDate: '2026-10-01' };
    const billed = roundCents(progressSubtotal(lines, true, 30));
    const qbo = parse(build('quickbooks', project, [inv]).csv).slice(1);
    const qboItems = qbo.filter(r => r[4] !== 'Sales Tax' && r[4] !== 'Retainage Receivable');
    const qboSum = qboItems.reduce((s, r) => s + Number(r[8]), 0);
    ok('QBO: a 30% progress bill of $30,000 exports ItemAmount $9,000 (Σ items === progressSubtotal)', near(qboSum, billed), `got ${qboSum}, billed ${billed}`);
    ok('QBO: Qty × Rate foots to the amount on every item row',
      qboItems.every(r => near(Number(r[6]) * Number(r[7]), Number(r[8]), 0.011)), JSON.stringify(qboItems));
    const xero = parse(build('xero', project, [inv]).csv).slice(1).filter(r => r[4] !== 'Sales Tax');
    const xeroSum = xero.reduce((s, r) => s + Number(r[5]) * Number(r[6]), 0);
    ok('Xero: Quantity × UnitAmount sums to the billed $9,000', near(xeroSum, billed), `got ${xeroSum}`);
    ok('the scaled line says it is a progress line', qboItems[0]?.[5]?.includes('30% progress billing') === true, qboItems[0]?.[5]);

    // A taxed progress invoice, two lines, 15%.
    const lines2 = [
      { id: 'a', name: 'Framing', description: 'Framing', quantity: 3, unitPrice: 10_000, total: 30_000 },
      { id: 'b', name: 'Drywall', description: 'Drywall', quantity: 1, unitPrice: 12_345.67, total: 12_345.67 },
    ];
    const sub2 = roundCents(progressSubtotal(lines2, true, 15));
    const tax2 = roundCents(sub2 * 0.08875);
    const inv2 = { id: 'i2', number: 8, status: 'sent', type: 'progress', progressPercent: 15, lineItems: lines2,
      subtotal: sub2, taxRate: 8.875, taxAmount: tax2, totalDue: roundCents(sub2 + tax2), issueDate: '2026-09-01', dueDate: '2026-10-01' };
    const rows2 = parse(build('quickbooks', project, [inv2]).csv).slice(1);
    const items2 = rows2.filter(r => r[4] !== 'Sales Tax' && r[4] !== 'Retainage Receivable');
    const taxRow = rows2.find(r => r[4] === 'Sales Tax');
    ok('taxed 15% bill: Σ item amounts === progressSubtotal (to the cent)',
      near(items2.reduce((s, r) => s + Number(r[8]), 0), sub2, 0.011), `${items2.map(r => r[8]).join('+')} vs ${sub2}`);
    ok('taxed 15% bill: the tax row === inv.taxAmount', !!taxRow && near(Number(taxRow[8]), tax2), taxRow?.[8]);
    ok('no item row is Taxable "Yes" (tax is its own line — an importer applying TaxRate counted it twice)',
      rows2.every(r => r[9] !== 'Yes'), rows2.map(r => r[9]).join(','));
    ok('…and no item row carries a TaxRate on a taxed invoice', items2.every(r => r[10] === ''), items2.map(r => r[10]).join(','));

    // A plain full invoice, untaxed, no retention: byte-identical to the 2859f55b export.
    const full = { id: 'f1', number: 3, status: 'paid', type: 'full', lineItems: [
      { id: 'x', name: 'Demo', description: 'Demo, haul-off', quantity: 2, unitPrice: 1_250.5, total: 2_501 },
      { id: 'y', name: 'Permit', description: '', quantity: 1, unitPrice: 400, total: 400 },
    ], subtotal: 2_901, taxRate: 0, taxAmount: 0, totalDue: 2_901, issueDate: '2026-08-01', dueDate: '2026-08-31' };
    const FULL_QBO_2859F55B = [
      'InvoiceNo,Customer,InvoiceDate,DueDate,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,ItemAmount,Taxable,TaxRate,ServiceDate,Memo',
      '3,Owner,08/01/2026,08/31/2026,Demo,"Demo, haul-off",2,1250.50,2501.00,No,0,08/01/2026,Invoice #3',
      '3,Owner,08/01/2026,08/31/2026,Permit,,1,400.00,400.00,No,0,08/01/2026,Invoice #3',
    ].join('\n');
    const FULL_XERO_2859F55B = [
      'ContactName,InvoiceNumber,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType,TrackingName1,TrackingOption1',
      'Owner,3,01/08/2026,31/08/2026,"Demo, haul-off",2,1250.50,,,Project,Henderson',
      'Owner,3,01/08/2026,31/08/2026,Permit,1,400.00,,,Project,Henderson',
    ].join('\n');
    ok('a full untaxed invoice exports byte-identical to 2859f55b (QBO)', build('quickbooks', project, [full]).csv === FULL_QBO_2859F55B);
    ok('a full untaxed invoice exports byte-identical to 2859f55b (Xero)', build('xero', project, [full]).csv === FULL_XERO_2859F55B);

    // A Bill-from-Estimate line is already scaled: exported as stored.
    const bfe = { ...inv, id: 'b1', number: 9, lineItems: [{ id: 'e', name: 'Tile', description: 'Tile', quantity: 50, unitPrice: 11.5, total: 575, billedPercent: 50 }],
      subtotal: 575, totalDue: 575 };
    const bfeRow = parse(build('quickbooks', project, [bfe]).csv)[1]!;
    ok('a pre-scaled Bill-from-Estimate line keeps its qty/rate/total (never double-scaled)',
      bfeRow[6] === '50' && bfeRow[7] === '11.50' && bfeRow[8] === '575.00', bfeRow.join(','));

    // Retainage: an explicit negative line for what is still held, as the push does.
    const ret = { id: 'r1', number: 10, status: 'sent', type: 'full', lineItems: [
      { id: 'z', name: 'Roofing', description: 'Roofing', quantity: 1, unitPrice: 20_000, total: 20_000 },
    ], subtotal: 20_000, taxRate: 0, taxAmount: 0, totalDue: 20_000, retentionPercent: 10, retentionAmount: 2_000,
      retentionReleased: 0, amountPaid: 0, issueDate: '2026-09-01', dueDate: '2026-10-01' };
    const held = roundCents(pendingRetentionHeld(ret));
    for (const format of ['quickbooks', 'xero'] as const) {
      const r = parse(build(format, project, [ret]).csv).slice(1);
      const retRow = format === 'quickbooks' ? r.find(x => x[4] === 'Retainage Receivable') : r.find(x => (x[4] ?? '').startsWith('Retainage withheld'));
      const amt = retRow ? (format === 'quickbooks' ? Number(retRow[8]) : Number(retRow[6])) : NaN;
      ok(`${format}: retainage still held exports as a negative line (−$${held})`, near(amt, -held), retRow?.join(','));
      const total = format === 'quickbooks'
        ? r.reduce((s, x) => s + Number(x[8]), 0)
        : r.reduce((s, x) => s + Number(x[5]) * Number(x[6]), 0);
      ok(`${format}: the imported invoice totals what the client can be asked for today (totalDue − held)`, near(total, 20_000 - held), `got ${total}`);
    }
    const guard = parse(build('quickbooks', project, [{ ...ret, lineItems: [{ id: 'g', name: '=HYPERLINK("x")', description: '@cmd', quantity: 1, unitPrice: 1, total: 1 }], retentionPercent: 0, retentionAmount: 0, subtotal: 1, totalDue: 1 }]).csv)[1]!;
    ok('the formula-injection guard still escapes =/@ text cells', guard[4]!.startsWith("'=") && guard[5]!.startsWith("'@"), guard.join(','));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MONEY-DRAFTS-COUNTED
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. drafts are not billed, rejected COs are not contract changes');
const sent10k = { id: 's', projectId: 'p', number: 1, status: 'sent', issueDate: new Date().toISOString(), dueDate: '2026-12-01',
  subtotal: 10_000, taxAmount: 0, totalDue: 10_000, amountPaid: 0, lineItems: [], payments: [] };
const draft5k = { id: 'd', projectId: 'p', number: 2, status: 'draft', issueDate: new Date().toISOString(), dueDate: '2026-12-01',
  subtotal: 5_000, taxAmount: 0, totalDue: 5_000, amountPaid: 1_000, lineItems: [],
  payments: [{ id: 'dp', amount: 1_000, date: new Date().toISOString(), method: 'check' }] };
const recalled = { ...sent10k, id: 'rc', number: 3, totalDue: 7_000, subtotal: 7_000, portalState: { status: 'recalled' } };
const rejectedCO = { id: 'c1', projectId: 'p', number: 1, status: 'rejected', changeAmount: 3_000 };
{
  const oc = await load('utils/ownerConfidence.ts');
  const buildOC = fn<(o: unknown) => { billing: { billed: number; paid: number; approvedChanges: number } }>(oc, 'buildOwnerConfidence');
  if (buildOC) {
    const project = { id: 'p', name: 'Henderson', status: 'in_progress', linkedEstimate: { grandTotal: 50_000, baseTotal: 50_000, items: [] } };
    const r = buildOC({ project, changeOrders: [rejectedCO], invoices: [sent10k, draft5k], nowMs: Date.now() });
    ok('Owner Confidence: Invoiced to date is $10,000, not $15,000 (draft excluded)', r.billing.billed === 10_000, `got ${r.billing.billed}`);
    ok('Owner Confidence: a payment logged on a draft is not "Paid"', r.billing.paid === 0, `got ${r.billing.paid}`);
    ok('Owner Confidence: a rejected CO is not an approved change', r.billing.approvedChanges === 0);
    const r2 = buildOC({ project, changeOrders: [], invoices: [sent10k, draft5k, recalled], nowMs: Date.now() });
    ok('Owner Confidence: a recalled invoice is off the client\'s page, so not invoiced to them', r2.billing.billed === 10_000, `got ${r2.billing.billed}`);
    const cvm = await load('utils/clientViewMoney.ts');
    const figs = fn<(i: unknown) => { invoicedToDate: number }>(cvm, 'clientViewMoneyFigures');
    if (figs) {
      ok('Owner Confidence "Invoiced" === the client-view Budget card "Total Invoiced" (one figure per screen)',
        r2.billing.billed === figs({ invoices: [sent10k, draft5k, recalled], contractValue: 50_000, changeOrders: [] }).invoicedToDate);
    }
  }

  const cvm = await load('utils/clientViewMoney.ts');
  const weekly = fn<(i: unknown[], a: (iso?: string) => boolean, b: (p: { date?: string }) => boolean) => {
    totalIssued: number; totalUnpaid: number; paidThisWindow: number; totalBilled: number; issuedCount: number;
  }>(cvm, 'issuedInvoiceWindowStats');
  if (weekly) {
    const w = weekly([sent10k, draft5k], () => true, () => true);
    ok('weekly snapshot: a draft issued this week is not "issued"', w.totalIssued === 10_000 && w.issuedCount === 1, JSON.stringify(w));
    ok('weekly snapshot: "Unpaid" excludes the $5,000 draft', w.totalUnpaid === 10_000, `got ${w.totalUnpaid}`);
    ok('weekly snapshot: the burn bar bills $10,000, not $15,000', w.totalBilled === 10_000, `got ${w.totalBilled}`);
    ok('weekly snapshot: a payment on a draft is not "paid this window"', w.paidThisWindow === 0, `got ${w.paidThisWindow}`);
  }
  const ws = src('app/weekly-snapshot.tsx');
  ok('weekly-snapshot.tsx reads its invoice sums from issuedInvoiceWindowStats',
    /return issuedInvoiceWindowStats\(invoices, inRange, receivedInWindow\);/.test(ws));
  ok('…and the burn bar uses the non-draft total',
    /const totalBilled = invoiceStats\.totalBilled;/.test(ws) && !/const totalBilled = invoices\.reduce/.test(ws));

  const ai = await load('utils/aiService.ts');
  const figures = fn<(p: unknown, i: unknown[], c: unknown[]) => { totalInvoiced: number; totalPaid: number; approvedCoCount: number; approvedCoTotal: number }>(ai, 'projectReportMoneyFigures');
  if (figures) {
    const f = figures({ id: 'p' }, [sent10k, draft5k, { ...sent10k, id: 'other', projectId: 'q' }], [rejectedCO]);
    ok('AI report: invoiced $10,000 (draft and other job excluded)', f.totalInvoiced === 10_000, JSON.stringify(f));
    ok('AI report: a draft payment is not paid', f.totalPaid === 0);
    ok('AI report: a rejected CO is not "1 totaling 3,000"', f.approvedCoCount === 0 && f.approvedCoTotal === 0, JSON.stringify(f));
    const f2 = figures({ id: 'p' }, [], [rejectedCO, { ...rejectedCO, id: 'c2', status: 'approved', changeAmount: 2_000 },
      { ...rejectedCO, id: 'c3', status: 'draft', changeAmount: 500 }, { ...rejectedCO, id: 'c4', status: 'void', changeAmount: 900 }]);
    ok('AI report: only APPROVED change orders count (1 totaling 2,000)', f2.approvedCoCount === 1 && f2.approvedCoTotal === 2_000, JSON.stringify(f2));
  }
  const aiSrc = src('utils/aiService.ts');
  ok('the report prompt says "Approved change orders" and reads the approved figures',
    /Approved change orders: \$\{approvedCoCount\} totaling \$\{approvedCoTotal\.toLocaleString\(\)\}/.test(aiSrc)
    && !/Change orders: \$\{projCOs\.length\}/.test(aiSrc));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MONEY-CASH-SUB-APPROVED
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. cash forecast — approved-but-unpaid sub bills and sub retainage');
{
  const cf = await load('utils/cashFlowEngine.ts');
  const buildInputs = fn<(a: Record<string, unknown>) => Record<string, any>>(cf, 'buildForecastInputs');
  const fromInputs = fn<(i: unknown, w: number) => { totalExpenses: number; expenseItems: { description: string; amount: number }[]; runningBalance: number }[]>(cf, 'forecastFromInputs');
  const four = fn<(a: Record<string, unknown>) => number | null>(cf, 'fourWeekCashPosition');
  const strip = fn<(e: unknown[]) => unknown[]>(cf, 'stripDerivedExpenses');
  if (buildInputs && fromInputs && four && strip) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    // A job with a live schedule finishing inside the 12-week horizon, so the
    // commitment's remaining balance is dated, not undated.
    const project = { id: 'p1', name: 'Henderson', status: 'in_progress',
      schedule: { startDate: today, totalDurationDays: 30, workingDaysPerWeek: 5, tasks: [] } };
    // Sub bills $40,000 gross with $4,000 retainage; GC approves; no check cut.
    const approved = { id: 'sb1', subPortalId: 'sp', projectId: 'p1', commitmentId: 'c1', invoiceNumber: '101',
      amount: 40_000, retentionAmount: 4_000, status: 'approved', createdAt: now.toISOString() };
    const paidToDate = 40_000; // recompute_commitment_paid_to_date: SUM(amount) over approved+paid
    const c1 = { id: 'c1', projectId: 'p1', number: 'SC-1', type: 'subcontract', status: 'active', amount: 100_000,
      changeAmount: 0, paidToDate, vendorName: 'Miller Bros Framing' };
    const cashData = { startingBalance: 200_000, expenses: [], expectedPayments: [], defaultPaymentTerms: 'net_30' };
    const base = { cashData, invoices: [], commitments: [c1], projects: [project], changeOrders: [], now };

    const withSubs = buildInputs({ ...base, subInvoices: [approved] });
    const weeks = fromInputs(withSubs, 12);
    const out = weeks.reduce((s, w) => s + w.totalExpenses, 0);
    ok('repro: outflow over the horizon = $60,000 remaining + $36,000 approved bill', near(out, 96_000, 0.05), `got ${out}`);
    const wk0Bill = weeks[0]?.expenseItems.find(e => e.description.includes('Approved sub bill'));
    ok('…the $36,000 check (net of retainage) lands in week 0', !!wk0Bill && near(wk0Bill.amount, 36_000), JSON.stringify(wk0Bill));
    ok('…labelled with the sub and the job', !!wk0Bill && wk0Bill.description.includes('Miller Bros Framing') && wk0Bill.description.includes('Henderson'), wk0Bill?.description);
    ok('subRetainagePayable = $4,000 (owed at closeout, undated)', withSubs.subRetainagePayable === 4_000, String(withSubs.subRetainagePayable));
    ok('subBillsChecked is true when the caller read the sub invoices', withSubs.subBillsChecked === true);
    ok('no double count: remaining + bill + retainage === the $100,000 still owed',
      near(out + (withSubs.subRetainagePayable ?? 0), 100_000, 0.05), `${out} + ${withSubs.subRetainagePayable}`);

    const notRead = buildInputs(base);
    const outNR = fromInputs(notRead, 12).reduce((s, w) => s + w.totalExpenses, 0);
    ok('sub invoices not read → subBillsChecked false (never presented as "no sub bills")', notRead.subBillsChecked === false);
    ok('…and subRetainagePayable is null, not $0', notRead.subRetainagePayable === null, String(notRead.subRetainagePayable));
    ok('…and the forecast is the commitment remainder alone ($60,000)', near(outNR, 60_000, 0.05), `got ${outNR}`);

    // Paid bill: no week-0 row, retainage still owed.
    const paidBill = { ...approved, id: 'sb2', status: 'paid' };
    const paidIn = buildInputs({ ...base, subInvoices: [paidBill] });
    const paidWeeks = fromInputs(paidIn, 12);
    ok('a PAID bill adds no week-0 row', !paidWeeks[0]?.expenseItems.some(e => e.description.includes('Approved sub bill')));
    ok('…but its retainage is still owed to the sub ($4,000)', paidIn.subRetainagePayable === 4_000);

    // Submitted / rejected bills: nothing (paid_to_date never counted them).
    const pending = buildInputs({ ...base, subInvoices: [{ ...approved, id: 'sb3', status: 'submitted' }, { ...approved, id: 'sb4', status: 'rejected' }] });
    ok('submitted / rejected bills add nothing', (pending.subBills?.rows?.length ?? -1) === 0 && pending.subRetainagePayable === 0);

    // A bill against a commitment the GC's own typed row claims: his row is the schedule.
    const claimedIn = buildInputs({ ...base, cashData: { ...cashData, expenses: [
      { id: 'mine', name: 'Miller draws', amount: 5_000, frequency: 'weekly', category: 'subcontractor', startDate: now.toISOString(), commitmentId: 'c1' },
    ] }, subInvoices: [approved] });
    ok('a bill on a commitment claimed by a typed row is not added again', (claimedIn.subBills?.rows?.length ?? -1) === 0
      && (claimedIn.subBills?.claimedSkippedIds ?? []).includes('sb1'));

    // A bill with no commitment still owes cash.
    const loose = buildInputs({ ...base, subInvoices: [{ ...approved, id: 'sb5', commitmentId: undefined, retentionAmount: undefined, submittedByName: 'Ace Electric' }] });
    ok('an approved bill with no commitment is still a week-0 check (full amount, no retainage)',
      loose.subBills?.rows?.length === 1 && near(loose.subBills.rows[0].amount, 40_000));

    // A finished job: undated, like buildCommittedOutflows' leftover balance.
    const over = buildInputs({ ...base, projects: [{ ...project, status: 'completed' }], subInvoices: [approved] });
    ok('an approved bill on a FINISHED job is reported undated, never dated to week 0',
      (over.subBills?.rows?.length ?? -1) === 0 && near(over.subBills?.approvedOnFinishedJobs ?? -1, 36_000));

    ok('sub-bill rows are derived and never persisted (stripDerivedExpenses drops them)',
      strip(withSubs.expenses).length === 0);

    const tileArgs = { cashData, setupComplete: true, invoices: [], commitments: [c1], projects: [project], changeOrders: [] };
    const tileWith = four({ ...tileArgs, subInvoices: [approved] });
    const tileWithout = four(tileArgs);
    ok('Summary tile: the $36,000 approved bill lowers the week-4 balance',
      tileWith !== null && tileWithout !== null && near(tileWithout - tileWith, 36_000, 0.05), `${tileWithout} → ${tileWith}`);
  }
  const summary = src('app/(tabs)/summary/index.tsx');
  ok('Summary reads the company-wide sub invoices and shows "—" until they are read',
    /useSubSubmittedInvoices\(\{ companyWide: true \}\)/.test(summary) && /if \(!subInvoices\) return null;/.test(summary)
    && /invoices, commitments, projects, changeOrders, subInvoices,\s*\}\);/.test(summary)
    && /\}, \[cashSettings, invoices, commitments, projects, changeOrders, subInvoices\]\);/.test(summary));
  const screen = src('app/cash-flow.tsx');
  ok('/cash-flow passes the sub invoices and says so when they were not checked',
    /subInvoices: relevantSubInvoices,/.test(screen) && /testID="cash-flow-sub-bills-unchecked"/.test(screen)
    && /testID="cash-flow-sub-retainage"/.test(screen) && /testID="cash-flow-sub-bills-finished-jobs"/.test(screen));
  const hook = src('hooks/useSubSubmittedInvoices.ts');
  ok('the hook offers a company-wide read that reports a failed read as unchecked (never [])',
    /companyWide\?: boolean/.test(hook) && /if \(rows === null\) throw new Error/.test(hook)
    && /const subBillsChecked = !isSupabaseConfigured \|\| query\.isSuccess \|\| query\.isRefetchError;/.test(hook)
    && /export async function fetchCompanySubInvoices\(\): Promise<SubSubmittedInvoice\[\] \| null>/.test(hook));
  // A failed BACKGROUND refetch keeps the last successful list (react-query v5
  // isRefetchError = error status WITH data from an earlier success), so the
  // Summary CASH·4WK tile does not flip to '—' every time a jobsite drops
  // signal; a first read that never succeeded (isLoadingError) stays unchecked.
  ok('a failed refetch keeps the last read list checked; a never-succeeded read does not',
    /query\.isRefetchError/.test(hook) && !/query\.isError\b/.test(hook) && !/query\.data !== undefined/.test(hook));
  ok('the company-wide read polls every 5 min, not every 60 s (Summary is always mounted)',
    /refetchInterval: companyWide \? 300_000 : 60_000,/.test(hook));
  for (const [rel, re] of [
    ['hooks/useMorningBrief.ts', /cashData: settings\.data, invoices, commitments, projects, changeOrders,\s*subInvoices,/],
    ['utils/oneMind/factBlocks.ts', /changeOrders: bundle\.changeOrders,\s*subInvoices,/],
  ] as const) {
    ok(`${rel} feeds the sub invoices into buildForecastInputs`, re.test(src(rel)));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MONEY-CLIENTVIEW-DUE-NOW
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. client view "Due now" — the portal\'s numbers, net of held retention');
{
  const cvm = await load('utils/clientViewMoney.ts');
  const figs = fn<(i: unknown) => Record<string, any>>(cvm, 'clientViewMoneyFigures');
  const shared = fn<(i: unknown) => boolean>(cvm, 'sharedWithClient');
  const snap = await import(join(ROOT, 'utils/portalSnapshot.ts'));
  if (figs && shared) {
    const repro = { id: 'i1', projectId: 'p', number: 1, status: 'partially_paid', subtotal: 10_000, taxAmount: 0, totalDue: 10_000,
      retentionPercent: 10, retentionAmount: 1_000, retentionReleased: 0, amountPaid: 9_000, lineItems: [], payments: [],
      issueDate: '2026-09-01', dueDate: '2026-10-01' };
    const f = figs({ invoices: [repro], contractValue: 25_000, changeOrders: [] });
    ok('repro job: Due now is $0 (was $1,000 on the client view)', f.outstanding === 0, `got ${f.outstanding}`);
    ok('repro job: retention held $1,000', f.retentionHeld === 1_000, `got ${f.retentionHeld}`);
    ok('repro job: paid $9,000', f.paidToDate === 9_000, `got ${f.paidToDate}`);

    // Same job through the real portal snapshot builder: every figure agrees.
    const job = [
      repro,
      { ...repro, id: 'i2', number: 2, status: 'sent', subtotal: 20_000, taxAmount: 1_775, totalDue: 21_775, amountPaid: 5_000, retentionAmount: 2_000 },
      { ...repro, id: 'i3', number: 3, status: 'draft', subtotal: 8_000, totalDue: 8_000, amountPaid: 500, retentionAmount: 800 },
      { ...repro, id: 'i4', number: 4, status: 'sent', subtotal: 3_000, totalDue: 3_000, amountPaid: 1_000, retentionAmount: 300, portalState: { status: 'recalled' } },
    ];
    const cos = [{ id: 'co1', projectId: 'p', number: 1, status: 'approved', changeAmount: 3_400 }, { id: 'co2', projectId: 'p', number: 2, status: 'rejected', changeAmount: 9_999 }];
    const project = { id: 'p', name: 'Henderson', type: 'renovation', status: 'in_progress',
      linkedEstimate: { grandTotal: 44_325, baseTotal: 44_325, items: [] }, contractMode: 'fixed', updatedAt: '2026-09-01T00:00:00.000Z' };
    const portal = { portalId: 'portal-abc', enabled: true, showSchedule: false, showBudgetSummary: true, showInvoices: true,
      showChangeOrders: true, showPhotos: false, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false };
    const budget = snap.buildPortalSnapshot({ project, portal, changeOrders: cos, invoices: job }).sections.budget;
    const mine = figs({ invoices: job, contractValue: 44_325, changeOrders: cos });
    ok('helper === portalSnapshot budget: outstanding', mine.outstanding === budget?.outstanding, `${mine.outstanding} vs ${budget?.outstanding}`);
    ok('helper === portalSnapshot budget: retentionHeld', mine.retentionHeld === budget?.retentionHeld, `${mine.retentionHeld} vs ${budget?.retentionHeld}`);
    ok('helper === portalSnapshot budget: invoicedToDate', mine.invoicedToDate === budget?.invoicedToDate, `${mine.invoicedToDate} vs ${budget?.invoicedToDate}`);
    ok('helper === portalSnapshot budget: paidToDate', mine.paidToDate === budget?.paidToDate, `${mine.paidToDate} vs ${budget?.paidToDate}`);
    ok('helper === portalSnapshot budget: revised contract', mine.revisedContract === budget?.contractValue, `${mine.revisedContract} vs ${budget?.contractValue}`);
    const segSum = (mine.segments as { pct: number }[]).reduce((s, x) => s + x.pct, 0);
    ok('the bar is Paid + Due now + Retention held, and fills to 100%',
      (mine.segments as { key: string }[]).map(x => x.key).join(',') === 'paid,due,retention' && near(segSum, 100, 1e-9)
      && near(mine.barTotal, mine.paidToDate + mine.outstanding + mine.retentionHeld, 0.011));
    ok('no segment mixes in the pre-tax contract (no "remaining" leg)',
      !(mine.segments as { key: string }[]).some(x => /remain/i.test(x.key)));
    for (const st of [undefined, { status: 'sent' }, { status: 'draft' }, { status: 'recalled' }]) {
      ok(`sharedWithClient agrees with portalSnapshot.isShared for ${JSON.stringify(st)}`,
        shared({ portalState: st }) === snap.isShared(st as never));
    }
  }

  // Negative control: the money-outstanding scan must FAIL on a real file
  // carrying the aggregate gross form, and name the rule.
  const tmp = mkdtempSync(join(tmpdir(), 'moneyreport-scan-'));
  try {
    writeFileSync(join(tmp, 'synthetic.tsx'), 'export const due = (invoicedTotal: number, paidTotal: number) => Math.max(0, invoicedTotal - paidTotal);\n');
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts/validate-money-outstanding.ts')], {
      env: { ...process.env, MONEY_OUTSTANDING_EXTRA_SCAN_DIR: tmp }, encoding: 'utf8',
    });
    const outText = `${run.stdout}${run.stderr}`;
    ok('validate-money-outstanding FAILS on a synthetic `invoicedTotal - paidTotal` file (negative control)',
      run.status !== 0 && /synthetic\.tsx:1\s+\[invoiced total - paid total\]/.test(outText), outText.split('\n').filter(l => l.includes('✗') || l.includes('synthetic')).join(' | ').slice(0, 400));
    const clean = spawnSync(process.execPath, [join(ROOT, 'scripts/validate-money-outstanding.ts')], { encoding: 'utf8' });
    ok('…and passes on the tree as it stands', clean.status === 0, `${clean.stdout}`.split('\n').filter(l => l.includes('✗')).join(' | ').slice(0, 400));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\nvalidate-health-moneyreport: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
