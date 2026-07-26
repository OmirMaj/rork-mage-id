// utils/brain/autonomyGate.ts
//
// Pure gate logic for Brain v3 autonomy ladder.
// No React. No network. No storage. Pure over resolved prediction rows.
//
// Earned-trust framing (G13): gates measure real graded outcomes, not promises.
// Both gates require n ≥ 5 resolved rows for the domain — thin samples are
// visible on the scoreboard but never treated as certified gates.
//
// G14: no new PredictionKind values — gate logic reads existing kinds
//      ('pace_suggestion_applied', 'leak_flag') with no schema changes.

import type { BrainPredictionReadRow } from './types';

// ─── Per-trade gate (pace) ────────────────────────────────────────────────────

export interface TradeGateResult {
  trade: string;
  /** Resolved rows for this trade (outcome != null). */
  n: number;
  /** Fraction of graded rows where pace beat or tied the AI (beatOrTie / n). */
  rate: number;
  /** n ≥ 5 AND rate ≥ 0.60. The pre-apply planner may use this trade. */
  passed: boolean;
}

/**
 * Compute per-trade pace gates from resolved `pace_suggestion_applied` rows.
 * Returns one entry per trade that has at least one resolved row.
 *
 * "Beat or tie" = paceBeatAi === true OR tie === true (gradePredictions.ts:77,79).
 * Gate threshold: rate ≥ 0.60, n ≥ 5.
 */
export function computeTradeGates(
  resolved: BrainPredictionReadRow[],
): TradeGateResult[] {
  const paceRows = resolved.filter(
    r => r.kind === 'pace_suggestion_applied' && r.outcome != null,
  );

  // Aggregate per trade.
  const byTrade = new Map<string, { beatOrTie: number; n: number }>();
  for (const row of paceRows) {
    const p = row.payload as { trade?: string };
    const o = row.outcome as { paceBeatAi?: boolean; tie?: boolean } | null;
    if (!o) continue;
    const trade = p.trade ?? '';
    const existing = byTrade.get(trade) ?? { beatOrTie: 0, n: 0 };
    existing.n++;
    if (o.paceBeatAi || o.tie) existing.beatOrTie++;
    byTrade.set(trade, existing);
  }

  const results: TradeGateResult[] = [];
  for (const [trade, { beatOrTie, n }] of byTrade) {
    const rate = n > 0 ? beatOrTie / n : 0;
    results.push({
      trade,
      n,
      rate,
      passed: n >= 5 && rate >= 0.60,
    });
  }
  return results;
}

// ─── Leak precision gate ──────────────────────────────────────────────────────

export interface LeakGateResult {
  /** Resolved leak_flag rows. */
  n: number;
  /**
   * billedRate = itemsBilled / (itemsBilled + itemsEaten) across all resolved scans.
   * Reuses the verbatim `billedRate` formula from accuracyReport.ts:125.
   */
  billedRate: number;
  /** n ≥ 5 AND billedRate ≥ 0.50. The draft-CO sweep may run. */
  passed: boolean;
}

/**
 * Compute the leak precision gate from resolved `leak_flag` rows.
 * Uses the identical billedRate formula as buildLeakAccuracy (accuracyReport.ts:125)
 * but applies a stricter gate (n ≥ 5, not n ≥ 3 display threshold).
 */
export function computeLeakGate(
  resolved: BrainPredictionReadRow[],
): LeakGateResult {
  const leakRows = resolved.filter(
    r => r.kind === 'leak_flag' && r.outcome != null,
  );

  let totalBilled = 0;
  let totalItems = 0;
  for (const row of leakRows) {
    const o = row.outcome as { itemsBilled?: number; itemsEaten?: number } | null;
    if (!o) continue;
    totalBilled += o.itemsBilled ?? 0;
    totalItems += (o.itemsBilled ?? 0) + (o.itemsEaten ?? 0);
  }

  const n = leakRows.length;
  // billedRate: verbatim formula from accuracyReport.ts:125
  const billedRate = totalItems > 0 ? totalBilled / totalItems : 0;

  return {
    n,
    billedRate,
    passed: n >= 5 && billedRate >= 0.50,
  };
}

// ─── Combined gates (convenience) ────────────────────────────────────────────

export interface AutonomyGates {
  /** Per-trade pace gates. Keyed by trade string for O(1) lookup. */
  paceTradeGates: Map<string, TradeGateResult>;
  /** Leak precision gate. */
  leakGate: LeakGateResult;
}

/**
 * Compute all autonomy gates from a combined set of resolved prediction rows.
 * Caller loads rows once via fetchResolvedPredictions([
 *   'pace_suggestion_applied', 'leak_flag'
 * ]) and passes them here.
 */
export function computeAutonomyGates(
  resolved: BrainPredictionReadRow[],
): AutonomyGates {
  const tradeResults = computeTradeGates(resolved);
  const paceTradeGates = new Map<string, TradeGateResult>(
    tradeResults.map(r => [r.trade, r]),
  );
  return {
    paceTradeGates,
    leakGate: computeLeakGate(resolved),
  };
}
