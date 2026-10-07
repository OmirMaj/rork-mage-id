// utils/codeFlags/rules.ts — Code Flags (Big Bets, Bet 4, Phase 1): the rule
// table. Thirteen KINDS OF WORK that are commonly looked at on a permit or by
// an inspector, each with the words that trigger it and the words that
// deliberately do not.
//
// WHAT THIS IS BUILT ON (and where the study that asked for it was wrong).
//   The study said the app already "spots nine families of code-sensitive
//   work". It does not. utils/codeScopeTriggers holds THIRTY scope-gap rules
//   filed under nine MODEL-CODE BOOKS (IBC, IRC, IECC, IEBC, IPC, IMC, IFC,
//   IFGC, NEC). Those rules answer "this job usually also needs X, and X is
//   not in your estimate"; many fire on a whole room ("kitchen", "bathroom",
//   "office"). Matched against one line they would flag nearly every line of
//   a kitchen job, so they are not a per-line table. What IS reused, by
//   reference and pinned by scripts/validate-code-flags.ts:
//     - the nine book names (ScopeRuleFamily): every family here names the
//       books it sits under, and all nine are covered;
//     - the trigger phrases of the existing rules that already name a KIND OF
//       WORK (service upgrades, big new loads, gas piping, rated walls,
//       appliance venting, new HVAC, range hoods, basement bedrooms, ...),
//       read off CODE_SCOPE_RULES at load so the two tables cannot drift;
//     - the two building-age rules (utils/buildingScopeTriggers): the same
//       years (before 1978; New York City, 1987 and earlier) and, for lead,
//       exactly the same trigger words.
//
// HONESTY RULES this table holds (scripts/validate-code-flags.ts):
//   - it is a STARTER LIST: CODE_FLAG_RULES_REVIEW says who has read it;
//   - matching is words on the line, never a model call;
//   - a family holds no code text and no section number. The few section
//     numbers the app has checked live in utils/codeFlags/place.ts;
//   - every `quiet` phrase is proved NOT to fire its family when it is the
//     whole line.
//
// HOW A LINE IS MATCHED (utils/codeFlags/match.ts)
//   1. the line's name and description are lower-cased and stripped of
//      punctuation (utils/scopeCoverage.normalizeScopeText);
//   2. every `mask` phrase of the family is blanked out of that text first
//      ("panel door" is gone before "panel" is looked for);
//   3. a family with a `veto` word anywhere on the line does not fire at all;
//   4. a `triggers` phrase must then appear as whole words (a plural "s" on
//      the last word is accepted);
//   5. a `categoryTriggers` phrase counts only when the line's category or CSI
//      division is one of the listed ones ("panel" on an Electrical line).
//
// Pure data: no React, no storage, no network.
import { CODE_SCOPE_RULES, type ScopeRuleFamily } from '@/utils/codeScopeTriggers';
import { ACP5_LAST_YEAR, BUILDING_TRIGGER_PHRASES, RRP_CUTOFF_YEAR } from '@/utils/buildingScopeTriggers';

export type CodeFlagFamilyId =
  | 'egress'
  | 'fire_rating'
  | 'fire_protection'
  | 'structural'
  | 'electrical_service'
  | 'plumbing'
  | 'gas'
  | 'mechanical'
  | 'change_of_use'
  | 'energy_tests'
  | 'decks_stairs'
  | 'lead_age'
  | 'asbestos_age';

/** 'permit' families fire on the line's words anywhere. 'building_age'
 *  families also need the building's year (and, for asbestos, New York City). */
export type CodeFlagKind = 'permit' | 'building_age';

export interface CodeFlagCategoryTrigger {
  /** CATEGORY_META keys or labels, or two-digit CSI divisions. */
  categories: readonly string[];
  phrases: readonly string[];
}

export interface CodeFlagFamily {
  id: CodeFlagFamilyId;
  kind: CodeFlagKind;
  /** The model-code books this kind of work sits under (the existing nine).
   *  Empty for the two building-age rules: they are not model-code rules. */
  books: readonly ScopeRuleFamily[];
  /** ids of the CODE_SCOPE_RULES rules whose phrases were reused. */
  reuses: readonly string[];
  triggers: readonly string[];
  categoryTriggers?: readonly CodeFlagCategoryTrigger[];
  /** Blanked out of the line before the triggers are looked for. */
  mask: readonly string[];
  /** Any of these anywhere on the line: the family does not fire. */
  veto?: readonly string[];
  /** Lines that look close and must NOT fire this family (proved by the validator). */
  quiet: readonly string[];
}

