// supabase/functions/qbo-reconciler/index.ts
// Cron-driven safety net for QBO 2-way sync (fires every 30 min).
//
// Each invocation, per connected qbo_connections row:
//   1) Re-pushes invoices stuck in 'pending'/'error' (max 5 retries, 50/run).
//   1b) Pushes every payment MAGE holds that QuickBooks does not (no qboId,
//      not from QuickBooks) on invoices already in QuickBooks: pay-link
//      payments the Stripe webhook wrote, and app-recorded payments whose push
//      failed or raced ahead of their offline invoice write. Max 25/run/user,
//      5 attempts per payment, each failure written onto the ledger entry.
//   2) Pulls QBO invoices updated since last_sync_at; when Balance == 0 (paid
//      in QBO) books ONLY the QuickBooks Payments MAGE's ledger does not
//      already account for, capped at the shortfall, keyed qbo-payment-<Id>
//      and dated with the Payment's TxnDate (_shared/paymentLedger.ts).
//   2b) Pulls QBO Purchase/Bill lines into the qbo_cost_lines STAGING table
//       (F5, Friday Close campaign). G11: staged rows reach job costs / the
//       cost book ONLY through explicit per-line confirmation in the app's
//       confirm queue; the upsert here refreshes 'staged' rows but NEVER
//       resurrects a confirmed/rejected one. Cursors are PER-ENTITY
//       (purchase_pull_last_at / bill_pull_last_at) — deliberately separate
//       from last_sync_at (the invoice pull already advances that; sharing
//       would skip all cost history on the first run) and from each other
//       (a shared cursor advances past the full-page entity's unpulled
//       backlog whenever the other entity has newer rows).
//   3) Advances qbo_connections.last_sync_at — the invoice pull's CURSOR, not
//      "now" (see nextInvoicePullCursor) — on success; last_error on failure.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { isValidCron } from "../_shared/cronAuth.ts";
import { qboFetch, svc, type QboConnectionRow } from "../_shared/qbo.ts";
import { upsertInvoice } from "../_shared/qbo-mapping/invoice.ts";
import { QBO_PUSH_OWED_FILTER } from "../_shared/qboSyncFilter.ts";
import { upsertPaymentForInvoice } from "../_shared/qbo-mapping/payment.ts";
import { ledgerFrom, ledgerSum, netPayable, settlementStatus, toCents2, type SettlementInput } from "../_shared/paymentMath.ts";
import {
  applyQboMatches,
  closedFlagChange,
  closedFlagForPlan,
  INVOICE_PULL_PAGE_SIZE,
  isPerObjectQboError,
  isQboOutageError,
  keepClosedFlag,
  knownQboPaymentIds,
  markPushFailure,
  matchUnpushedPayments,
  paymentsToPushToQbo,
  paymentSweepFloor,
  nextInvoicePullCursor,
  planQboPaidReconcile,
  QBO_CLOSED_WITHOUT_PAYMENT_PREFIX,
  sweepPushRefusal,
  qboTaxShortfall,
  unknownLinkedPayments,
  toLinkedPayment,
  voidFlagFor,
  withoutClosedFlag,
  type QboLedgerEntry,
  type QboLinkedPayment,
  type QboPaymentRead,
} from "../_shared/paymentLedger.ts";

// ── QBO Invoice / Payment shapes for the paid-invoice pull ────────────────
interface QboLinkedTxn { TxnId?: string; TxnType?: string }
interface QboPulledInvoice {
  Id: string;
  Balance: number;
  TotalAmt: number;
  TxnTaxDetail?: { TotalTax?: number };
  LinkedTxn?: QboLinkedTxn[];
  MetaData?: { LastUpdatedTime?: string };
}

/** Payment pushes per user per run. A first connection with years of history
 *  drains over a few cycles instead of blowing the function's time budget. */
const PAYMENT_PUSH_LIMIT = 25;

/**
 * The QuickBooks Payments linked to an invoice that `ledger` does not already
 * name, each reduced to the CASH it put on THIS invoice (linkedPaymentCash:
 * one check can pay several invoices, and a $0 Payment can apply a credit
 * memo — audit #9), plus when it was keyed and payment.ts's tag (the matcher,
 * audit #11). Payments the ledger names are never fetched, so the common
 * path — MAGE pushed the payment itself and holds its qboId — makes no request.
 */
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

