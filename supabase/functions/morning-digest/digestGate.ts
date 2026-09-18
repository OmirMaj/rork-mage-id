// morning-digest/digestGate.ts — the unsubscribe check both GC digests run
// before they email anyone. Imported by morning-digest and daily-digest.
//
// Why it exists (audit 2026-09-18 #15): both digests put an unsubscribe link
// in the footer and a List-Unsubscribe header on the message. Clicking either,
// or Gmail's one-click Unsubscribe, writes an email_unsubscribes row and the
// page says "You're unsubscribed." Neither digest ever read that table, so the
// same email arrived the next morning. That is the moment a reader reaches for
// "Report spam", and spam reports land on the shared sending domain that also
// carries every GC's invoices and portal invites.
//
// The rule is one function so a validator can EXECUTE it
// (scripts/validate-email-honesty.ts) rather than only grep for a call:
// a suppressed address is never sent to, and the outcome is recorded as
// 'suppressed_unsubscribed' in notification_outbox.email_status, the same
// value notify writes.
//
// Only the EMAIL is gated. The in-app inbox row and the push are not email and
// were not what he unsubscribed from; they follow digest_channels as before.

export type DigestEmailOutcome = 'sent' | 'failed' | 'suppressed_unsubscribed';

/** The suppression key both GC digests put in their unsubscribe links. */
export const GC_DIGEST_EVENT_KEY = 'daily_digest';

export async function sendDigestUnlessUnsubscribed(opts: {
  /** True when this address opted out of the digest (or of all email). */
  isUnsubscribed: () => Promise<boolean>;
  /** The actual send. Never called for a suppressed address. */
  send: () => Promise<boolean>;
}): Promise<DigestEmailOutcome> {
  if (await opts.isUnsubscribed()) return 'suppressed_unsubscribed';
  return (await opts.send()) ? 'sent' : 'failed';
}
