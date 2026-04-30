// mailtoComposer — small helper for building `mailto:` URLs that
// open the user's mail client with subject + body pre-filled.
//
// Why centralized: pre-2026-04 we had 9 places opening `mailto:` with
// just a recipient address. Subject blank, body blank, contact left
// staring at an empty composer. Now every mailto: in the app passes
// through here and gets context (project name, scope, lead source,
// whatever's relevant) so the GC isn't typing the same intro every
// time.

export interface MailtoOpts {
  /** Recipient email. Required. */
  to: string;
  /** Subject line. Will be URL-encoded. */
  subject?: string;
  /** Body lines — joined with newline. URL-encoded. */
  body?: string[];
  cc?: string;
  bcc?: string;
}

/**
 * Build a `mailto:` URL string. Caller passes to Linking.openURL().
 * Splitting the build from the open lets callers keep their existing
 * error handling pattern around openURL.
 */
export function buildMailtoUrl(opts: MailtoOpts): string {
  const params: string[] = [];
  if (opts.subject) params.push(`subject=${encodeURIComponent(opts.subject)}`);
  if (opts.body && opts.body.length > 0) {
    // Trim trailing empty lines but keep the structure clean.
    const body = opts.body.join('\n').replace(/\n+$/, '');
    if (body) params.push(`body=${encodeURIComponent(body)}`);
  }
  if (opts.cc) params.push(`cc=${encodeURIComponent(opts.cc)}`);
  if (opts.bcc) params.push(`bcc=${encodeURIComponent(opts.bcc)}`);
  const query = params.length > 0 ? '?' + params.join('&') : '';
  return `mailto:${opts.to}${query}`;
}

/**
 * Standard sign-off used in app-composed emails so they don't end cold.
 * Caller appends their name / context above this.
 */
export function mailSignOff(senderName?: string): string[] {
  if (senderName) {
    return ['', `Thanks,`, senderName, '', '— Sent from MAGE ID'];
  }
  return ['', '— Sent from MAGE ID'];
}
