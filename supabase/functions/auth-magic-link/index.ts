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
//   3. We send our own branded email through Resend via the shared
//      `wrapEmailHtml` + `resendSend` helpers — same shell every other
//      MAGE ID transactional email uses, so the user gets one
//      consistent look across digests, receipts, contract send, COI
//      warnings, etc.
//
// Secrets:
//   SUPABASE_SERVICE_ROLE_KEY — for admin.generateLink
//   RESEND_API_KEY            — for sending the branded email

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
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

// Abuse throttle. This endpoint is an open POST that sends a real email on
// every call — without a limit it can be used to email-bomb any address (or
// burn Resend quota). We reuse the atomic windowed `rate_limit_increment` RPC
// (same one notify uses) keyed per-email (the bombing TARGET) and per-IP (the
// SOURCE). Caps are per window (hourly). Fail-open on RPC error so a transient
// counter glitch never blocks a legitimate sign-in.
const MAGICLINK_EMAIL_CAP = 5;
const MAGICLINK_IP_CAP = 20;

async function rateLimitCount(scope: string): Promise<number | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_increment`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_scope: scope }),
    });
    if (!r.ok) return null;
    const c = await r.json();
    return typeof c === 'number' ? c : null;
  } catch {
    return null;
  }
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

  // Throttle before doing any work (mint link / send email). Check both the
  // target email and the source IP; trip on either. Generic 429 — don't reveal
  // which limit fired or whether the account exists.
  const clientIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const [emailCount, ipCount] = await Promise.all([
    rateLimitCount(`magiclink:email:${email}`),
    rateLimitCount(`magiclink:ip:${clientIp}`),
  ]);
  if (
    (emailCount !== null && emailCount > MAGICLINK_EMAIL_CAP) ||
    (ipCount !== null && ipCount > MAGICLINK_IP_CAP)
  ) {
    return jsonResponse({ error: 'Too many sign-in requests. Please wait a few minutes and try again.' }, 429);
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
  const actionLink = data.properties.action_link;

  // Branded HTML — uses the canonical wrapEmailHtml shell so the layout,
  // header, footer, and unsubscribe behavior match every other MAGE ID
  // email. unsubscribe.enabled = false because account / security mail
  // is exempt from List-Unsubscribe handling.
  const html = wrapEmailHtml({
    preheader: "Your one-tap sign-in link for MAGE ID — expires in 60 minutes.",
    eyebrow: 'One-tap sign-in',
    title: 'Welcome back to MAGE ID',
    subtitle: `Tap the button below to continue as ${email}. The link is good for one tap and expires in 60 minutes.`,
    bodyHtml: `
      <p style="margin:14px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#9AA3AD;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;">
        If the button doesn't work, paste this URL into your browser
      </p>
      <p style="margin:6px 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#4A5159;word-break:break-all;line-height:1.5;">
        ${actionLink}
      </p>
      <div style="height:1px;background:#E8DFCD;margin:8px 0 16px;"></div>
      <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#9AA3AD;line-height:1.55;">
        You're receiving this because someone — most likely you — entered <strong style="color:#4A5159">${email}</strong> on MAGE ID. If it wasn't you, ignore this message; no account will be created.
      </p>
    `,
    cta: { label: 'Sign in to MAGE ID', href: actionLink },
    unsubscribe: { enabled: false }, // security email — never unsubscribable
  });

  const result = await resendSend(RESEND_API_KEY, {
    to: email,
    subject: 'Your MAGE ID sign-in link',
    html,
    fromCompanyName: undefined, // pure platform email; default "MAGE ID <noreply@mageid.app>"
  });
  if (!result.ok) {
    console.error('[auth-magic-link] resend failed:', result.resp);
    return jsonResponse({ error: 'Could not send sign-in email.' }, 500);
  }

  return jsonResponse({ ok: true });
});
