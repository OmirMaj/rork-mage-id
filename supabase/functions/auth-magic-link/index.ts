// auth-magic-link
//
// Replaces Supabase's built-in magic-link email with a branded MAGE ID
// version. The default Supabase template ships with a generic blue link
// and inbox preview that screams "transactional auth provider." We want
// every touchpoint — including the very first email a user gets — to
// feel like the rest of the brand.
//
// Flow:
//   1. Client calls this function with { email, redirectTo } — or, for a crew
//      claim invite, { email, redirectTo, purpose: 'crew_claim', memberId,
//      claimToken } (#72, see the crew_claim branch below and ./copy.ts)
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
import { wrapEmailHtml, resendSend, escapeHtml } from '../_shared/email.ts';
import { clientIpFrom } from '../_shared/notifyGuards.ts';
import { verifyUser } from '../_shared/verifyUser.ts';
import {
  parsePurpose, isUuid, inviterIdentity, checkClaimInvite, claimRedirect,
  signInEmailCopy, crewClaimEmailCopy, type ClaimRow, type EmailCopy,
} from './copy.ts';

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

const SERVICE_HEADERS = (): Record<string, string> => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
});

/** Service-role PostgREST read; throws on a non-2xx. */
async function serviceGet(path: string): Promise<unknown[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SERVICE_HEADERS() });
  if (!r.ok) throw new Error(`rest ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

/** Save the invite token onto the caller's still-unclaimed, token-less crew
 *  row (service role: auth.uid() IS NULL, which crew_freeze_ownership_columns
 *  leaves free). True when this call wrote it. The filter makes it a no-op
 *  when the phone's own mint landed first or the row was claimed. */
async function serviceMintToken(memberId: string, ownerId: string, token: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/crew_members?id=eq.${memberId}&user_id=eq.${ownerId}&claim_token=is.null&claimed_by_user_id=is.null`,
      {
        method: 'PATCH',
        headers: { ...SERVICE_HEADERS(), Prefer: 'return=representation' },
        body: JSON.stringify({ claim_token: token }),
      },
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Use POST' }, 405);
  }

  let body: { email?: string; redirectTo?: string; purpose?: unknown; memberId?: unknown; claimToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  let redirectTo = body.redirectTo ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return jsonResponse({ error: 'Invalid email.' }, 400);
  }
  const purpose = parsePurpose(body.purpose);
  if (!purpose) return jsonResponse({ error: 'Unknown purpose.', code: 'bad_purpose' }, 400);
  if (!RESEND_API_KEY || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    return jsonResponse({ error: 'Server not configured.' }, 500);
  }

  // Throttle before doing any work (mint link / send email). Check both the
  // target email and the source IP; trip on either. Generic 429 — don't reveal
  // which limit fired or whether the account exists.
  // EDGE-F15 (review 2026-09-05): clientIpFrom, not the client-supplied FIRST
  // x-forwarded-for hop — otherwise the per-IP cap is a fresh bucket per request.
  const clientIp = clientIpFrom(req.headers);
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

  // ── crew_claim: a GC inviting a worker to claim his crew profile (#72) ──
  // The company-branded "<Company> added you to their crew" email is only
  // sent for a real invite: a signed-in caller (verified with GoTrue — this
  // function is verify_jwt = false), a crew row HE owns, still unclaimed,
  // whose saved email is this address. The company name comes from HIS
  // profile, never the body, so the open endpoint can't mail spoofed
  // contractor-branded messages to arbitrary addresses.
  let copy: EmailCopy = signInEmailCopy(email);
  let fromCompanyName: string | undefined; // sign-in: pure platform email
  let inviterDisplay: string | null = null;
  if (purpose === 'crew_claim') {
    const caller = await verifyUser(req);
    if (!caller?.id) {
      return jsonResponse({ error: 'Sign in again to send the invite.', code: 'unauthenticated' }, 401);
    }
    if (!isUuid(body.memberId)) return jsonResponse({ error: 'Missing crew member.', code: 'bad_member' }, 400);
    const readRow = async (): Promise<ClaimRow | null | 'error'> => {
      try {
        const rows = await serviceGet(
          `crew_members?id=eq.${body.memberId}&user_id=eq.${caller.id}&select=id,email,claim_token,claimed_by_user_id&limit=1`,
        ) as ClaimRow[];
        return rows[0] ?? null;
      } catch {
        return 'error';
      }
    };
    let row = await readRow();
    if (row === 'error') return jsonResponse({ error: 'Could not check the crew member. Try again.', code: 'lookup_failed' }, 502);
    let check = checkClaimInvite(row, email, body.claimToken);
    if (check.ok && check.mint) {
      // The phone's own mint write may still be in flight. Save the token as
      // the service role, only onto a row that is still unclaimed and holds
      // none; if the phone's write won the race, re-read and mail ITS token.
      const minted = await serviceMintToken(body.memberId, caller.id, check.token);
      if (!minted) {
        row = await readRow();
        if (row === 'error') return jsonResponse({ error: 'Could not check the crew member. Try again.', code: 'lookup_failed' }, 502);
        check = checkClaimInvite(row, email, null);
      }
    }
    if (!check.ok) return jsonResponse({ error: check.error, code: check.code }, check.status);
    const claimUrl = claimRedirect(redirectTo, check.token);
    if (!claimUrl) return jsonResponse({ error: 'Invalid invite link.', code: 'bad_redirect' }, 400);
    redirectTo = claimUrl;

    let profile: { company_name?: string | null; contact_name?: string | null } | null = null;
    try {
      const rows = await serviceGet(`profiles?id=eq.${caller.id}&select=company_name,contact_name&limit=1`) as typeof profile[];
      profile = rows[0] ?? null;
    } catch {
      profile = null; // falls back to "Your contractor" — never a guessed name
    }
    const inviter = inviterIdentity(profile);
    copy = crewClaimEmailCopy(inviter.display, email);
    fromCompanyName = inviter.fromCompanyName;
    inviterDisplay = inviter.fromCompanyName ?? null;
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
  // is exempt from List-Unsubscribe handling (a claim invite is a one-off
  // sign-in link too, sent because a named contractor asked for it).
  //
  // Neither email says "Welcome back" or "no account will be created":
  // generateLink('magiclink') above has ALREADY created the account for an
  // address that never signed in (#72).
  const html = wrapEmailHtml({
    preheader: copy.preheader,
    eyebrow: copy.eyebrow,
    title: copy.title,
    subtitle: copy.subtitle,
    companyName: fromCompanyName,
    bodyHtml: `
      <p style="margin:14px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#9AA3AD;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;">
        If the button doesn't work, paste this URL into your browser
      </p>
      <p style="margin:6px 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#4A5159;word-break:break-all;line-height:1.5;">
        ${escapeHtml(actionLink)}
      </p>
      <div style="height:1px;background:#E8DFCD;margin:8px 0 16px;"></div>
      <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#9AA3AD;line-height:1.55;">
        ${escapeHtml(copy.footer)}
      </p>
    `,
    cta: { label: copy.ctaLabel, href: actionLink },
    unsubscribe: { enabled: false }, // security email — never unsubscribable
  });

  const result = await resendSend(RESEND_API_KEY, {
    to: email,
    subject: copy.subject,
    html,
    // Sign-in: undefined → default "MAGE ID <noreply@mageid.app>". Claim:
    // "<Company> via MAGE ID", from the caller's own profile.
    fromCompanyName,
  });
  if (!result.ok) {
    console.error('[auth-magic-link] resend failed:', result.resp);
    return jsonResponse({ error: purpose === 'crew_claim' ? 'Could not send the invite email.' : 'Could not send sign-in email.' }, 500);
  }

  // companyName: the name the invite went out under (null → plain MAGE ID),
  // so the GC's confirmation says who the worker will see it from.
  return jsonResponse(purpose === 'crew_claim' ? { ok: true, companyName: inviterDisplay } : { ok: true });
});
