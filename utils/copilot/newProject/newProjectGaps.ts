// utils/copilot/newProject/newProjectGaps.ts — New Project interview gap rules.
//
// The utterance names + describes the job; the interview fills only the two
// setup fields that meaningfully change the project and that history can't
// always infer — the project TYPE and the FINISH quality. Both are grounded in
// what this contractor usually builds (the modal type/quality across their past
// jobs), so the default is theirs, not a generic guess. Square footage and
// location default silently (the estimate flow nails those later). Pure — no
// mageAI/RN/@/types-runtime imports, so a validator can drive it directly.
import type { Gap, Grounding } from '../types';

export interface NewProjectDraft {
  name?: string | null;
  /** ProjectType — kept loose (string) to stay pure here. */
  type?: string | null;
  location?: string | null;
  squareFootage?: number | null;
  /** QualityTier — kept loose (string) to stay pure here. */
  quality?: string | null;
  description?: string | null;
}

const TYPE_CHOICES: { label: string; value: string }[] = [
  { label: 'Renovation', value: 'renovation' },
  { label: 'Remodel', value: 'remodel' },
  { label: 'New build', value: 'new_build' },
  { label: 'Addition', value: 'addition' },
  { label: 'Commercial', value: 'commercial' },
  { label: 'Roofing', value: 'roofing' },
];

const QUALITY_CHOICES: { label: string; value: string; basis: string }[] = [
  { label: 'Economy', value: 'economy', basis: 'budget-conscious finishes' },
  { label: 'Standard', value: 'standard', basis: 'typical mid-market' },
  { label: 'Premium', value: 'premium', basis: 'high-end finishes' },
  { label: 'Luxury', value: 'luxury', basis: 'top-tier custom' },
];

interface NewProjectGroundData { usualType?: string | null; usualQuality?: string | null }

export function newProjectGaps(draft: NewProjectDraft, grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];
  const g = (grounding.data ?? {}) as NewProjectGroundData;

  if (draft.type == null) {
    const def = g.usualType ?? 'renovation';
    gaps.push({
      field: 'type', impact: 0.55, kind: 'choice',
      question: 'What kind of project is it?',
      groundedDefault: {
        value: def,
        basis: g.usualType ? 'what you build most' : 'your most common job type',
      },
      choices: TYPE_CHOICES.map((c) => ({ ...c, recommended: c.value === def })),
    });
  }

  if (draft.quality == null) {
    const def = g.usualQuality ?? 'standard';
    gaps.push({
      field: 'quality', impact: 0.45, kind: 'choice',
      question: 'What finish level are we pricing to?',
      groundedDefault: {
        value: def,
        basis: g.usualQuality ? 'your usual finish level' : 'typical mid-market',
      },
      choices: QUALITY_CHOICES.map((c) => ({ ...c, recommended: c.value === def })),
    });
  }

  return gaps;
}
