// utils/brain/trackRecord.ts
//
// Turns RESOLVED brain_predictions rows into itemized, human-readable
// "receipts" — the credibility layer behind the accuracy scoreboard.
//
// Where accuracyReport.ts gives per-kind RATES ("pace beat the AI 8 of 10"),
// this gives the individual PROOF the contractor can eyeball, one row at a time:
//   "Framing — Brain said 5d, actual 5d ✓ (beat the AI's 7d)"
//   "123 Oak kitchen — estimate $42,000, actual $42,840 ✓ (+2% vs actual)"
// That itemized proof is what makes the learning loop believable — and it's the
// Business-tier "why upgrade" made concrete.
//
// Pure: no React, no network, no storage, no Date.now()/new Date(). The row's
// resolved_at / predicted_at carry the time — we never stamp it here.

import type { BrainPredictionReadRow, PredictionKind } from './types';
import type {
  PaceOutcome,
  DelayRippleOutcome,
  LeakOutcome,
  EstimateSnapshotOutcome,
  JudgesOutcome,
  InstantBidOutcome,
  BidScoreOutcome,
} from './gradePredictions';

// hit  = the Brain's call was right / the good outcome landed
// miss = the Brain's call was wrong / the bad outcome landed
// tie  = within the kind's tie window (pace ±0.5d)
// info = resolved but not a clean right/wrong (e.g. finish-day data partial)
export type ReceiptVerdict = 'hit' | 'miss' | 'tie' | 'info';

export interface TrackRecordReceipt {
  id: string;
  kind: PredictionKind;
  label: string; // domain label — "Framing", "Estimate", "Margin verdict"
  predicted: string; // what the Brain called — "5d", "$42,000", "20% target"
  actual: string; // what happened — "5d", "$42,840", "22%"
  verdict: ReceiptVerdict;
  note?: string; // optional context — "beat the AI's 7d"
  whenISO: string; // resolved_at, falling back to predicted_at
}

export interface TrackRecordSummary {
  total: number;
  hits: number;
  misses: number;
  ties: number;
  /** hits / (hits + misses); ties & info excluded. null when no decisive rows. */
  hitRatePct: number | null;
}

// ─── formatters (pure, defensive) ────────────────────────────────────────────

function fmtDays(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}d`;
}
function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function fmtPct(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}
function fmtSignedPct(frac: number): string {
  const p = Math.round(frac * 100);
  return p >= 0 ? `+${p}%` : `${p}%`;
}

type ReceiptBody = Omit<TrackRecordReceipt, 'id' | 'kind' | 'whenISO'>;

function paceReceipt(o: PaceOutcome): ReceiptBody {
  return {
    label: o.trade || 'Pace call',
    predicted: fmtDays(o.paceDays),
    actual: fmtDays(o.actualDays),
    verdict: o.tie ? 'tie' : o.paceBeatAi ? 'hit' : 'miss',
    note: o.paceBeatAi ? `beat the AI's ${fmtDays(o.aiOriginalDays)}` : undefined,
  };
}

function delayReceipt(o: DelayRippleOutcome): ReceiptBody {
  const err = o.finishErrDays;
  const verdict: ReceiptVerdict =
    err == null ? 'info' : Math.abs(err) <= 1 ? 'hit' : Math.abs(err) <= 2 ? 'info' : 'miss';
  const taskCount = o.perTask.length;
  return {
    label: 'Delay ripple',
    predicted: 'finish held',
    actual: err == null ? 'graded' : err === 0 ? 'on time' : `${err > 0 ? '+' : ''}${err}d`,
    verdict,
    note: `${taskCount} task${taskCount === 1 ? '' : 's'} rippled`,
  };
}

function leakReceipt(o: LeakOutcome): ReceiptBody {
  const flagged = o.itemsBilled + o.itemsEaten;
  return {
    label: 'Profit-leak scan',
    predicted: `${flagged} item${flagged === 1 ? '' : 's'} flagged`,
    actual: `${o.itemsBilled} recovered`,
    verdict: o.itemsBilled > 0 ? 'hit' : 'miss',
    note: o.dollarsBilled > 0 ? `${fmtMoney(o.dollarsBilled)} billed back` : undefined,
  };
}

