// What a Send to the client portal freezes, and what stays live.
//
// A tiny module on purpose: contexts/ProjectContext.tsx freezes the copy at
// Send (freezeForPortal) and utils/portalSnapshot.ts renders it
// (portalLiveOverrides), and neither should pull the other's imports in.

import type { SendableItemKind } from '@/types';

/** The largest frozen copy a Send stores on portal_state (bytes of JSON).
 *  portal_state is jsonb with no size constraint, and the portal snapshot
 *  carries the same lines rendered anyway. 32 KB refused a G702/G703 with
 *  ~100 lines outright — the one document that cannot be "split" — so the cap
 *  is a last-resort guard against runaway notes, not a document-size limit. */
export const MAX_PORTAL_SNAPSHOT_BYTES = 200_000;

/** Invoice lines the portal shows (utils/portalSnapshot maxInvoiceLines
 *  default). The frozen copy keeps no more than the serializer reads. */
export const PORTAL_MAX_INVOICE_LINES = 10;

/**
 * The fields of a sent item that are STATE, not the document he sent — they
 * always come from the live row, laid over the frozen copy.
 *
 * WHY (invoice-to-paid blocker #4). A Send froze the raw item and the portal
 * rendered that frozen object as-is, skipping its serializer: an invoice
 * reached the client with no `total` / `balance` (the domain names are
 * totalDue / amountPaid), so it read "Balance due —" with no Pay button — and
 * even with the names fixed, a frozen balance goes stale on the first payment
 * and a frozen pay link skips the MONEY-F2 gate (the link shows only while its
 * minted amount equals what is owed). So the frozen copy keeps what he wrote
 * — line items, amounts billed, terms, notes — and what has happened since
 * (payments, retention released, the current pay link, the client's approval,
 * the architect's answer, the photo's stored file) is read live.
 */
export function portalLiveOverrides(kind: SendableItemKind, live: unknown): Record<string, unknown> {
  const r = (live ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = r[k];
    return out;
  };
  switch (kind) {
    case 'invoice':
      // dueDate moves WITH status (Mark sent / Send & Save recompute it, a
      // retention release that reopens an invoice stamps a new one — see
      // utils/retainage.ts), and a sent invoice's editor is locked, so it only
      // ever changes through those events. A frozen due date beside a live
      // status read "Overdue" on the portal for an invoice that was not.
      return pick('amountPaid', 'payments', 'status', 'dueDate', 'payLinkUrl', 'payLinkId', 'payLinkAmount',
        'retentionReleased', 'retentionReleases');
    case 'aia_pay_app':
      return pick('paidAt', 'payLinkUrl', 'payLinkId', 'payLinkAmount');
    case 'change_order':
    case 'rfi':
    case 'submittal':
      return pick('status');
    case 'photo':
      // The pixels are not an editable figure, and a data: URI would blow the
      // snapshot cap — the frozen copy leaves them out (freezeForPortal).
      return pick('uri');
    default:
      return {};
  }
}

/**
 * The frozen copy a Send stores on portalState.lastSentSnapshot, or null when
 * it would not fit. The item's own portalState is left out — it carries the
 * PREVIOUS snapshot, so every re-send nested one more copy inside the next
 * until the cap truncated it into JSON that no longer parsed, and the portal
 * silently fell back to live state. A photo's uri is left out too (it is laid
 * back over live, see portalLiveOverrides). Null → the caller refuses the send
 * and says why, rather than storing a truncated copy.
 */
export function freezeForPortal(kind: SendableItemKind, item: unknown): string | null {
  try {
    const { portalState: _prev, ...rest } = (item ?? {}) as Record<string, unknown>;
    void _prev;
    if (kind === 'photo') delete rest.uri;
    // Freeze only what the serializer reads. `payments` is always laid back
    // over live; invoice lines past what the portal shows are never rendered;
    // an AIA line's id / linkedTaskId are app bookkeeping. Every G703 line is
    // kept — the certificate is the whole schedule of values.
    if (kind === 'invoice') {
      delete rest.payments;
      if (Array.isArray(rest.lineItems)) rest.lineItems = rest.lineItems.slice(0, PORTAL_MAX_INVOICE_LINES);
    }
    if (kind === 'aia_pay_app' && Array.isArray(rest.lines)) {
      rest.lines = (rest.lines as Record<string, unknown>[]).map(l => ({
        itemNo: l.itemNo, description: l.description, scheduledValue: l.scheduledValue,
        fromPreviousApp: l.fromPreviousApp, thisPeriod: l.thisPeriod,
        materialsPresentlyStored: l.materialsPresentlyStored, retainagePercent: l.retainagePercent,
      }));
    }
    const raw = JSON.stringify(rest);
    return raw.length > MAX_PORTAL_SNAPSHOT_BYTES ? null : raw;
  } catch { return null; }
}
