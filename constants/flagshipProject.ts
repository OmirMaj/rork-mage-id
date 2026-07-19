// constants/flagshipProject.ts — The Overlook Estate.
//
// The FLAGSHIP demo project + reusable template. This is the single
// source of truth for MAGE ID's marquee demo: one very complex, fully
// internally-consistent luxury build, mid-construction today, filled
// start-to-finish across every feature so marketing/App-Store shots on
// iOS and web read as a real, live, healthy job to BOTH contractors and
// property owners.
//
// Everything here is PURE DATA (no React, no side effects, no styles) so
// it's safe to import from a seeder, a test, or a template picker. The
// numbers are authored to SUM correctly and tell a coherent story:
//   - $9.18M GMP contract on a 7,850 sf estate ($1,169/sf — realistic for
//     a Bay-Area luxury hillside build). The 53-item SOV base × 1.16 fee
//     lands exactly on the contract value.
//   - Schedule ~55% complete by cost (day 196 of a 354-day plan): the
//     expensive early spine — site, concrete, steel — is done; finishes
//     and site are upcoming. Mostly on track, with ONE well-handled
//     flagged risk (imported steel slipped 8 days at the mill → GC
//     recovered it with a no-cost re-sequence + a documented CO).
//   - Change orders a good GC navigated (mix approved / pending / one
//     declined) that adjust the contract coherently.
//   - Transparent open-book / GMP billing with 10% retention held.
//
// The `FLAGSHIP_SCHEDULE_TEMPLATE` at the bottom mirrors the shape of
// constants/scheduleTemplates.ts so a user can start a brand-new project
// from this project's schedule spine.

import type { ScheduleTemplate } from '@/constants/scheduleTemplates';

// ─────────────────────────────────────────────────────────────────────
// Identity + story
// ─────────────────────────────────────────────────────────────────────

/** How far in the past Day 1 of construction sits. At day 196 of a 354-day
 *  plan the build reads as mid-construction (~55% complete by cost) — plenty
 *  of history to show, a live critical path, and upcoming milestones in the
 *  next two weeks. */
export const FLAGSHIP_START_DAYS_AGO = 196;

/** Guaranteed-Maximum-Price contract value the owner signed. Matches the
 *  53-item SOV base ($7,912,060) × the 16% builder's fee, rounded. All
 *  billing, pay-apps, and portal cost math anchor to this. */
export const FLAGSHIP_CONTRACT_VALUE = 9_180_000;

/** Builder's fee on cost (GMP). Drives the open-book portal math. */
export const FLAGSHIP_FEE_PERCENT = 16;