/** Who has read this table. Flip with the founder's sign-off on
 *  design-previews/big-bets/CODE-FLAGS-RULES.md, as its own change. */
export const CODE_FLAG_RULES_REVIEW = {
  status: 'pending_founder_review' as 'pending_founder_review' | 'founder_reviewed',
  reviewedOn: null as string | null,
  professionalReview: 'none' as 'none' | 'architect_or_expediter',
};

function existing(id: string) {
  const rule = CODE_SCOPE_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`utils/codeFlags/rules: CODE_SCOPE_RULES has no rule "${id}"`);
  return rule;
}
/** The existing rule's trigger phrases, minus the ones that name a whole room
 *  or are too loose for a single line. */
function reuse(id: string, skip: readonly string[] = []): string[] {
  const all = existing(id).triggers;
  for (const s of skip) if (!all.includes(s)) throw new Error(`utils/codeFlags/rules: "${s}" is not a trigger of "${id}"`);
  return all.filter((t) => !skip.includes(t));
}
/** The existing rule's "already covered by" phrases (the names of the test or
 *  the part itself), minus the loose ones. */
function reuseCovered(id: string, skip: readonly string[] = []): string[] {
  const all = existing(id).coveredBy;
  for (const s of skip) if (!all.includes(s)) throw new Error(`utils/codeFlags/rules: "${s}" is not a coveredBy of "${id}"`);
  return all.filter((t) => !skip.includes(t));
}

/** What was taken from the existing table, for the validator's pin. */
export const CODE_FLAG_REUSE: Readonly<Record<string, { skipTriggers: readonly string[]; from: 'triggers' | 'coveredBy' }>> = {
  'egress-basement-bedroom': { skipTriggers: [], from: 'triggers' },
  firestopping: { skipTriggers: ['shaft'], from: 'triggers' },
  'garage-separation': { skipTriggers: ['attached garage', 'garage conversion', 'bonus room'], from: 'triggers' },
  'hood-suppression': { skipTriggers: ['commercial kitchen', 'cooking line', 'fryer'], from: 'triggers' },
  'service-grounding-bonding': { skipTriggers: [], from: 'triggers' },
  'electrical-load-calc': { skipTriggers: ['spa'], from: 'triggers' },
  'water-heater-expansion': { skipTriggers: [], from: 'triggers' },
  'gas-trap-test': { skipTriggers: [], from: 'triggers' },
  'appliance-venting': { skipTriggers: [], from: 'triggers' },
  'hvac-load-calc': { skipTriggers: [], from: 'triggers' },
  'range-hood-makeup-air': { skipTriggers: ['pro range', 'professional range'], from: 'triggers' },
  'smoke-co-sleeping': { skipTriggers: ['bedroom', 'sleeping room'], from: 'triggers' },
  'blower-door': { skipTriggers: ['hers'], from: 'coveredBy' },
  'duct-leakage-test': { skipTriggers: [], from: 'coveredBy' },
  'deck-ledger': { skipTriggers: ['deck'], from: 'triggers' },
};
function take(id: keyof typeof CODE_FLAG_REUSE & string): string[] {
  const r = CODE_FLAG_REUSE[id];
  return r.from === 'triggers' ? reuse(id, r.skipTriggers) : reuseCovered(id, r.skipTriggers);
}

function uniq(list: readonly string[]): string[] {
  return [...new Set(list)];
}

