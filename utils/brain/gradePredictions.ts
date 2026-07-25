// utils/brain/gradePredictions.ts
//
// Pure graders: one per gradeable kind.
// Signature: (prediction: BrainPredictionReadRow, ctx: GradingCtx) → outcome | null
//   null  = not yet resolvable (data not in hand)
//   object = outcome JSON written to brain_predictions.outcome via resolvePrediction
//
// HONESTY NOTES (per plan Wave 2):
//   - leveling_adjustment rows are captured but NEVER graded here — no join key.
//   - describe-mode judges_verdict rows are captured but NEVER graded — no project join.
//   - Both are deferred to v1.1 as documented in the plan's HONESTY LEDGER.
//
// No React imports. No AsyncStorage. No network. Pure.

import type { BrainPredictionReadRow } from './types';
import type { Project, ChangeOrder, Commitment } from '@/types';
import type { HomeownerBidResponse } from '@/types';
import { computeEstimateActuals } from '@/utils/estimateActuals';
import { isWorkingDay } from '@/utils/cpm';

// ─── Grading context ─────────────────────────────────────────────────────────

export interface GradingCtx {
  projects: Project[];
  changeOrders: ChangeOrder[];
  commitments: Commitment[];
  /** bid_responses rows — used to grade instant_bid_sent */
  bidResponses?: HomeownerBidResponse[];
  /** mageid_tracked_bids in-memory array — used to grade bid_score */
  trackedBids?: TrackedBidRecord[];
}

/** Minimal tracked-bid shape (from bid-detail.tsx TrackedBid interface) */
export interface TrackedBidRecord {
  bidId: string;
  status: 'saved' | 'interested' | 'preparing' | 'submitted' | 'won' | 'lost';
  notes: string;
  proposalAmount: number | null;
  savedAt: string;
}

// ─── Working-day count (calendar span → working days) ────────────────────────

/**
 * Count working days between two inclusive day-number indices.
 * Falls back to calendar days when the schedule has no parseable startDate.
 */
function workingDaySpan(
  startDay: number,
  endDay: number,
  schedule?: { startDate?: string | null; workingDaysPerWeek?: number } | null,
): number {
  if (startDay > endDay) return 0;
  const startDate = schedule?.startDate;
  if (!startDate || !Number.isFinite(Date.parse(startDate + 'T00:00:00Z'))) {
    return Math.max(1, endDay - startDay + 1);
  }
  const wd = schedule?.workingDaysPerWeek ?? 5;
  const closures = new Set<string>(); // no per-project closure list in grading ctx
  let count = 0;
  for (let d = startDay; d <= endDay; d++) {
    if (isWorkingDay(d, wd, startDate, closures)) count++;
  }
  return Math.max(1, count);
}

// ─── gradePace ───────────────────────────────────────────────────────────────

export interface PaceOutcome {
  taskId: string;
  trade: string;
  aiOriginalDays: number;
  paceDays: number;
  actualDays: number;
  /** |actual − pace| − |actual − aiOriginal|. Negative = pace was closer. */
  paceErrVsAi: number;
  paceBeatAi: boolean;
  tie: boolean; // within ±0.5 working days
}

export function gradePace(
  prediction: BrainPredictionReadRow,
  ctx: GradingCtx,
): PaceOutcome | null {
  const p = prediction.payload as {
    taskId?: string;
    trade?: string;
    aiOriginalDays?: number;
    paceDays?: number;
  };
  const { taskId, trade, aiOriginalDays, paceDays } = p;
  if (!taskId || aiOriginalDays == null || paceDays == null) return null;

  // Find the task across all project schedules
  for (const project of ctx.projects) {
    const tasks = project.schedule?.tasks ?? [];
    const task = tasks.find(t => t.id === taskId);
    if (!task) continue;
    // Needs both actuals to be gradeable
    if (task.actualStartDay == null || task.actualEndDay == null) return null;
    const actualDays = workingDaySpan(task.actualStartDay, task.actualEndDay, project.schedule);
    const paceErr = Math.abs(actualDays - paceDays);
    const aiErr = Math.abs(actualDays - aiOriginalDays);
    const diff = paceErr - aiErr;
    return {
      taskId,
      trade: trade ?? '',
      aiOriginalDays,
      paceDays,
      actualDays,
      paceErrVsAi: diff,
      paceBeatAi: diff < -0.5,
      tie: Math.abs(diff) <= 0.5,
    };
  }
  return null; // task not found yet
}

