// useProjectsFocusRefetch — re-read the projects when the app comes back to
// the foreground (#25, second writer, part 3).
//
// WHY. On iOS the projects query ran at launch and on Home's pull-to-refresh,
// and nowhere else: there was no focusManager / AppState wiring at all. A GC
// who opened his phone at 07:00 was still looking at 07:00's schedule at
// 15:00 — the foreman's 10:00 "Framing 60%" (saved through the field RPC)
// never reached his screen, so the next thing he edited was built on a copy
// that said 0%. The server trigger now refuses to let that stale copy undo the
// progress, but the GC should SEE it before he edits, not after.
//
// The decision is pure (shouldRefetchOnForeground) so
// scripts/validate-schedule-concurrency.ts can pin it; the hook is the thin
// AppState binding. It never refetches while projects writes are still queued
// — the provider's callback checks that, because the loader is server-first
// and would put the server's older row over an offline edit that has not
// landed yet (the post-flush listener re-pulls once it does).

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** No more than one foreground refetch per this window: iOS fires
 *  inactive → active for a notification pull-down or the app switcher, and
 *  each one is a full projects SELECT. */
export const FOREGROUND_REFETCH_MIN_GAP_MS = 30_000;

/** True when a transition to the foreground should re-read the projects. */
export function shouldRefetchOnForeground(
  prev: AppStateStatus | null,
  next: AppStateStatus,
  lastRefetchAt: number | null,
  now: number,
  minGapMs: number = FOREGROUND_REFETCH_MIN_GAP_MS,
): boolean {
  if (next !== 'active') return false;
  // Only a RETURN to the foreground: the launch itself already loads.
  if (prev == null || prev === 'active') return false;
  if (lastRefetchAt != null && now - lastRefetchAt < minGapMs) return false;
  return true;
}

export function useProjectsFocusRefetch(enabled: boolean, refetch: () => Promise<void>): void {
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);
  useEffect(() => {
    if (!enabled) return;
    let prev: AppStateStatus | null = AppState.currentState ?? null;
    let lastAt: number | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      const now = Date.now();
      const go = shouldRefetchOnForeground(prev, next, lastAt, now);
      prev = next;
      if (!go) return;
      lastAt = now;
      refetchRef.current().catch((err) => console.log('[useProjectsFocusRefetch] Foreground refetch failed:', err));
    });
    return () => sub.remove();
  }, [enabled]);
}
