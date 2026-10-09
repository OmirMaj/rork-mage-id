// utils/livingModel/modelCore.ts — build, place, check and edit a job model (pure).
//
// The Living Model, Phase 1. No React, no storage, no clock: every function
// takes what it needs and returns a new model. Ids and timestamps are handed
// in by the caller, so a test gets the same answer every time.
//
// WHAT IS A FACT HERE AND WHAT IS NOT. A typed room is exactly the rectangle
// the person typed. A scanned room is the scanner's model, turned over once so
// it draws the right way up, and nothing else is changed. The app never moves,
// resizes or links a room by itself.

import { polygonArea } from '@/utils/roomScan/geometryCore';
import type { Pt, RoomScan, RoomType, ScanOpening, ScanWall } from '@/utils/roomScan/types';
import { feetToMetres } from '@/utils/roomScan/units';
import type {
  Bounds, JobModel, ModelCheck, ModelIssue, PlacedRoom, Placement, QuarterTurn, RoomKind, RoomShape,
  WorldOpening, WorldWall,
} from './types';

/** The editor's snap: six inches. */
export const GRID_M = feetToMetres(0.5);
/** The lines the editor draws: one foot. */
export const GRID_LINE_M = feetToMetres(1);
/** A typed room is refused outside these sizes (a slip of the finger, not a room). */
export const MIN_ROOM_SIDE_M = feetToMetres(2);
export const MAX_ROOM_SIDE_M = feetToMetres(200);
export const MIN_CEILING_M = feetToMetres(4);
export const MAX_CEILING_M = feetToMetres(40);
/** A door or window keeps this much wall either side of it. */
export const OPENING_EDGE_M = feetToMetres(0.25);
export const MIN_OPENING_M = feetToMetres(1);
export const DOOR_HEIGHT_M = feetToMetres(6 + 8 / 12);
export const WINDOW_HEIGHT_M = feetToMetres(4);
export const WINDOW_SILL_M = feetToMetres(3);
/** Two rooms may touch. They overlap when they share more floor than this. */
export const TOUCH_TOL_M = 0.01;
export const MAX_ROOMS = 60;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function emptyJobModel(projectId: string): JobModel {
  return { version: 1, projectId, rooms: [], links: {}, updatedAt: '' };
}

export const snapM = (v: number): number => Math.round(v / GRID_M) * GRID_M;

// ── making rooms ─────────────────────────────────────────────────────────────

export interface RectRoomInput {
  id: string;
  name: string;
  kind: RoomKind;
  widthM: number;
  lengthM: number;
  heightM: number;
  level?: number;
  placement?: Partial<Placement>;
}

export type RectRoomRefusal = 'name_missing' | 'bad_width' | 'bad_length' | 'bad_height';

/** Why a typed room cannot be made, or null when it can. */
export function rectRoomRefusal(input: Pick<RectRoomInput, 'name' | 'widthM' | 'lengthM' | 'heightM'>): RectRoomRefusal | null {
  if (!input.name.trim()) return 'name_missing';
  if (!finite(input.widthM) || input.widthM < MIN_ROOM_SIDE_M || input.widthM > MAX_ROOM_SIDE_M) return 'bad_width';
  if (!finite(input.lengthM) || input.lengthM < MIN_ROOM_SIDE_M || input.lengthM > MAX_ROOM_SIDE_M) return 'bad_length';
  if (!finite(input.heightM) || input.heightM < MIN_CEILING_M || input.heightM > MAX_CEILING_M) return 'bad_height';
  return null;
}

/**
 * A rectangular room from typed sizes, in the scanner's own shape. Width runs
 * along x, length along y. Walls go round the outline in order: top, right,
 * bottom, left. Every length says it was typed.
 */
