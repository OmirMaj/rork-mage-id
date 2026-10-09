// utils/roomScan/cutPlanCore.ts — drywall sheets for a room, as a cut layout a
// screen can draw.
//
// Scan The Room, the order list (lane SCANORDER, dark behind SCAN_ROOM_ENABLED).
// Pure: no React, no storage, no clock. Inches everywhere in this file, rounded
// to an eighth, because that is what a hanger reads off a tape.
//
// A PHONE SCAN CAN BE OFF BY AN INCH OR MORE. This file counts sheets from the
// scan's numbers and says how. It does not know where the studs are, which way
// the joists run or what the board has to clear. It is a list to check, not a
// promise.
//
// ── HOW A SURFACE IS HUNG ───────────────────────────────────────────────────
// A sheet is 48 in wide and 96, 120 or 144 in long. Sheets go up in STRIPS one
// sheet-width wide:
//   'across'   sheets lie on their side. Strips are 48 in courses, counted from
//              the ceiling down, so the ripped course is the one at the floor.
//   'upright'  sheets stand up. Strips are 48 in columns from the wall's start.
// A strip is filled end to end along its length. Where a door or a cased
// opening crosses the FULL width of a strip, the strip stops there and starts
// again on the other side (no board is bought for a hole). A window, or the
// part of a door a strip only partly crosses, is CUT OUT of the board that
// covers it: the piece is bought whole and the hole is recorded once, on that
// piece, as a cutout.
//
// ── OFFCUTS, THE WAY A HANGER USES THEM ─────────────────────────────────────
// Cutting a piece off a sheet leaves up to two offcuts: the end of the sheet,
// and the rip beside the piece. An offcut is kept only if BOTH its sides are at
// least `minOffcutIn` (12 in unless the person changes it); smaller is scrap.
//   * A run one sheet can span is hung in ONE piece: from a kept offcut if one
//     covers the whole run (the smallest that does), else from a new sheet. An
//     offcut is never used to add a joint to a wall a single sheet would span.
//   * A run longer than a sheet needs a joint anyway, so a kept offcut may
//     start it (the largest that fits the strip), the way a hanger starts the
//     next course with the last course's drop.
// Offcuts are not turned: a piece keeps the sheet's long edge along its strip.
// The longest runs are hung first, so their drops are there for the short ones.
// Every piece carries where on its sheet it came from, so a test can lay the
// pieces of one sheet back on the sheet and see they fit without overlapping.
//
// A gap under one inch (a 96 1/2 in wall under a 96 in sheet) is not boarded:
// the corner or the trim takes it. It is reported as `gapIn`, never hidden.
//
// ── THE RULES A HANGER WOULD HOLD THE LAYOUT TO (lane SCANORDER, review round) ──
//   MINIMUM END PIECE, 16 in. A run longer than a sheet is never finished with
//     a strip. The last piece is at least MIN_PIECE_IN long (one stud bay at
//     16 in on centre, so it lands on two framing members) and the piece before
//     it is shortened to make room: a 98 in wall on 96 in sheets is 82 + 16,
//     never 96 + 2. A piece is shorter than that only where the wall itself is
//     (the strip between a door and a corner): that piece is marked `narrow`.
//   STAGGER, 16 in. A butt joint is kept at least STAGGER_IN (one stud bay)
//     from every butt joint in the course above or below it. The run is tried
//     full sheets first, then from the other end, then starting with a half
//     sheet, then in equal pieces; the first that clears the joints already
//     hung is used. Where no way of cutting the run clears them, the joints
//     are counted in `stackedJoints` and the screen says so.
//   THE GAP AT THE FLOOR, 2 in. A wall up to FLOOR_GAP_IN taller than its
//     sheets is not given a strip of board at the floor: the baseboard covers
//     it. An 8 ft 1 1/8 in wall under 4x8 sheets leaves a 1 1/8 in gap, which
//     is reported as `floorGapIn`. This keeps the scan's own inch of error from
//     flipping the sheet count.
//   A LONGER SHEET. When the longest run on a surface is 1 to 24 in longer
//     than the sheet and the next sheet size would span it, `longerSheet` says
//     so. It is a suggestion for the screen: the layout is not changed.
// TWO WAYS ARE TRIED, and the one that buys fewer sheets is kept (`policy`):
//   'layout_first'  decide every joint by the rules above, then cut the pieces
//                   longest first, each from the smallest offcut that covers it;
//   'run_by_run'    take the runs longest first and, among the ways of cutting
//                   a run that keep the rules, use the one that opens the
//                   fewest new sheets from the offcuts on hand.
// Neither is proven to be the fewest sheets possible. The count is checked in
// scripts/validate-scan-order.ts against a bound worked out another way.

