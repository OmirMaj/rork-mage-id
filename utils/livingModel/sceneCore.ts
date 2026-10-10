// utils/livingModel/sceneCore.ts — the 3D shapes of a job model, as plain numbers (pure).
//
// The Living Model, Phase 1. This file turns a placed room into flat arrays of
// triangle corners and normals. It imports NO 3D library: the web-only view
// (components/livingModel/JobReplay3D.web.tsx) hands these arrays to three.js,
// and jest and the validator test them as numbers. That is how the 3D view is
// tested without drawing anything.
//
// AXES. X is plan x, Z is plan y, Y is up. Metres.
//
// A SCHEMATIC, NOT A DRAWING OF THE BUILDING. Stud spacing, pipe and wire runs
// and the batts are drawn the same way in every room so a stage reads at a
// glance. They are not where the real ones are and no view says they are.

import { roomCentre, roomHeightM, worldFloor, worldWalls } from './modelCore';
import type { PlacedRoom, RoomKind, WorldOpening, WorldWall } from './types';

/** Every wall is drawn this thick, inside the room's own outline. */
export const WALL_T = 0.11;
export const STUD_GAP = 0.406;
/** The plate on the far face of a wall, and the board on the room side. */
export const SHELL_T = 0.014;
export const SKIN_T = 0.016;
export const DEFAULT_CUT_M = 1.25;
/** Each box is 12 triangles: 36 corners. */
export const VERTS_PER_BOX = 36;

export interface BoxBuf {
  /** x, y, z per corner. */
  p: number[];
  /** Normal per corner. */
  n: number[];
  /** r, g, b per corner (0 to 1). Empty when the layer has one colour. */
  c: number[];
  boxes: number;
}

export interface TriBuf { p: number[]; n: number[] }

export interface RoomGeometry {
  roomId: string;
  /** The wall height drawn, after the cut. */
  heightM: number;
  centre: { x: number; z: number };
  floor: TriBuf;
  /** The far face of every wall: a thin plate that is always there, so a room keeps its shape while its walls are open. */
  shell: BoxBuf;
  /** The wall surface on the room side. Drawn once as the wall that was there and once as new drywall. */
  skin: BoxBuf;
  studs: BoxBuf;
  pipes: BoxBuf;
  wires: BoxBuf;
  insulation: BoxBuf;
  /** Baseboard and door leaves. */
  trim: BoxBuf;
  glass: BoxBuf;
}

export type Rgb = readonly [number, number, number];

export interface SceneOptions {
  /** Walls are drawn no taller than this. null draws them full height. */
  cutHeightM: number | null;
  pipeCold: Rgb;
  pipeHot: Rgb;
  pipeDrain: Rgb;
}

const newBuf = (): BoxBuf => ({ p: [], n: [], c: [], boxes: 0 });

const CORN: readonly (readonly [number, number, number])[] = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
const FACE: readonly (readonly number[])[] = [[1, 2, 6, 5, 1, 0, 0], [0, 4, 7, 3, -1, 0, 0], [3, 7, 6, 2, 0, 1, 0], [0, 1, 5, 4, 0, -1, 0], [4, 5, 6, 7, 0, 0, 1], [0, 3, 2, 1, 0, 0, -1]];

/**
 * One box, turned about the up axis. (ux, uz) is the unit direction of its
 * long side on the floor; hu, hy and hn are half its length, height and depth.
 */
