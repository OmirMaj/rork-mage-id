// utils/rfiLatency.ts — aggregate per-project RFI response latency.
// Pure — no React, no mageAI, no RN. Called at the schedule-builder
// interview site so the prompt can buffer for slow design-team responders.
//
// TWO DIFFERENT NUMBERS LIVE HERE AND MUST NOT BE CONFLATED.
//
//   medianResponseDays / factLine  — ROUND TRIP. dateSubmitted to
//     dateResponded. Useful for planning (how long should I buffer for an
//     answer), useless as a measure of anyone else's responsiveness, because
//     it includes the GC's own turnaround.
//
//   hold / holdFactLine            — OWNER-SIDE HOLD TIME. Only the intervals
//     where the architect, engineer, or owner had the ball, folded out of the
//     RFIHandoff custody chain. See utils/rfiHoldTime.ts, including why a
//     subcontractor's hold is NOT owner-side.
//
// Both are exposed so a surface can show them side by side. Any surface that
// shows one must label which one it is.
import type { RFI } from '@/types';
import { summarizeRfiHoldTime, type RfiHoldSummary, type RfiHoldOptions } from '@/utils/rfiHoldTime';
import { calendarDayStart } from '@/utils/calendarDate';

export interface RFILatencySummary {
  /** Median calendar days from dateSubmitted to dateResponded, across all responded RFIs. */
  medianResponseDays: number;
  /** Number of RFIs that blew past their dateRequired deadline. */
  overdueCount: number;
  /** Total RFIs with a dateResponded (used for sample size). */
  respondedCount: number;
  /** Human-readable fact line for prompt injection, or null if < 2 samples.
   *  ROUND TRIP — see the file header. Not a claim measure. */
  factLine: string | null;
  /** Owner-side hold time folded from the handoff chains. Legacy RFIs with no
   *  chain are excluded and counted in `hold.unmeasurableCount`. */
  hold: RfiHoldSummary;
  /** `hold.factLine` — the claim-safe latency line. Null when no RFI on the
   *  project has a handoff chain. */
  holdFactLine: string | null;
}

/** Days between two ISO date strings (positive if b > a). */
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function computeRFILatency(rfis: RFI[], holdOpts: RfiHoldOptions = {}): RFILatencySummary {
  const hold = summarizeRfiHoldTime(rfis ?? [], holdOpts);
  const responseTimes: number[] = [];
  let overdueCount = 0;

  for (const rfi of rfis) {
    if (rfi.dateResponded) {
      const days = daysBetween(rfi.dateSubmitted, rfi.dateResponded);
      if (days >= 0) responseTimes.push(days);
    }
    // Overdue: had a required date + either not responded or responded late
    // calendarDayStart: dateRequired is a bare 'YYYY-MM-DD' in the common
    // case; `new Date()` read it as UTC midnight, so a response the evening
    // BEFORE the due day counted as late west of Greenwich (B4 review A2).
    const required = calendarDayStart(rfi.dateRequired);
    if (required) {
      // Compare DAYS, not an instant against local midnight: a response at
      // 10:00 on the due day is on time, and `required` is that day's 00:00.
      const resolved = rfi.dateResponded
        ? (calendarDayStart(rfi.dateResponded) ?? new Date(rfi.dateResponded))
        : new Date();
      const resolvedDay = new Date(resolved.getFullYear(), resolved.getMonth(), resolved.getDate());
      if (resolvedDay.getTime() > required.getTime()) overdueCount++;
    }
  }

  if (responseTimes.length === 0) {
    return {
      medianResponseDays: 0, overdueCount, respondedCount: 0, factLine: null,
      hold, holdFactLine: hold.factLine,
    };
  }

  const sorted = [...responseTimes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];

  const respondedCount = responseTimes.length;

  // Only emit a fact line when we have ≥ 2 responses (credible signal)
  let factLine: string | null = null;
  if (respondedCount >= 2) {
    const overdueNote = overdueCount > 0
      ? ` — ${overdueCount} blew past their due date`
      : '';
    factLine = `Your design team averages ${median} day${median === 1 ? '' : 's'} per RFI response on this project (${respondedCount} RFIs answered${overdueNote})`;
  }

  return {
    medianResponseDays: median, overdueCount, respondedCount, factLine,
    hold, holdFactLine: hold.factLine,
  };
}
