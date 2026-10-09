// utils/roomScan/clearanceCore.ts — Clearance Check: the distances an inspector
// commonly looks at, MEASURED off a scanned room, and which of them are worth
// putting a tape on.
//
// Scan The Room, lane CLEARANCE (owner preview: the same gate as the scanner,
// utils/roomScan/allowed). Pure: no React, no storage, no clock, no network,
// no model call. scripts/validate-scan-clearance.ts runs every function here
// on hand-built rooms. NOTHING HERE HAS BEEN CHECKED AGAINST A REAL SCAN.
//
// ── THE WHOLE POINT ─────────────────────────────────────────────────────────
// A phone scan can be off by an inch or more, and several of these figures
// are a matter of an inch. So this file never says a distance is fine and
// never says it is not. It gives the number as scanned and one of three
// states, each against a COMMONLY USED figure (utils/roomScan/clearanceRefs):
//   'roomy'   further from the figure than the margin, on the roomy side;
//   'close'   within the margin of the figure, either side: tape it;
//   'tight'   on the short side of the figure by MORE than the margin: tape
//             it, and check the local code.
// A measurement with NO state has not been compared with anything. A state
// never blocks an action: nothing in the app reads a state to decide whether
// something may be saved, priced, sent or signed (the validator pins this).
//
// ── THE MARGIN (clearanceMargin) ────────────────────────────────────────────
//   scan    1.5 in by default. When his own tape history (learnCore.tapeFacts,
//           at least MIN_TAPE_PAIRS walls) shows a LARGER difference, the
//           margin is that largest difference, up to MAX_MARGIN_IN. It never
//           goes below 1.5 in: a good history does not make the next scan good.
//   taped   0.5 in, used only where the number ITSELF is one he typed off a
//           tape: a door or window size he typed, a ceiling height he typed, or
//           a hallway whose width is the length of an end wall he taped
//           (lengthSource 'typed'). A taped wall does not move a fixture: a
//           toilet's or a sink's place still comes from the scan, so those rows
//           always use the scan margin, and each row says which it used.
//
// ── WHAT IS MEASURED, AND HOW ───────────────────────────────────────────────
// Walls are line segments on the plan (metres). A fixture is the scan's box:
// a centre, a width, a depth and a turn. The scan does not say which way a
// fixture FACES, so the back is worked out: of the two directions along its
// depth, the one whose wall is nearer is the back, and only when that wall is
// within BACK_REACH_M of the box and clearly nearer than the other side. A
// fixture that stands free of both walls is left out, and said.
//   toilet, each side   from the centre, square to the centre line, to the
//                       first wall or fixed thing (another fixture, a cabinet);
//   toilet, in front    from the front of the box, straight ahead, the
//                       shortest of three lines (the centre and a quarter of
//                       the width either side), to the first wall or fixed thing;
//   sink, in front      the same;
//   door                the width the scan drew for the door. The parser
//                       (capturedRoomParser) reads ONE width per door and
//                       cannot tell a leaf from a frame opening, and the CLEAR
//                       width with the door open is less than either. So a
//                       door's width is never 'roomy' and never 'tight': it is
//                       'close' when even the scanned width is within the
//                       margin of the figure, and has no state otherwise;
//   passage             the narrowest distance between two outline walls that
//                       face each other across the floor. It gets a state
//                       only when the room is shaped like a hallway (at least
//                       PASSAGE_RATIO times as long as it is wide). Furniture
//                       is not counted;
//   ceiling             the LOWEST height the scan saw. A bathroom is set beside
//                       the bathroom figure; a room shaped like a hallway
//                       beside the 7 ft figure alone; any other room beside
//                       7 ft and the 8 ft some city codes use;
//   bedroom window      width, height, area and sill height of the opening the
//                       scan drew. An emergency escape opening is judged on
//                       its NET CLEAR opening with the sash open, which a scan
//                       cannot see. So a window is only ever 'close' ("worth a
//                       closer look") or has no state, and only in a bedroom.
// LEFT OUT, each with a line on the screen (ClearanceLeftOut): stairs (the
// scan gives a box, with no risers or treads), a tub or shower opening (a box,
// no opening), a window that is not in a bedroom, a fixture that stands free,
// and the passage of a room whose outline did not close.

