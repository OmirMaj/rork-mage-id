// supabase/functions/qbo-reconciler/index.ts
// Cron-driven safety net for QBO 2-way sync (fires every 30 min).
//
// Each invocation, per connected qbo_connections row:
//   1) Re-pushes invoices stuck in 'pending'/'error' (max 5 retries, 50/run).
//   2) Pulls QBO invoices updated since last_sync_at; when Balance == 0 (paid
//      in QBO) synthesizes a payment record marked source:'qbo' so the push
//      path (payment.ts Task 7 guard) does not re-push it back to QBO.
//   2b) Pulls QBO Purchase/Bill lines updated since cost_pull_last_at into
//       the qbo_cost_lines STAGING table (F5, Friday Close campaign). G11:
//       staged rows reach job costs / the cost book ONLY through explicit
//       per-line confirmation in the app's confirm queue; the upsert here
//       refreshes 'staged' rows but NEVER resurrects a confirmed/rejected
//       one. Cursor is cost_pull_last_at — deliberately separate from
//       last_sync_at (the invoice pull already advances that; sharing would
//       skip all cost history on the first run).
//   3) Updates qbo_connections.last_sync_at on success; last_error on failure.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { isValidCron } from "../_shared/cronAuth.ts";
import { qboFetch, svc, type QboConnectionRow } from "../_shared/qbo.ts";
import { upsertInvoice } from "../_shared/qbo-mapping/invoice.ts";

// ── QBO Purchase/Bill line shapes (the fields we read) ─────────────────────
interface QboExpenseLineDetail {
  AccountRef?: { value?: string; name?: string };
  ItemRef?: { value?: string; name?: string };
  CustomerRef?: { value?: string; name?: string };
}
interface QboTxnLine {
  Id?: string;
  Amount?: number;
  Description?: string;
  DetailType?: string;
  AccountBasedExpenseLineDetail?: QboExpenseLineDetail;
  ItemBasedExpenseLineDetail?: QboExpenseLineDetail;
}
interface QboCostTxn {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  Credit?: boolean;                                  // Purchase only: true = refund
  EntityRef?: { value?: string; name?: string };     // Purchase payee
  VendorRef?: { value?: string; name?: string };     // Bill vendor
  MetaData?: { LastUpdatedTime?: string };
  Line?: QboTxnLine[];
}

const COST_PAGE_SIZE = 200;

interface StagedCostLine {
  user_id: string;
  qbo_type: "purchase" | "bill";
  qbo_id: string;
  qbo_line_id: string;
  doc_number: string | null;
  vendor: string | null;
  txn_date: string | null;
  amount: number;
  description: string | null;
  account_name: string | null;
  qbo_customer_ref: string | null;
  project_id: string | null;
  raw: unknown;
  updated_at: string;
}

/** Explode a Purchase/Bill into stageable expense lines. Only expense-detail
 *  lines carry cost + line-level CustomerRef (the QBO norm — header-level
 *  customer mapping does not exist on these entities, which is why the
 *  confirm queue's project picker is mandatory, not polish). */
