// Coerce anything that *should* be a number into a finite number. Persisted
// records sometimes come back with missing fields (legacy estimates, partial
// AI tool failures, schema drift) and a raw `.toLocaleString()` on undefined
// crashes the screen. Treat bad inputs as 0 so the UI degrades gracefully.
function safeNum(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * Round `n` to `decimals` places, half away from zero, in DECIMAL space: on
 * the number as it is written (its shortest round-trip string), not on its
 * binary approximation. So 1234.5 → 1235, -2.5 → -3, 1.005 → 1.01, 2.675 → 2.68.
 *
 * WHY (2026-09-27). The same value used to print differently on iPhone and on
 * the web. Hermes formats through Apple's NumberFormatter, which rounds an
 * exact half to EVEN; browsers (and Node, so jest) round it away from zero.
 * `formatMoney(1234.5, 0)` was "$1,234" on iPhone and "$1,235" on the web.
 * Round first and the formatter is handed a value that already has at most
 * `decimals` places, so it never meets a tie, and every engine prints the same
 * digits. This is the browsers' rule exactly (ECMA-402 halfExpand on the
 * shortest decimal), so no toLocaleString output changes on the web; only
 * Hermes' ties move. It also takes the tie out of toFixed, which goes by the
 * binary value ((1.15).toFixed(1) is "1.1" because 1.15 is stored as
 * 1.1499999…): there a decimal tie now rounds up on every platform.
 *
 * String arithmetic on the digits, never `Math.round(n * 10 ** d)`, which
 * rounds 1.005 * 100 = 100.49999… down and misreads long decimals.
 * Non-finite input, and `decimals` outside 0–100, come back untouched (the
 * formatter decides what to do with them, as it did before).
 */
export function roundHalfAwayFromZero(n: number, decimals = 0): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  const d = Math.trunc(decimals);
  if (!(d >= 0 && d <= 100)) return n;
  const abs = Math.abs(n);
  if (abs >= 1e21) return n; // String() is exponent form here, and the value is a whole number
  let s = String(abs);
  const e = s.indexOf('e');
  if (e >= 0) {
    // Below 1e-6 String() writes e.g. "1.2345e-7": spell it out.
    const exp = Number(s.slice(e + 1));
    const mant = s.slice(0, e).replace('.', '');
    s = '0.' + '0'.repeat(-exp - 1) + mant;
  }
  const dot = s.indexOf('.');
  if (dot < 0 || s.length - dot - 1 <= d) return n; // already at most `decimals` places
  let digits = s.slice(0, dot) + s.slice(dot + 1, dot + 1 + d);
  if (s.charCodeAt(dot + 1 + d) >= 53 /* '5' */) {
    // Away from zero: add one in the last kept place, carrying.
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === '9') i--;
    digits = i < 0
      ? '1' + '0'.repeat(digits.length)
      : digits.slice(0, i) + String.fromCharCode(digits.charCodeAt(i) + 1) + '0'.repeat(digits.length - i - 1);
  }
  const intLen = digits.length - d;
  const r = Number(d === 0 ? digits : digits.slice(0, intLen) + '.' + digits.slice(intLen));
  return n < 0 ? -r : r;
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

// Every money / number formatter below rounds with roundHalfAwayFromZero
// BEFORE toLocaleString / toFixed, so the same value prints the same digits on
// iPhone (Hermes) and on the web. scripts/validate-money-rounding.ts holds it,
// on Node and on the repo's Hermes binary.
export function formatMoney(n: number | null | undefined, decimals = 0): string {
  const num = safeNum(n);
  const abs = roundHalfAwayFromZero(Math.abs(num), decimals);
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
  if (abs >= 1000000) formatted = `$${roundHalfAwayFromZero(abs / 1000000, 1).toFixed(1)}M`;
  else if (abs >= 10000) formatted = `$${roundHalfAwayFromZero(abs / 1000, 0).toFixed(0)}K`;
  else formatted = '$' + roundHalfAwayFromZero(abs, 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return num < 0 ? '-' + formatted : formatted;
}

export function formatNumber(n: number | null | undefined, decimals = 0): string {
  return roundHalfAwayFromZero(safeNum(n), decimals).toLocaleString('en-US', {
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
