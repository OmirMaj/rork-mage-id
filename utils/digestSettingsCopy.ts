// utils/digestSettingsCopy.ts — what the Notifications screen says when the
// morning-digest Email switch or the "preview" button does not do what he
// asked. Pure, so scripts/validate-digest-preview-reasons.ts executes it.
//
// Why (leftovers review, 2026-09-18):
//   1. Every digest-email turn-ON goes through supabase.rpc
//      ('resume_my_digest_email'), added by migration 20260918170000. If the
//      OTA lands before that migration, PostgREST answers PGRST202 and the
//      screen said "We could not reach the server" — the switch could never
//      turn on, and the alert blamed his connection. A missing function now
//      falls back to the pre-migration behaviour (write the setting), and a
//      server refusal is worded as a refusal.
//   2. The preview read every sent:false as "No projects to digest", even
//      when his address had unsubscribed or the Email switch was off.

/** The shape supabase-js hands back for an RPC error (PostgrestError), plus
 *  the HTTP status some transports add. */
export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

export type ResumeErrorKind = 'missing_function' | 'network' | 'refused';

export function resumeDigestErrorKind(error: RpcErrorLike): ResumeErrorKind {
  const code = (error.code ?? '').trim();
  const msg = error.message ?? '';
  // PGRST202: no function by that name/signature in PostgREST's schema cache
  // (the migration has not been applied yet). A 404 is the same answer.
  if (code === 'PGRST202' || error.status === 404 || /could not find the function/i.test(msg)) return 'missing_function';
  // No code at all = the request never got a Postgres/PostgREST answer.
  if (!code && (/fetch|network|timed? ?out|abort/i.test(msg) || !msg)) return 'network';
  return 'refused';
}

export const RESUME_NETWORK_COPY = {
  title: "Couldn't turn email back on",
  message: 'We could not reach the server. Check your connection and try again.',
} as const;

export function resumeRefusedCopy(error: RpcErrorLike): { title: string; message: string } {
  const code = (error.code ?? '').trim();
  return {
    title: "Couldn't turn email back on",
    message: `The server refused the change${code ? ` (${code})` : ''}, so the morning email stays off. Try again later; if it keeps happening, contact support.`,
  };
}

/** Reasons morning-digest returns with sent:false (digestGate.ts
 *  digestNotSentReason). An older deployed function returns none. */
export type DigestPreviewReason =
  | 'email_off'
  | 'no_email'
  | 'nothing_to_report'
  | 'suppressed_unsubscribed'
  | 'send_failed'
  /** Wave 5 (#130): the digest now goes to the sign-in address, and the
   *  function could not read it this time. Not the same as no address. */
  | 'recipient_unknown';

/**
 * Where both GC digests go (audit 2026-09-23 #130): his SIGN-IN address, the
 * one this screen's suppression check and resume path key on — no longer the
 * Company Profile email. Said on the screen because the two can differ, and a
 * GC who set office@… as his company email would otherwise look for the brief
 * there. null when the account has no sign-in address (nothing true to say).
 */
export function digestRecipientLine(signInEmail: string | null | undefined): string | null {
  const email = typeof signInEmail === 'string' ? signInEmail.trim() : '';
  return email ? `Sent to your sign-in address, ${email}.` : null;
}

export function morningPreviewCopy(
  data: { sent?: unknown; reason?: unknown } | null | undefined,
  /** The signed-in user's auth email (useAuth().user.email). Optional so an
   *  older caller keeps working; when given, a sent preview names the inbox. */
  signInEmail?: string | null,
): { title: string; message: string } {
  if (data?.sent === true) {
    const where = digestRecipientLine(signInEmail);
    return {
      title: 'Preview sent',
      message: `${where ? `${where} ` : ''}Check your inbox in a few seconds. The digest reads what you have right now — set up a project with a location to see weather and tasks.`,
    };
  }
  switch (data?.reason) {
    case 'suppressed_unsubscribed':
      return {
        title: 'Your address unsubscribed',
        message: 'You unsubscribed from this email with a link in one of them, so nothing was sent. Turn the Email switch off and on again to resume it.',
      };
    case 'email_off':
      return {
        title: 'Email is off',
        message: 'The morning digest\'s Email switch is off, so no preview was emailed. Turn it on above, then preview again.',
      };
    case 'no_email':
      // The digest goes to the sign-in address; this is an account signed in
      // without one (the Company Profile email is used only then, and it is
      // empty too).
      return {
        title: 'No email address',
        message: 'You are signed in without an email address, so there is nowhere to send the preview.',
      };
    case 'recipient_unknown':
      return {
        title: 'Preview not sent',
        message: 'We could not look up your sign-in email address just now, so no preview was sent. Try again in a few minutes.',
      };
    case 'send_failed':
      return {
        title: 'Preview not sent',
        message: 'The email service did not accept the preview. Try again in a few minutes.',
      };
    case 'nothing_to_report':
    default:
      // 'nothing_to_report', or an older function that gives no reason (its
      // only no-send cases were the ones this copy always described).
      return {
        title: 'No projects to digest',
        message: 'Add an active project with a location to preview the digest. We use the lat/lng of each project to pull a hyperlocal weather forecast.',
      };
  }
}
