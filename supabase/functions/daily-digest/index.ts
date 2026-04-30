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
//   - "Quiet day" message if nothing happened — we still send so the user
//     trusts the cadence (but only on weekdays — silence on weekends)
//
// Why opt-in: instant emails already cover every event. The digest is for
// GCs who want a daily wrap-up they can scan before bed / in the morning.
// Default OFF to avoid adding to the noise.
//
// The function is idempotent on a per-user, per-day basis: it queries the
// notification_outbox for an existing 'daily_digest_sent' event today and
// skips if found. So re-running the cron doesn't duplicate sends.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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

  const isQuiet = totalEvents === 0;

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

  const bodyHtml = isQuiet
    ? `<p style="margin:0;">No events to report — quiet day on the jobs. Tomorrow's recap will land at the same time.</p>`
    : `
      ${statCardHtml}
      ${tilesHtml ? `<p style="margin:18px 0 6px;font-weight:700;color:#0B0D10;">Most active</p>${tilesHtml}` : ''}
      ${emailDivider()}
      <p style="margin:0;color:#4A5159;font-size:13px;">This recap is built from the events that hit your notification feed in the last 24 hours. Open MAGE ID to see everything in context.</p>
    `;

  return wrapEmailHtml({
    preheader: isQuiet
      ? `${date} · Quiet day. No new activity.`
      : `${date} · ${totalEvents} update${totalEvents === 1 ? '' : 's'} across your projects.`,
    eyebrow: 'Daily digest',
    title: isQuiet ? 'Quiet day.' : `${totalEvents} update${totalEvents === 1 ? '' : 's'} today`,
    subtitle: `${date} — your once-a-day recap of activity across your jobs.`,
    bodyHtml,
    cta: isQuiet ? undefined : { label: 'Open MAGE ID', href: APP_BASE },
    companyName: companyName ?? undefined,
    sender: { name: contactName ?? companyName ?? undefined, email, phone: phone ?? undefined },
    unsubscribe: { recipientEmail: email, eventKey: 'daily_digest', enabled: true },
  });
}

async function processGc(gc: ProfileRow): Promise<{ id: string; status: 'sent' | 'skipped_already' | 'skipped_no_email' | 'failed'; reason?: string }> {
  if (!gc.email) return { id: gc.id, status: 'skipped_no_email' };
  if (await alreadySentToday(gc.id)) return { id: gc.id, status: 'skipped_already' };

  const outbox = await getOutboxLast24h(gc.id).catch(() => [] as OutboxRow[]);
  const groups = groupEvents(outbox);
  const totalEvents = groups.reduce((s, g) => s + g.count, 0);

  // Suppress quiet-day digests on weekends so we don't ping users with
  // "nothing happened" on Sunday morning. Mon-Fri quiet days still send
  // because the cadence reassurance is valuable mid-week.
  const dayOfWeek = new Date().getUTCDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (totalEvents === 0 && isWeekend) {
    return { id: gc.id, status: 'skipped_already', reason: 'quiet_weekend' };
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

  const subject = totalEvents > 0
    ? `Daily digest · ${totalEvents} update${totalEvents === 1 ? '' : 's'} on your jobs`
    : `Daily digest · Quiet day on your jobs`;

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

    return jsonResponse({ ok: true, ...summary, results });
  } catch (e) {
    console.error('[daily-digest] crash', e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
