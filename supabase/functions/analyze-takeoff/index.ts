// analyze-takeoff
//
// AI-powered automated quantity takeoff for construction drawings.
// Multi-vendor: Gemini (default) + Claude Sonnet 4.6 for Enterprise tier.
//
// Output schema is in types/index.ts (TakeoffResult). The AI is asked
// for confidence per row + source-page references so the user can
// trace any quantity back to where it came from on the drawings.
//
// Tier: Pro / Business / Enterprise (analyze_drawings cap shared —
// same upstream API spend). Uses the shared `_shared/auth.ts`
// requireTier helper.
//
// Tier-based model selection (May 2026):
//   Pro        → gemini-2.5-flash    ($0.13/takeoff)  — fast + cheap
//   Business   → gemini-2.5-pro      ($0.50/takeoff)  — better DocVQA
//   Enterprise → claude-sonnet-4-5   ($1.17/takeoff)  — best on stamped/scanned scans
//
// The client sends a `model` hint based on the user's "Pro Takeoff"
// toggle and tier; the server validates the request matches their
// tier before routing. A free/pro user requesting `claude-sonnet-4-5`
// gets force-downgraded to flash with a log message — never a 403,
// because the per-call cap already gates the spend.
//
// Secrets:
//   GEMINI_API_KEY    — Google AI Studio key (Gemini path)
//   ANTHROPIC_API_KEY — Anthropic API key   (Sonnet path; falls back
//                       to gemini-2.5-pro if missing so Enterprise
//                       users still get takeoffs)
//
// Request body:
// {
//   pageUrls: string[];   // 1..N publicly-fetchable PNG URLs (rendered from PDF)
//   projectName?: string;
//   projectType?: string;
//   squareFootage?: number;
//   location?: string;
//   notes?: string;
//   model?: 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'claude-sonnet-4-5';
// }
//
// Response:
//   { success: true, data: TakeoffResult, modelUsed }
//   { success: false, error }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS, type Tier } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;

type ModelKey = 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'claude-sonnet-4-5';
const ALLOWED_MODELS: ModelKey[] = ['gemini-2.5-flash', 'gemini-2.5-pro', 'claude-sonnet-4-5'];
const DEFAULT_MODEL: ModelKey = 'gemini-2.5-flash';

/** Pick the highest-quality model the user's tier is entitled to.
 *  Used both as the default (when client omits `model`) and as a
 *  ceiling check so a Pro user can't request Sonnet via API. */
function modelForTier(tier: Tier): ModelKey {
  if (tier === 'enterprise') return 'claude-sonnet-4-5';
  if (tier === 'business') return 'gemini-2.5-pro';
  return 'gemini-2.5-flash';
}

/** Tier rank — higher = more capable. Used to clamp the requested
 *  model so Free can't ask for Sonnet via a forged body. */
const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
const MODEL_TIER: Record<ModelKey, Tier> = {
  'gemini-2.5-flash': 'pro',
  'gemini-2.5-pro': 'business',
  'claude-sonnet-4-5': 'enterprise',
};

