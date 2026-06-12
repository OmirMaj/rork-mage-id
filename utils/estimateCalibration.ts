// estimateCalibration.ts — the cross-job correction layer of the cost-learning loop.
//
// estimateActuals measures ONE job: bid vs committed vs actual, per line. This
// engine compounds that truth ACROSS jobs, per category: "you under-estimate
// Tile by 12%, across 4 jobs". That persistent, directional bias is the most
// fixable estimating error a GC has — it repeats job after job until somebody
// measures it. The output is a suggested correction factor per category that
// the GC can choose to apply (persisted by hooks/useEstimateCalibration).
//
// Honesty rules:
//  - Built on the SAME per-project tracing as estimate-accuracy: we call
//    computeEstimateActuals per project rather than re-deriving attribution,
//    so the two screens can never disagree about what a job actually cost.
//  - Only lines with REAL actuals (paid-to-date traced onto the line) count.
//    A category with bids but no payments yet proves nothing — excluded.
//  - Bias compares actual against the bid for the SAME scope (apples to
//    apples at line level), never whole-estimate vs whole-spend.
//  - Suggested multipliers are clamped to a sane 0.8–1.5 band: outside that,
//    the data is telling you about a scope bust or a bad link, not a pricing
//    bias, and blindly multiplying would do more harm than good.
//
// Pure function, no storage, no network — callers pass projects + commitments
// from ProjectContext and re-run on every mutation.

import type { Project, Commitment } from '@/types';
import { computeEstimateActuals } from '@/utils/estimateActuals';

/** Within ±3% of bid, the category is considered calibrated. */
const ALIGNED_BAND = 0.03;
/** Suggested multiplier clamp — corrections outside this are not credible. */
const MULTIPLIER_MIN = 0.8;
const MULTIPLIER_MAX = 1.5;

export type CalibrationDirection = 'under' | 'over' | 'aligned';
export type CalibrationConfidence = 'low' | 'medium' | 'high';

export interface CategoryCalibration {
  category: string;
  /** Number of projects contributing real actuals to this category. */
  jobs: number;
  /** Sum of bid (estimated line cost) across contributing lines. */
  estimatedTotal: number;
  /** Sum of actual (paid-to-date) attributed to those same lines. */
  actualTotal: number;
  /** actual / estimated. 1.12 = work cost 12% more than you bid it. */
  bias: number;
  /** Bias clamped to 0.8–1.5 and rounded to 2dp — the factor to apply. */
  suggestedMultiplier: number;
  /** 'under' = you under-estimate (actual ran above bid); 'over' = the reverse. */
  direction: CalibrationDirection;
  /** By job count: 1 job = low, 2 = medium, 3+ = high. */
  confidence: CalibrationConfidence;
  /** Plain-English readout, e.g. "You under-estimate Tile by 12% across 4 jobs." */
  detail: string;
}

export interface CalibrationSummary {
  /** Total actual / total estimated across all measured categories ($-weighted). */
  weightedBias: number;
  /** Distinct projects contributing actuals anywhere. */
  totalJobs: number;
  /** Categories with enough data to measure. */
  categoryCount: number;
  /** Worst under-estimated category by dollar overrun; null when none run under. */
  biggestUnder: CategoryCalibration | null;
}

export interface CalibrationReport {
  /** False until at least one category has real actuals to measure. */
  hasData: boolean;
  /** Per category, sorted by |bias − 1| descending (worst calibration first). */
  categories: CategoryCalibration[];
  summary: CalibrationSummary;
  asOf: string;
}

