// utils/brain/resolveOutcomes.ts
//
// Pure sweep: given open (unresolved) prediction rows + grading context,
// returns {id, outcome}[] for every row that is now resolvable.
//
// Graders are run on the DEDUPED view (dedupeBySubject applied by the caller —
// useBrainGrading dedupes before calling this).
//
// No React. No network. No storage. Pure.

import type { BrainPredictionReadRow } from './types';
import type { GradingCtx } from './gradePredictions';
import {
  gradePace,
  gradeDelayRipple,
  gradeLeak,
  gradeEstimateSnapshot,
  gradeJudges,
  gradeInstantBid,
  gradeBidScore,
} from './gradePredictions';

export interface ResolvedOutcome {
  id: string;
  outcome: Record<string, unknown>;
}

/**
 * Sweep all open (unresolved) deduped rows through their respective graders.
 * Returns only rows where a grader returned a non-null outcome.
 *
 * Skips leveling_adjustment (ungradeable v1) and describe-mode judges_verdict
 * (gradeJudges returns null for those) — both documented in plan HONESTY LEDGER.
 */
export function computeResolvableOutcomes(
  openRows: BrainPredictionReadRow[],
  ctx: GradingCtx,
): ResolvedOutcome[] {
  const results: ResolvedOutcome[] = [];

  for (const row of openRows) {
    let outcome: Record<string, unknown> | null = null;

    try {
      switch (row.kind) {
        case 'pace_suggestion_applied': {
          const o = gradePace(row, ctx);
          if (o) outcome = o as unknown as Record<string, unknown>;
          break;
        }
        case 'delay_ripple_applied': {
          const o = gradeDelayRipple(row, ctx);
          if (o) outcome = o as unknown as Record<string, unknown>;
          break;
        }
        case 'leak_flag': {
          const o = gradeLeak(row, ctx);
          if (o) outcome = o as unknown as Record<string, unknown>;
          break;
        }
        case 'estimate_confidence_snapshot': {
          const o = gradeEstimateSnapshot(row, ctx);
          if (o) outcome = o as unknown as Record<string, unknown>;
          break;
        }
        case 'judges_verdict': {
          const o = gradeJudges(row, ctx);
          if (o) outcome = o as unknown as Record<string, unknown>;
          break;
        }
        case 'instant_bid_sent': {
          const o = gradeInstantBid(row, ctx);
          if (o) outcome = o as unknown as Record<string, unknown>;
          break;
        }
        case 'bid_score': {
          const o = gradeBidScore(row, ctx);
          if (o) outcome = o as unknown as Record<string, unknown>;
          break;
        }
        case 'leveling_adjustment':
          // Ungradeable v1 — documented in plan HONESTY LEDGER
          break;
        default:
          break;
      }
    } catch {
      // Per G4: grading failure must never crash the caller
    }

    if (outcome !== null) {
      results.push({ id: row.id, outcome });
    }
  }

  return results;
}
