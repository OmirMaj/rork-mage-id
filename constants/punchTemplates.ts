// Trade-specific punch templates — pre-built checklists for the
// standard pre-substantial-completion walk in residential GC work.
//
// Why these exist: when a phase wraps (electrical rough-in, drywall,
// paint), the GC walks the work and hits the same 8-12 items every
// time — but typing each into the punch list takes 5 minutes per
// trade. With templates, the GC picks "Electrical rough-in" and
// drops 12 known items in one tap; they edit/discard from there.
//
// The library is intentionally small and curated. Source: standard
// QA punch lists from Builder magazine, IRC inspection checklists,
// and what residential GCs typically catch on quality walks. Sized
// so a GC can scan the whole list in 30 seconds without skimming
// past anything important.
//
// Each item has:
//   description — the actionable line that lands in the punch row
//   priority    — default priority (GC overrides freely)
//   notes       — optional one-line context (why this catches problems)

import type { PunchItemPriority, SubTrade } from '@/types';

export interface PunchTemplateItem {
  description: string;
  priority: PunchItemPriority;
  notes?: string;
}

export interface PunchTemplate {
  /** Stable id for analytics + as the React key in the picker. */
  id: string;
  /** Trade enum — used to set the punch item's `assignedSub` label. */
  trade: SubTrade;
  /** Human-readable label shown in the picker. */
  label: string;
  /** One-line description of when to use this template. */
  context: string;
  items: PunchTemplateItem[];
}

