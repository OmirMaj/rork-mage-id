// send-email
//
// Generic Resend relay. The app calls this from the client whenever it
// needs to send a transactional email composed locally (invoices, COs,
// daily reports, estimates, RFIs, portal-setup). The notify function
// handles system-generated event emails on its own; this one is for
// "GC composed an email and wants us to send it from a verified domain"
// so it lands in inboxes instead of spam.
//
// 2026-04 redesign — now goes through ../_shared/email.ts:resendSend so
// every email gets:
//   - Personalized FROM ("{Company} via MAGE ID <noreply@mageid.app>")
//   - List-Unsubscribe + List-Unsubscribe-Post headers (Gmail bulk-sender
//     compliance, Feb 2024)
//   - Auto-generated plaintext fallback (deliverability + a11y)
//   - Reply-to defaulting to the GC's email when client provides it
//
// Who may call: any signed-in account, free tier included — BY DESIGN. The
// relay exists so a GC's own invoices, estimates, change orders and portal
// invites reach THEIR clients from a verified domain instead of a personal
// inbox that lands in spam; gating it to paid tiers would break the free
// tier's core billing loop. Abuse is bounded instead: GoTrue-verified
// identity (requireTier), server-forced FROM / reply-to, recipient
// validation, a per-user hourly recipient bucket (60/h free, 500/h paid),
// a global 500/h bucket shared by every account, and the 25-per-call cap.
//
// Secrets:
//   RESEND_API_KEY — from resend.com/api-keys
//
// Request body:
//   {
//     to: string | string[],
//     subject: string,
//     html: string,
//     text?: string,                     // plaintext override; auto-generated otherwise
//     replyTo?: string,
//     from?: string,                     // legacy: full FROM string override
//     fromCompanyName?: string,          // preferred: just the company name; we wrap to "X via MAGE ID"
//     attachments?: Array<{
//       filename: string,
//       content: string,                 // base64
//       contentType?: string,
//     }>,
//     unsubscribe?: {                    // drives List-Unsubscribe headers
//       recipientEmail?: string,
//       eventKey?: string,
//       enabled?: boolean,
//     },
//   }
//
// Response:
//   { success: true, id: "<resend-message-id>" }
//   { success: false, error: "<reason>" }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { resendSend, htmlToPlaintext, buildFromAddress, buildUnsubscribeUrl, type UnsubscribeOpts } from "../_shared/email.ts";
import { requireTier, rateLimitCount } from "../_shared/auth.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const MAX_RECIPIENTS_PER_CALL = 25;
// EDGE-F9: per-user hourly recipient bucket on top of the per-call cap.
const RECIPIENTS_PER_HOUR_FREE = 60;
const RECIPIENTS_PER_HOUR_PAID = 500;
// A1 (review 2026-09-04): global ceiling across ALL accounts — Resend's plan
// quota is shared with dunning, digests and COI warnings.
const GLOBAL_RECIPIENTS_PER_HOUR = 500;
// Plausible-address check — Resend would reject garbage anyway, but a 400 here
// is cheaper and never touches the rate bucket.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const MAX_HTML_BYTES = 250_000;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

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

interface Attachment {
  filename: string;
  content: string;
  contentType?: string;
}

interface SendEmailBody {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
  fromCompanyName?: string;
  attachments?: Attachment[];
  unsubscribe?: UnsubscribeOpts;
}

