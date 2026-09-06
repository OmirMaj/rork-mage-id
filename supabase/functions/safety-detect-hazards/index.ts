// safety-detect-hazards
//
// Site photo(s) → candidate hazards { description, severity, likelihood }[] to
// prefill the Hazard Log. Reuses the analyze-photos vision pattern. Business-
// tier gated; metered against the dedicated `safety_ai` monthly cap — shared
// with the other safety AI functions and isolated from the unrelated
// analyze-photos feature, so safety usage has one clearly-labeled ceiling.
// Every photo URL is validated through validateFetchableUrl BEFORE any fetch
// (SSRF guard). Fail-closed: on error the user keeps the manual hazard form.
//
// Request: { photoUrls: string[] } OR { photos: [{ base64, mimeType? }] }.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, aiUsageGet, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";
import { validateFetchableUrl } from "../_shared/urlGuard.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// B3 (review 2026-09-04): per-user hourly request ceiling + bounded upstream fetch.
const HOURLY_LIMIT = 30;
const VISION_TIMEOUT_MS = 120_000;

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

interface DetectHazardsRequest {
  photoUrls?: string[];
  photos?: { base64: string; mimeType?: string }[];
}

interface HazardOut {
  description: string;
  severity: number;
  likelihood: number;
}

const HAZARD_PROMPT = `You are a construction safety inspector reviewing job-site photos. Identify visible safety hazards (fall exposure, missing guardrails, unsafe ladders, exposed rebar, housekeeping/trip hazards, electrical, missing PPE, unshored trenches, fire/flammables, etc.).

Return a JSON array; each item:
  - description: specific hazard (<=140 chars). "Unguarded floor opening near stair core" not "fall hazard".
  - severity: integer 1-5 (1 minor first-aid, 5 fatal/permanent).
  - likelihood: integer 1-5 (1 rare, 5 almost certain given current conditions).

Only include real, visible hazards. Return an empty array if the photos show none. Return JSON only — no preamble.`;

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const safeUrl = validateFetchableUrl(url);
  const r = await fetch(safeUrl);
  if (!r.ok) throw new Error(`Fetch image failed: ${r.status}`);
  const mimeType = r.headers.get('content-type') ?? 'image/jpeg';
  const buf = await r.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { data: btoa(binary), mimeType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  const auth = await requireTier(req, ['business'], 'safety_detect_hazards');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: DetectHazardsRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const usingInline = Array.isArray(body.photos) && body.photos.length > 0;
  const usingUrls = Array.isArray(body.photoUrls) && body.photoUrls.length > 0;
  if (!usingInline && !usingUrls) {
    return jsonResponse({ success: false, error: 'Either photos[] (inline base64) or photoUrls[] required' }, 400);
  }
  const inputCount = usingInline ? body.photos!.length : body.photoUrls!.length;
  if (inputCount > 8) return jsonResponse({ success: false, error: 'Max 8 photos per call' }, 400);

  let goodPhotos: { data: string; mimeType: string }[] = [];
  if (usingInline) {
    const MAX_PER = 6 * 1024 * 1024;
    for (let i = 0; i < body.photos!.length; i++) {
      const p = body.photos![i];
      if (!p || typeof p.base64 !== 'string' || p.base64.length === 0) {
        return jsonResponse({ success: false, error: `Photo ${i} missing base64 data` }, 400);
      }
      if (p.base64.length > MAX_PER) {
        return jsonResponse({ success: false, error: `Photo ${i} too large. Use ~1200×1600 px.` }, 413);
      }
    }
    goodPhotos = body.photos!.map((p) => ({ data: p.base64, mimeType: p.mimeType || 'image/jpeg' }));
  } else {
    // SSRF guard: validate EVERY URL before any fetch; generic 400 on rejection.
    for (const u of body.photoUrls!) {
      try { validateFetchableUrl(u); }
      catch { return jsonResponse({ success: false, error: 'One or more photo URLs are not allowed.' }, 400); }
    }
    const fetched = await Promise.allSettled(body.photoUrls!.map(fetchAsBase64));
    goodPhotos = fetched
      .map((r) => r.status === 'fulfilled' ? r.value : null)
      .filter((x): x is { data: string; mimeType: string } => x !== null);
  }
  if (goodPhotos.length === 0) return jsonResponse({ success: false, error: 'Could not load any of the supplied photos' }, 400);

  // B3 (review 2026-09-04): per-user hourly request bucket, fail-CLOSED. Bounds
  // the precheck-then-charge window (N racing requests at cap-1) to at most
  // HOURLY_LIMIT model calls per user-hour whatever the client's concurrency;
  // master accounts included. rateLimitCount returns the POST-increment count,
  // so `n - 1 >= HOURLY_LIMIT` denies exactly the (HOURLY_LIMIT + 1)th request.
  const hourly = await rateLimitCount(`safety-detect-hazards:user:${auth.userId}`);
  if (hourly < 0) return jsonResponse({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable' }, 503);
  if (hourly - 1 >= HOURLY_LIMIT) return jsonResponse({ success: false, error: `Hourly limit reached (${HOURLY_LIMIT} per hour). Try again in an hour.`, code: 'hourly_limit' }, 429);
  // Meter only now that a model call is certain (input validated + at least one
  // photo loaded). Read the current count first and deny an over-cap request
  // WITHOUT persisting an increment, so rejected retries don't climb the
  // counter; increment only when we're actually going to call Gemini.
  const cap = MONTHLY_CAPS[auth.tier].safety_ai;
  const used = await aiUsageGet(auth.userId, 'safety_ai');
  if (used >= cap) {
    return jsonResponse({
      success: false,
      error: `Monthly safety-AI limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached', used, cap,
    }, 429);
  }
  // The unit is charged AFTER Gemini answers (audit AI-F8) — see below.

  const parts: Record<string, unknown>[] = [{ text: HAZARD_PROMPT }];
  for (const p of goodPhotos) parts.push({ inline_data: { mime_type: p.mimeType, data: p.data } });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VISION_TIMEOUT_MS);
  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1500 },
      }),
      signal: ac.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return jsonResponse({ success: false, error: 'The AI service timed out — please try again.', code: 'upstream_timeout' }, 504);
    }
    console.error('[safety-detect-hazards] Gemini network error:', (e as Error).message);
    return jsonResponse({ success: false, error: 'The AI service is unreachable — please try again.', code: 'upstream_error' }, 502);
  } finally {
    clearTimeout(timer);
  }
  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    // Upstream text stays server-side (audit AI-F16); not charged.
    console.error(`[safety-detect-hazards] Gemini ${geminiResp.status}: ${text.slice(0, 300)}`);
    return jsonResponse({ success: false, error: 'The AI service returned an error — please try again.', code: 'upstream_error' }, 502);
  }
  // The model answered — the spend is real; charge the safety_ai unit now.
  await aiUsageIncrement(auth.userId, 'safety_ai');

  let j: unknown;
  try { j = await geminiResp.json(); } catch { return jsonResponse({ success: false, error: 'Gemini returned non-JSON' }, 502); }
  const raw = (j as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: unknown;
  // Never echo `raw` (audit AI-F16) — an incident/JHA draft can carry names.
  try { parsed = JSON.parse(raw); } catch {
    console.log(`[safety-detect-hazards] non-JSON Gemini output (len=${raw.length})`);
    return jsonResponse({ success: false, error: 'The AI returned an unreadable answer — please try again.' }, 500);
  }
  if (!Array.isArray(parsed)) return jsonResponse({ success: false, error: 'Expected array of hazards' }, 500);

  const clampScale = (v: unknown) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(5, n));
  };
  const hazards: HazardOut[] = (parsed as unknown[])
    .map((x): HazardOut => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        description: String(o.description ?? '').slice(0, 200),
        severity: clampScale(o.severity),
        likelihood: clampScale(o.likelihood),
      };
    })
    .filter((h) => h.description.length > 0);

  return jsonResponse({ success: true, data: { hazards } });
});
