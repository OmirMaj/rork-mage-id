// validate-qbo-payment-ledger.ts — QuickBooks and MAGE must agree on the cash,
// without counting any payment twice in either place.
//
// WHY THIS EXISTS (audit round 2, #14 and #15).
//
// #14 — qbo-reconciler booked a SECOND full payment on every invoice MAGE paid
// off itself. It skipped a QuickBooks-paid invoice only when a source:'qbo'
// entry existed; MAGE's pushed payments are source:'mage', pay-link payments
// have no source. payment.ts's own push drops the QuickBooks Balance to 0 and
// bumps LastUpdatedTime, which is the reconciler's query window, so a $30,000
// check recorded in MAGE became $60,000 received within one 30-minute cycle —
// on Payments, the Cash Flow balance, the weekly snapshot.
//
// #15 — money collected through MAGE's own Pay link never reached QuickBooks
// (stripe-webhook writes the ledger server-side and nothing pushed it), and a
// payment push that failed was never retried or recorded anywhere.
//
// WHAT THIS PINS. The pure rules in supabase/functions/_shared/paymentLedger.ts
// executed under bun (the reconciler imports the same file), the qbo-setup
// screen's client count against the server rule, and the reconciler/qbo-sync
// wiring that a pure test cannot see.
//
// Run via: bun run scripts/validate-qbo-payment-ledger.ts

import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log('  ✓', label);
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

type Entry = {
  id: string; amount: number; method?: string; kind?: string; date?: string; paymentIntentId?: string;
  qboId?: string; source?: 'mage' | 'qbo'; qboError?: string; qboAttempts?: number; notes?: string;
};
type Linked = { id: string; txnDate?: string | null; applied: number };
type Plan = { appended: Entry[]; matched: string[]; changed: boolean; ledger: Entry[]; amountPaid: number; unexplained: number };
interface LedgerModule {
  planQboPaidReconcile: (i: { payments: unknown; totalAmt: number; linkedPayments: Linked[]; fallbackDate?: string }) => Plan;
  paymentsToPushToQbo: (p: unknown, o?: { notBefore?: string | null }) => Entry[];
  paymentSweepFloor: (connCreatedAt: string | null | undefined) => string;
  PAYMENT_SWEEP_FLOOR: string;
  ledgerInstantForDay: (d: string | null | undefined) => string | undefined;
  isPerObjectQboError: (e: unknown) => boolean;
  QBO_CLOSED_WITHOUT_PAYMENT_PREFIX: string;
  closedWithoutPaymentNote: (n: number) => string;
  isClosedWithoutPaymentNote: (s: unknown) => boolean;
  countPaymentsNotInQbo: (p: unknown) => number;
  markPushFailure: (p: unknown, id: string, msg: string, opts?: { countAttempt?: boolean }) => Entry[] | null;
  matchUnpushedPayments: (l: Entry[], u: Linked[]) => { ledger: Entry[]; matches: { entryId: string; qboId: string }[] };
  applyQboMatches: (p: unknown, m: { entryId: string; qboId: string }[]) => Entry[] | null;
  MAX_PAYMENT_PUSH_ATTEMPTS: number;
  sweepPushRefusal: (amount: number, balance: number, n: number | string, taxShortfall?: number) => string | null;
  qboTaxShortfall: (mageTax: unknown, qboTotalTax: unknown) => number;
  isQboOutageError: (e: unknown) => boolean;
  QBO_ERROR_APPEND_SEP: string;
  closedFlagOf: (s: unknown) => string | null;
  closedFlagChange: (qboError: unknown, flag: string | null) => { qbo_error?: string | null };
  withoutClosedFlag: (s: unknown) => string | null;
  keepClosedFlag: (existing: unknown, next: string | null) => string | null;
  nextInvoicePullCursor: (i: { sinceIso: string | null | undefined; queryStartMs: number; rows: { MetaData?: { LastUpdatedTime?: string } }[] }) => string;
  INVOICE_PULL_PAGE_SIZE: number;
  INVOICE_PULL_LOOKBACK_MS: number;
}

// A variable specifier: tsc refuses a literal '.ts' import path (and would then
// follow paymentLedger's own Deno-style './paymentMath.ts'); bun does not care.
const LEDGER = '../supabase/functions/_shared/paymentLedger.ts';
const L = await import(LEDGER) as LedgerModule;

const mage = (id: string, amount: number, qboId?: string): Entry =>
  ({ id, amount, method: 'check', date: '2026-09-10', ...(qboId ? { qboId, source: 'mage' as const } : {}) });
const stripe = (id: string, amount: number): Entry =>
  ({ id, amount, method: 'stripe', kind: 'payment', date: '2026-09-11T18:22:04.000Z' });

console.log('\nQuickBooks payment ledger — one payment, counted once, in both books:\n');

// ── 1. #14: the reconciler never doubles money MAGE already has ────────────
console.log('  1. QuickBooks says paid — what MAGE still needs');
{
  // The audit path: $30k check recorded in MAGE, pushed by payment.ts (qboId
  // P1). The reconciler fetches only UNKNOWN linked payments, so none.
  const pushed = [mage('pay-1', 30_000, 'P1')];
  const p = L.planQboPaidReconcile({ payments: pushed, totalAmt: 30_000, linkedPayments: [] });
  check('a payment MAGE pushed itself adds nothing', !p.changed && p.appended.length === 0, JSON.stringify(p));
  check('...and amount_paid stays the ledger sum, $30,000', p.amountPaid === 30_000, String(p.amountPaid));

  // Belt and braces: even if its Payment were handed in as unknown, the cash is covered.
  const p2 = L.planQboPaidReconcile({ payments: [mage('pay-1', 30_000, 'P1')], totalAmt: 30_000, linkedPayments: [{ id: 'P1', applied: 30_000 }] });
  check('...even when QuickBooks lists that same Payment', !p2.changed && p2.amountPaid === 30_000);

  // A pay-link payment MAGE had not pushed yet; the bookkeeper keyed it in.
  const p3 = L.planQboPaidReconcile({ payments: [stripe('stripe-cs_1', 30_000)], totalAmt: 30_000, linkedPayments: [{ id: 'P9', txnDate: '2026-09-12', applied: 30_000 }] });
  check('a Stripe payment the bookkeeper keyed in is MATCHED, not added', p3.appended.length === 0 && p3.matched.join() === 'stripe-cs_1', JSON.stringify(p3));
  check('...its qboId is stamped so the push sweep never sends it', p3.ledger[0].qboId === 'P9' && p3.changed);
  check('...and the cash is still $30,000', p3.amountPaid === 30_000);

  // Legacy row the old reconciler already doubled: must not grow a third copy.
  const legacy = [mage('pay-1', 30_000, 'P1'), { id: 'qbo-5-1726000000000', amount: 30_000, method: 'qbo', source: 'qbo' as const }];
  const p4 = L.planQboPaidReconcile({ payments: legacy, totalAmt: 30_000, linkedPayments: [] });
  check('an already-doubled legacy row gains nothing more', !p4.changed);
}

