// notify
//
// Single dispatcher for every push + email notification in MAGE ID. Called
// from AFTER INSERT triggers via pg_net (and optionally directly from the
// app for re-sends). Handles fan-out to:
//   - Expo Push (for the GC, when we have a push_token in profiles)
//   - Resend (for everyone — always sent unless the user opts out)
//
// 2026-04 round-1 redesign — emails now go through the shared template
// at ../_shared/email.ts, so notify + send-email + every future edge
// function share ONE design language. Adds personalized FROM, reply-to,
// List-Unsubscribe headers, plaintext fallback, project context strip,
// stat cards, hero milestones, and deep-linked CTAs.
//
// Secrets required:
//   RESEND_API_KEY                — from resend.com
//   SERVICE_ROLE_KEY              — Supabase service role key (so we can
//                                    read profiles + write outbox)
//   EXPO_ACCESS_TOKEN             — optional, for higher Expo Push limits
//
// Request body: { event, source_table, source_id, payload }
//   event ∈
//     'portal_message'             — client → GC
//     'budget_proposal'            — client → GC
//     'co_approval'                — client → GC
//     'sub_invoice_submitted'      — sub → GC
//     'sub_invoice_reviewed'       — GC → sub
//     'nearby_rfp_posted'          — system → contractor (marketplace fan-out)
//     'rfp_awarded'                — homeowner → contractor (winner notice)
//     'contract_signed'            — homeowner counter-signs contract → GC
//     'selection_chosen'           — homeowner picks a selection option → GC
//     'bid_question_asked'         — contractor asks pre-bid question → RFP poster
//     'bid_question_answered'      — RFP poster answers → all bidders
//     'closeout_binder_sent'       — GC delivers binder → homeowner + GC summary
//
// DEPLOY ORDER (review 2026-09-04, advisory 4): marketing/portal/index.html must
// be live BEFORE this function is deployed. Anonymous callers (that page) now
// have to prove portal possession — payload.portal_id + payload.access_token,
// checked through the portal_project_for_token RPC — and the page only sends
// access_token from the same change. Deploying the function first refuses every
// homeowner selection_chosen / contract_signed with 403 portal_token_required
// until the page ships.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  wrapEmailHtml,
  emailStatCard,
  emailStatRow,
  emailQuote,
  emailHero,
  emailProductCard,
  emailDivider,
  resendSend,
  fmtMoney,
  escapeHtml,
  EMOJI,
  type ProjectContextOpts,
  type UnsubscribeOpts,
} from "../_shared/email.ts";
import { verifyUser, isServiceRoleToken } from "../_shared/verifyUser.ts";
// EDGE-F3: database triggers (fire_notify) authenticate with the pg_cron shared
// secret; a valid x-cron-secret is a privileged caller, like the service key.
import { isValidCron } from "../_shared/cronAuth.ts";
// EDGE-F6: every customer-facing portal URL is built by the shared helper so it
// carries the MINTED portal id and the ?t= access token the page requires.
import { portalUrlFor, subPortalUrlFor, APP_BASE } from "../_shared/portalLinks.ts";
// EDGE-F4/F5: the pure authorization pieces (unit-tested by scripts/validate-notify-authz.ts).
import {
  ANON_ALLOWED_EVENTS,
  ANON_HOURLY_CAP,
  CROSS_TENANT_EVENTS,
  MAX_RECIPIENTS,
  RFP_EVENTS,
  USER_HOURLY_CAP,
  capRecipients,
  clientIpFrom,
  exceedsBodyLimit,
  isUuid,
  trustedSubPortalId,
  userMayAddress,
  type Caller,
} from "../_shared/notifyGuards.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
// PORTAL_BASE / SUB_PORTAL_BASE / APP_BASE live in ../_shared/portalLinks.ts.
// A bare base-plus-portal-id link (no ?t= token) lands on the fallback page (EDGE-F6).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface NotifyRequest {
  event: string;
  source_table?: string;
  source_id?: string;
  payload: Record<string, unknown>;
}

interface ProfileRow {
  id: string;
  email: string | null;
  contact_name: string | null;
  company_name: string | null;
  phone: string | null;
  push_token: string | null;
  notification_preferences: Record<string, unknown> | null;
}

interface ProjectRow {
  id?: string;
  name?: string;
  location?: string;
  user_id?: string | null;
  /** Raw projects.client_portal jsonb — only ever read through portalUrlFor(). */
  client_portal?: unknown;
}

interface RfpRow {
  id: string;
  user_id: string | null;
  title: string | null;
}

interface BidderRecipient {
  email?: string | null;
  push_token?: string | null;
  user_id?: string | null;
}

interface SubPortalLinkRow {
  id: string;
  user_id: string | null;
  access_token: string | null;
  enabled: boolean | null;
}

interface BidQuestionRow {
  id: string;
  question: string | null;
  asker_name: string | null;
  created_at: string | null;
}

interface SubInvoiceRow {
  id: string;
  sub_portal_id: string | null;
  project_id: string | null;
  invoice_number: string | null;
  amount: number | string | null;
  status: string | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  notes_from_gc: string | null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function uuidOrNull(v: unknown): string | null {
  return isUuid(v) ? v : null;
}

// ─── Supabase REST helpers ────────────────────────────────────────────
async function sbGet(path: string): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`sbGet ${path} → ${r.status}: ${t}`);
  }
  return r.json();
}

async function sbInsert(table: string, body: unknown): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`sbInsert ${table} → ${r.status}: ${t}`);
  }
}

async function getProfile(userId: string): Promise<ProfileRow | null> {
  const rows = await sbGet(`profiles?id=eq.${userId}&select=id,email,contact_name,company_name,phone,push_token,notification_preferences`) as ProfileRow[];
  return rows[0] ?? null;
}

/**
 * Wrap resendSend with a suppression check. The direct-send branches
 * (sub_invoice_reviewed, bid_question_answered, closeout-homeowner)
 * use this instead of calling resendSend straight, so we honor the
 * unsubscribe table everywhere.
 */
async function sendIfNotSuppressed(opts: Parameters<typeof resendSend>[1] & { eventKey: string }): Promise<{ ok: boolean; resp: unknown; suppressed?: boolean }> {
  const suppressed = await isUnsubscribed(opts.to, opts.eventKey);
  if (suppressed) return { ok: false, resp: { suppressed: true }, suppressed: true };
  return resendSend(RESEND_API_KEY, opts);
}

/**
 * Honor the List-Unsubscribe table. Returns true if the recipient has
 * opted out of this event_key (or globally). Failures are non-fatal —
 * we'd rather send a duplicate than block legitimate notifications if
 * the suppression check itself errors.
 */