export function makeRectRoom(input: RectRoomInput): PlacedRoom {
  const refusal = rectRoomRefusal(input);
  if (refusal) throw new Error(`makeRectRoom: ${refusal}`);
  const { id, widthM: w, lengthM: l, heightM: h } = input;
  const corners: Pt[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }];
  const walls: ScanWall[] = corners.map((a, i) => {
    const b = corners[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      id: `${id}-w${i + 1}`, label: `Wall ${i + 1}`, a: { ...a }, b: { ...b },
      lengthM: len, scanLengthM: len, lengthSource: 'typed', heightM: h,
      confidence: 'high', curved: false, onOutline: true,
    };
  });
  return {
    id,
    name: input.name.trim(),
    kind: input.kind,
    level: input.level ?? 0,
    placement: { xM: input.placement?.xM ?? 0, yM: input.placement?.yM ?? 0, rotationDeg: input.placement?.rotationDeg ?? 0 },
    source: 'typed',
    room: {
      walls,
      openings: [],
      objects: [],
      floor: corners.map((c) => ({ ...c })),
      ceilingHeightM: { known: true, min: h, max: h, typical: h, source: 'typed' },
    },
  };
}

const KIND_FROM_SCAN: Record<RoomType, RoomKind> = { bathroom: 'bathroom', kitchen: 'kitchen', bedroom: 'bedroom', room: 'other' };

/**
 * A saved scan dropped into the job as a placed room. The scan's own numbers
 * are kept; the only change is the move from the scanner's axes (y up, any
 * origin) to drawing axes (y down, the room's box starting at 0, 0), so the
 * room is not drawn mirrored. Wall lengths, heights, openings and their
 * offsets are untouched.
 */
export function roomFromScan(scan: RoomScan, opts: { id: string; level?: number; placement?: Partial<Placement> }): PlacedRoom {
  const pts: Pt[] = [];
  for (const w of scan.walls) pts.push(w.a, w.b);
  for (const p of scan.floor) pts.push(p);
  for (const o of scan.objects) pts.push(o.center);
  const good = pts.filter((p) => finite(p.x) && finite(p.y));
  const minX = good.length ? Math.min(...good.map((p) => p.x)) : 0;
  const maxY = good.length ? Math.max(...good.map((p) => p.y)) : 0;
  const turn = (p: Pt): Pt => ({ x: p.x - minX, y: maxY - p.y });
  const room: RoomShape = {
    walls: scan.walls.map((w) => ({ ...w, a: turn(w.a), b: turn(w.b), polygon: w.polygon ? w.polygon.map((q) => ({ ...q })) : undefined })),
    openings: scan.openings.map((o) => ({ ...o })),
    objects: scan.objects.map((o) => ({ ...o, center: turn(o.center), rotationRad: -o.rotationRad })),
    floor: scan.floor.map(turn),
    ceilingHeightM: { ...scan.ceilingHeightM },
  };
  return {
    id: opts.id,
    name: scan.name,
    kind: KIND_FROM_SCAN[scan.roomType] ?? 'other',
    level: opts.level ?? 0,
    placement: { xM: opts.placement?.xM ?? 0, yM: opts.placement?.yM ?? 0, rotationDeg: opts.placement?.rotationDeg ?? 0 },
    source: 'scan',
    scanId: scan.id,
    room,
  };
}

// ── from a room's own axes to the floor ──────────────────────────────────────

function rotate(p: Pt, deg: QuarterTurn): Pt {
  switch (deg) {
    case 90: return { x: -p.y, y: p.x };
    case 180: return { x: -p.x, y: -p.y };
    case 270: return { x: p.y, y: -p.x };
    default: return { x: p.x, y: p.y };
  }
}

function localPoints(room: RoomShape): Pt[] {
  const pts: Pt[] = [];
  for (const w of room.walls) pts.push(w.a, w.b);
  for (const p of room.floor) pts.push(p);
  return pts;
}

/** The function that carries a point from the room's own axes to the floor. */
export function placer(r: PlacedRoom): (p: Pt) => Pt {
  const deg = r.placement.rotationDeg;
  const turned = localPoints(r.room).map((p) => rotate(p, deg)).filter((p) => finite(p.x) && finite(p.y));
  const minX = turned.length ? Math.min(...turned.map((p) => p.x)) : 0;
  const minY = turned.length ? Math.min(...turned.map((p) => p.y)) : 0;
  const dx = r.placement.xM - minX;
  const dy = r.placement.yM - minY;
  return (p: Pt) => {
    const q = rotate(p, deg);
    return { x: q.x + dx, y: q.y + dy };
  };
}

