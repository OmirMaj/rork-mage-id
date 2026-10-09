// utils/roomScan/orderListCore.ts — a room model to the list a contractor hands
// a supplier.
//
// Scan The Room, the order list (lane SCANORDER, dark behind SCAN_ROOM_ENABLED).
// Pure: no React, no storage, no clock. The room's TRUE shape is used (the
// outline as scanned and corrected), not a rectangle around it.
//
// A PHONE SCAN CAN BE OFF BY AN INCH OR MORE. CHECK BEFORE YOU ORDER. Every
// line here carries how it was worked out (`basis`), so the screen can show the
// assumption beside the number, and nothing in this file says how right a
// number is.
//
// WHAT IS MEASURED AND WHAT IS A RULE OF THUMB
//   measured from the room   drywall sheets (a cut layout, utils/roomScan/
//                            cutPlanCore), flooring and tile area, paint area,
//                            trim sticks (a cut list, trimPackCore);
//   a rule of thumb          screws, joint compound, tape and corner bead. Each
//                            such line has `ruleOfThumb: true` and its rule in
//                            `basis`; scripts/validate-scan-order.ts fails if
//                            one of them loses the mark. The waste added to
//                            flooring and tile is an allowance, shown with its
//                            percent and its reasons (`basis.reasons`).
//
// A QUANTITY THE PERSON TYPED IS KEPT. `options.typed[key]` replaces the worked
// number on that line, the line is marked `typed: true`, and the worked number
// stays beside it in `computed`. Changing a sheet size or a coat count never
// overwrites a typed quantity.
//
// A SUGGESTION NEVER CHANGES A QUANTITY BY ITSELF. What the phone has learned
// from his tape (utils/roomScan/learnCore) is not an input here. Only
// `options.longWallAddIn`, which is set when he ACCEPTS a suggestion, adds to
// the long walls, and only in this list's maths: the scan keeps its numbers.

import {
  DEFAULT_MIN_OFFCUT_IN, SHEET_KEYS, planSheets, r8, rectUnionArea,
  type CutPlan, type CutSurface, type HangDirection, type RectIn, type SheetKey,
} from './cutPlanCore';
import { CEILING_TOL_M, FLOOR_TOL_M, polygonArea, signedArea } from './geometryCore';
import { cleanStock, packTrim, type TrimPlan, type TrimRun } from './trimPackCore';
import type { RoomScan, RoomType, ScanOpening, ScanWall } from './types';
import { M2_TO_SF, metresToInches } from './units';

// ── the rules of thumb, each in one place ───────────────────────────────────
/** About one screw per square foot of board. */
export const SCREWS_PER_SF = 1;
/** A 5 lb box of 1 5/8 in drywall screws holds about this many. */
export const SCREWS_PER_BOX = 1000;
/** About one gallon of joint compound for each 100 square feet of board. */
export const COMPOUND_GAL_PER_100_SF = 1;
export const COMPOUND_BUCKET_GAL = 5;
/** About 370 feet of joint tape for each 1,000 square feet of board. */
export const TAPE_FT_PER_1000_SF = 370;
export const TAPE_ROLL_FT = 500;
export const CORNER_BEAD_STICK_FT = 10;
/** Waste on flooring and tile by layout, percent. */
export const LAYOUT_WASTE_PCT = { straight: 10, diagonal: 15, herringbone: 20 } as const;
/** Added when the room is not a plain rectangle: more cuts at the corners. */
export const SHAPE_WASTE_PCT = 5;
export const DEFAULT_SPREAD_SF_PER_GAL = 350;
export const DEFAULT_PRIMER_SPREAD_SF_PER_GAL = 300;
/** A wall at least this long is a "long wall" (the class his tape history is read by). */
export const LONG_WALL_IN = 144;
/** A corner turning less than this is a kink in a straight wall, not a corner. */
const CORNER_MIN_DEG = 10;

