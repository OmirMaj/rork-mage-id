// coi-expiry-watch
//
// Daily cron that emails the GC when one of their subs' Certificate of
// Insurance is approaching expiry. Thresholds: 30 / 14 / 7 days before
// expiry, plus an "overdue" warning the day after.
//
// Why GC, not sub: the COI expiry is the GC's compliance risk under the
// OSHA Multi-Employer Citation Policy. The sub is the source of truth on
// whether they renewed yet. So we email the GC ("Joe's Plumbing COI
// expires Friday — chase them") rather than the sub directly. The GC
// then forwards it / picks up the phone.
//
// Dedup: each subcontractor row carries `coi_last_warned_at` +
// `coi_last_warned_threshold` so a 30-day warning fires once at the
// 30-day mark, not every day until the COI's renewed.
//
// Trigger:
//   POST { all: true }      cron, runs daily at 13:00 UTC
//   POST { userId }         preview/test for a single user
//
// Secrets: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// Shared email helpers — same shell every transactional email uses, so
// the COI warning matches sub-portal invites, contract sends, payment
// receipts, the morning brief, and the homeowner weekly digest.
import { wrapEmailHtml, resendSend } from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

const INK = '#0B0D10';
const AMBER = '#FF6A1A';
const CREAM = '#F4EFE6';
const SAND = '#E8DFCD';
const FOG = '#9AA3AD';
const STONE = '#4A5159';
const PAPER = '#FFFFFF';
const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;
const FONT_DISPLAY = `Georgia,'Times New Roman',serif`;

function escapeHtml(text: unknown): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface SubRow {
  id: string;
  user_id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  coi_expiry: string | null;
  coi_last_warned_at: string | null;
  coi_last_warned_threshold: number | null;
}

interface ProfileRow {
  id: string;
  email: string | null;
  name: string | null;
  company_name: string | null;
  contact_name: string | null;
}

const THRESHOLDS = [30, 14, 7, 0] as const;
type Threshold = typeof THRESHOLDS[number];

function pickThreshold(daysUntilExpiry: number): Threshold | null {
  if (daysUntilExpiry <= 0) return 0;
  if (daysUntilExpiry <= 7) return 7;
  if (daysUntilExpiry <= 14) return 14;
  if (daysUntilExpiry <= 30) return 30;
  return null;
}

function shouldWarn(t: Threshold, sub: SubRow): boolean {
  // Fire when crossing into a tighter bucket. The threshold value is
  // smaller for tighter (7 < 14 < 30; 0 = overdue is tightest). If we
  // already warned at this threshold OR a tighter one, skip.
  const last = sub.coi_last_warned_threshold;
  if (last == null) return true;
  // Overdue (0) always re-warns weekly so the GC doesn't forget.
  if (t === 0) {
    if (!sub.coi_last_warned_at) return true;
    const ageDays = (Date.now() - Date.parse(sub.coi_last_warned_at)) / (24 * 60 * 60 * 1000);
    return Number.isFinite(ageDays) && ageDays >= 7;
  }
  return t < last;
}

