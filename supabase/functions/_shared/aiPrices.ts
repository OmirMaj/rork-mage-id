// _shared/aiPrices.ts — the ONE place a model's list price lives.
//
// ai_call_log.est_cost_micros is computed from this table at the moment the
// call is logged, and the row keeps the PRICE_VERSION it was computed with, so
// a later price change never rewrites history: bump PRICE_VERSION, edit the
// entry, redeploy the model-calling functions.
//
// RULES
//   - Every entry carries the provider's own pricing page (source) and the day
//     it was read (readOn). scripts/validate-ai-call-log.ts fails without them.
//   - A model that is not in this table, or a call whose provider returned no
//     token counts, gets est_cost_micros = NULL. Never a guess.
//   - These are LIST prices for the standard paid tier. They are an estimate:
//     the invoice is the truth. Known gaps are listed under NOT PRICED below.
//   - Unit: US dollars per 1,000,000 tokens, which is exactly millionths of a
//     dollar ("micros") per token. cost_micros = tokens x perM.
//
// SOURCES, read 2026-10-04
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//     Claude Opus 4.8    $5 / MTok input, $6.25 5-minute cache write, $10 1-hour
//                        cache write, $0.50 cache read, $25 / MTok output.
//     Claude Sonnet 4.5  $3 / MTok input, $3.75 5-minute cache write, $6 1-hour
//                        cache write, $0.30 cache read, $15 / MTok output.
//     Web search tool    "$10 per 1,000 searches, plus standard token costs for
//                        search-generated content"; a search that errors is not
//                        billed. Thinking tokens are billed as output tokens and
//                        are already inside usage.output_tokens.
//     Long context       "Claude 4.6 and later models ... include the full 1M
//                        token context window at standard pricing."
//   Google: https://ai.google.dev/gemini-api/docs/pricing (page dated 2026-10-01 UTC)
//     Gemini 2.5 Pro     input $1.25 (prompts <= 200k tokens) / $2.50 (> 200k);
//                        output incl. thinking $10.00 / $15.00; context caching
//                        $0.125 / $0.25.
//     Gemini 2.5 Flash   input $0.30 text / image / video, $1.00 audio; output
//                        incl. thinking $2.50; context caching $0.03 ($0.10 audio).
//     Gemini Embedding 2 text input $0.20 (image $0.45, audio $6.50, video
//                        $12.00 — the app embeds text only).
//
// NOT PRICED (est_cost_micros stays NULL for these rows)
//   - transcribe-audio's speech-to-text vendor: no published per-call price and
//     no usage block in its reply.
//   - any model id set through GEMINI_TEXT_MODEL / GEMINI_VISION_MODEL /
//     GEMINI_EMBED_MODEL that is not listed here.
//   - an embedding call whose reply carries no usageMetadata (the count is then
//     unknown, and a character-based estimate would be a guess).
//   - Gemini context-cache STORAGE (per hour) — the app creates no caches.

export const PRICE_VERSION = "2026-10-04";

export type AiProvider = "gemini" | "anthropic" | "rork-stt";

export interface ModelPrice {
  provider: AiProvider;
  /** The exact model id the request names. */
  model: string;
  /** USD per 1M uncached input tokens (= micros per token). */
  inputPerM: number;
  /** USD per 1M output tokens; for Gemini this rate also covers thinking tokens. */
  outputPerM: number;
  /** USD per 1M input tokens read from a cache. */
  cachedInputPerM: number;
  /** Anthropic only: USD per 1M tokens written to the 5-minute / 1-hour cache. */
  cacheWrite5mPerM?: number;
  cacheWrite1hPerM?: number;
  /** Gemini Flash only: audio input is priced apart from text / image / video. */
  audioInputPerM?: number;
  /** Gemini Pro only: the whole call moves to these rates above the threshold. */
  longContext?: { abovePromptTokens: number; inputPerM: number; outputPerM: number; cachedInputPerM: number };
  /** Anthropic server-side web search: micros per search ($10 / 1,000 = 10,000). */
  perToolCallMicros?: number;
  /** The provider's own pricing page. */
  source: string;
  /** The day that page was read, YYYY-MM-DD. */
  readOn: string;
}

const ANTHROPIC_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
const GEMINI_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing";

