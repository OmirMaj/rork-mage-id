// supabase/functions/_shared/notifyGuards.ts
//
// Pure, dependency-free pieces of the `notify` edge function's caller
// authorization — audit 2026-09-03 EDGE-F4 (any signed-in account could push /
// email any MAGE user with attacker-authored content and fan out unlimited
// email in one call), EDGE-F5 (anonymous callers could relay email with no
// rate limit and attacker-chosen recipients) and EDGE-F15 (per-IP limiters
// keyed on the caller-supplied FIRST x-forwarded-for hop).
//
// No Deno globals and no imports ON PURPOSE: scripts/validate-notify-authz.ts
// imports this file under bun and exercises every branch. The edge function
// itself is I/O-bound and has no unit harness, so this file is where the rules
// are testable. Keep it that way — anything that needs fetch / env stays in
// notify/index.ts.

/** Who is calling notify, as PROVEN by the request (never by a claim in the body). */
export type Caller =
  | { kind: 'service' }            // service-role key, or a valid x-cron-secret (DB triggers, pg_cron)
  | { kind: 'user'; id: string }   // GoTrue-verified user JWT
  | { kind: 'anon' };              // anon key only — the static homeowner portal page

/** Bidder fan-out lists are cut here whoever supplies them (EDGE-F4). */
export const MAX_RECIPIENTS = 50;
/** Request bodies above this are refused before JSON.parse (EDGE-F4). */
export const MAX_BODY_BYTES = 64 * 1024;
/** Hourly bucket for a verified user (EDGE-F4). */
export const USER_HOURLY_CAP = 60;
/** Hourly bucket per portal, per resolved GC and per client IP on the anon path (EDGE-F5). */
export const ANON_HOURLY_CAP = 30;

/**
 * Events whose recipient lives in ANOTHER tenant. Only award-rfp and
 * notify-nearby-contractors (service role) raise them — never a user JWT.
 */
export const CROSS_TENANT_EVENTS: ReadonlySet<string> = new Set(['rfp_awarded', 'nearby_rfp_posted']);

/**
 * Events the anonymous portal page may raise (marketing/portal/index.html
 * posts with the anon key). Deliberately EXCLUDES bid_question_asked,
 * bid_question_answered and closeout_binder_sent: they carried caller-chosen
 * recipients (EDGE-F5), and every legitimate sender of them is signed in
 * (utils/bidQuestionsEngine.ts, app/closeout-binder.tsx → user JWT).
 */
export const ANON_ALLOWED_EVENTS: ReadonlySet<string> = new Set(['contract_signed', 'selection_chosen']);

/** Events scoped to a public_bids row (the RFP poster and its bidders), not to a project. */
export const RFP_EVENTS: ReadonlySet<string> = new Set(['bid_question_asked', 'bid_question_answered']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string — ids go into PostgREST filters, so anything else is dropped, not queried. */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Client IP for rate limiting (EDGE-F15). Precedence (review 2026-09-05):
 *   1. cf-connecting-ip — set by Cloudflare in front of the Supabase gateway,
 *      overwritten if a client sends its own;
 *   2. the LAST x-forwarded-for hop — the one the edge proxy APPENDED. The
 *      FIRST hop is whatever the client chose to send, which is why every
 *      limiter keyed on `split(',')[0]` was spoofable;
 *   3. x-real-ip — a fallback only. Nothing in front of the function is proven
 *      to overwrite it, so a client-supplied value must never outrank a
 *      proxy-appended hop;
 *   4. 'unknown' — still a bucket, never a crash.
 * Every function that keys a limiter on the caller's address goes through this
 * (notify, validate-portal-passcode, auth-magic-link, public-lead-intake,
 * widget-estimate); scripts/validate-edge-security.ts pins that no function
 * reads x-forwarded-for and takes element 0.
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const cf = (headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const hops = (headers.get('x-forwarded-for') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length > 0) return hops[hops.length - 1];
  const real = (headers.get('x-real-ip') || '').trim();
  return real || 'unknown';
}

/** Non-arrays become []; arrays are cut to `max` (EDGE-F4). */
export function capRecipients<T>(list: unknown, max: number = MAX_RECIPIENTS): T[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, Math.max(0, max)) as T[];
}

/** True when a request body must be refused (EDGE-F4). A non-finite size is refused too. */
export function exceedsBodyLimit(bytes: number, max: number = MAX_BODY_BYTES): boolean {
  return !Number.isFinite(bytes) || bytes > max;
}

/**
 * May a GoTrue-verified user raise a project-scoped event addressed to
 * `gcUserId`? (RFP Q&A events are authorized against the public_bids row
 * instead — see notify/index.ts.)
 *
 *  - A project was resolved (by portal id or project id): the caller must be
 *    a MEMBER of that project (owner or accepted collaborator), and the GC
 *    being addressed must be the caller or the project's owner. Membership is
 *    required even when gcUserId === caller, because the email carries the
 *    project's tokenized portal URL: "my id as the GC, your portal id" must
 *    not render your access token into a mail the caller controls.
 *  - No project resolved: the caller may only address themselves.
 */
export function userMayAddress(o: {
  callerId: string;
  gcUserId: string | null;
  projectOwnerId: string | null;
  isProjectMember: boolean;
}): boolean {
  if (!o.callerId || !o.gcUserId) return false;
  if (o.projectOwnerId) {
    if (!o.isProjectMember) return false;
    return o.gcUserId === o.callerId || o.gcUserId === o.projectOwnerId;
  }
  return o.gcUserId === o.callerId;
}

/**
 * The `sub_portal_id` a caller may name (review 2026-09-04, blocking 1).
 *
 * The id steers the sub_invoice_reviewed CTA — subPortalUrlFor() renders that
 * link's ?t= access token into the email — and can also resolve the GC. Only a
 * trusted server-to-server caller (the sub_submitted_invoices triggers via
 * fire_notify, or the service key) may supply it. A user JWT sending
 * gc_user_id = <self> + sub_portal_id = <victim's link id> resolved no project,
 * passed userMayAddress (gc === caller) and was mailed the victim's token.
 */
export function trustedSubPortalId(caller: Caller, raw: unknown): string | null {
  if (caller.kind !== 'service') return null;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}
