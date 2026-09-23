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

// ─── The two reads ────────────────────────────────────────────────────────
//
// A FAILED READ IS NOT AN EMPTY LEDGER (#104 / #122, audit 2026-09-22). Both
// loaders used to end in `if (error || !data) return []` inside a catch-all, and
// that ran INSIDE readCache.get — so a read that failed with no signal came back
// as "no rows" AND was cached as "no rows" for the whole TTL. Offline, Profit
// Leak History said "No profit leak scans yet" to a GC with a year of scans, and
// the Morning Brief's "$X of flagged extra work" line vanished instead of
// falling back to the 14-day report scan its comment promised.
//
// So the cached loader now THROWS on failure — a PostgREST `error`, or a fetch
// that threw — and readCache already refuses to cache a rejected load (the next
// reader retries; validate-brain-read-cache pins that). `data: null` with no
// error is a successful empty read, never a failure.
//
// The callers are then split by contract, not by guesswork:
//  - fetchOpenPredictions / fetchResolvedPredictions / fetchOpenPredictionsDeduped
//    keep their exact swallow-to-[] behaviour. useAutonomy, useBrainGrading,
//    oneMind/factBlocks, gradePredictions and app/judges.tsx were built on it,
//    and none of them await a rejection. What they gain for free is that a
//    failure is no longer cached, so their next read retries.
//  - the *Result variants tell a caller WHICH it was, for the two surfaces whose
//    honesty depends on it (app/profit-leak-history.tsx, hooks/useMorningBrief).
//
// All five read through ONE cache entry per key, so the dedupe still collapses
// the page-load storm whichever variant a caller uses.

/** A ledger read that says whether it worked. `rows` is only ever real rows. */
export type PredictionReadResult =
  | { ok: true; rows: BrainPredictionReadRow[] }
  | { ok: false; error: string };

type ReadScope = 'open' | 'resolved';

/** The one cached loader behind every read. Throws on failure — never caches one. */
async function readPredictions(
  scope: ReadScope,
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
  ensureAuthInvalidation();
  const rows = await readCache.get(cacheKey(scope, kinds, projectId), async () => {
    // Open: capped at 200, oldest first. Resolved: capped at 200, newest first
    // (it feeds buildAccuracyReport on surfaces that need the full graded
    // history, not just the rows resolved this session).
    let q = scope === 'open'
      ? supabase
        .from('brain_predictions')
        .select('*')
        .is('resolved_at', null)
        .order('predicted_at', { ascending: true })
        .limit(200)
      : supabase
        .from('brain_predictions')
        .select('*')
        .not('resolved_at', 'is', null)
        .order('resolved_at', { ascending: false })
        .limit(200);
    if (kinds && kinds.length > 0) q = q.in('kind', kinds);
    if (projectId) q = q.eq('project_id', projectId);
    // A thrown fetch propagates as-is: readCache drops the entry and rethrows.
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'brain_predictions read failed');
    return (data ?? []) as BrainPredictionReadRow[];
  });
  // Hand every caller its own array reference, not the one the cache holds.
  // Verified 2026-08: none of the consumers (useAutonomy, useBrainGrading,
  // useMorningBrief, oneMind/factBlocks, profit-leak-history) sorts, reverses
  // or otherwise mutates THIS array — profit-leak-history sorts a fresh
  // `.map(buildLeakRow)` array, not this one — so this .slice() is defensive,
  // not load-bearing today: it stops a FUTURE consumer that does an in-place
  // `.sort()`/`.reverse()`/`.push()` from silently reordering the shared cached
  // array under the others.
  //
  // NB: .slice() is a SHALLOW copy — the row OBJECTS are still shared across all
  // consumers. That is safe only because no consumer mutates a row object in
  // place (they read fields, filter into new arrays, reduce, or dedupe). If a
  // consumer ever needs to mutate a row, it must clone the row, not rely on this.
  return rows.slice();
}

function readFailure(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error && err.message ? err.message : 'brain_predictions read failed' };
}

// Direct read (reads don't queue) of UNRESOLVED rows. Swallows a failure to []
// — see the block above for who relies on that and why it is no longer cached.
export async function fetchOpenPredictions(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
  try {
    return await readPredictions('open', kinds, projectId);
  } catch {
    return [];
  }
}

