// analyze-drawings
//
// Takes a list of construction drawing page image URLs (from the existing
// PDF→PNG pipeline) and calls Gemini's vision API to produce a structured
// estimate with explicit reasoning + areas of concern. Designed for full
// transparency: the GC sees exactly what the AI looked at, what it inferred,
// and what to double-check before relying on the numbers.
//
// Secrets required:
//   GEMINI_API_KEY — Google AI Studio key (https://aistudio.google.com/)
//
// Request body:
// {
//   pageUrls: string[];          // 1..N publicly fetchable PNG URLs
//   projectName?: string;
//   projectType?: string;        // 'renovation' | 'new construction' | etc.
//   squareFootage?: number;
//   location?: string;
//   quality?: 'standard' | 'premium' | 'luxury';
//   notes?: string;              // anything the GC wants the AI to consider
// }
//
// Response:
// {
//   success: boolean;
//   data?: { ...DrawingAnalysisResult },
//   error?: string;
// }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, aiUsageGet, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";
import { validateFetchableUrl, UrlValidationError } from "../_shared/urlGuard.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

// Audit AI-F16: upstream failures are reported to the client generically; the
// raw Gemini/Anthropic text (which can echo model output) stays in the server
// log. `spent` records whether the model actually answered (2xx) so the
// handler charges the monthly unit only when the spend was real (AI-F8).
class UpstreamError extends Error {
  constructor(message: string, readonly spent: boolean, readonly status = 502) {
    super(message);
    this.name = 'UpstreamError';
  }
}

// B3 (review 2026-09-04): per-user hourly request ceiling + bounded upstream
// fetch. A hung socket returns a CORS-carrying 504 instead of the isolate dying
// at the wall clock; aborts and network failures are UpstreamErrors with
// spent=false (no model answer → no charge).
const HOURLY_LIMIT = 30;
const VISION_TIMEOUT_MS = 120_000;

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

// Hard input limits — defense against DoS / token-bombing. The UI pipeline
// renders 144-DPI letter-size pages so each PNG is ~1–3 MB. We cap at
// 16 pages (already in callGemini) and 8 MB per page so a forged client
// can't burn server memory or Gemini tokens. 16 pages × 8 MB = 128 MB
// peak per request, which is fine for the function's memory budget.
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
// Default to Gemini 2.5 Flash — fast + cheap. The client can opt into
// gemini-2.5-pro for higher-tier subscriptions (better at reading dense
// drawings + reasoning about quantity takeoffs).
type ModelKey = 'gemini-2.5-flash' | 'gemini-2.5-pro';
const ALLOWED_MODELS: ModelKey[] = ['gemini-2.5-flash', 'gemini-2.5-pro'];
const DEFAULT_MODEL: ModelKey = 'gemini-2.5-flash';
function geminiEndpoint(model: ModelKey): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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

interface AnalyzeRequest {
  pageUrls: string[];
  projectName?: string;
  projectType?: string;
  squareFootage?: number;
  location?: string;
  quality?: 'standard' | 'premium' | 'luxury';
  notes?: string;
  /**
   * Which Gemini model to use. The client picks based on the user's
   * subscription tier — Pro tier = flash, Business = pro.
   * Allowed values are validated; anything else falls back to flash.
   */
  model?: ModelKey;
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function urlToInlineImagePart(url: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  // Gemini's REST API takes either inlineData (base64) or fileData (URI).
  // We use inlineData because the rendered PNGs live in our public-read
  // bucket — fetching once + base64-encoding is reliable across regions.
  // Send a real User-Agent because some image hosts (Wikimedia, etc.)
  // block fetches with a default Deno UA as anti-hotlinking.
  // SSRF guard: only fetch https URLs on the app's own Supabase storage
  // host — throws UrlValidationError (→ generic 400) for anything else.
  const safeUrl = validateFetchableUrl(url);
  const r = await fetch(safeUrl, {
    headers: {
      'User-Agent': 'MAGE-ID/1.0 (drawing-analyzer; +https://mageid.app)',
      'Accept': 'image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
    },
  });
  if (!r.ok) throw new Error(`Could not fetch ${url} (${r.status})`);
  const contentType = r.headers.get('content-type') ?? 'image/png';
  // Lock to the actually-detected mime so JPEGs from non-Supabase sources
  // don't get mislabeled as png and rejected by Gemini's vision pipeline.
  const mimeType = contentType.startsWith('image/') ? contentType.split(';')[0] : 'image/png';
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_PAGE_BYTES) {
    throw new Error(`Page too large: ${(buf.length / 1024 / 1024).toFixed(1)}MB (max 8MB).`);
  }
  // Base64-encode without blowing the stack on big images.
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const data = btoa(binary);
  return { inlineData: { mimeType, data } };
}