import { clearanceRef, type ClearanceRefId } from './clearanceRefs';
import { tapeFacts, type TapeFacts, type TapePair } from './learnCore';
import { metresToInches, sqMetresToSqFeet } from './units';
import type { Pt, RoomScan, ScanObject, ScanOpening, ScanWall } from './types';

export type ClearanceState = 'roomy' | 'close' | 'tight';

export type ClearanceKind =
  | 'toilet_side' | 'toilet_front' | 'sink_front'
  | 'door_width' | 'passage_width' | 'ceiling_low'
  | 'window_width' | 'window_height' | 'window_area' | 'window_sill';

/** The least the scan margin is ever allowed to be, inches. */
export const DEFAULT_MARGIN_IN = 1.5;
/** The margin where the number itself was typed off a tape. */
export const TAPED_MARGIN_IN = 0.5;
/** A worse tape history widens the margin up to this and no further. */
export const MAX_MARGIN_IN = 6;
/** A fixture's back wall is at most this far behind its box. */
export const BACK_REACH_M = 0.3;
/** The back must be nearer than the other side by at least this. */
export const BACK_CLEAR_M = 0.05;
/** A room this many times as long as it is wide is shaped like a hallway. */
export const PASSAGE_RATIO = 2.5;
/** Two walls face each other when they are within this of parallel (the sine of ten degrees). */
const PARALLEL_SIN = 0.1737;
/** Two facing walls must run beside each other for at least this. */
const MIN_OVERLAP_M = 0.3;
/** Inches. Keeps a value sitting on a boundary on the 'close' side of it. */
const EPS_IN = 1e-3;

/** Things that stay where they are. A chair, a table, a sofa or a bed is not in the way of a tape. */
export const FIXED_OBJECT_CATEGORIES: readonly string[] = [
  'toilet', 'sink', 'bathtub', 'storage', 'stove', 'oven', 'refrigerator', 'dishwasher', 'washerDryer', 'fireplace', 'stairs',
];

export type MarginBasis = 'scan_default' | 'tape_history' | 'taped';

export interface ClearanceMargin {
  /** The margin for a number read from the scan, inches. */
  scanIn: number;
  /** The margin for a number he typed off a tape, inches. */
  tapedIn: number;
  basis: 'scan_default' | 'tape_history';
  /** Taped walls the history is from. 0 when there are too few to read. */
  tapeCount: number;
  /** The largest difference in that history, inches. 0 when there are too few. */
  largestIn: number;
}

/** The margins, from his own tape history. Read the top of this file. */
export function clearanceMargin(tape: TapeFacts | null | undefined): ClearanceMargin {
  if (tape && tape.enough && tape.largestIn > DEFAULT_MARGIN_IN) {
    return { scanIn: Math.min(MAX_MARGIN_IN, tape.largestIn), tapedIn: TAPED_MARGIN_IN, basis: 'tape_history', tapeCount: tape.count, largestIn: tape.largestIn };
  }
  return {
    scanIn: DEFAULT_MARGIN_IN, tapedIn: TAPED_MARGIN_IN, basis: 'scan_default',
    tapeCount: tape && tape.enough ? tape.count : 0, largestIn: tape && tape.enough ? tape.largestIn : 0,
  };
}

/**
 * One value against one figure. `bound` 'min': short of the figure is the
 * tight side. 'max': over it is. On the figure, and anywhere within the
 * margin either side of it, is 'close'.
 */
export function clearanceState(value: number, limit: number, bound: 'min' | 'max', margin: number): ClearanceState {
  const over = bound === 'min' ? value - limit : limit - value;
  if (over < -margin - EPS_IN) return 'tight';
  if (over > margin + EPS_IN) return 'roomy';
  return 'close';
}

