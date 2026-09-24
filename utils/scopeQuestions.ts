// utils/scopeQuestions.ts
//
// Single source of truth for the project-scope / estimate-wizard
// question set. Both app/project-scope.tsx (free capture) and
// app/estimate-wizard.tsx (AI generation) import from here so the two
// screens cannot drift. ProjectScope (types/index.ts) mirrors
// WizardAnswers exactly + an updatedAt stamp.

import { z } from 'zod';
import type { ProjectType } from '@/types';
import { PROJECT_TYPES as APP_PROJECT_TYPES } from '@/types';
import { cleanProjectTypeOther, PROJECT_TYPE_OTHER_MAX } from '@/utils/projectTypes';

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
  // Q6: the founder's repipe had no box, so he picked "Bathroom Remodel" and
  // the AI was told so. Both map onto ids the app already has.
  'Plumbing / Repipe',
  'Electrical / Rewire',
] as const;

/** One of the chip answers above. Anything else in WizardAnswers.projectType
 *  is an "Other (describe it)" answer — the contractor's own words. */
export type ScopeTypeChip = typeof PROJECT_TYPES[number];

/** The Other box's cap — the same as the projects.project_type_other CHECK,
 *  because a new project's description is this answer. */
export const SCOPE_TYPE_OTHER_MAX = PROJECT_TYPE_OTHER_MAX;

export function isScopeTypeChip(answer: string): answer is ScopeTypeChip {
  return (PROJECT_TYPES as readonly string[]).includes(answer);
}

/** Each chip → the app's ProjectType. Exhaustive: a chip added above without
 *  a row here is a type error. Matches what the wizard's old substring
 *  mapProjectType produced for every original chip. */
const SCOPE_CHIP_TYPE: Readonly<Record<ScopeTypeChip, ProjectType>> = {
  'New Build': 'new_build',
  'Full Remodel': 'remodel',
  'Kitchen Remodel': 'remodel',
  'Bathroom Remodel': 'remodel',
  'Addition': 'addition',
  'Basement Finish': 'renovation',
  'ADU / Backyard Build': 'new_build',
  'Commercial TI': 'commercial',
  'Roof Replacement': 'roofing',
  'Deck / Outdoor': 'landscape',
  'Plumbing / Repipe': 'plumbing',
  'Electrical / Rewire': 'electrical',
};

/** Free-text keywords → type, in order: the whole-job kinds first (a
 *  "bathroom remodel with new plumbing" is a remodel), then the trades. The
 *  trade rows are what let "Whole-house repipe", "PEX repipe", "copper
 *  repipe", "rewire" and "panel upgrade" land on plumbing / electrical. */
const SCOPE_TEXT_RULES: ReadonlyArray<readonly [RegExp, ProjectType]> = [
  [/\bnew (build|construction|home|house)\b|\bground[- ]?up\b|\badu\b/i, 'new_build'],
  [/\baddition\b/i, 'addition'],
  [/\bcommercial\b|\bti\b|tenant improvement/i, 'commercial'],
  [/\bremodel/i, 'remodel'],
  [/\brenovat|\bbasement\b/i, 'renovation'],
  [/\b(re-?)?roof/i, 'roofing'],
  [/\bdeck|\boutdoor|landscap/i, 'landscape'],
  [/plumb|\bre-?pip|\bpex\b|\bcopper\b|\bpiping\b|\bwater (line|heater)|\bsewer\b|\bdrain line/i, 'plumbing'],
  [/electric|\bre-?wir|\bwiring\b|\bpanel (upgrade|swap|replace)|\bservice upgrade/i, 'electrical'],
  [/\bflooring\b|\bhardwood\b|\blvp\b|\bcarpet/i, 'flooring'],
  [/\bpaint/i, 'painting'],
  [/\bconcrete\b|\bflatwork\b|\bdriveway\b|\bfoundation\b/i, 'concrete'],
];

/**
 * The wizard's project-type answer → the Project's type (and, for Other, his
 * words). Replaces app/estimate-wizard.tsx's local mapProjectType, which could
 * only produce seven types and turned everything else into 'renovation'.
 *   a chip → its type
 *   an app type's own label or id ("Flooring", "plumbing", "new build") → that type
 *   free text naming a kind of job or trade ("Whole-house repipe") → that type
 *   anything else ("HVAC changeout", "Windows & doors") → 'other' + his words
 *   blank → 'renovation' (the app's generic default, as before)
 */
export function projectTypeFromScopeAnswer(answer: string): { type: ProjectType; projectTypeOther?: string } {
  const text = cleanProjectTypeOther(answer);
  if (!text) return { type: 'renovation' };
  if (isScopeTypeChip(text)) return { type: SCOPE_CHIP_TYPE[text] };
  const norm = text.toLowerCase().replace(/[_\s]+/g, ' ');
  const named = APP_PROJECT_TYPES.find(t => t.id !== 'other' && (t.label.toLowerCase() === norm || t.id.replace(/_/g, ' ') === norm));
  if (named) return { type: named.id };
  for (const [re, type] of SCOPE_TEXT_RULES) if (re.test(text)) return { type };
  return { type: 'other', projectTypeOther: text };
}

