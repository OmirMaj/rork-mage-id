// daily-digest
//
// Sends a once-per-day summary email to every GC who has opted in via
// notification_preferences.daily_digest.email = true. Cron-driven via
// pg_cron + pg_net (see migration: schedule_daily_digest.sql).
//
// What's in the digest:
//   - Header counts of activity in the last 24h (messages, COs, invoices,
//     selections, etc.)
//   - Top 5 active projects by event count, each with their latest event
//   - NOTHING when there is nothing. A digest with no events is not sent at
//     all; see the note in processGc for why the old weekday "Quiet day."
//     send was removed.
//
// Why opt-in: instant emails already cover every event. The digest is for
// GCs who want a daily wrap-up they can scan before bed / in the morning.
// Default OFF to avoid adding to the noise.
//
// The function is idempotent on a per-user, per-day basis: it queries the
// notification_outbox for an existing 'daily_digest_sent' event today and
// skips if found. So re-running the cron doesn't duplicate sends.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { isValidCron } from "../_shared/cronAuth.ts";
import {
  wrapEmailHtml,
  emailStatCard,
  emailStatRow,
  emailDivider,
  resendSend,
  fmtMoney,
  escapeHtml,
} from "../_shared/email.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";

const APP_BASE = "https://app.mageid.app";

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

interface ProfileRow {
  id: string;
  email: string | null;
  contact_name: string | null;
  company_name: string | null;
  phone: string | null;
  notification_preferences: Record<string, { push?: boolean; email?: boolean }> | null;
}

