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
//       token?: string,               // REQUIRED for both actions (signed, see _shared/email.ts)
//       source?: string,
//     }
//     → 200 { ok: true }
//     → 400 { ok: false, error: 'missing_email' | 'token_invalid' }
//
//   POST /functions/v1/unsubscribe?e=email&k=event_key&t=token
//     body: List-Unsubscribe=One-Click (application/x-www-form-urlencoded)
//     → 200 { ok: true } — RFC 8058 one-click, see below.
//
//   GET /functions/v1/unsubscribe?e=email&k=event_key&t=token   (the header URL)
//   GET … with Accept: text/html                              (a browser)
//     → 303 to mageid.app/unsubscribe?e&k&t — records NOTHING. A mail client
//       that doesn't do the RFC 8058 POST opens the header URL in a browser;
//       answering with this function's JSON left that reader looking at
//       {"ok":true,"unsubscribed":false} and still subscribed. RFC 8058 says a
//       GET must not unsubscribe by itself (link scanners prefetch), so it goes
//       to the confirm page, which POSTs after the person confirms.
//
//   GET /functions/v1/unsubscribe?e=email&k=event_key   (fetch, no token)
//     → 200 { unsubscribed: boolean } — the preferences page's per-row read.
//
//   GET /functions/v1/unsubscribe?e=email&t=token&list=1
//     → 200 { ok: true, suppressed: (string | null)[] } — every event_key this
//       address has turned off (null = the global row), so the preferences page
//       can offer an undo for a key its list doesn't name. Token required: it
//       reads more than one yes/no.
//     → 400 { ok: false, error: 'token_invalid' }
//
// Two different URLs reach this function (audit 2026-09-23, findings 45/76):
//   • The List-Unsubscribe HEADER points HERE, at /functions/v1/unsubscribe
//     (_shared/email.ts buildOneClickUnsubscribeUrl). Gmail and Apple Mail's
//     own "Unsubscribe" POSTs `List-Unsubscribe=One-Click` to it with e/k/t in
//     the query and no JWT — why this function runs with verify_jwt = false.
//   • The FOOTER link points at the static mageid.app/unsubscribe page, which
//     asks the person to confirm and then POSTs JSON here.
// It used to say "we accept it on the same URL" — but the header carried the
// PAGE's URL, a GET-only static rewrite, so every inbox one-click 404'd and
// nothing was recorded while the mail app said "unsubscribed".
//
// BOTH directions require the signed token (t=). Re-subscribe because
// re-enabling someone's subscription is a "spam someone's inbox" vector;
// unsubscribe because an unsigned {email, event_key:null} would let anyone
// globally suppress an arbitrary address (invoices, dunning, COI warnings)
// with no UI ever showing it. Every link we mint — List-Unsubscribe header,
// the static /unsubscribe page and the /preferences page — carries the
// token, so only forged calls are blocked.
//
// Grace for links already in inboxes (review 2026-09-05): mail sent before the
// HMAC rotation carries the old 12-char FNV token. Until
// LEGACY_UNSUB_GRACE_UNTIL that token is ALSO accepted — for the unsubscribe
// direction only, never re-subscribe — after which the branch is dead code
// and must be deleted along with legacyFnvUnsubscribeToken in _shared/email.ts.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { legacyFnvUnsubscribeToken, unsubscribeSecretConfigured, verifyUnsubscribeToken, UNSUBSCRIBE_PAGE_URL } from "../_shared/email.ts";

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

/**
 * The confirm-page URL for a browser GET of the header URL. Only e / k / t are
 * carried over, onto a fixed host — the Location is never built from the
 * request's own URL, so this can't be turned into an open redirect.
 */
function confirmPageRedirect(url: URL): Response {
  const params = new URLSearchParams();
  for (const name of ['e', 'k', 't']) {
    const v = url.searchParams.get(name);
    if (v) params.set(name, v);
  }
  const qs = params.toString();
  return new Response(null, {
    status: 303,
    headers: { ...CORS_HEADERS, Location: qs ? `${UNSUBSCRIBE_PAGE_URL}?${qs}` : UNSUBSCRIBE_PAGE_URL },
  });
}

/** A GET that a person (or a mail client acting for one) opened, rather than
 *  the preferences page's own fetch: it carries the signed token the header
 *  URL has, or the browser asked for a page. list=1 is the preferences page's
 *  token-carrying fetch and keeps its JSON. */
function isBrowserOpenOfHeaderUrl(req: Request, url: URL): boolean {
  if (url.searchParams.get('list') === '1') return false;
  if (url.searchParams.has('t')) return true;
  return (req.headers.get('accept') || '').toLowerCase().includes('text/html');
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s.includes('@') || s.length > 320) return null;
  return s;
}

// ── Legacy-token grace (review 2026-09-05) — DELETE this block after the date ──
// 30 days from 2026-09-04. After this instant the pre-rotation FNV token is
// refused everywhere; delete LEGACY_UNSUB_GRACE_UNTIL, legacyUnsubscribeTokenAccepted,
// its call in the unsubscribe branch below, and legacyFnvUnsubscribeToken in
// _shared/email.ts (the ship-check reminds you once the date has passed).
const LEGACY_UNSUB_GRACE_UNTIL = Date.parse('2026-10-04T00:00:00Z');

/**
 * True only while the grace window is open AND the token is the pre-rotation
 * FNV token for this address. Used by the UNSUBSCRIBE direction only: a forged
 * legacy token (its seed is public) can at worst suppress someone's mail — the
 * user-protective direction — and can never re-subscribe anyone.
 */
