// demoSeed — first-time-user sample projects.
//
// Three flavors so the new user can pick what looks closest to their
// real work:
//   - 'small'  — ~$420K kitchen + 2 bath remodel. Single-trade-heavy,
//                solo-operator-friendly. Default flavor.
//   - 'medium' — ~$512K full brownstone gut. The original Henderson
//                project; preserved as a middle ground.
//   - 'large'  — ~$14.4M new-construction 24-unit condominium.
//                Multi-trade buyout, AIA pay apps, deep schedule.
//
// Same SeedCtx surface across all three so callers don't branch.
//
// Public API:
//   seedDemoProject({ ...ctx, flavor })
// where flavor defaults to 'medium' for backward compatibility with the
// pre-multi-flavor home-empty-state wiring.

import type {
  Project, Invoice, DailyFieldReport, PunchItem, ProjectPhoto,
  ChangeOrder, RFI,
} from '@/types';
import { generateUUID } from '@/utils/generateId';

export type DemoFlavor = 'small' | 'medium' | 'large';

interface SeedCtx {
  addProject: (p: Project) => void;
  addInvoice: (i: Invoice) => void;
  addDailyReport: (d: DailyFieldReport) => void;
  addPunchItem: (p: PunchItem) => void;
  addProjectPhoto: (p: ProjectPhoto) => void;
  addRFI: (r: Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>) => void;
  addChangeOrder: (co: ChangeOrder) => void;
}

export interface SeedOpts {
  /** Which sample to seed. Defaults to 'medium' for backward-compat. */
  flavor?: DemoFlavor;
}

/** Display-meta for the seeder picker UI. Caller renders these as
 *  cards before invoking `seedDemoProject`. Keep numbers in sync with
 *  the actual seed below. */
export const DEMO_FLAVORS: Record<DemoFlavor, {
  name: string;
  scope: string;
  total: number;
  durationLabel: string;
  squareFootage: number;
  complexity: 'low' | 'medium' | 'high';
}> = {
  small: {
    name: 'Sample — Sarah\'s Place',
    scope: 'Kitchen + 2 bath remodel · 1980s ranch',
    total: 422_400,
    durationLabel: '8 weeks',
    squareFootage: 820,
    complexity: 'low',
  },
  medium: {
    name: 'Sample — The Henderson Residence',
    scope: 'Full-gut renovation · 3-story brownstone',
    total: 511_863,
    durationLabel: '5–6 months',
    squareFootage: 3_200,
    complexity: 'medium',
  },
  large: {
    name: 'Sample — Bay Ridge Lofts',
    scope: '24-unit, 4-story condominium · ground-up',
    total: 14_385_200,
    durationLabel: '14–16 months',
    squareFootage: 28_400,
    complexity: 'high',
  },
};

/** Backward-compat single-arg overload calls medium. */
export async function seedDemoProject(
  ctx: SeedCtx & SeedOpts,
): Promise<{ projectId: string }> {
  const flavor: DemoFlavor = ctx.flavor ?? 'medium';
  switch (flavor) {
    case 'small':  return seedSmall(ctx);
    case 'large':  return seedLarge(ctx);
    case 'medium':
    default:       return seedMedium(ctx);
  }
}

// ───────────────────────────────────────────────────────────────────────
// Time helpers shared across flavors.
// ───────────────────────────────────────────────────────────────────────

function timeHelpers() {
  const now = new Date();
  const isoNow = now.toISOString();
  const dayMs = 24 * 60 * 60 * 1000;
  const isoDaysAgo = (n: number) => new Date(now.getTime() - n * dayMs).toISOString();
  return { now, isoNow, isoDaysAgo };
}