// ─── gradeDelayRipple ────────────────────────────────────────────────────────

export interface DelayRippleOutcome {
  reportId: string;
  perTask: Array<{
    taskId: string;
    predictedDelta: number;
    actualDelta: number;
    errDays: number;
  }>;
  finishErrDays: number | null;
  allResolved: boolean;
}

export function gradeDelayRipple(
  prediction: BrainPredictionReadRow,
  ctx: GradingCtx,
): DelayRippleOutcome | null {
  const p = prediction.payload as {
    reportId?: string;
    hits?: Array<{ taskId: string; deltaDays: number }>;
    predictedFinishDay?: number;
  };
  const { reportId, hits, predictedFinishDay } = p;
  if (!reportId || !hits || hits.length === 0) return null;

  // Find the project for this prediction (via project_id on the row)
  const projectId = prediction.project_id;
  if (!projectId) return null;
  const project = ctx.projects.find(pr => pr.id === projectId);
  if (!project) return null;
  const tasks = project.schedule?.tasks ?? [];

  const perTask: DelayRippleOutcome['perTask'] = [];
  let allResolved = true;

  for (const hit of hits) {
    const task = tasks.find(t => t.id === hit.taskId);
    if (!task || task.actualEndDay == null) {
      allResolved = false;
      continue;
    }
    // Actual delta: compare to the task's planned end relative to schedule context.
    // We use the planned endDay (startDay + durationDays − 1 as calendar proxy)
    // vs actualEndDay.
    const plannedEndDay = task.startDay + Math.max(0, task.durationDays - 1);
    const actualDelta = task.actualEndDay - plannedEndDay;
    perTask.push({
      taskId: hit.taskId,
      predictedDelta: hit.deltaDays,
      actualDelta,
      errDays: Math.abs(actualDelta - hit.deltaDays),
    });
  }

  if (!allResolved) return null; // wait until all hit tasks have actuals

  // Finish error
  let finishErrDays: number | null = null;
  if (predictedFinishDay != null && project.schedule) {
    const lastActualEnd = tasks
      .filter(t => t.actualEndDay != null)
      .reduce<number | null>((max, t) => {
        const v = t.actualEndDay!;
        return max == null || v > max ? v : max;
      }, null);
    if (lastActualEnd != null) {
      finishErrDays = lastActualEnd - predictedFinishDay;
    }
  }

  return { reportId, perTask, finishErrDays, allResolved: true };
}

// ─── gradeLeak ───────────────────────────────────────────────────────────────

export interface LeakOutcome {
  reportId: string;
  itemsBilled: number;
  itemsEaten: number;
  dollarsBilled: number;
  dollarsEaten: number;
  /** true = project is closed with no match (final verdict: all eaten) */
  closedNoMatch: boolean;
}

/** Minimum shared token length for text match (plan spec: length ≥5) */
const MIN_TOKEN_LEN = 5;
const WINDOW_DAYS = 60;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= MIN_TOKEN_LEN);
}

function sharesToken(a: string, b: string): boolean {
  const tokA = new Set(tokenize(a));
  for (const t of tokenize(b)) {
    if (tokA.has(t)) return true;
  }
  return false;
}