export const PUNCH_TEMPLATES: PunchTemplate[] = [
  {
    id: 'electrical-rough',
    trade: 'Electrical',
    label: 'Electrical rough-in walk',
    context: 'Before drywall — verify boxes, runs, panel layout',
    items: [
      { description: 'All boxes set plumb and at consistent height (typically 16" AFF)', priority: 'medium', notes: 'A misaligned box shows through trim later' },
      { description: 'GFCI / AFCI locations match plan and code (kitchen, baths, garage, exterior)', priority: 'high' },
      { description: 'Switch leg / 3-way wiring verified at each location', priority: 'medium' },
      { description: 'Panel directory legible and accurate to circuits actually run', priority: 'medium' },
      { description: 'Recessed cans aligned in straight rows; layout matches plan', priority: 'medium', notes: 'Check from the doorway sight-line' },
      { description: 'Smoke / CO detectors at every required location (every bedroom, hall, each level)', priority: 'high' },
      { description: 'Bonding to gas line, water main, and panel ground rod', priority: 'high' },
      { description: 'Low-voltage rough (cat6, coax, security) pulled to all stub-outs', priority: 'low' },
      { description: 'No staples within 1.25" of stud edge (nail-plate or drilled holes used instead)', priority: 'medium', notes: 'Inspector will flag this' },
      { description: 'Generator transfer-switch / sub-panel boxes mounted and labeled', priority: 'low' },
    ],
  },

  {
    id: 'electrical-trim',
    trade: 'Electrical',
    label: 'Electrical trim walk',
    context: 'After paint — fixtures, devices, cover plates',
    items: [
      { description: 'All devices (switches, outlets) flush, level, screwed tight', priority: 'medium' },
      { description: 'Cover plates installed, no gaps to drywall, no painters\' tape residue', priority: 'low' },
      { description: 'Every switch tested — controls expected fixture / fan', priority: 'high' },
      { description: 'Dimmers compatible with installed bulbs (no flicker, no buzz at 30%)', priority: 'medium' },
      { description: 'Recessed cans level, trims seated, bulbs at consistent color temp', priority: 'medium' },
      { description: 'GFCIs trip and reset; test buttons confirmed', priority: 'high' },
      { description: 'Bath / kitchen / range exhaust fans run at expected CFM (no gurgle, no flapping damper)', priority: 'medium' },
      { description: 'Doorbell / chime tested', priority: 'low' },
      { description: 'Smoke detectors chirp-test on battery; interconnect to siblings', priority: 'high' },
    ],
  },

  {
    id: 'plumbing-rough',
    trade: 'Plumbing',
    label: 'Plumbing rough-in walk',
    context: 'Before drywall — supply, drain, vent, pressure test',
    items: [
      { description: 'Pressure test holding (hydro at 50 psi for 15 min minimum, no drop)', priority: 'high' },
      { description: 'Drain slope is min 1/4" per foot to nearest vent / stack', priority: 'high' },
      { description: 'Supply lines secured every 6\' (vertical) / 4\' (horizontal); no bouncing pipe', priority: 'medium' },
      { description: 'Tubs / showers set, leveled, blocking present for grab bars', priority: 'medium' },
      { description: 'Water hammer arrestors at washer + dishwasher hookups', priority: 'low', notes: 'Easier to add now than after drywall' },
      { description: 'Cleanouts accessible — not buried behind trim or finished walls', priority: 'medium' },
      { description: 'Pex / copper / PVC compatible fittings confirmed; no mixed-metal joints without dielectric', priority: 'medium' },
      { description: 'Vents extend 6" above roof, properly flashed', priority: 'medium' },
      { description: 'Hose bibs frost-proof (in cold-climate jobs); shutoffs accessible', priority: 'medium' },
    ],
  },

  {
    id: 'plumbing-trim',
    trade: 'Plumbing',
    label: 'Plumbing trim walk',
    context: 'After tile / counters — fixtures, supply caps, leaks',
    items: [
      { description: 'Faucets installed plumb, no rocking, escutcheons sealed to wall', priority: 'medium' },
      { description: 'P-traps installed under every sink, no leaks under load', priority: 'high' },
      { description: 'Toilets bolted, sealed at base (caulked perimeter except 1" at back), no rock', priority: 'medium' },
      { description: 'Tub / shower drain: no slow drain, no gurgle, stopper works', priority: 'medium' },
      { description: 'Hot/cold reversed nowhere — verify at each fixture', priority: 'high' },
      { description: 'Angle stops accessible behind every fixture, working', priority: 'medium' },
      { description: 'Caulking at all wet joints continuous, no gaps', priority: 'medium' },
      { description: 'Water heater plumbed correctly: T&P, expansion tank if required, drain pan', priority: 'high' },
    ],
  },

  {
    id: 'drywall',
    trade: 'Drywall',
    label: 'Drywall finish walk',
    context: 'Final coat, before paint — flatness, corners, trims',
    items: [
      { description: 'Walls flat under raking light — no waves, no telegraph from screws', priority: 'medium', notes: 'Sidelight from windows shows defects best' },
      { description: 'Inside corners straight and sharp; no daylight, no bulging', priority: 'medium' },
      { description: 'Outside corner bead seated, no visible metal, no gaps', priority: 'medium' },
      { description: 'Screw / nail dimples filled flush; no exposed fasteners', priority: 'low' },
      { description: 'Joint compound sanded smooth; no swirl marks, no orange-peel from over-sand', priority: 'low' },
      { description: 'No tape lines visible at butt joints', priority: 'medium' },
      { description: 'Ceiling-to-wall transition straight, even shadow line', priority: 'low' },
      { description: 'Cutouts for outlets/switches sized correctly — no oversized holes showing through plate', priority: 'medium' },
      { description: 'Texture matches scope (level 5 / orange peel / knockdown) consistently across rooms', priority: 'medium' },
    ],
  },

  {
    id: 'painting',
    trade: 'Painting',
    label: 'Paint final walk',
    context: 'Touch-up walk before substantial completion',
    items: [
      { description: 'No roller marks visible under raking light', priority: 'medium' },
      { description: 'Cut lines clean: ceiling/wall transitions, baseboards, casings', priority: 'medium' },
      { description: 'Touch-ups on dings, drips, and over-spray on hardware/floors', priority: 'medium' },
      { description: 'Doors painted on tops + bottoms (rare miss; causes warping)', priority: 'low' },
      { description: 'Caulking on trim joints continuous before paint; no shrinkage cracks', priority: 'low' },
      { description: 'Color/sheen matches scope per room (matte / eggshell / satin / semigloss)', priority: 'medium' },
      { description: 'No paint on hinges, light fixtures, outlets, switches', priority: 'medium' },
      { description: 'Closets painted to scope (some scopes skip closet ceilings — verify against contract)', priority: 'low' },
    ],
  },

  {
    id: 'flooring',
    trade: 'Flooring',
    label: 'Flooring finish walk',
    context: 'After install, before furniture moves in',
    items: [
      { description: 'Field flat under straightedge — no high spots, no humps at seams', priority: 'medium' },
      { description: 'Transitions / thresholds installed, level, sealed', priority: 'medium' },
      { description: 'Reveals / expansion gaps at walls covered by base or shoe', priority: 'low' },
      { description: 'Tile grout joint width consistent; no haze on face', priority: 'medium' },
      { description: 'Tile cuts clean at edges, around floor outlets / vents', priority: 'medium' },
      { description: 'Hardwood: no lippage between boards (under 1/32"); no end-gaps', priority: 'medium' },
      { description: 'LVP / vinyl: seams tight, no curling at edges, factory-edge cuts at walls', priority: 'medium' },
      { description: 'Floor squeak-free under walking load (especially upstairs framing)', priority: 'high', notes: 'Squeaks become callback warranty' },
    ],
  },

  {
    id: 'tile',
    trade: 'Other',
    label: 'Tile work walk',
    context: 'Tub surrounds, kitchen back, floors — final QA',
    items: [
      { description: 'Grout color consistent across the field; no shading', priority: 'medium' },
      { description: 'Grout joints clean, no haze, no holidays in lines', priority: 'medium' },
      { description: 'Cuts symmetric at corners and at the field edges', priority: 'medium' },
      { description: 'Shower walls plumb, niches level, soap dish set straight', priority: 'medium' },
      { description: 'Slope toward shower drain achieved (water flow test)', priority: 'high' },
      { description: 'Caulking (not grout) at all change-of-plane joints (corner-to-corner, tub-to-tile)', priority: 'high', notes: 'Grout in those joints will crack' },
      { description: 'Tile-to-counter / tile-to-floor expansion joints sealed with matching caulk', priority: 'medium' },
      { description: 'Shower glass clean, no water marks; dam leveled; door swings without scraping', priority: 'low' },
    ],
  },

  {
    id: 'cabinets',
    trade: 'Other',
    label: 'Cabinet & countertop walk',
    context: 'After install, hardware on, counters set',
    items: [
      { description: 'Cabinet boxes plumb and level — no rocking, no gaps to wall', priority: 'medium' },
      { description: 'Doors aligned: even reveals top/bottom and door-to-door', priority: 'medium' },
      { description: 'Drawers operate smoothly, soft-close engages, no rubbing', priority: 'medium' },
      { description: 'Hardware (knobs / pulls) installed straight, consistent across runs', priority: 'low' },
      { description: 'Toe kicks scribed to floor, no daylight under cabinets', priority: 'low' },
      { description: 'Crown / scribe molding caulked to ceiling; no shrink gaps', priority: 'low' },
      { description: 'Counter seams level (under straightedge, no lippage); polished, no dull spots', priority: 'medium' },
      { description: 'Sink cutout flush with counter, undermount supports tight, no flex', priority: 'high' },
      { description: 'Backsplash continuous, no gap to counter at outlets / corners', priority: 'medium' },
    ],
  },

  {
    id: 'hvac',
    trade: 'HVAC',
    label: 'HVAC trim walk',
    context: 'After fixture install — vents, returns, t-stat, balance',
    items: [
      { description: 'Supply / return registers level and matching trim grilles', priority: 'low' },
      { description: 'Air balance: each room measured CFM matches design (within 10%)', priority: 'medium', notes: 'Get balance report' },
      { description: 'Thermostat installed plumb, on interior wall, away from drafts/sun', priority: 'medium' },
      { description: 'Filter accessible without tool removal, sized correctly', priority: 'low' },
      { description: 'Condensate drain piped to safe termination, with float switch', priority: 'high' },
      { description: 'Outdoor unit set on level pad, clearances met (24" minimum, 48" front)', priority: 'medium' },
      { description: 'Refrigerant lines insulated continuously, sleeve where they pass through framing', priority: 'low' },
      { description: 'Smart-thermostat paired and tested in heat + cool', priority: 'low' },
    ],
  },

  {
    id: 'doors-hardware',
    trade: 'Other',
    label: 'Doors & hardware walk',
    context: 'Final — every door operates correctly',
    items: [
      { description: 'Every door swings smoothly, latches without lift', priority: 'medium' },
      { description: 'Even reveal around all 4 sides of each door', priority: 'medium' },
      { description: 'Locks throw fully into strike with no shimming required', priority: 'high' },
      { description: 'Weatherstripping at exterior doors continuous, no daylight', priority: 'high', notes: 'Energy compliance + bug barrier' },
      { description: 'Door bottoms clear flooring (no scrape), thresholds adjusted', priority: 'medium' },
      { description: 'Closer doors self-close fully (garage to interior; egress)', priority: 'high' },
      { description: 'Hinges screwed with manufacturer screws (3" minimum on exterior)', priority: 'medium' },
      { description: 'Stops (wall or floor) installed everywhere a door can hit drywall', priority: 'low' },
    ],
  },

  {
    id: 'roofing',
    trade: 'Roofing',
    label: 'Roofing final walk',
    context: 'Asphalt or metal — flashing, edges, penetrations',
    items: [
      { description: 'Flashing at every penetration (vent, chimney, skylight) lapped correctly', priority: 'high' },
      { description: 'Drip edge installed under underlayment at eaves, over at rakes', priority: 'medium' },
      { description: 'Shingle courses parallel, no waves, no exposed nails', priority: 'medium' },
      { description: 'Hip / ridge caps centered, fully nailed, end caps closed', priority: 'medium' },
      { description: 'Valley shingles cut clean, no asphalt overhang past valley line', priority: 'low' },
      { description: 'Exhaust vents (kitchen, bath, dryer) terminated through roof, not soffit (when scope says so)', priority: 'medium' },
      { description: 'Gutters pitch to downspouts, water flows test passed', priority: 'high' },
      { description: 'Yard / driveway clear of roofing nails (magnet sweep)', priority: 'high', notes: 'Common warranty cause: tire flats from missed nails' },
    ],
  },

  {
    id: 'final-substantial-completion',
    trade: 'General',
    label: 'Final substantial-completion walk',
    context: 'GC walk before homeowner walk — catch everything else',
    items: [
      { description: 'All MEP systems running (HVAC heat & cool, all faucets, all switches)', priority: 'high' },
      { description: 'Appliances installed, leveled, run a cycle (DW, washer, range)', priority: 'high' },
      { description: 'Cleaners completed: floors, glass, fixtures, behind toilets, tops of cabinets', priority: 'medium' },
      { description: 'All filters fresh (HVAC, range hood, fridge water if any)', priority: 'low' },
      { description: 'Permits closed at city — final inspection certs in hand', priority: 'high' },
      { description: 'All warranties + appliance manuals + paint codes assembled in closeout binder', priority: 'medium' },
      { description: 'Site cleanup: dumpster gone, no construction debris in yard or garage', priority: 'medium' },
      { description: 'Landscaping/exterior: no damage from staging; sod / mulch restored', priority: 'medium' },
      { description: 'Smoke detectors chirp-tested with fresh batteries', priority: 'high' },
      { description: 'Keys ready: master key + spares; garage code reset; smart-home accounts handed off', priority: 'high' },
    ],
  },
];

/**
 * Group templates by trade for the picker UI. Returns trades in a
 * sensible order — trades that come up most often in residential first.
 */
export function getPunchTemplatesByTrade(): { trade: SubTrade; templates: PunchTemplate[] }[] {
  const groups = new Map<SubTrade, PunchTemplate[]>();
  for (const t of PUNCH_TEMPLATES) {
    const list = groups.get(t.trade) ?? [];
    list.push(t);
    groups.set(t.trade, list);
  }
  // Order by frequency-of-use in residential GC work, not alphabetical.
  const ORDER: SubTrade[] = [
    'General', 'Electrical', 'Plumbing', 'HVAC', 'Drywall', 'Painting',
    'Flooring', 'Roofing', 'Other', 'Framing', 'Concrete', 'Landscaping',
  ];
  const out: { trade: SubTrade; templates: PunchTemplate[] }[] = [];
  for (const trade of ORDER) {
    const templates = groups.get(trade);
    if (templates && templates.length > 0) out.push({ trade, templates });
  }
  return out;
}
