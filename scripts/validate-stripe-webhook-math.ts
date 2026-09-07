// scripts/validate-stripe-webhook-math.ts — pure-fn guard for
// supabase/functions/_shared/paymentMath.ts, the Stripe webhook's money rules.
//
// Audit 2026-09-03 MONEY-F2 / MONEY-F16 / MONEY-F17. Each case below encodes
// the exact bug it prevents: the gross-vs-net "paid" flip that kept a fully
// paid retention invoice partially_paid (and the portal offering the spent
// link again), the double-credit on a Stripe retry, and the refund / lost-
// dispute ledger that did not exist.
//
// Runtime audit 2026-09-06 MONEY-02 added the receipt-balance section at the
// bottom: the customer receipt stated a GROSS "Balance remaining" while
// settlementStatus, in the same function, decided paid/partially_paid on the
// NET one. That half of the webhook is not in paymentMath.ts, so the guard
// EXTRACTS the shipped receiptBalance() out of stripe-webhook/index.ts between
// its sentinels and executes it — the same technique
// scripts/validate-sub-overpayment.ts uses on an Expo Router screen.
//
// paymentMath.ts has no Deno imports precisely so bun can run this file; the
// webhook (Deno) imports the same module, so what passes here is what runs.
//
// Run via: bun run test:stripe-webhook-math
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  effectiveRetention,
  netPayable,
  retentionPending,
  settlementStatus,
  applyLedgerEntry,
  applyChargeRefund,
  ledgerFrom,
  ledgerSum,
  toCents2,
  type LedgerEntry,
} from '../supabase/functions/_shared/paymentMath';
// MONEY-05: the CLIENT half of the same rule, imported so the two can be
// checked against each other rather than against a hand-copied constant.
import { effectiveRetentionHeld as clientEffectiveRetentionHeld } from '../utils/invoiceBilling';

// Declared locally rather than pulled from `bun-types`: this repo has no bun
// type package installed, and without this `npx tsc --noEmit` fails with
// TS2867 "Cannot find name 'Bun'". Same pattern as
// scripts/validate-sub-overpayment.ts:50.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
function close(n: string, got: number, want: number, eps = 1e-9) {
  const ok = Math.abs(got - want) <= eps;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', got, '\n   want', want); }
}

const NOW = '2026-09-04T12:00:00.000Z';
const pay = (id: string, amount: number): LedgerEntry => ({ id, amount, method: 'stripe', kind: 'payment' });

// ── netPayable — retention-net balance (mirrors utils/invoiceBilling.ts) ────
{
  close('held retention is not payable', netPayable({ total_due: 100000, retention_amount: 10000 }), 90000);
  close('released retention is payable again', netPayable({ total_due: 100000, retention_amount: 10000, retention_released: 10000 }), 100000);
  close('partial release', netPayable({ total_due: 100000, retention_amount: 10000, retention_released: 4000 }), 94000);
  close('no retention columns → gross', netPayable({ total_due: 4300 }), 4300);
  close('NUMERIC arrives as a string from PostgREST', netPayable({ total_due: '100000', retention_amount: '10000', retention_released: null }), 90000);
  close('over-released retention never goes negative', retentionPending({ retention_amount: 1000, retention_released: 5000 }), 0);
  close('garbage total_due → 0, never NaN', netPayable({ total_due: 'abc' as unknown as number }), 0);
}

// ── settlementStatus — the MONEY-F2 "paid" rule ─────────────────────────────
{
  const inv = { total_due: 100000, retention_amount: 10000, retention_released: 0 };
  // The audit's worked failure: $90k net paid on a $100k / 10% retention invoice.
  // Old rule (>= gross − 0.01) said partially_paid and the portal offered the
  // spent $90k link as "Pay $10,000". Net rule says paid.
  eq('net-of-retention payment settles the invoice (MONEY-F2)', settlementStatus('sent', 90000, inv), 'paid');
  eq('within a cent of net is paid', settlementStatus('sent', 89999.995, inv), 'paid');
  eq('short of net is partially_paid', settlementStatus('sent', 89998, inv), 'partially_paid');
  eq('after a retention release the same amount is no longer settled',
    settlementStatus('paid', 90000, { ...inv, retention_released: 10000 }), 'partially_paid');
  eq('no retention: gross rule still holds', settlementStatus('sent', 4300, { total_due: 4300 }), 'paid');
  // Fully refunded / charged back — nothing paid any more.
  eq('fully refunded paid invoice reverts to sent', settlementStatus('paid', 0, inv), 'sent');
  eq('fully refunded partially_paid invoice reverts to sent', settlementStatus('partially_paid', 0, inv), 'sent');
  eq('overdue stays overdue when nothing is paid', settlementStatus('overdue', 0, inv), 'overdue');
  eq('draft stays draft when nothing is paid', settlementStatus('draft', 0.004, inv), 'draft');
  eq('unknown prior status with nothing paid → sent', settlementStatus(null, 0, inv), 'sent');
}

