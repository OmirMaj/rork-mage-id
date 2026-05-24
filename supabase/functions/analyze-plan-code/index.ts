import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageGet, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MODEL = "gemini-2.5-flash";
function geminiEndpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
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

async function callGemini(req: PlanCodeRequest): Promise<unknown> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured on the server.");
  if (!req.imageBase64) throw new Error("No image provided.");
  if (approxBase64Bytes(req.imageBase64) > MAX_PAGE_BYTES) {
    throw new Error("Image too large (max 8MB). Try a lower-resolution export.");
  }
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
  const r = await fetch(`${geminiEndpoint()}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Gemini ${r.status}: ${errText.slice(0, 400)}`);
  }
  const json = await r.json();
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!raw) throw new Error("Gemini returned no text.");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse AI response as JSON: ${(e as Error).message}\nRaw: ${raw.slice(0, 400)}`);
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
    console.error("[analyze-plan-code] failed", e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