// ═══════════════════════════════════════════════════════════════════════
// SMALL — $422K kitchen + 2 bath remodel.
// Solo-operator, 8-week duration, 30% complete.
// ═══════════════════════════════════════════════════════════════════════
async function seedSmall(ctx: SeedCtx): Promise<{ projectId: string }> {
  const { isoNow, isoDaysAgo } = timeHelpers();
  const projectId = generateUUID();
  const meta = DEMO_FLAVORS.small;

  ctx.addProject({
    id: projectId,
    name: meta.name,
    type: 'renovation',
    location: '481 Maplewood Ave, Glen Ridge NJ 07028',
    squareFootage: meta.squareFootage,
    quality: 'standard',
    description: 'Demo project — bread-and-butter residential remodel: replace old kitchen + 2 baths in a 1980s ranch. Tap Delete on the project tile to wipe it.',
    createdAt: isoDaysAgo(45),
    updatedAt: isoNow,
    estimate: {
      materialTotal: 168_400,
      laborTotal: 112_800,
      permits: 3_200,
      overhead: 18_700,
      contingency: 12_400,
      taxAmount: 22_900,
      totalCost: 338_400,
      markupPercent: 25,
      markupAmount: 84_000,
      grandTotal: meta.total,
      pricePerSqFt: 515.12,
      estimatedDuration: meta.durationLabel,
      materials: [],
    },
    status: 'in_progress',
  } as unknown as Project);

  // Invoices — 2: a paid deposit + an outstanding progress bill.
  invoiceTemplate(ctx, projectId, [
    { number: 1, pct: 20, daysAgoIssue: 38, daysAgoDue: 8, amount: 84_480, paid: 84_480, status: 'paid', label: 'Deposit — 20%' },
    { number: 2, pct: 35, daysAgoIssue: 5, daysAgoDue: -25, amount: 63_360, paid: 0, status: 'sent', label: 'Progress — 35% complete' },
  ]);

  // 4 daily reports
  dailyReportTemplate(ctx, projectId, [
    { daysAgo: 1, temp: '62°F', conditions: 'Clear', work: 'Plumbing rough-in continues in primary bath. Cabinet delivery confirmed for Friday.', crew: [{ trade: 'Plumbing', company: 'NorthSide Plumbing', headcount: 2, hours: 8 }] },
    { daysAgo: 3, temp: '58°F', conditions: 'Cloudy', work: 'Demo of kitchen + hall bath complete. Started electrical pull for new island.', crew: [{ trade: 'Carpentry', company: 'Riverbend Build', headcount: 2, hours: 8 }, { trade: 'Electrical', company: 'Volt Bros', headcount: 1, hours: 6 }] },
    { daysAgo: 7, temp: '54°F', conditions: 'Rain', work: 'Indoor only. Drywall delivery received. Insulation on west wall complete.', crew: [{ trade: 'Carpentry', company: 'Riverbend Build', headcount: 2, hours: 8 }] },
    { daysAgo: 14, temp: '60°F', conditions: 'Partly cloudy', work: 'Kicked off demo. Salvaged original cabinets for owner. Set up dust containment.', crew: [{ trade: 'Demo', company: 'Riverbend Build', headcount: 3, hours: 8 }] },
  ]);

  // 2 RFIs
  ctx.addRFI({
    projectId,
    subject: 'Confirm cabinet pull spec',
    question: 'Owner showed two pull options at last walk — confirm satin nickel #4827 vs. matte black #5318.',
    priority: 'normal',
    status: 'answered',
    assignedTo: 'Sarah (Owner)',
    dateSubmitted: isoDaysAgo(8),
    dateRequired: isoDaysAgo(2),
    dateResponded: isoDaysAgo(5),
    response: 'Going with satin nickel #4827 throughout.',
    submittedBy: 'Riverbend Build',
    attachments: [],
  } as unknown as Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>);
  ctx.addRFI({
    projectId,
    subject: 'Discovered cracked DWV stack — repair or replace section?',
    question: 'Removed kitchen wall and found a hairline crack on the 3" cast-iron DWV. Patching with epoxy clamp will hold but inspector may flag. Replace 8\' section instead?',
    priority: 'urgent',
    status: 'open',
    assignedTo: 'Sarah (Owner)',
    dateSubmitted: isoDaysAgo(2),
    dateRequired: isoDaysAgo(-3),
    submittedBy: 'Riverbend Build',
    attachments: [],
  } as unknown as Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>);

  // 6 punch items spread across statuses
  punchTemplate(ctx, projectId, [
    { description: 'Touch-up paint behind range hood after install', priority: 'low', status: 'open', location: 'Kitchen' },
    { description: 'Caulk transition between hall bath floor + door jamb', priority: 'medium', status: 'open', location: 'Hall Bath' },
    { description: 'Repair drywall ding next to primary bath door', priority: 'low', status: 'open', location: 'Primary Bath' },
    { description: 'Re-shim primary vanity — slight rock', priority: 'medium', status: 'in_progress', location: 'Primary Bath' },
    { description: 'Replace cracked outlet plate (during paint)', priority: 'low', status: 'closed', location: 'Kitchen' },
    { description: 'Sand + finish edge of new threshold', priority: 'low', status: 'closed', location: 'Hall Bath' },
  ]);

  // 8 photos
  photoTemplate(ctx, projectId, [
    { i: 0, daysAgo: 30, tag: 'before', location: 'Kitchen — looking northwest' },
    { i: 1, daysAgo: 28, tag: 'before', location: 'Primary bath' },
    { i: 2, daysAgo: 22, tag: 'progress', location: 'Demo complete — kitchen' },
    { i: 3, daysAgo: 14, tag: 'progress', location: 'Plumbing rough — primary' },
    { i: 4, daysAgo: 10, tag: 'progress', location: 'Electrical rough' },
    { i: 5, daysAgo: 6, tag: 'progress', location: 'Drywall hung' },
    { i: 6, daysAgo: 3, tag: 'progress', location: 'Tile under-mount install' },
    { i: 7, daysAgo: 1, tag: 'progress', location: 'Cabinet delivery received' },
  ], [40.8043, -74.2032]);

  // 1 change order — added under-cabinet lighting
  ctx.addChangeOrder({
    id: generateUUID(),
    projectId,
    number: 1,
    date: isoDaysAgo(12),
    description: 'Add under-cabinet LED lighting to entire kitchen run',
    reason: 'Owner direction after evening walk-through; outlet locations already roughed-in.',
    status: 'approved',
    scheduleImpactDays: 1,
    originalContractValue: meta.total,
    changeAmount: 3_840,
    newContractTotal: meta.total + 3_840,
    lineItems: [
      { id: generateUUID(), description: 'LED strip — 22 LF', quantity: 22, unit: 'lf', unitPrice: 38, total: 836 },
      { id: generateUUID(), description: 'Driver + dimmer module', quantity: 1, unit: 'ea', unitPrice: 240, total: 240 },
      { id: generateUUID(), description: 'Labor — install + integration with existing switch', quantity: 8, unit: 'hr', unitPrice: 95, total: 760 },
      { id: generateUUID(), description: 'Markup', quantity: 1, unit: 'lump', unitPrice: 2_004, total: 2_004 },
    ],
    createdAt: isoDaysAgo(12),
    updatedAt: isoNow,
  } as unknown as ChangeOrder);

  return { projectId };
}