function buildPrompt(req: AnalyzeRequest): string {
  const { projectName, projectType, squareFootage, location, quality, notes } = req;
  const ctxLines: string[] = [];
  if (projectName) ctxLines.push(`Project: ${projectName}`);
  if (projectType) ctxLines.push(`Project type: ${projectType}`);
  if (squareFootage) ctxLines.push(`Square footage: ${squareFootage.toLocaleString()} sq ft`);
  if (location) ctxLines.push(`Location: ${location}`);
  if (quality) ctxLines.push(`Quality tier: ${quality}`);
  if (notes) ctxLines.push(`GC notes: ${notes}`);
  const ctxBlock = ctxLines.length ? `\n${ctxLines.join('\n')}\n` : '';

  return `You are an experienced construction estimator reviewing the attached drawing pages. Produce a starting-point estimate the contractor can refine.
${ctxBlock}
APPROACH (you MUST follow this and report it back to the user):
1. For EACH page, identify what type of drawing it is (floor plan, elevation, section, MEP, schedule, etc.) and what scope it conveys.
2. Pull dimensions, room counts, ceiling heights, and material callouts you can read clearly. Note where the drawing is fuzzy or partially out-of-frame.
3. Use industry-standard unit prices for the project's region (United States default if no location is given).
4. Build a CSI-Division-organized line-item estimate covering only what the drawings show. Don't fabricate items you can't justify from a drawing.
5. Apply a contingency of 8-12% (the more uncertainty, the higher).

OUTPUT (JSON only, matching the schema below):

{
  "summary": "1-2 sentence overall description of what these drawings represent.",
  "drawingsSeen": [
    {
      "page": 1,
      "type": "Floor plan / Elevation / Section / MEP / Schedule / Other",
      "scope": "What the page shows in 1 sentence.",
      "readability": "clear" | "partial" | "poor",
      "keyDimensions": ["any dimensions, room sizes, etc. you read"]
    }
  ],
  "estimatedSquareFootage": number | null,
  "lineItems": [
    {
      "category": "Site Work / Concrete / Masonry / Metals / Wood / Thermal & Moisture / Doors & Windows / Finishes / Specialties / Equipment / Furnishings / Plumbing / HVAC / Electrical / General Conditions / Permits & Fees / Contingency",
      "name": "Brief item name (e.g. 'Drywall - 1/2\" gypsum')",
      "description": "What this includes",
      "quantity": number,
      "unit": "sf | lf | ea | cy | etc",
      "unitPrice": number,    // USD
      "total": number,        // quantity * unitPrice
      "sourcePages": [1, 2],  // which pages drove this estimate
      "confidence": "high" | "medium" | "low",
      "reasoning": "1 sentence — why you picked this quantity / unit price"
    }
  ],
  "totals": {
    "subtotal": number,
    "contingencyPercent": number,
    "contingencyAmount": number,
    "grandTotal": number
  },
  "concerns": [
    {
      "severity": "minor" | "moderate" | "critical",
      "topic": "Short headline (e.g. 'Foundation depth not visible')",
      "detail": "1-2 sentences — why this matters",
      "recommendation": "What the GC should do (request RFI, add allowance, get sub bid, etc.)"
    }
  ],
  "doubleCheck": [
    "Concrete cubic yards — page 2 dimensions are partially obscured",
    "Window quantities — schedule on page 4 shows abbreviations only"
  ],
  "missingScopes": [
    "Mechanical drawings not included",
    "Site survey / topo not provided"
  ],
  "confidenceOverall": "high" | "medium" | "low",
  "confidenceExplanation": "1 sentence — what drove the overall confidence rating"
}

CRITICAL RULES:
- Return JSON only. No markdown fences, no commentary outside the JSON.
- If you can't determine a quantity, mark its confidence "low" and add a doubleCheck entry.
- Always include at least one concern. If everything is clear, say so explicitly.
- Always populate "drawingsSeen" — that's how the user verifies you actually looked.
- The contractor will VERIFY EVERY NUMBER before sending. Lean conservative on quantities.`;
}

// ─── Gemini call ──────────────────────────────────────────────────────

