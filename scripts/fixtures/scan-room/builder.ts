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

// ── eight more, the review round of Clearance Check ─────────────────────────
// Each is a room an independent reviewer broke the first geometry on, or a
// figure the reviewer changed. The answer is worked by hand in each comment,
// in inches, and again in scripts/validate-scan-clearance.ts. Every room is
// 60 wide (x) by 96 deep (y) unless it says otherwise: left wall x = 0, right
// wall x = 60, bottom wall y = 0, far wall y = 96. The margin is 1.5.

/**
 * A SINK IN A VANITY. The cabinet is 36 wide and 22 deep on the left wall:
 * x 0 to 22, y 30 to 66. The sink is 20 wide and 16 deep, centred in it:
 * x 3 to 19, y 38 to 58. The sink's centre is inside the cabinet, so the
 * cabinet is the vanity it sits in: the front line starts at the cabinet's
 * face, x = 22, and runs to the right wall, x = 60.
 *   SINK, CLEAR SPACE IN FRONT   60 - 22 = 38. Figure 21: past 22.5, ROOMY.
 * (The first geometry started at the sink's own front, x = 19, inside the
 * cabinet, and met the cabinet's own face: 22 - 19 = 3 in, "Tight".)
 */
export function vanitySinkSpec(): RoomSpec {
  return {
    walls: ring([inPt(0, 0), inPt(60, 0), inPt(60, 96), inPt(0, 96)], 96 * IN),
    objects: [
      { category: 'storage', at: inPt(11, 48), w: 36 * IN, h: 34 * IN, d: 22 * IN, turnDeg: 90 },
      { category: 'sink', at: inPt(11, 48), w: 20 * IN, h: 8 * IN, d: 16 * IN, turnDeg: 90 },
    ],
    rotateDeg: 13,
    shift: { x: 0.4, y: 0.9 },
    section: 'bathroom',
  };
}

/**
 * A CABINET BESIDE THE FRONT HALF OF A TOILET. The toilet is 15 wide and 28
 * deep on the left wall, centre line y = 48: x 0 to 28, y 40.5 to 55.5. A
 * cabinet 12 by 14 stands beside the bowl: x 16 to 28, y 56 to 70. It does
 * not cross a line drawn sideways from the middle of the box (x = 14).
 *   TOILET, CENTRE LINE TO THE CABINET   56 - 48 = 8. Figure 15: under 13.5, TIGHT.
 *   TOILET, CENTRE LINE TO THE WALL      48 - 0 = 48 (the bottom wall). ROOMY.
 *   TOILET, CLEAR SPACE IN FRONT         the cabinet starts at y = 56, past the
 *       edge of the box (55.5), so it is not in front: 60 - 28 = 32. ROOMY.
 * (The first geometry ran one line from x = 14 and read 48 in "Roomy" on both sides.)
 */
export function toiletSideCabinetSpec(): RoomSpec {
  return {
    walls: ring([inPt(0, 0), inPt(60, 0), inPt(60, 96), inPt(0, 96)], 96 * IN),
    objects: [
      { category: 'toilet', at: inPt(14, 48), w: 15 * IN, h: 30 * IN, d: 28 * IN, turnDeg: 90 },
      { category: 'storage', at: inPt(22, 63), w: 12 * IN, h: 30 * IN, d: 14 * IN },
    ],
    rotateDeg: -19,
    shift: { x: -0.5, y: 0.3 },
    section: 'bathroom',
  };
}

/**
 * A TOILET NEAR A CORNER, ITS BOX AXES SWAPPED. The same box as a toilet
 * backed onto the left wall with its centre line 16 from the bottom wall
 * (x 0 to 28, y 8.5 to 23.5), but written the other way round: "width" 28
 * along x, "depth" 15 along y. The bottom wall is 8.5 from the box and the
 * left wall touches it: a wall within reach on BOTH axes.
 *   NO ROW FOR THIS TOILET. It is left out with "MAGE cannot tell which way
 *   this fixture faces. Tape it."
 * (The first geometry trusted the "depth" axis, took the bottom wall for the
 * back, and read 14 in "Close" to the left wall whatever the true distance.)
 */
export function toiletCornerSwappedSpec(): RoomSpec {
  return {
    walls: ring([inPt(0, 0), inPt(60, 0), inPt(60, 96), inPt(0, 96)], 96 * IN),
    objects: [{ category: 'toilet', at: inPt(14, 16), w: 28 * IN, h: 30 * IN, d: 15 * IN }],
    rotateDeg: 29,
    shift: { x: 0.9, y: -0.2 },
    section: 'bathroom',
  };
}

/**
 * SOMETHING AHEAD OF ONLY THE OUTER EDGE OF A BOWL. The toilet is the tight
 * bathroom's: x 0 to 28, y 44.5 to 59.5, centre line y = 52. A cabinet 10 deep
 * stands on the right wall covering only y 57 to 63: x 50 to 60. It is ahead
 * of the last 2.5 in of the bowl and of nothing nearer the centre.
 *   TOILET, CLEAR SPACE IN FRONT   50 - 28 = 22. Figure 21: 19.5 to 22.5, CLOSE.
 *   TOILET, EACH SIDE              the cabinet is ahead of the box, not beside
 *       it: 52 to the bottom wall and 96 - 52 = 44 to the far wall. ROOMY.
 * (The first geometry looked along y = 48.25, 52 and 55.75 only, missed the
 * cabinet and read 32 in "Roomy".)
 */