export const SHEET_WIDTH_IN = 48;
export const SHEET_LENGTHS_IN = { '4x8': 96, '4x10': 120, '4x12': 144 } as const;
export type SheetKey = keyof typeof SHEET_LENGTHS_IN;
export const SHEET_KEYS: readonly SheetKey[] = ['4x8', '4x10', '4x12'];
export type HangDirection = 'across' | 'upright';

/** Both sides of an offcut must be at least this long for it to be kept. */
export const DEFAULT_MIN_OFFCUT_IN = 12;
/** A gap narrower than this is left for the corner or the trim. */
export const SLIVER_IN = 1;
/** The shortest piece a butt joint may leave: one stud bay at 16 in on centre. */
export const MIN_PIECE_IN = 16;
/** Butt joints in neighbouring courses are kept at least this far apart: one stud bay. */
export const STAGGER_IN = 16;
/** A wall up to this much taller than its sheets leaves a gap at the floor for the baseboard, not a strip of board. */
export const FLOOR_GAP_IN = 2;
/** A run up to this much longer than the sheet gets the "a longer sheet removes the joint" suggestion. */
export const LONGER_SHEET_OVER_IN = 24;

const EPS = 1e-6;
/** To the nearest eighth of an inch. */
export const r8 = (n: number): number => Math.round(n * 8) / 8;

export interface RectIn { x0: number; x1: number; y0: number; y1: number }
export type OpeningKind = 'door' | 'window' | 'opening';
/** An opening on a wall face. `kind` rides along so the cut list can say "window cut out". */
export interface OpeningRect extends RectIn { kind?: OpeningKind }
export interface PtIn { x: number; y: number }

export interface WallSurface {
  kind: 'wall';
  id: string;
  widthIn: number;
  heightIn: number;
  /** Doors, windows and openings on the wall face, x from the wall's start, y up from the floor. */
  openings: OpeningRect[];
}
export interface CeilingSurface {
  kind: 'ceiling';
  id: string;
  /** The room outline in inches, any orientation. It is turned so the longest side runs along the sheets. */
  polygon: PtIn[];
}
export type CutSurface = WallSurface | CeilingSurface;

export interface CutPiece {
  surfaceId: string;
  /** On the surface: x along the wall (or the turned ceiling), y up from the floor (or across the ceiling). */
  x: number; y: number; w: number; h: number;
  /** 1-based number of the sheet this piece was cut from. */
  sheet: number;
  /** True when the piece came from a kept offcut, false when it opened a new sheet. */
  fromOffcut: boolean;
  /** Where on its sheet the piece was cut: `a` along the sheet's length, `c` across its width. */
  src: { a: number; c: number; alongIn: number; acrossIn: number };
  /** Holes cut out of this piece, in surface coordinates. Each opening's area appears once across all pieces. */
  cutouts: OpeningRect[];
  /** True when the piece is under MIN_PIECE_IN because the wall there is: the strip between a door and a corner. */
  narrow: boolean;
  /** Board area of the piece less its cutouts, square inches. */
  netAreaIn2: number;
  /** A ceiling piece whose rectangle is larger than the room under it (an angled wall): it is cut to the shape. */
  cutToShape: boolean;
}