export type FloorLayout = keyof typeof LAYOUT_WASTE_PCT;
export const FLOOR_LAYOUTS: readonly FloorLayout[] = ['straight', 'diagonal', 'herringbone'];
export type OrderGroup = 'drywall' | 'flooring' | 'wallTile' | 'paint' | 'trim';
export const ORDER_GROUPS: readonly OrderGroup[] = ['drywall', 'flooring', 'wallTile', 'paint', 'trim'];
export type TrimKind = 'baseboard' | 'crown' | 'casing';
export const TRIM_KINDS: readonly TrimKind[] = ['baseboard', 'crown', 'casing'];

export interface OrderOptions {
  groups: Record<OrderGroup, boolean>;
  sheet: SheetKey;
  hang: HangDirection;
  minOffcutIn: number;
  floorKind: 'tile' | 'flooring';
  floorLayout: FloorLayout;
  /** null = the allowance worked out from the layout and the shape. A number = the person's own. */
  floorWastePct: number | null;
  /** Square feet in one box, when he knows it. null = the line is in square feet. */
  boxSF: number | null;
  /** Walls marked as wet walls, for wall tile. */
  wetWallIds: string[];
  /** How high the wall tile goes, inches. null = to the ceiling. */
  wetHeightIn: number | null;
  wallTileWastePct: number | null;
  coats: number;
  spreadSFPerGal: number;
  primer: boolean;
  primerSpreadSFPerGal: number;
  stockFt: number[];
  crown: boolean;
  casingWindows: boolean;
  /** Added to every trim piece for the cut at each end, inches. */
  trimAllowanceIn: number;
  /** Inches added to each long wall that was NOT taped, set only by accepting a suggestion. 0 = none. */
  longWallAddIn: number;
  /** Quantities typed over the worked ones, by line key. */
  typed: Record<string, number>;
}

