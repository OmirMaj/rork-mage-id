// utils/codeFlags/fixtures.ts — Code Flags: example lines with the answer each
// must give. Realistic residential and small commercial change order and
// estimate lines. scripts/validate-code-flags.ts runs every one and fails on
// any difference, in either direction: a negative that starts to flag is as
// much a failure as a positive that stops.
//
// `expect` is the EXACT set of families (order does not matter). `ctx` names a
// place and a year where the answer depends on one; without it the line is
// read with no project (no place, no year, residential).
//
// Pure data. Imported by the validator and the smoke test only.
import type { CodeFlagFamilyId } from '@/utils/codeFlags/rules';
import type { CodeFlagPlaceId } from '@/utils/codeFlags/place';

export interface CodeFlagFixture {
  line: { name: string; description?: string; category?: string; csiDivision?: string };
  expect: CodeFlagFamilyId[];
  ctx?: { place?: CodeFlagPlaceId; yearBuilt?: number | null; jobKind?: 'residential' | 'commercial' };
  /** Why this line is here, for the person reading a failure. */
  note?: string;
}

const NYC_1931 = { place: 'nyc' as const, yearBuilt: 1931 };
const NYC_1995 = { place: 'nyc' as const, yearBuilt: 1995 };
const BC_1920 = { place: 'baltimore_city' as const, yearBuilt: 1920 };

