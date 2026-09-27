// utils/syncSeat.ts — the seat verdict and the stamp arithmetic shared by the
// code-check sync (utils/codeThread/cloudSync.ts) and the desktop takeoff sync
// (utils/takeoffCloudSync.ts + hooks/useTakeoffConditions.ts). Pure: no React,
// no storage, no network — scripts/validate-cloud-sync.ts executes it.
//
// The tiers mirror supabase/migrations/20260926180000_code_checks_takeoff_docs.sql
// EXACTLY: code_checks insert/update at can_access_project(…, 'field'),
// takeoff_docs at 'editor'. A seat the server would refuse never pushes, so the
// offline queue never collects a write RLS will drop.

export type SyncTier = 'field' | 'editor';
export type SyncSeatRole = 'owner' | 'editor' | 'viewer' | 'field' | null;

/**
 * May this seat write at this tier? null = unknown (the role read is loading,
 * failed, or paused with no cached role) — the caller waits instead of
 * guessing. 'editor' tier → owner | editor. 'field' tier → owner | editor |
 * field. A viewer is read-only at both.
 */
export function seatCanWrite(role: SyncSeatRole, tier: SyncTier): boolean | null {
  if (role === null) return null;
  if (role === 'owner' || role === 'editor') return true;
  if (role === 'field') return tier === 'field';
  return false;
}

/**
 * A timestamp as epoch milliseconds, or null when it is missing / unparseable.
 * EVERY comparison of two stamps goes through this: PostgREST returns
 * '2026-09-26T18:00:00.12+00:00' for the '2026-09-26T18:00:00.120Z' the client
 * wrote, so comparing the strings would call the same instant different.
 */
export function stampMs(s: string | null | undefined): number | null {
  if (typeof s !== 'string' || s === '') return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The updated_at a push writes: now, or 1 ms past the last server stamp we
 * saw, whichever is later. The server's keep-newest trigger silently ignores
 * an older stamp, so a device whose clock runs behind would otherwise have its
 * newer edit discarded.
 */
export function nextPushStamp(nowMs: number, lastServerMs: number | null): string {
  return new Date(Math.max(nowMs, (lastServerMs ?? -Infinity) + 1)).toISOString();
}

/**
 * WHY the seat is unknown, when the effective role is null (#90: a settled
 * null never reads as "syncing"). The order is fixed: a failed read says so;
 * a read still in flight is loading; a read paused offline waits for signal;
 * anything else is settled — he is not on this job, and the server would
 * refuse the write, so it is reported as the seat.
 */
export type SeatReadStatus = 'loading' | 'failed' | 'offline' | 'none';
export function seatReadStatus(s: { isLoading: boolean; isError: boolean; isPaused: boolean }): SeatReadStatus {
  if (s.isError) return 'failed';
  if (s.isLoading) return 'loading';
  if (s.isPaused) return 'offline';
  return 'none';
}
