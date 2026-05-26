import { qboFetch, qboHash, svc, type QboConnectionRow } from "../qbo.ts";

interface MageInvoiceRow {
  id: string; user_id: string; project_id: string;
  number: number; issue_date: string; due_date: string; notes: string | null;
  line_items: Array<{ id: string; name: string; description?: string; quantity: number; unitPrice: number; total: number; sourceEstimateItemId?: string | null }>;
  total_due: number; tax_amount: number; subtotal: number;
  qbo_id: string | null; qbo_hash: string | null;
}

export async function upsertInvoice(conn: QboConnectionRow, invoiceId: string, userId: string): Promise<void> {
  const s = svc();
  const { data: row, error } = await s
    .from('invoices').select('*').eq('id', invoiceId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`invoice read: ${error.message}`);
  if (!row) throw new Error('invoice not found');
  const inv = row as MageInvoiceRow;

  // Resolve project's qbo_customer_id (push the project first if missing).
  const { data: projRow } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).eq('user_id', userId).maybeSingle();
  let customerId = (projRow as { qbo_customer_id?: string } | null)?.qbo_customer_id;
  if (!customerId) {
    const { upsertCustomer } = await import("./customer.ts");
    await upsertCustomer(conn, inv.project_id, userId);
    const { data: projRow2 } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).eq('user_id', userId).maybeSingle();
    customerId = (projRow2 as { qbo_customer_id?: string } | null)?.qbo_customer_id;
    if (!customerId) throw new Error('Could not establish QBO Customer for project');
  }

  // Read linked_estimate once before the loop. Re-read inside the loop only after a lazy upsertItem.
  const { data: pjBaseRow } = await s.from('projects').select('linked_estimate').eq('id', inv.project_id).eq('user_id', userId).maybeSingle();
  let linkedItems = ((pjBaseRow as { linked_estimate?: { items?: { materialId: string; qboItemId?: string }[] } } | null)?.linked_estimate?.items) ?? [];
  const { upsertItem } = await import("./item.ts");
  const lines: Array<Record<string, unknown>> = [];
  for (const li of inv.line_items) {
    if (li.sourceEstimateItemId) {
      let qboItemId = linkedItems.find(i => i.materialId === li.sourceEstimateItemId)?.qboItemId;
      if (!qboItemId) {
        await upsertItem(conn, `${inv.project_id}::${li.sourceEstimateItemId}`, userId);
        // Re-read ONLY when we just pushed a new item.
        const { data: pjRow2 } = await s.from('projects').select('linked_estimate').eq('id', inv.project_id).eq('user_id', userId).maybeSingle();
        linkedItems = ((pjRow2 as { linked_estimate?: { items?: { materialId: string; qboItemId?: string }[] } } | null)?.linked_estimate?.items) ?? [];
        qboItemId = linkedItems.find(i => i.materialId === li.sourceEstimateItemId)?.qboItemId;
      }
      if (!qboItemId) throw new Error(`Could not establish QBO Item for line ${li.sourceEstimateItemId} on invoice ${invoiceId}`);
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: li.total,
        Description: li.description ?? li.name,
        SalesItemLineDetail: { ItemRef: { value: qboItemId }, Qty: li.quantity, UnitPrice: li.unitPrice },
      });
    } else {
      lines.push({
        DetailType: 'DescriptionOnly',
        Amount: li.total,
        Description: li.description ?? li.name,
      });
    }
  }

  const body: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    DocNumber: String(inv.number),
    TxnDate: inv.issue_date.slice(0, 10),
    DueDate: inv.due_date.slice(0, 10),
    PrivateNote: inv.notes ?? undefined,
    Line: lines,
  };
  if (inv.qbo_id) Object.assign(body, { Id: inv.qbo_id, sparse: true, SyncToken: '0' });

  // Idempotency check.
  const hash = await qboHash(body);
  if (inv.qbo_id && inv.qbo_hash === hash) return; // no drift

  const path = inv.qbo_id ? '/invoice?operation=update' : '/invoice';
  const r = await qboFetch(conn, path, { method: 'POST', body: JSON.stringify(body) }) as { Invoice?: { Id?: string } };
  const newId = r?.Invoice?.Id ?? inv.qbo_id;
  if (!newId) throw new Error('QBO did not return an Invoice.Id');

  const { error: updateErr } = await s.from('invoices').update({
    qbo_id: newId,
    qbo_hash: hash,
    qbo_synced_at: new Date().toISOString(),
    qbo_sync_status: 'synced',
    qbo_error: null,
    qbo_retry_count: 0,
  }).eq('id', invoiceId).eq('user_id', userId);
  if (updateErr) throw new Error(`invoice update: ${updateErr.message}`);
}