export interface SurfacePlan {
  surfaceId: string;
  kind: 'wall' | 'ceiling';
  widthIn: number;
  heightIn: number;
  pieces: CutPiece[];
  /** Sheets first opened for this surface. The surfaces' numbers add up to the plan's `sheets`. */
  newSheets: number;
  offcutPieces: number;
  /** Total length of sub-inch gaps left unboarded on this surface. */
  gapIn: number;
  /** The height of the gap left at the floor for the baseboard (a wall up to FLOOR_GAP_IN taller than its sheets). 0 for none. */
  floorGapIn: number;
  /** Butt joints closer than STAGGER_IN to a joint in the next course, because no way of cutting the run cleared them. */
  stackedJoints: number;
  /** Set when the next sheet size would hang the longest run here with no butt joint. A suggestion: nothing is changed. */
  longerSheet: { sheet: SheetKey; overIn: number; along: 'length' | 'height' } | null;
  /** The ceiling's outline after turning, for drawing. Empty for a wall. */
  outline: PtIn[];
  /** The openings as hung (clipped to the wall). Empty for a ceiling. */
  openings: OpeningRect[];
}

export interface CutPlan {
  sheet: SheetKey;
  hang: HangDirection;
  minOffcutIn: number;
  minPieceIn: number;
  staggerIn: number;
  /** Which of the two ways of laying it out bought fewer sheets (see the top of this file). */
  policy: 'layout_first' | 'run_by_run';
  /** How many sheets to buy. */
  sheets: number;
  sheetAreaSF: number;
  /** sheets times the area of one sheet. */
  boardSF: number;
  /** The area the pieces cover, less cutouts. */
  hungSF: number;
  surfaces: SurfacePlan[];
}

export interface CutPlanOptions {
  sheet: SheetKey;
  hang: HangDirection;
  minOffcutIn?: number;
  /** false = never reuse an offcut (every piece opens a new sheet). For comparison only. */
  reuse?: boolean;
}

// ── small geometry ──────────────────────────────────────────────────────────
function unionRuns(runs: [number, number][]): [number, number][] {
  const sorted = runs.filter(([lo, hi]) => hi - lo > EPS).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + EPS) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

function complement(blocked: [number, number][], lo: number, hi: number): [number, number][] {
  const out: [number, number][] = [];
  let cursor = lo;
  for (const [b0, b1] of unionRuns(blocked)) {
    if (b0 > cursor + EPS) out.push([cursor, Math.min(b0, hi)]);
    cursor = Math.max(cursor, b1);
    if (cursor >= hi) break;
  }
  if (hi > cursor + EPS) out.push([cursor, hi]);
  return out;
}

/** Area covered by rectangles, overlaps counted once. */
export function rectUnionArea(rects: readonly RectIn[]): number {
  const live = rects.filter((r) => r.x1 - r.x0 > EPS && r.y1 - r.y0 > EPS);
  if (!live.length) return 0;
  const xs = [...new Set(live.flatMap((r) => [r.x0, r.x1]))].sort((p, q) => p - q);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const lo = xs[i];
    const hi = xs[i + 1];
    const tall = unionRuns(live.filter((r) => r.x0 <= lo + EPS && r.x1 >= hi - EPS).map((r) => [r.y0, r.y1] as [number, number]));
    area += (hi - lo) * tall.reduce((s, [a, b]) => s + (b - a), 0);
  }
  return area;
}

