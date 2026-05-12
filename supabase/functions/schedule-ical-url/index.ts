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

const SECRET =
  Deno.env.get('SCHEDULE_ICAL_SECRET') ?? 'mage-id-ical-fallback-rotate-on-leak';

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

  const auth = req.headers.get('authorization');
  if (!auth) {
    return new Response('Unauthorized', { status: 401, headers: CORS });
  }

  // Decode the JWT payload (no verification needed — Supabase gateway
  // already verified the signature when verify_jwt: true).
  let userId: string | undefined;
  try {
    const jwtPayload = JSON.parse(atob(auth.replace(/^Bearer\s+/i, '').split('.')[1]));
    userId = jwtPayload.sub;
  } catch {
    return new Response('Bad token', { status: 401, headers: CORS });
  }

  if (!userId) {
    return new Response('No user id in token', { status: 401, headers: CORS });
  }

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
