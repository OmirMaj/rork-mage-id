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

interface PlanExtractRequest {
  imageBase64: string;
  mimeType: string;
  sheetNumber?: string;
}

function buildPrompt(req: PlanExtractRequest): string {
  const sheetRef = req.sheetNumber?.trim() ? ` (sheet ${req.sheetNumber.trim()})` : "";
  return [
    `You are a meticulous construction document transcriber. Your job is to extract ALL legible text and data from this plan sheet${sheetRef} so it can be searched later.`,
    "Read the sheet carefully and produce a dense, search-friendly transcription. Include:",
    "- The sheet title, number, revision, and drawing name (exactly as printed)",
    "- A short one-sentence description of what this sheet depicts (e.g. 'Foundation plan showing column grid and footing schedules')",
    "- Every legible callout, annotation, note, and general note",
    "- All dimensions, room labels, material specifications, and keynotes",
    "- Every row of any schedule (door schedule, window schedule, finish schedule, panel schedule, etc.) with its columns",
    "- Every symbol legend entry and drawing title",
    "- Any stamps, revision block entries, or title block fields (project name, address, architect, date, scale)",
    "Transcribe faithfully — do not interpret, infer, or add commentary. If a region is illegible, skip it silently.",
    "Return STRICT JSON of this exact shape and nothing else:",
    '{"text":"<full dense transcription>"}',
    'If nothing is legible, return {"text":""}.',
  ].join("\n");
}

function approxBase64Bytes(b64: string): number {
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

async function callGemini(req: PlanExtractRequest): Promise<string> {
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
    generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 16384 },
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
  let parsed: { text?: string };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse AI response as JSON: ${(e as Error).message}\nRaw: ${raw.slice(0, 400)}`);
  }
  if (typeof parsed.text !== "string") throw new Error("AI response missing 'text' field.");
  return parsed.text;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const auth = await requireTier(req, ["business", "enterprise"], "plan_extract");
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  try {
    const body = await req.json() as PlanExtractRequest;
    if (!body || typeof body.imageBase64 !== "string" || !body.imageBase64) {
      return jsonResponse({ success: false, error: "Missing imageBase64" }, 400);
    }

    const cap = MONTHLY_CAPS[auth.tier].plan_extract;
    const used = await aiUsageGet(auth.userId, "plan_extract");
    if (used >= cap) {
      return jsonResponse({
        success: false,
        error: `Monthly plan-extract limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
        code: "monthly_cap_reached",
        used,
        cap,
      }, 429);
    }

    const text = await callGemini(body);
    const newUsed = await aiUsageIncrement(auth.userId, "plan_extract");
    return jsonResponse({ success: true, text, usage: { used: newUsed, cap } });
  } catch (e) {
    console.error("[plan-extract] failed", e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