function explodeCostLines(
  userId: string,
  qboType: "purchase" | "bill",
  txn: QboCostTxn,
  vendor: string | null,
  projectByCustomer: Map<string, string>,
  nowIso: string,
): StagedCostLine[] {
  const out: StagedCostLine[] = [];
  for (const line of txn.Line ?? []) {
    const detail =
      line.DetailType === "AccountBasedExpenseLineDetail" ? line.AccountBasedExpenseLineDetail :
      line.DetailType === "ItemBasedExpenseLineDetail" ? line.ItemBasedExpenseLineDetail :
      null;
    if (!detail) continue;
    const amount = typeof line.Amount === "number" ? line.Amount : 0;
    if (!(amount > 0)) continue; // discounts/zero rows are not costs
    const customerRef = detail.CustomerRef?.value ?? null;
    out.push({
      user_id: userId,
      qbo_type: qboType,
      qbo_id: txn.Id,
      qbo_line_id: line.Id ?? "",
      doc_number: txn.DocNumber ?? null,
      vendor,
      txn_date: txn.TxnDate ?? null,
      amount,
      description: line.Description ?? null,
      account_name: detail.AccountRef?.name ?? detail.ItemRef?.name ?? null,
      qbo_customer_ref: customerRef,
      project_id: customerRef ? projectByCustomer.get(customerRef) ?? null : null,
      raw: line,
      updated_at: nowIso,
    });
  }
  return out;
}

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

  let pushed = 0, pulled = 0, costStaged = 0, errors = 0;

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
        .or(`qbo_synced_at.is.null,qbo_synced_at.lt.${cutoff}`)
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
        if (qInv.Balance > 0 || qInv.TotalAmt === 0) continue; // not fully paid yet (or voided)

        // Find the matching local invoice by qbo_id.
        const { data: m } = await s
          .from("invoices")
          .select("id,payments")
          .eq("qbo_id", qInv.Id)
          .eq("user_id", row.user_id)
          .maybeSingle();
        if (!m) continue;

        const localInv = m as { id: string; payments?: { id: string; source?: string }[] };
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
          .eq("id", localInv.id)
          .eq("user_id", row.user_id);

        pulled++;
      }

      // -------------------------------------------------------------------
      // 2b) Pull Purchase/Bill cost lines → stage into qbo_cost_lines (F5).
      //     Cursor: cost_pull_last_at (NOT last_sync_at — see header note).
      // -------------------------------------------------------------------
      const nowIso = new Date().toISOString();
      const costSinceIso =
        (row as QboConnectionRow & { cost_pull_last_at?: string | null })
          .cost_pull_last_at ?? "1970-01-01T00:00:00Z";
      const costSince = costSinceIso.replace("T", " ").replace(/\..*$/, "").slice(0, 19);

      // Line-level CustomerRef → MAGE project map (projects.qbo_customer_id
      // is the direct mapping column written by upsertCustomer).
      const { data: projRows } = await s
        .from("projects")
        .select("id,qbo_customer_id")
        .eq("user_id", row.user_id)
        .not("qbo_customer_id", "is", null);
      const projectByCustomer = new Map<string, string>();
      for (const p of (projRows ?? []) as { id: string; qbo_customer_id: string }[]) {
        projectByCustomer.set(p.qbo_customer_id, p.id);
      }

      const staged: StagedCostLine[] = [];
      // Cursor bookkeeping: queries are ordered by LastUpdatedTime ASC, so
      // when a page comes back FULL (history may remain — e.g. the first-run
      // backfill since 1970) we advance the cursor only to the max
      // LastUpdatedTime actually seen; the next 30-min cycle resumes from
      // there instead of skipping everything past row 200. (If >200 txns
      // share one timestamp the strict `>` skips the remainder — accepted,
      // vanishingly rare.)
      let maxSeenMs = 0;
      let costPageFull = false;
      const trackSeen = (txns: QboCostTxn[]) => {
        if (txns.length >= COST_PAGE_SIZE) costPageFull = true;
        for (const t of txns) {
          const ms = Date.parse(t.MetaData?.LastUpdatedTime ?? "");
          if (!Number.isNaN(ms) && ms > maxSeenMs) maxSeenMs = ms;
        }
      };

      // Purchases (cash/card/check expenses). Credit=true rows are refunds —
      // skipped (no deletion/void propagation in v1; documented cut).
      const pq = (await qboFetch(
        row,
        "/query?query=" +
          encodeURIComponent(
            `select * from Purchase where MetaData.LastUpdatedTime > '${costSince}' orderby MetaData.LastUpdatedTime MAXRESULTS ${COST_PAGE_SIZE}`,
          ),
        { method: "GET" },
      )) as { QueryResponse?: { Purchase?: QboCostTxn[] } };
      const purchases = pq?.QueryResponse?.Purchase ?? [];
      trackSeen(purchases);
      for (const purchase of purchases) {
        if (purchase.Credit === true) continue;
        staged.push(...explodeCostLines(
          row.user_id, "purchase", purchase,
          purchase.EntityRef?.name ?? null, projectByCustomer, nowIso,
        ));
      }

      // Bills (vendor invoices).
      const bq = (await qboFetch(
        row,
        "/query?query=" +
          encodeURIComponent(
            `select * from Bill where MetaData.LastUpdatedTime > '${costSince}' orderby MetaData.LastUpdatedTime MAXRESULTS ${COST_PAGE_SIZE}`,
          ),
        { method: "GET" },
      )) as { QueryResponse?: { Bill?: QboCostTxn[] } };
      const bills = bq?.QueryResponse?.Bill ?? [];
      trackSeen(bills);
      const ownCompany = (row.company_name ?? "").trim().toLowerCase();
      for (const bill of bills) {
        const vendor = bill.VendorRef?.name ?? null;
        // Symmetry guard: Purchase/Bill are inherently cost-side (no loop
        // risk with our pushed invoices), but a Bill "from" the user's own
        // company is self-referential noise — skip it.
        if (vendor && ownCompany && vendor.trim().toLowerCase() === ownCompany) continue;
        staged.push(...explodeCostLines(
          row.user_id, "bill", bill, vendor, projectByCustomer, nowIso,
        ));
      }

      if (staged.length > 0) {
        // G11: a QBO edit refreshes a STAGED row but never resurrects a
        // confirmed/rejected one. supabase-js upsert can't express a
        // conditional DO UPDATE, so: read the prior status/project of the
        // touched keys, drop non-staged targets, and carry forward a
        // user-assigned project on rows we're refreshing.
        const { data: priorRows } = await s
          .from("qbo_cost_lines")
          .select("qbo_type,qbo_id,qbo_line_id,status,project_id")
          .eq("user_id", row.user_id)
          .in("qbo_id", [...new Set(staged.map((l) => l.qbo_id))]);
        const keyOf = (t: string, id: string, lid: string) => `${t}|${id}|${lid}`;
        const priorByKey = new Map<string, { status: string; project_id: string | null }>();
        for (const p of (priorRows ?? []) as { qbo_type: string; qbo_id: string; qbo_line_id: string; status: string; project_id: string | null }[]) {
          priorByKey.set(keyOf(p.qbo_type, p.qbo_id, p.qbo_line_id), p);
        }

        const upserts: StagedCostLine[] = [];
        for (const line of staged) {
          const prior = priorByKey.get(keyOf(line.qbo_type, line.qbo_id, line.qbo_line_id));
          if (prior && prior.status !== "staged") continue; // G11 — never resurrect
          upserts.push({
            ...line,
            // Keep the GC's in-queue project assignment over our (possibly
            // null) re-resolution; a fresh CustomerRef match still wins.
            project_id: line.project_id ?? prior?.project_id ?? null,
          });
        }
        if (upserts.length > 0) {
          const { error: upErr } = await s
            .from("qbo_cost_lines")
            .upsert(upserts, { onConflict: "user_id,qbo_type,qbo_id,qbo_line_id" });
          if (upErr) throw new Error(`qbo_cost_lines upsert: ${upErr.message}`);
          costStaged += upserts.length;
        }
      }

      // Stamp the cost cursor only after a fully successful cost pass.
      // Full page → resume from the max LastUpdatedTime seen; otherwise we
      // are caught up and jump to now.
      const nextCostCursor = costPageFull && maxSeenMs > 0
        ? new Date(maxSeenMs).toISOString()
        : nowIso;
      await s
        .from("qbo_connections")
        .update({ cost_pull_last_at: nextCostCursor })
        .eq("user_id", row.user_id);

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

  return json({ success: true, pushed, pulled, costStaged, errors });
});
