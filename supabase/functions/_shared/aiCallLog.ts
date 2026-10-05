// _shared/aiCallLog.ts — one public.ai_call_log row per model call.
//
// WHY. Nothing recorded which model answered, how big the call was or what it
// cost, so nobody could say what a feature costs or whether a plan's included
// AI is profitable (founder, 2026-10-04: "Record every AI call's cost").
//
// WHAT A ROW IS. Metadata about ONE request to a model provider: who it is
// billed to, which feature and edge function made it, provider + exact model
// id, the provider's own token counts, how long it took, how it ended and the
// list-price estimate (_shared/aiPrices.ts). NO prompt, NO answer, NO file
// name, NO project content: AiCallLogEntry below has no free-text field and
// scripts/validate-ai-call-log.ts fails the build if one is added.
//
// HOW A CALL SITE USES IT. Wrap the call, change nothing else:
//
//   const r = await logGeminiCall(null, { fn: "ai", feature: "ai_text", userId, model }, async () => {
//     return await fetch(url, init);
//   });
//
// The wrapper runs the call, hands back exactly what the call returned (or
// rethrows exactly what it threw) and writes the row in the background from a
// CLONE of the response, so the function's own parsing, errors, caps and
// charging are untouched. Every way a call can end writes exactly one row:
//   ok       a reply with content
//   empty    HTTP 200 with nothing in it
//   blocked  the provider's safety filter stopped it (Gemini blockReason /
//            finishReason SAFETY and friends)
//   refused  the model declined (Anthropic stop_reason "refusal")
//   error    a non-2xx reply, or the request failed before a reply
//   timeout  the function's own timer (or the wall-clock stop) aborted it
// The outcome is read from the provider's reply, not from what the function
// later made of it (a reply the function could not parse still logs "ok": the
// tokens were spent).
//
// NEVER IN THE WAY. logAiCall never throws and gives up after LOG_TIMEOUT_MS;
// the wrappers do not await it (EdgeRuntime.waitUntil keeps the write alive
// after the response is sent). A missing table, a missing service key or a
// database outage loses the row and nothing else.
//
// The SDK retries a failed request itself (maxRetries, default 2): one SDK
// call is one row, and its usage is the final attempt's.
//
// scripts/validate-ai-call-log.ts derives every model call site under
// supabase/functions/** and fails when one is not inside one of the four
// wrappers below.

import { estCostMicros, PRICE_VERSION, type AiProvider } from "./aiPrices.ts";

export type AiOutcome = "ok" | "blocked" | "empty" | "error" | "timeout" | "refused";

/** What a call site states about the call it is about to make. */
export interface AiCallMeta {
  /** Edge function directory name. */
  fn: string;
  /** The app's feature / metering key (the MONTHLY_CAPS key where there is one). */
  feature: string;
  /** The account the call is billed to; null for cron. */
  userId: string | null;
  /** Exact model id sent to the provider. */
  model: string;
  /** Images / PDF pages attached, when the call site knows the count. */
  images?: number | null;
  pdfPages?: number | null;
  /** A random id shared by every model call one request makes (an agentic
   *  answer is several calls); lets a query add them back up. Not content. */
  requestId?: string | null;
}

/**
 * One row of public.ai_call_log, column for column (the validator pins the two
 * lists equal). Identifiers, counts and enums only.
 */
export interface AiCallLogEntry {
  user_id: string | null;
  request_id: string | null;
  feature: string;
  function: string;
  provider: AiProvider;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  cached_tokens: number | null;
  cache_write_tokens: number | null;
  tool_calls: number | null;
  images: number | null;
  pdf_pages: number | null;
  duration_ms: number | null;
  outcome: AiOutcome;
  http_status: number | null;
}

/** Counts that change the price but are not columns. */
export interface AiCostDetail {
  cacheWrite1hTokens?: number | null;
  audioInputTokens?: number | null;
}

/** The service-role client shape logAiCall needs (supabase-js satisfies it). */
export interface AiLogAdmin {
  // deno-lint-ignore no-explicit-any
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: any }> };
}

