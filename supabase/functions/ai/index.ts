// ai
//
// The single Gemini-Vision-free AI relay. Every text-based MAGE AI feature —
// Copilot, Quick Estimate, Estimate Validator, AI Schedule Builder, Daily
// Report Generator, Homeowner Summary, Bid Scoring, Change Order Impact,
// Weekly Analysis, Home Briefing, Invoice Predictor, Sub Evaluator,
// Equipment Advice, Project Report — calls this function.
//
// Why centralized: keeps the GEMINI_API_KEY server-side, lets us swap models
// or add caching/rate-limiting in one place, gives every feature
// constrained-decoding (responseSchema) for free.
//
// Auth + cap: As of the May 2026 audit, this function now REQUIRES an
// authenticated user JWT (any tier — free included) and increments a
// monthly counter against MONTHLY_CAPS[tier].ai_text. Pre-fix the
// function was unauthenticated and the rate-limit lived purely in
// AsyncStorage on-device, so a curl-attacker (or anyone willing to
// extract the URL from the app bundle) could burn unlimited Gemini
// credits. Now: every text AI call costs an `ai_usage_counters` row
// increment, and exceeds-cap returns 429 with a clear reset date.
//
// Two tiers (decoding budget, NOT subscription tier):
//   fast  → gemini-2.5-flash, default maxTokens 1000-8192
//   smart → gemini-2.5-flash with HIGHER token ceiling (16000) so heavy
//           JSON outputs (Quick Estimate, Schedule Builder, Validator)
//           don't get truncated and silently fall back to stubs.
//
// JSON mode: enabled when the client passes schemaHint (a plain JS
// example). We infer a JSON Schema from the example and pass it as
// responseSchema → Gemini guarantees structurally valid JSON in the
// response.
//
// Error surface: We always return HTTP 200 with `{success: bool, ...}` for
// the model-side cases (MAX_TOKENS / SAFETY / RECITATION carried via
// `finishReason`). For the auth/cap cases we return non-200 because the
// `requireTier` helper does, and the client mageAI.ts already handles
// non-200 as `errorKind: 'http'` distinctly from `errorKind: 'model'`.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, aiUsageGet, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";
import { GEMINI_TEXT_MODEL } from "../_shared/models.ts";

const GK = Deno.env.get("GEMINI_API_KEY") || "";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
// Model ids come from _shared/models.ts (env-overridable — audit AI-F12).
const M: Record<string, string> = {
  fast: GEMINI_TEXT_MODEL,
  smart: GEMINI_TEXT_MODEL,
};
// B3 (review 2026-09-04): per-user hourly request ceiling + bounded upstream fetch.
const AI_HOURLY_LIMIT = 120;
const TEXT_TIMEOUT_MS = 60_000;
const H: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...H, "Content-Type": "application/json" } });
}

