// validate-permit-path-engine.ts — pins the Permit Path engine
// (utils/permitPath/*: predicate, jurisdiction, prefill, interview, durations,
// buildRoute, readiness, copy). Fixtures are inline: a small local pack set
// that mirrors the PPFACTS ids, so this guard tests the ENGINE's rules and
// does not move when pack wording moves.
//
// WHAT IT PROTECTS (PPENGINE M11)
//   1  station order is STATION_ORDER, always
//   2  NYC 1931 historic-district kitchen and bath: LPC, ACP-5, Alteration vs
//      Alteration-CO, plumber and electrician chips
//   3  landmark off drops LPC and the stated maximum; back on restores both;
//      inputsKey moves and comes back
//   4  1995: asbestos certification not needed with the April 1, 1987 reason
//      and V7; 1987 asks the April 1 question instead of deciding
//   5  Hempstead: Nassau license verified (V11); survey, sealed plans, CO search
//      unknown with askQuestionId; a saved answer for NY:3605934000 turns
//      li.survey into department_said, and readiness stays unknown until then
//   6  an answer saved for another key never applies (nor under UNRESOLVED)
//   7  village: VILLAGE_CAUTION verbatim, the village-or-town question first
//   8  unresolved: nothing verified, the which-department question first
//   9  no duration from the AI roadmap (999) or below the measured floor
//   10 shape guard: verified ⇔ source, department_said ⇔ answer, unknown ⇔ askQuestionId
//   11 banned words over copy.ts, every fixture route and shareText
//   12 determinism, including shuffled department answers
//   13 purity: no react, react-native, AsyncStorage, fetch(, Date.now(, new Date()
//
// Run: bun run scripts/validate-permit-path-engine.ts

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  STATION_ORDER, buildPermitRoute, classifyJurisdiction, durationFor, evalPredicate, explainChange, interviewProgress,
  nextQuestion, predicateQuestionIds, prefillFor, readinessFor, routeSummaryForAsk, shareText, visibleQuestions,
  withAnswer, withoutAnswer, LPC_STATED_MAX_SOURCE, verifiedDepartmentOffice,
  type InterviewAnswer, type InterviewAnswers, type PermitRoute, type QuestionPack, type ReadinessMarks, type RouteInputs,
  type RouteItem, type SavedDeptAnswer, type SourceRef,
} from '../utils/permitPath';
import { permitOfficeFor, PIN_TOWN_CAUTION, VILLAGE_CAUTION, type PlaceLookupResult } from '../utils/permitOffices';
import type { BuildingParcel } from '../utils/buildingRecord';
import { resolveCodeJurisdiction } from '../utils/codeJurisdiction';
import type { Permit, PermitRoadmap } from '../types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) pass++;
  else { fail++; console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`); }
}

// ─────────────────────────────────────────────────────────────────────
// Fixture sources and packs (PPFACTS ids; wording is fixture-only)
// ─────────────────────────────────────────────────────────────────────

const S = (label: string, url: string): SourceRef => ({ label, url, checkedOn: '2026-10-02' });
const V3 = S('NYC DOB · Alterations', 'https://www.nyc.gov/site/buildings/dob/project-categories-alterations.page');
const V5 = S('NYC DOB · Do I need a permit?', 'https://www.nyc.gov/site/buildings/property-or-business-owner/do-i-need-a-permit.page');
const V6 = S('NYC DOB · 1-2 family requirements', 'https://www.nyc.gov/site/buildings/property-or-business-owner/project-requirements-owner-alt-1-2-family-buildings.page');
const V7 = S('NYC DEP/DOB · Asbestos requirements', 'https://www.nyc.gov/site/buildings/dob/project-requirements-asbestos.page');
const V9 = S('NYC LPC · Permit types', 'https://www.nyc.gov/site/lpc/applications/permit-types.page');
const V11 = S('Nassau County Consumer Affairs · FAQ', 'https://www.nassaucountyny.gov/Faq.aspx?TID=36');
const V12 = S('Suffolk County Consumer Affairs · Home improvement', 'https://suffolkcountyny.gov/Departments/Consumer-Affairs/Type-of-License/Home-Improvement-Contractors');

const YNU = null;
const BASE: QuestionPack = {
  id: 'base',
  appliesTo: { family: ['nyc', 'ny_town', 'ny_village', 'ny_city', 'elsewhere', 'unresolved'] },
  questions: [
    { id: 'base.work_types', text: 'What kind of work is it?', help: null, kind: 'multi', prefill: 'scope_trades', askIf: null, source: null,
      choices: [{ id: 'kitchen_bath', label: 'Kitchen or bath' }, { id: 'plumbing', label: 'Plumbing' }, { id: 'electrical', label: 'Electrical' }, { id: 'paint_only', label: 'Painting only' }] },
    { id: 'base.occupied', text: 'Will people live in or use the building during the work?', help: null, kind: 'yes_no_unsure', choices: YNU, askIf: null, prefill: null, source: null },
    { id: 'base.building_year', text: 'What year was the building built?', help: null, kind: 'year', choices: null, askIf: null, prefill: 'building_year', source: null },
  ],
  items: [
    { id: 'base.drawings_who', station: 'drawings', kind: 'who', text: 'Ask your architect or engineer whether this scope needs stamped drawings.', who: ['design_pro'], certainty: 'unknown', source: null, askQuestionId: 'base.sealed_plans', readiness: false, when: null },
    { id: 'filing.owner_ok', station: 'filing', kind: 'document', text: "Owner's sign-off to file", who: ['owner'], certainty: 'your_answer', source: null, askQuestionId: null, readiness: true, when: null },
    { id: 'signoff.received', station: 'signoff', kind: 'document', text: 'Final sign-off from the building department', who: ['department'], certainty: 'your_answer', source: null, askQuestionId: null, readiness: true, when: null },
  ],
  // Fixture-only skip, to pin the skip mechanics.
  skips: [{ station: 'drawings', when: { q: 'base.work_types', is: 'paint_only' }, because: 'Painting only (fixture)', source: null }],
  deptQuestions: [
    // PPFACTS order: permit_needed is listed before which_department; the engine must still lead with it.
    { id: 'base.permit_needed', station: 'scope', text: 'Does this work need a building permit from you? The scope is: <scope>.', askIf: { not: { family: ['nyc'] } } },
    { id: 'base.which_department', station: 'scope', text: 'Is this address handled by the village or the town?', askIf: { family: ['unresolved', 'ny_village'] } },
    { id: 'base.sealed_plans', station: 'drawings', text: 'Does this scope need sealed drawings?', askIf: null },
    { id: 'base.review_time', station: 'review', text: 'How long is plan review taking right now?', askIf: null },
    { id: 'base.closeout', station: 'signoff', text: 'What closes the permit at the end?', askIf: null },
  ],
};

const NYC: QuestionPack = {
  id: 'nyc',
  appliesTo: { family: ['nyc'] },
  questions: [
    { id: 'nyc.landmark', text: 'Is the building a landmark, or in a historic district?', help: null, kind: 'yes_no_unsure', choices: null, askIf: null, prefill: 'pluto_landmark', source: V9 },
    { id: 'nyc.exterior', text: 'Does the work change the outside of the building?', help: null, kind: 'yes_no_unsure', choices: null, askIf: { q: 'nyc.landmark', is: 'yes' }, prefill: null, source: null },
    { id: 'nyc.disturb_materials', text: 'Will the work disturb existing walls?', help: null, kind: 'yes_no_unsure', choices: null, askIf: null, prefill: null, source: V7 },
    { id: 'nyc.built_before_apr_1987', text: 'Was the building built before April 1, 1987?', help: null, kind: 'yes_no_unsure', choices: null,
      askIf: { any: [{ q: 'derived.year_band', is: 'in_1987' }, { q: 'base.building_year', answered: false }] }, prefill: null, source: V7 },
    { id: 'nyc.co_change', text: 'Does the work change how the space is used, or change exits?', help: null, kind: 'yes_no_unsure', choices: null, askIf: null, prefill: null, source: V3 },
  ],
  items: [
    { id: 'nyc.permit_rule', station: 'scope', kind: 'fact', text: 'Most construction in NYC needs a DOB permit.', who: [], certainty: 'verified', source: V5, askQuestionId: null, readiness: false, when: null },
    { id: 'nyc.zoning_fact', station: 'checks', kind: 'fact', text: 'PLUTO lists zoning {zoning} · PLUTO {plutoVersion}.', who: [], certainty: 'your_records', source: null, askQuestionId: null, readiness: false, when: null },
    { id: 'nyc.lpc', station: 'checks', kind: 'need', text: 'Landmarked buildings need an LPC permit, filed in Portico.', who: ['lpc', 'design_pro'], certainty: 'verified', source: V9, askQuestionId: null, readiness: true, when: { q: 'nyc.landmark', is: 'yes' } },
    { id: 'nyc.acp5', station: 'checks', kind: 'need', text: 'A DEP Certified Asbestos Investigator checks the work area and files an ACP-5 or ACP-7.', who: ['asbestos_investigator', 'owner'], certainty: 'verified', source: V7, askQuestionId: null, readiness: true,
      when: { all: [{ q: 'nyc.disturb_materials', is: 'yes' }, { q: 'derived.pre_apr_1987', is: ['yes', 'unsure'] }] } },
    { id: 'nyc.asbestos_exempt', station: 'checks', kind: 'fact', text: 'Built after April 1, 1987: exempt from DEP asbestos certification. Known asbestos that the work disturbs must still be abated.', who: [], certainty: 'verified', source: V7, askQuestionId: null, readiness: false,
      when: { q: 'derived.pre_apr_1987', is: 'no' } },
    { id: 'nyc.job_type_unsure', station: 'filing', kind: 'who', text: 'Ask your architect or engineer whether this is an Alteration or an Alteration-CO filing.', who: ['design_pro'], certainty: 'unknown', source: null, askQuestionId: 'nyc.job_type_q', readiness: false,
      when: { any: [{ q: 'nyc.co_change', is: 'unsure' }, { q: 'nyc.co_change', answered: false }] } },
    { id: 'nyc.electrician', station: 'drawings', kind: 'who', text: 'Electrical work is done by a licensed electrician.', who: ['licensed_electrician'], certainty: 'verified', source: V6, askQuestionId: null, readiness: false, when: { q: 'base.work_types', is: 'electrical' } },
    { id: 'nyc.plumber', station: 'drawings', kind: 'who', text: 'Plumbing work is done by a Licensed Master Plumber.', who: ['licensed_plumber'], certainty: 'verified', source: V6, askQuestionId: null, readiness: false, when: { q: 'base.work_types', is: 'plumbing' } },
  ],
  skips: [],
  deptQuestions: [
    { id: 'nyc.job_type_q', station: 'filing', text: 'Is this an Alteration or an Alteration-CO filing?', askIf: null },
    { id: 'nyc.violations', station: 'checks', text: 'Do the open violations on this building affect our filing?', askIf: { q: 'derived.open_violations', is: 'yes' } },
  ],
};

const LI_FAMILIES = { family: ['ny_town', 'ny_village', 'ny_city'] as const };
const LI_VILLAGE: QuestionPack = {
  id: 'li_village',
  appliesTo: { family: ['ny_village', 'ny_city'] },
  questions: [{ id: 'li.village_or_town', text: 'Which department issues the permit?', help: null, kind: 'choice', askIf: null, prefill: 'permit_office', source: null,
    choices: [{ id: 'village', label: 'The village' }, { id: 'town', label: 'The town' }, { id: 'not_sure', label: 'Not sure' }] }],
  items: [{ id: 'li.village_caution', station: 'scope', kind: 'fact', text: 'slot', who: [], certainty: 'unknown', source: null, askQuestionId: 'base.which_department', readiness: false, when: null }],
  skips: [],
  deptQuestions: [],
};
const LI_COMMON: QuestionPack = {
  id: 'li_common',
  appliesTo: { all: [LI_FAMILIES, { county: ['36059', '36103'] }] },
  questions: [{ id: 'li.survey_on_hand', text: 'Do you have a recent survey of the property?', help: null, kind: 'yes_no_unsure', choices: null, askIf: null, prefill: null, source: null }],
  items: [{ id: 'li.office', station: 'scope', kind: 'fact', text: 'slot', who: ['department'], certainty: 'unknown', source: null, askQuestionId: 'base.which_department', readiness: false, when: null }],
  skips: [],
  deptQuestions: [
    { id: 'li.survey', station: 'filing', text: 'Do you need a survey with the application?', askIf: null },
    { id: 'li.co_search', station: 'checks', text: 'Do I need a certificate of occupancy search before filing?', askIf: null },
    { id: 'li.sealed_plans', station: 'drawings', text: "For this scope, do the drawings need an architect's or engineer's seal?", askIf: null },
    { id: 'li.review_time', station: 'review', text: 'How long is plan review taking right now?', askIf: null },
  ],
};
const NASSAU: QuestionPack = {
  id: 'nassau', appliesTo: { county: ['36059'] }, questions: [], skips: [], deptQuestions: [],
  items: [{ id: 'li.nassau_hic', station: 'scope', kind: 'need', text: 'Nassau County requires a home improvement license to remodel residential homes.', who: ['gc'], certainty: 'verified', source: V11, askQuestionId: null, readiness: true, when: null }],
};
const SUFFOLK: QuestionPack = {
  id: 'suffolk', appliesTo: { county: ['36103'] }, questions: [], skips: [], deptQuestions: [],
  items: [{ id: 'li.suffolk_hic', station: 'scope', kind: 'need', text: 'Suffolk County requires a home improvement license.', who: ['gc', 'licensed_plumber', 'licensed_electrician'], certainty: 'verified', source: V12, askQuestionId: null, readiness: true, when: null }],
};
const PACKS: readonly QuestionPack[] = [BASE, NYC, LI_VILLAGE, LI_COMMON, NASSAU, SUFFOLK];

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

const AT = '2026-10-02T12:00:00.000Z';
const A = (value: InterviewAnswer['value']): InterviewAnswer => ({ value, from: 'gc', prefillNote: null, at: AT });
const answersOf = (o: Record<string, InterviewAnswer['value']>): InterviewAnswers => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, A(v)]));

const place = (o: Partial<PlaceLookupResult>): PlaceLookupResult => ({
  state: 'NY', county: null, town: null, incorporatedPlace: null, cdp: null, match: 'address', matchedAddress: null,
  source: 'Census geocoder', asOf: '2026-10-01', ...o,
});

const parcel = (o: Partial<BuildingParcel>): BuildingParcel => ({
  status: 'ok', asOf: '2026-09-30', zoning: ['R6B'], overlays: [], specialDistricts: [], landmark: null, historicDistrict: null,
  floodZone2015: false, eDesignation: null, yearBuilt: 1931, numFloors: 4, bldgClass: 'C0', plutoVersion: '25v2', ...o,
});

const nycPlace = place({ county: { name: 'Kings County', geoid: '36047' }, town: { name: 'Brooklyn borough', basename: 'Brooklyn', geoid: '3604710022', kind: 'borough' } });
const NYC_J = classifyJurisdiction({ officeAnswer: permitOfficeFor(nycPlace), place: nycPlace, nyc: true });

const hempsteadPlace = place({ county: { name: 'Nassau County', geoid: '36059' }, town: { name: 'Hempstead town', basename: 'Hempstead', geoid: '3605934000', kind: 'town' } });
const hempsteadAnswer = permitOfficeFor(hempsteadPlace);
const HEMPSTEAD_J = classifyJurisdiction({ officeAnswer: hempsteadAnswer, place: hempsteadPlace, nyc: false });

const villagePlace = place({
  county: { name: 'Nassau County', geoid: '36059' }, town: { name: 'Hempstead town', basename: 'Hempstead', geoid: '3605934000', kind: 'town' },
  incorporatedPlace: { name: 'Garden City village', basename: 'Garden City', geoid: '3628178', kind: 'village' },
});
const villageAnswer = permitOfficeFor(villagePlace);
const VILLAGE_J = classifyJurisdiction({ officeAnswer: villageAnswer, place: villagePlace, nyc: false });

const nonePlace = place({ match: 'none' });
const UNRESOLVED_J = classifyJurisdiction({ officeAnswer: permitOfficeFor(nonePlace, { state: 'NY', postalCity: 'Hempstead' }), place: nonePlace, nyc: false });

function inputs(o: Partial<RouteInputs> & Pick<RouteInputs, 'jurisdiction'>): RouteInputs {
  return {
    projectId: 'p1', answers: {}, marks: {}, deptAnswers: [], permits: [], measured: null, parcel: null, buildingYear: null,
    aiRoadmap: null, today: '2026-10-02', scope: 'Kitchen cabinets; Bathroom sink and toilet; New outlets', ...o,
  };
}

const ALL_ROUTES: PermitRoute[] = [];
function build(i: RouteInputs, packs: readonly QuestionPack[] = PACKS): PermitRoute {
  const r = buildPermitRoute(i, packs);
  ALL_ROUTES.push(r);
  return r;
}
const itemsOf = (r: PermitRoute): RouteItem[] => r.stations.flatMap((s) => s.items);
const item = (r: PermitRoute, id: string) => itemsOf(r).find((i) => i.id === id);
const station = (r: PermitRoute, id: string) => r.stations.find((s) => s.id === id)!;
const ctxOf = (j: PermitRoute['jurisdiction'], answers: InterviewAnswers) => ({ answers, family: j.family, countyFips: j.countyFips });

// ─────────────────────────────────────────────────────────────────────
// M2 predicate
// ─────────────────────────────────────────────────────────────────────
{
  const ctx = { answers: answersOf({ 'base.work_types': ['plumbing', 'electrical'], 'nyc.landmark': 'yes', 'base.building_year': 1987 }), family: 'nyc' as const, countyFips: '36047' };
  ok('predicate: unknown question id is false', evalPredicate({ q: 'no.such.question', is: 'yes' }, ctx) === false);
  ok('predicate: malformed shape is false', evalPredicate({ nonsense: 1 } as never, ctx) === false && evalPredicate(null, ctx) === false);
  ok('predicate: multi answer membership', evalPredicate({ q: 'base.work_types', is: 'plumbing' }, ctx) && !evalPredicate({ q: 'base.work_types', is: 'paint_only' }, ctx));
  ok('predicate: answered', evalPredicate({ q: 'nyc.landmark', answered: true }, ctx) && evalPredicate({ q: 'nyc.exterior', answered: false }, ctx));
  ok('predicate: all/any/not/family/county', evalPredicate({ all: [{ family: ['nyc'] }, { not: { county: ['36059'] } }, { any: [{ q: 'x', is: 'y' }, { q: 'nyc.landmark', is: ['no', 'yes'] }] }] }, ctx));
  ok('predicate: derived year band 1987', evalPredicate({ q: 'derived.year_band', is: 'in_1987' }, ctx) && !evalPredicate({ q: 'derived.pre_apr_1987', answered: true }, ctx));
  ok('predicate: derived open violations', evalPredicate({ q: 'derived.open_violations', is: 'yes' }, { ...ctx, signals: { openViolations: 2 } }) && !evalPredicate({ q: 'derived.open_violations', is: 'yes' }, ctx));
  ok('predicateQuestionIds walks every leaf', JSON.stringify(predicateQuestionIds({ all: [{ q: 'a', is: 'x' }, { not: { any: [{ q: 'b', answered: true }, { family: ['nyc'] }, { q: 'a', is: 'y' }] } }] })) === '["a","b"]');
}

// ─────────────────────────────────────────────────────────────────────
// M3 jurisdiction
// ─────────────────────────────────────────────────────────────────────
{
  ok('jurisdiction: NYC', NYC_J.family === 'nyc' && NYC_J.key === 'NYC' && NYC_J.countyFips === '36047');
  ok('jurisdiction: Hempstead town', HEMPSTEAD_J.family === 'ny_town' && HEMPSTEAD_J.key === 'NY:3605934000' && HEMPSTEAD_J.officeTitle === 'Town of Hempstead Department of Buildings' && HEMPSTEAD_J.countyFips === '36059',
    JSON.stringify(HEMPSTEAD_J));
  ok('jurisdiction: village (address match)', VILLAGE_J.family === 'ny_village' && VILLAGE_J.key === 'NY:3628178');
  const pinVillage = { ...villagePlace, match: 'approximate' as const };
  const pinJ = classifyJurisdiction({ officeAnswer: permitOfficeFor(pinVillage), place: pinVillage, nyc: false });
  ok('jurisdiction: map pin keeps the town family + PIN_TOWN_CAUTION', pinJ.family === 'ny_town' && pinJ.cautions.includes(PIN_TOWN_CAUTION), JSON.stringify(pinJ));
  const pinTown = { ...hempsteadPlace, match: 'approximate' as const };
  const pinTownJ = classifyJurisdiction({ officeAnswer: permitOfficeFor(pinTown), place: pinTown, nyc: false });
  ok('jurisdiction: cautions copied verbatim, PIN_TOWN_CAUTION once', pinTownJ.cautions.filter((c) => c === PIN_TOWN_CAUTION).length === 1 && pinTownJ.family === 'ny_town');
  ok('jurisdiction: none → unresolved', UNRESOLVED_J.family === 'unresolved' && UNRESOLVED_J.key === 'UNRESOLVED' && UNRESOLVED_J.officeTitle === null);
  const westPlace = place({ county: { name: 'Westchester County', geoid: '36119' }, town: { name: 'Greenburgh town', basename: 'Greenburgh', geoid: '3611930367', kind: 'town' } });
  ok('jurisdiction: Westchester → elsewhere', classifyJurisdiction({ officeAnswer: permitOfficeFor(westPlace), place: westPlace, nyc: false }).family === 'elsewhere');
  ok('jurisdiction: unsupported state → elsewhere, never a real key', (() => { const j = classifyJurisdiction({ officeAnswer: permitOfficeFor(null, { state: 'TX' }), place: null, nyc: false }); return j.family === 'elsewhere' && j.key === 'UNRESOLVED'; })());
  // A verified department block (no place-lookup, the DepartmentCard rule):
  // Baltimore City and County map to their hand-verified MD office by row
  // name and land in 'elsewhere' (base pack + ask, F6) under the real key;
  // NYC and an unverified place get no office from this path.
  {
    const cityOffice = verifiedDepartmentOffice(resolveCodeJurisdiction({ city: 'Baltimore', state: 'MD', zip: '21218' }));
    const countyOffice = verifiedDepartmentOffice(resolveCodeJurisdiction({ city: 'Towson', state: 'MD', zip: '21204' }));
    ok('jurisdiction: Baltimore City verified department → office MD:24510', cityOffice?.key === 'MD:24510', cityOffice?.key);
    ok('jurisdiction: Baltimore County verified department → office MD:24005', countyOffice?.key === 'MD:24005', countyOffice?.key);
    ok('jurisdiction: NYC verified department → no office from this path', verifiedDepartmentOffice(resolveCodeJurisdiction({ city: 'New York', state: 'NY', zip: '10001' })) === null);
    ok('jurisdiction: Annapolis (no department block) → no office', verifiedDepartmentOffice(resolveCodeJurisdiction({ city: 'Annapolis', state: 'MD', zip: '21401' })) === null);
    const vj = cityOffice ? classifyJurisdiction({ officeAnswer: { kind: 'office', office: cityOffice, headline: null, cautions: [] }, place: null, nyc: false, departmentVerified: true }) : null;
    ok('jurisdiction: verified Baltimore City with no place → elsewhere under MD:24510, no Census headline', !!vj && vj.family === 'elsewhere' && vj.key === 'MD:24510' && vj.headline === null && vj.cautions.length === 0, JSON.stringify(vj));
    const unflagged = cityOffice ? classifyJurisdiction({ officeAnswer: { kind: 'office', office: cityOffice, headline: null, cautions: [] }, place: null, nyc: false }) : null;
    ok('jurisdiction: an office with no place and no verified flag stays unresolved', !!unflagged && unflagged.key === 'UNRESOLVED');
  }
}

// ─────────────────────────────────────────────────────────────────────
// M4 prefill
// ─────────────────────────────────────────────────────────────────────
{
  const q = (id: string) => [...BASE.questions, ...NYC.questions, ...LI_VILLAGE.questions].find((x) => x.id === id)!;
  const pin = { parcel: null, buildingYear: null, officeTitle: null, placeMatch: 'address' as const, scope: '', tradeHints: {} };
  const hd = prefillFor(q('nyc.landmark'), { ...pin, parcel: parcel({ historicDistrict: 'Park Slope Historic District' }) });
  ok('prefill: PLUTO historic district → yes with note', hd?.value === 'yes' && hd.note === 'PLUTO lists Park Slope Historic District (PLUTO 25v2)', JSON.stringify(hd));
  const none = prefillFor(q('nyc.landmark'), { ...pin, parcel: parcel({}) });
  ok('prefill: PLUTO none → no with LPC note', none?.value === 'no' && none.note === "PLUTO lists none. LPC's own map is the record.");
  ok('prefill: failed parcel → null', prefillFor(q('nyc.landmark'), { ...pin, parcel: parcel({ status: 'failed' }) }) === null && prefillFor(q('nyc.landmark'), pin) === null);
  const yr = prefillFor(q('base.building_year'), { ...pin, buildingYear: { entered: null, pluto: { year: 1931, source: 'pluto', asOf: '25v2' } } });
  ok('prefill: building year from PLUTO with its chip', yr?.value === 1931 && typeof yr.note === 'string' && yr.note.includes('1931'), JSON.stringify(yr));
  const vil = prefillFor(q('li.village_or_town'), { ...pin, officeTitle: 'Village of Garden City' });
  ok('prefill: office → village choice', vil?.value === 'village' && vil.note === 'Village of Garden City');
  const vilPin = prefillFor(q('li.village_or_town'), { ...pin, officeTitle: 'Town of Hempstead Department of Buildings', placeMatch: 'approximate' });
  ok('prefill: map pin never picks village or town', vilPin?.value === 'not_sure' && vilPin.note.endsWith('from the map pin'), JSON.stringify(vilPin));
  const tr = prefillFor(q('base.work_types'), { ...pin, scope: 'Demo existing; Bathroom sink and toilet; New outlets', tradeHints: { plumbing: ['sink', 'toilet'], electrical: ['outlet'] } });
  ok('prefill: scope trades from the estimate', JSON.stringify(tr?.value) === '["plumbing","electrical"]' && tr!.note === "From your estimate: 'Bathroom sink and toilet'", JSON.stringify(tr));
  ok('prefill: no match → null', prefillFor(q('base.work_types'), { ...pin, scope: 'Paint', tradeHints: { plumbing: ['sink'] } }) === null);
}

// ─────────────────────────────────────────────────────────────────────
// M5 interview (incl. stale answers ignored)
// ─────────────────────────────────────────────────────────────────────
{
  const a0 = answersOf({ 'nyc.landmark': 'yes', 'nyc.exterior': 'yes' });
  const vis0 = visibleQuestions(PACKS, ctxOf(NYC_J, a0)).map((q) => q.id);
  ok('interview: exterior visible under landmark yes', vis0.includes('nyc.exterior'));
  ok('interview: pack order then question order', vis0.indexOf('base.work_types') < vis0.indexOf('nyc.landmark') && vis0.indexOf('nyc.landmark') < vis0.indexOf('nyc.exterior'));
  ok('interview: nextQuestion is first unanswered', nextQuestion(PACKS, ctxOf(NYC_J, a0))?.id === 'base.work_types');
  const a1 = withoutAnswer(a0, 'nyc.landmark');
  ok('interview: withoutAnswer is pure', !!a0['nyc.landmark'] && !a1['nyc.landmark'] && !!a1['nyc.exterior']);
  ok('interview: withAnswer is pure', (() => { const a2 = withAnswer(a1, 'nyc.landmark', A('no')); return !a1['nyc.landmark'] && a2['nyc.landmark'].value === 'no'; })());
  ok('interview: hidden question drops from visible', !visibleQuestions(PACKS, ctxOf(NYC_J, a1)).some((q) => q.id === 'nyc.exterior'));
  const p = interviewProgress(PACKS, ctxOf(NYC_J, a1));
  ok('interview: stale answer stays stored but does not count', p.answered === 0, JSON.stringify(p));
  // Stale gating: the stale exterior answer must not satisfy an item or dept question.
  const staleItemPack: QuestionPack = { ...NYC, id: 'nyc', items: [...NYC.items, { id: 'fx.ext', station: 'checks', kind: 'fact', text: 'Exterior fixture line.', who: [], certainty: 'your_answer', source: null, askQuestionId: null, readiness: false, when: { q: 'nyc.exterior', is: 'yes' } }] };
  const packs2 = [BASE, staleItemPack];
  ok('interview: stale answer is ignored by item `when` (test-pinned)', !item(build(inputs({ jurisdiction: NYC_J, answers: a1 }), packs2), 'fx.ext') && !!item(build(inputs({ jurisdiction: NYC_J, answers: a0 }), packs2), 'fx.ext'));
  const vVillage = visibleQuestions(PACKS, ctxOf(VILLAGE_J, {}));
  ok('interview: the office-prefilled question leads', vVillage[0]?.id === 'li.village_or_town');
}

// ─────────────────────────────────────────────────────────────────────
// M11.1–4 NYC
// ─────────────────────────────────────────────────────────────────────
const nyc1931Answers = answersOf({ 'base.work_types': ['kitchen_bath', 'plumbing', 'electrical'], 'base.building_year': 1931, 'nyc.landmark': 'yes', 'nyc.disturb_materials': 'yes' });
const nyc1931In = inputs({ jurisdiction: NYC_J, answers: nyc1931Answers, parcel: parcel({ historicDistrict: 'Park Slope Historic District' }) });
const nyc1931 = build(nyc1931In);
{
  ok('M11.1 station order', JSON.stringify(nyc1931.stations.map((s) => s.id)) === JSON.stringify(STATION_ORDER));
  ok('M11.1 station titles from copy', nyc1931.stations.map((s) => s.title).join('|') === 'Scope|Checks|Drawings and who stamps them|Filing|Plan review|Permit issued|Work and inspections|Sign-off');
  const lpc = item(nyc1931, 'nyc.lpc');
  ok('M11.2 LPC item on checks', lpc?.station === 'checks' && lpc.certainty === 'verified');
  ok('M11.2 ACP-5 item appears', item(nyc1931, 'nyc.acp5')?.station === 'checks');
  ok('M11.2 Alteration vs Alteration-CO question', nyc1931.openDeptQuestions.some((d) => d.id === 'nyc.job_type_q') && visibleQuestions(PACKS, ctxOf(NYC_J, nyc1931Answers)).some((q) => q.id === 'nyc.co_change'));
  ok('M11.2 plumber and electrician chips', itemsOf(nyc1931).some((i) => i.who.includes('licensed_plumber')) && itemsOf(nyc1931).some((i) => i.who.includes('licensed_electrician')));
  ok('M11.2 LPC stated maximum on checks with V8', station(nyc1931, 'checks').duration.kind === 'stated_max' && station(nyc1931, 'checks').duration.label === "LPC's stated maximum: 20 to 90 working days" && station(nyc1931, 'checks').duration.source?.url === LPC_STATED_MAX_SOURCE.url);
  ok('zoning slot filled from the parcel', item(nyc1931, 'nyc.zoning_fact')?.text === 'PLUTO lists zoning R6B · PLUTO 25v2.');
  ok('zoning slot dropped without a parcel', !item(build(inputs({ jurisdiction: NYC_J, answers: nyc1931Answers })), 'nyc.zoning_fact'));

  // M11.3 toggle
  const off = build({ ...nyc1931In, answers: withAnswer(nyc1931Answers, 'nyc.landmark', A('no')) });
  const back = build({ ...nyc1931In, answers: withAnswer(withAnswer(nyc1931Answers, 'nyc.landmark', A('no')), 'nyc.landmark', nyc1931Answers['nyc.landmark']) });
  ok('M11.3 landmark no removes LPC', !item(off, 'nyc.lpc'));
  ok('M11.3 landmark no removes the stated maximum', station(off, 'checks').duration.kind === 'unknown');
  ok('M11.3 landmark back restores both', !!item(back, 'nyc.lpc') && station(back, 'checks').duration.kind === 'stated_max');
  ok('M11.3 inputsKey changes then returns', off.inputsKey !== nyc1931.inputsKey && back.inputsKey === nyc1931.inputsKey);
  const ex = explainChange(nyc1931, off);
  ok('S1 explainChange names the removed LPC line', ex.some((l) => l.startsWith('Removed: ') && l.includes('LPC')), JSON.stringify(ex));

  // M11.4 asbestos
  const y95 = build(inputs({ jurisdiction: NYC_J, answers: answersOf({ 'base.building_year': 1995, 'nyc.disturb_materials': 'yes' }) }));
  const ex95 = item(y95, 'nyc.asbestos_exempt');
  ok('M11.4 1995: asbestos certification not needed, April 1, 1987 reason, V7', !!ex95 && ex95.text.includes('April 1, 1987') && ex95.source?.url === V7.url && !item(y95, 'nyc.acp5'));
  ok('M11.4 1995: the April 1 question is not asked', !visibleQuestions(PACKS, ctxOf(NYC_J, answersOf({ 'base.building_year': 1995 }))).some((q) => q.id === 'nyc.built_before_apr_1987'));
  const a87 = answersOf({ 'base.building_year': 1987, 'nyc.disturb_materials': 'yes' });
  const y87 = build(inputs({ jurisdiction: NYC_J, answers: a87 }));
  ok('M11.4 1987: asks the April 1 question instead of deciding', visibleQuestions(PACKS, ctxOf(NYC_J, a87)).some((q) => q.id === 'nyc.built_before_apr_1987') && !item(y87, 'nyc.asbestos_exempt') && !item(y87, 'nyc.acp5'));
  const y87no = build(inputs({ jurisdiction: NYC_J, answers: withAnswer(a87, 'nyc.built_before_apr_1987', A('no')) }));
  const y87un = build(inputs({ jurisdiction: NYC_J, answers: withAnswer(a87, 'nyc.built_before_apr_1987', A('unsure')) }));
  ok('M11.4 1987 + "no" → exempt; "not sure" → ACP-5', !!item(y87no, 'nyc.asbestos_exempt') && !!item(y87un, 'nyc.acp5') && !item(y87un, 'nyc.asbestos_exempt'));
  ok('open violations dept question only with a count', !item(y95, 'nyc.violations') && item(build(inputs({ jurisdiction: NYC_J, openViolations: 3 })), 'nyc.violations')?.certainty === 'unknown');
}

// ─────────────────────────────────────────────────────────────────────
// M11.5–6 Hempstead and cross-jurisdiction answers
// ─────────────────────────────────────────────────────────────────────
const hempOffice = hempsteadAnswer.office;
const surveyAnswer: SavedDeptAnswer = { id: 'da-1', jurisdictionKey: 'NY:3605934000', questionId: 'li.survey', answerText: 'Yes, a survey from the last 2 years showing the proposed work.', answeredOn: '2026-09-14', saidBy: 'J. Smith, plans examiner', channel: 'phone', sourceUrl: null };
const otherTown: SavedDeptAnswer = { id: 'da-2', jurisdictionKey: 'NY:3605953000', questionId: 'li.co_search', answerText: 'No search needed.', answeredOn: '2026-09-20', saidBy: null, channel: 'email', sourceUrl: null };
const hempIn = inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice, marks: { 'li.survey': { state: 'have', evidence: { kind: 'attested', ref: null }, at: AT } } });
const hemp = build(hempIn);
{
  const hic = item(hemp, 'li.nassau_hic');
  ok('M11.5 Nassau HI license verified with V11', hic?.certainty === 'verified' && hic.source?.url === V11.url);
  for (const id of ['li.survey', 'li.sealed_plans', 'li.co_search']) {
    const it = item(hemp, id);
    ok(`M11.5 ${id} unknown with askQuestionId`, it?.certainty === 'unknown' && it.askQuestionId === id, JSON.stringify(it));
  }
  const off = item(hemp, 'li.office');
  ok('li.office slot verified from the hand card', off?.certainty === 'verified' && off.source?.url === 'https://hempsteadny.gov/191/Building-Department' && off.source.checkedOn === '2026-09-26' && off.text.startsWith('Town of Hempstead Department of Buildings'), JSON.stringify(off));
  const r0 = readinessFor(hemp, hempIn.marks).rows.find((r) => r.item.id === 'li.survey');
  ok('M11.5 readiness stays unknown although marked have', r0?.state === 'unknown');
  const answered = build({ ...hempIn, deptAnswers: [surveyAnswer, otherTown] });
  const sv = item(answered, 'li.survey');
  ok('M11.5 saved answer → department_said', sv?.certainty === 'department_said' && sv.answer?.id === 'da-1' && sv.askQuestionId === null && sv.text.includes(surveyAnswer.answerText));
  ok('M11.5 readiness moves to the mark once answered', readinessFor(answered, hempIn.marks).rows.find((r) => r.item.id === 'li.survey')?.state === 'have');
  ok('M11.6 another town\'s answer never applies', item(answered, 'li.co_search')?.certainty === 'unknown');
  ok('M11.6 answer for another key alone changes nothing', item(build({ ...hempIn, deptAnswers: [{ ...surveyAnswer, jurisdictionKey: 'NY:3605953000' }] }), 'li.survey')?.certainty === 'unknown');
  const unresolvedSaved = build(inputs({ jurisdiction: UNRESOLVED_J, deptAnswers: [{ ...surveyAnswer, jurisdictionKey: 'UNRESOLVED', questionId: 'base.sealed_plans' }] }));
  ok('M11.6 nothing matches under UNRESOLVED', item(unresolvedSaved, 'base.drawings_who')?.certainty === 'unknown' && !itemsOf(unresolvedSaved).some((i) => i.certainty === 'department_said'));
  const multi = build({ ...hempIn, deptAnswers: [{ id: 'da-m', jurisdictionKey: 'NY:3605934000', questionIds: ['li.co_search', 'li.sealed_plans'], answerText: 'No search; seal over $20,000.', answeredOn: '2026-09-15', saidBy: null, channel: 'email', sourceUrl: null }] });
  ok('M7.5 one saved answer covering several questions (PPASK questionIds)', item(multi, 'li.co_search')?.certainty === 'department_said' && item(multi, 'li.sealed_plans')?.certainty === 'department_said' && item(multi, 'li.survey')?.certainty === 'unknown');
  const newer = { ...surveyAnswer, id: 'da-0', answeredOn: '2026-09-30', answerText: 'A survey within 1 year.' };
  const twice = build({ ...hempIn, deptAnswers: [surveyAnswer, newer] });
  ok('M7.4 latest answeredOn wins', item(twice, 'li.survey')?.answer?.id === 'da-0');
  // review duration from a department answer
  const rt = build({ ...hempIn, deptAnswers: [{ ...surveyAnswer, id: 'da-3', questionId: 'li.review_time', answerText: 'about 6 weeks' }] });
  ok('M6 department answer → review duration', station(rt, 'review').duration.kind === 'department_said' && station(rt, 'review').duration.label === 'Department said about 6 weeks · Sep 14, 2026');
  ok('M7.7 confirm lines', station(hemp, 'filing').confirmLine === 'Confirm with Town of Hempstead Department of Buildings before you file.' && station(hemp, 'work').confirmLine === 'Confirm with Town of Hempstead Department of Buildings before you build.');
  ok('scope filled into base.permit_needed', item(hemp, 'base.permit_needed')?.text.includes('Kitchen cabinets; Bathroom sink and toilet') === true);
}

// ─────────────────────────────────────────────────────────────────────
// M11.7–8 village and unresolved
// ─────────────────────────────────────────────────────────────────────
{
  const v = build(inputs({ jurisdiction: VILLAGE_J, office: villageAnswer.office }));
  ok('M11.7 village cautions include VILLAGE_CAUTION verbatim', v.jurisdiction.cautions.includes(VILLAGE_CAUTION));
  ok('M11.7 first question is village or town', nextQuestion(PACKS, ctxOf(VILLAGE_J, {}))?.id === 'li.village_or_town');
  const vc = item(v, 'li.village_caution');
  ok('village caution slot: verbatim text, unknown without a source URL', vc?.text === VILLAGE_CAUTION && vc.certainty === 'unknown' && vc.askQuestionId === 'base.which_department', JSON.stringify(vc));
  const vcHand = item(build(inputs({ jurisdiction: VILLAGE_J, office: hempOffice })), 'li.village_caution');
  ok('village caution never borrows an office page as its source', vcHand?.certainty === 'unknown' && vcHand.source === null);
  const u = build(inputs({ jurisdiction: UNRESOLVED_J }));
  ok('M11.8 unresolved: nothing verified, nothing department_said', !itemsOf(u).some((i) => i.certainty === 'verified' || i.certainty === 'department_said'));
  ok('M11.8 unresolved: every jurisdiction question is unknown', itemsOf(u).filter((i) => i.who.includes('department') && i.readiness && i.id !== 'signoff.received').every((i) => i.certainty === 'unknown'));
  ok('M11.8 which department comes first', u.openDeptQuestions[0]?.id === 'base.which_department', u.openDeptQuestions.map((d) => d.id).join(','));
  ok('M11.8 unresolved confirm line names no office', station(u, 'filing').confirmLine === 'Confirm with your building department before you file.');
}

// ─────────────────────────────────────────────────────────────────────
// M11.9 durations
// ─────────────────────────────────────────────────────────────────────
const roadmap999: PermitRoadmap = {
  id: 'rm1', projectId: 'p1', generatedAt: AT, scopeHash: 'x',
  permits: [
    { id: 'rp1', type: 'building', title: 'Building permit', description: 'Takes 999 days', whoPulls: 'gc', leadTimeDays: 999, status: 'needed' },
    { id: 'rp2', type: 'other', title: 'MAGE files permits for you', description: '', whoPulls: 'gc', leadTimeDays: 999, status: 'needed' },
  ],
  inspections: [{ id: 'ri1', type: 'final', title: 'Final inspection', description: '', gatesTaskHint: '', leadTimeDays: 999, status: 'pending' }],
};
{
  const r = build(inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice, aiRoadmap: roadmap999 }));
  ok('M11.9 no "999" anywhere in the route', !JSON.stringify(r).includes('999'));
  const ai = item(r, 'ai.permit.rp1');
  ok('AI roadmap permit → ai_draft on filing, no readiness', ai?.station === 'filing' && ai.certainty === 'ai_draft' && ai.readiness === false);
  ok('AI roadmap inspection → ai_draft on work', item(r, 'ai.inspection.ri1')?.station === 'work');
  ok('AI line saying "files permits" is dropped', !item(r, 'ai.permit.rp2'));
  ok('AI draft never counts toward readiness', !readinessFor(r, {}).rows.some((x) => x.item.certainty === 'ai_draft'));
  const below = build(inputs({ jurisdiction: NYC_J, measured: { days: 41, n: 12, detail: 'x', appliesTo: ['building'] } }));
  ok('M11.9 measured below the floor → unknown', station(below, 'review').duration.kind === 'unknown');
  const meas = build(inputs({ jurisdiction: NYC_J, measured: { days: 41, n: 212, detail: 'x', appliesTo: ['building'] } }));
  const d = station(meas, 'review').duration;
  ok('M6 measured review duration', d.kind === 'measured' && d.label === 'Median 41 days · 212 filings' && d.detail === 'Approved filings only · last 12 months', JSON.stringify(d));
  const auth = 'Town of Hempstead Department of Buildings';
  const mk = (id: string, applied: string, approved: string): Permit => ({ id, projectId: 'other', projectName: 'Other', type: 'building', jurisdiction: auth, status: 'approved', appliedDate: applied, approvedDate: approved, fee: 0 } as Permit);
  const history = [mk('h1', '2026-01-05', '2026-02-04'), mk('h2', '2026-03-02', '2026-04-11'), mk('h3', '2026-05-01', '2026-06-05')];
  const learned = build(inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice, permits: history }));
  const ld = station(learned, 'review').duration;
  ok('M6 learned review duration from his permits', ld.kind === 'your_records' && ld.label === 'From your 3 permits here', JSON.stringify(ld));
  ok('M6 other stations unknown', station(learned, 'filing').duration.kind === 'unknown' && station(learned, 'work').duration.kind === 'unknown');
  ok('M6 durationFor never reads a model number', durationFor('review', { jurisdictionKey: 'NY:1', deptAnswers: [], durationQuestionIds: [], lpcApplies: false, permits: [], measured: null, authority: auth }).kind === 'unknown');
}

// ─────────────────────────────────────────────────────────────────────
// M7.2, M7.6 skips and station state
// ─────────────────────────────────────────────────────────────────────
{
  const sk = build(inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice, answers: answersOf({ 'base.work_types': ['paint_only'] }) }));
  const dr = station(sk, 'drawings');
  ok('M7.2 skip → not_needed with reason, items dropped', dr.state === 'not_needed' && dr.notNeededBecause === 'Painting only (fixture)' && dr.items.length === 0);
  const fresh = build(inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice }));
  ok('M7.6 no permits: scope is current, the rest ahead or unknown', station(fresh, 'scope').state === 'current' && fresh.stations.slice(1).every((s) => s.state === 'ahead' || s.state === 'unknown'));
  ok('M7.6 a station of only unknown items is unknown', station(fresh, 'review').state === 'unknown');
  const P = (id: string, status: Permit['status'], permitNumber?: string): Permit => ({ id, projectId: 'p1', projectName: 'P', type: 'building', jurisdiction: 'x', status, appliedDate: '2026-09-01', fee: 0, permitNumber } as Permit);
  const applied = build(inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice, permits: [P('a', 'applied')] }));
  ok('M7.6 applied → filing done, review current', station(applied, 'filing').state === 'done' && station(applied, 'review').state === 'current');
  const insp = build(inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice, permits: [P('a', 'inspection_passed')] }));
  ok('M7.6 inspection_* → review and issued done, work current', station(insp, 'review').state === 'done' && station(insp, 'issued').state === 'done' && station(insp, 'work').state === 'current');
  ok('M7.6 signoff never inferred from a PermitStatus', station(insp, 'signoff').state !== 'done');
  const marked = build(inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice, permits: [P('a', 'inspection_passed')], marks: { 'signoff.received': { state: 'have', evidence: { kind: 'attested', ref: null }, at: AT } } }));
  ok('M7.6 signoff done only by the GC mark', station(marked, 'signoff').state === 'done');
  const denied = build(inputs({ jurisdiction: HEMPSTEAD_J, office: hempOffice, permits: [P('d', 'denied', 'B-123'), P('e', 'expired')] }));
  ok('M7.6 denied alone does not file', station(build(inputs({ jurisdiction: HEMPSTEAD_J, permits: [P('d', 'denied')] })), 'filing').state !== 'done');
  ok('M7.6 denied/expired lines', itemsOf(denied).some((i) => i.text === 'A permit on this job is denied · B-123' && i.certainty === 'your_records') && itemsOf(denied).some((i) => i.text === 'A permit on this job is expired · no number on file'));
  ok('M7.6 another project\'s permit is ignored', station(build(inputs({ jurisdiction: HEMPSTEAD_J, permits: [{ ...P('z', 'approved'), projectId: 'p2' }] })), 'filing').state !== 'done');
  ok('M7.6 exactly one current station', ALL_ROUTES.every((r) => r.stations.filter((s) => s.state === 'current').length <= 1));
}

// ─────────────────────────────────────────────────────────────────────
// M8 readiness and share
// ─────────────────────────────────────────────────────────────────────
let shared = '';
{
  const marks: ReadinessMarks = { 'filing.owner_ok': { state: 'have', evidence: { kind: 'attested', ref: null }, at: AT }, 'li.nassau_hic': { state: 'n_a', evidence: null, at: AT } };
  const r = build({ ...hempIn, marks, deptAnswers: [surveyAnswer] });
  const { rows, tally } = readinessFor(r, marks);
  const order = rows.map((x) => x.state);
  const rank = { missing: 0, unknown: 1, have: 2, n_a: 3 } as const;
  ok('M8 rows ordered missing, unknown, have, n_a', order.every((s, i) => i === 0 || rank[order[i - 1]] <= rank[s]), order.join(','));
  ok('M8 tally', tally.have === 1 && tally.n_a === 1 && tally.total === tally.have + tally.missing + tally.unknown && r.readiness.total === tally.total);
  shared = shareText(r, rows, { company: 'Majeed Builders', address: '1 Main St, Hempstead, NY', today: '2026-10-02' });
  const lines = shared.split('\n');
  ok('M8 share ends with the footer and one confirm line', lines[lines.length - 2] === 'Prepared in MAGE ID by Majeed Builders on Oct 2, 2026. Not reviewed by any building department.' && lines[lines.length - 1] === 'Confirm with Town of Hempstead Department of Buildings before you file.' && shared.split('Confirm with').length === 2, shared);
  ok('M8 every row carries a source label', lines.filter((l) => l.startsWith('- ')).every((l) => / · (https:\/\/|Department said · |Your answer|From your permits|Not known yet · Ask|NYC DOB data)/.test(l)), shared);
  ok('M8 a department row names the date and who', shared.includes('Department said · Sep 14, 2026 · J. Smith, plans examiner · phone'));
  const ask = routeSummaryForAsk(r);
  ok('S2 ask grounding names unknowns as unknown', ask.includes('Not known yet · Ask') && ask.includes('NY:3605934000'));
}

// ─────────────────────────────────────────────────────────────────────
// The real PPFACTS packs, when present: the same scenarios must build, and
// their routes join the shape and banned-word scans below.
// ─────────────────────────────────────────────────────────────────────
if (existsSync(join(__dirname, '..', 'utils', 'permitPath', 'packs', 'index.ts'))) {
  const real = (await import('../utils/permitPath/packs')) as { ALL_PACKS?: readonly QuestionPack[] };
  const RP = real.ALL_PACKS ?? [];
  ok('real packs: ALL_PACKS loads', RP.length > 0);
  if (RP.length) {
    const rn = build({ ...nyc1931In, answers: { ...nyc1931Answers, ...answersOf({ 'base.residential': 'one_two_family' }) } }, RP);
    ok('real packs: NYC landmark job carries LPC and the stated maximum', itemsOf(rn).some((i) => i.who.includes('lpc') && i.certainty === 'verified') && station(rn, 'checks').duration.kind === 'stated_max');
    const rh = build({ ...hempIn, deptAnswers: [surveyAnswer, otherTown] }, RP);
    ok('real packs: Hempstead survey answered, CO search still unknown', item(rh, 'li.survey')?.certainty === 'department_said' && item(rh, 'li.co_search')?.certainty === 'unknown');
    const rv = build(inputs({ jurisdiction: VILLAGE_J, office: villageAnswer.office }), RP);
    ok('real packs: village leads with village or town', nextQuestion(RP, ctxOf(VILLAGE_J, {}))?.prefill === 'permit_office' && rv.jurisdiction.cautions.includes(VILLAGE_CAUTION));
    const ru = build(inputs({ jurisdiction: UNRESOLVED_J }), RP);
    ok('real packs: unresolved has nothing verified', !itemsOf(ru).some((i) => i.certainty === 'verified'));
    build(inputs({ jurisdiction: NYC_J, answers: answersOf({ 'base.building_year': 1995, 'nyc.disturb_materials': 'yes' }), aiRoadmap: roadmap999 }), RP);
  }
}

// ─────────────────────────────────────────────────────────────────────
// M11.10 shape guard, M11.11 banned words, M11.12 determinism, M11.13 purity
// ─────────────────────────────────────────────────────────────────────
{
  // A broken pack: verified with no source, unknown with no question, source on an answer line.
  const broken: QuestionPack = { ...BASE, id: 'base', items: [
    { id: 'fx.v', station: 'scope', kind: 'fact', text: 'Fixture verified line.', who: [], certainty: 'verified', source: null, askQuestionId: null, readiness: false, when: null },
    { id: 'fx.u', station: 'scope', kind: 'fact', text: 'Fixture unknown line.', who: [], certainty: 'unknown', source: null, askQuestionId: null, readiness: false, when: null },
    { id: 'fx.a', station: 'scope', kind: 'fact', text: 'Fixture answer line.', who: [], certainty: 'your_answer', source: V5, askQuestionId: 'x', readiness: false, when: null },
  ] };
  build(inputs({ jurisdiction: HEMPSTEAD_J }), [broken]);
  let bad: string[] = [];
  for (const r of ALL_ROUTES) for (const i of itemsOf(r)) {
    if ((i.certainty === 'verified') !== (i.source !== null)) bad.push(`${i.id} verified/source`);
    if ((i.certainty === 'department_said') !== (i.answer !== null)) bad.push(`${i.id} said/answer`);
    if ((i.certainty === 'unknown') !== (i.askQuestionId !== null)) bad.push(`${i.id} unknown/ask`);
  }
  ok('M11.10 shape guard over every route', bad.length === 0, bad.slice(0, 5).join('; '));
  bad = [];
  for (const r of ALL_ROUTES) for (const s of r.stations) {
    if ((s.duration.kind === 'department_said') !== (s.duration.answer !== null)) bad.push(`${s.id} duration answer`);
    if (s.duration.kind === 'unknown' && /\d/.test(s.duration.label)) bad.push(`${s.id} unknown with a number`);
  }
  ok('M11.10 duration shape', bad.length === 0, bad.join('; '));

  const BANNED = /files permits|file for you|verified code|approved|compliant|guaranteed|permit-ready|dob-approved|certified/i;
  const clean = (s: string) => s.replace(/approved filings only/gi, '').replace(/Certified Asbestos Investigator/g, '');
  const copySrc = readFileSync(join(__dirname, '..', 'utils', 'permitPath', 'copy.ts'), 'utf8');
  ok('M11.11 banned words: copy.ts', !BANNED.test(clean(copySrc)), (clean(copySrc).match(BANNED) ?? [])[0]);
  const strings: string[] = [];
  const walk = (v: unknown, inAi: boolean) => {
    if (typeof v === 'string') { if (!inAi) strings.push(v); else if (/files permits|file for you/i.test(v)) strings.push(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, inAi)); return; }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const ai = inAi || o.certainty === 'ai_draft';
      for (const k of Object.keys(o)) walk(o[k], ai);
    }
  };
  ALL_ROUTES.forEach((r) => walk(r, false));
  const hits = strings.map(clean).filter((s) => BANNED.test(s));
  ok('M11.11 banned words: every fixture route', hits.length === 0, hits.slice(0, 3).join(' | '));
  ok('M11.11 banned words: shareText', !BANNED.test(clean(shared)));
  ok('M11.11 "files permits" never survives even in AI drafts', !ALL_ROUTES.some((r) => /files permits|file for you/i.test(JSON.stringify(r))));

  const a = buildPermitRoute({ ...hempIn, deptAnswers: [surveyAnswer, otherTown, { ...surveyAnswer, id: 'da-9', answeredOn: '2026-09-14' }] }, PACKS);
  const b = buildPermitRoute({ ...hempIn, deptAnswers: [{ ...surveyAnswer, id: 'da-9', answeredOn: '2026-09-14' }, otherTown, surveyAnswer] }, PACKS);
  ok('M11.12 shuffled department answers → same route', JSON.stringify(a) === JSON.stringify(b), `${a.inputsKey} vs ${b.inputsKey}`);
  ok('M11.12 same inputs → deep-equal route', JSON.stringify(buildPermitRoute(nyc1931In, PACKS)) === JSON.stringify(buildPermitRoute(nyc1931In, PACKS)));
  ok('M11.12 inputsKey moves with an input', buildPermitRoute({ ...nyc1931In, today: '2026-10-03' }, PACKS).inputsKey !== nyc1931.inputsKey);

  const ENGINE = ['types', 'predicate', 'jurisdiction', 'prefill', 'interview', 'durations', 'buildRoute', 'readiness', 'copy', 'index'];
  const impure: string[] = [];
  for (const f of ENGINE) {
    const src = readFileSync(join(__dirname, '..', 'utils', 'permitPath', `${f}.ts`), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    if (/from ['"]react(-native)?['"]|from ['"]react-native\//.test(code)) impure.push(`${f}: react`);
    if (/AsyncStorage/.test(code)) impure.push(`${f}: AsyncStorage`);
    if (/\bfetch\(/.test(code)) impure.push(`${f}: fetch(`);
    if (/Date\.now\(/.test(code)) impure.push(`${f}: Date.now(`);
    if (/new Date\(\s*\)/.test(code)) impure.push(`${f}: new Date()`);
    if (/Math\.random\(/.test(code)) impure.push(`${f}: Math.random(`);
  }
  ok('M11.13 purity scan', impure.length === 0, impure.join('; '));
}

console.log(`\nvalidate-permit-path-engine: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