// ═══════════════════════════════════════════════════════════════════════
// MEDIUM — $512K full brownstone gut (the original Henderson story).
// 5–6 month duration, ~50% complete.
// ═══════════════════════════════════════════════════════════════════════
async function seedMedium(ctx: SeedCtx): Promise<{ projectId: string }> {
  const { isoNow, isoDaysAgo } = timeHelpers();
  const projectId = generateUUID();
  const meta = DEMO_FLAVORS.medium;

  ctx.addProject({
    id: projectId,
    name: meta.name,
    type: 'renovation',
    location: '124 Park Slope, Brooklyn NY 11215',
    squareFootage: meta.squareFootage,
    quality: 'premium',
    description: 'Demo project — full-gut renovation of a 3-story brownstone. New mechanicals, custom millwork throughout, designer kitchen + 4 baths. Tap Delete on the project tile to wipe it.',
    createdAt: isoDaysAgo(45),
    updatedAt: isoNow,
    estimate: {
      materialTotal: 184_500,
      laborTotal: 142_000,
      permits: 8_500,
      overhead: 33_500,
      contingency: 18_400,
      taxAmount: 32_660,
      totalCost: 419_560,
      markupPercent: 22,
      markupAmount: 92_303,
      grandTotal: meta.total,
      pricePerSqFt: 159.96,
      estimatedDuration: meta.durationLabel,
      materials: [],
    },
    status: 'in_progress',
  } as unknown as Project);

  invoiceTemplate(ctx, projectId, [
    { number: 1, pct: 15, daysAgoIssue: 40, daysAgoDue: 10, amount: 76_780, paid: 76_780, status: 'paid', label: 'Deposit — 15%' },
    { number: 2, pct: 30, daysAgoIssue: 20, daysAgoDue: -3, amount: 76_780, paid: 50_000, status: 'partially_paid', label: 'Progress — 30%' },
    { number: 3, pct: 45, daysAgoIssue: 4, daysAgoDue: -25, amount: 76_780, paid: 0, status: 'sent', label: 'Progress — 45%' },
  ]);

  dailyReportTemplate(ctx, projectId, [
    { daysAgo: 1, temp: '64°F', conditions: 'Clear', work: 'Demo of west wall complete. Started rough framing for the new kitchen island.', crew: [{ trade: 'Carpentry', company: 'Henderson Build', headcount: 3, hours: 8 }, { trade: 'Electrical', company: 'Volt Bros Electric', headcount: 2, hours: 8 }] },
    { daysAgo: 3, temp: '58°F', conditions: 'Cloudy', work: 'MEP rough-in continues — electrical pulled to all 1F outlets. Plumbing rough for primary bath underway.', crew: [{ trade: 'Electrical', company: 'Volt Bros Electric', headcount: 2, hours: 8 }, { trade: 'Plumbing', company: 'Cobblestone Plumbing', headcount: 2, hours: 8 }] },
    { daysAgo: 5, temp: '52°F', conditions: 'Rain', work: 'Indoor work only. Drywall delivery received. Insulation crew finished walls + ceiling on 2F.', crew: [{ trade: 'Insulation', company: 'GreenWall Insulation', headcount: 3, hours: 8 }] },
  ]);

  ctx.addRFI({
    projectId,
    subject: 'Knob-and-tube wiring discovered in NE corner — replace or splice?',
    question: 'Knob-and-tube wiring discovered in NE corner — replace or splice?',
    priority: 'urgent',
    status: 'open',
    assignedTo: 'D. Henderson (Architect)',
    dateSubmitted: isoDaysAgo(3),
    dateRequired: isoDaysAgo(-2),
    submittedBy: 'Henderson Build',
    attachments: [],
  } as unknown as Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>);
  ctx.addRFI({
    projectId,
    subject: 'Confirm tile pattern for primary bath',
    question: 'Confirm tile pattern for primary bath floor (matrix vs. herringbone)',
    priority: 'normal',
    status: 'answered',
    assignedTo: 'L. Henderson (Owner)',
    dateSubmitted: isoDaysAgo(12),
    dateRequired: isoDaysAgo(7),
    dateResponded: isoDaysAgo(10),
    response: 'Confirmed — herringbone in primary bath.',
    submittedBy: 'Henderson Build',
    attachments: [],
  } as unknown as Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>);

  punchTemplate(ctx, projectId, [
    { description: 'Touch-up paint above hallway light switch', priority: 'low', status: 'open', location: '2F Hallway' },
    { description: 'Caulk gap between tub and tile in hall bath', priority: 'medium', status: 'in_progress', location: '2F Hall Bath' },
    { description: 'Sand and re-stain banister handrail', priority: 'medium', status: 'closed', location: 'Stairwell' },
  ]);

  photoTemplate(ctx, projectId, [
    { i: 0, daysAgo: 30, tag: 'before', location: 'Kitchen — west wall' },
    { i: 1, daysAgo: 22, tag: 'progress', location: 'Primary bath rough-in' },
    { i: 2, daysAgo: 14, tag: 'progress', location: 'Living room subfloor' },
    { i: 3, daysAgo: 8, tag: 'progress', location: 'Stairwell framing' },
    { i: 4, daysAgo: 2, tag: 'after', location: 'Kitchen island' },
  ], [40.6712, -73.9876]);

  ctx.addChangeOrder({
    id: generateUUID(),
    projectId,
    number: 1,
    date: isoDaysAgo(15),
    description: 'Owner-requested upgrade: subway tile → marble herringbone for primary bath',
    reason: 'Owner direction at site walk',
    status: 'approved',
    scheduleImpactDays: 3,
    originalContractValue: meta.total,
    changeAmount: 4_280,
    newContractTotal: meta.total + 4_280,
    lineItems: [
      { id: generateUUID(), description: 'Marble tile (herringbone) — primary bath', quantity: 110, unit: 'sf', unitPrice: 24.50, total: 2_695 },
      { id: generateUUID(), description: 'Additional labor for herringbone install', quantity: 1, unit: 'lump', unitPrice: 1_585, total: 1_585 },
    ],
    createdAt: isoDaysAgo(15),
    updatedAt: isoNow,
  } as unknown as ChangeOrder);

  return { projectId };
}

