// utils/roomScan/clearanceCore.ts — Clearance Check: the distances an inspector
// commonly looks at, MEASURED off a scanned room, and which of them are worth
// putting a tape on.
//
// Scan The Room, lane CLEARANCE (owner preview, behind its OWN gate:
// utils/roomScan/clearanceAllowed). Pure: no React, no storage, no clock, no network,
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
// fixture FACES, and nothing here trusts the box's own "depth" axis for it
// (which axis Apple calls depth has not been checked on a real scan). The back
// is read from the ROOM: the one box axis along which a wall stands within
// BACK_REACH_M of the box, with open floor on the other side of the box.
//
// WHEN A FIXTURE IS NOT LABELLED (fixtureFacing returns 'unsure', and the
// screen says "MAGE cannot tell which way this fixture faces. Tape it."):
//   - a wall is within reach on BOTH box axes (a fixture in a corner, or beside
//     a side wall: the room alone cannot say which wall is the back);
//   - a wall is within reach on both sides of the same axis (an alcove: no
//     open floor in front), or the far side is not clearly further;
//   - the box is near-square (its sides within NEAR_SQUARE_RATIO of each other);
//   - a toilet whose depth, read off the room, is not at least
//     TOILET_DEPTH_RATIO times its width.
// A fixture with no wall within reach at all stands free: left out, and said.
// A fixture the scan drew across another fixed thing is left out, and said
// (it is NOT measured past that thing: ignoring it would read as roomy). The
// one exception is a sink whose centre is inside a cabinet: that cabinet is
// the vanity it sits in, so the sink's lines ignore it and its front line
// starts from the cabinet's front face.
//   toilet, each side   the SHORTEST distance, square to the centre line, to
//                       any wall or fixed thing that is beside the toilet
//                       anywhere along its depth (not one line from the centre);
//   toilet, in front    from the front of the box, straight ahead, the
//                       shortest distance across the box's whole width (to
//                       just inside each edge), to the first wall or fixed
//                       thing. A door's swing is not modelled, and the row says so;
//   sink, in front      the same, from the front of the cabinet it sits in
//                       when it sits in one;
//   door                the width the scan drew for the door, as a plain
//                       number with NO state and NO figure. An interior door
//                       28 or 30 in wide is ordinary, and the 32 in clear
//                       figure is commonly asked of a home's main exit door,
//                       which a scan cannot identify (said in words on the row);
//   passage             the narrowest distance between two outline walls that
//                       face each other across the floor. It gets a state
//                       only when the STRETCH THE TWO WALLS SHARE is at least
//                       PASSAGE_RATIO times that distance (a hallway). Whole
//                       wall lengths are not used: a short jog facing a long
//                       wall is not a hallway. Furniture is not counted;
//   ceiling             the LOWEST height the scan saw. A bathroom is set beside
//                       the 6 ft 8 in figure, and beside 7 ft as well when the
//                       project resolves to New York City. Any other room is set
//                       beside 7 ft, and beside New York City's commonly cited
//                       8 ft only when the project resolves to New York City
//                       and the room is not shaped like a hallway;
//   bedroom window      width, height, area and sill height of the opening the
//                       scan drew. An emergency escape opening is judged on
//                       its NET CLEAR opening with the sash open, which a scan
//                       cannot see. So a window is only ever 'close' ("worth a
//                       closer look") or has no state, and only in a bedroom.
// A measurement whose value is not a finite number is dropped.
// LEFT OUT, each with a line on the screen (ClearanceLeftOut): stairs (the
// scan gives a box, with no risers or treads), a tub or shower opening (a box,
// no opening), a window that is not in a bedroom, a fixture that stands free,
// a fixture whose facing is not sure, a fixture drawn across something else,
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
/** A box whose shorter side is at least this share of its longer side is near-square. */
export const NEAR_SQUARE_RATIO = 0.9;
/** A toilet's depth, read off the room, is at least this many times its width, or its facing is not sure. */
export const TOILET_DEPTH_RATIO = 1.25;
/** Two boxes overlap when they run into each other by more than this. Touching is not overlapping. */
const OVERLAP_M = 0.01;
/** The lines in front run to this far inside each edge of the box. */
export const EDGE_INSET_M = 0.01;
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
  /** Where a front line starts: the fixture's own box, or the cabinet a sink sits in. Null for every other row. */
  frontFrom: 'box' | 'cabinet' | null;
  toward: ClearanceToward | null;
  /** The measurement as a line on the plan, plan metres. Null for a height. */
  line: { a: Pt; b: Pt } | null;
  wallIds: string[];
  objectId: string | null;
  openingId: string | null;
}

export type ClearanceLeftOutKind =
  | 'stairs' | 'tub_opening' | 'door_clear' | 'window_net_clear'
  | 'windows_not_bedroom' | 'fixture_free' | 'fixture_facing' | 'fixture_overlap' | 'passage_open' | 'ceiling_unknown';

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