// ── applyLedgerEntry — idempotent credit (Stripe retries / overlapping deliveries)
{
  const ledger = [pay('stripe-cs_1', 90000)];
  const again = applyLedgerEntry(ledger, pay('stripe-cs_1', 90000));
  eq('same session id is not credited twice', [again.applied, again.delta, again.ledger.length], [false, 0, 1]);
  const next = applyLedgerEntry(ledger, pay('stripe-cs_2', 5000));
  eq('new session appends and reports its delta', [next.applied, next.delta, next.ledger.length], [true, 5000, 2]);
  eq('input ledger is not mutated', ledger.length, 1);
  eq('ledgerFrom drops non-object / id-less junk', ledgerFrom([null, 'x', { amount: 1 }, pay('a', 1)]).length, 1);
  eq('ledgerFrom tolerates a non-array column', ledgerFrom(null), []);
  close('ledgerSum rounds to cents', ledgerSum([pay('a', 0.1), pay('b', 0.2)]), 0.3);
}

// ── applyChargeRefund — MONEY-F17, both event shapes ────────────────────────
{
  // Shape A: the charge carries its refunds list (API < 2022-11-15, or expanded).
  const paid = [{ ...pay('stripe-cs_1', 9000), paymentIntentId: 'pi_1' }];
  const chargeA = { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 200000, refunds: { data: [{ id: 're_1', amount: 200000, created: 1757000000 }] } };
  const r1 = applyChargeRefund(paid, chargeA, NOW);
  eq('listed refund → one negative entry keyed by refund id', [r1.changed, r1.delta, r1.ledger[1]?.id, r1.ledger[1]?.amount, r1.ledger[1]?.kind], [true, -2000, 'stripe-refund-re_1', -2000, 'refund']);
  eq('refund entry keeps the PaymentIntent for later lookups', r1.ledger[1]?.paymentIntentId, 'pi_1');
  const r1again = applyChargeRefund(r1.ledger, chargeA, NOW);
  eq('re-delivered refund event is a no-op', [r1again.changed, r1again.delta, r1again.ledger.length], [false, 0, 2]);
  const chargeA2 = { ...chargeA, amount_refunded: 500000, refunds: { data: [{ id: 're_1', amount: 200000 }, { id: 're_2', amount: 300000 }] } };
  const r2 = applyChargeRefund(r1.ledger, chargeA2, NOW);
  eq('second partial refund appends only the new refund', [r2.changed, r2.delta, r2.ledger.length], [true, -3000, 3]);
  close('ledger now nets to the amount actually kept', ledgerSum(r2.ledger), 4000);

  // Shape B: no refunds list (API ≥ 2022-11-15 webhooks) — cumulative entry per charge.
  const chargeB = { id: 'ch_2', payment_intent: 'pi_2', amount_refunded: 200000 };
  const b1 = applyChargeRefund([pay('stripe-cs_2', 9000)], chargeB, NOW);
  eq('cumulative refund → one entry keyed by charge id', [b1.changed, b1.delta, b1.ledger[1]?.id, b1.ledger[1]?.amount], [true, -2000, 'stripe-refund-ch_2', -2000]);
  const b1again = applyChargeRefund(b1.ledger, chargeB, NOW);
  eq('re-delivery with the same cumulative amount is a no-op', [b1again.changed, b1again.delta], [false, 0]);
  const b2 = applyChargeRefund(b1.ledger, { ...chargeB, amount_refunded: 500000 }, NOW);
  eq('a further refund updates the same entry and reports only the change', [b2.changed, b2.delta, b2.ledger.length, b2.ledger[1]?.amount], [true, -3000, 2, -5000]);
  const b0 = applyChargeRefund([pay('stripe-cs_3', 100)], { id: 'ch_3', amount_refunded: 0 }, NOW);
  eq('amount_refunded 0 writes nothing', [b0.changed, b0.ledger.length], [false, 1]);
  eq('missing amount_refunded is treated as 0', applyChargeRefund([], { id: 'ch_4' }, NOW).changed, false);
}

