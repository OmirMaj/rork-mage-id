#!/usr/bin/env bun
// scripts/validate-w4-integration-money-portal.ts
//
// Audit wave 4 · integration fix round 1, lens money-portal. Each guard below
// runs the shipped code (or lifts it from the file and runs it) and was
// mutation-tested against the real pre-fix code.
//
//  A. #67 — the sealed contract PDF says HOW the homeowner signed. A paper
//     signature is never drawn in the cursive e-signature font, is dated to
//     the calendar day on the page (no time-zone shift), and the seal line does
//     not call it "electronically signed".
//  B. A refused payment append is the screen's alone: no Not-saved ledger line
//     (whose Retry would append the check a second time), no second toast.
//  C. stripe-webhook's refund / dispute ledger writes are a compare-and-swap on
//     updated_at: a payment appended between the read and the write survives.
//  D. qbo-sync / qbo-reconciler ledger stamps: the same rule.
//  E. project-detail hands the lite writer the AIA list only under the
//     provider's AIA freshness gate.
//  F. portalLanguages carries the page's contract words in every locale.
//  G. migration 06: a contentPending block never says needsSignature, and
//     portal_sign_contract refuses terms that were never published (the
//     behaviour is executed in PGlite; these pin the text the page relies on).
//
// Run: bun run scripts/validate-w4-integration-money-portal.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)}` : ''}`); }
}

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const BunG = (globalThis as unknown as { Bun?: { plugin: (p: { name: string; setup: (b: BunPluginBuilder) => void }) => void; Transpiler: TranspilerCtor } }).Bun;
if (!BunG) { console.error('must run under bun'); process.exit(1); }
const transpile = (src: string) => new BunG.Transpiler({ loader: 'ts' }).transformSync(src);

// A paper day at noon UTC is the NEXT calendar day at UTC+14: a formatter that
// re-zones the instant prints the wrong day here.
process.env.TZ = 'Pacific/Kiritimati';

