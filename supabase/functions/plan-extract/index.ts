// plan-extract
//
// Vision transcription of ONE plan sheet into dense, searchable text for
// project-memory ("Ask Your Plans": utils/plans/askYourPlans.ts → this →
// project-memory-embed). Business+ (requireTier), metered per call on
// `plan_extract`.
//
// Review 2026-09-04 (B3 / A6 sibling): this relay sat outside the named list
// but is live from the app, so it gets the same shape as analyze-drawings —
// a fail-closed per-user hourly bucket BEFORE the monthly precheck, a bounded
// Gemini fetch (CORS 504 with spent=false on abort), the unit charged only
// once the model answered (AI-F8), and generic error bodies: the upstream
// status text and any raw model output stay in the server log (AI-F16).
//
// Audit round 2 (#19): accepts `storagePath` instead of `imageBase64`. The
// function downloads the sheet with the service role after the same project
// access check compare-drawings and analyze-spec-book use (DB-F11,
// _shared/planSheetBytes.ts). The client-side download it replaces had no web
// branch, so on app.mageid.app every sheet failed to read and Ask Your Plans
// indexed nothing. `imageBase64` stays for device-only sheets (a photo that was
// never uploaded) and for one release of older clients.
//
// OWNER SCOPE (audit #161). A storagePath read is a read of a PROJECT's
// sheet, so it is metered on the project OWNER's plan: after the caller is
// confirmed as the owner or an accepted collaborator, the Business gate and the
// monthly plan_extract cap are the owner's, and the unit is charged to him.
// Only the owner or an editor may spend it (a viewer or field seat asks the
// index, it does not build it). The hourly limit stays on the caller. A bare
// imageBase64 has no project and stays on the caller's own plan.
//
// Secrets: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageGet, aiUsageIncrement, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";
import { loadPlanSheetImageParts, planSheetProjectId, PlanSheetAccessError } from "../_shared/planSheetBytes.ts";
import { mayWritePlanIndex, tierMeets, ownerPlanRefusal, type Tier } from "../project-memory-embed/planScope.ts";
import { resolvePlanScope, tierOfUser } from "../project-memory-embed/planScopeIo.ts";

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

interface PlanExtractRequest {
  imageBase64: string;
  mimeType: string;
  sheetNumber?: string;
  /** Bucket-relative plan-sheets path; when present the function reads the bytes. */
  storagePath?: string;
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
    // TITLE BLOCK as its own fields (audit round 2, #21). The transcription
    // already contains the sheet number, but only as prose inside one blob, so
    // a PDF import could not read it back — every page came in as
    // "<file> — Page 7" with no sheetNumber, and addPlanSheet's whole revision
    // chain (supersede + Rev N+1) never fired for a re-issued set. Pulling the
    // three fields out here is what lets the importer name the sheet.
    "Separately from the transcription, report the title block EXACTLY as printed:",
    "- sheetNumber: the drawing number, e.g. \"A-201\", \"S1.02\", \"M-101\". Not the page number, not the project number.",
    "- sheetTitle: the drawing title, e.g. \"SECOND FLOOR PLAN\".",
    "- revisionMark: the LATEST revision entry, e.g. \"3\", \"ASI-3\", \"Bulletin 2\".",
    'Any field you cannot read in the title block must be "" — never guess one from the file name, the page order, or another sheet.',
    "Return STRICT JSON of this exact shape and nothing else:",
    '{"text":"<full dense transcription>","sheetNumber":"","sheetTitle":"","revisionMark":""}',
    'If nothing is legible, return {"text":"","sheetNumber":"","sheetTitle":"","revisionMark":""}.',
  ].join("\n");
}

/** What the model read off the title block. Every field is optional: a sheet
 *  with no legible number must come back WITHOUT one, so the importer names it
 *  by file and page rather than inventing a number that a punch pin or an Ask
 *  Your Plans citation would then point at. */
export interface PlanTitleBlock { sheetNumber?: string; sheetTitle?: string; revisionMark?: string }

/** One title-block field: trimmed, length-capped, newlines collapsed. Empty →
 *  undefined, so `""` never reaches the client as a sheet number. */
function titleField(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const clean = v.replace(/\s+/g, " ").trim().slice(0, max);
  return clean ? clean : undefined;
}

