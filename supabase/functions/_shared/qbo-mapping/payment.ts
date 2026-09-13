import { qboFetch, svc, type QboConnectionRow } from "../qbo.ts";

interface InvoicePaymentBlob {
  id: string; date: string; amount: number; method?: string; qboId?: string;
  source?: 'mage' | 'qbo';
  /** Dollars of this payment QuickBooks actually LINKED to the invoice. Less
   *  than `amount` when the invoice was open for less; the remainder is
   *  unapplied customer credit. Recorded so the shortfall is a fact on the row
   *  rather than something an accountant has to find. */
  qboApplied?: number;
}

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
  const applied = Math.min(amount, balance);

  const body: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    TotalAmt: amount,
    TxnDate: pay.date.slice(0, 10),
  };
  if (applied > 0) {
    body.Line = [{ Amount: applied, LinkedTxn: [{ TxnId: inv.qbo_id, TxnType: 'Invoice' }] }];
  }
  if (applied < amount) {
    // Say so in the books rather than leaving an accountant to find an
    // unexplained credit. `PrivateNote` is internal-only in QuickBooks.
    body.PrivateNote =
      `MAGE recorded $${amount.toFixed(2)} against invoice #${inv.number}, which was open for $${balance.toFixed(2)}. ` +
      `$${(amount - applied).toFixed(2)} is unapplied customer credit.`;
  }
  const r = await qboFetch(conn, '/payment', { method: 'POST', body: JSON.stringify(body) }) as { Payment?: { Id?: string } };
  const qboPaymentId = r?.Payment?.Id;
  if (!qboPaymentId) throw new Error('QBO did not return a Payment.Id');

  const nextPayments = inv.payments.map(p => p.id === paymentId
    ? { ...p, qboId: qboPaymentId, source: 'mage' as const, qboApplied: applied }
    : p);
  const { error: updateErr } = await s.from('invoices').update({ payments: nextPayments }).eq('id', invoiceId).eq('user_id', userId);
  if (updateErr) throw new Error(`invoice update: ${updateErr.message}`);
}
