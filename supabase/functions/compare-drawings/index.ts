// compare-drawings
//
// Drawing rev-overlay — when the architect issues a revised sheet, AI
// compares old vs. new and reports what changed: scope added, scope
// removed, dimensions altered, notes/callouts revised, change-order
// implications.
//
// The headline win for the GC: revisions ship in 200-page bundles with
// no changelog. Manually walking each sheet to find the deltas takes
// hours and misses things — which becomes scope creep that goes
// unbilled. AI does it in 30 seconds per sheet pair.
//
// Tier: Pro / Business only. Counts under the same `analyze_drawings`
// monthly cap.
//
// Request:
// {
//   oldPageUrl: string;       // single image URL (current rev)
//   newPageUrl: string;       // single image URL (proposed rev)
//   sheetNumber?: string;     // "A-101" — context for the prompt
//   projectName?: string;
//   model?: 'gemini-2.5-flash' | 'gemini-2.5-pro';
// }
//
// Response: { success, data: { changes, severity, summary, ... } }
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

interface CompareRequest {
  oldPageUrl: string;
  newPageUrl: string;
  sheetNumber?: string;
  projectName?: string;
  model?: ModelKey;
}

async function urlToInlineImagePart(url: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'MAGE-ID/1.0 (compare-drawings; +https://mageid.app)',
      'Accept': 'image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
    },
  });
  if (!r.ok) throw new Error(`Could not fetch ${url} (${r.status})`);
  const ct = r.headers.get('content-type') ?? 'image/png';
  const mimeType = ct.startsWith('image/') ? ct.split(';')[0] : 'image/png';
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_PAGE_BYTES) {
    throw new Error(`Page too large: ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
  }
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { inlineData: { mimeType, data: btoa(bin) } };
}

function buildPrompt(req: CompareRequest): string {
  const ctx = [
    req.projectName ? `Project: ${req.projectName}` : '',
    req.sheetNumber ? `Sheet: ${req.sheetNumber}` : '',
  ].filter(Boolean).join('\n');

  return `You are a residential GC's pre-construction reviewer. Two images of the SAME architectural drawing sheet have been provided. The first image is the OLD revision. The second image is the NEW revision. Your job: identify what changed and call out anything that affects scope, cost, or schedule.

${ctx}

Approach:
1. Compare the two sheets visually. Look at dimensions, callouts, fixture/equipment counts, room labels, wall thicknesses, openings, finish codes.
2. Categorize each change as one of:
   - "added"   — scope present in NEW but not OLD (new fixture, new wall, larger room, new note requiring work)
   - "removed" — scope present in OLD but not NEW (deleted door, removed fixture, dropped finish)
   - "modified"— same item exists in both but with different values (changed dimension, swapped finish code, changed elevation)
   - "renote"  — note text changed but with no clear scope impact (clarification only)
3. For each change, give a one-sentence description in plain GC language. Reference WHERE on the sheet (room name, grid line, callout code).
4. Estimate cost / schedule impact: "none" | "minor" (under $1k or 1-day) | "moderate" ($1k-$10k or 2-7 days) | "major" (over $10k or week+).
5. Severity overall: "low" if all changes are renotes or minor; "medium" if any moderate; "high" if any major OR more than 5 changes total.

Return JSON only:
{
  "summary": "1-2 sentence plain-English summary the GC reads first",
  "severity": "low" | "medium" | "high",
  "changes": [
    {
      "type": "added" | "removed" | "modified" | "renote",
      "location": "where on the sheet",
      "description": "what changed, in plain language",
      "impact": "none" | "minor" | "moderate" | "major",
      "suggestedAction": "1 short sentence — file CO, ask architect for clarification, etc."
    }
  ],
  "rfiCandidates": [
    {
      "subject": "short headline if anything is ambiguous and needs an RFI to the architect",
      "question": "the specific question to ask"
    }
  ]
}

CRITICAL:
- JSON only. No markdown fences. No prose outside JSON.
- If the two sheets appear identical, return changes: [], severity: "low", summary: "No changes detected."
- Never invent. If you can't see a clear diff, omit it.
- "renote" entries should NOT be flagged as moderate / major impact.`;
}

interface ChangeEntry {
  type: 'added' | 'removed' | 'modified' | 'renote';
  location: string;
  description: string;
  impact: 'none' | 'minor' | 'moderate' | 'major';
  suggestedAction: string;
}
interface RfiCandidate { subject: string; question: string }
interface CompareResult {
  summary: string;
  severity: 'low' | 'medium' | 'high';
  changes: ChangeEntry[];
  rfiCandidates: RfiCandidate[];
}

const VALID_TYPES = new Set(['added', 'removed', 'modified', 'renote']);
const VALID_IMPACT = new Set(['none', 'minor', 'moderate', 'major']);
const VALID_SEVERITY = new Set(['low', 'medium', 'high']);

function asArr<T = unknown>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function asStr(v: unknown, fallback = ''): string { return typeof v === 'string' ? v : fallback; }

function validate(raw: Record<string, unknown>): CompareResult {
  const sev = asStr(raw.severity);
  return {
    summary: asStr(raw.summary, 'No summary returned.'),
    severity: VALID_SEVERITY.has(sev) ? (sev as CompareResult['severity']) : 'low',
    changes: asArr<Record<string, unknown>>(raw.changes).map(c => {
      const t = asStr(c.type);
      const imp = asStr(c.impact);
      return {
        type: VALID_TYPES.has(t) ? (t as ChangeEntry['type']) : 'modified',
        location: asStr(c.location).slice(0, 120),
        description: asStr(c.description).slice(0, 400),
        impact: VALID_IMPACT.has(imp) ? (imp as ChangeEntry['impact']) : 'minor',
        suggestedAction: asStr(c.suggestedAction).slice(0, 240),
      };
    }).filter(c => c.description.length > 0),
    rfiCandidates: asArr<Record<string, unknown>>(raw.rfiCandidates).map(r => ({
      subject: asStr(r.subject).slice(0, 120),
      question: asStr(r.question).slice(0, 600),
    })).filter(r => r.subject.length > 0 && r.question.length > 0),
  };
}

async function callGemini(req: CompareRequest): Promise<{ data: CompareResult; modelUsed: ModelKey }> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured.');
  const requested = req.model ?? DEFAULT_MODEL;
  const modelUsed: ModelKey = ALLOWED_MODELS.includes(requested) ? requested : DEFAULT_MODEL;
  const [oldImg, newImg] = await Promise.all([
    urlToInlineImagePart(req.oldPageUrl),
    urlToInlineImagePart(req.newPageUrl),
  ]);
  const body = {
    contents: [{
      parts: [
        { text: 'OLD revision (compare to NEW which follows):' },
        oldImg,
        { text: 'NEW revision:' },
        newImg,
        { text: buildPrompt(req) },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 6000,
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
  return { data: validate(parsed), modelUsed };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);

  const auth = await requireTier(req, ['pro', 'business'], 'compare_drawings');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  try {
    const body = await req.json() as CompareRequest;
    if (!body || typeof body.oldPageUrl !== 'string' || typeof body.newPageUrl !== 'string') {
      return jsonResponse({ success: false, error: 'oldPageUrl + newPageUrl required' }, 400);
    }
    if (body.model === 'gemini-2.5-pro' && auth.tier !== 'business' && auth.tier !== 'enterprise') {
      body.model = 'gemini-2.5-flash';
    }
    const used = await aiUsageIncrement(auth.userId, 'analyze_drawings');
    const cap = MONTHLY_CAPS[auth.tier].analyze_drawings;
    if (used > cap) {
      return jsonResponse({
        success: false,
        error: `Monthly drawing-analysis limit reached (${cap} on ${auth.tier}).`,
        code: 'monthly_cap_reached',
        used, cap,
      }, 429);
    }

    const { data, modelUsed } = await callGemini(body);
    return jsonResponse({ success: true, data, modelUsed, usage: { used, cap } });
  } catch (e) {
    console.error('[compare-drawings] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