export function gradeLeak(
  prediction: BrainPredictionReadRow,
  ctx: GradingCtx,
): LeakOutcome | null {
  const p = prediction.payload as {
    reportId?: string;
    items?: Array<{ category?: string; description?: string; estPrice?: number | null }>;
  };
  const { reportId, items } = p;
  if (!reportId || !items || items.length === 0) return null;

  const projectId = prediction.project_id;
  if (!projectId) return null;
  const project = ctx.projects.find(pr => pr.id === projectId);
  if (!project) return null;

  const scannedAt = prediction.predicted_at;
  const scannedMs = Date.parse(scannedAt);
  const windowEnd = scannedMs + WINDOW_DAYS * 86400000;
  const isClosed = project.status === 'completed' || project.status === 'closed';

  // COs on this project: approved, date ≥ scannedAt, within 60-day window
  const approvedCOs = ctx.changeOrders.filter(co => {
    if (co.projectId !== projectId) return false;
    if (co.status !== 'approved') return false;
    const coMs = Date.parse(co.date);
    return coMs >= scannedMs && coMs <= windowEnd;
  });

  let itemsBilled = 0;
  let itemsEaten = 0;
  let dollarsBilled = 0;
  let dollarsEaten = 0;
  let unresolvedCount = 0;

  for (const item of items) {
    const estPrice = item.estPrice ?? 0;
    const desc = item.description ?? '';

    // Try to match a CO by price window OR shared token
    const matched = approvedCOs.some(co => {
      const priceInWindow =
        estPrice > 0 &&
        co.changeAmount >= estPrice * 0.5 &&
        co.changeAmount <= estPrice * 2.0;
      const tokenMatch = sharesToken(co.description, desc);
      return priceInWindow || tokenMatch;
    });

    if (matched) {
      itemsBilled++;
      dollarsBilled += estPrice;
    } else if (isClosed) {
      // Project is closed, no matching CO — eaten
      itemsEaten++;
      dollarsEaten += estPrice;
    } else {
      // Window hasn't closed and no match yet — not resolvable yet
      unresolvedCount++;
    }
  }

  // If still within window and project open, wait
  if (unresolvedCount > 0 && !isClosed && Date.now() <= windowEnd) return null;

  // Remaining unmatched items on an open project past the window: eaten
  if (unresolvedCount > 0) {
    itemsEaten += unresolvedCount;
    // We don't have estPrice for the unmatched items easily here — already counted above
    // so just add the remaining items that weren't matched or billed
    // (unresolvedCount was items not matched and project still open — treat as eaten now)
  }

  return {
    reportId,
    itemsBilled,
    itemsEaten,
    dollarsBilled,
    dollarsEaten,
    closedNoMatch: isClosed && itemsBilled === 0 && itemsEaten === items.length,
  };
}

// ─── gradeEstimateSnapshot ───────────────────────────────────────────────────

export interface EstimateSnapshotOutcome {
  estimateId: string;
  grandTotal: number;
  totalActual: number;
  overallBiasPct: number; // (actual - estimate) / estimate, negative = came in under
  byBand: Array<{
    band: string;
    lines: number;
    avgBiasPct: number;
    withinThreePct: boolean;
  }>;
}

export function gradeEstimateSnapshot(
  prediction: BrainPredictionReadRow,
  ctx: GradingCtx,
): EstimateSnapshotOutcome | null {
  const p = prediction.payload as {
    estimateId?: string;
    grandTotal?: number;
    lines?: Array<{ id: string; category: string; total: number; confidenceBand: string }>;
    coveragePct?: number;
  };
  const { estimateId, grandTotal, lines } = p;
  if (!estimateId || grandTotal == null || !lines || lines.length === 0) return null;

  const projectId = prediction.project_id;
  if (!projectId) return null;
  const project = ctx.projects.find(pr => pr.id === projectId);
  if (!project) return null;
  // Only grade at close
  if (project.status !== 'completed' && project.status !== 'closed') return null;

  const report = computeEstimateActuals(project, ctx.commitments);
  if (!report.hasEstimate || !report.hasActuals) return null;

  const totalActual = Math.max(report.totalActual, report.totalCommitted);
  const overallBiasPct = grandTotal > 0 ? (totalActual - grandTotal) / grandTotal : 0;

  // Group by confidence band — compare predicted lines to actuals by category
  const bandGroups = new Map<string, { total: number; actual: number; count: number }>();
  for (const line of lines) {
    const band = line.confidenceBand;
    if (!bandGroups.has(band)) bandGroups.set(band, { total: 0, actual: 0, count: 0 });
    const g = bandGroups.get(band)!;
    g.total += line.total;
    g.count++;
    // Find corresponding actual from estimateActuals report
    const actualLine = report.lines.find(
      al => al.materialId === line.id || al.category === line.category,
    );
    g.actual += actualLine ? Math.max(actualLine.actual, actualLine.committed) : line.total;
  }

  const byBand = Array.from(bandGroups.entries()).map(([band, g]) => {
    const avgBiasPct = g.total > 0 ? (g.actual - g.total) / g.total : 0;
    return {
      band,
      lines: g.count,
      avgBiasPct,
      withinThreePct: Math.abs(avgBiasPct) <= 0.03,
    };
  });

  return {
    estimateId,
    grandTotal,
    totalActual,
    overallBiasPct,
    byBand,
  };
}