export function pushBox(B: BoxBuf, cx: number, cy: number, cz: number, ux: number, uz: number, hu: number, hy: number, hn: number, col?: Rgb): void {
  const nx = -uz;
  const nz = ux;
  const c: number[][] = [];
  for (let i = 0; i < 8; i++) {
    const q = CORN[i];
    c.push([cx + q[0] * hu * ux + q[2] * hn * nx, cy + q[1] * hy, cz + q[0] * hu * uz + q[2] * hn * nz]);
  }
  for (let i = 0; i < 6; i++) {
    const f = FACE[i];
    const wx = f[4] * ux + f[6] * nx;
    const wy = f[5];
    const wz = f[4] * uz + f[6] * nz;
    const a = c[f[0]];
    const b = c[f[1]];
    const d = c[f[2]];
    const e = c[f[3]];
    const crx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
    const cry = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
    const crz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const tri = crx * wx + cry * wy + crz * wz >= 0 ? [a, b, d, a, d, e] : [a, d, b, a, e, d];
    for (let j = 0; j < 6; j++) {
      B.p.push(tri[j][0], tri[j][1], tri[j][2]);
      B.n.push(wx, wy, wz);
      if (col) B.c.push(col[0], col[1], col[2]);
    }
  }
  B.boxes += 1;
}

/** A box on a wall: from s0 to s1 along it, y0 to y1 up it, its middle `inset` into the room, `hn` half deep. */
function wallBox(B: BoxBuf, w: WorldWall, s0: number, s1: number, y0: number, y1: number, inset: number, hn: number, col?: Rgb): void {
  if (s1 - s0 < 0.006 || y1 - y0 < 0.006 || w.lengthM <= 0) return;
  const ux = (w.b.x - w.a.x) / w.lengthM;
  const uz = (w.b.y - w.a.y) / w.lengthM;
  const sm = (s0 + s1) / 2;
  pushBox(B, w.a.x + ux * sm + w.inward.x * inset, (y0 + y1) / 2, w.a.y + uz * sm + w.inward.y * inset, ux, uz, (s1 - s0) / 2, (y1 - y0) / 2, hn, col);
}

/** The band of stage colour is this far off the floor at its top, so it sits on the floor and under the baseboard's lip. */
export const FLOOR_BAND_TOP_M = 0.02;

/**
 * A flat band round a room's floor, just inside its walls: one long box per wall. The Realistic look draws it in the
 * room's stage colour (utils/livingModel/looks.ts), so the stage reads while the floor keeps its material. Each box
 * stops a wall's thickness short of the corner, so it never pokes through the next wall.
 */
export function buildFloorBand(room: PlacedRoom, widthM: number): BoxBuf {
  const B = newBuf();
  const w = Number.isFinite(widthM) && widthM > 0 ? widthM : 0;
  if (!w) return B;
  for (const wall of worldWalls(room)) wallBox(B, wall, WALL_T, wall.lengthM - WALL_T, 0.004, FLOOR_BAND_TOP_M, WALL_T + w / 2, w / 2);
  return B;
}

/** Walk a wall and call back for every solid piece, skipping the doors and windows. Pieces are at most `step` long. */
export function wallSpans(openings: readonly WorldOpening[], lengthM: number, H: number, step: number, fn: (s0: number, s1: number, y0: number, y1: number) => void): void {
  let cur = 0;
  const solid = (a: number, b: number) => { for (let s = a; s < b - 0.005; s += step) fn(s, Math.min(b, s + step), 0, H); };
  for (const o of openings) {
    if (o.s0 > cur) solid(cur, o.s0);
    if (o.y0 > 0) fn(o.s0, o.s1, 0, Math.min(o.y0, H));
    if (o.y1 < H) fn(o.s0, o.s1, o.y1, H);
    cur = Math.max(cur, o.s1);
  }
  if (cur < lengthM) solid(cur, lengthM);
}

const holeAt = (openings: readonly WorldOpening[], s: number): WorldOpening | null => openings.find((o) => s > o.s0 - 0.02 && s < o.s1 + 0.02) ?? null;