/** Words a model returns where a type goes and that say nothing about the job. */
const NO_TYPE_WORDS = new Set(['other', 'null', 'none', 'n/a', 'na', 'undefined', 'unknown', 'general', 'project']);

/**
 * A project type from a VOICE / copilot parse, which may be an id
 * ("plumbing"), a label ("New Build") or the kind of job in his own words
 * ("HVAC changeout", "whole-house repipe"). Same mapping as the wizard
 * (projectTypeFromScopeAnswer), so a repipe lands on plumbing and an HVAC
 * changeout on 'other' with his words — never silently on 'renovation'.
 * Returns null when the value names no job at all (blank, not a string, or a
 * bare "other" / "none" / "unknown"): the caller asks, or keeps its default.
 */
export function projectTypeFromParsedType(v: unknown): { type: ProjectType; projectTypeOther?: string } | null {
  const text = cleanProjectTypeOther(v);
  if (!text || NO_TYPE_WORDS.has(text.toLowerCase())) return null;
  return projectTypeFromScopeAnswer(text);
}

/** A job's type → the answer the "What kind of project?" step opens on, so
 *  the scope screen and the wizard never re-ask what the job already says.
 *  Types with a chip open on the chip; flooring / painting / concrete open
 *  on Other with the type's own name (a chip list is not the whole
 *  taxonomy); an Other job opens on Other with his words. 'renovation' — the
 *  New Project form's default, which says nothing about the job — and any
 *  unknown id open blank, as the wizard always did. Round-trips through
 *  projectTypeFromScopeAnswer for every type but 'renovation'. */
export function scopeAnswerForProject(p: { type?: string | null; projectTypeOther?: string | null } | null | undefined): string {
  switch (p?.type) {
    case 'new_build': return 'New Build';
    case 'remodel': return 'Full Remodel';
    case 'addition': return 'Addition';
    case 'commercial': return 'Commercial TI';
    case 'roofing': return 'Roof Replacement';
    case 'landscape': return 'Deck / Outdoor';
    case 'plumbing': return 'Plumbing / Repipe';
    case 'electrical': return 'Electrical / Rewire';
    case 'flooring': return 'Flooring';
    case 'painting': return 'Painting';
    case 'concrete': return 'Concrete';
    case 'other': return cleanProjectTypeOther(p.projectTypeOther);
    default: return '';
  }
}

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
  { key: 'timelineWeeks', title: "What's the timeline?", subtitle: 'Expected duration in weeks — optional, skip if unsure.', iconKey: 'building', kind: 'numeric', placeholder: 'e.g. 8', optional: true },
  { key: 'specialRequirements', title: 'Any special requirements?', subtitle: 'Permits, HOA, historic, accessibility, etc. Optional.', iconKey: 'sparkles', kind: 'textarea', placeholder: 'e.g. Historic district review, ADA bathroom.', lines: 4, optional: true },
  { key: 'targetBudget', title: 'Target budget?', subtitle: 'Optional — helps the AI sanity-check the estimate.', iconKey: 'dollar', kind: 'numeric', placeholder: 'e.g. 75000', optional: true },
];

export const TOTAL_SCOPE_STEPS = SCOPE_STEPS.length;

/** Per-step "can advance" validation. Mirrors the wizard's original
 *  canAdvance switch exactly (steps 0-7). Optional steps always pass. */
/** First number in a free-text field — tolerant of commas, units, and ranges.
 *  "2,500" → 2500 · "1500 sqft" → 1500 · "6-8 weeks" → 6 · "abc" → null.
 *  The wizard's old strict Number() parse dead-ended the Next button on any
 *  of those perfectly reasonable inputs, with zero feedback. */