export interface CalibrationInput {
  projects: Project[];
  commitments: Commitment[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function directionFor(bias: number): CalibrationDirection {
  if (bias > 1 + ALIGNED_BAND) return 'under';
  if (bias < 1 - ALIGNED_BAND) return 'over';
  return 'aligned';
}

function confidenceFor(jobs: number): CalibrationConfidence {
  if (jobs >= 3) return 'high';
  if (jobs >= 2) return 'medium';
  return 'low';
}

function detailFor(c: Omit<CategoryCalibration, 'detail'>): string {
  const pct = Math.abs(Math.round((c.bias - 1) * 100));
  const jobsPhrase = c.jobs === 1 ? '1 job' : `${c.jobs} jobs`;
  if (c.direction === 'aligned') {
    return `${c.category} is calibrated — actuals land within 3% of your bids across ${jobsPhrase}.`;
  }
  if (c.direction === 'under') {
    return `You under-estimate ${c.category} by ${pct}% across ${jobsPhrase} — actuals ran above your bids. Suggested correction: ×${c.suggestedMultiplier.toFixed(2)}.`;
  }
  return `You over-estimate ${c.category} by ${pct}% across ${jobsPhrase} — actuals came in below your bids. Suggested correction: ×${c.suggestedMultiplier.toFixed(2)}.`;
}

/**
 * Aggregate per-category estimated-vs-actual bias across every project that
 * has real, traced actuals. Reuses computeEstimateActuals per project for the
 * line-level attribution, then rolls lines up by category across jobs.
 */
export function computeCalibration(input: CalibrationInput): CalibrationReport {
  const { projects, commitments } = input;

  interface Bucket {
    estimated: number;
    actual: number;
    projectIds: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  const contributingProjects = new Set<string>();

  for (const project of projects) {
    const report = computeEstimateActuals(project, commitments);
    if (!report.hasEstimate || !report.hasActuals) continue;

    for (const line of report.lines) {
      // Only lines with real paid actuals AND a real bid prove anything.
      // bid <= 0 also guards the zero-denominator case.
      if (!line.hasActual || line.bid <= 0) continue;

      // Same trade key as estimateActuals' rollup: category first, CSI fallback.
      const category = (line.category || line.csiDivision || 'Other').trim() || 'Other';
      const b = buckets.get(category) || { estimated: 0, actual: 0, projectIds: new Set<string>() };
      b.estimated += line.bid;
      b.actual += line.actual;
      b.projectIds.add(project.id);
      buckets.set(category, b);
      contributingProjects.add(project.id);
    }
  }

  const categories: CategoryCalibration[] = [];
  for (const [category, b] of buckets) {
    if (b.estimated <= 0 || b.actual <= 0) continue; // nothing real to measure
    const bias = b.actual / b.estimated;
    const suggestedMultiplier = round2(Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, bias)));
    const partial: Omit<CategoryCalibration, 'detail'> = {
      category,
      jobs: b.projectIds.size,
      estimatedTotal: b.estimated,
      actualTotal: b.actual,
      bias,
      suggestedMultiplier,
      direction: directionFor(bias),
      confidence: confidenceFor(b.projectIds.size),
    };
    categories.push({ ...partial, detail: detailFor(partial) });
  }

  // Worst calibration first; ties broken by dollars at stake.
  categories.sort(
    (a, b) =>
      Math.abs(b.bias - 1) - Math.abs(a.bias - 1) ||
      b.estimatedTotal - a.estimatedTotal,
  );

  const totalEstimated = categories.reduce((s, c) => s + c.estimatedTotal, 0);
  const totalActual = categories.reduce((s, c) => s + c.actualTotal, 0);
  const weightedBias = totalEstimated > 0 ? totalActual / totalEstimated : 1;

  // Biggest under-estimated category = the one bleeding the most dollars.
  let biggestUnder: CategoryCalibration | null = null;
  for (const c of categories) {
    if (c.direction !== 'under') continue;
    const overrun = c.actualTotal - c.estimatedTotal;
    if (!biggestUnder || overrun > biggestUnder.actualTotal - biggestUnder.estimatedTotal) {
      biggestUnder = c;
    }
  }

  return {
    hasData: categories.length > 0,
    categories,
    summary: {
      weightedBias,
      totalJobs: contributingProjects.size,
      categoryCount: categories.length,
      biggestUnder,
    },
    asOf: new Date().toISOString(),
  };
}