// ── End-to-end: the F17 scenario through the same functions the webhook calls
{
  const inv = { total_due: 9000, retention_amount: 0, retention_released: 0 };
  let ledger: LedgerEntry[] = [];
  let amountPaid = 0;
  let status = 'sent';
  // client pays $9,000
  const credit = applyLedgerEntry(ledger, pay('stripe-cs_9', 9000));
  ledger = credit.ledger; amountPaid = toCents2(amountPaid + credit.delta); status = settlementStatus(status, amountPaid, inv);
  eq('paid in full', [amountPaid, status], [9000, 'paid']);
  // GC refunds $2,000 from the Stripe dashboard
  const refund = applyChargeRefund(ledger, { id: 'ch_9', amount_refunded: 200000 }, NOW);
  ledger = refund.ledger; amountPaid = toCents2(Math.max(0, amountPaid + refund.delta)); status = settlementStatus(status, amountPaid, inv);
  eq('partial refund → $7,000 partially_paid (was: stayed paid at $9,000)', [amountPaid, status], [7000, 'partially_paid']);
  // then refunds the rest
  const refund2 = applyChargeRefund(ledger, { id: 'ch_9', amount_refunded: 900000 }, NOW);
  ledger = refund2.ledger; amountPaid = toCents2(Math.max(0, amountPaid + refund2.delta)); status = settlementStatus(status, amountPaid, inv);
  eq('full refund → $0, back to sent', [amountPaid, status, ledger.length], [0, 'sent', 2]);
  // a lost chargeback is booked with the same primitive, keyed by dispute id
  const lost = applyLedgerEntry([pay('stripe-cs_10', 500)], { id: 'stripe-dispute-du_1', amount: -500, kind: 'dispute' });
  eq('lost dispute entry applies once', [lost.applied, lost.delta, applyLedgerEntry(lost.ledger, { id: 'stripe-dispute-du_1', amount: -500 }).applied], [true, -500, false]);
}

// ── toCents2 ────────────────────────────────────────────────────────────────
{
  close('0.1 + 0.2 rounds to 0.3', toCents2(0.1 + 0.2), 0.3);
  eq('negative zero is normalised', Object.is(toCents2(-0), 0), true);
  close('cents from Stripe integer', toCents2(123456 / 100), 1234.56);
}

