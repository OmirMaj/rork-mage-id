// utils/tutorial/fixtures.ts — the sample inputs a tutorial offers, pure data.
//
// HONEST SEAMS. Each fixture stands in for exactly one real input (a voice
// note, a punch line, a photo's pin, a schedule sentence) and is labelled on
// screen as a sample that uses no AI credits. Anything the user says or types
// himself runs the real path and the real meter. There is no server-side
// tutorial exemption, ever: that would be an abuse vector.
//
// The numbers here are pinned by scripts/validate-tutorial-defs.ts (the
// estimate lines foot to the small sample's $422,400; the punch line infers
// Electrical with no AI call).

import type { LinkedEstimate } from '@/types';
import type { SampleDfrParse, SampleEstimateLine } from './types';

/** On-screen label for every fixture-driven fill. */
export const SAMPLE_NO_CREDITS_LABEL = 'Sample — no AI credits used';

// ── Daily report: the sample voice note ─────────────────────────────────────
// Three sections from one note — crew, work done, the delay — and 3 crew, so
// the stamp's "3 crew · 3 sections from one note" is literally what the fill
// produced. No weather: the screen fills weather from the real forecast, and a
// canned temperature would be an invented fact about his jobsite.

const DFR_TRANSCRIPT =
  'Three on site today. Riverbend had two setting kitchen base cabinets, and Volt Bros had one pulling wire for the island. ' +
  'Countertop template slipped to Thursday because the fabricator was out.';

const DFR_PARSED: SampleDfrParse = {
  manpower: [
    { id: 'mp-sample-0', trade: 'Carpentry', company: 'Riverbend Build', headcount: 2, hoursWorked: 8 },
    { id: 'mp-sample-1', trade: 'Electrical', company: 'Volt Bros', headcount: 1, hoursWorked: 8 },
  ],
  workPerformed: 'Set kitchen base cabinets. Pulled wire for the new island circuit.',
  issuesAndDelays: 'Countertop template slipped to Thursday — fabricator out.',
};

export const DFR_SAMPLE_NOTE: { transcript: string; parsed: SampleDfrParse; sections: readonly string[] } = {
  transcript: DFR_TRANSCRIPT,
  parsed: DFR_PARSED,
  /** The field names the fill writes; dfr.voice.applied reports these. */
  sections: ['manpower', 'workPerformed', 'issuesAndDelays'],
};

// ── Punch walk ──────────────────────────────────────────────────────────────

/** utils/tradeInference picks Electrical from 'outlet' deterministically —
 *  the longest keyword in the line — so the trade chip fills with no AI. */
export const PUNCH_SAMPLE = { line: 'Outlet cover missing by the sink', room: 'Kitchen', trade: 'Electrical' } as const;

export type SampleRoom = 'Kitchen' | 'Living' | 'Primary Bedroom' | 'Hall Bath' | 'Hall' | 'Primary Bath';

/**
 * The bundled A-101 sheet (assets/tutorial/sample-plan-a101.png, ~1600×1100).
 * `rooms` are the LABEL CENTRES as normalized image points (0..1 of width and
 * height). The PNG is authored to these numbers, not the other way round, so
 * the 'Do it for me' pin and the hand's tap-point land on the printed label.
 */
export const SAMPLE_PLAN: {
  sheetNumber: string;
  name: string;
  asset: string;
  imageSize: { w: number; h: number };
  rooms: Record<SampleRoom, { x: number; y: number }>;
} = {
  sheetNumber: 'A-101',
  name: 'Sample floor plan',
  asset: 'assets/tutorial/sample-plan-a101.png',
  imageSize: { w: 1600, h: 1100 },
  rooms: {
    Kitchen: { x: 0.2, y: 0.3 },
    Living: { x: 0.5, y: 0.3 },
    'Primary Bedroom': { x: 0.8, y: 0.3 },
    'Hall Bath': { x: 0.25, y: 0.72 },
    Hall: { x: 0.5, y: 0.72 },
    'Primary Bath': { x: 0.8, y: 0.72 },
  },
};

export const SAMPLE_PHOTO_ASSET = 'assets/tutorial/sample-outlet.jpg';