export const AI_CALL_LOG_TABLE = "ai_call_log";
/** The longest a log write may take before it is abandoned. */
export const LOG_TIMEOUT_MS = 2_500;
/** The longest the background reader waits for a reply body before logging a timeout. */
export const BODY_READ_TIMEOUT_MS = 150_000;

// ── small pure helpers ───────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A non-negative integer, or null. */
export function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** Identifier-only text: anything outside [A-Za-z0-9._:/-] is dropped, 80 chars max. */
export function ident(v: unknown): string {
  return String(v ?? "").replace(/[^A-Za-z0-9._:\/-]/g, "").slice(0, 80);
}

interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  cached_tokens: number | null;
  cache_write_tokens: number | null;
  tool_calls: number | null;
  detail: AiCostDetail;
}

const NO_USAGE: Usage = {
  input_tokens: null,
  output_tokens: null,
  thinking_tokens: null,
  cached_tokens: null,
  cache_write_tokens: null,
  tool_calls: null,
  detail: {},
};

// deno-lint-ignore no-explicit-any
type Json = any;

/**
 * Gemini's own usage block. A generate call: usageMetadata { promptTokenCount
 * (cached tokens included), candidatesTokenCount, thoughtsTokenCount,
 * cachedContentTokenCount, toolUsePromptTokenCount, promptTokensDetails[] }.
 * An embedding reply has at most promptTokenCount and no candidates: output 0.
 */
export function usageFromGemini(json: Json): Usage {
  const u = json && typeof json === "object" ? json.usageMetadata : null;
  if (!u || typeof u !== "object") return NO_USAGE;
  const prompt = count(u.promptTokenCount);
  if (prompt === null) return NO_USAGE;
  const toolPrompt = count(u.toolUsePromptTokenCount) ?? 0;
  let audio: number | null = null;
  if (Array.isArray(u.promptTokensDetails)) {
    for (const d of u.promptTokensDetails) {
      if (d && d.modality === "AUDIO") audio = (audio ?? 0) + (count(d.tokenCount) ?? 0);
    }
  }
  return {
    input_tokens: prompt + toolPrompt,
    output_tokens: count(u.candidatesTokenCount) ?? 0,
    thinking_tokens: count(u.thoughtsTokenCount),
    cached_tokens: count(u.cachedContentTokenCount),
    cache_write_tokens: null,
    tool_calls: null,
    detail: { audioInputTokens: audio },
  };
}

/**
 * Anthropic's own usage block: { input_tokens (uncached), output_tokens
 * (thinking included), cache_creation_input_tokens, cache_read_input_tokens,
 * cache_creation { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens },
 * server_tool_use { web_search_requests } }. The row's input_tokens is the
 * whole prompt: uncached + cache writes + cache reads.
 */
export function usageFromAnthropic(usage: Json): Usage {
  if (!usage || typeof usage !== "object") return NO_USAGE;
  const uncached = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  if (uncached === null || output === null) return NO_USAGE;
  const write = count(usage.cache_creation_input_tokens) ?? 0;
  const read = count(usage.cache_read_input_tokens) ?? 0;
  const tool = usage.server_tool_use && typeof usage.server_tool_use === "object"
    ? count(usage.server_tool_use.web_search_requests)
    : null;
  const write1h = usage.cache_creation && typeof usage.cache_creation === "object"
    ? count(usage.cache_creation.ephemeral_1h_input_tokens)
    : null;
  return {
    input_tokens: uncached + write + read,
    output_tokens: output,
    // Anthropic bills thinking inside output_tokens and reports no separate count.
    thinking_tokens: null,
    cached_tokens: read,
    cache_write_tokens: write,
    tool_calls: tool ?? 0,
    detail: { cacheWrite1hTokens: write1h },
  };
}

const GEMINI_BLOCK_FINISH = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);

