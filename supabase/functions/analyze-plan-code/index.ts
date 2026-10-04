// analyze-plan-code
//
// Vision pre-check of ONE construction drawing for likely code issues
// (utils/planCodeReviewer.ts → this). Pro+ (requireTier), metered per call on
// `plan_code_review`.
//
// Review 2026-09-04 (B3 / A6 sibling): this relay sat outside the named list
// but is live from the app, so it gets the same shape as analyze-drawings —
// a fail-closed per-user hourly bucket BEFORE the monthly precheck, a bounded
// Gemini fetch (CORS 504 with spent=false on abort), the unit charged only
// once the model answered (AI-F8), and generic error bodies: the upstream
// status text and any raw model output stay in the server log (AI-F16).
//
// Plan Review honesty (lane C, 2026-09-26): every finding now comes back with
// `citedEdition` and `section` split out of the model's citation, plus an
// `evidence` level the SERVER stamps — never the model. There is no code lookup
// behind this function, so that level is always "model_recall"; the client puts
// the same recall chip, rung badge and edition-mismatch badge on it that Code
// Check carries, comparing `citedEdition` against the jurisdiction's own row.
//
// Plan Set Code Sweep (list-2 lane S, 2026-09-26): an OPTIONAL `sweep` field
// ({ scopeTargets }) turns one call into a scope-aimed pre-check whose findings
// are QUESTIONS FOR THE ARCHITECT: the prompt names the GC's scope, forbids the
// "violation / non-compliant / fails code / illegal" vocabulary, and asks for a
// `question` and an approximate `location` per finding. Without `sweep` the
// prompt, the normalized result and every other byte are exactly what Plan
// Review sent and received before (scripts/validate-plan-sweep.ts pins both
// against the pre-sweep base). Tiering, caps, the hourly bucket, CORS and the
// error bodies are unchanged; `evidence` stays server-stamped.
//
// Code cards (lane CCSERVER, 2026-10-03): a sweep request may also carry
// `sweep.codeCards: true`. Only then does the prompt ask for a `status`
// ('fix' | 'ask' | 'ok') and a guessed inspection `stage` on every row, and
// only then does the result carry them: each finding gains `status` ('fix' or
// 'ask', never 'ok'), `stage` (or null) and `stageIsGuess: true`, and the rows
// the model says look right as drawn come back in a SEPARATE `lookRight` list
// (status 'ok'), so no consumer can turn one into an architect question or an
// RFI draft by accident (an ok row's question is null and its severity low,
// and there are at most 10 of them). An 'ok' row with nothing observed is
// dropped, and a status the model left out or garbled reads 'ask', never 'ok'. Without the
// flag the sweep prompt and result are byte-identical to what they were
// (scripts/validate-code-card-server.ts pins both against the untouched file).
//
// Secrets: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageGet, aiUsageIncrement, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MODEL = "gemini-2.5-flash";
function geminiEndpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
}

// B3 (review 2026-09-04): per-user hourly request ceiling + bounded upstream
// fetch. A hung socket returns a CORS-carrying 504 instead of the isolate dying
// at the wall clock; aborts and network failures are UpstreamErrors with
// spent=false (no model answer → no charge).
const HOURLY_LIMIT = 30;
const VISION_TIMEOUT_MS = 120_000;

