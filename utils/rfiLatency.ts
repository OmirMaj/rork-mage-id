// utils/rfiLatency.ts — aggregate per-project RFI response latency.
// Pure — no React, no mageAI, no RN. Called at the schedule-builder
// interview site so the prompt can buffer for slow design-team responders.
import type { RFI } from '@/types';

export interface RFILatencySummary {
  /** Median calendar days from dateSubmitted to dateResponded, across all responded RFIs. */
  medianResponseDays: number;
  /** Number of RFIs that blew past their dateRequired deadline. */
  overdueCount: number;
  /** Total RFIs with a dateResponded (used for sample size). */
  respondedCount: number;
  /** Human-readable fact line for prompt injection, or null if < 2 samples. */
  factLine: string | null;
}

/** Days between two ISO date strings (positive if b > a). */
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function computeRFILatency(rfis: RFI[]): RFILatencySummary {
  const responseTimes: number[] = [];
  let overdueCount = 0;

  for (const rfi of rfis) {
    if (rfi.dateResponded) {
      const days = daysBetween(rfi.dateSubmitted, rfi.dateResponded);
      if (days >= 0) responseTimes.push(days);
    }
    // Overdue: had a required date + either not responded or responded late
    if (rfi.dateRequired) {
      const requiredMs = new Date(rfi.dateRequired).getTime();
      const resolvedDate = rfi.dateResponded ? new Date(rfi.dateResponded) : new Date();
      if (resolvedDate.getTime() > requiredMs) overdueCount++;
    }
  }

  if (responseTimes.length === 0) {
    return { medianResponseDays: 0, overdueCount, respondedCount: 0, factLine: null };
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

  return { medianResponseDays: median, overdueCount, respondedCount, factLine };
}