/** Ear clipping. Returns corner indices, three per triangle. An outline that cannot be cut comes back as far as it got. */
export function triangulate(poly: readonly { x: number; y: number }[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const q = poly[(i + 1) % n]; area += poly[i].x * q.y - q.x * poly[i].y; }
  const idx = poly.map((_, i) => i);
  if (area < 0) idx.reverse();
  const cross = (a: number, b: number, c: number) => (poly[b].x - poly[a].x) * (poly[c].y - poly[a].y) - (poly[b].y - poly[a].y) * (poly[c].x - poly[a].x);
  const inside = (a: number, b: number, c: number, p: number) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  const out: number[] = [];
  let guard = n * n + 8;
  while (idx.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(a, b, c, p))) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

const WET: readonly RoomKind[] = ['kitchen', 'bathroom', 'laundry'];

/** Pipes are drawn only in a kitchen, a bathroom or a laundry, on the longest wall. */
export const roomHasPipes = (kind: RoomKind): boolean => WET.includes(kind);

export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
  cutHeightM: DEFAULT_CUT_M,
  pipeCold: [0.18, 0.5, 0.72],
  pipeHot: [0.77, 0.33, 0.23],
  pipeDrain: [0.36, 0.42, 0.45],
};

/** The shapes for one room. */
export function buildRoomGeometry(room: PlacedRoom, options: Partial<SceneOptions> = {}): RoomGeometry {
  const o: SceneOptions = { ...DEFAULT_SCENE_OPTIONS, ...options };
  const full = roomHeightM(room) || 2.44;
  const H = o.cutHeightM != null ? Math.min(full, o.cutHeightM) : full;
  const walls = worldWalls(room);
  const T = WALL_T;

  // floor
  const floorPts = worldFloor(room);
  const floor: TriBuf = { p: [], n: [] };
  const tri = triangulate(floorPts);
  for (let i = 0; i + 2 < tri.length; i += 3) {
    const a = floorPts[tri[i]];
    const b = floorPts[tri[i + 1]];
    const c = floorPts[tri[i + 2]];
    // Wound so the face looks up (+Y) with x to X and plan y to Z.
    const up = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
    for (const q of up >= 0 ? [a, b, c] : [a, c, b]) { floor.p.push(q.x, 0, q.y); floor.n.push(0, 1, 0); }
  }

  const shell = newBuf();
  const skin = newBuf();
  const studs = newBuf();
  const pipes = newBuf();
  const wires = newBuf();
  const insulation = newBuf();
  const trim = newBuf();
  const glass = newBuf();

  // The longest wall; of two the same length, the one nearest the top left of the plan (the far side in the default view).
  const corner = (w: WorldWall): number => w.a.x + w.b.x + w.a.y + w.b.y;
  const pipeWall = roomHasPipes(room.kind) && walls.length
    ? walls.reduce((a, b) => (b.lengthM > a.lengthM + 0.01 || (Math.abs(b.lengthM - a.lengthM) <= 0.01 && corner(b) < corner(a)) ? b : a))
    : null;

  for (const w of walls) {
    const L = w.lengthM;
    const wallH = Math.min(H, w.heightM > 0 ? w.heightM : H);
    if (L <= 0 || wallH <= 0) continue;
    const op = w.openings;

    // The far face, always there, and the room-side surface, in pieces, each with holes for the doors and windows.
    wallSpans(op, L, wallH, 2.4, (s0, s1, y0, y1) => wallBox(shell, w, s0, s1, y0, y1, SHELL_T / 2, SHELL_T / 2));
    wallSpans(op, L, wallH, 1.2, (s0, s1, y0, y1) => wallBox(skin, w, s0, s1, y0, y1, T - SKIN_T / 2, SKIN_T / 2));

    // The frame: a bottom plate, studs, and the framing round each opening.
    wallSpans(op, L, 0.04, 2.4, (s0, s1, y0) => { if (y0 === 0) wallBox(studs, w, s0, s1, 0, 0.04, T / 2, T / 2 - 0.018); });
    for (let s = 0.02; s < L; s += STUD_GAP) {
      const hole = holeAt(op, s);
      let top = wallH;
      if (hole) { if (hole.y0 <= 0) continue; top = Math.min(hole.y0, wallH); }
      wallBox(studs, w, s - 0.019, s + 0.019, 0.04, top - 0.01, T / 2, T / 2 - 0.018);
    }
    for (const h of op) {
      wallBox(studs, w, h.s0 - 0.045, h.s0 - 0.005, 0.04, wallH - 0.01, T / 2, T / 2 - 0.018);
      wallBox(studs, w, h.s1 + 0.005, h.s1 + 0.045, 0.04, wallH - 0.01, T / 2, T / 2 - 0.018);
      if (h.y1 < wallH - 0.02) wallBox(studs, w, h.s0, h.s1, h.y1, Math.min(wallH - 0.01, h.y1 + 0.14), T / 2, T / 2 - 0.018);
      if (h.y0 > 0) wallBox(studs, w, h.s0, h.s1, Math.max(0, h.y0 - 0.045), h.y0, T / 2, T / 2 - 0.018);
    }

    // Wires: one run along the wall with drops to boxes.
    const runY = Math.min(0.95, wallH - 0.08);
    if (runY > 0.3) {
      wallSpans(op, L, 1, 0.6, (s0, s1, y0) => { if (y0 === 0 && !holeAt(op, (s0 + s1) / 2)) wallBox(wires, w, s0, s1, runY, runY + 0.035, T * 0.78, 0.016); });
      for (let s = 0.7; s < L - 0.3; s += 1.6) {
        if (holeAt(op, s)) continue;
        wallBox(wires, w, s - 0.015, s + 0.015, 0.4, runY, T * 0.78, 0.016);
        wallBox(wires, w, s - 0.06, s + 0.06, 0.3, 0.46, T * 0.78, 0.022);
      }
    }

    // Pipes: a drain, a cold line and a hot line on one wall of a wet room.
    if (pipeWall && w.id === pipeWall.id) {
      for (let s = 0.15; s < L - 0.15; s += 0.6) {
        const e = Math.min(L - 0.15, s + 0.6);
        if (holeAt(op, (s + e) / 2)) continue;
        wallBox(pipes, w, s, e, 0.15, 0.22, T * 0.7, 0.03, o.pipeDrain);
        if (wallH > 0.62) wallBox(pipes, w, s, e, 0.52, 0.57, T * 0.75, 0.021, o.pipeCold);
        if (wallH > 0.78) wallBox(pipes, w, s, e, 0.67, 0.72, T * 0.75, 0.021, o.pipeHot);
      }
      for (let s = 0.45; s < L - 0.3; s += 1.2) {
        if (holeAt(op, s)) continue;
        if (wallH > 0.62) wallBox(pipes, w, s, s + 0.05, 0.52, Math.min(wallH - 0.02, 1.0), T * 0.75, 0.021, o.pipeCold);
        if (wallH > 0.78) wallBox(pipes, w, s + 0.12, s + 0.17, 0.67, Math.min(wallH - 0.02, 1.0), T * 0.75, 0.021, o.pipeHot);
      }
    }

    // Batts between the studs.
    for (let s = 0.045; s < L - 0.06; s += STUD_GAP) {
      const e = Math.min(L - 0.02, s + STUD_GAP - 0.05);
      const hole = holeAt(op, (s + e) / 2);
      let top = wallH;
      if (hole) { if (hole.y0 <= 0) continue; top = Math.min(hole.y0, wallH); }
      wallBox(insulation, w, s, e, 0.04, top, T * 0.42, T * 0.24);
    }

    // Baseboard, skipping doors. A door leaf standing a little open.
    wallSpans(op, L, 0.1, 1.2, (s0, s1, y0) => { if (y0 === 0 && !holeAt(op, (s0 + s1) / 2)) wallBox(trim, w, s0, s1, 0, 0.1, T + 0.011, 0.011); });
    for (const h of op) {
      if (h.kind === 'window') {
        if (h.y0 < wallH) wallBox(glass, w, h.s0, h.s1, h.y0, Math.min(wallH, h.y1), T / 2, 0.01);
        continue;
      }
      if (h.kind !== 'door') continue;
      const ux = (w.b.x - w.a.x) / L;
      const uz = (w.b.y - w.a.y) / L;
      const ang = 1.05;
      const rx = ux * Math.cos(ang) + w.inward.x * Math.sin(ang);
      const rz = uz * Math.cos(ang) + w.inward.y * Math.sin(ang);
      const hx = w.a.x + ux * h.s0 + w.inward.x * T;
      const hz = w.a.y + uz * h.s0 + w.inward.y * T;
      const width = h.s1 - h.s0;
      const leafH = Math.min(h.y1, wallH);
      pushBox(trim, hx + (rx * width) / 2, leafH / 2, hz + (rz * width) / 2, rx, rz, width / 2, leafH / 2, 0.02);
    }
  }

  const c = roomCentre(room) ?? { x: 0, y: 0 };
  return { roomId: room.id, heightM: H, centre: { x: c.x, z: c.y }, floor, shell, skin, studs, pipes, wires, insulation, trim, glass };
}

