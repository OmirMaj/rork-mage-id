// schedule-ical-url — Phase 27.
//
// Companion to schedule-ical. Called by authenticated app users to get a
// signed calendar feed URL they can subscribe to or share.
//
// Auth: standard JWT (verify_jwt: true — the default).
// Method: POST  { scheduleId: string }
// Response: { url: string, webcalUrl: string }
//
// Deploy: supabase functions deploy schedule-ical-url
//
// The returned `url` is an https:// link pointing at the schedule-ical
// function (for Google Calendar / Outlook).
// The returned `webcalUrl` uses the webcal:// scheme (for Apple Calendar
// on iOS/macOS — tapping it opens the native Subscribe dialog).

import { verifyUser } from '../_shared/verifyUser.ts';

// No literal fallback (audit OPS-F11 / AUTH-F13) — see schedule-ical. Unset →
// 500 with a clear message from the handler.
const SECRET = Deno.env.get('SCHEDULE_ICAL_SECRET') ?? '';

async function signToken(scheduleId: string, userId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${scheduleId}:${userId}`));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return b64.slice(0, 16);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  if (!SECRET) {
    return new Response('SCHEDULE_ICAL_SECRET is not configured on the server — calendar feeds are disabled until it is set', { status: 500, headers: CORS });
  }

  // Cryptographically verify the caller (audit EDGE-F14). The previous bare
  // claims decode trusted whatever `sub` the token carried and depended on the
  // gateway's verify_jwt flag — which the deploy runbooks kept flipping.
  const verified = await verifyUser(req);
  if (!verified?.id) {
    return new Response('Unauthorized', { status: 401, headers: CORS });
  }
  const userId = verified.id;

  let body: { scheduleId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: CORS });
  }

  const { scheduleId } = body;
  if (!scheduleId) {
    return new Response('Missing scheduleId in body', { status: 400, headers: CORS });
  }

  // OWNERSHIP (SECURITY). scheduleId == projectId and the caller supplies it.
  // Without this check any authenticated user could mint a valid feed token for
  // ANOTHER user's project (the token binds their own uid, so the HMAC passes)
  // and read that project's entire schedule. Only the project owner may mint.
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE_KEY =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/projects?id=eq.${encodeURIComponent(scheduleId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    const rows = r.ok ? await r.json() : [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response('Forbidden: not your project', { status: 403, headers: CORS });
    }
  } catch {
    return new Response('Ownership check failed', { status: 500, headers: CORS });
  }

  const token = await signToken(scheduleId, userId);

  // Build the edge function base URL from the Supabase project URL.
  // SUPABASE_URL is "https://<ref>.supabase.co"; functions live at
  // "<ref>.functions.supabase.co".
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const fnBase = supabaseUrl
    .replace(/^https?:\/\//, '')
    .replace('.supabase.co', '.functions.supabase.co');

  const params = `sid=${encodeURIComponent(scheduleId)}&uid=${encodeURIComponent(userId)}&t=${token}`;
  const url = `https://${fnBase}/schedule-ical?${params}`;
  const webcalUrl = `webcal://${fnBase}/schedule-ical?${params}`;

  return new Response(JSON.stringify({ url, webcalUrl }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
