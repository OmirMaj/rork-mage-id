import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { loadConnection, svc } from "../_shared/qbo.ts";
import { upsertCustomer } from "../_shared/qbo-mapping/customer.ts";
import { upsertItem }      from "../_shared/qbo-mapping/item.ts";
import { upsertInvoice }   from "../_shared/qbo-mapping/invoice.ts";
import { upsertPaymentForInvoice } from "../_shared/qbo-mapping/payment.ts";
import { isQboOutageError, keepClosedFlag, markPushFailure, markReversalRecorded, paymentSweepFloor } from "../_shared/paymentLedger.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// 'connection' and 'reversal' are not QuickBooks objects — qbo-setup's two
// small writes, done here because qbo_connections is service-role only and a
// ledger stamp must be patched onto a FRESH read by id (see below).
type Kind = 'project' | 'invoice' | 'payment' | 'item' | 'connection' | 'reversal';
interface Body {
  kind: Kind; op: 'upsert' | 'delete'; objectId: string;
  /** kind 'reversal' only: the open amount the line he tapped showed. */
  listedAmount?: number;
}

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

  // qbo-setup registers the device's IANA time zone (objectId), so
  // qbo-mapping sends QuickBooks the COMPANY's calendar day for an instant
  // rather than the UTC one (audit #98), and reads back the sweep floor so its
  // "will retry" label is the reconciler's own rule (audit #102). A zone the
  // runtime does not know is not stored. A failed write (the column not
  // migrated yet) must not fail the screen — the dates fall back to the old
  // UTC day, which is what they were.
  if (body.kind === 'connection' && body.op === 'upsert') {
    const tz = String(body.objectId).slice(0, 64);
    let valid = false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); valid = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)*$/.test(tz); } catch { valid = false; }
    let timezoneSaved = false;
    if (valid && (conn as { timezone?: string | null }).timezone !== tz) {
      const { error: tzErr } = await svc().from('qbo_connections').update({ timezone: tz }).eq('user_id', auth.userId);
      timezoneSaved = !tzErr;
      if (tzErr) console.warn('[qbo-sync] timezone not saved', tzErr.message);
    } else if (valid) {
      timezoneSaved = true;
    }
    return json({
      success: true,
      timezoneSaved,
      sweepFloor: paymentSweepFloor((conn as { created_at?: string | null }).created_at),
    });
  }

  // "I recorded this refund / chargeback in QuickBooks" (audit #97). Nothing
  // posts a RefundReceipt for him — how to book it is the bookkeeper's call —
  // so this is how the line on qbo-setup goes away. Patched onto a fresh read
  // by entry id (markReversalRecorded), like every other server-side ledger
  // stamp: a client write of the whole array could drop a payment the webhook
  // added in between, and could sit in the offline queue for hours doing it.
  if (body.kind === 'reversal' && body.op === 'upsert') {
    const [invoiceId, entryId] = String(body.objectId).split('::');
    if (!invoiceId || !entryId) return json({ success: false, error: 'bad reversal id' }, 400);
    const s = svc();
    const { data: fresh, error: rErr } = await s.from('invoices').select('payments').eq('id', invoiceId).eq('user_id', auth.userId).maybeSingle();
    if (rErr) return json({ success: false, error: rErr.message }, 500);
    // The amount he was SHOWN, not the entry's size now — a refund that grew
    // between the list and the tap stays listed (markReversalRecorded).
    const listed = typeof body.listedAmount === 'number' ? body.listedAmount : undefined;
    const next = markReversalRecorded((fresh as { payments?: unknown } | null)?.payments, entryId, new Date().toISOString(), listed);
    if (!next) return json({ success: true, skipped: 'not-a-pending-reversal' });
    const { error: wErr } = await s.from('invoices').update({ payments: next }).eq('id', invoiceId).eq('user_id', auth.userId);
    if (wErr) return json({ success: false, error: wErr.message }, 500);
    return json({ success: true });
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