/** The first wall a ray runs into. */
function firstWall(scan: RoomScan, o: Pt, d: Pt): { t: number; wallId: string } | null {
  let best: { t: number; wallId: string } | null = null;
  for (const w of scan.walls) {
    const t = raySegment(o, d, w.a, w.b);
    if (t != null && (!best || t < best.t)) best = { t, wallId: w.id };
  }
  return best;
}

interface Box { c: Pt; u: Pt; v: Pt; hu: number; hv: number }
/** A box the scan drew with every number a number. Anything else is not there as far as a line is concerned. */
const finiteBox = (o: ScanObject): boolean => [o.center.x, o.center.y, o.widthM, o.depthM, o.rotationRad].every(Number.isFinite) && o.widthM > 0 && o.depthM > 0;
const boxOf = (o: ScanObject): Box => {
  const u = { x: Math.cos(o.rotationRad), y: Math.sin(o.rotationRad) };
  return { c: o.center, u, v: { x: -u.y, y: u.x }, hu: o.widthM / 2, hv: o.depthM / 2 };
};
/** Half of a box's extent along a direction. */
const halfAlong = (b: Box, n: Pt): number => b.hu * Math.abs(dot(b.u, n)) + b.hv * Math.abs(dot(b.v, n));
const boxHolds = (b: Box, p: Pt): boolean => Math.abs(dot(sub(p, b.c), b.u)) <= b.hu && Math.abs(dot(sub(p, b.c), b.v)) <= b.hv;
/** True when two boxes run into each other by more than OVERLAP_M (touching does not count). */
export function boxesOverlap(p: ScanObject, q: ScanObject): boolean {
  const a = boxOf(p);
  const b = boxOf(q);
  for (const n of [a.u, a.v, b.u, b.v]) {
    if (halfAlong(a, n) + halfAlong(b, n) - Math.abs(dot(sub(b.c, a.c), n)) <= OVERLAP_M) return false;
  }
  return true;
}

interface Across { t: number; at: number; toward: ClearanceToward }

/**
 * The nearest wall or fixed thing across a band. From `o`, looking along `f`;
 * the band runs along `l` from `lMin` to `lMax`. Every wall and every edge of
 * every fixed box is cut down to the part inside the band and ahead of `o`,
 * and the smallest distance along `f` is kept, with where along `l` it was
 * found. This is the shortest of ALL the parallel lines across the band, not
 * of a few sample lines.
 */
function nearestAcross(scan: RoomScan, o: Pt, f: Pt, l: Pt, lMin: number, lMax: number, skipObjects: ReadonlySet<string>, skipWallId: string | null): Across | null {
  if (!(lMax > lMin)) return null;
  let best: Across | null = null;
  const mid = (lMin + lMax) / 2;
  const tryEdge = (a: Pt, b: Pt, toward: ClearanceToward) => {
    const fa = dot(sub(a, o), f);
    const fb = dot(sub(b, o), f);
    const la = dot(sub(a, o), l);
    const lb = dot(sub(b, o), l);
    let u0 = 0;
    let u1 = 1;
    // Keep the part of the edge where g(u) = ga + u (gb - ga) is at least c.
    const keep = (ga: number, gb: number, c: number): boolean => {
      const dg = gb - ga;
      if (Math.abs(dg) < 1e-12) return ga >= c;
      const root = (c - ga) / dg;
      if (dg > 0) u0 = Math.max(u0, root); else u1 = Math.min(u1, root);
      return u0 <= u1;
    };
    if (!keep(la, lb, lMin) || !keep(-la, -lb, -lMax) || !keep(fa, fb, 0)) return;
    const f0 = fa + u0 * (fb - fa);
    const f1 = fa + u1 * (fb - fa);
    const l0 = la + u0 * (lb - la);
    const l1 = la + u1 * (lb - la);
    let t = Math.min(f0, f1);
    let at = f0 <= f1 ? l0 : l1;
    // An edge square to the line of sight is the same distance all along: draw the line nearest the middle of the band.
    if (Math.abs(f0 - f1) < 1e-9) at = Math.min(Math.max(mid, Math.min(l0, l1)), Math.max(l0, l1));
    t = Math.max(0, t);
    if (!Number.isFinite(t) || !Number.isFinite(at)) return;
    if (!best || t < best.t - 1e-9) best = { t, at, toward };
  };
  for (const w of scan.walls) {
    if (w.id === skipWallId) continue;
    tryEdge(w.a, w.b, { kind: 'wall', wallId: w.id, label: w.label });
  }
  for (const obj of scan.objects) {
    if (skipObjects.has(obj.id) || !FIXED_OBJECT_CATEGORIES.includes(obj.category) || !finiteBox(obj)) continue;
    const c = objectCorners(obj);
    for (let i = 0; i < 4; i++) tryEdge(c[i], c[(i + 1) % 4], { kind: 'object', objectId: obj.id, category: obj.category });
  }
  return best;
}

