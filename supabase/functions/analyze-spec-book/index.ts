// analyze-spec-book
//
// Reads a project's specification book (architect-produced PDF) and runs
// one of two tasks:
//
//   task: 'codes' (default — backward compat)
//     Extracts a list of `code → manufacturer/product/finish` mappings.
//     Designed to pair with analyze-takeoff: the takeoff produces callout
//     codes (PT-1, T-2, WC-1) and this function explains each one.
//
//   task: 'submittals'
//     Identifies every spec item that requires a submittal (cut sheet,
//     mix design, sample, shop drawing, O&M manual). Returns a structured
//     list ready to populate the project's submittal log. The headline
//     win: GCs spend hours combing 200-page spec books for "Submit X
//     for review" lines; AI does it in 90 seconds.
//
// Tier: Pro / Business only. Counts under the same `analyze_drawings`
// monthly cap as analyze-takeoff and analyze-drawings (shared API spend).
//
// Optional `targetCodes` array — if the caller supplies the codes
// extracted from a takeoff, the AI is asked to surface them first +
// flag any not found. Only applies to task='codes'.
//
// Secrets: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;

type ModelKey = 'gemini-2.5-flash' | 'gemini-2.5-pro';
const ALLOWED_MODELS: ModelKey[] = ['gemini-2.5-flash', 'gemini-2.5-pro'];
const DEFAULT_MODEL: ModelKey = 'gemini-2.5-flash';

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

type SpecTask = 'codes' | 'submittals';

interface SpecRequest {
  pageUrls: string[];
  /** Which task to run. Default is 'codes' for backward compatibility
   *  with the takeoff → spec-match pipeline. */
  task?: SpecTask;
  /** Codes the takeoff already found on the plans. AI prioritizes these.
   *  Only used when task='codes'. */
  targetCodes?: string[];
  projectName?: string;
  notes?: string;
  model?: ModelKey;
}

async function urlToInlineImagePart(url: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'MAGE-ID/1.0 (spec-book; +https://mageid.app)',
      'Accept': 'image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
    },
  });
  if (!r.ok) throw new Error(`Could not fetch ${url} (${r.status})`);
  const contentType = r.headers.get('content-type') ?? 'image/png';
  const mimeType = contentType.startsWith('image/') ? contentType.split(';')[0] : 'image/png';
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_PAGE_BYTES) {
    throw new Error(`Page too large: ${(buf.length / 1024 / 1024).toFixed(1)}MB (max 8MB).`);
  }
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return { inlineData: { mimeType, data: btoa(binary) } };
}

function buildSubmittalsPrompt(req: SpecRequest): string {
  const { projectName, notes } = req;
  const ctx = projectName ? `\nProject: ${projectName}` : '';
  const noteBlock = notes ? `\nGC notes: ${notes}` : '';

  return `You are reading an architectural specification book. Your job: identify every spec item that requires a SUBMITTAL — a document the contractor must hand to the architect for review before installation. Examples: cut sheets, product data, color samples, mix designs, shop drawings, O&M manuals, warranties, mock-ups, certifications, test reports.
${ctx}${noteBlock}

APPROACH:
1. Scan each page for spec sections that explicitly say "Submit", "Submittals", "Submit for review/approval", or that name a deliverable (sample, mix design, shop drawing, etc.).
2. For each submittal item, capture:
   - title: short, contractor-friendly description (≤80 chars). Sentence case. e.g. "Concrete mix design for slab on grade"
   - specSection: the CSI section number when visible ("03 30 00", "09 91 23"). Empty if not stated.
   - submittalType: one of "Product Data", "Shop Drawings", "Sample", "Mix Design", "Warranty", "O&M Manual", "Test Report", "Certification", "Mock-up", "Other"
   - trade: closest match from "Concrete", "Framing", "Roofing", "Plumbing", "Electrical", "HVAC", "Drywall", "Painting", "Flooring", "Tile", "Doors/Hardware", "Cabinets", "General"
   - dueRelativeDays: integer estimate of how many days BEFORE installation this submittal should be in the architect's hands. Default 14 if not specified. Use 30 for long-lead items (mock-ups, custom fabrication).
   - sourcePages: 1-indexed page numbers where this submittal is called for.
   - confidence: "high" | "medium" | "low". "high" only when the spec uses the literal word "submit" or "submittal".

3. Deduplicate aggressively — if the same submittal is mentioned on multiple pages, ONE entry with all pages in sourcePages.

OUTPUT — JSON only. Schema:

{
  "items": [
    {
      "title": "Concrete mix design for slab on grade",
      "specSection": "03 30 00",
      "submittalType": "Mix Design",
      "trade": "Concrete",
      "dueRelativeDays": 14,
      "sourcePages": [12, 13],
      "confidence": "high"
    }
  ],
  "confidenceOverall": "high" | "medium" | "low",
  "confidenceExplanation": "1 sentence."
}

CRITICAL RULES:
- JSON only. No markdown fences. No prose outside the JSON.
- "title" required. Trim and de-jargonize so a GC reads it naturally.
- Drop entries below confidence "low".
- Never invent submittals — if a section just describes a product without requiring a submittal, do not include it.
- "submittalType" must be exactly one of the listed values. Default to "Other" if unclear.`;
}