function buildEmailHtml(opts: {
  companyName: string;
  subCompanyName: string;
  subContactName: string | null;
  subEmail: string | null;
  subPhone: string | null;
  expiryIso: string;
  daysUntilExpiry: number;
  threshold: Threshold;
}): string {
  const expiryLabel = new Date(opts.expiryIso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const headline =
    opts.threshold === 0
      ? `${opts.subCompanyName}'s COI expired ${Math.abs(opts.daysUntilExpiry)} day${Math.abs(opts.daysUntilExpiry) === 1 ? '' : 's'} ago`
      : `${opts.subCompanyName}'s COI expires in ${opts.daysUntilExpiry} day${opts.daysUntilExpiry === 1 ? '' : 's'}`;
  const eyebrow =
    opts.threshold === 0 ? 'COI expired' :
    opts.threshold === 7 ? 'COI — 7-day warning' :
    opts.threshold === 14 ? 'COI — 14-day warning' :
    'COI — 30-day reminder';

  const contactLines: string[] = [];
  if (opts.subContactName) contactLines.push(`<strong style="color:#0B0D10;">Contact:</strong> ${escapeHtml(opts.subContactName)}`);
  if (opts.subEmail) contactLines.push(`<strong style="color:#0B0D10;">Email:</strong> <a href="mailto:${escapeHtml(opts.subEmail)}" style="color:#FF6A1A;text-decoration:none;">${escapeHtml(opts.subEmail)}</a>`);
  if (opts.subPhone) contactLines.push(`<strong style="color:#0B0D10;">Phone:</strong> ${escapeHtml(opts.subPhone)}`);

  const bodyHtml = `
    <p style="margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:22px;color:#4A5159;">
      The certificate of insurance you have on file for <strong>${escapeHtml(opts.subCompanyName)}</strong> expires <strong>${escapeHtml(expiryLabel)}</strong>.
      Without a current COI you carry the OSHA controlling-employer risk for any work they do on your jobs.
      Reach out and ask them to send a renewed COI naming you as additional insured.
    </p>
    ${contactLines.length > 0 ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#4A5159;">
      ${contactLines.map(l => `<tr><td style="padding:4px 0;">${l}</td></tr>`).join('')}
    </table>` : ''}
    <p style="margin:16px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#9AA3AD;line-height:19px;">
      You can update the expiry date in MAGE ID once the new COI is in hand — Subs → ${escapeHtml(opts.subCompanyName)} → Edit. We'll stop reminding once the date passes the 30-day threshold.
    </p>
  `;

  return wrapEmailHtml({
    preheader: `${opts.subCompanyName} COI ${opts.threshold === 0 ? 'expired' : `in ${opts.daysUntilExpiry}d`} — chase a renewal.`,
    eyebrow,
    title: headline,
    bodyHtml,
    companyName: opts.companyName,
    // Compliance reminders aren't unsubscribable — they protect the GC's
    // own legal risk. Disable the unsubscribe footer.
    unsubscribe: { enabled: false },
  });
}

async function sendEmail(opts: { to: string; subject: string; html: string; fromCompanyName: string; replyTo?: string }) {
  if (!RESEND_API_KEY) return { ok: false, error: 'no_resend_key' };
  const result = await resendSend(RESEND_API_KEY, {
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    fromCompanyName: opts.fromCompanyName,
    replyTo: opts.replyTo,
    unsubscribe: { enabled: false },
  });
  if (!result.ok) {
    return { ok: false, error: JSON.stringify(result.resp).slice(0, 200) };
  }
  return { ok: true };
}

async function processForUser(client: SupabaseClient, userId: string, profile: ProfileRow): Promise<{ warnedCount: number }> {
  // Pull every sub for this GC that has a coi_expiry set and is within
  // 30 days of expiry (or already past). Skip subs without an expiry on
  // file — the GC hasn't entered one, so we can't reason about it.
  const cutoff = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const subsRes = await client
    .from('subcontractors')
    .select('id,user_id,company_name,contact_name,email,phone,coi_expiry,coi_last_warned_at,coi_last_warned_threshold')
    .eq('user_id', userId)
    .not('coi_expiry', 'is', null)
    .lte('coi_expiry', cutoff);
  if (subsRes.error) {
    console.warn('[coi-expiry-watch] subs query failed', userId, subsRes.error);
    return { warnedCount: 0 };
  }
  const subs = (subsRes.data ?? []) as SubRow[];
  if (subs.length === 0) return { warnedCount: 0 };

  // GC's email — required to send the warning. Fall back to profile.email.
  const gcEmail = profile.email;
  if (!gcEmail) return { warnedCount: 0 };
  const gcCompanyName = profile.company_name || profile.contact_name || profile.name || 'MAGE ID';

  let warned = 0;
  for (const sub of subs) {
    if (!sub.coi_expiry) continue;
    const expiryMs = Date.parse(sub.coi_expiry);
    if (!Number.isFinite(expiryMs)) continue;
    const daysUntil = Math.ceil((expiryMs - Date.now()) / (24 * 60 * 60 * 1000));
    const threshold = pickThreshold(daysUntil);
    if (threshold == null) continue;
    if (!shouldWarn(threshold, sub)) continue;

    const html = buildEmailHtml({
      companyName: gcCompanyName,
      subCompanyName: sub.company_name,
      subContactName: sub.contact_name,
      subEmail: sub.email,
      subPhone: sub.phone,
      expiryIso: sub.coi_expiry,
      daysUntilExpiry: daysUntil,
      threshold,
    });
    const subject = threshold === 0
      ? `COI expired — ${sub.company_name}`
      : `COI expiring in ${daysUntil} day${daysUntil === 1 ? '' : 's'} — ${sub.company_name}`;
    const result = await sendEmail({
      to: gcEmail,
      subject,
      html,
      fromCompanyName: gcCompanyName,
      replyTo: gcEmail,
    });
    if (result.ok) {
      warned += 1;
      await client
        .from('subcontractors')
        .update({
          coi_last_warned_at: new Date().toISOString(),
          coi_last_warned_threshold: threshold,
        })
        .eq('id', sub.id);
    } else {
      console.warn('[coi-expiry-watch] send failed', sub.id, result.error);
    }
  }
  return { warnedCount: warned };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!SUPABASE_SERVICE_ROLE_KEY) return jsonResponse({ success: false, error: 'service role key missing' }, 500);

  let body: { all?: boolean; userId?: string };
  try { body = await req.json(); } catch { body = {}; }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (body.userId) {
    const { data: profile } = await client
      .from('profiles')
      .select('id,email,name,company_name,contact_name')
      .eq('id', body.userId)
      .maybeSingle();
    if (!profile) return jsonResponse({ success: false, error: 'profile not found' }, 404);
    const result = await processForUser(client, body.userId, profile as ProfileRow);
    return jsonResponse({ success: true, mode: 'preview', ...result });
  }

  if (body.all) {
    const { data: profiles, error } = await client
      .from('profiles')
      .select('id,email,name,company_name,contact_name');
    if (error) return jsonResponse({ success: false, error: error.message }, 500);
    let totalWarned = 0;
    let userCount = 0;
    for (const p of (profiles ?? []) as ProfileRow[]) {
      const r = await processForUser(client, p.id, p);
      totalWarned += r.warnedCount;
      userCount += 1;
    }
    return jsonResponse({ success: true, mode: 'cron', users: userCount, totalWarned });
  }

  return jsonResponse({ success: false, error: 'must include all:true or userId' }, 400);
});
