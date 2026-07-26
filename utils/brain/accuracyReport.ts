// utils/brain/accuracyReport.ts
//
// Builds the accuracy report from resolved brain_predictions rows.
// Per-domain rates + calibration facts in the HYBRID VOICE:
//   dense stats + first-person self-correction lines
//   e.g. "My tile calls ran 9% hot — recalibrated"
//
// Honesty gate: suppress any kind with n < 3.
// bid_score calibration needs n ≥ 5 decided.
//
// No React. No network. No storage. Pure.

import type { BrainPredictionReadRow } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccuracyRow {
  kind: string;
  label: string;
  n: number;
  headline: string;
  detail: string;
  /** Fraction 0–1 for UI progress bar. Null when not applicable. */
  rate: number | null;
}

export interface AccuracyReport {
  rows: AccuracyRow[];
  totalGraded: number;
  hasEnoughData: boolean; // true when at least one kind has n ≥ 3
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '—';
}

function signedPct(v: number): string {
  const rounded = Math.round(v * 100);
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`;
}

// ─── Per-kind builders ────────────────────────────────────────────────────────

function buildPaceAccuracy(resolved: BrainPredictionReadRow[]): AccuracyRow | null {
  const rows = resolved.filter(r => r.kind === 'pace_suggestion_applied' && r.outcome != null);
  if (rows.length < 3) return null;

  const n = rows.length;
  let beats = 0;
  let ties = 0;
  for (const r of rows) {
    const o = r.outcome as { paceBeatAi?: boolean; tie?: boolean };
    if (o.tie) { ties++; continue; }
    if (o.paceBeatAi) beats++;
  }
  const beatRate = n > 0 ? beats / n : 0;

  return {
    kind: 'pace_suggestion_applied',
    label: 'Pace suggestions',
    n,
    headline: `Pace calls beat the AI ${beats} of ${n} times (${ties} ties)`,
    detail:
      beats > n * 0.6
        ? `My pace book is pulling ahead of the AI on ${beats} of ${n} tasks — keep feeding it actuals.`
        : beats < n * 0.4
        ? `The AI's duration proposals outperformed my pace suggestions ${n - beats} of ${n} times — I need more task actuals per trade to sharpen.`
        : `Roughly even split — pace book matches AI accuracy. ${ties} calls were within the ±0.5d tie window.`,
    rate: beatRate,
  };
}

function buildDelayAccuracy(resolved: BrainPredictionReadRow[]): AccuracyRow | null {
  const rows = resolved.filter(r => r.kind === 'delay_ripple_applied' && r.outcome != null);
  if (rows.length < 3) return null;

  const n = rows.length;
  let totalFinishErr = 0;
  let finishErrCount = 0;
  for (const r of rows) {
    const o = r.outcome as { finishErrDays?: number | null };
    if (o.finishErrDays != null) {
      totalFinishErr += Math.abs(o.finishErrDays);
      finishErrCount++;
    }
  }
  const avgFinishErr = finishErrCount > 0 ? totalFinishErr / finishErrCount : null;

  const headline =
    avgFinishErr != null
      ? `Delay ripples off by avg ${avgFinishErr.toFixed(1)}d at finish (${n} ripples graded)`
      : `${n} delay ripples graded`;

  const detail =
    avgFinishErr != null && avgFinishErr <= 2
      ? `My delay ripple predictions land within 2 days of actual finish on average — solid CPM accuracy.`
      : avgFinishErr != null
      ? `My finish predictions drifted ${avgFinishErr.toFixed(1)} days on average — schedule complexity may be compressing the error.`
      : `Delay ripples graded; finish-day data partially available.`;

  return {
    kind: 'delay_ripple_applied',
    label: 'Delay ripples',
    n,
    headline,
    detail,
    rate: null,
  };
}