// ─── gradeJudges (pick-mode only) ────────────────────────────────────────────

export interface JudgesOutcome {
  projectId: string;
  targetMarginPct: number;
  realizedMarginPct: number | null;
  verdictWasRight: boolean | null; // null when no realized margin available
  marginDeltaPct: number | null;
}

export function gradeJudges(
  prediction: BrainPredictionReadRow,
  ctx: GradingCtx,
): JudgesOutcome | null {
  const p = prediction.payload as {
    mode?: string;
    verdict?: string;
    targetMarginPct?: number;
    projectId?: string;
  };
  if (p.mode !== 'pick') return null; // describe-mode: ungradeable v1

  const { targetMarginPct, projectId } = p;
  if (targetMarginPct == null || !projectId) return null;

  const project = ctx.projects.find(pr => pr.id === projectId);
  if (!project) return null;
  if (project.status !== 'completed' && project.status !== 'closed') return null;

  // Use typeMargin realizedMarginPct logic inline
  const revenue = project.linkedEstimate?.grandTotal ?? 0;
  if (revenue <= 0) return null;
  const report = computeEstimateActuals(project, ctx.commitments);
  if (!report.hasEstimate) return null;
  const cost = Math.max(report.totalActual, report.totalCommitted);
  if (cost <= 0) return null;
  const realized = Math.max(-1, Math.min(1, (revenue - cost) / revenue));

  // "Verdict was right" = realized margin at or above target
  return {
    projectId,
    targetMarginPct,
    realizedMarginPct: realized,
    verdictWasRight: realized >= targetMarginPct,
    marginDeltaPct: realized - targetMarginPct,
  };
}

// ─── gradeInstantBid ─────────────────────────────────────────────────────────

export interface InstantBidOutcome {
  responseId: string;
  won: boolean;
  status: string;
}

export function gradeInstantBid(
  prediction: BrainPredictionReadRow,
  ctx: GradingCtx,
): InstantBidOutcome | null {
  const p = prediction.payload as { responseId?: string };
  const { responseId } = p;
  if (!responseId) return null;
  if (!ctx.bidResponses) return null;

  const response = ctx.bidResponses.find(r => r.id === responseId);
  if (!response) return null;
  if (response.status !== 'awarded' && response.status !== 'declined') return null;

  return {
    responseId,
    won: response.status === 'awarded',
    status: response.status,
  };
}

// ─── gradeBidScore ───────────────────────────────────────────────────────────

export interface BidScoreOutcome {
  bidId: string;
  won: boolean;
  trackedStatus: string;
  matchScore: number;
  estimatedWinProbability: number | null;
}

export function gradeBidScore(
  prediction: BrainPredictionReadRow,
  ctx: GradingCtx,
): BidScoreOutcome | null {
  const p = prediction.payload as {
    bidId?: string;
    matchScore?: number;
    estimatedWinProbability?: number | null;
  };
  const { bidId, matchScore, estimatedWinProbability } = p;
  if (!bidId) return null;
  if (!ctx.trackedBids) return null;

  const tracked = ctx.trackedBids.find(t => t.bidId === bidId);
  if (!tracked) return null;
  if (tracked.status !== 'won' && tracked.status !== 'lost') return null;

  return {
    bidId,
    won: tracked.status === 'won',
    trackedStatus: tracked.status,
    matchScore: matchScore ?? 0,
    estimatedWinProbability: estimatedWinProbability ?? null,
  };
}
