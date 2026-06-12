// unsubscribe
//
// Backs the List-Unsubscribe header (RFC 8058 / Gmail Feb-2024 bulk-sender
// rule), the static unsubscribe page at mageid.app/unsubscribe, and the
// preferences page at mageid.app/preferences.
//
// Endpoints:
//   POST /functions/v1/unsubscribe
//     body: {
//       email: string,
//       event_key?: string | null,    // null = global suppression
//       action?: 'unsubscribe' | 'resubscribe',  // defaults to unsubscribe
//       token?: string,               // REQUIRED for resubscribe
//       source?: string,
//     }
//     → 200 { ok: true }
//     → 400 { ok: false, error: 'missing_email' | 'token_invalid' }
//
//   GET /functions/v1/unsubscribe?e=email&k=event_key
//     → 200 { unsubscribed: boolean }
//
// One-click POST is the path Gmail pings when the user clicks
// "Unsubscribe" from the inbox header. We accept it on the same URL so a
// single endpoint covers both the static-page click and the inbox click.
//
// resubscribe requires a token because re-enabling someone's subscription
// is a "spam someone's inbox" attack vector. Plain unsubscribe does NOT —
// suppressing an address is user-protective and can be reversed by support
// if needed.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { verifyUnsubscribeToken } from "../_shared/email.ts";

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

/**
 * Re-enable a previously-suppressed (email, event_key) by deleting the
 * row. PostgREST handles the conditional delete via filters. Token is
 * verified by the caller before this runs.
 *
 * Special case: when eventKey is null, the user is asking to clear their
 * GLOBAL suppression (i.e. they hit "unsubscribe from everything" and
 * are now reversing it). We delete the row where event_key IS NULL.
 */
async function recordResubscribe(email: string, eventKey: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const filter = eventKey === null
      ? `email=eq.${encodeURIComponent(email)}&event_key=is.null`
      : `email=eq.${encodeURIComponent(email)}&event_key=eq.${encodeURIComponent(eventKey)}`;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/email_unsubscribes?${filter}`, {
      method: 'DELETE',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal',
      },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { ok: false, error: `delete ${r.status}: ${text.slice(0, 200)}` };
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
      const url = new URL(req.url);
      let email: string | null = normalizeEmail(url.searchParams.get('e'));
      let eventKey: string | null = url.searchParams.get('k');
      let action: 'unsubscribe' | 'resubscribe' = 'unsubscribe';
      let token: string | null = url.searchParams.get('t');
      let source = 'one_click';

      const ct = (req.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const body = await req.json().catch(() => ({})) as {
          email?: string;
          event_key?: string | null;
          action?: 'unsubscribe' | 'resubscribe';
          token?: string;
          source?: string;
        };
        email = email ?? normalizeEmail(body.email);
        if (eventKey === null || eventKey === undefined) {
          eventKey = body.event_key === null ? null : (body.event_key ?? null);
        }
        action = body.action ?? action;
        token = token ?? body.token ?? null;
        source = body.source ?? source;
      }

      if (!email) return jsonResponse({ ok: false, error: 'missing_email' }, 400);

      if (action === 'resubscribe') {
        // Token is mandatory for re-enable. Anyone with the URL has
        // legitimate access (they got it in an email we sent them).
        if (!token || !verifyUnsubscribeToken(email, token)) {
          return jsonResponse({ ok: false, error: 'token_invalid' }, 400);
        }
        const result = await recordResubscribe(email, eventKey);
        if (!result.ok) {
          console.error('[unsubscribe] resubscribe failed', result.error);
          return jsonResponse({ ok: false, error: result.error }, 500);
        }
        return jsonResponse({ ok: true, action: 'resubscribed' });
      }

      // Default action: unsubscribe. SECURITY: require the signed token here
      // too. Without it, anyone could POST {email, event_key:null} and globally
      // suppress an arbitrary address (silently blocking all their invoices /
      // receipts / COI warnings). Every List-Unsubscribe link we generate
      // carries t=buildUnsubscribeToken(email) (see _shared/email.ts), so Gmail
      // one-click and the static page both pass; only forged calls are blocked.
      if (!token || !verifyUnsubscribeToken(email, token)) {
        return jsonResponse({ ok: false, error: 'token_invalid' }, 400);
      }
      const result = await recordUnsubscribe(email, eventKey ?? null, source);
      if (!result.ok) {
        console.error('[unsubscribe] failed', result.error);
        return jsonResponse({ ok: false, error: result.error }, 500);
      }
      return jsonResponse({ ok: true, action: 'unsubscribed' });
    }

    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  } catch (e) {
    console.error('[unsubscribe] crash', e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
