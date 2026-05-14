// estimateAssemblies.ts
//
// Hardcoded "assembly" presets — common construction line-item rollups
// the GC selects with one tap instead of typing 40 individual rows.
// JobTread and Knowify win deals on this exact UX; we don't have an
// AI rollup yet, but hand-curated presets close the gap for the most
// common residential workflows.
//
// Each preset is a LinkedEstimate-compatible bundle: an ordered list of
// items with materialName + unit + a national-median quantity per
// 100 sf of work and a national-median unit price. The caller scales by
// the project's actual area + applies the project's globalMarkup at
// the time of import.
//
// Numbers anchored to RSMeans 2024 residential medians, rounded to be
// memorable rather than precise. The user will edit them — these are
// starting points, not gospel.

import type { LinkedEstimateItem } from '@/types';
import { generateUUID } from '@/utils/generateId';

export interface EstimateAssemblyItem {
  name: string;
  unit: 'lf' | 'sf' | 'ea' | 'hr' | 'cy' | 'ton';
  /** Quantity per 100 sf of the area the assembly covers. */
  qtyPer100Sf: number;
  /** Median unit cost, $ — pre-markup. */
  unitCost: number;
  /** Cost category — drives the line item's category badge. */
  category: 'materials' | 'labor' | 'equipment' | 'subcontractor' | 'other';
}

export interface EstimateAssembly {
  id: string;
  label: string;
  /** One-line description for the picker UI. */
  description: string;
  /** Default area in sf if the user doesn't override — used to compute
   *  the initial quantity from qtyPer100Sf. */
  defaultAreaSf: number;
  items: EstimateAssemblyItem[];
}

