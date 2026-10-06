// utils/roomScan/geometryCore.ts — parsed surfaces to a room outline.
//
// Pure: no React, no React Native, no storage, no clock. scripts/
// validate-scan-room.ts runs every function here against hand-built fixtures.
//
// ── FROM A WALL TO A LINE ON THE PLAN ───────────────────────────────────────
// A RoomPlan wall is a flat rectangle. Its 4x4 transform (column-major, metres,
// y up) says where its centre is and which way it runs:
//   centre           elements 12, 13, 14
//   "along" the wall column 0 = elements 0, 1, 2
// Looking straight down drops y. The plan point is (x, -z): keeping +z would
// draw the room mirrored. Half the width either side of the centre along the
// wall's own direction gives one line per wall.
//
// ── CLOSING THE ROOM ────────────────────────────────────────────────────────
// Scanned walls do not meet exactly. Two wall ends are joined when they are
// within SNAP_M of each other. The corner is then moved to where the two wall
// lines cross (or to the midpoint when they are parallel). If the walls form a
// loop, that loop is the floor. If they do not, the room is OPEN and no floor
// area is ever reported from it: the person is told which walls to check.

import type { ParsedRoom, RawSurface } from './capturedRoomParser';
import {
  RoomScanParseError,
  type CeilingHeight, type Pt, type RoomScan, type RoomType, type ScanClosure,
  type ScanObject, type ScanOpening, type ScanWall,
} from './types';

/** Two wall ends closer than this are the same corner. Tune on real scans. */
export const SNAP_M = 0.10;
/** An opening belongs to the nearest wall only within this distance (iOS 16 has no parent id). */
export const OPENING_REACH_M = 0.5;
/** A sill this close to the floor is at the floor. */
export const FLOOR_TOL_M = 0.05;
/** Ceiling heights within this are one flat ceiling. */
export const CEILING_TOL_M = 0.05;

const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: Pt, q: Pt): Pt => ({ x: p.x + q.x, y: p.y + q.y });
const mul = (p: Pt, k: number): Pt => ({ x: p.x * k, y: p.y * k });
const dot = (p: Pt, q: Pt): number => p.x * q.x + p.y * q.y;
const cross = (p: Pt, q: Pt): number => p.x * q.y - p.y * q.x;
export const dist = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.y - q.y);
const unit = (p: Pt): Pt => { const n = Math.hypot(p.x, p.y); return n > 0 ? { x: p.x / n, y: p.y / n } : { x: 1, y: 0 }; };

/** Apple (x, y up, z) to the plan. THE sign that keeps the plan from being mirrored. */
export function planPoint(x: number, z: number): Pt {
  return { x, y: -z };
}

/** Shoelace. Positive for counter-clockwise. */
export function signedArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polygonArea(poly: readonly Pt[]): number {
  return poly.length >= 3 ? Math.abs(signedArea(poly)) : 0;
}

/** One wall as a segment on the plan, before any corner is fixed. */
export function wallSegment(s: RawSurface): { a: Pt; b: Pt; centreY: number } {
  const m = s.transform;
  const along = planPoint(m[0], m[2]);
  const n = Math.hypot(along.x, along.y);
  if (n < 1e-6) throw new RoomScanParseError('bad_transform', `wall ${s.id}: it does not run along the floor`);
  const d = { x: along.x / n, y: along.y / n };
  const c = planPoint(m[12], m[14]);
  const h = s.widthM / 2;
  return { a: sub(c, mul(d, h)), b: add(c, mul(d, h)), centreY: m[13] };
}

/** Where two infinite lines cross, or null when they are (nearly) parallel. */
function lineCross(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = cross(d, e);
  if (Math.abs(den) < 0.05) return null; // under about 3 degrees
  const t = cross(sub(q, p), e) / den;
  return add(p, mul(d, t));
}

interface Seg { src: RawSurface; a: Pt; b: Pt; centreY: number }

interface Loop { order: number[]; flipped: boolean[] }