async function fetchUnknownLinkedPayments(
  conn: QboConnectionRow,
  qInv: QboPulledInvoice,
  ledger: readonly QboLedgerEntry[],
): Promise<QboLinkedPayment[]> {
  const known = knownQboPaymentIds(ledger);
  const ids = [...new Set(
    (qInv.LinkedTxn ?? [])
      .filter((t) => t?.TxnType === "Payment" && t.TxnId)
      .map((t) => String(t.TxnId)),
  )].filter((id) => !known.has(id));
  const out: QboLinkedPayment[] = [];
  for (const pid of ids) {
    const pr = (await qboFetch(conn, `/payment/${encodeURIComponent(pid)}`, { method: "GET" })) as {
      Payment?: QboPaymentRead;
    };
    const pay = pr?.Payment;
    if (!pay) continue;
    out.push(toLinkedPayment(pay, String(qInv.Id), pid));
  }
  return out;
}

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

  let pushed = 0, paymentsPushed = 0, pulled = 0, costStaged = 0, errors = 0;

  for (const row of (conns ?? []) as QboConnectionRow[]) {
    try {
      // -------------------------------------------------------------------
      // 1) Re-push invoices stuck in 'pending' or 'error'.
      //    Eligible: older than 5 min, fewer than 5 retries, limit 50/user.
      // -------------------------------------------------------------------
      const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data: pending } = await s
        .from("invoices")
        .select("id,qbo_retry_count,qbo_error")
        .eq("user_id", row.user_id)
        // A non-draft row with NO status is also owed a push (round 4): the
        // app marks 'pending' only on its own non-draft write, so a draft
        // that became paid server-side (stripe-webhook, or any future server
        // path) would otherwise never reach QuickBooks. Drafts stay excluded
        // — a draft is not a receivable (audit #12). QBO_PUSH_OWED_FILTER is
        // shared with qbo-connect-status so the screen counts the same set.
        .or(QBO_PUSH_OWED_FILTER)
        .or(`qbo_synced_at.is.null,qbo_synced_at.lt.${cutoff}`)
        .lt("qbo_retry_count", 5)
        .limit(50);

      for (const p of (pending ?? []) as { id: string; qbo_retry_count: number | null; qbo_error: string | null }[]) {
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
              // Keeps step 2's closed-without-payment flag (dunning pauses on it).
              qbo_error: keepClosedFlag(p.qbo_error, String((e as Error).message ?? e).slice(0, 500)),
              qbo_retry_count: nextRetry,
            })
            .eq("id", p.id)
            .eq("user_id", row.user_id);
        }
      }

      // -------------------------------------------------------------------
      // 1b) Push payments QuickBooks does not have (audit round 2, #15).
      //
      //     The app fires a payment push only from updateInvoice, the instant
      //     it runs. A pay-link payment is written by stripe-webhook, server-
      //     side, and never passed through it, so the exact money MAGE
      //     collected stayed open A/R in QuickBooks. A push that failed (the
      //     invoice write still in the offline queue, the invoice not yet in
      //     QuickBooks) was swallowed and never retried. This sweep is the one
      //     place both are closed.
      //
      //     Why here and not in the webhook: Intuit ROTATES the refresh token
      //     on every refresh (saveTokens), and a webhook refreshing in parallel
      //     with this cron can strand the connection; a QuickBooks outage must
      //     also never make a Stripe delivery fail. One cron owner, 30 minutes.
      //
      //     Settled for 5 minutes (updated_at): an app-triggered push for the
      //     same payment may still be in flight, and payment.ts's
      //     `if (pay.qboId) return` only protects AFTER a push has saved.
      // -------------------------------------------------------------------
      const settledCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
      // History before the sweep (or the connection) is never pushed blind:
      // a bookkeeper may have keyed it as an unlinked deposit. See
      // PAYMENT_SWEEP_FLOOR — those stay in qbo-setup's count for a person.
      const sweepFloor = paymentSweepFloor((row as QboConnectionRow & { created_at?: string | null }).created_at);
      const PAGE = 1000;
      let pushBudget = PAYMENT_PUSH_LIMIT;
      for (let from = 0; pushBudget > 0; from += PAGE) {
        const { data: payRows, error: payErr } = await s
          .from("invoices")
          .select("id,number,qbo_id,payments,tax_amount")
          .eq("user_id", row.user_id)
          .not("qbo_id", "is", null)
          .lt("updated_at", settledCutoff)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (payErr) throw new Error(`invoice payments read: ${payErr.message}`);
        const batch = (payRows ?? []) as { id: string; number: number; qbo_id: string; payments: unknown; tax_amount: unknown }[];

        for (const inv of batch) {
          const todo = paymentsToPushToQbo(inv.payments, { notBefore: sweepFloor });
          if (todo.length === 0) continue;
          if (pushBudget <= 0) break;

          // Where each attempt's failure is recorded — a fresh read patched by
          // entry id, so a payment written since our read is never dropped.
          const recordFailure = async (entryId: string, e: unknown) => {
            errors++;
            await patchInvoiceLedger(s, inv.id, row.user_id,
              (payments) => markPushFailure(payments, entryId, String((e as Error)?.message ?? e)));
          };

          // Refresh the QuickBooks invoice first (a no-op when its hash is
          // unchanged) so a released retainage is on it before we read it.
          try { await upsertInvoice(row, inv.id, row.user_id); } catch { /* payment.ts retries it */ }
          const readInvoice = async () =>
            ((await qboFetch(row, `/invoice/${encodeURIComponent(inv.qbo_id)}`, { method: "GET" })) as {
              Invoice?: QboPulledInvoice;
            })?.Invoice;

          // READS are split by kind. A 400/404 on THIS invoice or one of its
          // Payments (deleted in QuickBooks; a qbo_id from a company the GC has
          // since left) is this invoice's problem: charge it to its payments —
          // so the attempt cap ends the retries — and move on. Thrown, it used
          // to stall step 2, the cost staging and the cursor for this GC every
          // run, forever. Anything else (401 after refresh, 429, 5xx, network,
          // token refresh) is the connection or QuickBooks: it still aborts the
          // user's run rather than burning every payment's attempts on an outage.
          const ledger = ledgerFrom(inv.payments) as QboLedgerEntry[];
          let qInv: QboPulledInvoice | undefined;
          let unknown: QboLinkedPayment[];
          try {
            qInv = await readInvoice();
            if (!qInv) throw new Error(`QBO 404 /invoice/${inv.qbo_id}: QuickBooks returned no invoice`);
            // Does QuickBooks ALREADY have any of this money? (A bookkeeper
            // keyed it in; payment.ts posted it and failed to save the id; the
            // app rewrote `payments` from a copy older than the id.) Match
            // those to their QuickBooks Payment instead of pushing them again.
            unknown = unknownLinkedPayments(ledger, await fetchUnknownLinkedPayments(row, qInv, ledger));
          } catch (readErr) {
            if (!isPerObjectQboError(readErr)) throw readErr;
            for (const entry of todo) {
              await recordFailure(
                entry.id,
                `QuickBooks could not find invoice #${inv.number} or a payment on it (deleted there, or MAGE is now connected to a different company), so this payment was not sent. ${String((readErr as Error)?.message ?? readErr)}`,
              );
            }
            continue;
          }
          const { matches } = matchUnpushedPayments(ledger, unknown);
          if (matches.length > 0) {
            await patchInvoiceLedger(s, inv.id, row.user_id, (payments) => applyQboMatches(payments, matches));
          }
          const matchedIds = new Set(matches.map((x) => x.entryId));

          let balance = Number(qInv.Balance ?? NaN);
          // QuickBooks' own sales tax may be lower than MAGE's (invoice.ts
          // syncs that invoice with a tax note), so the client's last payment
          // of MAGE's figure lands over its balance by the tax gap. Allowed —
          // but only when every payment QuickBooks has on the invoice is one
          // the ledger knows; unknown money there means a short balance may be
          // a hand-entered duplicate, and then nothing is allowed.
          const taxShortfall = unknown.length === matches.length
            ? qboTaxShortfall(inv.tax_amount, qInv.TxnTaxDetail?.TotalTax)
            : 0;
          for (const entry of todo) {
            if (matchedIds.has(entry.id)) continue;
            if (pushBudget <= 0) break;
            pushBudget--;
            // QuickBooks is open for LESS than this payment with the money
            // unmatched: closed some other way (Balance 0), or the bookkeeper
            // already keyed it in net of fees. payment.ts would park the gap
            // as unapplied customer credit — income twice. Never do that blind.
            const refusal = sweepPushRefusal(Number(entry.amount), balance, inv.number, taxShortfall);
            if (refusal) {
              await recordFailure(entry.id, refusal);
              continue;
            }
            try {
              await upsertPaymentForInvoice(row, `${inv.id}::${entry.id}`, row.user_id);
              paymentsPushed++;
              balance = Number((await readInvoice())?.Balance ?? NaN);
            } catch (e) {
              // Same split as the reads above: QuickBooks or the connection
              // being down is not this payment's fault. Rethrow — the user's
              // run aborts and retries next cycle WITHOUT spending the entry's
              // MAX_PAYMENT_PUSH_ATTEMPTS. (A POST that timed out after
              // QuickBooks took it is matched by amount next run, not re-sent.)
              if (isQboOutageError(e)) throw e;
              await recordFailure(entry.id, e);
            }
          }
          if (pushBudget <= 0) break;
        }
        if (batch.length < PAGE) break;
      }

      // -------------------------------------------------------------------
      // 2) Pull QBO invoice updates → book QuickBooks-side payments MAGE lacks.
      //
      //    This used to append a full-TotalAmt payment whenever no entry was
      //    tagged source:'qbo'. MAGE's own pushed payments are tagged 'mage'
      //    and pay-link payments carry no source, so every invoice paid in full
      //    in MAGE was counted TWICE one cycle later: payment.ts's push drops
      //    the QuickBooks Balance to 0, which bumps LastUpdatedTime, which is
      //    this query's window. The decision is now made on the money
      //    (planQboPaidReconcile); see _shared/paymentLedger.ts.
      // -------------------------------------------------------------------
      const sinceIso = row.last_sync_at ?? "1970-01-01T00:00:00Z";
      // QBO CWQL expects 'YYYY-MM-DD HH:MM:SS' (no T, no timezone suffix).
      const since = sinceIso.replace("T", " ").replace(/\..*$/, "").slice(0, 19);
      // Taken BEFORE the query: anything QuickBooks records after this moment
      // is re-read next run (nextInvoicePullCursor), never skipped.
      const invoicePullStartMs = Date.now();

      // `select *` — LinkedTxn (the Payments applied to the invoice) is not
      // returned by a narrowed select list.
      const q = (await qboFetch(
        row,
        "/query?query=" +
          encodeURIComponent(
            `select * from Invoice where MetaData.LastUpdatedTime >= '${since}' orderby MetaData.LastUpdatedTime MAXRESULTS ${INVOICE_PULL_PAGE_SIZE}`,
          ),
        { method: "GET" },
      )) as { QueryResponse?: { Invoice?: QboPulledInvoice[] } };

      const updated = q?.QueryResponse?.Invoice ?? [];
      for (const qInv of updated) {
        if (qInv.Balance > 0) {
          // Not fully paid yet. If this run once flagged it closed without a
          // payment and the bookkeeper has since reopened it, lift the flag so
          // reminders resume. Matches no row in the normal case. Only the flag
          // lifts: a push error appended after it stays.
          const { data: flagged } = await s
            .from("invoices")
            .select("id,qbo_error")
            .eq("qbo_id", qInv.Id)
            .eq("user_id", row.user_id)
            .like("qbo_error", `${QBO_CLOSED_WITHOUT_PAYMENT_PREFIX}%`);
          for (const f of (flagged ?? []) as { id: string; qbo_error: string | null }[]) {
            await s
              .from("invoices")
              .update({ qbo_error: withoutClosedFlag(f.qbo_error) })
              .eq("id", f.id)
              .eq("user_id", row.user_id)
              .like("qbo_error", `${QBO_CLOSED_WITHOUT_PAYMENT_PREFIX}%`);
          }
          continue;
        }
        if (Number(qInv.TotalAmt) === 0) {
          // VOIDED in QuickBooks (audit #101) — TotalAmt and Balance 0. This
          // used to `continue` silently, and invoice-dunning's cron chased the
          // client for the voided invoice up to FINAL NOTICE. Flag it when MAGE
          // still has money outstanding (a genuine $0 invoice is not); the void
          // bumps LastUpdatedTime once, so this pull is the one chance, and no
          // other path rewrites the flag. MAGE's status is left for him.
          // A read or write error THROWS, like the paid path: the void bumps
          // LastUpdatedTime once, so if this pass swallowed a transient DB error
          // the cursor would move past it and the flag would be lost for good
          // (dunning chasing a voided invoice). Throwing leaves the cursor
          // unstamped and the next run re-reads it.
          const { data: v, error: vErr } = await s
            .from("invoices")
            .select("id,payments,total_due,subtotal,retention_percent,retention_amount,retention_released,qbo_error")
            .eq("qbo_id", qInv.Id)
            .eq("user_id", row.user_id)
            .maybeSingle();
          if (vErr) throw new Error(`invoice void read: ${vErr.message}`);
          if (!v) continue;
          const voided = v as SettlementInput & { id: string; payments?: unknown; qbo_error?: string | null };
          const outstanding = toCents2(netPayable(voided) - ledgerSum(ledgerFrom(voided.payments)));
          const voidChange = closedFlagChange(voided.qbo_error, voidFlagFor({ totalAmt: qInv.TotalAmt, balance: qInv.Balance, mageOutstanding: outstanding }));
          if ("qbo_error" in voidChange) {
            const { error: vwErr } = await s.from("invoices").update(voidChange).eq("id", voided.id).eq("user_id", row.user_id);
            if (vwErr) throw new Error(`invoice void flag write: ${vwErr.message}`);
          }
          continue;
        }

        // Find the matching local invoice by qbo_id.
        const { data: m } = await s
          .from("invoices")
          .select("id,payments,status,total_due,subtotal,retention_percent,retention_amount,retention_released,updated_at,qbo_error,qbo_sync_status")
          .eq("qbo_id", qInv.Id)
          .eq("user_id", row.user_id)
          .maybeSingle();
        if (!m) continue;
        const localInv = m as SettlementInput & {
          id: string; payments?: unknown; status?: string | null; updated_at?: string | null; qbo_error?: string | null; qbo_sync_status?: string | null;
        };

        const linkedPayments = await fetchUnknownLinkedPayments(
          row, qInv, ledgerFrom(localInv.payments) as QboLedgerEntry[],
        );

        const lastUpdated = qInv.MetaData?.LastUpdatedTime;
        const plan = planQboPaidReconcile({
          payments: localInv.payments,
          totalAmt: qInv.TotalAmt,
          linkedPayments,
          // QuickBooks' own local timestamp; its first 10 chars are the
          // company's calendar day, not a UTC re-projection.
          fallbackDate: typeof lastUpdated === "string" && /^\d{4}-\d{2}-\d{2}/.test(lastUpdated)
            ? lastUpdated.slice(0, 10)
            : undefined,
        });
        // QuickBooks closed the invoice with something that is not cash (a
        // credit memo, a journal entry, a write-off — including one applied
        // through a $0 Payment, audit #9). Never booked as cash — but no
        // longer silent either: the flag is what qbo-setup counts and what
        // pauses invoice-dunning's cron, so the client is not chased for an
        // invoice the bookkeeper closed. The same flag, worded for it, when
        // QuickBooks is paid only because it still counts money MAGE recorded
        // as refunded (audit #100). A later run that finds the gap explained
        // lifts it.
        const flag = closedFlagForPlan(plan);
        // A tax note or a push error already on the row (status 'error')
        // stays after the flag (keepClosedFlag) — an errored push used to skip
        // the flag, and the dunning cron kept chasing a closed invoice.
        // Lifting the flag leaves whatever followed it.
        const flagChange = closedFlagChange(localInv.qbo_error, flag);
        if (!plan.changed) {
          if ("qbo_error" in flagChange) {
            await s.from("invoices").update(flagChange).eq("id", localInv.id).eq("user_id", row.user_id);
          }
          continue;
        }

        // Optimistic: a webhook or app write to this row since our read would
        // be clobbered by writing our copy of the ledger. On a miss, throw —
        // the cursor is not stamped and the next run re-reads.
        let upd = s
          .from("invoices")
          .update({
            payments: plan.ledger,
            amount_paid: plan.amountPaid,
            status: settlementStatus(localInv.status, plan.amountPaid, localInv),
            ...flagChange,
            updated_at: new Date().toISOString(),
          })
          .eq("id", localInv.id)
          .eq("user_id", row.user_id);
        if (localInv.updated_at) upd = upd.eq("updated_at", localInv.updated_at);
        const { data: wrote, error: wErr } = await upd.select("id");
        if (wErr) throw new Error(`invoice reconcile write: ${wErr.message}`);
        if (!wrote || (wrote as unknown[]).length === 0) {
          throw new Error(`invoice ${localInv.id} changed during reconcile; retrying next run`);
        }

        if (plan.appended.length > 0) pulled++;
      }

      // -------------------------------------------------------------------
      // 2b) Pull Purchase/Bill cost lines → stage into qbo_cost_lines (F5).
      //     Cursors: purchase_pull_last_at / bill_pull_last_at, one per
      //     entity (NOT last_sync_at, NOT shared — see header note).
      // -------------------------------------------------------------------
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const cursorCols = row as QboConnectionRow & {
        purchase_pull_last_at?: string | null;
        bill_pull_last_at?: string | null;
      };
      // QBO CWQL expects 'YYYY-MM-DD HH:MM:SS' (no T, no timezone suffix).
      const toQboTs = (iso: string) =>
        iso.replace("T", " ").replace(/\..*$/, "").slice(0, 19);

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
      // Per-entity cursor bookkeeping. Queries are ordered by LastUpdatedTime
      // ASC with `>=` (inclusive) so a page cut landing inside a same-second
      // group re-fetches that second next cycle instead of skipping its tail
      // forever — the idempotent upsert plus the G11 prior-status skip absorb
      // re-pulled rows. Advance rules per entity:
      //  - full page → resume from the max LastUpdatedTime seen; if that made
      //    no forward progress (an ENTIRE page shares the cursor's second),
      //    step 1s past it — accepted residue, vanishingly rare;
      //  - caught up → stamp now minus a 5-minute overlap so rows that were
      //    not yet visible to the query (Intuit clock skew / late-committing
      //    txns) are re-queried next cycle; kept monotonic.
      const COST_CURSOR_LOOKBACK_MS = 5 * 60 * 1000;
      interface EntityCursor {
        sinceIso: string;
        maxSeenMs: number;
        pageFull: boolean;
      }
      const makeCursor = (stored: string | null | undefined): EntityCursor => ({
        sinceIso: stored ?? "1970-01-01T00:00:00Z",
        maxSeenMs: 0,
        pageFull: false,
      });
      const trackSeen = (c: EntityCursor, txns: QboCostTxn[]) => {
        if (txns.length >= COST_PAGE_SIZE) c.pageFull = true;
        for (const t of txns) {
          const ms = Date.parse(t.MetaData?.LastUpdatedTime ?? "");
          if (!Number.isNaN(ms) && ms > c.maxSeenMs) c.maxSeenMs = ms;
        }
      };
      const nextCursor = (c: EntityCursor): string => {
        const sinceMs = Date.parse(c.sinceIso) || 0;
        if (c.pageFull && c.maxSeenMs > 0) {
          if (c.maxSeenMs > sinceMs) return new Date(c.maxSeenMs).toISOString();
          return new Date(sinceMs + 1000).toISOString();
        }
        return new Date(Math.max(sinceMs, nowMs - COST_CURSOR_LOOKBACK_MS)).toISOString();
      };
      const purchaseCursor = makeCursor(cursorCols.purchase_pull_last_at);
      const billCursor = makeCursor(cursorCols.bill_pull_last_at);

      // Purchases (cash/card/check expenses). Credit=true rows are refunds —
      // skipped (no deletion/void propagation in v1; documented cut).
      const pq = (await qboFetch(
        row,
        "/query?query=" +
          encodeURIComponent(
            `select * from Purchase where MetaData.LastUpdatedTime >= '${toQboTs(purchaseCursor.sinceIso)}' orderby MetaData.LastUpdatedTime MAXRESULTS ${COST_PAGE_SIZE}`,
          ),
        { method: "GET" },
      )) as { QueryResponse?: { Purchase?: QboCostTxn[] } };
      const purchases = pq?.QueryResponse?.Purchase ?? [];
      trackSeen(purchaseCursor, purchases);
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
            `select * from Bill where MetaData.LastUpdatedTime >= '${toQboTs(billCursor.sinceIso)}' orderby MetaData.LastUpdatedTime MAXRESULTS ${COST_PAGE_SIZE}`,
          ),
        { method: "GET" },
      )) as { QueryResponse?: { Bill?: QboCostTxn[] } };
      const bills = bq?.QueryResponse?.Bill ?? [];
      trackSeen(billCursor, bills);
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
        //
        // The read is load-bearing (a confirmed row's project_id would be
        // wiped to NULL if its prior entry is missing), so it must not fail
        // open: a read error THROWS — aborting the cost pass leaves the
        // cursors unstamped, the same safe-retry path the upsert uses — and
        // the read is chunked + range-paged so PostgREST's 1000-row response
        // cap can never silently truncate priorByKey.
        const keyOf = (t: string, id: string, lid: string) => `${t}|${id}|${lid}`;
        const priorByKey = new Map<string, { status: string; project_id: string | null }>();
        const allQboIds = [...new Set(staged.map((l) => l.qbo_id))];
        const ID_CHUNK = 100;
        const READ_PAGE = 1000;
        for (let i = 0; i < allQboIds.length; i += ID_CHUNK) {
          const idChunk = allQboIds.slice(i, i + ID_CHUNK);
          for (let from = 0; ; from += READ_PAGE) {
            const { data: priorRows, error: priorErr } = await s
              .from("qbo_cost_lines")
              .select("qbo_type,qbo_id,qbo_line_id,status,project_id")
              .eq("user_id", row.user_id)
              .in("qbo_id", idChunk)
              .order("id", { ascending: true })
              .range(from, from + READ_PAGE - 1);
            if (priorErr) throw new Error(`qbo_cost_lines prior read: ${priorErr.message}`);
            const batch = (priorRows ?? []) as { qbo_type: string; qbo_id: string; qbo_line_id: string; status: string; project_id: string | null }[];
            for (const p of batch) {
              priorByKey.set(keyOf(p.qbo_type, p.qbo_id, p.qbo_line_id), p);
            }
            if (batch.length < READ_PAGE) break;
          }
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

      // Stamp BOTH per-entity cursors only after a fully successful cost
      // pass (advance rules documented at nextCursor above).
      await s
        .from("qbo_connections")
        .update({
          purchase_pull_last_at: nextCursor(purchaseCursor),
          bill_pull_last_at: nextCursor(billCursor),
        })
        .eq("user_id", row.user_id);

      // -------------------------------------------------------------------
      // 3) Advance the invoice pull's cursor. NOT "now at the end of the run":
      //    that skipped every payment the bookkeeper recorded while this run
      //    worked, and everything past a full first page. qbo-setup shows it
      //    as "Last reconcile", so it now reads up to 5 minutes early.
      // -------------------------------------------------------------------
      await s
        .from("qbo_connections")
        .update({
          last_sync_at: nextInvoicePullCursor({ sinceIso: row.last_sync_at, queryStartMs: invoicePullStartMs, rows: updated }),
        })
        .eq("user_id", row.user_id);
    } catch (e) {
      errors++;
      await s
        .from("qbo_connections")
        .update({ last_error: String((e as Error).message ?? e).slice(0, 300) })
        .eq("user_id", row.user_id);
    }
  }

  return json({ success: true, pushed, paymentsPushed, pulled, costStaged, errors });
});
