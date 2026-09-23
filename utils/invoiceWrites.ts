// Invoice writes — the pure half of ProjectContext.addInvoice / updateInvoice.
//
// WHY THIS IS A MODULE (invoice-to-paid audit, blocker #3). updateInvoice used
// to map the `invoices` array its render closed over. A screen that calls
// addInvoice and then, in the same async flow, updateInvoice (the invoice
// screen's Send: create → mint pay link → email → roll back on failure) handed
// updateInvoice a list that did not hold the new invoice yet. It found nothing,
// queued NO server write, and saved that stale list over state and the device
// copy — so the invoice vanished from his phone while the server kept the
// queued INSERT as 'sent', he rebuilt it under the same number, and dunning
// chased both. The context now reads a ref that addInvoice updates
// synchronously; these functions are what it runs on that list, so the
// composition is executed by scripts/validate-invoice-send-integrity.ts rather
// than argued.

import type { Invoice, InvoiceStatus } from '@/types';
import { shouldFlipInvoiceToPaid } from '@/utils/projectContextPure';
import { dueDateForTerms } from '@/utils/retainage';
import { netBalanceDue, roundCents } from '@/utils/invoiceBilling';

/**
 * Apply `updates` to invoice `id` in `list`. `prev` is the row before the edit
 * (for new-payment detection), `merged` the row after (undefined when `id` is
 * not in the list — the caller still queues a scoped write, see
 * invoiceUpdatePayload).
 */
export function mergeInvoiceUpdate(
  list: readonly Invoice[],
  id: string,
  updates: Partial<Invoice>,
  now: string,
): { next: Invoice[]; prev?: Invoice; merged?: Invoice } {
  const prev = list.find(i => i.id === id);
  if (!prev) return { next: [...list] };
  const merged = { ...prev, ...updates, updatedAt: now } as Invoice;
  // Auto-flip to 'paid' when amount_paid catches up to total_due. Without
  // this, manual payment entries (check / cash / Zelle / ACH outside Stripe)
  // never flip the status field — read-time helpers compute it but anything
  // querying the raw status (AI digests, A/R, Supabase filters) sees stale
  // 'sent' or 'partially_paid'. The Stripe webhook does this server-side
  // already; this mirrors it for non-Stripe payment recording paths.
  // MONEY-F5: settled NET of held retention (invoiceIsSettled, 1-cent
  // tolerance) — the gross totalDue gate could never flip a retention
  // invoice. Pure + tested in utils/projectContextPure.ts.
  if (shouldFlipInvoiceToPaid(merged)) merged.status = 'paid';
  return { next: list.map(i => (i.id === id ? merged : i)), prev, merged };
}

/**
 * The invoices UPDATE payload for one edit. `inv` is the merged row — or, when
 * the invoice is not in memory, `{ id, ...updates }`: a missing row must still
 * reach the server (a skipped write is how a rolled-back send stayed 'sent'
 * there), and every column below is written only when its key is IN
 * `updates`, so an absent value is never invented. Undefined values drop out
 * of the JSON, leaving the server column as it was.
 */