/**
 * The same, for a number that can only be LARGER than the thing the figure is
 * about (a scanned door width against a clear width, a scanned window opening
 * against its net clear opening). It can say "worth a closer look" and nothing
 * else: 'close', or no state.
 */
export function clearanceBoundState(value: number, limit: number, bound: 'min' | 'max', margin: number): 'close' | null {
  return clearanceState(value, limit, bound, margin) === 'roomy' ? null : 'close';
}

const RANK: Record<ClearanceState, number> = { roomy: 1, close: 2, tight: 3 };
/** The state most worth a tape. */
export function worstState(states: readonly (ClearanceState | null)[]): ClearanceState | null {
  let out: ClearanceState | null = null;
  for (const s of states) if (s && (!out || RANK[s] > RANK[out])) out = s;
  return out;
}

export interface ClearanceFigure {
  refId: ClearanceRefId;
  state: ClearanceState | null;
}

/** What a line from a fixture ran into. */
export type ClearanceToward = { kind: 'wall'; wallId: string; label: string } | { kind: 'object'; objectId: string; category: string };

export interface ClearanceMeasure {
  id: string;
  kind: ClearanceKind;
  /** 1 for the first toilet, door or window of the room, 2 for the second. */
  index: number;
  /** Metres for a length, square metres for an area. */
  value: number;
  unit: 'length' | 'area';
  /** Inches for a length, square feet for an area: what the states were worked out from. */
  valueUS: number;
  /** The figures this number was set beside, each with its own state. Empty: compared with nothing. */
  figures: ClearanceFigure[];
  /** The state most worth a tape among `figures`, or null: not compared with anything. */
  state: ClearanceState | null;
  /** The figure that gave `state`. */
  stateRefId: ClearanceRefId | null;
  marginIn: number;
  marginBasis: MarginBasis;
  /** True when the number is one he typed off a tape (see the top of this file). */
  restsOnTaped: boolean;
  /** True when the scan can only see something larger than what the figure is about. */
  boundOnly: boolean;
  toward: ClearanceToward | null;
  /** The measurement as a line on the plan, plan metres. Null for a height. */
  line: { a: Pt; b: Pt } | null;
  wallIds: string[];
  objectId: string | null;
  openingId: string | null;
}

export type ClearanceLeftOutKind =
  | 'stairs' | 'tub_opening' | 'door_clear' | 'window_net_clear'
  | 'windows_not_bedroom' | 'fixture_free' | 'passage_open' | 'ceiling_unknown';

export interface ClearanceLeftOut {
  kind: ClearanceLeftOutKind;
  /** How many things in this room the line is about (0 for a standing line). */
  count: number;
}

export interface ClearanceCheck {
  measures: ClearanceMeasure[];
  margin: ClearanceMargin;
  leftOut: ClearanceLeftOut[];
  /** How many measures carry any state at all. */
  comparedCount: number;
  /** How many rest on a taped number. */
  tapedCount: number;
}

// ── plan geometry ───────────────────────────────────────────────────────────
const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: Pt, q: Pt): Pt => ({ x: p.x + q.x, y: p.y + q.y });
const mul = (p: Pt, k: number): Pt => ({ x: p.x * k, y: p.y * k });
const dot = (p: Pt, q: Pt): number => p.x * q.x + p.y * q.y;
const cross = (p: Pt, q: Pt): number => p.x * q.y - p.y * q.x;
const len = (p: Pt): number => Math.hypot(p.x, p.y);
const unit = (p: Pt): Pt => { const n = len(p); return n > 0 ? { x: p.x / n, y: p.y / n } : { x: 1, y: 0 }; };