// Audit AI-F16: upstream failures are reported to the client generically; the
// raw Gemini text (which can echo model output) stays in the server log.
// `spent` records whether the model actually answered (2xx) so the handler
// charges the monthly unit only when the spend was real (AI-F8).
class UpstreamError extends Error {
  constructor(message: string, readonly spent: boolean, readonly status = 502) {
    super(message);
    this.name = 'UpstreamError';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new UpstreamError(`upstream timed out after ${ms} ms`, false, 504);
    throw new UpstreamError(`upstream network error: ${(e as Error).message}`, false, 502);
  } finally {
    clearTimeout(timer);
  }
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

// <pure:planPrompt>
interface PlanCodeRequest {
  imageBase64: string;
  mimeType: string;
  location?: string;
  projectType?: string;
  /** The adopted-code facts for this jobsite, built CLIENT-SIDE by
   *  utils/codeJurisdiction.groundingFactsFor. Exactly the text the prompt
   *  carries and the chip shows, so the two can never disagree. */
  jurisdictionBlock?: string;
  /** Plan Set Code Sweep only. Absent on every Plan Review call.
   *  `codeCards: true` (code cards) adds status + stage + lookRight. */
  sweep?: { scopeTargets?: unknown; codeCards?: unknown };
}

/** The inspection a row's item is checked at — the client's CodeStage. */
const CODE_CARD_STAGES = ["footing", "foundation", "framing", "rough", "insulation", "final", "other"] as const;
/** The row fields a code-card sweep adds to the JSON shape, spliced in before
 *  the closing of each finding. */
const CODE_CARD_ROW_FIELDS = `,"status":"fix|ask|ok","stage":"${CODE_CARD_STAGES.join("|")}"`;

/**
 * True only for a sweep object whose `codeCards` is exactly `true`. Anything
 * else (absent, "true", 1, a Plan Review call with no sweep) is the old path.
 */
function sweepCodeCardsOf(sweep: unknown): boolean {
  if (!sweep || typeof sweep !== "object" || Array.isArray(sweep)) return false;
  return (sweep as { codeCards?: unknown }).codeCards === true;
}

/**
 * The sweep's scope targets, sanitised: at most 8, each one line, control
 * characters stripped, clipped to 80 characters, empties dropped. null when the
 * request carries no `sweep` object at all — the Plan Review path.
 */
function sweepTargetsOf(sweep: unknown): string[] | null {
  if (!sweep || typeof sweep !== "object" || Array.isArray(sweep)) return null;
  const raw = (sweep as { scopeTargets?: unknown }).scopeTargets;
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const t of list) {
    if (typeof t !== "string") continue;
    const clean = t.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
    if (clean) out.push(clean);
    if (out.length >= 8) break;
  }
  return out;
}