export interface FixtureFacing {
  /** Away from the back wall. */
  front: Pt;
  /** Square to `front`. */
  side: Pt;
  /** Half of the fixture's own extent along `front`, and along `side`. */
  halfDepth: number;
  halfWidth: number;
  /** How far the wall behind is from the back of the box that was read (negative when the wall cuts into the box). */
  backGapM: number;
  backWallId: string;
}

/**
 * Which way a fixture faces, read from the room and not from the box's own
 * axes. 'free': no wall within reach. 'unsure': the room cannot say (read the
 * top of this file). `host` is the cabinet a sink sits in: the cabinet is what
 * backs onto the wall, so the walls are read from the cabinet's box.
 */
export function fixtureFacing(scan: RoomScan, o: ScanObject, host: ScanObject | null = null): FixtureFacing | 'free' | 'unsure' {
  const own = boxOf(o);
  const read = host ? boxOf(host) : own;
  const gap = (dir: Pt, half: number): { gap: number; wallId: string | null } => {
    const h = firstWall(scan, read.c, dir);
    return h ? { gap: h.t - half, wallId: h.wallId } : { gap: Infinity, wallId: null };
  };
  const axes = [read.v, read.u].map((n, i) => {
    const half = i === 0 ? read.hv : read.hu;
    const plus = gap(n, half);
    const minus = gap(mul(n, -1), half);
    const back = plus.gap <= minus.gap ? { dir: n, ...plus } : { dir: mul(n, -1), ...minus };
    return { n, back, near: Math.min(plus.gap, minus.gap), far: Math.max(plus.gap, minus.gap) };
  });
  const inReach = axes.filter((a) => a.near <= BACK_REACH_M);
  if (inReach.length === 0) return 'free';
  // A wall within reach on both axes: a corner. The room alone cannot say which wall is the back.
  if (inReach.length === 2) return 'unsure';
  const ax = inReach[0];
  // Open floor in front: the far side is out of reach, and clearly further than the back.
  if (!(ax.far > BACK_REACH_M) || !(ax.far - ax.near >= BACK_CLEAR_M) || !ax.back.wallId) return 'unsure';
  const short = Math.min(o.widthM, o.depthM);
  const long = Math.max(o.widthM, o.depthM);
  if (!(long > 0) || short / long >= NEAR_SQUARE_RATIO) return 'unsure';
  const front = mul(ax.back.dir, -1);
  const side = { x: -front.y, y: front.x };
  const halfDepth = halfAlong(own, front);
  const halfWidth = halfAlong(own, side);
  if (o.category === 'toilet' && !(halfDepth >= TOILET_DEPTH_RATIO * halfWidth)) return 'unsure';
  return { front, side, halfDepth, halfWidth, backGapM: ax.back.gap, backWallId: ax.back.wallId };
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
  /** How long the stretch is that the two walls run beside each other. NOT either wall's whole length. */
  sharedM: number;
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
        best = { widthM: pick.d, sharedM: hi - lo, wallIds: [A.id, B.id], line: { a: pick.from, b: pick.to }, tapedWallId: null };
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

export interface ClearanceOptions {
  /** True only when the project's address resolves to New York City (the app's own resolver, asked by the caller). */
  nyc?: boolean;
}

/** Read the top of this file. `tapePairs` is his taped walls on this phone (learnCore); pass none and the default margin is used. */
export function buildClearanceCheck(scan: RoomScan, tapePairs: readonly TapePair[] = [], options: ClearanceOptions = {}): ClearanceCheck {
  const nyc = options.nyc === true;
  const margin = clearanceMargin(tapeFacts(tapePairs));
  const measures: ClearanceMeasure[] = [];
  const left = new Map<ClearanceLeftOutKind, number>();
  const leave = (kind: ClearanceLeftOutKind, count = 1) => left.set(kind, (left.get(kind) ?? 0) + count);

  const push = (m: {
    id: string; kind: ClearanceKind; index: number; value: number; unit?: 'length' | 'area';
    refs: readonly ClearanceRefId[]; taped?: boolean; boundOnly?: boolean; boundStates?: (ClearanceState | null)[];
    toward?: ClearanceToward | null; line?: { a: Pt; b: Pt } | null; wallIds?: string[]; objectId?: string | null; openingId?: string | null;
    frontFrom?: 'box' | 'cabinet';
  }) => {
    // A number that is not a number is not a measurement.
    if (!Number.isFinite(m.value)) return;
    const unitOf = m.unit ?? 'length';
    const taped = m.taped === true;
    const marginIn = taped ? margin.tapedIn : margin.scanIn;
    const valueUS = unitOf === 'area' ? sqMetresToSqFeet(m.value) : metresToInches(m.value);
    if (!Number.isFinite(valueUS) || !Number.isFinite(marginIn)) return;
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
      marginIn, marginBasis: taped ? 'taped' : margin.basis, restsOnTaped: taped, boundOnly: m.boundOnly === true, frontFrom: m.frontFrom ?? null,
      toward: m.toward ?? null, line: m.line ?? null, wallIds: m.wallIds ?? [], objectId: m.objectId ?? null, openingId: m.openingId ?? null,
    });
  };
  const wallOf = (t: ClearanceToward | null): string[] => (t && t.kind === 'wall' ? [t.wallId] : []);

  // ── toilets and sinks ──
  const fixed = scan.objects.filter((x) => FIXED_OBJECT_CATEGORIES.includes(x.category) && finiteBox(x));
  let toiletNo = 0;
  let sinkNo = 0;
  for (const o of scan.objects) {
    if (o.category !== 'toilet' && o.category !== 'sink') continue;
    const index = o.category === 'toilet' ? ++toiletNo : ++sinkNo;
    if (!finiteBox(o)) { leave('fixture_facing'); continue; }
    // What the scan drew across this fixture. A sink whose centre is inside one cabinet sits in it; anything else is not measured past.
    const across = fixed.filter((x) => x.id !== o.id && boxesOverlap(o, x));
    const hosts = o.category === 'sink' ? across.filter((x) => x.category === 'storage' && boxHolds(boxOf(x), o.center)) : [];
    const host = hosts.length === 1 ? hosts[0] : null;
    if (across.length > (host ? 1 : 0)) { leave('fixture_overlap'); continue; }
    const f = fixtureFacing(scan, o, host);
    if (f === 'free') { leave('fixture_free'); continue; }
    if (f === 'unsure') { leave('fixture_facing'); continue; }
    const skip = new Set<string>([o.id, ...(host ? [host.id] : [])]);
    if (o.category === 'toilet') {
      // From the back of the box to its front, the shortest distance square to the centre line. The wall behind is not beside it.
      const backPt = sub(o.center, mul(f.front, f.halfDepth));
      const from = Math.max(0, -f.backGapM) + EDGE_INSET_M;
      (['a', 'b'] as const).forEach((tag, i) => {
        const dir = mul(f.side, i === 0 ? 1 : -1);
        const h = nearestAcross(scan, backPt, dir, f.front, from, 2 * f.halfDepth, skip, f.backWallId);
        if (!h) return;
        const a = add(backPt, mul(f.front, h.at));
        push({
          id: `toilet:${o.id}:side:${tag}`, kind: 'toilet_side', index, value: h.t, refs: ['toilet_side_15'],
          toward: h.toward, line: { a, b: add(a, mul(dir, h.t)) }, wallIds: wallOf(h.toward), objectId: o.id,
        });
      });
    }
    // In front: from the front of the box, or of the cabinet a sink sits in, across the fixture's whole width.
    let reach = f.halfDepth;
    if (host) for (const c of objectCorners(host)) reach = Math.max(reach, dot(sub(c, o.center), f.front));
    const frontPt = add(o.center, mul(f.front, reach));
    const inset = Math.min(EDGE_INSET_M, f.halfWidth / 2);
    const fc = nearestAcross(scan, frontPt, f.front, f.side, -(f.halfWidth - inset), f.halfWidth - inset, skip, f.backWallId);
    if (fc) {
      const a = add(frontPt, mul(f.side, fc.at));
      push({
        id: `${o.category}:${o.id}:front`, kind: o.category === 'toilet' ? 'toilet_front' : 'sink_front', index, value: fc.t,
        refs: o.category === 'toilet' ? ['toilet_front_21'] : ['sink_front_21'], frontFrom: host ? 'cabinet' : 'box',
        toward: fc.toward, line: { a, b: add(a, mul(f.front, fc.t)) }, wallIds: wallOf(fc.toward), objectId: o.id,
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
      // No figure and no state: read the top of this file.
      id: `door:${o.id}:width`, kind: 'door_width', index: doorNo, value: o.widthM, refs: [],
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
  const hallway = !!passage && passage.sharedM >= PASSAGE_RATIO * passage.widthM;
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
      // A bathroom: 6 ft 8 in, and New York City's commonly cited 7 ft there. Any other room: 7 ft, and New York City's
      // commonly cited 8 ft there, which is about rooms people live in and so not a room shaped like a hallway.
      refs: scan.roomType === 'bathroom'
        ? (nyc ? ['ceiling_bath_80', 'ceiling_bath_84_nyc'] : ['ceiling_bath_80'])
        : (nyc && !hallway ? ['ceiling_84', 'ceiling_96'] : ['ceiling_84']),
      taped: c.source === 'typed',
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
