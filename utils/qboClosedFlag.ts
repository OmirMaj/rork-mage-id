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
