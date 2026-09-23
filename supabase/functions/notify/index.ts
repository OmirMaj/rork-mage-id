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
//     'portal_reply'               — GC answers in the portal thread → homeowner
//                                    (trigger only; audit round 2, #16)
//     'lead_received'              — website quote form / widget lead → GC
//                                    (trigger only; audit round 2, #9)
//     'safety_incident_filed'      — invited collaborator files an incident → GC
//                                    (trigger only; wave 4, #119; no PHI)
//     'bid_invite_sent'            — GC invites a sub to bid → sub (answers
//                                    ok:false + reason when the email did not go)
//     'bid_invite_received'        — a sub files a bid through an invite link → GC
//     'lien_waiver_signed'         — a sub signs a requested lien waiver → GC
//     'prequal_submitted'          — a sub submits a prequalification packet → GC
//                                    (the last three: trigger only; wave 5, CONTRACT 8)
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
import { portalUrlFor, portalLinkEnded, subPortalUrlFor, APP_BASE } from "../_shared/portalLinks.ts";
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
// Audit round 2, #12: the ONE event -> screen table. The app's push-tap handler
// and in-app inbox import this same file, so an email button, a push tap and an
// inbox row for one event cannot open different screens (or the wrong param).
import { notificationRoute, routeHref } from "./routes.ts";

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
  /** The sub (subcontractors.id) and job the link is for — #149: the
   *  sub_invoice_submitted email opens /sub-portal-setup for THAT sub. */
  subcontractor_id?: string | null;
  project_id?: string | null;
}

interface BidQuestionRow {
  id: string;
  question: string | null;
  asker_name: string | null;
  created_at: string | null;
}

interface ChangeOrderRow {
  number: number | null;
  change_amount: number | string | null;
  new_contract_total: number | string | null;
  description: string | null;
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

// >>> bid-invite-format (pure; scripts/validate-drawing-contingency.ts evaluates this block)
/**
 * `bids_due_at` as the day a sub reads on his calendar ("Friday, September 18,
 * 2026"), or null when the package has no due date.
 *
 * It is `BidPackage.dueDate`, a CALENDAR DAY ('YYYY-MM-DD', or an ISO timestamp
 * after a sync — only its date prefix counts, as utils/calendarDate.ts does).
 * `new Date('2026-09-18')` is UTC midnight, and any local-zone format of that
 * instant west of Greenwich prints the 17th; so the day is built in UTC and
 * formatted in UTC, which names the same day whatever zone this isolate runs
 * in. A non-empty value that is not a real day is returned as written rather
 * than dropped — the GC typed a deadline, and hiding it is worse than showing
 * it raw (the caller escapes it).
 */
function bidDueDayLabel(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const raw = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const day = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC rolls over (Feb 31 -> Mar 3); a rolled day is not the one he set.
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return raw;
  return day.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** Scope text as email HTML: escaped first, THEN line breaks made visible —
 *  a GC's scope is a list typed one item per line, and HTML collapses a bare
 *  newline to a space, turning "Demo\nFrame\nHang" into one run-on sentence. */
function bidScopeHtml(scope: string): string {
  return escapeHtml(scope.replace(/\r\n?/g, '\n').trim()).replace(/\n/g, '<br>');
}

/**
 * When the link dies, from the invite row's own `expires_at`. The email used to
 * say "30 days from today" unconditionally — true on the first send and false
 * on every chase, which re-sends the SAME token with whatever time it has left.
 */
function bidInviteExpiryText(expiresAt: unknown, nowMs: number): string {
  const t = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(t)) return 'It stops working 30 days after it was first sent.';
  const days = Math.ceil((t - nowMs) / 86_400_000);
  if (days <= 0) return 'Its expiry time has passed — if it no longer opens, reply to this email for a new one.';
  return days === 1 ? 'It stops working within a day.' : `It stops working in ${days} days.`;
}
// <<< bid-invite-format

// >>> notify-format (pure; scripts/validate-notification-routes.ts and
//     scripts/validate-lead-contact-log.ts evaluate this block)
/**
 * Money to the cent: "$4,812.50", "$4,812" when the cents are zero, a leading
 * minus for a deduct CO. The shared fmtMoney rounds to whole dollars — fine
 * for a proposal headline, wrong for a signed change order a GC reconciles
 * against his own number. Null for anything that is not a finite number, so a
 * missing amount drops its line instead of printing "$0".
 */
function fmtMoneyCents(v: unknown): string | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(cents / 100).toLocaleString('en-US');
  const frac = cents % 100;
  return `${n < 0 && cents > 0 ? '-' : ''}$${whole}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}

/** True when a change order's amount is present and exactly zero (to the cent). */
function coAmountIsZero(v: unknown): boolean {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && Math.round(n * 100) === 0;
}

/**
 * How a change order is named in a push / subject: its real number from the
 * change_orders row. Never its uuid — "CO #9b1e44c0" matches nothing the GC
 * or the homeowner has ever seen on paper. No number, no "#".
 */
function coLabel(num: unknown): string {
  const n = typeof num === 'number' ? num : typeof num === 'string' && /^\d+$/.test(num.trim()) ? Number(num.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? `CO #${n}` : 'a change order';
}

/** widget-estimate prints the range it showed the homeowner into `scope` as
 *  "Instant Estimate shown: $38,000–$52,000" (budget_min/max stay empty, audit
 *  #24); utils/widgetLeadCore.ts reads it back with the same pattern. */
const WIDGET_BALLPARK_RX = /Instant Estimate shown: \$([\d,]+)\s*[\u2013-]\s*\$([\d,]+)/;
const WIDGET_MARK_RX = /Instant Estimate (shown|could not price)/;

function widgetBallparkText(scope: unknown): string | null {
  if (typeof scope !== 'string') return null;
  const m = WIDGET_BALLPARK_RX.exec(scope);
  return m ? `$${m[1]}\u2013$${m[2]}` : null;
}

/** The homeowner's own words: scope minus the widget's ballpark segment. */
function scopeWithoutBallpark(scope: unknown): string {
  if (typeof scope !== 'string') return '';
  return scope.split(' \u00B7 ').filter((part) => !WIDGET_MARK_RX.test(part)).join(' \u00B7 ').trim();
}

/** A widget lead's scope is text widget-estimate assembled (type · size ·
 *  finish · zip · notes · origin), not a sentence the homeowner typed. */
function isWidgetScope(scope: unknown): boolean {
  return typeof scope === 'string' && WIDGET_MARK_RX.test(scope);
}

/** A system portal row (ProjectContext's send/recall notices) still ends with
 *  the in-app "Tap to review." — meaningless in an email with a button. */
function portalBodyForEmail(body: string): string {
  return body.replace(/\s*Tap to review\.?\s*$/i, '').trim();
}

interface PortalInviteLike { id?: unknown; email?: unknown; name?: unknown }

/**
 * Who a GC's portal reply goes to (audit round 2, #16). The GC's own row never
 * carries an invite (hooks/usePortalThread.ts writes invite_id: null), so the
 * addressee is whoever wrote last: the invite on the newest client-authored
 * message in the thread. If that invite is gone — or nobody has written yet —
 * every invite on the portal is told, de-duplicated by address.
 */
function replyRecipients(invites: unknown, lastClientInviteId: string | null, cap = 10): { inviteId: string | null; email: string; name: string | null }[] {
  const list = (Array.isArray(invites) ? invites : []) as PortalInviteLike[];
  const clean = list
    .map((i) => ({
      inviteId: typeof i.id === 'string' ? i.id : null,
      email: typeof i.email === 'string' ? i.email.trim().toLowerCase() : '',
      name: typeof i.name === 'string' && i.name.trim() ? i.name.trim() : null,
    }))
    .filter((i) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email));
  const match = lastClientInviteId ? clean.filter((i) => i.inviteId === lastClientInviteId) : [];
  const chosen = match.length > 0 ? match : clean;
  const seen = new Set<string>();
  return chosen.filter((i) => (seen.has(i.email) ? false : (seen.add(i.email), true))).slice(0, cap);
}

/**
 * The lock-screen number (audit round 2, #17): the recipient's unread inbox
 * rows, plus the one this push is about to add (the outbox row is written
 * after the send). Null when the count could not be read — the push then
 * carries no badge and iOS leaves the icon as it was, rather than stamping a
 * made-up "1" that nothing in the app ever clears.
 */
function badgeFromUnread(unread: number | null): number | null {
  return typeof unread === 'number' && Number.isInteger(unread) && unread >= 0 ? unread + 1 : null;
}
// <<< notify-format

// >>> wave3-notify-text (pure; scripts/validate-invoice-send-pay-notify.ts evaluates this block)
/**
 * 'Mon, Sep 15' for a bare calendar day ('YYYY-MM-DD'), read as that day and
 * never as a UTC instant (new Date('2026-09-15') is Sep 14 in every US zone).
 * Anything else — an instant, garbage, an impossible date — is null, so the
 * copy falls back to "a daily report" instead of printing a guessed day.
 */
