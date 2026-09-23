#!/usr/bin/env bun
// scripts/validate-w4-money-ledger-pending.ts
//
// Audit wave 4, lane money-ledger — #83 (= #135) and #45.
//
// #83: a client's bank payment (ACH) completes Checkout UNPAID and settles days
// later. The single-use link was already dead, yet the row kept it: the portal
// drew a dead Pay button and invoice-dunning mailed "Pay $X now" to a client
// who had paid. The webhook now stamps pay_pending_* and nulls the dead link;
// dunning (and its bun mirror) skips 'payment_pending'; the invoice screen
// shows "Bank payment of $X processing since <day>" and mints nothing.
//
// #45: the GC's paid / failed notices and the receipt were `void`ed after the
// 200 and could be dropped. They now settle inside EdgeRuntime.waitUntil, or
// a bounded await, before the event is marked processed.
//
// The webhook's pending functions and flushSideEffects are lifted from the
// shipped file between their sentinels and EXECUTED against a fake Db.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paymentPendingHolds, reminderEligibility, reminderBlockMessage, PAYMENT_PENDING_HOLD_MS } from '../utils/billingFlowCore';
import { ledgerFrom, toCents2 } from '../supabase/functions/_shared/paymentMath';

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const WEBHOOK = read('supabase/functions/stripe-webhook/index.ts');
const DUNNING = read('supabase/functions/invoice-dunning/index.ts');
const INVOICE = read('app/invoice.tsx');

let passed = 0, failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function slice(src: string, begin: string, end: string): string | null {
  const a = src.indexOf(begin), b = src.indexOf(end);
  if (!(a > -1 && b > a)) return null;
  // From the line AFTER the marker: the marker line may carry prose.
  const nl = src.indexOf('\n', a);
  return src.slice(nl + 1, b);
}

// ── dunning ⇄ billingFlowCore parity ────────────────────────────────────────
console.log('\n#83 invoice-dunning holds while a bank payment settles');
const holdBlock = slice(DUNNING, '// >>> payment-pending-hold', '// <<< payment-pending-hold');
ok('invoice-dunning carries the payment-pending-hold block', !!holdBlock);
const serverHolds = holdBlock
  ? new Function(`${new Transpiler({ loader: 'ts' }).transformSync(holdBlock)}\nreturn paymentPendingHolds;`)() as (a: string | null | undefined, n: number) => boolean
  : null;
const NOW = Date.parse('2026-09-19T12:00:00Z');
const DAY = 86_400_000;
const cases: [string | null | undefined, number][] = [
  [null, NOW], [undefined, NOW], ['', NOW], ['garbage', NOW],
  [new Date(NOW - DAY).toISOString(), NOW], [new Date(NOW - 9 * DAY).toISOString(), NOW],
  [new Date(NOW - 10 * DAY + 1).toISOString(), NOW], [new Date(NOW - 10 * DAY).toISOString(), NOW],
  [new Date(NOW - 30 * DAY).toISOString(), NOW], [new Date(NOW + DAY).toISOString(), NOW],
];
ok('server and app answer identically on every case',
  !!serverHolds && cases.every(([a, n]) => serverHolds(a, n) === paymentPendingHolds(a, n)),
  JSON.stringify(cases.map(([a, n]) => [a, serverHolds?.(a, n), paymentPendingHolds(a, n)])));
ok('holds for a fresh marker', paymentPendingHolds(new Date(NOW - 3 * DAY).toISOString(), NOW));
ok('…and lets go after 10 days (a lost Stripe event cannot silence dunning forever)',
  !paymentPendingHolds(new Date(NOW - 10 * DAY).toISOString(), NOW) && PAYMENT_PENDING_HOLD_MS === 10 * DAY);
