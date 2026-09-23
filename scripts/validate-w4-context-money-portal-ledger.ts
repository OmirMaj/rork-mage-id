// validate-w4-context-money-portal-ledger.ts — wave 4, lane context-money-portal.
//
// The money half of the lane, run from the shipped source against stubs:
//
//   #80/#35 (BLOCKER) recordInvoicePayment appends ONE payment through
//        invoice_append_payment (CONTRACT 2) — never the device's whole ledger
//        through updateInvoice, which erased a client's Pay-link payment from
//        a stale phone. The device copy moves at once and is protected while
//        the call is out; 'synced' → the guarded re-read, 'queued' → kept,
//        'failed' → taken back off (the caller says nothing was recorded).
//   #83/#135 pay_pending_at / pay_pending_amount → paymentPendingAt /
//        paymentPendingAmount on invoices and AIA pay applications (CONTRACT 3).
//   #82  refetchInvoicesNow — the guarded invoices / pay-apps re-read the
//        "client paid" notification paths call (never a raw invalidate).
//   review round 1: a REFUSED append's ledger entry (operation 'rpc') does not
//        pin the reverted device row in the invoices loader's keep set — a
//        later Stripe payment would stay hidden until he tapped Discard.
//
// Run via: bun run scripts/validate-w4-context-money-portal-ledger.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  optimisticPaymentAppend, revertOptimisticPayment, pendingPaymentFromRow, aiaRowToSaved, rpcOnlyLedgerIds,
} from '../utils/projectContextPure';
import { mergeInvoiceUpdate } from '../utils/invoiceWrites';
import { extractCallback, runCallback } from './validate-context-money-portal-writes';