export const CODE_FLAG_POSITIVES: readonly CodeFlagFixture[] = [
  // ── exits and ways out ──
  { line: { name: 'Add egress window at basement bedroom' }, expect: ['egress'] },
  { line: { name: 'Install exit sign and emergency lighting at rear corridor' }, expect: ['egress'] },
  { line: { name: 'Panic hardware on rear exit door' }, expect: ['egress'] },
  { line: { name: 'Cut in window well for cellar' }, expect: ['egress'] },
  { line: { name: 'Relocate stair to rear of unit' }, expect: ['egress'] },
  { line: { name: 'Infill door at side yard and patch brick' }, expect: ['egress'] },
  { line: { name: 'Repair fire escape drop ladder' }, expect: ['egress'] },
  { line: { name: 'Add exterior door to mudroom', description: 'new exterior door with landing' }, expect: ['egress'] },
  // ── fire-rated walls, doors and ceilings ──
  { line: { name: '1-hour rated demising wall between tenants' }, expect: ['fire_rating'] },
  { line: { name: 'Furnish and install 90 minute door at stair' }, expect: ['fire_rating'] },
  { line: { name: 'Firestopping at pipe penetrations' }, expect: ['fire_rating'] },
  { line: { name: '5/8 Type X drywall at garage ceiling' }, expect: ['fire_rating'] },
  { line: { name: 'Fire damper at duct through corridor wall' }, expect: ['fire_rating'] },
  { line: { name: 'Shaft wall liner at new chase' }, expect: ['fire_rating'] },
  { line: { name: 'Replace fire door closer and gasketing', description: 'self-closing, 45 minute rated' }, expect: ['fire_rating'] },
  { line: { name: 'Intumescent paint on exposed steel' }, expect: ['fire_rating'], note: 'no year on file, so the lead rule stays quiet on "paint"' },
  // ── sprinklers, alarms and hood suppression ──
  { line: { name: 'Relocate 4 sprinkler heads for new ceiling layout' }, expect: ['fire_protection'] },
  { line: { name: 'Add fire alarm pull station at new exit' }, expect: ['fire_protection'] },
  { line: { name: 'Hardwired smoke detectors, interconnected' }, expect: ['fire_protection'] },
  { line: { name: 'Ansul system for cooking line' }, expect: ['fire_protection'] },
  { line: { name: 'Type I hood with suppression system' }, expect: ['fire_protection'] },
  { line: { name: 'Carbon monoxide alarm at boiler room' }, expect: ['fire_protection', 'mechanical'] },
  // ── bearing walls, beams and foundations ──
  { line: { name: 'Remove load bearing wall between kitchen and dining' }, expect: ['structural'] },
  { line: { name: 'Install LVL beam and posts' }, expect: ['structural'] },
  { line: { name: 'Sister floor joists at bathroom' }, expect: ['structural'] },
  { line: { name: 'New footing for lally column' }, expect: ['structural'] },
  { line: { name: 'Steel lintel at enlarged opening' }, expect: ['structural'] },
  { line: { name: 'Rear addition framing' }, expect: ['structural'] },
  { line: { name: 'Shed dormer at attic' }, expect: ['structural'] },
  { line: { name: 'Underpinning at party wall' }, expect: ['structural'], ctx: { place: 'baltimore_city' }, note: 'carries the one Baltimore City section number on file' },
  { line: { name: 'Widen doorway to 36 in. at kitchen' }, expect: ['structural'] },
  { line: { name: 'Retaining wall at rear yard, 5 ft' }, expect: ['structural'] },
  // ── electrical service, panels and big new loads ──
  { line: { name: 'Upgrade service to 200 amp' }, expect: ['electrical_service'] },
  { line: { name: 'Add subpanel in garage' }, expect: ['electrical_service'] },
  { line: { name: 'Replace electrical panel' }, expect: ['electrical_service'] },
  { line: { name: 'Panel', category: 'electrical' }, expect: ['electrical_service'], note: 'bare "panel" counts only on an Electrical line' },
  { line: { name: 'Dedicated circuit for microwave' }, expect: ['electrical_service'] },
  { line: { name: 'EV charger, level 2, at driveway' }, expect: ['electrical_service'] },
  { line: { name: 'Standby generator and transfer switch' }, expect: ['electrical_service'] },
  { line: { name: 'Rewire second floor, remove knob and tube' }, expect: ['electrical_service'] },
  { line: { name: 'Induction range, 240V feed' }, expect: ['electrical_service'] },
  { line: { name: 'Relocate meter to exterior', csiDivision: '26 0500' }, expect: ['electrical_service'] },
  // ── added or moved plumbing ──
  { line: { name: 'Add half bath under stairs' }, expect: ['plumbing'] },
  { line: { name: 'Relocate toilet 3 ft to north wall' }, expect: ['plumbing'] },
  { line: { name: 'Wet bar with bar sink in basement' }, expect: ['plumbing'] },
  { line: { name: 'Replace water heater, 50 gal' }, expect: ['plumbing'] },
  { line: { name: 'New sewer line to street' }, expect: ['plumbing'] },
  { line: { name: 'Rough plumbing for added laundry' }, expect: ['plumbing'] },
  { line: { name: 'Convert tub to shower' }, expect: ['plumbing'] },
  { line: { name: 'Backflow preventer at water service' }, expect: ['plumbing'] },
  { line: { name: 'Rough in', category: 'plumbing' }, expect: ['plumbing'], note: 'bare "rough in" counts only on a Plumbing line' },
  { line: { name: 'Grease trap for prep kitchen' }, expect: ['plumbing'] },
  // ── gas ──
  { line: { name: 'Run gas line to new range' }, expect: ['gas'] },
  { line: { name: 'Gas fireplace insert' }, expect: ['gas'] },
  { line: { name: 'Oil to gas conversion' }, expect: ['gas'] },
  { line: { name: 'Pressure test gas piping' }, expect: ['gas'] },
  { line: { name: 'Propane tank and regulator for generator' }, expect: ['gas', 'electrical_service'] },
  { line: { name: 'CSST to rooftop unit' }, expect: ['gas', 'mechanical'] },
  // ── mechanical equipment, ventilation and venting ──
  { line: { name: 'Replace boiler with high efficiency unit' }, expect: ['mechanical'] },
  { line: { name: 'New bath exhaust fan ducted to exterior' }, expect: ['mechanical'] },
  { line: { name: 'Range hood, 600 cfm, with makeup air' }, expect: ['mechanical'] },
  { line: { name: 'Mini split, two zones' }, expect: ['mechanical'] },
  { line: { name: 'Stainless chimney liner' }, expect: ['mechanical'] },
  { line: { name: 'Reroute dryer vent to side wall' }, expect: ['mechanical'] },
  { line: { name: 'Heat pump water heater' }, expect: ['mechanical', 'electrical_service', 'plumbing'] },
  { line: { name: 'New ductwork for second floor' }, expect: ['mechanical'] },
  // ── change of use ──
  { line: { name: 'Garage conversion to living space' }, expect: ['change_of_use'] },
  { line: { name: 'Legalize basement apartment' }, expect: ['change_of_use'] },
  { line: { name: 'Finish basement, 600 sq ft' }, expect: ['change_of_use'] },
  { line: { name: 'Convert storefront to restaurant', description: 'change of use' }, expect: ['change_of_use'] },
  { line: { name: 'Add bedroom at attic' }, expect: ['change_of_use'] },
  { line: { name: 'ADU over detached garage' }, expect: ['change_of_use'] },
  // ── energy code tests ──
  { line: { name: 'Blower door test' }, expect: ['energy_tests'] },
  { line: { name: 'Duct leakage test and report' }, expect: ['energy_tests'] },
  { line: { name: 'Manual J for new system' }, expect: ['energy_tests'] },
  // ── decks, stairs, guards and railings ──
  { line: { name: 'New deck, 12 x 16, pressure treated' }, expect: ['decks_stairs'] },
  { line: { name: 'Replace ledger board and flash' }, expect: ['decks_stairs'] },
  { line: { name: 'Guardrail at roof deck' }, expect: ['decks_stairs'] },
  { line: { name: 'Add handrail at front steps' }, expect: ['decks_stairs'] },
  { line: { name: 'Rebuild porch roof' }, expect: ['decks_stairs'] },
  { line: { name: 'New staircase to basement' }, expect: ['decks_stairs'] },
  // ── building age ──
  { line: { name: 'Replace 6 windows' }, expect: ['lead_age'], ctx: BC_1920, note: 'built before 1978, residential' },
  { line: { name: 'Scrape and paint exterior trim' }, expect: ['lead_age'], ctx: { place: 'other', yearBuilt: 1962 }, note: 'lead is federal: it shows outside the three places, with no local link' },
  { line: { name: 'Demo plaster ceiling at kitchen' }, expect: ['lead_age', 'asbestos_age'], ctx: NYC_1931 },
  { line: { name: 'Demo plaster ceiling at kitchen' }, expect: ['lead_age'], ctx: BC_1920, note: 'the asbestos rule is New York City only' },
  { line: { name: 'Remove pipe insulation at boiler room' }, expect: ['asbestos_age', 'mechanical'], ctx: NYC_1931 },
  { line: { name: 'Upgrade service to 200 amp' }, expect: ['electrical_service', 'asbestos_age'], ctx: NYC_1931, note: 'asbestos rides along with a permit flag in New York City' },
  { line: { name: 'Gut renovation of bathroom', description: 'full gut to studs' }, expect: ['asbestos_age'], ctx: { place: 'nyc', yearBuilt: 1987 }, note: '1987 itself still fires' },
];

