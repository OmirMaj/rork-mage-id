import { qboFetch, svc, type QboConnectionRow } from "../qbo.ts";

interface InvoicePaymentBlob { id: string; date: string; amount: number; method?: string; qboId?: string; source?: 'mage' | 'qbo' }

export async function upsertPaymentForInvoice(conn: QboConnectionRow, encodedId: string, userId: string): Promise<void> {
  const [invoiceId, paymentId] = encodedId.split('::');
  if (!invoiceId || !paymentId) throw new Error(`bad payment id ${encodedId}`);

  const s = svc();
  const { data: row } = await s.from('invoices').select('id,project_id,user_id,qbo_id,payments').eq('id', invoiceId).eq('user_id', userId).maybeSingle();
  if (!row) throw new Error('invoice not found');
  const inv = row as { id: string; project_id: string; user_id: string; qbo_id: string | null; payments: InvoicePaymentBlob[] };
  const pay = inv.payments.find(p => p.id === paymentId);
  if (!pay) throw new Error('payment not found in invoice.payments');
  if (pay.source === 'qbo') return; // came FROM QBO — don't push back (feedback loop)
  if (pay.qboId) return; // already pushed

  if (!inv.qbo_id) throw new Error('Invoice not yet synced to QBO — cannot apply payment');
  const { data: projRow } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).eq('user_id', userId).maybeSingle();
  const customerId = (projRow as { qbo_customer_id?: string } | null)?.qbo_customer_id;
  if (!customerId) throw new Error('Project missing QBO customer');

  const body = {
    CustomerRef: { value: customerId },
    TotalAmt: pay.amount,
    TxnDate: pay.date.slice(0, 10),
    Line: [{ Amount: pay.amount, LinkedTxn: [{ TxnId: inv.qbo_id, TxnType: 'Invoice' }] }],
  };
  const r = await qboFetch(conn, '/payment', { method: 'POST', body: JSON.stringify(body) }) as { Payment?: { Id?: string } };
  const qboPaymentId = r?.Payment?.Id;
  if (!qboPaymentId) throw new Error('QBO did not return a Payment.Id');

  const nextPayments = inv.payments.map(p => p.id === paymentId ? { ...p, qboId: qboPaymentId, source: 'mage' as const } : p);
  const { error: updateErr } = await s.from('invoices').update({ payments: nextPayments }).eq('id', invoiceId).eq('user_id', userId);
  if (updateErr) throw new Error(`invoice update: ${updateErr.message}`);
}
