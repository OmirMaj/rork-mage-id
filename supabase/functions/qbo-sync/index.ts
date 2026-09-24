import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { loadConnection, svc } from "../_shared/qbo.ts";
import { upsertCustomer } from "../_shared/qbo-mapping/customer.ts";
import { upsertItem }      from "../_shared/qbo-mapping/item.ts";
import { upsertInvoice }   from "../_shared/qbo-mapping/invoice.ts";
import { upsertPaymentForInvoice } from "../_shared/qbo-mapping/payment.ts";
import { isQboOutageError, keepClosedFlag, markPushFailure, markReversalRecorded, paymentSweepFloor } from "../_shared/paymentLedger.ts";
import { qboObjectOnSample } from "../_shared/sampleFence.ts";

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

/**
 * Integration round 1 · a stamp on invoices.payments (a push failure, a
 * QuickBooks match, a reversal marked recorded) patched onto a fresh read by
 * entry id — and now written ONLY if the row is still the one read: the UPDATE
 * is conditional on its updated_at, which invoice_append_payment and the
 * webhook's refund / dispute writes bump. Without it an append landing between
 * the read and the write was erased (service_role passes invoices_ledger_guard).
 * On a miss the row is re-read and the patch re-applied. The stamp sends no
 * updated_at of its own, but the table's invoices_updated_at BEFORE UPDATE
 * trigger (update_updated_at) bumps it on every UPDATE, this one included —
 * so a writer that raced the stamp misses its own swap and re-reads too, and
 * the sweep (which pages invoices by updated_at) sees the invoice again next
 * run, which is harmless: a stamped entry is never pushed twice.
 */
async function patchInvoiceLedger(
  s: ReturnType<typeof svc>,
  invoiceId: string,
  userId: string,
  patch: (payments: unknown) => unknown[] | null,
  tries = 4,
): Promise<{ wrote: boolean; error?: string }> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const read: { data: unknown; error: { message: string } | null } = await s
      .from("invoices").select("payments, updated_at").eq("id", invoiceId).eq("user_id", userId).maybeSingle();
    if (read.error) return { wrote: false, error: read.error.message };
    const row = read.data as { payments?: unknown; updated_at?: string | null } | null;
    if (!row) return { wrote: false };
    const next = patch(row.payments);
    if (!next) return { wrote: false };
    let upd = s.from("invoices").update({ payments: next }).eq("id", invoiceId).eq("user_id", userId);
    upd = row.updated_at ? upd.eq("updated_at", row.updated_at) : upd.is("updated_at", null);
    const res: { data: unknown; error: { message: string } | null } = await upd.select("id");
    if (res.error) return { wrote: false, error: res.error.message };
    if (Array.isArray(res.data) && res.data.length > 0) return { wrote: true };
  }
  return { wrote: false, error: "invoice changed during the ledger stamp" };
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
    // The amount he was SHOWN, not the entry's size now — a refund that grew
    // between the list and the tap stays listed (markReversalRecorded).
    const listed = typeof body.listedAmount === 'number' ? body.listedAmount : undefined;
    const stampedAt = new Date().toISOString();
    const out = await patchInvoiceLedger(s, invoiceId, auth.userId,
      (payments) => markReversalRecorded(payments, entryId, stampedAt, listed));
    if (out.error) return json({ success: false, error: out.error }, 500);
    if (!out.wrote) return json({ success: true, skipped: 'not-a-pending-reversal' });
    return json({ success: true });
  }

  // Sample fence (_shared/sampleFence): nothing on a sample job ("Sample — …")
  // is ever pushed to his real books. The app already skips samples; this
  // holds for a stale build, a replayed offline queue or a crafted call. A row
  // that cannot be read is refused (500) rather than pushed blind — an invoice
  // stays 'pending', and the reconciler, which fences by project too, retries.
  if (body.op === 'upsert') {
    const onSample = await qboObjectOnSample(svc(), body.kind, body.objectId, auth.userId);
    if (onSample === 'sample') return json({ success: true, skipped: 'sample_project' });
    if (onSample === 'unknown') return json({ success: false, error: 'Could not read the record to sync' }, 500);
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
          // An outage (503, 429, timeout) is not this payment's fault: record
          // why, but do not spend one of its attempts on it.
          const countAttempt = !isQboOutageError(e);
          await patchInvoiceLedger(s, invoiceId, auth.userId,
            (payments) => markPushFailure(payments, paymentId, errMsg, { countAttempt }));
        }
      } catch { /* secondary failure — swallow */ }
    }
    return json({ success: false, error: errMsg }, 500);
  }
});
