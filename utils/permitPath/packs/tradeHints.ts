// utils/permitPath/packs/tradeHints.ts — lowercase phrases that suggest each
// base.work_types choice from the estimate's line names. USED ONLY TO PRE-FILL:
// the engine (prefill.ts, `scope_trades`) matches these as substrings of
// scopeSummary, and the GC confirms the suggestion before it counts. A hint is
// never a fact about the job, so it carries no source.
//
// Keep phrases specific enough that a substring match is not silly: 'tile'
// would match 'textile', so it is not here; 'gas line' is, 'gas' alone is not.
// The same goes for 'addition' (additional outlets), 'steel' (stainless steel
// sink), 'duct' (product, conductor), 'gut' (gutter), 'panel' (wood paneling),
// 'tub' (tube), 'foundation' (foundation repair) and bare 'demo' or 'tear out'
// (demo the old cabinets): a wrong pick here turns on licensed-trade lines and
// sends the job type to "Ask". scripts/validate-permit-path-facts.ts holds a
// corpus of such estimate lines that must not match.

import type { WorkTypeChoiceId } from './base';

export const TRADE_HINTS: Readonly<Record<WorkTypeChoiceId, readonly string[]>> = Object.freeze({
  new_building_addition: Object.freeze(['new construction', 'new building', 'home addition', 'house addition', 'rear addition', 'side addition', 'room addition', 'building addition', 'second floor addition', 'rear extension', 'side extension', 'dormer', 'second story', 'ground up']),
  interior_renovation: Object.freeze(['renovation', 'remodel', 'drywall', 'sheetrock', 'gut rehab', 'interior finish', 'flooring', 'painting', 'trim', 'millwork']),
  kitchen_bath: Object.freeze(['kitchen', 'bath', 'vanity', 'cabinet', 'countertop', 'powder room']),
  plumbing: Object.freeze(['plumb', 'toilet', 'sink', 'shower', 'bathtub', 'tub and shower', 'water heater', 'gas line', 'gas piping', 'drain', 'sewer', 'faucet', 'water line', 'boiler']),
  electrical: Object.freeze(['electric', 'wiring', 'rewire', 'breaker panel', 'panel upgrade', 'outlet', 'circuit', 'lighting', 'light fixture', 'service upgrade', 'generator', 'ev charger']),
  hvac: Object.freeze(['hvac', 'mechanical', 'furnace', 'heat pump', 'air condition', 'a/c', 'mini split', 'mini-split', 'ductwork', 'duct work', 'ventilation', 'radiator']),
  structural: Object.freeze(['structural', 'beam', 'load bearing', 'load-bearing', 'joist', 'header', 'column', 'underpinning', 'wall removal', 'remove wall']),
  roofing_siding: Object.freeze(['roof', 'shingle', 'siding', 'gutter', 'flashing', 'facade', 'façade']),
  deck_porch_fence: Object.freeze(['deck', 'porch', 'fence', 'patio', 'railing', 'stoop', 'pergola']),
  demolition: Object.freeze(['demolition', 'full demo', 'tear down', 'teardown']),
  change_of_use: Object.freeze(['change of use', 'basement apartment', 'basement conversion', 'finish basement', 'finished basement', 'attic conversion', 'garage conversion', 'conversion', 'legalize', 'legalization']),
  not_sure: Object.freeze([]),
});
