// GROUND RULES:
// G3: all writes go through supabaseWrite (utils/offlineQueue.ts)
// G4: every recordPrediction / resolvePrediction call is fire-and-forget in its own try/catch
// G5: use generateUUID from utils/generateId.ts for id generation
// No React imports allowed

import { supabaseWrite, onQueueFlushed } from '@/utils/offlineQueue';
import { supabase } from '@/lib/supabase';
import type { PredictionKind, BrainPredictionRow, BrainPredictionReadRow } from './types';
import { buildPredictionRow as _buildPredictionRow, dedupeBySubject as _dedupeBySubject } from './predictionLedgerCore';
import { createAsyncCache } from './readCache';

// Re-export pure functions so callers only need one import
export { buildPredictionRow, dedupeBySubject } from './predictionLedgerCore';
export type { ClockFn } from './predictionLedgerCore';

// ─── Read cache ───────────────────────────────────────────────────────────
//
// fetchOpenPredictions / fetchResolvedPredictions are called from five
// unrelated places on a single page load (useAutonomy, useBrainGrading,
// useMorningBrief, oneMind/factBlocks, profit-leak-history). Production
// measured `brain_predictions?select=*&limit=200` going out 6x per load, 3 of
// them byte-identical.
//
// The cache lives HERE rather than in each caller because the callers are
// independent modules that will never learn about each other — fixing it at
// the shared read is the only place the storm actually collapses. In-flight
// dedupe handles the concurrent burst (all six start before any resolves);
// the TTL handles remounts and cross-screen navigation.
//
// TTL is short on purpose. The ledger is also invalidated explicitly on every
// write below and on auth changes, so the TTL only has to cover "the same
// screen re-read a moment later", not correctness.
const READ_TTL_MS = 30_000;

const readCache = createAsyncCache<BrainPredictionReadRow[]>({ ttlMs: READ_TTL_MS });

/**
 * Drop every cached read. Called after any ledger write (a recorded or
 * resolved prediction changes what these queries return) and whenever the
 * signed-in user changes — cached rows are per-user and must never survive a
 * tenant switch on a shared device.
 */
export function invalidatePredictionCache(): void {
  readCache.clear();
}

// Clear on sign-in / sign-out. Registered lazily on the first cached read so
// merely importing this module doesn't attach a listener. `supabase` is a safe
// no-op proxy when env vars are missing (lib/supabase.ts), so this cannot
// throw at import time either.
let authHookInstalled = false;
function ensureAuthInvalidation(): void {
  if (authHookInstalled) return;
  authHookInstalled = true;
  try {
    supabase.auth.onAuthStateChange(() => { readCache.clear(); });
  } catch {
    // Never let telemetry plumbing break a read.
  }
  // recordPrediction/resolvePrediction invalidate synchronously at CALL time, but
  // the write itself is offline-queued (supabaseWrite) and lands on the server
  // LATER, during a flush. A read issued in that window re-queries, misses the
  // not-yet-landed row, and pins that pre-write snapshot for the whole TTL. So
  // ALSO invalidate when brain_predictions writes actually flush, closing that
  // window: the next read after the flush re-queries the now-current rows.
  try {
    onQueueFlushed((tables) => {
      if (tables.has('brain_predictions')) readCache.clear();
    });
  } catch {
    // Registry failure must never break a read.
  }
}

/** Stable cache key. Kind order must not create a false miss. */
function cacheKey(scope: string, kinds?: PredictionKind[], projectId?: string | null): string {
  const k = kinds && kinds.length > 0 ? [...kinds].sort().join(',') : '*';
  return `${scope}|${k}|${projectId ?? '*'}`;
}

// Fire-and-forget — G4: never throws, never awaited by callers
export function recordPrediction(
  kind: PredictionKind,
  subjectId: string,
  payload: Record<string, unknown>,
  projectId?: string | null,
): void {
  const row: BrainPredictionRow = _buildPredictionRow(kind, subjectId, payload, projectId);
  // A new row changes what the open-prediction reads return — drop the cache
  // immediately so the next reader can't serve a pre-write snapshot.
  invalidatePredictionCache();
  (async () => {
    try {
      await supabaseWrite('brain_predictions', 'insert', row as unknown as Record<string, unknown>);
    } catch {
      // G4: silently swallow — ledger failure must never break host flow
    }
  })();
}

// Fire-and-forget resolution — G4
export function resolvePrediction(id: string, outcome: Record<string, unknown>): void {
  // Moves a row from the open set to the resolved set — both cached reads are
  // now wrong.
  invalidatePredictionCache();
  (async () => {
    try {
      await supabaseWrite('brain_predictions', 'update', {
        id,
        resolved_at: new Date().toISOString(),
        outcome,
      });
    } catch {
      // G4
    }
  })();
}

// Direct read (reads don't queue) — capped at 200, ordered by predicted_at asc.
// Deduped + TTL-cached; see the READ_TTL_MS block above.
export async function fetchOpenPredictions(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
  ensureAuthInvalidation();
  const rows = await readCache.get(cacheKey('open', kinds, projectId), async () => {
    try {
      let q = supabase
        .from('brain_predictions')
        .select('*')
        .is('resolved_at', null)
        .order('predicted_at', { ascending: true })
        .limit(200);
      if (kinds && kinds.length > 0) q = q.in('kind', kinds);
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error || !data) return [];
      return data as BrainPredictionReadRow[];
    } catch {
      return [];
    }
  });
  // Hand every caller its own array reference, not the one the cache holds.
  // Verified 2026-08: none of the five current consumers (useAutonomy,
  // useBrainGrading, useMorningBrief, oneMind/factBlocks, profit-leak-history)
  // sorts, reverses or otherwise mutates THIS array — profit-leak-history sorts
  // a fresh `.map(buildLeakRow)` array, not this one — so this .slice() is
  // defensive, not load-bearing today: it stops a FUTURE consumer that does an
  // in-place `.sort()`/`.reverse()`/`.push()` from silently reordering the
  // shared cached array under the other four.
  //
  // NB: .slice() is a SHALLOW copy — the row OBJECTS are still shared across all
  // consumers. That is safe only because no consumer mutates a row object in
  // place (they read fields, filter into new arrays, reduce, or dedupe). If a
  // consumer ever needs to mutate a row, it must clone the row, not rely on this.
  return rows.slice();
}

// Direct read of RESOLVED rows (reads don't queue) — feeds buildAccuracyReport
// on surfaces that need the full graded history (One Mind's ACCURACY block),
// not just the rows resolved this session. Newest first, capped at 200.
export async function fetchResolvedPredictions(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
  ensureAuthInvalidation();
  const rows = await readCache.get(cacheKey('resolved', kinds, projectId), async () => {
    try {
      let q = supabase
        .from('brain_predictions')
        .select('*')
        .not('resolved_at', 'is', null)
        .order('resolved_at', { ascending: false })
        .limit(200);
      if (kinds && kinds.length > 0) q = q.in('kind', kinds);
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error || !data) return [];
      return data as BrainPredictionReadRow[];
    } catch {
      return [];
    }
  });
  return rows.slice();
}

// Convenience re-export for graders that want deduped open predictions
export async function fetchOpenPredictionsDeduped(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
  const rows = await fetchOpenPredictions(kinds, projectId);
  return _dedupeBySubject(rows);
}