function buildPrompt(req: SpecRequest): string {
  if (req.task === 'submittals') return buildSubmittalsPrompt(req);
  const { projectName, notes, targetCodes } = req;
  const targetBlock = targetCodes && targetCodes.length > 0
    ? `\nTARGET CODES (these were found on the takeoff drawings — surface their specs FIRST, then any other codes you see):\n  ${targetCodes.join(', ')}\n`
    : '';
  const ctx = projectName ? `\nProject: ${projectName}` : '';
  const noteBlock = notes ? `\nGC notes: ${notes}` : '';

  return `You are reading an architectural specification book. Each spec section labels a CODE used on the drawings (e.g. "PT-1", "T-2", "WC-1") and gives the actual manufacturer, product, color/finish, and installation notes.
${ctx}${noteBlock}${targetBlock}
Your job: extract a list of code → spec mappings. Stay literal — do not invent products or guess at unspecified fields.

APPROACH:
1. Scan each page for spec headings + callout codes.
2. For each code: pull the manufacturer name, product name, SKU/model #, color or finish, and CSI section if visible.
3. If a target code (from the takeoff) is not in the spec book, list it in "unmatched" with the exact code as the AI saw on the takeoff.
4. Confidence per entry: "high" = manufacturer + product both clearly stated. "medium" = one of the two missing or ambiguous. "low" = code referenced but spec not pinned down.

OUTPUT — JSON only. Schema:

{
  "entries": [
    {
      "code": "PT-1",
      "csiSection": "09 9123" or null,
      "manufacturer": "Sherwin Williams" or null,
      "product": "ProMar 200" or null,
      "sku": "SW7036" or null,
      "finish": "Eggshell, Accessible Beige" or null,
      "notes": "<optional install/substrate notes>",
      "confidence": "high" | "medium" | "low",
      "sourcePages": [3]
    }
  ],
  "unmatched": ["PT-3", "T-7"],
  "confidenceOverall": "high" | "medium" | "low",
  "confidenceExplanation": "1 sentence."
}

CRITICAL RULES:
- JSON only. No markdown fences. No prose outside the JSON.
- "code" required. Everything else is optional but should be filled when present.
- "confidence" must be exactly "high" | "medium" | "low".
- "sourcePages" required, 1-indexed.
- Never invent manufacturers. If the spec book doesn't name one, leave manufacturer null.
- "unmatched" gets the codes from TARGET CODES that you couldn't find specs for.`;
}

const VALID_CONFIDENCE = ['high', 'medium', 'low'] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asConfidence(v: unknown): 'high' | 'medium' | 'low' {
  return typeof v === 'string' && (VALID_CONFIDENCE as readonly string[]).includes(v)
    ? (v as 'high' | 'medium' | 'low')
    : 'medium';
}
function asPages(v: unknown): number[] {
  return asArray(v)
    .map(p => typeof p === 'number' ? Math.round(p) : 0)
    .filter(p => p > 0);
}