function geminiEndpoint(model: 'gemini-2.5-flash' | 'gemini-2.5-pro'): string {
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

interface TakeoffRequest {
  pageUrls: string[];
  projectName?: string;
  projectType?: string;
  squareFootage?: number;
  location?: string;
  notes?: string;
  model?: ModelKey;
}

async function urlToInlineImagePart(url: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'MAGE-ID/1.0 (takeoff; +https://mageid.app)',
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
  const data = btoa(binary);
  return { inlineData: { mimeType, data } };
}

function buildPrompt(req: TakeoffRequest): string {
  const { projectName, projectType, squareFootage, location, notes } = req;
  const ctxLines: string[] = [];
  if (projectName) ctxLines.push(`Project: ${projectName}`);
  if (projectType) ctxLines.push(`Project type: ${projectType}`);
  if (squareFootage) ctxLines.push(`Square footage: ${squareFootage.toLocaleString()} sq ft`);
  if (location) ctxLines.push(`Location: ${location}`);
  if (notes) ctxLines.push(`GC notes: ${notes}`);
  const ctxBlock = ctxLines.length ? `\n${ctxLines.join('\n')}\n` : '';

  return `You are an experienced construction estimator performing an automated quantity takeoff from the attached drawing pages. Your job is to extract MEASURABLE QUANTITIES (linear feet, square feet, counts), NOT unit prices. The contractor will multiply your quantities by their own pricing.
${ctxBlock}
APPROACH:
1. FIRST, find the drawing scale on each sheet (e.g., '1/4" = 1'-0"', '1/8" = 1\\'-0"', '3/16" = 1\\'-0"'). Look in the title block, near the north arrow, or as a graphic scale. Report what you found.
2. Identify each page: floor plan, reflected ceiling plan, elevation, section, MEP, schedule (door/window/finish/wall), site plan, etc.
3. For FLOOR PLANS: trace each room outline + read the dimensions string to compute net floor area per room. Read the room label exactly as drawn ("Master Bedroom"). The "areaSqFt" you report is the NET interior area, NOT including wall thickness.
4. For WALLS: extract them from the FLOOR PLAN ONLY. Use elevations + sections only to confirm height. Group walls by type (use the wall-type tag from the wall schedule if visible — "W1", "INT-1", etc.). Sum the linear feet of each type. DO NOT count the same wall twice across pages. Classify each wall using "category": "interior_partition", "exterior_framed", "exterior_masonry", "demising", "shaft", "foundation", or "other".
5. For DOORS / WINDOWS: the SCHEDULE is the source of truth for COUNT and SIZE. Plan markings just confirm location — never count both. If no schedule exists, count from plan markings and flag with low/medium confidence.
6. For FINISH SCHEDULES: read each row exactly. Don't invent finishes you don't see. If a room has a callout (e.g. "PT-1") but no spec sheet maps it, record the code in the floorArea / wall finish — don't guess what PT-1 means.
7. For CALLOUTS / SPEC CODES on plans (PT-1, T-2, WC-1, L-3, etc.): record each unique code in the "callouts" array with how many times you saw it. This feeds a downstream spec-matcher; you are NOT expected to know what each code maps to.
8. For ELEVATIONS / SECTIONS: extract heights (plate height, ridge height, ceiling height per level). Use these to validate wall heights from the floor plan.
9. For BULK MATERIALS (concrete footings, slab, gravel base, asphalt): only report when you can read explicit dimensions or quantity callouts. Don't estimate volume from outlines without a thickness dimension.
10. CSI DIVISION: optionally tag each item with the appropriate MasterFormat division (e.g. "06 1000" rough carpentry, "08 1100" doors, "09 6000" floor finishes, "22 4000" plumbing fixtures, "26 5000" electrical fixtures). Use the prefix only — sections-level granularity is fine.

CONFIDENCE RULES — be strict:
- "high" = I read the EXACT dimension or count straight off the drawing. No interpolation.
- "medium" = I had to interpolate (partial dimension visible, used architectural ruler against the scale, summed two visible segments).
- "low" = I had to guess from typical practice because the data wasn't visible. Always pair with a "concerns" entry explaining what's missing.

ANTI-DOUBLE-COUNT RULES:
- Each wall counted ONCE — from the floor plan. Elevations confirm height only.
- Doors / windows counted ONCE — from the schedule when present, otherwise from plan markings.
- Floor areas are NET interior, exclusive of wall thickness.
- Wall area is computed downstream as length × height × 2 sides — do not pre-multiply.
- A bathroom shown on the floor plan AND fixture schedule contributes to fixtures from the schedule, not from plan markings.

OUTPUT — JSON only, matching this exact schema:

{
  "summary": "1-2 sentence description.",
  "scale": {
    "num": 0.25,
    "unit": "in" | "mm" | "cm",
    "perValue": 1,
    "perUnit": "ft" | "m",
    "label": "1/4\\" = 1'-0\\"",
    "confidence": "high" | "medium" | "low",
    "sourcePages": [1]
  },
  "drawingsSeen": [
    {
      "page": 1,
      "type": "Floor plan / RCP / Elevation / Section / MEP / Door Schedule / Window Schedule / Finish Schedule / Wall Schedule / Site Plan / Title / Other",
      "scope": "What this page shows in 1 sentence.",
      "readability": "clear" | "partial" | "poor"
    }
  ],
  "estimatedSquareFootage": <number or null — sum of net floor areas across all levels>,
  "grossEnvelopeSqFt": <number or null — exterior envelope footprint × levels, if measurable>,
  "walls": [
    {
      "id": "w1",
      "typeCode": "W1" or null,
      "category": "interior_partition" | "exterior_framed" | "exterior_masonry" | "demising" | "shaft" | "foundation" | "other",
      "description": "Interior 2x4 stud, 5/8\\" GWB both sides",
      "lengthFt": 24,
      "heightFt": 9,
      "csiDivision": "06 1000" or null,
      "confidence": "high" | "medium" | "low",
      "sourcePages": [1],
      "notes": "<optional>"
    }
  ],
  "floorAreas": [
    {
      "id": "fa1",
      "roomName": "Master Bedroom",
      "finishCode": "WOOD-A" or null,
      "areaSqFt": 220,
      "level": 2 or null,
      "ceilingHeightFt": 9,
      "csiDivision": "09 6000" or null,
      "confidence": "high" | "medium" | "low",
      "sourcePages": [1],
      "notes": "<optional>"
    }
  ],
  "doors": [
    {
      "id": "d1",
      "mark": "D-1" or null,
      "description": "3'-0\\" x 6'-8\\" SC HC paint grade",
      "widthIn": 36,
      "heightIn": 80,
      "exterior": false,
      "count": 4,
      "csiDivision": "08 1400" or null,
      "confidence": "high" | "medium" | "low",
      "sourcePages": [3]
    }
  ],
  "windows": [
    {
      "id": "win1",
      "mark": "A" or null,
      "description": "3'-0\\" x 5'-0\\" double-hung",
      "widthIn": 36,
      "heightIn": 60,
      "count": 6,
      "csiDivision": "08 5000" or null,
      "confidence": "high" | "medium" | "low",
      "sourcePages": [3]
    }
  ],
  "finishes": [
    {
      "id": "fn1",
      "surface": "floor" | "wall" | "ceiling" | "base" | "casing" | "crown" | "trim" | "other",
      "code": "T-1" or null,
      "description": "Porcelain tile 12x24, gray",
      "quantity": 180,
      "unit": "sqft" | "lf" | "ea",
      "csiDivision": "09 6000" or null,
      "confidence": "high" | "medium" | "low",
      "sourcePages": [4]
    }
  ],
  "fixtures": [
    {
      "id": "fx1",
      "category": "plumbing" | "electrical" | "hvac" | "appliance" | "other",
      "mark": "WC-1" or null,
      "description": "Floor-mount toilet, elongated 1.28 GPF",
      "count": 3,
      "csiDivision": "22 4000" or null,
      "confidence": "high" | "medium" | "low",
      "sourcePages": [2]
    }
  ],
  "bulkMaterials": [
    {
      "id": "bm1",
      "description": "Foundation footing concrete",
      "quantity": 12.5,
      "unit": "cy" | "sqft" | "tons" | "lbs" | "cf",
      "confidence": "high" | "medium" | "low",
      "sourcePages": [1],
      "notes": "<optional>"
    }
  ],
  "callouts": [
    {
      "code": "PT-1",
      "context": "wall_finish" | "floor_finish" | "ceiling_finish" | "fixture" | "door" | "window" | "other",
      "occurrences": 12,
      "sourcePages": [2, 4]
    }
  ],
  "concerns": [
    {
      "severity": "critical" | "moderate" | "minor",
      "topic": "Wall heights not dimensioned",
      "detail": "1-2 sentences explaining the issue.",
      "recommendation": "What the GC should do (RFI, allowance, sub bid, etc.).",
      "sourcePages": [1]
    }
  ],
  "doubleCheck": [
    "Concrete cubic yards — page 2 dimensions partially obscured",
    "Window quantities — schedule on page 4 shows abbreviations only"
  ],
  "missingScopes": [
    "MEP drawings not included",
    "Site/grading plan not provided"
  ],
  "confidenceOverall": "high" | "medium" | "low",
  "confidenceExplanation": "1 sentence — what drove the overall rating."
}

CRITICAL RULES:
- Return JSON only. No markdown fences, no commentary outside the JSON.
- Use the SCHEMA EXACTLY. No extra keys outside what's listed. No prose fields with embedded JSON.
- Generate stable IDs ("w1", "w2", ..., "fa1", "fa2", ...). Unique within category, not globally.
- "confidence" must be exactly "high" | "medium" | "low" — never empty, never another word.
- "sourcePages" is REQUIRED on every line item. 1-indexed page numbers.
- Never invent counts, dimensions, or items that aren't visible.
- If you can't extract a quantity, list it in "doubleCheck" or "concerns" rather than guessing.
- For projects with no visible MEP / no site plan, list those in "missingScopes". Do not guess fixture counts.
- The contractor will REVIEW EVERY NUMBER. Lean CONSERVATIVE: better to mark "low confidence" than to overstate.
- BE GRANULAR: a residential set will typically have 5-15 wall types, 8-30 doors, 10-40 windows, 6-20 rooms. Don't roll everything into one or two summary line items.
- Empty arrays are FINE — output [] for any category that isn't represented in the drawings rather than fabricating a placeholder entry.`;
}

/**
 * Pick the actual model to call given the requested model + the user's
 * tier. Pre-fix the client's `model` was trusted blindly, so a forged
 * body could make a Pro user pay Enterprise prices. Now: clamp down to
 * the highest model the user's tier is entitled to.
 *
 * Also degrades gracefully — if Sonnet is requested but
 * ANTHROPIC_API_KEY isn't set, falls back to Gemini Pro instead of
 * failing the whole takeoff. The user notices the modelUsed string
 * changed in the response; the server logs the downgrade.
 */
function pickActualModel(requested: ModelKey | undefined, tier: Tier): ModelKey {
  const clientModel = (requested && ALLOWED_MODELS.includes(requested)) ? requested : DEFAULT_MODEL;
  // Clamp to the user's tier ceiling so a forged request can't escalate.
  const tierRank = TIER_RANK[tier];
  const requestedTierRank = TIER_RANK[MODEL_TIER[clientModel]];
  let chosen: ModelKey = requestedTierRank > tierRank
    ? modelForTier(tier)
    : clientModel;
  // Degrade Sonnet → Gemini Pro if the Anthropic key is missing. Better
  // to give the Enterprise user a working takeoff with the second-best
  // model than to fail loudly.
  if (chosen === 'claude-sonnet-4-5' && !ANTHROPIC_API_KEY) {
    console.log('[analyze-takeoff] ANTHROPIC_API_KEY not set, falling back to gemini-2.5-pro');
    chosen = 'gemini-2.5-pro';
  }
  return chosen;
}

async function callTakeoffModel(req: TakeoffRequest, tier: Tier): Promise<{ data: unknown; modelUsed: ModelKey }> {
  if (!req.pageUrls || req.pageUrls.length === 0) throw new Error('No page URLs provided.');
  if (req.pageUrls.length > 16) throw new Error('Maximum 16 pages per request — split larger sets.');

  const modelUsed = pickActualModel(req.model, tier);
  const imageParts = await Promise.all(req.pageUrls.map(urlToInlineImagePart));

  if (modelUsed === 'claude-sonnet-4-5') {
    return { data: await callClaude(req, imageParts), modelUsed };
  }
  return { data: await callGemini(req, modelUsed, imageParts), modelUsed };
}

async function callGemini(
  req: TakeoffRequest,
  modelUsed: 'gemini-2.5-flash' | 'gemini-2.5-pro',
  imageParts: { inlineData: { mimeType: string; data: string } }[],
): Promise<unknown> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured on the server.');

  // Takeoff JSON is denser than estimate JSON — schedules can have
  // dozens of doors/windows/finishes. Give Pro a generous output budget.
  const maxOutputTokens = modelUsed === 'gemini-2.5-pro' ? 64000 : 32000;

  const body = {
    contents: [{
      parts: [
        ...imageParts,
        { text: buildPrompt(req) },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens,
    },
  };

  const r = await fetch(`${geminiEndpoint(modelUsed)}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Gemini ${r.status}: ${errText.slice(0, 400)}`);
  }
  const json = await r.json();
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new Error('Gemini returned no text.');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse AI response as JSON: ${(e as Error).message}\nRaw: ${raw.slice(0, 400)}`);
  }
  return validateAndNormalize(parsed);
}

/**
 * Claude Sonnet 4.6 path — Enterprise tier. Anthropic doesn't have a
 * native JSON mode like Gemini's responseMimeType, so we use a single
 * Tool-Use definition with input_schema set to the takeoff shape.
 * Claude's tool_use response is already structured JSON, no parse step
 * needed; that's significantly more reliable than asking it to "return
 * JSON" in a system prompt (~14-20% structured-output failure rate
 * without tool use, per real-world reports).
 */
async function callClaude(
  req: TakeoffRequest,
  imageParts: { inlineData: { mimeType: string; data: string } }[],
): Promise<unknown> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured on the server.');

  // Anthropic image format — base64 wrapped in a `source` object instead
  // of `inlineData`. Otherwise the byte payloads are identical.
  const anthropicImageBlocks = imageParts.map(p => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: p.inlineData.mimeType,
      data: p.inlineData.data,
    },
  }));

  // Tool-use schema — Claude returns the JSON in `tool_use.input` when
  // it picks the tool. Schema mirrors the TakeoffResult shape but kept
  // permissive (no enum constraints) since validateAndNormalize below
  // is the authoritative shape check. Stricter schema = more refusals.
  const tool = {
    name: 'submit_takeoff',
    description: 'Submit the structured takeoff results extracted from the construction drawings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string' },
        scale: { type: 'object' },
        drawingsSeen: { type: 'array' },
        estimatedSquareFootage: { type: 'number' },
        grossEnvelopeSqFt: { type: 'number' },
        walls: { type: 'array' },
        floorAreas: { type: 'array' },
        doors: { type: 'array' },
        windows: { type: 'array' },
        finishes: { type: 'array' },
        fixtures: { type: 'array' },
        bulkMaterials: { type: 'array' },
        callouts: { type: 'array' },
        concerns: { type: 'array' },
        doubleCheck: { type: 'array' },
        missingScopes: { type: 'array' },
      },
      required: ['walls', 'doors', 'windows', 'finishes', 'fixtures', 'bulkMaterials', 'floorAreas', 'concerns', 'doubleCheck', 'missingScopes'],
    },
  };

  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,
    tools: [tool],
    tool_choice: { type: 'tool' as const, name: 'submit_takeoff' },
    messages: [
      {
        role: 'user' as const,
        content: [
          ...anthropicImageBlocks,
          { type: 'text' as const, text: buildPrompt(req) },
        ],
      },
    ],
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Anthropic ${r.status}: ${errText.slice(0, 400)}`);
  }
  const json = await r.json() as { content?: Array<{ type: string; input?: Record<string, unknown> }> };
  const toolUse = json.content?.find(c => c.type === 'tool_use');
  if (!toolUse?.input) {
    throw new Error('Claude did not return a tool_use response.');
  }
  return validateAndNormalize(toolUse.input);
}