export const CODE_FLAG_FAMILIES: readonly CodeFlagFamily[] = [
  {
    id: 'egress', kind: 'permit', books: ['IBC', 'IRC'],
    reuses: ['egress-basement-bedroom'],
    triggers: uniq([
      ...take('egress-basement-bedroom'),
      'egress', 'exit door', 'exit sign', 'exit stair', 'exit corridor', 'exit passageway', 'emergency exit',
      'fire escape', 'window well', 'panic hardware', 'panic bar', 'exit device',
      'emergency lighting', 'emergency light', 'exit lighting', 'exit light',
      'relocate stair', 'move stair', 'stair relocation', 'remove stair',
      'new exterior door', 'add exterior door', 'remove exterior door', 'relocate exterior door',
      'infill door', 'block up door', 'brick up door',
    ]),
    mask: [],
    quiet: ['exit interview', 'exit strategy meeting', 'final exit cleaning', 'interior door slab', 'stair runner carpet'],
  },
  {
    id: 'fire_rating', kind: 'permit', books: ['IBC', 'IFC'],
    reuses: ['firestopping', 'garage-separation'],
    triggers: uniq([
      ...take('firestopping'),
      ...take('garage-separation'),
      'fire rated', 'fire rating', 'rated door', 'rated assembly', 'rated partition', 'rated shaft',
      'fire door', 'fire barrier', 'fire partition', 'fire separation', 'garage separation',
      'shaft wall', 'shaft enclosure', 'shaft liner', 'elevator shaft',
      'firestop', 'fire stop', 'firestopping', 'fire stopping', 'fire caulk', 'fire caulking',
      'fire damper', 'smoke damper', 'fire blocking', 'fireblocking', 'fire block', 'draftstop', 'draft stop',
      'type x', 'hour rated', 'hr rated', 'hour fire', 'hr fire', 'hour wall', 'hr wall', 'hour ceiling',
      'hour partition', 'hour shaft', 'hour door', 'minute door', 'min door', 'minute rated',
      'intumescent', 'fireproofing', 'fire proofing', 'self closing',
    ]),
    mask: [
      'fire pit', 'fire table', 'fire bowl', 'fire feature', 'fire ring',
      'network firewall', 'firewall router', 'firewall software', 'firewall appliance',
    ],
    quiet: ['fire pit', 'gas fire pit kit', 'fireplace mantel', 'network firewall', 'energy star rated dishwasher', 'fire extinguisher', '2 hour minimum labor'],
  },
  {
    id: 'fire_protection', kind: 'permit', books: ['IFC', 'IBC', 'IMC'],
    reuses: ['hood-suppression'],
    triggers: uniq([
      ...take('hood-suppression'),
      'fire sprinkler', 'sprinkler head', 'sprinkler system', 'sprinkler main', 'sprinkler line', 'sprinkler pipe',
      'sprinkler piping', 'relocate sprinkler', 'sprinkler relocation', 'standpipe',
      'fire alarm', 'pull station', 'smoke detector', 'smoke alarm', 'co detector', 'co alarm', 'carbon monoxide',
      'heat detector', 'horn strobe', 'fire pump', 'fire department connection',
      'ansul', 'hood suppression', 'suppression system', 'kitchen suppression',
    ]),
    mask: ['lawn sprinkler', 'sprinkler timer', 'sprinkler controller'],
    veto: ['irrigation', 'lawn', 'garden', 'landscape', 'landscaping', 'yard', 'drip'],
    quiet: ['lawn sprinkler system', 'irrigation sprinkler head', 'sprinkler system for the garden', 'smoke shop signage'],
  },
  {
    id: 'structural', kind: 'permit', books: ['IBC', 'IRC', 'IEBC'],
    reuses: [],
    triggers: [
      'load bearing', 'bearing wall', 'structural', 'beam', 'lvl', 'glulam', 'header', 'girder', 'joist',
      'rafter', 'truss', 'lintel', 'lally column', 'steel column', 'support column', 'support post',
      'footing', 'foundation', 'underpinning', 'underpin', 'shoring', 'retaining wall',
      'remove wall', 'removing wall', 'wall removal', 'take down wall', 'knock down wall', 'demo wall',
      'new doorway', 'widen doorway', 'new door opening', 'new window opening', 'new opening',
      'enlarge opening', 'widen opening', 'cut opening',
      'helical pier', 'concrete pier', 'dormer', 'addition', 'second story', 'second floor addition', 'bump out',
      'roof framing', 'floor framing',
    ],
    mask: [
      'non load bearing', 'non bearing', 'nonbearing', 'non structural', 'nonstructural',
      'faux beam', 'decorative beam', 'box beam', 'beam wrap', 'laser beam',
      'in addition', 'addition to scope', 'addition to contract',
      'foundation planting', 'foundation plants', 'foundation vent', 'foundation paint', 'foundation coating',
      'foundation sealer', 'foundation waterproofing',
    ],
    quiet: [
      'faux beam for the living room ceiling', 'in addition to the base scope', 'foundation planting bed',
      'remove non load bearing partition', 'laser beam level rental', 'post light at the driveway',
    ],
  },
  {
    id: 'electrical_service', kind: 'permit', books: ['NEC'],
    reuses: ['service-grounding-bonding', 'electrical-load-calc'],
    triggers: uniq([
      ...take('service-grounding-bonding'),
      ...take('electrical-load-calc'),
      'subpanel', 'sub panel', 'electrical panel', 'electric panel', 'breaker panel', 'breaker box', 'fuse box',
      'panel replacement', 'replace panel', 'panel swap', 'panel change',
      '100 amp', '125 amp', '150 amp', '320 amp',
      'meter pan', 'meter upgrade', 'meter relocation', 'relocate meter', 'electric meter',
      'service entrance', 'service drop', 'service mast', 'service cable', 'feeder',
      'new circuit', 'dedicated circuit', 'add circuit', 'additional circuit', 'branch circuit',
      'rewire', 'rewiring', 'knob and tube', 'aluminum wiring',
      'generator', 'transfer switch', 'load calculation', 'load calc',
      'solar panel', 'solar array', 'pv system', 'photovoltaic', 'battery storage', 'powerwall',
      'level 2 charger', 'ev charging', '240v', '240 volt', '220v', '220 volt',
    ]),
    categoryTriggers: [
      { categories: ['electrical', '26'], phrases: ['panel', 'service', 'meter', 'circuit', 'feeder'] },
    ],
    mask: [
      'panel door', 'door panel', 'wall panel', 'wood panel', 'panel molding', 'panel moulding', 'access panel',
      'glass panel', 'shower panel', 'fence panel', 'raised panel', 'flat panel', 'cabinet panel', 'end panel',
      'filler panel', 'appliance panel', 'dishwasher panel', 'refrigerator panel', 'fridge panel',
      'lattice panel', 'acoustic panel', 'ceiling panel', 'frp panel', 'sip panel', 'tub panel', 'bath panel',
      'side panel', 'skirt panel', 'toe kick panel', 'control panel',
      'service call', 'service fee', 'service charge', 'customer service', 'service door', 'service sink',
      'food service', 'service elevator', 'service visit', 'service agreement', 'service contract', 'service plan',
      'bird feeder', 'steam generator', 'generator rental', 'rent generator', 'portable generator',
      'solar shade', 'solar screen', 'solar tube', 'solar light', 'solar film',
    ],
    quiet: [
      'panel door', 'six panel door slab', 'access panel for the tub', 'service call fee', 'bird feeder post',
      'steam generator for the shower', 'solar shade for the patio', 'replace outlet cover', 'portable generator rental',
    ],
  },
  {
    id: 'plumbing', kind: 'permit', books: ['IPC'],
    reuses: ['water-heater-expansion'],
    triggers: uniq([
      ...take('water-heater-expansion'),
      'add bathroom', 'new bathroom', 'additional bathroom', 'add bath', 'add half bath', 'new half bath',
      'add powder room', 'new powder room',
      'add toilet', 'additional toilet', 'relocate toilet', 'move toilet', 'toilet relocation',
      'add sink', 'additional sink', 'relocate sink', 'move sink', 'sink relocation',
      'add shower', 'new shower', 'relocate shower', 'move shower', 'add tub', 'relocate tub', 'move tub',
      'tub to shower', 'wet bar', 'bar sink', 'prep sink', 'second sink', 'utility sink', 'slop sink', 'mop sink',
      'laundry sink', 'plumbing fixture', 'fixture count',
      'rough plumbing', 'plumbing rough', 'rough in plumbing',
      'new drain', 'drain line', 'waste line', 'waste pipe', 'vent stack', 'soil stack', 'stack replacement',
      'replace stack', 'sewer line', 'sewer lateral', 'house trap', 'house sewer', 'water service', 'water main',
      'repipe', 're pipe', 'repiping', 'relocate plumbing', 'move plumbing', 'relocate drain', 'move drain',
      'backflow', 'rpz', 'sump pump', 'ejector pump', 'sewage ejector', 'grease trap', 'grease interceptor',
      'floor drain', 'washer hookup', 'laundry hookup', 'washer box', 'pot filler', 'hose bib', 'hose bibb',
      'tankless', 'water meter', 'pressure reducing valve', 'expansion tank',
    ]),
    categoryTriggers: [
      { categories: ['plumbing', '22'], phrases: ['rough in', 'relocate', 'relocation', 'new line', 'new fixture', 'add fixture', 'additional fixture'] },
    ],
    mask: [
      'shower curtain', 'shower door', 'shower head', 'showerhead', 'shower rod', 'shower glass', 'shower niche',
      'shower shelf', 'shower caddy',
    ],
    quiet: ['replace faucet', 'toilet seat', 'new shower curtain rod', 'new shower door', 'drain cleaning', 'new light fixture', 'caulk tub'],
  },
  {
    id: 'gas', kind: 'permit', books: ['IFGC'],
    reuses: ['gas-trap-test'],
    triggers: uniq([
      ...take('gas-trap-test'),
      'gas pipe', 'gas meter', 'gas service', 'gas shutoff', 'gas shut off', 'gas valve', 'gas leak',
      'gas connection', 'gas hookup', 'gas hook up', 'gas boiler', 'gas insert', 'gas log', 'gas heater',
      'gas test', 'gas pressure test', 'gas riser', 'gas main', 'gas conversion', 'convert to gas', 'oil to gas',
      'natural gas', 'propane', 'lp gas', 'csst', 'black iron pipe', 'black pipe',
    ]),
    mask: [
      'gas station', 'gas lift', 'gas strut', 'gas spring', 'gas mileage', 'gas money', 'gas surcharge',
      'argon gas', 'gas filled', 'gas can', 'gas powered', 'gas cap', 'propane torch',
    ],
    quiet: ['gas mileage and travel', 'argon gas filled window', 'gas strut for the hatch', 'gas powered compressor rental', 'gasket for the toilet'],
  },
  {
    id: 'mechanical', kind: 'permit', books: ['IMC', 'IRC'],
    reuses: ['appliance-venting', 'hvac-load-calc', 'range-hood-makeup-air'],
    triggers: uniq([
      ...take('appliance-venting'),
      ...take('hvac-load-calc'),
      ...take('range-hood-makeup-air'),
      'dryer vent', 'dryer exhaust', 'dryer duct', 'exhaust fan', 'bath fan', 'bathroom fan', 'kitchen exhaust',
      'exhaust duct', 'exhaust hood', 'makeup air', 'make up air', 'erv', 'hrv', 'air handler', 'condenser',
      'condensing unit', 'rooftop unit', 'rtu', 'boiler', 'chimney liner', 'flue', 'flue liner', 'b vent',
      'direct vent', 'power vent', 'ventilation', 'fresh air intake', 'new duct', 'duct relocation',
      'relocate duct', 'duct run', 'split system', 'ptac', 'unit heater', 'air conditioning', 'air conditioner',
      'hvac system', 'new ac', 'ac replacement', 'ac unit', 'relocate radiator', 'new radiator', 'steam pipe',
      'steam riser', 'hydronic', 'oil tank', 'oil burner',
    ]),
    mask: [
      'soffit vent', 'ridge vent', 'gable vent', 'roof vent', 'foundation vent', 'attic ventilation',
      'roof ventilation', 'vent cleaning', 'duct cleaning', 'dryer vent cleaning', 'vent cover',
      'furnace filter', 'filter change', 'furnace cleaning', 'furnace tune up', 'hvac service', 'hvac maintenance',
      'ac service', 'ac tune up', 'boiler service', 'boiler cleaning', 'air compressor',
      'window air conditioner', 'window ac', 'portable air conditioner', 'portable ac',
    ],
    quiet: ['ridge vent', 'dryer vent cleaning', 'furnace filter change', 'ceiling fan install', 'window air conditioner sleeve', 'soffit vent strip'],
  },
  {
    id: 'change_of_use', kind: 'permit', books: ['IBC', 'IEBC'],
    reuses: ['smoke-co-sleeping'],
    triggers: uniq([
      ...take('smoke-co-sleeping'),
      'change of use', 'change of occupancy', 'change in use', 'change in occupancy',
      'certificate of occupancy', 'c of o',
      'garage conversion', 'convert garage', 'basement apartment', 'convert basement', 'basement conversion',
      'convert attic', 'in law suite', 'in law apartment',
      'two family conversion', 'convert to two family', 'convert to three family',
      'add dwelling unit', 'new dwelling unit', 'additional dwelling unit',
      'convert to office', 'convert to residential', 'convert to retail', 'convert to restaurant',
      'convert to apartment', 'convert storefront',
      'add bedroom', 'additional bedroom', 'bedroom addition', 'convert to bedroom', 'create bedroom',
      'legalize', 'legalization', 'occupancy load', 'occupant load', 'place of assembly', 'public assembly',
    ]),
    mask: [],
    quiet: ['convert to led lighting', 'bedroom door hardware', 'paint the bedroom', 'basement window well cover cleaning'],
  },
  {
    id: 'energy_tests', kind: 'permit', books: ['IECC'],
    reuses: ['blower-door', 'duct-leakage-test'],
    triggers: uniq([
      ...take('blower-door'),
      ...take('duct-leakage-test'),
      'energy code', 'manual j', 'rescheck', 'comcheck', 'hers rating', 'hers rater',
      'insulation inspection', 'energy inspection',
    ]),
    mask: [],
    quiet: ['his and hers vanity', 'energy star refrigerator', 'attic insulation r 38'],
  },
  {
    id: 'decks_stairs', kind: 'permit', books: ['IRC', 'IBC'],
    reuses: ['deck-ledger'],
    triggers: uniq([
      ...take('deck-ledger'),
      'new deck', 'build deck', 'deck framing', 'deck addition', 'deck extension', 'rebuild deck', 'replace deck',
      'deck replacement', 'deck footing', 'ledger board', 'rooftop deck', 'roof deck',
      'guardrail', 'guard rail', 'handrail', 'hand rail', 'new railing', 'replace railing', 'railing replacement',
      'stair railing', 'balcony',
      'new stair', 'new staircase', 'stair replacement', 'replace stair', 'rebuild stair', 'exterior stair',
      'stair stringer',
      'new porch', 'rebuild porch', 'porch roof', 'porch addition', 'rebuild stoop', 'new stoop',
    ]),
    mask: [
      'roof decking', 'deck board', 'decking board', 'deck stain', 'deck staining', 'deck sealing', 'deck sealer',
      'deck cleaning', 'deck wash', 'stair runner', 'stair carpet',
      'ledger stone', 'stone ledger', 'ledger panel', 'balcony furniture',
    ],
    quiet: ['deck stain and seal', 'replace deck boards', 'ledger stone veneer', 'stair runner carpet', 'replace roof decking', 'power wash the deck'],
  },
  {
    // The existing lead rule (utils/buildingScopeTriggers 'rrp'): the SAME
    // trigger words, the same year. Fires only on a residential job whose
    // building is on file as built before RRP_CUTOFF_YEAR.
    id: 'lead_age', kind: 'building_age', books: [],
    reuses: [],
    triggers: [...BUILDING_TRIGGER_PHRASES],
    mask: [
      'window treatment', 'window blind', 'window shade', 'window cleaning', 'window screen', 'window film',
      'door mat', 'door bell', 'door stop', 'tree trim', 'trim tree', 'trim hedge', 'trim bush',
    ],
    quiet: ['window treatment install', 'trim trees along the fence', 'door mat', 'carpet cleaning'],
  },
  {
    // The existing asbestos rule (utils/buildingScopeTriggers 'acp5') fires on
    // the building's year alone, for a job that needs a permit. A LINE has no
    // such thing, so here it fires when the line has one of the words below,
    // or when the line already carries a 'permit' flag. New York City only,
    // built ACP5_LAST_YEAR or earlier.
    id: 'asbestos_age', kind: 'building_age', books: [],
    reuses: [],
    triggers: [
      'asbestos', 'demo', 'demolition', 'gut', 'abatement', 'plaster', 'pipe insulation', 'boiler insulation',
      'popcorn ceiling', 'tear out', 'tear off', 'floor tile removal', 'vinyl tile removal', 'remove flooring',
      'flooring removal', 'siding removal', 'remove siding',
    ],
    mask: ['demo day lunch'],
    quiet: ['gutter cleaning', 'snow removal', 'new sod'],
  },
];

export const CODE_FLAG_FAMILY_IDS: readonly CodeFlagFamilyId[] = CODE_FLAG_FAMILIES.map((f) => f.id);

export function codeFlagFamily(id: CodeFlagFamilyId): CodeFlagFamily {
  const f = CODE_FLAG_FAMILIES.find((x) => x.id === id);
  if (!f) throw new Error(`utils/codeFlags/rules: no family "${id}"`);
  return f;
}

/** The two building-age years, read off the existing rules (never restated). */
export const LEAD_BUILT_BEFORE = RRP_CUTOFF_YEAR;
export const ASBESTOS_LAST_YEAR = ACP5_LAST_YEAR;

/** The underpinning words Baltimore City's § 105.1.3 is about (see place.ts). */
export const UNDERPINNING_WORDS: readonly string[] = ['underpinning', 'underpin'];
