// safety-generate-jha
//
// Text → Job Hazard Analysis. Input { trade, taskDescription, projectContext? }
// returns { steps: [{ step, hazards[], controls[] }], requiredPPE[] } for the
// user to REVIEW and edit before saving (client sets aiGenerated: true). No
// images — pure text prompt to Gemini. Business-tier gated; metered against the
// safety_ai monthly cap (text). Fail-closed: on any error the client keeps the
// manual JHA form.
//
// Secrets required: GEMINI_API_KEY (Google AI Studio).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, aiUsageGet, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

interface GenerateJhaRequest {
  trade?: string;
  taskDescription?: string;
  projectContext?: string;
}

interface JhaStepOut {
  step: string;
  hazards: string[];
  controls: string[];
}

const JHA_PROMPT = `You are a construction safety professional (CHST) writing a Job Hazard Analysis (JHA) for a residential/commercial GC crew. Break the task into its sequential work steps; for each step list the specific hazards a worker faces and the controls that eliminate or mitigate each hazard (prefer elimination > engineering controls > administrative controls > PPE). Then list the PPE required for the whole task.

Return a single JSON object:
{
  "steps": [
    { "step": "short imperative work step (<=100 chars)", "hazards": ["specific hazard", ...], "controls": ["specific control", ...] }
  ],
  "requiredPPE": ["Hard hat", "Safety glasses", ...]
}

Rules:
- 4-10 steps. Each step has 1-4 hazards and 1-4 controls. Be specific and site-real ("Silica dust from cutting masonry" not "dust").
- requiredPPE: 3-8 concrete items.
- Return JSON only — no preamble.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  const auth = await requireTier(req, ['business'], 'safety_generate_jha');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: GenerateJhaRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const trade = String(body.trade ?? '').slice(0, 120);
  const taskDescription = String(body.taskDescription ?? '').slice(0, 2000);
  if (!taskDescription.trim()) return jsonResponse({ success: false, error: 'taskDescription is required' }, 400);

  // Read the current count first and deny an over-cap request WITHOUT
  // persisting an increment, so rejected retries don't climb the counter;
  // increment only when we're actually going to call Gemini.
  const cap = MONTHLY_CAPS[auth.tier].safety_ai;
  const used = await aiUsageGet(auth.userId, 'safety_ai');
  if (used >= cap) {
    return jsonResponse({
      success: false,
      error: `Monthly safety-AI limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached', used, cap,
    }, 429);
  }
  await aiUsageIncrement(auth.userId, 'safety_ai');

  const ctxLine = [
    trade ? `Trade: ${trade}` : null,
    body.projectContext ? `Project context: ${String(body.projectContext).slice(0, 800)}` : null,
    `Task: ${taskDescription}`,
  ].filter(Boolean).join('\n');
  const prompt = `${ctxLine}\n\n${JHA_PROMPT}`;

  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 2000 },
      }),
    });
  } catch (e) {
    return jsonResponse({ success: false, error: `Gemini network error: ${(e as Error).message}` }, 502);
  }
  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    return jsonResponse({ success: false, error: `Gemini ${geminiResp.status}: ${text.slice(0, 200)}` }, 502);
  }

  let j: unknown;
  try { j = await geminiResp.json(); } catch { return jsonResponse({ success: false, error: 'Gemini returned non-JSON' }, 502); }
  const raw = (j as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return jsonResponse({ success: false, error: 'Gemini returned non-JSON', raw }, 500); }

  const o = (parsed ?? {}) as Record<string, unknown>;
  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  const steps: JhaStepOut[] = rawSteps.map((s): JhaStepOut => {
    const r = (s ?? {}) as Record<string, unknown>;
    return {
      step: String(r.step ?? '').slice(0, 200),
      hazards: Array.isArray(r.hazards) ? r.hazards.map((h) => String(h).slice(0, 200)) : [],
      controls: Array.isArray(r.controls) ? r.controls.map((c) => String(c).slice(0, 200)) : [],
    };
  }).filter((s) => s.step.length > 0);
  const requiredPPE = Array.isArray(o.requiredPPE) ? o.requiredPPE.map((p) => String(p).slice(0, 100)).filter(Boolean) : [];

  return jsonResponse({ success: true, data: { steps, requiredPPE } });
});
