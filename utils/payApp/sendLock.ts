// utils/payApp/sendLock.ts — a pay application is locked when it is sent,
// with or without a pay link. Easier Pay Applications, Phase 1.
//
// Until now the lock on app/aia-pay-app.tsx keyed on the Stripe pay link (or a
// payment): a contractor without Stripe could certify, send the PDF, and then
// change the figures on the record the PDF was made from. Now the moment he
// certifies is stamped on the record (`sentLockedAt`) when no pay link was
// made, and the screen treats the stamp the way it treats a link.
//
// THE LIMIT, STATED PLAINLY. This is the app's own lock. The stamp rides in
// the record's `snapshot_totals` sidecar (no column, no migration), so the
// DATABASE freeze, which keys on `certified_at` and is stamped only by
// create-payment-link, does not cover it. An old build or a direct write could
// still change the row. Stamping the server column without Stripe is a server
// change and is not part of this phase.
//
// Pure: no clock (now is passed in), no storage.

export interface SendLockFacts {
  payLinkUrl?: string | null;
  paidAt?: string | null;
  /** A bank payment the client started is still settling. */
  pendingBankPayment?: boolean;
  sentLockedAt?: string | null;
}

export type SendLockReason = 'paid' | 'payment_pending' | 'pay_link' | 'sent' | null;

/** Is this record locked, and by what. A payment outranks a link, a link outranks the stamp. */
export function payAppLock(facts: SendLockFacts | null | undefined): { locked: boolean; reason: SendLockReason } {
  if (!facts) return { locked: false, reason: null };
  if (facts.paidAt) return { locked: true, reason: 'paid' };
  if (facts.pendingBankPayment) return { locked: true, reason: 'payment_pending' };
  if (facts.payLinkUrl) return { locked: true, reason: 'pay_link' };
  if (facts.sentLockedAt) return { locked: true, reason: 'sent' };
  return { locked: false, reason: null };
}

/**
 * The record as it is stored at certify. The stamp is set once: a record that
 * already carries one keeps it, and nobody outside the preview gets one.
 */
export function withSentLock<T extends { sentLockedAt?: string }>(rec: T, nowIso: string, allowed: boolean): T {
  if (!allowed) return rec;
  if (rec.sentLockedAt) return rec;
  return { ...rec, sentLockedAt: nowIso };
}

export const SEND_LOCK_COPY = {
  /** The locked banner's body when the lock is the send itself (no pay link, not paid). */
  lockedBody: (applicationNumber: number) =>
    `You certified and sent Application ${applicationNumber}, so its figures are kept as they went out. `
    + 'To revise the numbers, bill the next period. It starts from this period\'s billed-through totals.',
  lockedAlert: 'You certified and sent this pay app. Bill the next period to revise it.',
} as const;