/** How a Gemini reply ended, from the reply alone. */
export function geminiOutcome(httpOk: boolean, json: Json): AiOutcome {
  if (!httpOk) return "error";
  if (!json || typeof json !== "object") return "empty";
  if (json.promptFeedback && json.promptFeedback.blockReason) return "blocked";
  if (Array.isArray(json.embeddings)) return json.embeddings.length > 0 ? "ok" : "empty";
  const cand = Array.isArray(json.candidates) ? json.candidates[0] : null;
  if (cand && typeof cand.finishReason === "string" && GEMINI_BLOCK_FINISH.has(cand.finishReason)) return "blocked";
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const hasContent = parts.some((p: Json) => p && ((typeof p.text === "string" && p.text.trim() !== "") || p.functionCall || p.inlineData));
  return hasContent ? "ok" : "empty";
}

/** How an Anthropic message ended, from the message alone. */
export function anthropicOutcome(httpOk: boolean, msg: Json): AiOutcome {
  if (!httpOk) return "error";
  if (!msg || typeof msg !== "object") return "empty";
  if (msg.stop_reason === "refusal") return "refused";
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  // A turn that only asks for a tool (tool_use / pause_turn) is a real reply.
  const hasContent = blocks.some((b: Json) => b && ((b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") || b.type === "tool_use" || b.type === "server_tool_use"));
  return hasContent ? "ok" : "empty";
}

/** Did this thrown value come from a timer / abort? Reads names and statuses, never message text that could carry content. */
export function isTimeoutError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : "";
  if (name === "AbortError" || name === "TimeoutError" || /Timeout|UserAbort/.test(name)) return true;
  for (const v of Object.values(o)) if (v === 504 || v === 408) return true;
  return typeof o.message === "string" && /timed out|timeout|aborted/i.test(o.message);
}

/** An HTTP status carried by a thrown value (SDK APIError.status, UpstreamError.status), or null. */
export function statusOfError(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  for (const k of ["status", "httpStatus", "statusCode"]) {
    const v = o[k];
    if (typeof v === "number" && v >= 100 && v <= 599) return v;
  }
  return null;
}

function entryFor(provider: AiProvider, meta: AiCallMeta, startedAt: number, outcome: AiOutcome, httpStatus: number | null, u: Usage): AiCallLogEntry {
  return {
    user_id: meta.userId,
    request_id: meta.requestId ?? null,
    feature: meta.feature,
    function: meta.fn,
    provider,
    model: meta.model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    thinking_tokens: u.thinking_tokens,
    cached_tokens: u.cached_tokens,
    cache_write_tokens: u.cache_write_tokens,
    tool_calls: u.tool_calls,
    images: count(meta.images),
    pdf_pages: count(meta.pdfPages),
    duration_ms: Math.max(0, Date.now() - startedAt),
    outcome,
    http_status: httpStatus,
  };
}

/** The exact row written: sanitized identifiers, counts, and the estimate. Pure. */
export function rowFor(entry: AiCallLogEntry, detail: AiCostDetail = {}): Record<string, unknown> {
  const provider = ident(entry.provider);
  const model = ident(entry.model);
  return {
    user_id: typeof entry.user_id === "string" && UUID.test(entry.user_id) ? entry.user_id : null,
    request_id: typeof entry.request_id === "string" && UUID.test(entry.request_id) ? entry.request_id : null,
    feature: ident(entry.feature) || "unknown",
    function: ident(entry.function) || "unknown",
    provider: provider || "unknown",
    model: model || "unknown",
    input_tokens: count(entry.input_tokens),
    output_tokens: count(entry.output_tokens),
    thinking_tokens: count(entry.thinking_tokens),
    cached_tokens: count(entry.cached_tokens),
    cache_write_tokens: count(entry.cache_write_tokens),
    tool_calls: count(entry.tool_calls),
    images: count(entry.images),
    pdf_pages: count(entry.pdf_pages),
    duration_ms: count(entry.duration_ms),
    outcome: entry.outcome,
    http_status: count(entry.http_status),
    est_cost_micros: estCostMicros(provider, model, {
      inputTokens: count(entry.input_tokens),
      outputTokens: count(entry.output_tokens),
      thinkingTokens: count(entry.thinking_tokens),
      cachedTokens: count(entry.cached_tokens),
      cacheWriteTokens: count(entry.cache_write_tokens),
      cacheWrite1hTokens: count(detail.cacheWrite1hTokens),
      audioInputTokens: count(detail.audioInputTokens),
      toolCalls: count(entry.tool_calls),
    }),
    price_version: PRICE_VERSION,
  };
}

// deno-lint-ignore no-explicit-any
const G = globalThis as any;

function env(name: string): string {
  try {
    return (G.Deno && G.Deno.env && G.Deno.env.get(name)) || "";
  } catch {
    return "";
  }
}

async function insertRow(admin: AiLogAdmin | null, row: Record<string, unknown>, signal: AbortSignal): Promise<void> {
  if (admin) {
    const { error } = await admin.from(AI_CALL_LOG_TABLE).insert(row);
    if (error) console.error("[ai-call-log] insert failed:", String(error.code || error.message || "error").slice(0, 80));
    return;
  }
  const SUPABASE_URL = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !key) return;
  // The one network call this file makes: our own database, never a provider.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${AI_CALL_LOG_TABLE}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
    signal,
  });
  if (!r.ok) console.error(`[ai-call-log] insert returned ${r.status}`);
  // Drain so the connection is released.
  await r.body?.cancel().catch(() => undefined);
}