// ---------------------------------------------------------------------------
// Validation
//
// Defensive normalization of the AI output. Catches the most common
// failure modes (missing keys, wrong confidence values, NaN quantities)
// and either coerces them to safe defaults or appends an internal
// "concern" so the UI surfaces the issue rather than silently mis-
// rendering.
// ---------------------------------------------------------------------------

const VALID_CONFIDENCE = ['high', 'medium', 'low'] as const;
type Confidence = typeof VALID_CONFIDENCE[number];
const VALID_WALL_CATEGORY = [
  'interior_partition', 'exterior_framed', 'exterior_masonry',
  'demising', 'shaft', 'foundation', 'other',
];
const VALID_FINISH_SURFACE = ['floor', 'wall', 'ceiling', 'base', 'casing', 'crown', 'trim', 'other'];
const VALID_FIXTURE_CATEGORY = ['plumbing', 'electrical', 'hvac', 'appliance', 'other'];
const VALID_BULK_UNIT = ['cy', 'sqft', 'tons', 'lbs', 'cf'];
const VALID_FINISH_UNIT = ['sqft', 'lf', 'ea'];
const VALID_READABILITY = ['clear', 'partial', 'poor'];
const VALID_SEVERITY = ['critical', 'moderate', 'minor'];
const VALID_CALLOUT_CONTEXT = [
  'wall_finish', 'floor_finish', 'ceiling_finish',
  'fixture', 'door', 'window', 'other',
];

