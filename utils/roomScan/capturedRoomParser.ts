// utils/roomScan/capturedRoomParser.ts — Apple's CapturedRoom JSON to plain rows.
//
// ── READ THIS BEFORE TRUSTING IT ────────────────────────────────────────────
// This parser was written from Apple's DOCUMENTED CapturedRoom structure
// (WWDC22 session 10127, WWDC23 session 10192, the RoomPlan reference) and the
// way Swift's JSONEncoder writes Codable types. It has NOT been run against a
// real export from a phone. The fixtures in scripts/fixtures/scan-room/ were
// built by hand. Before the feature is switched on, a real export from a LiDAR
// iPhone must be parsed here and added as a fixture
// (docs/scan-the-room-native-checklist.md, "First real export").
//
// Because the exact encoding is unconfirmed, every field is read tolerantly:
//   enum values      "wall"  or  { "wall": {} }  or  { "door": { "isOpen": true } }
//   dimensions       [w, h, d]  or  { x, y, z }  or  { width, height, depth/length }
//   transform        16 numbers (column-major, the simd layout)  or
//                    4 columns of 4  or  { columns: [[4],[4],[4],[4]] }
//   identifier       a string, any case
// Unknown keys are ignored. Keys that only exist on iOS 17 (floors, sections,
// story, parentIdentifier, polygonCorners, attributes) may be missing.
// A wall whose transform or size cannot be read is a typed error, never a
// guess: a wall in the wrong place would give a wrong floor area with no sign
// that anything went wrong.
//
// Pure: no React, no React Native, no storage.

import { RoomScanParseError, type Confidence, type RoomType } from './types';

export interface RawSurface {
  id: string;
  parentId: string | null;
  kind: 'wall' | 'door' | 'window' | 'opening' | 'floor';
  confidence: Confidence;
  /** Metres. Along the surface. */
  widthM: number;
  /** Metres. 0 when the export gave none. */
  heightM: number;
  /** Column-major 4x4, metres, y up. */
  transform: number[];
  curved: boolean;
  /** The surface's own plane, metres. Empty when not given. */
  polygon: { u: number; v: number }[];
  /** A door's isOpen, when the export said. */
  isOpen: boolean | null;
}

export interface RawObject {
  id: string;
  parentId: string | null;
  category: string;
  confidence: Confidence;
  widthM: number;
  heightM: number;
  depthM: number;
  transform: number[];
}

export interface ParsedRoom {
  walls: RawSurface[];
  doors: RawSurface[];
  windows: RawSurface[];
  openings: RawSurface[];
  floors: RawSurface[];
  objects: RawObject[];
  /** iOS 17 section labels, lower case ("bathroom", "kitchen" ...). */
  sections: string[];
  suggestedRoomType: RoomType | null;
  /** Things the parser dropped or could not read, in words for a log. Never shown as a number. */
  notes: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** "wall" from "wall", { wall: {} }, { door: { isOpen: true } } or { rawValue: "wall" }. */
export function enumCase(v: unknown): { name: string; payload: Record<string, unknown> } | null {
  if (typeof v === 'string' && v) return { name: v, payload: {} };
  if (isObj(v)) {
    if (typeof v.rawValue === 'string') return { name: v.rawValue, payload: {} };
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const p = v[keys[0]];
      return { name: keys[0], payload: isObj(p) ? p : {} };
    }
  }
  return null;
}

function readConfidence(v: unknown): Confidence {
  const c = enumCase(v)?.name.toLowerCase();
  if (c === 'low' || c === 'medium' || c === 'high') return c;
  // Missing or unknown is treated as the weakest answer, so it is drawn dashed
  // and the person is asked to check it.
  return 'low';
}

function flatten16(v: unknown): number[] | null {
  let src: unknown = v;
  if (isObj(src) && Array.isArray(src.columns)) src = src.columns;
  if (!Array.isArray(src)) return null;
  let flat: unknown[];
  if (src.length === 16) flat = src;
  else if (src.length === 4 && src.every((c) => Array.isArray(c) && c.length === 4)) flat = (src as unknown[][]).flat();
  else return null;
  if (!flat.every(isNum)) return null;
  return flat as number[];
}

function readTransform(v: unknown, what: string): number[] {
  const m = flatten16(v);
  if (!m) throw new RoomScanParseError('bad_transform', `${what}: the transform is not 16 numbers`);
  // Column 0 is the surface's own "along" direction. A zero column cannot place a wall.
  if (Math.hypot(m[0], m[1], m[2]) < 1e-6) {
    throw new RoomScanParseError('bad_transform', `${what}: the transform has no direction`);
  }
  return m;
}

function readDimensions(v: unknown): [number, number, number] | null {
  if (Array.isArray(v) && v.length >= 2 && v.slice(0, 3).every(isNum)) {
    return [v[0] as number, v[1] as number, isNum(v[2]) ? (v[2] as number) : 0];
  }
  if (isObj(v)) {
    const w = isNum(v.x) ? v.x : isNum(v.width) ? v.width : null;
    const h = isNum(v.y) ? v.y : isNum(v.height) ? v.height : null;
    const d = isNum(v.z) ? v.z : isNum(v.depth) ? v.depth : isNum(v.length) ? v.length : 0;
    if (w != null && h != null) return [w, h, d];
  }
  return null;
}

