// auth-magic-link
//
// Replaces Supabase's built-in magic-link email with a branded MAGE ID
// version. The default Supabase template ships with a generic blue link
// and inbox preview that screams "transactional auth provider." We want
// every touchpoint — including the very first email a user gets — to
// feel like the rest of the brand.
//
// Flow:
//   1. Client calls this function with { email, redirectTo }
//   2. We call supabase.auth.admin.generateLink to mint a real magic
//      link (same security primitive Supabase would use itself), but
//      we DON'T let Supabase send the email.
//   3. We send our own branded email through Resend using helpers
//      inlined here from supabase/functions/_shared/email.ts. The full
//      shared module wasn't bundled because deploy_edge_function only
//      ships files in the function's own directory; for a self-contained
//      auth function it's cleaner to inline the subset we use than to
//      maintain a copy under _shared/.
//
// Secrets:
//   SUPABASE_SERVICE_ROLE_KEY — for admin.generateLink
//   RESEND_API_KEY            — for sending the branded email

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

// ── Brand palette + fonts (mirrors _shared/email.ts) ──────────────────
const INK = '#0B0D10';
const AMBER = '#FF6A1A';
const CREAM = '#F4EFE6';
const SAND = '#E8DFCD';
const FOG = '#9AA3AD';
const STONE = '#4A5159';
const PAPER = '#FFFFFF';
const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;
const FONT_DISPLAY = `Georgia,'Times New Roman',serif`;

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

function escapeHtml(text: string | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMagicLinkHtml(opts: { actionLink: string; email: string }): string {
  const { actionLink, email } = opts;
  const safeLink = escapeHtml(actionLink);
  const safeEmail = escapeHtml(email);

  // Header — black/ink bar with MAGE ID wordmark + amber pill on right.
  const headerHtml = `
    <tr><td style="background:${INK};padding:22px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle">
            <p style="margin:0;font-family:${FONT_STACK};font-size:18px;font-weight:800;color:#FFFFFF;letter-spacing:-0.3px;line-height:1.1;">MAGE ID</p>
            <p style="margin:3px 0 0;font-family:${FONT_STACK};font-size:11px;color:#9AA3AD;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;">Operating system for builders</p>
          </td>
          <td align="right" valign="middle">
            <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${AMBER};color:${INK};font-family:${FONT_STACK};font-size:10px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">Sign&nbsp;in</span>
          </td>
        </tr>
      </table>
    </td></tr>`;

  const buttonHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 8px;">
      <tr><td align="center" bgcolor="${INK}" style="border-radius:12px;">
        <a href="${safeLink}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT_STACK};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.1px;border-radius:12px;">Sign in to MAGE ID</a>
      </td></tr>
    </table>`;

  const fallbackUrl = `<p style="margin:18px 0 0;font-family:${FONT_STACK};font-size:11px;color:${FOG};letter-spacing:1.2px;text-transform:uppercase;font-weight:700;">If the button doesn't work, paste this URL into your browser</p>
<p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:13px;color:${STONE};word-break:break-all;line-height:1.5;">${safeLink}</p>`;

  const divider = `<div style="height:1px;background:${SAND};margin:24px 0;"></div>`;

  const securityNote = `<p style="margin:0;font-family:${FONT_STACK};font-size:12px;color:${FOG};line-height:1.55;">You're receiving this because someone — most likely you — entered <strong style="color:${STONE}">${safeEmail}</strong> on MAGE ID. If it wasn't you, ignore this message; no account will be created.</p>`;

  const footerHtml = `
    <tr><td style="padding:22px 32px 28px;background:#FAFAF7;border-top:1px solid ${SAND};">
      <p style="margin:0;font-family:${FONT_STACK};font-size:11px;color:${FOG};line-height:1.6;">
        Powered by <a href="https://mageid.app" style="color:${INK};font-weight:700;text-decoration:none;">MAGE ID</a> — the operating system for general contractors.
      </p>
    </td></tr>`;

  const preheader = 'Your one-tap sign-in link for MAGE ID — expires in 60 minutes.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>Sign in to MAGE ID</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${FONT_STACK};color:${INK};">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${CREAM};opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${PAPER};border-radius:18px;overflow:hidden;border:1px solid ${SAND};">
        ${headerHtml}
        <tr><td style="padding:34px 32px 8px;">
          <p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:11px;font-weight:800;color:${AMBER};letter-spacing:1.6px;text-transform:uppercase;">One-tap sign-in</p>
          <h1 style="margin:0;font-family:${FONT_DISPLAY};font-size:30px;font-weight:700;color:${INK};letter-spacing:-0.6px;line-height:1.18;">Welcome back to MAGE ID</h1>
          <p style="margin:10px 0 0;font-family:${FONT_STACK};font-size:16px;color:${STONE};line-height:1.55;">Tap the button below to continue as <strong style="color:${INK};">${safeEmail}</strong>. The link is good for one tap and expires in 60 minutes.</p>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${STONE};">
          ${buttonHtml}
          ${fallbackUrl}
          ${divider}
          ${securityNote}
        </td></tr>
        ${footerHtml}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function htmlToPlaintext(html: string): string {
  let s = html;
  const bodyOpen = s.search(/<body\b[^>]*>/i);
  if (bodyOpen >= 0) {
    s = s.replace(/^[\s\S]*?<body\b[^>]*>/i, '');
    s = s.replace(/<\/body>[\s\S]*$/i, '');
  }
  s = s.replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '');
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const safeHref = String(href).replace(/=/g, '%3D');
    const cleaned = String(label).replace(/<[^>]+>/g, '').trim();
    return cleaned ? `${cleaned} (${safeHref})` : safeHref;
  });
  s = s.replace(/<\/(p|div|tr|h\d|li|blockquote|table)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&zwnj;/g, '');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map((l) => l.trim()).join('\n').trim();
  return s;
}

async function sendBrandedEmail(opts: { to: string; subject: string; html: string }): Promise<{ ok: boolean }> {
  const text = htmlToPlaintext(opts.html);
  const payload: Record<string, unknown> = {
    from: 'MAGE ID <noreply@mageid.app>',
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text,
    headers: {
      'X-Entity-Ref-ID': `mageid-auth-${Date.now()}`,
    },
  };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return { ok: r.ok };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Use POST' }, 405);
  }

  let body: { email?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const redirectTo = body.redirectTo ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return jsonResponse({ error: 'Invalid email.' }, 400);
  }
  if (!RESEND_API_KEY || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    return jsonResponse({ error: 'Server not configured.' }, 500);
  }

  // Mint the magic link without triggering Supabase's built-in email.
  // generateLink returns action_link which is the same URL the default
  // mailer would have sent — same security, same TTL, just our envelope.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    console.error('[auth-magic-link] generateLink failed:', error?.message);
    return jsonResponse({ error: 'Could not generate sign-in link.' }, 500);
  }

  const html = buildMagicLinkHtml({ actionLink: data.properties.action_link, email });
  try {
    const result = await sendBrandedEmail({
      to: email,
      subject: 'Your MAGE ID sign-in link',
      html,
    });
    if (!result.ok) {
      console.error('[auth-magic-link] resend non-2xx');
      return jsonResponse({ error: 'Could not send sign-in email.' }, 500);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auth-magic-link] sendBrandedEmail failed:', msg);
    return jsonResponse({ error: 'Could not send sign-in email.' }, 500);
  }

  return jsonResponse({ ok: true });
});