async function isUnsubscribed(email: string | null | undefined, eventKey: string): Promise<boolean> {
  if (!email) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_email_unsubscribed`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_email: email.toLowerCase(), p_event_key: eventKey }),
    });
    if (!r.ok) return false;
    const v = await r.json();
    return v === true;
  } catch {
    return false;
  }
}

type ProjectContext = ProjectRow & { name: string; viaPortal: boolean };
const PROJECT_SELECT = 'select=id,name,location,user_id,client_portal';

/**
 * Portal-first project lookup. One service-role read yields the GC (user_id),
 * the email context (name / location) AND client_portal — the only thing a
 * tokenized portal URL can be built from (EDGE-F6). Looking the project up BY
 * portal id also means a caller cannot pair one project's name with another
 * project's portal.
 */
async function getProjectContext(projectId: string | null, portalId: string | null): Promise<ProjectContext> {
  const empty: ProjectContext = { name: 'your project', viaPortal: false };
  try {
    if (portalId) {
      const rows = await sbGet(`projects?client_portal->>portalId=eq.${encodeURIComponent(portalId)}&${PROJECT_SELECT}&limit=1`) as ProjectRow[];
      const r = rows[0];
      if (r?.id) return { ...r, name: r.name ?? 'your project', viaPortal: true };
    }
    if (projectId) {
      const rows = await sbGet(`projects?id=eq.${projectId}&${PROJECT_SELECT}&limit=1`) as ProjectRow[];
      const r = rows[0];
      if (r?.id) return { ...r, name: r.name ?? 'your project', viaPortal: false };
    }
    return empty;
  } catch {
    return empty;
  }
}

/**
 * Review 2026-09-04 (advisory 4): the project a (portal id, access token) pair
 * proves possession of — via the SECURITY DEFINER RPC every portal write goes
 * through (EXECUTE for service_role only; migration 20260713150000). Null when
 * the token is wrong or the portal is disabled — and, once 20260904100800 is
 * applied, when the link has expired. Only the two-argument signature is used.
 */
async function projectForPortalToken(portalId: string, accessToken: string): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_project_for_token`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_portal_id: portalId, p_access_token: accessToken }),
    });
    if (!r.ok) return null;
    const v = await r.json();
    return isUuid(v) ? v : null;
  } catch {
    return null;
  }
}

async function getRfp(rfpId: string): Promise<RfpRow | null> {
  try {
    const rows = await sbGet(`public_bids?id=eq.${rfpId}&select=id,user_id,title&limit=1`) as RfpRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * EDGE-F4: the bidder fan-out for `bid_question_answered` is resolved HERE from
 * bid_responses — a user-JWT caller no longer ships the recipient list.
 */
async function resolveBidders(rfpId: string): Promise<BidderRecipient[]> {
  try {
    const rows = await sbGet(`bid_responses?bid_id=eq.${rfpId}&select=user_id`) as { user_id: string | null }[];
    const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(isUuid))).slice(0, MAX_RECIPIENTS);
    if (ids.length === 0) return [];
    const profiles = await sbGet(`profiles?id=in.(${ids.join(',')})&select=id,email,push_token`) as { id: string; email: string | null; push_token: string | null }[];
    return profiles.map((p) => ({ user_id: p.id, email: p.email, push_token: p.push_token }));
  } catch {
    return [];
  }
}

/**
 * Review 2026-09-04 (advisory 3 + residual): a user may raise
 * `bid_question_asked` on an RFP only if they actually asked on it — a
 * bid_questions row with bid_id = the RFP and asker_user_id = the caller
 * (written under the bq_ask RLS policy by utils/bidQuestionsEngine.ts before it
 * calls notify) — and the email carries THAT row's question / asker_name, never
 * the payload's text. The newest such row wins.
 */