declare const Bun: { Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CTX = readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

type Pay = { id: string; amount: number; date?: string; method?: string };
type Inv = {
  id: string; projectId: string; status: string; totalDue: number; amountPaid: number; payments: Pay[];
  subtotal?: number; retentionPercent?: number; retentionAmount?: number; retentionReleased?: number; updatedAt?: string;
};

async function main() {
  // ── #83/#135 · the pending bank-payment marker ─────────────────────────────
  console.log('\n#83 #135 the pending bank payment is read back (CONTRACT 3)');
  {
    const p = pendingPaymentFromRow({ pay_pending_at: '2026-09-20T15:00:00Z', pay_pending_amount: '20000.50' });
    ok('pay_pending_at / a numeric-string pay_pending_amount → paymentPendingAt / paymentPendingAmount',
      p.paymentPendingAt === '2026-09-20T15:00:00Z' && p.paymentPendingAmount === 20000.5, JSON.stringify(p));
    const none = pendingPaymentFromRow({ pay_pending_at: null, pay_pending_amount: null });
    ok('no payment in flight → the keys are ABSENT (a pre-migration row reads the same)',
      !('paymentPendingAt' in none) && !('paymentPendingAmount' in none), JSON.stringify(none));
    ok('an unparseable amount is dropped, never read as $0',
      !('paymentPendingAmount' in pendingPaymentFromRow({ pay_pending_amount: 'n/a' })));
    ok('cents survive: 0.1 + 0.2 style float noise is rounded to the cent',
      pendingPaymentFromRow({ pay_pending_amount: 0.30000000000000004 }).paymentPendingAmount === 0.3);
    const aia = aiaRowToSaved({ id: 'a1', project_id: 'p1', pay_pending_at: '2026-09-21T10:00:00Z', pay_pending_amount: 4800 });
    ok('aia_pay_apps rows carry it too (aiaRowToSaved)',
      aia.paymentPendingAt === '2026-09-21T10:00:00Z' && aia.paymentPendingAmount === 4800);
    const invMapper = CTX.slice(CTX.indexOf("const invoicesQuery = useQuery({"), CTX.indexOf('const commitmentsQuery = useQuery({'));
    ok('the invoices loader maps it (spread into the mapped row)', /\.\.\.pendingPaymentFromRow\(r\),/.test(invMapper));
    ok('…and the AIA loader goes through aiaRowToSaved',
      /\.\.\.aiaRowToSaved\(r\),/.test(CTX.slice(CTX.indexOf("const aiaPayAppsQuery = useQuery({"), CTX.indexOf('const saveAiaPayAppsMutationRaw'))));
  }

  // ── #80/#35 · the optimistic append, pure ──────────────────────────────────
  console.log('\n#80 #35 the device copy of one appended payment (pure)');
  {
    const inv: Inv = { id: 'i7', projectId: 'p1', status: 'sent', totalDue: 20000, amountPaid: 0, payments: [] };
    const a = optimisticPaymentAppend(inv, { id: 'pay-1', amount: 300 });
    ok('only the new entry is added; amount_paid moves by exactly it; partially paid',
      !!a && a.payments.length === 1 && a.amountPaid === 300 && a.status === 'partially_paid', JSON.stringify(a));
    ok('an entry already on the row is a no-op (a replay never counts twice)',
      optimisticPaymentAppend({ ...inv, payments: [{ id: 'pay-1', amount: 300 }], amountPaid: 300 }, { id: 'pay-1', amount: 300 }) === null);
    const c = optimisticPaymentAppend({ ...inv, totalDue: 0.3, amountPaid: 0.1, payments: [{ id: 'x', amount: 0.1 }] }, { id: 'y', amount: 0.2 });
    ok('money exact to the cent: $0.10 + $0.20 = $0.30 and settles', !!c && c.amountPaid === 0.3 && c.status === 'paid', JSON.stringify(c));
    const r = optimisticPaymentAppend(
      { ...inv, totalDue: 10000, subtotal: 10000, retentionPercent: 10, amountPaid: 0 }, { id: 'p', amount: 9000 });
    ok('settled NET of held retention → paid (the server\'s invoice_settlement_status rule)', r?.status === 'paid', JSON.stringify(r));
    const back = revertOptimisticPayment({ ...inv, payments: [{ id: 'old', amount: 50 }, { id: 'pay-1', amount: 300 }], amountPaid: 350, status: 'partially_paid' },
      { id: 'pay-1', amount: 300 }, { status: 'sent' });
    ok('a refused append is taken back: only that entry, only its amount, the prior status',
      !!back && back.payments.map(p => p.id).join() === 'old' && back.amountPaid === 50 && back.status === 'sent', JSON.stringify(back));
    ok('…and a row that no longer holds it (a re-read replaced it) is left alone',
      revertOptimisticPayment({ ...inv, payments: [] }, { id: 'pay-1', amount: 300 }, { status: 'sent' }) === null);
  }

  // ── #80/#35 · recordInvoicePayment, EXECUTED ───────────────────────────────
  console.log('\n#80 #35 recordInvoicePayment appends through the RPC (executed)');
  {
    const run = async (o: { outcome: string; canSync?: boolean; throws?: boolean }) => {
      const start: Inv = { id: 'i7', projectId: 'p1', status: 'sent', totalDue: 20300, amountPaid: 0, payments: [] };
      const invoicesRef = { current: [start] as Inv[] };
      const inFlight = { current: 0 };
      const touches: string[] = [];
      const rpc: { args: unknown[]; inFlightAtCall: number; rowAtCall: Inv | undefined }[] = [];
      const calls: string[] = [];
      const saved: Inv[][] = [];
      const fn = runCallback<(id: string, entry: Pay) => Promise<string>>(CTX, 'recordInvoicePayment', {
        canSync: o.canSync ?? true,
        invoicesRef, setInvoices: () => { calls.push('setInvoices'); },
        saveInvoicesMutation: { mutate: (n: Inv[]) => { saved.push(n); } },
        mergeInvoiceUpdate, optimisticPaymentAppend, revertOptimisticPayment,
        invoiceWritesInFlightRef: inFlight, proDocWriteTouchRef: { current: new Map() },
        touchedWrite: async (_ref: unknown, id: string, send: () => Promise<string>) => { touches.push(id); return send(); },
        supabaseRpcDetailed: async (...args: unknown[]) => {
          rpc.push({ args, inFlightAtCall: inFlight.current, rowAtCall: invoicesRef.current.find(i => i.id === 'i7') });
          if (o.throws) throw new Error('boom');
          return o.outcome;
        },
        refetchInvoicesNow: async () => { calls.push('refetchInvoicesNow'); },
        payInvoicesReloadIfOwed: () => { calls.push('payOwed'); },
      }, calls);
      const entry: Pay = { id: 'pay-check-1', amount: 300, method: 'check', date: '2026-09-22T10:00:00Z' };
      const outcome = await fn('i7', entry);
      return { outcome, invoicesRef, inFlight, touches, rpc, calls, saved, entry };
    };

    const s = await run({ outcome: 'synced' });
    const args = s.rpc[0]?.args as [string, string, string, { p_invoice_id: string; p_entry: Pay }] | undefined;
    ok('ONE rpc op: invoice_append_payment(p_invoice_id, p_entry) keyed on the invoice (CONTRACT 1/2)',
      s.rpc.length === 1 && !!args && args[0] === 'invoices' && args[1] === 'i7' && args[2] === 'invoice_append_payment'
        && args[3].p_invoice_id === 'i7' && args[3].p_entry === s.entry, JSON.stringify(args));
    ok('…carrying ONLY the new entry — no payments array, no amount_paid, no status',
      !!args && Object.keys(args[3]).sort().join() === 'p_entry,p_invoice_id');
    ok('the device copy shows the payment BEFORE the call goes out',
      s.rpc[0]?.rowAtCall?.payments.some(p => p.id === 'pay-check-1') === true && s.rpc[0]?.rowAtCall?.amountPaid === 300);
    ok('while it is out the loader keeps that copy: counted in flight and touched',
      s.rpc[0]?.inFlightAtCall === 1 && s.touches.join() === 'i7' && s.inFlight.current === 0);
    ok('synced → the guarded re-read (the server\'s ledger, with any Stripe entry, replaces the guess)',
      s.outcome === 'synced' && s.calls.includes('refetchInvoicesNow'));
    ok('the whole-ledger write path is never used', !s.calls.some(c => c === 'updateInvoice' || c.startsWith('supabaseWrite')), s.calls.join());

    const q = await run({ outcome: 'queued' });
    ok('queued → the device copy is KEPT, no re-read over it',
      q.outcome === 'queued' && !q.calls.includes('refetchInvoicesNow')
        && q.invoicesRef.current[0].payments.some(p => p.id === 'pay-check-1') && q.inFlight.current === 0);

    const f = await run({ outcome: 'failed' });
    ok('failed → taken back off the device copy (he is told nothing was recorded)',
      f.outcome === 'failed' && f.invoicesRef.current[0].payments.length === 0 && f.invoicesRef.current[0].amountPaid === 0
        && f.invoicesRef.current[0].status === 'sent' && !f.calls.includes('refetchInvoicesNow'), JSON.stringify(f.invoicesRef.current[0]));
    const t = await run({ outcome: 'synced', throws: true });
    ok('a throw counts as failed, taken back, and the in-flight count is released',
      t.outcome === 'failed' && t.invoicesRef.current[0].payments.length === 0 && t.inFlight.current === 0);
    const n = await run({ outcome: 'synced', canSync: false });
    ok('no account → failed, and nothing moves on the device either', n.outcome === 'failed' && n.rpc.length === 0 && n.saved.length === 0);

    const fin = CTX.slice(CTX.indexOf('const financialsData = useMemo<FinancialsDataValue>(() => ({'), CTX.indexOf('const fieldData = useMemo<FieldDataValue>'));
    ok('the financials bucket exposes the real recordInvoicePayment (and memoises on it)',
      /\n\s*recordInvoicePayment,\n/.test(fin) && /awaitInvoiceInsert, recordInvoicePayment, getInvoicesForProject/.test(fin));
    ok('no wave-4 PRE-STEP stub is left in the provider', !/PRE-STEP stub/.test(CTX) && !/recordInvoicePaymentStub|requestPortalPublishStub/.test(CTX));
  }

  // ── #82 · refetchInvoicesNow, EXECUTED ─────────────────────────────────────
  console.log('\n#82 refetchInvoicesNow is the guarded re-read (executed)');
  {
    const run = async (o: { insertOut?: boolean; updatesOut?: number; userId?: string | null }) => {
      const inv: string[] = [];
      const owed = { current: false };
      const fn = runCallback<() => Promise<void>>(CTX, 'refetchInvoicesNow', {
        userId: o.userId === undefined ? 'u1' : o.userId,
        invoiceInsertsRef: { current: new Map(o.insertOut ? [['i1', Promise.resolve('synced')]] : []) },
        invoiceWritesInFlightRef: { current: o.updatesOut ?? 0 },
        invoicesReloadOwedRef: owed,
        queryClient: { invalidateQueries: async (q: { queryKey: unknown[] }) => { inv.push(String(q.queryKey[0])); } },
      });
      await fn();
      return { reads: inv.sort().join(), owed: owed.current };
    };
    const idle = await run({});
    ok('idle → invoices and pay apps re-read now', idle.reads === 'aiaPayApps,invoices' && idle.owed === false, idle.reads);
    const ins = await run({ insertOut: true });
    ok('an invoice insert on the wire → no invoices read over it; the read is OWED', ins.reads === 'aiaPayApps' && ins.owed === true, ins.reads);
    const upd = await run({ updatesOut: 1 });
    ok('an invoice update (or payment append) on the wire → owed, not read', upd.reads === 'aiaPayApps' && upd.owed === true);
    ok('signed out → nothing', (await run({ userId: null })).reads === '');
    const guard = (src: string) => /if \(invoiceInsertsRef\.current\.size === 0 && invoiceWritesInFlightRef\.current === 0\) \{\s*invoicesReloadOwedRef\.current = false;/.test(src)
      && /\} else \{\s*invoicesReloadOwedRef\.current = true;/.test(src);
    ok('the same guard as the foreground pass (both copies hold it)',
      guard(extractCallback(CTX, 'refetchInvoicesNow')) && guard(extractCallback(CTX, 'refetchMoneyAndProfileOnForeground')));
    const stable = CTX.slice(CTX.indexOf('const stableActions = useMemo<StableActionsValue>(() => ({'), CTX.indexOf('// Non-destructive import (app/data-import.tsx)'));
    ok('exposed on the stable actions (in the object and the deps)',
      /\n\s*refetchInvoicesNow,\n/.test(stable) && /\], \[[^\]]*\brefetchInvoicesNow\b[^\]]*\]\);|\}\), \[[^\]]*\brefetchInvoicesNow\b/.test(stable));
    ok('…typed as () => Promise<void>', /refetchInvoicesNow: \(\) => Promise<void>;/.test(CTX));
  }

  console.log('\nreview · a refused payment append does not pin the invoice\'s device row');
  {
    const f = (recordId: string, operation: string, table = 'invoices', kind = 'write') => ({ kind, table, recordId, operation });
    ok('rpcOnlyLedgerIds: an invoice named only by a refused rpc is listed',
      [...rpcOnlyLedgerIds([f('i1', 'rpc')], 'invoices')].join() === 'i1');
    ok('…one that ALSO has a refused row write is not (that payload is the only copy)',
      rpcOnlyLedgerIds([f('i1', 'rpc'), f('i1', 'update')], 'invoices').size === 0);
    ok('…other tables, photo / dictation notes and id-less entries are ignored',
      rpcOnlyLedgerIds([f('i2', 'rpc', 'aia_pay_apps'), f('i3', 'rpc', 'invoices', 'photo'), { kind: 'write', table: 'invoices', operation: 'rpc' }], 'invoices').size === 0);
    // Executed: the real dropRpcOnlyLedgerIds, transpiled out of the provider.
    const start = CTX.indexOf('async function dropRpcOnlyLedgerIds(');
    const end = CTX.indexOf('\n}\n', start);
    const src = start >= 0 && end > start ? CTX.slice(start, end + 2) : '';
    const js = src ? new Bun.Transpiler({ loader: 'ts' }).transformSync(src) : '';
    const run = async (ledger: unknown[] | 'unreadable', queued: string[]) => {
      const factory = new Function('ownFailures', 'readSyncFailuresOrThrow', 'rpcOnlyLedgerIds', 'queuedIdsFor', `${js}\nreturn dropRpcOnlyLedgerIds;`);
      const drop = factory(
        (all: { userId?: string }[], uid: string) => all.filter(x => x.userId === uid),
        async () => { if (ledger === 'unreadable') throw new Error('storage'); return ledger; },
        rpcOnlyLedgerIds,
        async () => new Set(queued),
      ) as (keep: Set<string>, table: string, userId: string) => Promise<void>;
      const keep = new Set(['i1', 'i2', 'q1']);
      await drop(keep, 'invoices', 'u1');
      return [...keep].sort().join();
    };
    const L = [
      { ...f('i1', 'rpc'), userId: 'u1' },
      { ...f('i2', 'update'), userId: 'u1' },
      { ...f('q1', 'rpc'), userId: 'u1' },
    ];
    ok('the refused-append-only id leaves the keep set; a refused row write and a still-QUEUED append stay',
      js.length > 0 && await run(L, ['q1']) === 'i2,q1', js ? await run(L, ['q1']) : 'dropRpcOnlyLedgerIds not found');
    ok('…another user\'s ledger entry changes nothing', await run([{ ...f('i1', 'rpc'), userId: 'u2' }], []) === 'i1,i2,q1');
    ok('…storage refused → keep everything (the safe side)', await run('unreadable', []) === 'i1,i2,q1');
    const loader = CTX.slice(CTX.indexOf("const keepInvoices = new Set("), CTX.indexOf("notePortalRead('invoices', userId, true, readEpoch);"));
    ok('the invoices loader applies it to its keep set BEFORE the merge',
      /await dropRpcOnlyLedgerIds\(keepInvoices, 'invoices', userId\);[\s\S]*mergeServerKeepingPending\(mapped, priorInvoices, new Set\(\[\.\.\.keepInvoices,/.test(loader));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
