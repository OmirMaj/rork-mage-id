// scripts/fixtures/scan-room/builder.ts — builds CapturedRoom-shaped JSON BY HAND.
//
// NOT FROM A PHONE. Everything this writes follows Apple's documented
// CapturedRoom structure (walls, doors, windows, openings, objects; each with
// an identifier, a category, a confidence, dimensions in metres and a 4x4
// transform; iOS 17 adds floors, sections, story, parentIdentifier and
// polygonCorners) and the way Swift's JSONEncoder writes enums with no raw
// value ({ "wall": {} }) and simd types (arrays of numbers). The exact key
// names and the transform's layout have not been checked against a real
// export. The parser must be re-checked against one before the feature is
// switched on: docs/scan-the-room-native-checklist.md.
//
// A room is described on the PLAN (x to the right, y up the page, metres) and
// written out in Apple's space: plan (x, y) is Apple (x, height, -y).

export interface Pt { x: number; y: number }

export interface WallSpec {
  a: Pt; b: Pt; height: number;
  confidence?: 'low' | 'medium' | 'high';
  /** Stop this far short at each end (a scanned wall that does not reach the corner). */
  shortA?: number; shortB?: number;
  polygonCorners?: [number, number, number][];
  curveRadius?: number;
  id?: string;
}

export interface OpeningSpec {
  kind: 'door' | 'window' | 'opening';
  /** Index into walls. */
  wall: number;
  /** Centre, metres along the wall from its `a`. */
  at: number;
  width: number; height: number;
  /** Bottom above the floor. */
  sill: number;
  confidence?: 'low' | 'medium' | 'high';
}

export interface ObjectSpec { category: string; at: Pt; w: number; h: number; d: number; turnDeg?: number }

