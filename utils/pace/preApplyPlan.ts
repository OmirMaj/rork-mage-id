// utils/pace/preApplyPlan.ts — the pre-apply planner for the first earned
// autonomous act (F4, Friday Close campaign).
//
// Pure. No React, no network, no storage.
//
// Decides which draft-schedule tasks get their duration PRE-SET from the GC's
// measured pace at draft arrival, instead of waiting for a chip tap.
// Eligibility is three ANDed conditions:
//   1. paceFor's suggestion rules VERBATIM — delegated to paceSuggestionFor
//      (utils/pace/paceBook.ts), the shared pure form of schedule-review's
//      paceFor. This matters: the generator already grounds durations in PACE
//      HISTORY via prompt facts (paceGrounding.ts), and the ≥1-day-delta rule
//      inside paceSuggestionFor is what prevents double-application. Never
//      reimplement these rules here.
//   2. The per-trade earned-trust gate passed (computeTradeGates: n ≥ 5 graded
//      pace calls for THAT trade at ≥ 60% beat-or-tie). A trade with no gate
//      record is LOCKED — autonomy is earned, never default-open.
//   3. The pace_preapply autonomy preference is enabled (absent = ON; the
//      caller resolves `prefs.pace_preapply !== false`).
//
// Capture discipline (D4, G9): this module only PLANS. Predictions are
// recorded at accept() for decisions still holding the pace value — rejected
// pre-applies never inflate the gate's n. See app/schedule-review.tsx.

import type { ScheduleTask } from '@/types';
import { paceSuggestionFor, type PaceBook } from '@/utils/pace/paceBook';
import { tradeKeyForTask } from '@/utils/scheduleColors';

export interface PreApplyDecision {
  taskId: string;
  /** tradeKeyForTask(task) — the same trade string captured by applyPace and
   *  graded by gradePace, so the gate measures exactly this substitution. */
  trade: string;
  /** The duration pre-applied (identical to what the suggest chip offers). */
  paceDays: number;
  /** The AI draft's duration — the revert target for the badge tap. */
  aiOriginalDays: number;
  jobCount: number;
  confidence: 'medium' | 'high';
}

export interface ComputePreApplyPlanInput {
  tasks: ScheduleTask[];
  paceBook: PaceBook;
  /** Current project square footage — pace lookup prefers the size bucket. */
  sqft: number | undefined;
  /** Per-trade earned-trust gates, keyed by trade (autonomyGate
   *  computeTradeGates results, e.g. useAutonomy().paceTradeGates). Only
   *  `.passed` is consulted here. */
  tradeGates: ReadonlyMap<string, { passed: boolean }>;
  /** autonomy_preferences.pace_preapply !== false (absent = ON). */
  prefEnabled: boolean;
}

/**
 * Plan the pre-applies for a freshly arrived draft. Returns one decision per
 * eligible task; an empty array means the screen behaves exactly as before
 * (suggest chips only). Order follows the input task order.
 */
export function computePreApplyPlan(input: ComputePreApplyPlanInput): PreApplyDecision[] {
  if (!input.prefEnabled) return [];

  const decisions: PreApplyDecision[] = [];
  for (const task of input.tasks) {
    // Rule set 1: paceFor's rules verbatim (milestone / zero-duration /
    // 'general' / low-confidence / within-a-day agreement all return null).
    const suggestion = paceSuggestionFor(input.paceBook, task, input.sqft);
    if (!suggestion) continue;

    // Rule set 2: the earned-trust gate for this exact trade.
    const trade = tradeKeyForTask(task);
    if (!input.tradeGates.get(trade)?.passed) continue;

    decisions.push({
      taskId: task.id,
      trade,
      paceDays: suggestion.days,
      aiOriginalDays: task.durationDays,
      jobCount: suggestion.jobCount,
      confidence: suggestion.confidence,
    });
  }
  return decisions;
}
