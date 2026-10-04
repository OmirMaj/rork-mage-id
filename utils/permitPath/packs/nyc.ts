// utils/permitPath/packs/nyc.ts — the New York City pack (family 'nyc').
// PURE DATA. Every `verified` line paraphrases one NYC agency page in
// sources.ts, re-read on FACTS_CHECKED_ON, with at most one short phrase
// borrowed. Anything those pages do not state (Tenant Protection Plans, what
// open violations do to a filing, which job type a borderline scope is) is a
// DeptQuestion, never a fact.
//
// The NYC department row itself (DOB NOW portal, channels by stage) comes from
// departmentFor in utils/codeJurisdiction.ts at runtime; it is not repeated
// here. Zoning comes from the parcel through the nyc.zoning_fact slot.

import { ACP5_REQUIRES } from '@/utils/buildingScopeCopy';
import type { DeptQuestion, ItemTemplate, Predicate, Question, QuestionPack } from '../types';
import { NO, UNSURE, YES } from './base';
import { SOURCE_REFS } from './sources';

// The engine derives these from the GC's answers (utils/permitPath/predicate.ts
// DERIVED_QUESTION_IDS): predicates test equality only, and "built before
// April 1, 1987" needs a comparison on the typed year.
const PRE_APR_1987 = 'derived.pre_apr_1987';
const YEAR_BAND = 'derived.year_band';
const OPEN_VIOLATIONS = 'derived.open_violations';

const LANDMARK_YES: Predicate = { q: 'nyc.landmark', is: YES };
const CO_CHANGE_YES: Predicate = { q: 'nyc.co_change', is: YES };
const HAS_PLUMBING: Predicate = { q: 'base.work_types', is: 'plumbing' };
const FIXTURES_ONLY: Predicate = { q: 'nyc.plumbing_scope', is: 'fixtures_only' };
const ONE_TWO_FAMILY: Predicate = { q: 'base.residential', is: 'one_two_family' };

// JOB TYPE (V2, V3, V4). Exactly one of nyc.job_type_alt_co, nyc.job_type_alt
// and nyc.job_type_unsure holds for any answers (the facts validator walks the
// grid). The rule is deliberately blunt:
//   - "New building or addition" and "Demolition" may be a New Building filing
//     (V2: full demolition means a New Building application), so with those
//     picked even a "yes" is not provably Alteration-CO;
//   - those two plus "Change of use" are Alteration-CO elements in V3
//     (enlargements, conversions), so a "no" is not provably a plain Alteration.
// Anything not provable goes to the architect or engineer: "Not known yet · Ask".
const CO_CHANGE_NO: Predicate = { q: 'nyc.co_change', is: NO };
const MAY_BE_NEW_BUILDING: Predicate = { q: 'base.work_types', is: ['new_building_addition', 'demolition'] };
const CO_ELEMENT_WORK: Predicate = { q: 'base.work_types', is: ['new_building_addition', 'change_of_use', 'demolition'] };
const ALT_CO_KNOWN: Predicate = { all: [CO_CHANGE_YES, { not: MAY_BE_NEW_BUILDING }] };
const ALT_KNOWN: Predicate = { all: [CO_CHANGE_NO, { not: CO_ELEMENT_WORK }] };
const JOB_TYPE_OPEN: Predicate = {
  any: [
    { q: 'nyc.co_change', is: UNSURE },
    { q: 'nyc.co_change', answered: false },
    { all: [CO_CHANGE_NO, CO_ELEMENT_WORK] },
    { all: [CO_CHANGE_YES, MAY_BE_NEW_BUILDING] },
  ],
};
// V6 is DOB's 1- and 2-family owner page: its rules are shown only there.
// Other building types get base.drawings_who and base.which_permits instead.

const questions: readonly Question[] = [
  {
    id: 'nyc.landmark',
    text: 'Is the building a landmark, or in a historic district?',
    help: "LPC's own map is the record.",
    kind: 'yes_no_unsure',
    choices: null,
    askIf: null,
    prefill: 'pluto_landmark',
    source: SOURCE_REFS.V9,
  },
  {
    id: 'nyc.exterior',
    text: 'Does the work change the outside of the building?',
    help: null,
    kind: 'yes_no_unsure',
    choices: null,
    askIf: LANDMARK_YES,
    prefill: null,
    source: null,
  },
  {
    id: 'nyc.disturb_materials',
    text: 'Will the work disturb existing walls, ceilings, floors, pipes or insulation?',
    help: ACP5_REQUIRES,
    kind: 'yes_no_unsure',
    choices: null,
    askIf: null,
    prefill: null,
    source: SOURCE_REFS.V7,
  },
  {
    id: 'nyc.built_before_apr_1987',
    text: 'Was the building built before April 1, 1987?',
    help: 'DEP asbestos certification depends on it. Not sure is a fine answer.',
    kind: 'yes_no_unsure',
    choices: null,
    // Asked only when the typed year can't decide: built in 1987, or no year yet.
    askIf: { any: [{ q: YEAR_BAND, is: 'in_1987' }, { q: 'base.building_year', answered: false }] },
    prefill: null,
    source: SOURCE_REFS.V7,
  },
  {
    id: 'nyc.co_change',
    // V3's Alteration-CO elements: conversions, egress, enlargements, floor-area reductions.
    text: 'Does the work change how the space is used, change exits (doors, stairs, exit routes), or add or remove floor area?',
    help: null,
    kind: 'yes_no_unsure',
    choices: null,
    askIf: null,
    prefill: null,
    source: SOURCE_REFS.V3,
  },
  {
    id: 'nyc.plumbing_scope',
    text: 'What is the plumbing work?',
    help: null,
    kind: 'choice',
    choices: [
      { id: 'fixtures_only', label: 'Replacing fixtures only' },
      { id: 'new_piping', label: 'New or moved pipes or gas' },
      { id: 'not_sure', label: 'Not sure' },
    ],
    askIf: HAS_PLUMBING,
    prefill: null,
    source: null,
  },
];

