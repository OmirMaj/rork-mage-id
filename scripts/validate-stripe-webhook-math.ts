// scripts/validate-stripe-webhook-math.ts — pure-fn guard for
// supabase/functions/_shared/paymentMath.ts, the Stripe webhook's money rules.
//
// Audit 2026-09-03 MONEY-F2 / MONEY-F16 / MONEY-F17. Each case below encodes
// the exact bug it prevents: the gross-vs-net "paid" flip that kept a fully
// paid retention invoice partially_paid (and the portal offering the spent
// link again), the double-credit on a Stripe retry, and the refund / lost-
// dispute ledger that did not exist.
//
// paymentMath.ts has no Deno imports precisely so bun can run this file; the
// webhook (Deno) imports the same module, so what passes here is what runs.
//
// Run via: bun run test:stripe-webhook-math
import {
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

console.log(`\nvalidate-stripe-webhook-math: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
