// utils/codeScopeTriggers.ts — Scope Code Gaps: the hand-written starter rule
// table. "Your scope says X; jobs with X usually need Y; Y is not in your
// estimate."
//
// HONESTY RULES this table holds (scripts/validate-code-scope-triggers.ts):
//   • family-level only ("NEC: GFCI") — never a code section number;
//   • no edition years in any text — the adopted edition comes from the
//     jurisdiction record (utils/codeJurisdiction), never from this table;
//   • it ships labelled a STARTER LIST not yet reviewed by the founder. When he
//     signs off the rule sheet, set CODE_SCOPE_RULES_REVIEW to
//     { status: 'founder_reviewed', reviewedOn: '<date>' } and ship that as
//     its own JS-only OTA.
//
// price.trade is a CATEGORY_META KEY (or 'general'); pricing always goes
// through utils/scopePricing.scopeRateFor, which maps it to the label the
// cost book stores.
//
// Pure data — no React, no storage, no network.
import type { ProjectType } from '@/types';

export type ScopeRuleFamily = 'IBC' | 'IRC' | 'IECC' | 'IEBC' | 'IPC' | 'IMC' | 'IFC' | 'IFGC' | 'NEC';

export interface CodeScopeRule {
  id: string;
  family: ScopeRuleFamily;
  /** 2–4 words; the line name on a change order. */
  topic: string;
  projects: 'res' | 'com' | 'all';
  projectTypes?: ProjectType[];
  triggers: string[];
  /** A line or note containing one of these never fires the rule. */
  excludeLinePhrases?: string[];
  requires: string;
  why: string;
  varies?: string;
  coveredBy: string[];
  price: { trade: string /* CATEGORY_META key or 'general' */; unit: string; qty: number | null };
  onlyStates?: string[];
  editionGate?: { family: 'NEC'; minYear: number };
}

export const CODE_SCOPE_RULES_REVIEW = {
  status: 'pending_founder_review' as 'pending_founder_review' | 'founder_reviewed',
  reviewedOn: null as string | null,
};

export const SCOPE_GAPS_STARTER_LABEL =
  'Starter list · 30 hand-written rules, not yet reviewed by you. Family-level (for example "NEC: GFCI"), never a code section. Your AHJ decides.';

const SERVICE_TRIGGERS = [
  'panel upgrade', 'service upgrade', 'service change', 'new service', '200a', '200 amp', '400 amp',
  'meter socket', 'main panel',
];
const REROOF_TRIGGERS = [
  'reroof', 're-roof', 'roof replacement', 'tear-off', 'tear off', 'shingles', 'asphalt shingle',
];
const ICE_DAM_STATES = [
  'CT', 'MA', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT', 'OH', 'MI', 'IN', 'IL', 'WI', 'MN', 'IA',
  'ND', 'SD', 'NE', 'MT', 'WY', 'ID', 'CO', 'UT', 'WA', 'OR', 'AK',
];