export function invoiceUpdatePayload(
  inv: Partial<Invoice>,
  updates: Partial<Invoice>,
  id: string,
  now: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { id, updated_at: now };
  // QuickBooks only ever sees a sent invoice (quickbooks-money #12/#103):
  // qbo-sync refuses a draft server-side, so 'pending' on a draft only made the
  // reconciler call it for nothing — and flagged a draft rolled back from a
  // failed send as a QuickBooks error.
  if (inv.status !== 'draft') payload.qbo_sync_status = 'pending';
  // Scope the write to the columns this edit actually touched. amount_paid,
  // payments, and status are ALSO written by the Stripe webhook when a
  // payment succeeds; a passive edit (notes, line items, retention release,
  // pay-link attach) that blindly rewrote them would clobber a
  // webhook-recorded payment with stale local state, silently un-collecting
  // real money. The offline-queue 'update' op only SETs the keys present,
  // so omitting a column leaves the webhook's value intact.
  if ('notes' in updates) payload.notes = inv.notes;
  if ('lineItems' in updates) payload.line_items = inv.lineItems;
  if ('subtotal' in updates) payload.subtotal = inv.subtotal;
  if ('taxRate' in updates) payload.tax_rate = inv.taxRate;
  if ('taxAmount' in updates) payload.tax_amount = inv.taxAmount;
  if ('totalDue' in updates) payload.total_due = inv.totalDue;
  // The due date MOVES after the invoice exists — app/invoice.tsx
  // recomputes it from today and the terms when a saved draft is finally
  // sent, and utils/retainage.buildRetainageReleasePatch stamps a fresh
  // one when a release re-opens a paid invoice. Only addInvoice used to
  // write these three, so the server kept the draft's date: a draft saved
  // Sep 1 net-15 and sent Oct 20 drew "FINAL NOTICE — 34 days overdue" as
  // its FIRST reminder, because invoice-dunning counts days overdue from
  // the SERVER's invoices.due_date (audit round 2, #13).
  // due_date is text NOT NULL on the server and Invoice.dueDate is a
  // required string, so it is written as-is — a `?? null` here would be a
  // terminal write that drops the whole edit. The other two are nullable,
  // and a cleared value must reach the DB as null or the omitted key
  // leaves the old one in place on the next refetch.
  if ('dueDate' in updates && inv.dueDate) payload.due_date = inv.dueDate;
  if ('paymentTerms' in updates) payload.payment_terms = inv.paymentTerms ?? null;
  if ('progressPercent' in updates) payload.progress_percent = inv.progressPercent ?? null;
  // THE LEDGER IS NEVER WRITTEN FROM HERE (wave 4, #80 BLOCKER). amount_paid
  // and payments used to be sent whole from the device's copy, and the offline
  // queue replayed that UPDATE verbatim: a phone that had not seen the client's
  // $20,000 Pay-link payment recorded a $300 check and, on reconnect, wrote
  // [check] over the server's ledger — the Stripe entry, its PaymentIntent and
  // the $20,000 gone. A payment is now ONE entry appended on the server under a
  // row lock (invoice_append_payment, via ProjectContext.recordInvoicePayment),
  // which recomputes amount_paid and status from the ledger itself.
  // A status riding along with a payment field is dropped too: it was computed
  // from the same stale balance. (The server's invoices_ledger_guard enforces
  // all of this for writes queued by older builds.)
  const touchesLedger = 'amountPaid' in updates || 'payments' in updates;
  if ('status' in updates && !touchesLedger) payload.status = inv.status;
  // Retention (cloud-backed as of the 20260713 migration). Use ?? null,
  // NOT bare undefined: a cleared value must reach the DB as null, or
  // the omitted key leaves the old one in place on the next refetch.
  if ('retentionPercent' in updates) payload.retention_percent = inv.retentionPercent ?? null;
  if ('retentionAmount' in updates) payload.retention_amount = inv.retentionAmount ?? null;
  if ('retentionReleased' in updates || 'retentionReleases' in updates) {
    payload.retention_released = inv.retentionReleased ?? null;
    payload.retention_releases = inv.retentionReleases ?? null;
  }
  // MONEY-F2: pay_link_url / pay_link_id / pay_link_amount are never written
  // from the client — create-payment-link sets them and stripe-webhook nulls
  // them once the single-use link is paid. Echoing local payLinkUrl here
  // resurrected a spent link and re-armed a dead Pay button in the portal.
  // Dunning markers are OWNED by the invoice-dunning edge function; the
  // app only ever echoes back the values that function just returned
  // from a confirmed send, so this write is idempotent and can't invent
  // a reminder that never went out. Scoped like every other column
  // above so an unrelated edit never touches the cadence.
  if ('dunningStage' in updates || 'dunningLastSentAt' in updates) {
    payload.dunning_stage = inv.dunningStage ?? null;
    payload.dunning_last_sent_at = inv.dunningLastSentAt ?? null;
  }
  return payload;
}

/**
 * The invoice columns the server's answer is judged on after a recorded
 * payment (what commitPayment reads back once invoice_append_payment landed).
 */
export interface ServerInvoiceSettlement {
  total_due: number | string | null;
  amount_paid: number | string | null;
  subtotal: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  retention_released: number | string | null;
  status: string | null;
  pay_pending_at?: string | null;
}

export interface RecordedPaymentFollowUp {
  /** False only for 'failed': nothing was written and nothing may say it was. */
  recorded: boolean;
  /** The status to report: the server's when it answered, else the local guess. */
  status: InvoiceStatus;
  /** Re-mint the pay link for this amount (the SERVER's balance), or null = don't. */
  remintFor: number | null;
  /** The server's collectible balance, when it was read. */
  serverBalance: number | null;
}