/** The floor outline on the floor it sits on. Empty when the room has no closed outline. */
export function worldFloor(r: PlacedRoom): Pt[] {
  const place = placer(r);
  return r.room.floor.map(place);
}

export function roomHeightM(r: PlacedRoom): number {
  const c = r.room.ceilingHeightM;
  if (c.known && finite(c.typical) && c.typical > 0) return c.typical;
  const hs = r.room.walls.map((w) => w.heightM).filter((h) => finite(h) && h > 0);
  return hs.length ? Math.max(...hs) : 0;
}

/** Every wall on the floor, with its doors and windows as holes along it, and which side is the room. */
export function worldWalls(r: PlacedRoom): WorldWall[] {
  const place = placer(r);
  const floor = r.room.floor.map(place);
  const pts = (floor.length ? floor : r.room.walls.flatMap((w) => [place(w.a), place(w.b)]));
  const cx = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length);
  const cy = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
  const fallbackH = roomHeightM(r);
  return r.room.walls.map((w) => {
    const a = place(w.a);
    const b = place(w.b);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = len > 0 ? (b.x - a.x) / len : 1;
    const uy = len > 0 ? (b.y - a.y) / len : 0;
    // The two normals; the inward one is the side a point just off the wall's middle lands inside the floor on.
    let nx = -uy;
    let ny = ux;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const probe = 0.05;
    const inside = floor.length >= 3
      ? pointInPolygon({ x: mx + nx * probe, y: my + ny * probe }, floor)
      : (cx - mx) * nx + (cy - my) * ny > 0;
    if (!inside) { nx = -nx; ny = -ny; }
    const h = finite(w.heightM) && w.heightM > 0 ? w.heightM : fallbackH;
    const openings: WorldOpening[] = r.room.openings
      .filter((o) => o.wallId === w.id)
      .map((o) => {
        const s0 = Math.max(0, Math.min(len, o.offsetM));
        const s1 = Math.max(s0, Math.min(len, o.offsetM + o.widthM));
        const y0 = Math.max(0, o.sillM);
        const y1 = Math.max(y0, Math.min(h > 0 ? h : y0 + o.heightM, y0 + o.heightM));
        return { id: o.id, kind: o.kind, s0, s1, y0, y1 };
      })
      .filter((o) => o.s1 - o.s0 > 0.01)
      .sort((p, q) => p.s0 - q.s0);
    return { id: w.id, label: w.label, a, b, lengthM: len, heightM: h, inward: { x: nx, y: ny }, openings };
  });
}

// ── measuring ────────────────────────────────────────────────────────────────

/** Floor area in square metres, or null when the room has no closed outline (no area is ever given for an open loop). */
export function roomAreaM2(r: PlacedRoom): number | null {
  if (r.room.floor.length < 3) return null;
  const a = polygonArea(r.room.floor);
  return finite(a) ? a : null;
}

export function roomBounds(r: PlacedRoom): Bounds | null {
  const place = placer(r);
  const pts = localPoints(r.room).map(place).filter((p) => finite(p.x) && finite(p.y));
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** The box around every room on one floor, or on all floors when `level` is left out. null for an empty model. */
export function modelBounds(model: JobModel, level?: number): Bounds | null {
  let out: Bounds | null = null;
  for (const r of model.rooms) {
    if (level !== undefined && r.level !== level) continue;
    const b = roomBounds(r);
    if (!b) continue;
    out = out
      ? { minX: Math.min(out.minX, b.minX), minY: Math.min(out.minY, b.minY), maxX: Math.max(out.maxX, b.maxX), maxY: Math.max(out.maxY, b.maxY) }
      : b;
  }
  return out;
}

/** The floors that have a room on them, lowest first. */
export function modelLevels(model: JobModel): number[] {
  return Array.from(new Set(model.rooms.map((r) => r.level))).sort((a, b) => a - b);
}

/** A point for a room's label: the middle of its box. */
export function roomCentre(r: PlacedRoom): Pt | null {
  const b = roomBounds(r);
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}

// ── geometry helpers ─────────────────────────────────────────────────────────

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function strictlyInside(p: Pt, poly: readonly Pt[], tol: number): boolean {
  if (!pointInPolygon(p, poly)) return false;
  for (let i = 0; i < poly.length; i++) {
    if (distToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return false;
  }
  return true;
}

function properCross(a: Pt, b: Pt, c: Pt, d: Pt, tol: number): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const scale = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - c.x, d.y - c.y), 1e-9);
  const e = tol * scale;
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

