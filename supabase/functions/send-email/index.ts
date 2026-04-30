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

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

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
    return { ok: r.ok, resp };
  } catch (e) {
    return { ok: false, resp: { error: String(e) } };
  }
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

  const recipients = Array.isArray(body.to) ? body.to : [body.to];
  const text = body.text ?? htmlToPlaintext(body.html);
  const fromAddress = body.from ?? buildFromAddress(body.fromCompanyName);

  // Send to each recipient. Resend supports multi-recipient on `to` but
  // that exposes each recipient's address to the others — never what we
  // want. Loop instead.
  const results: Array<{ to: string; ok: boolean; id?: string; error?: string }> = [];
  for (const to of recipients) {
    if (body.attachments && body.attachments.length > 0) {
      // Build unsubscribe headers for this recipient.
      const unsubHeaders: Record<string, string> = {};
      if (body.unsubscribe?.enabled !== false && (body.unsubscribe?.recipientEmail || to)) {
        const u = { ...body.unsubscribe, recipientEmail: body.unsubscribe?.recipientEmail ?? to };
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
        unsubscribe: body.unsubscribe?.enabled === false ? undefined : { ...body.unsubscribe, recipientEmail: body.unsubscribe?.recipientEmail ?? to },
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
