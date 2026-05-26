// supabase/functions/qbo-reconciler/index.ts
// Cron-driven safety net for QBO 2-way sync (fires every 30 min).
//
// Each invocation, per connected qbo_connections row:
//   1) Re-pushes invoices stuck in 'pending'/'error' (max 5 retries, 50/run).
//   2) Pulls QBO invoices updated since last_sync_at; when Balance == 0 (paid
//      in QBO) synthesizes a payment record marked source:'qbo' so the push
//      path (payment.ts Task 7 guard) does not re-push it back to QBO.
//   3) Updates qbo_connections.last_sync_at on success; last_error on failure.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { isValidCron } from "../_shared/cronAuth.ts";
import { loadConnection, qboFetch, svc, type QboConnectionRow } from "../_shared/qbo.ts";
import { upsertInvoice } from "../_shared/qbo-mapping/invoice.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "Content-Type": "application/json" },
  });

serve(async (req) => {
  // Require the cron shared secret — reject public callers.
  if (!(await isValidCron(req))) {
    return json({ success: false, error: "cron auth required" }, 401);
  }

  const s = svc();
  const { data: conns, error } = await s
    .from("qbo_connections")
    .select("*")
    .eq("status", "connected");
  if (error) return json({ success: false, error: error.message }, 500);

  let pushed = 0, pulled = 0, errors = 0;

  for (const row of (conns ?? []) as QboConnectionRow[]) {
    try {
      // -------------------------------------------------------------------
      // 1) Re-push invoices stuck in 'pending' or 'error'.
      //    Eligible: older than 5 min, fewer than 5 retries, limit 50/user.
      // -------------------------------------------------------------------
      const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data: pending } = await s
        .from("invoices")
        .select("id,qbo_retry_count")
        .eq("user_id", row.user_id)
        .or("qbo_sync_status.eq.pending,qbo_sync_status.eq.error")
        .lt("qbo_synced_at", cutoff)
        .lt("qbo_retry_count", 5)
        .limit(50);

      for (const p of (pending ?? []) as { id: string; qbo_retry_count: number | null }[]) {
        try {
          await upsertInvoice(row, p.id, row.user_id);
          pushed++;
        } catch (e) {
          errors++;
          // IMPORTANT: proper operator precedence — ((current ?? 0) + 1).
          // The naive `?? 0 + 1` parses as `?? (0 + 1)` due to +
          // having higher precedence than ??; wrap the addition.
          const nextRetry = (p.qbo_retry_count ?? 0) + 1;
          await s
            .from("invoices")
            .update({
              qbo_sync_status: "error",
              qbo_error: String((e as Error).message ?? e).slice(0, 500),
              qbo_retry_count: nextRetry,
            })
            .eq("id", p.id)
            .eq("user_id", row.user_id);
        }
      }

      // -------------------------------------------------------------------
      // 2) Pull QBO invoice updates → synthesize payment records for paid-in-QBO.
      // -------------------------------------------------------------------
      const sinceIso = row.last_sync_at ?? "1970-01-01T00:00:00Z";
      // QBO CWQL expects 'YYYY-MM-DD HH:MM:SS' (no T, no timezone suffix).
      const since = sinceIso.replace("T", " ").replace(/\..*$/, "").slice(0, 19);

      const q = (await qboFetch(
        row,
        "/query?query=" +
          encodeURIComponent(
            `select Id, Balance, TotalAmt, MetaData from Invoice where MetaData.LastUpdatedTime > '${since}' MAXRESULTS 200`,
          ),
        { method: "GET" },
      )) as {
        QueryResponse?: {
          Invoice?: { Id: string; Balance: number; TotalAmt: number }[];
        };
      };

      const updated = q?.QueryResponse?.Invoice ?? [];
      for (const qInv of updated) {
        if (qInv.Balance > 0) continue; // not fully paid yet

        // Find the matching local invoice by qbo_id.
        const { data: m } = await s
          .from("invoices")
          .select("id,payments")
          .eq("qbo_id", qInv.Id)
          .eq("user_id", row.user_id)
          .maybeSingle();
        if (!m) continue;

        const localInv = m as { id: string; payments?: { id: string; source?: string }[] } | null;
        const payments = localInv?.payments ?? [];

        // Skip if we already have a QBO-sourced payment (prevents re-processing
        // the same paid invoice every 30 min after the initial synthesize).
        const hasQboPayment = payments.some((p) => p.source === "qbo");
        if (hasQboPayment) continue;

        // Synthesize a payment marked source:'qbo'. The push path (Task 7's
        // feedback-loop guard in payment.ts) checks for this marker and skips
        // pushing such payments back to QBO, preventing an infinite loop.
        const next = [
          ...payments,
          {
            id: `qbo-${qInv.Id}-${Date.now()}`,
            date: new Date().toISOString().slice(0, 10),
            amount: qInv.TotalAmt,
            method: "qbo",
            source: "qbo" as const,
          },
        ];

        await s
          .from("invoices")
          .update({
            payments: next,
            amount_paid: qInv.TotalAmt,
            status: "paid",
          })
          .eq("id", localInv!.id)
          .eq("user_id", row.user_id);

        pulled++;
      }

      // -------------------------------------------------------------------
      // 3) Stamp this connection's last successful sync time.
      // -------------------------------------------------------------------
      await s
        .from("qbo_connections")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("user_id", row.user_id);
    } catch (e) {
      errors++;
      await s
        .from("qbo_connections")
        .update({ last_error: String((e as Error).message ?? e).slice(0, 300) })
        .eq("user_id", row.user_id);
    }
  }

  return json({ success: true, pushed, pulled, errors });
});
