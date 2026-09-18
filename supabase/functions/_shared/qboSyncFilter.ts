/**
 * Which invoice rows still owe QuickBooks a push, as ONE PostgREST `or=`
 * filter shared by qbo-reconciler step 1 (what it pushes) and
 * qbo-connect-status (what qbo-setup counts as Pending) — so the screen can
 * never say "all synced" about a row the sweep will not pick up.
 *
 * 'pending' / 'error' are the app's own markers. The third arm is a non-draft
 * row with NO status: the app marks 'pending' only on its own non-draft write
 * (utils/invoiceWrites), so a draft that becomes paid server-side
 * (stripe-webhook creditInvoice, round 4) — or a row older than that rule —
 * would otherwise never be pushed, nor its payment (step 1b needs qbo_id).
 * Drafts stay out: a draft is not a receivable (audit #12). Pure — the
 * validator executes it against an in-memory evaluator.
 */
export const QBO_PUSH_OWED_FILTER =
  "qbo_sync_status.eq.pending,qbo_sync_status.eq.error,and(qbo_sync_status.is.null,status.neq.draft)";

/** qbo-connect-status's "Pending" count: the owed set minus 'error' (counted
 *  on its own). Not `.neq('error')` — in SQL `NULL <> 'error'` is NULL, which
 *  would silently drop exactly the no-status rows this exists to count. */
export const QBO_PENDING_COUNT_FILTER =
  "qbo_sync_status.eq.pending,and(qbo_sync_status.is.null,status.neq.draft)";

/** The same set as a row predicate, for replays and the in-app wording. */
export function qboPushOwed(row: { qbo_sync_status?: string | null; status?: string | null }): boolean {
  const s = row.qbo_sync_status ?? null;
  if (s === "pending" || s === "error") return true;
  // SQL semantics of `status.neq.draft`: a NULL status is not selected.
  return s === null && row.status != null && row.status !== "draft";
}
