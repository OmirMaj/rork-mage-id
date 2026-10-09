// utils/codeFlags/rules.ts — Code Flags (Big Bets, Bet 4, Phase 1): the rule
// table. Fourteen KINDS OF WORK that are commonly looked at on a permit or by
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
// HOW A LINE IS MATCHED (utils/codeFlags/match.ts, words read by text.ts)
//   1. the line's name and description are split into words: lower case,
//      accents folded, punctuation dropped; a comma, semicolon or colon is a
//      break nothing reaches across;
//   2. every `mask` phrase and `maskPairs` pair of the family is blanked out
//      first ("panel door" is gone before "panel" is looked for);
//   3. a `triggers` or `es` (Spanish) phrase must then appear as whole words,
//      side by side (the last word may be plural: "s", "es", "y" to "ies");
//   4. a `pairs` entry is a VERB AND ITS NOUN: the verb, then the noun within
//      three ordinary words (articles, room names, positions and numbers are
//      free), with no "and", "at", "for" or comma in between, and the noun must
//      be the thing itself ("remove wall", never "remove wall tile");
//   5. a `categoryTriggers` phrase counts only when the line's category or CSI
//      division is one of the listed ones ("panel" on an Electrical line);
//   6. a trigger right after "no", "not including", "excluding" (or "sin",
//      "no incluye") does not count, and neither does one followed by "cover",
//      "sticker", "delivery", "rental", "label", "cleaning" or "warranty".
//   There is no line-wide veto: one stray word never silences a family.
//
// BUILDING AGE. The two 'building_age' families are never a chip on a line.
// match.flagBuildingAge reads the whole change order or estimate and gives ONE
// row for it.
//
// LAYOUT CHANGES (`layout_change`) is the newest family and the least sure:
// its `confirm` field says a founder or an expediter still has to confirm it.
// Its wording never says "bearing". It stays quiet on a line the structural
// family already flagged.
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
  | 'layout_change'
  | 'lead_age'
  | 'asbestos_age';

/** 'permit' families put a chip on a line. 'building_age' families also need
 *  the building's year (and, for asbestos, New York City) and show ONCE for the
 *  whole change order or estimate, never on a line. */
export type CodeFlagKind = 'permit' | 'building_age';

export interface CodeFlagCategoryTrigger {
  /** CATEGORY_META keys or labels, or two-digit CSI divisions. */
  categories: readonly string[];
  phrases: readonly string[];
}