export function toiletFrontEdgeSpec(): RoomSpec {
  return {
    walls: ring([inPt(0, 0), inPt(60, 0), inPt(60, 96), inPt(0, 96)], 96 * IN),
    objects: [
      { category: 'toilet', at: inPt(14, 52), w: 15 * IN, h: 30 * IN, d: 28 * IN, turnDeg: 90 },
      { category: 'storage', at: inPt(55, 60), w: 6 * IN, h: 72 * IN, d: 10 * IN, turnDeg: 90 },
    ],
    rotateDeg: 41,
    shift: { x: -0.3, y: -0.8 },
    section: 'bathroom',
  };
}

/**
 * A BEDROOM WITH A JOG. 12 ft by 12 ft (144 by 144), 8 ft ceiling, with a
 * nook 36 wide and 14 deep off the far wall at the left: the left wall runs
 * from y = 0 to 158, and the nook's other wall is x = 36 from y = 144 to 158.
 *   NARROWEST WIDTH BETWEEN WALLS   36, between the left wall and the nook's
 *       wall. The stretch the two share is 14 long. 14 is under 2.5 x 36 = 90,
 *       so this is NOT a hallway: no figure, no state.
 *   LOWEST CEILING                  96. Set beside 84 as a room: ROOMY. (In New
 *       York City it is also set beside that city's 96: CLOSE.)
 * (The first geometry used the left wall's whole length, 158, called the room
 * a 36 in hallway, "Close", and dropped the bedroom's ceiling line.)
 */
export function bedroomJogSpec(): RoomSpec {
  return {
    walls: ring([inPt(0, 0), inPt(144, 0), inPt(144, 144), inPt(36, 144), inPt(36, 158), inPt(0, 158)], 96 * IN),
    rotateDeg: 8,
    shift: { x: 1.2, y: 0.4 },
    section: 'bedroom',
  };
}

/**
 * A BATHROOM WITH A CEILING AT 82.5. 60 by 96, nothing in it.
 *   LOWEST CEILING, ANYWHERE BUT NEW YORK CITY   82.5 beside 80 (6 ft 8 in):
 *       past 81.5, ROOMY.
 *   LOWEST CEILING, IN NEW YORK CITY             also beside that city's
 *       commonly cited 84 (7 ft): 84 - 1.5 = 82.5, so 82.5 is CLOSE. The row
 *       takes CLOSE and credits the New York City figure. Never ROOMY there.
 */
export function bathCeiling82Spec(): RoomSpec {
  return {
    walls: ring([inPt(0, 0), inPt(60, 0), inPt(60, 96), inPt(0, 96)], 82.5 * IN),
    rotateDeg: -4,
    shift: { x: 0.1, y: 0.6 },
    section: 'bathroom',
  };
}

/**
 * A BEDROOM WITH A CEILING AT 96. 132 by 144, nothing in it.
 *   LOWEST CEILING, IN BALTIMORE (or anywhere but New York City)   96 beside
 *       84 alone: past 85.5, ROOMY. There is NO 8 ft line.
 *   LOWEST CEILING, IN NEW YORK CITY   also beside that city's commonly cited
 *       96: on it, CLOSE.
 */
export function bedroom96Spec(): RoomSpec {
  return {
    walls: ring([inPt(0, 0), inPt(132, 0), inPt(132, 144), inPt(0, 144)], 96 * IN),
    rotateDeg: 15,
    shift: { x: -0.7, y: 0.2 },
    section: 'bedroom',
  };
}

/**
 * 22 IN IN FRONT OF A TOILET. The room is 50 wide. The toilet is 15 wide and
 * 28 deep on the left wall, centre line y = 48: its front is x = 28.
 *   TOILET, CLEAR SPACE IN FRONT   50 - 28 = 22, to the right wall. Read
 *       against 21 alone: 19.5 to 22.5, CLOSE. (It was "Tight" while the
 *       front was also read against 24.)
 *   TOILET, EACH SIDE              48 to the bottom wall and 48 to the far wall. ROOMY.
 */
export function toiletFront22Spec(): RoomSpec {
  return {
    walls: ring([inPt(0, 0), inPt(50, 0), inPt(50, 96), inPt(0, 96)], 96 * IN),
    objects: [{ category: 'toilet', at: inPt(14, 48), w: 15 * IN, h: 30 * IN, d: 28 * IN, turnDeg: 90 }],
    rotateDeg: -26,
    shift: { x: 0.5, y: 0.5 },
    section: 'bathroom',
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
  'vanity-sink.json': vanitySinkSpec,
  'toilet-side-cabinet.json': toiletSideCabinetSpec,
  'toilet-corner-swapped.json': toiletCornerSwappedSpec,
  'toilet-front-edge.json': toiletFrontEdgeSpec,
  'bedroom-jog.json': bedroomJogSpec,
  'bath-ceiling-82.json': bathCeiling82Spec,
  'bedroom-96.json': bedroom96Spec,
  'toilet-front-22.json': toiletFront22Spec,
};
