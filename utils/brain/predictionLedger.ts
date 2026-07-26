// GROUND RULES:
// G3: all writes go through supabaseWrite (utils/offlineQueue.ts)
// G4: every recordPrediction / resolvePrediction call is fire-and-forget in its own try/catch
// G5: use generateUUID from utils/generateId.ts for id generation
// No React imports allowed

import { supabaseWrite } from '@/utils/offlineQueue';
import { supabase } from '@/lib/supabase';
import type { PredictionKind, BrainPredictionRow, BrainPredictionReadRow } from './types';
import { buildPredictionRow as _buildPredictionRow, dedupeBySubject as _dedupeBySubject } from './predictionLedgerCore';

// Re-export pure functions so callers only need one import
export { buildPredictionRow, dedupeBySubject } from './predictionLedgerCore';
export type { ClockFn } from './predictionLedgerCore';

// Fire-and-forget — G4: never throws, never awaited by callers
export function recordPrediction(
  kind: PredictionKind,
  subjectId: string,
  payload: Record<string, unknown>,
  projectId?: string | null,
): void {
  const row: BrainPredictionRow = _buildPredictionRow(kind, subjectId, payload, projectId);
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

// Direct read (reads don't queue) — capped at 200, ordered by predicted_at asc
export async function fetchOpenPredictions(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
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
}

// Direct read of RESOLVED rows (reads don't queue) — feeds buildAccuracyReport
// on surfaces that need the full graded history (One Mind's ACCURACY block),
// not just the rows resolved this session. Newest first, capped at 200.
export async function fetchResolvedPredictions(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
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
}

// Convenience re-export for graders that want deduped open predictions
export async function fetchOpenPredictionsDeduped(
  kinds?: PredictionKind[],
  projectId?: string | null,
): Promise<BrainPredictionReadRow[]> {
  const rows = await fetchOpenPredictions(kinds, projectId);
  return _dedupeBySubject(rows);
}
