// send-email
//
// Deno edge function that sends transactional email via Resend.
//
// Why a server-side function instead of doing this from the app:
//   - Resend requires an authenticated API call from a trusted origin.
//   - The app was previously opening `mailto:` via expo-mail-composer, which
//     meant email went out from the user's personal inbox. That failed SPF/DKIM
//     for the mageid.app domain and clients' spam filters ate it.
//   - By routing through here, every email sends FROM a verified mageid.app
//     address with proper DKIM signatures. Deliverability goes from "in spam
//     or bounced" to "in the inbox."
//
// Secrets required (set via Supabase dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY  — from resend.com/api-keys
//
// Request body:
//   {
//     to: string | string[],
//     subject: string,
//     html: string,
//     replyTo?: string,
//     from?: string,              // optional override — default below
//     attachments?: Array<{
//       filename: string,
//       content: string,          // base64-encoded
//       contentType?: string,
//     }>,
//   }
//
// Response:
//   { success: true, id: "<resend-message-id>" }
//   { success: false, error: "<reason>" }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Default FROM. Can be overridden per-request via body.from so a white-labeled
// GC could send as their own branded sender down the road (requires their
// own verified domain — out of scope for MVP).
const DEFAULT_FROM = 'MAGE ID <noreply@mageid.app>';

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
  content: string;       // base64
  contentType?: string;
}

interface SendEmailBody {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
  attachments?: Attachment[];
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

  // Validate required fields. We're strict here because a malformed payload
  // to Resend costs a round-trip and a confusing error.
  if (!body.to || (Array.isArray(body.to) && body.to.length === 0)) {
    return jsonResponse({ success: false, error: "Missing recipient (to)" }, 400);
  }
  if (!body.subject || typeof body.subject !== "string") {
    return jsonResponse({ success: false, error: "Missing subject" }, 400);
  }
  if (!body.html || typeof body.html !== "string") {
    return jsonResponse({ success: false, error: "Missing html body" }, 400);
  }

  // Build Resend payload. Resend accepts the same keys we already use with
  // one exception: it wants `reply_to` not `replyTo`.
  const resendPayload: Record<string, unknown> = {
    from: body.from || DEFAULT_FROM,
    to: Array.isArray(body.to) ? body.to : [body.to],
    subject: body.subject,
    html: body.html,
  };

  if (body.replyTo) resendPayload.reply_to = body.replyTo;
  if (body.attachments && body.attachments.length > 0) {
    resendPayload.attachments = body.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      // content_type is optional; Resend infers from filename if omitted.
      ...(a.contentType ? { content_type: a.contentType } : {}),
    }));
  }

  try {
    const resendRes = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });

    const text = await resendRes.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // Non-JSON body — keep the raw text so we can surface it for debugging.
      parsed = { raw: text.substring(0, 500) };
    }

    if (!resendRes.ok) {
      console.error("[send-email] Resend rejected:", resendRes.status, text.substring(0, 400));
      const message =
        (parsed.message as string) ||
        (parsed.error as string) ||
        `Resend ${resendRes.status}`;
      return jsonResponse({ success: false, error: message }, 502);
    }

    const id = (parsed.id as string) || null;
    console.log("[send-email] Sent", id, "to", body.to);
    return jsonResponse({ success: true, id });
  } catch (err) {
    console.error("[send-email] Network error:", err);
    return jsonResponse(
      { success: false, error: "Network error reaching Resend: " + String(err) },
      500,
    );
  }
});
