// utils/copilot/estimate/estimateGaps.ts — estimate interview gap rules.
//
// The spoken scope (the transcript) drives generation; the DRAFT holds the
// pricing parameters that refine it. A gap is emitted ONLY when neither the
// draft nor the project's own metadata can resolve the parameter — so a
// fully-scoped project generates with zero questions, and a bare new project
// gets asked the two things pricing genuinely needs (finish level + size).
import type { Gap, Grounding } from '../types';
import type { QualityTier } from '@/types';

export interface EstimateDraft {
  /** The spoken scope — the transcript. Drives generation; never asked as a gap. */
  scope?: string | null;
  quality?: QualityTier | null;
  sizeSqft?: number | null;
  markupPct?: number | null;
}

/** Shape of the estimate grounding's `data` block (see estimateGrounding.ts). */
export interface EstimateGroundData {
  projectQuality?: QualityTier;
  projectSqft?: number;
  defaultMarkupPct?: number;
  costBookEntries?: number;
}

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

  // 3. Markup — defaulted silently (below the ask threshold) so it is shown, not
  //    asked. Contractors tune per-line markup on the grid; forcing a question
  //    here would add friction for the one field they almost never change.
  if (draft.markupPct == null && d.defaultMarkupPct == null) {
    gaps.push({
      field: 'markupPct', impact: 0.3, kind: 'number',
      question: 'What markup do you want on this?',
      groundedDefault: { value: 18, basis: 'no default markup set — using 18%' },
    });
  }

  return gaps;
}
