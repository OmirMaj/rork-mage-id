// utils/errorCopy.ts — turn a thrown thing into a sentence a contractor can act on.
//
// WHY THIS EXISTS. The 2026-09-07 app-experience audit ("Worth doing" #7)
// counted 46 alerts that print the raw exception as the message body, six of
// them with no fallback string at all — app/takeoff-estimate.tsx:518 and :554
// (`showAlert('Save failed', e instanceof Error ? e.message : String(e))`),
// app/prequal-form.tsx:138, settings:526, ProjectFilesBrowser:127/:148. A GC
// who had just priced forty takeoff lines got
//   "Could not find the 'markup' column of 'estimates' in the schema cache"
// as the ENTIRE explanation, and no indication of whether his work was gone.
//
// The three things every one of those alerts owed him, and none of them gave:
//   1. WHAT failed, in his words rather than PostgREST's.
//   2. WHAT TO DO next — one concrete step, not "try again" as a shrug.
//   3. WHETHER HIS WORK SURVIVED. That is the question he actually has, and
//      `keptLocally` is the only reason this module takes a context at all.
//
// The raw text is not thrown away — it belongs in `console.warn` next to the
// call (see rawErrorMessage) and in Sentry, where an engineer reads it. What
// reaches the alert body is the classification plus, when the server gave us
// one, a short reference code support can search on. A code is not a stack
// trace; it is the one token that makes "it keeps happening" diagnosable.
//
// PURE ON PURPOSE — no react-native, no expo, no imports at all — so
// scripts/validate-error-copy.ts can import it under bun and actually execute
// the classifier instead of grepping for its shape.

/** What went wrong, at the granularity the copy differs on. */
export type ErrorKind =
  | 'offline'
  | 'session'
  | 'permission'
  | 'rateLimit'
  | 'schema'
  | 'notFound'
  | 'conflict'
  | 'timeout'
  | 'cancelled'
  | 'server'
  | 'unknown';

export interface ErrorContext {
  /** Verb phrase naming what was being attempted, lower case, no trailing
   *  period: 'save this estimate', 'load your reports'. It is spliced into
   *  the body, so it has to read after "MAGE couldn't ". */
  action: string;
  /** TRUE when the user's input is still on this device after the failure
   *  (an optimistic local write landed, or the form is still on screen);
   *  FALSE when it is definitively gone. Omit when the caller genuinely
   *  cannot tell — silence beats a guess about whether his work survived. */
  keptLocally?: boolean;
}

export interface ErrorCopy {
  /** Short, plain, sentence case. Never "Error". */
  title: string;
  /** What happened, one next step, and — when the caller knows — whether the
   *  user's work survived. Never contains the raw exception text. */
  body: string;
  kind: ErrorKind;
  /** The server's own code (PGRST204, 23505, 401…) when there was one. Shown
   *  as a trailing reference, and useful to log. */
  code: string | null;
}

// ── Reading the thrown thing ────────────────────────────────────────────────
// Supabase hands back a PostgrestError ({ message, code, details, hint }), edge
// functions throw FunctionsHttpError with a `status`, fetch throws a bare
// TypeError, and half the app throws strings. All four land here.

function asRecord(err: unknown): Record<string, unknown> {
  return err !== null && typeof err === 'object' ? (err as Record<string, unknown>) : {};
}

/** The raw text, for `console.warn` and Sentry — NOT for a user-facing body. */
export function rawErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  const r = asRecord(err);
  if (typeof r.message === 'string' && r.message) return r.message;
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err) ?? String(err); } catch { return String(err); }
}

/** The server's error code, when it gave one. `status` counts: a 429 with no
 *  body is still the most useful thing we can quote back. */
export function errorCode(err: unknown): string | null {
  const r = asRecord(err);
  if (typeof r.code === 'string' && r.code.trim()) return r.code.trim();
  if (typeof r.code === 'number' && Number.isFinite(r.code)) return String(r.code);
  const status = typeof r.status === 'number' ? r.status
    : typeof r.statusCode === 'number' ? r.statusCode
    : null;
  return status !== null && status >= 400 ? `HTTP ${status}` : null;
}