// ── 2. money that really arrived in QuickBooks still comes back ────────────
console.log('\n  2. payments entered only in QuickBooks');
{
  const p = L.planQboPaidReconcile({ payments: [], totalAmt: 30_000, linkedPayments: [{ id: 'P5', txnDate: '2026-09-10', applied: 30_000 }] });
  check('paid only in QuickBooks: one entry, keyed by the QuickBooks Payment id',
    p.appended.length === 1 && p.appended[0].id === 'qbo-payment-P5' && p.appended[0].amount === 30_000, JSON.stringify(p));
  check('...dated with the Payment\'s own TxnDate, not today', p.appended[0].date?.slice(0, 10) === '2026-09-10', p.appended[0].date);
  // Every reader does `new Date(p.date)`. A bare 'YYYY-MM-DD' is UTC midnight:
  // the evening before in every US timezone, so Sep 10 rendered as Sep 9.
  const shown = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(p.appended[0].date as string));
  check('...stored as an instant that reads as Sep 10 in Honolulu, Los Angeles, New York (not the day before)',
    ['Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York', 'UTC'].every((tz) => shown(tz) === '2026-09-10'),
    ['Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York'].map(shown).join());
  check('...tagged so payment.ts never pushes it back', p.appended[0].source === 'qbo' && p.appended[0].qboId === 'P5');
  const again = L.planQboPaidReconcile({ payments: p.ledger, totalAmt: 30_000, linkedPayments: [] });
  check('...and a second run is a no-op', !again.changed && again.amountPaid === 30_000);

  const partial = L.planQboPaidReconcile({
    payments: [mage('pay-1', 10_000, 'P1')], totalAmt: 30_000,
    linkedPayments: [{ id: 'P2', txnDate: '2026-09-14', applied: 20_000 }],
  });
  check('$10k in MAGE + $20k in QuickBooks: only the $20k is added',
    partial.appended.length === 1 && partial.appended[0].amount === 20_000 && partial.amountPaid === 30_000, JSON.stringify(partial));

  // Capped at the shortfall: never book more than QuickBooks says was owed.
  const trimmed = L.planQboPaidReconcile({
    payments: [mage('pay-1', 25_000, 'P1')], totalAmt: 30_000,
    linkedPayments: [{ id: 'P3', txnDate: '2026-09-15', applied: 10_000 }],
  });
  check('a QuickBooks payment larger than the shortfall is trimmed to it',
    trimmed.appended[0]?.amount === 5_000 && trimmed.amountPaid === 30_000, JSON.stringify(trimmed));

  // Exact to the cent.
  const cents = L.planQboPaidReconcile({
    payments: [mage('a', 0.1, 'Q1'), mage('b', 0.2, 'Q2')], totalAmt: 1000.33,
    linkedPayments: [{ id: 'Q3', txnDate: '2026-09-15', applied: 1000.03 }],
  });
  check('amounts stay exact to the cent', cents.appended[0]?.amount === 1000.03 && cents.amountPaid === 1000.33, JSON.stringify(cents));

  const noDate = L.planQboPaidReconcile({ payments: [], totalAmt: 500, linkedPayments: [{ id: 'P7', applied: 500 }], fallbackDate: '2026-09-16' });
  check('a Payment without TxnDate is dated from QuickBooks\' last change, never left undated', noDate.appended[0]?.date === '2026-09-16T12:00:00.000Z', noDate.appended[0]?.date);
  check('a malformed day is left undated rather than guessed', L.ledgerInstantForDay('2026-9-1') === undefined);
}

// ── 3. what is NOT cash is not booked as cash ──────────────────────────────
console.log('\n  3. closed without a payment, refunds');
{
  const credit = L.planQboPaidReconcile({ payments: [], totalAmt: 30_000, linkedPayments: [] });
  check('closed by a credit memo / journal entry: nothing booked', !credit.changed && credit.amountPaid === 0);
  check('...and the gap is reported', credit.unexplained === 30_000);
  const note = L.closedWithoutPaymentNote(credit.unexplained);
  check('...as the flag qbo-setup counts and dunning pauses on',
    L.isClosedWithoutPaymentNote(note) && note.startsWith(L.QBO_CLOSED_WITHOUT_PAYMENT_PREFIX) && /\$30000\.00/.test(note), note);
  check('...which a tax note or a push error is not',
    !L.isClosedWithoutPaymentNote('QuickBooks charged $12.00 of sales tax on invoice #4') && !L.isClosedWithoutPaymentNote(null));
  check('...and whose prefix needs no escaping in a PostgREST like', /^[A-Za-z ]+$/.test(L.QBO_CLOSED_WITHOUT_PAYMENT_PREFIX));

  const refunded = L.planQboPaidReconcile({
    payments: [stripe('stripe-cs_1', 30_000), { id: 'stripe-refund-re_1', amount: -30_000, method: 'stripe', kind: 'refund' }],
    totalAmt: 30_000, linkedPayments: [],
  });
  check('a refunded Stripe payment is not re-added as a "shortfall"', !refunded.changed && refunded.amountPaid === 0, JSON.stringify(refunded));

  // The one that separates "cash received" from "net ledger": $20k pushed,
  // $10k Stripe payment later refunded, and QuickBooks still shows the invoice
  // paid through a $10k Payment the bookkeeper keyed before the refund. Netting
  // the refund would open a $10k "shortfall" and book the refunded money again.
  const rePaid = L.planQboPaidReconcile({
    payments: [
      mage('pay-1', 20_000, 'P1'),
      { ...stripe('stripe-cs_2', 10_000), paymentIntentId: 'pi_2' },
      { id: 'stripe-refund-re_2', amount: -10_000, method: 'stripe', kind: 'refund', paymentIntentId: 'pi_2' },
    ],
    totalAmt: 30_000,
    linkedPayments: [{ id: 'P2', txnDate: '2026-09-12', applied: 10_000 }],
  });
  check('refunded money QuickBooks still counts is never booked back into MAGE',
    rePaid.appended.length === 0 && rePaid.amountPaid === 20_000, JSON.stringify(rePaid));
}