export interface RoomSpec {
  walls: WallSpec[];
  openings?: OpeningSpec[];
  objects?: ObjectSpec[];
  /** Turn the whole room about the plan origin, then move it. */
  rotateDeg?: number;
  shift?: Pt;
  /** Height of the floor in Apple's space (the phone starts above it). */
  floorY?: number;
  ios17?: boolean;
  section?: string;
  /** Leave walls without a height (an export that gave none). */
  noHeights?: boolean;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function uuid(kind: number, i: number): string {
  const h = (n: number, len: number) => n.toString(16).toUpperCase().padStart(len, '0');
  return `${h(0x5ca90000 + kind, 8)}-0000-4000-8000-${h(i + 1, 12)}`;
}

/** Column-major 4x4 for a surface centred at plan `c`, running along plan direction `d`, centre height `cy`. */
function transform(c: Pt, d: Pt, cy: number): number[] {
  // along = (dx, 0, -dy); up = (0, 1, 0); normal = along x up = (dy, 0, dx)
  return [d.x, 0, -d.y, 0, 0, 1, 0, 0, d.y, 0, d.x, 0, c.x, cy, -c.y, 1].map(r6);
}

export function buildCapturedRoom(spec: RoomSpec): Record<string, unknown> {
  const ang = ((spec.rotateDeg ?? 0) * Math.PI) / 180;
  const sh = spec.shift ?? { x: 0, y: 0 };
  const place = (p: Pt): Pt => ({
    x: p.x * Math.cos(ang) - p.y * Math.sin(ang) + sh.x,
    y: p.x * Math.sin(ang) + p.y * Math.cos(ang) + sh.y,
  });
  const floorY = spec.floorY ?? -1.2;
  const ios17 = spec.ios17 ?? true;
  const conf = (c?: string) => ({ [c ?? 'high']: {} });

  const placed = spec.walls.map((w) => {
    const A = place(w.a);
    const B = place(w.b);
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const d = { x: (B.x - A.x) / len, y: (B.y - A.y) / len };
    const a = { x: A.x + d.x * (w.shortA ?? 0), y: A.y + d.y * (w.shortA ?? 0) };
    const b = { x: B.x - d.x * (w.shortB ?? 0), y: B.y - d.y * (w.shortB ?? 0) };
    return { w, A, d, a, b, width: Math.hypot(b.x - a.x, b.y - a.y) };
  });

  const walls = placed.map((p, i) => {
    const h = spec.noHeights ? 0 : p.w.height;
    const out: Record<string, unknown> = {
      identifier: p.w.id ?? uuid(1, i),
      category: { wall: {} },
      confidence: conf(p.w.confidence),
      dimensions: [r6(p.width), r6(h), 0],
      transform: transform({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 }, p.d, floorY + p.w.height / 2),
      completedEdges: [{ top: {} }, { bottom: {} }, { left: {} }, { right: {} }],
      curve: p.w.curveRadius ? { radius: p.w.curveRadius, startAngle: 0, endAngle: 1.2 } : null,
    };
    if (ios17) { out.parentIdentifier = null; out.story = 0; out.polygonCorners = p.w.polygonCorners ?? []; }
    return out;
  });

  const surface = (o: OpeningSpec, i: number, kindNo: number) => {
    const p = placed[o.wall];
    const c = { x: p.A.x + p.d.x * o.at, y: p.A.y + p.d.y * o.at };
    const out: Record<string, unknown> = {
      identifier: uuid(kindNo, i),
      category: o.kind === 'door' ? { door: { isOpen: false } } : { [o.kind]: {} },
      confidence: conf(o.confidence),
      dimensions: [r6(o.width), r6(o.height), 0],
      transform: transform(c, p.d, floorY + o.sill + o.height / 2),
      completedEdges: [],
      curve: null,
    };
    if (ios17) { out.parentIdentifier = (walls[o.wall].identifier as string); out.story = 0; out.polygonCorners = []; }
    return out;
  };
  const ops = spec.openings ?? [];
  const pick = (k: OpeningSpec['kind'], n: number) => ops.filter((o) => o.kind === k).map((o, i) => surface(o, i, n));

  const objects = (spec.objects ?? []).map((o, i) => {
    const c = place(o.at);
    const t = ang + ((o.turnDeg ?? 0) * Math.PI) / 180;
    const out: Record<string, unknown> = {
      identifier: uuid(5, i),
      category: { [o.category]: {} },
      confidence: conf('high'),
      dimensions: [o.w, o.h, o.d],
      transform: transform(c, { x: Math.cos(t), y: Math.sin(t) }, floorY + o.h / 2),
    };
    if (ios17) { out.parentIdentifier = null; out.story = 0; out.attributes = {}; }
    return out;
  });

  const room: Record<string, unknown> = {
    walls,
    doors: pick('door', 2),
    windows: pick('window', 3),
    openings: pick('opening', 4),
    objects,
  };
  if (ios17) {
    room.version = 2;
    room.story = 0;
    room.floors = [];
    room.sections = spec.section ? [{ label: { [spec.section]: {} }, center: [0, 0, 0], story: 0 }] : [];
    room.referenceOriginTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  return room;
}

/** A closed ring of corners to walls, counter-clockwise, all one height. */
export function ring(corners: Pt[], height: number): WallSpec[] {
  return corners.map((a, i) => ({ a, b: corners[(i + 1) % corners.length], height }));
}

// ── the three files ─────────────────────────────────────────────────────────

const IN = 0.0254;

/** A hall bathroom, 5 ft 1 in by 8 ft 2 in, 8 ft ceiling. One door, one window, a tub, a toilet and a sink. */
export function bathroomSpec(): RoomSpec {
  const W = 61 * IN;
  const D = 98 * IN;
  const H = 96 * IN;
  const r = ring([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }], H);
  // Out of order, and one wall written end for end, the way a scan hands them over.
  const walls = [r[2], { ...r[0], a: r[0].b, b: r[0].a }, r[3], r[1]];
  return {
    walls,
    openings: [
      // The door is on the bottom wall (index 1, written from x = W back to 0), 30 in by 80 in.
      { kind: 'door', wall: 1, at: W - 1.05, width: 30 * IN, height: 80 * IN, sill: 0 },
      // The window is on the right wall (index 3), 24 in by 36 in, sill 40 in up.
      { kind: 'window', wall: 3, at: 1.6, width: 24 * IN, height: 36 * IN, sill: 40 * IN },
    ],
    objects: [
      { category: 'bathtub', at: { x: W / 2, y: D - 0.4 }, w: 1.5, h: 0.5, d: 0.76 },
      { category: 'toilet', at: { x: 0.3, y: 1.3 }, w: 0.4, h: 0.75, d: 0.7, turnDeg: 90 },
      { category: 'sink', at: { x: W - 0.3, y: 0.9 }, w: 0.5, h: 0.85, d: 0.45, turnDeg: 270 },
      { category: 'storage', at: { x: W - 0.3, y: 0.3 }, w: 0.4, h: 1.8, d: 0.35 },
    ],
    rotateDeg: 20,
    shift: { x: 0.8, y: -1.1 },
    section: 'bathroom',
  };
}

/** An L-shaped room written the iOS 16 way: no parent ids, no floors, no sections. */
export function lShapeSpec(): RoomSpec {
  const H = 2.7;
  const walls = ring([
    { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 }, { x: 3.5, y: 3 }, { x: 3.5, y: 5 }, { x: 0, y: 5 },
  ], H);
  return {
    walls,
    openings: [
      { kind: 'door', wall: 0, at: 1.0, width: 0.9, height: 2.1, sill: 0 },
      { kind: 'window', wall: 5, at: 1.2, width: 1.2, height: 1.0, sill: 0.9 },
      { kind: 'window', wall: 5, at: 3.6, width: 1.2, height: 1.0, sill: 0.9 },
      // A cased opening, floor to ceiling.
      { kind: 'opening', wall: 1, at: 1.5, width: 1.2, height: 2.7, sill: 0 },
    ],
    objects: [
      { category: 'sofa', at: { x: 1.5, y: 4 }, w: 2, h: 0.8, d: 0.9 },
      { category: 'table', at: { x: 4.5, y: 1.5 }, w: 1.2, h: 0.75, d: 0.8 },
    ],
    rotateDeg: -33,
    shift: { x: -2, y: 3 },
    ios17: false,
  };
}

/** A 3 m by 4 m room where the scan never found the fourth wall, and two corners stop 3 cm short. */
export function missingWallSpec(): RoomSpec {
  const H = 2.44;
  return {
    walls: [
      { a: { x: 0, y: 0 }, b: { x: 0, y: 4 }, height: H, shortB: 0.03 },
      { a: { x: 0, y: 4 }, b: { x: 3, y: 4 }, height: H, shortB: 0.03, confidence: 'medium' },
      { a: { x: 3, y: 4 }, b: { x: 3, y: 0 }, height: H },
    ],
    openings: [{ kind: 'door', wall: 1, at: 1.5, width: 0.8, height: 2.03, sill: 0 }],
    rotateDeg: 8,
  };
}

// ── three more, for the order list (lane SCANORDER) ─────────────────────────
// Drawn in whole inches so the cut layouts can be checked by hand.
const inPt = (x: number, y: number): Pt => ({ x: x * IN, y: y * IN });

/**
 * A 14 ft by 10 ft room with a bay on the far wall, 8 ft ceiling. The bay is
 * 6 ft wide at the wall, 3 ft wide at its face and 2 ft deep, so each angled
 * wall is 30 in (18, 24, 30). Eight walls, two outside corners where the bay
 * leaves the wall. A window on each of the bay's three walls, a door on the
 * near wall.
 */
export function bayRoomSpec(): RoomSpec {
  const walls = ring([
    inPt(0, 0), inPt(168, 0), inPt(168, 120), inPt(120, 120), inPt(102, 144), inPt(66, 144), inPt(48, 120), inPt(0, 120),
  ], 96 * IN);
  return {
    walls,
    openings: [
      { kind: 'door', wall: 0, at: 40 * IN, width: 32 * IN, height: 80 * IN, sill: 0 },
      { kind: 'window', wall: 3, at: 15 * IN, width: 20 * IN, height: 48 * IN, sill: 30 * IN },
      { kind: 'window', wall: 4, at: 18 * IN, width: 28 * IN, height: 48 * IN, sill: 30 * IN },
      { kind: 'window', wall: 5, at: 15 * IN, width: 20 * IN, height: 48 * IN, sill: 30 * IN },
    ],
    rotateDeg: 12,
    shift: { x: 1.5, y: 0.4 },
    section: 'bedroom',
  };
}

/** A hallway, 3 ft 6 in by 22 ft, 8 ft ceiling. A door at each end and a cased opening, floor to ceiling, on one long wall. */
export function hallwaySpec(): RoomSpec {
  const walls = ring([inPt(0, 0), inPt(264, 0), inPt(264, 42), inPt(0, 42)], 96 * IN);
  return {
    walls,
    openings: [
      { kind: 'door', wall: 1, at: 21 * IN, width: 30 * IN, height: 80 * IN, sill: 0 },
      { kind: 'door', wall: 3, at: 21 * IN, width: 30 * IN, height: 80 * IN, sill: 0 },
      { kind: 'opening', wall: 2, at: 132 * IN, width: 48 * IN, height: 96 * IN, sill: 0 },
    ],
    rotateDeg: -7,
    shift: { x: -0.6, y: 2.2 },
  };
}

/** A 12 ft by 10 ft room, 8 ft ceiling, with three openings on ONE wall: a door, a window and a cased opening. */
export function threeOpeningsSpec(): RoomSpec {
  const walls = ring([inPt(0, 0), inPt(144, 0), inPt(144, 120), inPt(0, 120)], 96 * IN);
  return {
    walls,
    openings: [
      { kind: 'door', wall: 0, at: 22 * IN, width: 32 * IN, height: 80 * IN, sill: 0 },
      { kind: 'window', wall: 0, at: 68 * IN, width: 36 * IN, height: 48 * IN, sill: 36 * IN },
      { kind: 'opening', wall: 0, at: 120 * IN, width: 36 * IN, height: 96 * IN, sill: 0 },
    ],
    rotateDeg: 31,
    shift: { x: 0.3, y: -0.9 },
  };
}

// ── three more, for Clearance Check (lane CLEARANCE) ────────────────────────
// Drawn in whole and half inches so every distance can be worked out by hand
// (the working is in scripts/validate-scan-clearance.ts).

/**
 * A tight bathroom, 5 ft by 8 ft, ceiling 6 ft 9 in. Left wall x = 0, bottom
 * wall y = 0. On the left wall: a sink (24 in wide, 20 in deep, from y = 15.5
 * to 39.5) and a toilet (15 in wide, 28 in deep, centre line at y = 52). A tub
 * 30 in deep fills the far end from y = 66. A cabinet 10 in deep stands on the
 * right wall across from the toilet. One 28 in door on the bottom wall.
 */
export function tightBathSpec(): RoomSpec {
  const walls = ring([inPt(0, 0), inPt(60, 0), inPt(60, 96), inPt(0, 96)], 81 * IN);
  return {
    walls,
    openings: [{ kind: 'door', wall: 0, at: 42 * IN, width: 28 * IN, height: 80 * IN, sill: 0 }],
    objects: [
      { category: 'bathtub', at: inPt(30, 81), w: 60 * IN, h: 20 * IN, d: 30 * IN },
      { category: 'toilet', at: inPt(14, 52), w: 15 * IN, h: 30 * IN, d: 28 * IN, turnDeg: 90 },
      { category: 'sink', at: inPt(10, 27.5), w: 24 * IN, h: 34 * IN, d: 20 * IN, turnDeg: 90 },
      { category: 'storage', at: inPt(55, 52), w: 20 * IN, h: 72 * IN, d: 10 * IN, turnDeg: 90 },
    ],
    rotateDeg: 17,
    shift: { x: 0.7, y: -0.4 },
    section: 'bathroom',
  };
}

/** A narrow hallway, 3 ft 1 in by 20 ft, 8 ft ceiling. A 30 in door at each end, and a stair the scan saw as one box. */
export function narrowHallSpec(): RoomSpec {
  const walls = ring([inPt(0, 0), inPt(240, 0), inPt(240, 37), inPt(0, 37)], 96 * IN);
  return {
    walls,
    openings: [
      { kind: 'door', wall: 1, at: 18.5 * IN, width: 30 * IN, height: 80 * IN, sill: 0 },
      { kind: 'door', wall: 3, at: 18.5 * IN, width: 30 * IN, height: 80 * IN, sill: 0 },
    ],
    objects: [{ category: 'stairs', at: inPt(200, 18.5), w: 36 * IN, h: 60 * IN, d: 60 * IN }],
    rotateDeg: -11,
    shift: { x: 0.2, y: 1.3 },
  };
}

/** A bedroom, 10 ft by 11 ft, 8 ft ceiling. One window 24 in by 36 in with its sill 43 in up, and a 36 in door. */
export function bedroomWindowSpec(): RoomSpec {
  const walls = ring([inPt(0, 0), inPt(120, 0), inPt(120, 132), inPt(0, 132)], 96 * IN);
  return {
    walls,
    openings: [
      { kind: 'door', wall: 0, at: 30 * IN, width: 36 * IN, height: 80 * IN, sill: 0 },
      { kind: 'window', wall: 2, at: 60 * IN, width: 24 * IN, height: 36 * IN, sill: 43 * IN },
    ],
    objects: [{ category: 'bed', at: inPt(60, 90), w: 60 * IN, h: 24 * IN, d: 80 * IN }],
    rotateDeg: 23,
    shift: { x: -1.1, y: 0.6 },
    section: 'bedroom',
  };
}

export const FIXTURE_FILES: Record<string, () => RoomSpec> = {
  'bathroom.json': bathroomSpec,
  'l-shape.json': lShapeSpec,
  'missing-wall.json': missingWallSpec,
  'bay-room.json': bayRoomSpec,
  'hallway.json': hallwaySpec,
  'three-openings.json': threeOpeningsSpec,
  'tight-bath.json': tightBathSpec,
  'narrow-hall.json': narrowHallSpec,
  'bedroom-window.json': bedroomWindowSpec,
};