function polygonAreaIn2(poly: readonly PtIn[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

/** Where a horizontal line at `y` is inside the polygon, as [lo, hi] runs of x. */
function scanline(poly: readonly PtIn[], y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

/**
 * The stretch of x a band [y0, y1] of the polygon needs covered. Between two
 * corners the room's edges are straight, so the widest reach of each part is at
 * the top or the bottom of that slice: take both and keep the wider.
 */
function bandRuns(poly: readonly PtIn[], y0: number, y1: number): [number, number][] {
  const ys = [y0, y1, ...poly.map((p) => p.y).filter((y) => y > y0 + EPS && y < y1 - EPS)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    if (ys[i + 1] - ys[i] <= EPS) continue;
    const nudge = Math.min(1e-4, (ys[i + 1] - ys[i]) / 4);
    const lo = scanline(poly, ys[i] + nudge);
    const hi = scanline(poly, ys[i + 1] - nudge);
    if (lo.length === hi.length) for (let k = 0; k < lo.length; k++) runs.push([Math.min(lo[k][0], hi[k][0]), Math.max(lo[k][1], hi[k][1])]);
    else runs.push(...lo, ...hi);
  }
  return unionRuns(runs).map(([a, b]) => [r8(a), r8(b)] as [number, number]).filter(([a, b]) => b - a > EPS);
}

/** Turn the outline so its longest side lies along x, and move it to start at 0, 0. */
export function turnToLongestSide(polygon: readonly PtIn[]): PtIn[] {
  if (polygon.length < 3) return [];
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len > bestLen + EPS) { bestLen = len; best = i; }
  }
  const p = polygon[best];
  const q = polygon[(best + 1) % polygon.length];
  const ang = Math.atan2(q.y - p.y, q.x - p.x);
  const c = Math.cos(-ang);
  const s = Math.sin(-ang);
  const turned = polygon.map((v) => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c }));
  const minX = Math.min(...turned.map((v) => v.x));
  const minY = Math.min(...turned.map((v) => v.y));
  return turned.map((v) => ({ x: r8(v.x - minX), y: r8(v.y - minY) }));
}

// ── the hanging ─────────────────────────────────────────────────────────────
/** One stretch of one strip that needs board. `a` runs along the sheet's length, `c` across its width. */
interface Need {
  surface: number;
  a0: number; a1: number;
  c0: number; c1: number;
  /** Order within the surface, so equal needs are hung in a fixed order. */
  seq: number;
}
interface Offcut { sheet: number; a: number; c: number; alongIn: number; acrossIn: number }

interface Prepared {
  plan: SurfacePlan;
  needs: Need[];
  /** 'x' when the sheet's length runs along the surface's x. */
  alongAxis: 'x' | 'y';
  /** Area the surface really has under a rectangle, for `cutToShape`. Walls: null. */
  polygon: PtIn[] | null;
}

function clipOpenings(s: WallSurface): OpeningRect[] {
  const W = r8(s.widthIn);
  const H = r8(s.heightIn);
  return s.openings
    .map((o) => ({ x0: r8(Math.max(0, o.x0)), x1: r8(Math.min(W, o.x1)), y0: r8(Math.max(0, o.y0)), y1: r8(Math.min(H, o.y1)), ...(o.kind ? { kind: o.kind } : {}) }))
    .filter((o) => o.x1 - o.x0 > EPS && o.y1 - o.y0 > EPS);
}