/** A verb and its noun: one of `first`, then one of `then` within the window. */
export interface CodeFlagPair {
  first: readonly string[];
  then: readonly string[];
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
  /** Spanish phrases (written with their accents; matched with accents folded). */
  es: readonly string[];
  /** Verb-and-noun pairs, English and Spanish. */
  pairs?: readonly CodeFlagPair[];
  categoryTriggers?: readonly CodeFlagCategoryTrigger[];
  /** Blanked out of the line before the triggers are looked for. */
  mask: readonly string[];
  /** Blanked out too: a verb and its noun that mean upkeep, not new work ("snake" a "drain line"). */
  maskPairs?: readonly CodeFlagPair[];
  /** Set while a founder or an expediter still has to confirm the family. */
  confirm?: 'founder_or_expediter';
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

// Verbs shared by more than one family.
const REMOVE_VERBS = ['remove', 'removing', 'take down', 'taking down', 'knock down', 'tear down', 'demo', 'demolish', 'open up', 'opening up'] as const;
const REMOVE_VERBS_ES = ['quitar', 'remover', 'tumbar', 'demoler', 'tirar', 'derribar', 'eliminar'] as const;
const MOVE_VERBS = ['relocate', 'relocating', 'relocated', 'move', 'moving', 'moved', 'shift'] as const;
const MOVE_VERBS_ES = ['mover', 'reubicar', 'trasladar', 'cambiar de lugar'] as const;
const ADD_VERBS_ES = ['agregar', 'añadir', 'instalar', 'nuevo', 'nueva', 'nuevos', 'nuevas'] as const;
/** "wall" before one of these is tile, a cabinet or a fitting, never the wall itself. */
const NOT_A_WALL = [
  'retaining wall', 'stone wall', 'garden wall', 'seat wall', 'landscape wall', 'boulder wall', 'privacy wall',
  'knee wall', 'pony wall', 'half wall', 'shower wall', 'tub wall', 'accent wall', 'feature wall', 'curtain wall',
  'parapet wall', 'foundation wall', 'wall to wall',
  'temporary wall', 'temp wall', 'temporary partition', 'temp partition', 'dust wall', 'dust partition', 'zip wall',
  'toilet partition', 'shower partition', 'urinal partition', 'cubicle partition',
] as const;

export const CODE_FLAG_FAMILIES: readonly CodeFlagFamily[] = [
  {
    id: 'egress', kind: 'permit', books: ['IBC', 'IRC'],
    reuses: ['egress-basement-bedroom'],
    triggers: uniq([
      ...take('egress-basement-bedroom'),
      'egress', 'exit door', 'exit sign', 'exit stair', 'exit corridor', 'exit passageway', 'emergency exit',
      'fire escape', 'window well', 'panic hardware', 'panic bar', 'exit device',
      'emergency lighting', 'emergency light', 'exit lighting', 'exit light',
      'stair relocation',
    ]),
    es: [
      'salida de emergencia', 'puerta de salida', 'escalera de incendios', 'escalera de emergencia',
      'letrero de salida', 'luz de emergencia', 'luces de emergencia', 'barra antipánico',
      'ventana de escape', 'ventana de egreso',
    ],
    pairs: [
      { first: [...MOVE_VERBS, 'remove', 'eliminate'], then: ['stair', 'staircase', 'stairway'] },
      { first: ['new', 'add', 'adding', 'remove', ...MOVE_VERBS], then: ['exterior door', 'entry door'] },
      {
        first: ['close off', 'close up', 'infill', 'block up', 'block off', 'brick up', 'wall up', 'wall off', 'wall over', 'eliminate', 'abandon'],
        then: ['door', 'doorway', 'door opening', 'exit'],
      },
      { first: ['tapiar', 'clausurar', 'cegar', 'eliminar'], then: ['puerta', 'salida'] },
    ],
    mask: ['cabinet door', 'shower door', 'screen door', 'storm door', 'closet door', 'pocket door'],
    quiet: ['exit interview', 'exit strategy meeting', 'final exit cleaning', 'interior door slab', 'stair runner carpet', 'exit sign sticker'],
  },
  {
    id: 'fire_rating', kind: 'permit', books: ['IBC', 'IFC'],
    reuses: ['firestopping', 'garage-separation'],
    triggers: uniq([
      ...take('firestopping'),
      ...take('garage-separation'),
      'fire rated', 'fire rating', 'rated door', 'rated assembly', 'rated partition', 'rated shaft', 'rated slab', 'rated floor',
      'fire door', 'fire barrier', 'fire partition', 'fire separation', 'garage separation',
      'shaft wall', 'shaft enclosure', 'shaft liner', 'elevator shaft',
      'firestop', 'fire stop', 'firestopping', 'fire stopping', 'fire caulk', 'fire caulking',
      'fire damper', 'smoke damper', 'fire blocking', 'fireblocking', 'fire block', 'draftstop', 'draft stop',
      'type x', 'hour rated', 'hr rated', 'hour fire', 'hr fire', 'hour wall', 'hr wall', 'hour ceiling', 'hr ceiling',
      'hour partition', 'hr partition', 'hour shaft', 'hr shaft', 'hour door', 'hr door', 'hour slab', 'hr slab',
      'hour assembly', 'hr assembly', 'hour rating', 'hr rating', 'hour demising', 'hr demising',
      'minute door', 'min door', 'minute rated',
      'intumescent', 'fireproofing', 'fire proofing',
    ]),
    es: [
      'cortafuego', 'puerta cortafuego', 'pared cortafuego', 'muro cortafuego', 'sellador cortafuego', 'sello cortafuego',
      'resistente al fuego', 'resistencia al fuego', 'tipo x', 'ignífugo', 'intumescente',
    ],
    // "self closing" counts only with a door: hinges, drawers and toilet seats close themselves too.
    pairs: [{ first: ['self closing'], then: ['door', 'entry door', 'apartment door', 'unit door', 'stair door', 'corridor door'] }],
    mask: [
      'fire pit', 'fire table', 'fire bowl', 'fire feature', 'fire ring',
      'network firewall', 'firewall router', 'firewall software', 'firewall appliance',
      'cabinet door', 'shower door', 'screen door', 'storm door', 'toilet seat',
    ],
    quiet: [
      'fire pit', 'gas fire pit kit', 'fireplace mantel', 'network firewall', 'energy star rated dishwasher', 'fire extinguisher',
      '2 hour minimum labor', 'self closing cabinet hinges', 'self closing drawer slides', 'toilet seat self closing',
    ],
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
    es: [
      'rociadores contra incendios', 'rociador contra incendios', 'sistema de rociadores', 'cabeza de rociador', 'cabezal de rociador',
      'alarma contra incendios', 'alarma de incendio', 'detector de humo', 'detectores de humo', 'alarma de humo', 'alarmas de humo',
      'detector de monóxido', 'monóxido de carbono', 'sistema de supresión',
    ],
    pairs: [{ first: [...MOVE_VERBS, ...MOVE_VERBS_ES], then: ['sprinkler', 'rociador'] }],
    // Phrases only. A line-wide veto on "garden" or "yard" used to silence real
    // sprinkler work on a garden level, which is everyday New York City wording.
    mask: [
      'lawn sprinkler', 'garden sprinkler', 'yard sprinkler', 'landscape sprinkler', 'irrigation sprinkler',
      'sprinkler timer', 'sprinkler controller', 'sprinkler valve box',
      'sprinkler system for the garden', 'sprinkler system for the lawn', 'sprinkler system for the yard',
      'sprinkler for the garden', 'sprinkler for the lawn', 'sprinkler for the yard',
      'drip irrigation', 'irrigation system', 'irrigation line', 'irrigation zone', 'irrigation head',
      'rociador de jardín', 'rociador de césped', 'sistema de riego',
    ],
    quiet: ['lawn sprinkler system', 'irrigation sprinkler head', 'sprinkler system for the garden', 'smoke shop signage', 'drip irrigation line'],
  },
  {
    id: 'structural', kind: 'permit', books: ['IBC', 'IRC', 'IEBC'],
    reuses: [],
    triggers: [
      'load bearing', 'bearing wall', 'structural', 'beam', 'lvl', 'glulam', 'girder', 'joist',
      'rafter', 'truss', 'lintel', 'lally column', 'steel column', 'support column', 'support post',
      'footing', 'foundation', 'underpinning', 'underpin', 'shoring', 'retaining wall',
      'wall removal',
      'door header', 'window header', 'lvl header', 'steel header', 'wood header', 'flush header', 'dropped header', 'header beam',
      'header at', 'header over', 'header above',
      'helical pier', 'concrete pier', 'dormer', 'addition', 'second story', 'second floor addition', 'bump out',
      'roof framing', 'floor framing',
    ],
    es: [
      'pared de carga', 'muro de carga', 'muro portante', 'pared portante', 'viga', 'vigueta', 'estructural',
      'cimiento', 'cimentación', 'zapata', 'columna de acero', 'dintel', 'apuntalamiento', 'apuntalar', 'recalce',
      'muro de contención', 'pared de contención', 'cercha', 'ampliación', 'segundo piso nuevo',
    ],
    pairs: [
      { first: [...REMOVE_VERBS, ...REMOVE_VERBS_ES], then: ['wall', 'pared', 'muro'] },
      {
        first: ['new', 'enlarge', 'enlarging', 'widen', 'widening', 'cut', 'cut in', 'create', 'add'],
        then: ['opening', 'door opening', 'window opening', 'doorway'],
      },
      { first: ['abrir', 'ampliar', 'nueva', 'nuevo'], then: ['abertura', 'vano', 'hueco'] },
      { first: ['new', 'install', 'installing', 'add', 'replace', 'frame', 'set', 'upsize', 'sister', 'build'], then: ['header'] },
    ],
    mask: [
      'non load bearing', 'non bearing', 'nonbearing', 'non structural', 'nonstructural',
      'not load bearing', 'not bearing', 'not structural', 'partition wall', 'partition',
      'no portante', 'no estructural', 'no es de carga', 'tabique', 'pared divisoria',
      'faux beam', 'decorative beam', 'box beam', 'beam wrap', 'laser beam',
      'in addition', 'addition of', 'addition to scope', 'addition to contract',
      'ampliación de plazo', 'ampliación de contrato',
      'foundation planting', 'foundation plants', 'foundation vent', 'foundation paint', 'foundation coating',
      'foundation sealer', 'foundation waterproofing',
      'structural screw', 'structural adhesive', 'joist hanger', 'joist tape',
      'header board', 'header pipe', 'header tank',
      ...NOT_A_WALL.filter((w) => w !== 'retaining wall' && w !== 'foundation wall'),
    ],
    quiet: [
      'faux beam for the living room ceiling', 'in addition to the base scope', 'foundation planting bed',
      'remove non load bearing partition', 'laser beam level rental', 'post light at the driveway',
      'addition of crown molding', 'header board for bed', 'remove wall tile', 'no structural work',
    ],
  },
  {
    id: 'electrical_service', kind: 'permit', books: ['NEC'],
    reuses: ['service-grounding-bonding', 'electrical-load-calc'],
    triggers: uniq([
      ...take('service-grounding-bonding'),
      ...take('electrical-load-calc'),
      'subpanel', 'sub panel', 'electrical panel', 'electric panel', 'breaker panel', 'breaker box', 'fuse box',
      'panel replacement', 'replace panel', 'panel swap', 'panel change', 'load center', 'service panel',
      'elec panel', 'elect panel', 'subpannel', 'sub pannel', 'electrical pannel', 'electric pannel', 'main pannel', 'pannel upgrade',
      'electrical service', 'electric service', 'elec service', 'elec svc', 'electric svc', 'electrical svc',
      'svc upgrade', 'svc change', 'new svc',
      '100 amp', '125 amp', '150 amp', '320 amp',
      'meter pan', 'meter upgrade', 'meter relocation', 'relocate meter', 'electric meter',
      'service entrance', 'service drop', 'service mast', 'service cable', 'feeder',
      'branch circuit',
      'rewire', 'rewiring', 'knob and tube', 'aluminum wiring',
      'generator', 'transfer switch', 'load calculation', 'load calc',
      'solar panel', 'solar array', 'pv system', 'photovoltaic', 'battery storage', 'powerwall',
      'level 2 charger', 'ev charging', 'evse', 'charging station', 'wall connector', 'tesla charger',
      '240v', '240 volt', '220v', '220 volt', 'nema 14 50', '50 amp outlet', '50a outlet',
    ]),
    es: [
      'panel eléctrico', 'tablero eléctrico', 'caja de breakers', 'caja de fusibles', 'cambio de panel', 'cambiar panel',
      'acometida', 'servicio eléctrico', 'medidor eléctrico', 'medidor de luz', 'circuito dedicado',
      'recablear', 'recableado', 'cargador de auto', 'cargador de carro', 'cargador de vehículo eléctrico',
      'generador', 'interruptor de transferencia', 'paneles solares', '200 amperios', '100 amperios',
    ],
    pairs: [
      { first: ['add', 'adding', 'additional', 'new', 'install', 'installing', 'run', 'dedicated'], then: ['circuit'] },
      { first: [...ADD_VERBS_ES], then: ['circuito'] },
    ],
    categoryTriggers: [
      { categories: ['electrical', '26'], phrases: ['panel', 'service', 'meter', 'circuit', 'feeder'] },
    ],
    mask: [
      'panel door', 'door panel', 'wall panel', 'wood panel', 'panel molding', 'panel moulding', 'access panel',
      'glass panel', 'shower panel', 'fence panel', 'raised panel', 'flat panel', 'cabinet panel', 'end panel',
      'filler panel', 'appliance panel', 'dishwasher panel', 'refrigerator panel', 'fridge panel',
      'lattice panel', 'acoustic panel', 'ceiling panel', 'frp panel', 'sip panel', 'tub panel', 'bath panel',
      'side panel', 'skirt panel', 'toe kick panel', 'control panel',
      'trim panel', 'low voltage panel', 'patch panel', 'led panel', 'light panel', 'alarm panel',
      'service call', 'service fee', 'service charge', 'customer service', 'service door', 'service sink',
      'food service', 'service elevator', 'service visit', 'service agreement', 'service contract', 'service plan',
      'bird feeder', 'steam generator', 'generator rental', 'rent generator', 'portable generator',
      'generator for temp', 'generator for temporary', 'temp generator', 'temporary generator', 'generator fuel',
      'generador portátil', 'alquiler de generador',
      'solar shade', 'solar screen', 'solar tube', 'solar light', 'solar film',
      'circuit breaker', 'circuit tester', 'meter reading',
    ],
    quiet: [
      'panel door', 'six panel door slab', 'access panel for the tub', 'service call fee', 'bird feeder post',
      'steam generator for the shower', 'solar shade for the patio', 'replace outlet cover', 'portable generator rental',
      'generator for temp power', 'hot tub cover', 'induction cooktop delivery', 'not including electrical panel',
    ],
  },
  {
    id: 'plumbing', kind: 'permit', books: ['IPC'],
    reuses: ['water-heater-expansion'],
    triggers: uniq([
      ...take('water-heater-expansion'),
      'w/h', 'hwh', 'hw heater', 'hot water tank',
      'tub to shower', 'wet bar', 'bar sink', 'prep sink', 'second sink', 'utility sink', 'slop sink', 'mop sink',
      'laundry sink', 'plumbing fixture', 'fixture count',
      'toilet relocation', 'sink relocation',
      'rough plumbing', 'plumbing rough', 'rough in plumbing',
      'drain line', 'waste line', 'waste pipe', 'vent stack', 'soil stack', 'stack replacement',
      'sewer line', 'sewer lateral', 'house trap', 'house sewer', 'water service', 'water main',
      'repipe', 're pipe', 'repiping',
      'backflow', 'rpz', 'sump pump', 'ejector pump', 'sewage ejector', 'grease trap', 'grease interceptor',
      'floor drain', 'washer hookup', 'laundry hookup', 'washer box', 'pot filler', 'hose bib', 'hose bibb',
      'tankless', 'water meter', 'pressure reducing valve', 'expansion tank',
    ]),
    es: [
      'calentador de agua', 'medio baño', 'línea de drenaje', 'tubería de drenaje', 'línea de desagüe', 'tubería de desagüe',
      'línea de alcantarillado', 'alcantarillado', 'bajante', 'acometida de agua', 'bomba de sumidero',
      'trampa de grasa', 'válvula antirretorno', 'drenaje de piso', 'instalación de plomería',
    ],
    pairs: [
      {
        first: ['add', 'adding', 'additional', ...MOVE_VERBS],
        then: ['toilet', 'sink', 'shower', 'tub', 'bathtub', 'lav', 'lavatory', 'urinal', 'bidet', 'drain', 'plumbing'],
      },
      { first: ['add', 'adding', 'additional', 'new'], then: ['bathroom', 'bath', 'half bath', 'full bath', 'powder room', 'shower', 'drain'] },
      { first: ['replace', 'replacing', 'new', ...MOVE_VERBS], then: ['stack', 'cast iron stack', 'waste stack'] },
      {
        first: [...MOVE_VERBS_ES, 'agregar', 'añadir'],
        then: ['inodoro', 'lavamanos', 'fregadero', 'lavabo', 'ducha', 'regadera', 'tina', 'bañera', 'drenaje', 'desagüe'],
      },
      { first: ['agregar', 'añadir', 'nuevo', 'nueva'], then: ['baño', 'ducha', 'regadera', 'desagüe'] },
    ],
    categoryTriggers: [
      { categories: ['plumbing', '22'], phrases: ['rough in', 'relocate', 'relocation', 'new line', 'new fixture', 'add fixture', 'additional fixture'] },
    ],
    mask: [
      'shower curtain', 'shower door', 'shower head', 'showerhead', 'shower rod', 'shower glass', 'shower niche',
      'shower shelf', 'shower caddy',
      'drain cleaning', 'drain clog', 'drain line clog', 'clogged drain', 'limpieza de drenaje', 'destapar drenaje',
    ],
    maskPairs: [
      {
        first: ['snake', 'snaking', 'clear', 'clearing', 'clean', 'cleaning', 'unclog', 'unclogging', 'jet', 'jetting', 'camera', 'scope', 'rod', 'rodding', 'auger', 'flush', 'destapar', 'limpiar'],
        then: ['drain line', 'drain', 'sewer line', 'sewer', 'waste line', 'main line', 'house trap', 'drenaje', 'desagüe'],
      },
    ],
    quiet: [
      'replace faucet', 'toilet seat', 'new shower curtain rod', 'new shower door', 'drain cleaning', 'new light fixture', 'caulk tub',
      'new shower tile', 'new shower valve trim', 'snake drain line', 'clear main drain line clog',
    ],
  },
  {
    id: 'gas', kind: 'permit', books: ['IFGC'],
    reuses: ['gas-trap-test'],
    triggers: uniq([
      ...take('gas-trap-test'),
      'gas pipe', 'gas meter', 'gas service', 'gas svc', 'gas shutoff', 'gas shut off', 'gas valve', 'gas leak',
      'gas connection', 'gas hookup', 'gas hook up', 'gas boiler', 'gas insert', 'gas log', 'gas heater',
      'gas test', 'gas pressure test', 'gas riser', 'gas main', 'gas conversion', 'convert to gas', 'converting to gas',
      'switch to gas', 'oil to gas', 'electric to gas',
      'natural gas', 'lp gas', 'csst', 'black iron pipe', 'black pipe',
      'propane line', 'propane piping', 'propane tank', 'propane regulator', 'propane conversion', 'convert to propane', 'propane appliance',
    ]),
    es: [
      'línea de gas', 'tubería de gas', 'conexión de gas', 'medidor de gas', 'prueba de gas', 'prueba de presión de gas',
      'fuga de gas', 'gas natural', 'conversión a gas', 'convertir a gas', 'llave de gas', 'válvula de gas',
      'caldera de gas', 'tanque de propano',
    ],
    mask: [
      'gas station', 'gas lift', 'gas strut', 'gas spring', 'gas mileage', 'gas money', 'gas surcharge',
      'argon gas', 'gas filled', 'gas can', 'gas powered', 'gas cap', 'propane torch',
      'propane tank refill', 'propane tank exchange', 'propane refill',
      'black pipe shelf', 'black pipe shelving', 'black pipe bracket', 'black pipe rail', 'black pipe handrail',
      'black pipe curtain rod', 'black pipe closet rod', 'black pipe leg', 'black pipe decor',
    ],
    quiet: [
      'gas mileage and travel', 'argon gas filled window', 'gas strut for the hatch', 'gas powered compressor rental', 'gasket for the toilet',
      'propane for temp heaters', 'black pipe shelf brackets',
    ],
  },
  {
    id: 'mechanical', kind: 'permit', books: ['IMC', 'IRC'],
    reuses: ['appliance-venting', 'hvac-load-calc', 'range-hood-makeup-air'],
    triggers: uniq([
      ...take('appliance-venting'),
      ...take('hvac-load-calc'),
      ...take('range-hood-makeup-air'),
      'dryer vent', 'dryer exhaust', 'dryer duct', 'vent dryer', 'dryer venting',
      'vent to exterior', 'vented to exterior', 'vent to outside', 'vent through roof', 'vent thru roof',
      'exhaust fan', 'bath fan', 'bathroom fan', 'kitchen exhaust',
      'exhaust duct', 'exhaust hood', 'makeup air', 'make up air', 'erv', 'hrv', 'air handler', 'condenser', 'condensor',
      'condensing unit', 'rooftop unit', 'rtu', 'boiler', 'chimney liner', 'chimney lining', 'chimney reline', 'chimney relining',
      'flue', 'flue liner', 'b vent',
      'direct vent', 'power vent', 'ventilation', 'fresh air intake', 'new duct', 'duct relocation',
      'relocate duct', 'duct run', 'split system', 'ptac', 'unit heater', 'air conditioning', 'air conditioner',
      'hvac system', 'hvac install', 'hvac installation', 'hvac unit', 'hvac equipment', 'hvac upgrade',
      'ac replacement', 'ac unit', 'a/c unit', 'a/c replacement', 'a/c condenser', 'central ac', 'central a/c',
      'steam pipe', 'steam riser', 'hydronic', 'oil tank', 'oil burner',
    ]),
    es: [
      'caldera', 'aire acondicionado', 'aire central', 'bomba de calor', 'ductos nuevos', 'ducto nuevo',
      'extractor de baño', 'extractor de aire', 'campana extractora', 'campana de cocina', 'ventilación',
      'revestimiento de chimenea', 'forro de chimenea', 'ventilación de secadora', 'ducto de secadora',
      'condensador', 'tanque de aceite', 'calefacción nueva',
    ],
    pairs: [
      // A bare "HVAC" heading is not a flag. "Replace HVAC" is.
      { first: ['replace', 'replacing', 'new', 'install', 'installing', 'add', 'upgrade', 'swap', ...MOVE_VERBS], then: ['hvac', 'ac', 'a/c'] },
      { first: ['new', 'add', 'adding', ...MOVE_VERBS], then: ['radiator'] },
      { first: ['reline', 'relining', 'line'], then: ['chimney', 'flue'] },
    ],
    mask: [
      'soffit vent', 'ridge vent', 'gable vent', 'roof vent', 'foundation vent', 'attic ventilation',
      'roof ventilation', 'vent cleaning', 'duct cleaning', 'dryer vent cleaning', 'vent cover',
      'furnace filter', 'filter change', 'furnace cleaning', 'furnace tune up', 'hvac service', 'hvac maintenance',
      'ac service', 'ac tune up', 'boiler service', 'boiler cleaning', 'air compressor',
      'window air conditioner', 'window ac', 'portable air conditioner', 'portable ac',
      'boiler plate', 'boiler room', 'furnace room',
      'aire acondicionado de ventana', 'aire de ventana', 'limpieza de ductos', 'limpieza de caldera', 'mantenimiento de caldera',
      'cuarto de caldera',
    ],
    maskPairs: [
      { first: ['clean', 'cleaning', 'clear', 'unclog', 'limpiar'], then: ['dryer vent', 'vent', 'duct', 'ductwork', 'chimney', 'flue', 'furnace', 'boiler', 'ducto', 'caldera'] },
    ],
    quiet: [
      'ridge vent', 'dryer vent cleaning', 'furnace filter change', 'ceiling fan install', 'window air conditioner sleeve', 'soffit vent strip',
      'boiler plate contract language', 'boiler room door paint', 'hvac',
    ],
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
    es: [
      'cambio de uso', 'cambio de ocupación', 'certificado de ocupación', 'convertir garaje', 'conversión de garaje',
      'apartamento en el sótano', 'apartamento de sótano', 'convertir sótano', 'terminar sótano', 'convertir ático',
      'legalizar', 'legalización', 'agregar dormitorio', 'agregar recámara', 'agregar habitación', 'dormitorio nuevo',
      'unidad adicional',
    ],
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
    es: ['prueba de hermeticidad', 'prueba de puerta sopladora', 'prueba de fugas en ductos', 'prueba de ductos', 'código de energía', 'cálculo de cargas'],
    mask: [],
    quiet: ['his and hers vanity', 'energy star refrigerator', 'attic insulation r 38'],
  },
  {
    id: 'decks_stairs', kind: 'permit', books: ['IRC', 'IBC'],
    reuses: ['deck-ledger'],
    triggers: uniq([
      ...take('deck-ledger'),
      'deck framing', 'deck addition', 'deck extension',
      'deck replacement', 'deck footing', 'ledger board', 'rooftop deck', 'roof deck framing', 'roof deck pavers',
      'roof deck railing', 'roof terrace', 'occupied roof',
      'guardrail', 'guard rail', 'handrail', 'hand rail', 'railing replacement',
      'stair railing', 'balcony',
      'stair replacement', 'exterior stair',
      'stair stringer',
      'porch roof', 'porch addition',
    ]),
    es: [
      'barandal', 'baranda', 'barandilla', 'pasamanos', 'balcón', 'terraza nueva', 'deck nuevo',
      'escalera nueva', 'escalones nuevos', 'porche nuevo',
    ],
    pairs: [
      {
        first: ['new', 'build', 'building', 'rebuild', 'rebuilding', 'replace', 'replacing', 'construct', 'add', 'extend'],
        then: ['deck', 'porch', 'stoop', 'stair', 'staircase', 'stairway', 'step', 'railing'],
      },
      // The roof deck a roofer writes about is sheathing. Only a NEW one is a deck.
      { first: ['new', 'build', 'building', 'construct', 'add'], then: ['roof deck'] },
      { first: ['construir', 'reconstruir', 'nueva', 'nuevo', 'nuevos'], then: ['terraza', 'deck', 'escalera', 'escalones', 'porche'] },
    ],
    mask: [
      'roof decking', 'deck board', 'decking board', 'deck stain', 'deck staining', 'deck sealing', 'deck sealer',
      'deck cleaning', 'deck wash', 'stair runner', 'stair carpet',
      'ledger stone', 'stone ledger', 'ledger panel', 'balcony furniture',
      'ledger entry', 'general ledger', 'ledger adjustment', 'ledger balance', 'ledger account',
      'temporary guardrail', 'temp guardrail', 'temporary guard rail', 'temp guard rail', 'temporary handrail', 'temp handrail',
      'temporary railing', 'temp railing', 'temporary stair', 'temp stair',
      'barandal temporal', 'baranda temporal', 'pasamanos temporal',
      'step flashing', 'step ladder', 'step stool',
    ],
    // Refinishing a rail or a deck is upkeep, not a new or rebuilt one.
    maskPairs: [
      {
        first: ['sand', 'sanding', 'stain', 'staining', 'restain', 're stain', 'refinish', 'refinishing', 'paint', 'painting', 'varnish', 'tighten', 'clean'],
        then: ['handrail', 'hand rail', 'guardrail', 'guard rail', 'railing', 'stair railing', 'balcony', 'deck', 'porch', 'stoop', 'banister handrail'],
      },
    ],
    quiet: [
      'deck stain and seal', 'replace deck boards', 'ledger stone veneer', 'stair runner carpet', 'replace roof decking', 'power wash the deck',
      'replace rotted roof deck plywood', 'roof deck sheathing', 'ledger entry adjustment', 'temporary guardrail at stair opening',
      'replace stair treads', 'replace step flashing', 'sand and re stain banister handrail',
    ],
  },
  {
    // NEEDS FOUNDER OR EXPEDITER CONFIRMATION. Taking out, adding or moving a
    // wall or a partition. The wording never says "bearing": it says only that
    // changing the layout of rooms commonly involves a filing in New York City,
    // and stays general everywhere else. Quiet on a line the structural family
    // already flagged (match.flagLine).
    id: 'layout_change', kind: 'permit', books: ['IEBC', 'IBC'],
    reuses: [],
    confirm: 'founder_or_expediter',
    triggers: ['partition removal', 'wall relocation', 'partition relocation', 'reconfigure layout', 'layout change', 'new room layout'],
    es: ['pared divisoria nueva', 'tabique nuevo', 'cambio de distribución'],
    pairs: [
      {
        first: [...REMOVE_VERBS, 'new', 'add', 'adding', 'build', 'building', 'frame', 'framing', 'erect', ...MOVE_VERBS],
        then: ['wall', 'partition', 'partition wall', 'interior wall', 'demising partition'],
      },
      { first: ['install', 'installing'], then: ['partition', 'partition wall'] },
      {
        first: [...REMOVE_VERBS_ES, ...MOVE_VERBS_ES, 'construir', 'levantar', 'nueva', 'nuevo'],
        then: ['pared', 'tabique', 'pared divisoria', 'muro divisorio', 'división'],
      },
    ],
    mask: [...NOT_A_WALL, 'exterior wall'],
    quiet: [
      'frame exterior wall', 'paint the wall', 'install wall tile', 'hang wall cabinets', 'new wall sconce', 'temporary dust partition',
      'toilet partitions', 'remove wall paper', 'build retaining wall',
    ],
  },
  {
    // The existing lead rule (utils/buildingScopeTriggers 'rrp'): the SAME
    // trigger words, the same year. Fires only on a residential job whose
    // building is on file as built before RRP_CUTOFF_YEAR. One row for the
    // whole change order or estimate, never a chip on a line.
    id: 'lead_age', kind: 'building_age', books: [],
    reuses: [],
    triggers: [...BUILDING_TRIGGER_PHRASES],
    es: ['pintura', 'pintar', 'demolición', 'yeso', 'ventana', 'puerta', 'lijar', 'lijado', 'moldura', 'raspar'],
    mask: [
      'window treatment', 'window blind', 'window shade', 'window cleaning', 'window screen', 'window film',
      'door mat', 'door bell', 'door stop', 'tree trim', 'trim tree', 'trim hedge', 'trim bush',
    ],
    quiet: ['window treatment install', 'trim trees along the fence', 'door mat', 'carpet cleaning'],
  },
  {
    // The existing asbestos rule (utils/buildingScopeTriggers 'acp5') fires on
    // the building's year alone, for a job that needs a permit. Here it fires
    // when some line has one of the words below, or when some line carries a
    // 'permit' flag. New York City only, built ACP5_LAST_YEAR or earlier. One
    // row for the whole change order or estimate.
    id: 'asbestos_age', kind: 'building_age', books: [],
    reuses: [],
    triggers: [
      'asbestos', 'demo', 'demolition', 'gut', 'abatement', 'plaster', 'pipe insulation', 'boiler insulation',
      'popcorn ceiling', 'tear out', 'tear off', 'floor tile removal', 'vinyl tile removal', 'remove flooring',
      'flooring removal', 'siding removal', 'remove siding',
    ],
    es: ['asbesto', 'demolición', 'demoler', 'yeso', 'aislamiento de tubería', 'quitar piso', 'remoción de piso'],
    mask: [],
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
