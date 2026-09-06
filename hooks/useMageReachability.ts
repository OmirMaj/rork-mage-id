// hooks/useMageReachability.ts — can this device reach MAGE's backend as the
// signed-in user, right now?
//
// RT-R1 (UI half). ProjectContext and most read hooks swallow fetch errors and
// keep serving the local cache — right for offline-first, but it means a dead
// session (revoked JWT, signing-key rotation, admin ban) or a dead network
// looks IDENTICAL to "nothing to show": every read fails quietly, the cached
// lists render, and Home says "All clear — your jobs are on track". This hook
// is the one place that asks the question directly, so a surface can say
// "couldn't reach MAGE" instead of a green all-clear it cannot vouch for.
//
// One cheap PostgREST HEAD (count only, no rows) against `projects`, shared
// by every caller through one react-query key. A 401 / PGRST301 (bad JWT), a
// 5xx, or a thrown fetch (no network) all read as `failed`; an empty book is
// a 200 and reads as reachable. It never signs anyone out — the session half
// of RT-R1 (refresh once → local sign-out + "session expired") is
// AuthContext's job. This is only the honest signal.
//
// Two things the review caught and this file now owns:
//   • networkMode. The app's QueryClient defaults to 'offlineFirst', under
//     which a query whose fetch fails while the browser reports offline is
//     PAUSED, not errored — isError stays false and Home would show the green
//     all-clear in exactly the RT-R1 case. This query runs 'always' and treats
//     a paused fetch as a failure to reach MAGE.
//   • cadence. useBrainWatch is mounted in four places; a per-observer
//     refetchInterval would fire four probes a minute, because react-query
//     gives every observer its own timer and only dedupes fetches that are
//     in flight at the same instant. So no observer polls: one ref-counted
//     module ticker refetches the shared query while any observer is mounted
//     and the app is foregrounded.
//   • confinement (re-review A1). The foreground signal is this module's
//     own AppState listener, NOT react-query's focusManager. An earlier
//     version bridged AppState → focusManager.setEventListener, which is
//     app-wide: it switched on refetch-on-foreground for EVERY mounted query
//     older than its staleTime — ~40 parallel selects per foreground, and
//     stale server copies overwriting queued local edits until the offline
//     queue drained. The probe needs the foreground for two things only, to
//     gate its ticker and to re-run itself, and both stay inside this file.

import { useEffect } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export const MAGE_REACHABILITY_QUERY_KEY = ['mage_reachability'] as const;

/** How often the shared probe re-runs while the app is in the foreground. */
export const PROBE_INTERVAL_MS = 60_000;

export interface MageReachability {
  /** True once a probe has FAILED (or been paused offline) and no later probe
   *  has succeeded. False while the first probe is still in flight, so a slow
   *  network never flashes a warning before there is anything to warn about. */
  failed: boolean;
  /** True once at least one probe has settled either way. */
  settled: boolean;
  /** Last failure message, for logs — never rendered verbatim. */
  reason: string | null;
}

const UNPROBED: MageReachability = { failed: false, settled: false, reason: null };

// ── Foreground gate ────────────────────────────────────────────────────────
// A module-level `foregrounded` flag fed by one AppState subscription, held
// only while the ticker is (see acquireTicker / releaseTicker). On native
// AppState is the app lifecycle; on web react-native-web's AppState is
// document visibility, so one listener covers both. Two duties, nothing
// else: the ticker reads the flag, and a return to 'active' re-runs THIS
// query key — `client.refetchQueries` scoped to MAGE_REACHABILITY_QUERY_KEY,
// so a foreground never touches any other query in the app.
let foregrounded = true;
let foregroundSub: NativeEventSubscription | null = null;
function probeNow(client: QueryClient): void {
  client.refetchQueries({ queryKey: MAGE_REACHABILITY_QUERY_KEY, type: 'active' }).catch(() => {});
}
function installForegroundGate(client: QueryClient): void {
  if (foregroundSub) return;
  // 'unknown' (native, before the first event) counts as foreground so a
  // fresh launch is never silenced; only a real background/inactive reading
  // gates the ticker.
  const initial = AppState.currentState;
  foregrounded = initial !== 'background' && initial !== 'inactive';
  foregroundSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    const was = foregrounded;
    foregrounded = state === 'active';
    // Back in front: a dead session or a dead network should surface now,
    // not up to a minute later on the next tick.
    if (foregrounded && !was) probeNow(client);
  });
}
function removeForegroundGate(): void {
  foregroundSub?.remove();
  foregroundSub = null;
}

// ── Shared ticker ──────────────────────────────────────────────────────────
// One interval regardless of how many observers exist; cleared when the last
// one unmounts (so a jest worker is never kept alive by it). `type: 'active'`
// makes the refetch a no-op when no observer is mounted anyway.
let tickerRefs = 0;
let tickerId: ReturnType<typeof setInterval> | null = null;
function acquireTicker(client: QueryClient): void {
  tickerRefs += 1;
  if (tickerId) return;
  installForegroundGate(client);
  tickerId = setInterval(() => {
    if (!foregrounded) return; // background: do not probe
    probeNow(client);
  }, PROBE_INTERVAL_MS);
}
function releaseTicker(): void {
  tickerRefs = Math.max(0, tickerRefs - 1);
  if (tickerRefs === 0 && tickerId) {
    clearInterval(tickerId);
    tickerId = null;
    removeForegroundGate();
  }
}

export function useMageReachability(): MageReachability {
  const { isAuthenticated } = useAuth();
  const client = useQueryClient();
  const enabled = isAuthenticated && isSupabaseConfigured;

  const query = useQuery({
    queryKey: MAGE_REACHABILITY_QUERY_KEY,
    enabled,
    queryFn: async (): Promise<true> => {
      const { error } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .limit(1);
      if (error) throw new Error(error.message || 'unreachable');
      return true;
    },
    // Never inherit 'offlineFirst' (see header): offline must read as failed.
    networkMode: 'always',
    staleTime: 30_000,
    // The foreground gate above is the ONE foreground trigger on every
    // platform. Leaving this on would make web probe twice per tab focus
    // (react-query's own visibilitychange listener plus the gate).
    refetchOnWindowFocus: false,
    // One quick retry: a dead session should surface in seconds, not after
    // react-query's default three-step backoff.
    retry: 1,
    retryDelay: 1_500,
  });

  useEffect(() => {
    if (!enabled) return;
    acquireTicker(client);
    return releaseTicker;
  }, [enabled, client]);

  if (!enabled) return UNPROBED;
  return {
    // status becomes 'error' on a failed refetch too (isRefetchError), and
    // flips back to 'success' the moment a later probe lands. A PAUSED fetch
    // (the online manager says offline) is the same fact for this surface:
    // MAGE was not reached.
    failed: query.isError || query.isPaused,
    settled: query.isError || query.isSuccess || query.isPaused,
    reason: query.error instanceof Error ? query.error.message : query.isPaused ? 'offline' : null,
  };
}

export default useMageReachability;