function readPolygon(v: unknown): { u: number; v: number }[] {
  if (!Array.isArray(v)) return [];
  const out: { u: number; v: number }[] = [];
  for (const p of v) {
    if (Array.isArray(p) && isNum(p[0]) && isNum(p[1])) out.push({ u: p[0], v: p[1] });
    else if (isObj(p) && isNum(p.x) && isNum(p.y)) out.push({ u: p.x, v: p.y });
    else return [];
  }
  return out.length >= 3 ? out : [];
}

function readId(v: unknown, fallback: string): string {
  if (typeof v === 'string' && v) return v.toLowerCase();
  if (isObj(v) && typeof v.uuidString === 'string') return v.uuidString.toLowerCase();
  return fallback;
}

function readCurved(v: unknown): boolean {
  if (!isObj(v)) return false;
  const r = v.radius;
  if (isNum(r)) return Math.abs(r) > 1e-6;
  if (isObj(r) && isNum(r.value)) return Math.abs(r.value) > 1e-6;
  return Object.keys(v).length > 0;
}

function readSurface(v: unknown, kind: RawSurface['kind'], index: number, notes: string[]): RawSurface | null {
  const what = `${kind} ${index + 1}`;
  if (!isObj(v)) { notes.push(`${what}: not an object, dropped`); return null; }
  const dims = readDimensions(v.dimensions);
  if (!dims || !(dims[0] > 0)) {
    // A wall with no width cannot be drawn. Anything else with no size is dropped and noted.
    if (kind === 'wall') throw new RoomScanParseError('bad_dimensions', `${what}: no usable width`);
    notes.push(`${what}: no usable size, dropped`);
    return null;
  }
  let transform: number[];
  try {
    transform = readTransform(v.transform, what);
  } catch (e) {
    if (kind === 'wall') throw e;
    notes.push(`${what}: transform could not be read, dropped`);
    return null;
  }
  const cat = enumCase(v.category);
  const isOpen = cat && typeof cat.payload.isOpen === 'boolean' ? cat.payload.isOpen : null;
  return {
    id: readId(v.identifier, `${kind}-${index + 1}`),
    parentId: v.parentIdentifier == null ? null : readId(v.parentIdentifier, ''),
    kind,
    confidence: readConfidence(v.confidence),
    widthM: dims[0],
    heightM: dims[1] > 0 ? dims[1] : 0,
    transform,
    curved: readCurved(v.curve),
    polygon: readPolygon(v.polygonCorners),
    isOpen,
  };
}

function readObject(v: unknown, index: number, notes: string[]): RawObject | null {
  const what = `object ${index + 1}`;
  if (!isObj(v)) { notes.push(`${what}: not an object, dropped`); return null; }
  const dims = readDimensions(v.dimensions);
  const m = flatten16(v.transform);
  const cat = enumCase(v.category);
  if (!dims || !m || !cat) { notes.push(`${what}: could not be read, dropped`); return null; }
  return {
    id: readId(v.identifier, `object-${index + 1}`),
    parentId: v.parentIdentifier == null ? null : readId(v.parentIdentifier, ''),
    category: cat.name,
    confidence: readConfidence(v.confidence),
    widthM: Math.max(0, dims[0]),
    heightM: Math.max(0, dims[1]),
    depthM: Math.max(0, dims[2]),
    transform: m,
  };
}

const SECTION_ROOM: Record<string, RoomType> = {
  bathroom: 'bathroom',
  kitchen: 'kitchen',
  bedroom: 'bedroom',
  livingroom: 'room',
  diningroom: 'room',
};

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Parse Apple's CapturedRoom JSON (a string, or the already-parsed object).
 * Throws RoomScanParseError with a typed code; never returns a half-read room.
 */
export function parseCapturedRoom(input: string | unknown): ParsedRoom {
  let root: unknown = input;
  if (typeof input === 'string') {
    try { root = JSON.parse(input); }
    catch { throw new RoomScanParseError('not_json', 'The scan file is not JSON'); }
  }
  if (!isObj(root)) throw new RoomScanParseError('not_a_room', 'The scan file is not a room');
  if (!Array.isArray(root.walls)) throw new RoomScanParseError('not_a_room', 'The scan file has no list of walls');
  const notes: string[] = [];
  const surfaces = (key: string, kind: RawSurface['kind']) =>
    list(root[key]).map((s, i) => readSurface(s, kind, i, notes)).filter((s): s is RawSurface => s !== null);

  const walls = surfaces('walls', 'wall');
  if (walls.length === 0) throw new RoomScanParseError('no_walls', 'The scan found no walls');
  const doors = surfaces('doors', 'door');
  const windows = surfaces('windows', 'window');
  const openings = surfaces('openings', 'opening');
  const floors = surfaces('floors', 'floor');
  const objects = list(root.objects).map((o, i) => readObject(o, i, notes)).filter((o): o is RawObject => o !== null);

  const sections: string[] = [];
  for (const s of list(root.sections)) {
    const label = isObj(s) ? enumCase(s.label)?.name : null;
    if (label) sections.push(label.toLowerCase());
  }
  let suggestedRoomType: RoomType | null = null;
  for (const s of sections) {
    const t = SECTION_ROOM[s.replace(/[^a-z]/g, '')];
    if (t) { suggestedRoomType = t; break; }
  }
  return { walls, doors, windows, openings, floors, objects, sections, suggestedRoomType, notes };
}
