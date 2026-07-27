// Coerce anything that *should* be a number into a finite number. Persisted
// records sometimes come back with missing fields (legacy estimates, partial
// AI tool failures, schema drift) and a raw `.toLocaleString()` on undefined
// crashes the screen. Treat bad inputs as 0 so the UI degrades gracefully.
function safeNum(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * Lenient parser for user-typed money / quantity fields.
 *
 * Handles the silent corruption that raw parseFloat causes on inputs like
 * '1,200' (parseFloat('1,200') === 1 — passes the <=0 guard, corrupts $1,200
 * material to $1) or '$450' (NaN from the currency symbol).
 *
 * Strategy: strip everything that can't be part of a number (currency symbols,
 * commas, spaces, trailing junk) then parseFloat the remainder. When the
 * result is a valid finite number, return it; otherwise return null so the
 * caller can show a specific error rather than silently proceeding.
 *
 * For range inputs like "2-3" (e.g. a quantity range), only the first number
 * is returned — mirrors the `firstNumber` helper in utils/instantBid.ts.
 *
 * In-repo prior art:
 *   quick-quote.tsx:52  toNum  — same strip-then-parse pattern
 *   scopeQuestions.ts:88 firstNumber — first-digit extraction on size inputs
 *
 * @param s  Raw text from a TextInput (may include $, commas, spaces, units).
 * @returns  Parsed number, or null if no valid number found.
 */
export function parseLenientNumber(s: string): number | null {
  if (!s || typeof s !== 'string') return null;
  // Strip currency symbols, commas, spaces, and any trailing non-numeric chars.
  // Keep the leading minus for negative numbers, dots for decimals.
  const cleaned = s.replace(/[$,\s]/g, '');
  // Match the first valid decimal/integer (handles "2-3" → "2", "abc" → null).
  const m = cleaned.match(/^-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(n: number | null | undefined, decimals = 0): string {
  const num = safeNum(n);
  const abs = Math.abs(num);
  const formatted = '$' + abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return num < 0 ? '-' + formatted : formatted;
}

export function formatMoneyShort(n: number | null | undefined): string {
  const num = safeNum(n);
  const abs = Math.abs(num);
  let formatted: string;
  if (abs >= 1000000) formatted = `$${(abs / 1000000).toFixed(1)}M`;
  else if (abs >= 10000) formatted = `$${(abs / 1000).toFixed(0)}K`;
  else formatted = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return num < 0 ? '-' + formatted : formatted;
}

export function formatNumber(n: number | null | undefined, decimals = 0): string {
  return safeNum(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Display guard for free-text fields that may carry the literal string
 * "null" / "undefined" — the classic vibe-coded tell the 2026-07 sim audit
 * caught rendering as "New Project — null · renovation" (AI extractors and
 * legacy imports sometimes stringify an absent value instead of omitting
 * it). Junk tokens and empty strings collapse to `fallback`; real text is
 * returned trimmed.
 *
 * Same junk set as utils/copilot/newProject's write-side `clean` guard —
 * this is the READ-side belt for data that already got in.
 */
const JUNK_DISPLAY_TOKENS = new Set(['null', 'none', 'n/a', 'na', 'undefined', 'unknown']);
export function displayText(v: string | null | undefined, fallback = ''): string {
  const t = (typeof v === 'string' ? v : '').trim();
  if (!t || JUNK_DISPLAY_TOKENS.has(t.toLowerCase())) return fallback;
  return t;
}
