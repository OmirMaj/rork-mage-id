// transcribe-audio — MAGE-owned speech-to-text proxy.
//
// WHY THIS EXISTS
// The app records audio (VoiceCaptureModal, OAC meeting upload) and needs
// it transcribed. Historically the client POSTed the audio DIRECTLY to a
// third-party STT service, which meant that vendor's hostname shipped in
// the JS bundle and showed up in a browser's Network tab. This proxy moves
// that call server-side: the client now uploads to a mageid.app-owned
// Supabase Function URL, and WE forward it to the STT provider. The vendor
// endpoint never appears in the shipped client bundle again.
//
// SECURITY
// Deployed with verify_jwt=TRUE (Supabase default — do NOT pass
// --no-verify-jwt). Only a signed-in MAGE user can reach this function, so
// nobody can burn our STT quota anonymously. The upstream provider URL and
// any future provider credentials live ONLY here, on the server.
//
// SHAPE
// Request:  multipart/form-data with an `audio` field (uri/File), exactly
//           what the old direct call sent.
// Response: the upstream JSON relayed verbatim — `{ text, ... }`.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { verifyUser } from '../_shared/verifyUser.ts';
import { rateLimitCount } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// The STT provider. Kept server-side so it never lands in the client bundle.
// Swapping providers later (e.g. to a first-party model) is a one-line change
// here with zero client/OTA churn.
const STT_ENDPOINT = 'https://toolkit.rork.com/stt/transcribe/';

// Upstream tops out around 40 MB; reject bigger uploads before we buffer
// them, matching the guidance the OAC screen already shows the user.
// Size cap in context: VoiceCaptureModal records 16 kHz / 16-bit mono WAV
// (32 KB/s), so 40 MB ≈ 21 minutes of audio; the OAC upload path is the
// only surface that gets near it. With the hourly quota below, one account
// can relay at most 60 × 40 MB = 2.4 GB/h to the vendor in the worst case.
const MAX_BYTES = 40 * 1024 * 1024;
// Audit EDGE-F14 / AI-F14: per-user hourly quota (transcriptions per hour).
const UPLOADS_PER_HOUR = 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed. POST audio as multipart/form-data.' }, 405);
  }

  // Audit EDGE-F14: this proxy had NO in-code identity check — it relied on
  // the gateway's verify_jwt flag alone. Verify the caller with GoTrue, then
  // apply a per-user hourly quota so one account cannot relay unlimited 40 MB
  // uploads to the paid STT vendor. The limiter fails OPEN (-1 = RPC
  // unavailable): the JWT gate still holds and one upload is bounded by
  // MAX_BYTES.
  const user = await verifyUser(req);
  if (!user?.id) return json({ error: 'Sign in is required to transcribe audio.' }, 401);
  const uploads = await rateLimitCount(`stt:user:${user.id}`);
  // Post-increment count: `uploads - 1 >= LIMIT` denies exactly the (LIMIT+1)th.
  if (uploads - 1 >= UPLOADS_PER_HOUR) {
    return json({ error: `Transcription limit reached (${UPLOADS_PER_HOUR} uploads per hour). Try again in an hour.` }, 429);
  }

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ error: 'Expected multipart/form-data with an "audio" field.' }, 400);
  }

  // Read the raw multipart body and forward it byte-for-byte with the same
  // content-type (which carries the multipart boundary). Re-encoding here
  // would risk corrupting the boundary; a verbatim relay is the safe path.
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch (err) {
    return json({ error: `Could not read upload. ${err instanceof Error ? err.message : ''}`.trim() }, 400);
  }
  if (body.byteLength === 0) {
    return json({ error: 'Empty upload — no audio received.' }, 400);
  }
  if (body.byteLength > MAX_BYTES) {
    return json(
      { error: 'Audio too large. Max 40 MB — split a long recording into chunks and upload them one at a time.' },
      413,
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(STT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
  } catch (err) {
    return json({ error: `Transcription service unreachable. ${err instanceof Error ? err.message : ''}`.trim() }, 502);
  }

  const text = await upstream.text().catch(() => '');
  if (!upstream.ok) {
    // Vendor error text stays server-side (audit AI-F16 class).
    console.error(`[transcribe-audio] upstream ${upstream.status}: ${text.slice(0, 200)}`);
    return json({ error: `Transcription upstream returned ${upstream.status}.` }, 502);
  }

  // Upstream returns JSON (`{ text }` / `{ transcript }`). Relay it as-is so
  // the client keeps reading the same fields it always has.
  return new Response(text || '{}', {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
