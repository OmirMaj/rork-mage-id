// utils/stalePriceWarning.ts — the honest "this number might be old" note for
// a line priced from the contractor's own learned/stored cost book
// (CostBookEntry.lastSeen, utils/costDatabase.ts; carried onto a matched line
// as OwnRateMatch.lastSeen, utils/takeoffPricing.ts).
//
// WHY 180 DAYS. Building-materials inflation moves several percent a year
// (NAHB: +5.9% YoY in April 2026, small builders' median material increase
// 9.1%). A learned rate the contractor hasn't re-measured in six months is
// old enough that asking him to glance at it before it goes on a signed
// number is cheap insurance, not nagging. ideas-roadmap.md's stale-price item
// (T2) does not name an age threshold of its own — its 30-day number is a
// proposal VALIDITY window, a different thing — so this uses 180 days.
//
// "NOT KNOWN" IS NEVER "FRESH". CostBookEntry.lastSeen is '' when the book
// cannot attest a measurement date at all (every measured sample lacked one).
// That is a fact we don't have, not a recent one — it must never read as
// fresh, so an empty, missing or unparsable date returns null: no claim of
// staleness, no claim of freshness either. A future-dated "measurement" is
// equally not something we can age; it also returns null rather than a
// negative age.
//
// Pure: no React, no storage, no clock beyond what the caller passes in.
// bun runs it directly (scripts/validate-stale-price.ts).

export const STALE_PRICE_THRESHOLD_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between `lastSeen` and `now`. null when `lastSeen` is absent,
 * unparsable, or in the future — every case where we cannot honestly say how
 * old the price is.
 */
export function stalePriceDays(
  lastSeen: string | undefined | null,
  now: Date = new Date(),
): number | null {
  if (!lastSeen) return null;
  const then = new Date(lastSeen);
  const thenMs = then.getTime();
  if (Number.isNaN(thenMs)) return null;
  const ms = now.getTime() - thenMs;
  if (ms < 0) return null;
  return Math.floor(ms / DAY_MS);
}

/**
 * "Price last updated N months ago" once a learned rate is at least
 * STALE_PRICE_THRESHOLD_DAYS old; null otherwise (including "we don't know"
 * and "not old enough yet" — the caller shows nothing in both cases, which is
 * the point: silence, not a false freshness claim).
 *
 * Sentence case, no hype, no emoji (docs/VOICE.md).
 */
export function stalePriceNote(
  lastSeen: string | undefined | null,
  now: Date = new Date(),
): string | null {
  const days = stalePriceDays(lastSeen, now);
  if (days == null || days < STALE_PRICE_THRESHOLD_DAYS) return null;

  const months = Math.round(days / 30);
  if (months < 24) {
    return `Price last updated ${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.round(months / 12);
  return `Price last updated ${years} year${years === 1 ? '' : 's'} ago`;
}