function validateCodes(raw: Record<string, unknown>): Record<string, unknown> {
  const entries = asArray<Record<string, unknown>>(raw.entries).map(e => ({
    code: asString(e.code, ''),
    csiSection: typeof e.csiSection === 'string' ? e.csiSection : undefined,
    manufacturer: typeof e.manufacturer === 'string' ? e.manufacturer : undefined,
    product: typeof e.product === 'string' ? e.product : undefined,
    sku: typeof e.sku === 'string' ? e.sku : undefined,
    finish: typeof e.finish === 'string' ? e.finish : undefined,
    notes: typeof e.notes === 'string' ? e.notes : undefined,
    confidence: asConfidence(e.confidence),
    sourcePages: asPages(e.sourcePages),
  })).filter(e => e.code.length > 0);

  const unmatched = asArray<unknown>(raw.unmatched)
    .map(s => asString(s, ''))
    .filter(s => s.length > 0);

  return {
    entries,
    unmatched,
    confidenceOverall: asConfidence(raw.confidenceOverall),
    confidenceExplanation: asString(raw.confidenceExplanation, ''),
  };
}

const VALID_SUBMITTAL_TYPES = new Set([
  'Product Data', 'Shop Drawings', 'Sample', 'Mix Design',
  'Warranty', 'O&M Manual', 'Test Report', 'Certification', 'Mock-up', 'Other',
]);

function asInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function validateSubmittals(raw: Record<string, unknown>): Record<string, unknown> {
  const items = asArray<Record<string, unknown>>(raw.items).map(e => {
    const submittalType = asString(e.submittalType, 'Other');
    return {
      title: asString(e.title, '').slice(0, 200),
      specSection: typeof e.specSection === 'string' ? e.specSection : '',
      submittalType: VALID_SUBMITTAL_TYPES.has(submittalType) ? submittalType : 'Other',
      trade: asString(e.trade, 'General'),
      dueRelativeDays: Math.max(0, Math.min(120, asInt(e.dueRelativeDays, 14))),
      sourcePages: asPages(e.sourcePages),
      confidence: asConfidence(e.confidence),
    };
  }).filter(e => e.title.length > 0);

  return {
    items,
    confidenceOverall: asConfidence(raw.confidenceOverall),
    confidenceExplanation: asString(raw.confidenceExplanation, ''),
  };
}

function validate(raw: Record<string, unknown>, task: SpecTask): Record<string, unknown> {
  return task === 'submittals' ? validateSubmittals(raw) : validateCodes(raw);
}

async function callGemini(req: SpecRequest): Promise<{ data: unknown; modelUsed: ModelKey }> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured.');
  if (!req.pageUrls || req.pageUrls.length === 0) throw new Error('No page URLs provided.');
  if (req.pageUrls.length > 24) throw new Error('Maximum 24 spec pages per request.');

  const requested = req.model ?? DEFAULT_MODEL;
  const modelUsed: ModelKey = ALLOWED_MODELS.includes(requested) ? requested : DEFAULT_MODEL;
  const imageParts = await Promise.all(req.pageUrls.map(urlToInlineImagePart));
  const maxOutputTokens = modelUsed === 'gemini-2.5-pro' ? 32000 : 16000;

  const body = {
    contents: [{ parts: [...imageParts, { text: buildPrompt(req) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.05,
      maxOutputTokens,
    },
  };

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelUsed}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error(`Gemini ${r.status}: ${err.slice(0, 400)}`);
  }
  const json = await r.json();
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new Error('Gemini returned no text.');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse JSON: ${(e as Error).message}\nRaw: ${raw.slice(0, 400)}`);
  }
  if (!isObj(parsed)) throw new Error('AI response was not an object.');
  const task: SpecTask = req.task === 'submittals' ? 'submittals' : 'codes';
  return { data: validate(parsed, task), modelUsed };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const auth = await requireTier(req, ['pro', 'business'], 'analyze_spec_book');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  try {
    const body = await req.json() as SpecRequest;
    if (!body || !Array.isArray(body.pageUrls)) {
      return jsonResponse({ success: false, error: 'Missing pageUrls' }, 400);
    }
    if (body.model === 'gemini-2.5-pro' && auth.tier !== 'business' && auth.tier !== 'enterprise') {
      body.model = 'gemini-2.5-flash';
    }

    const used = await aiUsageIncrement(auth.userId, 'analyze_drawings');
    const cap = MONTHLY_CAPS[auth.tier].analyze_drawings;
    if (used > cap) {
      return jsonResponse({
        success: false,
        error: `Monthly drawing-analysis limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
        code: 'monthly_cap_reached',
        used, cap,
      }, 429);
    }

    const { data, modelUsed } = await callGemini(body);
    return jsonResponse({ success: true, data, modelUsed, usage: { used, cap } });
  } catch (e) {
    console.error('[analyze-spec-book] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
