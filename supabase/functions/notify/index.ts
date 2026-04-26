// notify
//
// Single dispatcher for every push + email notification in MAGE ID. Called
// from AFTER INSERT triggers via pg_net (and optionally directly from the
// app for re-sends). Handles fan-out to:
//   - Expo Push (for the GC, when we have a push_token in profiles)
//   - Resend (for everyone — always sent unless the user opts out)
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
//     'sub_invoice_reviewed'       — GC → sub (optional, future)
//     'gc_message'                 — GC → client (optional, future)
//   source_table, source_id        — for outbox dedup + back-reference
//   payload                        — the row that triggered the event,
//                                    plus anything the trigger wants to
//                                    pass through (project_name, etc.)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
// Supabase auto-injects SUPABASE_SERVICE_ROLE_KEY into every edge function
// runtime. Fall back to a manually set SERVICE_ROLE_KEY if someone prefers
// that name in their secrets.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const PORTAL_BASE = "https://mageid.app/portal";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_FROM = 'MAGE ID <noreply@mageid.app>';

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

async function sbInsert(table: string, body: unknown): Promise<unknown> {
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

async function getProjectName(projectId: string): Promise<string> {
  try {
    const rows = await sbGet(`projects?id=eq.${projectId}&select=name`) as { name: string }[];
    return rows[0]?.name ?? 'your project';
  } catch { return 'your project'; }
}

// ─── Preference check ─────────────────────────────────────────────────
// Per-event opt-in flags. Default ON if the user hasn't set anything.
function prefAllows(prefs: Record<string, unknown> | null | undefined, key: string, channel: 'push' | 'email'): boolean {
  if (!prefs) return true;
  const evt = (prefs as Record<string, Record<string, unknown>>)[key];
  if (!evt) return true;
  const v = (evt as Record<string, unknown>)[channel];
  if (v === false) return false;
  return true;
}

// ─── Senders ──────────────────────────────────────────────────────────
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
        // Auto-bump the iOS badge by 1; the app calls clearBadge on focus.
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

async function sendEmail(opts: { to: string; subject: string; html: string; replyTo?: string }): Promise<{ ok: boolean; resp?: unknown }> {
  if (!RESEND_API_KEY) return { ok: false, resp: { error: 'no key' } };
  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: DEFAULT_FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        reply_to: opts.replyTo,
      }),
    });
    const resp = await r.json().catch(() => ({}));
    return { ok: r.ok, resp };
  } catch (e) {
    return { ok: false, resp: { error: String(e) } };
  }
}