function reportDayLabel(v: unknown): string | null {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim()) : null;
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const at = new Date(Date.UTC(y, mo - 1, d, 12));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return null;
  return at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Push / email / inbox wording for the wave-3 GC events. One function so the
 * push, the email and the validator agree. Every figure is exact to the cent
 * (fmtMoneyCents) — a GC reconciles "client paid $77,484.88" against his bank,
 * not "$77K". Null for an event this block does not own.
 *
 *   client_invoice_paid    stripe-webhook, after a credited (non-duplicate) payment (#48)
 *   client_payment_failed  stripe-webhook, a delayed (ACH) payment that bounced (#48)
 *   field_report_filed     a collaborator's daily report was filed (dfr-screen trigger)
 *   pro_response_received  an architect/engineer answered an RFI or submittal (rfi-core)
 *   punch_marked_ready     a sub marked a punch item ready for review (punch)
 *   safety_incident_filed  an invited collaborator filed an incident report (wave 4,
 *                          #119; trg_notify_safety_incident_filed). NO PHI: the
 *                          payload carries only the author's name and the severity
 *                          word, and neither is printed as injury detail — a push
 *                          lands on a lock screen and the outbox feeds the digests.
 */
function wave3NotifyText(event: string, p: Record<string, unknown>, projectName: string): {
  prefKey: string; pushTitle: string; pushBody: string; emailSubject: string;
  eyebrow: string; title: string; subtitle: string; rows: [string, string, boolean?][]; ctaLabel: string;
} | null {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
    return Number.isInteger(n) && n > 0 ? `#${n}` : '';
  };
  switch (event) {
    case 'client_invoice_paid': {
      const inv = num(p.number);
      const paid = fmtMoneyCents(p.amount_paid) ?? 'A payment';
      const full = p.paid_in_full === true;
      const bal = fmtMoneyCents(p.balance);
      const label = inv ? `Invoice ${inv}` : 'an invoice';
      return {
        prefKey: 'invoice_paid',
        pushTitle: `Client paid ${label} · ${projectName}`,
        pushBody: full ? `${paid} received — paid in full.` : `${paid} received${bal ? ` · ${bal} still due` : ''}.`,
        emailSubject: `Client paid ${label}: ${paid} · ${projectName}`,
        eyebrow: 'Payment received',
        title: `Your client paid ${paid}`,
        subtitle: full
          ? `${label[0].toUpperCase()}${label.slice(1)} is paid in full. The money settles to your Stripe account on its payout schedule.`
          : `${label[0].toUpperCase()}${label.slice(1)} still has a balance. The money settles to your Stripe account on its payout schedule.`,
        rows: [
          ['Invoice', inv || '—'],
          ['Amount received', paid, true],
          ['Balance remaining', full ? 'Paid in full' : (bal ?? '—')],
        ],
        ctaLabel: 'Open the invoice',
      };
    }
    case 'client_payment_failed': {
      const inv = num(p.number);
      const amt = fmtMoneyCents(p.amount) ?? 'A payment';
      const label = inv ? `Invoice ${inv}` : 'an invoice';
      return {
        prefKey: 'invoice_paid',
        pushTitle: `Payment failed · ${label}`,
        pushBody: `${amt} from your client did not go through. The invoice is still open.`,
        emailSubject: `Payment failed: ${amt} on ${label} · ${projectName}`,
        eyebrow: 'Payment failed',
        title: `A ${amt} payment did not go through`,
        subtitle: 'Your client started a bank payment that failed after checkout. Nothing was credited — the invoice is still open. Reach out, or send a new pay link.',
        rows: [['Invoice', inv || '—'], ['Attempted', amt, true]],
        ctaLabel: 'Open the invoice',
      };
    }
    case 'field_report_filed': {
      // Wave 4 (#60): raised when the report is SUBMITTED (status → 'sent'),
      // not on the first Save Draft, and for the report's own day — a Monday
      // report backfilled on Wednesday is "the report for Mon, Sep 15", never
      // "today's". report_date is the trigger's calendar day ('YYYY-MM-DD');
      // missing/garbled → "a daily report", never a guessed day.
      // (#59/#133): portal_status is what the homeowner can see NOW (the
      // trigger's rule: shared AND the portal shows daily reports). The copy
      // used to promise "nothing reaches the homeowner" while a foreman's
      // report was already on the portal; each branch now says what is true.
      // An older trigger sent no portal_status — then neither promise is made.
      const who = s(p.author_name) || 'Your field team';
      const day = reportDayLabel(p.report_date);
      const filed = day ? `filed the report for ${day}` : 'filed a daily report';
      const status = p.portal_status === 'sent' ? 'sent' : p.portal_status === 'draft' ? 'draft' : null;
      const tail = status === 'sent'
        ? (p.in_weekly_digest === false
          ? "It's already on the homeowner's portal. Hide it if it shouldn't be."
          : "It's already on the homeowner's portal and will be in Friday's update. Hide it if it shouldn't be.")
        : status === 'draft'
          ? 'Review it before anything goes to the homeowner.'
          : 'Open it to check what the homeowner can see.';
      const rows: [string, string, boolean?][] = [['Filed by', who]];
      if (day) rows.push(['Report date', day]);
      rows.push(['Homeowner portal', status === 'sent' ? 'Showing now' : status === 'draft' ? 'Not shown — waiting on you' : 'Check in the app']);
      return {
        prefKey: 'field_report',
        pushTitle: `Daily report filed · ${projectName}`,
        pushBody: `${who} ${filed}. ${tail}`,
        emailSubject: `${who} ${filed} · ${projectName}`,
        eyebrow: 'Daily report filed',
        title: `${who} filed a daily report`,
        subtitle: tail,
        rows,
        ctaLabel: 'Review the report',
      };
    }
    case 'pro_response_received': {
      const kind = p.kind === 'submittal' ? 'Submittal' : 'RFI';
      const n = num(p.number);
      const who = s(p.responder_name) || (kind === 'RFI' ? 'The design team' : 'The reviewer');
      const code = s(p.action_code);
      const label = `${kind}${n ? ` ${n}` : ''}`;
      return {
        prefKey: 'pro_response',
        pushTitle: `${label} answered · ${projectName}`,
        pushBody: `${who} responded${code ? ` — ${code}` : ''}.`,
        emailSubject: `${who} responded to ${label} · ${projectName}`,
        eyebrow: `${kind} response`,
        title: `${who} responded to ${label}`,
        subtitle: 'Read the response and update the work that was waiting on it.',
        rows: code ? [[kind === 'Submittal' ? 'Action' : 'Status', code, true]] : [],
        ctaLabel: `Open ${label}`,
      };
    }
    case 'punch_marked_ready': {
      // Wave 4 (#51): WHICH item — the description, the room and the sub's own
      // note (CONTRACT 10 payload keys) — instead of twelve identical "marked a
      // punch item ready" pushes. The sub typed all three on his portal, so
      // they are clipped here and escaped where they meet HTML (the dispatch
      // escapes every row; wrapEmailHtml escapes title/subtitle). more_count
      // is the marks from this sub on this job that arrived inside the
      // coalescing window and went only to the inbox (punchReadyCoalesce).
      const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v);
      const who = s(p.sub_name) || 'A subcontractor';
      const desc = clip(s(p.description).replace(/\s+/g, ' '), 80);
      const loc = clip(s(p.location).replace(/\s+/g, ' '), 60);
      const note = clip(s(p.sub_note).replace(/\s+/g, ' '), 200);
      const moreN = typeof p.more_count === 'number' && Number.isInteger(p.more_count) && p.more_count > 0 ? p.more_count : 0;
      const more = moreN ? ` And ${moreN} more from ${who} since the last alert — see Review.` : '';
      const item = desc ? `“${desc}”` : 'a punch item';
      const rows: [string, string, boolean?][] = [['From', who]];
      if (desc) rows.push(['Item', desc, true]);
      rows.push(['Location', loc || 'No room given']);
      if (note) rows.push(['Sub’s note', note]);
      if (moreN) rows.push(['Also marked since the last alert', `${moreN} more`]);
      return {
        prefKey: 'punch_ready',
        pushTitle: `Punch item ready · ${projectName}`,
        pushBody: `${who} marked ${item}${loc ? ` (${loc})` : ''} ready for your review.${more}`,
        emailSubject: `${who} marked ${desc ? `“${clip(desc, 50)}”` : 'a punch item'} ready · ${projectName}`,
        eyebrow: 'Punch list',
        title: `${who} says ${desc ? `“${desc}”` : 'a punch item'} is done`,
        subtitle: 'Walk it and close it, or send it back.',
        rows,
        ctaLabel: 'Open the item',
      };
    }
    case 'safety_incident_filed': {
      const who = s(p.author_name) || 'Someone on your team';
      return {
        prefKey: 'safety_incident',
        pushTitle: `Incident report filed · ${projectName}`,
        pushBody: `${who} filed an incident report on ${projectName}. Open it in Safety.`,
        emailSubject: `${who} filed an incident report · ${projectName}`,
        eyebrow: 'Safety',
        title: `${who} filed an incident report`,
        subtitle: `Open it in Safety to review the case and decide whether it goes on your OSHA 300 log.`,
        rows: [['Filed by', who]],
        ctaLabel: 'Open the incident',
      };
    }
    default:
      return null;
  }
}
// <<< wave3-notify-text

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

/**
 * Unread inbox rows for a user — the same rows app/notifications-inbox.tsx
 * lists (recipient_user_id, read_at null, the daily_digest_sent audit marker
 * excluded). A HEAD count: the app's feed stops at 80 rows, this does not.
 * Null on any failure (see badgeFromUnread).
 */
async function unreadCountFor(userId: string | null | undefined): Promise<number | null> {
  if (!isUuid(userId)) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_outbox?recipient_user_id=eq.${userId}&read_at=is.null&event_type=neq.daily_digest_sent&select=id`,
      {
        method: 'HEAD',
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          Prefer: 'count=exact',
          Range: '0-0',
        },
      },
    );
    // PostgREST answers "0-0/17" (or "*/0" when empty) in Content-Range.
    const total = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    return r.ok || r.status === 206 ? (Number.isInteger(total) && total >= 0 ? total : null) : null;
  } catch {
    return null;
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
    const rows = await sbGet(`sub_portal_links?id=eq.${encodeURIComponent(subPortalId)}&select=id,user_id,access_token,enabled,subcontractor_id,project_id&limit=1`) as SubPortalLinkRow[];
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

// >>> wave5-notify-text (pure; scripts/validate-w5-join-server-events.ts evaluates
//     this block together with notify-format)
/**
 * The three sub-side GC events of wave 5 (CONTRACT 8). Each is raised ONLY by
 * its AFTER trigger (fire_notify, the cron secret) and carries ids only; every
 * fact printed here was re-read from the source row with the service role by
 * loadWave5Source, never taken from the payload a trigger (or anyone) sent.
 *
 *   bid_invite_received  a sub filed his number through an invite link (#15)
 *   lien_waiver_signed   a sub signed a lien waiver the GC requested (#31)
 *   prequal_submitted    a sub submitted a prequalification packet (#111)
 *
 * The sub typed his company / signer name, so every string is flattened to one
 * line and clipped here; the dispatch escapes each stat row and wrapEmailHtml
 * escapes title / subtitle / preheader. prefKey is the event name (each has a
 * row in app/notifications-settings.tsx and marketing/email-event-keys.json).
 * Money is exact to the cent with both decimals ("$48,250.00"): it is a bid he
 * will compare against other bids, not a headline.
 */
function fmtMoney2(v: unknown): string | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(cents / 100).toLocaleString('en-US');
  return `${n < 0 && cents > 0 ? '-' : ''}$${whole}.${String(cents % 100).padStart(2, '0')}`;
}

/** 'conditional_progress' → 'Conditional progress'. Unknown → null. */
function waiverTypeLabel(v: unknown): string | null {
  if (typeof v !== 'string' || !/^[a-z_]{3,40}$/.test(v.trim())) return null;
  const words = v.trim().replace(/_/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

/** 'Sep 15, 2026' for a bare calendar day, read as that day (never a UTC
 *  instant); anything else → null, so no guessed date is printed. */
function throughDayLabel(v: unknown): string | null {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim()) : null;
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const at = new Date(Date.UTC(y, mo - 1, d, 12));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return null;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function wave5NotifyText(event: string, f: Record<string, unknown>, projectName: string | null): {
  prefKey: string; pushTitle: string; pushBody: string; emailSubject: string;
  eyebrow: string; title: string; subtitle: string; rows: [string, string, boolean?][]; ctaLabel: string;
} | null {
  const one = (v: unknown, n: number) => {
    const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
  };
  const onJob = projectName ? ` · ${projectName}` : '';
  switch (event) {
    case 'bid_invite_received': {
      const who = one(f.vendor_name, 80) || one(f.sub_name, 80) || 'A subcontractor';
      const pkg = one(f.package_name, 80) || 'your bid package';
      const amt = fmtMoney2(f.amount);
      const rows: [string, string, boolean?][] = [['Package', pkg], ['From', who]];
      rows.push(['Bid', amt ?? 'Open the package to see it', !!amt]);
      if (projectName) rows.push(['Project', projectName]);
      return {
        prefKey: 'bid_invite_received',
        pushTitle: `Bid received · ${pkg}`,
        pushBody: amt ? `${who} bid ${amt} on ${pkg}${projectName ? ` (${projectName})` : ''}.` : `${who} filed a bid on ${pkg}${projectName ? ` (${projectName})` : ''}.`,
        emailSubject: amt ? `${who} bid ${amt} · ${pkg}${onJob}` : `${who} filed a bid · ${pkg}${onJob}`,
        eyebrow: 'Bid received',
        title: amt ? `${who} bid ${amt}` : `${who} filed a bid`,
        subtitle: `On ${pkg}, through the invite link you sent. It is in the package's bid matrix, ready to level against the others.`,
        rows,
        ctaLabel: 'Open the package',
      };
    }
    case 'lien_waiver_signed': {
      const signer = one(f.signer_name, 80);
      const company = one(f.sub_company, 80);
      const who = company || signer || 'A subcontractor';
      const type = waiverTypeLabel(f.waiver_type);
      const through = throughDayLabel(f.through_date);
      const amt = fmtMoney2(f.paid_amount);
      const rows: [string, string, boolean?][] = [['Sub', who]];
      if (signer && signer !== who) rows.push(['Signed by', signer]);
      if (type) rows.push(['Waiver', type]);
      if (through) rows.push(['Through', through]);
      if (amt) rows.push(['Amount', amt, true]);
      return {
        prefKey: 'lien_waiver_signed',
        pushTitle: `Lien waiver signed${onJob}`,
        pushBody: `${who} signed their ${type ? `${type.toLowerCase()} ` : ''}lien waiver${amt ? ` for ${amt}` : ''}.`,
        emailSubject: `${who} signed their lien waiver${onJob}`,
        eyebrow: 'Lien waiver signed',
        title: `${who} signed their lien waiver`,
        subtitle: 'The signed waiver is on the job’s lien waiver list.',
        rows,
        ctaLabel: 'Open lien waivers',
      };
    }
    case 'prequal_submitted': {
      const who = one(f.sub_name, 80) || 'A subcontractor';
      return {
        prefKey: 'prequal_submitted',
        pushTitle: 'Prequalification submitted',
        pushBody: `${who} submitted their prequalification packet. Review it before you award them work.`,
        emailSubject: `${who} submitted their prequalification packet`,
        eyebrow: 'Prequalification',
        title: `${who} submitted their prequalification packet`,
        subtitle: 'Run the auto-review, then approve it or send it back with what needs changing.',
        rows: [['From', who], ...(projectName ? [['Project', projectName] as [string, string]] : [])],
        ctaLabel: 'Review the packet',
      };
    }
    default:
      return null;
  }
}
// <<< wave5-notify-text

