import { qboFetch, svc, type QboConnectionRow } from "../qbo.ts";

interface InvoicePaymentBlob {
  id: string; date: string; amount: number; method?: string; qboId?: string;
  source?: 'mage' | 'qbo';
  /** Dollars of this payment QuickBooks actually LINKED to the invoice. Less
   *  than `amount` when the invoice was open for less; the remainder is
   *  unapplied customer credit. Recorded so the shortfall is a fact on the row
   *  rather than something an accountant has to find. */
  qboApplied?: number;
  /** The LOCAL calendar day the money arrived ('YYYY-MM-DD'), picked on
   *  Record Payment (audit #133). `date` stays the instant it was recorded. */
  receivedDate?: string;
  /** Check number / reference he typed. */
  reference?: string;
}

// --- BEGIN qboDay (twin in ./invoice.ts) ---
// The QuickBooks date for a MAGE date (audit #98). The ledger stores INSTANTS
// (stripe-webhook and the app write `new Date().toISOString()`), and this used
// to send `date.slice(0, 10)` — the UTC day. A Pay-link payment at 9:30 pm EDT
// on Sep 30 is 2026-10-01T01:30Z, so it was booked in OCTOBER (and a Dec 31
// evening payment in the next tax year on a cash basis); for a West Coast GC
// the cutoff is 5 pm. The day is the company's own: the instant formatted in
// the time zone the GC's device registered (qbo_connections.timezone, set by
// qbo-setup through qbo-sync). A value that is already a bare day passes
// through untouched — re-reading it as an instant would move it back a day in
// every US zone. With no zone registered it falls back to the UTC slice, the
// old behaviour, rather than guessing one.
// Inlined, not imported: validate-money-definitions runs this file in a
// sandbox holding only its siblings. validate-qbo-payment-ledger executes both
// copies on the same cases.
function qboDay(value: unknown, timeZone: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (typeof timeZone === 'string' && timeZone !== '' && Number.isFinite(ms)) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
      const day = `${get('year')}-${get('month')}-${get('day')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    } catch { /* unknown zone: the UTC day below */ }
  }
  return raw.slice(0, 10);
}
// --- END qboDay ---

// --- BEGIN payment twins (of _shared/paymentLedger.ts) ---
// The zero-balance refusal and the entry tag, byte-for-byte the sentences
// paymentLedger's alreadyPaidRefusal / magePaymentTag produce (pinned by
// validate-qbo-payment-ledger). Inlined for the same sandbox reason as qboDay.
function alreadyPaidRefusal(invoiceNumber: number | string): string {
  return `QuickBooks already shows invoice #${invoiceNumber} paid, so this payment was not sent (it would be recorded twice). Check the invoice in QuickBooks.`;
}
function magePaymentTag(entryId: string): string {
  return `[MAGE payment ${entryId}]`;
}
// --- END payment twins ---