/** Join wall ends, then walk them. Returns the largest closed loop, or the chains when none closes. */
function linkWalls(segs: Seg[]): { loop: Loop | null; chains: Loop[]; partner: (number | null)[] } {
  const ends: Pt[] = [];
  segs.forEach((s) => { ends.push(s.a, s.b); });
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if ((i >> 1) === (j >> 1)) continue;
      const d = dist(ends[i], ends[j]);
      if (d <= SNAP_M) { pairs.push({ i, j, d }); continue; }
      // Two walls that each stop a little short of the corner: joined when
      // neither end has to move more than SNAP_M to reach where the lines cross.
      const si = segs[i >> 1];
      const sj = segs[j >> 1];
      const x = lineCross(si.a, unit(sub(si.b, si.a)), sj.a, unit(sub(sj.b, sj.a)));
      if (x && dist(ends[i], x) <= SNAP_M && dist(ends[j], x) <= SNAP_M) pairs.push({ i, j, d });
    }
  }
  pairs.sort((p, q) => p.d - q.d);
  const partner: (number | null)[] = ends.map(() => null);
  for (const p of pairs) {
    if (partner[p.i] == null && partner[p.j] == null) { partner[p.i] = p.j; partner[p.j] = p.i; }
  }
  const seen = segs.map(() => false);
  const loops: Loop[] = [];
  const chains: Loop[] = [];
  for (let start = 0; start < segs.length; start++) {
    if (seen[start]) continue;
    // Walk backwards to the head of a chain (or all the way round a loop).
    let head = start;
    let headFlip = false;
    let isLoop = false;
    for (;;) {
      const inEnd = head * 2 + (headFlip ? 1 : 0);
      const p = partner[inEnd];
      if (p == null) break;
      const w = p >> 1;
      const wFlip = (p & 1) === 0; // the wall before us ends at its own `a`, so it runs backwards
      if (w === start) { isLoop = true; break; }
      head = w; headFlip = wFlip;
    }
    if (isLoop) { head = start; headFlip = false; }
    const order: number[] = [];
    const flipped: boolean[] = [];
    let w = head;
    let f = headFlip;
    for (;;) {
      seen[w] = true;
      order.push(w); flipped.push(f);
      const outEnd = w * 2 + (f ? 0 : 1);
      const p = partner[outEnd];
      if (p == null) break;
      const nw = p >> 1;
      if (seen[nw]) break;
      w = nw; f = (p & 1) === 1; // arriving at its `b` means it runs backwards
    }
    (isLoop ? loops : chains).push({ order, flipped });
  }
  loops.sort((p, q) => q.order.length - p.order.length);
  const loop = loops.length && loops[0].order.length >= 3 ? loops[0] : null;
  return { loop, chains: loop ? [...loops.slice(1), ...chains] : [...loops, ...chains], partner };
}

