// planIntelligence.ts — AI room detection on plan sheets + the memory that
// learns from every correction. The Togal-style flow, MAGE-flavored:
//
//   1. Pick a plan sheet → AI detects every room/space (name, type, sqft,
//      where it sits on the sheet).
//   2. The GC taps rooms, fixes the square footage, sets their $/SF, and
//      leaves notes ("client wants heated floors in here").
//   3. Every correction TRAINS the per-room-type memory: how far off the AI's
//      sqft runs for this GC's plans, what rate they actually charge per room
//      type, and what they keep noting. Next plan, the memory pre-applies —
//      detection arrives already corrected and priced. Over time the GC
//      reviews instead of types: the AI does the managing.
//
// This module is the PURE half: normalization, memory application, learning
// math, pricing, estimate-line conversion. No network, no storage — the
// screen owns I/O (vision call via utils/photoAnalyzer.analyzePlanRooms,
// persistence via hooks/usePlanRooms).

export type RoomType =
  | 'kitchen' | 'bathroom' | 'bedroom' | 'living' | 'dining' | 'office'
  | 'garage' | 'laundry' | 'closet' | 'hallway' | 'basement' | 'deck' | 'other';

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  kitchen: 'Kitchen', bathroom: 'Bathroom', bedroom: 'Bedroom', living: 'Living',
  dining: 'Dining', office: 'Office', garage: 'Garage', laundry: 'Laundry',
  closet: 'Closet', hallway: 'Hallway', basement: 'Basement', deck: 'Deck/Patio',
  other: 'Other',
};

/** Default finish-out $/SF per room type — the cold-start pricing floor.
 *  Overridden the moment the GC's own learned rate exists for the type.
 *  Wet rooms carry the cost density (fixtures, tile, cabinets, rough-in). */
export const DEFAULT_ROOM_RATES: Record<RoomType, number> = {
  kitchen: 250, bathroom: 300, bedroom: 90, living: 80, dining: 80, office: 95,
  garage: 45, laundry: 140, closet: 60, hallway: 55, basement: 70, deck: 65,
  other: 85,
};

/** Wire shape returned by the analyze-photos 'rooms' task (already clamped
 *  server-side; we re-clamp anyway — never trust the wire). */
export interface RawDetectedRoom {
  name: string;
  type: string;
  approxSqft: number;
  /** Normalized 0..1 box on the sheet image. */
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  note?: string;
}

/** A room as the GC works with it on the screen. */
export interface PlanRoom {
  id: string;
  name: string;
  type: RoomType;
  /** Editable square footage. Starts at aiSqft × learned correction. */
  sqft: number;
  /** What the AI originally said — kept so learning compares against it. */
  aiSqft: number;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  /** Editable $/SF. */
  ratePerSqft: number;
  rateSource: 'learned' | 'default' | 'user';
  /** True when the memory's sqft correction was pre-applied. */
  memoryApplied: boolean;
  /** GC's note — persisted into memory so the AI "remembers" next time. */
  note?: string;
  /** What the AI observed ("dimensions printed 12'×14'", "double vanity"). */
  aiNote?: string;
  included: boolean;
}

export interface RoomTypeMemory {
  samples: number;
  /** Running average of (GC-confirmed sqft ÷ AI sqft). 1 = AI was right. */
  sqftCorrection: number;
  /** Learned $/SF once the GC has set one. */
  ratePerSqft?: number;
  /** Recent notes, newest first, capped — context the AI carries forward. */
  notes: string[];
}

/** Keyed by RoomType. The whole "learns over time" state. */
export type PlanRoomMemory = Partial<Record<RoomType, RoomTypeMemory>>;

const MAX_NOTES = 5;
const CORRECTION_CLAMP: [number, number] = [0.5, 2];

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Map free-text room labels to a stable type bucket. */
export function normalizeRoomType(s: string | undefined): RoomType {
  const v = (s ?? '').toLowerCase();
  if (/kitchen|kitchenette/.test(v)) return 'kitchen';
  if (/bath|powder|wc|toilet|ensuite/.test(v)) return 'bathroom';
  if (/bed|master|primary suite|guest room|nursery/.test(v)) return 'bedroom';
  if (/living|family|great|den\b|lounge|rec(reation)? room/.test(v)) return 'living';
  if (/dining|breakfast|nook/.test(v)) return 'dining';
  if (/office|study|library/.test(v)) return 'office';
  if (/garage|carport/.test(v)) return 'garage';
  if (/laundry|utility|mud/.test(v)) return 'laundry';
  if (/closet|wic|wardrobe|pantry/.test(v)) return 'closet';
  if (/hall|foyer|entry|corridor|stair|landing/.test(v)) return 'hallway';
  if (/basement|cellar/.test(v)) return 'basement';
  if (/deck|patio|porch|balcon|terrace/.test(v)) return 'deck';
  return 'other';
}

