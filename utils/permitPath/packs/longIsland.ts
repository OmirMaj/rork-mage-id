// utils/permitPath/packs/longIsland.ts — Nassau (36059) and Suffolk (36103)
// towns, villages and cities. PURE DATA.
//
// WHY THESE ARE QUESTION PACKS, NOT RULE PACKS
//   The one town page read for this (Town of Hempstead, V13) states no
//   application document list: no survey, no plot plan, no sealed-plan rule,
//   nothing about villages. So every town or village requirement below is a
//   DeptQuestion, shown as "Not known yet · Ask" until the GC saves what the
//   department said. Each town wants different things; the saved answers are
//   how the app learns them, per jurisdiction key.
//
//   The ONLY verified Long Island lines are the two county home improvement
//   licenses (V11, V12) and Suffolk's license check (V12).
//   scripts/validate-permit-path-facts.ts holds that list as a ratchet:
//   another verified Long Island item needs a V-source AND an edit there.
//
//   The office itself (title, phone, hours, its own source) comes from
//   permitOfficeFor at runtime, through the li.office slot.

import { VILLAGE_CAUTION } from '@/utils/permitOffices';
import type { DeptQuestion, ItemTemplate, Predicate, QuestionPack } from '../types';
import { LI_COUNTIES, NO, UNSURE, YES } from './base';
import { SOURCE_REFS } from './sources';

const LI_FAMILIES = ['ny_town', 'ny_village', 'ny_city'] as const;

/** Never true on its own: a department question with this askIf is opened
 *  only by the pack item that names it as its askQuestionId. */
const ONLY_FROM_ITEM: Predicate = { any: [] };

const liDeptQuestions: readonly DeptQuestion[] = [
  {
    id: 'li.survey',
    station: 'filing',
    text: 'Do you need a survey with the application? How recent, and does it have to show the proposed work?',
    askIf: null,
  },
  {
    id: 'li.co_search',
    station: 'checks',
    text: 'Do I need a certificate of occupancy or completion search before filing, and how do I request one?',
    askIf: null,
  },
  {
    id: 'li.open_permits',
    station: 'checks',
    text: 'There may be open or expired permits on this property. Do they need to be closed before we file?',
    askIf: { q: 'li.prior_open_permits', is: [YES, UNSURE] },
  },
  {
    id: 'li.sealed_plans',
    station: 'drawings',
    text: "For this scope, do the drawings need an architect's or engineer's seal?",
    askIf: null,
  },
  {
    id: 'li.zoning_variance',
    station: 'checks',
    text: 'Does this scope need a zoning review or a variance (setbacks, height, lot coverage)?',
    askIf: null,
  },
  {
    id: 'li.license_on_application',
    station: 'filing',
    text: 'Do you need my county home improvement license number on the application?',
    askIf: null,
  },
  {
    id: 'li.trades_license',
    station: 'drawings',
    text: 'Do the plumber and electrician need to be licensed with you, the county, or both?',
    askIf: null,
  },
  {
    id: 'li.inspection_booking',
    station: 'work',
    text: 'How do I book inspections, and how much notice do you need?',
    askIf: null,
  },
  { id: 'li.review_time', station: 'review', text: 'How long is plan review taking for a job like this right now?', askIf: null },
  { id: 'li.fees', station: 'filing', text: 'Where is your current fee schedule, and how do I pay it?', askIf: null },
  {
    // Opened by li.office when the office card is not hand-verified (state
    // list or name only): what is missing then is how to reach the office,
    // whatever the family. A town job never gets "village or town?" for it.
    id: 'li.office_contact',
    station: 'scope',
    text: 'What is the best phone number and hours for building permit questions?',
    askIf: ONLY_FROM_ITEM,
  },
];