function buildPrompt(req: PlanCodeRequest): string {
  const loc = req.location?.trim() || "jurisdiction unknown";
  const ptype = req.projectType?.trim() || "residential/commercial construction";
  // The adopted edition, when the client could resolve one. Plan Review used to
  // ask for "general IRC/IBC" while Code Check -- one toggle to the left in the
  // same screen -- resolved the jurisdiction's ACTUAL adopted code and cited it
  // (audit 2026-09-07, theme 4: the engine is uncalled where it matters most).
  // A GC does not build to a general IRC; he builds to the edition his AHJ
  // adopted, and the two differ in exactly the places a plan examiner stops him.
  const juris = req.jurisdictionBlock?.trim() || "";
  // Plan Set Code Sweep: null on every Plan Review call, so each sweep entry
  // below is '' there and filter(Boolean) drops it — the Plan Review prompt is
  // byte-identical to what it was before the sweep existed.
  const sweep = sweepTargetsOf(req.sweep);
  // Code cards: false on every Plan Review call and on every sweep without the
  // flag, so each entry below that reads it is '' there (dropped by the filter).
  const cards = sweep !== null && sweepCodeCardsOf(req.sweep);
  const sweepShape = '{"findings":[{"category":"egress|stairs|width|height|fire|ada|guards|other","codeRef":"code and section as you would print it","citedEdition":"code family and edition year","section":"section number only, or empty","requirement":"what code requires, paraphrased in your own words","observed":"what the drawing shows","severity":"high|med|low","confidence":"high|med|low","question":"one plain question the contractor can send the architect about this item, phrased as a question","location":{"x":0.0-1.0,"y":0.0-1.0}}],"disclaimer":"one sentence reminding the GC to verify against the local code official"}';
  return [
    "You are a meticulous building-code plan reviewer. Review THIS construction drawing for LIKELY code issues a plan examiner would flag.",
    `Project location: ${loc}. Project type: ${ptype}.`,
    juris,
    juris
      ? "Cite the ADOPTED edition named above wherever it covers the issue, and say which edition you are citing. Fall back to general IRC/IBC (and ADA where relevant) only for something that block does not cover. Never invent a local amendment that is not listed."
      : "Cite general IRC/IBC sections (and ADA where relevant). If the location is unknown, give general IRC/IBC guidance and do not invent local amendments.",
    sweep && sweep.length > 0
      ? `The general contractor's scope on this job includes: ${sweep.join("; ")}. Look first for items on this sheet that relate to that scope. Still flag ONLY what you can actually see.`
      : "",
    sweep
      ? "Write every field as a question or an observation for the architect. Never use the words 'violation', 'violates', 'non-compliant', 'fails code' or 'illegal'."
      : "",
    cards
      ? "Give every row a status. fix: the sheet shows something that looks like it misses the requirement. ask: the sheet does not show enough to tell, so it is a question for the architect. ok: an item in the contractor's scope that you can see drawn and that looks right as drawn. Add ok rows too, but only for items you can actually see on this sheet, and say in observed what you saw. At most 10 ok rows. If you are unsure, use ask."
      : "",
    cards
      ? `stage is your best guess at which inspection checks the item: ${CODE_CARD_STAGES.join(", ")}. It is a guess the contractor can change.`
      : "",
    "Only flag what you can ACTUALLY SEE in the drawing. Prefer fewer high-confidence findings over speculation. This is a PRE-CHECK the GC will verify against their AHJ — it is not a substitute for plan review.",
    "You cannot look anything up: every section number is your own recall. Give a section only when you are certain of it; otherwise leave section empty and describe the requirement.",
    "Write every requirement in your own words. Never quote or reproduce the text of any model code (ICC, NFPA) word for word.",
    // The app shows a line only when it reads as plain words (its own-words
    // gate: no quotation marks, no sentence over 25 words). An inch written
    // as a mark, or a drawing note copied in quotes, costs the contractor the line.
    `Write ${sweep ? "requirement, observed and question" : "requirement and observed"} as short plain sentences of under 25 words, with no quotation marks. Write inches as in. and feet as ft (36 in., 6 ft 8 in.), never with the " or ' marks.`,
    juris
      ? "For each finding, citedEdition is the code family and edition you are citing, exactly as named in the jurisdiction block above when that block covers it, and section is the section number alone."
      : "For each finding, citedEdition is the model-code family and the edition year you are recalling (the family alone if you are unsure of the year), and section is the section number alone.",
    "Return STRICT JSON of this exact shape and nothing else:",
    sweep
      ? (cards ? sweepShape.replace('}}],"disclaimer"', `}${CODE_CARD_ROW_FIELDS}}],"disclaimer"`) : sweepShape)
      : '{"findings":[{"category":"egress|stairs|width|height|fire|ada|guards|other","codeRef":"code and section as you would print it","citedEdition":"code family and edition year","section":"section number only, or empty","requirement":"what code requires, paraphrased in your own words","observed":"what the drawing shows that conflicts","severity":"high|med|low","confidence":"high|med|low"}],"disclaimer":"one sentence reminding the GC to verify against the local code official"}',
    sweep
      ? "location is the approximate centre of the item on the sheet as a fraction of width/height, or null if you cannot place it."
      : "",
    'If you see no likely issues, return {"findings":[],"disclaimer":"..."}.',
  ].filter(Boolean).join("\n");
}
// </pure:planPrompt>

// <pure:normalizePlanResult>
/**
 * What the client receives for one finding. `evidence` is stamped HERE, never
 * read from the model: nothing behind this function retrieves code text, so
 * the only honest level is model recall. A model that writes its own
 * "evidence": "verified" is ignored, and so is any other field it invents.
 */
const PLAN_FINDING_EVIDENCE = "model_recall" as const;
/** The same seven stages the prompt offers (CODE_CARD_STAGES above), repeated
 *  so this block runs on its own; validate-code-card-server keeps them equal. */