async function callGemini(req: AnalyzeRequest): Promise<{ data: unknown; modelUsed: ModelKey }> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured on the server.');
  if (!req.pageUrls || req.pageUrls.length === 0) throw new Error('No page URLs provided.');
  if (req.pageUrls.length > 16) throw new Error('Maximum 16 pages per request — split larger sets.');

  // Validate the requested model; fall back to default if unrecognized.
  const requested = req.model ?? DEFAULT_MODEL;
  const modelUsed: ModelKey = ALLOWED_MODELS.includes(requested) ? requested : DEFAULT_MODEL;

  // Fetch all pages in parallel and base64-encode for inline transmission.
  const imageParts = await Promise.all(req.pageUrls.map(urlToInlineImagePart));

  // Both tiers get enough headroom for a full estimate — Flash was
  // hitting the 8K cap and truncating mid-JSON. Pro gets a bit more
  // since it tends to write more verbose reasoning per line item.
  const maxOutputTokens = modelUsed === 'gemini-2.5-pro' ? 32768 : 16384;

  const body = {
    contents: [{
      parts: [
        ...imageParts,
        { text: buildPrompt(req) },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens,
    },
  };

  const r = await fetchWithTimeout(`${geminiEndpoint(modelUsed)}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, VISION_TIMEOUT_MS);
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new UpstreamError(`Gemini ${r.status}: ${errText.slice(0, 400)}`, false);
  }
  const json = await r.json();
  // Gemini wraps the response in candidates[0].content.parts[0].text
  // Even with responseMimeType:'application/json', the output is still a
  // JSON-encoded STRING — parse it.
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new UpstreamError('Gemini returned no text.', true);
  try {
    const parsed = JSON.parse(raw);
    return { data: parsed, modelUsed };
  } catch (e) {
    throw new UpstreamError(`Could not parse AI response as JSON: ${(e as Error).message}\nRaw: ${raw.slice(0, 400)}`, true);
  }
}

// ─── Server ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  // Server-side paywall: the AI estimate wizard is Pro/Business only.
  // Without this gate, anyone with the function URL could curl us for
  // free Gemini Vision calls. Audit found this was the highest-risk
  // bypass in the codebase.
  const auth = await requireTier(req, ['pro', 'business'], 'analyze_drawings');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  try {
    const body = await req.json() as AnalyzeRequest;
    if (!body || !Array.isArray(body.pageUrls)) {
      return jsonResponse({ success: false, error: 'Missing pageUrls' }, 400);
    }
    // gemini-2.5-pro is Business AND Enterprise only — the model field is
    // client-supplied and the UI sets it from the user's tier, but a forged
    // client could pick pro on a Pro tier subscription. Force-downgrade on
    // the server. Previously this used `tier !== 'business'` which silently
    // demoted Enterprise users to flash.
    if (body.model === 'gemini-2.5-pro' && auth.tier !== 'business' && auth.tier !== 'enterprise') {
      body.model = 'gemini-2.5-flash';
    }

    // B3 (review 2026-09-04): per-user hourly request bucket, fail-CLOSED. Bounds
    // the precheck-then-charge window (N racing requests at cap-1) to at most
    // HOURLY_LIMIT model calls per user-hour whatever the client's concurrency;
    // master accounts included. rateLimitCount returns the POST-increment count,
    // so `n - 1 >= HOURLY_LIMIT` denies exactly the (HOURLY_LIMIT + 1)th request.
    const hourly = await rateLimitCount(`analyze-drawings:user:${auth.userId}`);
    if (hourly < 0) return jsonResponse({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable' }, 503);
    if (hourly - 1 >= HOURLY_LIMIT) return jsonResponse({ success: false, error: `Hourly limit reached (${HOURLY_LIMIT} per hour). Try again in an hour.`, code: 'hourly_limit' }, 429);
    // Monthly cap PRECHECK (audit AI-F8: the unit is charged after the model
    // answers — see the success path and the UpstreamError branch below).
    // aiUsageGet fails CLOSED. Accepted window: N requests racing at cap-1 all
    // pass this read and each charges after, so one user's counter can
    // overshoot the cap by N-1 — never more.
    const cap = MONTHLY_CAPS[auth.tier].analyze_drawings;
    const used = await aiUsageGet(auth.userId, 'analyze_drawings');
    if (used >= cap) {
      return jsonResponse({
        success: false,
        error: `Monthly drawing-analysis limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
        code: 'monthly_cap_reached',
        used,
        cap,
      }, 429);
    }

    const { data, modelUsed } = await callGemini(body);
    const newUsed = await aiUsageIncrement(auth.userId, 'analyze_drawings');
    return jsonResponse({ success: true, data, modelUsed, usage: { used: newUsed, cap } });
  } catch (e) {
    if (e instanceof UrlValidationError) {
      // Generic — never echo the offending URL or an upstream status.
      return jsonResponse({ success: false, error: 'One or more image URLs are not allowed.' }, 400);
    }
    if (e instanceof UpstreamError) {
      // Charge only when the model actually answered (the spend is real even
      // if the answer was unusable); an upstream 5xx / network failure is free.
      if (e.spent) await aiUsageIncrement(auth.userId, 'analyze_drawings');
      console.error('[analyze-drawings] upstream failure', e.message);
      return jsonResponse({ success: false, error: e.status === 504 ? 'The AI service timed out — please try again.' : 'The AI service returned an error — please try again.', code: e.status === 504 ? 'upstream_timeout' : 'upstream_error' }, e.status);
    }
    // The exception text stays in the log; the body is generic (A6 / AI-F16).
    console.error('[analyze-drawings] failed', e);
    return jsonResponse({ success: false, error: 'Internal error — please try again.' }, 500);
  }
});