function prepare(surface: CutSurface, index: number, hang: HangDirection, L: number): Prepared {
  const blank = (kind: 'wall' | 'ceiling', W: number, H: number, outline: PtIn[], openings: OpeningRect[]): SurfacePlan => ({
    surfaceId: surface.id, kind, widthIn: W, heightIn: H, pieces: [], newSheets: 0, offcutPieces: 0,
    gapIn: 0, floorGapIn: 0, stackedJoints: 0, longerSheet: null, outline, openings,
  });
  if (surface.kind === 'wall') {
    const W = r8(surface.widthIn);
    const H = r8(surface.heightIn);
    const openings = clipOpenings(surface);
    const plan = blank('wall', W, H, [], openings);
    const needs: Need[] = [];
    let seq = 0;
    if (!(W > 0) || !(H > 0)) return { plan, needs, alongAxis: 'x', polygon: null };
    if (hang === 'across') {
      // Courses from the ceiling down.
      for (let top = H; top > EPS; top -= SHEET_WIDTH_IN) {
        const c1 = top;
        const c0 = Math.max(0, top - SHEET_WIDTH_IN);
        // The wall is only a little taller than its sheets: a gap at the floor for the baseboard, not a strip of board.
        if (c0 <= EPS && c1 < H - EPS && c1 - c0 <= FLOOR_GAP_IN + EPS) { plan.floorGapIn = r8(c1 - c0); continue; }
        if (c1 - c0 < SLIVER_IN) { plan.gapIn += c1 - c0; continue; }
        const blocked = openings.filter((o) => o.y0 <= c0 + EPS && o.y1 >= c1 - EPS).map((o) => [o.x0, o.x1] as [number, number]);
        for (const [a0, a1] of complement(blocked, 0, W)) {
          if (a1 - a0 < SLIVER_IN) { plan.gapIn += a1 - a0; continue; }
          needs.push({ surface: index, a0, a1, c0, c1, seq: seq++ });
        }
      }
      return { plan, needs, alongAxis: 'x', polygon: null };
    }
    // Columns from the wall's start.
    for (let left = 0; left < W - EPS; left += SHEET_WIDTH_IN) {
      const c0 = left;
      const c1 = Math.min(W, left + SHEET_WIDTH_IN);
      if (c1 - c0 < SLIVER_IN) { plan.gapIn += c1 - c0; continue; }
      const blocked = openings.filter((o) => o.x0 <= c0 + EPS && o.x1 >= c1 - EPS).map((o) => [o.y0, o.y1] as [number, number]);
      for (const [lo, a1] of complement(blocked, 0, H)) {
        let a0 = lo;
        if (a1 - a0 < SLIVER_IN) { plan.gapIn += a1 - a0; continue; }
        // A column a little taller than its sheets is pushed up to the ceiling and leaves the gap at the floor.
        const over = (a1 - a0) - Math.floor((a1 - a0 + EPS) / L) * L;
        if (a0 <= EPS && a1 - a0 > L + EPS && over > EPS && over <= FLOOR_GAP_IN + EPS) { plan.floorGapIn = Math.max(plan.floorGapIn, r8(over)); a0 += over; }
        needs.push({ surface: index, a0, a1, c0, c1, seq: seq++ });
      }
    }
    return { plan, needs, alongAxis: 'y', polygon: null };
  }
  const outline = turnToLongestSide(surface.polygon);
  const W = outline.length ? r8(Math.max(...outline.map((p) => p.x))) : 0;
  const H = outline.length ? r8(Math.max(...outline.map((p) => p.y))) : 0;
  const plan = blank('ceiling', W, H, outline, []);
  const needs: Need[] = [];
  let seq = 0;
  for (let bottom = 0; bottom < H - EPS; bottom += SHEET_WIDTH_IN) {
    const c0 = bottom;
    const c1 = Math.min(H, bottom + SHEET_WIDTH_IN);
    if (c1 - c0 < SLIVER_IN) { plan.gapIn += c1 - c0; continue; }
    for (const [a0, a1] of bandRuns(outline, c0, c1)) {
      if (a1 - a0 < SLIVER_IN) { plan.gapIn += a1 - a0; continue; }
      needs.push({ surface: index, a0, a1, c0, c1, seq: seq++ });
    }
  }
  return { plan, needs, alongAxis: 'x', polygon: outline };
}

/**
 * The ways a run of `len` may be cut from sheets `L` long, each a list of piece
 * lengths in order along the run. Every piece is at least MIN_PIECE_IN (a run
 * one sheet spans is one piece, whatever its length). In order: full sheets
 * first, the same from the other end, starting with a half sheet, that from
 * the other end, and equal pieces.
 */
