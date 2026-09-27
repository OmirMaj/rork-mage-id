// utils/bidsFreshness.ts
//
// SUPA-H1 (health lane NOTIFYOPS). How old the public-bids feed on Discover ->
// Bids is, said honestly.
//
// cached_bids stopped moving on 2026-06-22 (the SAM.gov key went invalid and
// the sync kept answering success). The screen selected fetched_at and never
// showed it, so a three-month-old feed looked live, with 118 bids "open" on
// deadlines nobody had re-checked.
//
// Rules:
//   • the age comes from the NEWEST fetched_at among the rows on screen;
//   • no rows, or no row with a readable fetched_at -> 'not checked', never
//     'fresh' and never "0 days" (a feed nobody read is not a feed that is
//     current);
//   • older than 48 hours -> stale (the sync runs 4x a day; two missed days is
//     a broken sync, not a quiet one).
//
// Pure: no React, no network. Pinned by scripts/validate-health-notifyops.ts.

export const BIDS_STALE_AFTER_HOURS = 48;

export interface BidsFreshness {
  /** ISO string of the newest fetched_at, or null when none is readable. */
  newestFetchedAt: string | null;
  /** Whole hours since newestFetchedAt (floored, never negative), or null. */
  ageHours: number | null;
  /** 'Updated just now' / 'Updated 5 hours ago' / 'Updated 3 days ago' / 'Not checked'. */
  label: string;
  stale: boolean;
  /** True when no fetched_at could be read at all. */
  notChecked: boolean;
}

function toMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export function bidsFeedFreshness(
  rows: readonly ({ fetched_at?: string | null } | null | undefined)[] | null | undefined,
  now: Date | number = Date.now(),
): BidsFreshness {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  let newest: number | null = null;
  for (const r of rows ?? []) {
    const ms = toMs(r?.fetched_at);
    if (ms !== null && (newest === null || ms > newest)) newest = ms;
  }
  if (newest === null) {
    return { newestFetchedAt: null, ageHours: null, label: 'Not checked', stale: false, notChecked: true };
  }
  const ageHours = Math.max(0, Math.floor((nowMs - newest) / 3_600_000));
  let label: string;
  if (ageHours < 1) label = 'Updated just now';
  else if (ageHours < 48) label = `Updated ${ageHours} hour${ageHours === 1 ? '' : 's'} ago`;
  else {
    const days = Math.floor(ageHours / 24);
    label = `Updated ${days} day${days === 1 ? '' : 's'} ago`;
  }
  return {
    newestFetchedAt: new Date(newest).toISOString(),
    ageHours,
    label,
    stale: ageHours > BIDS_STALE_AFTER_HOURS,
    notChecked: false,
  };
}