const PLAN_CARD_STAGES = ["footing", "foundation", "framing", "rough", "insulation", "final", "other"] as const;
/** The prompt asks for at most 10 ok rows; the server holds it to that. */
const PLAN_LOOK_RIGHT_MAX = 10;
interface PlanFindingOut {
  category: string;
  codeRef: string;
  citedEdition: string | null;
  section: string | null;
  requirement: string;
  observed: string;
  severity: string;
  confidence: string;
  evidence: typeof PLAN_FINDING_EVIDENCE;
  /** Sweep only — never a key on a Plan Review finding. */
  question?: string | null;
  location?: { x: number; y: number } | null;
  /** Code-card sweep only (`sweep.codeCards: true`). A finding is 'fix' or
   *  'ask'; 'ok' rows live in `lookRight`, never in `findings`. */
  status?: "fix" | "ask" | "ok";
  stage?: string | null;
  stageIsGuess?: true;
}
function normalizePlanResult(
  raw: unknown,
  sweep = false,
  cards = false,
): { findings: PlanFindingOut[]; disclaimer: string; lookRight?: PlanFindingOut[] } {
  // One line, bounded: a model string never carries a newline or a wall of text
  // into a card, and never an empty-looking value that is only whitespace.
  const clip = (v: unknown, max: number): string =>
    typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  const obj = raw && typeof raw === "object" ? raw as { findings?: unknown; disclaimer?: unknown } : {};
  const sweepQuestion = (v: unknown): string | null => {
    const q = clip(v, 300);
    if (!q) return null;
    if (q.endsWith("?")) return q;
    const stem = q.slice(0, 299).replace(/[\s.!:;,]+$/, "");
    return stem ? `${stem}?` : null;
  };
  const sweepLocation = (v: unknown): { x: number; y: number } | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const { x, y } = v as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };
  const list = Array.isArray(obj.findings) ? obj.findings.slice(0, 40) : [];
  const findings: PlanFindingOut[] = [];
  // Code cards only. The stage is the model's guess and is labelled one; a
  // stage outside the client's list is null, never coerced to a near match.
  const lookRight: PlanFindingOut[] = [];
  const cardStage = (v: unknown): string | null => {
    const s = clip(v, 20).toLowerCase();
    return (PLAN_CARD_STAGES as readonly string[]).includes(s) ? s : null;
  };
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const citedEdition = clip(f.citedEdition, 80);
    const section = clip(f.section, 40);
    const row: PlanFindingOut = {
      category: clip(f.category, 20),
      codeRef: clip(f.codeRef, 120),
      citedEdition: citedEdition || null,
      section: section || null,
      requirement: clip(f.requirement, 600),
      observed: clip(f.observed, 600),
      severity: clip(f.severity, 8),
      confidence: clip(f.confidence, 8),
      evidence: PLAN_FINDING_EVIDENCE,
      // Sweep only: the question for the architect (always ends in '?') and
      // the approximate centre on the sheet, both clamped or null. A Plan
      // Review call never gets these keys, whatever the model wrote.
      ...(sweep ? { question: sweepQuestion(f.question), location: sweepLocation(f.location) } : {}),
    };
    if (!(sweep && cards)) {
      findings.push(row);
      continue;
    }
    // 'ok' only when the model said exactly that AND said what it saw; an ok
    // with nothing observed is dropped (an unsupported "looks right" is worse
    // than no row). Anything that is not 'fix' or 'ok' is a question: 'ask'.
    const said = clip(f.status, 8).toLowerCase();
    const stage = cardStage(f.stage);
    // An ok row carries no architect question and no alarm: question null,
    // severity low, so a renderer that reuses the findings row can never offer
    // "Ask architect" on something that looks right.
    if (said === "ok") {
      if (row.observed && lookRight.length < PLAN_LOOK_RIGHT_MAX) {
        lookRight.push({ ...row, severity: "low", question: null, status: "ok", stage, stageIsGuess: true });
      }
      continue;
    }
    findings.push({ ...row, status: said === "fix" ? "fix" : "ask", stage, stageIsGuess: true });
  }
  const disclaimer = clip(obj.disclaimer, 300);
  return sweep && cards ? { findings, disclaimer, lookRight } : { findings, disclaimer };
}
// </pure:normalizePlanResult>

