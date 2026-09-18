/**
 * The client's read of the "closed in QuickBooks without a payment" flag that
 * qbo-reconciler writes into invoices.qbo_error.
 *
 * Twin of QBO_CLOSED_WITHOUT_PAYMENT_PREFIX / QBO_ERROR_APPEND_SEP / closedFlagOf
 * in supabase/functions/_shared/paymentLedger.ts (the app cannot import Deno
 * files); scripts/validate-qbo-payment-ledger.ts runs both over the same input.
 *
 * Why the invoice screen needs it: invoice-dunning's cron pauses on the flag,
 * but a manual "Send reminder" goes through on the assumption the GC has
 * looked — and the screen used to give him nothing to look at.
 */
export const QBO_CLOSED_WITHOUT_PAYMENT_PREFIX = 'QuickBooks shows this invoice closed without a payment';
export const QBO_ERROR_APPEND_SEP = '\n\nAlso: ';

/** The flag sentence on this invoice, or null when it is not flagged. */
export function qboClosedFlagOf(qboError: unknown): string | null {
  if (typeof qboError !== 'string' || !qboError.startsWith(QBO_CLOSED_WITHOUT_PAYMENT_PREFIX)) return null;
  return qboError.split(QBO_ERROR_APPEND_SEP)[0];
}

/** What closed it in QuickBooks, read off the flag's own sentence. The screens
 *  used to explain every flag as "cleared by something other than a payment"
 *  — false for a void, and backwards for a refund gap, where QuickBooks DID
 *  take a real payment and it is MAGE that recorded money going back out.
 *  Markers are phrases of the reconciler's notes (voidedInQuickBooksNote,
 *  refundGapNote in supabase/functions/_shared/paymentLedger.ts); pinned by
 *  scripts/validate-qbo-payment-ledger.ts against the real note text. */
export const QBO_VOID_FLAG_MARKER = 'it was voided in QuickBooks';
export const QBO_REFUND_GAP_FLAG_MARKER = 'as refunded or charged back';
export type QboClosedFlagKind = 'void' | 'refund_gap' | 'credit';
export function qboClosedFlagKind(flag: string): QboClosedFlagKind {
  if (flag.includes(QBO_VOID_FLAG_MARKER)) return 'void';
  if (flag.includes(QBO_REFUND_GAP_FLAG_MARKER)) return 'refund_gap';
  return 'credit';
}

/** The "Send anyway" alert's reason line, true to the flag's kind. */
export function qboClosedFlagAlertReason(flag: string): string {
  switch (qboClosedFlagKind(flag)) {
    case 'void':
      return 'It was voided in QuickBooks, so automatic reminders are paused.';
    case 'refund_gap':
      return 'QuickBooks counts more paid on it than MAGE holds, because MAGE recorded part of the money as refunded or charged back. Automatic reminders are paused.';
    default:
      return 'It was cleared there by something other than a payment, so automatic reminders are paused.';
  }
}