export const ESTIMATE_ASSEMBLIES: EstimateAssembly[] = [
  {
    id: 'demo-residential',
    label: 'Demolition (interior)',
    description: 'Selective interior demo — drywall, flooring, cabinets, fixtures.',
    defaultAreaSf: 500,
    items: [
      { name: 'Demo labor', unit: 'hr', qtyPer100Sf: 8, unitCost: 65, category: 'labor' },
      { name: 'Dumpster (20yd)', unit: 'ea', qtyPer100Sf: 0.2, unitCost: 525, category: 'other' },
      { name: 'Dust containment + plastic', unit: 'sf', qtyPer100Sf: 25, unitCost: 0.85, category: 'materials' },
      { name: 'Disposal fees', unit: 'ton', qtyPer100Sf: 0.4, unitCost: 95, category: 'other' },
    ],
  },
  {
    id: 'framing-residential',
    label: 'Framing (residential)',
    description: '2x4 / 2x6 stud walls + sheathing + headers + blocking.',
    defaultAreaSf: 1500,
    items: [
      { name: '2x4 studs', unit: 'ea', qtyPer100Sf: 12, unitCost: 4.5, category: 'materials' },
      { name: '2x6 plate / top plate', unit: 'lf', qtyPer100Sf: 30, unitCost: 2.8, category: 'materials' },
      { name: 'OSB sheathing 4x8', unit: 'ea', qtyPer100Sf: 4, unitCost: 38, category: 'materials' },
      { name: 'Framing labor', unit: 'hr', qtyPer100Sf: 6, unitCost: 75, category: 'labor' },
      { name: 'Nails / fasteners (lot)', unit: 'ea', qtyPer100Sf: 0.5, unitCost: 110, category: 'materials' },
    ],
  },
  {
    id: 'drywall-finish',
    label: 'Drywall (hang + finish)',
    description: '1/2" drywall, taped + 3-coat finish, ready for prime.',
    defaultAreaSf: 1200,
    items: [
      { name: 'Drywall 1/2" 4x8', unit: 'ea', qtyPer100Sf: 3.5, unitCost: 14.5, category: 'materials' },
      { name: 'Drywall tape + mud', unit: 'sf', qtyPer100Sf: 100, unitCost: 0.18, category: 'materials' },
      { name: 'Hang + finish labor', unit: 'hr', qtyPer100Sf: 4.5, unitCost: 68, category: 'labor' },
      { name: 'Corner bead + accessories', unit: 'lf', qtyPer100Sf: 12, unitCost: 1.2, category: 'materials' },
    ],
  },
  {
    id: 'paint-interior',
    label: 'Paint (interior, 2 coat)',
    description: 'Walls + ceilings + trim, prime + 2 finish coats.',
    defaultAreaSf: 1200,
    items: [
      { name: 'Primer (gal)', unit: 'ea', qtyPer100Sf: 0.3, unitCost: 42, category: 'materials' },
      { name: 'Wall paint (gal)', unit: 'ea', qtyPer100Sf: 0.8, unitCost: 58, category: 'materials' },
      { name: 'Trim/ceiling paint (gal)', unit: 'ea', qtyPer100Sf: 0.3, unitCost: 62, category: 'materials' },
      { name: 'Painter labor', unit: 'hr', qtyPer100Sf: 3, unitCost: 60, category: 'labor' },
      { name: 'Drop cloths / tape / masking', unit: 'ea', qtyPer100Sf: 0.1, unitCost: 85, category: 'materials' },
    ],
  },
  {
    id: 'kitchen-rough-in',
    label: 'Kitchen rough-in (MEP)',
    description: 'Plumbing + electrical + gas rough-in for a typical kitchen.',
    defaultAreaSf: 200,
    items: [
      { name: 'Plumbing rough sub', unit: 'ea', qtyPer100Sf: 1, unitCost: 2200, category: 'subcontractor' },
      { name: 'Electrical rough sub', unit: 'ea', qtyPer100Sf: 1, unitCost: 1800, category: 'subcontractor' },
      { name: 'Gas line (range hookup)', unit: 'ea', qtyPer100Sf: 0.5, unitCost: 450, category: 'subcontractor' },
      { name: 'Misc. fittings + boxes', unit: 'ea', qtyPer100Sf: 0.4, unitCost: 220, category: 'materials' },
    ],
  },
  {
    id: 'bath-rough-in',
    label: 'Bathroom rough-in (MEP)',
    description: 'Plumbing + electrical + vent rough-in for a standard bath.',
    defaultAreaSf: 80,
    items: [
      { name: 'Plumbing rough sub', unit: 'ea', qtyPer100Sf: 1, unitCost: 1850, category: 'subcontractor' },
      { name: 'Electrical rough sub', unit: 'ea', qtyPer100Sf: 1, unitCost: 950, category: 'subcontractor' },
      { name: 'Bath fan + duct', unit: 'ea', qtyPer100Sf: 1, unitCost: 185, category: 'materials' },
      { name: 'Vent line / boots', unit: 'lf', qtyPer100Sf: 6, unitCost: 12, category: 'materials' },
    ],
  },
  {
    id: 'roof-tear-replace',
    label: 'Roof tear-off + replace (asphalt)',
    description: 'Tear-off, underlayment, drip edge, asphalt shingle.',
    defaultAreaSf: 2000,
    items: [
      { name: 'Tear-off labor', unit: 'hr', qtyPer100Sf: 2.5, unitCost: 65, category: 'labor' },
      { name: 'Asphalt shingles (square)', unit: 'ea', qtyPer100Sf: 1, unitCost: 145, category: 'materials' },
      { name: 'Underlayment (square)', unit: 'ea', qtyPer100Sf: 1, unitCost: 38, category: 'materials' },
      { name: 'Drip edge / flashing', unit: 'lf', qtyPer100Sf: 6, unitCost: 3.2, category: 'materials' },
      { name: 'Install labor', unit: 'hr', qtyPer100Sf: 4, unitCost: 70, category: 'labor' },
      { name: 'Dumpster (30yd)', unit: 'ea', qtyPer100Sf: 0.1, unitCost: 685, category: 'other' },
    ],
  },
  {
    id: 'concrete-slab',
    label: 'Concrete slab on grade (4")',
    description: 'Excavation, gravel base, vapor barrier, rebar, 4" slab pour.',
    defaultAreaSf: 600,
    items: [
      { name: 'Excavation', unit: 'cy', qtyPer100Sf: 1.5, unitCost: 95, category: 'subcontractor' },
      { name: 'Gravel base', unit: 'cy', qtyPer100Sf: 1.2, unitCost: 55, category: 'materials' },
      { name: 'Vapor barrier 10mil', unit: 'sf', qtyPer100Sf: 100, unitCost: 0.32, category: 'materials' },
      { name: 'Rebar #4 grid', unit: 'lf', qtyPer100Sf: 50, unitCost: 1.4, category: 'materials' },
      { name: 'Concrete 4000 psi', unit: 'cy', qtyPer100Sf: 1.25, unitCost: 175, category: 'materials' },
      { name: 'Pour + finish labor', unit: 'hr', qtyPer100Sf: 3, unitCost: 78, category: 'labor' },
    ],
  },
  {
    id: 'electrical-service',
    label: 'Electrical service upgrade (200A)',
    description: 'New 200A panel, mast, meter, ground rod, permits.',
    defaultAreaSf: 100,
    items: [
      { name: '200A main panel (Square D / Eaton)', unit: 'ea', qtyPer100Sf: 1, unitCost: 485, category: 'materials' },
      { name: 'Meter base + mast', unit: 'ea', qtyPer100Sf: 1, unitCost: 285, category: 'materials' },
      { name: 'Electrician labor', unit: 'hr', qtyPer100Sf: 16, unitCost: 95, category: 'labor' },
      { name: 'Permit + inspection', unit: 'ea', qtyPer100Sf: 1, unitCost: 215, category: 'other' },
      { name: 'Ground rod + wire', unit: 'ea', qtyPer100Sf: 1, unitCost: 145, category: 'materials' },
    ],
  },
  {
    id: 'window-package-residential',
    label: 'Window package (10 windows, vinyl)',
    description: 'Vinyl double-hung windows, install + flashing + trim-out.',
    defaultAreaSf: 100, // not area-driven; "100sf" = "10 windows" worth.
    items: [
      { name: 'Vinyl windows 36x60 (avg)', unit: 'ea', qtyPer100Sf: 10, unitCost: 285, category: 'materials' },
      { name: 'Install labor', unit: 'hr', qtyPer100Sf: 12, unitCost: 70, category: 'labor' },
      { name: 'Flashing tape + sealant', unit: 'ea', qtyPer100Sf: 10, unitCost: 18, category: 'materials' },
      { name: 'Trim-out materials', unit: 'lf', qtyPer100Sf: 80, unitCost: 4.2, category: 'materials' },
    ],
  },
];