// Derive a JSON Schema from a plain JS example object. Gemini uses this for
// constrained decoding — guarantees structurally valid JSON output.
function inferSchema(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { type: "string" };
  if (Array.isArray(val)) {
    return { type: "array", items: val.length > 0 ? inferSchema(val[0]) : { type: "string" } };
  }
  if (typeof val === "object") {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      properties[k] = inferSchema(v);
      required.push(k);
    }
    return { type: "object", properties, required };
  }
  if (typeof val === "number") return { type: "number" };
  if (typeof val === "boolean") return { type: "boolean" };
  return { type: "string" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  try {
    if (!GK) {
      return jsonResp({ success: false, error: "GEMINI_API_KEY not set on server", finishReason: "CONFIG_ERROR" }, 500);
    }

    // Require any authenticated tier (free included). The min-rank semantics
    // of requireTier mean ['free',...] = "any signed-in user" — but we still
    // must list it explicitly for the rank lookup. Pre-fix this function
    // accepted anonymous calls and was a blank check on Gemini cost.
    const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'ai_text');
    if (!auth.ok) return jsonResp(auth.body, auth.status);

    // Parse + validate the body BEFORE we touch the usage counter. Pre-fix
    // the increment fired immediately after auth, so a malformed body or a
    // missing-prompt request still burned one of the user's monthly quota
    // — a buggy client (or anyone hitting the URL with curl) could exhaust
    // someone's cap with empty bodies.
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResp({ success: false, error: "Invalid JSON body", finishReason: "BAD_REQUEST" }, 400);
    }

    const prompt = body.prompt;
    const schemaHint = body.schemaHint;
    // Enable JSON mode when explicit, schemaHint provided, or legacy `schema` key from old clients.
    const jsonMode = body.jsonMode === true || !!schemaHint || !!body.schema;
    const tier = (body.tier as string) || "fast";

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return jsonResp({ success: false, error: "Missing prompt", finishReason: "BAD_REQUEST" }, 400);
    }

    // Per-feature minimum subscription tier. The requireTier above only checks
    // "signed in" (['free',...]); these text-AI features are Pro/Business-only in
    // the UI, but a free user could POST the prompt straight here and get the
    // result, spending only their generic ai_text quota. Enforce the floor
    // server-side using the tier we ALREADY resolved (no second JWT verify).
    // Rank semantics: business/enterprise auto-satisfy a 'pro' floor. Vision
    // features (photo/drawing/scan/cost-xray) are intentionally ABSENT — they run
    // through their own edge functions with their own requireTier; adding them
    // here would be dead config. A registered but unlisted feature → no floor
    // (free ok); an ABSENT/empty tag → the registered default `general` (also
    // no floor); a NON-EMPTY unregistered tag → 400 (KNOWN_FEATURES below).
    // Keep this map in sync with FEATURE_CONFIG.proOnly text features
    // (scripts/validate-ai-feature-gating.ts guards the parity).
    const FEATURE_MIN_RANK: Record<string, number> = {
      bidLeveling: 1,         // pro
      weeklyAnalysis: 1,      // pro
      aiEstimateWizard: 1,    // pro
      cashFlowForecaster: 1,  // pro
      fullBudgetDashboard: 2, // business
    };
    const TIER_RANK: Record<string, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
    // Audit EDGE-F7 / AI-F7: every request carries a REGISTERED feature id.
    // KNOWN_FEATURES mirrors the AIFeature union in utils/aiRateLimiterCore.ts
    // plus the canAccess-gated ids (already in FEATURE_MIN_RANK), the two
    // non-AIFeature tags in use (planAsk, bid_scoring) and `general` — the
    // default the client wrappers (utils/mageAI.ts) send for untagged calls.
    // Deploy-order safety: builds that predate that wrapper default send NO
    // tag; treat those as `general` (normal per-tier ai_text cap, no Pro
    // floor) and log them so the untagged tail is visible in the function
    // logs. A NON-EMPTY unregistered id is still a 400 — a typo must not
    // silently skip a floor. The residual gap (a free account replaying a
    // Pro prompt under `general`) is AI-F7's server-side prompt registry.
    const KNOWN_FEATURES = new Set<string>([
      ...Object.keys(FEATURE_MIN_RANK),
      "general",
      "voiceIntake", "leadScoring", "copilot", "homeBriefing", "invoicePrediction", "subEvaluation",
      "equipmentAdvice", "homeownerSummary", "changeOrderImpact", "dailyReport", "projectReport",
      "profitLeak", "delayScan", "askMage", "projectMemory", "quickEstimate", "scheduleBuilder",
      "scheduleCopilot", "estimateValidation", "voiceCapture", "aiTakeoff", "photoAnalysis",
      "drawingAnalysis", "specBookExtract", "scanCredential", "planAsk", "bid_scoring",
    ]);
    const rawFeature = typeof body.feature === "string" ? body.feature.trim() : "";
    const feature = rawFeature || "general";
    if (!rawFeature) console.log(`[ai] feature=general(untagged) user=${auth.userId} tier=${auth.tier}`);
    if (!KNOWN_FEATURES.has(feature)) {
      return jsonResp({ success: false, error: `Unknown feature id "${feature.slice(0, 40)}".`, code: "unknown_feature", finishReason: "BAD_REQUEST" }, 400);
    }
    const minRank: number | undefined = FEATURE_MIN_RANK[feature];
    if (minRank !== undefined && (TIER_RANK[auth.tier] ?? 0) < minRank) {
      const needed = minRank >= 2 ? "business" : "pro";
      return jsonResp({
        success: false,
        error: `This feature requires ${needed} or higher. You're currently on ${auth.tier}.`,
        code: "tier_required",
        finishReason: "TIER_REQUIRED",
      }, 403);
    }

    // Input length cap — defense against per-tier cost bypass via giant
    // prompts. The MONTHLY_CAPS economic model assumes "average" prompt
    // sizes (~5-15KB legitimate range for estimate-context generations).
    // Without an upper bound, a power user (or a leaked credential) could
    // burn the monthly count quickly via 1MB prompts that each still tick
    // the counter as 1 unit. 50KB is ~10-12K English words — far more than
    // any legitimate in-app request.
    const MAX_PROMPT_CHARS = 50_000;
    const MAX_SCHEMA_HINT_CHARS = 20_000;
    if (prompt.length > MAX_PROMPT_CHARS) {
      return jsonResp({
        success: false,
        error: `Prompt too long (${prompt.length.toLocaleString()} chars; max ${MAX_PROMPT_CHARS.toLocaleString()}).`,
        finishReason: "BAD_REQUEST",
      }, 400);
    }
    if (schemaHint !== undefined && schemaHint !== null) {
      try {
        const schemaLen = JSON.stringify(schemaHint).length;
        if (schemaLen > MAX_SCHEMA_HINT_CHARS) {
          return jsonResp({
            success: false,
            error: `Schema hint too large (${schemaLen.toLocaleString()} chars; max ${MAX_SCHEMA_HINT_CHARS.toLocaleString()}). Simplify the response structure.`,
            finishReason: "BAD_REQUEST",
          }, 400);
        }
      } catch {
        return jsonResp({
          success: false,
          error: "Schema hint is not serializable.",
          finishReason: "BAD_REQUEST",
        }, 400);
      }
    }

    // Token budget. Floors lifted from the prior 8192 → 16000 for jsonMode
    // smart tier so heavy estimate / schedule generations don't truncate.
    // Gemini 2.5 Flash supports up to 65,535 output tokens; 16000 leaves
    // plenty of headroom for any prompt the app sends.
    //
    // MAX_OUTPUT_TOKENS_CAP — hard upper bound regardless of what the
    // caller requests. Same cost-bypass concern as MAX_PROMPT_CHARS:
    // without this, a body.maxTokens of 100000 would charge ~6x more
    // Gemini output cost than the cap model assumes, while still
    // counting as a single ai_text unit on the monthly counter.
    const MAX_OUTPUT_TOKENS_CAP = 24000;
    const rawMaxTokens = typeof body.maxTokens === "number" ? body.maxTokens : 0;
    const maxTokensReq = Math.max(0, Math.min(rawMaxTokens, MAX_OUTPUT_TOKENS_CAP));
    let maxTokens: number;
    if (jsonMode && tier === "smart") {
      maxTokens = Math.max(maxTokensReq || 16000, 16000);
    } else if (jsonMode) {
      maxTokens = Math.max(maxTokensReq || 8192, 8192);
    } else {
      maxTokens = maxTokensReq || 1000;
    }
    // Final clamp — even the floor-Math.max above can't exceed the cap.
    maxTokens = Math.min(maxTokens, MAX_OUTPUT_TOKENS_CAP);

    // B3 (review 2026-09-04): per-user hourly request bucket, fail-CLOSED. Bounds
    // the precheck-then-charge window (N racing requests at cap-1) to at most
    // AI_HOURLY_LIMIT model calls per user-hour whatever the client's concurrency;
    // master accounts included. rateLimitCount returns the POST-increment count,
    // so `n - 1 >= AI_HOURLY_LIMIT` denies exactly the (AI_HOURLY_LIMIT + 1)th request.
    const hourly = await rateLimitCount(`ai:user:${auth.userId}`);
    if (hourly < 0) return jsonResp({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable', finishReason: 'RATE_LIMITED' }, 503);
    if (hourly - 1 >= AI_HOURLY_LIMIT) return jsonResp({ success: false, error: `Hourly limit reached (${AI_HOURLY_LIMIT} per hour). Try again in an hour.`, code: 'hourly_limit', finishReason: 'RATE_LIMITED' }, 429);

    // Monthly cap PRECHECK (audit AI-F8: charge after the model answers). Caps
    // are daily × 30 in MONTHLY_CAPS so the server ceiling matches the client
    // daily limiter. aiUsageGet fails CLOSED (sentinel on RPC error) so an
    // outage denies rather than spends. The increment now happens after a 2xx
    // from Gemini — an upstream 5xx/timeout no longer burns a unit and over-cap
    // retries no longer climb the counter. Accepted window: N requests racing
    // at cap-1 all pass this read and each charges after, so one user's
    // counter can overshoot the cap by N-1 — never more.
    const cap = MONTHLY_CAPS[auth.tier].ai_text ?? 0;
    const usedBefore = await aiUsageGet(auth.userId, 'ai_text');
    if (usedBefore >= cap) {
      return jsonResp({
        success: false,
        error: `Monthly AI limit reached (${cap}/mo on ${auth.tier}). Resets the 1st of next month.`,
        code: 'monthly_cap',
        finishReason: 'RATE_LIMITED',
      }, 429);
    }

    const model = M[tier] || M.fast;
    const sys = "You are MAGE AI, a construction project management assistant built into the MAGE ID app. You help contractors with scheduling, estimating, bid analysis, daily reports, and project management. Be concise, specific, and use construction industry terminology. When returning JSON, ensure ALL array fields are present even if empty. Never omit required fields or return null for arrays. Every number field MUST be a number (use 0 if unknown).";

    let userMsg = prompt;
    if (jsonMode && schemaHint) {
      userMsg += "\n\nMatch this exact JSON structure (values shown are examples only, generate realistic data for the request):\n" + JSON.stringify(schemaHint, null, 2);
    }

    const genConfig: Record<string, unknown> = {
      maxOutputTokens: maxTokens,
      temperature: 0.3,
    };
    if (jsonMode) {
      genConfig.responseMimeType = "application/json";
      if (schemaHint) {
        genConfig.responseSchema = inferSchema(schemaHint);
      }
    }

    const gb = {
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      systemInstruction: { parts: [{ text: sys }] },
      generationConfig: genConfig,
    };

    const url = BASE + model + ":generateContent?key=" + GK;
    // Bounded upstream fetch (B3): a hung socket returns a CORS 504 instead of
    // the isolate dying at the wall clock; nothing is charged on abort.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TEXT_TIMEOUT_MS);
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gb),
        signal: ac.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return jsonResp({ success: false, error: "The AI service timed out — please try again.", code: "upstream_timeout", finishReason: "UPSTREAM_TIMEOUT" }, 504);
      }
      console.error("GEMINI NETWORK ERROR:", (e as Error).message);
      return jsonResp({ success: false, error: "The AI service is unreachable — please try again.", code: "upstream_error", finishReason: "UPSTREAM_HTTP_ERROR" }, 502);
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      const e = await r.text();
      console.error("GEMINI ERROR:", r.status, e.substring(0, 500));
      // Upstream text stays in the server log (audit AI-F16) — not charged.
      return new Response(
        JSON.stringify({
          success: false,
          error: "The AI service returned an error (" + r.status + "). Please try again.",
          finishReason: "UPSTREAM_HTTP_ERROR",
        }),
        { status: 502, headers: { ...H, "Content-Type": "application/json" } },
      );
    }

    // The model answered (2xx) — the spend is real, so charge now regardless
    // of how usable the answer turns out to be: MAX_TOKENS / SAFETY / bad JSON
    // are still paid Gemini calls and the cap is the cost ceiling. Only the
    // upstream failure above is free.
    await aiUsageIncrement(auth.userId, 'ai_text');

    const data = await r.json();
    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason || "UNKNOWN";
    const raw = candidate?.content?.parts?.[0]?.text || "";
    const usage = data.usageMetadata || {};

    if (!raw) {
      console.error("Empty Gemini response, finishReason:", finishReason, "usage:", JSON.stringify(usage), "raw[:300]:", JSON.stringify(data).substring(0, 300));
      // Surface finishReason so the client can branch (MAX_TOKENS retry,
      // SAFETY explainer, etc.).
      const human = finishReason === "MAX_TOKENS"
        ? "Hit the token ceiling before producing output. Try a shorter description or fewer items."
        : finishReason === "SAFETY"
        ? "Gemini refused the request (safety filter). Try rephrasing — avoid identifiable people, weapons, etc."
        : finishReason === "RECITATION"
        ? "Gemini refused (looked too similar to copyrighted training data)."
        : "AI returned no content (" + finishReason + "). Please try again.";
      return new Response(
        JSON.stringify({ success: false, error: human, finishReason, usage }),
        { headers: { ...H, "Content-Type": "application/json" } },
      );
    }

    let parsed = null;
    if (jsonMode) {
      try {
        let c = raw.trim();
        if (c.startsWith("```json")) c = c.slice(7);
        if (c.startsWith("```")) c = c.slice(3);
        if (c.endsWith("```")) c = c.slice(0, -3);
        parsed = JSON.parse(c.trim());
      } catch (_e) {
        console.error("JSON parse failed, finishReason:", finishReason, "raw[:300]:", raw.substring(0, 300));
        // If finishReason was MAX_TOKENS the text is truncated mid-JSON;
        // tell the client clearly.
        const human = finishReason === "MAX_TOKENS"
          ? "AI response was cut off before the JSON could finish. Try a shorter input."
          : "AI returned invalid JSON (" + finishReason + "). Please try again.";
        return new Response(
          JSON.stringify({ success: false, data: null, raw: raw.substring(0, 500), error: human, finishReason, usage }),
          { headers: { ...H, "Content-Type": "application/json" } },
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: parsed || raw,
        raw,
        model,
        finishReason,
        usage: { inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0 },
      }),
      { headers: { ...H, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      // A6 (review): the detail is in the console.error above, never the body.
      JSON.stringify({ success: false, error: "Internal error — please try again.", finishReason: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...H, "Content-Type": "application/json" } },
    );
  }
});
