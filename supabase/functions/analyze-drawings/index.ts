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

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
// Use Gemini 2.0 Flash for vision — fast + cheap + handles ~16 images.
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function urlToInlineImagePart(url: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  // Gemini's REST API takes either inlineData (base64) or fileData (URI).
  // We use inlineData because the rendered PNGs live in our public-read
  // bucket — fetching once + base64-encoding is reliable across regions.
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not fetch ${url} (${r.status})`);
  const buf = new Uint8Array(await r.arrayBuffer());
  // Base64-encode without blowing the stack on big images.
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const data = btoa(binary);
  return { inlineData: { mimeType: 'image/png', data } };
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

async function callGemini(req: AnalyzeRequest): Promise<unknown> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured on the server.');
  if (!req.pageUrls || req.pageUrls.length === 0) throw new Error('No page URLs provided.');
  if (req.pageUrls.length > 16) throw new Error('Maximum 16 pages per request — split larger sets.');

  // Fetch all pages in parallel and base64-encode for inline transmission.
  const imageParts = await Promise.all(req.pageUrls.map(urlToInlineImagePart));

  const body = {
    contents: [{
      parts: [
        ...imageParts,
        { text: buildPrompt(req) },
      ],
    }],
    generationConfig: {
      // Force JSON mode — Gemini will produce a valid JSON document.
      responseMimeType: 'application/json',
      // Slightly conservative — we want repeatable estimates, not creative ones.
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  const r = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Gemini ${r.status}: ${errText.slice(0, 400)}`);
  }
  const json = await r.json();
  // Gemini wraps the response in candidates[0].content.parts[0].text
  // Even with responseMimeType:'application/json', the output is still a
  // JSON-encoded STRING — parse it.
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new Error('Gemini returned no text.');
  try {
    return JSON.parse(raw);
  } catch (e) {
    // If parsing fails, return the raw text in an error wrapper so the
    // client can show something useful instead of a silent "AI failed."
    throw new Error(`Could not parse AI response as JSON: ${(e as Error).message}\nRaw: ${raw.slice(0, 400)}`);
  }
}

// ─── Server ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  try {
    const body = await req.json() as AnalyzeRequest;
    if (!body || !Array.isArray(body.pageUrls)) {
      return jsonResponse({ success: false, error: 'Missing pageUrls' }, 400);
    }
    const data = await callGemini(body);
    return jsonResponse({ success: true, data });
  } catch (e) {
    console.error('[analyze-drawings] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