interface OutboxRow {
  event_type: string;
  recipient_user_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

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
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// Fetch every GC profile that has explicitly opted into the digest.
// notification_preferences.daily_digest.email must be the literal `true`
// (not undefined / not false). Default behavior is OFF so we don't add
// to inbox volume without consent.
async function getOptedInGcs(): Promise<ProfileRow[]> {
  // PostgREST: filter on a JSONB key. Use the `->>` text accessor and
  // compare to 'true'.
  const url = `profiles?notification_preferences->daily_digest->>email=eq.true&email=not.is.null&select=id,email,contact_name,company_name,phone,notification_preferences`;
  const rows = await sbGet(url) as ProfileRow[];
  return rows ?? [];
}

// Fetch the user's notification_outbox rows from the last 24h.
async function getOutboxLast24h(userId: string): Promise<OutboxRow[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `notification_outbox?recipient_user_id=eq.${userId}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=200&select=event_type,recipient_user_id,payload,created_at`;
  const rows = await sbGet(url) as OutboxRow[];
  return rows ?? [];
}

// Has this GC already received today's digest? Idempotency guard for
// cron retries / accidental double-fires. We log a 'daily_digest_sent'
// row in notification_outbox after each successful send.
async function alreadySentToday(userId: string): Promise<boolean> {
  const sinceMidnight = new Date();
  sinceMidnight.setUTCHours(0, 0, 0, 0);
  const url = `notification_outbox?recipient_user_id=eq.${userId}&event_type=eq.daily_digest_sent&created_at=gte.${encodeURIComponent(sinceMidnight.toISOString())}&select=id&limit=1`;
  try {
    const rows = await sbGet(url) as { id: string }[];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

interface EventGroup {
  /** Event prefs key, doubles as the human label key. */
  key: string;
  count: number;
  latestPayload: Record<string, unknown> | null;
  latestAt: string;
}

const EVENT_LABELS: Record<string, { label: string; emoji?: string; cta?: string }> = {
  portal_message:        { label: 'Client messages',     cta: 'client-messages' },
  budget_proposal:       { label: 'Budget proposals',    cta: 'project-detail' },
  co_approval:           { label: 'Change-order decisions', cta: 'change-order' },
  contract_signed:       { label: 'Contracts signed',    cta: 'contract' },
  selection_chosen:      { label: 'Selections picked',   cta: 'selections' },
  sub_invoice_submitted: { label: 'Sub invoices in',     cta: 'sub-portals' },
  sub_invoice_reviewed:  { label: 'Sub invoices acted on', cta: 'sub-portals' },
  nearby_rfp_posted:     { label: 'New nearby RFPs',     cta: 'rfp-detail' },
  rfp_awarded:           { label: 'RFPs awarded',        cta: 'project-detail' },
  bid_question_asked:    { label: 'Bid questions',       cta: 'rfp-detail' },
  bid_question_answered: { label: 'Bid Q&A answered',    cta: 'rfp-detail' },
  closeout_binder_sent:  { label: 'Closeouts delivered', cta: 'closeout-binder' },
};

function groupEvents(rows: OutboxRow[]): EventGroup[] {
  const map = new Map<string, EventGroup>();
  for (const r of rows) {
    if (!r.event_type || !EVENT_LABELS[r.event_type]) continue;
    const existing = map.get(r.event_type);
    if (existing) {
      existing.count += 1;
      if (r.created_at > existing.latestAt) {
        existing.latestAt = r.created_at;
        existing.latestPayload = r.payload;
      }
    } else {
      map.set(r.event_type, {
        key: r.event_type,
        count: 1,
        latestPayload: r.payload,
        latestAt: r.created_at,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function buildDigestEmail(opts: {
  contactName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string;
  groups: EventGroup[];
  totalEvents: number;
  date: string;
}): string {
  const { contactName, companyName, phone, email, groups, totalEvents, date } = opts;

  // Build the activity stat card
  const statRows = groups.map(g => {
    const meta = EVENT_LABELS[g.key];
    return emailStatRow(meta?.label ?? g.key, String(g.count));
  }).join('');

  const statCardHtml = totalEvents > 0
    ? emailStatCard(statRows + emailStatRow('Total updates', String(totalEvents), { emphasize: true }))
    : '';

  // No quiet-day branch. processGc returns before it ever reaches this
  // function when totalEvents is 0, and leaving a rendered "Quiet day." here
  // would be a working empty-digest template one `if` away from shipping again.
  // Build per-event-type tiles for the top groups (max 4) so the digest
  // includes a glance at WHAT happened, not just a count.
  const tilesHtml = groups.slice(0, 4).map(g => {
    const meta = EVENT_LABELS[g.key];
    const projectName = (g.latestPayload?.project_name as string)
      || (g.latestPayload?.title as string)
      || '';
    const detail =
      g.key === 'portal_message'        ? `${(g.latestPayload?.author_name as string) || 'A client'} sent a message`
      : g.key === 'budget_proposal'     ? `Budget proposed: ${fmtMoney((g.latestPayload?.amount as number) ?? 0)}`
      : g.key === 'co_approval'         ? `${(g.latestPayload?.signer_name as string) || 'Client'} ${(g.latestPayload?.decision as string) || 'acted on'} a CO`
      : g.key === 'contract_signed'     ? `${(g.latestPayload?.signer_name as string) || 'Client'} signed`
      : g.key === 'selection_chosen'    ? `${(g.latestPayload?.product_name as string) || 'A selection'} picked`
      : g.key === 'sub_invoice_submitted' ? `${fmtMoney((g.latestPayload?.amount as number) ?? 0)} from ${(g.latestPayload?.submitted_by_name as string) || 'a sub'}`
      : g.key === 'rfp_awarded'         ? `Won: ${projectName}`
      : g.key === 'nearby_rfp_posted'   ? `${projectName}`
      : '';

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;background:#FAFAF7;border:1px solid #E8DFCD;border-radius:12px;">
        <tr><td style="padding:14px 18px;">
          <p style="margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;font-weight:800;color:#FF6A1A;letter-spacing:1.2px;text-transform:uppercase;">${escapeHtml(meta?.label ?? g.key)}${g.count > 1 ? ` · ${g.count} today` : ''}</p>
          <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;color:#0B0D10;line-height:1.4;">${escapeHtml(detail || (projectName || 'Activity logged'))}</p>
          ${projectName && projectName !== detail ? `<p style="margin:2px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9AA3AD;">${escapeHtml(projectName)}</p>` : ''}
        </td></tr>
      </table>`;
  }).join('');

  const bodyHtml = `
      ${statCardHtml}
      ${tilesHtml ? `<p style="margin:18px 0 6px;font-weight:700;color:#0B0D10;">Most active</p>${tilesHtml}` : ''}
      ${emailDivider()}
      <p style="margin:0;color:#4A5159;font-size:13px;">This recap covers the client- and sub-facing activity that reached your notification feed in the last 24 hours. Your schedule, RFIs and field reports are in the morning briefing.</p>
    `;

  return wrapEmailHtml({
    preheader: `${date} · ${totalEvents} update${totalEvents === 1 ? '' : 's'} across your projects.`,
    eyebrow: 'Daily digest',
    title: `${totalEvents} update${totalEvents === 1 ? '' : 's'} today`,
    subtitle: `${date} — client and sub activity across your jobs.`,
    bodyHtml,
    cta: { label: 'Open MAGE ID', href: APP_BASE },
    companyName: companyName ?? undefined,
    // No `sender` block. That footer renders "Sent by <name> · <email> ·
    // <phone>. Replies go to them, not us." — copy written for a HOMEOWNER
    // receiving a contractor's email, so they know who to reply to. This digest
    // goes to the GC himself, so it printed his own name, his own address and
    // his own phone number back at him and told him replies would reach
    // himself. Reported from a real inbox, 2026-09-08.
    unsubscribe: { recipientEmail: email, eventKey: 'daily_digest', enabled: true },
  });
}

async function processGc(gc: ProfileRow): Promise<{ id: string; status: 'sent' | 'skipped_already' | 'skipped_no_email' | 'failed'; reason?: string }> {
  if (!gc.email) return { id: gc.id, status: 'skipped_no_email' };
  if (await alreadySentToday(gc.id)) return { id: gc.id, status: 'skipped_already' };

  const outbox = await getOutboxLast24h(gc.id).catch(() => [] as OutboxRow[]);
  const groups = groupEvents(outbox);
  const totalEvents = groups.reduce((s, g) => s + g.count, 0);

  // A digest with nothing in it does not get sent. Full stop.
  //
  // This used to send on weekdays with the body "No events to report — quiet
  // day on the jobs", on the theory that the cadence itself was reassuring and
  // only weekends deserved silence. A real inbox falsified that on 2026-09-08:
  // a giant serif "Quiet day." over one sentence of nothing, which reads as a
  // broken template, not as reassurance. And the cost is not neutral — a
  // recurring email that is empty most days teaches the reader to archive the
  // subject line on sight, so the mornings that DO carry an unanswered client
  // message or a signed change order get archived with them. The cadence the
  // quiet send was protecting is the thing it was destroying.
  //
  // Note what "nothing" means here, because it is narrower than it sounds: this
  // digest is built ONLY from notification_outbox — portal messages, CO
  // approvals, budget proposals, sub invoices, RFP awards. Schedule, RFIs,
  // DFRs and weather belong to the sibling morning-digest function, which does
  // query them. So "no events" means "nothing hit the notification feed", not
  // "nothing happened on the jobs" — one more reason not to assert a quiet day
  // in the reader's inbox.
  if (totalEvents === 0) {
    return { id: gc.id, status: 'skipped_already', reason: 'no_events' };
  }

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const html = buildDigestEmail({
    contactName: gc.contact_name,
    companyName: gc.company_name,
    phone: gc.phone,
    email: gc.email,
    groups,
    totalEvents,
    date,
  });

  // totalEvents is always > 0 here — processGc returned above otherwise.
  const subject = `Daily digest · ${totalEvents} update${totalEvents === 1 ? '' : 's'} on your jobs`;

  const r = await resendSend(RESEND_API_KEY, {
    to: gc.email,
    subject,
    html,
    fromCompanyName: gc.company_name ?? undefined,
    unsubscribe: { recipientEmail: gc.email, eventKey: 'daily_digest', enabled: true },
  });

  // Log the send attempt + idempotency marker.
  await sbInsert('notification_outbox', {
    event_type: 'daily_digest_sent',
    source_table: null,
    source_id: null,
    recipient_kind: 'gc',
    recipient_user_id: gc.id,
    recipient_email: gc.email,
    email_status: r.ok ? 'sent' : 'failed',
    email_response: r.resp,
    payload: { total_events: totalEvents, group_count: groups.length },
    delivered_at: r.ok ? new Date().toISOString() : null,
  });

  return r.ok
    ? { id: gc.id, status: 'sent' }
    : { id: gc.id, status: 'failed', reason: JSON.stringify(r.resp).slice(0, 200) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (!(await isValidCron(req))) return jsonResponse({ success: false, error: "unauthorized" }, 401);
  if (req.method !== "POST") return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    const gcs = await getOptedInGcs();
    if (gcs.length === 0) {
      return jsonResponse({ ok: true, processed: 0, message: 'no opted-in users' });
    }

    // Sequential processing — at this scale (~tens of users opted in)
    // there's no benefit to parallelism, and serial keeps Resend rate
    // limits / DB pressure predictable.
    const results: Awaited<ReturnType<typeof processGc>>[] = [];
    for (const gc of gcs) {
      try {
        const r = await processGc(gc);
        results.push(r);
      } catch (e) {
        results.push({ id: gc.id, status: 'failed', reason: String(e).slice(0, 200) });
      }
    }

    const summary = {
      total: gcs.length,
      sent: results.filter(r => r.status === 'sent').length,
      skipped_already: results.filter(r => r.status === 'skipped_already').length,
      skipped_no_email: results.filter(r => r.status === 'skipped_no_email').length,
      failed: results.filter(r => r.status === 'failed').length,
    };
    console.log('[daily-digest] run complete', summary);

    // Heartbeat: ping BetterStack so its uptime monitor confirms this
    // cron actually ran. If it doesn't see a ping within 24h + 1h
    // grace, BetterStack alerts. Best-effort — never block the response
    // on the heartbeat call.
    const heartbeatUrl = Deno.env.get('BETTERSTACK_HEARTBEAT_DAILY_DIGEST');
    if (heartbeatUrl) {
      await fetch(heartbeatUrl).catch(() => {});
    }

    return jsonResponse({ ok: true, ...summary, results });
  } catch (e) {
    console.error('[daily-digest] crash', e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
