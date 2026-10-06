// utils/permitPath/packs/base.ts — the pack every job gets, wherever it is.
// PURE DATA. It states NO legal rule: the questions are about the job, the
// items name roles ("ask your architect or engineer"), and everything only a
// building department can answer is a DeptQuestion, which shows as
// "Not known yet · Ask" until the GC saves the department's answer.

import type { DeptQuestion, ItemTemplate, Predicate, Question, QuestionPack } from '../types';

/** County FIPS codes for Long Island: Nassau, Suffolk. */
export const LI_COUNTIES: readonly string[] = Object.freeze(['36059', '36103']);
const NOT_LONG_ISLAND: Predicate = { not: { county: LI_COUNTIES } };

/** Answer values for every yes_no_unsure question. */
export const YES = 'yes';
export const NO = 'no';
export const UNSURE = 'unsure';
export const YES_NO_UNSURE: readonly string[] = Object.freeze([YES, NO, UNSURE]);

export const WORK_TYPE_CHOICES = Object.freeze([
  { id: 'new_building_addition', label: 'New Building or Addition' },
  { id: 'interior_renovation', label: 'Interior Renovation' },
  { id: 'kitchen_bath', label: 'Kitchen or Bath' },
  { id: 'plumbing', label: 'Plumbing' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'hvac', label: 'HVAC or Mechanical' },
  { id: 'structural', label: 'Structural (Walls, Beams)' },
  { id: 'roofing_siding', label: 'Roofing or Siding' },
  { id: 'deck_porch_fence', label: 'Deck, Porch or Fence' },
  { id: 'demolition', label: 'Demolition' },
  { id: 'change_of_use', label: 'Change of use (for example, basement to living space)' },
  { id: 'not_sure', label: 'Not Sure' },
] as const);

export type WorkTypeChoiceId = (typeof WORK_TYPE_CHOICES)[number]['id'];

export const RESIDENTIAL_CHOICES = Object.freeze([
  { id: 'one_two_family', label: '1- or 2-family home' },
  { id: 'apartment', label: 'Apartment Building' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'mixed_use', label: 'Mixed Use' },
] as const);

const questions: readonly Question[] = [
  {
    id: 'base.work_types',
    text: 'What work is in this job?',
    help: 'Pick all that apply.',
    kind: 'multi',
    choices: WORK_TYPE_CHOICES,
    askIf: null,
    prefill: 'scope_trades',
    source: null,
  },
  {
    id: 'base.occupied',
    text: 'Will people live in or use the building during the work?',
    help: null,
    kind: 'yes_no_unsure',
    choices: null,
    askIf: null,
    prefill: null,
    source: null,
  },
  {
    id: 'base.building_year',
    text: 'What year was the building built?',
    help: "Skip it if you don't know.",
    kind: 'year',
    choices: null,
    askIf: null,
    prefill: 'building_year',
    source: null,
  },
  {
    id: 'base.residential',
    text: 'What kind of building is it?',
    help: null,
    kind: 'choice',
    choices: RESIDENTIAL_CHOICES,
    askIf: null,
    prefill: null,
    source: null,
  },
];

const items: readonly ItemTemplate[] = [
  {
    id: 'base.drawings_who',
    station: 'drawings',
    kind: 'who',
    text: 'Ask your architect or engineer whether this scope needs stamped drawings.',
    who: ['design_pro'],
    certainty: 'unknown',
    source: null,
    askQuestionId: 'base.sealed_plans',
    // The DeptQuestion base.sealed_plans is the readiness row; this is the role line.
    readiness: false,
    // Long Island asks li.sealed_plans instead (longIsland.ts), so the two never stack.
    when: NOT_LONG_ISLAND,
  },
  {
    id: 'filing.owner_ok',
    station: 'filing',
    kind: 'document',
    text: "Owner's sign-off to file",
    who: ['owner'],
    certainty: 'your_answer',
    source: null,
    askQuestionId: null,
    readiness: true,
    when: null,
  },
  {
    id: 'signoff.received',
    station: 'signoff',
    kind: 'document',
    text: 'Final sign-off from the building department',
    who: ['department'],
    certainty: 'your_answer',
    source: null,
    askQuestionId: null,
    readiness: true,
    when: null,
  },
];

const deptQuestions: readonly DeptQuestion[] = [
  {
    id: 'base.permit_needed',
    station: 'scope',
    // `<scope>` is the one placeholder: the ask flow fills in the job's scope.
    text: 'The scope is: <scope>. Does this work need a building permit from you?',
    askIf: null,
  },
  { id: 'base.which_permits', station: 'filing', text: 'Which permits does this job need from you?', askIf: null },
  { id: 'base.documents', station: 'filing', text: 'What documents do you need with the application?', askIf: null },
  {
    id: 'base.sealed_plans',
    station: 'drawings',
    text: "Do the drawings for this scope need an architect's or engineer's seal?",
    askIf: NOT_LONG_ISLAND,
  },
  { id: 'base.review_time', station: 'review', text: 'How long is plan review taking right now?', askIf: NOT_LONG_ISLAND },
  { id: 'base.fees', station: 'filing', text: 'Where is your current fee schedule?', askIf: NOT_LONG_ISLAND },
  { id: 'base.inspections', station: 'work', text: 'Which inspections will this job need, and how do I book them?', askIf: null },
  {
    id: 'base.closeout',
    station: 'signoff',
    text: 'What closes the permit at the end: a certificate of occupancy, a certificate of completion, or something else?',
    askIf: null,
  },
  {
    id: 'base.which_department',
    station: 'scope',
    text: 'Is this address handled by the village or the town?',
    askIf: { family: ['unresolved', 'ny_village', 'ny_city'] },
  },
];

export const BASE_PACK: QuestionPack = {
  id: 'base',
  appliesTo: { family: ['nyc', 'ny_town', 'ny_village', 'ny_city', 'elsewhere', 'unresolved'] },
  questions,
  items,
  skips: [],
  deptQuestions,
};