ok('SkipReason carries payment_pending', /\| 'payment_pending';/.test(DUNNING));
ok('processInvoice skips it for cron AND manual, before any recipient/send work',
  /if \(paymentPendingHolds\(await paymentPendingSince\(client, invoice\.id\), nowMs\)\) \{\s*return skip\('payment_pending'\);/.test(DUNNING)
  && DUNNING.indexOf("return skip('payment_pending')") < DUNNING.indexOf('resolveDunningRecipient(invoice, project.client_portal?.invites)'));
ok('the marker read survives a not-yet-applied migration (missing column = no marker)',
  /async function paymentPendingSince[\s\S]{0,400}if \(!isMissingColumn\(error\)\)[\s\S]{0,120}return null;/.test(DUNNING));

const base = {
  status: 'overdue', totalDue: 20000, amountPaid: 0, dueMs: NOW - 20 * DAY, dunningStage: 1, lastSentMs: null,
  manual: true, nowMs: NOW,
};
const e1 = reminderEligibility({ ...base, paymentPendingAt: new Date(NOW - 2 * DAY).toISOString() });
ok('the invoice card blocks the manual send with payment_pending', !e1.eligible && e1.reason === 'payment_pending');
ok('…with copy that says why', /bank payment/.test(reminderBlockMessage('payment_pending')));
ok('no marker → eligible as before', reminderEligibility({ ...base }).eligible === true);
ok('the screen passes the marker in', /paymentPendingAt: existingInvoice\.paymentPendingAt \?\? null,/.test(INVOICE));

// ── the webhook's pending functions, executed ───────────────────────────────
console.log('\n#83 stripe-webhook records the pending bank payment');
type Row = Record<string, unknown>;
type Write = { table: string; patch: Row; filters: [string, unknown][] };
const pendingSrc = slice(WEBHOOK, '// --- BEGIN pending bank payment ---', '// --- END pending bank payment ---');
ok('the pending functions sit between their sentinels', !!pendingSrc);
// onRead(table, row): runs after a read hands a row out — a write that lands
// between the webhook's read and its UPDATE (integration round 1 race).
function makeDb(tables: Record<string, Row[]>, onRead?: (table: string, row: Row | undefined) => void) {
  const writes: Write[] = [];
  const db = {
    from: (table: string) => ({
      select: () => {
        let rows = tables[table] ?? [];
        const hand = () => { const r = rows[0]; const copy = r ? { ...r } : undefined; onRead?.(table, r); return copy; };
        const b = {
          eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return b; },
          single: () => { const r = hand(); return Promise.resolve(r ? { data: r, error: null } : { data: null, error: { code: 'PGRST116' } }); },
          maybeSingle: () => Promise.resolve({ data: hand() ?? null, error: null }),
        };
        return b;
      },
      update: (patch: Row) => {
        const w: Write = { table, patch, filters: [] };
        writes.push(w);
        const apply = () => {
          const hit: Row[] = [];
          for (const r of tables[table] ?? []) {
            if (w.filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v))) { Object.assign(r, patch); hit.push(r); }
          }
          return { data: hit.map(r => ({ id: r.id })), error: null };
        };
        const chain = {
          eq: (k: string, v: unknown) => { w.filters.push([k, v]); return chain; },
          is: (k: string, v: unknown) => { w.filters.push([k, v]); return chain; },
          select: () => Promise.resolve(apply()),
          then: (res: (v: { data: Row[]; error: null }) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(apply()).then(res, rej),
        };
        return chain;
      },
    }),
  };
  return { db, writes };
}
const fns = pendingSrc
  ? new Function('toCents2', 'isNotFound', 'ledgerFrom',
      `${new Transpiler({ loader: 'ts' }).transformSync(pendingSrc)}\nreturn { markPaymentPending, clearPaymentPending };`,
    )(toCents2, (c: string | undefined) => c === 'PGRST116' || c === '22P02', ledgerFrom) as {
      markPaymentPending: (db: unknown, s: Row) => Promise<{ ok: boolean; reason?: string }>;
      clearPaymentPending: (db: unknown, s: Row) => Promise<{ ok: boolean }>;
    }
  : null;