/**
 * Write one row. Best-effort: never throws, never takes longer than
 * LOG_TIMEOUT_MS. `admin` is a service-role supabase-js client when the
 * function already has one, or null to write through PostgREST with the
 * function's own service-role secret.
 */
export async function logAiCall(admin: AiLogAdmin | null, entry: AiCallLogEntry, detail: AiCostDetail = {}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ac = new AbortController();
    const gaveUp = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        ac.abort();
        resolve();
      }, LOG_TIMEOUT_MS);
    });
    const write = insertRow(admin, rowFor(entry, detail), ac.signal).catch(() => undefined);
    await Promise.race([write, gaveUp]);
  } catch {
    // never in the way
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Keep a background write alive past the response without awaiting it. */
function settle(p: Promise<void>): void {
  const quiet = p.catch(() => undefined);
  try {
    if (G.EdgeRuntime && typeof G.EdgeRuntime.waitUntil === "function") G.EdgeRuntime.waitUntil(quiet);
  } catch {
    // no runtime hook: the promise still runs
  }
}

async function readJson(clone: Response | null): Promise<{ json: Json; timedOut: boolean }> {
  if (!clone) return { json: null, timedOut: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), BODY_READ_TIMEOUT_MS);
    });
    const text = await Promise.race([clone.text(), late]);
    if (text === null) {
      clone.body?.cancel().catch(() => undefined);
      return { json: null, timedOut: true };
    }
    try {
      return { json: JSON.parse(text), timedOut: false };
    } catch {
      return { json: null, timedOut: false };
    }
  } catch (e) {
    // The function's own timer aborted the body mid-read.
    return { json: null, timedOut: isTimeoutError(e) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function loggedFetch(
  provider: AiProvider,
  admin: AiLogAdmin | null,
  meta: AiCallMeta,
  call: () => Promise<Response>,
  read: ((httpOk: boolean, json: Json) => { outcome: AiOutcome; usage: Usage }) | null,
): Promise<Response> {
  const startedAt = Date.now();
  let resp: Response;
  try {
    resp = await call();
  } catch (e) {
    settle(logAiCall(admin, entryFor(provider, meta, startedAt, isTimeoutError(e) ? "timeout" : "error", statusOfError(e), NO_USAGE)));
    throw e;
  }
  try {
    const status = resp.status;
    const ok = resp.ok;
    if (!read) {
      settle(logAiCall(admin, entryFor(provider, meta, startedAt, ok ? "ok" : "error", status, NO_USAGE)));
      return resp;
    }
    let clone: Response | null = null;
    try {
      clone = resp.clone();
    } catch {
      clone = null;
    }
    settle((async () => {
      const { json, timedOut } = await readJson(clone);
      const r = read(ok, json);
      await logAiCall(admin, entryFor(provider, meta, startedAt, timedOut ? "timeout" : r.outcome, status, r.usage), r.usage.detail);
    })());
  } catch {
    // logging must never change what the caller gets
  }
  return resp;
}

// ── the four wrappers (the only ways a model call may be made) ───────────────

/** A Gemini generate or batch-embed request made with fetch. */
export function logGeminiCall(admin: AiLogAdmin | null, meta: AiCallMeta, call: () => Promise<Response>): Promise<Response> {
  return loggedFetch("gemini", admin, meta, call, (ok, json) => ({ outcome: geminiOutcome(ok, json), usage: usageFromGemini(json) }));
}

/** An Anthropic Messages API request made with fetch (no SDK). */
export function logAnthropicHttpCall(admin: AiLogAdmin | null, meta: AiCallMeta, call: () => Promise<Response>): Promise<Response> {
  return loggedFetch("anthropic", admin, meta, call, (ok, json) => ({ outcome: anthropicOutcome(ok, json), usage: usageFromAnthropic(json && json.usage) }));
}

/** A request to a provider that reports no usage (speech-to-text). */
export function logOpaqueCall(provider: AiProvider, admin: AiLogAdmin | null, meta: AiCallMeta, call: () => Promise<Response>): Promise<Response> {
  return loggedFetch(provider, admin, meta, call, null);
}

/** An Anthropic SDK call that resolves to a Message (messages.create, stream().finalMessage()). */
export async function logAnthropicSdkCall<T>(admin: AiLogAdmin | null, meta: AiCallMeta, call: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let msg: T;
  try {
    msg = await call();
  } catch (e) {
    settle(logAiCall(admin, entryFor("anthropic", meta, startedAt, isTimeoutError(e) ? "timeout" : "error", statusOfError(e), NO_USAGE)));
    throw e;
  }
  try {
    const m = msg as Json;
    const usage = usageFromAnthropic(m && m.usage);
    settle(logAiCall(admin, entryFor("anthropic", meta, startedAt, anthropicOutcome(true, m), 200, usage), usage.detail));
  } catch {
    // logging must never change what the caller gets
  }
  return msg;
}

/** How many image parts a Gemini `parts` array carries (inline_data / inlineData with an image mime type). */
export function inlineImageCount(parts: unknown): number | null {
  if (!Array.isArray(parts)) return null;
  let n = 0;
  for (const p of parts) {
    // deno-lint-ignore no-explicit-any
    const d = p && typeof p === "object" ? ((p as any).inline_data ?? (p as any).inlineData) : null;
    const mime = d && typeof d === "object" ? String(d.mime_type ?? d.mimeType ?? "") : "";
    if (mime.startsWith("image/")) n++;
  }
  return n;
}

// ── who a call is billed to, carried on the request object ───────────────────
// Some model-calling helpers take only the request they send (their call text
// is pinned by other guards), so the handler notes the account against that
// object and the helper reads it back. A WeakMap keyed by the per-request
// object: nothing is added to the object, nothing outlives the request, and
// two concurrent requests can never see each other's account.
export interface AiCaller {
  userId: string | null;
  pdfPages?: number | null;
}
const CALLERS = new WeakMap<object, AiCaller>();
const NO_CALLER: AiCaller = { userId: null };

/** Note who the model call made from `request` is billed to. */
export function noteAiCaller(request: object, caller: AiCaller): void {
  if (request && typeof request === "object") CALLERS.set(request, caller);
}

/** The account noted against `request`, or { userId: null } when none was. */
export function aiCallerOf(request: unknown): AiCaller {
  return (request && typeof request === "object" ? CALLERS.get(request as object) : undefined) ?? NO_CALLER;
}