// ── receiptBalance — the customer receipt's balance line (MONEY-02) ─────────
//
// Loaded from the SHIPPED webhook source so this cannot pass against a copy.
{
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const WEBHOOK = 'supabase/functions/stripe-webhook/index.ts';
  const src = readFileSync(join(ROOT, WEBHOOK), 'utf8');

  const BEGIN = '// --- BEGIN receiptBalance';
  const END = '// --- END receiptBalance ---';
  const from = src.indexOf(BEGIN);
  const to = src.indexOf(END);
  if (from < 0 || to < 0) {
    console.error(`\n  ✗ could not find the receiptBalance sentinels in ${WEBHOOK}.`);
    console.error('    Someone moved or renamed the function; the receipt balance would go');
    console.error('    unpinned and could drift back to the gross rule. Restore the sentinels.');
    process.exit(1);
  }
  const js = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(src.slice(from, to).replace(/^export /gm, ''));
  const receiptBalance = new Function(
    'netPayable', 'retentionPending', 'toCents2',
    `${js}\nreturn receiptBalance;`,
  )(netPayable, retentionPending, toCents2) as (o: {
    totalDue: number; newAmountPaid: number; retentionAmount: number; retentionReleased: number;
  }) => { remaining: number; retentionHeld: number };

  // The audit's live case: Houston Phone Booth Ad invoice #1 — $81,264.63 due,
  // $4,063.23 (5%) retention, client part-pays $40,000 through the Stripe link.
  // The receipt used to say $41,264.63 (gross) while the app, the portal and
  // the A/R aging all said $37,201.39.
  const houston = { totalDue: 81264.63, retentionAmount: 4063.23, retentionReleased: 0 };
  eq('part-paid retention invoice: receipt matches the app, not the gross total',
    receiptBalance({ ...houston, newAmountPaid: 40000 }),
    { remaining: 37201.4, retentionHeld: 4063.23 });
  eq('held retention is reported separately, never folded into the balance',
    receiptBalance({ ...houston, newAmountPaid: 0 }).retentionHeld, 4063.23);
  eq('no retention → the plain gross balance is unchanged',
    receiptBalance({ totalDue: 4300, newAmountPaid: 1000, retentionAmount: 0, retentionReleased: 0 }),
    { remaining: 3300, retentionHeld: 0 });
  eq('a released retention becomes collectible again',
    receiptBalance({ ...houston, retentionReleased: 4063.23, newAmountPaid: 77201.4 }),
    { remaining: 4063.23, retentionHeld: 0 });
  eq('overpayment never renders a negative balance',
    receiptBalance({ ...houston, newAmountPaid: 90000 }).remaining, 0);
  eq('float noise is rounded to whole cents',
    receiptBalance({ totalDue: 0.3, newAmountPaid: 0.1 + 0.2 - 0.1, retentionAmount: 0, retentionReleased: 0 }).remaining,
    0.1);

  // THE INVARIANT the bug broke: the two halves of one email must agree. When
  // settlementStatus says "paid", the balance line must be zero — and when it
  // says partially_paid, the balance must be positive.
  const cases: { totalDue: number; retentionAmount: number; retentionReleased: number; paid: number }[] = [
    { totalDue: 81264.63, retentionAmount: 4063.23, retentionReleased: 0, paid: 77201.4 },
    { totalDue: 81264.63, retentionAmount: 4063.23, retentionReleased: 0, paid: 40000 },
    { totalDue: 100000, retentionAmount: 10000, retentionReleased: 4000, paid: 94000 },
    { totalDue: 100000, retentionAmount: 10000, retentionReleased: 4000, paid: 50000 },
    { totalDue: 4300, retentionAmount: 0, retentionReleased: 0, paid: 4300 },
    { totalDue: 4300, retentionAmount: 0, retentionReleased: 0, paid: 1 },
  ];
  const disagreements = cases.filter((c) => {
    const status = settlementStatus('sent', c.paid, {
      total_due: c.totalDue, retention_amount: c.retentionAmount, retention_released: c.retentionReleased,
    });
    const { remaining } = receiptBalance({
      totalDue: c.totalDue, newAmountPaid: c.paid,
      retentionAmount: c.retentionAmount, retentionReleased: c.retentionReleased,
    });
    return status === 'paid' ? remaining > 0.01 : remaining <= 0.01;
  });
  eq('status and balance never contradict each other in the same email', disagreements, []);

  // And the shape that caused it may not come back.
  const grossReceipt = /opts\.totalDue\s*-\s*opts\.newAmountPaid/.test(src);
  eq('the receipt no longer subtracts amount_paid from the GROSS total_due', grossReceipt, false);
  eq('ReceiptOpts carries the retention columns INVOICE_COLS already reads',
    /interface ReceiptOpts[\s\S]{0,900}?retentionAmount:\s*number;[\s\S]{0,120}?retentionReleased:\s*number;/.test(src),
    true);

  // ── MONEY-05 · the webhook must READ the basis, not just be able to ────────
  // effectiveRetention() silently falls back to the stored retention_amount
  // when subtotal / retention_percent are absent from the row. That fallback is
  // correct for rows that genuinely have no percentage — and catastrophic if
  // the SELECT simply forgot the columns, because every legacy invoice would
  // then be charged on the tax-inclusive basis with nothing to show for it.
  // A column list is not type-checked, so pin it in source.
  const invoiceCols = src.match(/const INVOICE_COLS = "([^"]+)"/)?.[1] ?? '';
  eq('INVOICE_COLS selects the work value the withholding is recomputed from',
    invoiceCols.includes('subtotal'), true);
  eq('…and the contract percentage', invoiceCols.includes('retention_percent'), true);
  eq('…alongside the stored columns it now only falls back to',
    invoiceCols.includes('retention_amount') && invoiceCols.includes('retention_released'), true);
  eq('the InvoiceRow type declares both, so a dropped column is a type error too',
    /interface InvoiceRow[\s\S]{0,600}?subtotal: number \| string \| null;[\s\S]{0,200}?retention_percent: number \| string \| null;/.test(src),
    true);
  eq('creditInvoice takes the EFFECTIVE withholding, not the raw column',
    /const retentionAmount = effectiveRetention\(inv\);/.test(src)
    && !/const retentionAmount = Number\(inv\.retention_amount/.test(src),
    true);
}