/**
 * Which corners of a layer to draw solid and which faint, for a layer that is
 * `solid` done and planned to be `ghost` done (both 0 to 1). The faint part
 * always starts where the solid part ends, so the two never cover each other.
 */
export function revealRange(boxes: number, solid: number, ghost: number): { solidCount: number; ghostStart: number; ghostCount: number } {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  const a = Math.round(clamp(solid) * boxes) * VERTS_PER_BOX;
  const b = Math.round(Math.max(clamp(solid), clamp(ghost)) * boxes) * VERTS_PER_BOX;
  return { solidCount: a, ghostStart: a, ghostCount: b - a };
}

/** The camera's box: how wide the scene is, so the default view fits it. */
export function fitSpan(bounds: { minX: number; minY: number; maxX: number; maxY: number } | null): { cx: number; cz: number; span: number } {
  if (!bounds) return { cx: 0, cz: 0, span: 8 };
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxY - bounds.minY;
  return { cx: (bounds.minX + bounds.maxX) / 2, cz: (bounds.minY + bounds.maxY) / 2, span: Math.max(4, Math.hypot(w, d)) };
}

/**
 * How much of the world the camera has to show, at one angle, so the whole
 * model sits inside the frame: the floor box AND the walls standing on it.
 * `halfW` runs across the screen and `halfH` up it, both in metres, measured
 * from the middle of the walls. Full-height walls stand taller than cut ones,
 * so they ask for more room; the camera pulls back by exactly that much.
 *
 * `azimuth` and `elevation` are the camera's angles in radians (elevation 0
 * looks along the floor, a quarter turn looks straight down).
 */