// ── 4. #15: which payments still have to reach QuickBooks ──────────────────
console.log('\n  4. the push sweep');
{
  const ledger: Entry[] = [
    stripe('stripe-cs_1', 12_500),                                   // pay-link — push
    mage('pay-2', 4_000),                                            // recorded, push failed — push
    mage('pay-3', 9_000, 'P3'),                                      // already in QuickBooks
    { id: 'qbo-payment-P8', amount: 700, method: 'qbo', source: 'qbo', qboId: 'P8' }, // came from QuickBooks
    { id: 'stripe-refund-re_1', amount: -500, method: 'stripe', kind: 'refund' },     // not a Payment
    { ...mage('pay-4', 300), qboAttempts: 5, qboError: 'QuickBooks already shows invoice #3 paid' }, // given up
  ];
  const todo = L.paymentsToPushToQbo(ledger).map((e) => e.id);
  check('pay-link and failed pushes are swept; pushed, pulled, refunds and exhausted ones are not',
    todo.join() === 'stripe-cs_1,pay-2', todo.join());
  check('the setup screen still counts the exhausted one (it is still not in QuickBooks)',
    L.countPaymentsNotInQbo(ledger) === 3);
  check(`attempts are capped at ${L.MAX_PAYMENT_PUSH_ATTEMPTS}`, L.MAX_PAYMENT_PUSH_ATTEMPTS === 5);

  const refundedLedger: Entry[] = [
    { ...stripe('stripe-cs_9', 800), paymentIntentId: 'pi_9' },
    { id: 'stripe-refund-re_9', amount: -300, method: 'stripe', kind: 'refund', paymentIntentId: 'pi_9' },
  ];
  check('a Stripe payment since refunded is not pushed as if the money stayed',
    L.paymentsToPushToQbo(refundedLedger).length === 0);
  check('...but it is still counted as not in QuickBooks (a bookkeeper has to record the net)',
    L.countPaymentsNotInQbo(refundedLedger) === 1);

  // History is never pushed blind: a bookkeeper may have keyed it as an
  // unlinked deposit, which matching cannot see.
  const floor = L.PAYMENT_SWEEP_FLOOR;
  const dated: Entry[] = [
    { ...stripe('old', 100), date: '2026-03-02T15:00:00.000Z' },
    { ...stripe('new', 200), date: new Date(Date.parse(floor) + 3_600_000).toISOString() },
    { id: 'undated', amount: 300, method: 'check' },
  ];
  check('with the floor, only payments dated on/after it are swept (not history, not undated)',
    L.paymentsToPushToQbo(dated, { notBefore: floor }).map((e) => e.id).join() === 'new',
    L.paymentsToPushToQbo(dated, { notBefore: floor }).map((e) => e.id).join());
  check('...while the setup count still shows all three for a person', L.countPaymentsNotInQbo(dated) === 3);
  check('the floor is the later of the sweep start and the connection',
    L.paymentSweepFloor('2025-01-01T00:00:00Z') === floor && L.paymentSweepFloor(null) === floor &&
    L.paymentSweepFloor('2027-02-01T00:00:00.000Z') === '2027-02-01T00:00:00.000Z');

  // A read failure on ONE object must not stall the user's whole run.
  check('a 400 Object Not Found / 404 on one invoice is a per-object error',
    L.isPerObjectQboError(new Error('QBO 400 /invoice/77: Object Not Found')) && L.isPerObjectQboError(new Error('QBO 404 /payment/9: gone')));
  check('...a 401, 429, 5xx, timeout or token failure is not',
    ['QBO 401 /invoice/1: x', 'QBO 429 /invoice/1: x', 'QBO 503 /invoice/1: x', 'The signal has been aborted', 'refresh failed: invalid_grant']
      .every((m) => !L.isPerObjectQboError(new Error(m))));

  const failed = L.markPushFailure(ledger, 'pay-2', 'Invoice not yet synced to QBO');
  const f = failed?.find((e) => e.id === 'pay-2');
  check('a failed push is written onto that entry', f?.qboError === 'Invoice not yet synced to QBO' && f?.qboAttempts === 1);
  check('...leaving every other entry untouched', failed?.length === ledger.length &&
    JSON.stringify(failed?.filter((e) => e.id !== 'pay-2')) === JSON.stringify(ledger.filter((e) => e.id !== 'pay-2')));
  check('...and never onto an entry that has since been pushed', L.markPushFailure(ledger, 'pay-3', 'x') === null);

  // The app rewrote `payments` from a copy older than pay-1's qboId: QuickBooks
  // HAS P1, the ledger lost the id. Matching must restore it, not re-push.
  const lostId = [mage('pay-1', 30_000), mage('pay-2', 5_000)];
  const m = L.matchUnpushedPayments(lostId, [{ id: 'P1', txnDate: '2026-09-10', applied: 30_000 }]);
  check('an entry whose qboId was clobbered is matched back to its QuickBooks Payment',
    m.matches.length === 1 && m.matches[0].entryId === 'pay-1' && m.matches[0].qboId === 'P1', JSON.stringify(m.matches));
  const written = L.applyQboMatches([...lostId, stripe('stripe-cs_new', 99)], m.matches);
  check('...applied to a FRESH read by id, keeping a payment written in between',
    written?.length === 3 && written[0].qboId === 'P1' && !written[1].qboId && written[2].id === 'stripe-cs_new');
  const two = L.matchUnpushedPayments([mage('a', 100), mage('b', 100)], [{ id: 'X', applied: 100 }]);
  check('matching is one-to-one', two.matches.length === 1);
  const off = L.matchUnpushedPayments([mage('a', 100)], [{ id: 'X', applied: 100.01 }]);
  check('...and exact to the cent', off.matches.length === 0);
}