function buildLeakAccuracy(resolved: BrainPredictionReadRow[]): AccuracyRow | null {
  const rows = resolved.filter(r => r.kind === 'leak_flag' && r.outcome != null);
  if (rows.length < 3) return null;

  const n = rows.length;
  let totalBilled = 0;
  let totalItems = 0;
  for (const r of rows) {
    const o = r.outcome as { itemsBilled?: number; itemsEaten?: number };
    totalBilled += o.itemsBilled ?? 0;
    totalItems += (o.itemsBilled ?? 0) + (o.itemsEaten ?? 0);
  }
  const billedRate = totalItems > 0 ? totalBilled / totalItems : 0;

  return {
    kind: 'leak_flag',
    label: 'Profit leak flags',
    n,
    headline: `${pct(totalBilled, totalItems)} of flagged items recovered via COs (${n} scans graded)`,
    detail:
      billedRate >= 0.6
        ? `Strong CO recovery — I flagged ${totalBilled} of ${totalItems} leak items that turned into approved change orders.`
        : billedRate >= 0.3
        ? `${totalBilled} of ${totalItems} flagged leak items recovered via COs. The rest were absorbed — consider earlier flag-to-CO follow-through.`
        : `Only ${totalBilled} of ${totalItems} leak items became COs. Low recovery may signal the flags are catching conditions that don't justify formal change orders.`,
    rate: billedRate,
  };
}

function buildEstimateAccuracy(resolved: BrainPredictionReadRow[]): AccuracyRow | null {
  const rows = resolved.filter(
    r => r.kind === 'estimate_confidence_snapshot' && r.outcome != null,
  );
  if (rows.length < 3) return null;

  const n = rows.length;
  let totalBiasPct = 0;
  for (const r of rows) {
    const o = r.outcome as { overallBiasPct?: number };
    totalBiasPct += o.overallBiasPct ?? 0;
  }
  const avgBias = n > 0 ? totalBiasPct / n : 0;
  const signed = signedPct(avgBias);

  const headline = `Estimates averaged ${signed} vs actuals across ${n} closed jobs`;
  const detail =
    Math.abs(avgBias) <= 0.03
      ? `My estimates are landing within ±3% of actual cost on average — within calibration range.`
      : avgBias > 0
      ? `My estimates ran ${signed} over actual costs. I'm consistently over-budgeting — which protects margin but may cost me bids.`
      : `My estimates ran ${signed} under actual costs — I'm leaving margin on the table. Recalibrating my high-confidence line estimates upward.`;

  return {
    kind: 'estimate_confidence_snapshot',
    label: 'Estimate accuracy',
    n,
    headline,
    detail,
    rate: Math.max(0, Math.min(1, 1 - Math.abs(avgBias) * 5)), // accuracy proxy
  };
}

function buildJudgesAccuracy(resolved: BrainPredictionReadRow[]): AccuracyRow | null {
  // Only pick-mode rows are graded (describe-mode outcome is null)
  const rows = resolved.filter(r => r.kind === 'judges_verdict' && r.outcome != null);
  if (rows.length < 3) return null;

  const n = rows.length;
  let correct = 0;
  let totalDelta = 0;
  for (const r of rows) {
    const o = r.outcome as { verdictWasRight?: boolean | null; marginDeltaPct?: number | null };
    if (o.verdictWasRight) correct++;
    if (o.marginDeltaPct != null) totalDelta += o.marginDeltaPct;
  }
  const correctRate = n > 0 ? correct / n : 0;
  const avgDelta = n > 0 ? totalDelta / n : 0;

  return {
    kind: 'judges_verdict',
    label: 'Judges margin calls',
    n,
    headline: `${pct(correct, n)} of margin verdicts hit target on ${n} closed jobs`,
    detail:
      correctRate >= 0.7
        ? `My Judges calls landed on or above target margin ${correct} of ${n} times — solid forecasting.`
        : `Margin came in ${signedPct(avgDelta)} vs target on average. My Judges verdicts are running ${avgDelta >= 0 ? 'conservative' : 'optimistic'} — adjusting target guidance.`,
    rate: correctRate,
  };
}

