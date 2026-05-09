// extract-plan-metadata — single-image vision call that extracts the
// title-block metadata from a construction drawing page.
//
// Why a separate function instead of folding into analyze-drawings:
//   analyze-drawings is heavy. It pulls a full estimate from a multi-
//   page set, takes 30+ seconds, and burns Gemini quota. For the
//   "auto-name + auto-scale plan pages on upload" use case we only
//   need 4 small fields per page: sheet number, sheet title, scale
//   notation, and approximate confidence. Round-tripping that through
//   the heavy function would take ~30s per page; a focused metadata
//   call gets it in 2-3s.
//
// Request body:
// {
//   imageUrl: string;     // public URL or signed Supabase Storage URL
// }
//
// Response:
// {
//   success: boolean;
//   data?: {
//     sheetNumber: string | null;     // "A-101", "S-201", "M-1.0", etc.
//     sheetTitle: string | null;      // "Floor Plan — Level 2"
//     scaleNotation: string | null;   // "1/4\" = 1'-0\"", "1:50", etc.
//     confidence: 'low' | 'medium' | 'high';
//   };
//   error?: string;
// }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = "gemini-2.5-flash-lite";

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

interface Body {
  imageUrl?: string;
}

async function downloadAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Image fetch failed: ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  // Manual base64 encoding — Deno's btoa expects binary string,
  // not Uint8Array. Walk in chunks to avoid stack overflow on
  // large images.
  let binary = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  const base64 = btoa(binary);
  const mimeType = r.headers.get("content-type") || "image/png";
  return { base64, mimeType };
}

const PROMPT = `You are reading a single page of a construction drawing set. Look at the title block (usually bottom-right or right edge).

Extract these fields. Use null when a field is genuinely not visible — do NOT guess.

- sheetNumber: the canonical sheet identifier. Examples: "A-101", "S-201", "M-1.0", "E-301", "C-100", "L-1". Strip trailing notes like "REVISION" — only the number.
- sheetTitle: the human-readable name. Examples: "Floor Plan — Level 2", "Foundation Plan", "Roof Framing Plan", "Mechanical Schedules". Trim aggressive caps but preserve the structure.
- scaleNotation: the drawing scale. Examples: '1/4" = 1\\'-0\"', '1/8" = 1\\'-0\"', '1:50', 'NOT TO SCALE'. Pull verbatim from the title block; don't normalize.
- confidence: how confident you are in the extraction. 'high' = title block clearly visible and unambiguous; 'medium' = partially obscured or partial extraction; 'low' = couldn't find a title block at all.

Return ONLY a JSON object with these four keys. No prose, no markdown, no preamble.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  // Tier gate. Free tier gets a small daily allotment via the
  // requireTier check; Pro+ runs unlimited. The function is cheap
  // (single-page vision) but we still want the gate to keep abuse
  // off the Gemini quota.
  const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'plan_metadata');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  if (!GEMINI_API_KEY) {
    return jsonResponse({ success: false, error: "GEMINI_API_KEY not configured on the function" }, 500);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }
  if (!body.imageUrl) {
    return jsonResponse({ success: false, error: "imageUrl is required" }, 400);
  }

  try {
    const { base64, mimeType } = await downloadAsBase64(body.imageUrl);

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType, data: base64 } },
            ],
          }],
          generationConfig: {
            temperature: 0.1,  // Deterministic — we want the same
                               // sheet to extract the same value on
                               // every retry.
            maxOutputTokens: 200,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      const txt = await geminiRes.text();
      return jsonResponse({ success: false, error: `Gemini error ${geminiRes.status}: ${txt.slice(0, 200)}` }, 502);
    }

    const result = await geminiRes.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return jsonResponse({ success: false, error: "Empty response from vision model" }, 502);
    }
    let parsed: { sheetNumber?: string | null; sheetTitle?: string | null; scaleNotation?: string | null; confidence?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      return jsonResponse({ success: false, error: "Vision model returned non-JSON" }, 502);
    }

    return jsonResponse({
      success: true,
      data: {
        sheetNumber: typeof parsed.sheetNumber === 'string' && parsed.sheetNumber.trim().length > 0 ? parsed.sheetNumber.trim() : null,
        sheetTitle: typeof parsed.sheetTitle === 'string' && parsed.sheetTitle.trim().length > 0 ? parsed.sheetTitle.trim() : null,
        scaleNotation: typeof parsed.scaleNotation === 'string' && parsed.scaleNotation.trim().length > 0 ? parsed.scaleNotation.trim() : null,
        confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low' ? parsed.confidence : 'low',
      },
    });
  } catch (err) {
    console.error("[extract-plan-metadata] error", err);
    return jsonResponse({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }, 500);
  }
});