async function newestBidQuestionBy(rfpId: string, userId: string): Promise<BidQuestionRow | null> {
  if (!isUuid(rfpId) || !isUuid(userId)) return null;
  try {
    const rows = await sbGet(`bid_questions?bid_id=eq.${rfpId}&asker_user_id=eq.${userId}&select=id,question,asker_name,created_at&order=created_at.desc&limit=1`) as BidQuestionRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function getSubPortalLink(subPortalId: string): Promise<SubPortalLinkRow | null> {
  try {
    const rows = await sbGet(`sub_portal_links?id=eq.${encodeURIComponent(subPortalId)}&select=id,user_id,access_token,enabled&limit=1`) as SubPortalLinkRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Review 2026-09-04 (residual): a user JWT may raise `sub_invoice_reviewed` only
 * for an invoice row whose sub-portal link it OWNS, and the recipient is that
 * row's stored submitter email — never a caller-chosen address. The trigger
 * (trg_notify_sub_invoice_reviewed, service path) ships the row id as
 * source_id; a client caller must do the same (or send payload.invoice_id).
 */
async function getOwnedSubInvoice(invoiceId: string, ownerId: string): Promise<{ invoice: SubInvoiceRow; link: SubPortalLinkRow } | null> {
  if (!isUuid(invoiceId) || !isUuid(ownerId)) return null;
  try {
    const rows = await sbGet(`sub_submitted_invoices?id=eq.${invoiceId}&select=id,sub_portal_id,project_id,invoice_number,amount,status,submitted_by_name,submitted_by_email,notes_from_gc&limit=1`) as SubInvoiceRow[];
    const invoice = rows[0];
    if (!invoice?.sub_portal_id) return null;
    const link = await getSubPortalLink(invoice.sub_portal_id);
    if (!link || link.user_id !== ownerId) return null;
    return { invoice, link };
  } catch {
    return null;
  }
}

/** Accepted collaborators count as project members for authorization (EDGE-F4). */
async function isAcceptedCollaborator(projectId: string | null, userId: string): Promise<boolean> {
  if (!projectId) return false;
  try {
    const rows = await sbGet(`project_collaborators?project_id=eq.${projectId}&user_id=eq.${userId}&or=(status.eq.accepted,accepted_at.not.is.null)&select=id&limit=1`) as unknown[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ─── Preference check ─────────────────────────────────────────────────
function prefAllows(prefs: Record<string, unknown> | null | undefined, key: string, channel: 'push' | 'email'): boolean {
  if (!prefs) return true;
  const evt = (prefs as Record<string, Record<string, unknown>>)[key];
  if (!evt) return true;
  const v = (evt as Record<string, unknown>)[channel];
  if (v === false) return false;
  return true;
}

// ─── Push sender (email goes through shared resendSend) ──────────────
async function sendPush(token: string, title: string, body: string, data?: Record<string, unknown>): Promise<{ ok: boolean; resp?: unknown }> {
  if (!token) return { ok: false };
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/json" };
    if (EXPO_ACCESS_TOKEN) headers["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
    const r = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: token, title, body, data: data ?? {},
        sound: "default", priority: "high",
        badge: 1,
        _displayInForeground: true,
      }),
    });
    const resp = await r.json().catch(() => ({}));
    return { ok: r.ok, resp };
  } catch (e) {
    return { ok: false, resp: { error: String(e) } };
  }
}

// ─── Rate limit ───────────────────────────────────────────────────────
// (The anon allowlist lives in ../_shared/notifyGuards.ts: ANON_ALLOWED_EVENTS.)
//
// Hourly buckets keyed by an arbitrary scope string, backed by the
// rate_limit_increment SQL function (see migration: rate_limit_counters),
// which does an atomic INSERT … ON CONFLICT DO UPDATE … RETURNING count.
// This closes the TOCTOU race in the previous SELECT-then-decide
// implementation: under N parallel callers, the i'th caller is GUARANTEED
// to see count=i. Scopes in use: `portal:<id>` (anon, since day one) and —
// since EDGE-F4/F5 — `notify:user:<id>` (verified users), `notify:gc:<id>`
// and `notify:ip:<ip>` (anon path, whichever id the caller supplied).
//
// Fail-open semantics: if the RPC errors (network, function missing,
// etc.), we let the request through. We'd rather risk a duplicate than
// drop a legit homeowner-signed-contract notification on a transient
// counter glitch.
async function exceedsRateLimit(scope: string, cap: number): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_increment`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_scope: scope }),
    });
    if (!r.ok) return false; // fail open
    const count = await r.json();
    return typeof count === 'number' && count > cap;
  } catch {
    return false; // fail open
  }
}

// ─── Event dispatch ───────────────────────────────────────────────────
interface DispatchResult {
  ok: boolean;
  reason?: string;
  event?: string;
  gc?: string | null;
  portal_id?: string | null;
  /** Set on authorization / abuse refusals; the handler maps it to the HTTP status. */
  httpStatus?: number;
}

async function dispatch(req: NotifyRequest, caller: Caller, clientIp: string): Promise<DispatchResult> {
  const { event, source_table, source_id, payload } = req;
  const isService = caller.kind === 'service';
  const isAnonCaller = caller.kind === 'anon';
  const isRfpEvent = RFP_EVENTS.has(event);
  const portalId = strOrNull(payload.portal_id ?? payload.portalId);
  // Review 2026-09-04 (blocking 1): only a trusted caller may name a sub-portal
  // link — its ?t= token is rendered into the sub_invoice_reviewed CTA, and a
  // user JWT addressing itself would otherwise be mailed a foreign link's token.
  const subPortalId = trustedSubPortalId(caller, payload.sub_portal_id);

  if (isAnonCaller && !ANON_ALLOWED_EVENTS.has(event)) {
    return { ok: false, reason: 'event_not_anon_allowed', event };
  }
  // EDGE-F4: the two events that address another tenant's user come only from
  // award-rfp / notify-nearby-contractors (service role) — never from a JWT.
  if (!isService && CROSS_TENANT_EVENTS.has(event)) {
    return { ok: false, reason: 'cross_tenant_event', event, httpStatus: 403 };
  }
  // EDGE-F4/F5: nobody but a trusted server-to-server caller steers recipients.
  // Anon callers never name the GC; user callers never name the RFP side; the
  // bidder list and push tokens are resolved here, not read from the body.
  if (isAnonCaller || (caller.kind === 'user' && isRfpEvent)) {
    delete payload.gc_user_id;
    delete payload.contractor_user_id;
  }
  if (!isService) {
    delete payload.bidder_recipients;
    delete payload.homeowner_push_token;
    if (isRfpEvent) delete payload.homeowner_email;
  }

  let gcUserId: string | null = uuidOrNull(payload.gc_user_id) ?? uuidOrNull(payload.contractor_user_id);
  // RFP Q&A is scoped to the public_bids row, never to a project: ignore any
  // project / portal ids a caller adds so no foreign project context leaks in.
  // An anonymous caller's project comes ONLY from the portal token below, never
  // from a bare project_id (review 2026-09-04, advisory 4).
  let projectId: string | null = (isRfpEvent || isAnonCaller) ? null : uuidOrNull(payload.project_id);
  const effectivePortalId = isRfpEvent ? null : portalId;

  // Review 2026-09-04 (advisory 4): the static portal page must PROVE it holds
  // the portal — portal_id + the ?t= access token — before it can raise anything.
  // portal_project_for_token (service-role RPC, the trust root of every portal
  // write) turns the pair into the project id. A bare project_id used to resolve
  // the GC on its own, so anyone holding a project uuid could burn the GC's
  // notify:gc bucket and suppress their real contract_signed notices. Buckets
  // are consumed AFTER the token check (the IP bucket first, so an invalid-token
  // spray still costs the sender), and a project_id the page also sends must
  // agree with the token.
  const accessToken = strOrNull(payload.access_token);
  delete payload.access_token; // never into notification_outbox.payload or a log line
  if (isAnonCaller) {
    if (!portalId || !accessToken) {
      return { ok: false, reason: 'portal_token_required', event, httpStatus: 403 };
    }
    if (await exceedsRateLimit(`notify:ip:${clientIp}`, ANON_HOURLY_CAP)) {
      return { ok: false, reason: 'rate_limited', event, httpStatus: 429 };
    }
    const tokenProjectId = await projectForPortalToken(portalId, accessToken);
    const claimedProjectId = uuidOrNull(payload.project_id);
    if (!tokenProjectId || (claimedProjectId && claimedProjectId !== tokenProjectId)) {
      return { ok: false, reason: 'portal_token_invalid', event, portal_id: portalId, httpStatus: 403 };
    }
    if (await exceedsRateLimit(`portal:${portalId}`, ANON_HOURLY_CAP)) {
      return { ok: false, reason: 'rate_limited', portal_id: portalId, httpStatus: 429 };
    }
    projectId = tokenProjectId;
  }

  // Server-resolved bidder fan-out for a user-JWT `bid_question_answered`.
  let resolvedBidders: BidderRecipient[] | null = null;
  if (!isService && isRfpEvent) {
    const rfpId = uuidOrNull(payload.rfp_id) ?? uuidOrNull(payload.bid_id);
    const rfp = rfpId ? await getRfp(rfpId) : null;
    if (!rfp) return { ok: false, reason: 'no_rfp', event };
    if (event === 'bid_question_answered') {
      // Only the RFP's poster answers, and the recipients are THAT RFP's bidders.
      if (caller.kind !== 'user' || rfp.user_id !== caller.id) {
        return { ok: false, reason: 'not_your_project', event, httpStatus: 403 };
      }
      resolvedBidders = await resolveBidders(rfp.id);
    }
    if (event === 'bid_question_asked') {
      // Only a bidder who asked on THIS RFP may notify its poster, and only with
      // the STORED text (advisory 3 + residual) — the payload's is ignored.
      const asked = caller.kind === 'user' ? await newestBidQuestionBy(rfp.id, caller.id) : null;
      if (!asked) return { ok: false, reason: 'no_bid_question', event, httpStatus: 403 };
      payload.question = asked.question ?? '';
      payload.asker_name = asked.asker_name ?? null;
      payload.bid_question_id = asked.id;
    }
    gcUserId = uuidOrNull(rfp.user_id); // the poster receives 'asked' / sends 'answered'
    if (rfp.title) payload.rfp_title = rfp.title;
  }

  // Review 2026-09-04 (residual): sub_invoice_reviewed from a user JWT used to
  // email whatever submitted_by_email the caller typed. The user path now needs
  // the invoice id (source_id — the slot the trigger uses — or payload.invoice_id),
  // the row's sub-portal link must belong to the caller, and every field the
  // email shows comes from the row. No client sends this event today: without
  // an id it is service-only (the trigger path is unchanged).
  let ownedSubLink: SubPortalLinkRow | null = null;
  if (caller.kind === 'user' && event === 'sub_invoice_reviewed') {
    const invoiceId = uuidOrNull(payload.invoice_id) ?? uuidOrNull(source_id);
    if (!invoiceId) return { ok: false, reason: 'invoice_id_required', event, httpStatus: 403 };
    const owned = await getOwnedSubInvoice(invoiceId, caller.id);
    if (!owned) return { ok: false, reason: 'not_your_invoice', event, httpStatus: 403 };
    payload.submitted_by_email = owned.invoice.submitted_by_email;
    payload.submitted_by_name = owned.invoice.submitted_by_name;
    payload.invoice_number = owned.invoice.invoice_number;
    payload.amount = owned.invoice.amount;
    payload.status = owned.invoice.status;
    payload.notes_from_gc = owned.invoice.notes_from_gc;
    ownedSubLink = owned.link;
    if (!gcUserId) gcUserId = owned.link.user_id; // the link's owner === caller
    projectId = uuidOrNull(owned.invoice.project_id) ?? projectId;
  }

  // Portal-first project lookup: one service-role read yields the GC, the
  // email context AND client_portal for the tokenized portal URL (EDGE-F6).
  // Anon: look the project up by the id the token PROVED, not by the portal id
  // (they agree by construction; the proof must not hinge on a second lookup).
  const projectCtx = await getProjectContext(projectId, isAnonCaller ? null : effectivePortalId);
  if (projectCtx.id) projectId = projectCtx.id;
  if (!gcUserId && effectivePortalId && projectCtx.viaPortal) gcUserId = projectCtx.user_id ?? null;

  let subPortalLink: string | null = null;
  if (subPortalId) {
    const link = await getSubPortalLink(subPortalId);
    subPortalLink = subPortalUrlFor(link);
    if (!gcUserId && link && isUuid(link.user_id)) gcUserId = link.user_id;
  } else if (ownedSubLink) {
    // User path: getOwnedSubInvoice proved this link belongs to the caller.
    subPortalLink = subPortalUrlFor(ownedSubLink);
  }
  if (!gcUserId && projectCtx.user_id) gcUserId = projectCtx.user_id;
  if (!gcUserId) return { ok: false, reason: 'no_gc_resolved', event };

  // EDGE-F4: a verified user may only address themselves or a project they belong to.
  if (caller.kind === 'user') {
    if (!isRfpEvent) {
      const ownerId = projectCtx.user_id ?? null;
      const isMember = !!ownerId && (ownerId === caller.id || await isAcceptedCollaborator(projectCtx.id ?? null, caller.id));
      if (!userMayAddress({ callerId: caller.id, gcUserId, projectOwnerId: ownerId, isProjectMember: isMember })) {
        return { ok: false, reason: 'not_your_project', event, httpStatus: 403 };
      }
    }
    if (await exceedsRateLimit(`notify:user:${caller.id}`, USER_HOURLY_CAP)) {
      return { ok: false, reason: 'rate_limited', event, httpStatus: 429 };
    }
  }
  // EDGE-F5: the anon path is also bucketed by the RESOLVED GC (the client-IP
  // and per-portal buckets were consumed above, after the token check).
  if (isAnonCaller && await exceedsRateLimit(`notify:gc:${gcUserId}`, ANON_HOURLY_CAP)) {
    return { ok: false, reason: 'rate_limited', event, httpStatus: 429 };
  }

  const gc = await getProfile(gcUserId);
  if (!gc) return { ok: false, reason: 'no_gc_profile' };

  const projectName = projectCtx.id
    ? projectCtx.name
    : (projectId || effectivePortalId) ? 'your project' : ((payload.project_name as string) || 'your project');

  // EDGE-F6: tokenized portal URL or nothing — never a token-less /portal/<id>.
  const portalUrl = portalUrlFor(projectCtx.client_portal);
  const portalLink = portalUrl ?? APP_BASE;

  // Reusable email "shell" args populated for every dispatch.
  const sharedEmail = {
    companyName: gc.company_name ?? undefined,
    sender: {
      name: gc.contact_name ?? gc.company_name ?? undefined,
      email: gc.email ?? undefined,
      phone: gc.phone ?? undefined,
    },
    project: projectId
      ? { name: projectCtx.name, location: projectCtx.location } as ProjectContextOpts
      : undefined,
  };

  // Helper to fire a (push optional + email) for a recipient. Caller
  // passes the fully-built email shell; we wrap with wrapEmailHtml,
  // call resendSend (which adds plaintext, headers, FROM), and log
  // outcome to notification_outbox.
  const dispatchOne = async (kind: 'gc' | 'client' | 'sub', spec: {
    /** Event-prefs key. */
    prefKey: string;
    /** Push title (also email subject if no override). */
    pushTitle: string;
    /** Push body. */
    pushBody: string;
    pushData?: Record<string, unknown>;
    pushToken?: string | null;
    /** Recipient email. */
    email?: string | null;
    /** Where replies go. Defaults to GC email when undefined. */
    replyTo?: string;
    /** Email subject — usually different (and tighter) than push title. */
    emailSubject: string;
    /** wrapEmailHtml inputs. We add the shell defaults around it. */
    emailWrap: {
      preheader: string;
      eyebrow?: string;
      title: string;
      subtitle?: string;
      bodyHtml: string;
      cta?: { label: string; href: string };
      secondaryCta?: { label: string; href: string };
      accent?: string;
    };
  }) => {
    let pushStatus: string | null = null;
    let pushResp: unknown = null;
    let emailStatus: string | null = null;
    let emailResp: unknown = null;

    const allowPush = kind === 'gc' && prefAllows(gc.notification_preferences, spec.prefKey, 'push');
    const allowEmail = prefAllows(gc.notification_preferences, spec.prefKey, 'email');

    if (allowPush && spec.pushToken) {
      const r = await sendPush(spec.pushToken, spec.pushTitle, spec.pushBody, spec.pushData);
      pushStatus = r.ok ? 'sent' : 'failed';
      pushResp = r.resp;
    }
    if (allowEmail && spec.email) {
      // Honor the global unsubscribe table before sending. If they hit
      // List-Unsubscribe (or unsubscribed via the prefs page), skip and
      // log to outbox so we have an audit trail.
      const suppressed = await isUnsubscribed(spec.email, spec.prefKey);
      if (suppressed) {
        emailStatus = 'suppressed_unsubscribed';
      } else {
        const unsubscribe: UnsubscribeOpts = {
          recipientEmail: spec.email,
          eventKey: spec.prefKey,
          enabled: true,
        };
        const html = wrapEmailHtml({
          ...spec.emailWrap,
          ...sharedEmail,
          unsubscribe,
        });
        const replyTo = spec.replyTo ?? (kind === 'gc' ? undefined : (gc.email ?? undefined));
        const r = await resendSend(RESEND_API_KEY, {
          to: spec.email,
          subject: spec.emailSubject,
          html,
          fromCompanyName: gc.company_name ?? undefined,
          replyTo,
          unsubscribe,
        });
        emailStatus = r.ok ? 'sent' : 'failed';
        emailResp = r.resp;
      }
    }

    await sbInsert('notification_outbox', {
      event_type: event,
      source_table: source_table ?? null,
      source_id: source_id ?? null,
      recipient_kind: kind,
      recipient_user_id: kind === 'gc' ? gcUserId : null,
      recipient_email: spec.email ?? null,
      push_token: spec.pushToken ?? null,
      push_status: pushStatus,
      push_response: pushResp,
      email_status: emailStatus,
      email_response: emailResp,
      payload,
      delivered_at: (pushStatus === 'sent' || emailStatus === 'sent') ? new Date().toISOString() : null,
    }).catch((e) => console.log('[notify] outbox insert failed', e));
  };

  // Project deep-link helper (when we have a projectId).
  const projectDeepLink = (route: string): string =>
    projectId ? `${APP_BASE}/${route}?projectId=${encodeURIComponent(projectId)}` : APP_BASE;

  // ─── Per-event branches ───
  switch (event) {
    case 'portal_message': {
      const body = (payload.body as string) ?? '';
      const author = (payload.author_name as string) || 'your client';
      const trimmed = body.length > 220 ? body.slice(0, 220) + '…' : body;
      await dispatchOne('gc', {
        prefKey: 'portal_message',
        pushTitle: `New message · ${projectName}`,
        pushBody: `${author}: ${body.slice(0, 140)}`,
        pushData: { projectId, portalId, kind: 'portal_message' },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${author} sent a message · ${projectName}`,
        emailWrap: {
          preheader: `${author}: ${body.slice(0, 100)}`,
          eyebrow: 'New portal message',
          title: `${author} sent you a message`,
          subtitle: `Reply through MAGE ID — your client sees it instantly in their portal.`,
          bodyHtml: emailQuote(trimmed),
          cta: { label: 'Reply in MAGE ID', href: projectDeepLink('client-messages') },
          secondaryCta: portalUrl ? { label: 'View their portal', href: portalUrl } : undefined,
        },
      });
      break;
    }

    case 'budget_proposal': {
      const amount = payload.amount as number | string;
      const proposer = (payload.proposer_name as string) || 'your client';
      const note = (payload.note as string) || '';
      await dispatchOne('gc', {
        prefKey: 'budget_proposal',
        pushTitle: `Budget proposed · ${projectName}`,
        pushBody: `${proposer}: ${fmtMoney(amount)}`,
        pushData: { projectId, portalId, kind: 'budget_proposal' },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `Budget proposed: ${fmtMoney(amount)} · ${projectName}`,
        emailWrap: {
          preheader: `${proposer} suggested ${fmtMoney(amount)} for ${projectName}.`,
          eyebrow: 'Budget proposal',
          title: `${proposer} suggested ${fmtMoney(amount)}`,
          subtitle: 'Accept it as the project target, counter back, or just message — you decide.',
          bodyHtml: `${emailStatCard(emailStatRow('Proposed budget', fmtMoney(amount), { emphasize: true }))}${note ? emailQuote(note) : ''}`,
          cta: { label: 'Open the project', href: projectDeepLink('project-detail') },
        },
      });
      break;
    }

    case 'co_approval': {
      const decision = (payload.decision as string) ?? 'approved';
      const signerName = (payload.signer_name as string) || 'your client';
      const coId = (payload.change_order_id as string) || '';
      const coNumber = (payload.co_number as string) || coId.slice(0, 8);
      const coAmount = payload.co_amount as number | string | undefined;
      const isApproved = decision === 'approved';
      const symbol = isApproved ? EMOJI.approved : EMOJI.declined;
      await dispatchOne('gc', {
        prefKey: 'co_approval',
        pushTitle: `${isApproved ? 'CO approved' : 'CO declined'} · ${projectName}`,
        pushBody: `${signerName} ${isApproved ? 'approved' : 'declined'} CO #${coNumber}${coAmount ? ` (${fmtMoney(coAmount)})` : ''}`,
        pushData: { projectId, portalId, kind: 'co_approval', changeOrderId: coId },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${symbol} CO #${coNumber} ${isApproved ? 'approved' : 'declined'}${coAmount ? ` · ${fmtMoney(coAmount)}` : ''}`,
        emailWrap: {
          preheader: `${signerName} ${isApproved ? 'approved' : 'declined'} change order #${coNumber}.`,
          eyebrow: isApproved ? 'Change order approved' : 'Change order declined',
          title: isApproved
            ? `${signerName} approved CO #${coNumber}`
            : `${signerName} declined CO #${coNumber}`,
          subtitle: isApproved
            ? 'Approval is logged and time-stamped — proceed with the work.'
            : 'Reach out to clarify, then revise and re-issue if appropriate.',
          bodyHtml: coAmount
            ? emailStatCard(`${emailStatRow('Change order', `#${escapeHtml(coNumber)}`)}${emailStatRow('Amount', fmtMoney(coAmount), { emphasize: true, valueColor: isApproved ? '#1E8E4A' : '#C2410C' })}${emailStatRow('Decision', isApproved ? 'Approved' : 'Declined')}`)
            : emailStatCard(`${emailStatRow('Change order', `#${escapeHtml(coNumber)}`)}${emailStatRow('Decision', isApproved ? 'Approved' : 'Declined', { emphasize: true })}`),
          cta: { label: 'View change order', href: projectDeepLink('change-order') },
        },
      });
      break;
    }

    case 'sub_invoice_submitted': {
      const num = (payload.invoice_number as string) || '';
      const amount = payload.amount as number | string;
      const submitter = (payload.submitted_by_name as string) || 'sub';
      const lineCount = payload.line_count as number | undefined;
      await dispatchOne('gc', {
        prefKey: 'sub_invoice',
        pushTitle: `Sub invoice · ${fmtMoney(amount)}`,
        pushBody: `${submitter} submitted invoice #${num}`,
        pushData: { projectId, kind: 'sub_invoice', subPortalId },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `New invoice: ${fmtMoney(amount)} from ${submitter}`,
        emailWrap: {
          preheader: `${submitter} submitted invoice #${num} for ${fmtMoney(amount)}.`,
          eyebrow: 'Sub invoice submitted',
          title: `${submitter} sent invoice #${num}`,
          subtitle: 'Review the lines, approve, and mark paid when the wire clears.',
          bodyHtml: emailStatCard(`${emailStatRow('Invoice', `#${escapeHtml(num)}`)}${emailStatRow('From', escapeHtml(submitter))}${lineCount ? emailStatRow('Line items', String(lineCount)) : ''}${emailStatRow('Total due', fmtMoney(amount), { emphasize: true })}`),
          cta: { label: 'Review invoice', href: projectDeepLink('sub-portals') },
        },
      });
      break;
    }

    case 'sub_invoice_reviewed': {
      // Sub-bound notification when the GC takes action on their invoice.
      const num = (payload.invoice_number as string) || '';
      const amount = payload.amount as number | string;
      const newStatus = (payload.status as string) || 'updated';
      const submitter = (payload.submitted_by_name as string) || 'there';
      const submitterEmail = (payload.submitted_by_email as string) || null;
      const notesFromGc = (payload.notes_from_gc as string) || '';
      const company = gc.company_name || gc.contact_name || 'Your contractor';
      if (!submitterEmail) {
        await sbInsert('notification_outbox', {
          event_type: event,
          source_table: source_table ?? null,
          source_id: source_id ?? null,
          recipient_kind: 'sub',
          email_status: 'skipped_no_email',
          payload,
        }).catch(() => {});
        break;
      }
      const statusMap: Record<string, { eyebrow: string; title: string; subtitle: string; symbol: string; accent?: string }> = {
        paid: { eyebrow: 'Invoice paid', title: `${company} paid invoice #${num}`, subtitle: 'Payment is on its way — check your bank for the deposit. We sent this on their behalf.', symbol: EMOJI.paid, accent: '#1E8E4A' },
        approved: { eyebrow: 'Invoice approved', title: `${company} approved invoice #${num}`, subtitle: "You'll get another note once payment is on its way.", symbol: EMOJI.approved },
        rejected: { eyebrow: 'Invoice update', title: `${company} sent back invoice #${num}`, subtitle: 'Reach out for clarification or revise and resubmit through your portal.', symbol: EMOJI.declined, accent: '#C2410C' },
      };
      const meta = statusMap[newStatus] ?? { eyebrow: 'Invoice update', title: `${company} updated invoice #${num}`, subtitle: '', symbol: '' };
      const subject = newStatus === 'paid'
        ? `${meta.symbol} Paid: ${fmtMoney(amount)} · invoice #${num}`
        : `Invoice #${num} ${newStatus} · ${fmtMoney(amount)}`;

      const html = wrapEmailHtml({
        preheader: `${company} ${newStatus === 'paid' ? 'just paid' : newStatus} invoice #${num} for ${fmtMoney(amount)}.`,
        eyebrow: meta.eyebrow,
        title: `Hi ${submitter},`,
        subtitle: meta.title,
        bodyHtml: `
          ${emailStatCard(`${emailStatRow('Invoice', `#${escapeHtml(num)}`)}${emailStatRow('Project', escapeHtml(projectName))}${emailStatRow(newStatus === 'paid' ? 'Paid' : 'Amount', fmtMoney(amount), { emphasize: true, valueColor: meta.accent ?? undefined })}`)}
          ${notesFromGc ? emailQuote(notesFromGc) : ''}
          <p style="margin:0;">${escapeHtml(meta.subtitle)}</p>
        `,
        cta: subPortalLink ? { label: 'View in your sub portal', href: subPortalLink } : { label: 'Open MAGE ID', href: APP_BASE },
        accent: meta.accent,
        companyName: gc.company_name ?? undefined,
        sender: {
          name: gc.contact_name ?? gc.company_name ?? undefined,
          email: gc.email ?? undefined,
          phone: gc.phone ?? undefined,
        },
        unsubscribe: { recipientEmail: submitterEmail, eventKey: 'sub_invoice', enabled: true },
      });
      const r = await sendIfNotSuppressed({
        to: submitterEmail,
        subject,
        html,
        fromCompanyName: gc.company_name ?? undefined,
        replyTo: gc.email ?? undefined,
        unsubscribe: { recipientEmail: submitterEmail, eventKey: 'sub_invoice', enabled: true },
        eventKey: 'sub_invoice',
      });
      await sbInsert('notification_outbox', {
        event_type: event,
        source_table: source_table ?? null,
        source_id: source_id ?? null,
        recipient_kind: 'sub',
        recipient_email: submitterEmail,
        email_status: r.suppressed ? 'suppressed_unsubscribed' : (r.ok ? 'sent' : 'failed'),
        email_response: r.resp,
        payload,
        delivered_at: r.ok ? new Date().toISOString() : null,
      }).catch(() => {});
      break;
    }

    case 'nearby_rfp_posted': {
      const rfpId = (payload.rfp_id as string) ?? '';
      const title = (payload.title as string) || 'A new project';
      const city = (payload.city as string) || '';
      const state = (payload.state as string) || '';
      const scope = (payload.scope_excerpt as string) || '';
      const budgetMin = payload.budget_min as number | null;
      const budgetMax = payload.budget_max as number | null;
      const cityState = [city, state].filter(Boolean).join(', ');
      const budgetLine = (budgetMin || budgetMax)
        ? `${budgetMin ? fmtMoney(budgetMin) : '—'} – ${budgetMax ? fmtMoney(budgetMax) : '—'}`
        : 'Budget TBD';
      const detailUrl = `${APP_BASE}/rfp-detail?bidId=${encodeURIComponent(rfpId)}`;
      await dispatchOne('gc', {
        prefKey: 'nearby_rfp_posted',
        pushTitle: `New project nearby · ${cityState || 'your area'}`,
        pushBody: `${title}${scope ? ' — ' + scope.slice(0, 100) : ''}`,
        pushData: { rfpId, kind: 'nearby_rfp_posted' },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `New ${cityState ? cityState + ' ' : ''}project: ${title}`,
        emailWrap: {
          preheader: `${cityState ? cityState + ' · ' : ''}${budgetLine}. ${scope.slice(0, 80)}`,
          eyebrow: 'New project nearby',
          title,
          subtitle: 'Open it to see drawings, photos, and the full scope. Bid before the deadline closes.',
          bodyHtml: `${emailStatCard(`${emailStatRow('Location', cityState || 'Pending')}${emailStatRow('Budget', budgetLine, { emphasize: true })}`)}${scope ? emailQuote(scope) : ''}`,
          cta: { label: 'View project', href: detailUrl },
        },
      });
      break;
    }

    case 'rfp_awarded': {
      const projectName = (payload.project_name as string) || 'a project';
      const newProjectId = (payload.project_id as string) || '';
      const heroPhoto = (payload.hero_photo_url as string) || undefined;
      const contractValue = payload.contract_value as number | string | undefined;
      const newProjectLink = newProjectId ? `${APP_BASE}/project-detail?projectId=${encodeURIComponent(newProjectId)}` : APP_BASE;
      await dispatchOne('gc', {
        prefKey: 'rfp_awarded',
        pushTitle: `🎉 You won the bid · ${projectName}`,
        pushBody: `The homeowner picked you. Project is set up — open to start the kickoff message.`,
        pushData: { projectId: newProjectId, kind: 'rfp_awarded' },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${EMOJI.celebrate} You won the bid · ${projectName}`,
        emailWrap: {
          preheader: `Congrats — the homeowner picked you for ${projectName}.`,
          accent: '#1E8E4A',
          eyebrow: 'Bid awarded',
          title: 'You won.',
          subtitle: `The homeowner just awarded ${projectName} to you. We've set up the project in MAGE ID with their drawings, photos, scope, and a live portal between the two of you.`,
          bodyHtml: `
            ${emailHero({ kicker: 'Project awarded', bigText: projectName, subText: contractValue ? `${fmtMoney(contractValue)} contract value` : undefined, photoUrl: heroPhoto, accent: '#1E8E4A' })}
            <p style="margin:0 0 12px;"><strong>What's next:</strong> open the project, review what the homeowner posted, and send a kickoff message through the portal so they know you're on it.</p>
            <p style="margin:0;color:#9AA3AD;font-size:13px;">Other bidders were politely declined automatically — you don't need to do anything on that side.</p>
          `,
          cta: { label: 'Open the project', href: newProjectLink },
        },
      });
      break;
    }

    case 'contract_signed': {
      const signerName = (payload.signer_name as string) || 'your client';
      const contractValue = payload.contract_value as number | string | null;
      const contractTitle = (payload.contract_title as string) || 'the construction agreement';
      await dispatchOne('gc', {
        prefKey: 'contract_signed',
        pushTitle: `${EMOJI.signed} Contract signed · ${projectName}`,
        pushBody: `${signerName} signed ${contractTitle}${contractValue ? ` (${fmtMoney(contractValue)})` : ''}`,
        pushData: { projectId, portalId, kind: 'contract_signed' },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${EMOJI.signed} Contract signed · ${projectName}${contractValue ? ` · ${fmtMoney(contractValue)}` : ''}`,
        emailWrap: {
          preheader: `${signerName} just signed ${contractTitle}${contractValue ? ` for ${fmtMoney(contractValue)}` : ''}.`,
          eyebrow: 'Contract signed',
          title: 'Signed and binding.',
          subtitle: `${signerName} just counter-signed ${contractTitle}. The agreement is now in effect — start the work with confidence.`,
          accent: '#1E8E4A',
          bodyHtml: `
            ${contractValue ? emailHero({ kicker: 'Contract value', bigText: fmtMoney(contractValue), subText: `Signed by ${signerName}`, accent: '#1E8E4A' }) : ''}
            ${emailStatCard(`${emailStatRow('Project', escapeHtml(projectName))}${emailStatRow('Signed by', escapeHtml(signerName))}${contractValue ? emailStatRow('Contract value', fmtMoney(contractValue), { emphasize: true, valueColor: '#1E8E4A' }) : ''}${emailStatRow('Signed at', new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}`)}
            <p style="margin:0;">The signed PDF is in MAGE ID under this project's Contract section — pull it for your records. A copy lives in the homeowner's portal too, so they can reference it any time.</p>
          `,
          cta: { label: 'View signed contract', href: projectDeepLink('contract') },
          secondaryCta: portalUrl ? { label: 'Open client portal', href: portalUrl } : undefined,
        },
      });
      break;
    }

    case 'selection_chosen': {
      const category = (payload.category as string) || 'a selection';
      const productName = (payload.product_name as string) || 'an option';
      const brand = (payload.brand as string) || '';
      const totalCost = payload.total_cost as number | string | null;
      const overBudget = !!payload.over_budget;
      const productImage = (payload.product_image_url as string) || undefined;
      await dispatchOne('gc', {
        prefKey: 'selection_chosen',
        pushTitle: overBudget ? `Selection (over allowance) · ${projectName}` : `Selection chosen · ${projectName}`,
        pushBody: `${category}: ${productName}${brand ? ' · ' + brand : ''}${totalCost ? ` — ${fmtMoney(totalCost)}` : ''}`,
        pushData: { projectId, portalId, kind: 'selection_chosen' },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `Selection: ${productName} for ${category}${overBudget ? ' (over allowance)' : ''}`,
        emailWrap: {
          preheader: `Your client picked ${productName}${brand ? ' by ' + brand : ''} for ${category}.`,
          eyebrow: overBudget ? 'Selection chosen · over allowance' : 'Selection chosen',
          title: `Picked: ${productName}`,
          subtitle: 'Place the order, lock the spec, and the choice will sync into MAGE ID under Selections.',
          bodyHtml: `
            ${emailProductCard({ imageUrl: productImage, productName, brand, category, price: totalCost ? fmtMoney(totalCost) : undefined, overBudget })}
          `,
          cta: { label: 'View in MAGE ID', href: projectDeepLink('selections') },
          secondaryCta: portalUrl ? { label: 'Open client portal', href: portalUrl } : undefined,
        },
      });
      break;
    }

    case 'bid_question_asked': {
      const askerName = (payload.asker_name as string) || 'A bidder';
      const question = (payload.question as string) || '';
      const rfpId = (payload.rfp_id as string) || (payload.bid_id as string) || '';
      const rfpTitle = (payload.rfp_title as string) || projectName || 'your RFP';
      const homeownerEmail = (payload.homeowner_email as string) || gc.email;
      const homeownerToken = (payload.homeowner_push_token as string) || gc.push_token;
      const detailUrl = rfpId ? `${APP_BASE}/rfp-detail?bidId=${encodeURIComponent(rfpId)}` : APP_BASE;
      await dispatchOne('gc', {
        prefKey: 'bid_question_asked',
        pushTitle: `New bid question · ${rfpTitle}`,
        pushBody: `${askerName}: ${question.slice(0, 140)}`,
        pushData: { rfpId, kind: 'bid_question_asked' },
        pushToken: homeownerToken,
        email: homeownerEmail,
        emailSubject: `${askerName} asked about ${rfpTitle}`,
        emailWrap: {
          preheader: `${askerName}: ${question.slice(0, 100)}`,
          eyebrow: 'New question on your RFP',
          title: `${askerName} asked:`,
          subtitle: 'Answer once — every bidder sees the same response so your scope stays clean.',
          bodyHtml: `${emailQuote(question)}<p style="margin:0;"><strong>RFP:</strong> ${escapeHtml(rfpTitle)}</p>`,
          cta: { label: 'Answer in MAGE ID', href: detailUrl },
        },
      });
      break;
    }

    case 'bid_question_answered': {
      const rfpId = (payload.rfp_id as string) || (payload.bid_id as string) || '';
      const rfpTitle = (payload.rfp_title as string) || projectName || 'an RFP you bid on';
      const question = (payload.question as string) || '';
      const answer = (payload.answer as string) || '';
      const detailUrl = rfpId ? `${APP_BASE}/rfp-detail?bidId=${encodeURIComponent(rfpId)}` : APP_BASE;
      // EDGE-F4: a user-JWT caller's bidders were resolved server-side from
      // bid_responses (resolvedBidders); only a service-role caller may ship a
      // list, and it is capped at MAX_RECIPIENTS either way.
      const recipients = resolvedBidders ?? capRecipients<BidderRecipient>(payload.bidder_recipients);
      for (const r of recipients) {
        const pushTok = r.push_token ?? null;
        const em = r.email ?? null;
        if (!em && !pushTok) continue;
        if (pushTok) {
          await sendPush(pushTok, `Answer posted · ${rfpTitle}`, `${question.slice(0, 80)}…`, { rfpId, kind: 'bid_question_answered' });
        }
        if (em) {
          const html = wrapEmailHtml({
            preheader: `Q: ${question.slice(0, 60)} · A: ${answer.slice(0, 60)}`,
            eyebrow: 'Pre-bid Q&A',
            title: 'A question was answered',
            subtitle: `If this changes your scope or pricing, update your bid before the deadline.`,
            bodyHtml: `
              <p style="margin:0 0 6px;"><strong>Q:</strong> ${escapeHtml(question)}</p>
              ${emailQuote(answer)}
              <p style="margin:0;"><strong>RFP:</strong> ${escapeHtml(rfpTitle)}</p>
            `,
            cta: { label: 'View RFP', href: detailUrl },
            companyName: gc.company_name ?? undefined,
            unsubscribe: { recipientEmail: em, eventKey: 'bid_question_answered', enabled: true },
          });
          await sendIfNotSuppressed({
            to: em,
            subject: `Answer posted on ${rfpTitle}`,
            html,
            fromCompanyName: gc.company_name ?? undefined,
            unsubscribe: { recipientEmail: em, eventKey: 'bid_question_answered', enabled: true },
            eventKey: 'bid_question_answered',
          });
        }
        await sbInsert('notification_outbox', {
          event_type: event,
          source_table: source_table ?? null,
          source_id: source_id ?? null,
          recipient_kind: 'sub',
          recipient_user_id: r.user_id ?? null,
          recipient_email: em,
          push_token: pushTok,
          push_status: pushTok ? 'sent' : null,
          email_status: em ? 'sent' : null,
          payload,
        }).catch(() => {});
      }
      break;
    }

    case 'closeout_binder_sent': {
      const binderId = (payload.binder_id as string) || '';
      const homeownerEmail = (payload.homeowner_email as string) || null;
      const homeownerName = (payload.homeowner_name as string) || 'there';
      const finalCost = payload.final_cost as number | string | undefined;
      const photoCount = payload.photo_count as number | undefined;
      const warrantyCount = payload.warranty_count as number | undefined;
      const heroPhoto = (payload.hero_photo_url as string) || undefined;
      const portalLink2 = portalLink; // tokenized via portalUrlFor, or APP_BASE (EDGE-F6)
      const company = gc.company_name || gc.contact_name || 'Your contractor';

      // Homeowner-bound — the warm hand-off email.
      if (homeownerEmail) {
        const html = wrapEmailHtml({
          preheader: `${company} sent you the closeout binder for ${projectName} — it's all in your portal.`,
          eyebrow: 'Closeout binder delivered',
          title: `Hi ${homeownerName} — your home's owner's manual.`,
          subtitle: `${company} just delivered the closeout binder for ${projectName}. Every paint color, fixture brand, sub contact, warranty, and maintenance reminder you'll need for the life of the home — all in your portal.`,
          accent: '#1E8E4A',
          bodyHtml: `
            ${emailHero({ kicker: 'Project complete', bigText: projectName, subText: finalCost ? `Final cost: ${fmtMoney(finalCost)}` : undefined, photoUrl: heroPhoto, accent: '#1E8E4A' })}
            ${emailStatCard(`${photoCount ? emailStatRow('Project photos', String(photoCount)) : ''}${warrantyCount ? emailStatRow('Warranties on file', String(warrantyCount)) : ''}${finalCost ? emailStatRow('Final cost', fmtMoney(finalCost), { emphasize: true }) : ''}`)}
            <p style="margin:0 0 14px;">Open your portal and tap <strong>Closeout Binder</strong>. Read it on your phone, or hit Print to save a PDF you can keep forever.</p>
            <p style="margin:0;color:#9AA3AD;font-size:13px;">Bookmark this email — your portal lives at the link below and doesn't expire.</p>
          `,
          cta: { label: 'Open my portal', href: portalLink2 },
          companyName: gc.company_name ?? undefined,
          sender: {
            name: gc.contact_name ?? gc.company_name ?? undefined,
            email: gc.email ?? undefined,
            phone: gc.phone ?? undefined,
          },
          project: { name: projectName, location: projectCtx.location },
          unsubscribe: { recipientEmail: homeownerEmail, eventKey: 'closeout_binder', enabled: true },
        });
        const r = await sendIfNotSuppressed({
          to: homeownerEmail,
          subject: `${EMOJI.binder} Your closeout binder is ready · ${projectName}`,
          html,
          fromCompanyName: gc.company_name ?? undefined,
          replyTo: gc.email ?? undefined,
          unsubscribe: { recipientEmail: homeownerEmail, eventKey: 'closeout_binder', enabled: true },
          eventKey: 'closeout_binder',
        });
        await sbInsert('notification_outbox', {
          event_type: event,
          source_table: source_table ?? null,
          source_id: source_id ?? null,
          recipient_kind: 'client',
          recipient_email: homeownerEmail,
          email_status: r.suppressed ? 'suppressed_unsubscribed' : (r.ok ? 'sent' : 'failed'),
          email_response: r.resp,
          payload,
          delivered_at: r.ok ? new Date().toISOString() : null,
        }).catch(() => {});
      } else {
        await sbInsert('notification_outbox', {
          event_type: event,
          source_table: source_table ?? null,
          source_id: source_id ?? null,
          recipient_kind: 'client',
          email_status: 'skipped_no_email',
          payload,
        }).catch(() => {});
      }

      // GC-bound — the "delivery confirmed" email. Round-1 #3: previously
      // a no-op. Now the GC gets a celebratory recap of what they shipped.
      if (gc.email) {
        await dispatchOne('gc', {
          prefKey: 'closeout_binder',
          pushTitle: `📦 Closeout delivered · ${projectName}`,
          pushBody: `Binder sent${homeownerName ? ' to ' + homeownerName : ''}. Project complete.`,
          pushData: { projectId, kind: 'closeout_binder_sent_confirmation', binderId },
          pushToken: gc.push_token,
          email: gc.email,
          emailSubject: `${EMOJI.binder} Closeout delivered · ${projectName}`,
          emailWrap: {
            preheader: `Closeout binder for ${projectName} sent${homeownerName !== 'there' ? ` to ${homeownerName}` : ''}. Nice work.`,
            accent: '#1E8E4A',
            eyebrow: 'Project closed out',
            title: 'Binder delivered. Project complete.',
            subtitle: `${homeownerName !== 'there' ? `${homeownerName} now has` : 'The homeowner now has'} the full closeout package — every spec, warranty, and maintenance reminder for ${projectName}. Nice work.`,
            bodyHtml: `
              ${emailStatCard(`${emailStatRow('Project', escapeHtml(projectName))}${photoCount ? emailStatRow('Photos delivered', String(photoCount)) : ''}${warrantyCount ? emailStatRow('Warranties packaged', String(warrantyCount)) : ''}${finalCost ? emailStatRow('Final cost', fmtMoney(finalCost), { emphasize: true }) : ''}`)}
              <p style="margin:0;">Their warranty walk reminder is set for 11 months from substantial completion — we'll surface it on your home tab when it's time.</p>
            `,
            cta: { label: 'View binder', href: projectDeepLink('closeout-binder') },
            secondaryCta: portalUrl ? { label: 'See homeowner portal', href: portalLink2 } : undefined,
          },
        });
      }

      // GC audit log row.
      await sbInsert('notification_outbox', {
        event_type: event,
        source_table: source_table ?? null,
        source_id: binderId || (source_id ?? null),
        recipient_kind: 'gc',
        recipient_user_id: gcUserId,
        payload,
      }).catch(() => {});
      break;
    }

    default:
      return { ok: false, reason: 'unknown_event', event };
  }

  return { ok: true, event, gc: gcUserId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    // EDGE-F4: bound the body BEFORE parsing it — a 10,000-address fan-out
    // request is refused at the door, not after Resend has seen it.
    const raw = await req.text();
    if (exceedsBodyLimit(new TextEncoder().encode(raw).byteLength)) {
      return jsonResponse({ success: false, error: 'payload_too_large' }, 413);
    }
    let body: NotifyRequest;
    try {
      body = JSON.parse(raw) as NotifyRequest;
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    if (!body || typeof body.event !== 'string' || !body.event) return jsonResponse({ error: "Missing event" }, 400);
    if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) body.payload = {};

    // Privilege determination — FAIL-CLOSED. This function deploys
    // verify_jwt:false, so the gateway doesn't verify tokens; we must not infer
    // privilege from an unverified `role` claim (a forged role:'authenticated'
    // token previously skipped the allowlist + rate limit and could blast any
    // event to anyone). A caller is classified ONLY by what it proves:
    //   service — holds the service-role key (notify-nearby-contractors,
    //             award-rfp) OR the pg_cron shared secret (EDGE-F3: the
    //             fire_notify / public_bids_notify_nearby_fn triggers);
    //   user    — presents a GoTrue-verified authenticated JWT; may only
    //             address themselves / their own projects (EDGE-F4);
    //   anon    — anon key only (the static portal page), or a forged token:
    //             ANON_ALLOWED_EVENTS + three hourly buckets (EDGE-F5).
    const auth = req.headers.get('Authorization') || req.headers.get('authorization') || '';
    const bearer = auth.replace(/^Bearer\s+/i, '').trim();
    const apikey = req.headers.get('apikey') || req.headers.get('Apikey') || '';
    let caller: Caller = { kind: 'anon' };
    if (isServiceRoleToken(bearer) || isServiceRoleToken(apikey)) {
      caller = { kind: 'service' };
    } else if ((req.headers.get('x-cron-secret') || '').length >= 16 && await isValidCron(req)) {
      caller = { kind: 'service' };
    } else {
      const user = await verifyUser(req);
      if (user) caller = { kind: 'user', id: user.id };
    }
    // EDGE-F5: the anon path needs at least the project's anon key — a bare
    // curl with no headers is not a caller we serve.
    if (caller.kind === 'anon' && !apikey && !bearer) {
      return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    }

    const result = await dispatch(body, caller, clientIpFrom(req.headers));
    const { httpStatus, ...rest } = result;
    if (httpStatus && httpStatus >= 400) return jsonResponse({ success: false, ...rest }, httpStatus);
    return jsonResponse({ success: true, result: rest });
  } catch (e) {
    // Detail goes to the server log only; the caller gets a generic envelope
    // (the old `String(e)` echoed PostgREST paths and statuses to anonymous callers).
    console.error('[notify] dispatch failed', e);
    return jsonResponse({ success: false, error: 'notify_failed' }, 500);
  }
});