export async function upsertPaymentForInvoice(conn: QboConnectionRow, encodedId: string, userId: string): Promise<void> {
  const [invoiceId, paymentId] = encodedId.split('::');
  if (!invoiceId || !paymentId) throw new Error(`bad payment id ${encodedId}`);

  const s = svc();
  const { data: row, error } = await s.from('invoices').select('id,project_id,user_id,number,qbo_id,payments').eq('id', invoiceId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`invoice read: ${error.message}`);
  if (!row) throw new Error('invoice not found');
  const inv = row as { id: string; project_id: string; user_id: string; number: number; qbo_id: string | null; payments: InvoicePaymentBlob[] };
  const pay = inv.payments.find(p => p.id === paymentId);
  if (!pay) throw new Error('payment not found in invoice.payments');
  if (pay.source === 'qbo') return; // came FROM QBO — don't push back (feedback loop)
  if (pay.qboId) return; // already pushed

  if (!inv.qbo_id) throw new Error('Invoice not yet synced to QBO — cannot apply payment');

  // ───────────────────────────────────────────────────────────────────────────
  // PUSH THE INVOICE FIRST (audit 2026-09-11, review round 3).
  //
  // invoice.ts now posts the QuickBooks invoice NET of retainage still held,
  // so its Balance is smaller than MAGE's gross `total_due` for the whole
  // retainage period. A closeout payment covering RELEASED retainage that
  // reaches QuickBooks before the invoice is re-pushed would be capped at the
  // stale net balance, and the remainder would sit as unapplied customer
  // credit that nothing ever re-applies: `if (pay.qboId) return;` exits on
  // every later run.
  //
  // Ordering the two removes the whole class. The push is a NO-OP when nothing
  // changed (`inv.qbo_hash === hash` returns immediately), so this costs one
  // hash comparison on the ordinary payment.
  //
  // BEST EFFORT, DELIBERATELY. If the invoice cannot be pushed — a footing
  // mismatch, a QuickBooks fault — the payment still goes in against whatever
  // balance QuickBooks reports. A payment that fails to sync because its
  // INVOICE is unhappy is a regression on cash the GC has already banked, and
  // the balance read below is live either way.
  try {
    const { upsertInvoice } = await import('./invoice.ts');
    await upsertInvoice(conn, invoiceId, userId);
  } catch (e) {
    console.warn('[qbo payment] invoice refresh before payment failed; applying against the live balance', e);
  }

  const { data: projRow } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).eq('user_id', userId).maybeSingle();
  const customerId = (projRow as { qbo_customer_id?: string } | null)?.qbo_customer_id;
  if (!customerId) throw new Error('Project missing QBO customer');

  // MONEY-QBO-1 (audit 2026-09-11). NEVER apply more against the QuickBooks
  // invoice than it is still open for.
  //
  // Before invoice.ts started scaling progress billings and withholding
  // retainage, the QuickBooks invoice was routinely LARGER than the MAGE one
  // and this over-application was invisible. It can still happen the other way
  // — an overpayment typed on app/invoice.tsx (`handleMarkPaid` has no ceiling)
  // or a partial credit already applied in QuickBooks itself — and the
  // consequence is worse there: QuickBooks rejects a linked amount above the
  // balance on some paths and silently negative-balances the invoice on others.
  //
  // The correct QuickBooks representation of cash beyond the balance is an
  // UNAPPLIED customer credit: `TotalAmt` is the money that actually arrived
  // (it must be, or the bank reconciliation breaks), while the LinkedTxn line
  // takes only what the invoice can absorb. QuickBooks parks the remainder on
  // the customer, which is exactly what an overpayment is.
  const openInvoice = await qboFetch(
    conn,
    `/invoice/${encodeURIComponent(inv.qbo_id)}`,
    { method: 'GET' },
  ) as { Invoice?: { Balance?: number } };
  const balance = typeof openInvoice?.Invoice?.Balance === 'number'
    ? Math.max(0, Math.round(openInvoice.Invoice.Balance * 100) / 100)
    : null;
  if (balance === null) {
    throw new Error(`QuickBooks did not report a balance for invoice #${inv.number} — refusing to apply a payment blind.`);
  }
  const amount = Math.round((pay.amount || 0) * 100) / 100;
  if (amount <= 0) throw new Error(`Payment ${paymentId} has no amount to apply.`);
  // NOTHING OPEN, NOTHING SENT (audit #10). At Balance 0 this still posted a
  // Payment with TotalAmt and no Line — the whole amount as unapplied customer
  // credit, a duplicate for a bookkeeper to find. The reconciler's sweep
  // already refused exactly this; the app's own push (qbo-sync, e.g. after the
  // "closed in QuickBooks" flag) did not. Throwing is enough: qbo-sync's catch
  // stamps it on the entry (markPushFailure), qbo-setup lists it as refused,
  // and the sweep keeps refusing it. Only the ZERO balance is refused here — a
  // payment above a positive balance is often a deliberate overpayment, and
  // the unapplied-credit note below is what records that.
  if (Math.round(balance * 100) <= 0) throw new Error(alreadyPaidRefusal(inv.number));
  const applied = Math.min(amount, balance);

  // THE DAY HE RECEIVED IT (audit #133). A check that arrived Friday and was
  // recorded Monday night was booked on Monday — or Tuesday, as the UTC slice
  // did before #98 — and his bookkeeper could not match it to Friday's
  // deposit. Record Payment now stores the day he picks as a bare calendar
  // day, which qboDay passes through untouched; rows without one (Pay-link
  // payments, older entries) keep #98's company-zone day of the instant.
  const receivedDay = typeof pay.receivedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pay.receivedDate)
    ? pay.receivedDate
    : null;
  const body: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    TotalAmt: amount,
    TxnDate: qboDay(receivedDay ?? pay.date, (conn as { timezone?: unknown }).timezone),
  };
  // The check number, where a bookkeeper looks for it. QuickBooks caps
  // PaymentRefNum at 21 characters; the whole reference also goes into the
  // PrivateNote below, AFTER the matching tag, so nothing is lost and the tag
  // stays first (brackets are stripped so a typed reference can never read as
  // a second tag).
  const reference = typeof pay.reference === 'string' ? pay.reference.replace(/[[\]]/g, '').trim() : '';
  if (reference) body.PaymentRefNum = reference.slice(0, 21);
  if (applied > 0) {
    body.Line = [{ Amount: applied, LinkedTxn: [{ TxnId: inv.qbo_id, TxnType: 'Invoice' }] }];
  }
  // The tag lets the reconciler match this Payment to THIS entry exactly if
  // the qboId write below is lost (audit #11) — amount alone paired a Pay-link
  // payment with an older check. `PrivateNote` is internal-only in QuickBooks.
  body.PrivateNote = magePaymentTag(paymentId);
  if (applied < amount) {
    // Say so in the books rather than leaving an accountant to find an
    // unexplained credit.
    body.PrivateNote +=
      ` MAGE recorded $${amount.toFixed(2)} against invoice #${inv.number}, which was open for $${balance.toFixed(2)}. ` +
      `$${(amount - applied).toFixed(2)} is unapplied customer credit.`;
  }
  if (reference) body.PrivateNote += ` ${!pay.method || pay.method === 'check' ? 'Check #' : 'Ref '}${reference}`;
  const r = await qboFetch(conn, '/payment', { method: 'POST', body: JSON.stringify(body) }) as { Payment?: { Id?: string } };
  const qboPaymentId = r?.Payment?.Id;
  if (!qboPaymentId) throw new Error('QBO did not return a Payment.Id');

  // RE-READ, THEN PATCH BY ID. `inv.payments` was read several QuickBooks round
  // trips ago (invoice refresh, customer, balance, POST). Writing that copy back
  // dropped any payment stripe-webhook or the app added to this invoice in the
  // meantime — out of the ledger, while amount_paid kept it. Same shape as
  // paymentLedger.markPushFailure / applyQboMatches (inlined, not imported:
  // validate-money-definitions runs this file in a sandbox with only its own
  // siblings). The read→write window left is milliseconds, not seconds.
  const { data: fresh, error: freshErr } = await s.from('invoices').select('payments').eq('id', invoiceId).eq('user_id', userId).maybeSingle();
  if (freshErr) throw new Error(`invoice re-read: ${freshErr.message}`);
  const freshPayments = (fresh as { payments?: unknown } | null)?.payments;
  const ledger = Array.isArray(freshPayments) ? freshPayments as InvoicePaymentBlob[] : [];
  const target = ledger.find(p => p && p.id === paymentId);
  if (!target || target.qboId) {
    // Deleted in MAGE, or stamped by a parallel push, while this one was in
    // flight. QuickBooks now holds Payment <qboPaymentId>; the reconciler's
    // exact-amount matching (or a person) reconciles it. Never re-add it here.
    console.warn(`[qbo payment] ${paymentId} on invoice #${inv.number} ${target ? `already carries QuickBooks payment ${target.qboId}` : 'was removed'} while QuickBooks payment ${qboPaymentId} was being posted`);
    return;
  }
  const nextPayments = ledger.map(p => {
    if (p !== target) return p;
    const { qboError: _drop, ...rest } = p as InvoicePaymentBlob & { qboError?: string };
    void _drop;
    return { ...rest, qboId: qboPaymentId, source: 'mage' as const, qboApplied: applied };
  });
  const { error: updateErr } = await s.from('invoices').update({ payments: nextPayments }).eq('id', invoiceId).eq('user_id', userId);
  if (updateErr) throw new Error(`invoice update: ${updateErr.message}`);
}