export const MODEL_PRICES: readonly ModelPrice[] = [
  {
    provider: "anthropic",
    model: "claude-opus-4-8",
    inputPerM: 5,
    outputPerM: 25,
    cachedInputPerM: 0.5,
    cacheWrite5mPerM: 6.25,
    cacheWrite1hPerM: 10,
    perToolCallMicros: 10_000,
    source: ANTHROPIC_SOURCE,
    readOn: "2026-10-04",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    inputPerM: 3,
    outputPerM: 15,
    cachedInputPerM: 0.3,
    cacheWrite5mPerM: 3.75,
    cacheWrite1hPerM: 6,
    perToolCallMicros: 10_000,
    source: ANTHROPIC_SOURCE,
    readOn: "2026-10-04",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    inputPerM: 1.25,
    outputPerM: 10,
    cachedInputPerM: 0.125,
    longContext: { abovePromptTokens: 200_000, inputPerM: 2.5, outputPerM: 15, cachedInputPerM: 0.25 },
    source: GEMINI_SOURCE,
    readOn: "2026-10-04",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    inputPerM: 0.3,
    outputPerM: 2.5,
    cachedInputPerM: 0.03,
    audioInputPerM: 1,
    source: GEMINI_SOURCE,
    readOn: "2026-10-04",
  },
  {
    provider: "gemini",
    model: "gemini-embedding-2",
    inputPerM: 0.2,
    outputPerM: 0,
    cachedInputPerM: 0.2,
    source: GEMINI_SOURCE,
    readOn: "2026-10-04",
  },
];

/** Exact provider + model id match, or null (never a nearest match). */
export function priceFor(provider: string, model: string): ModelPrice | null {
  return MODEL_PRICES.find((p) => p.provider === provider && p.model === model) ?? null;
}

/** Token counts as the log row stores them. null = the provider did not say. */
export interface CostInput {
  /** Whole prompt, cached and cache-written tokens included. */
  inputTokens: number | null;
  /** Visible output. Anthropic: all output (thinking included). */
  outputTokens: number | null;
  /** Gemini thoughtsTokenCount (billed at the output rate). */
  thinkingTokens: number | null;
  /** Read from a cache (subset of inputTokens). */
  cachedTokens: number | null;
  /** Anthropic: written to a cache (subset of inputTokens). */
  cacheWriteTokens: number | null;
  /** Anthropic: of cacheWriteTokens, how many went to the 1-hour cache. */
  cacheWrite1hTokens?: number | null;
  /** Gemini: of inputTokens, how many were audio. */
  audioInputTokens?: number | null;
  /** Billed server-side tool uses (Anthropic web searches). */
  toolCalls: number | null;
}

const n0 = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Estimated list-price cost in millionths of a dollar, or null when the price
 * or the token counts are unknown. Pure.
 */
export function estCostMicros(provider: string, model: string, u: CostInput): number | null {
  const p = priceFor(provider, model);
  if (!p) return null;
  if (u.inputTokens === null || u.outputTokens === null) return null;

  const input = n0(u.inputTokens);
  const cached = Math.min(input, n0(u.cachedTokens));
  const cacheWrite = Math.min(input - cached, n0(u.cacheWriteTokens));
  const cacheWrite1h = Math.min(cacheWrite, n0(u.cacheWrite1hTokens));
  const audio = Math.min(input - cached - cacheWrite, n0(u.audioInputTokens));
  const plain = input - cached - cacheWrite - audio;
  const out = n0(u.outputTokens) + n0(u.thinkingTokens);

  const long = p.longContext && input > p.longContext.abovePromptTokens ? p.longContext : null;
  const inRate = long ? long.inputPerM : p.inputPerM;
  const outRate = long ? long.outputPerM : p.outputPerM;
  const cachedRate = long ? long.cachedInputPerM : p.cachedInputPerM;

  // A kind of token this entry has no rate for → unknown, not a guess.
  if (cacheWrite > 0 && p.cacheWrite5mPerM === undefined) return null;
  if (cacheWrite1h > 0 && p.cacheWrite1hPerM === undefined) return null;
  if (audio > 0 && p.audioInputPerM === undefined) return null;
  if (n0(u.toolCalls) > 0 && p.perToolCallMicros === undefined) return null;

  const micros =
    plain * inRate +
    audio * (p.audioInputPerM ?? 0) +
    cached * cachedRate +
    (cacheWrite - cacheWrite1h) * (p.cacheWrite5mPerM ?? 0) +
    cacheWrite1h * (p.cacheWrite1hPerM ?? 0) +
    out * outRate +
    n0(u.toolCalls) * (p.perToolCallMicros ?? 0);
  return Math.round(micros);
}