function approxBase64Bytes(b64: string): number {
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

// Input is validated by the handler before this runs; everything thrown here
// is an UpstreamError so the handler can charge / report it uniformly.
async function callGemini(req: PlanCodeRequest): Promise<unknown> {
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
  const r = await fetchWithTimeout(`${geminiEndpoint()}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, VISION_TIMEOUT_MS);
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    // Upstream text stays server-side (AI-F16); not charged.
    throw new UpstreamError(`Gemini ${r.status}: ${errText.slice(0, 400)}`, false, 502);
  }
  // The model answered — the spend is real from here on (AI-F8).
  let json: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try {
    json = await r.json();
  } catch {
    throw new UpstreamError("Gemini returned an unreadable response", true, 502);
  }
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!raw) throw new UpstreamError("Gemini returned no text", true, 502);
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Never echo `raw` — a length-only marker is enough to debug.
    throw new UpstreamError(`Could not parse AI response as JSON: ${(e as Error).message} (len=${raw.length})`, true, 502);
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
    if (approxBase64Bytes(body.imageBase64) > MAX_PAGE_BYTES) {
      return jsonResponse({ success: false, error: "Image too large (max 8MB). Try a lower-resolution export." }, 413);
    }
    if (!GEMINI_API_KEY) {
      console.error("[analyze-plan-code] GEMINI_API_KEY not configured on the server");
      return jsonResponse({ success: false, error: "AI service not configured" }, 500);
    }

    // B3 (review 2026-09-04): per-user hourly request bucket, fail-CLOSED. Bounds
    // the precheck-then-charge window (N racing requests at cap-1) to at most
    // HOURLY_LIMIT model calls per user-hour whatever the client's concurrency;
    // master accounts included. rateLimitCount returns the POST-increment count,
    // so `n - 1 >= HOURLY_LIMIT` denies exactly the (HOURLY_LIMIT + 1)th request.
    const hourly = await rateLimitCount(`analyze-plan-code:user:${auth.userId}`);
    if (hourly < 0) return jsonResponse({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable' }, 503);
    if (hourly - 1 >= HOURLY_LIMIT) return jsonResponse({ success: false, error: `Hourly limit reached (${HOURLY_LIMIT} per hour). Try again in an hour.`, code: 'hourly_limit' }, 429);

    // Monthly cap PRECHECK (AI-F8: the unit is charged after the model answers
    // — see the success path and the UpstreamError branch below). aiUsageGet
    // fails CLOSED. Accepted window: N requests racing at cap-1 all pass this
    // read and each charges after, so one user's counter can overshoot the cap
    // by N-1 — never more.
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

    // Code cards: a sweep that opted in gets status, stage and lookRight. Same
    // call, same charge; without the flag the sweep branch below runs as before.
    if (sweepCodeCardsOf(body.sweep)) {
      const carded = normalizePlanResult(await callGemini(body), true, true);
      const cardsUsed = await aiUsageIncrement(auth.userId, "plan_code_review");
      return jsonResponse({ success: true, data: carded, usage: { used: cardsUsed, cap } });
    }
    // Plan Set Code Sweep: the same call, charged the same way, normalized with
    // the sweep fields. The Plan Review path below is untouched.
    if (sweepTargetsOf(body.sweep) !== null) {
      const swept = normalizePlanResult(await callGemini(body), true);
      const sweepUsed = await aiUsageIncrement(auth.userId, "plan_code_review");
      return jsonResponse({ success: true, data: swept, usage: { used: sweepUsed, cap } });
    }
    const data = normalizePlanResult(await callGemini(body));
    const newUsed = await aiUsageIncrement(auth.userId, "plan_code_review");
    return jsonResponse({ success: true, data, usage: { used: newUsed, cap } });
  } catch (e) {
    if (e instanceof UpstreamError) {
      // Charge only when the model actually answered (the spend is real even
      // if the answer was unusable); an upstream 5xx / timeout is free.
      if (e.spent) await aiUsageIncrement(auth.userId, "plan_code_review");
      console.error("[analyze-plan-code] upstream failure", e.message);
      return jsonResponse({ success: false, error: e.status === 504 ? 'The AI service timed out — please try again.' : 'The AI service returned an error — please try again.', code: e.status === 504 ? 'upstream_timeout' : 'upstream_error' }, e.status);
    }
    console.error("[analyze-plan-code] failed", e);
    return jsonResponse({ success: false, error: "Internal error — please try again." }, 500);
  }
});
