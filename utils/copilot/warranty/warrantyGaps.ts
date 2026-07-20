// utils/copilot/warranty/warrantyGaps.ts — Warranty interview gap rules.
//
// The utterance is WHAT'S covered; the interview fills in the three things a
// warranty record is worthless without — who backs it, what kind, and how long
// (the term is the whole point: it's what lets MAGE compute expiry + remind you
// before coverage lapses). Each gap is asked only when the contractor didn't
// already say it, and the term default is grounded in the category (a roof is
// 25 years; an appliance is 1). Pure — no mageAI/RN imports, so a validator can
// exercise it directly.
import type { Gap, Grounding } from '../types';
import type { WarrantyCategory } from '@/types';

export interface WarrantyDraft {
  title?: string | null;
  category?: WarrantyCategory | null;
  provider?: string | null;
  durationMonths?: number | null;
  startDate?: string | null;
  coverageDetails?: string | null;
}

/** Typical term for a category, in months. Drives the grounded default so the
 *  contractor confirms a sane number instead of guessing. */
export function defaultDurationForCategory(category: WarrantyCategory | null | undefined): number {
  switch (category) {
    case 'roofing': return 300;      // 25 yr — manufacturer membrane/shingle
    case 'foundation': return 120;   // 10 yr — structural/foundation
    case 'structural': return 120;   // 10 yr
    case 'windows': return 120;      // 10 yr — glazing/seal
    case 'hvac': return 60;          // 5 yr — equipment
    case 'plumbing': return 24;      // 2 yr — workmanship
    case 'electrical': return 24;    // 2 yr — workmanship
    case 'appliances': return 12;    // 1 yr
    case 'finishes': return 12;      // 1 yr
    default: return 12;              // general / other — 1 yr workmanship
  }
}

const CATEGORY_CHOICES: { label: string; value: WarrantyCategory }[] = [
  { label: 'Roofing', value: 'roofing' },
  { label: 'HVAC', value: 'hvac' },
  { label: 'Plumbing', value: 'plumbing' },
  { label: 'Electrical', value: 'electrical' },
  { label: 'Windows', value: 'windows' },
  { label: 'Appliances', value: 'appliances' },
  { label: 'Structural', value: 'structural' },
  { label: 'Finishes', value: 'finishes' },
  { label: 'General workmanship', value: 'general' },
];

const MONTHS_IN_YEAR = 12;

function durationChoices(category: WarrantyCategory | null | undefined): Gap['choices'] {
  const rec = defaultDurationForCategory(category);
  const terms = [12, 24, 60, 120, 300];
  // Make sure the category's grounded default is offered even if it's off-ladder.
  if (!terms.includes(rec)) terms.push(rec);
  return terms
    .sort((a, b) => a - b)
    .map((m) => {
      const yrs = m / MONTHS_IN_YEAR;
      return {
        label: yrs === 1 ? '1 year' : `${yrs} years`,
        value: m,
        recommended: m === rec,
      };
    });
}

export function warrantyGaps(draft: WarrantyDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];
  const catDefault = defaultDurationForCategory(draft.category);

  if (draft.durationMonths == null) {
    gaps.push({
      field: 'durationMonths', impact: 0.62, kind: 'choice',
      question: 'How long is it covered?',
      groundedDefault: {
        value: catDefault,
        basis: `typical ${draft.category ?? 'workmanship'} term`,
      },
      choices: durationChoices(draft.category),
    });
  }

  if (draft.provider == null) {
    gaps.push({
      field: 'provider', impact: 0.55, kind: 'text',
      question: 'Who backs it — the manufacturer or the sub who installed it?',
      groundedDefault: { value: '', basis: 'note who to call on a claim' },
      placeholder: 'e.g. GAF, or the installer',
    });
  }

  if (draft.category == null) {
    gaps.push({
      field: 'category', impact: 0.5, kind: 'choice',
      question: 'What does it cover?',
      groundedDefault: { value: 'general', basis: 'general workmanship' },
      choices: CATEGORY_CHOICES,
    });
  }

  return gaps;
}
