import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { loadConnection, svc } from "../_shared/qbo.ts";
import { upsertCustomer } from "../_shared/qbo-mapping/customer.ts";
import { upsertItem }      from "../_shared/qbo-mapping/item.ts";
import { upsertInvoice }   from "../_shared/qbo-mapping/invoice.ts";
import { upsertPaymentForInvoice } from "../_shared/qbo-mapping/payment.ts";
import { isQboOutageError, keepClosedFlag, markPushFailure } from "../_shared/paymentLedger.ts";

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
    // A fresh read first: the reconciler's "closed in QuickBooks without a
    // payment" flag shares qbo_error and must survive a failed push, or the
    // dunning pause it drives lifts on the next failure (keepClosedFlag).
    if (body.kind === 'invoice') {
      try {
        const s = svc();
        const { data: cur } = await s.from('invoices').select('qbo_error').eq('id', body.objectId).eq('user_id', auth.userId).maybeSingle();
        await s.from('invoices').update({
          qbo_sync_status: 'error',
          qbo_error: keepClosedFlag((cur as { qbo_error?: string | null } | null)?.qbo_error, errMsg),
        }).eq('id', body.objectId).eq('user_id', auth.userId);
      } catch { /* secondary failure — swallow */ }
    }
    // Payment pushes that failed used to leave no trace at all: nothing marked
    // the entry, the reconciler only retried invoices, and the app swallowed
    // the error. Stamp the failure on the ledger entry itself (a fresh read,
    // patched by id) so qbo-setup can count it and qbo-reconciler step 1b
    // retries it. "payment not found" (the app's invoice write is still in its
    // offline queue) has no entry to stamp — the sweep picks it up once the
    // write lands.
    if (body.kind === 'payment') {
      try {
        const [invoiceId, paymentId] = body.objectId.split('::');
        if (invoiceId && paymentId) {
          const s = svc();
          const { data: fresh } = await s.from('invoices').select('payments').eq('id', invoiceId).eq('user_id', auth.userId).maybeSingle();
          // An outage (503, 429, timeout) is not this payment's fault: record
          // why, but do not spend one of its attempts on it.
          const next = markPushFailure((fresh as { payments?: unknown } | null)?.payments, paymentId, errMsg, {
            countAttempt: !isQboOutageError(e),
          });
          if (next) await s.from('invoices').update({ payments: next }).eq('id', invoiceId).eq('user_id', auth.userId);
        }
      } catch { /* secondary failure — swallow */ }
    }
    return json({ success: false, error: errMsg }, 500);
  }
});