// Direct read of RESOLVED rows. Swallows a failure to [], like the one above.
export async function fetchResolvedPredictions(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
  try {
    return await readPredictions('resolved', kinds, projectId);
  } catch {
    return [];
  }
}

/** fetchOpenPredictions that reports a failed read instead of hiding it. */
export async function fetchOpenPredictionsResult(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<PredictionReadResult> {
  try {
    return { ok: true, rows: await readPredictions('open', kinds, projectId) };
  } catch (err) {
    return readFailure(err);
  }
}

/** fetchOpenPredictionsResult, deduped by subject like fetchOpenPredictionsDeduped. */
export async function fetchOpenPredictionsDedupedResult(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<PredictionReadResult> {
  const res = await fetchOpenPredictionsResult(kinds, projectId);
  return res.ok ? { ok: true, rows: _dedupeBySubject(res.rows) } : res;
}

/** fetchResolvedPredictions that reports a failed read instead of hiding it. */
export async function fetchResolvedPredictionsResult(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<PredictionReadResult> {
  try {
    return { ok: true, rows: await readPredictions('resolved', kinds, projectId) };
  } catch (err) {
    return readFailure(err);
  }
}

// Convenience re-export for graders that want deduped open predictions
export async function fetchOpenPredictionsDeduped(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
  const rows = await fetchOpenPredictions(kinds, projectId);
  return _dedupeBySubject(rows);
}

// ─── Profit Leak History: how a graded scan is filed ─────────────────────────
//
// Pure — app/profit-leak-history.tsx renders these and
// scripts/validate-w5-brain-money-leak.ts runs them under bun.
//
// #22 (audit 2026-09-22). The screen used to file a resolved scan as
// 'converted' only when `outcome.resolution === 'co_raised' || outcome.coId` —
// fields NO code writes on a leak outcome. The one resolver of leak_flag,
// utils/brain/gradePredictions.gradeLeak, writes { itemsBilled, itemsEaten,
// dollarsBilled, dollarsEaten }. So every graded scan landed under "Eaten", in
// red, the Converted bucket never filled, and the page contradicted the brain's
// own "N of M flagged items recovered via COs" line (accuracyReport) about the
// same rows. Now the bucket is read from the grader's fields, and the item
// recovery rate below is the SAME arithmetic buildAccuracyReport's leak row
// uses — the validator holds the two equal on shared rows.
//
// WHAT "EATEN" MEANS, precisely: gradeLeak found no approved change order that
// matches the item (price within 0.5×–2× or a shared word) within 60 days of
// the scan, or before the job closed. It does not know the owner declined
// anything, and the copy must not say so.

export type LeakBucket = 'open' | 'converted' | 'partial' | 'eaten';

/** The grader's outcome fields, as a leak row may carry them. */
interface LeakOutcomeFields {
  itemsBilled?: unknown;
  itemsEaten?: unknown;
  dollarsBilled?: unknown;
  /** Legacy converted signals — kept so a future writer that sets them still counts. */
  resolution?: unknown;
  coId?: unknown;
}

function countOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * open      — not graded yet (no resolved_at).
 * converted — every graded item matched an approved CO (itemsBilled > 0 and
 *             itemsEaten === 0), or a legacy converted signal is present.
 * partial   — some items matched, some did not: listed as partly billed so the
 *             billed half is never filed as eaten.
 * eaten     — no item matched (itemsBilled === 0).
 */
export function classifyLeakOutcome(
  row: Pick<BrainPredictionReadRow, 'resolved_at' | 'outcome'>,
): LeakBucket {
  if (!row.resolved_at) return 'open';
  const o = (row.outcome ?? {}) as LeakOutcomeFields;
  const billed = countOf(o.itemsBilled);
  const eaten = countOf(o.itemsEaten);
  if (billed > 0 && eaten > 0) return 'partial';
  if (billed > 0) return 'converted';
  if (o.resolution === 'co_raised' || (typeof o.coId === 'string' && o.coId.length > 0)) return 'converted';
  return 'eaten';
}

/** Σ estPrice over a leak row's flagged items. */
export function leakEstTotal(row: Pick<BrainPredictionReadRow, 'payload'>): number {
  const items = ((row.payload ?? {}) as { items?: { estPrice?: number | null }[] }).items ?? [];
  let total = 0;
  for (const i of items) {
    const v = i?.estPrice;
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total;
}

/**
 * Dollars of this scan that became an approved CO. From the grader's
 * `dollarsBilled`; a legacy converted row with no dollar figure counts its
 * whole estimate (that is what a legacy 'co_raised' asserted). Clamped to the
 * scan's own estimate.
 */
export function leakDollarsBilled(
  row: Pick<BrainPredictionReadRow, 'resolved_at' | 'outcome' | 'payload'>,
): number {
  if (!row.resolved_at) return 0;
  const est = leakEstTotal(row);
  const o = (row.outcome ?? {}) as LeakOutcomeFields;
  const billed = typeof o.dollarsBilled === 'number' && Number.isFinite(o.dollarsBilled)
    ? o.dollarsBilled
    : classifyLeakOutcome(row) === 'converted' ? est : 0;
  return Math.max(0, Math.min(est, billed));
}

/**
 * Dollars of this scan that were NOT billed: estimate − billed. Deliberately
 * not the grader's `dollarsEaten`: gradeLeak raises itemsEaten for items still
 * unmatched when the 60-day window passes on an OPEN job but never adds their
 * estPrice to dollarsEaten, so that field reads low exactly where it matters.
 */
export function leakDollarsUnbilled(
  row: Pick<BrainPredictionReadRow, 'resolved_at' | 'outcome' | 'payload'>,
): number {
  if (!row.resolved_at) return 0;
  return Math.max(0, leakEstTotal(row) - leakDollarsBilled(row));
}

export interface LeakHistorySummary {
  openCount: number;
  openTotal: number;
  /** Scans with at least one item billed (converted + partial). */
  billedScanCount: number;
  /** Scans with at least one item not billed (eaten + partial). */
  unbilledScanCount: number;
  partialCount: number;
  /** Σ dollarsBilled over graded scans. */
  convertedTotal: number;
  /** Σ (estTotal − dollarsBilled) over graded scans. */
  eatenTotal: number;
  /** Item-level: Σ itemsBilled and Σ (itemsBilled + itemsEaten) over graded scans —
   *  the numerator and denominator of the brain's own leak recovery rate. */
  itemsBilled: number;
  itemsGraded: number;
  /** itemsBilled / itemsGraded, or null when no item has been graded. */
  itemRecoveryRate: number | null;
}

export function summarizeLeakHistory(
  rows: Pick<BrainPredictionReadRow, 'resolved_at' | 'outcome' | 'payload'>[],
): LeakHistorySummary {
  const s: LeakHistorySummary = {
    openCount: 0, openTotal: 0, billedScanCount: 0, unbilledScanCount: 0, partialCount: 0,
    convertedTotal: 0, eatenTotal: 0, itemsBilled: 0, itemsGraded: 0, itemRecoveryRate: null,
  };
  for (const row of rows) {
    const bucket = classifyLeakOutcome(row);
    if (bucket === 'open') {
      s.openCount += 1;
      s.openTotal += leakEstTotal(row);
      continue;
    }
    if (bucket === 'converted' || bucket === 'partial') s.billedScanCount += 1;
    if (bucket === 'eaten' || bucket === 'partial') s.unbilledScanCount += 1;
    if (bucket === 'partial') s.partialCount += 1;
    s.convertedTotal += leakDollarsBilled(row);
    s.eatenTotal += leakDollarsUnbilled(row);
    // Same fields, same defaults as accuracyReport.buildLeakAccuracy (which
    // counts only rows whose outcome is not null — so does this: a graded row
    // always carries one).
    if (row.outcome != null) {
      const o = row.outcome as { itemsBilled?: number; itemsEaten?: number };
      s.itemsBilled += o.itemsBilled ?? 0;
      s.itemsGraded += (o.itemsBilled ?? 0) + (o.itemsEaten ?? 0);
    }
  }
  s.itemRecoveryRate = s.itemsGraded > 0 ? s.itemsBilled / s.itemsGraded : null;
  return s;
}