export function defaultOrderOptions(roomType: RoomType): OrderOptions {
  const wet = roomType === 'bathroom' || roomType === 'kitchen';
  return {
    groups: { drywall: wet, flooring: true, wallTile: false, paint: true, trim: true },
    sheet: '4x8', hang: 'across', minOffcutIn: DEFAULT_MIN_OFFCUT_IN,
    floorKind: roomType === 'bathroom' ? 'tile' : 'flooring',
    floorLayout: 'straight', floorWastePct: null, boxSF: null,
    wetWallIds: [], wetHeightIn: null, wallTileWastePct: null,
    coats: 2, spreadSFPerGal: DEFAULT_SPREAD_SF_PER_GAL, primer: true, primerSpreadSFPerGal: DEFAULT_PRIMER_SPREAD_SF_PER_GAL,
    stockFt: [8, 12, 16], crown: true, casingWindows: true, trimAllowanceIn: 0,
    longWallAddIn: 0, typed: {},
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const posNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Saved options read back from the phone. Never throws; anything unreadable falls back to the default for the room. */
export function parseOrderOptions(raw: unknown, roomType: RoomType): OrderOptions {
  const d = defaultOrderOptions(roomType);
  if (!isObj(raw)) return d;
  const groups = { ...d.groups };
  if (isObj(raw.groups)) for (const g of ORDER_GROUPS) if (typeof raw.groups[g] === 'boolean') groups[g] = raw.groups[g] as boolean;
  const typed: Record<string, number> = {};
  if (isObj(raw.typed)) for (const [k, v] of Object.entries(raw.typed)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) typed[k] = v;
  const pct = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null);
  return {
    groups,
    sheet: (SHEET_KEYS as readonly string[]).includes(raw.sheet as string) ? (raw.sheet as SheetKey) : d.sheet,
    hang: raw.hang === 'upright' ? 'upright' : raw.hang === 'across' ? 'across' : d.hang,
    minOffcutIn: posNum(raw.minOffcutIn) ? raw.minOffcutIn : d.minOffcutIn,
    floorKind: raw.floorKind === 'tile' || raw.floorKind === 'flooring' ? raw.floorKind : d.floorKind,
    floorLayout: (FLOOR_LAYOUTS as readonly string[]).includes(raw.floorLayout as string) ? (raw.floorLayout as FloorLayout) : d.floorLayout,
    floorWastePct: pct(raw.floorWastePct),
    boxSF: posNum(raw.boxSF) ? raw.boxSF : null,
    wetWallIds: Array.isArray(raw.wetWallIds) ? raw.wetWallIds.filter((x): x is string => typeof x === 'string') : [],
    wetHeightIn: posNum(raw.wetHeightIn) ? raw.wetHeightIn : null,
    wallTileWastePct: pct(raw.wallTileWastePct),
    coats: posNum(raw.coats) ? Math.min(4, Math.round(raw.coats)) : d.coats,
    spreadSFPerGal: posNum(raw.spreadSFPerGal) ? raw.spreadSFPerGal : d.spreadSFPerGal,
    primer: typeof raw.primer === 'boolean' ? raw.primer : d.primer,
    primerSpreadSFPerGal: posNum(raw.primerSpreadSFPerGal) ? raw.primerSpreadSFPerGal : d.primerSpreadSFPerGal,
    stockFt: Array.isArray(raw.stockFt) ? cleanStock(raw.stockFt.filter((x): x is number => typeof x === 'number')) : d.stockFt,
    crown: typeof raw.crown === 'boolean' ? raw.crown : d.crown,
    casingWindows: typeof raw.casingWindows === 'boolean' ? raw.casingWindows : d.casingWindows,
    trimAllowanceIn: typeof raw.trimAllowanceIn === 'number' && raw.trimAllowanceIn >= 0 && raw.trimAllowanceIn <= 12 ? raw.trimAllowanceIn : d.trimAllowanceIn,
    longWallAddIn: typeof raw.longWallAddIn === 'number' && raw.longWallAddIn > 0 && raw.longWallAddIn <= 6 ? raw.longWallAddIn : 0,
    typed,
  };
}

export type OrderUnit = 'sheet' | 'box' | 'bucket' | 'roll' | 'stick' | 'sqft' | 'gallon';

/** Why an allowance is what it is. */
export type WasteReason =
  | { kind: 'layout'; layout: FloorLayout; pct: number }
  | { kind: 'shape'; pct: number; corners: number; angled: boolean }
  | { kind: 'typed'; pct: number };

/** How a line was worked out, for the sentence beside the number. */
export type OrderBasis =
  | { kind: 'sheets'; where: 'walls' | 'ceiling'; sheet: SheetKey; hang: HangDirection; minOffcutIn: number; hungSF: number; boardSF: number; offcutPieces: number }
  | { kind: 'screws'; boardSF: number; perSF: number; perBox: number }
  | { kind: 'compound'; boardSF: number; galPer100SF: number; bucketGal: number }
  | { kind: 'tape'; boardSF: number; ftPer1000SF: number; rollFt: number }
  | { kind: 'cornerBead'; corners: number; stickFt: number; sticksPerCorner: number }
  | { kind: 'area'; what: 'floor' | 'wallTile'; netSF: number; wastePct: number; reasons: WasteReason[]; orderSF: number; boxSF: number | null; walls: number; heightIn: number | null }
  | { kind: 'paint'; what: 'walls' | 'ceiling' | 'primer'; netSF: number; coats: number; spreadSFPerGal: number; workedGal: number }
  | { kind: 'trim'; what: TrimKind; stockFt: number; runFt: number; pieces: number; joints: number; boughtFt: number; method: TrimPlan['method'] };

export interface OrderLine {
  /** Stable for one room: 'drywall_walls', 'paint_walls', 'baseboard:16' ... */
  key: string;
  group: OrderGroup;
  unit: OrderUnit;
  /** The worked number. */
  computed: number;
  /** What the list says to buy: the typed number when there is one, else the worked one. */
  quantity: number;
  typed: boolean;
  ruleOfThumb: boolean;
  basis: OrderBasis;
  /** What the room itself measures for this line before any waste, for the later "bought versus scanned" comparison. null for a derived line. */
  net: { quantity: number; unit: 'SF' | 'LF' } | null;
}

export type OrderGap = 'floor_not_known' | 'ceiling_height_missing' | 'no_wet_wall';

export interface WallUsed {
  wallId: string;
  label: string;
  /** The length this list used, inches. */
  lengthIn: number;
  heightIn: number;
  /** Inches added by an accepted suggestion. 0 for a taped wall and for a short one. */
  addedIn: number;
  taped: boolean;
}

export interface OrderList {
  scanId: string;
  options: OrderOptions;
  lines: OrderLine[];
  /** Layouts to draw. null when the group is off or the room cannot give it. */
  wallPlan: CutPlan | null;
  ceilingPlan: CutPlan | null;
  trimPlans: Partial<Record<TrimKind, TrimPlan>>;
  walls: WallUsed[];
  outsideCorners: number;
  /** What the room could not give, each a code the screen puts into words. */
  gaps: OrderGap[];
}

// ── the room, in inches ─────────────────────────────────────────────────────
function wallHeightM(w: ScanWall, scan: RoomScan): number {
  return w.heightM > 0 ? w.heightM : scan.ceilingHeightM.known ? scan.ceilingHeightM.typical : 0;
}

/** Corners of the outline that stick INTO the room (an outside corner, which takes corner bead). */
export function outsideCornerCount(scan: Pick<RoomScan, 'floor'>): number {
  const f = scan.floor;
  if (f.length < 3) return 0;
  const ccw = signedArea(f) > 0 ? 1 : -1;
  let n = 0;
  for (let i = 0; i < f.length; i++) {
    const a = f[(i + f.length - 1) % f.length];
    const b = f[i];
    const c = f[(i + 1) % f.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    const turn = (Math.atan2(cross, dot) * 180) / Math.PI * ccw;
    if (turn < -CORNER_MIN_DEG) n += 1;
  }
  return n;
}

/** How the room's shape adds to waste: its corner count, and whether any corner is off square. */
export function roomShape(scan: Pick<RoomScan, 'floor'>): { corners: number; angled: boolean; plain: boolean } {
  const f = scan.floor;
  let corners = 0;
  let angled = false;
  for (let i = 0; i < f.length; i++) {
    const a = f[(i + f.length - 1) % f.length];
    const b = f[i];
    const c = f[(i + 1) % f.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    const turn = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
    if (turn < CORNER_MIN_DEG) continue;
    corners += 1;
    if (Math.abs(turn - 90) > 3) angled = true;
  }
  return { corners, angled, plain: corners === 4 && !angled };
}

function openingRect(o: ScanOpening, wall: ScanWall, heightIn: number): RectIn {
  const x0 = Math.max(0, metresToInches(o.offsetM));
  const x1 = Math.min(metresToInches(wall.lengthM), metresToInches(o.offsetM + o.widthM));
  const y0 = Math.max(0, metresToInches(o.sillM));
  const y1 = Math.min(heightIn, metresToInches(o.sillM + o.heightM));
  return { x0: r8(x0), x1: r8(x1), y0: r8(y0), y1: r8(y1) };
}

function complementRuns(blocked: [number, number][], hi: number): [number, number][] {
  const sorted = blocked.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of sorted) {
    if (a > cursor + 1e-6) out.push([cursor, Math.min(a, hi)]);
    cursor = Math.max(cursor, b);
  }
  if (hi > cursor + 1e-6) out.push([cursor, hi]);
  return out;
}

const ceilTo = (n: number): number => (n <= 1e-9 ? 0 : Math.ceil(n - 1e-9));

/** Build the order list for one room. Reads the scan only; nothing is saved or sent from here. */
export function buildOrderList(scan: RoomScan, options: OrderOptions): OrderList {
  const o = options;
  const outline = scan.walls.filter((w) => w.onOutline);
  const closed = scan.closure.closed && scan.floor.length >= 3;
  const heightKnown = scan.ceilingHeightM.known;
  const gaps: OrderGap[] = [];
  const add = o.longWallAddIn > 0 ? o.longWallAddIn : 0;

  // Each opening once, on a wall of the outline.
  const seen = new Set<string>();
  const openings = scan.openings.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  const byWall = new Map<string, ScanOpening[]>();
  for (const op of openings) {
    if (!op.wallId || !outline.some((w) => w.id === op.wallId)) continue;
    byWall.set(op.wallId, [...(byWall.get(op.wallId) ?? []), op]);
  }

  const walls: WallUsed[] = outline.map((w) => {
    const scanned = r8(metresToInches(w.lengthM));
    const taped = w.lengthSource === 'typed';
    const addedIn = !taped && add > 0 && scanned >= LONG_WALL_IN ? add : 0;
    return { wallId: w.id, label: w.label, lengthIn: r8(scanned + addedIn), heightIn: r8(metresToInches(wallHeightM(w, scan))), addedIn, taped };
  });
  const used = new Map(walls.map((w) => [w.wallId, w]));
  const rectsOf = (w: ScanWall): RectIn[] => (byWall.get(w.id) ?? []).map((op) => openingRect(op, w, (used.get(w.id) as WallUsed).heightIn));

  const lines: OrderLine[] = [];
  const push = (line: Omit<OrderLine, 'quantity' | 'typed'>) => {
    const t = o.typed[line.key];
    const typed = typeof t === 'number' && Number.isFinite(t) && t >= 0;
    lines.push({ ...line, quantity: typed ? t : line.computed, typed });
  };

  // ── drywall ──
  let wallPlan: CutPlan | null = null;
  let ceilingPlan: CutPlan | null = null;
  const corners = closed ? outsideCornerCount(scan) : 0;
  if (o.groups.drywall) {
    if (!heightKnown) gaps.push('ceiling_height_missing');
    else {
      const surfaces: CutSurface[] = outline.map((w) => {
        const u = used.get(w.id) as WallUsed;
        return { kind: 'wall', id: w.id, widthIn: u.lengthIn, heightIn: u.heightIn, openings: rectsOf(w) };
      });
      wallPlan = planSheets(surfaces, { sheet: o.sheet, hang: o.hang, minOffcutIn: o.minOffcutIn });
      push({
        key: 'drywall_walls', group: 'drywall', unit: 'sheet', computed: wallPlan.sheets, ruleOfThumb: false,
        basis: { kind: 'sheets', where: 'walls', sheet: o.sheet, hang: o.hang, minOffcutIn: wallPlan.minOffcutIn, hungSF: wallPlan.hungSF, boardSF: wallPlan.boardSF, offcutPieces: wallPlan.surfaces.reduce((s, x) => s + x.offcutPieces, 0) },
        net: { quantity: wallPlan.hungSF, unit: 'SF' },
      });
    }
    if (!closed) gaps.push('floor_not_known');
    else {
      const polygon = scan.floor.map((p) => ({ x: metresToInches(p.x), y: metresToInches(p.y) }));
      ceilingPlan = planSheets([{ kind: 'ceiling', id: 'ceiling', polygon }], { sheet: o.sheet, hang: 'across', minOffcutIn: o.minOffcutIn });
      push({
        key: 'drywall_ceiling', group: 'drywall', unit: 'sheet', computed: ceilingPlan.sheets, ruleOfThumb: false,
        basis: { kind: 'sheets', where: 'ceiling', sheet: o.sheet, hang: 'across', minOffcutIn: ceilingPlan.minOffcutIn, hungSF: ceilingPlan.hungSF, boardSF: ceilingPlan.boardSF, offcutPieces: ceilingPlan.surfaces.reduce((s, x) => s + x.offcutPieces, 0) },
        net: { quantity: ceilingPlan.hungSF, unit: 'SF' },
      });
    }
    // The four below are rules of thumb on the board bought, and say so.
    const sheetQty = (key: string, plan: CutPlan | null): number => {
      if (!plan) return 0;
      const t = o.typed[key];
      return typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : plan.sheets;
    };
    const boardSF = sheetQty('drywall_walls', wallPlan) * (wallPlan?.sheetAreaSF ?? 0) + sheetQty('drywall_ceiling', ceilingPlan) * (ceilingPlan?.sheetAreaSF ?? 0);
    if (boardSF > 0) {
      push({ key: 'screws', group: 'drywall', unit: 'box', computed: ceilTo((boardSF * SCREWS_PER_SF) / SCREWS_PER_BOX), ruleOfThumb: true, basis: { kind: 'screws', boardSF, perSF: SCREWS_PER_SF, perBox: SCREWS_PER_BOX }, net: null });
      push({ key: 'compound', group: 'drywall', unit: 'bucket', computed: ceilTo(((boardSF / 100) * COMPOUND_GAL_PER_100_SF) / COMPOUND_BUCKET_GAL), ruleOfThumb: true, basis: { kind: 'compound', boardSF, galPer100SF: COMPOUND_GAL_PER_100_SF, bucketGal: COMPOUND_BUCKET_GAL }, net: null });
      push({ key: 'tape', group: 'drywall', unit: 'roll', computed: ceilTo(((boardSF / 1000) * TAPE_FT_PER_1000_SF) / TAPE_ROLL_FT), ruleOfThumb: true, basis: { kind: 'tape', boardSF, ftPer1000SF: TAPE_FT_PER_1000_SF, rollFt: TAPE_ROLL_FT }, net: null });
      const tallest = walls.reduce((m, w) => Math.max(m, w.heightIn), 0);
      const perCorner = Math.max(1, Math.ceil((tallest - 1e-6) / (CORNER_BEAD_STICK_FT * 12)));
      push({ key: 'corner_bead', group: 'drywall', unit: 'stick', computed: corners * perCorner, ruleOfThumb: true, basis: { kind: 'cornerBead', corners, stickFt: CORNER_BEAD_STICK_FT, sticksPerCorner: perCorner }, net: null });
    }
  }

  // ── flooring or floor tile ──
  const shape = roomShape(scan);
  const areaLine = (key: string, group: OrderGroup, what: 'floor' | 'wallTile', netSF: number, typedPct: number | null, wallCount: number, heightIn: number | null) => {
    const reasons: WasteReason[] = typedPct != null
      ? [{ kind: 'typed', pct: typedPct }]
      : [
        { kind: 'layout', layout: o.floorLayout, pct: LAYOUT_WASTE_PCT[o.floorLayout] },
        ...(what === 'floor' && !shape.plain ? [{ kind: 'shape' as const, pct: SHAPE_WASTE_PCT, corners: shape.corners, angled: shape.angled }] : []),
      ];
    const wastePct = reasons.reduce((s, r) => s + r.pct, 0);
    const orderSF = ceilTo(netSF * (1 + wastePct / 100));
    const boxSF = what === 'floor' ? o.boxSF : null;
    push({
      key, group, unit: boxSF ? 'box' : 'sqft', computed: boxSF ? ceilTo(orderSF / boxSF) : orderSF,
      // The area is measured. The allowance on top of it is shown with its reasons.
      ruleOfThumb: false,
      basis: { kind: 'area', what, netSF, wastePct, reasons, orderSF, boxSF, walls: wallCount, heightIn },
      net: { quantity: netSF, unit: 'SF' },
    });
  };
  if (o.groups.flooring) {
    if (!closed) { if (!gaps.includes('floor_not_known')) gaps.push('floor_not_known'); }
    else areaLine('floor', 'flooring', 'floor', polygonArea(scan.floor) * M2_TO_SF, o.floorWastePct, 0, null);
  }

  // ── wall tile on the wet walls he marked ──
  if (o.groups.wallTile) {
    const wet = outline.filter((w) => o.wetWallIds.includes(w.id));
    if (!wet.length) gaps.push('no_wet_wall');
    else if (!heightKnown) { if (!gaps.includes('ceiling_height_missing')) gaps.push('ceiling_height_missing'); }
    else {
      let in2 = 0;
      for (const w of wet) {
        const u = used.get(w.id) as WallUsed;
        const top = o.wetHeightIn != null ? Math.min(o.wetHeightIn, u.heightIn) : u.heightIn;
        const holes = rectsOf(w).map((r) => ({ ...r, y1: Math.min(r.y1, top) }));
        in2 += u.lengthIn * top - rectUnionArea(holes);
      }
      areaLine('wall_tile', 'wallTile', 'wallTile', Math.max(0, in2) / 144, o.wallTileWastePct, wet.length, o.wetHeightIn);
    }
  }

  // ── paint ──
  if (o.groups.paint) {
    const coats = Math.max(1, Math.round(o.coats));
    let wallSF: number | null = null;
    if (!heightKnown) { if (!gaps.includes('ceiling_height_missing')) gaps.push('ceiling_height_missing'); }
    else {
      let in2 = 0;
      for (const w of outline) {
        const u = used.get(w.id) as WallUsed;
        in2 += u.lengthIn * u.heightIn - rectUnionArea(rectsOf(w));
      }
      wallSF = Math.max(0, in2) / 144;
      const worked = (wallSF * coats) / o.spreadSFPerGal;
      push({ key: 'paint_walls', group: 'paint', unit: 'gallon', computed: ceilTo(worked), ruleOfThumb: false, basis: { kind: 'paint', what: 'walls', netSF: wallSF, coats, spreadSFPerGal: o.spreadSFPerGal, workedGal: worked }, net: { quantity: wallSF, unit: 'SF' } });
    }
    let ceilSF: number | null = null;
    if (!closed) { if (!gaps.includes('floor_not_known')) gaps.push('floor_not_known'); }
    else {
      ceilSF = polygonArea(scan.floor) * M2_TO_SF;
      const worked = (ceilSF * coats) / o.spreadSFPerGal;
      push({ key: 'paint_ceiling', group: 'paint', unit: 'gallon', computed: ceilTo(worked), ruleOfThumb: false, basis: { kind: 'paint', what: 'ceiling', netSF: ceilSF, coats, spreadSFPerGal: o.spreadSFPerGal, workedGal: worked }, net: { quantity: ceilSF, unit: 'SF' } });
    }
    if (o.primer && (wallSF != null || ceilSF != null)) {
      const netSF = (wallSF ?? 0) + (ceilSF ?? 0);
      const worked = netSF / o.primerSpreadSFPerGal;
      push({ key: 'primer', group: 'paint', unit: 'gallon', computed: ceilTo(worked), ruleOfThumb: false, basis: { kind: 'paint', what: 'primer', netSF, coats: 1, spreadSFPerGal: o.primerSpreadSFPerGal, workedGal: worked }, net: { quantity: netSF, unit: 'SF' } });
    }
  }

  // ── trim ──
  const trimPlans: Partial<Record<TrimKind, TrimPlan>> = {};
  if (o.groups.trim) {
    const stock = cleanStock(o.stockFt);
    const base: TrimRun[] = [];
    const crown: TrimRun[] = [];
    const casing: TrimRun[] = [];
    for (const w of outline) {
      const u = used.get(w.id) as WallUsed;
      const atFloor: [number, number][] = [];
      const atCeiling: [number, number][] = [];
      for (const op of byWall.get(w.id) ?? []) {
        const r = openingRect(op, w, u.heightIn);
        if (!(r.x1 > r.x0)) continue;
        if (op.kind === 'door' || (op.kind === 'opening' && op.sillM < FLOOR_TOL_M)) atFloor.push([r.x0, r.x1]);
        const h = wallHeightM(w, scan);
        if (op.kind === 'opening' && h > 0 && op.sillM + op.heightM >= h - CEILING_TOL_M) atCeiling.push([r.x0, r.x1]);
      }
      complementRuns(atFloor, u.lengthIn).forEach(([a, b], i) => base.push({ id: `${w.id}:base:${i}`, lengthIn: b - a, on: w.label, what: 'wall' }));
      complementRuns(atCeiling, u.lengthIn).forEach(([a, b], i) => crown.push({ id: `${w.id}:crown:${i}`, lengthIn: b - a, on: w.label, what: 'wall' }));
    }
    for (const op of openings) {
      if (op.kind === 'opening') continue;
      if (op.kind === 'window' && !o.casingWindows) continue;
      const wIn = r8(metresToInches(op.widthM));
      const hIn = r8(metresToInches(op.heightM));
      casing.push({ id: `${op.id}:leg:1`, lengthIn: hIn, on: op.id, what: 'leg' }, { id: `${op.id}:leg:2`, lengthIn: hIn, on: op.id, what: 'leg' }, { id: `${op.id}:head`, lengthIn: wIn, on: op.id, what: 'head' });
      // A window is cased on four sides (a picture frame). A door has no sill.
      if (op.kind === 'window') casing.push({ id: `${op.id}:sill`, lengthIn: wIn, on: op.id, what: 'sill' });
    }
    const kinds: [TrimKind, TrimRun[], boolean][] = [['baseboard', base, true], ['crown', crown, o.crown], ['casing', casing, true]];
    for (const [kind, runs, on] of kinds) {
      if (!on || !runs.length) continue;
      const plan = packTrim(runs, stock, o.trimAllowanceIn);
      if (!plan.stickCount) continue;
      trimPlans[kind] = plan;
      const runFt = runs.reduce((s, r) => s + r.lengthIn, 0) / 12;
      for (const c of plan.counts) {
        push({
          key: `${kind}:${c.stockFt}`, group: 'trim', unit: 'stick', computed: c.count, ruleOfThumb: false,
          basis: { kind: 'trim', what: kind, stockFt: c.stockFt, runFt, pieces: plan.pieceCount, joints: plan.joints, boughtFt: plan.boughtFt, method: plan.method },
          net: { quantity: runFt, unit: 'LF' },
        });
      }
    }
  }

  // A typed quantity for a line the options no longer produce is not dropped: it stays in `options.typed` and comes back with the line.
  return { scanId: scan.id, options: o, lines, wallPlan, ceilingPlan, trimPlans, walls, outsideCorners: corners, gaps };
}

/** The lines a supplier would be handed: a quantity above zero. */
export function orderLinesToBuy(list: OrderList): OrderLine[] {
  return list.lines.filter((l) => l.quantity > 0);
}

// ── the list as plain text ──────────────────────────────────────────────────
/** The words the text needs, passed in so the core holds no English of its own (hooks/useScanOrderCopy.ts). */
export interface OrderTextWords {
  title: (room: string) => string;
  notice: string;
  group: (g: OrderGroup) => string;
  line: (l: OrderLine) => string;
  quantity: (l: OrderLine) => string;
  typedMark: string;
  ruleOfThumbMark: string;
  assumption: (l: OrderLine) => string;
  cutListHeading: (kind: TrimKind) => string;
  stick: (stockFt: number, cuts: string[]) => string;
  length: (inches: number) => string;
}

/** The order list as plain text for a supplier: every line, how it was worked out, and the trim cut list. */
export function orderListText(list: OrderList, roomName: string, w: OrderTextWords): string {
  const out: string[] = [w.title(roomName.trim()), w.notice, ''];
  for (const g of ORDER_GROUPS) {
    const rows = orderLinesToBuy(list).filter((l) => l.group === g);
    if (!rows.length) continue;
    out.push(w.group(g));
    for (const l of rows) {
      const marks = [l.typed ? w.typedMark : '', l.ruleOfThumb ? w.ruleOfThumbMark : ''].filter(Boolean).join(', ');
      out.push(`  ${w.line(l)}: ${w.quantity(l)}${marks ? ` (${marks})` : ''}`);
      out.push(`    ${w.assumption(l)}`);
    }
    out.push('');
  }
  for (const kind of TRIM_KINDS) {
    const plan = list.trimPlans[kind];
    if (!plan || !list.options.groups.trim) continue;
    out.push(w.cutListHeading(kind));
    for (const s of plan.sticks) out.push(`  ${w.stick(s.stockFt, s.cuts.map((c) => w.length(c.lengthIn)))}`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}

// ── sending it somewhere, only after a yes ──────────────────────────────────
export type OrderSendVia = 'copy' | 'share' | 'estimate';

/** What the list said at the moment it left the screen, kept with the scan for the later "bought versus scanned" comparison. */
export interface OrderSnapshot {
  at: string;
  via: OrderSendVia;
  lines: { key: string; group: OrderGroup; unit: OrderUnit; quantity: number; typed: boolean; net: OrderLine['net'] }[];
}

/**
 * The record of a list that is about to leave the screen, or null.
 *
 * `confirmed` must be the literal `true` from the person's tap on that
 * destination's confirm sheet. Without it this returns null, and the three
 * senders (copy, share, estimate) take their text or their lines only from a
 * non-null result: there is no path that sends a list he has not said yes to.
 */
export function confirmOrderSend(args: { confirmed: boolean; via: OrderSendVia; list: OrderList; at: string }): OrderSnapshot | null {
  if (args.confirmed !== true) return null;
  const lines = orderLinesToBuy(args.list);
  if (!lines.length) return null;
  return { at: args.at, via: args.via, lines: lines.map((l) => ({ key: l.key, group: l.group, unit: l.unit, quantity: l.quantity, typed: l.typed, net: l.net })) };
}