/** Clamp + validate the wire payload. Drops rooms with no usable identity. */
export function normalizeDetectedRooms(raw: unknown[]): RawDetectedRoom[] {
  if (!Array.isArray(raw)) return [];
  const out: RawDetectedRoom[] = [];
  for (const x of raw) {
    const o = (x ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? '').trim().slice(0, 60);
    if (!name) continue;
    const rawSqft = Number(o.approxSqft);
    if (!isNum(rawSqft) || rawSqft <= 0) continue;
    const sqft = clamp(rawSqft, 1, 20000);
    const b = (o.bbox ?? {}) as Record<string, unknown>;
    out.push({
      name,
      type: String(o.type ?? ''),
      approxSqft: Math.round(sqft),
      bbox: {
        x: clamp(Number(b.x) || 0, 0, 1),
        y: clamp(Number(b.y) || 0, 0, 1),
        w: clamp(Number(b.w) || 0, 0, 1),
        h: clamp(Number(b.h) || 0, 0, 1),
      },
      confidence: clamp(Number(o.confidence) || 50, 0, 100),
      note: o.note ? String(o.note).slice(0, 160) : undefined,
    });
  }
  return out;
}

/**
 * Turn detections into working rooms with the memory pre-applied: sqft gets
 * the learned correction for its type, rate comes from learned > default.
 * `makeId` is injected so this stays pure (screen passes generateUUID).
 */
export function buildPlanRooms(
  raw: unknown[],
  memory: PlanRoomMemory,
  makeId: () => string,
): PlanRoom[] {
  return normalizeDetectedRooms(raw).map(r => {
    const type = normalizeRoomType(`${r.type} ${r.name}`);
    const mem = memory[type];
    const hasCorrection = !!mem && mem.samples >= 1 && isNum(mem.sqftCorrection);
    const correction = hasCorrection ? clamp(mem!.sqftCorrection, ...CORRECTION_CLAMP) : 1;
    const learnedRate = mem?.ratePerSqft;
    return {
      id: makeId(),
      name: r.name,
      type,
      sqft: Math.max(1, Math.round(r.approxSqft * correction)),
      aiSqft: r.approxSqft,
      bbox: r.bbox,
      confidence: r.confidence,
      ratePerSqft: isNum(learnedRate) && learnedRate! > 0 ? learnedRate! : DEFAULT_ROOM_RATES[type],
      rateSource: isNum(learnedRate) && learnedRate! > 0 ? 'learned' : 'default',
      memoryApplied: hasCorrection && Math.abs(correction - 1) > 0.001,
      aiNote: r.note,
      included: true,
    };
  });
}

/**
 * The learning step — fold a finished session back into memory. For every
 * included room: update the sqft-correction running average against what the
 * AI originally said, learn the rate when the GC set one, and remember notes.
 */
export function learnFromSession(rooms: PlanRoom[], memory: PlanRoomMemory): PlanRoomMemory {
  const next: PlanRoomMemory = { ...memory };
  for (const room of rooms) {
    if (!room.included || room.aiSqft <= 0 || room.sqft <= 0) continue;
    const prev: RoomTypeMemory = next[room.type] ?? { samples: 0, sqftCorrection: 1, notes: [] };
    const thisCorrection = clamp(room.sqft / room.aiSqft, ...CORRECTION_CLAMP);
    const samples = prev.samples + 1;
    const sqftCorrection = (prev.sqftCorrection * prev.samples + thisCorrection) / samples;
    const ratePerSqft = room.rateSource === 'user' && room.ratePerSqft > 0
      ? room.ratePerSqft
      : prev.ratePerSqft;
    const note = (room.note ?? '').trim();
    const notes = note && !prev.notes.includes(note)
      ? [note, ...prev.notes].slice(0, MAX_NOTES)
      : prev.notes;
    next[room.type] = { samples, sqftCorrection, ratePerSqft, notes };
  }
  return next;
}

export interface RoomEstimateLine {
  name: string;
  category: string;
  unit: 'SF';
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Included rooms → estimate-ready lines (the screen wraps these into
 *  LinkedEstimateItems with ids + the estimate's existing markup ratio,
 *  same as the visual-takeoff add flow). */
export function roomsToEstimateLines(rooms: PlanRoom[]): RoomEstimateLine[] {
  return rooms
    .filter(r => r.included && r.sqft > 0 && r.ratePerSqft > 0)
    .map(r => ({
      name: `${r.name} — finish-out (plan AI)`,
      category: ROOM_TYPE_LABELS[r.type],
      unit: 'SF' as const,
      quantity: Math.round(r.sqft),
      unitPrice: r.ratePerSqft,
      lineTotal: Math.round(r.sqft) * r.ratePerSqft,
    }));
}

export interface PlanRoomTotals {
  roomCount: number;
  totalSqft: number;
  totalCost: number;
}

export function planRoomTotals(rooms: PlanRoom[]): PlanRoomTotals {
  const included = rooms.filter(r => r.included);
  return {
    roomCount: included.length,
    totalSqft: included.reduce((s, r) => s + Math.round(r.sqft), 0),
    totalCost: included.reduce((s, r) => s + Math.round(r.sqft) * r.ratePerSqft, 0),
  };
}

/** One-line description of what the memory knows — the trust-builder chip. */
export function memorySummary(memory: PlanRoomMemory): string | null {
  const entries = Object.entries(memory).filter(([, m]) => m && m.samples > 0);
  if (entries.length === 0) return null;
  const totalSamples = entries.reduce((s, [, m]) => s + (m?.samples ?? 0), 0);
  return `Trained on ${totalSamples} correction${totalSamples === 1 ? '' : 's'} across ${entries.length} room type${entries.length === 1 ? '' : 's'}`;
}