// ── 5. qbo-setup's count is the server rule ────────────────────────────────
console.log('\n  5. the setup screen counts what the reconciler works down');
{
  const screen = read('app/qbo-setup.tsx');
  const BEGIN = '// --- BEGIN paymentsNotInQuickBooks';
  const END = '// --- END paymentsNotInQuickBooks ---';
  const a = screen.indexOf(BEGIN), b = screen.indexOf(END);
  if (a < 0 || b < 0) {
    check('qbo-setup keeps the paymentsNotInQuickBooks sentinels', false);
  } else {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(screen.slice(a, b));
    const clientCount = new Function(`${js}\nreturn paymentsNotInQuickBooks;`)() as
      (invs: { qboId?: string; payments: unknown }[]) => number;
    const fixtures: Entry[][] = [
      [stripe('s', 1), mage('m', 2), mage('p', 3, 'P')],
      [{ id: 'q', amount: 5, source: 'qbo' }, { id: 'r', amount: -5, kind: 'refund' }, { id: 'z', amount: 0 }],
      [{ ...mage('x', 7), qboAttempts: 9 }, { id: 'y', amount: 4, method: 'qbo' }, { id: 'd', amount: 3, kind: 'dispute' }],
    ];
    for (const [i, f] of fixtures.entries()) {
      check(`fixture ${i + 1}: client ${clientCount([{ qboId: 'INV', payments: f }])} = server ${L.countPaymentsNotInQbo(f)}`,
        clientCount([{ qboId: 'INV', payments: f }]) === L.countPaymentsNotInQbo(f));
    }
    check('...and an invoice not in QuickBooks is not counted (it shows under Errors/Pending)',
      clientCount([{ payments: fixtures[0] }]) === 0);
    check('the screen renders the count', /testID="qbo-payments-unsynced"/.test(screen) &&
      /paymentsNotInQuickBooks\(ledgerRows\)/.test(screen));
    // The device's invoices were empty while loading (a false "all in
    // QuickBooks") and lacked the qboId payment.ts stamps server-side (a false
    // "not in QuickBooks yet"). The count is the server's ledger.
    check('...counted from the server read, not the device copy of invoices',
      /\.from\('invoices'\)\s*\.select\('id,number,qbo_id,payments,qbo_error'\)/.test(screen) && !/useFinancialsData\(\)/.test(screen));
    check('...and says nothing reassuring until that read has landed',
      /\{unsyncedPayments === null \? \(/.test(screen) && /ledgerRows \? paymentsNotInQuickBooks\(ledgerRows\) : null/.test(screen));
    const clientPrefix = /const QBO_CLOSED_WITHOUT_PAYMENT_PREFIX = '([^']+)'/.exec(screen)?.[1];
    check('the screen\'s closed-without-payment prefix is the reconciler\'s', clientPrefix === L.QBO_CLOSED_WITHOUT_PAYMENT_PREFIX, clientPrefix);
    const closedCount = new Function(`${js}\nreturn invoicesClosedWithoutPayment;`)() as (r: { qboError?: string | null }[]) => number;
    check('...and it counts exactly the flagged invoices',
      closedCount([{ qboError: L.closedWithoutPaymentNote(5) }, { qboError: 'QuickBooks charged $1.00 of sales tax' }, {}]) === 1);
    check('the screen no longer promises every payment "in seconds"', !/payments to your books in seconds/.test(screen));

    // Round-3 critic: the sweep records WHY a payment was refused, but no
    // screen showed it, and the copy promised a retry that never comes.
    const stuck = new Function(`${js}\nreturn stuckQboPayments;`)() as
      (r: { number?: number; qboId?: string; payments: unknown }[]) => { invoiceNumber: unknown; amount: number; reason: string; state: string }[];
    const refusal = L.sweepPushRefusal(1000, 970.6, 12) ?? '';
    const rows = stuck([{ number: 12, qboId: 'Q', payments: [
      { id: 'a', amount: 1000, qboError: refusal, qboAttempts: 1 },
      { id: 'b', amount: 50, qboError: 'QBO 400 /payment: bad', qboAttempts: L.MAX_PAYMENT_PUSH_ATTEMPTS },
      { id: 'c', amount: 20, qboError: 'QBO 400 /payment: bad', qboAttempts: 1 },
      { id: 'd', amount: 30, qboId: 'P9', qboError: 'old' },
      { id: 'e', amount: 40 },
      { id: 'f', amount: 60, qboError: L.sweepPushRefusal(60, 0, 12), qboAttempts: 2 },
    ] }]);
    check('qbo-setup lists each refused / stopped payment with its recorded reason',
      rows.length === 4 && rows[0].invoiceNumber === 12 && rows[0].reason === refusal
      && rows.map((r) => r.state).join() === 'refused,stopped,retrying,refused', JSON.stringify(rows.map((r) => r.state)));
    check('...its attempt cap is the reconciler\'s',
      Number(/const QBO_PAYMENT_PUSH_MAX_ATTEMPTS = (\d+);/.exec(screen)?.[1]) === L.MAX_PAYMENT_PUSH_ATTEMPTS);
    check('...rendered, with copy that no longer promises every payment goes over next reconcile',
      /stuckPayments\.map\(/.test(screen) && /testID="qbo-stuck-payment"/.test(screen)
      && !/pushes that failed go over on the next reconcile/.test(screen));
    {
      // The invoice screen's read of the closed flag is the server's.
      const flagSpec = join(ROOT, 'utils', 'qboClosedFlag.ts');
      const C = await import(pathToFileURL(flagSpec).href) as {
        QBO_CLOSED_WITHOUT_PAYMENT_PREFIX: string; QBO_ERROR_APPEND_SEP: string; qboClosedFlagOf: (e: unknown) => string | null;
      };
      const both = `${L.closedWithoutPaymentNote(812.4)}\n\nAlso: QBO 400 /invoice: x`;
      check('the app\'s closed-flag reader matches the reconciler (prefix, separator, flag part)',
        C.QBO_CLOSED_WITHOUT_PAYMENT_PREFIX === L.QBO_CLOSED_WITHOUT_PAYMENT_PREFIX
        && [both, L.closedWithoutPaymentNote(5), 'QuickBooks charged $1.00 of sales tax', null, undefined]
          .every((x) => C.qboClosedFlagOf(x) === L.closedFlagOf(x))
        && C.qboClosedFlagOf(both) === L.closedWithoutPaymentNote(812.4));
      const inv = read('app/invoice.tsx');
      check('the invoice screen shows the flag by Send reminder and confirms a manual reminder on a flagged invoice',
        /const qboClosedFlag = qboClosedFlagOf\(existingInvoice\?\.qboError\);/.test(inv)
        && /testID="reminder-qbo-closed-flag"/.test(inv)
        && /if \(!qboClosedFlag\) \{ void handleSendReminder\(\); return; \}[\s\S]{0,400}'Send anyway'/.test(inv));
    }
    check('the cursor is labelled as what it is, not "Last reconcile"',
      !/Last reconcile:/.test(screen) && /QuickBooks changes read up to:/.test(screen));
  }
}

// ── 6. wiring the pure rules cannot see ────────────────────────────────────
console.log('\n  6. qbo-reconciler and qbo-sync use them');
{
  const rec = read('supabase/functions/qbo-reconciler/index.ts');
  check('the reconciler no longer appends a full TotalAmt payment',
    !/amount: qInv\.TotalAmt/.test(rec) && !/amount_paid: qInv\.TotalAmt/.test(rec));
  check('...nor decides on the source tag alone', !/payments\.some\(\(p\) => p\.source === "qbo"\)/.test(rec));
  check('...it plans from the ledger and writes the ledger sum',
    /const plan = planQboPaidReconcile\(\{/.test(rec) &&
    /if \(!plan\.changed\) \{[\s\S]{0,200}continue;\s*\}/.test(rec) &&
    /amount_paid: plan\.amountPaid,/.test(rec) &&
    /status: settlementStatus\(localInv\.status, plan\.amountPaid, localInv\)/.test(rec));
  check('...guarded against a concurrent write to the row',
    /if \(localInv\.updated_at\) upd = upd\.eq\("updated_at", localInv\.updated_at\)/.test(rec));
  check('...and reads LinkedTxn (a narrowed select drops it)',
    /select \* from Invoice where MetaData\.LastUpdatedTime/.test(rec));

  const sweepAt = rec.indexOf('1b) Push payments QuickBooks does not have');
  const pullAt = rec.indexOf('2) Pull QBO invoice updates');
  const sweep = sweepAt >= 0 && pullAt > sweepAt ? rec.slice(sweepAt, pullAt) : '';
  check('step 1b sweeps unsynced payments and pushes them', /paymentsToPushToQbo\(inv\.payments, /.test(sweep) &&
    /await upsertPaymentForInvoice\(row, `\$\{inv\.id\}::\$\{entry\.id\}`, row\.user_id\)/.test(sweep));
  check('...matching QuickBooks-side copies BEFORE any push', sweep.indexOf('matchUnpushedPayments(') > -1 &&
    sweep.indexOf('matchUnpushedPayments(') < sweep.indexOf('await upsertPaymentForInvoice('));
  check('...never pushing onto an invoice QuickBooks already shows paid (or open for less than the payment)',
    /const refusal = sweepPushRefusal\(Number\(entry\.amount\), balance, inv\.number, taxShortfall\);\s*if \(refusal\) \{\s*await recordFailure\(entry\.id, refusal\);\s*continue;\s*\}\s*try \{\s*await upsertPaymentForInvoice\(/.test(sweep));
  check('...recording each failure on the entry', /markPushFailure\(/.test(sweep));
  check('...never reaching back before the sweep floor', /paymentsToPushToQbo\(inv\.payments, \{ notBefore: sweepFloor \}\)/.test(sweep) &&
    /const sweepFloor = paymentSweepFloor\(/.test(sweep));
  // A deleted QuickBooks invoice used to throw out of the user's run every 30
  // minutes, forever: no pull, no cost staging, no cursor.
  const readTry = /try \{\s*qInv = await readInvoice\(\);[\s\S]*?fetchUnknownLinkedPayments\(row, qInv, ledger\)[\s\S]*?\} catch \(readErr\) \{\s*if \(!isPerObjectQboError\(readErr\)\) throw readErr;[\s\S]*?await recordFailure\([\s\S]*?continue;\s*\}/.exec(sweep);
  check('...its reads sit in a per-invoice try: a per-object 400/404 is charged to that invoice\'s payments and skipped',
    !!readTry);
  check('...and no read outside that try can throw the run', (sweep.match(/await readInvoice\(\)/g) ?? []).length === 2 &&
    (sweep.match(/fetchUnknownLinkedPayments\(/g) ?? []).length === 1 &&
    /balance = Number\(\(await readInvoice\(\)\)\?\.Balance \?\? NaN\);\s*\} catch \(e\) \{/.test(sweep));
  check('...waiting for the row to settle (an app push may be in flight)', /\.lt\("updated_at", settledCutoff\)/.test(sweep));

  check('an invoice QuickBooks closed without a payment is flagged, not silent',
    /const flag = plan\.unexplained > 0 \? closedWithoutPaymentNote\(plan\.unexplained\) : null;/.test(rec) &&
    /\.\.\.flagChange,/.test(rec) && /update\(flagChange\)/.test(rec));
  {
    const fl = L.closedWithoutPaymentNote(400);
    const pushErr = 'QBO 400 /invoice: Business Validation Error';
    const ch = L.closedFlagChange(pushErr, fl);
    check('an invoice whose own push is in error STILL gets the closed-without-payment flag (dunning pauses)',
      typeof ch.qbo_error === 'string' && L.closedFlagOf(ch.qbo_error) === fl && ch.qbo_error.endsWith(pushErr), JSON.stringify(ch));
    check('...and the reconciler no longer skips errored rows for it',
      /const flagChange = closedFlagChange\(localInv\.qbo_error, flag\);/.test(rec) && !/qbo_sync_status === "error" \? \{\}/.test(rec));
    check('...an unchanged flag writes nothing; a lifted one keeps the push error',
      !('qbo_error' in L.closedFlagChange(ch.qbo_error, fl)) && L.closedFlagChange(ch.qbo_error, null).qbo_error === pushErr);
  }
  check('...and the flag lifts when QuickBooks reopens the invoice (keeping any push error after it)',
    /\.update\(\{ qbo_error: withoutClosedFlag\(f\.qbo_error\) \}\)[\s\S]{0,160}\.like\("qbo_error", `\$\{QBO_CLOSED_WITHOUT_PAYMENT_PREFIX\}%`\)/.test(rec) &&
    !/\.update\(\{ qbo_error: null \}\)/.test(rec));
  const dun = read('supabase/functions/invoice-dunning/index.ts');
  check('invoice-dunning\'s cron does not chase an invoice QuickBooks closed',
    /if \(!manual && isClosedWithoutPaymentNote\(invoice\.qbo_error\)\) \{\s*return skip\('closed_in_quickbooks'\);/.test(dun) &&
    (dun.match(/dunning_last_sent_at,qbo_error'\)/g) ?? []).length === 2);

  const sync = read('supabase/functions/qbo-sync/index.ts');
  check('qbo-sync records a failed payment push on the entry',
    /if \(body\.kind === 'payment'\) \{[\s\S]{0,700}markPushFailure\(/.test(sync));
  check('qbo-sync does not spend a payment attempt on a QuickBooks outage',
    /markPushFailure\([^;]*paymentId, errMsg, \{\s*countAttempt: !isQboOutageError\(e\),\s*\}\)/.test(sync));
  {
    const base = [{ id: 'o1', amount: 100, date: '2026-09-10', qboAttempts: 2 }];
    const out = L.markPushFailure(base, 'o1', 'QBO 503 /payment: down', { countAttempt: false });
    check('...an outage stamp records the message but leaves the attempt count',
      !!out && (out[0] as { qboAttempts?: number }).qboAttempts === 2 && /503/.test(String((out[0] as { qboError?: string }).qboError)));
    const charged = L.markPushFailure(base, 'o1', 'QBO 400 /payment: bad');
    check('...a per-payment failure still counts', !!charged && (charged[0] as { qboAttempts?: number }).qboAttempts === 3);
  }

  const webhook = read('supabase/functions/stripe-webhook/index.ts');
  check('stripe-webhook stays out of QuickBooks (token rotation race; a QBO outage must not fail a Stripe delivery)',
    !/qbo/i.test(webhook));
}

// ── 7. round 3: the sweep, the flag and the cursor (integration critics) ──
console.log('\n  7. money-accounts round 3 — sweep refusals, outages, the flag, the cursor');
{
  // (a) A balance above $0 but below the payment: the bookkeeper keyed it in
  //     net of Stripe's fee. payment.ts would push the full amount and park
  //     the gap as unapplied credit — the income counted twice.
  const net = L.sweepPushRefusal(1000, 970.6, 12);
  check('a $1,000 payment on an invoice QuickBooks shows $970.60 open is refused',
    !!net && /QuickBooks shows only \$970\.60 open on invoice #12/.test(net) && /already entered/.test(net), String(net));
  check('...paid in full in QuickBooks is refused too', /already shows invoice #12 paid/.test(L.sweepPushRefusal(1000, 0, 12) ?? ''));
  check('...an exact or smaller payment goes through', L.sweepPushRefusal(970.6, 970.6, 12) === null && L.sweepPushRefusal(500, 970.6, 12) === null);
  check('...a one-cent rounding gap is not a refusal', L.sweepPushRefusal(970.61, 970.6, 12) === null);
  check('...but two cents is — compared in whole cents, not floats', L.sweepPushRefusal(0.1 + 0.2 + 970.3, 970.58, 12) !== null);
  check('...an unknown balance is left to payment.ts (which refuses blind itself)', L.sweepPushRefusal(1000, NaN, 12) === null);

  // (a2) QuickBooks' Automated Sales Tax charged LESS tax than MAGE (invoice.ts
  //      syncs that invoice with a tax note). $10,000 job, MAGE 8.25% ($825),
  //      QuickBooks 7% ($700): the $10,825 payment against $10,700 open is not
  //      a duplicate and must be pushed; payment.ts parks the $125 as credit.
  const taxGap = L.qboTaxShortfall(825, 700);
  check('tax recompute: the shortfall is MAGE tax − QuickBooks tax ($125)', taxGap === 125, String(taxGap));
  check('...a tax-recompute shortfall is PUSHED (full payment)', L.sweepPushRefusal(10825, 10700, 12, taxGap) === null);
  check('...and the final installment after a $5,000 deposit', L.sweepPushRefusal(5825, 5700, 12, taxGap) === null);
  check('...a net-of-fees shortfall is still refused on a taxed invoice (gap beyond the tax)',
    L.sweepPushRefusal(10825, 10500, 12, taxGap) !== null);
  check('...and with no tax gap at all', L.sweepPushRefusal(1000, 970.6, 12, L.qboTaxShortfall(0, 0)) !== null);
  check('...QuickBooks charging MORE tax gives no allowance', L.qboTaxShortfall(700, 825) === 0);
  check('...no TxnTaxDetail on the read gives no allowance (cannot tell tax from a duplicate)',
    L.qboTaxShortfall(825, undefined) === 0);
  check('...paid in full in QuickBooks is refused even inside the allowance', L.sweepPushRefusal(125, 0, 12, 125) !== null);
  check('...the refusal names both causes and says it will not be sent as things stand',
    /already entered/.test(net ?? '') && /sales tax/.test(net ?? '') && /will not send it/.test(net ?? ''), String(net));
  {
    const rec = read('supabase/functions/qbo-reconciler/index.ts');
    check('the sweep gives the tax allowance only when every QuickBooks payment on the invoice is known',
      /const taxShortfall = unknown\.length === matches\.length\s*\?\s*qboTaxShortfall\(inv\.tax_amount, qInv\.TxnTaxDetail\?\.TotalTax\)\s*:\s*0;/.test(rec)
      && /\.select\("id,number,qbo_id,payments,tax_amount"\)/.test(rec));
  }

  // (b) An outage is not the payment's fault.
  for (const m of ['QBO 429 /payment: Throttle', 'QBO 503 /payment: x', 'QBO 401 /payment: x', 'Intuit token refresh 400: invalid_grant',
    'The signal has been aborted', 'error sending request for url (https://quickbooks.api.intuit.com/v3)', 'invoice read: connection refused',
    'invoice re-read: timeout']) {
    check(`outage: "${m.slice(0, 40)}" is not charged to the payment`, L.isQboOutageError(new Error(m)));
  }
  const abort = new Error('x'); abort.name = 'AbortError';
  check('...nor an AbortError', L.isQboOutageError(abort));
  for (const m of ['QBO 400 /payment: Business Validation Error', 'Project missing QBO customer', 'Invoice not yet synced to QBO — cannot apply payment',
    'payment not found in invoice.payments', 'QBO did not return a Payment.Id']) {
    check(`per-payment: "${m.slice(0, 40)}" IS charged (else it stalls the run forever)`, !L.isQboOutageError(new Error(m)));
  }

  // (c) The closed-without-payment flag survives every push writer.
  const flag = L.closedWithoutPaymentNote(812.4);
  const tax = 'QuickBooks charged $12.00 of sales tax on invoice #4';
  const pushErr = 'QBO 400 /invoice: Stale object';
  const kept = L.keepClosedFlag(flag, tax);
  check('a successful push keeps the flag at the front (dunning still sees it)', L.isClosedWithoutPaymentNote(kept) && kept === `${flag}${L.QBO_ERROR_APPEND_SEP}${tax}`, String(kept));
  check('...a clean push leaves exactly the flag', L.keepClosedFlag(flag, null) === flag);
  const failedAfter = L.keepClosedFlag(kept, pushErr);
  check('...a failed push after that replaces the old message, not the flag', failedAfter === `${flag}${L.QBO_ERROR_APPEND_SEP}${pushErr}`, String(failedAfter));
  check('...no flag, no change to what a writer writes', L.keepClosedFlag(tax, pushErr) === pushErr && L.keepClosedFlag(null, null) === null);
  check('the flag part and the rest split cleanly', L.closedFlagOf(failedAfter) === flag && L.withoutClosedFlag(failedAfter) === pushErr &&
    L.withoutClosedFlag(flag) === null && L.withoutClosedFlag(tax) === tax && L.closedFlagOf(tax) === null);

  const inv = read('supabase/functions/_shared/qbo-mapping/invoice.ts');
  const B = '// --- BEGIN keepClosedFlag', E = '// --- END keepClosedFlag ---';
  const ia = inv.indexOf(B), ib = inv.indexOf(E);
  if (ia < 0 || ib < 0) check('invoice.ts keeps its keepClosedFlag sentinels', false);
  else {
    const twin = new Function(`${new Bun.Transpiler({ loader: 'ts' }).transformSync(inv.slice(ia, ib))}\nreturn keepClosedFlag;`)() as
      (e: unknown, n: string | null) => string | null;
    const cases: [unknown, string | null][] = [[flag, tax], [flag, null], [kept, pushErr], [tax, pushErr], [null, null], [undefined, tax], [failedAfter, null]];
    check('invoice.ts\'s twin keepClosedFlag agrees with paymentLedger\'s on every case',
      cases.every(([e, n]) => twin(e, n) === L.keepClosedFlag(e, n)),
      JSON.stringify(cases.map(([e, n]) => [twin(e, n), L.keepClosedFlag(e, n)])));
  }
  check('invoice.ts writes qbo_error through it, from the row it read',
    /qbo_error: keepClosedFlag\(inv\.qbo_error, totalsAgree \? taxNote : \(/.test(inv) && /qbo_error\?: string \| null;/.test(inv));
  const rec = read('supabase/functions/qbo-reconciler/index.ts');
  check('the reconciler\'s invoice-retry failure keeps the flag',
    /\.select\("id,qbo_retry_count,qbo_error"\)/.test(rec) && /qbo_error: keepClosedFlag\(p\.qbo_error, String\(/.test(rec));
  {
    // The rule moved into the pure closedFlagChange (asserted by behaviour).
    const taxNote = 'QuickBooks charged $70.00 of sales tax on invoice #3 where MAGE computed $82.50';
    const fl = L.closedWithoutPaymentNote(90);
    const ch = L.closedFlagChange(taxNote, fl);
    check('...and setting the flag keeps a tax note already on the row',
      /const flagChange = closedFlagChange\(localInv\.qbo_error, flag\);/.test(rec) &&
      typeof ch.qbo_error === 'string' && L.closedFlagOf(ch.qbo_error) === fl && ch.qbo_error.endsWith(taxNote));
  }
  const sync = read('supabase/functions/qbo-sync/index.ts');
  check('qbo-sync\'s invoice failure reads the row and keeps the flag',
    /if \(body\.kind === 'invoice'\) \{[\s\S]{0,300}\.select\('qbo_error'\)[\s\S]{0,300}qbo_error: keepClosedFlag\(/.test(sync) &&
    !/qbo_error: errMsg/.test(sync));

  // (d) The sweep's push catch: outage rethrown BEFORE any attempt is charged.
  check('the sweep rethrows an outage instead of charging the payment\'s attempts',
    /\} catch \(e\) \{[\s\S]{0,700}if \(isQboOutageError\(e\)\) throw e;\s*await recordFailure\(entry\.id, e\);/.test(rec));

  // (e) The invoice-pull cursor.
  const start = Date.parse('2026-09-17T15:00:00.000Z');
  const caught = L.nextInvoicePullCursor({ sinceIso: '2026-09-17T14:25:00.000Z', queryStartMs: start, rows: [{ MetaData: { LastUpdatedTime: '2026-09-17T07:40:00-07:00' } }] });
  check('caught up: the cursor is the QUERY START minus 5 minutes, not the end of the run',
    caught === '2026-09-17T14:55:00.000Z', caught);
  check('...never moving backwards', L.nextInvoicePullCursor({ sinceIso: '2026-09-17T14:58:00.000Z', queryStartMs: start, rows: [] }) === '2026-09-17T14:58:00.000Z');
  const full = Array.from({ length: L.INVOICE_PULL_PAGE_SIZE }, (_, i) => ({ MetaData: { LastUpdatedTime: new Date(Date.parse('2021-03-01T00:00:00Z') + i * 60_000).toISOString() } }));
  const fullNext = L.nextInvoicePullCursor({ sinceIso: null, queryStartMs: start, rows: full });
  check('a full first page resumes from the newest row it saw (everything past 200 is pulled next run)',
    fullNext === full[full.length - 1].MetaData.LastUpdatedTime, fullNext);
  const same = Array.from({ length: L.INVOICE_PULL_PAGE_SIZE }, () => ({ MetaData: { LastUpdatedTime: '2021-03-01T00:00:00.000Z' } }));
  check('...a full page stuck on one second steps past it rather than looping',
    L.nextInvoicePullCursor({ sinceIso: '2021-03-01T00:00:00.000Z', queryStartMs: start, rows: same }) === '2021-03-01T00:00:01.000Z');
  check('the query is ordered and inclusive, one page of INVOICE_PULL_PAGE_SIZE',
    /select \* from Invoice where MetaData\.LastUpdatedTime >= '\$\{since\}' orderby MetaData\.LastUpdatedTime MAXRESULTS \$\{INVOICE_PULL_PAGE_SIZE\}/.test(rec));
  const startAt = rec.indexOf('const invoicePullStartMs = Date.now();');
  const queryAt = rec.indexOf('select * from Invoice where');
  check('...its start is taken BEFORE the query runs', startAt > -1 && startAt < queryAt);
  check('...and the cursor is stamped from it, not from "now"',
    /last_sync_at: nextInvoicePullCursor\(\{ sinceIso: row\.last_sync_at, queryStartMs: invoicePullStartMs, rows: updated \}\)/.test(rec) &&
    !/last_sync_at: new Date\(\)\.toISOString\(\)/.test(rec));
}

// ── 8. payment.ts never loses a payment written while it was pushing ──────
// Executes the REAL payment.ts (copied byte-for-byte beside stubs, the way
// validate-money-definitions runs it): the Stripe webhook adds a payment to
// the same invoice between payment.ts's first read and its write-back.
console.log('\n  8. payment.ts — a concurrent payment write survives the push');
{
  const dir = mkdtempSync(join(tmpdir(), 'mage-qbo-pay-'));
  mkdirSync(join(dir, '_shared', 'qbo-mapping'), { recursive: true });
  copyFileSync(join(ROOT, 'supabase/functions/_shared/qbo-mapping/payment.ts'), join(dir, '_shared', 'qbo-mapping', 'payment.ts'));
  writeFileSync(join(dir, '_shared', 'qbo-mapping', 'invoice.ts'), 'export async function upsertInvoice() {}\n');
  writeFileSync(join(dir, '_shared', 'qbo.ts'), `
export interface QboConnectionRow { realm_id?: string }
const H = () => (globalThis as any).__PAY_HARNESS;
export async function qboFetch(_c: unknown, path: string, init: any) { return H().fetch(path, init); }
export function svc() {
  return {
    from(table: string) {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: H().read(table), error: null }),
        update: (patch: any) => { H().updates.push({ table, patch }); const t: any = { eq: () => t, then: (r: any) => r({ error: null }) }; return t; },
      };
      return q;
    },
  };
}
`);
  type Harness = { reads: number; updates: { table: string; patch: { payments?: Entry[] } }[]; read: (t: string) => unknown; fetch: (p: string, i: { method?: string }) => unknown };
  const run = async (later: Entry[] | null) => {
    const base = { id: 'inv-1', project_id: 'p1', user_id: 'u1', number: 7, qbo_id: 'Q-INV' };
    const first = [{ ...stripe('stripe-cs_1', 400), qboError: 'QBO 503 earlier' }];
    const h: Harness = {
      reads: 0, updates: [],
      read(t) {
        if (t === 'projects') return { qbo_customer_id: 'CUST-1' };
        h.reads++;
        return { ...base, payments: h.reads === 1 ? first : later };
      },
      fetch(path, init) {
        if (init?.method === 'GET' && path.startsWith('/invoice/')) return { Invoice: { Balance: 1000 } };
        if (path === '/payment') return { Payment: { Id: 'P-77' } };
        return {};
      },
    };
    (globalThis as { __PAY_HARNESS?: unknown }).__PAY_HARNESS = h;
    const mod = await import(pathToFileURL(join(dir, '_shared', 'qbo-mapping', 'payment.ts')).href) as
      { upsertPaymentForInvoice: (c: unknown, id: string, u: string) => Promise<void> };
    let threw = '';
    try { await mod.upsertPaymentForInvoice({}, 'inv-1::stripe-cs_1', 'u1'); } catch (e) { threw = (e as Error).message; }
    return { h, threw, written: h.updates.filter((u) => u.table === 'invoices').at(-1)?.patch.payments };
  };
  const warn = console.warn; console.warn = () => {};
  const concurrent = await run([stripe('stripe-cs_1', 400), stripe('stripe-cs_2', 250)]);
  check('the push stamps its own entry', concurrent.threw === '' &&
    concurrent.written?.find((e) => e.id === 'stripe-cs_1')?.qboId === 'P-77', concurrent.threw || JSON.stringify(concurrent.written));
  check('...and KEEPS the payment the webhook wrote while QuickBooks was answering',
    concurrent.written?.some((e) => e.id === 'stripe-cs_2' && e.amount === 250 && !e.qboId) === true, JSON.stringify(concurrent.written));
  check('...clearing the entry\'s stale push error', concurrent.written?.find((e) => e.id === 'stripe-cs_1')?.qboError === undefined);
  const removed = await run([stripe('stripe-cs_2', 250)]);
  check('an entry deleted mid-push is not written back (no resurrection, no throw)', removed.threw === '' && removed.written === undefined,
    removed.threw || JSON.stringify(removed.written));
  console.warn = warn;
}

if (failures > 0) {
  console.error(`\n✗ validate-qbo-payment-ledger: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ validate-qbo-payment-ledger: all checks passed\n');