function approxBase64Bytes(b64: string): number {
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

// Input is validated by the handler before this runs; everything thrown here
// is an UpstreamError so the handler can charge / report it uniformly.
async function callGemini(req: PlanExtractRequest): Promise<{ text: string; titleBlock: PlanTitleBlock }> {
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
  let parsed: { text?: string; sheetNumber?: unknown; sheetTitle?: unknown; revisionMark?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Never echo `raw` (a transcribed title block can carry names / addresses)
    // — a length-only marker is enough to debug.
    throw new UpstreamError(`Could not parse AI response as JSON: ${(e as Error).message} (len=${raw.length})`, true, 502);
  }
  if (typeof parsed.text !== "string") throw new UpstreamError("AI response missing 'text' field", true, 502);
  // The title block is best-effort: a model that answers the old one-field
  // shape (or leaves a field out) still returns a usable transcription.
  return {
    text: parsed.text,
    titleBlock: {
      sheetNumber: titleField(parsed.sheetNumber, 40),
      sheetTitle: titleField(parsed.sheetTitle, 120),
      revisionMark: titleField(parsed.revisionMark, 24),
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  // Identity first; the Business gate runs below against whoever is metered.
  const auth = await requireTier(req, ["free", "pro", "business", "enterprise"], "plan_extract");
  if (!auth.ok) return jsonResponse(auth.body, auth.status);
  // Charged after the model answers — to the caller, or for a project sheet to
  // the project owner (set below, before any spend).
  let meter: { userId: string; tier: Tier } = { userId: auth.userId, tier: auth.tier };

  try {
    const body = await req.json() as PlanExtractRequest;
    // Shape only here — the ACCESS check runs in loadPlanSheetImageParts, after
    // the limits, so a refused request never costs a storage download.
    const byPath = !!body && typeof body.storagePath === "string" && planSheetProjectId(body.storagePath) !== "";
    if (!body || (!byPath && (typeof body.imageBase64 !== "string" || !body.imageBase64))) {
      return jsonResponse({ success: false, error: "Missing imageBase64" }, 400);
    }
    let collaborator = false;
    if (byPath) {
      const scope = await resolvePlanScope(auth.userId, planSheetProjectId(body.storagePath));
      // Same generic 403 as an unreachable path (DB-F11): never say which.
      if (!scope) return jsonResponse({ success: false, error: "This plan sheet is not available on this account.", code: "sheet_unavailable" }, 403);
      if (!mayWritePlanIndex(scope.role)) {
        return jsonResponse({ success: false, error: "The project owner indexes the plan set — you can ask questions of the sheets they indexed.", code: "index_owner_only" }, 403);
      }
      if (scope.meterUserId !== auth.userId) {
        meter = { userId: scope.meterUserId, tier: await tierOfUser(scope.meterUserId) };
        collaborator = true;
      }
    }
    if (!tierMeets(meter.tier, "business")) {
      return jsonResponse({
        success: false,
        error: collaborator
          ? ownerPlanRefusal("Reading plan sheets", "business")
          : `This feature requires business or enterprise or higher. You're currently on ${meter.tier}.`,
        code: "tier_required",
      }, 403);
    }
    if (!byPath && approxBase64Bytes(body.imageBase64) > MAX_PAGE_BYTES) {
      return jsonResponse({ success: false, error: "Image too large (max 8MB). Try a lower-resolution export." }, 413);
    }
    if (!GEMINI_API_KEY) {
      console.error("[plan-extract] GEMINI_API_KEY not configured on the server");
      return jsonResponse({ success: false, error: "AI service not configured" }, 500);
    }

    // B3 (review 2026-09-04): per-user hourly request bucket, fail-CLOSED. Bounds
    // the precheck-then-charge window (N racing requests at cap-1) to at most
    // HOURLY_LIMIT model calls per user-hour whatever the client's concurrency;
    // master accounts included. rateLimitCount returns the POST-increment count,
    // so `n - 1 >= HOURLY_LIMIT` denies exactly the (HOURLY_LIMIT + 1)th request.
    const hourly = await rateLimitCount(`plan-extract:user:${auth.userId}`);
    if (hourly < 0) return jsonResponse({ success: false, error: 'Rate limiter unavailable — please try again in a moment.', code: 'rate_limiter_unavailable' }, 503);
    if (hourly - 1 >= HOURLY_LIMIT) return jsonResponse({ success: false, error: `Hourly limit reached (${HOURLY_LIMIT} per hour). Try again in an hour.`, code: 'hourly_limit' }, 429);

    // Monthly cap PRECHECK (AI-F8: the unit is charged after the model answers
    // — see the success path and the UpstreamError branch below). aiUsageGet
    // fails CLOSED. Accepted window: N requests racing at cap-1 all pass this
    // read and each charges after, so one user's counter can overshoot the cap
    // by N-1 — never more.
    const cap = MONTHLY_CAPS[meter.tier].plan_extract;
    const used = await aiUsageGet(meter.userId, "plan_extract");
    if (used >= cap) {
      return jsonResponse({
        success: false,
        error: `Monthly plan-extract limit reached (${cap} on ${meter.tier}). Resets on the 1st.`,
        code: "monthly_cap_reached",
        used,
        cap,
      }, 429);
    }

    if (byPath) {
      const [part] = await loadPlanSheetImageParts([body.storagePath as string], auth.userId, MAX_PAGE_BYTES);
      body.imageBase64 = part.inlineData.data;
      body.mimeType = part.inlineData.mimeType;
    }

    const { text, titleBlock } = await callGemini(body);
    const newUsed = await aiUsageIncrement(meter.userId, "plan_extract");
    // `text` keeps its old position and meaning — Ask Your Plans embeds it
    // unchanged. `titleBlock` is additive, for the PDF importer.
    return jsonResponse({ success: true, text, titleBlock, usage: { used: newUsed, cap } });
  } catch (e) {
    if (e instanceof PlanSheetAccessError) {
      // Generic 403 — never say whether the path was malformed or someone
      // else's project (DB-F11). Nothing was spent, nothing is charged.
      return jsonResponse({ success: false, error: "This plan sheet is not available on this account.", code: "sheet_unavailable" }, 403);
    }
    if (e instanceof UpstreamError) {
      // Charge only when the model actually answered (the spend is real even
      // if the answer was unusable); an upstream 5xx / timeout is free.
      if (e.spent) await aiUsageIncrement(meter.userId, "plan_extract");
      console.error("[plan-extract] upstream failure", e.message);
      return jsonResponse({ success: false, error: e.status === 504 ? 'The AI service timed out — please try again.' : 'The AI service returned an error — please try again.', code: e.status === 504 ? 'upstream_timeout' : 'upstream_error' }, e.status);
    }
    console.error("[plan-extract] failed", e);
    return jsonResponse({ success: false, error: "Internal error — please try again." }, 500);
  }
});