export const CODE_SCOPE_RULES: readonly CodeScopeRule[] = [
  {
    id: 'smoke-co-sleeping', family: 'IRC', topic: 'Smoke and CO alarms', projects: 'res',
    triggers: ['bedroom', 'sleeping room', 'basement finish', 'finished basement', 'finish basement', 'attic conversion', 'adu', 'accessory dwelling', 'in-law'],
    requires: 'Smoke alarms in each sleeping room and outside it, plus CO alarms where there is fuel-burning equipment or an attached garage, interconnected',
    why: 'New or altered sleeping space usually brings the alarms in that area up to current requirements.',
    varies: 'Some jurisdictions accept battery alarms where walls are not opened; hardwired interconnection is typical where they are.',
    coveredBy: ['smoke', 'carbon monoxide', 'co alarm', 'co detector'],
    price: { trade: 'electrical', unit: 'ea', qty: 2 },
  },
  {
    id: 'egress-basement-bedroom', family: 'IRC', topic: 'Basement egress window', projects: 'res',
    triggers: ['basement bedroom', 'bedroom in basement', 'basement sleeping', 'basement guest room'],
    requires: 'An emergency escape and rescue opening for the basement sleeping room (egress window, window well, and a ladder if the well is deep)',
    why: 'A sleeping room below grade needs a way out other than the stairs.',
    varies: 'Opening size, sill height and well dimensions are set by the adopted edition and local amendments.',
    coveredBy: ['egress', 'escape window', 'window well'],
    price: { trade: 'windows', unit: 'ea', qty: 1 },
  },
  {
    id: 'bath-exhaust', family: 'IRC', topic: 'Bath exhaust fan', projects: 'res',
    triggers: ['bathroom', 'bath remodel', 'shower', 'powder room', 'half bath'],
    requires: 'A bath exhaust fan ducted to the outdoors (some editions accept an operable window instead)',
    why: 'Bathrooms with a tub or shower need mechanical exhaust or natural ventilation.',
    varies: 'Whether a window alone is enough depends on the edition and local energy rules.',
    coveredBy: ['exhaust fan', 'bath fan', 'vent fan', 'ventilation fan'],
    price: { trade: 'hvac', unit: 'ea', qty: 1 },
  },
  {
    id: 'bath-gfci', family: 'NEC', topic: 'Bathroom GFCI protection', projects: 'all',
    triggers: ['bathroom', 'bath remodel', 'powder room', 'half bath', 'vanity'],
    requires: 'GFCI protection on the bathroom receptacles and their circuit',
    why: 'Bathroom receptacles need ground-fault protection.',
    varies: 'Which outlets and circuits need it widens with newer electrical code editions.',
    coveredBy: ['gfci', 'gfi', 'ground fault'],
    price: { trade: 'electrical', unit: 'ea', qty: 1 },
  },
  {
    id: 'kitchen-gfci-afci', family: 'NEC', topic: 'Kitchen GFCI and AFCI', projects: 'res',
    triggers: ['kitchen'],
    requires: 'GFCI on countertop receptacles, the small-appliance circuits, and AFCI on kitchen circuits where your NEC edition requires it',
    why: 'Kitchen countertop receptacles need ground-fault protection and two small-appliance circuits.',
    varies: 'AFCI in kitchens and GFCI on appliance outlets depend on the adopted electrical code edition.',
    coveredBy: ['gfci', 'afci', 'dual function', 'small appliance'],
    price: { trade: 'electrical', unit: 'ea', qty: 2 },
  },
  {
    id: 'habitable-afci', family: 'NEC', topic: 'AFCI protection', projects: 'res',
    triggers: ['bedroom', 'family room', 'living room', 'den', 'basement finish', 'finished basement', 'finish basement', 'addition', 'attic conversion'],
    requires: 'AFCI protection on new or extended branch circuits in habitable rooms',
    why: 'New or extended circuits feeding living spaces usually need arc-fault protection.',
    varies: 'Which rooms are covered, and the rules for extending old circuits, change by edition.',
    coveredBy: ['afci', 'arc fault', 'dual function'],
    price: { trade: 'electrical', unit: 'ea', qty: 2 },
  },
  {
    id: 'service-grounding-bonding', family: 'NEC', topic: 'Service grounding and bonding', projects: 'all',
    triggers: SERVICE_TRIGGERS,
    requires: 'The grounding electrode system and water/gas bonding brought up to current requirements with the new service',
    why: 'A new or upgraded service is inspected with its grounding and bonding.',
    varies: 'The utility and the AHJ may add their own requirements for electrodes and bonding.',
    coveredBy: ['grounding', 'ground rod', 'bonding', 'ufer', 'electrode'],
    price: { trade: 'electrical', unit: 'ls', qty: 1 },
  },
  {
    id: 'service-surge', family: 'NEC', topic: 'Service surge protection', projects: 'res',
    triggers: SERVICE_TRIGGERS,
    requires: 'A surge-protective device at the dwelling service',
    why: 'Newer electrical code editions call for surge protection when a dwelling service is replaced.',
    varies: 'Shown only where the adopted electrical code is new enough to require it; hidden where an older edition is on file; when no edition is on file it says so.',
    coveredBy: ['surge', 'spd'],
    price: { trade: 'electrical', unit: 'ea', qty: 1 },
    editionGate: { family: 'NEC', minYear: 2020 },
  },
  {
    id: 'electrical-load-calc', family: 'NEC', topic: 'Electrical load calculation', projects: 'all',
    triggers: ['ev charger', 'car charger', 'heat pump', 'induction', 'electric range', 'hot tub', 'spa', 'sauna', 'electric tankless'],
    requires: 'A load calculation showing the service can carry the new load',
    why: 'A large new electrical load needs proof the existing service can carry it.',
    varies: 'Some AHJs want it on the permit drawings; others only ask when the service looks tight.',
    coveredBy: ['load calc', 'load calculation', 'service upgrade', 'panel upgrade'],
    price: { trade: 'electrical', unit: 'ls', qty: 1 },
  },
  {
    id: 'water-heater-expansion', family: 'IPC', topic: 'Thermal expansion tank', projects: 'all',
    triggers: ['water heater', 'hot water heater'],
    excludeLinePhrases: ['tankless'],
    requires: 'A thermal expansion tank where the water system is closed (check valve, backflow preventer or PRV on the service)',
    why: 'A tank water heater on a closed system needs somewhere for expanding water to go.',
    varies: 'Depends on whether the water service has a check valve, backflow preventer or PRV.',
    coveredBy: ['expansion tank', 'thermal expansion'],
    price: { trade: 'plumbing', unit: 'ea', qty: 1 },
  },
  {
    id: 'shower-valve-antiscald', family: 'IPC', topic: 'Anti-scald shower valve', projects: 'all',
    triggers: ['shower valve', 'shower', 'bathtub', 'tub'],
    requires: 'A pressure-balance or thermostatic (anti-scald) mixing valve on the shower or tub',
    why: 'Shower and tub-shower valves need scald protection.',
    varies: 'Tub-only fillers and the temperature limit vary by edition and local plumbing code.',
    coveredBy: ['pressure balance', 'thermostatic', 'anti-scald', 'anti scald', 'mixing valve'],
    price: { trade: 'plumbing', unit: 'ea', qty: 1 },
  },
  {
    id: 'gas-trap-test', family: 'IFGC', topic: 'Sediment trap, pressure test', projects: 'all',
    triggers: ['gas line', 'gas piping', 'gas range', 'gas dryer', 'gas stove', 'gas fireplace', 'gas appliance', 'gas furnace', 'gas water heater', 'gas cooktop'],
    requires: 'A sediment trap (drip leg) at the gas appliance and a pressure test of the new gas piping',
    why: 'New gas piping is pressure tested, and most appliances need a sediment trap.',
    varies: 'Test pressure, duration and which appliances are exempt from the trap vary locally.',
    coveredBy: ['sediment trap', 'drip leg', 'dirt leg', 'pressure test'],
    price: { trade: 'plumbing', unit: 'ea', qty: 1 },
  },
  {
    id: 'appliance-venting', family: 'IFGC', topic: 'Appliance venting check', projects: 'all',
    triggers: ['furnace replacement', 'new furnace', 'boiler replacement', 'new boiler', 'high efficiency furnace', 'water heater replacement'],
    requires: 'The vent or chimney liner checked and sized for the new appliance',
    why: 'A replaced fuel-burning appliance must vent correctly, and an old chimney is often oversized for it.',
    varies: 'Whether a liner is needed depends on the appliance, the chimney and the local inspector.',
    coveredBy: ['chimney liner', 'flue liner', 'liner', 'b-vent', 'b vent', 'venting', 'vent kit'],
    price: { trade: 'hvac', unit: 'ls', qty: 1 },
  },
  {
    id: 'hvac-load-calc', family: 'IRC', topic: 'HVAC load calculation', projects: 'res',
    triggers: ['new hvac', 'hvac replacement', 'heat pump', 'mini split', 'central air', 'furnace', 'ductwork', 'ac system'],
    requires: 'A heating and cooling load calculation (Manual J/S) with the mechanical permit where the AHJ asks',
    why: 'Equipment is expected to be sized to a load calculation, not to the old unit.',
    varies: 'Many AHJs only ask for it on new systems or when equipment size changes.',
    coveredBy: ['manual j', 'load calc', 'load calculation'],
    price: { trade: 'hvac', unit: 'ls', qty: 1 },
  },
  {
    id: 'duct-leakage-test', family: 'IECC', topic: 'Duct leakage test', projects: 'res',
    triggers: ['new ductwork', 'ductwork', 'duct replacement', 'new ducts', 'attic ducts'],
    requires: 'A duct leakage test when ducts run outside conditioned space',
    why: 'The energy code tests duct tightness when ducts run through unconditioned space.',
    varies: 'Thresholds and exemptions for small alterations depend on the adopted energy code.',
    coveredBy: ['duct test', 'duct leakage', 'duct blaster'],
    price: { trade: 'hvac', unit: 'ls', qty: 1 },
  },
  {
    id: 'blower-door', family: 'IECC', topic: 'Blower-door test', projects: 'res',
    projectTypes: ['new_build', 'addition'],
    triggers: ['gut renovation', 'gut rehab'],
    requires: 'An air-leakage (blower-door) test for new construction',
    why: 'The energy code tests whole-house air leakage on new construction.',
    varies: 'Additions and gut renovations are treated differently from one jurisdiction to the next.',
    coveredBy: ['blower door', 'air leakage test', 'hers'],
    price: { trade: 'general', unit: 'ls', qty: 1 },
  },
  {
    id: 'dryer-exhaust', family: 'IRC', topic: 'Dryer exhaust duct', projects: 'res',
    triggers: ['laundry', 'dryer', 'washer/dryer', 'laundry room'],
    requires: 'A dryer exhaust duct run to the outdoors in smooth metal, within the length limit',
    why: 'A clothes dryer exhausts outdoors through a rigid metal duct of limited length.',
    varies: 'The length limit can follow the dryer maker’s instructions where they are on site.',
    coveredBy: ['dryer vent', 'dryer exhaust', 'dryer duct'],
    price: { trade: 'hvac', unit: 'ea', qty: 1 },
  },
  {
    id: 'range-hood-makeup-air', family: 'IRC', topic: 'Range hood makeup air', projects: 'res',
    triggers: ['range hood', 'hood vent', 'vent hood', 'pro range', 'professional range'],
    requires: 'Makeup air if the hood exhausts more than 400 cfm (check the hood\'s rating; mark N/A if it is smaller)',
    why: 'A large kitchen exhaust hood can depressurize the house without makeup air.',
    varies: 'Some jurisdictions set a different threshold or do not enforce it on remodels.',
    coveredBy: ['makeup air', 'make-up air', 'mua'],
    price: { trade: 'hvac', unit: 'ea', qty: 1 },
  },
  {
    id: 'deck-guards', family: 'IRC', topic: 'Deck guard and railing', projects: 'res',
    triggers: ['deck', 'porch', 'balcony', 'raised patio'],
    requires: 'Guards on open sides more than 30 inches above grade, plus handrails on the deck stairs',
    why: 'A raised walking surface needs guards on its open sides, and its stairs need a handrail.',
    varies: 'Guard height, opening size and load requirements vary with local amendments.',
    coveredBy: ['guard', 'railing', 'rail', 'baluster'],
    price: { trade: 'decking', unit: 'lf', qty: null },
  },
  {
    id: 'deck-ledger', family: 'IRC', topic: 'Deck ledger flashing', projects: 'res',
    triggers: ['deck', 'ledger'],
    requires: 'Ledger flashing and a lateral-load connection where the deck attaches to the house',
    why: 'A ledger-attached deck needs flashing and a positive connection to the house.',
    varies: 'Some AHJs publish their own deck guide with specific details.',
    coveredBy: ['ledger flashing', 'flashing', 'lateral load', 'hold-down', 'hold down'],
    price: { trade: 'decking', unit: 'ls', qty: 1 },
  },
  {
    id: 'stair-handrail-lighting', family: 'IRC', topic: 'Stair handrail and lighting', projects: 'res',
    triggers: ['stair', 'stairs', 'staircase', 'stairway'],
    requires: 'A handrail (and guards at open sides) and stair lighting switched at top and bottom',
    why: 'Stairs need a graspable handrail, guards where open, and lighting controlled from both ends.',
    varies: 'Handrail height, geometry and the number of risers that trigger it vary locally.',
    coveredBy: ['handrail', 'railing', 'balustrade'],
    price: { trade: 'lumber', unit: 'lf', qty: null },
  },
  {
    id: 'garage-separation', family: 'IRC', topic: 'Garage fire-rated separation', projects: 'res',
    triggers: ['attached garage', 'garage conversion', 'room over garage', 'bonus room'],
    requires: 'Fire separation (gypsum board) between the garage and the house and a solid or self-closing door where required',
    why: 'An attached garage is separated from living space by gypsum board and a rated or solid door.',
    varies: 'Board type, door rating and self-closer rules differ between jurisdictions.',
    coveredBy: ['type x', '5/8', 'fire rated', 'fire-rated', 'self-closing', 'self closing', 'fire door'],
    price: { trade: 'drywall', unit: 'sf', qty: null },
  },
  {
    id: 'safety-glazing', family: 'IRC', topic: 'Safety glazing', projects: 'all',
    triggers: ['shower door', 'shower glass', 'glass enclosure', 'tub enclosure', 'patio door', 'sliding door', 'french door', 'window replacement', 'replacement window'],
    requires: 'Safety (tempered or laminated) glazing in hazardous locations: doors, next to tubs and showers, near doors and stairs, large low panes',
    why: 'Glass in places people can fall or walk into must be safety glazing.',
    varies: 'The list of hazardous locations shifts slightly between editions.',
    coveredBy: ['tempered', 'safety glass', 'safety glazing', 'laminated'],
    price: { trade: 'windows', unit: 'ea', qty: null },
  },
  {
    id: 'reroof-ice-barrier', family: 'IRC', topic: 'Eave ice barrier', projects: 'res',
    triggers: REROOF_TRIGGERS,
    requires: 'An ice barrier at the eaves where the AHJ requires it (areas with a history of ice damming)',
    why: 'Where ice dams are common, the roof needs an ice barrier at the eaves.',
    varies: 'Only where the local building department says ice damming is a risk.',
    coveredBy: ['ice barrier', 'ice and water', 'ice shield'],
    price: { trade: 'roofing', unit: 'sf', qty: null },
    onlyStates: ICE_DAM_STATES,
  },
  {
    id: 'reroof-drip-edge', family: 'IRC', topic: 'Roof drip edge', projects: 'res',
    triggers: REROOF_TRIGGERS,
    requires: 'Drip edge at eaves and rake edges for asphalt shingles',
    why: 'Asphalt shingle roofs need drip edge at eaves and rakes.',
    varies: 'Some older adoptions do not require it on reroofs.',
    coveredBy: ['drip edge'],
    price: { trade: 'roofing', unit: 'lf', qty: null },
  },
  {
    id: 'accessible-restroom', family: 'IBC', topic: 'Accessible restroom fixtures', projects: 'com',
    triggers: ['restroom', 'bathroom', 'toilet room', 'washroom'],
    requires: 'Accessible fixtures, clearances, grab bars and lever hardware in the restroom',
    why: 'Commercial restrooms that are altered usually need to be accessible.',
    varies: 'How much of an existing building must be upgraded depends on the alteration and local rules.',
    coveredBy: ['grab bar', 'ada', 'accessible'],
    price: { trade: 'plumbing', unit: 'ea', qty: null },
  },
  {
    id: 'exit-emergency-lighting', family: 'IBC', topic: 'Exit and emergency lighting', projects: 'com',
    triggers: ['fit-out', 'fit out', 'tenant improvement', 'build-out', 'buildout', 'office', 'retail', 'restaurant', 'demising'],
    requires: 'Exit signs and emergency egress lighting with battery backup',
    why: 'A commercial space needs lit exit signs and emergency lighting along the way out.',
    varies: 'The fire marshal often sets the layout at the inspection.',
    coveredBy: ['exit sign', 'emergency light', 'egress light', 'emergency lighting'],
    price: { trade: 'electrical', unit: 'ea', qty: null },
  },
  {
    id: 'firestopping', family: 'IBC', topic: 'Penetration firestopping', projects: 'com',
    triggers: ['rated wall', 'demising wall', 'corridor wall', 'fire wall', 'firewall', 'rated ceiling', 'shaft'],
    requires: 'Listed fire-stopping at every penetration of a fire-rated wall or ceiling',
    why: 'Every pipe, duct or cable through a rated assembly must be sealed with a listed system.',
    varies: 'Inspection of firestopping varies from spot checks to special inspection.',
    coveredBy: ['firestop', 'fire stop', 'fire caulk', 'fire-stopping', 'firestopping'],
    price: { trade: 'general', unit: 'ls', qty: 1 },
  },
  {
    id: 'hood-suppression', family: 'IMC', topic: 'Kitchen hood suppression', projects: 'com',
    triggers: ['commercial kitchen', 'cooking line', 'type i hood', 'type 1 hood', 'grease hood', 'fryer'],
    requires: 'A Type I grease hood with a fire-suppression system and makeup air',
    why: 'Commercial cooking that makes grease needs a Type I hood with fire suppression.',
    varies: 'The fire department usually permits and tests the suppression system separately.',
    coveredBy: ['ansul', 'suppression'],
    price: { trade: 'hvac', unit: 'ls', qty: 1 },
  },
  {
    id: 'backflow-irrigation', family: 'IPC', topic: 'Irrigation backflow preventer', projects: 'all',
    triggers: ['irrigation', 'lawn sprinkler', 'drip irrigation'],
    requires: 'A backflow preventer on the irrigation supply, tested and registered with the water utility',
    why: 'An irrigation system connected to drinking water needs backflow protection.',
    varies: 'The device type and the testing program are set by the local water utility.',
    coveredBy: ['backflow', 'rpz', 'pvb', 'double check'],
    price: { trade: 'plumbing', unit: 'ea', qty: 1 },
  },
];