let printedHtml = '';
BunG.plugin({
  name: 'w4-int-money-portal-stubs',
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

// ── A. the sealed contract PDF ──────────────────────────────────────────────
console.log('\nA. #67 — the sealed contract says how the homeowner signed');
{
  const pdf = await import('../utils/pdfGenerator');
  ok('precondition: this run is at UTC+14 (noon UTC is the next local day)', new Date('2026-09-10T12:00:00.000Z').getDate() === 11);
  const project = { id: 'p1', name: 'Henderson Kitchen', address: '1 Main St', description: 'Kitchen', status: 'active', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' };
  const branding = { companyName: 'Smith Builders' };
  const gcSignature = { name: 'Sam Smith', role: 'gc', signedAt: '2026-09-09T15:00:00.000Z', signaturePaths: ['M0 0 L10 10'] };
  const contractWith = (homeownerSignature: Record<string, unknown> | undefined) => ({
    id: 'c1', projectId: 'p1', userId: 'u1', version: 1, title: 'Kitchen Agreement', contractValue: 48000,
    scopeText: 'Kitchen remodel', termsText: 'Net 10', warrantyText: 'One year', paymentSchedule: [], allowances: [],
    gcSignature, homeownerSignature, status: 'signed', signedAt: '2026-09-10T12:00:00.000Z', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T12:00:00Z',
  });
  const render = async (sig: Record<string, unknown> | undefined) => {
    printedHtml = '';
    await pdf.generateContractPDFUri(contractWith(sig) as never, project as never, branding as never);
    return printedHtml;
  };
  const homeownerBlock = (html: string) => {
    const a = html.indexOf('>Homeowner<');
    return a > -1 ? html.slice(a, html.indexOf('</div>\n    </div>', a) + 20) : '';
  };

  const paper = await render({ name: 'Pat Paper', role: 'homeowner', method: 'paper', signedAt: '2026-09-10T12:00:00.000Z', evidencePath: 'u1/c1/page.jpg' });
  const pBlock = homeownerBlock(paper);
  ok('the contract renders', paper.length > 0 && pBlock.length > 0);
  ok('paper: the method line says paper, with the page photo on file', pBlock.includes('Signed on paper — photo of the signed page on file'), pBlock);
  ok('paper: the name is NOT drawn in the cursive e-signature font', !/Caveat/.test(pBlock), pBlock);
  ok('paper: dated to the calendar day on the page (September 10), never re-zoned', pBlock.includes('September 10, 2026') && !pBlock.includes('September 11'), pBlock);
  ok('paper: the seal line does not call it electronically signed',
    !/electronically signed/.test(paper) && /signed a printed copy on paper/.test(paper));
  ok('paper: the evidence path (a private bucket path) is not printed', !paper.includes('u1/c1/page.jpg'));

  const noPhoto = homeownerBlock(await render({ name: 'Pat Paper', role: 'homeowner', method: 'paper', signedAt: '2026-09-10T12:00:00.000Z' }));
  ok('paper with no photo on record never claims one', noPhoto.includes('no photo of the signed page on file') && !noPhoto.includes('— photo of the signed page on file'), noPhoto.slice(0, 900));

  const inPerson = await render({ name: 'Ina Person', role: 'homeowner', method: 'in_person', signedAt: '2026-09-10T18:30:00.000Z', signaturePaths: ['M1 1 L5 5'] });
  ok('in person: the method line says so', homeownerBlock(inPerson).includes('Signed in person on the contractor'), homeownerBlock(inPerson));
  ok('in person: still an electronic signature on the seal line', /electronically signed/.test(inPerson));

  const portal = await render({ name: 'Portia Portal', role: 'homeowner', method: 'portal', signedAt: '2026-09-10T18:30:00.000Z' });
  ok('portal: typed name in the signature font + "Signed in the client portal"',
    /Caveat[^>]*>Portia Portal</.test(homeownerBlock(portal)) && homeownerBlock(portal).includes('Signed in the client portal'), homeownerBlock(portal));

  const legacy = await render({ name: 'Leo Legacy', role: 'homeowner', signedAt: '2026-09-10T18:30:00.000Z' });
  ok('a legacy signature with no method prints no method line (nothing guessed)', !/data-sig-method/.test(legacy));

  // Wave-4 final fix: the PDF's milestone Amount is the portal's number
  // (contractMilestoneAmount) — never `m.amount ?? 0`.
  const { buildPortalContractContent } = await import('../utils/portalSnapshot');
  const schedule = [
    { id: 'm1', label: 'Deposit', amount: 4800, trigger: 'on_signing', status: 'pending' },
    { id: 'm2', label: 'Rough-in', percent: 33.333, trigger: 'on_invoice', status: 'pending' },
    { id: 'm3', label: 'Punch', trigger: 'on_final', status: 'pending' },
  ];
  printedHtml = '';
  await pdf.generateContractPDFUri({ ...contractWith(undefined), paymentSchedule: schedule } as never, project as never, branding as never);
  const scheduleHtml = printedHtml.slice(printedHtml.indexOf('Payment milestones'), printedHtml.indexOf('</table>', printedHtml.indexOf('Payment milestones')));
  const portalRows = buildPortalContractContent({ ...contractWith(undefined), paymentSchedule: schedule } as never).paymentSchedule;
  ok('the portal prices the percent-only row at 33.333% of $48,000 to the cent ($15,999.84)', portalRows[1].amount === 15999.84, portalRows);
  ok('...and the sealed PDF prints that same $15,999.84 (it printed $0.00)', scheduleHtml.includes('$15,999.84') && !scheduleHtml.includes('$0.00'), scheduleHtml.slice(0, 1500));
  ok('a saved amount prints as saved on both ($4,800.00)', portalRows[0].amount === 4800 && scheduleHtml.includes('$4,800.00'));
  ok('a row with neither prints "Amount not set" on the PDF (the portal holds null)', portalRows[2].amount === null && scheduleHtml.includes('Amount not set'));

  // Wave-4 final fix r2: ONE rule for a row carrying both a percent and a
  // cached amount — billing's (percent wins on a valued contract). The
  // production shape: 4 × 25% at $45,308.505 with a whole-dollar cache of
  // $11,327 per row. Amount-first showed $11,327.00 on the portal and PDF and
  // billing invoiced $11,327.13. And the PDF's value line / allowances print
  // to the cent, as the portal does ($45,309 against the portal's $45,308.50).
  const { milestoneBillableAmount } = await import('../utils/billingFlowCore');
  const { contractMilestoneAmount } = await import('../utils/paymentTerms');
  const V = 45308.50499999999;
  const stale = [1, 2, 3, 4].map((i) => ({ id: `s${i}`, label: `Draw ${i}`, percent: 25, amount: 11327, trigger: 'on_invoice', status: 'pending' }));
  const staleContract = { ...contractWith(undefined), contractValue: V, paymentSchedule: stale, allowances: [{ id: 'a1', category: 'Tile', amount: 1250.5 }] };
  printedHtml = '';
  await pdf.generateContractPDFUri(staleContract as never, project as never, branding as never);
  const staleHtml = printedHtml;
  const staleRows = buildPortalContractContent(staleContract as never).paymentSchedule;
  ok('a percent row with a stale cached amount: the portal shows what billing invoices ($11,327.13, not the cache\'s $11,327.00)',
    staleRows.length === 4 && staleRows.every((r: { amount: number | null }) => r.amount === 11327.13 && r.amount === milestoneBillableAmount(stale[0] as never, V)), staleRows);
  ok('...and the sealed PDF prints the same $11,327.13', staleHtml.includes('$11,327.13') && !staleHtml.includes('$11,327.00'));
  ok('the PDF prints the contract value to the cent, as the portal does ($45,308.50, never $45,309)', staleHtml.includes('$45,308.50') && !staleHtml.includes('$45,309'));
  ok('...and the allowances to the cent ($1,250.50)', staleHtml.includes('$1,250.50'));
  const parityRows: { amount?: number; percent?: number }[] = [
    { amount: 4800 }, { percent: 33.333 }, { percent: 10, amount: 999 }, { percent: 12.5, amount: 0 }, { amount: 1234.565 }, { amount: -5 }, { percent: 0, amount: 700 },
  ];
  for (const value of [48000, V, 0, 123456.78]) {
    for (const r of parityRows) {
      const shown = contractMilestoneAmount(r as never, value);
      const billed = milestoneBillableAmount(r as never, value);
      // null = "Amount not set" (a percent on a $0 contract, or no amount):
      // billing has nothing to bill there either.
      ok(`parity at $${value}: ${JSON.stringify(r)} shows ${shown}, bills ${billed}`, shown === null ? billed === 0 : shown === billed);
    }
  }
  ok('a row with neither amount nor percent is null (not $0) — "Amount not set"', contractMilestoneAmount({} as never, 48000) === null);

  // Wave-4 final fix round 8: the printed rows add up to the contract value
  // printed above them. Percent-wins alone dropped the rounding cent that
  // contractScheduleFromSplit / retieContractSchedule put on the progress
  // (on_invoice) row: $10,000.05 on 10 / 80 / 10 printed 1,000.01 |
  // 8,000.04 | 1,000.01 = $10,000.06. printedScheduleAmounts keeps it.
  const { contractScheduleFromSplit, retieContractSchedule } = await import('../utils/paymentTerms');
  const cents = (rows: { amount: number | null }[]) => rows.reduce((sum, r) => sum + Math.round((r.amount ?? 0) * 100), 0);
  let n = 0;
  const idGen = () => `id${n++}`;
  const foot = contractScheduleFromSplit(10000.05, { depositPct: 10, progressPct: 80, finalPct: 10 }, idGen);
  const footContract = { ...contractWith(undefined), contractValue: 10000.05, paymentSchedule: foot };
  const footRows = buildPortalContractContent(footContract as never).paymentSchedule;
  ok('$10,000.05 on 10 / 80 / 10: the portal rows are 1,000.01 | 8,000.03 | 1,000.01 (they printed 8,000.04)',
    footRows.map((r: { amount: number | null }) => r.amount).join('|') === '1000.01|8000.03|1000.01', footRows);
  printedHtml = '';
  await pdf.generateContractPDFUri(footContract as never, project as never, branding as never);
  const footHtml = printedHtml.slice(printedHtml.indexOf('Payment milestones'), printedHtml.indexOf('</table>', printedHtml.indexOf('Payment milestones')));
  ok('...and the sealed PDF prints the same $8,000.03', footHtml.includes('$8,000.03') && !footHtml.includes('$8,000.04'), footHtml.slice(0, 1200));
  const splits = [[10, 80, 10], [25, 50, 25], [30, 40, 30], [33, 34, 33], [15, 70, 15], [0, 100, 0], [50, 0, 50], [20, 0, 80]];
  let bad: string[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 2000; i++) {
    const value = Math.round(rnd() * 250000_00 + 1) / 100;
    const [d, p, f] = splits[i % splits.length];
    const fresh = contractScheduleFromSplit(value, { depositPct: d, progressPct: p, finalPct: f }, idGen);
    const retied = retieContractSchedule(value, contractScheduleFromSplit(Math.round(rnd() * 90000_00) / 100 + 1, { depositPct: d, progressPct: p, finalPct: f }, idGen));
    for (const sched of [fresh, retied]) {
      const rows = buildPortalContractContent({ ...contractWith(undefined), contractValue: value, paymentSchedule: sched } as never).paymentSchedule;
      if (cents(rows) !== Math.round(value * 100)) bad.push(`${value} ${d}/${p}/${f}: ${rows.map((r: { amount: number | null }) => r.amount).join('|')}`);
    }
  }
  ok('2,000 contracts with cents × 8 splits (fresh and re-tied): the printed rows foot to the contract value to the cent', bad.length === 0, bad.slice(0, 5));
  bad = [];
  // Every row but the remainder row still prints exactly what it bills.
  for (const value of [10000.05, 48000, 123456.78]) {
    const sched = contractScheduleFromSplit(value, { depositPct: 10, progressPct: 80, finalPct: 10 }, idGen);
    const rows = buildPortalContractContent({ ...contractWith(undefined), contractValue: value, paymentSchedule: sched } as never).paymentSchedule;
    sched.forEach((m, i) => { if (m.trigger !== 'on_invoice' && rows[i].amount !== milestoneBillableAmount(m as never, value)) bad.push(`${value} row ${i}`); });
  }
  ok('...and every row but the on_invoice remainder row prints what billing bills', bad.length === 0, bad);
}

// ── B. a refused payment append is the screen's alone ──────────────────────
console.log('\nB. a refused Record Payment is not also parked under Not saved');
{
  const CTX = read('contexts/ProjectContext.tsx');
  const Q = read('utils/offlineQueue.ts');
  const INV = read('app/invoice.tsx');
  ok('recordInvoicePayment calls the RPC with callerOwnsRefusal',
    /supabaseRpcDetailed\(\s*'invoices', invoiceId, 'invoice_append_payment', \{ p_invoice_id: invoiceId, p_entry: entry \},\s*\{ callerOwnsRefusal: true \},\s*\)/.test(CTX));
  ok('supabaseRpcDetailed forwards the option to the direct write',
    // Data-sync round 1 added ledgerRetry (Retry's own resend) beside it.
    /opts\?: \{ callerOwnsRefusal\?: boolean; ledgerRetry\?: boolean \},[\s\S]{0,260}\.\.\.\(opts\?\.callerOwnsRefusal \? \{ callerOwnsRefusal: true \} : \{\}\),/.test(Q));
  const fail = Q.slice(Q.indexOf('function failDirectWrite('), Q.indexOf('// Forward to Sentry so we can see'));
  ok('failDirectWrite skips the ledger line AND the toast for it', /if \(ledger && !opts\?\.callerOwnsRefusal && !opts\?\.ledgerRetry && !foreignSession\) \{/.test(fail) && /if \(!opts\?\.callerOwnsRefusal && sameSession\) \{\s*try \{[\s\S]*?oops\(/.test(fail));
  ok('the refused alert no longer blames the connection (a dropped signal queues)',
    /'Payment not recorded', `The server did not accept the \$\{formatCurrency\(amt\)\} payment — nothing was recorded\./.test(INV) && !/could not be saved — nothing was recorded\. Check your connection/.test(INV));
  ok('the queued alert says where it waits, not "You\'re offline"',
    /It is waiting in this phone's sync queue/.test(INV) && !/You're offline, so it reaches your books/.test(INV));
}

// A fake PostgREST that honours eq / is filters and answers .select() with
// the rows it updated. onRead runs after a read hands its row out — a write
// landing between the reader's read and its UPDATE.
type Row = Record<string, unknown>;
function fakeDb(rows: Row[], onRead?: (row: Row) => void) {
  const writes: Row[] = [];
  return {
    writes,
    db: {
      from: () => ({
        select: () => {
          let hit = rows;
          const b = {
            eq: (k: string, v: unknown) => { hit = hit.filter(r => r[k] === v); return b; },
            maybeSingle: () => {
              const r = hit[0];
              const copy = r ? JSON.parse(JSON.stringify(r)) : null;
              if (r) onRead?.(r);
              return Promise.resolve({ data: copy, error: null });
            },
          };
          return b;
        },
        update: (patch: Row) => {
          const filters: [string, unknown][] = [];
          const run = () => {
            const hit = rows.filter(r => filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)));
            for (const r of hit) Object.assign(r, patch);
            writes.push(patch);
            return { data: hit.map(r => ({ id: r.id })), error: null };
          };
          const c = {
            eq: (k: string, v: unknown) => { filters.push([k, v]); return c; },
            is: (k: string, v: unknown) => { filters.push([k, v]); return c; },
            select: () => Promise.resolve(run()),
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
          };
          return c;
        },
      }),
    },
  };
}
// The append the RPC makes, landing on the row mid-write.
const appendLands = (row: Row) => {
  row.payments = [...(row.payments as Row[]), { id: 'pay-check-2', amount: 500 }];
  row.amount_paid = Number(row.amount_paid) + 500;
  row.updated_at = '2026-09-22T10:00:01.000001+00:00';
};

// ── C. stripe-webhook refund / dispute ──────────────────────────────────────
console.log('\nC. stripe-webhook refund / dispute writes cannot erase an append');
{
  const W = read('supabase/functions/stripe-webhook/index.ts');
  const a = W.indexOf('async function writeInvoiceLedgerCas(');
  const b = W.indexOf('\nasync function handleChargeRefunded(');
  ok('writeInvoiceLedgerCas sits before handleChargeRefunded', a > -1 && b > a);
  const cas = new Function('INVOICE_COLS', `${transpile(W.slice(a, b))}\nreturn writeInvoiceLedgerCas;`)('id, payments, updated_at') as
    (db: unknown, first: Row, plan: (row: Row, now: string) => Row | null) => Promise<{ ok: boolean; wrote?: Row | null; reason?: string }>;
  const row: Row = { id: 'inv1', amount_paid: 1000, payments: [{ id: 'pay-check-1', amount: 1000 }], updated_at: '2026-09-22T10:00:00.000001+00:00' };
  const first = JSON.parse(JSON.stringify(row)) as Row;
  let raced = false;
  const { db } = fakeDb([row], () => {});
  // The append lands after the webhook's read (`first`) — i.e. before its write.
  appendLands(row); raced = true;
  const res = await cas(db, first, (r) => {
    const ledger = [...(r.payments as Row[]), { id: 'stripe-refund-re_1', amount: -200 }];
    return { payments: ledger, amount_paid: ledger.reduce((s, e) => s + Number(e.amount), 0) };
  });
  const ids = (row.payments as Row[]).map(e => e.id);
  ok('a refund written over a stale read keeps the check appended meanwhile',
    raced && res.ok === true && ids.join(',') === 'pay-check-1,pay-check-2,stripe-refund-re_1' && row.amount_paid === 1300, { res, row });
  const dup = await cas(fakeDb([{ ...row }]).db, { ...row }, () => null);
  ok('nothing to write (a duplicate event) writes nothing', dup.ok === true && dup.wrote === null);
  const always: Row = { id: 'inv2', payments: [], updated_at: 't0' };
  let n = 0;
  const { db: busy } = fakeDb([always], (r) => { r.updated_at = `t${++n}`; });
  const gaveUp = await cas(busy, { ...always, updated_at: 'stale' }, (r) => ({ payments: [...(r.payments as Row[]), { id: 'x' }] }));
  ok('a row that never holds still reports failure (Stripe redelivers), never a blind write', gaveUp.ok === false && (always.payments as Row[]).length === 0, gaveUp);
  ok('the refund handler writes through it', /const res = await writeInvoiceLedgerCas\(supabase, found, \(row, now\) => \{\s*const refund = applyChargeRefund\(ledgerFrom\(row\.payments\), charge, now\);/.test(W));
  ok('the dispute handler writes through it', /async function handleDispute[\s\S]{0,900}const res = await writeInvoiceLedgerCas\(supabase, found, \(row, now\) => \{[\s\S]{0,200}applyLedgerEntry\(ledgerFrom\(row\.payments\)/.test(W));
  ok('no unconditional invoices update of payments is left in the webhook',
    !/\.from\("invoices"\)\s*\.update\(\{ amount_paid: newAmountPaid, payments: refund\.ledger/.test(W) && !/await supabase\.from\("invoices"\)\.update\(patch\)\.eq\("id", found\.id\);/.test(W));
  ok('INVOICE_COLS carries updated_at (the swap token)', /const INVOICE_COLS = "[^"]*, updated_at";/.test(W));
}

// ── D. qbo ledger stamps ───────────────────────────────────────────────────
console.log('\nD. qbo-sync / qbo-reconciler ledger stamps cannot erase an append');
{
  const SYNC = read('supabase/functions/qbo-sync/index.ts');
  const REC = read('supabase/functions/qbo-reconciler/index.ts');
  const lift = (src: string, end: string) => {
    const a = src.indexOf('async function patchInvoiceLedger(');
    const b = src.indexOf(end, a);
    return a > -1 && b > a ? src.slice(a, b) : '';
  };
  const fromSync = lift(SYNC, '\nserve(async');
  const fromRec = lift(REC, '\nasync function fetchUnknownLinkedPayments(');
  ok('both functions carry the helper, identical', fromSync.length > 0 && fromSync === fromRec);
  const patchLedger = new Function('svc', `${transpile(fromSync)}\nreturn patchInvoiceLedger;`)(() => null) as
    (s: unknown, id: string, user: string, patch: (p: unknown) => unknown[] | null) => Promise<{ wrote: boolean; error?: string }>;
  const row: Row = { id: 'inv1', user_id: 'u1', amount_paid: 1000, payments: [{ id: 'pay-check-1', amount: 1000 }], updated_at: '2026-09-22T10:00:00.000001+00:00' };
  let once = false;
  const { db } = fakeDb([row], (r) => { if (!once) { once = true; appendLands(r); } });
  const out = await patchLedger(db, 'inv1', 'u1', (payments) => (payments as Row[]).map(e => (e.id === 'pay-check-1' ? { ...e, qboError: 'QBO 400' } : e)));
  const ledger = row.payments as Row[];
  ok('a push-failure stamp over a stale read keeps the check appended meanwhile, and is still applied',
    out.wrote === true && ledger.length === 2 && ledger[0].qboError === 'QBO 400' && ledger[1].id === 'pay-check-2', { out, row });
  ok('the stamp sends no updated_at of its own (the table\'s trigger bumps it; the fake models none)', row.updated_at === '2026-09-22T10:00:01.000001+00:00');
  ok('no unconditional payments write is left in either function',
    (SYNC.match(/\.update\(\{ payments: next \}\)/g) ?? []).length === 1 && (REC.match(/\.update\(\{ payments: next \}\)/g) ?? []).length === 1);
  ok('qbo-sync reversal + payment failure and the reconciler\'s failure + match stamps all use it',
    (SYNC.match(/await patchInvoiceLedger\(s, invoiceId, auth\.userId,/g) ?? []).length === 2
    && /const out = await patchInvoiceLedger\(s, invoiceId, auth\.userId,/.test(SYNC)
    && (REC.match(/await patchInvoiceLedger\(s, inv\.id, row\.user_id,/g) ?? []).length === 2);
}

// ── E. project-detail AIA freshness ────────────────────────────────────────
console.log('\nE. #15 — project-detail publishes the AIA list only while it is the server\'s');
{
  const PD = read('app/project-detail.tsx');
  const CTX = read('contexts/ProjectContext.tsx');
  ok('the provider exposes its AIA gate', /portalAiaListServerRead: boolean;/.test(CTX) && /portalAiaListServerRead: portalAiaFresh,/.test(CTX)
    && /retryRemoteReads, portalListsServerRead, portalAiaFresh, settingsLoaded,/.test(CTX));
  ok('project-detail passes aiaPayApps only under it (absent = carried)',
    /\.\.\.\(portalAiaListServerRead \? \{ aiaPayApps: projectAIAPayApps \} : \{\}\),/.test(PD) && !/projectAIAPayApps\.length > 0 \? \{ aiaPayApps/.test(PD));
  ok('…and re-runs when the gate flips', /\}, \[project, portalListsServerRead, portalAiaListServerRead, authUser\?\.id,/.test(PD));
}

// ── F. portalLanguages ⇄ the page's CONTRACT_COPY ──────────────────────────
console.log('\nF. #64 — the snapshot\'s contract words match the page in every locale');
{
  const { PORTAL_UI_STRINGS } = await import('../utils/portalLanguages');
  const page = read('marketing/portal/index.html');
  const a = page.indexOf('var CONTRACT_COPY = {');
  const block = a > -1 ? page.slice(a, page.indexOf('};', a)) : '';
  const copy = new Function(`${block.replace('var CONTRACT_COPY = ', 'return ')}}`)() as Record<string, { explainer: string; finePrint: string }>;
  for (const lang of ['en', 'es', 'pt', 'zh', 'vi', 'fr'] as const) {
    const s = (PORTAL_UI_STRINGS as Record<string, { contractSignerExplainer: string; contractFinePrint: string }>)[lang];
    ok(`${lang}: explainer and fine print are the page's words`,
      !!s && !!copy[lang] && s.contractSignerExplainer === copy[lang].explainer && s.contractFinePrint === copy[lang].finePrint,
      { have: s?.contractSignerExplainer, want: copy[lang]?.explainer });
  }
  ok('no locale says "in the app" / "emailed to you" any more',
    !/in the app|emailed to you/.test(PORTAL_UI_STRINGS.en.contractSignerExplainer + PORTAL_UI_STRINGS.en.contractFinePrint));
}

// ── G. migration 06 + the page ─────────────────────────────────────────────
console.log('\nG. #64 — no Sign box and no signature on terms nobody published');
{
  const M = read('supabase/migrations/20260920060000_portal_live_overlay_v2.sql');
  ok('a contentPending block says needsSignature false',
    /v_contract := v_contract \|\| jsonb_build_object\('contentPending', true, 'needsSignature', false\);\s*v_c_open := false;/.test(M));
  const sign = M.slice(M.indexOf('create or replace function public.portal_sign_contract('), M.indexOf('create or replace function public.portal_submit_co_approval('));
  ok('portal_sign_contract refuses a contract with no published block, after the already-signed answer',
    /raise exception 'contract_terms_pending';/.test(sign)
    && sign.indexOf("'already', true") < sign.indexOf('contract_terms_pending')
    && sign.indexOf('contract_terms_pending') < sign.indexOf('update public.project_contracts'));
  const PAGE = read('marketing/portal/index.html');
  ok('the page words that refusal (not "re-send your link")',
    /if \(fc && fc\.contentPending === true\) \{\s*alert\('Your contractor has not published this contract/.test(PAGE));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
