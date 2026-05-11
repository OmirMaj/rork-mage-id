// supabase/functions/webhook-dispatch/index.ts
//
// Fires an event payload to every enabled webhook endpoint subscribed
// to the event kind. Called by the app (or by Postgres triggers) when
// a high-value event happens.
//
// Request shape:
//   POST /functions/v1/webhook-dispatch
//   Headers: Authorization: Bearer <user_session_token>
//   Body: {
//     event: 'invoice_paid' | 'rfi_answered' | ...
//     data: { ... event-specific payload ... }
//   }
//
// Response: 200 with { dispatched: number, failed: number }
// Errors: 401 if not authenticated, 400 if missing event/data
//
// Security model:
//   - User must be authenticated to dispatch (their endpoints only)
//   - Each outbound POST includes HMAC signature so receivers can
//     verify authenticity: X-MAGE-Signature: sha256=<hex>
//   - Receiver computes: hmac(signing_secret, raw_body), compares
//
// Diagnostics: every fire updates last_fired_at / last_status /
// last_error / fire_count / fail_count on the endpoint row.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Allow-list of dispatchable events. Adding a new event kind here is
// the only place. Schema'd events let us version + filter; arbitrary
// event names would create receiver-side chaos.
const ALLOWED_EVENTS = new Set([
  'invoice_paid',
  'rfi_answered',
  'project_created',
  'subscription_purchased',
  'subscription_cancelled',
  'change_order_approved',
  'dfr_submitted',
  'bid_received',       // homeowner side
  'bid_submitted',      // GC side
  'permit_qa_used',
  'test',               // for the "Test webhook" button in Settings
]);

// Per-endpoint fire timeout. Webhooks must respond fast or we drop.
const FIRE_TIMEOUT_MS = 5_000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function hmacSign(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, { status: 405 });

  // Auth: user must be signed in. We use the user's JWT to scope the
  // endpoint query, so non-owners can't dispatch from someone else's
  // endpoints by guessing IDs.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthenticated' }, { status: 401 });

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userInfo, error: userErr } = await supabaseUser.auth.getUser(token);
  if (userErr || !userInfo?.user) return json({ error: 'unauthenticated' }, { status: 401 });
  const userId = userInfo.user.id;

  // Parse body
  let payload: { event?: string; data?: Record<string, unknown> } = {};
  try { payload = await req.json(); }
  catch { return json({ error: 'invalid_json' }, { status: 400 }); }

  const event = payload.event;
  const data = payload.data ?? {};
  if (!event || typeof event !== 'string') return json({ error: 'missing_event' }, { status: 400 });
  if (!ALLOWED_EVENTS.has(event)) return json({ error: 'event_not_allowed', event }, { status: 400 });

  // Service-role client for endpoint reads/writes (RLS bypass for the
  // fire path — we already verified ownership via user JWT above).
  const supabaseSvc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Find enabled endpoints owned by this user that subscribe to this
  // event (NULL event_filter = subscribe to all).
  const { data: endpoints, error: fetchErr } = await supabaseSvc
    .from('webhook_endpoints')
    .select('id, url, signing_secret, event_filter')
    .eq('user_id', userId)
    .eq('enabled', true);

  if (fetchErr) return json({ error: 'fetch_failed', detail: fetchErr.message }, { status: 500 });

  const matching = (endpoints ?? []).filter(e =>
    e.event_filter === null || (Array.isArray(e.event_filter) && e.event_filter.includes(event)),
  );

  if (matching.length === 0) return json({ dispatched: 0, failed: 0, matching: 0 });

  // Build the outbound payload once
  const outboundBody = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data,
    source: 'mage-id',
    version: '1',
  });

  let dispatched = 0;
  let failed = 0;

  // Fire to each endpoint in parallel
  await Promise.all(matching.map(async (ep) => {
    const sig = await hmacSign(ep.signing_secret, outboundBody);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FIRE_TIMEOUT_MS);
    let status = 0;
    let errMsg: string | null = null;
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MAGE-Event': event,
          'X-MAGE-Signature': `sha256=${sig}`,
          'User-Agent': 'MAGE-ID-Webhooks/1.0',
        },
        body: outboundBody,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      status = res.status;
      if (res.status >= 200 && res.status < 300) {
        dispatched += 1;
      } else {
        failed += 1;
        errMsg = `HTTP ${res.status}`;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      failed += 1;
      errMsg = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
    }

    // Update diagnostics — best-effort, no await-throw
    void supabaseSvc.from('webhook_endpoints').update({
      last_fired_at: new Date().toISOString(),
      last_status: status,
      last_error: errMsg,
      fire_count: 1, // upsert-style increment handled by Postgres
      fail_count: errMsg ? 1 : 0,
    }).eq('id', ep.id);
  }));

  return json({ dispatched, failed, matching: matching.length });
});