// ═══════════════════════════════════════════════════════════════════════
// LARGE — $14.4M ground-up 24-unit condominium.
// 14–16 month duration, ~55% complete. Multi-trade, multi-invoice,
// multiple COs, deeper crew counts.
// ═══════════════════════════════════════════════════════════════════════
async function seedLarge(ctx: SeedCtx): Promise<{ projectId: string }> {
  const { isoNow, isoDaysAgo } = timeHelpers();
  const projectId = generateUUID();
  const meta = DEMO_FLAVORS.large;

  ctx.addProject({
    id: projectId,
    name: meta.name,
    type: 'new_construction',
    location: '847 Bay Ridge Pkwy, Brooklyn NY 11209',
    squareFootage: meta.squareFootage,
    quality: 'premium',
    description: 'Demo project — ground-up 4-story, 24-unit luxury condominium. Garden-level parking, rooftop amenity, custom millwork, full MEP build-out. Tap Delete on the project tile to wipe it.',
    createdAt: isoDaysAgo(240),
    updatedAt: isoNow,
    estimate: {
      materialTotal: 5_840_000,
      laborTotal: 4_220_000,
      permits: 312_000,
      overhead: 1_180_000,
      contingency: 720_000,
      taxAmount: 1_023_200,
      totalCost: 13_295_200,
      markupPercent: 8.2,
      markupAmount: 1_090_000,
      grandTotal: meta.total,
      pricePerSqFt: 506.51,
      estimatedDuration: meta.durationLabel,
      materials: [],
    },
    status: 'in_progress',
  } as unknown as Project);

  // 6 invoices — staggered to look like a real AIA pay-app cadence.
  invoiceTemplate(ctx, projectId, [
    { number: 1, pct: 5,  daysAgoIssue: 220, daysAgoDue: 190, amount: 719_260,   paid: 719_260,   status: 'paid', label: 'Mobilization + earthwork' },
    { number: 2, pct: 15, daysAgoIssue: 180, daysAgoDue: 150, amount: 1_438_520, paid: 1_438_520, status: 'paid', label: 'Foundation + slab' },
    { number: 3, pct: 25, daysAgoIssue: 130, daysAgoDue: 100, amount: 1_438_520, paid: 1_438_520, status: 'paid', label: 'Structural frame complete' },
    { number: 4, pct: 35, daysAgoIssue: 80,  daysAgoDue: 50,  amount: 1_438_520, paid: 1_438_520, status: 'paid', label: 'MEP rough-in' },
    { number: 5, pct: 45, daysAgoIssue: 35,  daysAgoDue: 5,   amount: 1_438_520, paid: 1_100_000, status: 'partially_paid', label: 'Drywall + interior framing' },
    { number: 6, pct: 55, daysAgoIssue: 6,   daysAgoDue: -24, amount: 1_438_520, paid: 0,         status: 'sent', label: 'Finishes — phase 1' },
  ]);

  // 8 daily reports across 5 levels — bigger crews, more trades.
  dailyReportTemplate(ctx, projectId, [
    { daysAgo: 1,  temp: '67°F', conditions: 'Clear',          work: 'Drywall hang continues on 3F + 4F (units 12-24). 3 crews on site. Tile rough complete in 8 unit baths.', crew: [
      { trade: 'Drywall', company: 'Tristate Drywall', headcount: 9, hours: 8 },
      { trade: 'Tile', company: 'Granite Coast Tile', headcount: 4, hours: 8 },
      { trade: 'Carpentry', company: 'Bay Ridge Build', headcount: 6, hours: 8 },
      { trade: 'Cleanup', company: 'Bay Ridge Build', headcount: 2, hours: 6 },
    ] },
    { daysAgo: 3,  temp: '63°F', conditions: 'Cloudy',         work: 'Elevator install — phase 2 underway. HVAC ductwork commissioning starting on 2F. Building dept inspection tomorrow at 9 AM.', crew: [
      { trade: 'Elevator', company: 'Otis NYC', headcount: 4, hours: 8 },
      { trade: 'HVAC', company: 'NorthEast Mechanical', headcount: 5, hours: 8 },
      { trade: 'Electrical', company: 'Volt Bros Electric', headcount: 8, hours: 8 },
    ] },
    { daysAgo: 6,  temp: '60°F', conditions: 'Rain',           work: 'Indoor work continues — exterior masonry pulled. Interior painters started prime coats on 1F + 2F units.', crew: [
      { trade: 'Painting', company: 'CityWide Painters', headcount: 7, hours: 8 },
      { trade: 'Carpentry', company: 'Bay Ridge Build', headcount: 6, hours: 8 },
    ] },
    { daysAgo: 10, temp: '58°F', conditions: 'Cloudy',         work: 'Roof membrane work resumed — 60% complete. Window install on east elevation finished today.', crew: [
      { trade: 'Roofing', company: 'CapShield Roofing', headcount: 6, hours: 8 },
      { trade: 'Glazier', company: 'Pier 8 Glass', headcount: 4, hours: 8 },
    ] },
    { daysAgo: 14, temp: '64°F', conditions: 'Partly cloudy',  work: 'Drywall delivery — 1,400 sheets. Stored in basement secure area. Lobby millwork install began.', crew: [
      { trade: 'Carpentry', company: 'Bay Ridge Build', headcount: 8, hours: 8 },
      { trade: 'Drywall', company: 'Tristate Drywall', headcount: 9, hours: 8 },
    ] },
    { daysAgo: 21, temp: '55°F', conditions: 'Clear',          work: 'MEP rough-in inspection passed on units 1-12. Punch list logged for re-inspection on units 13-18 next week.', crew: [
      { trade: 'Plumbing', company: 'Cobblestone Plumbing', headcount: 6, hours: 8 },
      { trade: 'Electrical', company: 'Volt Bros Electric', headcount: 8, hours: 8 },
    ] },
    { daysAgo: 30, temp: '50°F', conditions: 'Snow',           work: 'Site closed before noon — 4" accumulation. Crew dispatched home with full pay per safety policy.', crew: [
      { trade: 'GC', company: 'Bay Ridge Build', headcount: 12, hours: 4 },
    ] },
    { daysAgo: 60, temp: '38°F', conditions: 'Cold',           work: 'Steel structural frame topped out — ceremony with owners + design team. Photos attached.', crew: [
      { trade: 'Steel', company: 'Apex Iron Works', headcount: 11, hours: 8 },
    ] },
  ]);

  // 6 RFIs — multi-trade, mix of open + answered.
  ([
    { subject: 'Verify firestop assembly at penthouse mechanical chase', priority: 'urgent', status: 'open', daysAgo: 2, days: -3, assigned: 'M. Tan (Architect)', q: 'UL firestop drawing references W-L-3013 but submittal shows W-L-3007. Confirm which assembly is approved for penthouse mechanical chase.' },
    { subject: 'Lobby chandelier — confirm finish on canopy', priority: 'normal', status: 'answered', daysAgo: 14, days: -7, response: 'Polished nickel canopy confirmed.', assigned: 'M. Tan (Architect)', q: 'Spec calls for polished nickel canopy but submittal shows brushed brass. Which is correct?' },
    { subject: 'Elevator pit waterproofing — owner finish vs. spec', priority: 'urgent', status: 'answered', daysAgo: 38, days: -28, response: 'Use spec\'d Bituthene 4000 — change to owner upgrade is rejected.', assigned: 'M. Tan (Architect)', q: 'Owner requested elastomeric upgrade for elevator pit waterproofing. Spec calls for Bituthene 4000. Confirm direction.' },
    { subject: 'Unit 4B kitchen — relocate microwave outlet?', priority: 'normal', status: 'open', daysAgo: 5, days: 0, assigned: 'Owner', q: 'Owner of 4B requested OTR microwave outlet move 12" left to clear hood spec. Confirm scope + cost impact.' },
    { subject: 'Roof drain leader location — amend plumbing plan', priority: 'normal', status: 'answered', daysAgo: 70, days: -60, response: 'Drain location confirmed at amendment line; revised plumbing plan A-301 r3 issued.', assigned: 'M. Tan (Architect)', q: 'Plumbing plan shows roof drain leader 4" off existing column. Field condition shows 18". Confirm revised location.' },
    { subject: '2F balcony railings — verify glass thickness', priority: 'normal', status: 'open', daysAgo: 9, days: -2, assigned: 'M. Tan (Architect)', q: 'Submittal shows 1/2" laminated; spec calls for 5/8". Building code requires 5/8" for guard heights >36". Confirm.' },
  ] as const).forEach(r => {
    ctx.addRFI({
      projectId,
      subject: r.subject,
      question: r.q,
      priority: r.priority,
      status: r.status,
      assignedTo: r.assigned,
      dateSubmitted: isoDaysAgo(r.daysAgo),
      dateRequired: isoDaysAgo(r.days),
      ...(r.status === 'answered' && 'response' in r ? { response: r.response, dateResponded: isoDaysAgo(Math.max(0, r.daysAgo - 2)) } : {}),
      submittedBy: 'Bay Ridge Build',
      attachments: [],
    } as unknown as Omit<RFI, 'id' | 'number' | 'createdAt' | 'updatedAt'>);
  });

  // 18 punch items — grouped by trade (open + closed mix).
  punchTemplate(ctx, projectId, [
    // Drywall + paint
    { description: 'Touch-up paint at 3F-12 living room corner', priority: 'low', status: 'open', location: 'Unit 3F-12' },
    { description: 'Re-skim seam at unit 2F-08 hallway ceiling', priority: 'medium', status: 'open', location: 'Unit 2F-08' },
    { description: 'Patch drywall behind 4F-22 kitchen — visible after cabinet install', priority: 'medium', status: 'in_progress', location: 'Unit 4F-22' },
    { description: 'Touch-up paint above lobby chandelier mount', priority: 'low', status: 'closed', location: 'Lobby' },
    // Plumbing
    { description: 'Adjust 1F-04 primary bath shower diverter — sluggish', priority: 'high', status: 'open', location: 'Unit 1F-04' },
    { description: 'Caulk transition between vanity + countertop in 2F-09', priority: 'medium', status: 'open', location: 'Unit 2F-09' },
    { description: 'Replace cracked toilet flange at 3F-15', priority: 'high', status: 'in_progress', location: 'Unit 3F-15' },
    { description: 'Test hot-water re-circ pump on penthouse', priority: 'medium', status: 'closed', location: 'Penthouse' },
    // Electrical
    { description: 'Rotate dimmer wallplate to vertical at 1F-02 living room', priority: 'low', status: 'open', location: 'Unit 1F-02' },
    { description: '4F-21 kitchen island — outlet pop-up not retracting smoothly', priority: 'medium', status: 'in_progress', location: 'Unit 4F-21' },
    { description: 'Replace flickering recessed at 2F-07 bath #2', priority: 'medium', status: 'closed', location: 'Unit 2F-07' },
    // Tile + flooring
    { description: '3F-13 primary bath — tile cracked at floor drain edge', priority: 'high', status: 'open', location: 'Unit 3F-13' },
    { description: 'Re-grout shower niche at 4F-23', priority: 'medium', status: 'in_progress', location: 'Unit 4F-23' },
    { description: 'Lobby floor — buff scratch near elevator', priority: 'low', status: 'closed', location: 'Lobby' },
    // Doors + millwork
    { description: 'Adjust hinge at 2F-10 entry — slight rub', priority: 'low', status: 'open', location: 'Unit 2F-10' },
    { description: 'Re-set 3F-14 closet door — out of plumb', priority: 'medium', status: 'in_progress', location: 'Unit 3F-14' },
    // Exterior
    { description: 'Caulk window perimeter at east elevation, 4F units', priority: 'high', status: 'open', location: 'East elevation' },
    { description: 'Touch-up paint at lobby door jamb after install', priority: 'low', status: 'closed', location: 'Lobby entry' },
  ]);

  // 25 photos — broader site coverage.
  photoTemplate(ctx, projectId, [
    { i: 100, daysAgo: 220, tag: 'before', location: 'Site — pre-mobilization' },
    { i: 101, daysAgo: 200, tag: 'progress', location: 'Excavation complete' },
    { i: 102, daysAgo: 180, tag: 'progress', location: 'Foundation pour — west pier' },
    { i: 103, daysAgo: 150, tag: 'progress', location: 'Slab on grade poured' },
    { i: 104, daysAgo: 130, tag: 'progress', location: 'Steel frame topped out' },
    { i: 105, daysAgo: 110, tag: 'progress', location: 'Floor decking — 3F' },
    { i: 106, daysAgo: 95,  tag: 'progress', location: 'Exterior sheathing — north' },
    { i: 107, daysAgo: 80,  tag: 'progress', location: 'Window install — south elevation' },
    { i: 108, daysAgo: 65,  tag: 'progress', location: 'Roofing membrane — phase 1' },
    { i: 109, daysAgo: 55,  tag: 'progress', location: 'MEP rough-in — Unit 2F-09' },
    { i: 110, daysAgo: 48,  tag: 'progress', location: 'Drywall hung — 1F units' },
    { i: 111, daysAgo: 40,  tag: 'progress', location: 'Tile install — Unit 1F-04 primary bath' },
    { i: 112, daysAgo: 35,  tag: 'progress', location: 'Cabinet delivery — staging area' },
    { i: 113, daysAgo: 30,  tag: 'progress', location: 'Lobby millwork install' },
    { i: 114, daysAgo: 25,  tag: 'progress', location: 'Painting — Unit 3F-15' },
    { i: 115, daysAgo: 20,  tag: 'progress', location: 'Elevator car arrived on site' },
    { i: 116, daysAgo: 16,  tag: 'progress', location: 'Penthouse — exterior decking' },
    { i: 117, daysAgo: 12,  tag: 'progress', location: 'Lobby chandelier installed' },
    { i: 118, daysAgo: 8,   tag: 'progress', location: 'Unit 4F-22 kitchen — cabinets in' },
    { i: 119, daysAgo: 6,   tag: 'progress', location: 'Roof deck pavers laid' },
    { i: 120, daysAgo: 4,   tag: 'progress', location: 'Punch walk — Unit 2F-08' },
    { i: 121, daysAgo: 3,   tag: 'progress', location: 'Drywall 4F — unit 22' },
    { i: 122, daysAgo: 2,   tag: 'progress', location: 'Ceiling fan install — Unit 3F-13' },
    { i: 123, daysAgo: 1,   tag: 'progress', location: 'Garage line stripe — final coat' },
    { i: 124, daysAgo: 0,   tag: 'progress', location: 'East elevation — punch walk' },
  ], [40.6228, -74.0290]);

  // 4 change orders — owner-driven + field-condition mix.
  ([
    {
      number: 1, daysAgo: 110,
      description: 'Owner upgrade: standard cabinet pulls → custom brass throughout (24 units)',
      reason: 'Owner direction at design-team meeting.',
      status: 'approved' as const,
      scheduleImpactDays: 0,
      changeAmount: 38_400,
      lineItems: [
        { description: 'Custom brass pulls — 24 units', quantity: 384, unit: 'ea', unitPrice: 95, total: 36_480 },
        { description: 'Re-stock charge for original pulls', quantity: 1, unit: 'lump', unitPrice: 1_920, total: 1_920 },
      ],
    },
    {
      number: 2, daysAgo: 65,
      description: 'Field condition: encountered abandoned fuel tank during excavation — remediation',
      reason: 'Geotechnical site condition not disclosed in original drawings.',
      status: 'approved' as const,
      scheduleImpactDays: 12,
      changeAmount: 184_500,
      lineItems: [
        { description: 'Fuel tank removal + soil testing', quantity: 1, unit: 'lump', unitPrice: 78_000, total: 78_000 },
        { description: 'Contaminated soil removal — 240 CY', quantity: 240, unit: 'cy', unitPrice: 285, total: 68_400 },
        { description: 'Replacement clean fill', quantity: 240, unit: 'cy', unitPrice: 92, total: 22_080 },
        { description: 'Schedule extension overhead', quantity: 12, unit: 'day', unitPrice: 1_335, total: 16_020 },
      ],
    },
    {
      number: 3, daysAgo: 28,
      description: 'Add penthouse outdoor kitchen — gas line, hood, plumbing rough',
      reason: 'Owner upgrade — buyer of penthouse PH2 requested at deposit.',
      status: 'pending' as const,
      scheduleImpactDays: 5,
      changeAmount: 92_750,
      lineItems: [
        { description: 'Gas line extension to penthouse', quantity: 1, unit: 'lump', unitPrice: 18_500, total: 18_500 },
        { description: 'Outdoor-rated hood + ducting', quantity: 1, unit: 'lump', unitPrice: 24_000, total: 24_000 },
        { description: 'Plumbing rough-in + sink', quantity: 1, unit: 'lump', unitPrice: 12_400, total: 12_400 },
        { description: 'Custom counter + base cabinets', quantity: 1, unit: 'lump', unitPrice: 31_500, total: 31_500 },
        { description: 'Markup', quantity: 1, unit: 'lump', unitPrice: 6_350, total: 6_350 },
      ],
    },
    {
      number: 4, daysAgo: 6,
      description: 'Lobby finish upgrade: terrazzo → book-matched marble',
      reason: 'Owner direction — design refresh after preview event.',
      status: 'pending' as const,
      scheduleImpactDays: 8,
      changeAmount: 67_200,
      lineItems: [
        { description: 'Marble slab — book-matched, lobby floor', quantity: 480, unit: 'sf', unitPrice: 78, total: 37_440 },
        { description: 'Demo + dispose original terrazzo install', quantity: 1, unit: 'lump', unitPrice: 9_800, total: 9_800 },
        { description: 'Marble install labor + sealer', quantity: 1, unit: 'lump', unitPrice: 14_400, total: 14_400 },
        { description: 'Markup', quantity: 1, unit: 'lump', unitPrice: 5_560, total: 5_560 },
      ],
    },
  ]).forEach(co => {
    let runningContractValue = meta.total;
    ctx.addChangeOrder({
      id: generateUUID(),
      projectId,
      number: co.number,
      date: isoDaysAgo(co.daysAgo),
      description: co.description,
      reason: co.reason,
      status: co.status,
      scheduleImpactDays: co.scheduleImpactDays,
      originalContractValue: runningContractValue,
      changeAmount: co.changeAmount,
      newContractTotal: runningContractValue + co.changeAmount,
      lineItems: co.lineItems.map(li => ({ id: generateUUID(), ...li })),
      createdAt: isoDaysAgo(co.daysAgo),
      updatedAt: isoNow,
    } as unknown as ChangeOrder);
    runningContractValue += co.changeAmount;
  });

  return { projectId };
}

