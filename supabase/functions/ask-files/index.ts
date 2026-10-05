// ask-files
//
// MAGE reads files with Google Gemini and answers, in two modes:
//
//   mode 'ask'      Ask MAGE. The contractor attached up to 4 photos, PDFs or
//                   plan pages of his own job and typed a question.
//   mode 'message'  The client portal. The project OWNER asked for a reading of
//                   the files a client attached to one portal message.
//
// SHIPS OFF. ASK_FILES_SERVER_ENABLED, MESSAGE_SOURCE_ENABLED and
// MESSAGE_SOURCE_NOT_BEFORE live in ./core.ts and are all off. While the first
// is off this function answers 503 to every caller, before it checks who is
// calling and before it reads the body.
//
// WHAT IT NEVER DOES
//   - It never takes a location from the app. A plan page is a bucket key that
//     core.planSheetKey accepted character by character. While
//     PLAN_PAGES_OWNER_ONLY is on (it ships on) the caller must OWN that job:
//     the owner is checked here, before _shared/planSheetBytes.ts is asked for
//     anything, because that shared loader would also read for somebody the
//     owner shared the job with. The key that is loaded is the one the storage
//     rule (_shared/storagePath.ts) returned for it, pinned to a job that
//     passed that owner check (core.ownedPlanSheetKey).
//     A message file is two ids; _shared/messageFileBytes.ts rebuilds the key
//     from the live row and reads it for the project owner only.
//   - It never gives the model anything but this ask: the files, their cleaned
//     names, the question or the client's message text. No job records, no
//     earlier turns, no way for the model to call anything.
//   - It never writes anything the model said anywhere. The answer goes back
//     to the caller and that is all.
//   - It never logs a file name, a question, a message, an answer, a storage
//     location or the provider's response text. A log line here is fixed text,
//     a step label, an HTTP status and the caller's id.
//
// METERING. The caller is the only meter: Pro and up, one unit of the monthly
// analyze_photos allowance per answered ask whatever the file count, charged
// only once the model answered. A refusal, a provider block, a timeout and a
// provider error are free. An answer with nothing usable in it is charged (the
// spend was real). A per-user hourly bucket, fail closed, runs before the body
// is read, so a malformed request still spends a slot.
//
// CONSENT. Mode 'ask' is a tap in the app after the phone's own AI question.
// Mode 'message' sends a third person's files, so the account's stored answer
// is read here too and anything but yes stops the request before any file is
// loaded.
//
// Secrets: GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { aiCallerOf, inlineImageCount, logGeminiCall, noteAiCaller } from "../_shared/aiCallLog.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { requireTier, aiUsageGet, aiUsageIncrement, rateLimitCount, MONTHLY_CAPS } from "../_shared/auth.ts";
import { loadPlanSheetImageParts } from "../_shared/planSheetBytes.ts";
import { readOwnerAiConsent } from "../_shared/aiConsent.ts";
import {
  callerOwnsProject,
  loadOwnedMessageFiles,
  MessageFileAccessError,
  MessageFileRefusal,
  type LoadedMessage,
} from "../_shared/messageFileBytes.ts";
import {
  BODY_MAX_BYTES,
  DEVICE_TOTAL_MAX_BYTES,
  ERROR_TEXT,
  MESSAGE_FILE_MAX_BYTES,
  MESSAGE_SOURCE_NOT_BEFORE,
  PDF_MAX_PAGES,
  PLAN_PAGE_MAX_BYTES,
  PLAN_PAGES_OWNER_ONLY,
  TOTAL_MAX_BYTES,
  answerWasCut,
  base64ToBytes,
  buildAskRequest,
  buildMessageRequest,
  bytesToBase64,
  cleanName,
  clipAnswer,
  decodedBytes,
  featureGate,
  headBytes,
  hourlyLimitText,
  isBase64,
  kindFor,
  monthlyCapText,
  ownedPlanSheetKey,
  parseAskFilesRequest,
  parseMessageAnswer,
  planDisplayName,
  planKeyProject,
  planLoadFailure,
  readGeminiAnswer,
  sniffMatches,
  type AskFileRead,
  type ErrorCode,
  type InlinePart,
  type ModelRequest,
} from "./core.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const HOURLY_LIMIT = 30;
const VISION_TIMEOUT_MS = 120_000;
const METER_KEY = "analyze_photos";
const MODEL = "gemini-2.5-flash";
function geminiEndpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
}

