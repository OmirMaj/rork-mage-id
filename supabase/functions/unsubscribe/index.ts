// unsubscribe
//
// Backs the List-Unsubscribe header (RFC 8058 / Gmail Feb-2024 bulk-sender
// rule) and the static unsubscribe page at mageid.app/unsubscribe.
//
// POST /functions/v1/unsubscribe
//   body: { email: string, event_key?: string, source?: string }
//   → 200 { ok: true } on success
//   → 400 { ok: false, error: 'missing_email' } if no email
//
// GET /functions/v1/unsubscribe?e=email&k=event_key
//   → 200 { unsubscribed: boolean }
//
// One-click POST is the path Gmail pings when the user clicks
// "Unsubscribe" from the inbox header. We accept it on the same URL so a
// single endpoint covers both the static-page click and the inbox click.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://nteoqhcswappxxjlpvap.supabase.co";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s.includes('@') || s.length > 320) return null;
  return s;
}

async function recordUnsubscribe(email: string, eventKey: string | null, source: string): Promise<{ ok: boolean; error?: string }> {
  // Upsert via Supabase REST. The unique constraint on (email, event_key)
  // makes this idempotent — clicking unsubscribe twice doesn't fail.
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/email_unsubscribes?on_conflict=email,event_key`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ email, event_key: eventKey, source }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { ok: false, error: `upsert ${r.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function checkUnsubscribed(email: string, eventKey: string | null): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_email_unsubscribed`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_email: email, p_event_key: eventKey ?? '__global__' }),
    });
    if (!r.ok) return false;
    const v = await r.json();
    return v === true;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const email = normalizeEmail(url.searchParams.get('e'));
      const eventKey = url.searchParams.get('k');
      if (!email) return jsonResponse({ ok: false, error: 'missing_email' }, 400);
      const unsubscribed = await checkUnsubscribed(email, eventKey);
      return jsonResponse({ ok: true, unsubscribed });
    }

    if (req.method === "POST") {
      // Gmail one-click sends Content-Type: application/x-www-form-urlencoded
      // with body `List-Unsubscribe=One-Click`. We fish the email out of the
      // URL params for that path. Web-page UI sends JSON.
      const url = new URL(req.url);
      let email: string | null = normalizeEmail(url.searchParams.get('e'));
      let eventKey: string | null = url.searchParams.get('k');
      let source = 'one_click';

      const ct = (req.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const body = await req.json().catch(() => ({})) as { email?: string; event_key?: string; source?: string };
        email = email ?? normalizeEmail(body.email);
        eventKey = eventKey ?? (body.event_key ?? null);
        source = body.source ?? source;
      }

      if (!email) return jsonResponse({ ok: false, error: 'missing_email' }, 400);

      const result = await recordUnsubscribe(email, eventKey ?? null, source);
      if (!result.ok) {
        console.error('[unsubscribe] failed', result.error);
        return jsonResponse({ ok: false, error: result.error }, 500);
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  } catch (e) {
    console.error('[unsubscribe] crash', e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