// ───────────────────────────────────────────────────────────────────────
// Shared content helpers — kept tight so each flavor's intent stays
// readable above. All take the SeedCtx + projectId + a flavor-specific
// content array.
// ───────────────────────────────────────────────────────────────────────

interface InvoiceSpec {
  number: number;
  pct: number;
  daysAgoIssue: number;
  daysAgoDue: number;
  amount: number;
  paid: number;
  status: Invoice['status'];
  label: string;
}

function invoiceTemplate(ctx: SeedCtx, projectId: string, specs: InvoiceSpec[]) {
  const now = new Date();
  const isoNow = now.toISOString();
  const dayMs = 24 * 60 * 60 * 1000;
  const isoDaysAgo = (n: number) => new Date(now.getTime() - n * dayMs).toISOString();

  for (const inv of specs) {
    ctx.addInvoice({
      id: generateUUID(),
      projectId,
      number: inv.number,
      type: 'progress',
      progressPercent: inv.pct,
      issueDate: isoDaysAgo(inv.daysAgoIssue),
      dueDate: isoDaysAgo(inv.daysAgoDue),
      paymentTerms: 'net_30',
      notes: '',
      lineItems: [
        { id: generateUUID(), description: `${inv.label} — ${inv.pct}% completion`, quantity: 1, unit: 'lump', unitPrice: inv.amount * 0.92, total: inv.amount * 0.92 },
      ],
      subtotal: inv.amount * 0.92,
      taxRate: 8.875,
      taxAmount: inv.amount * 0.08,
      totalDue: inv.amount,
      amountPaid: inv.paid,
      status: inv.status,
      payments: inv.paid > 0
        ? [{ id: generateUUID(), amount: inv.paid, method: 'check', receivedAt: isoDaysAgo(inv.daysAgoDue), reference: `Check #1${inv.number}042` }]
        : [],
      createdAt: isoDaysAgo(inv.daysAgoIssue),
      updatedAt: isoNow,
    } as unknown as Invoice);
  }
}

