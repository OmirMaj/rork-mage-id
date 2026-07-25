// Pure, side-effect-free functions for building and deduplicating prediction rows.
// No React, no React Native, no Supabase imports — safe to import in bun validator scripts.
import { generateUUID } from '@/utils/generateId';
import type { PredictionKind, BrainPredictionRow, BrainPredictionReadRow } from './types';

// Injectable clock for testing
export type ClockFn = () => string; // returns ISO string

export function buildPredictionRow(
  kind: PredictionKind,
  subjectId: string,
  payload: Record<string, unknown>,
  projectId?: string | null,
  clock?: ClockFn,
): BrainPredictionRow {
  return {
    id: generateUUID(),
    project_id: projectId ?? null,
    kind,
    subject_id: subjectId,
    payload,
    predicted_at: clock ? clock() : new Date().toISOString(),
  };
}

// Dedupe: keep earliest predicted_at per (kind, subject_id)
// Graders always run on the deduped view — systemic answer to double-capture
export function dedupeBySubject(rows: BrainPredictionReadRow[]): BrainPredictionReadRow[] {
  const seen = new Map<string, BrainPredictionReadRow>();
  for (const row of rows) {
    const key = `${row.kind}::${row.subject_id}`;
    const existing = seen.get(key);
    if (!existing || row.predicted_at < existing.predicted_at) {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values());
}