/**
 * Scale a single assembly's items to the given area. Returns a list of
 * LinkedEstimateItem objects ready to push into a project's estimate.
 * The caller should append these to `linkedEstimate.items` and recompute
 * `baseTotal` / `markupTotal` / `grandTotal`.
 *
 * Pre-markup. The project's existing globalMarkup is applied by the
 * recompute, not here — keeps the cost / markup split clean.
 */
export function applyAssembly(
  assembly: EstimateAssembly,
  areaSf: number,
): LinkedEstimateItem[] {
  const scale = Math.max(0, areaSf) / 100;
  return assembly.items.map<LinkedEstimateItem>(item => {
    const qty = Math.round(item.qtyPer100Sf * scale * 100) / 100;
    const lineTotal = Math.round(qty * item.unitCost * 100) / 100;
    return {
      // LinkedEstimateItem uses materialId rather than a separate id field;
      // it's just a stable identifier and doesn't need to match a real
      // catalog row — assembly presets are off-catalog by design.
      materialId: generateUUID(),
      name: item.name,
      category: item.category,
      unit: item.unit,
      quantity: qty,
      unitPrice: item.unitCost,
      bulkPrice: item.unitCost,
      usesBulk: false,
      markup: 0,
      lineTotal,
      supplier: '',
    };
  });
}