// ── MONEY-05 · effectiveRetention — the server half of the one rule ─────────
// Must agree, to the cent, with utils/invoiceBilling.effectiveRetentionHeld.
// This file decides what Stripe collects; the client file decides what the GC
// and the client are SHOWN. When they disagreed, the founder's Houston client
// was quoted $77,484.88 on the invoice and would have been settled against
// $77,201.39 by the webhook.
{
  console.log('\neffectiveRetention (MONEY-05):');
  // The production row, verbatim (invoices.d8f3e7a8… — read-only SELECT, 2026-09-07).
  const houstonRow = {
    total_due: 81264.625,
    subtotal: 75595,
    retention_percent: 5,
    retention_amount: 4063.2312500000003,
    retention_released: 0,
  };
  close('Houston #1 withholds 5% of the WORK value', effectiveRetention(houstonRow), 3779.75);
  close('…not the 4,063.23 the column stores', retentionPending(houstonRow), 3779.75);
  close('…so the net collectible is 77,484.88', netPayable(houstonRow), 81264.625 - 3779.75);
  eq('…and a client who pays 77,484.88 is PAID',
    settlementStatus('sent', 77484.88, houstonRow), 'paid');
  eq('…while the old stored-basis figure leaves the invoice open',
    settlementStatus('sent', 77201.39, houstonRow), 'partially_paid');

  // PostgREST hands NUMERIC back as a string. A string percentage must still
  // take the derived branch, or every real webhook payload falls back.
  close('NUMERIC-as-string subtotal and percent still derive',
    effectiveRetention({ subtotal: '75595', retention_percent: '5', retention_amount: '4063.23' }), 3779.75);

  // The fallback branch, and the three edges it exists for.
  close('no percentage → the stored column stands (nothing to recompute from)',
    effectiveRetention({ subtotal: 10000, retention_amount: 500 }), 500);
  close('a NULL percentage is not a zero percentage',
    effectiveRetention({ subtotal: 10000, retention_percent: null, retention_amount: 500 }), 500);
  close('percent 0 with a stored amount → the stored column stands',
    effectiveRetention({ subtotal: 10000, retention_percent: 0, retention_amount: 500 }), 500);
  close('no subtotal → the stored column stands',
    effectiveRetention({ retention_percent: 5, retention_amount: 500 }), 500);
  close('a non-numeric subtotal falls back rather than poisoning the charge',
    effectiveRetention({ subtotal: 'not a number', retention_percent: 5, retention_amount: 500 }), 500);
  close('nothing at all → nothing withheld', effectiveRetention({}), 0);
  close('a credit-memo subtotal withholds nothing',
    effectiveRetention({ subtotal: -5000, retention_percent: 5 }), 0);
  close('a percentage above 100 is clamped', effectiveRetention({ subtotal: 1000, retention_percent: 500 }), 1000);
  close('a release against the OLD basis leaves nothing pending, never a negative',
    retentionPending({ ...houstonRow, retention_released: 4063.23 }), 0);
  close('…and the whole total_due becomes collectible',
    netPayable({ ...houstonRow, retention_released: 4063.23 }), 81264.625);
  close('a partial release nets off the WORK-basis figure',
    retentionPending({ ...houstonRow, retention_released: 1000 }), 2779.75);

  // The two implementations of one rule, checked against each other rather than
  // against a hand-copied constant — a drift between them is the whole bug class.
  const clientSide = [
    { subtotal: 75595, retentionPercent: 5, retentionAmount: 4063.2312500000003, retentionReleased: 0 },
    { subtotal: 20000, retentionPercent: 10, retentionAmount: 2150, retentionReleased: 500 },
    { subtotal: 10000, retentionAmount: 500 },
    { subtotal: 10000, retentionPercent: 0, retentionAmount: 500 },
    { subtotal: 0, retentionPercent: 5 },
  ];
  const drift = clientSide.filter(c => Math.abs(
    effectiveRetention({
      subtotal: c.subtotal, retention_percent: c.retentionPercent ?? null,
      retention_amount: c.retentionAmount ?? null, retention_released: c.retentionReleased ?? null,
    }) - clientEffectiveRetentionHeld(c),
  ) > 0.005);
  eq('server effectiveRetention === client effectiveRetentionHeld on every case', drift, []);
}

console.log(`\nvalidate-stripe-webhook-math: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