// `spent` records whether the model answered (2xx): the unit is charged only
// when the spend was real. The text of one of these is fixed words and a
// status number, never anything the provider sent back.
class UpstreamError extends Error {
  constructor(readonly spent: boolean, readonly status = 502) {
    super(`model call failed (${status})`);
    this.name = "UpstreamError";
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new UpstreamError(false, 504);
    throw new UpstreamError(false, 502);
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

/** A failure with its own HTTP status. The sentence is the fixed one for the code. */
function fail(code: ErrorCode, status: number): Response {
  return jsonResponse({ success: false, error: ERROR_TEXT[code], code }, status);
}

/** A refusal about the files. HTTP 200 so the app can read which file; never charged. */
function refuse(code: ErrorCode, detail: { fileIndex?: number; pages?: number; limit?: number } = {}): Response {
  return jsonResponse({ success: false, code, error: ERROR_TEXT[code], ...detail }, 200);
}

/** The request body, read while counting. null as soon as it passes `max` bytes. */
async function readCappedBody(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > max) {
      try { await reader.cancel(); } catch { /* already closed */ }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Pages in a PDF, or null when it will not open (a password-protected PDF does not). */
async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = doc.getPageCount();
    return Number.isInteger(pages) && pages >= 1 ? pages : null;
  } catch {
    return null;
  }
}

/** The service client, or null when the server has no storage settings. */
function serviceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The one model call. Everything thrown here is an UpstreamError. */
async function callModel(request: ModelRequest): Promise<unknown> {
  const r = await logGeminiCall(null, { fn: "ask-files", feature: METER_KEY, userId: aiCallerOf(request).userId, model: MODEL, images: inlineImageCount(request.contents?.[0]?.parts), pdfPages: aiCallerOf(request).pdfPages }, async () => {
    return await fetchWithTimeout(`${geminiEndpoint()}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, VISION_TIMEOUT_MS);
  });
  if (!r.ok) {
    try { await r.body?.cancel(); } catch { /* nothing to release */ }
    throw new UpstreamError(false, 502);
  }
  // The model answered: the spend is real from here on.
  try {
    return await r.json();
  } catch {
    throw new UpstreamError(true, 502);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  // Off for everyone: before auth, before the body.
  if (featureGate("ask") !== "ok") return fail("feature_off", 503);

  const auth = await requireTier(req, ["pro", "business"], "ask_files");
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let step = "start";
  try {
    const declared = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) return fail("body_too_large", 413);

    // Per-user hourly bucket, fail closed, BEFORE the body is read: a request
    // that turns out to be malformed has still spent a slot.
    // rateLimitCount returns the count after this request, so `hourly - 1 >=
    // HOURLY_LIMIT` refuses exactly the request after the limit.
    step = "hourly";
    const hourly = await rateLimitCount(`ask-files:user:${auth.userId}`);
    if (hourly < 0) return fail("rate_limiter_unavailable", 503);
    if (hourly - 1 >= HOURLY_LIMIT) return jsonResponse({ success: false, error: hourlyLimitText(HOURLY_LIMIT), code: "hourly_limit" }, 429);

    step = "body";
    const bodyBytes = await readCappedBody(req, BODY_MAX_BYTES);
    if (bodyBytes === null) return fail("body_too_large", 413);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return fail("bad_request", 400);
    }
    const parsed = parseAskFilesRequest(payload);
    if (!parsed.ok) {
      if (parsed.code === "bad_request") return fail("bad_request", 400);
      return refuse(parsed.code, parsed.fileIndex === undefined ? {} : { fileIndex: parsed.fileIndex });
    }
    const ask = parsed.req;

    if (ask.mode === "message" && featureGate("message") !== "ok") return fail("feature_off", 503);

    // A client's files: the account itself must have said yes to AI.
    if (ask.mode === "message") {
      step = "account";
      const consent = await readOwnerAiConsent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, auth.userId);
      if (consent === "unavailable") return fail("ai_check_unavailable", 503);
      if (consent !== "granted") return fail("account_ai_off", 403);
    }

    // One entry per file, in request order: what the model is sent and what
    // "What I read" lists.
    const parts: InlinePart[] = [];
    const read: AskFileRead[] = [];
    let totalBytes = 0;

    // Files that came in the request: the bytes must be what they claim.
    step = "inline";
    if (ask.mode === "ask") {
      let deviceBytes = 0;
      for (let i = 0; i < ask.files.length; i++) {
        const file = ask.files[i];
        if (file.source !== "inline") continue;
        if (!isBase64(file.base64)) return refuse("unreadable_file", { fileIndex: i });
        const size = decodedBytes(file.base64);
        if (size === 0) return refuse("unreadable_file", { fileIndex: i });
        if (!sniffMatches(headBytes(file.base64), file.mime)) return refuse("unreadable_file", { fileIndex: i });
        deviceBytes += size;
        if (deviceBytes > DEVICE_TOTAL_MAX_BYTES) return refuse("files_too_large", { limit: DEVICE_TOTAL_MAX_BYTES });
        const kind = kindFor(file.mime) === "pdf" ? "pdf" : "image";
        const entry: AskFileRead = { index: i, name: cleanName(file.name, file.mime), kind };
        if (kind === "pdf") {
          const pages = await countPdfPages(base64ToBytes(file.base64));
          if (pages === null) return refuse("unreadable_file", { fileIndex: i });
          if (pages > PDF_MAX_PAGES) return refuse("too_many_pages", { fileIndex: i, pages, limit: PDF_MAX_PAGES });
          entry.pages = pages;
        }
        parts[i] = { inlineData: { mimeType: file.mime, data: file.base64 } };
        read[i] = entry;
      }
      totalBytes = deviceBytes;
    }

    if (!GEMINI_API_KEY) {
      console.error("[ask-files] GEMINI_API_KEY is not set on the server");
      return fail("not_configured", 500);
    }

    // Monthly allowance, checked before anything is loaded or sent. The unit
    // is charged after the model answers (below).
    step = "allowance";
    const cap = MONTHLY_CAPS[auth.tier].analyze_photos;
    const used = await aiUsageGet(auth.userId, METER_KEY);
    // Written as "not under the cap" so a plan with no number is refused, not unlimited.
    if (!(used < cap)) {
      return jsonResponse({ success: false, error: monthlyCapText(cap, auth.tier), code: "monthly_cap_reached", used, cap }, 429);
    }

    // Stored files, loaded by this function. Plan pages go one at a time, in
    // request order, each against the room that is left, and stop at the first
    // failure.
    step = "load";
    let messageBody = "";
    if (ask.mode === "ask") {
      // Plan pages: the caller must OWN each job a page belongs to. Every job
      // is checked before the first page is loaded, so one page that is not
      // his means nothing is read at all. Anything but the boolean false keeps
      // this check on.
      const ownedJobs = new Set<string>();
      if (PLAN_PAGES_OWNER_ONLY !== false) {
        const jobs = new Set<string>();
        for (const file of ask.files) {
          if (file.source === "plan") jobs.add(planKeyProject(file.storagePath));
        }
        if (jobs.size > 0) {
          step = "owner";
          const svc = serviceClient();
          if (!svc) {
            console.error("[ask-files] storage is not configured on the server");
            return fail("internal", 500);
          }
          for (const job of jobs) {
            if (!(await callerOwnsProject(svc, auth.userId, job))) return fail("file_unavailable", 403);
            ownedJobs.add(job);
          }
          step = "load";
        }
      }
      for (let i = 0; i < ask.files.length; i++) {
        const file = ask.files[i];
        if (file.source !== "plan") continue;
        // The storage rule, on the key the owner check was made for: exactly
        // <a job he owns>/<file>, or nothing is loaded. With the owner rule
        // switched off the shared loader applies the same rule and its own
        // access check to this string.
        const planKey = PLAN_PAGES_OWNER_ONLY !== false ? ownedPlanSheetKey(file.storagePath, ownedJobs) : file.storagePath;
        if (planKey === "") return fail("file_unavailable", 403);
        const left = TOTAL_MAX_BYTES - totalBytes;
        let part: InlinePart;
        try {
          [part] = await loadPlanSheetImageParts([planKey], auth.userId, Math.min(PLAN_PAGE_MAX_BYTES, left));
        } catch (e) {
          const why = planLoadFailure(e);
          if (why === "file_unavailable") return fail("file_unavailable", 403);
          if (why === "unreadable_file") return refuse("unreadable_file", { fileIndex: i });
          if (why === "file_too_large") {
            return left >= PLAN_PAGE_MAX_BYTES
              ? refuse("file_too_large", { fileIndex: i, limit: PLAN_PAGE_MAX_BYTES })
              : refuse("files_too_large", { limit: TOTAL_MAX_BYTES });
          }
          console.error("[ask-files] plan page load failed", { step, userId: auth.userId });
          return fail("internal", 500);
        }
        if (!part || !sniffMatches(headBytes(part.inlineData.data), part.inlineData.mimeType)) {
          return refuse("unreadable_file", { fileIndex: i });
        }
        totalBytes += decodedBytes(part.inlineData.data);
        parts[i] = { inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } };
        read[i] = { index: i, name: planDisplayName(file.name), kind: "plan" };
      }
    } else {
      const svc = serviceClient();
      if (!svc) {
        console.error("[ask-files] storage is not configured on the server");
        return fail("internal", 500);
      }
      let loaded: LoadedMessage;
      try {
        loaded = await loadOwnedMessageFiles(
          svc,
          auth.userId,
          ask.files.map((f) => ({ messageId: f.messageId, attachmentId: f.attachmentId })),
          { maxBytesEach: MESSAGE_FILE_MAX_BYTES, maxBytesTotal: TOTAL_MAX_BYTES, notBefore: MESSAGE_SOURCE_NOT_BEFORE },
        );
      } catch (e) {
        if (e instanceof MessageFileAccessError) return fail("file_unavailable", 403);
        if (e instanceof MessageFileRefusal) {
          if (e.code === "before_notice") return fail("before_notice", 403);
          if (e.code === "file_too_large") return refuse("file_too_large", { fileIndex: e.index, limit: MESSAGE_FILE_MAX_BYTES });
          if (e.code === "files_too_large") return refuse("files_too_large", { limit: TOTAL_MAX_BYTES });
          return refuse("unreadable_file", { fileIndex: e.index });
        }
        console.error("[ask-files] message file load failed", { step, userId: auth.userId });
        return fail("internal", 500);
      }
      messageBody = loaded.body;

      // Stored-file checks: a client's PDF is counted like a device PDF.
      step = "stored";
      for (const file of loaded.files) {
        const entry: AskFileRead = { index: file.index, name: file.name, kind: file.kind };
        if (file.kind === "pdf") {
          const pages = await countPdfPages(file.bytes);
          if (pages === null) return refuse("unreadable_file", { fileIndex: file.index });
          if (pages > PDF_MAX_PAGES) return refuse("too_many_pages", { fileIndex: file.index, pages, limit: PDF_MAX_PAGES });
          entry.pages = pages;
        }
        totalBytes += file.bytes.length;
        parts[file.index] = { inlineData: { mimeType: file.mime, data: bytesToBase64(file.bytes) } };
        read[file.index] = entry;
      }
    }
    if (totalBytes > TOTAL_MAX_BYTES) return refuse("files_too_large", { limit: TOTAL_MAX_BYTES });
    for (let i = 0; i < ask.files.length; i++) {
      if (!parts[i] || !read[i]) {
        console.error("[ask-files] a file has no part", { step, userId: auth.userId });
        return fail("internal", 500);
      }
    }

    // The one model call.
    step = "model";
    const request = ask.mode === "ask"
      ? buildAskRequest(parts, read, ask.question)
      : buildMessageRequest(parts, read, messageBody);
    const pdfPages = read.reduce((n, r) => n + (r?.pages ?? 0), 0);
    noteAiCaller(request, { userId: auth.userId, pdfPages: pdfPages > 0 ? pdfPages : null });
    const modelJson = await callModel(request);

    step = "answer";
    const result = readGeminiAnswer(modelJson);
    if (result.kind === "blocked") return refuse("blocked");
    if (result.kind === "empty") {
      await aiUsageIncrement(auth.userId, METER_KEY);
      return fail("no_answer", 502);
    }
    const answerText = result.text;
    if (ask.mode === "ask") {
      const newUsed = await aiUsageIncrement(auth.userId, METER_KEY);
      return jsonResponse({
        success: true,
        mode: "ask",
        answer: clipAnswer(answerText),
        truncated: result.truncated || answerWasCut(answerText),
        read,
        usage: { used: newUsed, cap },
      });
    }
    const note = parseMessageAnswer(answerText);
    if (note === null) {
      await aiUsageIncrement(auth.userId, METER_KEY);
      return fail("no_answer", 502);
    }
    const newUsed = await aiUsageIncrement(auth.userId, METER_KEY);
    return jsonResponse({
      success: true,
      mode: "message",
      summary: note.summary,
      asks: note.asks,
      draft: note.draft,
      truncated: result.truncated || note.recovered || note.clipped,
      read,
      usage: { used: newUsed, cap },
    });
  } catch (e) {
    if (e instanceof UpstreamError) {
      // Charged only when the model answered and the answer could not be read.
      if (e.spent) {
        await aiUsageIncrement(auth.userId, METER_KEY);
        return fail("no_answer", 502);
      }
      console.error("[ask-files] model call failed", { status: e.status, userId: auth.userId });
      return fail(e.status === 504 ? "upstream_timeout" : "upstream_error", e.status);
    }
    console.error("[ask-files] failed", { step, userId: auth.userId });
    return fail("internal", 500);
  }
});
