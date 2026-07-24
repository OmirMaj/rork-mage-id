// utils/delayScan/appliedDelays.ts — pure helpers for the applied-delay store.
//
// When a delay ripple is APPLIED to the schedule, the daily-report screen
// persists { [reportId]: hashDelayText(issuesText at apply time) } under ONE
// AsyncStorage key. A later scan whose text hash matches the stored hash is
// rendered "already applied" (explicit re-arm required) so the same relative
// move ops can't be applied twice — in-session or across sessions.
//
// Deliberately a SEPARATE store, not a field on DailyFieldReport: a local-only
// report field gets wiped by sync rehydration, silently losing the guard. The
// key is registered in LOCAL_USER_CACHE_KEYS (contexts/AuthContext.tsx) so it
// can't leak across tenants on a shared device. React/RN-free — the storage
// I/O lives at the call site; validators drive these directly.

/** Single AsyncStorage key — mageid_* namespaced, wiped on auth changes. */
export const DELAY_APPLIED_STORE_KEY = 'mageid_delay_applied';

/** reportId → hashDelayText(issues text) captured at apply time. */
export type AppliedDelayMap = Record<string, string>;

/** Parse the raw stored JSON. Junk / wrong shapes → empty map, never throws. */
export function parseAppliedDelayMap(raw: string | null | undefined): AppliedDelayMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AppliedDelayMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (k && typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Immutable upsert of a report's applied hash. No-op on empty id/hash. */
export function withAppliedDelay(map: AppliedDelayMap, reportId: string, hash: string): AppliedDelayMap {
  if (!reportId || !hash) return map;
  return { ...map, [reportId]: hash };
}

/** Does the stored applied hash for this report match this scan's text hash? */
export function isDelayApplied(
  map: AppliedDelayMap,
  reportId: string | null | undefined,
  hash: string | null | undefined,
): boolean {
  if (!reportId || !hash) return false;
  return map[reportId] === hash;
}
