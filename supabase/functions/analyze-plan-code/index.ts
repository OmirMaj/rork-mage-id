// analyze-plan-code
//
// Vision pre-check of ONE construction drawing for likely code issues
// (utils/planCodeReviewer.ts → this). Pro+ (requireTier), metered per call on
// `plan_code_review`.
//
// Review 2026-09-04 (B3 / A6 sibling): this relay sat outside the named list
// but is live from the app, so it gets the same shape as analyze-drawings —
// a fail-closed per-user hourly bucket BEFORE the monthly precheck, a bounded
// Gemini fetch (CORS 504 with spent=false on abort), the unit charged only
// once the model answered (AI-F8), and generic error bodies: the upstream
// status text and any raw model output stay in the server log (AI-F16).
//
// Secrets: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageGet, aiUsageIncrement, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MODEL = "gemini-2.5-flash";
function geminiEndpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
}

// B3 (review 2026-09-04): per-user hourly request ceiling + bounded upstream
// fetch. A hung socket returns a CORS-carrying 504 instead of the isolate dying
// at the wall clock; aborts and network failures are UpstreamErrors with
// spent=false (no model answer → no charge).
const HOURLY_LIMIT = 30;
const VISION_TIMEOUT_MS = 120_000;

// Audit AI-F16: upstream failures are reported to the client generically; the
// raw Gemini text (which can echo model output) stays in the server log.
// `spent` records whether the model actually answered (2xx) so the handler
// charges the monthly unit only when the spend was real (AI-F8).
class UpstreamError extends Error {
  constructor(message: string, readonly spent: boolean, readonly status = 502) {
    super(message);
    this.name = 'UpstreamError';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new UpstreamError(`upstream timed out after ${ms} ms`, false, 504);
    throw new UpstreamError(`upstream network error: ${(e as Error).message}`, false, 502);
  } finally {
    clearTimeout(timer);
  }
}

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

interface PlanCodeRequest {
  imageBase64: string;
  mimeType: string;
  location?: string;
  projectType?: string;
}

function buildPrompt(req: PlanCodeRequest): string {
  const loc = req.location?.trim() || "jurisdiction unknown";
  const ptype = req.projectType?.trim() || "residential/commercial construction";
  return [
    "You are a meticulous building-code plan reviewer. Review THIS construction drawing for LIKELY code issues a plan examiner would flag.",
    `Project location: ${loc}. Project type: ${ptype}.`,
    "Cite general IRC/IBC sections (and ADA where relevant). If the location is unknown, give general IRC/IBC guidance and do not invent local amendments.",
    "Only flag what you can ACTUALLY SEE in the drawing. Prefer fewer high-confidence findings over speculation. This is a PRE-CHECK the GC will verify against their AHJ — it is not a substitute for plan review.",
    "Return STRICT JSON of this exact shape and nothing else:",
    '{"findings":[{"category":"egress|stairs|width|height|fire|ada|guards|other","codeRef":"IRC/IBC section","requirement":"what code requires","observed":"what the drawing shows that conflicts","severity":"high|med|low","confidence":"high|med|low"}],"disclaimer":"one sentence reminding the GC to verify against the local code official"}',
    'If you see no likely issues, return {"findings":[],"disclaimer":"..."}.',
  ].join("\n");
}