export function waysToCut(len: number, L: number): number[][] {
  if (len <= L + EPS) return [[len]];
  const forward = (n: number): number[] => {
    if (n <= L + EPS) return [n];
    const full = Math.floor((n + EPS) / L);
    const rest = n - full * L;
    const sheets = (k: number): number[] => Array.from({ length: k }, () => L);
    if (rest <= EPS) return sheets(full);
    if (rest >= MIN_PIECE_IN - EPS) return [...sheets(full), rest];
    // The piece before the last is shortened so the last is not a strip.
    return [...sheets(full - 1), L - (MIN_PIECE_IN - rest), MIN_PIECE_IN];
  };
  const full = forward(len);
  const half = [L / 2, ...forward(len - L / 2)];
  const k = Math.ceil((len - EPS) / L);
  const each = r8(len / k);
  const even = [...Array.from({ length: k - 1 }, () => each), len - each * (k - 1)];
  const seen = new Set<string>();
  return [full, [...full].reverse(), half, [...half].reverse(), even].filter((w) => {
    const key = w.join(',');
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

/**
 * Lay out sheets for a set of surfaces that share offcuts (the walls of one
 * room, or its ceiling). Returns how many sheets to buy and every piece.
 */
export function planSheets(surfaces: readonly CutSurface[], opts: CutPlanOptions): CutPlan {
  const L = SHEET_LENGTHS_IN[opts.sheet] ?? SHEET_LENGTHS_IN['4x8'];
  const minOff = Math.max(0, Number.isFinite(opts.minOffcutIn as number) ? (opts.minOffcutIn as number) : DEFAULT_MIN_OFFCUT_IN);
  const reuse = opts.reuse !== false;

  const attempt = (policy: CutPlan['policy']) => {
    const prepared = surfaces.map((s, i) => prepare(s, i, opts.hang, L));
    const pool: Offcut[] = [];
    let sheets = 0;
    let stacked = 0;
    /** Butt joints hung so far, by surface: where along the strip, and which strip. */
    const joints: { at: number; c0: number; c1: number }[][] = prepared.map(() => []);

    /** Take a piece from the smallest offcut that covers it, else from a new sheet. The drops go back in the pool. */
    const take = (from: Offcut[], len: number, across: number, fresh: () => number): { src: Offcut; isNew: boolean } => {
      const fits = from.filter((o) => o.acrossIn >= across - EPS && o.alongIn >= len - EPS)
        .sort((p, q) => p.alongIn * p.acrossIn - q.alongIn * q.acrossIn || p.sheet - q.sheet || p.a - q.a || p.c - q.c)[0];
      const src: Offcut = fits ?? { sheet: fresh(), a: 0, c: 0, alongIn: L, acrossIn: SHEET_WIDTH_IN };
      if (fits) from.splice(from.indexOf(fits), 1);
      // Cut the length first, then rip: the end of the sheet, and the rip beside the piece.
      for (const o of [
        { sheet: src.sheet, a: src.a + len, c: src.c, alongIn: src.alongIn - len, acrossIn: src.acrossIn },
        { sheet: src.sheet, a: src.a, c: src.c + across, alongIn: len, acrossIn: src.acrossIn - across },
      ]) if (reuse && o.alongIn >= minOff - EPS && o.acrossIn >= minOff - EPS && o.alongIn > EPS && o.acrossIn > EPS) from.push(o);
      return { src, isNew: !fits };
    };

    const hang = (n: Need, at: number, len: number, narrow: boolean): void => {
      const prep = prepared[n.surface];
      const across = n.c1 - n.c0;
      const { src, isNew } = take(pool, len, across, () => { sheets += 1; prep.plan.newSheets += 1; return sheets; });
      const rect: RectIn = prep.alongAxis === 'x'
        ? { x0: at, x1: at + len, y0: n.c0, y1: n.c1 }
        : { x0: n.c0, x1: n.c1, y0: at, y1: at + len };
      const cutouts = prep.plan.openings
        .map((o) => ({ ...o, x0: Math.max(o.x0, rect.x0), x1: Math.min(o.x1, rect.x1), y0: Math.max(o.y0, rect.y0), y1: Math.min(o.y1, rect.y1) }))
        .filter((o) => o.x1 - o.x0 > EPS && o.y1 - o.y0 > EPS);
      const gross = (rect.x1 - rect.x0) * (rect.y1 - rect.y0);
      let net = gross - rectUnionArea(cutouts);
      let cutToShape = false;
      if (prep.polygon) {
        // What the room has under this rectangle: clip the outline to it.
        const a = polygonAreaIn2(clipToRect(prep.polygon, rect));
        if (a < gross - 0.5) { cutToShape = true; net = a; }
      }
      if (!isNew) prep.plan.offcutPieces += 1;
      prep.plan.pieces.push({
        surfaceId: prep.plan.surfaceId,
        x: rect.x0, y: rect.y0, w: rect.x1 - rect.x0, h: rect.y1 - rect.y0,
        sheet: src.sheet, fromOffcut: !isNew,
        src: { a: src.a, c: src.c, alongIn: len, acrossIn: across },
        cutouts, narrow, netAreaIn2: net, cutToShape,
      });
    };

    /** Decide how one run is cut. Returns its pieces as [where, how long]. */
    const layRun = (n: Need): { at: number; len: number }[] => {
      const prep = prepared[n.surface];
      const across = n.c1 - n.c0;
      let len = n.a1 - n.a0;
      // A run under an inch longer than its sheets is not given a strip: the corner takes it.
      const over = len - Math.floor((len + EPS) / L) * L;
      if (len > L + EPS && over > EPS && over < SLIVER_IN) { prep.plan.gapIn += over; len -= over; }
      const near = joints[n.surface].filter((j) => Math.abs(j.c1 - n.c0) < EPS || Math.abs(j.c0 - n.c1) < EPS);
      const scored = waysToCut(len, L).map((way, index) => {
        const mine: number[] = [];
        let at = n.a0;
        for (let i = 0; i + 1 < way.length; i++) { at += way[i]; mine.push(at); }
        const close = mine.filter((j) => near.some((q) => Math.abs(q.at - j) < STAGGER_IN - EPS)).length;
        let fresh = 0;
        if (policy === 'run_by_run') {
          const trial = [...pool];
          for (const piece of [...way].sort((p, q) => q - p)) take(trial, piece, across, () => { fresh += 1; return -1; });
        }
        return { way, mine, close, fresh, index };
      });
      const best = scored.sort((p, q) => p.close - q.close || p.fresh - q.fresh || p.way.length - q.way.length || p.index - q.index)[0];
      stacked += best.close;
      prep.plan.stackedJoints += best.close;
      for (const at of best.mine) joints[n.surface].push({ at, c0: n.c0, c1: n.c1 });
      const out: { at: number; len: number }[] = [];
      let at = n.a0;
      for (const piece of best.way) { out.push({ at, len: piece }); at += piece; }
      return out;
    };

    const narrowRun = (n: Need): boolean => n.a1 - n.a0 < MIN_PIECE_IN - EPS;
    const bySize = (p: { n: Need; len: number; at: number }, q: { n: Need; len: number; at: number }): number =>
      (q.n.c1 - q.n.c0) - (p.n.c1 - p.n.c0) || q.len - p.len || p.n.surface - q.n.surface || p.n.seq - q.n.seq || p.at - q.at;
    const needs = prepared.flatMap((p) => p.needs);
    if (policy === 'layout_first') {
      // Every joint first, in the order the courses go up. Then the pieces, longest first.
      const laid = needs.flatMap((n) => layRun(n).map((x) => ({ n, ...x })));
      for (const x of laid.sort(bySize)) hang(x.n, x.at, x.len, narrowRun(x.n));
    } else {
      // Full-width strips before ripped ones, long runs before short ones.
      const order = [...needs].sort((p, q) => (q.c1 - q.c0) - (p.c1 - p.c0) || (q.a1 - q.a0) - (p.a1 - p.a0) || p.surface - q.surface || p.seq - q.seq);
      for (const n of order) for (const x of layRun(n).map((y) => ({ n, ...y })).sort(bySize)) hang(x.n, x.at, x.len, narrowRun(n));
    }

    for (const p of prepared) {
      // The next sheet size that would span the longest run here, when the run is only a little longer than this one.
      const longest = p.needs.reduce((m, n) => Math.max(m, n.a1 - n.a0), 0);
      const over = longest - L;
      const next = SHEET_KEYS.find((k) => SHEET_LENGTHS_IN[k] > L && SHEET_LENGTHS_IN[k] >= longest - EPS);
      if (over >= SLIVER_IN - EPS && over <= LONGER_SHEET_OVER_IN + EPS && next) p.plan.longerSheet = { sheet: next, overIn: r8(over), along: p.alongAxis === 'x' ? 'length' : 'height' };
      p.plan.gapIn = r8(p.plan.gapIn);
      p.plan.pieces.sort((a, b) => b.y - a.y || a.x - b.x);
    }
    return { policy, prepared, sheets, stacked, pieces: prepared.reduce((s, p) => s + p.plan.pieces.length, 0) };
  };

  const first = attempt('layout_first');
  const second = reuse ? attempt('run_by_run') : first;
  const won = second.sheets < first.sheets
    || (second.sheets === first.sheets && (second.stacked < first.stacked || (second.stacked === first.stacked && second.pieces < first.pieces)))
    ? second : first;

  const sheetAreaSF = (L * SHEET_WIDTH_IN) / 144;
  const hung = won.prepared.reduce((s, p) => s + p.plan.pieces.reduce((t, x) => t + x.netAreaIn2, 0), 0);
  return {
    sheet: opts.sheet, hang: opts.hang, minOffcutIn: minOff, minPieceIn: MIN_PIECE_IN, staggerIn: STAGGER_IN, policy: won.policy,
    sheets: won.sheets, sheetAreaSF, boardSF: won.sheets * sheetAreaSF, hungSF: hung / 144,
    surfaces: won.prepared.map((p) => p.plan),
  };
}

/** Sutherland-Hodgman: the part of a polygon inside an axis-aligned rectangle. */
function clipToRect(poly: readonly PtIn[], r: RectIn): PtIn[] {
  type Edge = { inside: (p: PtIn) => boolean; cross: (p: PtIn, q: PtIn) => PtIn };
  const atX = (x: number) => (p: PtIn, q: PtIn): PtIn => ({ x, y: p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y) });
  const atY = (y: number) => (p: PtIn, q: PtIn): PtIn => ({ y, x: p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x) });
  const edges: Edge[] = [
    { inside: (p) => p.x >= r.x0, cross: atX(r.x0) },
    { inside: (p) => p.x <= r.x1, cross: atX(r.x1) },
    { inside: (p) => p.y >= r.y0, cross: atY(r.y0) },
    { inside: (p) => p.y <= r.y1, cross: atY(r.y1) },
  ];
  let out = [...poly];
  for (const e of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const ci = e.inside(cur);
      const pi = e.inside(prev);
      if (ci) { if (!pi) out.push(e.cross(prev, cur)); out.push(cur); }
      else if (pi) out.push(e.cross(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

/**
 * Lay one sheet's pieces back on the sheet. Returns a sentence for every piece
 * that sticks out past the sheet or lies on another piece: an empty list means
 * no piece is larger than what it was cut from. For the tests.
 */
export function checkSheetCuts(plan: CutPlan): string[] {
  const L = SHEET_LENGTHS_IN[plan.sheet];
  const problems: string[] = [];
  const bySheet = new Map<number, CutPiece[]>();
  for (const s of plan.surfaces) for (const p of s.pieces) bySheet.set(p.sheet, [...(bySheet.get(p.sheet) ?? []), p]);
  for (const [sheet, pieces] of bySheet) {
    if (sheet < 1 || sheet > plan.sheets) problems.push(`a piece names sheet ${sheet} of ${plan.sheets}`);
    let area = 0;
    for (const p of pieces) {
      const { a, c, alongIn, acrossIn } = p.src;
      area += alongIn * acrossIn;
      if (a < -EPS || c < -EPS || a + alongIn > L + EPS || c + acrossIn > SHEET_WIDTH_IN + EPS) problems.push(`sheet ${sheet}: a ${alongIn} by ${acrossIn} piece at ${a}, ${c} runs off the sheet`);
      if (Math.abs(alongIn * acrossIn - p.w * p.h) > 1e-3) problems.push(`sheet ${sheet}: a piece is ${p.w} by ${p.h} on the wall and ${alongIn} by ${acrossIn} on the sheet`);
    }
    if (area > L * SHEET_WIDTH_IN + 1e-3) problems.push(`sheet ${sheet}: its pieces add to more than one sheet`);
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[i].src;
      const q = pieces[j].src;
      const overlapA = Math.min(p.a + p.alongIn, q.a + q.alongIn) - Math.max(p.a, q.a);
      const overlapC = Math.min(p.c + p.acrossIn, q.c + q.acrossIn) - Math.max(p.c, q.c);
      if (overlapA > 1e-3 && overlapC > 1e-3) problems.push(`sheet ${sheet}: two pieces are cut from the same part of the sheet`);
    }
  }
  return problems;
}