// Type-guard helpers ---------------------------------------------------------
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function asConfidence(v: unknown): Confidence {
  return asEnum(v, VALID_CONFIDENCE, 'medium');
}
function asPages(v: unknown): number[] {
  return asArray(v)
    .map(p => Math.round(asNum(p, 0)))
    .filter(p => p > 0);
}

function validateAndNormalize(raw: Record<string, unknown>): Record<string, unknown> {
  const warnings: string[] = [];

  const summary = asString(raw.summary, 'No summary provided.');

  // scale
  const rawScale = isObj(raw.scale) ? raw.scale : {};
  const scale = {
    num: asNum(rawScale.num, 0.25),
    unit: asEnum(rawScale.unit, ['in', 'mm', 'cm'] as const, 'in'),
    perValue: asNum(rawScale.perValue, 1),
    perUnit: asEnum(rawScale.perUnit, ['ft', 'm'] as const, 'ft'),
    label: asString(rawScale.label, '1/4" = 1\'-0"'),
    confidence: asConfidence(rawScale.confidence),
    sourcePages: asPages(rawScale.sourcePages),
  };

  // drawingsSeen
  const drawingsSeen = asArray<Record<string, unknown>>(raw.drawingsSeen).map(d => ({
    page: Math.max(1, Math.round(asNum(d.page, 1))),
    type: asString(d.type, 'Unknown'),
    scope: asString(d.scope, ''),
    readability: asEnum(d.readability, VALID_READABILITY, 'partial'),
  }));

  // walls
  const walls = asArray<Record<string, unknown>>(raw.walls).map((w, i) => ({
    id: asString(w.id, `w${i + 1}`),
    typeCode: typeof w.typeCode === 'string' ? w.typeCode : undefined,
    category: typeof w.category === 'string' && VALID_WALL_CATEGORY.includes(w.category)
      ? w.category : undefined,
    description: asString(w.description, 'Wall'),
    lengthFt: Math.max(0, asNum(w.lengthFt, 0)),
    heightFt: Math.max(0, asNum(w.heightFt, 9)),
    csiDivision: typeof w.csiDivision === 'string' ? w.csiDivision : undefined,
    confidence: asConfidence(w.confidence),
    sourcePages: asPages(w.sourcePages),
    notes: typeof w.notes === 'string' ? w.notes : undefined,
  })).filter(w => w.lengthFt > 0);

  // floorAreas
  const floorAreas = asArray<Record<string, unknown>>(raw.floorAreas).map((f, i) => ({
    id: asString(f.id, `fa${i + 1}`),
    roomName: asString(f.roomName, 'Room'),
    finishCode: typeof f.finishCode === 'string' ? f.finishCode : undefined,
    areaSqFt: Math.max(0, asNum(f.areaSqFt, 0)),
    level: typeof f.level === 'number' && Number.isFinite(f.level) ? f.level : undefined,
    ceilingHeightFt: Math.max(0, asNum(f.ceilingHeightFt, 9)),
    csiDivision: typeof f.csiDivision === 'string' ? f.csiDivision : undefined,
    confidence: asConfidence(f.confidence),
    sourcePages: asPages(f.sourcePages),
    notes: typeof f.notes === 'string' ? f.notes : undefined,
  })).filter(f => f.areaSqFt > 0);

  // doors
  const doors = asArray<Record<string, unknown>>(raw.doors).map((d, i) => ({
    id: asString(d.id, `d${i + 1}`),
    mark: typeof d.mark === 'string' ? d.mark : undefined,
    description: asString(d.description, 'Door'),
    widthIn: Math.max(0, asNum(d.widthIn, 36)),
    heightIn: Math.max(0, asNum(d.heightIn, 80)),
    exterior: typeof d.exterior === 'boolean' ? d.exterior : undefined,
    count: Math.max(0, Math.round(asNum(d.count, 1))),
    csiDivision: typeof d.csiDivision === 'string' ? d.csiDivision : undefined,
    confidence: asConfidence(d.confidence),
    sourcePages: asPages(d.sourcePages),
  })).filter(d => d.count > 0);

  // windows
  const windows = asArray<Record<string, unknown>>(raw.windows).map((w, i) => ({
    id: asString(w.id, `win${i + 1}`),
    mark: typeof w.mark === 'string' ? w.mark : undefined,
    description: asString(w.description, 'Window'),
    widthIn: Math.max(0, asNum(w.widthIn, 36)),
    heightIn: Math.max(0, asNum(w.heightIn, 60)),
    count: Math.max(0, Math.round(asNum(w.count, 1))),
    csiDivision: typeof w.csiDivision === 'string' ? w.csiDivision : undefined,
    confidence: asConfidence(w.confidence),
    sourcePages: asPages(w.sourcePages),
  })).filter(w => w.count > 0);

  // finishes
  const finishes = asArray<Record<string, unknown>>(raw.finishes).map((f, i) => ({
    id: asString(f.id, `fn${i + 1}`),
    surface: asEnum(f.surface, VALID_FINISH_SURFACE, 'other'),
    code: typeof f.code === 'string' ? f.code : undefined,
    description: asString(f.description, 'Finish'),
    quantity: Math.max(0, asNum(f.quantity, 0)),
    unit: asEnum(f.unit, VALID_FINISH_UNIT, 'sqft'),
    csiDivision: typeof f.csiDivision === 'string' ? f.csiDivision : undefined,
    confidence: asConfidence(f.confidence),
    sourcePages: asPages(f.sourcePages),
  })).filter(f => f.quantity > 0);

  // fixtures
  const fixtures = asArray<Record<string, unknown>>(raw.fixtures).map((x, i) => ({
    id: asString(x.id, `fx${i + 1}`),
    category: asEnum(x.category, VALID_FIXTURE_CATEGORY, 'other'),
    mark: typeof x.mark === 'string' ? x.mark : undefined,
    description: asString(x.description, 'Fixture'),
    count: Math.max(0, Math.round(asNum(x.count, 1))),
    csiDivision: typeof x.csiDivision === 'string' ? x.csiDivision : undefined,
    confidence: asConfidence(x.confidence),
    sourcePages: asPages(x.sourcePages),
  })).filter(x => x.count > 0);

  // bulkMaterials
  const bulkMaterials = asArray<Record<string, unknown>>(raw.bulkMaterials).map((b, i) => ({
    id: asString(b.id, `bm${i + 1}`),
    description: asString(b.description, 'Bulk material'),
    quantity: Math.max(0, asNum(b.quantity, 0)),
    unit: asEnum(b.unit, VALID_BULK_UNIT, 'cy'),
    confidence: asConfidence(b.confidence),
    sourcePages: asPages(b.sourcePages),
    notes: typeof b.notes === 'string' ? b.notes : undefined,
  })).filter(b => b.quantity > 0);

  // callouts
  const callouts = asArray<Record<string, unknown>>(raw.callouts).map(c => ({
    code: asString(c.code, '?'),
    context: asEnum(c.context, VALID_CALLOUT_CONTEXT, 'other'),
    occurrences: Math.max(1, Math.round(asNum(c.occurrences, 1))),
    sourcePages: asPages(c.sourcePages),
  })).filter(c => c.code !== '?');

  // concerns + housekeeping
  const concerns = asArray<Record<string, unknown>>(raw.concerns).map(c => ({
    severity: asEnum(c.severity, VALID_SEVERITY, 'minor'),
    topic: asString(c.topic, 'Concern'),
    detail: asString(c.detail, ''),
    recommendation: asString(c.recommendation, ''),
    sourcePages: asPages(c.sourcePages),
  }));
  const doubleCheck = asArray<unknown>(raw.doubleCheck)
    .map(s => asString(s, ''))
    .filter(s => s.length > 0);
  const missingScopes = asArray<unknown>(raw.missingScopes)
    .map(s => asString(s, ''))
    .filter(s => s.length > 0);

  // Sanity checks — surface as warnings appended to concerns.
  if (walls.length === 0 && floorAreas.length === 0 && doors.length === 0 && windows.length === 0) {
    warnings.push('Empty takeoff: no walls, floor areas, doors, or windows extracted.');
  }
  if (scale.confidence === 'low') {
    warnings.push('Drawing scale could not be confidently determined — quantities may be off.');
  }

  for (const w of warnings) {
    concerns.push({
      severity: 'moderate',
      topic: 'Validation warning',
      detail: w,
      recommendation: 'Re-run with a higher-resolution PDF or supply scale manually.',
      sourcePages: [],
    });
  }

  return {
    summary,
    scale,
    drawingsSeen,
    estimatedSquareFootage: typeof raw.estimatedSquareFootage === 'number'
      && Number.isFinite(raw.estimatedSquareFootage) ? raw.estimatedSquareFootage : null,
    grossEnvelopeSqFt: typeof raw.grossEnvelopeSqFt === 'number'
      && Number.isFinite(raw.grossEnvelopeSqFt) ? raw.grossEnvelopeSqFt : null,
    walls,
    floorAreas,
    doors,
    windows,
    finishes,
    fixtures,
    bulkMaterials,
    callouts,
    concerns,
    doubleCheck,
    missingScopes,
    confidenceOverall: asConfidence(raw.confidenceOverall),
    confidenceExplanation: asString(raw.confidenceExplanation, ''),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  // Server-side paywall: takeoff is Pro/Business. Same gate as
  // analyze-drawings — burns Gemini Vision tokens.
  const auth = await requireTier(req, ['pro', 'business'], 'analyze_takeoff');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  try {
    const body = await req.json() as TakeoffRequest;
    if (!body || !Array.isArray(body.pageUrls)) {
      return jsonResponse({ success: false, error: 'Missing pageUrls' }, 400);
    }
    // gemini-2.5-pro is Business only.
    if (body.model === 'gemini-2.5-pro' && auth.tier !== 'business') {
      body.model = 'gemini-2.5-flash';
    }

    // Counts under the analyze_drawings cap (same upstream API spend).
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

    const { data, modelUsed } = await callTakeoffModel(body, auth.tier);
    return jsonResponse({ success: true, data, modelUsed, usage: { used, cap } });
  } catch (e) {
    console.error('[analyze-takeoff] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