function buildInstantBidAccuracy(resolved: BrainPredictionReadRow[]): AccuracyRow | null {
  const rows = resolved.filter(r => r.kind === 'instant_bid_sent' && r.outcome != null);
  if (rows.length < 3) return null;

  const n = rows.length;
  let won = 0;
  for (const r of rows) {
    const o = r.outcome as { won?: boolean };
    if (o.won) won++;
  }
  const winRate = n > 0 ? won / n : 0;

  return {
    kind: 'instant_bid_sent',
    label: 'Instant bid win rate',
    n,
    headline: `${pct(won, n)} win rate on Instant Bid proposals (${n} decided)`,
    detail:
      winRate >= 0.5
        ? `${won} of ${n} Instant Bid responses awarded — above average.`
        : `${won} of ${n} Instant Bid responses won. Consider adjusting tier pricing or proposal messaging.`,
    rate: winRate,
  };
}

function buildBidScoreAccuracy(resolved: BrainPredictionReadRow[]): AccuracyRow | null {
  // bid_score calibration: n ≥ 5 decided (plan spec)
  const rows = resolved.filter(r => r.kind === 'bid_score' && r.outcome != null);
  if (rows.length < 5) return null;

  const n = rows.length;
  let won = 0;
  let totalProbability = 0;
  let probCount = 0;
  for (const r of rows) {
    const o = r.outcome as { won?: boolean; estimatedWinProbability?: number | null };
    if (o.won) won++;
    if (o.estimatedWinProbability != null) {
      totalProbability += o.estimatedWinProbability;
      probCount++;
    }
  }
  const winRate = n > 0 ? won / n : 0;
  const avgPredicted = probCount > 0 ? totalProbability / probCount : null;

  let headline = `Bid Scorecard win rate: ${pct(won, n)} (${n} bids graded)`;
  let detail =
    `Tracked ${n} bids through to outcome — ${won} won. `;

  if (avgPredicted != null) {
    const calibrationErr = Math.abs(winRate - avgPredicted);
    headline = `Bid Scorecard ${pct(won, n)} actual vs ${Math.round(avgPredicted * 100)}% predicted win rate`;
    detail +=
      calibrationErr <= 0.08
        ? `Win probability predictions are well-calibrated (±${Math.round(calibrationErr * 100)}% from actual).`
        : `Win probability overestimated by ${Math.round((avgPredicted - winRate) * 100)}% — recalibrating scoring weights.`;
  }

  return {
    kind: 'bid_score',
    label: 'Bid scorecard',
    n,
    headline,
    detail,
    rate: winRate,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the accuracy report from all resolved prediction rows.
 * Applies the n-gate (3 for most kinds, 5 for bid_score calibration).
 * Returns an empty report when no kind meets the gate — honest cold-start.
 */
export function buildAccuracyReport(resolvedRows: BrainPredictionReadRow[]): AccuracyReport {
  const rows: AccuracyRow[] = [];

  const pace = buildPaceAccuracy(resolvedRows);
  if (pace) rows.push(pace);

  const delay = buildDelayAccuracy(resolvedRows);
  if (delay) rows.push(delay);

  const leak = buildLeakAccuracy(resolvedRows);
  if (leak) rows.push(leak);

  const est = buildEstimateAccuracy(resolvedRows);
  if (est) rows.push(est);

  const judges = buildJudgesAccuracy(resolvedRows);
  if (judges) rows.push(judges);

  const instantBid = buildInstantBidAccuracy(resolvedRows);
  if (instantBid) rows.push(instantBid);

  const bidScore = buildBidScoreAccuracy(resolvedRows);
  if (bidScore) rows.push(bidScore);

  const totalGraded = resolvedRows.length;
  return {
    rows,
    totalGraded,
    hasEnoughData: rows.length > 0,
  };
}