if (fns) {
  // The invoice path: the unpaid completion of the link the row still holds.
  const inv: Row = { id: 'inv1', pay_link_id: 'plink_1', pay_link_url: 'https://buy.stripe.com/1', pay_link_amount: 20000, pay_pending_session: null };
  const t1 = { invoices: [inv], aia_pay_apps: [] as Row[] };
  const { db } = makeDb(t1);
  const session = { id: 'cs_ach', amount_total: 2_000_000, payment_link: 'plink_1', metadata: { invoice_id: 'inv1' }, payment_status: 'unpaid', status: 'complete' };
  const r1 = await fns.markPaymentPending(db, session);
  ok('an unpaid completion is recorded as pending (not "not paid")', r1.ok === true && r1.reason === 'payment pending');
  ok('…stamping at / amount / session', typeof inv.pay_pending_at === 'string' && inv.pay_pending_amount === 20000 && inv.pay_pending_session === 'cs_ach', JSON.stringify(inv));
  ok('…and nulling the dead link (url, id, amount)', inv.pay_link_url === null && inv.pay_link_id === null && inv.pay_link_amount === null);
  // A link the GC minted SINCE is never clobbered.
  const newer: Row = { id: 'inv2', pay_link_id: 'plink_NEW', pay_link_url: 'https://buy.stripe.com/new', pay_link_amount: 500 };
  const { db: db2 } = makeDb({ invoices: [newer], aia_pay_apps: [] });
  await fns.markPaymentPending(db2, { ...session, metadata: { invoice_id: 'inv2' } });
  ok('a newer link on the row survives (the null is guarded on pay_link_id = this session\'s link)',
    newer.pay_link_url === 'https://buy.stripe.com/new' && newer.pay_pending_session === 'cs_ach');
  // The AIA path marks the pay app AND the invoice dunning reads.
  const app: Row = { id: 'aia1', invoice_id: 'inv3', pay_link_id: 'plink_aia', pay_link_url: 'u', pay_link_amount: 9 };
  const inv3: Row = { id: 'inv3', pay_link_id: 'plink_other', pay_link_url: 'v', pay_link_amount: 9 };
  const { db: db3 } = makeDb({ invoices: [inv3], aia_pay_apps: [app] });
  await fns.markPaymentPending(db3, { ...session, payment_link: 'plink_aia', metadata: { record_type: 'aia_pay_app', record_id: 'aia1' } });
  ok('AIA: the pay app is marked and its dead link nulled', app.pay_pending_session === 'cs_ach' && app.pay_link_url === null);
  ok('…and the invoice it bills is marked (dunning reads invoices) without losing its own link',
    inv3.pay_pending_session === 'cs_ach' && inv3.pay_link_url === 'v');
  // Integration round 1: a late redelivery of the 'unpaid' completion after
  // async_payment_succeeded credited the session stamps nothing.
  const credited: Row = { id: 'inv5', updated_at: 't1', payments: [{ id: 'stripe-cs_ach', amount: 200 }], pay_pending_session: null, pay_link_id: 'plink_1', pay_link_url: 'x' };
  const { db: db5 } = makeDb({ invoices: [credited], aia_pay_apps: [] });
  await fns.markPaymentPending(db5, { ...session, metadata: { invoice_id: 'inv5' } });
  ok('int-1 a session already in the ledger is not marked pending (no 10-day hold on a paid invoice)',
    credited.pay_pending_session == null && credited.pay_pending_at == null && credited.pay_link_url === 'x', JSON.stringify(credited));
  const paidApp: Row = { id: 'aia5', invoice_id: 'inv6', paid_at: '2026-09-19T00:00:00Z', pay_link_url: 'u' };
  const inv6: Row = { id: 'inv6', updated_at: 't1', payments: [], pay_link_url: 'v' };
  const { db: db6 } = makeDb({ invoices: [inv6], aia_pay_apps: [paidApp] });
  const r6 = await fns.markPaymentPending(db6, { ...session, payment_link: 'plink_aia', metadata: { record_type: 'aia_pay_app', record_id: 'aia5' } });
  ok('int-1 AIA: a pay app already paid marks neither it nor its invoice',
    r6.ok === true && paidApp.pay_pending_session == null && inv6.pay_pending_session == null, JSON.stringify([paidApp, inv6]));
  // The credit lands between the read and the UPDATE: the conditional write
  // misses, the re-read finds the entry, nothing is stamped.
  const racing: Row = { id: 'inv7', updated_at: 't1', payments: [], pay_link_id: null };
  let raced = false;
  const { db: db7 } = makeDb({ invoices: [racing], aia_pay_apps: [] }, (table, row) => {
    if (table === 'invoices' && row && !raced) { raced = true; row.payments = [{ id: 'stripe-cs_ach', amount: 200 }]; row.updated_at = 't2'; }
  });
  await fns.markPaymentPending(db7, { ...session, payment_link: null, metadata: { invoice_id: 'inv7' } });
  ok('int-1 a credit landing between the read and the stamp wins (conditional on updated_at)',
    raced && racing.pay_pending_session == null, JSON.stringify(racing));
  // Failure clears only this session's marker, on both tables.
  const other: Row = { id: 'inv9', pay_pending_session: 'cs_OTHER', pay_pending_at: 'x', pay_pending_amount: 1 };
  const { db: db4 } = makeDb({ invoices: [inv, other], aia_pay_apps: [app] });
  const c = await fns.clearPaymentPending(db4, session);
  ok('async_payment_failed clears the marker of its session', c.ok && inv.pay_pending_session === null && inv.pay_pending_at === null && app.pay_pending_session === null);
  ok('…and never another session\'s', other.pay_pending_session === 'cs_OTHER');
}