function estimateReceipt(o: EstimateSnapshotOutcome): ReceiptBody {
  const bias = Math.abs(o.overallBiasPct);
  return {
    label: 'Estimate',
    predicted: fmtMoney(o.grandTotal),
    actual: fmtMoney(o.totalActual),
    verdict: bias <= 0.03 ? 'hit' : bias <= 0.1 ? 'info' : 'miss',
    note: `${fmtSignedPct(o.overallBiasPct)} vs actual`,
  };
}

function judgesReceipt(o: JudgesOutcome): ReceiptBody {
  // targetMarginPct + realizedMarginPct are FRACTIONS (see JudgesOutcome doc).
  return {
    label: 'Margin verdict',
    predicted: `${fmtPct(o.targetMarginPct)} target`,
    actual: o.realizedMarginPct == null ? 'pending' : fmtPct(o.realizedMarginPct),
    verdict: o.verdictWasRight == null ? 'info' : o.verdictWasRight ? 'hit' : 'miss',
    note: o.marginDeltaPct == null ? undefined : `${fmtSignedPct(o.marginDeltaPct)} vs target`,
  };
}

function instantBidReceipt(o: InstantBidOutcome): ReceiptBody {
  return {
    label: 'Instant bid',
    predicted: 'proposal sent',
    actual: o.won ? 'won' : 'lost',
    verdict: o.won ? 'hit' : 'miss',
  };
}

function bidScoreReceipt(o: BidScoreOutcome): ReceiptBody {
  const p = o.estimatedWinProbability;
  const predicted = p != null ? `${Math.round(p * 100)}% win odds` : `match ${Math.round(o.matchScore)}`;
  // Calibration: a confident call (≥50%) that won, or a long-shot call (<50%)
  // that lost, is a "right" read. No probability recorded → informational.
  const verdict: ReceiptVerdict = p == null ? 'info' : (p >= 0.5) === o.won ? 'hit' : 'miss';
  return {
    label: 'Tracked bid',
    predicted,
    actual: o.won ? 'won' : 'lost',
    verdict,
  };
}

// ─── main ────────────────────────────────────────────────────────────────────

/**
 * Build itemized receipts from resolved prediction rows, newest first.
 * Rows with no outcome, an unknown kind, or a malformed outcome are skipped
 * (defensive — a bad row must never sink the surface).
 */
export function buildTrackRecord(resolvedRows: BrainPredictionReadRow[]): TrackRecordReceipt[] {
  const out: TrackRecordReceipt[] = [];

  for (const row of resolvedRows) {
    if (row.outcome == null) continue;
    let body: ReceiptBody | null = null;

    try {
      switch (row.kind) {
        case 'pace_suggestion_applied':
          body = paceReceipt(row.outcome as unknown as PaceOutcome);
          break;
        case 'delay_ripple_applied':
          body = delayReceipt(row.outcome as unknown as DelayRippleOutcome);
          break;
        case 'leak_flag':
          body = leakReceipt(row.outcome as unknown as LeakOutcome);
          break;
        case 'estimate_confidence_snapshot':
          body = estimateReceipt(row.outcome as unknown as EstimateSnapshotOutcome);
          break;
        case 'judges_verdict':
          body = judgesReceipt(row.outcome as unknown as JudgesOutcome);
          break;
        case 'instant_bid_sent':
          body = instantBidReceipt(row.outcome as unknown as InstantBidOutcome);
          break;
        case 'bid_score':
          body = bidScoreReceipt(row.outcome as unknown as BidScoreOutcome);
          break;
        default:
          body = null; // leveling_adjustment + any future kind: ungraded
      }
    } catch {
      body = null;
    }

    if (!body) continue;
    out.push({ id: row.id, kind: row.kind, whenISO: row.resolved_at ?? row.predicted_at, ...body });
  }

  // Newest first — lexical compare on ISO-8601 is chronological.
  out.sort((a, b) => (a.whenISO < b.whenISO ? 1 : a.whenISO > b.whenISO ? -1 : 0));
  return out;
}

/** Roll receipts up into a headline record (hits / decisive calls). */
export function summarizeTrackRecord(receipts: TrackRecordReceipt[]): TrackRecordSummary {
  let hits = 0;
  let misses = 0;
  let ties = 0;
  for (const r of receipts) {
    if (r.verdict === 'hit') hits++;
    else if (r.verdict === 'miss') misses++;
    else if (r.verdict === 'tie') ties++;
  }
  const decisive = hits + misses;
  return {
    total: receipts.length,
    hits,
    misses,
    ties,
    hitRatePct: decisive > 0 ? Math.round((hits / decisive) * 100) : null,
  };
}