function approxBase64Bytes(b64: string): number {
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

// Input is validated by the handler before this runs; everything thrown here
// is an UpstreamError so the handler can charge / report it uniformly.
async function callGemini(req: PlanCodeRequest): Promise<unknown> {
  const mimeType = req.mimeType && req.mimeType.startsWith("image/")
    ? req.mimeType.split(";")[0]
    : "image/png";
  const body = {
    contents: [{ parts: [
      { inlineData: { mimeType, data: req.imageBase64 } },
      { text: buildPrompt(req) },
    ] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 8192 },
  };
  const r = await fetchWithTimeout(`${geminiEndpoint()}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, VISION_TIMEOUT_MS);
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    // Upstream text stays server-side (AI-F16); not charged.
    throw new UpstreamError(`Gemini ${r.status}: ${errText.slice(0, 400)}`, false, 502);
  }
  // The model answered — the spend is real from here on (AI-F8).
  let json: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    json = await r.json();
  } catch {
    throw new UpstreamError("Gemini returned an unreadable response", true, 502);
  }
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!raw) throw new UpstreamError("Gemini returned no text", true, 502);
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Never echo `raw` — a length-only marker is enough to debug.
    throw new UpstreamError(`Could not parse AI response as JSON: ${(e as Error).message} (len=${raw.length})`, true, 502);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const auth = await requireTier(req, ["pro", "business"], "plan_code_review");
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  try {
    const body = await req.json() as PlanCodeRequest;
    if (!body || typeof body.imageBase64 !== "string" || !body.imageBase64) {
      return jsonResponse({ success: false, error: "Missing imageBase64" }, 400);
    }
    if (approxBase64Bytes(body.imageBase64) > MAX_PAGE_BYTES) {
      return jsonResponse({ success: false, error: "Image too large (max 8MB). Try a lower-resolution export." }, 413);
    }
    if (!GEMINI_API_KEY) {
      console.error("[analyze-plan-code] GEMINI_API_KEY not configured on the server");
      return jsonResponse({ success: false, error: "AI service not configured" }, 500);
    }

    // B3 (review 2026-09-04): per-user hourly request bucket, fail-CLOSED. Bounds
    // the precheck-then-charge window (N racing requests at cap-1) to at most
    // HOURLY_LIMIT model calls per user-hour whatever the client's concurrency;
    // master accounts included. rateLimitCount returns the POST-increment count,
    // so `n - 1 >= HOURLY_LIMIT` denies exactly the (HOURLY_LIMIT + 1)th request.
    const hourly = await rateLimitCount(`analyze-plan-code:user:${auth.userId}`);
    if (hourly < 0) return jsonResponse({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable' }, 503);
    if (hourly - 1 >= HOURLY_LIMIT) return jsonResponse({ success: false, error: `Hourly limit reached (${HOURLY_LIMIT} per hour). Try again in an hour.`, code: 'hourly_limit' }, 429);

    // Monthly cap PRECHECK (AI-F8: the unit is charged after the model answers
    // — see the success path and the UpstreamError branch below). aiUsageGet
    // fails CLOSED. Accepted window: N requests racing at cap-1 all pass this
    // read and each charges after, so one user's counter can overshoot the cap
    // by N-1 — never more.
    const cap = MONTHLY_CAPS[auth.tier].plan_code_review;
    const used = await aiUsageGet(auth.userId, "plan_code_review");
    if (used >= cap) {
      return jsonResponse({
        success: false,
        error: `Monthly plan-review limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
        code: "monthly_cap_reached",
        used,
        cap,
      }, 429);
    }

    const data = await callGemini(body);
    const newUsed = await aiUsageIncrement(auth.userId, "plan_code_review");
    return jsonResponse({ success: true, data, usage: { used: newUsed, cap } });
  } catch (e) {
    if (e instanceof UpstreamError) {
      // Charge only when the model actually answered (the spend is real even
      // if the answer was unusable); an upstream 5xx / timeout is free.
      if (e.spent) await aiUsageIncrement(auth.userId, "plan_code_review");
      console.error("[analyze-plan-code] upstream failure", e.message);
      return jsonResponse({ success: false, error: e.status === 504 ? 'The AI service timed out — please try again.' : 'The AI service returned an error — please try again.', code: e.status === 504 ? 'upstream_timeout' : 'upstream_error' }, e.status);
    }
    console.error("[analyze-plan-code] failed", e);
    return jsonResponse({ success: false, error: "Internal error — please try again." }, 500);
  }
});
