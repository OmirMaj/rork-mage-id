// scripts/validate-brain-accuracy.ts
// Run: bun scripts/validate-brain-accuracy.ts
//
// Tests buildAccuracyReport with synthetic resolved prediction+outcome fixtures.
// Verifies: n-gate suppression (< 3 / < 5), hybrid voice, rate computation,
// honest cold-start empty state.

import { buildAccuracyReport, type AccuracyReport } from '@/utils/brain/accuracyReport';
import type { BrainPredictionReadRow } from '@/utils/brain/types';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
  else { console.log(`PASS: ${msg}`); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResolved(
  kind: BrainPredictionReadRow['kind'],
  subjectId: string,
  outcome: Record<string, unknown>,
): BrainPredictionReadRow {
  return {
    id: `resolved_${kind}_${subjectId}`,
    user_id: 'user-1',
    kind,
    subject_id: subjectId,
    payload: {},
    project_id: null,
    predicted_at: '2026-01-01T00:00:00Z',
    resolved_at: '2026-02-01T00:00:00Z',
    outcome,
  };
}

// ─── Cold start: no resolved rows ─────────────────────────────────────────────

{
  const report = buildAccuracyReport([]);
  assert(report.hasEnoughData === false, 'cold-start: hasEnoughData=false');
  assert(report.rows.length === 0, 'cold-start: no accuracy rows');
  assert(report.totalGraded === 0, 'cold-start: totalGraded=0');
}

// ─── n-gate: below threshold ──────────────────────────────────────────────────

// pace: only 2 rows → suppressed (n < 3)
{
  const rows = [
    makeResolved('pace_suggestion_applied', 'task-1', { paceBeatAi: true, tie: false }),
    makeResolved('pace_suggestion_applied', 'task-2', { paceBeatAi: false, tie: false }),
  ];
  const report = buildAccuracyReport(rows);
  assert(
    !report.rows.some(r => r.kind === 'pace_suggestion_applied'),
    'n-gate: pace suppressed with n=2 (< 3)',
  );
}

// bid_score: only 4 rows → suppressed (n < 5)
{
  const rows = Array.from({ length: 4 }, (_, i) =>
    makeResolved('bid_score', `bid-${i}`, { won: i % 2 === 0, estimatedWinProbability: 0.6, trackedStatus: i % 2 === 0 ? 'won' : 'lost' }),
  );
  const report = buildAccuracyReport(rows);
  assert(
    !report.rows.some(r => r.kind === 'bid_score'),
    'n-gate: bid_score suppressed with n=4 (< 5)',
  );
}

// ─── pace accuracy rows (n ≥ 3) ───────────────────────────────────────────────

{
  const rows = [
    makeResolved('pace_suggestion_applied', 'task-1', { paceBeatAi: true, tie: false }),
    makeResolved('pace_suggestion_applied', 'task-2', { paceBeatAi: true, tie: false }),
    makeResolved('pace_suggestion_applied', 'task-3', { paceBeatAi: false, tie: false }),
    makeResolved('pace_suggestion_applied', 'task-4', { paceBeatAi: false, tie: true }),
  ];
  const report = buildAccuracyReport(rows);
  const paceRow = report.rows.find(r => r.kind === 'pace_suggestion_applied');
  assert(paceRow !== undefined, 'pace: row present with n=4');
  if (paceRow) {
    assert(paceRow.n === 4, 'pace: n=4');
    assert(typeof paceRow.headline === 'string' && paceRow.headline.length > 0, 'pace: headline non-empty');
    assert(typeof paceRow.detail === 'string' && paceRow.detail.length > 0, 'pace: detail non-empty');
    assert(paceRow.rate !== null, 'pace: rate is not null');
    assert(paceRow.rate! >= 0 && paceRow.rate! <= 1, 'pace: rate in [0, 1]');
    // 2 beats + 1 tie counted separately → beatRate = 2/4 = 0.5
    assert(Math.abs(paceRow.rate! - 0.5) < 0.001, 'pace: rate=0.5 (2/4 beat)');
  }
}

// ─── leak accuracy ────────────────────────────────────────────────────────────

{
  const rows = [
    makeResolved('leak_flag', 'r1', { itemsBilled: 2, itemsEaten: 1, dollarsBilled: 2000, dollarsEaten: 500, closedNoMatch: false }),
    makeResolved('leak_flag', 'r2', { itemsBilled: 0, itemsEaten: 3, dollarsBilled: 0, dollarsEaten: 1500, closedNoMatch: true }),
    makeResolved('leak_flag', 'r3', { itemsBilled: 1, itemsEaten: 0, dollarsBilled: 800, dollarsEaten: 0, closedNoMatch: false }),
  ];
  const report = buildAccuracyReport(rows);
  const leakRow = report.rows.find(r => r.kind === 'leak_flag');
  assert(leakRow !== undefined, 'leak: row present with n=3');
  if (leakRow) {
    assert(leakRow.n === 3, 'leak: n=3');
    // totalBilled = 2+0+1 = 3, totalItems = 3+3+1 = 7
    assert(typeof leakRow.headline === 'string', 'leak: headline is string');
    assert(leakRow.rate !== null, 'leak: rate is not null');
    const expectedRate = 3 / 7;
    assert(Math.abs(leakRow.rate! - expectedRate) < 0.01, `leak: rate≈${expectedRate.toFixed(2)}`);
  }
}

// ─── estimate accuracy ────────────────────────────────────────────────────────

{
  const rows = [
    makeResolved('estimate_confidence_snapshot', 'e1', { estimateId: 'e1', grandTotal: 100000, totalActual: 105000, overallBiasPct: 0.05, byBand: [] }),
    makeResolved('estimate_confidence_snapshot', 'e2', { estimateId: 'e2', grandTotal: 80000, totalActual: 82000, overallBiasPct: 0.025, byBand: [] }),
    makeResolved('estimate_confidence_snapshot', 'e3', { estimateId: 'e3', grandTotal: 60000, totalActual: 57000, overallBiasPct: -0.05, byBand: [] }),
  ];
  const report = buildAccuracyReport(rows);
  const estRow = report.rows.find(r => r.kind === 'estimate_confidence_snapshot');
  assert(estRow !== undefined, 'estimate: row present with n=3');
  if (estRow) {
    assert(estRow.n === 3, 'estimate: n=3');
    // avgBias = (0.05 + 0.025 + (-0.05)) / 3 = 0.025/3 ≈ 0.0083
    assert(typeof estRow.headline === 'string', 'estimate: headline is string');
    assert(estRow.headline.toLowerCase().includes('estimates averaged'), 'estimate: headline mentions estimates');
  }
}

// ─── judges accuracy (pick-mode only) ─────────────────────────────────────────

{
  const rows = [
    makeResolved('judges_verdict', 'p1', { projectId: 'p1', targetMarginPct: 0.2, realizedMarginPct: 0.22, verdictWasRight: true, marginDeltaPct: 0.02 }),
    makeResolved('judges_verdict', 'p2', { projectId: 'p2', targetMarginPct: 0.15, realizedMarginPct: 0.18, verdictWasRight: true, marginDeltaPct: 0.03 }),
    makeResolved('judges_verdict', 'p3', { projectId: 'p3', targetMarginPct: 0.25, realizedMarginPct: 0.12, verdictWasRight: false, marginDeltaPct: -0.13 }),
  ];
  const report = buildAccuracyReport(rows);
  const judgesRow = report.rows.find(r => r.kind === 'judges_verdict');
  assert(judgesRow !== undefined, 'judges: row present with n=3');
  if (judgesRow) {
    assert(judgesRow.n === 3, 'judges: n=3');
    assert(judgesRow.rate !== null, 'judges: rate is not null');
    // 2 correct out of 3
    assert(Math.abs(judgesRow.rate! - (2 / 3)) < 0.01, 'judges: rate=2/3');
  }
}

// ─── instant_bid accuracy ─────────────────────────────────────────────────────

{
  const rows = [
    makeResolved('instant_bid_sent', 'resp-1', { responseId: 'resp-1', won: true, status: 'awarded' }),
    makeResolved('instant_bid_sent', 'resp-2', { responseId: 'resp-2', won: false, status: 'declined' }),
    makeResolved('instant_bid_sent', 'resp-3', { responseId: 'resp-3', won: true, status: 'awarded' }),
    makeResolved('instant_bid_sent', 'resp-4', { responseId: 'resp-4', won: false, status: 'declined' }),
  ];
  const report = buildAccuracyReport(rows);
  const ibRow = report.rows.find(r => r.kind === 'instant_bid_sent');
  assert(ibRow !== undefined, 'instant_bid: row present with n=4');
  if (ibRow) {
    assert(ibRow.n === 4, 'instant_bid: n=4');
    // 2 won / 4 = 0.5
    assert(Math.abs(ibRow.rate! - 0.5) < 0.01, 'instant_bid: rate=0.5');
  }
}

// ─── bid_score accuracy (n ≥ 5 gate) ─────────────────────────────────────────

{
  const rows = Array.from({ length: 6 }, (_, i) =>
    makeResolved('bid_score', `bid-${i}`, {
      bidId: `bid-${i}`,
      won: i < 4, // 4 won, 2 lost
      trackedStatus: i < 4 ? 'won' : 'lost',
      matchScore: 70 + i,
      estimatedWinProbability: 0.65,
    }),
  );
  const report = buildAccuracyReport(rows);
  const bsRow = report.rows.find(r => r.kind === 'bid_score');
  assert(bsRow !== undefined, 'bid_score: row present with n=6 (≥ 5)');
  if (bsRow) {
    assert(bsRow.n === 6, 'bid_score: n=6');
    assert(bsRow.rate !== null, 'bid_score: rate is not null');
    // 4/6 ≈ 0.667
    assert(Math.abs(bsRow.rate! - (4 / 6)) < 0.01, 'bid_score: rate≈0.667');
    assert(bsRow.headline.includes('win rate'), 'bid_score: headline mentions win rate');
  }
}

// ─── delay ripple accuracy ────────────────────────────────────────────────────

{
  const rows = [
    makeResolved('delay_ripple_applied', 'rpt-1', { reportId: 'rpt-1', perTask: [], finishErrDays: 1, allResolved: true }),
    makeResolved('delay_ripple_applied', 'rpt-2', { reportId: 'rpt-2', perTask: [], finishErrDays: 3, allResolved: true }),
    makeResolved('delay_ripple_applied', 'rpt-3', { reportId: 'rpt-3', perTask: [], finishErrDays: 2, allResolved: true }),
  ];
  const report = buildAccuracyReport(rows);
  const delayRow = report.rows.find(r => r.kind === 'delay_ripple_applied');
  assert(delayRow !== undefined, 'delay: row present with n=3');
  if (delayRow) {
    assert(delayRow.n === 3, 'delay: n=3');
    assert(delayRow.headline.includes('avg'), 'delay: headline mentions avg');
    // avgFinishErr = (1+3+2)/3 = 2 → within 2 days → solid accuracy
    assert(delayRow.detail.includes('within 2 days'), 'delay: detail mentions 2-day accuracy');
  }
}

// ─── hasEnoughData gate ───────────────────────────────────────────────────────

{
  // Mix: 2 pace (suppressed) + 3 leak (shown) → hasEnoughData = true
  const rows = [
    makeResolved('pace_suggestion_applied', 'task-x', { paceBeatAi: true, tie: false }),
    makeResolved('pace_suggestion_applied', 'task-y', { paceBeatAi: false, tie: false }),
    makeResolved('leak_flag', 'rpt-a', { itemsBilled: 1, itemsEaten: 0, dollarsBilled: 500, dollarsEaten: 0, closedNoMatch: false }),
    makeResolved('leak_flag', 'rpt-b', { itemsBilled: 0, itemsEaten: 1, dollarsBilled: 0, dollarsEaten: 300, closedNoMatch: true }),
    makeResolved('leak_flag', 'rpt-c', { itemsBilled: 1, itemsEaten: 1, dollarsBilled: 400, dollarsEaten: 200, closedNoMatch: false }),
  ];
  const report = buildAccuracyReport(rows);
  assert(report.hasEnoughData === true, 'hasEnoughData: true when at least one kind ≥ n-gate');
  assert(report.rows.length === 1, 'hasEnoughData: only leak row shown (pace suppressed)');
  assert(report.totalGraded === 5, 'hasEnoughData: totalGraded counts all resolved rows');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll brain accuracy tests passed.');
}