export function viewExtent(
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  wallHeightM: number,
  azimuth: number,
  elevation: number,
): { halfW: number; halfH: number } {
  const w = bounds ? Math.max(0, bounds.maxX - bounds.minX) : 4;
  const d = bounds ? Math.max(0, bounds.maxY - bounds.minY) : 4;
  const h = Number.isFinite(wallHeightM) && wallHeightM > 0 ? wallHeightM : 0;
  const ca = Math.abs(Math.cos(azimuth));
  const sa = Math.abs(Math.sin(azimuth));
  const ce = Math.abs(Math.cos(elevation));
  const se = Math.abs(Math.sin(elevation));
  return {
    halfW: Math.max(1, (ca * w + sa * d) / 2),
    halfH: Math.max(1, (se * (sa * w + ca * d)) / 2 + (ce * h) / 2),
  };
}

/** The share of the frame the model may fill at the home view; the rest is margin for the corner card and the buttons. */
export const VIEW_FILL = 0.84;

/** Pixels per metre at the home view, so `viewExtent` fits a canvas of the given size with the margin above. */
export function fitZoom(extent: { halfW: number; halfH: number }, widthPx: number, heightPx: number): number {
  const z = Math.min(widthPx / (extent.halfW * 2), heightPx / (extent.halfH * 2)) * VIEW_FILL;
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** Where one point of the world lands on the canvas, in pixels from its middle, at a camera angle and zoom. For checking a fit as numbers. */
export function screenPoint(p: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, azimuth: number, elevation: number, zoom: number): { x: number; y: number } {
  const dx = p.x - target.x;
  const dy = p.y - target.y;
  const dz = p.z - target.z;
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  return { x: (ca * dx - sa * dz) * zoom, y: (-se * sa * dx + ce * dy - se * ca * dz) * zoom };
}

/**
 * How much room a label has across a room as it is drawn: the length, in
 * pixels, of the level line through the middle of the room's floor on the
 * canvas. `u` and `v` are the floor's two half-sides as drawn (from the middle
 * of the room to the middle of a side, in canvas pixels). A room seen at an
 * angle is a slanted box, and its box on the canvas is far wider than the
 * strip a label can sit on; this is the strip.
 */
export function labelRoomPx(u: { x: number; y: number }, v: { x: number; y: number }): number {
  let best = 0;
  const tryPoint = (a: number, b: number): void => { if (Math.abs(a) <= 1 + 1e-9 && Math.abs(b) <= 1 + 1e-9) best = Math.max(best, Math.abs(a * u.x + b * v.x)); };
  // Where the level line through the middle leaves the box: on a side where a = 1 or where b = 1 (the other two are its mirror).
  if (Math.abs(v.y) > 1e-9) tryPoint(1, -u.y / v.y); else tryPoint(1, 1);
  if (Math.abs(u.y) > 1e-9) tryPoint(-v.y / u.y, 1); else tryPoint(1, 1);
  if (Math.abs(u.y) <= 1e-9 && Math.abs(v.y) <= 1e-9) best = Math.abs(u.x) + Math.abs(v.x);
  const out = best * 2;
  return Number.isFinite(out) ? out : 0;
}

/**
 * How big a room's label may be, from how much room it has (`labelRoomPx`).
 *   'full'  the name and the stage line;
 *   'name'  the name alone (the stage line would spill over the next room);
 *   'dot'   a small dot in the stage colour (even the name would not fit).
 * The selected room and the room under the pointer always show 'full'.
 */
export type PinSize = 'full' | 'name' | 'dot';
export const PIN_FULL_PX = 150;
export const PIN_NAME_PX = 84;
export function pinSize(roomPx: number, emphasised: boolean): PinSize {
  if (emphasised) return 'full';
  if (!Number.isFinite(roomPx)) return 'name';
  if (roomPx >= PIN_FULL_PX) return 'full';
  return roomPx >= PIN_NAME_PX ? 'name' : 'dot';
}

/**
 * THE PAGE STILL SCROLLS. The wheel zooms the model only when the person has
 * clicked it (the canvas has focus) or is holding Ctrl or Cmd; any other wheel
 * belongs to the page.
 */
export function wheelShouldZoom(e: { ctrlKey?: boolean; metaKey?: boolean }, canvasHasFocus: boolean): boolean {
  return e.ctrlKey === true || e.metaKey === true || canvasHasFocus === true;
}

/**
 * On a narrow screen one finger belongs to the page (it scrolls) and the model
 * moves only with two. A mouse or a pen always turns the model, and so does one
 * finger on a wide screen, where the view does not sit in a scrolling column.
 */
export function oneFingerTurnsModel(pointerType: string, narrowScreen: boolean): boolean {
  return !(pointerType === 'touch' && narrowScreen);
}

/** The CSS touch-action for the canvas: on a narrow screen the browser keeps the up and down swipe for the page. */
export function canvasTouchAction(narrowScreen: boolean): 'pan-y' | 'none' {
  return narrowScreen ? 'pan-y' : 'none';
}