const items: readonly ItemTemplate[] = [
  {
    id: 'nyc.permit_rule',
    station: 'scope',
    kind: 'fact',
    text: 'Most construction in NYC needs a DOB permit. Painting, plastering, cabinets, plumbing fixture replacement, floor resurfacing and non-structural roof repair are listed as not needing one.',
    who: [],
    certainty: 'verified',
    source: SOURCE_REFS.V5,
    askQuestionId: null,
    readiness: false,
    when: null,
  },
  {
    id: 'nyc.hic',
    station: 'scope',
    kind: 'need',
    text: 'Home improvement work on a residential building in NYC needs a DCWP Home Improvement Contractor license, even when no permit is needed.',
    who: ['gc'],
    certainty: 'verified',
    source: SOURCE_REFS.V10,
    askQuestionId: null,
    readiness: true,
    // V10: "any residential land or building"; mixed use has homes in it.
    when: { q: 'base.residential', is: ['one_two_family', 'apartment', 'mixed_use'] },
  },
  {
    id: 'nyc.job_type_alt_co',
    station: 'filing',
    kind: 'fact',
    text: 'Changes to use, exits or floor area are filed as Alteration-CO in DOB NOW, the job type for work that affects the certificate of occupancy.',
    who: ['design_pro'],
    certainty: 'verified',
    source: SOURCE_REFS.V2,
    askQuestionId: null,
    readiness: false,
    when: ALT_CO_KNOWN,
  },
  {
    id: 'nyc.job_type_alt',
    station: 'filing',
    kind: 'fact',
    text: "Work that doesn't change the certificate of occupancy is filed as an Alteration in DOB NOW.",
    who: ['design_pro'],
    certainty: 'verified',
    source: SOURCE_REFS.V2,
    askQuestionId: null,
    readiness: false,
    when: ALT_KNOWN,
  },
  {
    id: 'nyc.job_type_unsure',
    station: 'filing',
    kind: 'who',
    text: 'Ask your architect or engineer which DOB NOW job type this is: Alteration, Alteration-CO or New Building.',
    who: ['design_pro'],
    certainty: 'unknown',
    source: null,
    askQuestionId: 'nyc.job_type_q',
    readiness: false,
    when: JOB_TYPE_OPEN,
  },
  {
    id: 'nyc.rdp',
    station: 'drawings',
    kind: 'who',
    text: 'Beyond the limits DOB sets for owners, an architect or engineer must file the plans before a work permit is issued.',
    who: ['design_pro'],
    certainty: 'verified',
    source: SOURCE_REFS.V6,
    askQuestionId: null,
    readiness: false,
    when: ONE_TWO_FAMILY,
  },
  {
    id: 'nyc.electrician',
    station: 'drawings',
    kind: 'who',
    text: 'Electrical work needs its own electrical permit and is done by a New York City licensed electrician.',
    who: ['licensed_electrician'],
    certainty: 'verified',
    source: SOURCE_REFS.V6,
    askQuestionId: null,
    readiness: false,
    when: { all: [ONE_TWO_FAMILY, { q: 'base.work_types', is: 'electrical' }] },
  },
  {
    id: 'nyc.plumber',
    station: 'drawings',
    kind: 'who',
    text: 'Plumbing work is done by a Licensed Master Plumber. Past the limited work a plumber may do alone, an architect or engineer files the plans.',
    who: ['licensed_plumber', 'design_pro'],
    certainty: 'verified',
    source: SOURCE_REFS.V6,
    askQuestionId: null,
    readiness: false,
    when: { all: [ONE_TWO_FAMILY, HAS_PLUMBING, { not: FIXTURES_ONLY }] },
  },
  {
    id: 'nyc.plumber_fixtures',
    station: 'drawings',
    kind: 'who',
    text: 'Replacing plumbing fixtures is listed as not needing a permit.',
    who: ['licensed_plumber'],
    certainty: 'verified',
    source: SOURCE_REFS.V5,
    askQuestionId: null,
    readiness: false,
    when: { all: [HAS_PLUMBING, FIXTURES_ONLY] },
  },
  {
    id: 'nyc.acp5',
    station: 'checks',
    kind: 'need',
    text: "Before a DOB permit, a Certified Asbestos Investigator checks the work area. An ACP-5 goes to DEP if it isn't an asbestos project, or an ACP-7 if it is.",
    who: ['asbestos_investigator', 'owner'],
    certainty: 'verified',
    source: SOURCE_REFS.V7,
    askQuestionId: null,
    readiness: true,
    // Pre-April 1987, or not known: only a clear "built after" drops it.
    when: { all: [{ q: 'nyc.disturb_materials', is: YES }, { not: { q: PRE_APR_1987, is: NO } }] },
  },
  {
    id: 'nyc.asbestos_exempt',
    station: 'checks',
    kind: 'fact',
    // Both halves, always: never just "exempt".
    text: 'Built after April 1, 1987: exempt from DEP asbestos certification. Known asbestos that the work disturbs must still be abated.',
    who: [],
    certainty: 'verified',
    source: SOURCE_REFS.V7,
    askQuestionId: null,
    readiness: false,
    when: { q: PRE_APR_1987, is: NO },
  },
  {
    id: 'nyc.lpc',
    station: 'checks',
    kind: 'need',
    text: 'On a landmark or in a historic district, outside work and inside work that needs a DOB permit need an LPC permit, filed in Portico. Outside work needs one even without a DOB permit.',
    who: ['lpc', 'design_pro'],
    certainty: 'verified',
    source: SOURCE_REFS.V9,
    askQuestionId: null,
    readiness: true,
    // Outside work, or not known yet: the whole V9 rule.
    when: { all: [LANDMARK_YES, { not: { q: 'nyc.exterior', is: NO } }] },
  },
  {
    // The GC said the outside is untouched: only V9's inside half applies.
    id: 'nyc.lpc_interior',
    station: 'checks',
    kind: 'need',
    text: 'On a landmark or in a historic district, inside work that needs a DOB permit needs an LPC permit, filed in Portico.',
    who: ['lpc', 'design_pro'],
    certainty: 'verified',
    source: SOURCE_REFS.V9,
    askQuestionId: null,
    readiness: true,
    when: { all: [LANDMARK_YES, { q: 'nyc.exterior', is: NO }] },
  },
  {
    // Slot: the engine fills {zoning} and {plutoVersion} from the parcel, and
    // drops the line when the parcel has no zoning (SLOT_ITEM_IDS in index.ts).
    id: 'nyc.zoning_fact',
    station: 'checks',
    kind: 'fact',
    text: 'PLUTO lists zoning {zoning} · PLUTO {plutoVersion}.',
    who: [],
    certainty: 'your_records',
    source: null,
    askQuestionId: null,
    readiness: false,
    when: null,
  },
  {
    id: 'nyc.dob_now',
    station: 'filing',
    kind: 'fact',
    text: 'Filings go through DOB NOW: Build. Architects, engineers, licensees and filing representatives file there.',
    who: ['design_pro'],
    certainty: 'verified',
    source: SOURCE_REFS.V1,
    askQuestionId: null,
    readiness: false,
    when: null,
  },
  {
    id: 'nyc.signoff_co',
    station: 'signoff',
    kind: 'fact',
    text: 'This kind of work ends with a new or amended certificate of occupancy.',
    who: ['department'],
    certainty: 'verified',
    source: SOURCE_REFS.V4,
    askQuestionId: null,
    readiness: false,
    // Follows the job type: only a provable Alteration-CO gets the CO line.
    when: { all: [ALT_CO_KNOWN, ONE_TWO_FAMILY] },
  },
  {
    id: 'nyc.signoff_co_other',
    station: 'signoff',
    kind: 'fact',
    text: 'This kind of work ends with a new certificate of occupancy.',
    who: ['department'],
    certainty: 'verified',
    source: SOURCE_REFS.V3,
    askQuestionId: null,
    readiness: false,
    when: { all: [ALT_CO_KNOWN, { not: ONE_TWO_FAMILY }] },
  },
];

const deptQuestions: readonly DeptQuestion[] = [
  {
    id: 'nyc.job_type_q',
    station: 'filing',
    text: 'Is this an Alteration, an Alteration-CO or a New Building filing?',
    askIf: JOB_TYPE_OPEN,
  },
  {
    id: 'nyc.tpp',
    station: 'filing',
    text: 'Does this job need a Tenant Protection Plan?',
    askIf: { all: [{ q: 'base.occupied', is: YES }, { q: 'base.residential', is: 'apartment' }] },
  },
  {
    id: 'nyc.violations',
    station: 'checks',
    text: 'Do the open violations on this building affect our filing?',
    askIf: { q: OPEN_VIOLATIONS, is: YES },
  },
];

export const NYC_PACK: QuestionPack = {
  id: 'nyc',
  appliesTo: { family: ['nyc'] },
  questions,
  items,
  // `checks` is never skipped: it always carries the zoning fact. The asbestos
  // exemption is an item swap (nyc.acp5 → nyc.asbestos_exempt), not a skip.
  skips: [],
  deptQuestions,
};
