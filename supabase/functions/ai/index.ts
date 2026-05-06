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
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";

const GK = Deno.env.get("GEMINI_API_KEY") || "";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const M: Record<string, string> = {
  fast: "gemini-2.5-flash",
  smart: "gemini-2.5-flash",
};
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

    // Monthly cap check + atomic increment. Caps are deliberately set to
    // daily × 30 in MONTHLY_CAPS so the server-side ceiling matches the
    // client-side daily limiter without us having to add a separate daily
    // SQL function. A user who maxes their daily client cap every day for
    // the month hits the server cap on the same day they would have run
    // out anyway.
    const used = await aiUsageIncrement(auth.userId, 'ai_text');
    const cap = MONTHLY_CAPS[auth.tier].ai_text ?? 0;
    if (used > cap) {
      return jsonResp({
        success: false,
        error: `Monthly AI limit reached (${cap}/mo on ${auth.tier}). Resets the 1st of next month.`,
        code: 'monthly_cap',
        finishReason: 'RATE_LIMITED',
      }, 429);
    }

    const body = await req.json();
    const prompt = body.prompt;
    const schemaHint = body.schemaHint;
    // Enable JSON mode when explicit, schemaHint provided, or legacy `schema` key from old clients.
    const jsonMode = body.jsonMode === true || !!schemaHint || !!body.schema;
    const tier = (body.tier as string) || "fast";

    // Token budget. Floors lifted from the prior 8192 → 16000 for jsonMode
    // smart tier so heavy estimate / schedule generations don't truncate.
    // Gemini 2.5 Flash supports up to 65,535 output tokens; 16000 leaves
    // plenty of headroom for any prompt the app sends.
    let maxTokens: number;
    if (jsonMode && tier === "smart") {
      maxTokens = Math.max(body.maxTokens || 16000, 16000);
    } else if (jsonMode) {
      maxTokens = Math.max(body.maxTokens || 8192, 8192);
    } else {
      maxTokens = body.maxTokens || 1000;
    }

    if (!prompt) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing prompt", finishReason: "BAD_REQUEST" }),
        { status: 400, headers: { ...H, "Content-Type": "application/json" } },
      );
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
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gb),
    });
    if (!r.ok) {
      const e = await r.text();
      console.error("GEMINI ERROR:", r.status, e.substring(0, 500));
      return new Response(
        JSON.stringify({
          success: false,
          error: "Gemini error (" + r.status + "): " + e.substring(0, 200),
          finishReason: "UPSTREAM_HTTP_ERROR",
        }),
        { status: 502, headers: { ...H, "Content-Type": "application/json" } },
      );
    }

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
      JSON.stringify({ success: false, error: "Internal error: " + String(err), finishReason: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...H, "Content-Type": "application/json" } },
    );
  }
});