/** How far along a ray (origin `o`, unit direction `d`) the segment a-b is hit, or null. A ray running along the segment does not hit it. */
export function raySegment(o: Pt, d: Pt, a: Pt, b: Pt): number | null {
  const e = sub(b, a);
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const ao = sub(a, o);
  const t = cross(ao, e) / den;
  const s = cross(ao, d) / den;
  if (t < -1e-9 || s < -1e-9 || s > 1 + 1e-9) return null;
  return Math.max(0, t);
}

/** The four corners of a fixture's box on the plan. */
export function objectCorners(o: ScanObject): Pt[] {
  const w = { x: Math.cos(o.rotationRad), y: Math.sin(o.rotationRad) };
  const d = { x: -w.y, y: w.x };
  const hw = mul(w, o.widthM / 2);
  const hd = mul(d, o.depthM / 2);
  return [
    add(add(o.center, hw), hd), add(sub(o.center, hw), hd),
    sub(sub(o.center, hw), hd), sub(add(o.center, hw), hd),
  ];
}

interface Hit { t: number; toward: ClearanceToward }

/** The first wall or fixed thing a ray runs into. `skipObjectId` is the fixture the ray starts from. */
function firstHit(scan: RoomScan, o: Pt, d: Pt, skipObjectId: string | null, wallsOnly = false): Hit | null {
  let best: Hit | null = null;
  for (const w of scan.walls) {
    const t = raySegment(o, d, w.a, w.b);
    if (t != null && (!best || t < best.t)) best = { t, toward: { kind: 'wall', wallId: w.id, label: w.label } };
  }
  if (wallsOnly) return best;
  for (const obj of scan.objects) {
    if (obj.id === skipObjectId || !FIXED_OBJECT_CATEGORIES.includes(obj.category)) continue;
    const c = objectCorners(obj);
    for (let i = 0; i < 4; i++) {
      const t = raySegment(o, d, c[i], c[(i + 1) % 4]);
      if (t != null && (!best || t < best.t)) best = { t, toward: { kind: 'object', objectId: obj.id, category: obj.category } };
    }
  }
  return best;
}

/** Which way a fixture faces, or null when it stands free of the walls (see the top of this file). */
export function fixtureFacing(scan: RoomScan, o: ScanObject): { front: Pt; side: Pt } | null {
  const side = { x: Math.cos(o.rotationRad), y: Math.sin(o.rotationRad) };
  const depth = { x: -side.y, y: side.x };
  const gap = (dir: Pt): number => {
    const h = firstHit(scan, o.center, dir, o.id, true);
    return h ? h.t - o.depthM / 2 : Infinity;
  };
  const plus = gap(depth);
  const minus = gap(mul(depth, -1));
  const back = plus <= minus ? depth : mul(depth, -1);
  const near = Math.min(plus, minus);
  const far = Math.max(plus, minus);
  if (!(near <= BACK_REACH_M) || !(far - near >= BACK_CLEAR_M)) return null;
  return { front: mul(back, -1), side };
}

function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface Passage {
  widthM: number;
  /** The longer of the two facing walls. */
  longM: number;
  wallIds: [string, string];
  line: { a: Pt; b: Pt };
  /** The end wall he taped whose length IS this width, when there is one. */
  tapedWallId: string | null;
}