function centroid(poly: readonly Pt[]): Pt {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

/** True when two floor outlines share floor. Sharing an edge or a corner is touching, not overlapping. */
export function polygonsOverlap(p: readonly Pt[], q: readonly Pt[], tol: number = TOUCH_TOL_M): boolean {
  if (p.length < 3 || q.length < 3) return false;
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      if (properCross(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length], tol)) return true;
    }
  }
  const probes = (poly: readonly Pt[]): Pt[] => {
    const out: Pt[] = [...poly];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    const c = centroid(poly);
    if (pointInPolygon(c, poly)) out.push(c);
    return out;
  };
  return probes(p).some((pt) => strictlyInside(pt, q, tol)) || probes(q).some((pt) => strictlyInside(pt, p, tol));
}

/** The room whose floor a point lands on, top of the list last drawn so last hit wins. null when it lands on none. */
export function roomAtPoint(model: JobModel, level: number, p: Pt): PlacedRoom | null {
  for (let i = model.rooms.length - 1; i >= 0; i--) {
    const r = model.rooms[i];
    if (r.level !== level) continue;
    const floor = worldFloor(r);
    if (floor.length >= 3 ? pointInPolygon(p, floor) : inBounds(roomBounds(r), p)) return r;
  }
  return null;
}

const inBounds = (b: Bounds | null, p: Pt): boolean => !!b && p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** The wall of one room nearest a point, with how far along it the point falls. null when none is within `reachM`. */
export function wallNearPoint(r: PlacedRoom, p: Pt, reachM: number): { wallId: string; alongM: number } | null {
  let best: { wallId: string; alongM: number; d: number } | null = null;
  for (const w of worldWalls(r)) {
    const d = distToSegment(p, w.a, w.b);
    if (d > reachM) continue;
    const ux = (w.b.x - w.a.x) / (w.lengthM || 1);
    const uy = (w.b.y - w.a.y) / (w.lengthM || 1);
    const along = Math.max(0, Math.min(w.lengthM, (p.x - w.a.x) * ux + (p.y - w.a.y) * uy));
    if (!best || d < best.d) best = { wallId: w.id, alongM: along, d };
  }
  return best ? { wallId: best.wallId, alongM: best.alongM } : null;
}

// ── checking ─────────────────────────────────────────────────────────────────

function roomNumbers(r: PlacedRoom): number[] {
  const n: number[] = [r.placement.xM, r.placement.yM, r.placement.rotationDeg, r.level];
  for (const w of r.room.walls) n.push(w.a.x, w.a.y, w.b.x, w.b.y, w.lengthM, w.heightM);
  for (const o of r.room.openings) n.push(o.offsetM, o.widthM, o.heightM, o.sillM);
  for (const p of r.room.floor) n.push(p.x, p.y);
  return n;
}

/**
 * Check a whole job model. Errors stop a drawing: a number that is not a
 * number, two rooms with one id, a room with no walls. Warnings do not: an
 * outline that does not close, a missing ceiling height, an opening off its
 * wall, a link to a room that is gone, and two rooms on one floor that
 * overlap. Rooms that only touch are fine and are not mentioned.
 */