export function firstNumber(s: string): number | null {
  const m = (s || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function stepCanAdvance(stepIndex: number, a: WizardAnswers): boolean {
  switch (stepIndex) {
    case 0: return a.projectType.trim().length > 0;
    case 1: return firstNumber(a.sizeSqft) !== null;
    case 2: return a.location.trim().length > 0;
    case 3: return true;
    case 4: return a.scope.trim().length >= 4;
    case 5: return true; // timeline is optional — never block Next on it
    case 6: return true;
    case 7: return true;
    default: return false;
  }
}

/** Why the current step can't advance — shown when the user taps a blocked
 *  Next, so the wizard never silently dead-ends. Null when advance is fine. */
export function stepBlockReason(stepIndex: number, a: WizardAnswers): string | null {
  if (stepCanAdvance(stepIndex, a)) return null;
  switch (stepIndex) {
    case 0: return 'Pick a project type to continue, or tap Other and describe the job.';
    case 1: return 'Enter the size with a number — e.g. 2500 or 2,500 sqft.';
    case 2: return 'Enter a location — city and state is plenty.';
    case 4: return 'Describe the scope in a few words — a short sentence is plenty.';
    case 5: return 'Enter the timeline with a number of weeks — e.g. 6 or 6-8.';
    default: return 'Fill in this step to continue.';
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
  // 0-100 — how tight this estimate is given the inputs. The model lowers it
  // when the biggest cost drivers are unknown; rises as refine answers land.
  //
  // NO DEFAULT, deliberately. This used to be `.catch(70).default(70)`, so a
  // model that returned nothing rendered "70% confident" plus a filled meter
  // in BrainCard — visually identical to an earned score. `undefined` now
  // flows through to BrainCard, which omits the pill and the meter entirely
  // when confidence is absent, and the wizard says so in the grounding line.
  confidence: z.number().min(0).max(100).optional().catch(undefined),
  // The specific high-leverage QUESTIONS that would most sharpen this estimate
  // (demo/existing conditions, MEP scope, structural changes, counts). Empty
  // when scope was already detailed. Back-compatible default.
  refineWith: z.array(z.string()).default([]),
});
export type EstimateResult = z.infer<typeof estimateSchema>;

export interface EstimatePromptOptions {
  /** The GC's own contingency percentage (Settings). The wizard applies it to
   *  the subtotal itself; the prompt carries it so the model's own figure and
   *  any note it writes about contingency agree with what the GC will see. */
  contingencyRate?: number;
}

export function buildEstimatePrompt(a: WizardAnswers, groundingFacts?: string[], opts: EstimatePromptOptions = {}): string {
  const rate = opts.contingencyRate;
  const contingencyLine = typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 50
    ? `${rate}% of subtotal (this contractor's own contingency rate)`
    : '~10% of subtotal';
  const grounding = groundingFacts && groundingFacts.length > 0
    ? `\n\nTHIS CONTRACTOR'S OWN COST HISTORY (price with these rates wherever the trade matches — they beat any regional average):\n${groundingFacts.map((f) => `- ${f}`).join('\n')}\n`
    : '';
  return `You are a construction cost estimator producing a quick first-pass budget for a US contractor. Use the inputs and return a JSON object with an itemized line-by-line estimate.${grounding}

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
- contingency: ${contingencyLine}
- permits: rough permit/fees estimate for the location
- total: subtotal + contingency + permits
- notes: array of caveats (e.g. "assumes standard finishes")
- confidence: integer 0-100 — how tight this estimate is GIVEN THE INPUTS.
  Start high only when the real cost drivers are clear. Lower it (e.g. 55-70)
  when the biggest drivers are unknown: existing conditions / demolition
  (gut-to-studs vs cosmetic), MEP scope (new vs reuse electrical / plumbing /
  HVAC), structural changes (moving or removing walls), and room counts
  (# of bathrooms / kitchens for remodels).
- refineWith: 2-4 SHORT, specific QUESTIONS whose answers would most tighten
  THIS number — draw from the biggest cost drivers that are still unclear
  above. Phrase as plain questions a contractor answers in a few words
  (e.g. "Gut to the studs or cosmetic refresh?", "New electrical panel or
  reuse the existing?", "Moving any walls?", "How many bathrooms?"). Order by
  cost impact, biggest first. Empty array ONLY if the scope was already
  detailed enough that none of these would move the number.

Use current regional pricing where possible. Round reasonably. Keep it under 15 line items.`;
}

export function scopeCacheKey(a: WizardAnswers): string {
  return `wizard::${a.projectType}::${a.sizeSqft}::${a.location}::${a.quality}::${a.scope.slice(0, 80)}`;
}

// ── The pricing market is not the jobsite (audit 2026-09-18, #157) ─────────
//
// Step 3 asks "City and state — we use this for regional pricing", and on a
// standalone run it is pre-filled with his default market from Settings. The
// Save-estimate path then wrote that answer as Project.location — the string
// proposals, invoices, POs, permits and the weather geocoder all read as the
// jobsite — so the first project he ever made printed "Location: Houston, TX"
// and geocoded to the city centroid. Home's create modal refuses exactly that
// stamp (app/(tabs)/(home)/index.tsx usualArea). The pricing answer stays in
// project.scope.location, where pricing reads it; these two decide what, if
// anything, may become the address.

const norm = (s: string | null | undefined): string => (s ?? '').trim();
const sameText = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The pricing answer, when it is something he TYPED for this job — not his
 *  default market carried through unchanged, and not the 'United States'
 *  placeholder. Null otherwise. Also what the save sheet offers as a one-tap
 *  fill for the jobsite field. */
export function typedPricingLocation(pricingAnswer: string, homeMarket: string): string | null {
  const a = norm(pricingAnswer);
  if (!a || sameText(a, 'United States')) return null;
  const m = norm(homeMarket);
  if (m && sameText(a, m)) return null;
  return a;
}

/** Project.location for a project created from the wizard: the jobsite
 *  address he entered; failing that, a location he typed for this job at step
 *  3; failing that, '' — never his default market and never 'United States'.
 *  An empty string is honest: it is under the geocoder's threshold, so the
 *  job falls to the marked simulated-weather path instead of inventing a site. */
export function jobsiteLocationFor(opts: { jobsite: string; pricingAnswer: string; homeMarket: string }): string {
  const typed = norm(opts.jobsite);
  if (typed && !sameText(typed, 'United States')) return typed;
  return typedPricingLocation(opts.pricingAnswer, opts.homeMarket) ?? '';
}