const toNum = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What commitPayment does once recordInvoicePayment resolves (#80). The pay
 * link re-mint used to be computed from the device's balance — stale in exactly
 * the case this blocker is about — so it is now computed from the server's row,
 * read after the append landed:
 *  - 'failed'  → not recorded; no mint.
 *  - 'queued'  → recorded on this phone only; the server's balance has not
 *                moved, so there is nothing true to re-mint for — skip it.
 *  - 'synced'  → re-mint for the server's net balance when a link existed and
 *                money is still owed, never while a bank payment is processing
 *                (#83: minting then invites a second payment).
 * A server row that could not be read skips the mint rather than guessing.
 */
export function afterRecordedPayment(
  outcome: 'synced' | 'queued' | 'failed',
  server: ServerInvoiceSettlement | null,
  ctx: { hadPayLink: boolean; localStatus: InvoiceStatus },
): RecordedPaymentFollowUp {
  if (outcome === 'failed') return { recorded: false, status: ctx.localStatus, remintFor: null, serverBalance: null };
  if (outcome === 'queued' || !server) return { recorded: true, status: ctx.localStatus, remintFor: null, serverBalance: null };
  const balance = roundCents(netBalanceDue({
    totalDue: toNum(server.total_due),
    amountPaid: toNum(server.amount_paid),
    subtotal: server.subtotal == null ? undefined : toNum(server.subtotal),
    retentionPercent: server.retention_percent == null ? undefined : toNum(server.retention_percent),
    retentionAmount: server.retention_amount == null ? undefined : toNum(server.retention_amount),
    retentionReleased: toNum(server.retention_released),
  }));
  const status = (server.status as InvoiceStatus | null) ?? ctx.localStatus;
  const remintFor = ctx.hadPayLink && balance > 0.005 && !server.pay_pending_at ? balance : null;
  return { recorded: true, status, remintFor, serverBalance: balance };
}

type QueueEntryLike = { table: string; operation: string; data?: Record<string, unknown> };

/**
 * Whether `queue` still holds an INSERT of row `id` in `table` (not yet
 * flushed). A direct UPDATE sent while that insert waits matches 0 rows and
 * PostgREST calls it success — the queued insert then lands with the OLD
 * content. Any record whose edit can overtake its own queued create must
 * queue the edit behind it instead (invoices below; change orders in
 * ProjectContext.updateChangeOrder).
 */
export function insertStillQueued(queue: readonly QueueEntryLike[], table: string, id: string): boolean {
  return queue.some(e => e.table === table && e.operation === 'insert' && e.data?.id === id);
}

/** Whether `queue` still holds an INSERT of invoice `id` (not yet flushed). */
export function invoiceInsertStillQueued(queue: readonly QueueEntryLike[], id: string): boolean {
  return insertStillQueued(queue, 'invoices', id);
}

/**
 * One UPDATE, ordered behind this row's own create (round 4). The portal-state
 * writes (send / recall / batch send) and updateCommitment used to send a
 * direct UPDATE with no queue check: for an invoice made offline and shared to
 * the portal after signal returned but before the queue drained (backoff up to
 * 5 min), the UPDATE matched 0 rows, reported success, and the queued INSERT
 * then landed with portal_state 'draft' — the Outbox showed it unsent again
 * and the next publish dropped it (and its Pay button) from the client's
 * portal. A commitment edited after an offline award reverted the same way.
 *
 * Same rule as updateInvoice / updateChangeOrder: wait for an insert still on
 * the wire, then queue the edit behind a queued insert (the flush replays
 * FIFO); a queue that cannot be read counts as holding it — queuing is never
 * wrong, a 0-row "success" is. Resolves 'sent' | 'queued' | 'failed'.
 */
export async function writeBehindQueuedInsert(
  deps: {
    pendingInsert?: Promise<unknown>;
    getQueue: () => Promise<readonly QueueEntryLike[]>;
    enqueue: (entry: { table: string; operation: 'update'; data: Record<string, unknown> }) => Promise<unknown>;
    send: (table: string, payload: Record<string, unknown>) => Promise<unknown>;
  },
  table: string,
  payload: Record<string, unknown> & { id: string },
): Promise<'sent' | 'queued' | 'failed'> {
  if (deps.pendingInsert) { try { await deps.pendingInsert; } catch { /* outcome only orders the write */ } }
  let stillQueued = false;
  try { stillQueued = insertStillQueued(await deps.getQueue(), table, payload.id); } catch { stillQueued = true; }
  if (stillQueued) {
    try { await deps.enqueue({ table, operation: 'update', data: payload }); return 'queued'; } catch { return 'failed'; }
  }
  try { await deps.send(table, payload); return 'sent'; } catch { return 'failed'; }
}

/**
 * SHARING A DRAFT INVOICE IS SENDING IT (round 4). Send to Client is offered on
 * a draft, and the portal shows its Pay button whenever a link matching the
 * balance exists — the new-invoice Send mints that link BEFORE the email, so a
 * failed email left exactly such a draft. Shared as-is, the client could pay
 * a row the server still called 'draft': stripe-webhook moved it straight to
 * 'paid', nothing ever marked it for QuickBooks, and dunning never counted it.
 * So the share issues it the way Mark sent does — status 'sent', due date
 * counted from today on its stored terms. Null when it is not a draft.
 */
export function sharedDraftIssuePatch(inv: Pick<Invoice, 'status' | 'paymentTerms'>, nowIso: string): Pick<Invoice, 'status' | 'dueDate'> | null {
  if (inv.status !== 'draft') return null;
  return { status: 'sent', dueDate: dueDateForTerms(nowIso, inv.paymentTerms) };
}
