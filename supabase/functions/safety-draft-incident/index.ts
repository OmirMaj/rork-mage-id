// safety-draft-incident
//
// Voice transcript / notes (+ optional site photos) → structured SafetyIncident
// draft { type, severity, description, location, correctiveActions[] } for the
// user to confirm before saving. Business-tier gated; metered against the
// safety_ai monthly cap (text). Optional photos are SSRF-validated + fed to the
// model on the same text meter. Fail-closed: on error the user keeps the manual
// incident form.
//
// Request: { voiceTranscript?, notes?, photoUrls?: string[] }.

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

interface DraftIncidentRequest {
  voiceTranscript?: string;
  notes?: string;
  photoUrls?: string[];
}

interface CorrectiveActionOut { action: string; owner: string; }
interface IncidentDraftOut {
  type: 'injury' | 'near_miss' | 'property' | 'environmental';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  location: string;
  correctiveActions: CorrectiveActionOut[];
}

const INCIDENT_PROMPT = `You are a construction safety manager turning a field report (spoken/typed notes, plus any photos) into a structured incident record. Classify and summarize.

Return a single JSON object:
{
  "type": "injury" | "near_miss" | "property" | "environmental",
  "severity": "low" | "medium" | "high" | "critical",
  "description": "objective factual summary of what happened (<=600 chars, no blame language)",
  "location": "where on site (<=100 chars, empty if unknown)",
  "correctiveActions": [ { "action": "specific corrective/preventive action (<=160 chars)", "owner": "role responsible, e.g. Site Super (empty if unknown)" } ]
}

Rules:
- Choose type by whether a person was hurt (injury), almost hurt (near_miss), only property was damaged (property), or a spill/environmental release occurred (environmental).
- 1-4 corrective actions. Return JSON only — no preamble.`;

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

  const auth = await requireTier(req, ['business'], 'safety_draft_incident');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: DraftIncidentRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const transcript = String(body.voiceTranscript ?? '').slice(0, 4000);
  const notes = String(body.notes ?? '').slice(0, 2000);
  const hasPhotos = Array.isArray(body.photoUrls) && body.photoUrls.length > 0;
  if (!transcript.trim() && !notes.trim() && !hasPhotos) {
    return jsonResponse({ success: false, error: 'Provide voiceTranscript, notes, or photoUrls' }, 400);
  }

  // B3 (review 2026-09-04): per-user hourly request bucket, fail-CLOSED. Bounds
  // the precheck-then-charge window (N racing requests at cap-1) to at most
  // HOURLY_LIMIT model calls per user-hour whatever the client's concurrency;
  // master accounts included. rateLimitCount returns the POST-increment count,
  // so `n - 1 >= HOURLY_LIMIT` denies exactly the (HOURLY_LIMIT + 1)th request.
  const hourly = await rateLimitCount(`safety-draft-incident:user:${auth.userId}`);
  if (hourly < 0) return jsonResponse({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable' }, 503);
  if (hourly - 1 >= HOURLY_LIMIT) return jsonResponse({ success: false, error: `Hourly limit reached (${HOURLY_LIMIT} per hour). Try again in an hour.`, code: 'hourly_limit' }, 429);
  // Read the current count first and deny an over-cap request WITHOUT
  // persisting an increment, so rejected retries don't climb the counter;
  // increment only when we're actually going to call Gemini.
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

  const ctxLine = [
    transcript ? `Spoken report: ${transcript}` : null,
    notes ? `Notes: ${notes}` : null,
  ].filter(Boolean).join('\n');
  const parts: Record<string, unknown>[] = [{ text: `${ctxLine}\n\n${INCIDENT_PROMPT}` }];

  if (hasPhotos) {
    const urls = body.photoUrls!.slice(0, 6);
    for (const u of urls) {
      try { validateFetchableUrl(u); }
      catch { return jsonResponse({ success: false, error: 'One or more photo URLs are not allowed.' }, 400); }
    }
    const fetched = await Promise.allSettled(urls.map(fetchAsBase64));
    for (const r of fetched) {
      if (r.status === 'fulfilled') parts.push({ inline_data: { mime_type: r.value.mimeType, data: r.value.data } });
    }
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VISION_TIMEOUT_MS);
  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1200 },
      }),
      signal: ac.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return jsonResponse({ success: false, error: 'The AI service timed out — please try again.', code: 'upstream_timeout' }, 504);
    }
    console.error('[safety-draft-incident] Gemini network error:', (e as Error).message);
    return jsonResponse({ success: false, error: 'The AI service is unreachable — please try again.', code: 'upstream_error' }, 502);
  } finally {
    clearTimeout(timer);
  }
  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    // Upstream text stays server-side (audit AI-F16); not charged.
    console.error(`[safety-draft-incident] Gemini ${geminiResp.status}: ${text.slice(0, 300)}`);
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
    console.log(`[safety-draft-incident] non-JSON Gemini output (len=${raw.length})`);
    return jsonResponse({ success: false, error: 'The AI returned an unreadable answer — please try again.' }, 500);
  }

  const o = (parsed ?? {}) as Record<string, unknown>;
  const VALID_TYPES = ['injury', 'near_miss', 'property', 'environmental'];
  const VALID_SEV = ['low', 'medium', 'high', 'critical'];
  const rawActions = Array.isArray(o.correctiveActions) ? o.correctiveActions : [];
  const draft: IncidentDraftOut = {
    type: (VALID_TYPES.includes(String(o.type)) ? o.type : 'near_miss') as IncidentDraftOut['type'],
    severity: (VALID_SEV.includes(String(o.severity)) ? o.severity : 'low') as IncidentDraftOut['severity'],
    description: String(o.description ?? '').slice(0, 800),
    location: String(o.location ?? '').slice(0, 120),
    correctiveActions: rawActions.map((a): CorrectiveActionOut => {
      const r = (a ?? {}) as Record<string, unknown>;
      return { action: String(r.action ?? '').slice(0, 200), owner: String(r.owner ?? '').slice(0, 120) };
    }).filter((a) => a.action.length > 0),
  };

  return jsonResponse({ success: true, data: draft });
});
