// utils/copilot/estimate/estimateGaps.ts — estimate interview gap rules.
//
// The spoken scope (the transcript) drives generation; the DRAFT holds the
// pricing parameters that refine it. A gap is emitted ONLY when neither the
// draft nor the project's own metadata can resolve the parameter — so a
// fully-scoped project generates with zero questions, and a bare new project
// gets asked the two things pricing genuinely needs (finish level + size).
import type { Gap, Grounding } from '../types';
import type { QualityTier } from '@/types';
import { MARKUP_CHOICES } from '@/utils/estimateMarkup';

export interface EstimateDraft {
  /** The spoken scope — the transcript. Drives generation; never asked as a gap. */
  scope?: string | null;
  quality?: QualityTier | null;
  sizeSqft?: number | null;
  markupPct?: number | null;
  /** Set by the review step's pricing call (estimatePrice.ts) through
   *  PATCH_DRAFT; Build commits exactly this — never a second model call. */
  priced?: import('./estimatePricing').PricedEstimate | null;
}

/** Shape of the estimate grounding's `data` block (see estimateGrounding.ts). */
export interface EstimateGroundData {
  projectQuality?: QualityTier;
  projectSqft?: number;
  defaultMarkupPct?: number;
  /** The markup he decided in the estimator / wizard (MaterialCartContext). */
  decidedMarkupPct?: number;
  costBookEntries?: number;
}

/** Ask threshold of the estimate capability — the markup gap sits above it. */
export const ESTIMATE_ASK_THRESHOLD = 0.4;

const QUALITY_CHOICES = [
  { label: 'Economy', value: 'economy' as QualityTier, basis: 'budget-grade finishes' },
  { label: 'Standard', value: 'standard' as QualityTier, basis: 'mid-grade, most jobs', recommended: true },
  { label: 'Premium', value: 'premium' as QualityTier, basis: 'high-end finishes' },
  { label: 'Luxury', value: 'luxury' as QualityTier, basis: 'top-tier throughout' },
];

export function estimateGaps(draft: EstimateDraft, grounding: Grounding): Gap[] {
  const d = grounding.data as EstimateGroundData;
  const gaps: Gap[] = [];

  // 1. Finish level — drives every unit price. Ask only if neither the draft nor
  //    the project already sets it.
  if (draft.quality == null && d.projectQuality == null) {
    gaps.push({
      field: 'quality', impact: 0.6, kind: 'choice',
      question: 'What finish level should I price this at?',
      groundedDefault: { value: 'standard', basis: 'no quality set on the project — assuming standard' },
      choices: QUALITY_CHOICES,
    });
  }

  // 2. Size — needed to price area-based work. Ask only when nothing supplies it.
  if (draft.sizeSqft == null && d.projectSqft == null) {
    gaps.push({
      field: 'sizeSqft', impact: 0.5, kind: 'number',
      question: 'About how many square feet is the work area?',
      groundedDefault: { value: 200, basis: 'no size on file — rough it in, refine on the grid' },
      placeholder: 'e.g. 250',
    });
  }

  // 3. Markup — his decision, never ours (#7). Resolved from what he said,
  //    then this job's current estimate, then the markup he decided in the
  //    estimator. When none exists it is ASKED (impact above the ask
  //    threshold, the same MARKUP_CHOICES ladder the wizard offers) — it used
  //    to default silently to a hard-coded 18% filed under "SET FROM YOUR
  //    HISTORY". Skipped, the review card asks again and blocks Build.
  if (draft.markupPct == null && d.defaultMarkupPct == null && d.decidedMarkupPct == null) {
    gaps.push({
      field: 'markupPct', impact: 0.45, kind: 'choice',
      question: 'What markup do you want on this?',
      groundedDefault: { value: null, basis: 'No markup on file — MAGE won’t guess what you charge.', source: 'assumed' },
      choices: MARKUP_CHOICES.map((n) => ({ label: `${n}%`, value: n })),
    });
  }

  return gaps;
}