ok('both handlers take the pending branch before their "not paid" early return',
  /payment_status === "unpaid" && session\.status === "complete"\) \{\s*return markPaymentPending\(supabase, session\);\s*\}\s*if \(session\.payment_status !== "paid"\)/.test(WEBHOOK)
  && (WEBHOOK.match(/return markPaymentPending\(supabase, session\);/g) ?? []).length === 2);
ok('async_payment_failed clears the marker (retried on a DB failure) before telling the GC',
  /const cleared = outcomeOf\(event\.type, await clearPaymentPending\(supabase, failed\)\);\s*if \(cleared\.retry\) return cleared;\s*afterCredit\(notifyGcPaymentFailed\(supabase, failed\)\);/.test(WEBHOOK));
ok('the spent link is retired on an unpaid completion too',
  /const spent = session\.payment_status === "paid"\s*\|\| \(session\.payment_status === "unpaid" && session\.status === "complete"\);\s*if \(isMageLink && spent && session\.payment_link\)/.test(WEBHOOK));

// ── #45: side effects outlive the response ──────────────────────────────────
console.log('\n#45 the GC notices and the receipt are not fire-and-forget');
ok('no `void` notify / receipt call left', !/void (notifyGcInvoicePaid|notifyGcPaymentFailed|sendReceiptEmail)\(/.test(WEBHOOK));
ok('all four sites register through afterCredit',
  (WEBHOOK.match(/afterCredit\(notifyGcInvoicePaid\(/g) ?? []).length === 2
  && /afterCredit\(sendReceiptEmail\(/.test(WEBHOOK) && /afterCredit\(notifyGcPaymentFailed\(/.test(WEBHOOK));
ok('they are settled BEFORE the event is marked processed',
  /await flushSideEffects\(\);[\s\S]{0,600}if \(claim\.state === "claimed"\) await markProcessed\(supabase, event\.id\);/.test(WEBHOOK));
{
  const a = WEBHOOK.indexOf('const sideEffects: Promise<unknown>[] = [];');
  const b = WEBHOOK.indexOf('// ── Tell the GC (#48)');
  const src = a > -1 && b > a ? WEBHOOK.slice(a, b) : '';
  ok('flushSideEffects block found', src.length > 0);
  if (src) {
    const mk = () => new Function(`${new Transpiler({ loader: 'ts' }).transformSync(src.replace('const SIDE_EFFECT_BUDGET_MS = 5_000;', 'const SIDE_EFFECT_BUDGET_MS = 60;'))}\nreturn { afterCredit, flushSideEffects };`)() as {
      afterCredit: (p: Promise<unknown>) => void; flushSideEffects: () => Promise<void>;
    };
    // With EdgeRuntime.waitUntil: handed over as ONE allSettled promise, not awaited.
    const g = globalThis as { EdgeRuntime?: unknown };
    const handed: Promise<unknown>[] = [];
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { handed.push(p); } };
    const m1 = mk();
    let done1 = false;
    m1.afterCredit(new Promise(r => setTimeout(() => { done1 = true; r(1); }, 30)));
    m1.afterCredit(Promise.reject(new Error('notify down')));
    const t0 = Date.now();
    await m1.flushSideEffects();
    ok('waitUntil receives the settled set and the response is not held', handed.length === 1 && Date.now() - t0 < 25 && !done1);
    const settled = await handed[0] as PromiseSettledResult<unknown>[];
    ok('…a rejected side effect cannot reject it (allSettled)', settled.length === 2 && settled[1].status === 'rejected');
    // Without it: awaited, but bounded.
    delete g.EdgeRuntime;
    const m2 = mk();
    let done2 = false;
    m2.afterCredit(new Promise(r => setTimeout(() => { done2 = true; r(1); }, 10)));
    await m2.flushSideEffects();
    ok('without waitUntil a fast side effect is awaited', done2);
    const m3 = mk();
    m3.afterCredit(new Promise(() => { /* never settles */ }));
    const t1 = Date.now();
    await m3.flushSideEffects();
    ok('…and a hung one is cut off at the budget', Date.now() - t1 < 1000);
  }
}

// ── the invoice screen ─────────────────────────────────────────────────────
console.log('\n#83 the invoice screen while a bank payment processes');
ok('the processing line reads "Bank payment of $X processing since <day>"',
  /line: `Bank payment\$\{typeof amount === 'number' && Number\.isFinite\(amount\) \? ` of \$\{formatCurrency\(amount\)\}` : ''\} processing since \$\{day \|\| 'recently'\}`/.test(INVOICE));
ok('it is gated on the same 10-day rule as dunning', /paymentPendingHolds\(since, Date\.now\(\)\)/.test(INVOICE));
ok('the Pay-link card (Copy / Share / Regenerate / Generate) is replaced while pending',
  /existingInvoice && !pendingBankPayment && effectiveStatus !== 'draft' && effectiveStatus !== 'paid' && balanceDue > 0 && \(/.test(INVOICE)
  && /testID="bank-payment-processing"/.test(INVOICE));
ok('every mint on the screen refuses while pending (Send, PDF send, re-mints go through mintPayLinkFor)',
  /if \(pendingBankMintBlock && invoice\.id === existingInvoice\?\.id\) \{\s*return \{ ok: false, reason: 'failed', error: 'payment_pending', message: pendingBankMintBlock \};/.test(INVOICE));
ok('Regenerate (its own createPaymentLink call) refuses with the reason',
  /\/\/ #83: Regenerate is a mint too\.\s*if \(pendingBankPayment\) \{\s*showAlert\('Bank payment processing'/.test(INVOICE));
ok('Record Payment asks first instead of silently double-counting',
  /if \(pendingBankPayment && !confirmedDespitePending\.current\) \{\s*showAlert\(\s*'A bank payment is processing'/.test(INVOICE));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