// ─── Email template (lightweight inlined version of emailLayout) ────
// We can't import the app's emailLayout from here, so we inline a tiny
// version that produces the same look. Keep it small — Outlook does what
// Outlook does.
function wrapHtml(opts: { title: string; eyebrow?: string; bodyHtml: string; cta?: { label: string; href: string } }): string {
  const ctaHtml = opts.cta
    ? `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:24px 0 8px"><tr><td bgcolor="#FF6A1A" style="border-radius:10px;"><a href="${opts.cta.href}" target="_blank" style="display:inline-block;padding:14px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${opts.cta.label}</a></td></tr></table>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0B0D10;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#F4EFE6;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;background:#FFFFFF;border-radius:18px;border:1px solid #E8DFCD;overflow:hidden;">
      <tr><td style="padding:32px 36px 8px;">
        <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#0B0D10;color:#FF6A1A;font-weight:700;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;">${opts.eyebrow ?? 'MAGE ID'}</div>
      </td></tr>
      <tr><td style="padding:8px 36px 28px;">
        <h1 style="font-family:Georgia,serif;font-size:28px;line-height:1.18;font-weight:700;letter-spacing:-0.02em;margin:0 0 16px;">${opts.title}</h1>
        <div style="font-size:15px;line-height:1.6;color:#4A5159;">${opts.bodyHtml}</div>
        ${ctaHtml}
      </td></tr>
      <tr><td style="padding:18px 36px 28px;border-top:1px solid #F1EAD9;font-size:12px;color:#8B9099;">
        Sent automatically by MAGE ID. <a href="https://mageid.app" style="color:#0B0D10;text-decoration:none;font-weight:600;">mageid.app</a>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function esc(s: string | undefined | null): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function fmtMoney(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(v)) return '—';
  return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ─── Event dispatch ───────────────────────────────────────────────────
async function dispatch(req: NotifyRequest): Promise<unknown> {
  const { event, source_table, source_id, payload } = req;
  const portalId = (payload.portal_id as string) ?? (payload.portalId as string) ?? null;
  const subPortalId = (payload.sub_portal_id as string) ?? null;

  // Find the GC owner. Direct projects.user_id when we already know the
  // project, else look up via gc_for_portal / gc_for_sub_portal.
  let gcUserId: string | null = (payload.gc_user_id as string) ?? null;
  let projectId: string | null = (payload.project_id as string) ?? null;

  if (!gcUserId && portalId) {
    const rows = await sbGet(`rpc/gc_for_portal?p_portal_id=${encodeURIComponent(portalId)}`).catch(() => null);
    if (typeof rows === 'string') gcUserId = rows;
  }
  if (!gcUserId && subPortalId) {
    const rows = await sbGet(`rpc/gc_for_sub_portal?p_portal_id=${encodeURIComponent(subPortalId)}`).catch(() => null);
    if (typeof rows === 'string') gcUserId = rows;
  }
  if (!gcUserId) {
    // Last resort: read project owner directly.
    if (projectId) {
      const rows = await sbGet(`projects?id=eq.${projectId}&select=user_id`) as { user_id: string }[];
      gcUserId = rows[0]?.user_id ?? null;
    }
  }

  if (!gcUserId) {
    return { ok: false, reason: 'no_gc_resolved', event };
  }

  const gc = await getProfile(gcUserId);
  if (!gc) return { ok: false, reason: 'no_gc_profile' };

  const projectName = projectId ? await getProjectName(projectId) : ((payload.project_name as string) || 'your project');
  const portalLink = portalId ? `${PORTAL_BASE}/${portalId}` : 'https://app.mageid.app';

  const dispatchOne = async (kind: 'gc' | 'client' | 'sub', spec: {
    title: string;
    body: string;
    emailSubject: string;
    emailHtml: string;
    pushData?: Record<string, unknown>;
    pushToken?: string | null;
    email?: string | null;
    replyTo?: string;
    prefKey: string;
  }) => {
    let pushStatus: string | null = null;
    let pushResp: unknown = null;
    let emailStatus: string | null = null;
    let emailResp: unknown = null;

    const allowPush = kind === 'gc' && prefAllows(gc.notification_preferences, spec.prefKey, 'push');
    const allowEmail = prefAllows(gc.notification_preferences, spec.prefKey, 'email');

    if (allowPush && spec.pushToken) {
      const r = await sendPush(spec.pushToken, spec.title, spec.body, spec.pushData);
      pushStatus = r.ok ? 'sent' : 'failed';
      pushResp = r.resp;
    }
    if (allowEmail && spec.email) {
      const r = await sendEmail({ to: spec.email, subject: spec.emailSubject, html: spec.emailHtml, replyTo: spec.replyTo });
      emailStatus = r.ok ? 'sent' : 'failed';
      emailResp = r.resp;
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

  // ─── Per-event branches ───
  switch (event) {
    case 'portal_message': {
      // Client sent the GC a portal message
      const body = (payload.body as string) ?? '';
      const author = (payload.author_name as string) || 'your client';
      await dispatchOne('gc', {
        prefKey: 'portal_message',
        title: `New message · ${projectName}`,
        body: `${author}: ${body.slice(0, 140)}`,
        pushData: { projectId, portalId, kind: 'portal_message' },
        pushToken: gc.push_token,
        email: gc.email,
        replyTo: undefined,
        emailSubject: `New message from ${author} — ${projectName}`,
        emailHtml: wrapHtml({
          eyebrow: 'New portal message',
          title: `${esc(author)} sent you a message`,
          bodyHtml: `<p style="margin:0 0 14px"><strong>Project:</strong> ${esc(projectName)}</p><blockquote style="margin:0;padding:14px 16px;background:#F4EFE6;border-left:3px solid #FF6A1A;border-radius:6px;font-style:italic;">${esc(body)}</blockquote>`,
          cta: { label: 'Open MAGE ID', href: 'https://app.mageid.app' },
        }),
      });
      break;
    }
    case 'budget_proposal': {
      const amount = payload.amount as number | string;
      const proposer = (payload.proposer_name as string) || 'your client';
      const note = (payload.note as string) || '';
      await dispatchOne('gc', {
        prefKey: 'budget_proposal',
        title: `Budget proposed · ${projectName}`,
        body: `${proposer}: ${fmtMoney(amount)}`,
        pushData: { projectId, portalId, kind: 'budget_proposal' },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${proposer} proposed a budget — ${projectName}`,
        emailHtml: wrapHtml({
          eyebrow: 'Budget proposal',
          title: `${esc(proposer)} suggested ${esc(fmtMoney(amount))} as a target budget`,
          bodyHtml: `<p style="margin:0 0 14px"><strong>Project:</strong> ${esc(projectName)}</p>${note ? `<blockquote style="margin:0 0 14px;padding:14px 16px;background:#F4EFE6;border-left:3px solid #FF6A1A;border-radius:6px;font-style:italic;">${esc(note)}</blockquote>` : ''}<p style="margin:0">Open the client portal setup to accept it as the project's target budget, or message back to negotiate.</p>`,
          cta: { label: 'Review in MAGE ID', href: 'https://app.mageid.app' },
        }),
      });
      break;
    }
    case 'co_approval': {
      const decision = (payload.decision as string) ?? 'approved';
      const signerName = (payload.signer_name as string) || 'your client';
      const coId = (payload.change_order_id as string) || '';
      await dispatchOne('gc', {
        prefKey: 'co_approval',
        title: decision === 'approved' ? `CO approved · ${projectName}` : `CO declined · ${projectName}`,
        body: `${signerName} ${decision === 'approved' ? 'approved' : 'declined'} a change order`,
        pushData: { projectId, portalId, kind: 'co_approval', changeOrderId: coId },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${signerName} ${decision === 'approved' ? 'approved' : 'declined'} a change order — ${projectName}`,
        emailHtml: wrapHtml({
          eyebrow: decision === 'approved' ? 'CO approved' : 'CO declined',
          title: `${esc(signerName)} ${decision === 'approved' ? 'approved' : 'declined'} change order #${esc(coId.slice(0, 8))}`,
          bodyHtml: `<p style="margin:0 0 14px"><strong>Project:</strong> ${esc(projectName)}</p><p style="margin:0">Sync the decision to your CO record next time you're in MAGE ID — the approval is logged and time-stamped.</p>`,
          cta: { label: 'View in MAGE ID', href: 'https://app.mageid.app' },
        }),
      });
      break;
    }
    case 'sub_invoice_submitted': {
      const num = (payload.invoice_number as string) || '';
      const amount = payload.amount as number | string;
      const submitter = (payload.submitted_by_name as string) || 'sub';
      await dispatchOne('gc', {
        prefKey: 'sub_invoice',
        title: `Sub invoice · ${fmtMoney(amount)}`,
        body: `${submitter} submitted invoice #${num}`,
        pushData: { projectId, kind: 'sub_invoice', subPortalId },
        pushToken: gc.push_token,
        email: gc.email,
        emailSubject: `${submitter} submitted invoice #${num} — ${fmtMoney(amount)}`,
        emailHtml: wrapHtml({
          eyebrow: 'Sub invoice submitted',
          title: `${esc(submitter)} submitted invoice #${esc(num)}`,
          bodyHtml: `<p style="margin:0 0 6px"><strong>Amount:</strong> ${esc(fmtMoney(amount))}</p><p style="margin:0 0 14px"><strong>Project:</strong> ${esc(projectName)}</p><p style="margin:0">Review and approve from the sub-portal screen — once approved, you can mark it paid and the sub sees the status update on their next portal visit.</p>`,
          cta: { label: 'Review in MAGE ID', href: 'https://app.mageid.app' },
        }),
      });
      break;
    }
    case 'sub_invoice_reviewed': {
      // Sub-bound notification when the GC takes action on their invoice.
      const num = (payload.invoice_number as string) || '';
      const amount = payload.amount as number | string;
      const newStatus = (payload.status as string) || 'updated';
      const submitter = (payload.submitted_by_name as string) || 'sub';
      const submitterEmail = (payload.submitted_by_email as string) || null;
      const notesFromGc = (payload.notes_from_gc as string) || '';
      const company = gc.company_name || gc.contact_name || 'Your contractor';
      if (!submitterEmail) {
        // Sub didn't leave an email — nothing to do.
        await sbInsert('notification_outbox', {
          event_type: event,
          source_table: source_table ?? null,
          source_id: source_id ?? null,
          recipient_kind: 'sub',
          recipient_user_id: null,
          recipient_email: null,
          push_status: null,
          email_status: 'skipped_no_email',
          payload,
        }).catch(() => {});
        break;
      }
      const verb =
        newStatus === 'approved' ? 'approved'
        : newStatus === 'paid' ? 'marked as paid'
        : 'updated';
      const subject =
        newStatus === 'paid'
          ? `Invoice #${num} paid · ${fmtMoney(amount)}`
          : `Invoice #${num} ${verb} · ${fmtMoney(amount)}`;
      const eyebrow = newStatus === 'paid' ? 'Invoice paid' : (newStatus === 'approved' ? 'Invoice approved' : (newStatus === 'rejected' ? 'Invoice update' : 'Invoice update'));
      const title = newStatus === 'paid'
        ? `${esc(company)} just paid invoice #${esc(num)}`
        : newStatus === 'approved'
          ? `${esc(company)} approved invoice #${esc(num)}`
          : newStatus === 'rejected'
            ? `${esc(company)} sent back invoice #${esc(num)}`
            : `${esc(company)} updated invoice #${esc(num)}`;
      const bodyHtml = `<p style="margin:0 0 6px"><strong>Amount:</strong> ${esc(fmtMoney(amount))}</p><p style="margin:0 0 14px"><strong>Project:</strong> ${esc(projectName)}</p>${notesFromGc ? `<blockquote style="margin:0 0 14px;padding:14px 16px;background:#F4EFE6;border-left:3px solid #FF6A1A;border-radius:6px;font-style:italic;">${esc(notesFromGc)}</blockquote>` : ''}<p style="margin:0">${newStatus === 'paid' ? 'Payment is on its way — check your bank for the deposit.' : newStatus === 'approved' ? 'You\'ll get another note once payment is on its way.' : newStatus === 'rejected' ? 'Reach out for clarification or revise and resubmit through your portal.' : ''}</p>`;
      const r = await sendEmail({
        to: submitterEmail,
        subject,
        html: wrapHtml({ eyebrow, title, bodyHtml }),
        replyTo: gc.email ?? undefined,
      });
      await sbInsert('notification_outbox', {
        event_type: event,
        source_table: source_table ?? null,
        source_id: source_id ?? null,
        recipient_kind: 'sub',
        recipient_user_id: null,
        recipient_email: submitterEmail,
        push_status: null,
        email_status: r.ok ? 'sent' : 'failed',
        email_response: r.resp,
        payload,
        delivered_at: r.ok ? new Date().toISOString() : null,
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
    const body = await req.json() as NotifyRequest;
    if (!body || !body.event) return jsonResponse({ error: "Missing event" }, 400);
    const result = await dispatch(body);
    return jsonResponse({ success: true, result });
  } catch (e) {
    console.error('[notify] dispatch failed', e);
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});
