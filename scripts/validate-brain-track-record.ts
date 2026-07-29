// validate-brain-track-record.ts — pins utils/brain/trackRecord.ts.
// The itemized "receipts" behind the Brain accuracy scoreboard: predicted vs
// actual + verdict per resolved prediction. Run: bun run scripts/validate-brain-track-record.ts
import { buildTrackRecord, summarizeTrackRecord } from '../utils/brain/trackRecord';
import type { BrainPredictionReadRow, PredictionKind } from '../utils/brain/types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

// Minimal resolved-row builder (server-set fields included).
let seq = 0;
function mk(kind: PredictionKind, outcome: Record<string, unknown> | null, resolvedAt = `2026-07-2${seq++}T00:00:00.000Z`): BrainPredictionReadRow {
  return {
    id: `p${seq}`, project_id: 'proj1', kind, subject_id: 's', payload: {},
    predicted_at: '2026-07-01T00:00:00.000Z', user_id: 'u1', resolved_at: resolvedAt, outcome,
  };
}

console.log('\nbrain track record:');

// ─── per-kind receipts ────────────────────────────────────────────────────────
const pace = buildTrackRecord([mk('pace_suggestion_applied', {
  taskId: 't', trade: 'Framing', aiOriginalDays: 7, paceDays: 5, actualDays: 5, paceErrVsAi: -2, paceBeatAi: true, tie: false,
})])[0];
expect('pace hit — predicted/actual', [pace.predicted, pace.actual, pace.verdict], ['5d', '5d', 'hit']);
expect('pace hit — label + note', [pace.label, pace.note], ['Framing', "beat the AI's 7d"]);

expect('pace tie',
  buildTrackRecord([mk('pace_suggestion_applied', { taskId: 't', trade: 'Tile', aiOriginalDays: 5, paceDays: 5, actualDays: 5, paceErrVsAi: 0, paceBeatAi: false, tie: true })])[0].verdict,
  'tie');
expect('pace miss',
  buildTrackRecord([mk('pace_suggestion_applied', { taskId: 't', trade: 'Paint', aiOriginalDays: 5, paceDays: 8, actualDays: 5, paceErrVsAi: 3, paceBeatAi: false, tie: false })])[0].verdict,
  'miss');

const est = buildTrackRecord([mk('estimate_confidence_snapshot', {
  estimateId: 'e', grandTotal: 42000, totalActual: 42840, overallBiasPct: 0.02, byBand: [],
})])[0];
expect('estimate hit — money + bias note', [est.predicted, est.actual, est.verdict, est.note], ['$42,000', '$42,840', 'hit', '+2% vs actual']);
expect('estimate miss (>10% bias)',
  buildTrackRecord([mk('estimate_confidence_snapshot', { estimateId: 'e', grandTotal: 10000, totalActual: 13000, overallBiasPct: 0.3, byBand: [] })])[0].verdict,
  'miss');

const leak = buildTrackRecord([mk('leak_flag', { reportId: 'r', itemsBilled: 3, itemsEaten: 1, dollarsBilled: 5000, dollarsEaten: 0, closedNoMatch: false })])[0];
expect('leak hit — flagged/recovered + $ note', [leak.predicted, leak.actual, leak.verdict, leak.note], ['4 items flagged', '3 recovered', 'hit', '$5,000 billed back']);
expect('leak miss (nothing recovered)',
  buildTrackRecord([mk('leak_flag', { reportId: 'r', itemsBilled: 0, itemsEaten: 2, dollarsBilled: 0, dollarsEaten: 900, closedNoMatch: true })])[0].verdict,
  'miss');

const judges = buildTrackRecord([mk('judges_verdict', { projectId: 'proj1', targetMarginPct: 0.2, realizedMarginPct: 0.22, verdictWasRight: true, marginDeltaPct: 0.02 })])[0];
expect('judges hit — target/realized', [judges.predicted, judges.actual, judges.verdict, judges.note], ['20% target', '22%', 'hit', '+2% vs target']);

expect('instant bid won → hit/won',
  (() => { const r = buildTrackRecord([mk('instant_bid_sent', { responseId: 'x', won: true, status: 'awarded' })])[0]; return [r.actual, r.verdict]; })(),
  ['won', 'hit']);

expect('bid score calibrated (70% → won) hit',
  buildTrackRecord([mk('bid_score', { bidId: 'b', won: true, trackedStatus: 'won', matchScore: 80, estimatedWinProbability: 0.7 })])[0].verdict,
  'hit');
expect('bid score miscalibrated (80% → lost) miss',
  buildTrackRecord([mk('bid_score', { bidId: 'b', won: false, trackedStatus: 'lost', matchScore: 80, estimatedWinProbability: 0.8 })])[0].verdict,
  'miss');

expect('delay ripple on-time → hit',
  (() => { const r = buildTrackRecord([mk('delay_ripple_applied', { reportId: 'r', perTask: [{ taskId: 't', predictedDelta: 2, actualDelta: 0, errDays: 0 }], finishErrDays: 0, allResolved: true })])[0]; return [r.actual, r.verdict]; })(),
  ['on time', 'hit']);

// ─── skipping ─────────────────────────────────────────────────────────────────
expect('null outcome skipped',
  buildTrackRecord([mk('pace_suggestion_applied', null)]).length, 0);
expect('ungradeable kind skipped',
  buildTrackRecord([mk('leveling_adjustment', { anything: 1 })]).length, 0);

// ─── ordering (newest resolved_at first) ──────────────────────────────────────
seq = 0;
const ordered = buildTrackRecord([
  mk('instant_bid_sent', { responseId: 'a', won: true, status: 'awarded' }, '2026-07-10T00:00:00.000Z'),
  mk('instant_bid_sent', { responseId: 'b', won: false, status: 'declined' }, '2026-07-20T00:00:00.000Z'),
]);
expect('newest first', [ordered[0].whenISO, ordered[1].whenISO], ['2026-07-20T00:00:00.000Z', '2026-07-10T00:00:00.000Z']);

// ─── summary ──────────────────────────────────────────────────────────────────
const summary = summarizeTrackRecord([
  { id: '1', kind: 'instant_bid_sent', label: '', predicted: '', actual: '', verdict: 'hit', whenISO: '' },
  { id: '2', kind: 'instant_bid_sent', label: '', predicted: '', actual: '', verdict: 'hit', whenISO: '' },
  { id: '3', kind: 'instant_bid_sent', label: '', predicted: '', actual: '', verdict: 'miss', whenISO: '' },
  { id: '4', kind: 'pace_suggestion_applied', label: '', predicted: '', actual: '', verdict: 'tie', whenISO: '' },
]);
expect('summary counts + hit rate (2 of 3 decisive = 67%)',
  [summary.total, summary.hits, summary.misses, summary.ties, summary.hitRatePct], [4, 2, 1, 1, 67]);
expect('summary hit rate null when no decisive rows',
  summarizeTrackRecord([{ id: '1', kind: 'delay_ripple_applied', label: '', predicted: '', actual: '', verdict: 'info', whenISO: '' }]).hitRatePct,
  null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