/** The narrowest distance between two outline walls that face each other across the floor, or null. */
export function narrowestPassage(scan: RoomScan): Passage | null {
  if (!scan.closure.closed || scan.floor.length < 3) return null;
  const walls = scan.walls.filter((w) => w.onOutline && w.lengthM > 0);
  let best: Passage | null = null;
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const A = walls[i];
      const B = walls[j];
      const u = unit(sub(A.b, A.a));
      const v = unit(sub(B.b, B.a));
      if (Math.abs(cross(u, v)) > PARALLEL_SIN) continue;
      // Where B's ends fall along A.
      const t1 = dot(sub(B.a, A.a), u);
      const t2 = dot(sub(B.b, A.a), u);
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(A.lengthM, Math.max(t1, t2));
      if (hi - lo < MIN_OVERLAP_M) continue;
      // The distance square to A, at each end of the stretch they share and in the middle. The narrowest counts.
      const n = { x: -u.y, y: u.x };
      let pick: { d: number; from: Pt; to: Pt } | null = null;
      for (const t of [(lo + hi) / 2, lo, hi]) {
        const from = add(A.a, mul(u, t));
        const den = cross(n, v);
        if (Math.abs(den) < 1e-9) continue;
        const k = cross(sub(B.a, from), v) / den;
        const to = add(from, mul(n, k));
        const d = Math.abs(k);
        if (!pick || d < pick.d - 1e-4) pick = { d, from, to };
      }
      if (!pick || pick.d < 0.05) continue;
      // Floor between them, and no other wall in the way.
      const mid = mul(add(pick.from, pick.to), 0.5);
      if (!pointInPolygon(mid, scan.floor)) continue;
      const dir = unit(sub(pick.to, pick.from));
      const blocked = walls.some((w) => {
        if (w === A || w === B) return false;
        const t = raySegment(pick.from, dir, w.a, w.b);
        return t != null && t > 1e-6 && t < pick.d - 1e-6;
      });
      if (blocked) continue;
      if (!best || pick.d < best.widthM - 1e-6) {
        best = { widthM: pick.d, longM: Math.max(A.lengthM, B.lengthM), wallIds: [A.id, B.id], line: { a: pick.from, b: pick.to }, tapedWallId: null };
      }
    }
  }
  if (!best) return null;
  // An end wall he taped, square to the pair, joining them, whose length is this width.
  const [A, B] = best.wallIds.map((id) => walls.find((w) => w.id === id) as ScanWall);
  const u = unit(sub(A.b, A.a));
  const touches = (p: Pt, w: ScanWall): boolean => Math.min(len(sub(p, w.a)), len(sub(p, w.b))) < 0.01;
  for (const w of walls) {
    if (w === A || w === B || w.lengthSource !== 'typed') continue;
    if (Math.abs(dot(unit(sub(w.b, w.a)), u)) > PARALLEL_SIN) continue;
    if (Math.abs(w.lengthM - best.widthM) > 0.005) continue;
    const joins = (touches(w.a, A) && touches(w.b, B)) || (touches(w.a, B) && touches(w.b, A));
    if (joins) { best.tapedWallId = w.id; break; }
  }
  return best;
}

// ── the check ───────────────────────────────────────────────────────────────
const IN_PER_SQFT = 144;

