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
type Linked = { id: string; txnDate?: string | null; applied: number; credit?: number; createdAt?: string | null; mageEntryId?: string | null };
type Plan = { appended: Entry[]; matched: string[]; changed: boolean; ledger: Entry[]; amountPaid: number; unexplained: number; creditApplied: number; refundGap: number; uncountedQboIds: string[] };
interface LedgerModule {
  planQboPaidReconcile: (i: { payments: unknown; totalAmt: number; linkedPayments: Linked[]; fallbackDate?: string }) => Plan;
  paymentsToPushToQbo: (p: unknown, o?: { notBefore?: string | null }) => Entry[];
  paymentSweepFloor: (connCreatedAt: string | null | undefined) => string;
  PAYMENT_SWEEP_FLOOR: string;
  ledgerInstantForDay: (d: string | null | undefined) => string | undefined;
  isPerObjectQboError: (e: unknown) => boolean;
  QBO_CLOSED_WITHOUT_PAYMENT_PREFIX: string;
  closedWithoutPaymentNote: (n: number, creditApplied?: number) => string;
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
  linkedPaymentCash: (pay: unknown, invoiceQboId: string) => { cash: number; credit: number };
  toLinkedPayment: (pay: unknown, invoiceQboId: string, id?: string) => Linked;
  closedFlagForPlan: (plan: Plan) => string | null;
  alreadyPaidRefusal: (n: number | string) => string;
  magePaymentTag: (id: string) => string;
  mageEntryIdFromNote: (note: unknown) => string | null;
  reversalsNotInQbo: (p: unknown) => { entryId: string; amount: number; kind: string; paymentQboId: string }[];
  markReversalRecorded: (p: unknown, id: string, at: string, listedAmount?: number) => Entry[] | null;
  unsyncedPaymentState: (e: Entry, ledger: Entry[], floorIso?: string) => string;
  voidFlagFor: (i: { totalAmt: unknown; balance: unknown; mageOutstanding: number }) => string | null;
  voidedInQuickBooksNote: () => string;
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
  const p3 = L.planQboPaidReconcile({ payments: [stripe('stripe-cs_1', 30_000)], totalAmt: 30_000, linkedPayments: [{ id: 'P9', txnDate: '2026-09-12', applied: 30_000, createdAt: '2026-09-12T10:00:00-07:00' }] });
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
  // #100: …but QuickBooks paid while MAGE's net ledger is $30k short is not
  // silent any more — the flag pauses reminders and says what disagrees.
  const refundedFlag = L.closedFlagForPlan(refunded) ?? '';
  check('...and the disagreement is flagged (QuickBooks paid, MAGE net short by refunded cash)',
    refunded.refundGap === 30_000 && L.isClosedWithoutPaymentNote(refundedFlag) && /refunded or charged back/.test(refundedFlag)
      && !/credit memo, journal entry or write-off/.test(refundedFlag), refundedFlag);

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
  // #100 — the audit's exact ledger: the client paid again by check (P2), or
  // QuickBooks still carries the refunded money. MAGE cannot tell; it must SAY.
  const rePaidFlag = L.closedFlagForPlan(rePaid) ?? '';
  check('#100: ...and the $10k disagreement is flagged, naming the uncounted QuickBooks payment',
    rePaid.refundGap === 10_000 && rePaid.unexplained === 0 && L.isClosedWithoutPaymentNote(rePaidFlag)
      && /\$10000\.00 more than MAGE holds/.test(rePaidFlag) && /payment P2 was not counted/.test(rePaidFlag), rePaidFlag);
  const lifted = L.planQboPaidReconcile({
    payments: [...rePaid.ledger, mage('pay-p2', 10_000, 'P2')], totalAmt: 30_000, linkedPayments: [],
  });
  check('#100: ...and it lifts once the check is recorded in MAGE (net covers QuickBooks\' total)',
    L.closedFlagForPlan(lifted) === null && lifted.refundGap === 0, JSON.stringify(lifted));
  const fullyPushed = L.planQboPaidReconcile({ payments: [mage('pay-1', 30_000, 'P1')], totalAmt: 30_000, linkedPayments: [] });
  check('#100: an ordinary paid invoice raises no flag', L.closedFlagForPlan(fullyPushed) === null);
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
  const m = L.matchUnpushedPayments(lostId, [{ id: 'P1', txnDate: '2026-09-10', applied: 30_000, createdAt: '2026-09-10T16:00:00-07:00' }]);
  check('an entry whose qboId was clobbered is matched back to its QuickBooks Payment',
    m.matches.length === 1 && m.matches[0].entryId === 'pay-1' && m.matches[0].qboId === 'P1', JSON.stringify(m.matches));
  const written = L.applyQboMatches([...lostId, stripe('stripe-cs_new', 99)], m.matches);
  check('...applied to a FRESH read by id, keeping a payment written in between',
    written?.length === 3 && written[0].qboId === 'P1' && !written[1].qboId && written[2].id === 'stripe-cs_new');
  const two = L.matchUnpushedPayments([mage('a', 100), mage('b', 100)], [{ id: 'X', applied: 100, createdAt: '2026-09-10T16:00:00-07:00' }]);
  check('matching is one-to-one', two.matches.length === 1);
  const off = L.matchUnpushedPayments([mage('a', 100)], [{ id: 'X', applied: 100.01, createdAt: '2026-09-10T16:00:00-07:00' }]);
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
      /\.from\('invoices'\)\s*\.select\('id,number,qbo_id,payments,qbo_error,status'\)/.test(screen) && !/useFinancialsData\(\)/.test(screen));
    check('...and says nothing reassuring until that read has landed',
      /\{unsyncedPayments === null \? \(/.test(screen) && /ledgerRows \? paymentsNotInQuickBooks\(ledgerRows\) : null/.test(screen));
    const clientPrefix = /const QBO_CLOSED_WITHOUT_PAYMENT_PREFIX = '([^']+)'/.exec(screen)?.[1];
    check('the screen\'s closed-without-payment prefix is the reconciler\'s', clientPrefix === L.QBO_CLOSED_WITHOUT_PAYMENT_PREFIX, clientPrefix);
    const closedCount = new Function(`${js}\nreturn invoicesClosedWithoutPayment;`)() as (r: { qboError?: string | null; status?: string }[]) => { open: number; paidInMage: number };
    const cc = closedCount([{ qboError: L.closedWithoutPaymentNote(5) }, { qboError: 'QuickBooks charged $1.00 of sales tax' }, {},
      { qboError: L.closedWithoutPaymentNote(9), status: 'paid' }]);
    check('...and it counts exactly the flagged invoices, apart from those MAGE itself shows paid (#10)',
      cc.open === 1 && cc.paidInMage === 1, JSON.stringify(cc));
    check('the screen no longer promises every payment "in seconds"', !/payments to your books in seconds/.test(screen));

    // Round-3 critic: the sweep records WHY a payment was refused, but no
    // screen showed it, and the copy promised a retry that never comes.
    const stuck = new Function(`${js}\nreturn stuckQboPayments;`)() as
      (r: { number?: number; qboId?: string; payments: unknown }[]) => { invoiceNumber: unknown; amount: number; reason: string; state: string }[];
    const refusal = L.sweepPushRefusal(1000, 970.6, 12) ?? '';
    const D = '2026-09-18T10:00:00.000Z';
    const rows = stuck([{ number: 12, qboId: 'Q', payments: [
      { id: 'a', amount: 1000, qboError: refusal, qboAttempts: 1, date: D },
      { id: 'b', amount: 50, qboError: 'QBO 400 /payment: bad', qboAttempts: L.MAX_PAYMENT_PUSH_ATTEMPTS, date: D },
      { id: 'c', amount: 20, qboError: 'QBO 400 /payment: bad', qboAttempts: 1, date: D },
      { id: 'd', amount: 30, qboId: 'P9', qboError: 'old', date: D },
      { id: 'e', amount: 40, date: D },
      { id: 'f', amount: 60, qboError: L.sweepPushRefusal(60, 0, 12), qboAttempts: 2, date: D },
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
        QBO_REFUND_GAP_FLAG_MARKER: string; qboClosedFlagKind: (f: string) => string; qboClosedFlagAlertReason: (f: string) => string;
      };
      // #100 wording: each flag is explained by its OWN kind. The kinds are
      // read off the reconciler's real note text, so a reworded note that
      // drops a marker turns this red instead of silently falling to 'credit'.
      const gapNote = (L as unknown as { refundGapNote: (g: number, r: number, ids: string[]) => string }).refundGapNote(500, 500, ['77']);
      const kinds = [L.closedWithoutPaymentNote(300), L.voidedInQuickBooksNote(), gapNote].map((n) => C.qboClosedFlagKind(n));
      check('#100: the app reads each flag\'s kind off the reconciler\'s own notes (credit, void, refund gap)',
        kinds.join() === 'credit,void,refund_gap', kinds.join());
      check('#100: the "Send anyway" reason is true to the kind — a refund gap is not "cleared by something other than a payment"',
        !/something other than a payment/.test(C.qboClosedFlagAlertReason(gapNote)) && !/something other than a payment/.test(C.qboClosedFlagAlertReason(L.voidedInQuickBooksNote()))
          && /voided/.test(C.qboClosedFlagAlertReason(L.voidedInQuickBooksNote())) && /refunded or charged back/.test(C.qboClosedFlagAlertReason(gapNote)));
      {
        const cw = new Function(`${js}\nreturn invoicesClosedWithoutPayment;`)() as (r: { qboError?: string | null; status?: string }[]) => { open: number; paidInMage: number; refundGapPaid: number };
        const r = cw([{ qboError: gapNote, status: 'paid' }, { qboError: L.voidedInQuickBooksNote(), status: 'paid' }, { qboError: gapNote, status: 'sent' }]);
        check('#100: qbo-setup puts a refund gap MAGE shows paid on its own card, not the credit/void one',
          r.refundGapPaid === 1 && r.paidInMage === 1 && r.open === 1 && /testID="qbo-closed-refund-gap-paid"/.test(screen)
            && /const QBO_REFUND_GAP_MARKER = '([^']+)'/.exec(screen)?.[1] === C.QBO_REFUND_GAP_FLAG_MARKER, JSON.stringify(r));
      }
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
        && /if \(!qboClosedFlag\) \{ void handleSendReminder\(\); return; \}[\s\S]{0,700}'Send anyway'/.test(inv)
        && /\$\{qboClosedFlagAlertReason\(qboClosedFlag\)\} Send a reminder to the client anyway\?/.test(inv));
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
    /const flag = closedFlagForPlan\(plan\);/.test(rec) &&
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
    // Integration round 1: the flag is computed once, then the stamp rides
    // patchInvoiceLedger (conditional on updated_at).
    /const countAttempt = !isQboOutageError\(e\);\s*await patchInvoiceLedger\(s, invoiceId, auth\.userId,\s*\(payments\) => markPushFailure\(payments, paymentId, errMsg, \{ countAttempt \}\)\);/.test(sync));
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
        update: (patch: any) => {
          const filters: [string, unknown][] = []; const u = { table, patch, filters, landed: false }; H().updates.push(u);
          const t: any = {
            eq: (c: string, v: unknown) => { filters.push([c, v]); return t; },
            is: (c: string, v: unknown) => { filters.push([c, v]); return t; },
            // The swap: the UPDATE lands only while the row's updated_at is the one filtered on.
            select: () => ({ then: (r: any) => { u.landed = H().land(filters); return r({ data: u.landed ? [{ id: 'inv-1' }] : [], error: null }); } }),
            then: (r: any) => { u.landed = true; return r({ error: null }); },
          };
          return t;
        },
      };
      return q;
    },
  };
}
`);
  type Harness = { reads: number; stamp: number; posts: number; updates: { table: string; patch: { payments?: Entry[] }; filters: [string, unknown][]; landed: boolean }[]; read: (t: string) => unknown; land: (f: [string, unknown][]) => boolean; fetch: (p: string, i: { method?: string }) => unknown };
  // `later` is the ledger every re-read returns; `race`, when given, is what a
  // write landing between the re-read and the UPDATE puts there (once).
  // `alwaysMoves`: every UPDATE finds the row already moved (a writer lands
  // between each re-read and each swap) — the retry bound's case.
  const run = async (later: Entry[] | null, race?: Entry[], alwaysMoves = false) => {
    const base = { id: 'inv-1', project_id: 'p1', user_id: 'u1', number: 7, qbo_id: 'Q-INV' };
    const first = [{ ...stripe('stripe-cs_1', 400), qboError: 'QBO 503 earlier' }];
    let current = later;
    let raced = false;
    const h: Harness = {
      reads: 0, stamp: 0, posts: 0, updates: [],
      read(t) {
        if (t === 'projects') return { qbo_customer_id: 'CUST-1' };
        h.reads++;
        return { ...base, payments: h.reads === 1 ? first : current, updated_at: `t${h.stamp}` };
      },
      land(filters) {
        if (alwaysMoves) { h.stamp++; return false; }
        if (race && !raced) { raced = true; current = race; h.stamp++; }
        const swap = filters.find(([c]) => c === 'updated_at');
        if (!swap || swap[1] !== `t${h.stamp}`) return false;
        h.stamp++;
        return true;
      },
      fetch(path, init) {
        if (init?.method === 'GET' && path.startsWith('/invoice/')) return { Invoice: { Balance: 1000 } };
        if (path === '/payment') { h.posts++; return { Payment: { Id: 'P-77' } }; }
        return {};
      },
    };
    (globalThis as { __PAY_HARNESS?: unknown }).__PAY_HARNESS = h;
    const mod = await import(pathToFileURL(join(dir, '_shared', 'qbo-mapping', 'payment.ts')).href) as
      { upsertPaymentForInvoice: (c: unknown, id: string, u: string) => Promise<void> };
    let threw = '';
    try { await mod.upsertPaymentForInvoice({}, 'inv-1::stripe-cs_1', 'u1'); } catch (e) { threw = (e as Error).message; }
    return { h, threw, written: h.updates.filter((u) => u.table === 'invoices' && u.landed).at(-1)?.patch.payments };
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
  // Wave-4 final fix: the write-back is a compare-and-swap on updated_at. A
  // $250 check appended AFTER the re-read (the millisecond window left) moves
  // the row; the stamp's UPDATE lands on 0 rows, re-reads, and keeps it.
  const cas = await run([stripe('stripe-cs_1', 400)], [stripe('stripe-cs_1', 400), stripe('stripe-cs_3', 250)]);
  check('the stamp\'s UPDATE is conditional on the updated_at it re-read',
    cas.h.updates.filter((u) => u.table === 'invoices').every((u) => u.filters.some(([c]) => c === 'updated_at')), JSON.stringify(cas.h.updates.map((u) => u.filters)));
  check('a check appended between the re-read and the write survives: the missed swap re-reads and re-stamps',
    cas.threw === '' && cas.written?.some((e) => e.id === 'stripe-cs_3' && e.amount === 250) === true
      && cas.written?.find((e) => e.id === 'stripe-cs_1')?.qboId === 'P-77'
      && cas.h.updates.filter((u) => u.table === 'invoices').length === 2,
    cas.threw || JSON.stringify(cas.written));
  // Wave-4 final fix r2: the retry bound. A row that moves under every swap
  // gets exactly 4 conditional UPDATEs (none lands), ONE QuickBooks POST (no
  // second push), and a THROW naming the payment already posted — a silent
  // return would leave the entry unstamped with no qboError and qbo-sync
  // would answer success.
  const moving = await run([stripe('stripe-cs_1', 400)], undefined, true);
  const invUpdates = moving.h.updates.filter((u) => u.table === 'invoices');
  check('a row that moves under every swap: exactly 4 conditional UPDATEs, none landed',
    invUpdates.length === 4 && invUpdates.every((u) => !u.landed && u.filters.some(([c]) => c === 'updated_at')), JSON.stringify(invUpdates.map((u) => [u.landed, u.filters])));
  check('...exactly one QuickBooks POST (the retry never pushes again)', moving.h.posts === 1, String(moving.h.posts));
  check('...and it THROWS, naming the QuickBooks payment already posted (P-77)', moving.threw.includes('P-77'), moving.threw || '(returned silently)');
  console.warn = warn;
}

// ── 9. post-ship money-qbo (2026-09-18): #9 #10 #11 #97 #98 #100 #101 #102 ──
console.log('\n  9. post-ship: credit is not cash, a payment goes once, the right day, a void stops the chase');
{
  // #9 — a credit memo applied through QuickBooks' Receive Payment flow is a
  // $0 Payment linking the invoice AND the credit memo. It is not money.
  const inv = (id: string, amt: number) => ({ Amount: amt, LinkedTxn: [{ TxnId: id, TxnType: 'Invoice' }] });
  const cm = (amt: number) => ({ Amount: amt, LinkedTxn: [{ TxnId: 'CM1', TxnType: 'CreditMemo' }] });
  const pure = L.linkedPaymentCash({ TotalAmt: 0, Line: [inv('14', 10_000), cm(10_000)] }, '14');
  check('#9: a $0 credit application puts $0 cash on the invoice ($10k credit)', pure.cash === 0 && pure.credit === 10_000, JSON.stringify(pure));
  const mixed = L.linkedPaymentCash({ TotalAmt: 20_000, Line: [inv('14', 30_000), cm(10_000)] }, '14');
  check('#9: $20k check + $10k credit memo in one Payment: $20k cash, $10k credit', mixed.cash === 20_000 && mixed.credit === 10_000, JSON.stringify(mixed));
  const multi = { TotalAmt: 30_000, Line: [inv('A', 30_000), inv('B', 10_000), cm(10_000)] };
  const a = L.linkedPaymentCash(multi, 'A'), b = L.linkedPaymentCash(multi, 'B');
  check('#9: a check paying two invoices with a credit is shared pro rata, never the whole check to each',
    a.cash === 22_500 && b.cash === 7_500 && a.cash + b.cash === 30_000, JSON.stringify({ a, b }));
  check('#9: a plain check is all cash; its unapplied remainder is not this invoice\'s',
    L.linkedPaymentCash({ TotalAmt: 12_000, Line: [inv('14', 10_000)] }, '14').cash === 10_000
      && L.linkedPaymentCash({ Line: [inv('14', 10_000)] }, '14').cash === 10_000);
  check('#9: cash stays exact to the cent', L.linkedPaymentCash({ TotalAmt: 100, Line: [inv('A', 33.33), inv('B', 66.67), cm(0)] }, 'A').cash === 33.33);
  check('#9: a journal-entry line is credit too', L.linkedPaymentCash({ TotalAmt: 0, Line: [inv('14', 500), { Amount: 500, LinkedTxn: [{ TxnId: 'J', TxnType: 'JournalEntry' }] }] }, '14').cash === 0);

  const P2 = L.toLinkedPayment({ Id: 'P2', TxnDate: '2026-10-05', TotalAmt: 0, Line: [inv('14', 10_000), cm(10_000)], MetaData: { CreateTime: '2026-10-05T09:00:00-07:00' } }, '14');
  const repro = L.planQboPaidReconcile({ payments: [mage('pay-1', 20_000, 'P1')], totalAmt: 30_000, linkedPayments: [P2] });
  check('#9 repro: the credit-memo Payment books NOTHING as cash (amount_paid stays $20,000)',
    repro.appended.length === 0 && repro.amountPaid === 20_000 && !repro.changed, JSON.stringify(repro));
  const reproFlag = L.closedFlagForPlan(repro) ?? '';
  check('#9 repro: ...the $10,000 stays unexplained and the closed-without-a-payment flag fires, naming the credit',
    repro.unexplained === 10_000 && L.isClosedWithoutPaymentNote(reproFlag) && /\$10000\.00 of credit/.test(reproFlag), reproFlag);
  const pending = L.planQboPaidReconcile({
    payments: [mage('pay-1', 20_000, 'P1'), { ...stripe('stripe-cs_x', 10_000), date: '2026-10-04T15:00:00.000Z' }],
    totalAmt: 30_000, linkedPayments: [P2],
  });
  check('#9: a $0 credit application never absorbs an unsynced Pay-link payment of the same amount',
    pending.matched.length === 0 && !pending.ledger.find((e) => e.id === 'stripe-cs_x')?.qboId, JSON.stringify(pending.matched));
  const rec = read('supabase/functions/qbo-reconciler/index.ts');
  check('#9: the reconciler reduces each Payment through toLinkedPayment (TotalAmt read), not a sum of its lines',
    /out\.push\(toLinkedPayment\(pay, String\(qInv\.Id\), pid\)\);/.test(rec) && !/sum \+ \(Number\(line\.Amount\) \|\| 0\)/.test(rec));

  // #11 — amount alone paired a Pay-link payment with an older check.
  const payLink = { ...stripe('stripe-cs_oct20', 10_000), date: '2026-10-20T18:00:00.000Z' };
  const P7 = (createdAt: string | null, txnDate: string | null, extra: Partial<Linked> = {}): Linked => ({ id: 'P7', applied: 10_000, createdAt, txnDate, ...extra });
  check('#11 repro: a check keyed Oct 1 does NOT match a Pay-link payment of Oct 20',
    L.matchUnpushedPayments([payLink], [P7('2026-10-01T10:00:00-07:00', '2026-10-01')]).matches.length === 0);
  check('#11: the bookkeeper keying the Pay-link payment itself on Oct 21 DOES match',
    L.matchUnpushedPayments([payLink], [P7('2026-10-21T10:00:00-07:00', '2026-10-20')]).matches.length === 1);
  check('#11: an Oct 1 check keyed late in a batch (Oct 21) keeps its own date and does NOT match',
    L.matchUnpushedPayments([payLink], [P7('2026-10-21T10:00:00-07:00', '2026-10-01')]).matches.length === 0);
  check('#11: a Payment with no CreateTime is not matchable by amount',
    L.matchUnpushedPayments([payLink], [P7(null, '2026-10-20')]).matches.length === 0);
  check('#11: a date-only MAGE entry keyed the evening before (Pacific) still matches — one day of slack',
    L.matchUnpushedPayments([{ ...mage('m', 10_000), date: '2026-10-20' }], [P7('2026-10-19T17:00:00-07:00', '2026-10-19')]).matches.length === 1);
  check('#11: payment.ts\'s tag matches its own entry exactly, whatever the dates',
    L.matchUnpushedPayments([payLink], [P7('2026-01-01T00:00:00Z', '2026-01-01', { mageEntryId: 'stripe-cs_oct20', applied: 9_000 })]).matches[0]?.qboId === 'P7');
  check('#11: ...and a Payment tagged for ANOTHER entry is never paired by amount',
    L.matchUnpushedPayments([payLink], [P7('2026-10-21T10:00:00-07:00', '2026-10-20', { mageEntryId: 'pay-other' })]).matches.length === 0);
  const two = L.matchUnpushedPayments([payLink], [
    { id: 'PA', applied: 10_000, createdAt: '2026-10-25T10:00:00-07:00', txnDate: '2026-10-22' },
    { id: 'PB', applied: 10_000, createdAt: '2026-10-21T10:00:00-07:00', txnDate: '2026-10-20' },
  ]);
  check('#11: with two candidates the closest-keyed one wins (deterministic)', two.matches[0]?.qboId === 'PB', JSON.stringify(two.matches));
  check('#11: the tag round-trips', L.mageEntryIdFromNote(`${L.magePaymentTag('stripe-cs_1')} MAGE recorded $5.00`) === 'stripe-cs_1'
    && L.mageEntryIdFromNote('hand-keyed') === null);

  // #10 — the flag copy no longer tells him to do the thing that doubles it.
  for (const n of [L.closedWithoutPaymentNote(30_000), L.closedWithoutPaymentNote(10_000, 10_000), L.voidedInQuickBooksNote(),
    L.closedFlagForPlan(L.planQboPaidReconcile({ payments: [stripe('s', 5), { id: 'r', amount: -5, kind: 'refund' }], totalAmt: 5, linkedPayments: [] })) ?? '']) {
    check(`#10: flag copy never says "Record the payment in MAGE" (${n.slice(55, 90)}…)`, !/Record the payment in MAGE/.test(n) && L.isClosedWithoutPaymentNote(n));
  }
  const screen = read('app/qbo-setup.tsx');
  check('#10: ...nor does qbo-setup, which counts invoices MAGE shows paid apart',
    !/Record the payment in MAGE/.test(screen) && /testID="qbo-closed-paid-in-mage"/.test(screen) && /closedWithoutPayment\.open > 0/.test(screen));

  // #101 — a void in QuickBooks.
  check('#101: voided in QuickBooks with MAGE still owed: flagged', L.voidFlagFor({ totalAmt: 0, balance: 0, mageOutstanding: 4_200 }) === L.voidedInQuickBooksNote()
    && L.isClosedWithoutPaymentNote(L.voidedInQuickBooksNote()) && /voided in QuickBooks/.test(L.voidedInQuickBooksNote())
    && /Pay link still works/.test(L.voidedInQuickBooksNote()) && !/credit memo/.test(L.voidedInQuickBooksNote()));
  check('#101: the note names only steps MAGE has (invoices have no void or delete)',
    !/void or delete the invoice in MAGE/.test(L.voidedInQuickBooksNote()) && /note to the invoice in MAGE/.test(L.voidedInQuickBooksNote()));
  {
    // The void bumps LastUpdatedTime ONCE: a swallowed DB error loses the flag
    // for good. Both the read and the write must throw (cursor not stamped).
    const at = rec.indexOf('if (Number(qInv.TotalAmt) === 0) {');
    const branch = at >= 0 ? rec.slice(at, rec.indexOf('continue;\n        }', at) + 10) : '';
    check('#101: the void branch throws on a read error and on a write error, like the paid path',
      /error: vErr \} = await s[\s\S]{0,400}if \(vErr\) throw/.test(branch)
        && /const \{ error: vwErr \} = await s\.from\("invoices"\)\.update\(voidChange\)[\s\S]{0,120}if \(vwErr\) throw/.test(branch),
      branch.slice(0, 200));
  }
  check('#101: a genuine $0 invoice (nothing owed in MAGE) is not', L.voidFlagFor({ totalAmt: 0, balance: 0, mageOutstanding: 0 }) === null);
  check('#101: an open or non-zero invoice is not a void', L.voidFlagFor({ totalAmt: 500, balance: 0, mageOutstanding: 500 }) === null
    && L.voidFlagFor({ totalAmt: 0, balance: 5, mageOutstanding: 5 }) === null);
  check('#101: the reconciler flags it through closedFlagChange (a push error on the row survives) instead of skipping it',
    /if \(Number\(qInv\.TotalAmt\) === 0\) \{[\s\S]{0,2600}closedFlagChange\(voided\.qbo_error, voidFlagFor\(\{ totalAmt: qInv\.TotalAmt, balance: qInv\.Balance, mageOutstanding: outstanding \}\)\)/.test(rec)
      && /const outstanding = toCents2\(netPayable\(voided\) - ledgerSum\(ledgerFrom\(voided\.payments\)\)\);/.test(rec)
      && !/qInv\.Balance > 0 \|\| qInv\.TotalAmt === 0/.test(rec));
  {
    const pushErr = 'QBO 400 /invoice: x';
    const ch = L.closedFlagChange(pushErr, L.voidedInQuickBooksNote());
    check('#101: ...keeping an existing push error after it', typeof ch.qbo_error === 'string' && ch.qbo_error.endsWith(pushErr) && L.isClosedWithoutPaymentNote(ch.qbo_error));
  }

  // #97 — money MAGE sent to QuickBooks and Stripe then gave back.
  const pushed = (id: string, amt: number, pi: string, q: string): Entry => ({ ...stripe(id, amt), paymentIntentId: pi, qboId: q, source: 'mage' });
  const fixtures: Entry[][] = [
    [pushed('s1', 12_000, 'pi1', 'Q1'), { id: 'r1', amount: -12_000, method: 'stripe', kind: 'refund', paymentIntentId: 'pi1' }],
    [pushed('s2', 12_000, 'pi2', 'Q2'), { id: 'r2', amount: -2_500.5, method: 'stripe', kind: 'refund', paymentIntentId: 'pi2' }],
    [pushed('s3', 800, 'pi3', 'Q3'), { id: 'd3', amount: -800, method: 'stripe', kind: 'dispute', paymentIntentId: 'pi3' }],
    [{ ...stripe('s4', 900), paymentIntentId: 'pi4' }, { id: 'r4', amount: -900, method: 'stripe', kind: 'refund', paymentIntentId: 'pi4' }],
    [pushed('s5', 700, 'pi5', 'Q5'), { id: 'r5', amount: -700, kind: 'refund', paymentIntentId: 'pi5', qboReversalRecordedAt: '2026-10-02T00:00:00Z' } as Entry],
    // A SECOND partial refund after he acknowledged the first: Stripe's
    // cumulative entry grew from -2,000 to -3,250.25 and kept his stamp.
    [pushed('s6', 12_000, 'pi6', 'Q6'), { id: 'r6', amount: -3_250.25, kind: 'refund', paymentIntentId: 'pi6', qboReversalRecordedAt: '2026-10-02T00:00:00Z', qboReversalRecordedAmount: 2_000 } as Entry],
  ];
  const got = fixtures.map((f) => L.reversalsNotInQbo(f).map((x) => `${x.entryId}:${x.amount}:${x.kind}:${x.paymentQboId}`).join());
  check('#97: pushed + full refund, partial refund, lost dispute are listed with the REVERSAL amount and the QuickBooks payment',
    got[0] === 'r1:12000:refund:Q1' && got[1] === 'r2:2500.5:refund:Q2' && got[2] === 'd3:800:dispute:Q3', got.join(' | '));
  check('#97: ...a refund of a payment never sent is not listed twice (the original is already counted)', got[3] === '' && L.countPaymentsNotInQbo(fixtures[3]) === 1);
  check('#97: ...one he marked recorded is not listed', got[4] === '');
  check('#97: a second partial refund on an already-acknowledged entry lists the UNRECORDED difference',
    got[5] === 'r6:1250.25:refund:Q6', got[5]);
  {
    // End to end through the real webhook fold: first refund, he acknowledges
    // it, Stripe's cumulative entry grows, the difference comes back.
    const first = [pushed('s7', 1_000, 'pi7', 'Q7'), { id: 'r7', amount: -300, kind: 'refund', paymentIntentId: 'pi7' } as Entry];
    const ack = L.markReversalRecorded(first, 'r7', '2026-10-04T00:00:00.000Z');
    const grown = ack ? ack.map((e) => (e.id === 'r7' ? { ...e, amount: -450 } : e)) : [];
    check('#97: acknowledge $300 → nothing listed; cumulative grows to $450 → $150 listed; acknowledge again → nothing',
      !!ack && L.reversalsNotInQbo(ack).length === 0
        && L.reversalsNotInQbo(grown).map((x) => x.amount).join() === '150'
        && L.reversalsNotInQbo(L.markReversalRecorded(grown, 'r7', 'y') ?? grown).length === 0,
      JSON.stringify(L.reversalsNotInQbo(grown)));
  }
  {
    // Round 4: the refund GROWS between the list and the tap. qbo-setup listed
    // −$300; a second partial refund of $150 folds into the same cumulative
    // entry (−$450) before he taps "I recorded it". Stamping the whole entry
    // marked $150 he never saw as recorded. The stamp is what he was shown.
    const listed = [pushed('s8', 1_000, 'pi8', 'Q8'), { id: 'r8', amount: -300, kind: 'refund', paymentIntentId: 'pi8' } as Entry];
    const shown = L.reversalsNotInQbo(listed)[0]?.amount;
    const grewBeforeTap = listed.map((e) => (e.id === 'r8' ? { ...e, amount: -450 } : e));
    const tapped = L.markReversalRecorded(grewBeforeTap, 'r8', '2026-10-05T00:00:00.000Z', shown);
    check('#97 r4: a refund that grew between list and tap stamps only what he was shown ($300); the $150 stays listed',
      shown === 300 && !!tapped && L.reversalsNotInQbo(tapped).map((x) => x.amount).join() === '150',
      JSON.stringify(tapped && L.reversalsNotInQbo(tapped)));
    const again = tapped && L.markReversalRecorded(tapped, 'r8', '2026-10-06T00:00:00.000Z', 150);
    check('#97 r4: ...acknowledging the $150 next clears it (recorded 300 + 150 = 450, capped at the entry)',
      !!again && L.reversalsNotInQbo(again).length === 0
        && (again.find((e) => e.id === 'r8') as { qboReversalRecordedAmount?: number } | undefined)?.qboReversalRecordedAmount === 450);
    const over = L.markReversalRecorded(listed, 'r8', 'z', 999);
    check('#97 r4: a listed amount larger than the entry is capped at the entry',
      (over?.find((e) => e.id === 'r8') as { qboReversalRecordedAmount?: number } | undefined)?.qboReversalRecordedAmount === 300);
    check('#97 r4: qbo-setup sends the amount the line showed, and qbo-sync passes it through',
      /objectId: `\$\{line\.invoiceId\}::\$\{line\.entryId\}`, listedAmount: line\.amount/.test(screen)
      && /markReversalRecorded\([\s\S]{0,120}, listed\)/.test(read('supabase/functions/qbo-sync/index.ts')));
  }
  const acked = L.markReversalRecorded([...fixtures[0], stripe('late', 50)], 'r1', '2026-10-03T00:00:00.000Z');
  check('#97: "I recorded it" stamps the reversal on a fresh read, keeping a payment written in between',
    !!acked && acked.length === 3 && L.reversalsNotInQbo(acked).length === 0 && acked[2].id === 'late');
  check('#97: ...and refuses an entry that is not a pending reversal', L.markReversalRecorded(fixtures[3], 'r4', 'x') === null);
  {
    const a2 = screen.indexOf('// --- BEGIN paymentsNotInQuickBooks'), b2 = screen.indexOf('// --- END paymentsNotInQuickBooks ---');
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(screen.slice(a2, b2));
    const clientRev = new Function(`${js}\nreturn reversalsNotInQuickBooks;`)() as (r: { id?: string; qboId?: string; payments: unknown }[]) => { entryId: string; amount: number; kind: string; paymentQboId: string }[];
    check('#97: the screen\'s twin lists exactly what the server rule lists, on every fixture',
      fixtures.every((f) => clientRev([{ id: 'i', qboId: 'INV', payments: f }]).map((x) => `${x.entryId}:${x.amount}:${x.kind}:${x.paymentQboId}`).join()
        === L.reversalsNotInQbo(f).map((x) => `${x.entryId}:${x.amount}:${x.kind}:${x.paymentQboId}`).join()));
    check('#97: the green "every payment is in QuickBooks" check needs zero reversals too, and each line can be acknowledged',
      /unsyncedPayments > 0 \|\| reversals\.length > 0\s*\?\s*<AlertTriangle/.test(screen) && /testID="qbo-reversal-not-recorded"/.test(screen)
        && /kind: 'reversal', op: 'upsert', objectId: `\$\{line\.invoiceId\}::\$\{line\.entryId\}`/.test(screen));

    // #102 — the label is the sweep's own predicate.
    const clientState = new Function(`${js}\nreturn unsyncedStateOf;`)() as (e: Entry, l: Entry[], f: string) => string;
    const floor = L.PAYMENT_SWEEP_FLOOR;
    const after = '2026-09-20T10:00:00.000Z';
    const cases: [Entry, Entry[]][] = [];
    const refunded = { ...stripe('x1', 500), date: after, paymentIntentId: 'pX', qboError: 'Project missing QBO customer', qboAttempts: 1 };
    cases.push([refunded, [refunded, { id: 'rx', amount: -500, kind: 'refund', paymentIntentId: 'pX' }]]);
    const disputed = { ...stripe('x2', 500), date: after, paymentIntentId: 'pY', qboError: 'QBO 400', qboAttempts: 1 };
    cases.push([disputed, [disputed, { id: 'dy', amount: -500, kind: 'dispute', paymentIntentId: 'pY' }]]);
    const old = { ...mage('x3', 70), date: '2026-08-01T10:00:00.000Z', qboError: 'QBO 400', qboAttempts: 1 };
    const undated = { id: 'x4', amount: 70, qboError: 'QBO 400', qboAttempts: 1 };
    const stopped = { ...mage('x5', 70), date: after, qboError: 'QBO 400', qboAttempts: 5 };
    const refusedE = { ...mage('x6', 70), date: after, qboError: L.alreadyPaidRefusal(3), qboAttempts: 1 };
    const retry = { ...mage('x7', 70), date: after, qboError: 'QBO 400', qboAttempts: 1 };
    for (const e of [old, undated, stopped, refusedE, retry]) cases.push([e, [e]]);
    const serverStates = cases.map(([e, l]) => L.unsyncedPaymentState(e, l, floor));
    check('#102: refunded, disputed, pre-floor, undated, stopped, refused and retrying each get their own state',
      serverStates.join() === 'reversed,reversed,not-swept,not-swept,stopped,refused,retrying', serverStates.join());
    // (A 'refused' one IS re-tried — and re-refused, spending an attempt — so
    // it is labelled for what happens: not sent.)
    check('#102: ..."retrying" is only ever a payment paymentsToPushToQbo returns; reversed, pre-floor and stopped ones it never returns',
      cases.every(([e, l]) => {
        const st = L.unsyncedPaymentState(e, l, floor);
        const swept = L.paymentsToPushToQbo(l, { notBefore: floor }).some((x) => x.id === e.id);
        return st === 'retrying' ? swept : st === 'refused' ? true : !swept;
      }));
    check('#102: the screen\'s twin agrees with the server on every case, and with a later connection floor',
      cases.every(([e, l]) => clientState(e, l, floor) === L.unsyncedPaymentState(e, l, floor)
        && clientState(e, l, '2026-10-01T00:00:00.000Z') === L.unsyncedPaymentState(e, l, '2026-10-01T00:00:00.000Z')));
    check('#102: its floor constant is the reconciler\'s, and the server floor wins once loaded',
      /const QBO_PAYMENT_SWEEP_FLOOR = '([^']+)'/.exec(screen)?.[1] === L.PAYMENT_SWEEP_FLOOR
        && /stuckQboPayments\(ledgerRows, sweepFloor\)/.test(screen) && /connectionQuery\.data\?\.sweepFloor \?\? QBO_PAYMENT_SWEEP_FLOOR/.test(screen));
    check('#102: the list labels a refunded payment and a pre-sweep one honestly',
      /p\.state === 'reversed' \? 'refunded — record the net in QuickBooks by hand'/.test(screen) && /p\.state === 'not-swept' \? 'from before automatic sending — match by hand'/.test(screen));
  }

  // #10/#11/#98 twins inlined in payment.ts / invoice.ts (sandboxed files).
  const payTs = read('supabase/functions/_shared/qbo-mapping/payment.ts');
  const invTs = read('supabase/functions/_shared/qbo-mapping/invoice.ts');
  const load = (src: string, B: string, E: string, name: string) => {
    const i = src.indexOf(B), j = src.indexOf(E);
    if (i < 0 || j < 0) return null;
    return new Function(`${new Bun.Transpiler({ loader: 'ts' }).transformSync(src.slice(i, j))}\nreturn ${name};`)();
  };
  const refuseTwin = load(payTs, '// --- BEGIN payment twins', '// --- END payment twins ---', 'alreadyPaidRefusal') as ((n: number) => string) | null;
  const tagTwin = load(payTs, '// --- BEGIN payment twins', '// --- END payment twins ---', 'magePaymentTag') as ((s: string) => string) | null;
  check('#10/#11: payment.ts\'s inlined refusal and tag are paymentLedger\'s, byte for byte',
    !!refuseTwin && !!tagTwin && refuseTwin(12) === L.alreadyPaidRefusal(12) && refuseTwin(12) === L.sweepPushRefusal(1, 0, 12)
      && tagTwin('stripe-cs_1') === L.magePaymentTag('stripe-cs_1'));
  const dayPay = load(payTs, '// --- BEGIN qboDay', '// --- END qboDay ---', 'qboDay') as ((v: unknown, tz: unknown) => string) | null;
  const dayInv = load(invTs, '// --- BEGIN qboDay', '// --- END qboDay ---', 'qboDay') as ((v: unknown, tz: unknown) => string) | null;
  const dayCases: [unknown, unknown, string][] = [
    ['2026-10-01T01:30:00.000Z', 'America/New_York', '2026-09-30'],   // the audit: 9:30 pm EDT Sep 30
    ['2027-01-01T04:59:00.000Z', 'America/New_York', '2026-12-31'],   // Dec 31 evening stays in the tax year
    ['2026-10-01T00:30:00.000Z', 'America/Los_Angeles', '2026-09-30'], // 5:30 pm PDT
    ['2026-10-01T15:00:00.000Z', 'America/New_York', '2026-10-01'],
    ['2026-09-30', 'America/New_York', '2026-09-30'],                 // a bare day passes through unchanged
    ['2026-09-30', undefined, '2026-09-30'],
    ['2026-10-01T01:30:00.000Z', null, '2026-10-01'],                 // no zone registered: the old UTC day, not a guess
    ['2026-10-01T01:30:00.000Z', 'Not/AZone', '2026-10-01'],
  ];
  for (const [v, tz, want] of dayCases) {
    check(`#98: ${String(v)} in ${String(tz)} → ${want} (payment.ts and invoice.ts)`,
      !!dayPay && !!dayInv && dayPay(v, tz) === want && dayInv(v, tz) === want, `${dayPay?.(v, tz)} / ${dayInv?.(v, tz)}`);
  }
  check('#98: both mappers send QuickBooks the company day',
    // #133: the payment's picked received day goes first; qboDay passes a bare
    // day through, so an entry without one still gets #98's company day.
    /TxnDate: qboDay\(receivedDay \?\? pay\.date, \(conn as \{ timezone\?: unknown \}\)\.timezone\),/.test(payTs)
      && /TxnDate: qboDay\(inv\.issue_date, \(conn as \{ timezone\?: unknown \}\)\.timezone\),/.test(invTs)
      && /DueDate: qboDay\(inv\.due_date, \(conn as \{ timezone\?: unknown \}\)\.timezone\),/.test(invTs)
      && !/\.slice\(0, 10\),\s*$/m.test(payTs.replace(/\/\/ --- BEGIN qboDay[\s\S]*?\/\/ --- END qboDay ---/, '')));
  const sync = read('supabase/functions/qbo-sync/index.ts');
  check('#98/#102: qbo-setup registers the device zone through qbo-sync, which stores a valid one and returns the sweep floor',
    /kind: 'connection', op: 'upsert', objectId: timeZone \|\| QBO_UNKNOWN_TIME_ZONE/.test(screen)
      && /body\.kind === 'connection' && body\.op === 'upsert'/.test(sync) && /update\(\{ timezone: tz \}\)/.test(sync)
      && /sweepFloor: paymentSweepFloor\(/.test(sync));
  // Integration review: an unreadable zone must not overwrite a real one with
  // 'UTC', a failure must not be cached for 10 minutes, and the registration
  // runs while (and as soon as) the connection is 'connected'.
  {
    const unknownTz = /const QBO_UNKNOWN_TIME_ZONE = '([^']*)';/.exec(screen)?.[1];
    let storedByServer = true;
    try { new Intl.DateTimeFormat('en-US', { timeZone: String(unknownTz) }); storedByServer = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)*$/.test(String(unknownTz)); } catch { storedByServer = false; }
    check('#98: the unknown-zone sentinel is non-empty and qbo-sync refuses to store it (no guessed UTC)',
      !!unknownTz && !storedByServer && !/objectId: timeZone \|\| 'UTC'/.test(screen));
    check('#98: a failed registration throws (not cached as {sweepFloor:null})',
      // w5-join-screens (CONTRACT 26): the function's own sentence rides the
      // throw (edgeFunctionError), and a non-success answer still throws.
      (/if \(error \|\| !data\?\.success\) throw new Error\(/.test(screen)
        || (/if \(error\) throw await edgeFunctionError\(error, /.test(screen) && /if \(!data\?\.success\) throw new Error\(/.test(screen)))
      && !/return \{ sweepFloor: null \}/.test(screen));
    check('#98: registration is enabled only while connected, keyed on that status',
      /enabled: !!user\?\.id && qboConnected,/.test(screen) && /queryKey: \['qbo-setup-connection', user\?\.id \?\? 'anon', qboConnected \?/.test(screen));
  }
  check('#97: qbo-sync stamps a reversal on a fresh read by id (markReversalRecorded)',
    /body\.kind === 'reversal' && body\.op === 'upsert'[\s\S]{0,900}patchInvoiceLedger\(s, invoiceId, auth\.userId,\s*\(payments\) => markReversalRecorded\(payments, entryId, stampedAt, listed\)\)/.test(sync)
      // …and patchInvoiceLedger re-reads by id and writes only over the row it read.
      && /\.select\("payments, updated_at"\)\.eq\("id", invoiceId\)[\s\S]{0,600}upd\.eq\("updated_at", row\.updated_at\)/.test(sync));
  const mig = read('supabase/migrations/20260918190000_qbo_connections_timezone.sql');
  check('#98: the migration adds qbo_connections.timezone without opening the table to clients',
    /add column if not exists timezone text/.test(mig) && !/create policy|grant /i.test(mig.replace(/--.*$/gm, '')));
}

// ── 10. the mappers, executed: payment.ts refuses at zero, tags, dates;
//        invoice.ts leaves drafts alone and marks a no-drift row synced ────
console.log('\n  10. payment.ts and invoice.ts, executed');
{
  const dir = mkdtempSync(join(tmpdir(), 'mage-qbo-map-'));
  mkdirSync(join(dir, '_shared', 'qbo-mapping'), { recursive: true });
  const S = join(ROOT, 'supabase/functions/_shared');
  copyFileSync(join(S, 'paymentMath.ts'), join(dir, '_shared', 'paymentMath.ts'));
  copyFileSync(join(S, 'qbo-mapping', 'payment.ts'), join(dir, '_shared', 'qbo-mapping', 'payment.ts'));
  copyFileSync(join(S, 'qbo-mapping', 'invoice.ts'), join(dir, '_shared', 'qbo-mapping', 'invoice.ts'));
  writeFileSync(join(dir, '_shared', 'qbo.ts'), `
export interface QboConnectionRow { realm_id?: string }
const H = () => (globalThis as any).__MAP_HARNESS;
export async function qboFetch(_c: unknown, path: string, init: any) { H().fetches.push({ path, init }); return H().fetch(path, init); }
export async function qboHash(_o: unknown) { return 'HASH'; }
export function svc() {
  return {
    from(table: string) {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: H().read(table), error: null }),
        update: (patch: any) => { const filters: [string, unknown][] = []; H().updates.push({ table, patch, filters }); const t: any = { eq: (c: string, v: unknown) => { filters.push([c, v]); return t; }, is: (c: string, v: unknown) => { filters.push([c, v]); return t; }, select: () => ({ then: (r: any) => r({ data: [{ id: 'row' }], error: null }) }), then: (r: any) => r({ error: null }) }; return t; },
      };
      return q;
    },
  };
}
`);
  writeFileSync(join(dir, '_shared', 'qbo-mapping', 'financials.ts'), 'export async function readLinkedEstimateItems() { return []; }\n');
  writeFileSync(join(dir, '_shared', 'qbo-mapping', 'item.ts'), 'export async function upsertItem() {}\n');
  writeFileSync(join(dir, '_shared', 'qbo-mapping', 'customer.ts'), 'export async function upsertCustomer() {}\n');
  type H = { fetches: { path: string; init: { method?: string; body?: string } }[]; updates: { table: string; patch: Record<string, unknown>; filters?: [string, unknown][] }[]; read: (t: string) => unknown; fetch: (p: string, i: { method?: string }) => unknown };
  const invRow = (over: Record<string, unknown>) => ({
    id: 'inv-1', user_id: 'u1', project_id: 'p1', number: 14, issue_date: '2026-10-01T01:30:00.000Z', due_date: '2026-10-31T01:30:00.000Z',
    notes: null, line_items: [{ id: 'l', name: 'Work', quantity: 1, unitPrice: 1000, total: 1000 }], subtotal: '1000', total_due: '1000',
    tax_amount: null, type: null, progress_percent: null, retention_percent: null, retention_amount: null, retention_released: null,
    qbo_id: null, qbo_hash: null, qbo_error: null, qbo_sync_status: 'pending', status: 'sent', payments: [], ...over,
  });
  const install = (row: Record<string, unknown>, balance: number) => {
    const h: H = {
      fetches: [], updates: [],
      read: (t) => (t === 'projects' ? { qbo_customer_id: 'CUST-1' } : row),
      fetch: (path, init) => {
        if (init?.method === 'GET' && path.startsWith('/invoice/')) return { Invoice: { SyncToken: '1', Balance: balance } };
        if (path === '/payment') return { Payment: { Id: 'P-NEW' } };
        if (path.startsWith('/invoice')) return { Invoice: { Id: 'QI', TotalAmt: 1000 } };
        return {};
      },
    };
    (globalThis as { __MAP_HARNESS?: unknown }).__MAP_HARNESS = h;
    return h;
  };
  const pay = await import(pathToFileURL(join(dir, '_shared', 'qbo-mapping', 'payment.ts')).href) as { upsertPaymentForInvoice: (c: unknown, id: string, u: string) => Promise<void> };
  const invm = await import(pathToFileURL(join(dir, '_shared', 'qbo-mapping', 'invoice.ts')).href) as { upsertInvoice: (c: unknown, id: string, u: string) => Promise<void> };
  const warn = console.warn; console.warn = () => {};
  const tryRun = async (f: () => Promise<void>) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };

  // #10: balance 0 → no Payment posted, the sweep's own sentence.
  {
    const h = install(invRow({ qbo_id: 'QI', qbo_hash: 'HASH', qbo_sync_status: 'synced', payments: [{ id: 'pay-9', date: '2026-10-02T15:00:00.000Z', amount: 30_000 }] }), 0);
    const threw = await tryRun(() => pay.upsertPaymentForInvoice({ timezone: 'America/New_York' }, 'inv-1::pay-9', 'u1'));
    check('#10: the app\'s push onto an invoice QuickBooks shows paid posts NOTHING', !h.fetches.some((f) => f.path === '/payment'), JSON.stringify(h.fetches.map((f) => f.path)));
    check('#10: ...and throws the sweep\'s refusal (qbo-sync stamps it; qbo-setup reads it as refused)', threw === L.alreadyPaidRefusal(14), threw);
  }
  // #11 + #98: an evening Pay-link payment, pushed with a tag and the company day.
  {
    const h = install(invRow({ qbo_id: 'QI', qbo_hash: 'HASH', qbo_sync_status: 'synced', payments: [{ id: 'stripe-cs_ev', date: '2026-10-01T01:30:00.000Z', amount: 400 }] }), 1000);
    const threw = await tryRun(() => pay.upsertPaymentForInvoice({ timezone: 'America/New_York' }, 'inv-1::stripe-cs_ev', 'u1'));
    const body = JSON.parse(h.fetches.find((f) => f.path === '/payment')?.init.body ?? '{}') as { TxnDate?: string; PrivateNote?: string };
    check('#98: a 9:30 pm EDT Sep 30 payment is dated Sep 30 in QuickBooks', threw === '' && body.TxnDate === '2026-09-30', threw || JSON.stringify(body));
    check('#11: ...and carries its MAGE entry tag', L.mageEntryIdFromNote(body.PrivateNote) === 'stripe-cs_ev', String(body.PrivateNote));
    check('#133: a payment with no reference sends no PaymentRefNum', !('PaymentRefNum' in body), JSON.stringify(body));
  }
  // #133: the check he received Friday and recorded Monday night is dated
  // Friday, carries its check number, and the tag stays the first thing in the note.
  {
    const h = install(invRow({ qbo_id: 'QI', qbo_hash: 'HASH', qbo_sync_status: 'synced', payments: [{ id: 'pay-chk', date: '2026-09-15T01:00:00.000Z', receivedDate: '2026-09-11', reference: 'Check 104213 [MAGE payment evil] from First National', amount: 400, method: 'check' }] }), 1000);
    const threw = await tryRun(() => pay.upsertPaymentForInvoice({ timezone: 'America/Chicago' }, 'inv-1::pay-chk', 'u1'));
    const body = JSON.parse(h.fetches.find((f) => f.path === '/payment')?.init.body ?? '{}') as { TxnDate?: string; PrivateNote?: string; PaymentRefNum?: string };
    check('#133: TxnDate is the day he received it, not the day he recorded it', threw === '' && body.TxnDate === '2026-09-11', threw || JSON.stringify(body));
    check('#133: PaymentRefNum carries the reference, cut to QuickBooks\' 21 characters', body.PaymentRefNum === 'Check 104213 MAGE pay' && (body.PaymentRefNum ?? '').length <= 21, String(body.PaymentRefNum));
    check('#133: the whole reference follows the tag in PrivateNote; the tag still matches THIS entry',
      L.mageEntryIdFromNote(body.PrivateNote) === 'pay-chk' && String(body.PrivateNote).startsWith('[MAGE payment pay-chk]')
        && /Check #Check 104213 MAGE payment evil from First National$/.test(String(body.PrivateNote)), String(body.PrivateNote));
    const bad = install(invRow({ qbo_id: 'QI', qbo_hash: 'HASH', qbo_sync_status: 'synced', payments: [{ id: 'pay-x', date: '2026-10-01T01:30:00.000Z', receivedDate: 'Friday', amount: 400 }] }), 1000);
    await tryRun(() => pay.upsertPaymentForInvoice({ timezone: 'America/New_York' }, 'inv-1::pay-x', 'u1'));
    const badBody = JSON.parse(bad.fetches.find((f) => f.path === '/payment')?.init.body ?? '{}') as { TxnDate?: string };
    check('#133: a malformed received day is ignored for #98\'s company day of the instant', badBody.TxnDate === '2026-09-30', JSON.stringify(badBody));
    const over = install(invRow({ qbo_id: 'QI', qbo_hash: 'HASH', qbo_sync_status: 'synced', payments: [{ id: 'pay-o', date: '2026-10-01T15:00:00.000Z', reference: 'A-77', amount: 1500, method: 'ach' }] }), 1000);
    await tryRun(() => pay.upsertPaymentForInvoice({ timezone: 'America/New_York' }, 'inv-1::pay-o', 'u1'));
    const overNote = String((JSON.parse(over.fetches.find((f) => f.path === '/payment')?.init.body ?? '{}') as { PrivateNote?: string }).PrivateNote);
    check('#133: the reference comes after the overpayment note, labelled for a non-check method',
      /is unapplied customer credit\. Ref A-77$/.test(overNote) && overNote.startsWith('[MAGE payment pay-o]'), overNote);
  }
  // #12: a draft never reaches QuickBooks.
  {
    const h = install(invRow({ status: 'draft' }), 0);
    const threw = await tryRun(() => invm.upsertInvoice({}, 'inv-1', 'u1'));
    const patch = h.updates.at(-1)?.patch ?? {};
    check('#12: a draft makes no QuickBooks call at all', threw === '' && h.fetches.length === 0, threw || JSON.stringify(h.fetches));
    check('#12: ...and leaves "pending" (not re-read every 30 minutes, not counted as Pending)', 'qbo_sync_status' in patch && patch.qbo_sync_status === null, JSON.stringify(patch));
    const flagged = install(invRow({ status: 'draft', qbo_error: L.closedWithoutPaymentNote(5) }), 0);
    await tryRun(() => invm.upsertInvoice({}, 'inv-1', 'u1'));
    check('#12: ...keeping a closed-in-QuickBooks flag', flagged.updates.at(-1)?.patch.qbo_error === L.closedWithoutPaymentNote(5));
    const back = install(invRow({ status: 'draft', qbo_id: 'QI', qbo_hash: 'OLD' }), 0);
    const threwBack = await tryRun(() => invm.upsertInvoice({}, 'inv-1', 'u1'));
    check('#12: a draft already in QuickBooks is not updated there, and says so loudly',
      back.fetches.length === 0 && /is a draft in MAGE but QuickBooks already has it as an open invoice/.test(threwBack), threwBack);
    const sent = install(invRow({ status: 'sent' }), 0);
    await tryRun(() => invm.upsertInvoice({ timezone: 'America/New_York' }, 'inv-1', 'u1'));
    const posted = JSON.parse(sent.fetches.find((f) => f.path === '/invoice')?.init.body ?? '{}') as { TxnDate?: string; DueDate?: string };
    check('#12: the first non-draft push goes', !!sent.fetches.find((f) => f.path === '/invoice'));
    check('#98: ...with the company\'s issue and due day, not the UTC one', posted.TxnDate === '2026-09-30' && posted.DueDate === '2026-10-30', JSON.stringify(posted));
  }
  // #103: a no-drift pass marks the row synced.
  {
    const tax = 'QuickBooks charged $70.00 of sales tax on invoice #14 where MAGE computed $82.50';
    const flag = L.closedWithoutPaymentNote(40);
    const run = async (status: string, qboError: string | null) => {
      const h = install(invRow({ qbo_id: 'QI', qbo_hash: 'HASH', qbo_sync_status: status, qbo_error: qboError, issue_date: '2026-09-30', due_date: '2026-10-30', updated_at: '2026-10-02T10:00:00.000Z' }), 0);
      const threw = await tryRun(() => invm.upsertInvoice({}, 'inv-1', 'u1'));
      return { threw, h, patch: h.updates.at(-1)?.patch, filters: h.updates.at(-1)?.filters ?? [] };
    };
    const p1 = await run('pending', tax);
    check('#103: a payment-only edit (pending, hash unchanged) is marked synced, with no QuickBooks write',
      p1.threw === '' && p1.patch?.qbo_sync_status === 'synced' && p1.patch?.qbo_retry_count === 0 && !p1.h.fetches.some((f) => f.init?.method === 'POST'), JSON.stringify(p1.patch));
    check('#103: ...keeping the accepted push\'s tax note', p1.patch?.qbo_error === tax, String(p1.patch?.qbo_error));
    const p2 = await run('error', `${flag}${L.QBO_ERROR_APPEND_SEP}QBO 503 /invoice: down`);
    check('#103: a transient error whose retry finds no drift is synced, the stale error gone and the dunning flag kept',
      p2.patch?.qbo_sync_status === 'synced' && p2.patch?.qbo_error === flag, JSON.stringify(p2.patch));
    const has = (f: [string, unknown][], c: string, v: unknown) => f.some(([k, x]) => k === c && x === v);
    check('#103: the synced write is conditional on the row this pass read (same hash, same updated_at) — a stale pass cannot clear a newer push\'s error',
      has(p1.filters, 'qbo_hash', 'HASH') && has(p1.filters, 'updated_at', '2026-10-02T10:00:00.000Z')
        && has(p2.filters, 'qbo_hash', 'HASH'), JSON.stringify(p1.filters));
    const p3 = await run('synced', null);
    check('#103: an already-synced row is not rewritten', p3.threw === '' && p3.h.updates.length === 0);
  }
  console.warn = warn;
}

// ── Round 4: a draft paid through its link still reaches QuickBooks ─────────
// A draft is inserted with qbo_sync_status null (#12). If the client pays its
// link while it is still a draft on the server, stripe-webhook moves it
// draft → paid and (by design, pinned above) never touches QuickBooks columns.
// Step 1 used to select only pending/error rows and step 1b needs qbo_id, so
// neither the invoice nor its payment was ever pushed, and qbo-connect-status
// counted it nowhere. The step-1 filter now owes a push to any non-draft row
// with no status; the screen's Pending count is the same set minus errors.
{
  console.log('\nRound 4 — a draft paid server-side is still owed a QuickBooks push');
  const F = await import('../supabase/functions/_shared/qboSyncFilter' + '.ts') as {
    QBO_PUSH_OWED_FILTER: string; QBO_PENDING_COUNT_FILTER: string;
    qboPushOwed: (r: { qbo_sync_status?: string | null; status?: string | null }) => boolean;
  };
  const M = await import('../supabase/functions/_shared/paymentMath' + '.ts') as {
    applyLedgerEntry: (l: unknown[], e: unknown) => { applied: boolean; ledger: unknown[]; delta: number };
    settlementStatus: (prev: string | null, paid: number, inv: Record<string, unknown>) => string;
    ledgerFrom: (raw: unknown) => unknown[];
    toCents2: (n: number) => number;
  };
  type Row = Record<string, unknown>;
  // A PostgREST `or=(…)` evaluator for the operators these filters use, with
  // SQL NULL semantics (NULL = x and NULL <> x are not true).
  const splitTop = (src: string): string[] => {
    const out: string[] = []; let depth = 0, cur = '';
    for (const ch of src) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  const evalTerm = (t: string, r: Row): boolean => {
    const m = /^(and|or)\((.*)\)$/.exec(t);
    if (m) {
      const parts = splitTop(m[2]).map((x) => evalTerm(x, r));
      return m[1] === 'and' ? parts.every(Boolean) : parts.some(Boolean);
    }
    const [col, op, ...rest] = t.split('.');
    const val = rest.join('.');
    const v = r[col] ?? null;
    if (op === 'is') return val === 'null' ? v === null : String(v) === val;
    if (v === null) return false;
    if (op === 'eq') return String(v) === val;
    if (op === 'neq') return String(v) !== val;
    throw new Error(`operator ${op} not modelled`);
  };
  const orFilter = (f: string, r: Row) => splitTop(f).some((t) => evalTerm(t, r));

  // The replay: the new-invoice Send inserts a draft (qbo null), mints the
  // link, the email fails; the client pays $8,400 through the link. The
  // webhook's own money rules move the row.
  const draftRow: Row = { id: 'inv-12', status: 'draft', qbo_sync_status: null, qbo_id: null, total_due: 8400, amount_paid: 0, payments: [], subtotal: 8400, retention_percent: 0, retention_amount: 0, retention_released: 0 };
  const applied = M.applyLedgerEntry(M.ledgerFrom(draftRow.payments), { id: 'stripe-cs_12', amount: 8400, method: 'stripe', kind: 'payment', date: '2026-10-01T00:00:00Z' });
  const paidAmt = M.toCents2(0 + applied.delta);
  const paidRow: Row = { ...draftRow, amount_paid: paidAmt, payments: applied.ledger, status: M.settlementStatus('draft', paidAmt, draftRow) };
  check('replay: the webhook moves the draft straight to paid with no QuickBooks status',
    paidRow.status === 'paid' && paidRow.qbo_sync_status === null, JSON.stringify({ s: paidRow.status, q: paidRow.qbo_sync_status }));
  check('replay: reconciler step 1 now selects it (the invoice is pushed, then step 1b pushes the $8,400)',
    orFilter(F.QBO_PUSH_OWED_FILTER, paidRow));
  check('replay: qbo-connect-status counts it as Pending, so qbo-setup is not green',
    orFilter(F.QBO_PENDING_COUNT_FILTER, paidRow));
  check('mutation: the OLD step-1 filter (pending/error only) does not select it — this is the bug',
    !orFilter('qbo_sync_status.eq.pending,qbo_sync_status.eq.error', paidRow));
  check('a draft is still never selected or counted (#12: a draft is not a receivable)',
    !orFilter(F.QBO_PUSH_OWED_FILTER, draftRow) && !orFilter(F.QBO_PENDING_COUNT_FILTER, draftRow));
  const grid: Row[] = [];
  for (const q of [null, 'pending', 'error', 'synced']) for (const st of [null, 'draft', 'sent', 'partially_paid', 'paid']) grid.push({ qbo_sync_status: q, status: st });
  check('the row predicate is the filter, on every status × sync-status pair',
    grid.every((r) => F.qboPushOwed(r) === orFilter(F.QBO_PUSH_OWED_FILTER, r)));
  check('Pending + Errors partitions the owed set (nothing double-counted, nothing dropped)',
    grid.every((r) => orFilter(F.QBO_PUSH_OWED_FILTER, r)
      === (orFilter(F.QBO_PENDING_COUNT_FILTER, r) !== (r.qbo_sync_status === 'error'))));
  check('a synced row is not re-pushed by step 1 (its payments go through step 1b)',
    !orFilter(F.QBO_PUSH_OWED_FILTER, { qbo_sync_status: 'synced', status: 'paid' }));
  const recon = read('supabase/functions/qbo-reconciler/index.ts');
  const status = read('supabase/functions/qbo-connect-status/index.ts');
  check('wiring: reconciler step 1 uses the shared filter',
    /\.or\(QBO_PUSH_OWED_FILTER\)/.test(recon) && !/\.or\("qbo_sync_status\.eq\.pending,qbo_sync_status\.eq\.error"\)/.test(recon));
  check('wiring: qbo-connect-status counts Pending with the shared filter, not eq(pending)',
    /\.or\(QBO_PENDING_COUNT_FILTER\)/.test(status) && !/\.eq\("qbo_sync_status", "pending"\)/.test(status));
}

if (failures > 0) {
  console.error(`\n✗ validate-qbo-payment-ledger: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ validate-qbo-payment-ledger: all checks passed\n');