interface DfrSpec {
  daysAgo: number;
  temp: string;
  conditions: string;
  work: string;
  crew: { trade: string; company: string; headcount: number; hours: number }[];
}

function dailyReportTemplate(ctx: SeedCtx, projectId: string, specs: DfrSpec[]) {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const isoDaysAgo = (n: number) => new Date(now.getTime() - n * dayMs).toISOString();

  specs.forEach((d, i) => {
    const date = isoDaysAgo(d.daysAgo);
    ctx.addDailyReport({
      id: generateUUID(),
      projectId,
      date,
      weather: { temperature: d.temp, conditions: d.conditions, wind: '', isManual: false },
      manpower: d.crew.map(c => ({
        id: generateUUID(),
        trade: c.trade,
        company: c.company,
        headcount: c.headcount,
        hoursWorked: c.hours,
      })),
      workPerformed: d.work,
      materialsDelivered: i === 0 ? ['Drywall — multiple pallets', 'Insulation — R-21 rolls'] : [],
      issuesAndDelays: '',
      photos: [],
      status: i === 0 ? 'sent' : 'draft',
      createdAt: date,
      updatedAt: date,
    } as unknown as DailyFieldReport);
  });
}

interface PunchSpec {
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'closed';
  location: string;
}

function punchTemplate(ctx: SeedCtx, projectId: string, specs: PunchSpec[]) {
  const now = new Date();
  const isoNow = now.toISOString();
  const dayMs = 24 * 60 * 60 * 1000;
  const isoDaysAgo = (n: number) => new Date(now.getTime() - n * dayMs).toISOString();

  for (const p of specs) {
    ctx.addPunchItem({
      id: generateUUID(),
      projectId,
      description: p.description,
      location: p.location,
      priority: p.priority,
      status: p.status,
      createdAt: isoDaysAgo(8),
      updatedAt: isoNow,
      closedAt: p.status === 'closed' ? isoDaysAgo(2) : undefined,
      notes: '',
      photos: [],
    } as unknown as PunchItem);
  }
}

interface PhotoSpec {
  i: number;
  daysAgo: number;
  tag: 'before' | 'progress' | 'after';
  location: string;
}

function photoTemplate(ctx: SeedCtx, projectId: string, specs: PhotoSpec[], center: [number, number]) {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const isoDaysAgo = (n: number) => new Date(now.getTime() - n * dayMs).toISOString();

  for (const p of specs) {
    ctx.addProjectPhoto({
      id: generateUUID(),
      projectId,
      uri: `https://picsum.photos/seed/mage-demo-${p.i}/640/480`,
      timestamp: isoDaysAgo(p.daysAgo),
      location: p.location,
      tag: p.tag,
      latitude: center[0] + (Math.random() - 0.5) * 0.001,
      longitude: center[1] + (Math.random() - 0.5) * 0.001,
    } as unknown as ProjectPhoto);
  }
}