export function validateModel(model: JobModel): ModelCheck {
  const errors: ModelIssue[] = [];
  const warnings: ModelIssue[] = [];
  const seen = new Set<string>();
  const sound: PlacedRoom[] = [];
  for (const r of model.rooms) {
    if (seen.has(r.id)) errors.push({ code: 'duplicate_room_id', level: 'error', roomIds: [r.id] });
    seen.add(r.id);
    if (roomNumbers(r).some((v) => !finite(v))) { errors.push({ code: 'not_a_number', level: 'error', roomIds: [r.id] }); continue; }
    if (r.room.walls.length === 0) { errors.push({ code: 'no_walls', level: 'error', roomIds: [r.id] }); continue; }
    sound.push(r);
    if (!r.name.trim()) warnings.push({ code: 'name_missing', level: 'warning', roomIds: [r.id] });
    if (r.room.floor.length < 3) warnings.push({ code: 'outline_open', level: 'warning', roomIds: [r.id] });
    if (!(roomHeightM(r) > 0)) warnings.push({ code: 'ceiling_missing', level: 'warning', roomIds: [r.id] });
    const wallById = new Map(r.room.walls.map((w) => [w.id, w]));
    const off = r.room.openings.some((o) => {
      const w = o.wallId ? wallById.get(o.wallId) : undefined;
      return !w || o.offsetM < -1e-6 || o.widthM <= 0 || o.offsetM + o.widthM > w.lengthM + 1e-6;
    });
    if (off) warnings.push({ code: 'opening_off_wall', level: 'warning', roomIds: [r.id] });
  }
  for (let i = 0; i < sound.length; i++) {
    for (let j = i + 1; j < sound.length; j++) {
      if (sound[i].level !== sound[j].level) continue;
      if (polygonsOverlap(worldFloor(sound[i]), worldFloor(sound[j]))) {
        warnings.push({ code: 'rooms_overlap', level: 'warning', roomIds: [sound[i].id, sound[j].id] });
      }
    }
  }
  for (const roomId of Object.keys(model.links)) {
    if (!seen.has(roomId)) warnings.push({ code: 'link_to_missing_room', level: 'warning', roomIds: [roomId] });
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ── editing (each returns a new model; none is called except from a tap) ─────

const withRooms = (model: JobModel, rooms: PlacedRoom[]): JobModel => ({ ...model, rooms });
const mapRoom = (model: JobModel, roomId: string, fn: (r: PlacedRoom) => PlacedRoom): JobModel =>
  withRooms(model, model.rooms.map((r) => (r.id === roomId ? fn(r) : r)));

/** Where a new room goes: to the right of everything on that floor, one grid step clear, so it never lands on another room. */
export function nextFreeSpot(model: JobModel, level: number): { xM: number; yM: number } {
  const b = modelBounds(model, level);
  if (!b) return { xM: 0, yM: 0 };
  return { xM: snapM(b.maxX + GRID_M * 2), yM: snapM(b.minY) };
}

export function addRoom(model: JobModel, room: PlacedRoom): JobModel {
  if (model.rooms.length >= MAX_ROOMS || model.rooms.some((r) => r.id === room.id)) return model;
  return withRooms(model, [...model.rooms, room]);
}

/** Move a room so its top left corner sits at a snapped spot. */
export function moveRoom(model: JobModel, roomId: string, xM: number, yM: number): JobModel {
  if (!finite(xM) || !finite(yM)) return model;
  return mapRoom(model, roomId, (r) => ({ ...r, placement: { ...r.placement, xM: snapM(xM), yM: snapM(yM) } }));
}

export function nudgeRoom(model: JobModel, roomId: string, dxSteps: number, dySteps: number): JobModel {
  const r = model.rooms.find((x) => x.id === roomId);
  if (!r) return model;
  return moveRoom(model, roomId, r.placement.xM + dxSteps * GRID_M, r.placement.yM + dySteps * GRID_M);
}

/** Turn a room a quarter turn clockwise. Its top left corner stays where it is. */
export function rotateRoom(model: JobModel, roomId: string): JobModel {
  return mapRoom(model, roomId, (r) => ({ ...r, placement: { ...r.placement, rotationDeg: (((r.placement.rotationDeg + 90) % 360) as QuarterTurn) } }));
}

export function renameRoom(model: JobModel, roomId: string, name: string): JobModel {
  const clean = name.trim();
  if (!clean) return model;
  return mapRoom(model, roomId, (r) => ({ ...r, name: clean }));
}

export function setRoomKind(model: JobModel, roomId: string, kind: RoomKind): JobModel {
  return mapRoom(model, roomId, (r) => ({ ...r, kind }));
}

export function setRoomLevel(model: JobModel, roomId: string, level: number): JobModel {
  if (!Number.isInteger(level)) return model;
  return mapRoom(model, roomId, (r) => ({ ...r, level }));
}

/** Remove a room and every task ticked for it. */
export function deleteRoom(model: JobModel, roomId: string): JobModel {
  if (!model.rooms.some((r) => r.id === roomId)) return model;
  const links = { ...model.links };
  delete links[roomId];
  return { ...model, rooms: model.rooms.filter((r) => r.id !== roomId), links };
}

/**
 * A copy of a room beside the original. The copy gets a new id and new wall
 * and opening ids. It does NOT get the original's ticked tasks: which tasks
 * happen in a room is for the person to say, room by room.
 */
export function duplicateRoom(model: JobModel, roomId: string, newId: string, newName: string): JobModel {
  const src = model.rooms.find((r) => r.id === roomId);
  if (!src || model.rooms.length >= MAX_ROOMS || model.rooms.some((r) => r.id === newId)) return model;
  const wallIds = new Map(src.room.walls.map((w, i) => [w.id, `${newId}-w${i + 1}`]));
  const b = roomBounds(src);
  const copy: PlacedRoom = {
    ...src,
    id: newId,
    name: newName.trim() || src.name,
    placement: { ...src.placement, xM: snapM((b ? b.maxX : src.placement.xM) + GRID_M * 2) },
    room: {
      walls: src.room.walls.map((w) => ({ ...w, id: wallIds.get(w.id) as string, a: { ...w.a }, b: { ...w.b } })),
      openings: src.room.openings.map((o, i) => ({ ...o, id: `${newId}-o${i + 1}`, wallId: o.wallId ? wallIds.get(o.wallId) ?? null : null })),
      objects: src.room.objects.map((o, i) => ({ ...o, id: `${newId}-f${i + 1}`, center: { ...o.center } })),
      floor: src.room.floor.map((p) => ({ ...p })),
      ceilingHeightM: { ...src.room.ceilingHeightM },
    },
  };
  return withRooms(model, [...model.rooms, copy]);
}

export type OpeningRefusal = 'no_wall' | 'too_narrow' | 'wider_than_wall' | 'no_room_left';

export interface AddOpeningInput {
  roomId: string;
  wallId: string;
  id: string;
  kind: 'door' | 'window';
  widthM: number;
  /** Where along the wall its middle goes. Left out, it is centred. */
  centreAlongM?: number;
}

function freeSpot(wall: ScanWall, openings: ScanOpening[], widthM: number, wantStart: number): number | null {
  const lo = OPENING_EDGE_M;
  const hi = wall.lengthM - OPENING_EDGE_M - widthM;
  if (hi < lo - 1e-9) return null;
  const taken = openings.filter((o) => o.wallId === wall.id).map((o) => [o.offsetM, o.offsetM + o.widthM] as const).sort((p, q) => p[0] - q[0]);
  const clear = (s: number) => taken.every(([a, b]) => s + widthM <= a + 1e-9 || s >= b - 1e-9);
  const want = Math.max(lo, Math.min(hi, wantStart));
  if (clear(want)) return want;
  // The nearest clear start: just before or just after each opening already there.
  const tries: number[] = [];
  for (const [a, b] of taken) tries.push(a - widthM, b);
  const ok = tries.filter((s) => s >= lo - 1e-9 && s <= hi + 1e-9 && clear(s)).sort((p, q) => Math.abs(p - want) - Math.abs(q - want));
  return ok.length ? ok[0] : null;
}

/** Why a door or window cannot go on that wall, or null when it can. */
export function openingRefusal(model: JobModel, input: Omit<AddOpeningInput, 'id'>): OpeningRefusal | null {
  const r = model.rooms.find((x) => x.id === input.roomId);
  const wall = r?.room.walls.find((w) => w.id === input.wallId);
  if (!r || !wall) return 'no_wall';
  if (!finite(input.widthM) || input.widthM < MIN_OPENING_M) return 'too_narrow';
  if (input.widthM > wall.lengthM - OPENING_EDGE_M * 2 + 1e-9) return 'wider_than_wall';
  const want = (input.centreAlongM ?? wall.lengthM / 2) - input.widthM / 2;
  return freeSpot(wall, r.room.openings, input.widthM, want) === null ? 'no_room_left' : null;
}

/** Add a door or a window to a wall. The width is the typed one; the height and sill are the usual ones and are held under the ceiling. */
export function addOpening(model: JobModel, input: AddOpeningInput): JobModel {
  if (openingRefusal(model, input)) return model;
  return mapRoom(model, input.roomId, (r) => {
    const wall = r.room.walls.find((w) => w.id === input.wallId) as ScanWall;
    const start = freeSpot(wall, r.room.openings, input.widthM, (input.centreAlongM ?? wall.lengthM / 2) - input.widthM / 2) as number;
    const ceiling = roomHeightM(r) || wall.heightM || DOOR_HEIGHT_M;
    const sill = input.kind === 'window' ? Math.min(WINDOW_SILL_M, Math.max(0, ceiling - feetToMetres(2))) : 0;
    const height = Math.max(0.3, Math.min(input.kind === 'window' ? WINDOW_HEIGHT_M : DOOR_HEIGHT_M, ceiling - sill - feetToMetres(0.5)));
    const opening: ScanOpening = {
      id: input.id, kind: input.kind, wallId: wall.id, offsetM: start, widthM: input.widthM,
      heightM: height, sillM: sill, confidence: 'high', widthSource: 'typed', heightSource: 'typed',
    };
    return { ...r, room: { ...r.room, openings: [...r.room.openings, opening] } };
  });
}

export function removeOpening(model: JobModel, roomId: string, openingId: string): JobModel {
  return mapRoom(model, roomId, (r) => ({ ...r, room: { ...r.room, openings: r.room.openings.filter((o) => o.id !== openingId) } }));
}

// ── the links a person ticked ────────────────────────────────────────────────

/** Tick or untick one task for one room. Called only from a tap on that tick. */
export function setRoomTaskLink(model: JobModel, roomId: string, taskId: string, on: boolean): JobModel {
  if (!model.rooms.some((r) => r.id === roomId)) return model;
  const now = model.links[roomId] ?? [];
  const has = now.includes(taskId);
  if (on === has) return model;
  const next = on ? [...now, taskId] : now.filter((t) => t !== taskId);
  const links = { ...model.links };
  if (next.length) links[roomId] = next; else delete links[roomId];
  return { ...model, links };
}

/** The task ids ticked for a room. Never a suggestion. */
export function linkedTaskIds(model: JobModel, roomId: string): string[] {
  return model.links[roomId] ?? [];
}

// ── reading a saved model back ───────────────────────────────────────────────

const TURNS: readonly number[] = [0, 90, 180, 270];

/** Parse what the device saved. Anything that is not a sound model comes back as null, never half a model. */
export function parseJobModel(raw: string | null | undefined, projectId: string): JobModel | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const m = v as Partial<JobModel>;
  if (m.version !== 1 || m.projectId !== projectId || !Array.isArray(m.rooms)) return null;
  const rooms: PlacedRoom[] = [];
  for (const r of m.rooms as PlacedRoom[]) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || !r.room || !r.placement) return null;
    if (!Array.isArray(r.room.walls) || !Array.isArray(r.room.openings) || !Array.isArray(r.room.floor) || !r.room.ceilingHeightM) return null;
    if (!TURNS.includes(r.placement.rotationDeg)) return null;
    rooms.push({ ...r, room: { ...r.room, objects: Array.isArray(r.room.objects) ? r.room.objects : [] } });
  }
  const links: Record<string, string[]> = {};
  if (m.links && typeof m.links === 'object') {
    for (const [roomId, ids] of Object.entries(m.links)) {
      if (Array.isArray(ids)) links[roomId] = ids.filter((t): t is string => typeof t === 'string');
    }
  }
  const model: JobModel = { version: 1, projectId, rooms, links, updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : '' };
  return validateModel(model).ok ? model : null;
}