// ─── Wave 5 sub-side events (CONTRACT 8) ──────────────────────────────
/** Raised only by trg_notify_bid_invite_received / trg_notify_lien_waiver_signed
 *  / trg_notify_prequal_submitted — all three are in SERVICE_ONLY_EVENTS. */
const WAVE5_SOURCE_EVENTS: ReadonlySet<string> = new Set(['bid_invite_received', 'lien_waiver_signed', 'prequal_submitted']);

type Wave5Source =
  | { ok: true; ownerId: string; projectId: string | null; facts: Record<string, unknown>; pushData: Record<string, unknown> }
  | { ok: false; reason: string };

/** The project id when the project exists AND belongs to `ownerId`; else null
 *  (the email then names no job rather than someone else's). */
async function ownedProjectId(projectId: unknown, ownerId: string): Promise<string | null> {
  if (!isUuid(projectId)) return null;
  try {
    const rows = await sbGet(`projects?id=eq.${projectId}&user_id=eq.${ownerId}&select=id&limit=1`) as { id: string }[];
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function firstRow<T>(path: string): Promise<T | null> {
  try {
    const rows = await sbGet(path) as T[];
    return Array.isArray(rows) ? rows[0] ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Re-read the row a wave-5 trigger fired for, with the service role. The
 * payload carries ids only (CONTRACT 8); the recipient is the row's owner and
 * must equal payload.user_id, and every name / amount the email prints comes
 * from these reads — nothing an anonymous sub typed rides in the payload, and a
 * forged payload pairing one GC's id with another GC's row is refused.
 */
async function loadWave5Source(event: string, payload: Record<string, unknown>): Promise<Wave5Source> {
  const ownerId = uuidOrNull(payload.user_id);
  if (!ownerId) return { ok: false, reason: 'bad_payload' };
  if (event === 'bid_invite_received') {
    const inviteId = uuidOrNull(payload.invite_id);
    const packageId = uuidOrNull(payload.package_id);
    if (!inviteId || !packageId) return { ok: false, reason: 'bad_payload' };
    const invite = await firstRow<{ id: string; user_id: string | null; package_id: string | null; sub_name: string | null; bid_id: string | null; responded_at: string | null }>(
      `bid_package_invites?id=eq.${inviteId}&select=id,user_id,package_id,sub_name,bid_id,responded_at&limit=1`);
    const pkg = await firstRow<{ id: string; user_id: string | null; project_id: string | null; name: string | null }>(
      `bid_packages?id=eq.${packageId}&select=id,user_id,project_id,name&limit=1`);
    if (!invite || !pkg || invite.user_id !== ownerId || pkg.user_id !== ownerId || invite.package_id !== pkg.id || !invite.responded_at) {
      return { ok: false, reason: 'source_mismatch' };
    }
    // The ROW's bid id, and only a bid on this package.
    const bidId = uuidOrNull(invite.bid_id);
    const bid = bidId
      ? await firstRow<{ vendor_name: string | null; amount: number | string | null }>(
        `bid_package_bids?id=eq.${bidId}&package_id=eq.${pkg.id}&select=vendor_name,amount&limit=1`)
      : null;
    return {
      ok: true, ownerId,
      projectId: await ownedProjectId(pkg.project_id, ownerId),
      facts: { package_name: pkg.name, vendor_name: bid?.vendor_name ?? null, sub_name: invite.sub_name, amount: bid?.amount ?? null },
      pushData: { packageId: pkg.id },
    };
  }
  if (event === 'lien_waiver_signed') {
    const waiverId = uuidOrNull(payload.waiver_id);
    if (!waiverId) return { ok: false, reason: 'bad_payload' };
    const w = await firstRow<{ id: string; user_id: string | null; project_id: string | null; waiver_type: string | null; sub_name: string | null; through_date: string | null; paid_amount: number | string | null; signed_at: string | null; sub_signature: { name?: unknown; role?: unknown } | null }>(
      `lien_waivers?id=eq.${waiverId}&select=id,user_id,project_id,waiver_type,sub_name,through_date,paid_amount,signed_at,sub_signature&limit=1`);
    if (!w || w.user_id !== ownerId || !w.signed_at) return { ok: false, reason: 'source_mismatch' };
    // The GC's own paper record is not news to the GC (the trigger skips it too).
    if (w.sub_signature && w.sub_signature.role === 'gc') return { ok: false, reason: 'gc_paper_record' };
    return {
      ok: true, ownerId,
      projectId: await ownedProjectId(w.project_id, ownerId),
      facts: {
        signer_name: typeof w.sub_signature?.name === 'string' ? w.sub_signature.name : null,
        sub_company: w.sub_name, waiver_type: w.waiver_type, through_date: w.through_date, paid_amount: w.paid_amount,
      },
      pushData: { waiverId: w.id },
    };
  }
  if (event === 'prequal_submitted') {
    const packetId = uuidOrNull(payload.packet_id);
    if (!packetId) return { ok: false, reason: 'bad_payload' };
    const pk = await firstRow<{ id: string; user_id: string | null; subcontractor_id: string | null; project_id: string | null; status: string | null }>(
      `prequal_packets?id=eq.${packetId}&select=id,user_id,subcontractor_id,project_id,status&limit=1`);
    if (!pk || pk.user_id !== ownerId || pk.status !== 'submitted') return { ok: false, reason: 'source_mismatch' };
    // The name from the GC's OWN roster row (prequal_packets carries none).
    const sub = isUuid(pk.subcontractor_id)
      ? await firstRow<{ company_name: string | null }>(`subcontractors?id=eq.${pk.subcontractor_id}&user_id=eq.${ownerId}&select=company_name&limit=1`)
      : null;
    return {
      ok: true, ownerId,
      projectId: await ownedProjectId(pk.project_id, ownerId),
      facts: { sub_name: sub?.company_name ?? null },
      pushData: { packetId: pk.id },
    };
  }
  return { ok: false, reason: 'unknown_event' };
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
async function sendPush(token: string, title: string, body: string, data?: Record<string, unknown>, badge?: number | null): Promise<{ ok: boolean; resp?: unknown }> {
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
        // Audit round 2, #17: the recipient's real unread count, never a
        // hard-coded 1 — that stamped "1" on the icon for good (nothing in the
        // app cleared it) and read the same for one push as for five.
        ...(typeof badge === 'number' ? { badge } : {}),
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

// ─── punch_marked_ready coalescing (wave 4, #51) ───────────────────────
// >>> punch-ready-coalesce (scripts/validate-w4-punch-gc-fixes.ts evaluates this block with stubbed I/O)
/** The window a sub's sweep of "Mark fixed" taps collapses into one alert. */
const PUNCH_READY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Should this punch_marked_ready go out loud, and how many quiet ones came
 * before it? The first mark per GC + job + sub in a fixed 10-minute window is
 * loud (rate_limit_increment's atomic counter — the i'th caller sees count i,
 * so exactly one per window is first); later ones in the window are quiet
 * (inbox row only). A loud one counts the quiet rows logged since the last
 * loud one for the same key, so its push says "and N more".
 *
 * Fails OPEN like exceedsRateLimit: a counter or read that errors sends the
 * alert (a duplicate beats a dropped "work is ready"), and a failed count is
 * simply no "and N more". Fixed windows, not sliding: a sweep that straddles
 * a boundary sends two alerts, never zero.
 */
async function punchReadyCoalesce(
  gcUserId: string,
  projectId: string | null,
  payload: Record<string, unknown>,
): Promise<{ quiet: boolean; more: number }> {
  const sub = typeof payload.sub_name === 'string' ? payload.sub_name.trim() : '';
  const subKey = sub.toLowerCase() || '-';
  const windowId = Math.floor(Date.now() / PUNCH_READY_WINDOW_MS);
  if (await exceedsRateLimit(`notify:punch_ready:${gcUserId}:${projectId ?? '-'}:${subKey}:${windowId}`, 1)) {
    return { quiet: true, more: 0 };
  }
  if (!projectId || !sub) return { quiet: false, more: 0 };
  try {
    const base = `notification_outbox?event_type=eq.punch_marked_ready&recipient_user_id=eq.${encodeURIComponent(gcUserId)}`
      + `&payload->>project_id=eq.${encodeURIComponent(projectId)}&payload->>sub_name=eq.${encodeURIComponent(sub)}`;
    // A loud row with no push token has a NULL push_status — still loud.
    const lastLoud = await sbGet(`${base}&or=(push_status.is.null,push_status.neq.coalesced)&select=created_at&order=created_at.desc&limit=1`) as { created_at: string }[];
    const since = Array.isArray(lastLoud) && lastLoud[0]?.created_at
      ? lastLoud[0].created_at
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const quietRows = await sbGet(`${base}&push_status=eq.coalesced&created_at=gt.${encodeURIComponent(since)}&select=id&limit=500`) as unknown[];
    return { quiet: false, more: Array.isArray(quietRows) ? quietRows.length : 0 };
  } catch {
    return { quiet: false, more: 0 };
  }
}
// <<< punch-ready-coalesce

// ─── Event dispatch ───────────────────────────────────────────────────
/** Events only a trigger (service caller) may raise — see dispatch(). */
/** lead_received pushes/emails per GC per hour (public-lead-intake caps
 *  captured leads at 30/h per account; this backs it up at the sender). */
const LEAD_NOTIFY_HOURLY_CAP = 20;
/** portal_reply emails per GC per hour, charged per RECIPIENT — the same
 *  number as send-email's free-tier RECIPIENTS_PER_HOUR_FREE. The invite list
 *  and the message text are both his, so without a sender-side cap this
 *  branch is an unmetered mail relay on the shared sending domain. */
const PORTAL_REPLY_HOURLY_CAP = 60;
/** All portal_reply emails, every GC together, per hour (send-email's
 *  GLOBAL_RECIPIENTS_PER_HOUR) — the ceiling if many accounts are abused at once. */
const PORTAL_REPLY_GLOBAL_HOURLY_CAP = 500;

// The wave-3 GC events carry money and a named sender, so only a trusted
// server caller raises them: stripe-webhook (service role) and the database
// triggers / RPCs (fire_notify, the cron secret). A signed-in JWT forging
// "your client paid $50,000" or "the architect approved it" is refused.
const SERVICE_ONLY_EVENTS: ReadonlySet<string> = new Set([
  'portal_reply', 'lead_received',
  'client_invoice_paid', 'client_payment_failed', 'field_report_filed', 'pro_response_received', 'punch_marked_ready',
  // wave 4 (#119): raised only by trg_notify_safety_incident_filed.
  'safety_incident_filed',
  // wave 5 (CONTRACT 8): raised only by trg_notify_bid_invite_received,
  // trg_notify_lien_waiver_signed and trg_notify_prequal_submitted.
  'bid_invite_received', 'lien_waiver_signed', 'prequal_submitted',
]);

interface DispatchResult {
  ok: boolean;
  reason?: string;
  event?: string;
  gc?: string | null;
  portal_id?: string | null;
  /** Set on authorization / abuse refusals; the handler maps it to the HTTP status. */
  httpStatus?: number;
  /** True when at least one push or email of this dispatch was actually SENT
   *  (not skipped by prefs, suppressed, token-less or failed). A 200 alone
   *  only means "handled" — notify-nearby-contractors counts on this. */
  delivered?: boolean;
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
  // portal_reply mails a homeowner and lead_received names a stranger's phone
  // number: both are raised only by their AFTER INSERT triggers (the cron
  // secret), never by a JWT that could aim them at somebody else.
  if (!isService && SERVICE_ONLY_EVENTS.has(event)) {
    return { ok: false, reason: 'service_only_event', event, httpStatus: 403 };
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

  // Wave 5 (CONTRACT 8): the three sub-side trigger events name their
  // recipient by the SOURCE ROW's owner, re-read here with the service role
  // (they are service-only, so only a trigger reaches this). The payload's
  // ids pick the row; nothing else in it is trusted.
  let wave5: Extract<Wave5Source, { ok: true }> | null = null;
  if (WAVE5_SOURCE_EVENTS.has(event)) {
    const src = await loadWave5Source(event, payload);
    if (!src.ok) return { ok: false, reason: src.reason, event };
    wave5 = src;
    gcUserId = src.ownerId;
    projectId = src.projectId;
  }

  // Portal-first project lookup: one service-role read yields the GC, the
  // email context AND client_portal for the tokenized portal URL (EDGE-F6).
  // Anon: look the project up by the id the token PROVED, not by the portal id
  // (they agree by construction; the proof must not hinge on a second lookup).
  const projectCtx = await getProjectContext(projectId, isAnonCaller ? null : effectivePortalId);
  if (projectCtx.id) projectId = projectCtx.id;
  if (!gcUserId && effectivePortalId && projectCtx.viaPortal) gcUserId = projectCtx.user_id ?? null;

  let subPortalLink: string | null = null;
  let trustedSubLink: SubPortalLinkRow | null = null;
  if (subPortalId) {
    const link = await getSubPortalLink(subPortalId);
    trustedSubLink = link;
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
  let portalUrl = portalUrlFor(projectCtx.client_portal);
  // An ENDED link (portal_snapshots.expires_at in the past) is treated exactly
  // like no portal: every template already omits the CTA / skips the client
  // email when portalUrl is null. A failed read keeps the link (fail open —
  // the page itself refuses an expired token with a clear message).
  //
  // A portal that was NEVER published (no portal_snapshots row) is dropped
  // the same way: the link opens the "not published" fallback page, a dead
  // end. award_rfp creates the winner's project with client_portal.enabled
  // and the homeowner already on the invites, so a message he writes before
  // his first publish would otherwise email the homeowner a dead link.
  let portalUnpublished = false;
  if (portalUrl) {
    const cpId = ((projectCtx.client_portal ?? {}) as { portalId?: unknown }).portalId;
    if (typeof cpId === 'string' && cpId.trim()) {
      try {
        const snap = await sbGet(`portal_snapshots?portal_id=eq.${encodeURIComponent(cpId.trim())}&select=expires_at&limit=1`) as { expires_at: string | null }[];
        if (Array.isArray(snap) && snap.length === 0) { portalUnpublished = true; portalUrl = null; }
        else if (portalLinkEnded(snap[0]?.expires_at ?? null)) portalUrl = null;
      } catch { /* keep the link */ }
    }
  }
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
  let deliveredAny = false;
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
    /** Footer "Sent by …" override. sharedEmail's sender is the GC, which is
     *  right for client/sub mail and wrong for mail TO the GC about someone
     *  else (he would read "Sent by <himself>. Replies go to them"). Pass
     *  null to print no sender line. */
    sender?: { name?: string; email?: string; phone?: string } | null;
    /** Email subject — usually different (and tighter) than push title. */
    emailSubject: string;
    /** Inbox row only: no push, no email (a coalesced repeat — see
     *  punchReadyCoalesce). Both statuses are logged as 'coalesced'. */
    quiet?: boolean;
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

    const allowPush = !spec.quiet && kind === 'gc' && prefAllows(gc.notification_preferences, spec.prefKey, 'push');
    const allowEmail = !spec.quiet && prefAllows(gc.notification_preferences, spec.prefKey, 'email');
    if (spec.quiet) { pushStatus = 'coalesced'; emailStatus = 'coalesced'; }

    if (allowPush && spec.pushToken) {
      const badge = badgeFromUnread(await unreadCountFor(gcUserId));
      const r = await sendPush(spec.pushToken, spec.pushTitle, spec.pushBody, spec.pushData, badge);
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
          ...(spec.sender !== undefined ? { sender: spec.sender ?? undefined } : {}),
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

    if (pushStatus === 'sent' || emailStatus === 'sent') deliveredAny = true;
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

  // Every in-app email button goes through the shared route table (./routes.ts)
  // — the same one the push tap and the inbox read — so the param each screen
  // actually reads is the one the link sends. Nothing openable: the app root,
  // never a screen that will say "not found".
  const appLink = (routeEvent: string, data: Record<string, unknown>): string => {
    const r = notificationRoute(routeEvent, data);
    return r ? `${APP_BASE}${routeHref(r)}` : APP_BASE;
  };
  const projectData = { project_id: projectId };

  // Audit round 2, #13: the outbox payload is what the inbox (summarize) and
  // daily-digest read later, and no trigger sends the project's name — so the
  // one notify already resolved is written into it. RFP events have no project.
  if (projectCtx.id) payload.project_name = projectCtx.name;

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
          subtitle: `Reply through MAGE ID — your client gets an email with your answer and a link back to their portal.`,
          bodyHtml: emailQuote(trimmed),
          cta: { label: 'Reply in MAGE ID', href: appLink('portal_message', projectData) },
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
          cta: { label: 'Review the proposal', href: appLink('budget_proposal', projectData) },
        },
      });
      break;
    }

    case 'co_approval': {
      const decision = (payload.decision as string) ?? 'approved';
      const signerName = (payload.signer_name as string) || 'your client';
      const coId = uuidOrNull(payload.change_order_id);
      const note = typeof payload.note === 'string' ? payload.note.trim() : '';
      // Audit round 2, #13: the trigger sends only the CO's uuid, so the push
      // read "approved CO #9b1e44c0" with no amount. Read the row — scoped to
      // THIS project as well as the id, so a change_order_id supplied through a
      // portal can never pull another job's number and amount into the email —
      // and write what it says into the stored payload, where the inbox and
      // daily-digest read it too.
      let co: ChangeOrderRow | null = null;
      if (coId && projectCtx.id) {
        try {
          const rows = await sbGet(`change_orders?id=eq.${coId}&project_id=eq.${projectCtx.id}&select=number,change_amount,new_contract_total,description&limit=1`) as ChangeOrderRow[];
          co = rows[0] ?? null;
        } catch { co = null; }
      }
      if (co) {
        // `number` is an integer column; String() is the conversion the old
        // `as string` cast only pretended to do.
        if (typeof co.number === 'number') payload.co_number = String(co.number);
        if (co.change_amount != null) payload.co_amount = Number(co.change_amount);
        if (co.new_contract_total != null) payload.new_contract_total = Number(co.new_contract_total);
        if (co.description) payload.co_description = co.description;
      } else {
        // A number the caller supplied is not the record's number; say nothing.
        delete payload.co_number;
        delete payload.co_amount;
      }
      const coName = coLabel(payload.co_number);
      // A $0 CO (scope swap, no cost change) prints no amount in the push or
      // subject — "approved CO #3 ($0)" reads like a missing number — and the
      // stat card says "No cost change", matching the inbox's fmtMoneyExact.
      const coNoCost = coAmountIsZero(payload.co_amount);
      const coAmount = coNoCost ? null : fmtMoneyCents(payload.co_amount);
      const newTotal = fmtMoneyCents(payload.new_contract_total);
      const description = typeof payload.co_description === 'string' ? payload.co_description : '';
      const isApproved = decision === 'approved';
      const verb = isApproved ? 'approved' : 'declined';
      const symbol = isApproved ? EMOJI.approved : EMOJI.declined;
      await dispatchOne('gc', {
        prefKey: 'co_approval',
        pushTitle: `${isApproved ? 'CO approved' : 'CO declined'} · ${projectName}`,
        pushBody: `${signerName} ${verb} ${coName}${coAmount ? ` (${coAmount})` : ''}${!isApproved && note ? ` — "${note.slice(0, 90)}"` : ''}`,
        pushData: { projectId, portalId, kind: 'co_approval', changeOrderId: coId ?? undefined },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${symbol} ${coName === 'a change order' ? 'Change order' : coName} ${verb}${coAmount ? ` · ${coAmount}` : ''} · ${projectName}`,
        emailWrap: {
          preheader: `${signerName} ${verb} ${coName}${coAmount ? ` for ${coAmount}` : ''}.`,
          eyebrow: isApproved ? 'Change order approved' : 'Change order declined',
          title: `${signerName} ${verb} ${coName}`,
          subtitle: isApproved
            ? 'Approval is logged and time-stamped — proceed with the work.'
            // #73: name the action the CO screen actually has — "Revise &
            // re-issue" on the declined CO starts a new version with the next
            // number (the declined one keeps its record).
            : note
              ? 'Their reason is below — answer it, then use Revise & re-issue on the change order if it still applies.'
              : 'They gave no reason. Reach out to clarify, then use Revise & re-issue on the change order if appropriate.',
          bodyHtml: `${emailStatCard([
            coName !== 'a change order' ? emailStatRow('Change order', escapeHtml(coName.replace('CO ', ''))) : '',
            description ? emailStatRow('Scope', escapeHtml(description.length > 80 ? description.slice(0, 80) + '…' : description)) : '',
            coAmount ? emailStatRow('Amount', coAmount, { emphasize: true, valueColor: isApproved ? '#1E8E4A' : '#C2410C' }) : '',
            coNoCost ? emailStatRow('Amount', 'No cost change') : '',
            isApproved && newTotal ? emailStatRow('New contract total', newTotal) : '',
            emailStatRow('Decision', isApproved ? 'Approved' : 'Declined', coAmount ? undefined : { emphasize: true }),
          ].join(''))}${!isApproved && note ? emailQuote(note) : ''}`,
          // Lands on THIS change order (projectId + coId), not a blank new one.
          cta: { label: 'View change order', href: appLink('co_approval', { project_id: projectId, change_order_id: coId }) },
        },
      });
      break;
    }

    case 'sub_invoice_submitted': {
      // #149: name the sub the link belongs to, so the email / push / inbox
      // open /sub-portal-setup for THAT sub (routes.ts reads sub_id) instead
      // of the /sub-portals list. Only from the trusted link row, and only
      // when it is this GC's link on this job.
      const linkSubId = strOrNull(trustedSubLink?.subcontractor_id);
      if (linkSubId && trustedSubLink?.user_id === gcUserId && projectId && trustedSubLink?.project_id === projectId) {
        payload.sub_id = linkSubId;
      }
      const num = (payload.invoice_number as string) || '';
      const amount = payload.amount as number | string;
      const submitter = (payload.submitted_by_name as string) || 'sub';
      const lineCount = payload.line_count as number | undefined;
      await dispatchOne('gc', {
        prefKey: 'sub_invoice',
        pushTitle: `Sub invoice · ${fmtMoney(amount)}`,
        pushBody: `${submitter} submitted invoice #${num}`,
        pushData: { projectId, kind: 'sub_invoice', subPortalId, subId: strOrNull(payload.sub_id) ?? undefined },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `New invoice: ${fmtMoney(amount)} from ${submitter}`,
        emailWrap: {
          preheader: `${submitter} submitted invoice #${num} for ${fmtMoney(amount)}.`,
          eyebrow: 'Sub invoice submitted',
          title: `${submitter} sent invoice #${num}`,
          subtitle: 'Review the lines, approve, and mark paid when the wire clears.',
          bodyHtml: emailStatCard(`${emailStatRow('Invoice', `#${escapeHtml(num)}`)}${emailStatRow('From', escapeHtml(submitter))}${lineCount ? emailStatRow('Line items', String(lineCount)) : ''}${emailStatRow('Total due', fmtMoney(amount), { emphasize: true })}`),
          cta: { label: 'Review invoice', href: appLink('sub_invoice_submitted', { project_id: projectId, sub_id: payload.sub_id }) },
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

    case 'client_invoice_paid':
    case 'client_payment_failed':
    case 'field_report_filed':
    case 'pro_response_received':
    case 'safety_incident_filed':
    case 'punch_marked_ready': {
      // #51: one alert per sub sweep — see punchReadyCoalesce.
      const co = event === 'punch_marked_ready' ? await punchReadyCoalesce(gcUserId, projectId, payload) : { quiet: false, more: 0 };
      const text = wave3NotifyText(event, co.more > 0 ? { ...payload, more_count: co.more } : payload, projectName);
      if (!text) break;
      // Screen ids come from the payload (a trusted caller — see
      // SERVICE_ONLY_EVENTS) and go through the shared route table.
      const pushKind = event;
      await dispatchOne('gc', {
        prefKey: text.prefKey,
        pushTitle: text.pushTitle,
        pushBody: text.pushBody,
        pushData: {
          kind: pushKind, projectId,
          invoiceId: payload.invoice_id ?? undefined,
          reportId: payload.report_id ?? undefined,
          itemId: payload.punch_item_id ?? payload.item_id ?? undefined, // punch | pro response
          proKind: payload.kind ?? undefined,
          incidentId: payload.incident_id ?? undefined,
        },
        pushToken: gc.push_token,
        email: gc.email,
        // Mail TO the GC about his own client / crew: no "Sent by <himself>".
        sender: null,
        emailSubject: text.emailSubject,
        quiet: co.quiet,
        emailWrap: {
          preheader: text.pushBody,
          eyebrow: text.eyebrow,
          title: text.title,
          subtitle: text.subtitle,
          bodyHtml: text.rows.length
            ? emailStatCard(text.rows.map(([k, v, em]) => emailStatRow(k, escapeHtml(v), em ? { emphasize: true } : undefined)).join(''))
            : '',
          cta: { label: text.ctaLabel, href: appLink(event, { ...payload, project_id: projectId }) },
        },
      });
      break;
    }

    case 'bid_invite_received':
    case 'lien_waiver_signed':
    case 'prequal_submitted': {
      if (!wave5) break; // unreachable: loadWave5Source ran above
      // What the inbox and daily-digest read later: the server-read facts,
      // replacing anything the trigger sent under the same keys.
      Object.assign(payload, wave5.facts);
      const text = wave5NotifyText(event, wave5.facts, projectCtx.id ? projectCtx.name : null);
      if (!text) break;
      await dispatchOne('gc', {
        prefKey: text.prefKey,
        pushTitle: text.pushTitle,
        pushBody: text.pushBody,
        pushData: { kind: event, projectId: projectId ?? undefined, ...wave5.pushData },
        pushToken: gc.push_token,
        email: gc.email,
        // Mail TO the GC about his sub: no "Sent by <himself>".
        sender: null,
        emailSubject: text.emailSubject,
        emailWrap: {
          preheader: text.pushBody,
          eyebrow: text.eyebrow,
          title: text.title,
          subtitle: text.subtitle,
          bodyHtml: emailStatCard(text.rows.map(([k, v, em]) => emailStatRow(k, escapeHtml(v), em ? { emphasize: true } : undefined)).join('')),
          cta: { label: text.ctaLabel, href: appLink(event, { ...payload, project_id: projectId, package_id: wave5.pushData.packageId, packet_id: wave5.pushData.packetId }) },
        },
      });
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
      const detailUrl = appLink('nearby_rfp_posted', { rfp_id: rfpId });
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
      // To the cent (award_rfp stores round(bid, 2)); a $0 / missing value drops the line.
      const awardedValueText = Number(contractValue) > 0 ? fmtMoneyCents(contractValue) : null;
      // award-rfp forwards the homeowner's email (20260918120000+). The
      // homeowner is told the contractor will send the portal link, so the
      // email says exactly that and names where to send it.
      const homeownerEmail = typeof payload.homeowner_email === 'string' ? payload.homeowner_email.trim() : '';
      // project-detail reads `id`; this link used to send `projectId` and the
      // first tap on "You won the bid" said the project did not exist (#12).
      const newProjectLink = appLink('rfp_awarded', { project_id: newProjectId });
      await dispatchOne('gc', {
        prefKey: 'rfp_awarded',
        pushTitle: `🎉 You won the bid · ${projectName}`,
        pushBody: `The homeowner picked you. Project is set up — open it to publish their portal and send them the link.`,
        pushData: { projectId: newProjectId, kind: 'rfp_awarded' },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${EMOJI.celebrate} You won the bid · ${projectName}`,
        emailWrap: {
          preheader: `Congrats — the homeowner picked you for ${projectName}.`,
          accent: '#1E8E4A',
          eyebrow: 'Bid awarded',
          title: 'You won.',
          subtitle: `The homeowner just awarded ${projectName} to you. We've set up the project in MAGE ID with their address, photos, drawings, scope and the price they accepted. Their email is already on the client-portal invite — open portal setup to publish it and send them the link.`,
          bodyHtml: `
            ${emailHero({ kicker: 'Project awarded', bigText: projectName, subText: awardedValueText ? `${awardedValueText} contract value` : undefined, photoUrl: heroPhoto, accent: '#1E8E4A' })}
            <p style="margin:0 0 12px;"><strong>What's next:</strong> open the project, review what the homeowner posted, then publish their portal and send the link to ${homeownerEmail ? escapeHtml(homeownerEmail) : 'the homeowner'} so they know you're on it.</p>
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
          cta: { label: 'View signed contract', href: appLink('contract_signed', projectData) },
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
          cta: { label: 'View in MAGE ID', href: appLink('selection_chosen', projectData) },
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
      const detailUrl = appLink('bid_question_asked', { rfp_id: rfpId });
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
      const detailUrl = appLink('bid_question_answered', { rfp_id: rfpId });
      // EDGE-F4: a user-JWT caller's bidders were resolved server-side from
      // bid_responses (resolvedBidders); only a service-role caller may ship a
      // list, and it is capped at MAX_RECIPIENTS either way.
      const recipients = resolvedBidders ?? capRecipients<BidderRecipient>(payload.bidder_recipients);
      for (const r of recipients) {
        const pushTok = r.push_token ?? null;
        const em = r.email ?? null;
        if (!em && !pushTok) continue;
        if (pushTok) {
          const badge = badgeFromUnread(await unreadCountFor(r.user_id));
          await sendPush(pushTok, `Answer posted · ${rfpTitle}`, `${question.slice(0, 80)}…`, { rfpId, kind: 'bid_question_answered' }, badge);
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
            cta: { label: 'View binder', href: appLink('closeout_binder_sent', projectData) },
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

    // Invitation to bid. The sub has no account and no app: the email IS the
    // product surface. Without this branch `notify` fell through to `default:`
    // and returned 200 {ok:false, reason:'unknown_event'} — which
    // utils/notifyClient.ts read as success, so the GC was told the invite had
    // been emailed when nothing was ever sent (review 2026-09-10).
    case 'bid_invite_sent': {
      const subEmail = strOrNull(payload.sub_email);
      const inviteUrl = strOrNull(payload.invite_url);
      const pkgName = (payload.package_name as string) || 'this package';
      const scope = typeof payload.scope_description === 'string' ? payload.scope_description : '';
      // The deadline the GC set on the package (utils/bidInvites.ts sends it as
      // `bids_due_at`). Before this branch rendered it, the only date in the
      // email was the link's expiry — a sub who needed three days read thirty.
      const dueLabel = bidDueDayLabel(payload.bids_due_at);
      const csi = (payload.csi_division as string) || '';
      const phase = (payload.phase as string) || '';
      const subName = (payload.sub_name as string) || 'there';
      // No estimate_budget anywhere in this branch, for the same reason
      // bid_invite_get withholds it: the GC's own number in front of the people
      // bidding against it anchors every bid just under it.
      if (!subEmail || !inviteUrl) {
        await sbInsert('notification_outbox', {
          event_type: event, source_table: source_table ?? null, source_id: source_id ?? null,
          recipient_kind: 'sub', recipient_email: subEmail,
          email_status: 'skipped_no_email', payload,
        }).catch(() => {});
        // CONTRACT 8: the GC's "invite emailed" reads result.ok / result.reason
        // (utils/notifyClient.notifyEventDetailed) — nothing went, so say so.
        return { ok: false, reason: 'no_recipient', event };
      }
      const html = wrapEmailHtml({
        // preheader / title / subtitle go in RAW: wrapEmailHtml escapes all
        // three itself, so escaping here too printed "&amp;amp;" for a package
        // called "Doors & Hardware".
        preheader: `${gc.company_name ?? 'A contractor'} is asking you to price ${pkgName} on ${projectName}${dueLabel ? ` — bids due ${dueLabel}` : ''}.`,
        eyebrow: 'Invitation to bid',
        title: `You're invited to bid on ${pkgName}`,
        subtitle: `${String(subName)} — ${gc.company_name ?? 'a contractor'} wants your number on ${projectName}. No account, no app: open the link, read the scope, type your price.`,
        bodyHtml: `
          ${emailStatCard(`${emailStatRow('Package', escapeHtml(pkgName))}${dueLabel ? emailStatRow('Bids due', escapeHtml(dueLabel), { emphasize: true }) : ''}${csi ? emailStatRow('CSI division', escapeHtml(csi)) : ''}${phase ? emailStatRow('Phase', escapeHtml(phase)) : ''}${emailStatRow('Project', escapeHtml(projectName))}`)}
          ${scope.trim() ? `<p style="margin:0 0 14px;"><strong>Scope:</strong><br>${bidScopeHtml(scope)}</p>` : ''}
          <p style="margin:0;color:#9AA3AD;font-size:13px;">This link is yours — anyone who has it can file a bid under your name, so please don't forward it. ${escapeHtml(bidInviteExpiryText(payload.expires_at, Date.now()))}</p>
        `,
        cta: { label: 'Open the invitation', href: inviteUrl },
        companyName: gc.company_name ?? undefined,
        sender: { name: gc.contact_name ?? gc.company_name ?? undefined, email: gc.email ?? undefined, phone: gc.phone ?? undefined },
        project: { name: projectName, location: projectCtx.location },
        unsubscribe: { recipientEmail: subEmail, eventKey: 'bid_invite', enabled: true },
      });
      const r = await sendIfNotSuppressed({
        to: subEmail,
        subject: `Invitation to bid \u00b7 ${pkgName} \u00b7 ${projectName}`,
        html,
        fromCompanyName: gc.company_name ?? undefined,
        replyTo: (payload.reply_to as string) || gc.email || undefined,
        unsubscribe: { recipientEmail: subEmail, eventKey: 'bid_invite', enabled: true },
        eventKey: 'bid_invite',
      });
      await sbInsert('notification_outbox', {
        event_type: event, source_table: source_table ?? null, source_id: source_id ?? null,
        recipient_kind: 'sub', recipient_email: subEmail,
        email_status: r.suppressed ? 'suppressed_unsubscribed' : (r.ok ? 'sent' : 'failed'),
        email_response: r.resp, payload,
        delivered_at: r.ok ? new Date().toISOString() : null,
      }).catch(() => {});
      // CONTRACT 8: a suppressed or failed send is not "emailed" — the app
      // tells the GC to text the link instead (notifyEventDetailed).
      if (!r.ok) return { ok: false, reason: r.suppressed ? 'suppressed_unsubscribed' : 'email_send_failed', event };
      break;
    }

    // Audit round 2, #16: the GC answered in the portal thread. Before this
    // branch nothing told the homeowner — the trigger only fired for client
    // rows — while the preferences page promised a "portal_message" email "when
    // your client or contractor sends a message". Client-bound, so it goes out
    // through sendIfNotSuppressed (the homeowner's unsubscribe, not the GC's
    // notification preferences, decides) and is logged recipient_kind 'client'.
    case 'portal_reply': {
      const outboxBase = { event_type: event, source_table: source_table ?? null, source_id: source_id ?? null, recipient_kind: 'client', payload };
      if (payload.author_type !== 'gc' || !effectivePortalId || !projectCtx.viaPortal) {
        await sbInsert('notification_outbox', { ...outboxBase, email_status: 'skipped_not_gc_reply' }).catch(() => {});
        break;
      }
      // Cross-tenant lock: notify resolves the project PORTAL-first, so a row
      // filed under the author's project but naming another contractor's
      // portal would email THAT contractor's homeowner, in his name. The row's
      // own project must be the project that owns the portal. (The migration's
      // RLS and trigger refuse this too; this is the last of three locks.)
      if (!projectCtx.id || uuidOrNull(payload.project_id)?.toLowerCase() !== projectCtx.id.toLowerCase()) {
        await sbInsert('notification_outbox', { ...outboxBase, email_status: 'skipped_portal_mismatch' }).catch(() => {});
        break;
      }
      // A person's reply only. System notices (no author_name) are not emailed
      // until the portal snapshot republishes with the send/recall (#23, #44).
      if (!strOrNull(payload.author_name)) {
        await sbInsert('notification_outbox', { ...outboxBase, email_status: 'skipped_system_notice' }).catch(() => {});
        break;
      }
      // No live portal link, no email: a reply they cannot open is worse than none.
      // Never-published is logged apart from ended/missing so the outbox says why.
      if (!portalUrl) {
        await sbInsert('notification_outbox', { ...outboxBase, email_status: portalUnpublished ? 'skipped_portal_unpublished' : 'skipped_portal_unavailable' }).catch(() => {});
        break;
      }
      // Neutral wording ("sent you a message"), kept from when system notices
      // also came through here.
      const body = portalBodyForEmail(typeof payload.body === 'string' ? payload.body : '');
      const trimmed = body.length > 600 ? body.slice(0, 600) + '…' : body;
      const company = gc.company_name || gc.contact_name || 'Your contractor';
      let lastClientInvite: string | null = null;
      try {
        const rows = await sbGet(`portal_messages?portal_id=eq.${encodeURIComponent(effectivePortalId)}&author_type=eq.client&select=invite_id&order=created_at.desc&limit=1`) as { invite_id: string | null }[];
        lastClientInvite = strOrNull(rows[0]?.invite_id);
      } catch { lastClientInvite = null; }
      const cp = (projectCtx.client_portal ?? {}) as { invites?: unknown };
      const recipients = replyRecipients(cp.invites, lastClientInvite);
      if (recipients.length === 0) {
        await sbInsert('notification_outbox', { ...outboxBase, email_status: 'skipped_no_email' }).catch(() => {});
        break;
      }
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      for (const rc of recipients) {
        // Batch a burst of replies: if this address was already emailed about
        // this portal in the last 15 minutes and that message is still unread
        // in the portal, the earlier email already brings them to this one.
        try {
          const prior = await sbGet(`notification_outbox?event_type=eq.portal_reply&email_status=eq.sent&recipient_email=eq.${encodeURIComponent(rc.email)}&payload->>portal_id=eq.${encodeURIComponent(effectivePortalId)}&created_at=gte.${encodeURIComponent(since)}&select=source_id&order=created_at.desc&limit=1`) as { source_id: string | null }[];
          const priorMsg = uuidOrNull(prior[0]?.source_id);
          if (priorMsg) {
            const m = await sbGet(`portal_messages?id=eq.${priorMsg}&select=read_by_client&limit=1`) as { read_by_client: boolean | null }[];
            if (m[0] && m[0].read_by_client !== true) {
              await sbInsert('notification_outbox', { ...outboxBase, recipient_email: rc.email, email_status: 'batched_unread' }).catch(() => {});
              continue;
            }
          }
        } catch { /* a failed batching read sends rather than drops */ }
        // Sender-side cap, charged per recipient (post-ship review): he writes
        // both the text and the invite list, and the 15-minute batching above
        // is per recipient and resettable, so it is not a throttle. Over either
        // cap the message stays in the portal and is logged; only the email is
        // held back.
        if (
          await exceedsRateLimit(`notify:portal_reply:${gcUserId}`, PORTAL_REPLY_HOURLY_CAP)
          || await exceedsRateLimit('notify:portal_reply:global', PORTAL_REPLY_GLOBAL_HOURLY_CAP)
        ) {
          await sbInsert('notification_outbox', { ...outboxBase, recipient_email: rc.email, email_status: 'rate_limited' }).catch(() => {});
          continue;
        }
        const unsubscribe: UnsubscribeOpts = { recipientEmail: rc.email, eventKey: 'portal_message', enabled: true };
        const html = wrapEmailHtml({
          preheader: `${company}: ${body.slice(0, 100)}`,
          eyebrow: 'New message in your portal',
          title: `${rc.name ? `Hi ${rc.name.split(' ')[0]} — ` : ''}new message from ${company}`,
          subtitle: `About ${projectName}. Reply in your portal so the answer stays with the project.`,
          bodyHtml: emailQuote(trimmed),
          cta: { label: 'Read and reply in your portal', href: portalUrl },
          companyName: gc.company_name ?? undefined,
          sender: { name: gc.contact_name ?? gc.company_name ?? undefined, email: gc.email ?? undefined, phone: gc.phone ?? undefined },
          project: { name: projectName, location: projectCtx.location },
          unsubscribe,
        });
        const r = await sendIfNotSuppressed({
          to: rc.email,
          subject: `${company} sent you a message · ${projectName}`,
          html,
          fromCompanyName: gc.company_name ?? undefined,
          replyTo: gc.email ?? undefined,
          unsubscribe,
          eventKey: 'portal_message',
        });
        await sbInsert('notification_outbox', {
          ...outboxBase,
          recipient_email: rc.email,
          email_status: r.suppressed ? 'suppressed_unsubscribed' : (r.ok ? 'sent' : 'failed'),
          email_response: r.resp,
          delivered_at: r.ok ? new Date().toISOString() : null,
        }).catch(() => {});
      }
      break;
    }

    // Audit round 2, #9: a homeowner asked for a price on the GC's website (the
    // quote form or the Instant Estimate widget). Raised by the AFTER INSERT
    // trigger on leads for service-written website leads only, so a lead he
    // typed in himself never pings him. The first callback usually wins the
    // job, so the push carries what he needs to call back from the lock screen.
    case 'lead_received': {
      const leadId = uuidOrNull(payload.lead_id);
      const who = strOrNull(payload.name) ?? 'A homeowner';
      const phone = strOrNull(payload.phone);
      const leadEmail = strOrNull(payload.email);
      const validLeadEmail = leadEmail && /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(leadEmail) ? leadEmail : null;
      const kind = strOrNull(payload.project_type) ?? 'a project';
      const saw = widgetBallparkText(payload.scope);
      const stated = [fmtMoneyCents(payload.budget_min), fmtMoneyCents(payload.budget_max)];
      const budget = stated[0] && stated[1] ? `${stated[0]}\u2013${stated[1]}` : (stated[0] ?? stated[1]);
      const ownWords = scopeWithoutBallpark(payload.scope);
      const fromWidget = isWidgetScope(payload.scope);
      // Per-GC cap. The trigger fires for every service-written website lead,
      // and both public endpoints are anonymous, so a flood against one GC
      // must not become a flood of lock-screen pushes. Over the cap the lead
      // is still in his pipeline and still logged here (so it reaches the
      // inbox); only the push and email are held back.
      if (await exceedsRateLimit(`notify:lead:${gcUserId}`, LEAD_NOTIFY_HOURLY_CAP)) {
        await sbInsert('notification_outbox', {
          event_type: event, source_table: source_table ?? null, source_id: source_id ?? null,
          recipient_kind: 'gc', recipient_user_id: gcUserId, recipient_email: gc.email ?? null,
          push_status: 'rate_limited', email_status: 'rate_limited', payload,
        }).catch(() => {});
        break;
      }
      await dispatchOne('gc', {
        prefKey: 'lead_received',
        pushTitle: `New website lead · ${kind}`,
        pushBody: [who, saw ? `saw ${saw}` : null, budget ? `budget ${budget}` : null, phone].filter(Boolean).join(' · '),
        pushData: { kind: 'lead_received', leadId: leadId ?? undefined },
        pushToken: gc.push_token,
        email: gc.email,
        // The mail is TO him ABOUT the homeowner: the footer names the lead
        // (not "Sent by <his own company>") and Reply reaches the homeowner
        // when they left an email — the daily-digest mistake of 2026-09-08.
        // The footer line ends "Replies go to them, not us." — true only when
        // reply_to is set. With no usable lead email, Reply goes to
        // noreply@, so the footer drops the sender line entirely (null) —
        // the stat card above already shows the lead's name and phone.
        sender: validLeadEmail ? { name: who, email: validLeadEmail, phone: phone ?? undefined } : null,
        // Only a well-formed address: Resend refuses the whole send on a bad
        // reply_to, and a typo'd lead email must not cost him the lead alert.
        replyTo: validLeadEmail ?? undefined,
        emailSubject: `New website lead · ${kind} · ${who}`,
        emailWrap: {
          preheader: `${who} asked about ${kind}${saw ? ` after seeing ${saw}` : ''}. Call back tonight.`,
          eyebrow: 'New website lead',
          title: `${who} wants a price`,
          subtitle: saw
            ? `Your Instant Estimate widget showed them ${saw} — a published national range, not your price. They are waiting for a real number.`
            : 'Most homeowners ask two or three contractors. The first one to call back usually gets the site visit.',
          bodyHtml: `${emailStatCard([
            emailStatRow('Name', escapeHtml(who)),
            emailStatRow('Project', escapeHtml(kind)),
            phone ? emailStatRow('Phone', escapeHtml(phone), { emphasize: true }) : '',
            leadEmail ? emailStatRow('Email', escapeHtml(leadEmail)) : '',
            saw ? emailStatRow('Widget range shown', escapeHtml(saw)) : '',
            budget ? emailStatRow('Their budget', escapeHtml(budget)) : '',
            // The widget builds its scope from the form fields, so it is shown
            // as request details, not quoted as if the homeowner wrote it.
            fromWidget && ownWords ? emailStatRow('Request details', escapeHtml(ownWords.length > 400 ? ownWords.slice(0, 400) + '…' : ownWords)) : '',
          ].join(''))}${!fromWidget && ownWords ? emailQuote(ownWords.length > 400 ? ownWords.slice(0, 400) + '…' : ownWords) : ''}`,
          cta: { label: 'Open the lead', href: appLink('lead_received', { lead_id: leadId }) },
          secondaryCta: phone ? { label: `Call ${phone}`, href: `tel:${phone.replace(/[^\d+]/g, '')}` } : undefined,
        },
      });
      break;
    }

    default:
      return { ok: false, reason: 'unknown_event', event };
  }

  return { ok: true, event, gc: gcUserId, delivered: deliveredAny };
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