// ── Invoice: estimate lines for the small sample ────────────────────────────
// Today the small seed's estimate.materials is [], so a progress invoice on
// the sample bills $0. These 8 lines are the same $422,400 job, with the
// estimate's 25 % markup folded into lineTotal the way LinkedEstimateItem
// stores it (unitPrice is pre-markup; lineTotal is markup-inclusive). 15 %
// progress bills $63,360.

const SAMPLE_MARKUP_PCT = 25;

function line(materialId: string, name: string, category: string, csiDivision: string, lineTotal: number): SampleEstimateLine {
  // lineTotal is a multiple of 5, so the pre-markup price is a whole dollar.
  const unitPrice = Math.round((lineTotal * 100) / (100 + SAMPLE_MARKUP_PCT));
  return {
    materialId,
    name,
    category,
    unit: 'LS',
    quantity: 1,
    unitPrice,
    bulkPrice: unitPrice,
    markup: SAMPLE_MARKUP_PCT,
    usesBulk: false,
    lineTotal,
    supplier: '',
    csiDivision,
  };
}

export const SAMPLE_ESTIMATE_LINES: readonly SampleEstimateLine[] = [
  line('sample-demo', 'Demolition & haul-off', 'Demolition', '02', 18_000),
  line('sample-framing', 'Framing & rough carpentry', 'Carpentry', '06', 32_500),
  line('sample-plumbing', 'Plumbing rough & finish', 'Plumbing', '22', 64_000),
  line('sample-electrical', 'Electrical rough & finish', 'Electrical', '26', 48_500),
  line('sample-drywall', 'Drywall, tape & paint', 'Finishes', '09', 36_400),
  line('sample-cabinets', 'Kitchen cabinets & counters', 'Casework', '12', 118_000),
  line('sample-tile', 'Tile — 2 baths + backsplash', 'Finishes', '09', 57_000),
  line('sample-fixtures', 'Fixtures, trim & closeout', 'Fixtures', '22', 48_000),
];

export const SAMPLE_ESTIMATE_TOTAL = 422_400;
export const SAMPLE_PROGRESS_PCT = 15;

/** The sample job's recorded retainage term: none held, entered as a real
 *  answer (assumed:false) so utils/retainageSource resolves it as "from your
 *  contract" and app/invoice.tsx never opens its retainage ask on the sample.
 *  Keeps the invoice tutorial's 15 % at the full $63,360. */
export const SAMPLE_RETAINAGE = { retainagePercent: 0, retainagePercentAssumed: false } as const;

/** The linkedEstimate the small sample carries. bulkSavingsTotal is NEVER
 *  set: it is derived at render time (utils/bulkSavings) and the demo seed
 *  must not fabricate it. */
export function sampleLinkedEstimate(id: string, createdAt: string): LinkedEstimate {
  const items = SAMPLE_ESTIMATE_LINES.map(l => ({ ...l }));
  const grandTotal = items.reduce((s, l) => s + l.lineTotal, 0);
  const baseTotal = items.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return {
    id,
    items,
    globalMarkup: SAMPLE_MARKUP_PCT,
    baseTotal,
    markupTotal: grandTotal - baseTotal,
    grandTotal,
    createdAt,
  };
}

// ── Schedule (wave A2) ──────────────────────────────────────────────────────
// The op shape mirrors utils/copilot/scheduleEdit/editOps.ts's 'move' op. It
// is restated here, not imported, because that file is in flight in another
// wave; A2 wires the fixture seam and a validator pins the two shapes equal.

export interface SampleMoveOp {
  op: 'move';
  task: string;
  deltaDays: number;
}

export const SCHEDULE_SAMPLE = {
  sentence: 'Push drywall 2 days — board delivery slipped',
  /** Normalize before comparing: exact match only, so edited words run the
   *  real AI and the real meter. */
  normalize(s: string): string {
    return s.toLowerCase().replace(/[–—-]/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  },
  /** The preset answer: move the drywall task 2 days. [] when the schedule
   *  has no drywall task (then the fixture does not apply). */
  ops(tasks: readonly { id: string; name: string }[]): SampleMoveOp[] {
    const t = tasks.find(x => /drywall/i.test(x.name));
    return t ? [{ op: 'move', task: t.id, deltaDays: 2 }] : [];
  },
} as const;
