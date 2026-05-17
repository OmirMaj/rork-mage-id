// utils/scopeQuestions.ts
//
// Single source of truth for the project-scope / estimate-wizard
// question set. Both app/project-scope.tsx (free capture) and
// app/estimate-wizard.tsx (AI generation) import from here so the two
// screens cannot drift. ProjectScope (types/index.ts) mirrors
// WizardAnswers exactly + an updatedAt stamp.

import { z } from 'zod';

export interface WizardAnswers {
  projectType: string;
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
}

export const INITIAL_SCOPE: WizardAnswers = {
  projectType: '',
  sizeSqft: '',
  location: '',
  quality: 'standard',
  scope: '',
  timelineWeeks: '',
  specialRequirements: '',
  targetBudget: '',
};

export const PROJECT_TYPES = [
  'New Build',
  'Full Remodel',
  'Kitchen Remodel',
  'Bathroom Remodel',
  'Addition',
  'Basement Finish',
  'ADU / Backyard Build',
  'Commercial TI',
  'Roof Replacement',
  'Deck / Outdoor',
] as const;

export const QUALITY_LABELS: Record<WizardAnswers['quality'], string> = {
  budget: 'Budget',
  standard: 'Standard',
  high_end: 'High-End',
};

/** Step metadata. iconKey is resolved to a Lucide icon in the stepper
 *  component (keeps this module icon-library-free). kind drives which
 *  input the stepper renders. */
export type ScopeStepKind = 'chips' | 'qualityChips' | 'numeric' | 'text' | 'textarea';
export interface ScopeStep {
  key: keyof WizardAnswers;
  title: string;
  subtitle: string;
  iconKey: 'building' | 'home' | 'sparkles' | 'wrench' | 'dollar';
  kind: ScopeStepKind;
  placeholder?: string;
  /** Only meaningful for kind:'textarea'. Matches the wizard's numberOfLines. */
  lines?: number;
  optional: boolean;
}

export const SCOPE_STEPS: ScopeStep[] = [
  { key: 'projectType', title: 'What kind of project?', subtitle: "Pick the closest match — we'll refine in the next steps.", iconKey: 'building', kind: 'chips', optional: false },
  { key: 'sizeSqft', title: 'How big is the project?', subtitle: 'Approximate square footage of the work area.', iconKey: 'home', kind: 'numeric', placeholder: 'e.g. 1500', optional: false },
  { key: 'location', title: "Where's the job?", subtitle: 'City and state — we use this for regional pricing.', iconKey: 'building', kind: 'text', placeholder: 'e.g. Austin, TX', optional: false },
  { key: 'quality', title: 'What quality tier?', subtitle: 'Drives material selection and labor assumptions.', iconKey: 'sparkles', kind: 'qualityChips', optional: false },
  { key: 'scope', title: "What's the scope?", subtitle: "A few sentences on what you're actually building.", iconKey: 'wrench', kind: 'textarea', placeholder: 'e.g. Gut kitchen, new cabinets and quartz counters, move the sink wall, add island with seating, replace floors.', lines: 5, optional: false },
  { key: 'timelineWeeks', title: "What's the timeline?", subtitle: 'Expected duration in weeks.', iconKey: 'building', kind: 'numeric', placeholder: 'e.g. 8', optional: false },
  { key: 'specialRequirements', title: 'Any special requirements?', subtitle: 'Permits, HOA, historic, accessibility, etc. Optional.', iconKey: 'sparkles', kind: 'textarea', placeholder: 'e.g. Historic district review, ADA bathroom.', lines: 4, optional: true },
  { key: 'targetBudget', title: 'Target budget?', subtitle: 'Optional — helps the AI sanity-check the estimate.', iconKey: 'dollar', kind: 'numeric', placeholder: 'e.g. 75000', optional: true },
];

export const TOTAL_SCOPE_STEPS = SCOPE_STEPS.length;

/** Per-step "can advance" validation. Mirrors the wizard's original
 *  canAdvance switch exactly (steps 0-7). Optional steps always pass. */
export function stepCanAdvance(stepIndex: number, a: WizardAnswers): boolean {
  switch (stepIndex) {
    case 0: return a.projectType.length > 0;
    case 1: return a.sizeSqft.trim().length > 0 && !isNaN(Number(a.sizeSqft));
    case 2: return a.location.trim().length > 0;
    case 3: return true;
    case 4: return a.scope.trim().length > 10;
    case 5: return a.timelineWeeks.trim().length > 0 && !isNaN(Number(a.timelineWeeks));
    case 6: return true;
    case 7: return true;
    default: return false;
  }
}

export const estimateSchema = z.object({
  summary: z.string().catch('').default(''),
  lineItems: z.array(z.object({
    category: z.string().catch('Other').default('Other'),
    description: z.string().catch('').default(''),
    quantity: z.number().catch(1).default(1),
    unit: z.string().catch('ea').default('ea'),
    unitCost: z.number().catch(0).default(0),
    total: z.number().catch(0).default(0),
  })).default([]),
  subtotal: z.number().catch(0).default(0),
  contingency: z.number().catch(0).default(0),
  permits: z.number().catch(0).default(0),
  total: z.number().catch(0).default(0),
  notes: z.array(z.string()).default([]),
  // NEW: the specific missing inputs that would most sharpen this
  // estimate. Empty when scope was complete. Back-compatible default.
  refineWith: z.array(z.string()).default([]),
});
export type EstimateResult = z.infer<typeof estimateSchema>;

export function buildEstimatePrompt(a: WizardAnswers): string {
  return `You are a construction cost estimator producing a quick first-pass budget for a US contractor. Use the inputs and return a JSON object with an itemized line-by-line estimate.

Inputs:
- Project type: ${a.projectType || '(not provided)'}
- Size: ${a.sizeSqft || '(not provided)'} sqft
- Location: ${a.location || '(not provided)'}
- Quality tier: ${QUALITY_LABELS[a.quality]}
- Scope: ${a.scope || '(not provided)'}
- Timeline: ${a.timelineWeeks || '(not provided)'} weeks
- Special requirements: ${a.specialRequirements || 'None'}
- Target budget: ${a.targetBudget || 'Not specified'}

ALWAYS return a usable ROUGH estimate even if some inputs are missing —
make clearly-labeled assumptions for anything not provided; never refuse.

Return JSON with:
- summary: one paragraph plain-English overview
- lineItems: array of { category, description, quantity, unit, unitCost, total } (total = quantity * unitCost)
- subtotal: sum of all lineItems totals
- contingency: ~10% of subtotal
- permits: rough permit/fees estimate for the location
- total: subtotal + contingency + permits
- notes: array of caveats (e.g. "assumes standard finishes")
- refineWith: array of SHORT strings naming the specific missing inputs
  that would most improve accuracy (e.g. "exact square footage",
  "finish level for the primary bath"). Empty array if inputs were
  sufficient. Max 5 items.

Use current regional pricing where possible. Round reasonably. Keep it under 15 line items.`;
}

export function scopeCacheKey(a: WizardAnswers): string {
  return `wizard::${a.projectType}::${a.sizeSqft}::${a.location}::${a.quality}::${a.scope.slice(0, 80)}`;
}