export const FLAGSHIP_IDENTITY = {
  name: 'The Overlook Estate',
  type: 'new_build' as const,
  location: '1 Vista Ridge Ct, Los Altos Hills, CA 94022',
  squareFootage: 7850,
  quality: 'luxury' as const,
  description:
    'Ground-up modern hillside estate — 6,400 sf main residence + 1,450 sf detached guest house (ADU) over a shared subterranean garage. Board-formed concrete + exposed structural steel, floor-to-ceiling glass curtain wall, chef\'s kitchen with scullery, spa primary wing, 900-bottle wine cellar, negative-edge pool + spa, 22kW rooftop solar with whole-home battery. 5 beds / 6.5 baths. Title-24 all-electric, seeking LEED Gold.',
  primaryContact: {
    name: 'James & Priya Whitaker',
    phone: '(650) 555-0182',
    email: 'priya.whitaker@example.com',
  },
  clientPortalWelcome:
    'Welcome to the live build portal for The Overlook Estate. Your schedule, budget, selections, photos, and every daily update land here in real time — nothing to log into twice, nothing hidden. We run this job open-book: you see actual cost against the guaranteed maximum, always. Message us any time.',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Linked estimate — Schedule of Values by CSI division
// ─────────────────────────────────────────────────────────────────────
//
// 54 line items across 20+ CSI divisions. Realistic unit costs × quantities
// for a Bay-Area luxury hillside build. Per-item markup is uniform (the
// GMP fee); a few finish items are carried as ALLOWANCES so the
// allowance → selection → firm-price story reads end-to-end. baseTotal ×
// (1 + markup) is computed by the builder below so the grand total always
// sums exactly.

/** Uniform per-line + global markup — the GMP builder's fee. */
export const FLAGSHIP_MARKUP_PCT = FLAGSHIP_FEE_PERCENT;

export interface FlagshipEstimateSeed {
  materialId: string;
  name: string;
  category: string;
  csiDivision: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  isAllowance?: boolean;
}

// Base (pre-fee) cost breakdown. The GMP fee is applied on top so the
// contract lands at ~$3.24M. Authored so the summed base × 1.16 ≈ contract.
export const FLAGSHIP_ESTIMATE_ITEMS: FlagshipEstimateSeed[] = [
  // ── 01 General Requirements ──
  { materialId: 'li-genconds', name: 'General conditions & jobsite supervision', category: 'General', csiDivision: '01', unit: 'mo', quantity: 13, unitPrice: 14_800 },
  { materialId: 'li-genreq-temp', name: 'Temporary power, water, fencing & sanitation', category: 'General', csiDivision: '01', unit: 'ls', quantity: 1, unitPrice: 41_200 },
  { materialId: 'li-genreq-clean', name: 'Progressive & final cleaning', category: 'General', csiDivision: '01', unit: 'ls', quantity: 1, unitPrice: 22_500 },
  { materialId: 'li-genreq-crane', name: 'Tower crane rental & operation', category: 'General', csiDivision: '01', unit: 'mo', quantity: 5, unitPrice: 18_400 },

  // ── 02 / 31 / 33 Existing Conditions & Earthwork ──
  { materialId: 'li-demo', name: 'Demolition of existing cottage & abatement', category: 'Sitework', csiDivision: '02', unit: 'ls', quantity: 1, unitPrice: 38_000 },
  { materialId: 'li-erosion', name: 'Erosion control & SWPPP (hillside)', category: 'Sitework', csiDivision: '31', unit: 'ls', quantity: 1, unitPrice: 29_500 },
  { materialId: 'li-excav', name: 'Mass excavation & export (hillside cut)', category: 'Sitework', csiDivision: '31', unit: 'cy', quantity: 3_100, unitPrice: 62 },
  { materialId: 'li-shoring', name: 'Soldier-pile shoring & tiebacks', category: 'Sitework', csiDivision: '31', unit: 'ls', quantity: 1, unitPrice: 168_000 },
  { materialId: 'li-utilities', name: 'Site utilities — sewer, water, gas, dry', category: 'Sitework', csiDivision: '33', unit: 'ls', quantity: 1, unitPrice: 96_000 },

  // ── 03 Concrete ──
  { materialId: 'li-caissons', name: 'Drilled caissons & grade beams', category: 'Concrete', csiDivision: '31', unit: 'ls', quantity: 1, unitPrice: 214_000 },
  { materialId: 'li-foundation', name: 'Foundation walls & mat slab', category: 'Concrete', csiDivision: '03', unit: 'cy', quantity: 640, unitPrice: 545 },
  { materialId: 'li-board-formed', name: 'Board-formed architectural concrete', category: 'Concrete', csiDivision: '03', unit: 'sf', quantity: 3_400, unitPrice: 68 },
  { materialId: 'li-flatwork', name: 'Interior slabs-on-deck & garage flatwork', category: 'Concrete', csiDivision: '03', unit: 'sf', quantity: 6_800, unitPrice: 22 },

  // ── 05 Metals ──
  { materialId: 'li-steel', name: 'Structural steel — fabricate & erect', category: 'Structural', csiDivision: '05', unit: 'ton', quantity: 96, unitPrice: 6_950 },
  { materialId: 'li-steel-misc', name: 'Miscellaneous & ornamental metals', category: 'Structural', csiDivision: '05', unit: 'ls', quantity: 1, unitPrice: 74_000 },
  { materialId: 'li-mono-stair', name: 'Floating monostringer feature staircase', category: 'Structural', csiDivision: '05', unit: 'ls', quantity: 1, unitPrice: 88_000 },

  // ── 06 Wood & Plastics ──
  { materialId: 'li-framing', name: 'Rough carpentry & heavy timber framing', category: 'Carpentry', csiDivision: '06', unit: 'ls', quantity: 1, unitPrice: 268_000 },
  { materialId: 'li-millwork', name: 'Architectural millwork & casework', category: 'Finishes', csiDivision: '06', unit: 'ls', quantity: 1, unitPrice: 246_000 },
  { materialId: 'li-cabinetry', name: 'Kitchen, scullery & bath cabinetry', category: 'Finishes', csiDivision: '06', unit: 'ls', quantity: 1, unitPrice: 158_000 },
  { materialId: 'li-wine-cellar', name: 'Wine cellar racking & glass enclosure', category: 'Finishes', csiDivision: '06', unit: 'ls', quantity: 1, unitPrice: 62_000 },

  // ── 07 Thermal & Moisture ──
  { materialId: 'li-waterproof', name: 'Below-grade & deck waterproofing', category: 'Envelope', csiDivision: '07', unit: 'sf', quantity: 8_200, unitPrice: 14 },
  { materialId: 'li-insulation', name: 'Spray foam & batt insulation', category: 'Envelope', csiDivision: '07', unit: 'sf', quantity: 9_400, unitPrice: 6.5 },
  { materialId: 'li-roof', name: 'TPO + standing-seam metal roof assembly', category: 'Envelope', csiDivision: '07', unit: 'sf', quantity: 6_900, unitPrice: 34 },
  { materialId: 'li-cladding', name: 'Cor-ten & thermally-modified wood cladding', category: 'Envelope', csiDivision: '07', unit: 'sf', quantity: 4_600, unitPrice: 52 },

  // ── 08 Openings ──
  { materialId: 'li-curtainwall', name: 'Structural glass curtain wall (imported)', category: 'Envelope', csiDivision: '08', unit: 'sf', quantity: 2_800, unitPrice: 168 },
  { materialId: 'li-windows', name: 'Aluminum-clad windows & lift-slide doors', category: 'Envelope', csiDivision: '08', unit: 'ls', quantity: 1, unitPrice: 224_000 },
  { materialId: 'li-doors', name: 'Interior doors, hardware & specialties', category: 'Finishes', csiDivision: '08', unit: 'ls', quantity: 1, unitPrice: 64_000 },
  { materialId: 'li-garage-doors', name: 'Glass sectional garage doors', category: 'Envelope', csiDivision: '08', unit: 'ea', quantity: 3, unitPrice: 12_400 },

  // ── 09 Finishes ──
  { materialId: 'li-drywall', name: 'Insulation, drywall hang, tape & Level-5', category: 'Finishes', csiDivision: '09', unit: 'sf', quantity: 22_400, unitPrice: 5.4 },
  { materialId: 'li-plaster', name: 'Venetian plaster & specialty wall finishes', category: 'Finishes', csiDivision: '09', unit: 'sf', quantity: 3_100, unitPrice: 28 },
  { materialId: 'li-flooring-wood', name: 'Wide-plank rift white-oak flooring', category: 'Finishes', csiDivision: '09', unit: 'sf', quantity: 5_200, unitPrice: 32 },
  { materialId: 'li-flooring-stone', name: 'Natural stone slab & tile flooring', category: 'Finishes', csiDivision: '09', unit: 'sf', quantity: 2_600, unitPrice: 48, isAllowance: true },
  { materialId: 'li-tile', name: 'Bath & feature-wall tile allowance', category: 'Finishes', csiDivision: '09', unit: 'ls', quantity: 1, unitPrice: 96_000, isAllowance: true },
  { materialId: 'li-paint', name: 'Interior & exterior painting', category: 'Finishes', csiDivision: '09', unit: 'ls', quantity: 1, unitPrice: 78_000 },

  // ── 10 / 11 / 12 Specialties, Equipment, Furnishings ──
  { materialId: 'li-appliances', name: 'Kitchen & scullery appliance package', category: 'Finishes', csiDivision: '11', unit: 'ls', quantity: 1, unitPrice: 118_000, isAllowance: true },
  { materialId: 'li-countertops', name: 'Stone countertops & slab surrounds', category: 'Finishes', csiDivision: '12', unit: 'ls', quantity: 1, unitPrice: 92_000 },
  { materialId: 'li-specialties', name: 'Bath accessories, closets & specialties', category: 'Finishes', csiDivision: '10', unit: 'ls', quantity: 1, unitPrice: 54_000 },

  // ── 13 / 14 Special Construction & Conveying ──
  { materialId: 'li-pool', name: 'Negative-edge pool, spa & equipment', category: 'Sitework', csiDivision: '13', unit: 'ls', quantity: 1, unitPrice: 268_000 },
  { materialId: 'li-elevator', name: 'Residential elevator (3-stop)', category: 'Specialties', csiDivision: '14', unit: 'ls', quantity: 1, unitPrice: 78_000 },
  { materialId: 'li-smart-home', name: 'Lighting control, AV & smart-home', category: 'Electrical', csiDivision: '27', unit: 'ls', quantity: 1, unitPrice: 142_000 },

  // ── 21 / 22 / 23 Fire, Plumbing, HVAC ──
  { materialId: 'li-fire', name: 'Fire sprinkler & suppression', category: 'MEP', csiDivision: '21', unit: 'ls', quantity: 1, unitPrice: 68_000 },
  { materialId: 'li-plumbing', name: 'Plumbing rough & fixtures', category: 'MEP', csiDivision: '22', unit: 'ls', quantity: 1, unitPrice: 214_000 },
  { materialId: 'li-plumbing-fixtures', name: 'Plumbing fixtures & fittings allowance', category: 'MEP', csiDivision: '22', unit: 'ls', quantity: 1, unitPrice: 86_000, isAllowance: true },
  { materialId: 'li-hvac', name: 'All-electric heat-pump HVAC & ERV', category: 'MEP', csiDivision: '23', unit: 'ls', quantity: 1, unitPrice: 196_000 },
  { materialId: 'li-radiant', name: 'Hydronic radiant floor heating', category: 'MEP', csiDivision: '23', unit: 'sf', quantity: 6_400, unitPrice: 16 },

  // ── 26 Electrical + Solar ──
  { materialId: 'li-electrical', name: 'Electrical rough, panels & devices', category: 'Electrical', csiDivision: '26', unit: 'ls', quantity: 1, unitPrice: 224_000 },
  { materialId: 'li-lighting', name: 'Architectural lighting fixture allowance', category: 'Electrical', csiDivision: '26', unit: 'ls', quantity: 1, unitPrice: 88_000, isAllowance: true },
  { materialId: 'li-solar', name: '22 kW solar + 40 kWh battery storage', category: 'Electrical', csiDivision: '26', unit: 'ls', quantity: 1, unitPrice: 132_000 },
  { materialId: 'li-generator', name: 'Standby generator & transfer switch', category: 'Electrical', csiDivision: '26', unit: 'ls', quantity: 1, unitPrice: 34_000 },

  // ── 32 Landscape & Sitework ──
  { materialId: 'li-hardscape', name: 'Hardscape, retaining walls & site stairs', category: 'Sitework', csiDivision: '32', unit: 'ls', quantity: 1, unitPrice: 186_000 },
  { materialId: 'li-landscape', name: 'Landscape, irrigation & lighting', category: 'Landscaping', csiDivision: '32', unit: 'ls', quantity: 1, unitPrice: 148_000 },
  { materialId: 'li-driveway', name: 'Motor court & driveway paving', category: 'Sitework', csiDivision: '32', unit: 'sf', quantity: 4_200, unitPrice: 26 },
  { materialId: 'li-green-roof', name: 'Living green roof over garage', category: 'Landscaping', csiDivision: '32', unit: 'sf', quantity: 1_800, unitPrice: 42 },
];

// ─────────────────────────────────────────────────────────────────────
// Schedule spine — phases, dependencies, weather sensitivity
// ─────────────────────────────────────────────────────────────────────
//
// 42 tasks. startDay offsets are from the schedule startDate (Day 1).
// Progress is authored consistent with mid-construction "today" (day 196 of
// 354 — ~52% complete by cost, ~41% by task-duration weight):
// everything up to dry-in/MEP is done or in-progress; finishes & site
// are upcoming. The critical path runs the structural spine:
//   permits → shoring → excavation → caissons → foundation → steel →
//   framing → dry-in → rough MEP → drywall → finishes → CO.
// One critical task (steel) shows a recovered slip via the baseline.

export interface FlagshipTaskSeed {
  id: string;
  title: string;
  phase: string;
  startDay: number;
  durationDays: number;
  progress: number;
  crew: string;
  crewSize: number;
  deps: string[];
  critical?: boolean;
  weather?: boolean;
  milestone?: boolean;
  /** Baseline end-day delta vs current (positive = task now finishes
   *  LATER than baseline → visible slip; negative = ahead). */
  baselineEndDelta?: number;
  notes?: string;
  rationale?: string;
}

export const FLAGSHIP_TASKS: FlagshipTaskSeed[] = [
  // Pre-construction
  { id: 't-permit', title: 'Permitting, entitlements & plan check', phase: 'Pre-Construction', startDay: 0, durationDays: 34, progress: 100, crew: 'Office', crewSize: 1, deps: [], critical: true, rationale: 'Hillside grading + geotech review drove the plan-check duration; sequenced first because every field task gates on the master building permit.' },
  { id: 't-mobilize', title: 'Mobilization & site setup', phase: 'Pre-Construction', startDay: 30, durationDays: 8, progress: 100, crew: 'GC', crewSize: 4, deps: ['t-permit'] },
  { id: 't-demo', title: 'Demo existing cottage & abatement', phase: 'Sitework', startDay: 34, durationDays: 10, progress: 100, crew: 'Demo', crewSize: 5, deps: ['t-mobilize'], weather: true },

  // Sitework / earthwork
  { id: 't-erosion', title: 'Erosion control & SWPPP', phase: 'Sitework', startDay: 40, durationDays: 6, progress: 100, crew: 'Earthworks', crewSize: 4, deps: ['t-demo'], weather: true },
  { id: 't-shoring', title: 'Soldier-pile shoring & tiebacks', phase: 'Sitework', startDay: 46, durationDays: 18, progress: 100, crew: 'Shoring', crewSize: 6, deps: ['t-erosion'], critical: true, weather: true, rationale: 'Hillside cut required shoring before mass excavation could proceed safely — a hard predecessor on the critical path.' },
  { id: 't-excav', title: 'Mass excavation & export', phase: 'Sitework', startDay: 60, durationDays: 20, progress: 100, crew: 'Earthworks', crewSize: 6, deps: ['t-shoring'], critical: true, weather: true },
  { id: 't-utilities', title: 'Site utilities rough', phase: 'Sitework', startDay: 78, durationDays: 14, progress: 100, crew: 'Site', crewSize: 4, deps: ['t-excav'] },

  // Foundation / concrete
  { id: 't-caissons', title: 'Drilled caissons & grade beams', phase: 'Foundation', startDay: 80, durationDays: 16, progress: 100, crew: 'Concrete', crewSize: 8, deps: ['t-excav'], critical: true, rationale: 'Deep caissons carry the hillside structure; must cure before foundation walls.' },
  { id: 't-found-inspect', title: 'Foundation / pre-pour inspection', phase: 'Foundation', startDay: 96, durationDays: 2, progress: 100, crew: 'Office', crewSize: 1, deps: ['t-caissons'], critical: true, milestone: true },
  { id: 't-foundation', title: 'Foundation walls & mat slab', phase: 'Foundation', startDay: 98, durationDays: 20, progress: 100, crew: 'Concrete', crewSize: 8, deps: ['t-found-inspect'], critical: true },
  { id: 't-waterproof', title: 'Below-grade waterproofing', phase: 'Foundation', startDay: 116, durationDays: 10, progress: 100, crew: 'Waterproofing', crewSize: 4, deps: ['t-foundation'] },
  { id: 't-board-formed', title: 'Board-formed architectural concrete', phase: 'Foundation', startDay: 118, durationDays: 22, progress: 100, crew: 'Concrete', crewSize: 6, deps: ['t-foundation'] },

  // Structure
  { id: 't-steel', title: 'Structural steel fabricate & erect', phase: 'Structure', startDay: 122, durationDays: 30, progress: 100, crew: 'Steel', crewSize: 7, deps: ['t-foundation'], critical: true, baselineEndDelta: 8, notes: 'Imported members slipped 8 days at the mill; recovered by re-sequencing framing start — no net project slip.', rationale: 'Long-lead imported steel; critical because framing and everything above the deck depends on topped-out structure.' },
  { id: 't-elevator-rough', title: 'Elevator shaft & rails rough', phase: 'Structure', startDay: 140, durationDays: 12, progress: 100, crew: 'Elevator', crewSize: 3, deps: ['t-steel'] },
  { id: 't-framing', title: 'Rough carpentry & heavy timber framing', phase: 'Structure', startDay: 150, durationDays: 34, progress: 92, crew: 'Carpentry', crewSize: 9, deps: ['t-steel'], critical: true, baselineEndDelta: 4 },
  { id: 't-mono-stair', title: 'Floating feature staircase install', phase: 'Structure', startDay: 178, durationDays: 12, progress: 60, crew: 'Steel', crewSize: 4, deps: ['t-framing'] },

  // Envelope / dry-in
  { id: 't-roof', title: 'Roof assembly & dry-in', phase: 'Envelope', startDay: 176, durationDays: 20, progress: 88, crew: 'Roofing', crewSize: 6, deps: ['t-framing'], critical: true, weather: true },
  { id: 't-windows', title: 'Windows & lift-slide doors', phase: 'Envelope', startDay: 188, durationDays: 16, progress: 45, crew: 'Glazing', crewSize: 5, deps: ['t-roof'] },
  { id: 't-curtainwall', title: 'Structural glass curtain wall', phase: 'Envelope', startDay: 196, durationDays: 22, progress: 20, crew: 'Glazing', crewSize: 6, deps: ['t-roof'], critical: true, rationale: 'Imported curtain-wall panels are the pacing envelope item and gate weather-tight interior work.' },
  { id: 't-cladding', title: 'Exterior cladding & rainscreen', phase: 'Envelope', startDay: 200, durationDays: 26, progress: 12, crew: 'Cladding', crewSize: 5, deps: ['t-roof'], weather: true },

  // MEP rough
  { id: 't-plumb-rough', title: 'Plumbing rough-in', phase: 'MEP', startDay: 186, durationDays: 26, progress: 55, crew: 'Plumbing', crewSize: 6, deps: ['t-framing'] },
  { id: 't-elec-rough', title: 'Electrical rough-in', phase: 'MEP', startDay: 190, durationDays: 28, progress: 48, crew: 'Electrical', crewSize: 7, deps: ['t-framing'], critical: true },
  { id: 't-hvac-rough', title: 'HVAC & radiant rough-in', phase: 'MEP', startDay: 192, durationDays: 26, progress: 40, crew: 'Mechanical', crewSize: 6, deps: ['t-framing'] },
  { id: 't-fire-rough', title: 'Fire sprinkler rough-in', phase: 'MEP', startDay: 196, durationDays: 16, progress: 30, crew: 'Fire', crewSize: 3, deps: ['t-framing'] },
  { id: 't-lowvolt', title: 'Smart-home & low-voltage rough', phase: 'MEP', startDay: 200, durationDays: 22, progress: 15, crew: 'AV', crewSize: 4, deps: ['t-framing'] },
  { id: 't-mep-inspect', title: 'Rough MEP inspection', phase: 'MEP', startDay: 218, durationDays: 3, progress: 0, crew: 'Office', crewSize: 1, deps: ['t-plumb-rough', 't-elec-rough', 't-hvac-rough', 't-fire-rough'], critical: true, milestone: true },

  // Interior finishes
  { id: 't-insulation', title: 'Insulation & building envelope seal', phase: 'Finishes', startDay: 221, durationDays: 12, progress: 0, crew: 'Insulation', crewSize: 4, deps: ['t-mep-inspect', 't-windows'], critical: true },
  { id: 't-drywall', title: 'Drywall hang, tape & Level-5', phase: 'Finishes', startDay: 233, durationDays: 26, progress: 0, crew: 'Drywall', crewSize: 8, deps: ['t-insulation'], critical: true },
  { id: 't-plaster', title: 'Venetian plaster & specialty finishes', phase: 'Finishes', startDay: 255, durationDays: 18, progress: 0, crew: 'Plaster', crewSize: 4, deps: ['t-drywall'] },
  { id: 't-millwork', title: 'Architectural millwork & cabinetry', phase: 'Finishes', startDay: 259, durationDays: 34, progress: 0, crew: 'Millwork', crewSize: 6, deps: ['t-drywall'], critical: true },
  { id: 't-tile', title: 'Stone & tile install', phase: 'Finishes', startDay: 265, durationDays: 28, progress: 0, crew: 'Tile', crewSize: 5, deps: ['t-drywall'] },
  { id: 't-flooring', title: 'Wood & stone flooring', phase: 'Finishes', startDay: 273, durationDays: 24, progress: 0, crew: 'Flooring', crewSize: 5, deps: ['t-drywall'] },
  { id: 't-paint', title: 'Interior & exterior paint', phase: 'Finishes', startDay: 285, durationDays: 22, progress: 0, crew: 'Painting', crewSize: 6, deps: ['t-plaster', 't-millwork'] },
  { id: 't-countertops', title: 'Stone countertops & surrounds', phase: 'Finishes', startDay: 293, durationDays: 12, progress: 0, crew: 'Stone', crewSize: 4, deps: ['t-millwork'] },
  { id: 't-wine-cellar', title: 'Wine cellar racking & glass', phase: 'Finishes', startDay: 300, durationDays: 14, progress: 0, crew: 'Millwork', crewSize: 3, deps: ['t-flooring'] },

  // MEP trim + specialties
  { id: 't-mep-trim', title: 'MEP trim, fixtures & devices', phase: 'Finishes', startDay: 305, durationDays: 24, progress: 0, crew: 'MEP', crewSize: 8, deps: ['t-countertops', 't-paint'], critical: true },
  { id: 't-appliances', title: 'Appliance & specialty install', phase: 'Finishes', startDay: 320, durationDays: 10, progress: 0, crew: 'GC', crewSize: 4, deps: ['t-countertops'] },
  { id: 't-elevator-final', title: 'Elevator finish & inspection', phase: 'Finishes', startDay: 322, durationDays: 8, progress: 0, crew: 'Elevator', crewSize: 2, deps: ['t-mep-trim'] },

  // Site + closeout
  { id: 't-pool', title: 'Negative-edge pool & spa', phase: 'Sitework', startDay: 250, durationDays: 60, progress: 0, crew: 'Pool', crewSize: 5, deps: ['t-board-formed'], weather: true },
  { id: 't-hardscape', title: 'Hardscape, retaining & landscape', phase: 'Sitework', startDay: 300, durationDays: 46, progress: 0, crew: 'Landscape', crewSize: 6, deps: ['t-cladding'], weather: true },
  { id: 't-final', title: 'Final finishes, commissioning & punch', phase: 'Closeout', startDay: 329, durationDays: 24, progress: 0, crew: 'GC', crewSize: 6, deps: ['t-mep-trim', 't-flooring', 't-hardscape'], critical: true },
  { id: 't-co', title: 'Final inspection & Certificate of Occupancy', phase: 'Closeout', startDay: 353, durationDays: 1, progress: 0, crew: 'Office', crewSize: 1, deps: ['t-final'], critical: true, milestone: true },
];

// ─────────────────────────────────────────────────────────────────────
// Reusable schedule template
// ─────────────────────────────────────────────────────────────────────
//
// Mirrors constants/scheduleTemplates.ts (TemplateTask + ScheduleTemplate)
// so a user can start a fresh project from The Overlook Estate's spine.
// Derived from FLAGSHIP_TASKS: same titles/phases/durations/dependencies,
// with progress + dates stripped (a template is a plan skeleton, not a
// live job). This is exported for the template picker to consume.

export const FLAGSHIP_SCHEDULE_TEMPLATE: ScheduleTemplate = {
  id: 'flagship-luxury-estate',
  name: 'Luxury Hillside Estate (Overlook)',
  taskCount: FLAGSHIP_TASKS.length,
  typicalDuration: '50 weeks',
  tasks: FLAGSHIP_TASKS.map((t) => ({
    id: t.id,
    name: t.title,
    phase: t.phase,
    duration: t.durationDays,
    predecessorIds: t.deps,
    isMilestone: !!t.milestone,
    isCriticalPath: !!t.critical,
    crewSize: t.crewSize,
  })),
};