function httpStatus(err: unknown): number | null {
  const r = asRecord(err);
  for (const key of ['status', 'statusCode', 'httpStatus'] as const) {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function errorName(err: unknown): string {
  const r = asRecord(err);
  return typeof r.name === 'string' ? r.name : '';
}

// ── Classification ──────────────────────────────────────────────────────────
// Codes first (exact), then HTTP status, then message text. Message matching is
// last and deliberately phrase-shaped: a bare /401/ would fire on an invoice
// number. Postgres SQLSTATEs are matched verbatim, PostgREST's PGRST* likewise.

export function classifyError(err: unknown): ErrorKind {
  const code = (errorCode(err) ?? '').toUpperCase();
  const name = errorName(err);
  const status = httpStatus(err);
  const msg = rawErrorMessage(err);

  if (name === 'AbortError' || /\baborted\b|\bcancell?ed\b/i.test(msg)) return 'cancelled';

  // PostgREST / Postgres codes.
  if (code === 'PGRST301') return 'session';
  if (code === 'PGRST204' || code === 'PGRST202' || code === '42703' || code === '42P01') return 'schema';
  if (code === 'PGRST116') return 'notFound';
  if (code === '42501') return 'permission';
  if (code === '23505') return 'conflict';
  if (code === '23503' || code === '23502') return 'conflict';

  if (status !== null) {
    if (status === 401) return 'session';
    if (status === 403) return 'permission';
    if (status === 404) return 'notFound';
    if (status === 408 || status === 504) return 'timeout';
    if (status === 409) return 'conflict';
    if (status === 429) return 'rateLimit';
    if (status >= 500) return 'server';
  }

  // The offline shapes, verbatim from the three runtimes: RN's
  // "Network request failed", web fetch's "Failed to fetch" / Safari's
  // "Load failed", and Node/Deno's socket errors.
  if (/network request failed|failed to fetch|load failed|network ?error|econnrefused|econnreset|enotfound|dns|offline|no internet/i.test(msg)) {
    return 'offline';
  }
  if (/bad_jwt|jwt expired|jwt is expired|invalid claim|jwserror|not authenticated|invalid refresh token|unauthorized/i.test(msg)) {
    return 'session';
  }
  if (/row-level security|permission denied|forbidden|not allowed/i.test(msg)) return 'permission';
  if (/rate ?limit|too many requests/i.test(msg)) return 'rateLimit';
  if (/schema cache|could not find the .* column|column .* does not exist|relation .* does not exist/i.test(msg)) {
    return 'schema';
  }
  if (/duplicate key|already exists/i.test(msg)) return 'conflict';
  if (/timed? ?out|etimedout|deadline exceeded/i.test(msg)) return 'timeout';
  if (/\bnot found\b|no rows returned/i.test(msg)) return 'notFound';
  if (/internal server error|service unavailable|bad gateway/i.test(msg)) return 'server';

  return 'unknown';
}

// ── Copy ────────────────────────────────────────────────────────────────────
// Every body: what happened → one concrete next step. `action` is spliced after
// "MAGE couldn't ", so it stays a verb phrase.

const TITLES: Record<ErrorKind, string> = {
  offline: "You're offline",
  session: 'Signed out',
  permission: 'Not allowed',
  rateLimit: 'Too many requests',
  schema: 'MAGE needs to update',
  notFound: 'That record is gone',
  conflict: 'That already exists',
  timeout: 'That took too long',
  cancelled: 'Cancelled',
  server: 'MAGE hit a problem',
  unknown: "That didn't go through",
};

// The two kinds whose only remaining advice is "tell support" have to know
// whether there will BE a reference to point at (review fix, 2026-09-07). The
// first draft ended both with "send support the reference below" — and
// `unknown` is the DEFAULT bucket, reached by every plain `new Error('…')` the
// app throws, which carries no code at all. So the single most common alert in
// the app told a GC to send support a reference that was not printed anywhere
// on the screen. That is the same defect class as the raw-exception body this
// module exists to kill: copy that sends him after something that isn't there.
function supportTail(hasCode: boolean): string {
  return hasCode
    ? ' Try again in a moment; if it keeps happening, send support the reference below.'
    : ' Try again in a moment; if it keeps happening, tell support what you were doing when it failed.';
}

function sentence(kind: ErrorKind, action: string, hasCode: boolean): string {
  switch (kind) {
    case 'offline':
      return `MAGE couldn't ${action} — this device isn't reaching the network. Check your signal or Wi-Fi, then try again.`;
    case 'session':
      return `MAGE couldn't ${action} — the server no longer recognizes this sign-in, even though the app still looks signed in. Sign out and back in from Settings, then try again.`;
    case 'permission':
      // "isn't allowed to CHANGE that record" asserts the operation was a
      // write. It is not: the first two adopters call this on READS too
      // (prequal-form's packet lookup, every `sourceFailed` surface that will
      // follow), and one of those readers is an anonymous sub on a magic link
      // who has no account at all. State only what a 403 actually proves —
      // that this sign-in does not have access — and leave the verb to
      // `action`, which the caller wrote (review 2026-09-07).
      return `MAGE couldn't ${action} — this sign-in doesn't have access to that record. Ask whoever owns the account to give you access.`;
    case 'rateLimit':
      return `MAGE couldn't ${action} — too many requests went out in a short window. Wait about a minute, then try again.`;
    case 'schema':
      return `MAGE couldn't ${action} — this build of the app is asking the server for something it doesn't have yet. Close the app fully, reopen it to pick up the latest update, then try again.`;
    case 'notFound':
      // NOT "pull down to refresh". This module formats ALERT bodies as much
      // as list states — its first three call sites are modal alerts on
      // takeoff-estimate, which has no pull-to-refresh anywhere on it — and
      // naming a control the reader cannot find is the same defect class as
      // the raw exception this file replaced (review 2026-09-07). "Reopen the
      // screen" is true on every surface that can show this string.
      return `MAGE couldn't ${action} — the record it needs isn't there any more. It may have been deleted on another device. Go back, reopen the screen, then try again.`;
    case 'conflict':
      return `MAGE couldn't ${action} — something with the same number or name is already saved. Change it, then try again.`;
    case 'timeout':
      return `MAGE couldn't ${action} — the server didn't answer in time. Try again in a moment.`;
    case 'cancelled':
      return `MAGE stopped trying to ${action}. Nothing was changed — start it again when you're ready.`;
    case 'server':
      return `MAGE couldn't ${action} — the server returned an error.` + supportTail(hasCode);
    case 'unknown':
      return `MAGE couldn't ${action}.` + supportTail(hasCode);
  }
}

/** The sentence that answers the question he actually has. */
function fateOfHisWork(keptLocally: boolean | undefined): string {
  if (keptLocally === true) return " Nothing you entered was lost — it's still on this device.";
  if (keptLocally === false) return ' What you entered was not saved.';
  return '';
}

/**
 * The one entry point. `showAlert(copy.title, copy.body)` at every call site
 * that used to pass `e.message`.
 *
 *   const copy = describeError(e, { action: 'save this estimate', keptLocally: true });
 *   showAlert(copy.title, copy.body);
 */
export function describeError(err: unknown, ctx: ErrorContext): ErrorCopy {
  const kind = classifyError(err);
  const code = errorCode(err);
  // A reference code is only useful where support would act on it, and only
  // honest where the server actually spoke. An offline device got no code, and
  // a cancel is not a fault, so neither carries one.
  const showCode = code !== null && kind !== 'offline' && kind !== 'cancelled';
  return {
    title: TITLES[kind],
    // `showCode` is computed BEFORE the sentence and handed to it: the body
    // may only promise "the reference below" when one is actually appended.
    body: sentence(kind, ctx.action, showCode) + fateOfHisWork(ctx.keptLocally) + (showCode ? ` (Reference: ${code})` : ''),
    kind,
    code,
  };
}

export default describeError;
