import { qboFetch, qboHash as _qboHash, svc, type QboConnectionRow } from "../qbo.ts";

interface MageProjectRow {
  id: string; user_id: string;
  name: string; location: string | null;
  primary_contact: { name?: string | null; email?: string | null; phone?: string | null } | null;
  qbo_customer_id: string | null;
}

export async function upsertCustomer(conn: QboConnectionRow, projectId: string, userId: string): Promise<void> {
  const s = svc();
  const { data: row, error } = await s
    .from('projects')
    .select('id,user_id,name,location,primary_contact,qbo_customer_id')
    .eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`project read: ${error.message}`);
  if (!row) throw new Error('project not found');
  const p = row as MageProjectRow;

  const body: Record<string, unknown> = {
    DisplayName: p.name,
    CompanyName: p.name,
    PrimaryEmailAddr: p.primary_contact?.email ? { Address: p.primary_contact.email } : undefined,
    PrimaryPhone: p.primary_contact?.phone ? { FreeFormNumber: p.primary_contact.phone } : undefined,
    BillAddr: p.location ? { Line1: p.location } : undefined,
  };
  if (p.qbo_customer_id) Object.assign(body, { Id: p.qbo_customer_id, sparse: true, SyncToken: '0' });

  const path = p.qbo_customer_id ? '/customer?operation=update' : '/customer';
  const r = await qboFetch(conn, path, { method: 'POST', body: JSON.stringify(body) }) as { Customer?: { Id?: string } };
  const newId = r?.Customer?.Id ?? p.qbo_customer_id;
  if (!newId) throw new Error('QBO did not return a Customer.Id');

  await s.from('projects').update({ qbo_customer_id: newId, qbo_synced_at: new Date().toISOString() }).eq('id', projectId);
}