/** Read the top of this file. `tapePairs` is his taped walls on this phone (learnCore); pass none and the default margin is used. */
export function buildClearanceCheck(scan: RoomScan, tapePairs: readonly TapePair[] = []): ClearanceCheck {
  const margin = clearanceMargin(tapeFacts(tapePairs));
  const measures: ClearanceMeasure[] = [];
  const left = new Map<ClearanceLeftOutKind, number>();
  const leave = (kind: ClearanceLeftOutKind, count = 1) => left.set(kind, (left.get(kind) ?? 0) + count);

  const push = (m: {
    id: string; kind: ClearanceKind; index: number; value: number; unit?: 'length' | 'area';
    refs: readonly ClearanceRefId[]; taped?: boolean; boundOnly?: boolean; boundStates?: (ClearanceState | null)[];
    toward?: ClearanceToward | null; line?: { a: Pt; b: Pt } | null; wallIds?: string[]; objectId?: string | null; openingId?: string | null;
  }) => {
    const unitOf = m.unit ?? 'length';
    const taped = m.taped === true;
    const marginIn = taped ? margin.tapedIn : margin.scanIn;
    const valueUS = unitOf === 'area' ? sqMetresToSqFeet(m.value) : metresToInches(m.value);
    const figures: ClearanceFigure[] = m.refs.map((refId, i) => {
      const ref = clearanceRef(refId);
      if (m.boundStates) return { refId, state: m.boundStates[i] ?? null };
      return { refId, state: m.boundOnly ? clearanceBoundState(valueUS, ref.value, ref.bound, marginIn) : clearanceState(valueUS, ref.value, ref.bound, marginIn) };
    });
    const state = worstState(figures.map((f) => f.state));
    // Of the figures that gave the state, the one asking for the most room.
    let stateRefId: ClearanceRefId | null = null;
    for (const f of figures) {
      if (!state || f.state !== state) continue;
      if (!stateRefId || clearanceRef(f.refId).value > clearanceRef(stateRefId).value) stateRefId = f.refId;
    }
    measures.push({
      id: m.id, kind: m.kind, index: m.index, value: m.value, unit: unitOf, valueUS, figures, state, stateRefId,
      marginIn, marginBasis: taped ? 'taped' : margin.basis, restsOnTaped: taped, boundOnly: m.boundOnly === true,
      toward: m.toward ?? null, line: m.line ?? null, wallIds: m.wallIds ?? [], objectId: m.objectId ?? null, openingId: m.openingId ?? null,
    });
  };
  const wallOf = (t: ClearanceToward | null): string[] => (t && t.kind === 'wall' ? [t.wallId] : []);

  // ── toilets and sinks ──
  const frontClear = (o: ScanObject, f: { front: Pt; side: Pt }): { t: number; from: Pt; toward: ClearanceToward } | null => {
    let best: { t: number; from: Pt; toward: ClearanceToward } | null = null;
    for (const k of [0, -1, 1]) {
      const from = add(add(o.center, mul(f.front, o.depthM / 2)), mul(f.side, (k * o.widthM) / 4));
      const h = firstHit(scan, from, f.front, o.id);
      if (h && (!best || h.t < best.t - 1e-9)) best = { t: h.t, from, toward: h.toward };
    }
    return best;
  };
  let toiletNo = 0;
  let sinkNo = 0;
  for (const o of scan.objects) {
    if (o.category !== 'toilet' && o.category !== 'sink') continue;
    const index = o.category === 'toilet' ? ++toiletNo : ++sinkNo;
    const f = fixtureFacing(scan, o);
    if (!f) { leave('fixture_free'); continue; }
    if (o.category === 'toilet') {
      (['a', 'b'] as const).forEach((tag, i) => {
        const dir = mul(f.side, i === 0 ? 1 : -1);
        const h = firstHit(scan, o.center, dir, o.id);
        if (!h) return;
        push({
          id: `toilet:${o.id}:side:${tag}`, kind: 'toilet_side', index, value: h.t, refs: ['toilet_side_15'],
          toward: h.toward, line: { a: o.center, b: add(o.center, mul(dir, h.t)) }, wallIds: wallOf(h.toward), objectId: o.id,
        });
      });
    }
    const fc = frontClear(o, f);
    if (fc) {
      push({
        id: `${o.category}:${o.id}:front`, kind: o.category === 'toilet' ? 'toilet_front' : 'sink_front', index, value: fc.t,
        refs: o.category === 'toilet' ? ['toilet_front_21', 'toilet_front_24'] : ['sink_front_21'],
        toward: fc.toward, line: { a: fc.from, b: add(fc.from, mul(f.front, fc.t)) }, wallIds: wallOf(fc.toward), objectId: o.id,
      });
    }
  }
  const tubs = scan.objects.filter((o) => o.category === 'bathtub').length;
  if (tubs) leave('tub_opening', tubs);
  const stairs = scan.objects.filter((o) => o.category === 'stairs').length;
  leave('stairs', stairs);

  // ── doors and bedroom windows ──
  const byId = new Map(scan.walls.map((w) => [w.id, w]));
  const openingLine = (o: ScanOpening): { a: Pt; b: Pt } | null => {
    const w = o.wallId ? byId.get(o.wallId) : undefined;
    if (!w || !(w.lengthM > 0)) return null;
    const u = unit(sub(w.b, w.a));
    return { a: add(w.a, mul(u, o.offsetM)), b: add(w.a, mul(u, o.offsetM + o.widthM)) };
  };
  let doorNo = 0;
  for (const o of scan.openings) {
    if (o.kind !== 'door' || !(o.widthM > 0)) continue;
    doorNo += 1;
    push({
      id: `door:${o.id}:width`, kind: 'door_width', index: doorNo, value: o.widthM, refs: ['door_clear_32'],
      taped: o.widthSource === 'typed', boundOnly: true, line: openingLine(o), wallIds: o.wallId ? [o.wallId] : [], openingId: o.id,
    });
  }
  if (doorNo) leave('door_clear', doorNo);

  const windows = scan.openings.filter((o) => o.kind === 'window' && o.widthM > 0 && o.heightM > 0);
  if (windows.length && scan.roomType !== 'bedroom') leave('windows_not_bedroom', windows.length);
  if (windows.length && scan.roomType === 'bedroom') {
    leave('window_net_clear', windows.length);
    windows.forEach((o, i) => {
      const index = i + 1;
      const wTyped = o.widthSource === 'typed';
      const hTyped = o.heightSource === 'typed';
      const common = { index, boundOnly: true, line: openingLine(o), wallIds: o.wallId ? [o.wallId] : [], openingId: o.id };
      push({ ...common, id: `window:${o.id}:width`, kind: 'window_width', value: o.widthM, refs: ['escape_width_20'], taped: wTyped });
      push({ ...common, id: `window:${o.id}:height`, kind: 'window_height', value: o.heightM, refs: ['escape_height_24'], taped: hTyped });
      // The area: 'close' unless the opening still holds the figure with the margin taken off each side.
      const mw = wTyped ? margin.tapedIn : margin.scanIn;
      const mh = hTyped ? margin.tapedIn : margin.scanIn;
      const leastSF = (Math.max(0, metresToInches(o.widthM) - mw) * Math.max(0, metresToInches(o.heightM) - mh)) / IN_PER_SQFT;
      push({
        ...common, id: `window:${o.id}:area`, kind: 'window_area', value: o.widthM * o.heightM, unit: 'area', refs: ['escape_area_5_7'],
        taped: wTyped && hTyped, boundStates: [leastSF > clearanceRef('escape_area_5_7').value + 1e-6 ? null : 'close'],
      });
      push({ ...common, id: `window:${o.id}:sill`, kind: 'window_sill', value: o.sillM, refs: ['escape_sill_44'] });
    });
  }

  // ── the narrowest passage ──
  const passage = narrowestPassage(scan);
  const hallway = !!passage && passage.longM >= PASSAGE_RATIO * passage.widthM;
  if (passage) {
    push({
      id: 'passage:narrowest', kind: 'passage_width', index: 1, value: passage.widthM, refs: hallway ? ['passage_36'] : [],
      taped: passage.tapedWallId != null, line: passage.line, wallIds: [...passage.wallIds, ...(passage.tapedWallId ? [passage.tapedWallId] : [])],
    });
  } else if (!scan.closure.closed) {
    leave('passage_open');
  }

  // ── the ceiling ──
  const c = scan.ceilingHeightM;
  if (c.known && c.min > 0) {
    push({
      id: 'ceiling:lowest', kind: 'ceiling_low', index: 1, value: c.min,
      // The 8 ft figure is about rooms people live in: not a bathroom, and not a room shaped like a hallway.
      refs: scan.roomType === 'bathroom' ? ['ceiling_bath_80'] : hallway ? ['ceiling_84'] : ['ceiling_84', 'ceiling_96'], taped: c.source === 'typed',
    });
  } else {
    leave('ceiling_unknown');
  }

  const leftOut: ClearanceLeftOut[] = [...left.entries()].map(([kind, count]) => ({ kind, count }));
  return {
    measures, margin, leftOut,
    comparedCount: measures.filter((m) => m.state != null).length,
    tapedCount: measures.filter((m) => m.restsOnTaped).length,
  };
}
