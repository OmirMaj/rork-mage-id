// utils/payApp/sendLock.ts — a pay application is locked when it is sent,
// with or without a pay link. Easier Pay Applications, Phase 1.
//
// Until now the lock on app/aia-pay-app.tsx keyed on the Stripe pay link (or a
// payment): a contractor without Stripe could certify, send the PDF, and then
// change the figures on the record the PDF was made from. Now the moment he
// certifies is stamped on the record (`sentLockedAt`) when no pay link was
// made, and the screen treats the stamp the way it treats a link.
//
// WHO HOLDS THE LOCK. The app holds it first: the stamp rides in the record's
// `snapshot_totals` sidecar and this file reads it. The DATABASE holds it too
// once 20261014090000_aia_pay_app_send_lock.sql is applied: the first write
// that carries the sidecar stamp makes the server set its own
// `sent_locked_at` column (the server's clock, never a value the app sends),
// and the freeze trigger then refuses a change to the figures the same way it
// does for a row with a pay link. The app never writes that column. Before
// that migration is applied the lock is the app's alone, and an old build or
// a direct write could still change the row.
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

/**
 * Does the SERVER keep this record's row whatever the app does next? True for
 * a record locked by the send, by a pay link or by a payment: the database
 * refuses to delete it (20261014100000_aia_pay_app_delete_guard.sql). The
 * save path asks this before its housekeeping delete of an older record of
 * the same period, so it never sends a delete that will be refused and never
 * drops from the device a record the server still holds.
 */
export function keepsItsServerRow(rec: { sentLockedAt?: string | null; payLinkUrl?: string | null; paidAt?: string | null; paymentPendingAt?: string | null } | null | undefined): boolean {
  if (!rec) return false;
  return payAppLock({ sentLockedAt: rec.sentLockedAt, payLinkUrl: rec.payLinkUrl, paidAt: rec.paidAt, pendingBankPayment: !!rec.paymentPendingAt }).locked;
}

// ── A Pay button, added later ───────────────────────────────────────────────
// A record locked at send may have gone out with NO pay link (Stripe not set
// up yet, or the link could not be made in time). The lock refuses a re-save,
// so without this the promise the certify result makes ("share the pay app
// again later to add one") could never be kept. Adding the button is the one
// thing a 'sent' record may still learn, and it changes no figure:
// withPayLinkOnly writes the three pay link fields and nothing else, and
// figuresOf is the proof (the same string before and after).

/** May a Pay button be added to this record now? Only a record locked by the send itself, with money owed. */
export function canAddPayButton(facts: SendLockFacts | null | undefined, due: number): boolean {
  return payAppLock(facts).reason === 'sent' && Number.isFinite(due) && due > 0;
}

export interface MintedPayLink { payLinkUrl: string; payLinkId: string; payLinkAmount: number }

/** The stored record with the pay link on it. Every other field is the same object's own value. */
export function withPayLinkOnly<T extends object>(rec: T, link: MintedPayLink): T & MintedPayLink {
  return { ...rec, payLinkUrl: link.payLinkUrl, payLinkId: link.payLinkId, payLinkAmount: link.payLinkAmount };
}

/** Everything on a record except its pay link, as one string. Equal before and after means no figure moved. */
export function figuresOf(rec: object): string {
  const { payLinkUrl: _u, payLinkId: _i, payLinkAmount: _a, ...rest } = rec as Record<string, unknown>;
  void _u; void _i; void _a;
  return JSON.stringify(rest);
}

export const SEND_LOCK_COPY = {
  addPayButton: 'Add a Pay Button',
  addPayButtonHint: 'This application went out without a Pay button. Adding one changes no figure on it.',
  payButtonAddedTitle: 'Pay Button Added',
  payButtonAddedBody: (amount: string) => `The client portal now shows a Pay button for ${amount}. No figure on the application changed.`,
  payButtonNotAddedTitle: 'Pay Button Not Added',
  payButtonNotConnected: 'Stripe is not connected, so no Pay button was made. Set up Stripe, then add the button here. Nothing on the application changed.',
  payButtonFailed: 'Stripe could not make the pay link. Nothing on the application changed. Try again in a moment.',
  payButtonBalance: 'The server shows a different balance for this pay app, so no Pay button was made. Nothing on the application changed.',
  payButtonNothingOwed: 'No Pay button was made: nothing can be collected on this application right now. Nothing on it changed.',
  /** The locked banner's body when the lock is the send itself (no pay link, not paid). */
  lockedBody: (applicationNumber: number) =>
    `You certified and sent Application ${applicationNumber}, so its figures are kept as they went out. `
    + 'To revise the numbers, bill the next period. It starts from this period\'s billed-through totals.',
  lockedAlert: 'You certified and sent this pay app. Bill the next period to revise it.',
} as const;