function median(xs: number[]): number {
  const s = [...xs].sort((p, q) => p - q);
  const n = s.length;
  return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** The heights a wall's top edge reaches: one for a rectangle, several for a slanted polygon. */
function wallTopHeights(s: RawSurface): number[] {
  if (s.polygon.length >= 3) {
    const vs = s.polygon.map((p) => p.v);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const mid = (lo + hi) / 2;
    const tops = vs.filter((v) => v > mid).map((v) => v - lo);
    if (tops.length) return tops;
  }
  return s.heightM > 0 ? [s.heightM] : [];
}

export interface BuildMeta {
  id: string;
  projectId: string;
  name: string;
  capturedAt: string;
  device: { model: string; os: string };
  warnings?: string[];
  rawSha256?: string;
  roomType?: RoomType;
}

/** Parsed surfaces to the app's room model. No edits yet: everything here is as scanned. */
export function buildRoomScan(parsed: ParsedRoom, meta: BuildMeta): RoomScan {
  const segs: Seg[] = parsed.walls.map((src) => ({ src, ...wallSegment(src) }));
  const { loop, chains } = linkWalls(segs);

  const walls: ScanWall[] = [];
  let floor: Pt[] = [];
  let closure: ScanClosure;
  const mk = (s: Seg, a: Pt, b: Pt, onOutline: boolean): ScanWall => {
    const w: ScanWall = {
      id: s.src.id,
      label: '',
      a, b,
      lengthM: dist(a, b),
      scanLengthM: s.src.widthM,
      lengthSource: 'scan',
      heightM: s.src.heightM,
      confidence: s.src.confidence,
      curved: s.src.curved,
      onOutline,
    };
    if (s.src.polygon.length >= 3) w.polygon = s.src.polygon;
    return w;
  };
  const oriented = (l: Loop) => l.order.map((idx, k) => {
    const s = segs[idx];
    return l.flipped[k] ? { s, a: s.b, b: s.a } : { s, a: s.a, b: s.b };
  });

  if (loop) {
    let ring = oriented(loop);
    const n = ring.length;
    let maxGap = 0;
    let corners: Pt[] = ring.map((cur, i) => {
      const prev = ring[(i - 1 + n) % n];
      maxGap = Math.max(maxGap, dist(prev.b, cur.a));
      const mid = mul(add(prev.b, cur.a), 0.5);
      const x = lineCross(prev.a, unit(sub(prev.b, prev.a)), cur.a, unit(sub(cur.b, cur.a)));
      return x && dist(x, mid) <= 2 * SNAP_M ? x : mid;
    });
    if (signedArea(corners) < 0) {
      // Clockwise: turn the ring round so the floor is counter-clockwise.
      ring = [...ring].reverse();
      corners = [...corners].reverse();
      // Wall k of the turned ring starts at old corner (n - k) mod n.
      corners = [corners[n - 1], ...corners.slice(0, n - 1)];
    }
    ring.forEach((r, i) => walls.push(mk(r.s, corners[i], corners[(i + 1) % n], true)));
    floor = corners;
    closure = { closed: true, gapM: maxGap, gaps: 0, gapWallIds: [], cause: 'scan' };
    // Walls that are not part of the outline (a stub, a second loop) are kept and marked.
    for (const c of chains) for (const r of oriented(c)) walls.push(mk(r.s, r.a, r.b, false));
  } else {
    // OPEN. Keep the walls in chain order so the labels still read round the room.
    const free: { p: Pt; wallId: string }[] = [];
    for (const c of chains) {
      const ring = oriented(c);
      ring.forEach((r) => walls.push(mk(r.s, r.a, r.b, true)));
      free.push({ p: ring[0].a, wallId: ring[0].s.src.id });
      free.push({ p: ring[ring.length - 1].b, wallId: ring[ring.length - 1].s.src.id });
    }
    let gapM = 0;
    let gapWallIds: string[] = [];
    free.forEach((f, i) => {
      let best = Infinity;
      let bestId = '';
      free.forEach((g, j) => {
        if (i === j) return;
        const d = dist(f.p, g.p);
        if (d < best) { best = d; bestId = g.wallId; }
      });
      if (Number.isFinite(best) && best > gapM) { gapM = best; gapWallIds = f.wallId === bestId ? [f.wallId] : [f.wallId, bestId]; }
    });
    closure = { closed: false, gapM, gaps: Math.max(1, chains.length), gapWallIds, cause: 'scan' };
  }
  walls.forEach((w, i) => { w.label = `Wall ${i + 1}`; });

  // ── heights ──
  const tops = parsed.walls.flatMap(wallTopHeights);
  const ceilingHeightM: CeilingHeight = tops.length
    ? { known: true, min: Math.min(...tops), max: Math.max(...tops), typical: median(tops), source: 'scan' }
    : { known: false, min: 0, max: 0, typical: 0, source: 'scan' };

  const withHeight = segs.filter((s) => s.src.heightM > 0);
  const floorY = withHeight.length
    ? Math.min(...withHeight.map((s) => s.centreY - s.src.heightM / 2))
    : parsed.doors.length ? Math.min(...parsed.doors.map((d) => d.transform[13] - d.heightM / 2)) : 0;

  // ── openings ──
  const byId = new Map(walls.map((w) => [w.id, w]));
  const openings: ScanOpening[] = [];
  for (const s of [...parsed.doors, ...parsed.windows, ...parsed.openings]) {
    const c = planPoint(s.transform[12], s.transform[14]);
    let wall = s.parentId ? byId.get(s.parentId) ?? null : null;
    if (!wall) {
      let best = OPENING_REACH_M;
      for (const w of walls) {
        const d = unit(sub(w.b, w.a));
        const t = Math.max(0, Math.min(w.lengthM, dot(sub(c, w.a), d)));
        const off = dist(c, add(w.a, mul(d, t)));
        if (off <= best) { best = off; wall = w; }
      }
    }
    const offsetM = wall ? dot(sub(c, wall.a), unit(sub(wall.b, wall.a))) - s.widthM / 2 : 0;
    const sillRaw = s.transform[13] - s.heightM / 2 - floorY;
    openings.push({
      id: s.id,
      kind: s.kind === 'door' ? 'door' : s.kind === 'window' ? 'window' : 'opening',
      wallId: wall ? wall.id : null,
      offsetM,
      widthM: s.widthM,
      heightM: s.heightM,
      sillM: sillRaw < FLOOR_TOL_M ? 0 : sillRaw,
      confidence: s.confidence,
      widthSource: 'scan',
      heightSource: 'scan',
    });
  }

  // ── objects ──
  const objects: ScanObject[] = parsed.objects.map((o) => ({
    id: o.id,
    category: o.category,
    center: planPoint(o.transform[12], o.transform[14]),
    widthM: o.widthM,
    depthM: o.depthM,
    heightM: o.heightM,
    rotationRad: Math.atan2(-o.transform[2], o.transform[0]),
    confidence: o.confidence,
  }));

  return {
    id: meta.id,
    projectId: meta.projectId,
    name: meta.name,
    version: 1,
    capturedAt: meta.capturedAt,
    device: meta.device,
    roomType: meta.roomType ?? parsed.suggestedRoomType ?? 'room',
    suggestedRoomType: parsed.suggestedRoomType,
    walls,
    openings,
    objects,
    floor,
    closure,
    ceilingHeightM,
    warnings: [...(meta.warnings ?? []), ...parsed.notes],
    tapeChecks: [],
    edits: [],
    rawSha256: meta.rawSha256 ?? '',
  };
}

/** The room turned so its longest wall is level, moved so its top-left is (0, 0). For drawing only. */
export function planForDisplay(scan: RoomScan): {
  walls: { id: string; a: Pt; b: Pt }[];
  floor: Pt[];
  objects: { id: string; center: Pt; rotationRad: number }[];
  width: number;
  height: number;
} {
  const longest = scan.walls.reduce<ScanWall | null>((m, w) => (!m || w.lengthM > m.lengthM ? w : m), null);
  const ang = longest ? Math.atan2(longest.b.y - longest.a.y, longest.b.x - longest.a.x) : 0;
  const cos = Math.cos(-ang);
  const sin = Math.sin(-ang);
  const rot = (p: Pt): Pt => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  const pts = scan.walls.flatMap((w) => [rot(w.a), rot(w.b)]);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  // Screen y grows downward; plan y grows "up the page". Flip so the drawing is not mirrored.
  const place = (p: Pt): Pt => { const r = rot(p); return { x: r.x - minX, y: maxY - r.y }; };
  return {
    walls: scan.walls.map((w) => ({ id: w.id, a: place(w.a), b: place(w.b) })),
    floor: scan.floor.map(place),
    objects: scan.objects.map((o) => ({ id: o.id, center: place(o.center), rotationRad: -(o.rotationRad - ang) })),
    width: maxX - minX,
    height: maxY - minY,
  };
}
