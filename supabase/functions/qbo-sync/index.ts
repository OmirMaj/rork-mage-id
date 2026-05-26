import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { loadConnection, svc } from "../_shared/qbo.ts";
import { upsertCustomer } from "../_shared/qbo-mapping/customer.ts";
import { upsertItem }      from "../_shared/qbo-mapping/item.ts";
import { upsertInvoice }   from "../_shared/qbo-mapping/invoice.ts";
import { upsertPaymentForInvoice } from "../_shared/qbo-mapping/payment.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Kind = 'project' | 'invoice' | 'payment' | 'item';
interface Body { kind: Kind; op: 'upsert' | 'delete'; objectId: string; }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'Method not allowed' }, 405);

  const auth = await requireTier(req, ['business','enterprise'], 'qbo_sync');
  if (!auth.ok) return json(auth.body, auth.status);

  const body = await req.json().catch(() => null) as Body | null;
  if (!body?.kind || !body?.op || !body?.objectId) return json({ success: false, error: 'Missing kind/op/objectId' }, 400);

  const conn = await loadConnection(auth.userId);
  if (!conn || conn.status === 'disconnected' || conn.status === 'connecting' || conn.status === 'error') {
    return json({ success: false, error: 'QuickBooks not connected' }, 409);
  }
  if (conn.status === 'reauth_required') {
    return json({ success: false, error: 'Reconnect QuickBooks' }, 409);
  }

  try {
    if (body.op === 'upsert') {
      if (body.kind === 'project')  await upsertCustomer(conn, body.objectId, auth.userId);
      else if (body.kind === 'item')    await upsertItem(conn, body.objectId, auth.userId);
      else if (body.kind === 'invoice') await upsertInvoice(conn, body.objectId, auth.userId);
      else if (body.kind === 'payment') await upsertPaymentForInvoice(conn, body.objectId, auth.userId);
      else return json({ success: false, error: `Unknown kind ${body.kind}` }, 400);
    } else {
      // Delete is a no-op for v1 (we don't void/delete in QBO automatically). Caller can handle manually.
      return json({ success: true, skipped: 'delete-not-implemented' });
    }
    return json({ success: true });
  } catch (e) {
    console.error('[qbo-sync] failed', e);
    const errMsg = String((e as Error).message ?? e).slice(0, 500);
    // For invoice pushes that failed, mark the row so the reconciler can retry.
    if (body.kind === 'invoice') {
      try {
        const s = svc();
        await s.from('invoices').update({
          qbo_sync_status: 'error',
          qbo_error: errMsg,
        }).eq('id', body.objectId).eq('user_id', auth.userId);
      } catch { /* secondary failure — swallow */ }
    }
    return json({ success: false, error: errMsg }, 500);
  }
});