function legacyUnsubscribeTokenAccepted(email: string, token: string): boolean {
  if (Date.now() >= LEGACY_UNSUB_GRACE_UNTIL) return false;
  const expected = legacyFnvUnsubscribeToken(email);
  if (expected.length !== token.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return r === 0;
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

/** Every event_key (null = global) suppressed for this address. */
async function listSuppressions(email: string): Promise<{ ok: true; keys: (string | null)[] } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/email_unsubscribes?email=eq.${encodeURIComponent(email)}&select=event_key&limit=200`, {
      headers: { 'apikey': SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { ok: false, error: `list ${r.status}: ${text.slice(0, 200)}` };
    }
    const rows = await r.json() as { event_key: string | null }[];
    return { ok: true, keys: (rows ?? []).map((row) => row.event_key ?? null) };
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
      // Before anything is read or written: a browser open of the header URL
      // goes to the confirm page (see the endpoint notes above).
      if (isBrowserOpenOfHeaderUrl(req, url)) return confirmPageRedirect(url);
      const email = normalizeEmail(url.searchParams.get('e'));
      const eventKey = url.searchParams.get('k');
      if (!email) return jsonResponse({ ok: false, error: 'missing_email' }, 400);
      if (url.searchParams.get('list') === '1') {
        // Every suppression row for this address — the preferences page's
        // catch-all (finding 172): a key missing from marketing/
        // email-event-keys.json must still be visible and re-enableable, or an
        // unsubscribe from it is one-way again. Current token only: the
        // pre-rotation legacy token is for the unsubscribe direction alone.
        if (!unsubscribeSecretConfigured()) {
          console.error('[unsubscribe] UNSUB_SECRET is not set — refusing every token');
          return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
        }
        const token = url.searchParams.get('t');
        if (!token || !verifyUnsubscribeToken(email, token)) {
          return jsonResponse({ ok: false, error: 'token_invalid' }, 400);
        }
        const listed = await listSuppressions(email);
        if (!listed.ok) {
          console.error('[unsubscribe] list failed', listed.error);
          return jsonResponse({ ok: false, error: 'server_error' }, 500);
        }
        return jsonResponse({ ok: true, suppressed: listed.keys });
      }
      const unsubscribed = await checkUnsubscribed(email, eventKey);
      return jsonResponse({ ok: true, unsubscribed });
    }

    if (req.method === "POST") {
      // Fail closed, loudly (audit OPS-F11): without UNSUB_SECRET no token can be
      // genuine, so answer 500 instead of a misleading 'token_invalid'.
      if (!unsubscribeSecretConfigured()) {
        console.error('[unsubscribe] UNSUB_SECRET is not set — refusing every token');
        return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500);
      }
      const url = new URL(req.url);
      let email: string | null = normalizeEmail(url.searchParams.get('e'));
      let eventKey: string | null = url.searchParams.get('k');
      let action: 'unsubscribe' | 'resubscribe' = 'unsubscribe';
      let token: string | null = url.searchParams.get('t');
      let source = 'one_click';

      const ct = (req.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/x-www-form-urlencoded')) {
        // The RFC 8058 one-click POST. Its body carries no address or token —
        // those come from the header URL's query — only the marker, which
        // names the source so an inbox unsubscribe can be told apart from a
        // page click in email_unsubscribes.
        const form = await req.text().catch(() => '');
        if (/(^|&)List-Unsubscribe=One-Click(&|$)/i.test(form)) source = 'list_unsubscribe_one_click';
      } else if (ct.includes('application/json')) {
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
          // A6 (review): the PostgREST detail stays in the log, not the body.
          console.error('[unsubscribe] resubscribe failed', result.error);
          return jsonResponse({ ok: false, error: 'server_error' }, 500);
        }
        return jsonResponse({ ok: true, action: 'resubscribed' });
      }

      // Default action: unsubscribe. SECURITY: require the signed token here
      // too. Without it, anyone could POST {email, event_key:null} and globally
      // suppress an arbitrary address (silently blocking all their invoices /
      // receipts / COI warnings). Every List-Unsubscribe link we generate
      // carries t=buildUnsubscribeToken(email) (see _shared/email.ts) and the
      // static marketing/unsubscribe page forwards it (review B2, 2026-09-04),
      // so Gmail one-click and the page both pass; only forged calls are blocked.
      // Links minted before the rotation carry the legacy FNV token — accepted
      // for THIS direction only, until LEGACY_UNSUB_GRACE_UNTIL.
      const currentToken = !!token && verifyUnsubscribeToken(email, token);
      const legacyToken = !currentToken && !!token && legacyUnsubscribeTokenAccepted(email, token);
      if (!currentToken && !legacyToken) {
        return jsonResponse({ ok: false, error: 'token_invalid' }, 400);
      }
      if (legacyToken) console.log('[unsubscribe] legacy pre-rotation token accepted (grace ends 2026-10-04)');
      const result = await recordUnsubscribe(email, eventKey ?? null, source);
      if (!result.ok) {
        console.error('[unsubscribe] failed', result.error);
        return jsonResponse({ ok: false, error: 'server_error' }, 500);
      }
      return jsonResponse({ ok: true, action: 'unsubscribed' });
    }

    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  } catch (e) {
    console.error('[unsubscribe] crash', e);
    return jsonResponse({ ok: false, error: 'server_error' }, 500);
  }
});