export const CODE_FLAG_NEGATIVES: readonly CodeFlagFixture[] = [
  // ── close to exits ──
  { line: { name: 'Exit interview with homeowner' }, expect: [] },
  { line: { name: 'Final exit cleaning' }, expect: [] },
  { line: { name: 'Interior door slab, 2 panel, primed' }, expect: [] },
  { line: { name: 'Stair runner carpet' }, expect: [] },
  { line: { name: 'Door hardware, satin nickel' }, expect: [] },
  // ── close to fire rating ──
  { line: { name: 'Fire pit' }, expect: [] },
  { line: { name: 'Gas fire pit kit with lava rock' }, expect: [], note: '"fire pit" is not fire rating, and a kit is not gas piping' },
  { line: { name: 'Fireplace mantel, reclaimed oak' }, expect: [] },
  { line: { name: 'Network firewall for office IT closet' }, expect: [] },
  { line: { name: 'Energy Star rated dishwasher' }, expect: [] },
  { line: { name: '2 hour minimum labor charge' }, expect: [] },
  { line: { name: 'Fire extinguisher, 5 lb ABC' }, expect: [] },
  { line: { name: 'Standard 1/2 in. drywall at closet' }, expect: [] },
  // ── close to sprinklers and alarms ──
  { line: { name: 'Lawn sprinkler system, 6 zones' }, expect: [] },
  { line: { name: 'Replace irrigation sprinkler heads' }, expect: [] },
  { line: { name: 'Sprinkler system for the garden beds' }, expect: [] },
  { line: { name: 'Alarm clock radio for model unit' }, expect: [] },
  // ── close to structural ──
  { line: { name: 'Faux beam at living room ceiling' }, expect: [] },
  { line: { name: 'In addition to base scope, extra coat of sealer' }, expect: [] },
  { line: { name: 'Foundation planting bed and mulch' }, expect: [] },
  { line: { name: 'Remove non-load-bearing partition at closet' }, expect: [], note: 'unflagged on purpose; the sheet says no flag means nothing' },
  { line: { name: 'Laser beam level rental' }, expect: [] },
  { line: { name: 'Post light at driveway' }, expect: [] },
  { line: { name: 'Column of tile at shower niche' }, expect: [] },
  { line: { name: 'Hang wall cabinets' }, expect: [] },
  // ── close to electrical ──
  { line: { name: 'Panel door' }, expect: [] },
  { line: { name: 'Six panel door slab, solid core' }, expect: [] },
  { line: { name: 'Tub access panel' }, expect: [] },
  { line: { name: 'Raised panel wainscot' }, expect: [] },
  { line: { name: 'Panel', category: 'doors' }, expect: [], note: 'bare "panel" off an Electrical line is nothing' },
  { line: { name: 'Service call fee' }, expect: [] },
  { line: { name: 'Bird feeder post' }, expect: [] },
  { line: { name: 'Steam generator for shower' }, expect: [] },
  { line: { name: 'Solar shade at patio door' }, expect: [] },
  { line: { name: 'Replace outlet covers, white' }, expect: [] },
  { line: { name: 'Portable generator rental for site power' }, expect: [] },
  { line: { name: 'LED recessed light, 6 in.', category: 'electrical' }, expect: [] },
  { line: { name: 'Cabinet end panel and filler panel' }, expect: [] },
  // ── close to plumbing ──
  { line: { name: 'Replace faucet at kitchen sink' }, expect: [] },
  { line: { name: 'Toilet seat, elongated' }, expect: [] },
  { line: { name: 'New shower curtain rod' }, expect: [] },
  { line: { name: 'New shower door, frameless' }, expect: [] },
  { line: { name: 'Drain cleaning' }, expect: [] },
  { line: { name: 'New light fixture at vanity' }, expect: [] },
  { line: { name: 'Caulk tub surround' }, expect: [] },
  { line: { name: 'Rough in', category: 'electrical' }, expect: [], note: 'bare "rough in" off a Plumbing line is nothing' },
  // ── close to gas ──
  { line: { name: 'Gas mileage and travel' }, expect: [] },
  { line: { name: 'Argon gas filled insulated glass unit' }, expect: [] },
  { line: { name: 'Gas strut for attic hatch' }, expect: [] },
  { line: { name: 'Gas powered compressor rental' }, expect: [] },
  { line: { name: 'Wax gasket for toilet' }, expect: [] },
  // ── close to mechanical ──
  { line: { name: 'Ridge vent at reroof' }, expect: [] },
  { line: { name: 'Dryer vent cleaning' }, expect: [] },
  { line: { name: 'Furnace filter change' }, expect: [] },
  { line: { name: 'Ceiling fan install' }, expect: [] },
  { line: { name: 'Window air conditioner sleeve' }, expect: [] },
  { line: { name: 'Soffit vent strip' }, expect: [] },
  { line: { name: 'Vent cover, white, 4 x 10' }, expect: [] },
  // ── close to change of use ──
  { line: { name: 'Convert to LED lighting' }, expect: [] },
  { line: { name: 'Bedroom door hardware' }, expect: [] },
  { line: { name: 'Carpet at bedroom' }, expect: [] },
  // ── close to energy tests ──
  { line: { name: 'His and hers vanity' }, expect: [] },
  { line: { name: 'Energy Star refrigerator' }, expect: [] },
  { line: { name: 'Attic insulation, R-38 blown' }, expect: [] },
  // ── close to decks and stairs ──
  { line: { name: 'Deck stain and seal' }, expect: [] },
  { line: { name: 'Replace deck boards' }, expect: [] },
  { line: { name: 'Ledger stone veneer at fireplace' }, expect: [] },
  { line: { name: 'Replace roof decking, 4 sheets' }, expect: [] },
  { line: { name: 'Power wash the deck' }, expect: [] },
  // ── building age: the year, the place and the job decide ──
  { line: { name: 'Replace 6 windows' }, expect: [], ctx: { place: 'baltimore_city', yearBuilt: 1985 }, note: 'built after 1977' },
  { line: { name: 'Replace 6 windows' }, expect: [], ctx: { place: 'baltimore_city', yearBuilt: null }, note: 'no year on file: nothing fires' },
  { line: { name: 'Replace 6 windows' }, expect: [], ctx: { place: 'nyc', yearBuilt: 1931, jobKind: 'commercial' }, note: 'the lead rule is residential' },
  { line: { name: 'Demo plaster ceiling at kitchen' }, expect: [], ctx: NYC_1995, note: 'built after 1987 and after 1977' },
  { line: { name: 'Window treatment install' }, expect: [], ctx: NYC_1931 },
  { line: { name: 'Trim trees along the fence' }, expect: [], ctx: NYC_1931 },
  { line: { name: 'Gutter cleaning' }, expect: [], ctx: NYC_1931 },
  { line: { name: 'Snow removal' }, expect: [], ctx: NYC_1931 },
  // ── ordinary lines ──
  { line: { name: 'Kitchen cabinets, shaker, white' }, expect: [], note: 'a room name alone is not a flag' },
  { line: { name: 'Quartz countertop, 42 sq ft' }, expect: [] },
  { line: { name: 'Tile backsplash' }, expect: [] },
  { line: { name: 'Hardwood floor refinish' }, expect: [] },
  { line: { name: 'Bathroom vanity, 36 in.' }, expect: [] },
  { line: { name: 'Dumpster, 20 yd' }, expect: [] },
  { line: { name: 'Permit fee allowance' }, expect: [] },
  { line: { name: 'Project management and supervision' }, expect: [] },
  { line: { name: '' }, expect: [] },
];