// resendSend in _shared/email.ts handles single-recipient sends with full
// header + plaintext support but doesn't accept attachments. For the
// attachment path we still construct the Resend payload directly here so
// we keep one consistent set of headers / FROM / plaintext logic but
// thread attachments through.
async function sendWithAttachments(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  from: string;
  attachments: Attachment[];
  unsubscribeHeaders: Record<string, string>;
}): Promise<{ ok: boolean; resp: unknown }> {
  const payload: Record<string, unknown> = {
    from: opts.from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    attachments: opts.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      ...(a.contentType ? { content_type: a.contentType } : {}),
    })),
  };
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  const headers = { ...opts.unsubscribeHeaders, 'X-Entity-Ref-ID': `mageid-${Date.now()}` };
  if (Object.keys(headers).length > 0) payload.headers = headers;
  // Mirror the retry-with-backoff in resendSend for the attachment path —
  // Resend's 5/sec rate limit applies to the whole account, so a burst
  // of invoice/CO sends with PDFs would 429 just like the no-attachment
  // path. 4 attempts, ~3.5s worst case, only retries on 429.
  const MAX_ATTEMPTS = 4;
  const BASE_MS = 350;
  let lastResp: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const resp = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, resp };
      lastResp = resp;
      if (r.status !== 429 || attempt === MAX_ATTEMPTS - 1) {
        return { ok: false, resp };
      }
      const wait = BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise((res) => setTimeout(res, wait));
    } catch (e) {
      return { ok: false, resp: { error: String(e) } };
    }
  }
  return { ok: false, resp: lastResp ?? { error: 'rate_limit_exhausted' } };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }
  if (!RESEND_API_KEY) {
    console.error("[send-email] RESEND_API_KEY not set in edge function secrets");
    return jsonResponse({ success: false, error: "Email service not configured" }, 500);
  }

  let body: SendEmailBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  if (!body.to || (Array.isArray(body.to) && body.to.length === 0)) {
    return jsonResponse({ success: false, error: "Missing recipient (to)" }, 400);
  }
  if (!body.subject || typeof body.subject !== "string") {
    return jsonResponse({ success: false, error: "Missing subject" }, 400);
  }
  if (!body.html || typeof body.html !== "string") {
    return jsonResponse({ success: false, error: "Missing html body" }, 400);
  }

  // Audit-2026-05-21: anti-impersonation + size caps. Pre-fix this
  // function had verify_jwt:true at the platform level but blindly
  // honored caller-supplied `from`, `fromCompanyName`, and `replyTo`
  // — any authenticated MAGE user could send emails branded as
  // "[Any Company] via MAGE ID <noreply@mageid.app>" with a reply-to
  // pointing anywhere. That's a phishing kit shipped with every signup.
  // Plus there was no cap on body.html size, attachment size, or
  // recipient count — abuse vector for Resend quota burn.
  //
  // Fix:
  //   1. Verify the caller's JWT with GoTrue (requireTier → identity + tier;
  //      audit EDGE-F14 replaced the bare claims decode that was here)
  //   2. Look up their profile.company_name + profile.email
  //   3. FORCE fromCompanyName to their company_name (ignore body.fromCompanyName)
  //   4. FORCE replyTo to their email (ignore body.replyTo)
  //   5. REJECT body.from (no legacy override path)
  //   6. Cap recipients at 25 per call, html at 250KB, attachments at 5MB total
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[send-email] Supabase server config missing — cannot verify caller identity");
    return jsonResponse({ success: false, error: "Server misconfigured" }, 500);
  }
  // Audit EDGE-F14 / EDGE-F9: verified identity + tier in one call (GoTrue
  // /auth/v1/user + the subscriptions row). This relay is a phishing kit if
  // the caller can be forged, so a claims decode is not acceptable here.
  const auth = await requireTier(req, ["free", "pro", "business", "enterprise"], "send_email");
  if (!auth.ok) return jsonResponse(auth.body, auth.status);
  const callerSub = auth.userId;
  // Look up caller profile for the trust-derived FROM / reply-to. The reply-to
  // is the GoTrue-verified address first (attributable — EDGE-F9), the profile
  // row only as a fallback.
  let callerCompany: string | null = null;
  let callerEmail: string | null = auth.email ?? null;
  try {
    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(callerSub)}&select=company_name,contact_name,email&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
    );
    if (pRes.ok) {
      const rows = await pRes.json() as { company_name: string | null; contact_name: string | null; email: string | null }[];
      if (rows.length > 0) {
        callerCompany = rows[0].company_name || rows[0].contact_name || null;
        callerEmail = callerEmail || rows[0].email || null;
      }
    }
  } catch (e) {
    console.warn("[send-email] profile lookup failed (will use defaults):", e);
  }

  // Size + recipient caps
  const recipients = Array.isArray(body.to) ? body.to : [body.to];
  if (recipients.length > MAX_RECIPIENTS_PER_CALL) {
    return jsonResponse({ success: false, error: `Too many recipients (max ${MAX_RECIPIENTS_PER_CALL} per call)` }, 400);
  }
  // EDGE-F9: every recipient must be a plausible address.
  const hasBadRecipient = recipients.some((to) => typeof to !== "string" || to.length > 320 || !EMAIL_RE.test(to.trim()));
  if (hasBadRecipient) {
    return jsonResponse({ success: false, error: "One or more recipient addresses are not valid email addresses" }, 400);
  }
  if (body.html.length > MAX_HTML_BYTES) {
    return jsonResponse({ success: false, error: `HTML body too large (max ${MAX_HTML_BYTES} bytes)` }, 400);
  }
  if (body.attachments) {
    let totalAttachBytes = 0;
    for (const a of body.attachments) {
      // base64 inflates ~33%, so we approximate decoded size.
      totalAttachBytes += Math.floor((a.content?.length || 0) * 0.75);
    }
    if (totalAttachBytes > MAX_ATTACHMENT_BYTES) {
      return jsonResponse({ success: false, error: `Attachments too large (max ${MAX_ATTACHMENT_BYTES} bytes total decoded)` }, 400);
    }
  }

  // EDGE-F9: per-user hourly recipient bucket (60/h free, 500/h paid). Pre-fix
  // an account could send 25 recipients per call, unlimited calls. Counted per
  // RECIPIENT so a 25-address blast costs 25. The limiter fails OPEN (-1 = the
  // RPC is unavailable): a limiter blip must not block a GC's invoice, and
  // Resend's own account limits still apply.
  const hourlyLimit = auth.tier === "free" ? RECIPIENTS_PER_HOUR_FREE : RECIPIENTS_PER_HOUR_PAID;
  // Review 2026-09-05: this is TWO sequential RPCs PER RECIPIENT (a 25-address
  // send = 50 round trips) because public.rate_limit_increment(p_scope text) in
  // supabase/schema.sql only ever adds 1 — there is no (scope, by) overload —
  // and bulk-incrementing would need a migration this branch deliberately does
  // not add. The loop stays; collapse it to one RPC per bucket once a
  // rate_limit_increment(p_scope, p_by) lands.
  let bucket = 0;
  let globalBucket = 0;
  for (let i = 0; i < recipients.length; i++) {
    const n = await rateLimitCount(`sendemail:user:${callerSub}`);
    const g = await rateLimitCount(`sendemail:global`);
    if (n < 0 || g < 0) { console.warn("[send-email] rate limiter unavailable — failing open"); break; }
    bucket = n;
    globalBucket = g;
  }
  // rateLimitCount returns the POST-increment count, so `count - 1 >= LIMIT`
  // means LIMIT recipients were already counted this hour: the one that would
  // be the (LIMIT + 1)th is denied and exactly LIMIT get through.
  if (bucket - 1 >= hourlyLimit) {
    return jsonResponse({
      success: false,
      error: `Sending limit reached (${hourlyLimit} recipients per hour on ${auth.tier}). Try again in an hour.`,
      code: "rate_limited",
    }, 429);
  }
  if (globalBucket - 1 >= GLOBAL_RECIPIENTS_PER_HOUR) {
    console.error(`[send-email] global hourly recipient ceiling hit (${GLOBAL_RECIPIENTS_PER_HOUR}/h)`);
    return jsonResponse({ success: false, error: "Email sending is temporarily paused — please try again in an hour.", code: "rate_limited" }, 429);
  }

  // Force server-derived FROM + reply-to. Caller's body.from / body.fromCompanyName / body.replyTo are IGNORED.
  const text = body.text ?? htmlToPlaintext(body.html);
  const fromAddress = buildFromAddress(callerCompany);
  // Override the parsed values so the rest of the function uses trusted versions.
  body.from = fromAddress;
  body.fromCompanyName = callerCompany ?? undefined;
  body.replyTo = callerEmail ?? undefined;

  // Send to each recipient. Resend supports multi-recipient on `to` but
  // that exposes each recipient's address to the others — never what we
  // want. Loop instead.
  const results: { to: string; ok: boolean; id?: string; error?: string }[] = [];
  for (const to of recipients) {
    if (body.attachments && body.attachments.length > 0) {
      // Build unsubscribe headers for this recipient.
      const unsubHeaders: Record<string, string> = {};
      if (body.unsubscribe?.enabled !== false) {
        // B1 (review 2026-09-04): the unsubscribe recipient is ALWAYS `to`.
        // Honouring a caller-supplied recipientEmail let any signed-in account
        // mint HMAC(UNSUB_SECRET, victim) by mailing itself and reading the
        // List-Unsubscribe header. Only eventKey is taken from the body.
        const u = { eventKey: body.unsubscribe?.eventKey, recipientEmail: to };
        const url = buildUnsubscribeUrl(u);
        if (url) {
          unsubHeaders['List-Unsubscribe'] = `<${url}>, <mailto:unsubscribe@mageid.app?subject=Unsubscribe%20${encodeURIComponent(u.eventKey ?? '')}>`;
          unsubHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
        }
      }
      const r = await sendWithAttachments({
        to,
        subject: body.subject,
        html: body.html,
        text,
        replyTo: body.replyTo,
        from: fromAddress,
        attachments: body.attachments,
        unsubscribeHeaders: unsubHeaders,
      });
      const id = (r.resp as { id?: string } | null)?.id;
      const error = (r.resp as { message?: string; error?: string } | null);
      if (!r.ok) {
        console.error("[send-email] Resend rejected:", r.resp);
        results.push({ to, ok: false, error: error?.message || error?.error || 'Resend error' });
      } else {
        results.push({ to, ok: true, id });
      }
    } else {
      const r = await resendSend(RESEND_API_KEY, {
        to,
        subject: body.subject,
        html: body.html,
        text,
        replyTo: body.replyTo,
        fromCompanyName: body.fromCompanyName,
        fromOverride: body.from,
        // B1: recipientEmail is `to`, never the body value (see above).
        unsubscribe: body.unsubscribe?.enabled === false ? undefined : { eventKey: body.unsubscribe?.eventKey, recipientEmail: to },
      });
      const id = (r.resp as { id?: string } | null)?.id;
      const error = (r.resp as { message?: string; error?: string } | null);
      if (!r.ok) {
        console.error("[send-email] Resend rejected:", r.resp);
        results.push({ to, ok: false, error: error?.message || error?.error || 'Resend error' });
      } else {
        results.push({ to, ok: true, id });
      }
    }
  }

  const allOk = results.every((r) => r.ok);
  if (!allOk) {
    const firstErr = results.find((r) => !r.ok);
    return jsonResponse({ success: false, error: firstErr?.error || 'One or more sends failed', results }, 502);
  }
  // For a single-recipient send (the common case), return the message id at top level for backward compat.
  if (results.length === 1) {
    return jsonResponse({ success: true, id: results[0].id });
  }
  return jsonResponse({ success: true, results });
});