export const LI_COMMON_PACK: QuestionPack = {
  id: 'li_common',
  appliesTo: { all: [{ family: LI_FAMILIES }, { county: LI_COUNTIES }] },
  questions: [
    {
      id: 'li.survey_on_hand',
      text: 'Do you have a recent survey of the property?',
      help: null,
      kind: 'yes_no_unsure',
      choices: null,
      askIf: null,
      prefill: null,
      source: null,
    },
    {
      id: 'li.prior_co',
      text: 'Does the house have a certificate of occupancy or completion on file for its current layout?',
      help: null,
      kind: 'yes_no_unsure',
      choices: null,
      askIf: null,
      prefill: null,
      source: null,
    },
    {
      id: 'li.prior_open_permits',
      text: 'Any open or expired permits on the property that you know of?',
      help: null,
      kind: 'yes_no_unsure',
      choices: null,
      askIf: null,
      prefill: null,
      source: null,
    },
  ],
  items: [
    {
      // Slot: the engine replaces the text with the PermitOffice title, phone
      // and hours, and raises it to verified only for a hand-verified office,
      // citing that office's own page (SLOT_ITEM_IDS in index.ts).
      id: 'li.office',
      station: 'scope',
      kind: 'fact',
      text: '{title} · {phone} · {hours}',
      who: ['department'],
      certainty: 'unknown',
      source: null,
      askQuestionId: 'li.office_contact',
      readiness: false,
      when: null,
    },
    {
      // The GC's own answers, pointing at the department question that settles
      // them. No rule is stated: what the town wants is li.survey / li.co_search.
      id: 'li.survey_note',
      station: 'filing',
      kind: 'fact',
      text: 'No recent survey on hand yet. Ask the department whether the application needs one before you order it.',
      who: ['gc', 'owner'],
      certainty: 'your_answer',
      source: null,
      askQuestionId: null,
      readiness: false,
      when: { q: 'li.survey_on_hand', is: [NO, UNSURE] },
    },
    {
      id: 'li.prior_co_note',
      station: 'checks',
      kind: 'fact',
      text: 'The current layout may have no certificate of occupancy or completion on file. Ask the department how to search for one before filing.',
      who: ['gc', 'owner'],
      certainty: 'your_answer',
      source: null,
      askQuestionId: null,
      readiness: false,
      when: { q: 'li.prior_co', is: [NO, UNSURE] },
    },
  ],
  skips: [],
  deptQuestions: liDeptQuestions,
};

const nassauItems: readonly ItemTemplate[] = [
  {
    id: 'li.nassau_hic',
    station: 'scope',
    kind: 'need',
    text: 'Nassau County requires a home improvement license to remodel residential homes. Plumbers and electricians licensed in their trade, and working only in it, are exempt.',
    who: ['gc'],
    certainty: 'verified',
    source: SOURCE_REFS.V11,
    askQuestionId: null,
    readiness: true,
    // V11: anyone who works only on commercial buildings needs no license.
    when: { not: { q: 'base.residential', is: 'commercial' } },
  },
];

export const NASSAU_PACK: QuestionPack = {
  id: 'nassau',
  appliesTo: { county: ['36059'] },
  questions: [],
  items: nassauItems,
  skips: [],
  deptQuestions: [],
};

const suffolkItems: readonly ItemTemplate[] = [
  {
    id: 'li.suffolk_hic',
    station: 'scope',
    kind: 'need',
    text: 'Suffolk County Consumer Affairs licenses home improvement contractors, and working without a license can lead to arrest and prosecution. It issues separate Master Plumber and Master Electrician licenses.',
    who: ['gc', 'licensed_plumber', 'licensed_electrician'],
    certainty: 'verified',
    source: SOURCE_REFS.V12,
    askQuestionId: null,
    readiness: true,
    when: null,
  },
  {
    id: 'li.suffolk_check',
    station: 'scope',
    kind: 'fact',
    text: "Check a license at (631) 853-4600 or with Suffolk's contractor search.",
    who: ['gc'],
    certainty: 'verified',
    source: SOURCE_REFS.V12,
    askQuestionId: null,
    readiness: false,
    when: null,
  },
];

export const SUFFOLK_PACK: QuestionPack = {
  id: 'suffolk',
  appliesTo: { county: ['36103'] },
  questions: [],
  items: suffolkItems,
  skips: [],
  deptQuestions: [],
};

export const LI_VILLAGE_PACK: QuestionPack = {
  id: 'li_village',
  // 'unresolved' too: with no place match, which department issues is the
  // first thing to settle (PLAN §4), and the engine leads with this question.
  appliesTo: { family: ['ny_village', 'ny_city', 'unresolved'] },
  questions: [
    {
      id: 'li.village_or_town',
      text: 'Which department issues the permit?',
      help: null,
      kind: 'choice',
      choices: [
        { id: 'village', label: 'The village' },
        { id: 'town', label: 'The town' },
        { id: 'city', label: 'The city' },
        { id: 'not_sure', label: 'Not sure' },
      ],
      askIf: null,
      prefill: 'permit_office',
      source: null,
    },
  ],
  items: [
    {
      id: 'li.village_caution',
      station: 'scope',
      kind: 'fact',
      // Verbatim. No official page in sources.ts states it, so it rides on the
      // department question rather than claiming a source.
      text: VILLAGE_CAUTION,
      who: ['department'],
      certainty: 'unknown',
      source: null,
      askQuestionId: 'base.which_department',
      readiness: false,
      when: null,
    },
  ],
  skips: [],
  deptQuestions: [],
};
