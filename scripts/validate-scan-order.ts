// validate-scan-order — Scan The Room, the order list and the learning loop
// (lane SCANORDER). Dark behind SCAN_ROOM_ENABLED = false.
//
// WHAT IT PROVES, with no phone. Every room is a hand-built fixture
// (scripts/fixtures/scan-room): the bathroom, the L-shaped room, a room with a
// bay and angled walls, a long hallway, and a room with three openings on one
// wall. NOTHING HERE HAS BEEN CHECKED AGAINST A REAL SCAN.
//
// A. THE ORDER LIST (utils/roomScan/orderListCore, cutPlanCore, trimPackCore)
//    O1  the bathroom's whole list equals answers worked out by hand below;
//    O2  sheet counts for every fixture, sheet size and hanging direction, each
//        at or above the area lower bound and never more than with no reuse;
//    O3  openings are cut out ONCE: the board hung on a wall is its face less
//        the area its openings cover, and no two pieces overlap;
//    O4  an offcut never yields a piece larger than what it was cut from: the
//        pieces of each sheet are laid back on the sheet and fit;
//    O5  the ceiling follows the room's true shape (the L's notch is not
//        boarded, the bay is, and the bay's angled pieces are marked);
//    O6  every rule of thumb is labelled as one, on the line, on the screen and
//        in the sentence; measured lines are not;
//    O7  corner bead counts the outside corners the outline has;
//    O8  flooring and tile: the allowance depends on the layout and the shape,
//        and says why; wall tile reads the wet walls he marks and a height;
//    O9  paint: gallons from net area, coats and a stated spread rate, primer
//        on its own line;
//    O10 trim: the packing is never worse than one stick per piece, no cut is
//        longer than its stick, and every run has the fewest joints, on the
//        fixtures and on 3,000 random lists;
//    O11 a quantity he typed is kept, marked, and survives every other change;
//    O12 a changed choice recomputes;
//    O13 NOTHING reaches an estimate or leaves the phone without the confirm;
//    O14 material lines are priced through the existing takeoff path, each
//        with where its price came from, never as "his own";
//    O15 the list as plain text carries every line, the notice and the cuts;
//    O16 sent to the estimate a second time, the lines the list no longer has
//        are removed and named first, and a line he changed by hand is left;
//    O17 casing is cut with its mitres, and says what it assumed (the door and
//        the window worked by hand, at the default width and with each option);
//    O18 the drywall layout keeps a hanger's rules on a few hundred random
//        walls and L-shaped ceilings: full cover, no overlap, no piece under
//        the minimum, no stacked butt joints, every piece inside its sheet,
//        and a sheet count between two bounds worked out another way;
//    O19 the core guards its own inputs: a wild option never makes a quantity
//        that is not a number;
//    O20 the cut layout is written out in words under the drawing, and an
//        offcut is not told from a new sheet by colour alone;
//    O21 the "material is in there twice" warning is on every confirm that can
//        cause it, and is specific when the other lines are already there.
// B. THE LEARNING LOOP (utils/roomScan/learnCore, learnStore)
//    L1  the facts on a fixture history of 14 taped walls;
//    L2  below the minimum count there are no differences at all;
//    L3  there is no percentage, score or grade anywhere in the facts;
//    L4  a wall taped at more than double or less than half is counted, said
//        and left out of the inches;
//    L5  a suggestion needs enough long walls that agree, and never suggests
//        ordering less;
//    L6  a suggestion never changes a quantity by itself;
//    L7  pairs: from a scan reading only, one per wall, kept and removed;
//    L8  bought versus scanned: the pure core on fixtures, and NOT wired to
//        any data source in the app.
// C. THE WIRING (source text)
//    S1  storage keys are under an owned prefix and carry the user's id;
//    S2  nothing in the lane talks to a server or a model;
//    N1  with the flag off there is no entry point, and nothing outside the
//        feature imports the new files;
//    W1  the words: the plain notice, no "exact", no "accurate", English and
//        Spanish for every key;
//    D1  the checklist says what a later cloud phase needs and what data is
//        missing.
//
// PLANTED MUTATIONS. Every rule is run a second time against a planted break
// (a wrapped copy of a module, or edited text, in memory only) and the run
// fails unless that break turns the named rule red. `LIST=1` prints them, and
// `WHY=1` prints the first sentence each one was caught by.
//
// Run: bun run scripts/validate-scan-order.ts
// Pure node:fs + pure modules; no react-native import (those crash bun).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCapturedRoom } from '../utils/roomScan/capturedRoomParser';
import { buildRoomScan } from '../utils/roomScan/geometryCore';
import { correctWallLength } from '../utils/roomScan/editsCore';
import { computeQuantities } from '../utils/roomScan/quantitiesCore';
import * as CUT from '../utils/roomScan/cutPlanCore';
import * as TRIM from '../utils/roomScan/trimPackCore';
import * as ORDER from '../utils/roomScan/orderListCore';
import * as LEARN from '../utils/roomScan/learnCore';
import * as OPRICE from '../utils/roomScan/orderPricingCore';
import * as PRICING from '../utils/roomScan/pricingCore';
import { parseSavedScans } from '../utils/roomScan/storeCore';
import type { RoomScan } from '../utils/roomScan/types';
import { SCAN_ROOM_ENABLED } from '../constants/featureFlags';
import { BASE_MATERIALS as MATERIALS } from '../constants/materials';
import { isAppStorageKey } from '../utils/localCacheKeys';
import { buildCostDatabase } from '../utils/costDatabase';
import { applyTakeoffPush, pushLinesFrom } from '../utils/takeoff/conditionPush';
import { EN as EN_REAL } from '../i18n/catalog/en/office.room-scan.generated';
import { ES_OFFICE_ROOM_SCAN as ES_REAL } from '../i18n/catalog/es/office/roomScan';
import type { LinkedEstimate, Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

// ── the world a rule looks at (a mutation hands it an edited copy) ──────────
const NEW_FILES = [
  'utils/roomScan/cutPlanCore.ts', 'utils/roomScan/trimPackCore.ts', 'utils/roomScan/orderListCore.ts',
  'utils/roomScan/learnCore.ts', 'utils/roomScan/learnStore.ts', 'utils/roomScan/orderPricingCore.ts',
  'components/roomScan/OrderListView.tsx', 'components/roomScan/CutLayoutView.tsx', 'components/roomScan/TapeFactsPanel.tsx',
  'hooks/useScanOrderCopy.ts',
] as const;
const OTHER_FILES = [
  'components/roomScan/RoomScanFlow.tsx', 'components/roomScan/QuantitiesView.tsx', 'utils/roomScan/storeCore.ts',
  'utils/roomScan/pricingCore.ts', 'constants/featureFlags.ts', 'app/scan-room.tsx', 'docs/scan-the-room-native-checklist.md',
  'scripts/validate-scan-room.ts', 'package.json',
  'components/roomScan/PricedDraftView.tsx', 'hooks/useRoomScanCopy.ts', 'utils/roomScan/store.ts',
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(rel);
  }
  return out;
}
/** Every source file that is not part of Scan The Room. */
const OUTSIDE: Record<string, string> = {};
for (const dir of ['app', 'components', 'utils', 'hooks', 'contexts', 'constants', 'lib', 'i18n']) {
  for (const f of walk(dir)) {
    if (/(^|\/)roomScan\//.test(f) || f === 'app/scan-room.tsx' || f === 'hooks/useRoomScanCopy.ts' || f === 'hooks/useScanOrderCopy.ts' || f.startsWith('i18n/catalog/')) continue;
    OUTSIDE[f] = read(f);
  }
}

interface Mods {
  list: typeof ORDER.buildOrderList;
  sheets: typeof CUT.planSheets;
  checkSheets: typeof CUT.checkSheetCuts;
  pack: typeof TRIM.packTrim;
  checkTrim: typeof TRIM.checkTrimPlan;
  send: typeof ORDER.confirmOrderSend;
  text: typeof ORDER.orderListText;
  parseOptions: typeof ORDER.parseOrderOptions;
  facts: typeof LEARN.tapeFacts;
  suggest: typeof LEARN.longWallSuggestion;
  pair: typeof LEARN.tapePairFromEdit;
  upsert: typeof LEARN.upsertTapePairs;
  waste: typeof LEARN.wasteFactors;
  wasteOffer: typeof LEARN.wasteSuggestion;
  draft: typeof OPRICE.buildOrderDraft;
  patch: typeof PRICING.buildEstimatePatch;
  resend: typeof OPRICE.planOrderResend;
  flag: boolean;
}
interface World {
  M: Mods;
  F: Record<string, string>;
  outside: Record<string, string>;
  EN: Record<string, unknown>;
  ES: Record<string, { s: unknown; src: string } | undefined>;
}
const REAL_MODS: Mods = {
  list: ORDER.buildOrderList, sheets: CUT.planSheets, checkSheets: CUT.checkSheetCuts, pack: TRIM.packTrim, checkTrim: TRIM.checkTrimPlan,
  send: ORDER.confirmOrderSend, text: ORDER.orderListText, parseOptions: ORDER.parseOrderOptions,
  facts: LEARN.tapeFacts, suggest: LEARN.longWallSuggestion, pair: LEARN.tapePairFromEdit, upsert: LEARN.upsertTapePairs,
  waste: LEARN.wasteFactors, wasteOffer: LEARN.wasteSuggestion,
  draft: OPRICE.buildOrderDraft, patch: PRICING.buildEstimatePatch, resend: OPRICE.planOrderResend, flag: SCAN_ROOM_ENABLED,
};
const F_REAL: Record<string, string> = {};
for (const f of [...NEW_FILES, ...OTHER_FILES]) F_REAL[f] = existsSync(join(ROOT, f)) ? read(f) : '';
const REAL: World = { M: REAL_MODS, F: F_REAL, outside: OUTSIDE, EN: EN_REAL as Record<string, unknown>, ES: ES_REAL as World['ES'] };

// ── helpers ─────────────────────────────────────────────────────────────────
const META = { id: 'scan-1', projectId: 'proj-1', name: 'Hall Bathroom', capturedAt: '2026-10-06T13:41:00.000Z', device: { model: 'iPhone16,1', os: '17.5' } };
const FIXTURES = ['bathroom', 'l-shape', 'bay-room', 'hallway', 'three-openings'] as const;
type Fixture = typeof FIXTURES[number];
const scanCache = new Map<string, RoomScan>();
function scanOf(name: Fixture): RoomScan {
  if (!scanCache.has(name)) scanCache.set(name, buildRoomScan(parseCapturedRoom(read(`scripts/fixtures/scan-room/${name}.json`)), META));
  return scanCache.get(name) as RoomScan;
}
/** Every group on, the defaults otherwise. */
function opts(scan: RoomScan, patch: Partial<ORDER.OrderOptions> = {}): ORDER.OrderOptions {
  const d = ORDER.defaultOrderOptions(scan.roomType);
  return { ...d, groups: { ...d.groups, drywall: true }, ...patch };
}
const near = (a: number | null | undefined, b: number, tol = 0.01): boolean => typeof a === 'number' && Math.abs(a - b) <= tol;
const qty = (l: ORDER.OrderList, key: string): number | undefined => l.lines.find((x) => x.key === key)?.quantity;
const IN = 0.0254;
const AT = '2026-10-06T14:00:00.000Z';

const forms = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v as Record<string, string>) : []);
type Rule = (w: World) => string[];
const RULES: Record<string, Rule> = {};
const rule = (id: string, fn: Rule) => { RULES[id] = fn; };
const check = (out: string[], cond: boolean, msg: string) => { if (!cond) out.push(msg); };

// ── A. the order list ───────────────────────────────────────────────────────

// THE BATHROOM, WORKED BY HAND (again, after the review round). 61 in by 98 in,
// 96 in ceiling. One door 30 by 80 on a 61 in wall (26 3/8 in of wall on one
// side of it, 4 5/8 in on the other, to the nearest eighth). One window 24 by
// 36, sill at 40, on a 98 in wall. Floor 61 x 98 / 144 = 41.51 sq ft. Walls
// 318 in x 96 = 212 sq ft gross, less 30 x 80 + 24 x 36 = 3,264 sq in = 22.67
// sq ft, is 189.33 net.
//
// DRYWALL, WALLS, 4x8 sheets lying down. Two 48 in courses on every wall, and
// the walls are 96 in tall, so there is no gap at the floor.
//   THE JOINTS FIRST. A 98 in wall is 2 in longer than a sheet. 96 + 2 would
//   leave a 2 in strip, so the last piece is made 16 in and the one before it
//   gives up 14: 82 + 16, the butt joint 82 in from the wall's start. The
//   course under it may not put its joint within 16 in of that, so it is cut
//   from the other end: 16 + 82, the joint at 16 in. 66 in apart.
//     98 in wall, no opening     top 82 + 16     bottom 16 + 82
//     98 in wall, the window     top 82 + 16     bottom 16 + 82   (the window is cut OUT of the pieces over it)
//     61 in wall, no opening     61, 61          (one sheet spans it: no joint)
//     61 in wall, the door, top  61              (the door's top 32 in is cut out of it)
//     61 in wall, the door, bottom  26 3/8 and 4 5/8  (the door crosses the whole course, so no board
//                                there; the 4 5/8 in piece is the wall itself, between the door and the corner)
//   THEN THE SHEETS, longest piece first, each from the smallest offcut that covers it:
//     82, 82, 82, 82     sheets 1, 2, 3, 4      each leaves 14 in
//     61, 61, 61         sheets 5, 6, 7         each leaves 35 in
//     26 3/8             from sheet 5's 35 in   (8 5/8 left, scrap)
//     16, 16             from sheet 6's 35 in   (35, then 19, then 3)
//     16, 16             from sheet 7's 35 in
//     4 5/8              from sheet 1's 14 in
//   SEVEN sheets, the same count as before the review, with no strip and no
//   stacked joint. (Area says at least 189.33 / 32 = 5.9, so six. One sheet
//   for every sheet-length of every course would be 4 x 2 + 3 + 2 = 13.)
// DRYWALL, CEILING. 98 long, 61 wide: a 48 in strip and a 13 in strip.
//   48 in strip: 82 + 16 (not 96 + 2). The 82 from sheet 1 (14 x 48 left), the
//                16 from sheet 2 (80 x 48 left).
//   13 in strip: its joint must clear 82 by 16 in. Cut from the other end it
//                would be 16 + 82, and no offcut is 82 long, so that opens a
//                third sheet. Starting with a half sheet it is 48 + 50, both
//                ripped from sheet 2's 80 x 48: joint at 48, 34 in clear.
//   TWO sheets.
// Board hung: 9 sheets x 32 = 288 sq ft.
//   screws    288 x 1 per sq ft = 288, a 5 lb box holds about 1,000   1 box
//   compound  288 / 100 = 2.88 gal, a 5 gal bucket                    1 bucket
//   tape      288 x 0.37 = 107 ft, a 500 ft roll                      1 roll
//   corner bead: a rectangle has no outside corner                    0
// FLOOR TILE, straight: 41.51 x 1.10 = 45.66                          46 sq ft
// PAINT, 2 coats, 350 sq ft a gallon:
//   walls    189.33 x 2 / 350 = 1.08                                  2 gallons
//   ceiling  41.51 x 2 / 350 = 0.24                                   1 gallon
//   primer   (189.33 + 41.51) / 300 = 0.77                            1 gallon
// TRIM, sticks of 8, 12 and 16 ft. One line for each kind, in feet of stick.
//   baseboard  98, 98, 61, 26 3/8, 4 5/8 (the door takes 30 in out) = 288 in = 24 ft
//              a 16 ft: 98 + 61 + 26 3/8 + 4 5/8 = 190     a 12 ft: 98
//              28 ft. Nothing under 24 ft will do, and 24 ft is two 12s, a 16
//              and an 8, or three 8s. An 8 holds no 98; two 12s hold a 98 each
//              and then the 61 fits neither. So 28 is the least.
//   crown      98, 98, 61, 61 = 318 in = 26.5 ft: (98 + 61) twice, two 16 ft   32 ft
//              (28 ft would be a 16 and a 12: the 12 holds one 98 and nothing else.)
//   casing, 2 1/4 in wide, mitred (O17 works every piece):
//              door   82 1/4, 82 1/4, 34 1/2
//              window 40 1/2, 40 1/2, 28 1/2, 28 1/2        337 in = 28.08 ft
//              two 16 ft: 82 1/4 + 34 1/2 + 28 1/2 + 28 1/2 = 173 3/4
//                         82 1/4 + 40 1/2 + 40 1/2 = 163 1/4             32 ft
//              (Before the review this was 190 + 120 on a 16 and a 12, 28 ft,
//              because the pieces were cut to the bare opening.)
const BATHROOM: Record<string, number> = {
  drywall_walls: 7, drywall_ceiling: 2, screws: 1, compound: 1, tape: 1, corner_bead: 0,
  floor: 46, paint_walls: 2, paint_ceiling: 1, primer: 1,
  baseboard: 28, crown: 32, casing: 32,
};
/** The bathroom's pieces by hand, each wall as "where:how long" top course then bottom course. */
const BATHROOM_WALLS = ['0:61|0:61', '0:82,82:16|0:16,16:82', '0:61|0:26.375,56.375:4.625', '0:82,82:16|0:16,16:82'];

rule('O1 the bathroom order list equals the hand-worked answers', (w) => {
  const o: string[] = [];
  const scan = scanOf('bathroom');
  const l = w.M.list(scan, opts(scan));
  for (const [key, want] of Object.entries(BATHROOM)) check(o, qty(l, key) === want, `${key} is ${qty(l, key)}, worked by hand as ${want}`);
  check(o, l.lines.length === Object.keys(BATHROOM).length, `the list has ${l.lines.length} lines, the hand-worked one has ${Object.keys(BATHROOM).length}: ${l.lines.map((x) => x.key).join(', ')}`);
  const sticks = (k: ORDER.TrimKind) => l.trimPlans[k]?.counts.map((c) => `${c.stockFt}:${c.count}`).join();
  const base = l.trimPlans.baseboard;
  check(o, !!base && base.boughtFt === 28 && sticks('baseboard') === '12:1,16:1' && base.joints === 0, `baseboard buys ${base?.boughtFt} ft in ${sticks('baseboard')}`);
  check(o, !!base && base.sticks[0].cuts.map((c) => c.lengthIn).join() === '98,61,26.375,4.625' && base.sticks[1].cuts.map((c) => c.lengthIn).join() === '98', `the baseboard cut list is ${base?.sticks.map((s) => s.cuts.map((c) => c.lengthIn).join('+')).join(' | ')}`);
  check(o, sticks('crown') === '16:2' && sticks('casing') === '16:2', `crown is ${sticks('crown')} and casing ${sticks('casing')}`);
  const casing = l.trimPlans.casing;
  check(o, !!casing && casing.sticks.flatMap((s) => s.cuts.map((c) => c.lengthIn)).sort((p, q) => q - p).join() === '82.25,82.25,40.5,40.5,34.5,28.5,28.5', `the casing pieces are ${casing?.sticks.map((s) => s.cuts.map((c) => c.lengthIn).join('+')).join(' | ')}`);
  check(o, near(l.wallPlan?.hungSF, 189.33, 0.01) && near(l.ceilingPlan?.hungSF, 41.51, 0.01), `board hung is ${l.wallPlan?.hungSF} and ${l.ceilingPlan?.hungSF}`);
  // The layout itself, wall by wall, as worked above.
  const shape = (s: CUT.SurfacePlan) => [...new Set(s.pieces.map((p) => p.y))].sort((p, q) => q - p).map((y) => s.pieces.filter((p) => p.y === y).sort((p, q) => p.x - q.x).map((p) => `${p.x}:${p.w}`).join()).join('|');
  const got = (l.wallPlan?.surfaces ?? []).map(shape);
  check(o, got.length === 4 && [...got].sort().join(' / ') === [...BATHROOM_WALLS].sort().join(' / '), `the bathroom walls are hung ${got.join(' / ')}`);
  const ceil = l.ceilingPlan?.surfaces[0];
  check(o, !!ceil && shape(ceil) === '0:48,48:50|0:82,82:16', `the bathroom ceiling is hung ${ceil ? shape(ceil) : 'not at all'}`);
  check(o, l.gaps.length === 0, `unexpected gaps ${l.gaps.join()}`);
  return o;
});

// ── THE LAYOUT RULES, CHECKED BY A SECOND IMPLEMENTATION ────────────────────
// Nothing below reads a count, a gap or a flag the layout reports about
// itself, except to compare it with what is worked out here. The stretches of
// wall that need board are found again from the wall and its openings; the
// joints are found again from where the pieces touch; the sheets are counted
// again from the pieces; and the count is held between two bounds:
//   AT LEAST  the area of board the courses need, over the area of one sheet;
//   AT MOST   one sheet for every sheet-length of every course, plus one for
//             each course longer than a sheet (staggering a joint can add a
//             piece). That is what a hanger who never reused a drop would buy.
const MIN_PIECE = 16;
const STAGGER = 16;
const FLOOR_GAP = 2;
const SHEET_W = 48;
const LEN_OF: Record<CUT.SheetKey, number> = { '4x8': 96, '4x10': 120, '4x12': 144 };
interface Run { a0: number; a1: number; c0: number; c1: number }

function gapsIn(blocked: [number, number][], hi: number): [number, number][] {
  const sorted = blocked.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of sorted) { if (a > cursor + 1e-6) out.push([cursor, Math.min(a, hi)]); cursor = Math.max(cursor, b); }
  if (hi > cursor + 1e-6) out.push([cursor, hi]);
  return out;
}

/** The stretches of a wall that need board, and the gap left at the floor. Worked out here, not read from the plan. */
function wallRuns(W: number, H: number, openings: CUT.RectIn[], hang: CUT.HangDirection, L: number): { runs: Run[]; floorGap: number } {
  const runs: Run[] = [];
  let floorGap = 0;
  if (hang === 'across') {
    for (let c1 = H; c1 > 1e-6; c1 -= SHEET_W) {
      const c0 = Math.max(0, c1 - SHEET_W);
      if (c0 === 0 && c1 < H && c1 - c0 <= FLOOR_GAP) { floorGap = c1 - c0; continue; }
      if (c1 - c0 < 1) continue;
      const blocked = openings.filter((op) => op.y0 <= c0 + 1e-6 && op.y1 >= c1 - 1e-6).map((op) => [op.x0, op.x1] as [number, number]);
      for (const [a0, a1] of gapsIn(blocked, W)) if (a1 - a0 >= 1) runs.push({ a0, a1, c0, c1 });
    }
    return { runs, floorGap };
  }
  for (let c0 = 0; c0 < W - 1e-6; c0 += SHEET_W) {
    const c1 = Math.min(W, c0 + SHEET_W);
    if (c1 - c0 < 1) continue;
    const blocked = openings.filter((op) => op.x0 <= c0 + 1e-6 && op.x1 >= c1 - 1e-6).map((op) => [op.y0, op.y1] as [number, number]);
    for (const [lo, a1] of gapsIn(blocked, H)) {
      if (a1 - lo < 1) continue;
      let a0 = lo;
      const over = (a1 - a0) % L;
      if (a0 === 0 && a1 - a0 > L && over > 1e-6 && over <= FLOOR_GAP) { floorGap = Math.max(floorGap, over); a0 += over; }
      runs.push({ a0, a1, c0, c1 });
    }
  }
  return { runs, floorGap };
}

/** A piece as (along, across) whichever way the sheets hang. */
const alongOf = (p: CUT.CutPiece, upright: boolean) => (upright ? { a: p.y, len: p.h, c: p.x, wide: p.w } : { a: p.x, len: p.w, c: p.y, wide: p.h });

/**
 * Every way one surface's layout breaks a hanger's rules. `runs` is the wall
 * worked out above (null for a ceiling, whose stretches are read off the
 * pieces' own strips).
 */
function layoutProblems(plan: CUT.CutPlan, s: CUT.SurfacePlan, runs: Run[] | null, upright: boolean, tag: string): string[] {
  const o: string[] = [];
  const L = LEN_OF[plan.sheet];
  const P = s.pieces.map((p) => ({ p, ...alongOf(p, upright) }));
  // Inside the surface, and no two on the same board.
  for (const { p } of P) if (p.x < -1e-6 || p.y < -1e-6 || p.x + p.w > s.widthIn + 1e-6 || p.y + p.h > s.heightIn + 1e-6) o.push(`${tag}: a piece hangs off the surface`);
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const p = P[i].p;
    const q = P[j].p;
    if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 1e-3 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 1e-3) o.push(`${tag}: two pieces overlap`);
  }
  // No piece longer than a sheet or wider than one.
  for (const x of P) if (x.len > L + 1e-6 || x.wide > SHEET_W + 1e-6) o.push(`${tag}: a ${x.len} by ${x.wide} piece is larger than a sheet`);
  if (runs) {
    // Full cover: every stretch that needs board is boarded end to end (less a corner gap under an inch), and no board is hung where none is needed.
    for (const r of runs) {
      const mine = P.filter((x) => Math.abs(x.c - r.c0) < 1e-6 && Math.abs(x.c + x.wide - r.c1) < 1e-6 && x.a >= r.a0 - 1e-6 && x.a + x.len <= r.a1 + 1e-6).sort((p, q) => p.a - q.a);
      let at = r.a0;
      for (const x of mine) { if (Math.abs(x.a - at) > 1e-6) o.push(`${tag}: a hole in the board at ${at} on the course from ${r.c0}`); at = x.a + x.len; }
      if (r.a1 - at >= 1) o.push(`${tag}: ${(r.a1 - at).toFixed(3)} in of a ${(r.a1 - r.a0).toFixed(3)} in course is not boarded`);
      // The minimum piece, unless the wall there is shorter than it.
      for (const x of mine) {
        if (x.len < MIN_PIECE - 1e-6 && r.a1 - r.a0 >= MIN_PIECE) o.push(`${tag}: a ${x.len} in piece on a ${(r.a1 - r.a0).toFixed(3)} in course`);
        if (x.p.narrow !== (r.a1 - r.a0 < MIN_PIECE - 1e-6)) o.push(`${tag}: a ${x.len} in piece is ${x.p.narrow ? '' : 'not '}marked as narrow wall`);
      }
    }
    const placed = P.filter((x) => runs.some((r) => Math.abs(x.c - r.c0) < 1e-6 && Math.abs(x.c + x.wide - r.c1) < 1e-6 && x.a >= r.a0 - 1e-6 && x.a + x.len <= r.a1 + 1e-6)).length;
    if (placed !== P.length) o.push(`${tag}: ${P.length - placed} pieces are hung where the wall needs none`);
  } else {
    for (const x of P) if (x.len < MIN_PIECE - 1e-6) o.push(`${tag}: a ${x.len} in piece on a ceiling whose every stretch is longer`);
  }
  // Butt joints, found from where two pieces of one course meet. None within a stud bay of a joint in the next course.
  const joints: { at: number; c0: number; c1: number }[] = [];
  for (const x of P) for (const y of P) if (x !== y && Math.abs(x.c - y.c) < 1e-6 && Math.abs(x.wide - y.wide) < 1e-6 && Math.abs(x.a + x.len - y.a) < 1e-6) joints.push({ at: y.a, c0: x.c, c1: x.c + x.wide });
  let stacked = 0;
  for (const j of joints) if (joints.some((q) => Math.abs(q.c0 - j.c1) < 1e-6 && Math.abs(q.at - j.at) < STAGGER - 1e-6) || joints.some((q) => Math.abs(q.c1 - j.c0) < 1e-6 && Math.abs(q.at - j.at) < STAGGER - 1e-6)) stacked += 1;
  if (stacked > 0) o.push(`${tag}: ${stacked} butt joints sit within ${STAGGER} in of a joint in the next course`);
  if (s.stackedJoints !== 0) o.push(`${tag}: the layout reports ${s.stackedJoints} stacked joints`);
  return o;
}

/** Each sheet's pieces laid back on the sheet: inside it, and not on each other. Written here, not the core's own check. */
function sheetProblems(plan: CUT.CutPlan, tag: string): string[] {
  const o: string[] = [];
  const L = LEN_OF[plan.sheet];
  const all = plan.surfaces.flatMap((s) => s.pieces);
  const ids = [...new Set(all.map((p) => p.sheet))];
  if (ids.length !== plan.sheets || ids.some((id) => id < 1 || id > plan.sheets)) o.push(`${tag}: ${plan.sheets} sheets to buy and the pieces come from ${ids.length}`);
  if (plan.surfaces.reduce((t, s) => t + s.newSheets, 0) !== plan.sheets) o.push(`${tag}: the surfaces' new sheets do not add to the total`);
  if (!near(plan.boardSF, plan.sheets * ((L * SHEET_W) / 144), 1e-6)) o.push(`${tag}: board bought is not sheets times one sheet`);
  for (const id of ids) {
    const mine = all.filter((p) => p.sheet === id);
    for (const p of mine) {
      if (p.src.a < -1e-6 || p.src.c < -1e-6 || p.src.a + p.src.alongIn > L + 1e-6 || p.src.c + p.src.acrossIn > SHEET_W + 1e-6) o.push(`${tag}: a piece runs off sheet ${id}`);
      if (Math.abs(p.src.alongIn * p.src.acrossIn - p.w * p.h) > 1e-3) o.push(`${tag}: a piece is one size on the wall and another on sheet ${id}`);
    }
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      const p = mine[i].src;
      const q = mine[j].src;
      if (Math.min(p.a + p.alongIn, q.a + q.alongIn) - Math.max(p.a, q.a) > 1e-3 && Math.min(p.c + p.acrossIn, q.c + q.acrossIn) - Math.max(p.c, q.c) > 1e-3) o.push(`${tag}: two pieces are cut from the same part of sheet ${id}`);
    }
  }
  return o;
}

/** The two bounds on a wall plan's sheet count, from the runs worked out here. */
function wallBounds(allRuns: Run[], L: number): { least: number; most: number } {
  const need = allRuns.reduce((t, r) => { const len = r.a1 - r.a0; const over = len % L; return t + (len > L && over < 1 ? len - over : len) * (r.c1 - r.c0); }, 0);
  return {
    least: Math.ceil(need / (L * SHEET_W) - 1e-9),
    most: allRuns.reduce((t, r) => t + Math.ceil((r.a1 - r.a0) / L - 1e-9) + (r.a1 - r.a0 > L ? 1 : 0), 0),
  };
}

const r8v = (n: number): number => Math.round(n * 8) / 8;
/** A fixture's walls as the hanger sees them, read from the scan here (inches, to an eighth). */
function wallsOf(scan: RoomScan): CUT.WallSurface[] {
  return scan.walls.filter((x) => x.onOutline).map((x) => {
    const W = r8v(x.lengthM / IN);
    const H = r8v((x.heightM > 0 ? x.heightM : scan.ceilingHeightM.typical) / IN);
    const openings = scan.openings.filter((op) => op.wallId === x.id).map((op) => ({
      x0: r8v(Math.max(0, op.offsetM / IN)), x1: r8v(Math.min(x.lengthM / IN, (op.offsetM + op.widthM) / IN)),
      y0: r8v(Math.max(0, op.sillM / IN)), y1: r8v(Math.min(H, (op.sillM + op.heightM) / IN)),
    }));
    return { kind: 'wall' as const, id: x.id, widthIn: W, heightIn: H, openings };
  });
}

/** Every problem with a wall plan against the walls it was made for. */
function wallPlanProblems(plan: CUT.CutPlan | null, walls: CUT.WallSurface[], tag: string): string[] {
  if (!plan) return [`${tag}: no plan`];
  const o: string[] = [];
  const L = LEN_OF[plan.sheet];
  const every: Run[] = [];
  for (const wall of walls) {
    const s = plan.surfaces.find((x) => x.surfaceId === wall.id);
    if (!s) { o.push(`${tag}: no layout for a wall`); continue; }
    const { runs, floorGap } = wallRuns(wall.widthIn, wall.heightIn, wall.openings, plan.hang, L);
    every.push(...runs);
    if (Math.abs(s.floorGapIn - floorGap) > 1e-6) o.push(`${tag}: the layout reports a ${s.floorGapIn} in gap at the floor and the wall leaves ${floorGap}`);
    o.push(...layoutProblems(plan, s, runs, plan.hang === 'upright', tag));
  }
  o.push(...sheetProblems(plan, tag));
  const { least, most } = wallBounds(every, L);
  if (plan.sheets < least) o.push(`${tag}: ${plan.sheets} sheets cannot cover what the courses need (at least ${least})`);
  if (plan.sheets > most) o.push(`${tag}: ${plan.sheets} sheets is more than one for every sheet-length of every course (${most})`);
  return o;
}

/** Every problem with a ceiling plan against the outline it was made for (square inches of room, and its bounding box). */
function ceilingPlanProblems(plan: CUT.CutPlan | null, areaIn2: number, tag: string): string[] {
  if (!plan) return [`${tag}: no plan`];
  const o: string[] = [];
  const L = LEN_OF[plan.sheet];
  const s = plan.surfaces[0];
  o.push(...layoutProblems(plan, s, null, false, tag), ...sheetProblems(plan, tag));
  // No two pieces overlap (above), so the room is fully boarded exactly when what the pieces cover adds to the room.
  const covered = s.pieces.reduce((t, p) => t + p.netAreaIn2, 0);
  // The outline is turned and rounded to an eighth before it is boarded: allow that much along its edges.
  if (Math.abs(covered - areaIn2) > 2 + 0.125 * (s.widthIn + s.heightIn) + s.gapIn * Math.max(s.widthIn, s.heightIn)) o.push(`${tag}: the pieces cover ${(covered / 144).toFixed(2)} sq ft of a ${(areaIn2 / 144).toFixed(2)} sq ft ceiling`);
  const least = Math.ceil(areaIn2 / (L * SHEET_W) - 1e-9);
  const most = Math.ceil(s.heightIn / SHEET_W - 1e-9) * (Math.ceil(s.widthIn / L - 1e-9) + 1) + 1;
  if (plan.sheets < least || plan.sheets > most) o.push(`${tag}: ${plan.sheets} sheets on a ceiling that needs between ${least} and ${most}`);
  return o;
}

function eachPlan(w: World, fn: (name: Fixture, key: string, l: ORDER.OrderList, scan: RoomScan) => void) {
  for (const name of FIXTURES) {
    const scan = scanOf(name);
    for (const sheet of CUT.SHEET_KEYS) for (const hang of ['across', 'upright'] as const) fn(name, `${sheet}/${hang}`, w.M.list(scan, opts(scan, { sheet, hang })), scan);
  }
}

rule('O2 sheet counts on every fixture, sheet size and direction, between two bounds worked out another way', (w) => {
  const o: string[] = [];
  eachPlan(w, (name, key, l, scan) => {
    for (const p of wallPlanProblems(l.wallPlan, wallsOf(scan), `${name} ${key} walls`)) o.push(p);
    const floorIn2 = Math.abs(scan.floor.reduce((t, pt, i) => { const q = scan.floor[(i + 1) % scan.floor.length]; return t + (pt.x * q.y - q.x * pt.y) / (IN * IN); }, 0)) / 2;
    for (const p of ceilingPlanProblems(l.ceilingPlan, floorIn2, `${name} ${key} ceiling`)) o.push(p);
  });
  // Reusing offcuts never takes MORE sheets than using none.
  for (const name of FIXTURES) {
    const l = w.M.list(scanOf(name), opts(scanOf(name)));
    const surfaces = wallsOf(scanOf(name));
    const withReuse = w.M.sheets(surfaces, { sheet: '4x8', hang: 'across' }).sheets;
    const without = w.M.sheets(surfaces, { sheet: '4x8', hang: 'across', reuse: false }).sheets;
    check(o, withReuse <= without && withReuse === l.wallPlan?.sheets, `${name}: ${withReuse} sheets with offcuts reused, ${without} with none`);
  }
  check(o, CUT.MIN_PIECE_IN === MIN_PIECE && CUT.STAGGER_IN === STAGGER && CUT.FLOOR_GAP_IN === FLOOR_GAP, 'a layout rule changed without its test');
  return o;
});

rule('O3 openings are cut out once, and no two pieces overlap', (w) => {
  const o: string[] = [];
  eachPlan(w, (name, key, l) => {
    for (const s of l.wallPlan?.surfaces ?? []) {
      const face = s.widthIn * s.heightIn;
      const holes = CUT.rectUnionArea(s.openings);
      const hung = s.pieces.reduce((t, p) => t + p.netAreaIn2, 0);
      // What is left unboarded is only the sub-inch gaps and the gap at the floor the plan reports.
      const slack = s.gapIn * Math.max(s.widthIn, s.heightIn) + s.floorGapIn * s.widthIn + 1;
      check(o, hung <= face - holes + 1e-3 && hung >= face - holes - slack, `${name} ${key} ${s.surfaceId.slice(-2)}: ${hung.toFixed(1)} sq in hung on a ${face.toFixed(0)} face with ${holes.toFixed(0)} of openings`);
      const cut = s.pieces.reduce((t, p) => t + CUT.rectUnionArea(p.cutouts), 0);
      const boarded = s.pieces.reduce((t, p) => t + p.w * p.h, 0);
      check(o, Math.abs(boarded - cut - hung) < 1e-3, `${name} ${key}: a cutout was taken off a piece twice`);
      check(o, cut <= holes + 1e-3, `${name} ${key}: ${cut.toFixed(0)} sq in of cutouts on a wall with ${holes.toFixed(0)} of openings`);
      for (let i = 0; i < s.pieces.length; i++) for (let j = i + 1; j < s.pieces.length; j++) {
        const p = s.pieces[i];
        const q = s.pieces[j];
        const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
        const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
        if (ox > 1e-3 && oy > 1e-3) o.push(`${name} ${key}: two pieces overlap on a wall`);
      }
      for (const p of s.pieces) check(o, p.x >= -1e-6 && p.y >= -1e-6 && p.x + p.w <= s.widthIn + 1e-6 && p.y + p.h <= s.heightIn + 1e-6, `${name} ${key}: a piece hangs off its wall`);
    }
  });
  // The door on the three-openings wall crosses the bottom course: no board is bought for the hole.
  const l = w.M.list(scanOf('three-openings'), opts(scanOf('three-openings')));
  const wall = l.wallPlan?.surfaces.find((s) => s.openings.length === 3);
  check(o, !!wall && wall.pieces.every((p) => !(p.y < 1 && p.x >= 6 - 1e-6 && p.x + p.w <= 38 + 1e-6)), 'a piece of board was bought for the doorway');
  check(o, !!wall && wall.pieces.filter((p) => p.cutouts.length > 0).length === 2, `the window is cut out of ${wall?.pieces.filter((p) => p.cutouts.length > 0).length} pieces on the three-opening wall (it crosses two courses)`);
  return o;
});

rule('O4 an offcut never yields a piece larger than what it was cut from', (w) => {
  const o: string[] = [];
  let reused = 0;
  eachPlan(w, (name, key, l) => {
    for (const plan of [l.wallPlan, l.ceilingPlan]) {
      if (!plan) continue;
      for (const p of w.M.checkSheets(plan)) o.push(`${name} ${key}: ${p}`);
      for (const s of plan.surfaces) for (const p of s.pieces) {
        if (p.fromOffcut) reused += 1;
        check(o, p.src.alongIn <= CUT.SHEET_LENGTHS_IN[plan.sheet] + 1e-6 && p.src.acrossIn <= CUT.SHEET_WIDTH_IN + 1e-6, `${name} ${key}: a piece is larger than a sheet`);
      }
    }
  });
  check(o, reused > 50, `only ${reused} pieces came from offcuts across every layout: reuse is not happening`);
  // An offcut under the minimum is scrap: with a 40 in minimum the bathroom's 27 and 35 in drops are not kept.
  const scan = scanOf('bathroom');
  const strict = w.M.list(scan, opts(scan, { minOffcutIn: 40 }));
  check(o, (strict.wallPlan?.sheets ?? 0) > 7, `with a 40 in minimum offcut the bathroom still takes ${strict.wallPlan?.sheets} sheets`);
  for (const s of strict.wallPlan?.surfaces ?? []) for (const p of s.pieces) check(o, !p.fromOffcut || p.src.alongIn + 1e-6 >= 0, 'offcut bookkeeping');
  return o;
});

rule('O5 the ceiling follows the true shape of the room', (w) => {
  const o: string[] = [];
  const L = w.M.list(scanOf('l-shape'), opts(scanOf('l-shape')));
  // 25 sq m = 269.1 sq ft. The rectangle around the L is 6 m by 5 m = 322.9 sq ft.
  check(o, near(L.ceilingPlan?.hungSF, 269.1, 0.2), `the L's ceiling hangs ${L.ceilingPlan?.hungSF} sq ft, the room is 269.1`);
  const bay = w.M.list(scanOf('bay-room'), opts(scanOf('bay-room')));
  // 168 x 120 + (72 + 36) / 2 x 24 = 21,456 sq in = 149.0 sq ft.
  check(o, near(bay.ceilingPlan?.hungSF, 149, 0.05), `the bay room's ceiling hangs ${bay.ceilingPlan?.hungSF} sq ft, the room is 149.0`);
  const shaped = bay.ceilingPlan?.surfaces[0].pieces.filter((p) => p.cutToShape) ?? [];
  check(o, shaped.length >= 2, `${shaped.length} ceiling pieces are marked as cut to the bay's shape`);
  check(o, (bay.ceilingPlan?.surfaces[0].outline.length ?? 0) === 8, 'the bay room ceiling does not carry its eight-sided outline for the drawing');
  const rect = w.M.list(scanOf('bathroom'), opts(scanOf('bathroom')));
  check(o, (rect.ceilingPlan?.surfaces[0].pieces ?? []).every((p) => !p.cutToShape), 'a rectangular ceiling has a piece marked as cut to shape');
  return o;
});

const RULE_OF_THUMB_KEYS = ['screws', 'compound', 'tape', 'corner_bead'];

rule('O6 every rule of thumb is labelled as one', (w) => {
  const o: string[] = [];
  for (const name of FIXTURES) {
    const l = w.M.list(scanOf(name), opts(scanOf(name)));
    for (const line of l.lines) {
      const should = RULE_OF_THUMB_KEYS.includes(line.key);
      check(o, line.ruleOfThumb === should, `${name}: ${line.key} has ruleOfThumb ${line.ruleOfThumb}`);
    }
    for (const k of RULE_OF_THUMB_KEYS) check(o, l.lines.some((x) => x.key === k), `${name}: no ${k} line`);
    check(o, qty(l, 'drywall_spare') === undefined, `${name}: a spare sheet is on the list that nobody added`);
  }
  const l = w.M.list(scanOf('l-shape'), opts(scanOf('l-shape')));
  // The rules, worked here from the sheets on the list: 32 sq ft a sheet, one screw a sq ft in boxes of 1,000,
  // one gallon to 100 sq ft in 5 gal buckets, 370 ft of tape to 1,000 sq ft in 500 ft rolls.
  const b = (k: string) => l.lines.find((x) => x.key === k)?.basis as Record<string, number> | undefined;
  const board = ((qty(l, 'drywall_walls') ?? 0) + (qty(l, 'drywall_ceiling') ?? 0)) * 32;
  check(o, board >= 900 && board <= 1000 && b('screws')?.boardSF === board && qty(l, 'screws') === Math.ceil(board / 1000), `screws on ${b('screws')?.boardSF} sq ft come to ${qty(l, 'screws')} (the list has ${board} sq ft of board)`);
  check(o, qty(l, 'compound') === Math.ceil(board / 100 / 5) && qty(l, 'compound') === 2, `compound is ${qty(l, 'compound')} buckets (${board / 100} gal in 5 gal buckets)`);
  check(o, qty(l, 'tape') === Math.ceil((board * 0.37) / 500) && qty(l, 'tape') === 1, `tape is ${qty(l, 'tape')} rolls (${Math.round(board * 0.37)} ft in 500 ft rolls)`);
  // A spare sheet he adds is not hung: the rules of thumb do not grow with it.
  const spare = w.M.list(scanOf('l-shape'), opts(scanOf('l-shape'), { spareSheets: 1 }));
  check(o, qty(spare, 'drywall_spare') === 1 && (spare.lines.find((x) => x.key === 'screws')?.basis as { boardSF: number }).boardSF === board && spare.lines.find((x) => x.key === 'drywall_spare')?.ruleOfThumb === false, 'a spare sheet changed a rule of thumb, or is called one');
  check(o, ORDER.SCREWS_PER_BOX === 1000 && ORDER.COMPOUND_GAL_PER_100_SF === 1 && ORDER.TAPE_FT_PER_1000_SF === 370 && ORDER.TAPE_ROLL_FT === 500 && ORDER.COMPOUND_BUCKET_GAL === 5, 'a rule of thumb constant changed without its sentence');
  // The screen and the sentence.
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  check(o, /\{l\.ruleOfThumb && \(\s*<View[^>]*testID=\{`scan-order-rot-\$\{l\.key\}`\}><Text[^>]*>\{ocopy\.ruleOfThumbLabel\}<\/Text><\/View>\s*\)\}/.test(view), 'the screen does not put the Rule Of Thumb label on a rule of thumb line');
  check(o, /testID=\{`scan-order-basis-\$\{l\.key\}`\}>\{ocopy\.assumption\(l\)\}/.test(view), 'the screen does not show how each line was worked out');
  for (const k of ['screwsNote', 'compoundNote', 'tapeNote', 'cornerBeadNote']) check(o, /^Rule of thumb: /.test(String(w.EN[`office.roomScan.order.basis.${k}`])), `the ${k} sentence does not say it is a rule of thumb`);
  check(o, w.EN['office.roomScan.order.ruleOfThumbLabel'] === 'Rule Of Thumb', 'the label is not "Rule Of Thumb"');
  check(o, /1,000/.test(String(w.EN['office.roomScan.order.basis.screwsNote'])) && /370 ft/.test(String(w.EN['office.roomScan.order.basis.tapeNote'])) && /100 sq ft/.test(String(w.EN['office.roomScan.order.basis.compoundNote'])), 'a rule of thumb sentence does not state its rule');
  return o;
});

rule('O7 corner bead counts the outside corners of the outline', (w) => {
  const o: string[] = [];
  for (const [name, want] of [['bathroom', 0], ['l-shape', 1], ['bay-room', 2], ['hallway', 0], ['three-openings', 0]] as [Fixture, number][]) {
    const l = w.M.list(scanOf(name), opts(scanOf(name)));
    check(o, l.outsideCorners === want && qty(l, 'corner_bead') === want, `${name}: ${l.outsideCorners} outside corners and ${qty(l, 'corner_bead')} sticks, the outline has ${want}`);
  }
  return o;
});

rule('O8 flooring and tile: the allowance depends on layout and shape, and says why', (w) => {
  const o: string[] = [];
  const bath = scanOf('bathroom');
  const area = (l: ORDER.OrderList, key = 'floor') => l.lines.find((x) => x.key === key)?.basis as Extract<ORDER.OrderBasis, { kind: 'area' }> | undefined;
  // 41.51 sq ft: x 1.10 = 45.66, x 1.15 = 47.74, x 1.20 = 49.82.
  for (const [layout, pct, want] of [['straight', 10, 46], ['diagonal', 15, 48], ['herringbone', 20, 50]] as [ORDER.FloorLayout, number, number][]) {
    const l = w.M.list(bath, opts(bath, { floorLayout: layout }));
    check(o, qty(l, 'floor') === want && area(l)?.wastePct === pct, `bathroom ${layout}: ${qty(l, 'floor')} sq ft at ${area(l)?.wastePct} percent, worked as ${want} at ${pct}`);
    check(o, area(l)?.reasons.length === 1 && area(l)?.reasons[0].kind === 'layout', `bathroom ${layout}: a plain rectangle was given a shape allowance`);
  }
  // The L has six corners: 10 + 5. 269.1 x 1.15 = 309.46.
  const L = w.M.list(scanOf('l-shape'), opts(scanOf('l-shape')));
  const lr = area(L)?.reasons ?? [];
  check(o, qty(L, 'floor') === 310 && area(L)?.wastePct === 15 && lr.some((r) => r.kind === 'shape' && !r.angled && r.corners === 6), `the L: ${qty(L, 'floor')} sq ft, reasons ${JSON.stringify(lr)}`);
  // The bay has angled walls: 149.0 x 1.15 = 171.35.
  const bay = w.M.list(scanOf('bay-room'), opts(scanOf('bay-room')));
  check(o, qty(bay, 'floor') === 172 && (area(bay)?.reasons ?? []).some((r) => r.kind === 'shape' && r.angled), `the bay room: ${qty(bay, 'floor')} sq ft, reasons ${JSON.stringify(area(bay)?.reasons)}`);
  // His own allowance replaces the worked one and says so. 41.51 x 1.05 = 43.59.
  const own = w.M.list(bath, opts(bath, { floorWastePct: 5 }));
  check(o, qty(own, 'floor') === 44 && area(own)?.reasons.length === 1 && area(own)?.reasons[0].kind === 'typed', `a 5 percent allowance gives ${qty(own, 'floor')}`);
  // Boxes: 46 sq ft at 10 sq ft a box.
  const boxed = w.M.list(bath, opts(bath, { boxSF: 10 }));
  check(o, qty(boxed, 'floor') === 5 && boxed.lines.find((x) => x.key === 'floor')?.unit === 'box', `46 sq ft at 10 sq ft a box is ${qty(boxed, 'floor')} boxes`);
  // Wall tile: nothing until a wet wall is marked.
  const none = w.M.list(bath, opts(bath, { groups: { ...opts(bath).groups, wallTile: true } }));
  check(o, qty(none, 'wall_tile') === undefined && none.gaps.includes('no_wet_wall'), 'wall tile appeared with no wet wall marked');
  // The window wall (98 in), tiled to 72 in: 98 x 72 = 7,056 less the window below 72 in (24 x 32 = 768) = 6,288 sq in = 43.67 sq ft. x 1.10 = 48.03.
  const windowWall = bath.openings.find((x) => x.kind === 'window')?.wallId as string;
  const wet = w.M.list(bath, opts(bath, { groups: { ...opts(bath).groups, wallTile: true }, wetWallIds: [windowWall], wetHeightIn: 72 }));
  check(o, near(area(wet, 'wall_tile')?.netSF, 43.67, 0.01) && qty(wet, 'wall_tile') === 49, `wall tile on the window wall to 6 ft: ${area(wet, 'wall_tile')?.netSF} sq ft net, ${qty(wet, 'wall_tile')} to order`);
  // To the ceiling: 98 x 96 - 24 x 36 = 8,544 sq in = 59.33 sq ft.
  const full = w.M.list(bath, opts(bath, { groups: { ...opts(bath).groups, wallTile: true }, wetWallIds: [windowWall], wetHeightIn: null }));
  check(o, near(area(full, 'wall_tile')?.netSF, 59.33, 0.01), `wall tile to the ceiling: ${area(full, 'wall_tile')?.netSF}`);
  // Wall tile has its own allowance. The floor's layout and the room's shape are the floor's: a herringbone floor in the
  // L-shaped room does not put 25 percent on a wall.
  const wr = area(wet, 'wall_tile')?.reasons ?? [];
  check(o, wr.length === 1 && wr[0].kind === 'wallTile' && wr[0].pct === 10 && area(wet, 'wall_tile')?.wastePct === 10, `wall tile reasons ${JSON.stringify(wr)}`);
  const fancy = w.M.list(bath, opts(bath, { groups: { ...opts(bath).groups, wallTile: true }, wetWallIds: [windowWall], wetHeightIn: 72, floorLayout: 'herringbone' }));
  check(o, qty(fancy, 'wall_tile') === 49 && area(fancy, 'wall_tile')?.wastePct === 10 && qty(fancy, 'floor') === 50, `with a herringbone floor the wall tile is ${qty(fancy, 'wall_tile')} sq ft at ${area(fancy, 'wall_tile')?.wastePct} percent`);
  const Ls = scanOf('l-shape');
  const lwet = w.M.list(Ls, opts(Ls, { groups: { ...opts(Ls).groups, wallTile: true }, wetWallIds: [Ls.walls[0].id] }));
  check(o, area(lwet, 'wall_tile')?.wastePct === 10 && (area(lwet, 'wall_tile')?.reasons ?? []).every((r) => r.kind === 'wallTile'), 'the room\'s shape was added to the wall tile allowance');
  // His own wall tile allowance is his, and is not the floor's: 43.67 x 1.05 = 45.85.
  const ownWall = w.M.list(bath, opts(bath, { groups: { ...opts(bath).groups, wallTile: true }, wetWallIds: [windowWall], wetHeightIn: 72, wallTileWastePct: 5, floorWastePct: 20 }));
  check(o, qty(ownWall, 'wall_tile') === 46 && area(ownWall, 'wall_tile')?.reasons[0].kind === 'typed' && qty(ownWall, 'floor') === 50, `a 5 percent wall allowance beside a 20 percent floor one gives ${qty(ownWall, 'wall_tile')} and ${qty(ownWall, 'floor')}`);
  check(o, (Object.values(ORDER.LAYOUT_WASTE_PCT) as number[]).join() === '10,15,20' && ORDER.SHAPE_WASTE_PCT === 5 && ORDER.WALL_TILE_WASTE_PCT === 10, 'an allowance changed without its test');
  const screen = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  check(o, !/floorWastePct: [^,}]+, wallTileWastePct/.test(screen) && /onPress=\{\(\) => p\.onOptions\(\{ wallTileWastePct: w \}\)\}/.test(screen), 'one tap still sets the floor and the wall tile allowance together');
  const view = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  check(o, /const why = b\.reasons\.map\(reason\)\.join\(' '\);/.test(view) && /return `\$\{head\} \$\{why\}\$\{box\}`;/.test(view), 'the sentence for flooring no longer says why the allowance is what it is');
  return o;
});

rule('O9 paint: net area, coats, a stated spread rate, primer on its own line', (w) => {
  const o: string[] = [];
  const bath = scanOf('bathroom');
  const paint = (l: ORDER.OrderList, key: string) => l.lines.find((x) => x.key === key)?.basis as Extract<ORDER.OrderBasis, { kind: 'paint' }> | undefined;
  const d = w.M.list(bath, opts(bath));
  check(o, near(paint(d, 'paint_walls')?.netSF, 189.33) && near(paint(d, 'paint_walls')?.workedGal, 1.082, 0.001) && qty(d, 'paint_walls') === 2, `walls: ${paint(d, 'paint_walls')?.workedGal} gallons worked, ${qty(d, 'paint_walls')} to buy`);
  check(o, near(paint(d, 'paint_ceiling')?.workedGal, 0.237, 0.001) && qty(d, 'paint_ceiling') === 1, `ceiling: ${paint(d, 'paint_ceiling')?.workedGal}`);
  check(o, near(paint(d, 'primer')?.netSF, 230.85, 0.01) && paint(d, 'primer')?.coats === 1 && paint(d, 'primer')?.spreadSFPerGal === 300 && qty(d, 'primer') === 1, `primer: ${JSON.stringify(paint(d, 'primer'))}`);
  // One coat: 189.33 / 350 = 0.54.
  check(o, qty(w.M.list(bath, opts(bath, { coats: 1 })), 'paint_walls') === 1, 'one coat on the walls is not 1 gallon');
  // Three coats at 250: 189.33 x 3 / 250 = 2.27.
  check(o, qty(w.M.list(bath, opts(bath, { coats: 3, spreadSFPerGal: 250 })), 'paint_walls') === 3, 'three coats at 250 sq ft a gallon is not 3 gallons');
  check(o, qty(w.M.list(bath, opts(bath, { primer: false })), 'primer') === undefined, 'primer stayed on the list after it was turned off');
  // The L: 558.0 x 2 / 350 = 3.19.
  check(o, qty(w.M.list(scanOf('l-shape'), opts(scanOf('l-shape'))), 'paint_walls') === 4, 'the L-shaped room walls are not 4 gallons');
  check(o, ORDER.DEFAULT_SPREAD_SF_PER_GAL === 350 && ORDER.DEFAULT_PRIMER_SPREAD_SF_PER_GAL === 300, 'a spread rate changed without its test');
  check(o, /one gallon to \{spread\} sq ft/.test(JSON.stringify(w.EN['office.roomScan.order.basis.paintNote'])) && /Rounded up to whole gallons/.test(JSON.stringify(w.EN['office.roomScan.order.basis.paintNote'])), 'the paint sentence does not state the spread rate and the rounding');
  return o;
});

/** A small fixed-seed random number source, so the fuzz is the same every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * What one stick per piece buys, WORKED OUT HERE and not read from the plan:
 * every run cut into the fewest pieces the longest stick allows (a joint never
 * leaving less than 24 in), each piece with its allowance where the stick has
 * room, each bought as the shortest stick that holds it.
 */
function onePerPiece(runs: readonly TRIM.TrimRun[], stockFt: readonly number[], allowanceIn = 0): { feet: number; pieces: number; cuts: number[] } {
  const stock = [...stockFt].sort((a, b) => a - b);
  const longest = stock[stock.length - 1] * 12;
  let feet = 0;
  const cuts: number[] = [];
  for (const r of runs) {
    const len = r8v(r.lengthIn);
    if (len < 1) continue;
    const n = Math.max(1, Math.ceil(len / longest - 1e-9));
    const parts = Array.from({ length: n }, (_x, i) => (i < n - 1 ? longest : len - longest * (n - 1)));
    if (n > 1 && parts[n - 1] < 24 && parts[n - 2] - (24 - parts[n - 1]) >= 24) { parts[n - 2] -= 24 - parts[n - 1]; parts[n - 1] = 24; }
    for (const part of parts) {
      const cut = Math.min(longest, r8v(part + allowanceIn));
      cuts.push(cut);
      feet += stock.find((ft) => ft * 12 >= cut - 1e-6) as number;
    }
  }
  return { feet, pieces: cuts.length, cuts };
}

/** The fewest feet ANY grouping of the pieces can buy, by putting each piece in every stick it could go in. Short lists only. */
function fewestFeetByHand(lengths: readonly number[], stockFt: readonly number[]): number {
  const stock = [...stockFt].sort((a, b) => a - b);
  const longest = stock[stock.length - 1] * 12;
  const cost = (used: number) => stock.find((ft) => ft * 12 >= used - 1e-6) as number;
  let best = Infinity;
  const go = (i: number, bins: number[]) => {
    if (i === lengths.length) { best = Math.min(best, bins.reduce((t, b) => t + cost(b), 0)); return; }
    for (let b = 0; b < bins.length; b++) if (bins[b] + lengths[i] <= longest + 1e-6) { bins[b] += lengths[i]; go(i + 1, bins); bins[b] -= lengths[i]; }
    bins.push(lengths[i]); go(i + 1, bins); bins.pop();
  };
  go(0, []);
  return best;
}

rule('O10 trim packing: never worse than one stick per piece worked out another way, no cut longer than its stick, fewest joints, and nothing claimed past what is proven', (w) => {
  const o: string[] = [];
  const subsets = [[8], [12], [16], [8, 12], [8, 16], [12, 16], [8, 12, 16]];
  for (const name of FIXTURES) {
    const scan = scanOf(name);
    for (const stockFt of subsets) {
      const l = w.M.list(scan, opts(scan, { stockFt }));
      for (const kind of ORDER.TRIM_KINDS) {
        const plan = l.trimPlans[kind];
        if (!plan) { if (kind !== 'casing') o.push(`${name}: no ${kind} plan`); continue; }
        const runs: TRIM.TrimRun[] = [];
        const seen = new Set<string>();
        for (const s of plan.sticks) for (const c of s.cuts) if (!seen.has(c.runId)) { seen.add(c.runId); runs.push({ id: c.runId, on: c.on, what: c.what, lengthIn: plan.sticks.flatMap((x) => x.cuts).filter((x) => x.runId === c.runId).reduce((t, x) => t + x.lengthIn, 0) }); }
        for (const p of w.M.checkTrim(plan, runs)) o.push(`${name} ${kind} [${stockFt}]: ${p}`);
        const longest = Math.max(...stockFt) * 12;
        for (const s of plan.sticks) for (const c of s.cuts) check(o, c.lengthIn <= longest + 1e-6 && c.lengthIn <= s.stockFt * 12 + 1e-6, `${name} ${kind} [${stockFt}]: a ${c.lengthIn} in cut on a ${s.stockFt} ft stick`);
        for (const s of plan.sticks) check(o, s.cuts.reduce((t, c) => t + c.lengthIn, 0) <= s.stockFt * 12 + 1e-6, `${name} ${kind} [${stockFt}]: the cuts on a ${s.stockFt} ft stick add to more than the stick`);
        const naive = onePerPiece(runs, stockFt);
        const bought = plan.sticks.reduce((t, s) => t + s.stockFt, 0);
        check(o, bought === plan.boughtFt && bought <= naive.feet + 1e-6 && plan.sticks.length <= naive.pieces, `${name} ${kind} [${stockFt}]: ${plan.boughtFt} ft in ${plan.stickCount} sticks against ${naive.feet} ft in ${naive.pieces}, one stick per piece worked out here`);
        check(o, plan.onePerPiece.boughtFt === naive.feet && plan.onePerPiece.stickCount === naive.pieces, `${name} ${kind} [${stockFt}]: the plan says one stick per piece is ${plan.onePerPiece.boughtFt} ft and it is ${naive.feet}`);
        // The line is the plan: its feet, and its sticks by length.
        const line = l.lines.find((x) => x.key === kind);
        const counts = line?.basis.kind === 'trim' ? line.basis.counts : [];
        check(o, !!line && line.unit === 'foot' && line.computed === bought && counts.reduce((t, c) => t + c.count, 0) === plan.sticks.length && counts.reduce((t, c) => t + c.count * c.stockFt, 0) === bought, `${name} ${kind} [${stockFt}]: the line says ${line?.computed} ft in ${JSON.stringify(counts)} and the plan buys ${bought} ft in ${plan.sticks.length} sticks`);
      }
    }
  }
  // The hallway's 22 ft walls are longer than any stick: one joint each, not two.
  const hall = w.M.list(scanOf('hallway'), opts(scanOf('hallway')));
  check(o, hall.trimPlans.crown?.joints === 1 && hall.trimPlans.baseboard?.joints === 1, `the hallway has ${hall.trimPlans.crown?.joints} crown joints and ${hall.trimPlans.baseboard?.joints} baseboard joints (one 22 ft run of each)`);
  // A joint never leaves a sliver: 196 7/8 in is 172 7/8 + 24, not 192 + 4 7/8.
  const split = TRIM.splitRuns([{ id: 'r', on: 'w', what: 'wall', lengthIn: 196.875 }], 192);
  check(o, split.map((c) => c.lengthIn).join() === '172.875,24', `a 196 7/8 in run is cut ${split.map((c) => c.lengthIn).join(' + ')}`);
  // 3,000 random lists, every subset of stock lengths, half of them WITH an allowance on every piece.
  const rand = rng(20261008);
  let packedBetter = 0;
  for (let i = 0; i < 3000; i++) {
    const stock = subsets[Math.floor(rand() * subsets.length)];
    const n = 1 + Math.floor(rand() * 14);
    const allowance = i % 2 === 0 ? 0 : [0.5, 1, 1.5, 3][Math.floor(rand() * 4)];
    const runs: TRIM.TrimRun[] = [];
    for (let k = 0; k < n; k++) runs.push({ id: `r${k}`, on: 'w', what: 'wall', lengthIn: Math.round((2 + rand() * (rand() < 0.15 ? 400 : 180)) * 8) / 8 });
    const plan = w.M.pack(runs, stock, allowance);
    const bad = TRIM.checkTrimPlan(plan, runs);
    const naive = onePerPiece(runs, stock, allowance);
    const bought = plan.sticks.reduce((t, s) => t + s.stockFt, 0);
    const mine = plan.sticks.flatMap((s) => s.cuts.map((c) => c.lengthIn)).sort((p, q) => p - q).join();
    if (bad.length) o.push(`random list ${i} [${stock}]: ${bad[0]}`);
    else if (plan.sticks.some((s) => s.cuts.reduce((t, c) => t + c.lengthIn, 0) > s.stockFt * 12 + 1e-6)) o.push(`random list ${i} [${stock}]: the cuts on a stick add to more than the stick`);
    else if (mine !== [...naive.cuts].sort((p, q) => p - q).join()) o.push(`random list ${i} [${stock}] with ${allowance} in on each piece: the pieces cut are not the runs with their allowance`);
    else if (bought !== plan.boughtFt || bought > naive.feet + 1e-6 || plan.sticks.length > naive.pieces) o.push(`random list ${i} [${stock}] with ${allowance} in on each piece: ${plan.boughtFt} ft in ${plan.sticks.length} sticks against ${naive.feet} ft in ${naive.pieces}, one stick per piece`);
    else if (plan.onePerPiece.boughtFt !== naive.feet) o.push(`random list ${i} [${stock}]: the plan says one stick per piece is ${plan.onePerPiece.boughtFt} ft and it is ${naive.feet}`);
    // A long list is packed longest piece first, and may not be called searched.
    else if (naive.pieces > TRIM.OPTIMAL_MAX_PIECES && plan.method === 'searched') o.push(`random list ${i}: ${naive.pieces} pieces is called searched`);
    if (o.length > 5) break;
    if (bought < naive.feet) packedBetter += 1;
  }
  check(o, packedBetter > 1500, `packing beat one stick per piece on only ${packedBetter} of 3,000 random lists`);
  // A SHORT list is searched, and what is said about it is true: no grouping buys fewer feet. 400 lists of up to 7 pieces,
  // each checked against every grouping tried here by another method.
  let searched = 0;
  for (let i = 0; i < 400; i++) {
    const stock = subsets[Math.floor(rand() * subsets.length)];
    const longest = Math.max(...stock) * 12;
    const n = 1 + Math.floor(rand() * 7);
    const runs: TRIM.TrimRun[] = Array.from({ length: n }, (_x, k) => ({ id: `s${k}`, on: 'w', what: 'wall' as const, lengthIn: Math.round((2 + rand() * (longest - 2)) * 8) / 8 }));
    const plan = w.M.pack(runs, stock);
    const least = fewestFeetByHand(runs.map((r) => r.lengthIn), stock);
    if (plan.method === 'searched') searched += 1;
    if (plan.method === 'first_fit') o.push(`short list ${i}: ${n} pieces were not searched`);
    else if (plan.method === 'searched' && plan.sticks.reduce((t, s) => t + s.stockFt, 0) !== least) o.push(`short list ${i} [${stock}]: called searched at ${plan.boughtFt} ft, and a grouping buys ${least} ft`);
    if (o.length > 5) break;
  }
  check(o, searched > 300 && TRIM.OPTIMAL_MAX_PIECES === 10, `${searched} of 400 short lists were searched`);
  // A run under an inch is not a cut: the door 1/2 in from the corner leaves no 1/2 in piece of baseboard.
  check(o, TRIM.MIN_RUN_IN === 1 && TRIM.splitRuns([{ id: 'r', on: 'w', what: 'wall', lengthIn: 0.875 }], 192).length === 0 && w.M.pack([{ id: 'a', on: 'w', what: 'wall', lengthIn: 0.5 }, { id: 'b', on: 'w', what: 'wall', lengthIn: 50 }], [8]).pieceCount === 1, 'a run under an inch is cut as a piece');
  const bath = scanOf('bathroom');
  const door = bath.openings.find((x) => x.kind === 'door') as RoomScan['openings'][number];
  const tight: RoomScan = { ...bath, openings: bath.openings.map((x) => (x.id === door.id ? { ...x, offsetM: 30.5 * IN } : x)) };
  const tl = w.M.list(tight, opts(tight));
  const baseCuts = tl.trimPlans.baseboard?.sticks.flatMap((s) => s.cuts.map((c) => c.lengthIn)).sort((p, q) => q - p).join();
  const baseBasis = tl.lines.find((x) => x.key === 'baseboard')?.basis;
  check(o, baseCuts === '98,98,61,30.5' && baseBasis?.kind === 'trim' && near(baseBasis.runFt, 287.5 / 12, 1e-6), `with the door 1/2 in from the corner the baseboard is cut ${baseCuts}`);
  // The words. "Fewest" is said about nothing; the searched sentence is only for a searched list.
  const src = w.F['utils/roomScan/trimPackCore.ts'];
  check(o, /first-fit decreasing/i.test(src) && /NEVER WORSE THAN ONE STICK PER PIECE/.test(src) && /THIS IS NOT ALWAYS THE FEWEST FEET/.test(src), 'trimPackCore.ts no longer names its method, its guarantee and its limit');
  for (const [k, v] of Object.entries(w.EN)) if (k.startsWith('office.roomScan.order.')) for (const f of forms(v)) check(o, !/fewest/i.test(f), `${k}: "${f}" says "fewest"`);
  check(o, w.EN['office.roomScan.order.basis.trimFirstFitNote'] === 'Packed longest piece first.' && /none buys fewer feet/.test(String(w.EN['office.roomScan.order.basis.trimSearchedNote'])), 'the two packing sentences changed');
  const hook = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  check(o, [...hook.matchAll(/order\.basis\.trimSearchedNote/g)].length === 1 && /case 'searched': return t\('office\.roomScan\.order\.basis\.trimSearchedNote'/.test(hook) && /case 'first_fit': return t\('office\.roomScan\.order\.basis\.trimFirstFitNote'/.test(hook), 'the "none buys fewer feet" sentence is shown for a list that was not searched');
  return o;
});

rule('O11 a quantity he typed is kept and marked', (w) => {
  const o: string[] = [];
  const scan = scanOf('bathroom');
  const typed = { drywall_walls: 9, baseboard: 40, corner_bead: 2 };
  const l = w.M.list(scan, opts(scan, { typed }));
  const line = (x: ORDER.OrderList, k: string) => x.lines.find((y) => y.key === k);
  check(o, line(l, 'drywall_walls')?.quantity === 9 && line(l, 'drywall_walls')?.typed === true && line(l, 'drywall_walls')?.computed === 7, `typed 9 sheets reads ${JSON.stringify(line(l, 'drywall_walls'))}`);
  check(o, line(l, 'baseboard')?.quantity === 40 && line(l, 'baseboard')?.typed === true && line(l, 'baseboard')?.computed === 28, 'typed feet of baseboard were not kept');
  // The trim line's key does not carry the stick length, so the typed feet stay when he buys other sticks.
  const other = w.M.list(scan, opts(scan, { typed, stockFt: [16] }));
  check(o, line(other, 'baseboard')?.quantity === 40 && line(other, 'baseboard')?.typed === true && line(other, 'baseboard')?.computed === 32, `with 16 ft sticks only the typed baseboard reads ${JSON.stringify(line(other, 'baseboard'))}`);
  check(o, line(l, 'corner_bead')?.quantity === 2 && line(l, 'corner_bead')?.computed === 0, 'a typed quantity on a zero line was not kept');
  check(o, l.lines.filter((x) => x.typed).length === 3 && line(l, 'paint_walls')?.typed === false, 'a line he did not type is marked typed');
  // Changing other choices never overwrites it.
  for (const patch of [{ sheet: '4x12' as const }, { hang: 'upright' as const }, { coats: 3 }, { floorLayout: 'diagonal' as const }]) {
    const next = w.M.list(scan, opts(scan, { typed, ...patch }));
    check(o, line(next, 'drywall_walls')?.quantity === 9 && line(next, 'drywall_walls')?.typed === true, `changing ${Object.keys(patch)[0]} overwrote the typed sheet count`);
  }
  // The rules of thumb follow the sheets he says he is buying: 9 + 2 = 11 sheets = 352 sq ft.
  check(o, (line(l, 'screws')?.basis as { boardSF: number }).boardSF === 352, 'screws were worked from the app\'s sheet count, not the typed one');
  // It is saved and read back.
  const back = w.M.parseOptions(JSON.parse(JSON.stringify(opts(scan, { typed }))), scan.roomType);
  check(o, back.typed.drywall_walls === 9 && back.typed.baseboard === 40, 'typed quantities do not survive a save');
  const saved = parseSavedScans(JSON.stringify({ version: 1, scans: [{ scan, pushed: {}, manualRates: {}, excluded: [], savedAt: AT, pricedAt: null, order: opts(scan, { typed }) }] }));
  check(o, saved.scans[0]?.order?.typed.drywall_walls === 9, 'a saved scan lost its typed order quantity');
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  check(o, /\{l\.typed && \(\s*<View[^>]*testID=\{`scan-order-typed-\$\{l\.key\}`\}>/.test(view) && /\{l\.typed && <Text[^>]*>\{ocopy\.workedSub\(/.test(view), 'the screen does not mark a typed quantity and show the worked one beside it');
  return o;
});

rule('O12 a changed choice recomputes', (w) => {
  const o: string[] = [];
  const scan = scanOf('bathroom');
  const base = w.M.list(scan, opts(scan));
  check(o, qty(w.M.list(scan, opts(scan, { sheet: '4x12' })), 'drywall_walls') === 6, 'a 4x12 sheet did not change the count');
  check(o, w.M.list(scan, opts(scan, { stockFt: [8] })).trimPlans.baseboard?.counts.map((c) => `${c.stockFt}:${c.count}`).join() === '8:4', `8 ft sticks only: ${JSON.stringify(w.M.list(scan, opts(scan, { stockFt: [8] })).trimPlans.baseboard?.counts)} (98 and 98 take three, the rest share one)`);
  const off = w.M.list(scan, opts(scan, { groups: { drywall: false, flooring: true, wallTile: false, paint: false, trim: false } }));
  check(o, off.lines.map((x) => x.key).join() === 'floor' && off.wallPlan === null, `with only flooring on, the list is ${off.lines.map((x) => x.key).join()}`);
  check(o, qty(w.M.list(scan, opts(scan, { crown: false })), 'crown') === undefined, 'crown stayed after it was turned off');
  // Changing the stick lengths changes the feet and the sticks, never which lines there are.
  for (const stockFt of [[8], [12], [16], [8, 16]]) {
    const next = w.M.list(scan, opts(scan, { stockFt }));
    check(o, next.lines.map((x) => x.key).join() === base.lines.map((x) => x.key).join(), `with ${stockFt} ft sticks the lines are ${next.lines.map((x) => x.key).join()}`);
  }
  check(o, qty(w.M.list(scan, opts(scan, { stockFt: [16] })), 'baseboard') === 32 && qty(base, 'baseboard') === 28, '16 ft sticks only did not change the feet of baseboard');
  check(o, w.M.list(scan, opts(scan, { casingWindows: false })).trimPlans.casing?.pieceCount === 3, 'window casing stayed after it was turned off');
  // A typed wall on the scan changes the list too: the 98 in wall taped at 96 in drops a 2 in piece.
  const longWall = scan.walls.find((x) => Math.abs(x.lengthM - 98 * IN) < 0.01) as RoomScan['walls'][number];
  const fixed = correctWallLength(scan, longWall.id, 96 * IN, AT);
  check(o, JSON.stringify(w.M.list(fixed, opts(fixed)).lines) !== JSON.stringify(base.lines), 'a taped wall did not change the order list');
  // An open outline gives no floor and no ceiling, and says so.
  const open = buildRoomScan(parseCapturedRoom(read('scripts/fixtures/scan-room/missing-wall.json')), META);
  const ol = w.M.list(open, opts(open));
  check(o, qty(ol, 'floor') === undefined && qty(ol, 'drywall_ceiling') === undefined && qty(ol, 'paint_ceiling') === undefined && ol.gaps.includes('floor_not_known'), 'an open outline was given a floor or a ceiling');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, /const orderList = useMemo\(\(\) => \(scan && orderOptions \? buildOrderList\(scan, orderOptions\) : null\), \[scan, orderOptions\]\);/.test(flow), 'the flow does not work the list out again from the scan and the choices');
  return o;
});

const BOOK = buildCostDatabase([], [], [], [], []);
const RATER = OPRICE.makeMaterialRater('');
function projectWith(est: LinkedEstimate | null): Project {
  return { id: 'proj-1', name: 'Maple St', linkedEstimate: est ?? undefined, estimateVersions: [] } as unknown as Project;
}
const EST: LinkedEstimate = {
  id: 'est-1', globalMarkup: 20, baseTotal: 1000, markupTotal: 200, grandTotal: 1200, createdAt: '2026-09-01T00:00:00.000Z',
  items: [{ materialId: 'm1', name: 'Demo', category: 'Demolition', unit: 'LS', quantity: 1, unitPrice: 1000, bulkPrice: 1000, markup: 20, usesBulk: false, lineTotal: 1200, supplier: '' }],
};
let idSeq = 0;
const newId = () => `new-${++idSeq}`;

rule('O13 nothing reaches an estimate or leaves the phone without the confirm', (w) => {
  const o: string[] = [];
  const scan = scanOf('bathroom');
  const l = w.M.list(scan, opts(scan));
  for (const via of ['copy', 'share', 'estimate'] as const) {
    for (const bad of [false, undefined, 'true', 1, null]) {
      check(o, w.M.send({ confirmed: bad as never, via, list: l, at: AT }) === null, `confirmOrderSend(${via}) gave a record for confirmed = ${String(bad)}`);
    }
    const snap = w.M.send({ confirmed: true, via, list: l, at: AT });
    check(o, !!snap && snap.via === via && snap.lines.length === ORDER.orderLinesToBuy(l).length && snap.lines.every((x) => x.quantity > 0), `confirmOrderSend(${via}) with a yes did not record the list`);
  }
  const empty = w.M.list(scan, opts(scan, { groups: { drywall: false, flooring: false, wallTile: false, paint: false, trim: false } }));
  check(o, w.M.send({ confirmed: true, via: 'copy', list: empty, at: AT }) === null, 'an empty list was sent');
  // The estimate: the room draft's own gate.
  const draft = w.M.draft({ ...scan, name: 'Hall Bathroom' }, l, BOOK, RATER);
  const args = { mayEdit: true, project: projectWith(EST), draft, pushed: {}, newId, markupPct: 20 as number | null, now: AT };
  for (const bad of [false, undefined, 'true', 1]) check(o, w.M.patch({ ...args, confirmed: bad as never }) === null, `a patch was built for confirmed = ${String(bad)}`);
  check(o, w.M.patch({ ...args, confirmed: true, mayEdit: false }) === null, 'a patch was built for a seat that may not edit');
  check(o, w.M.patch({ ...args, confirmed: true, draft: { ...draft, roomName: '' } }) === null, 'a patch was built for a room with no name');
  const res = w.M.patch({ ...args, confirmed: true });
  check(o, !!res && res.added === PRICING.draftPushLines(draft).length && res.added > 0, `a confirmed patch added ${res?.added} lines`);
  // The screen: onSend is called only from the three confirm buttons.
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  const calls = [...view.matchAll(/p\.onSend\(/g)].length;
  const guarded = [...view.matchAll(/primaryAction=\{\{ label: ocopy\.confirm(Copy|Share|Estimate)YesLabel, onPress: \(\) => \{ setConfirming\(null\); p\.onSend\('(copy|share|estimate)', true\); \}/g)];
  check(o, calls === 3 && guarded.length === 3 && guarded.every((m) => m[1].toLowerCase() === m[2]), `OrderListView calls onSend ${calls} times, ${guarded.length} of them from a confirm sheet's yes`);
  check(o, /onPress=\{\(\) => setConfirming\('copy'\)\}/.test(view) && /onPress=\{\(\) => setConfirming\('share'\)\}/.test(view) && /onPress=\{\(\) => setConfirming\('estimate'\)\}/.test(view), 'a send button no longer opens its confirm sheet first');
  check(o, !/copyToClipboard|shareText|Clipboard|Share\.share|updateProject/.test(view), 'OrderListView sends something itself');
  // The flow: the record is asked for first, and nothing is done without it.
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  const start = flow.indexOf('const sendOrder = useCallback(');
  const body = flow.slice(start, flow.indexOf('}, [saved, orderList, orderDraft, orderBusy', start));
  check(o, start > 0 && /const snap = confirmOrderSend\(\{ confirmed, via, list: orderList, at: [^}]+\}\);\s*if \(!snap\) \{[^}]*return; \}/.test(body), 'sendOrder does not ask the core for the confirmed record first');
  const snapAt = body.indexOf('if (!snap)');
  for (const call of ['copyToClipboard(', 'shareText(', 'buildEstimatePatch(', 'updateProject(', 'orderListText(']) {
    const at = body.indexOf(call);
    check(o, at > snapAt && snapAt > 0, `sendOrder reaches ${call} before the confirmed record is checked`);
  }
  check(o, /buildEstimatePatch\(\{\s*confirmed, mayEdit: mayEditEstimate, project, draft: orderSendDraft,/.test(body), 'the order list does not go into the estimate through buildEstimatePatch with the tap\'s own confirmed value');
  const kept = body.indexOf('kept = estimateHoldsPush(getProjectRef.current(project.id) ?? null, res);');
  check(o, kept > body.indexOf('updateProject(') && body.indexOf("setOrderSend('added')") > kept && body.indexOf('router.push(') > kept && [...body.matchAll(/setOrderSend\('added'\)/g)].length === 1 && /if \(!kept\) \{ setOrderSend\('unconfirmed'\); return; \}/.test(body), '"Added to the estimate." is said for the order list before the project is seen to hold the lines');
  const outsideSend = flow.slice(0, start) + flow.slice(start + body.length);
  check(o, !/copyToClipboard\(|shareText\(|orderListText\(/.test(outsideSend), 'the flow copies or shares the list outside sendOrder');
  check(o, /onSend=\{\(via, confirmed\) => void sendOrder\(via, confirmed\)\}/.test(flow), 'the flow does not hand the tap\'s confirmed value to sendOrder');
  for (const f of NEW_FILES) {
    if (f === 'components/roomScan/OrderListView.tsx') continue;
    check(o, !/copyToClipboard|shareText\(|expo-clipboard|expo-sharing|expo-print/.test(stripComments(w.F[f])), `${f} can send the list somewhere`);
  }
  return o;
});

rule('O14 material lines go through the takeoff path, each saying where its price came from', (w) => {
  const o: string[] = [];
  const scan = { ...scanOf('bathroom'), name: 'Hall Bathroom' };
  const l = w.M.list(scan, opts(scan));
  const d = w.M.draft(scan, l, BOOK, RATER);
  check(o, d.lines.length === ORDER.orderLinesToBuy(l).length, 'a line with nothing to buy was priced, or one to buy was dropped');
  for (const line of d.lines) {
    const priced = line.amountCents != null;
    check(o, priced ? (line.source === 'engine' || line.source === 'manual') && (line.rate as number) > 0 : line.source === null && line.rate === null, `${line.key}: ${priced ? 'a priced line has no source' : 'an unpriced line has a source or a rate'}`);
    check(o, line.row.condition.trade === null && line.row.condition.wastePct === 0, `${line.key}: the condition carries a trade or a second waste`);
    check(o, line.quantity === (l.lines.find((x) => x.key === line.key) as ORDER.OrderLine).quantity, `${line.key}: the priced quantity is not the list's`);
    check(o, line.conditionId === `scanorder:${scan.id}:${line.key}`, `${line.key}: condition id ${line.conditionId}`);
  }
  // 7 + 2 sheets at the catalog's 4x8 price, and the lines the catalog names nothing for.
  const sheet = MATERIALS.find((m) => m.id === 'd1');
  check(o, !!sheet && sheet.unit === 'sheet' && /4x8/.test(sheet.name), 'catalog item d1 is no longer a 4x8 sheet');
  for (const [id, unit, word] of [['d2', 'sheet', '4x12'], ['d12', 'box', 'Screws'], ['d6', 'bucket', 'Joint Compound'], ['d8', 'roll', 'Tape'], ['d10', 'each', 'Corner Bead'], ['pa1', 'gallon', 'Paint'], ['pa6', 'gallon', 'Primer']]) {
    const m = MATERIALS.find((x) => x.id === id);
    check(o, !!m && m.unit === unit && m.name.includes(word), `catalog item ${id} is no longer a ${word} sold by the ${unit}`);
  }
  const walls = d.lines.find((x) => x.key === 'drywall_walls');
  check(o, !!walls && walls.source === 'engine' && walls.rate === sheet?.baseRetailPrice && walls.amountCents === Math.round(7 * (sheet?.baseRetailPrice ?? 0) * 100), `drywall sheets priced at ${walls?.rate}`);
  for (const k of ['floor', 'baseboard', 'crown', 'casing']) check(o, d.lines.find((x) => x.key === k)?.source === null, `${k} was given a catalog price (the catalog names no one item for it)`);
  check(o, OPRICE.catalogItemFor({ key: 'drywall_walls' }, '4x10') === null, 'a 4x10 sheet was priced from another size');
  check(o, d.pricedCount === 8 && d.unpricedCount === d.lines.length - 8 && d.catalogCount === 8 && d.manualCount === 0, `counts: ${d.pricedCount} priced, ${d.unpricedCount} not`);
  // His installed drywall rate is NOT a sheet price.
  const book = buildCostDatabase([], [], [], [], [{ id: 's1', trade: 'Drywall', unit: 'EA', rate: 55 }, { id: 's2', trade: 'drywall_walls', unit: 'EA', rate: 77 }] as never);
  const d2 = w.M.draft(scan, l, book, () => null);
  check(o, d2.lines.every((x) => x.source === null && x.amountCents === null), 'a material line was priced from his installed cost book');
  // A typed price wins and is labelled as typed.
  const d3 = w.M.draft(scan, l, BOOK, RATER, { manualRates: { drywall_walls: 11.5, baseboard: 1.25 } });
  const d3base = d3.lines.find((x) => x.key === 'baseboard');
  // Trim is priced by the foot of stick: 28 ft at 1.25 is 35.00.
  check(o, d3.lines.find((x) => x.key === 'drywall_walls')?.source === 'manual' && d3.lines.find((x) => x.key === 'drywall_walls')?.amountCents === 8050 && d3base?.source === 'manual' && d3base?.unit === 'LF' && d3base?.quantity === 28 && d3base?.amountCents === 3500, `a typed price did not win: baseboard ${JSON.stringify({ unit: d3base?.unit, q: d3base?.quantity, c: d3base?.amountCents })}`);
  // The push is the takeoff's own: the same lines pushLinesFrom gives, written by applyTakeoffPush.
  const lines = PRICING.draftPushLines(d);
  const direct = pushLinesFrom(d.lines.map((x) => x.row)).lines;
  check(o, JSON.stringify(lines) === JSON.stringify(direct) && lines.length === 8, `the push lines differ from pushLinesFrom (${lines.length})`);
  check(o, lines.every((x) => x.priceSource === undefined), 'a catalog or typed material price is stamped as learned on the estimate');
  idSeq = 0;
  const res = w.M.patch({ confirmed: true, mayEdit: true, project: projectWith(EST), draft: d, pushed: {}, newId, markupPct: 20, now: AT });
  idSeq = 0;
  const want = applyTakeoffPush(EST, lines, {}, newId);
  const bare = (items: LinkedEstimate['items']) => JSON.stringify(items.map((it) => { const { priceSource: _drop, ...rest } = it; return rest; }));
  check(o, !!res && bare(res.next.items) === bare(want.next.items) && res.afterGrand === want.afterGrand, 'the estimate the patch writes is not what applyTakeoffPush gives');
  // WHERE THE PRICE CAME FROM, on the estimate line itself. With `sources`, a catalog price is 'regional' and a typed
  // one 'seeded' (the two values types/index.ts gives for those), never 'learned' and never left blank.
  idSeq = 0;
  const stamped = w.M.patch({ confirmed: true, mayEdit: true, project: projectWith(EST), draft: d3, pushed: {}, newId, markupPct: 20, now: AT, after: OPRICE.orderAfterPush({ sources: OPRICE.orderPriceSources(d3) }) });
  const mine = (stamped?.next.items ?? []).filter((it) => it.sourceTakeoffConditionId?.startsWith('scanorder:'));
  const src = (key: string) => mine.find((it) => it.sourceTakeoffConditionId === `scanorder:${scan.id}:${key}`)?.priceSource;
  check(o, mine.length === 9 && mine.every((it) => it.priceSource === 'regional' || it.priceSource === 'seeded') && src('drywall_walls') === 'seeded' && src('baseboard') === 'seeded' && src('paint_walls') === 'regional' && src('screws') === 'regional', `the estimate lines' price sources are ${mine.map((it) => String(it.priceSource)).join()}`);
  check(o, stamped?.next.items.find((it) => it.materialId === 'm1')?.priceSource === undefined, 'a line that is not the order list\'s was given a price source');
  const flowSrc = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, /after: orderAfterPush\(\{ remove: resend\.remove, sources: orderPriceSources\(orderSendDraft\) \}\),/.test(flowSrc), 'the flow does not hand the price sources to the patch');
  // Sending twice updates in place.
  const again = w.M.patch({ confirmed: true, mayEdit: true, project: projectWith(res?.next ?? null), draft: d, pushed: res?.pushed ?? {}, newId, markupPct: 20, now: AT });
  check(o, !!again && again.added === 0 && again.next.items.length === (res?.next.items.length ?? -1), `a second send added ${again?.added} lines and left ${again?.next.items.length} on the estimate`);
  const core = stripComments(w.F['utils/roomScan/orderPricingCore.ts']);
  check(o, !/lookupRate|matchOwnRate|priceTakeoff|resolveTrade/.test(core) && /priceCondition\(db, condition, l\.quantity\)/.test(core), 'orderPricingCore prices by a path of its own');
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  check(o, /testID=\{`scan-order-source-\$\{l\.key\}`\}>\s*<Text[^>]*>\{ocopy\.materialSourceLabel\(price\?\.source \?\? null, copy\.sourceLabel\('manual', null\), copy\.sourceLabel\(null, null\)\)\}/.test(view), 'the screen does not label each line with where its price came from');
  // A catalog price for a material is not waiting on past jobs: the material path never reads the cost book.
  check(o, w.EN['office.roomScan.order.source.catalogLabel'] === 'Catalog Price For This Material' && !/copy\.sourceLabel\(price/.test(view), 'a catalog material price is labelled with the installed draft\'s "No Past Jobs Yet" label');
  const hookSrc = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  check(o, /materialSourceLabel: \(source, typedLabel, noPriceLabel\) => \(source === 'engine'\s*\? t\('office\.roomScan\.order\.source\.catalogLabel'/.test(hookSrc) && /Your past jobs do not change it/.test(String(w.EN['office.roomScan.order.materialPriceNote'])), 'the material price label or its note no longer says past jobs do not change it');
  return o;
});

/** Plain words for the text builder: enough to read the result. */
const WORDS: ORDER.OrderTextWords = {
  title: (room) => `Order list, ${room}`,
  notice: String((EN_REAL as Record<string, unknown>)['office.roomScan.order.noticeBody']),
  group: (g) => g.toUpperCase(),
  line: (l) => l.key,
  quantity: (l) => `${l.quantity} ${l.unit}`,
  typedMark: 'typed',
  ruleOfThumbMark: 'rule of thumb',
  assumption: (l) => `basis ${l.basis.kind}`,
  cutListHeading: (k) => `Cut list, ${k}`,
  stick: (ft, cuts) => `${ft} ft: ${cuts.join(' + ')}`,
  length: (inches) => `${inches} in`,
};

rule('O15 the list as plain text carries every line, the notice and the cut list', (w) => {
  const o: string[] = [];
  const scan = scanOf('bathroom');
  const l = w.M.list(scan, opts(scan, { typed: { paint_walls: 3 } }));
  const text = w.M.text(l, 'Hall Bathroom', WORDS);
  const rows = text.split('\n');
  check(o, rows[0] === 'Order list, Hall Bathroom' && rows[1] === 'A phone scan can be off by an inch or more. Check before you order.', `the text starts "${rows[0]}" / "${rows[1]}"`);
  for (const line of ORDER.orderLinesToBuy(l)) check(o, rows.some((r) => r.startsWith(`  ${line.key}: ${line.quantity} ${line.unit}`)), `the text has no line for ${line.key}`);
  check(o, !/corner_bead/.test(text), 'a line with nothing to buy is in the text');
  check(o, /paint_walls: 3 gallon \(typed\)/.test(text), 'a typed quantity is not marked in the text');
  check(o, /screws: 1 box \(rule of thumb\)/.test(text), 'a rule of thumb is not marked in the text');
  check(o, /Cut list, baseboard\n {2}16 ft: 98 in \+ 61 in \+ 26\.375 in \+ 4\.625 in\n {2}12 ft: 98 in/.test(text), 'the text has no baseboard cut list');
  check(o, rows.filter((r) => r.startsWith('    basis ')).length === ORDER.orderLinesToBuy(l).length, 'a line in the text does not say how it was worked out');
  return o;
});

// ── the second send ─────────────────────────────────────────────────────────
// THE CASE, as the reviewer ran it: push the bathroom, then choose 16 ft sticks
// only, turn Paint off, type 0 boxes of screws, and push again. Before the fix
// the 12 ft baseboard line, all three paint lines and the screws stayed in the
// estimate. Here every trim and floor line is given a typed price so that all
// thirteen lines with something to buy go in (the catalog prices eight).
const RESEND_RATES = { floor: 3, baseboard: 1.25, crown: 2, casing: 1.5 };

rule('O16 sent to the estimate a second time, the lines the list no longer has are removed and named first, and a line he changed by hand is left alone', (w) => {
  const o: string[] = [];
  const scan = { ...scanOf('bathroom'), name: 'Hall Bathroom' };
  const names = (l: ORDER.OrderList) => Object.fromEntries(l.lines.map((x) => [x.key, `${x.key}, Hall Bathroom`]));
  const cid = (key: string) => `scanorder:${scan.id}:${key}`;
  const ids = (d: OPRICE.OrderDraft) => PRICING.draftPushLines(d).map((x) => x.conditionId);

  // THE FIRST SEND.
  const l1 = w.M.list(scan, opts(scan));
  const d1 = w.M.draft(scan, l1, BOOK, RATER, { manualRates: RESEND_RATES, names: names(l1) });
  idSeq = 0;
  const r1 = w.M.patch({ confirmed: true, mayEdit: true, project: projectWith(EST), draft: d1, pushed: {}, newId, markupPct: 20, now: AT, after: OPRICE.orderAfterPush({ sources: OPRICE.orderPriceSources(d1) }) });
  if (!r1) return ['the first send built no patch'];
  check(o, r1.added === 12 && r1.removedIds.length === 0, `the first send added ${r1.added} lines (twelve with something to buy: corner bead is zero)`);
  const wrote1 = OPRICE.orderWroteFrom(r1, ids(d1));
  check(o, Object.keys(wrote1).length === 12 && wrote1[cid('baseboard')]?.quantity === 28, `the record of what the first send wrote has ${Object.keys(wrote1).length} lines`);
  // BETWEEN THE SENDS, in the estimate itself: he changes the crown to 40 ft by hand. And the estimate holds lines that
  // are not this list's: the Demo line he typed, the room draft's installed drywall line for this same scan, and a
  // paint line from ANOTHER scan's order list.
  const crown1 = r1.next.items.find((it) => it.sourceTakeoffConditionId === cid('crown')) as LinkedEstimate['items'][number];
  const foreign: LinkedEstimate['items'] = [
    { materialId: 'x-installed', name: 'Drywall, Walls, Hall Bathroom', category: 'Drywall', unit: 'SF', quantity: 190, unitPrice: 4, bulkPrice: 4, markup: 20, usesBulk: false, lineTotal: 912, supplier: '', sourceTakeoffConditionId: `scan:${scan.id}:drywall_walls` },
    { materialId: 'x-other', name: 'paint_walls, Kitchen', category: 'paint_walls, Kitchen', unit: 'EA', quantity: 3, unitPrice: 30, bulkPrice: 30, markup: 20, usesBulk: false, lineTotal: 108, supplier: '', sourceTakeoffConditionId: 'scanorder:another-scan:paint_walls' },
  ];
  const est1: LinkedEstimate = { ...r1.next, items: [...r1.next.items.map((it) => (it === crown1 ? { ...it, quantity: 40, lineTotal: 96 } : it)), ...foreign] };
  // THE CHOICES CHANGE: 16 ft sticks only, Paint off, 0 boxes of screws.
  const l2 = w.M.list(scan, opts(scan, { stockFt: [16], groups: { ...opts(scan).groups, paint: false }, typed: { screws: 0 } }));
  const d2 = w.M.draft(scan, l2, BOOK, RATER, { manualRates: RESEND_RATES, names: names(l2) });
  check(o, qty(l2, 'baseboard') === 32 && qty(l2, 'screws') === 0 && qty(l2, 'paint_walls') === undefined, `the changed list reads baseboard ${qty(l2, 'baseboard')}, screws ${qty(l2, 'screws')}, paint ${qty(l2, 'paint_walls')}`);

  // THE PLAN, worked out before the sheet opens.
  const plan = w.M.resend({ estimate: est1, scanId: scan.id, pushed: r1.pushed, wrote: wrote1, lines: PRICING.draftPushLines(d2) });
  const gone = ['paint_walls', 'paint_ceiling', 'primer', 'screws'].map(cid).sort();
  check(o, plan.remove.map((x) => x.conditionId).sort().join() === gone.join(), `the plan removes ${plan.remove.map((x) => x.conditionId.split(':').pop()).join(', ')} (it should be the three paint lines and the screws)`);
  check(o, plan.remove.every((x) => x.name === `${x.conditionId.split(':').pop()}, Hall Bathroom`), `the lines to remove are not named for the sheet: ${plan.remove.map((x) => x.name).join(' / ')}`);
  check(o, plan.leftAlone.map((x) => x.conditionId).join() === cid('crown') && plan.skip.join() === cid('crown'), `the line he changed by hand is not left alone: ${JSON.stringify(plan.leftAlone)} / ${plan.skip.join()}`);
  const said = String((w.EN['office.roomScan.order.send.resendRemoveBody'] as { other: string }).other).replace('{count}', String(plan.remove.length)).replace('{names}', plan.remove.map((x) => x.name).join('; '));
  check(o, /^4 lines will be removed, because they are no longer on this list: /.test(said) && plan.remove.every((x) => said.includes(x.name)), `the sheet would say "${said}"`);
  check(o, /because you changed/.test(forms(w.EN['office.roomScan.order.send.resendLeftAloneBody']).join(' ')) && /\{names\}/.test(forms(w.EN['office.roomScan.order.send.resendLeftAloneBody']).join(' ')) && /Every other line in the estimate is left as it is/.test(String(w.EN['office.roomScan.order.send.resendUntouchedNote'])), 'the sheet does not say which lines are left alone and why');

  // THE SECOND SEND, with that plan.
  const send2 = OPRICE.orderDraftWithout(d2, plan.skip);
  const r2 = w.M.patch({ confirmed: true, mayEdit: true, project: projectWith(est1), draft: send2, pushed: r1.pushed, newId, markupPct: 20, now: AT, after: OPRICE.orderAfterPush({ remove: plan.remove, sources: OPRICE.orderPriceSources(send2) }) });
  if (!r2) return [...o, 'the second send built no patch'];
  const item = (est: LinkedEstimate, id: string) => est.items.filter((it) => it.sourceTakeoffConditionId === id);
  for (const id of gone) check(o, item(r2.next, id).length === 0, `${id.split(':').pop()} is still in the estimate after the second send`);
  check(o, r2.removedIds.slice().sort().join() === gone.join() && gone.every((id) => !(id in r2.pushed)) && r2.added === 0, `the patch reports ${r2.removedIds.length} removed and ${r2.added} added`);
  // The 12 ft baseboard line is the SAME estimate line, now 32 ft of 16 ft sticks. There is one of it.
  const base1 = item(r1.next, cid('baseboard'))[0];
  const base2 = item(r2.next, cid('baseboard'));
  check(o, base2.length === 1 && base2[0].materialId === base1.materialId && base1.quantity === 28 && base2[0].quantity === 32, `baseboard after the second send: ${JSON.stringify(base2.map((it) => [it.materialId, it.quantity]))} (one line, the first send's, at 32 ft)`);
  check(o, r2.next.items.filter((it) => /^baseboard/.test(it.name)).length === 1, 'a second baseboard line is in the estimate');
  // The line he changed by hand is byte for byte what he left. So is every line that is not this list's.
  check(o, JSON.stringify(item(r2.next, cid('crown'))) === JSON.stringify(item(est1, cid('crown'))) && item(r2.next, cid('crown'))[0]?.quantity === 40, 'the crown line he changed by hand was updated or removed');
  for (const id of ['m1', 'x-installed', 'x-other']) check(o, JSON.stringify(r2.next.items.find((it) => it.materialId === id)) === JSON.stringify(est1.items.find((it) => it.materialId === id)), `the line ${id}, which is not this order list's, was touched`);
  // The totals moved by exactly the lines that changed.
  const sum = (est: LinkedEstimate) => est.items.reduce((t, it) => t + it.lineTotal, 0);
  check(o, near(r2.next.grandTotal - est1.grandTotal, sum(r2.next) - sum(est1), 0.011) && r2.next.grandTotal < est1.grandTotal, `the grand total moved ${(r2.next.grandTotal - est1.grandTotal).toFixed(2)} and the lines moved ${(sum(r2.next) - sum(est1)).toFixed(2)}`);
  check(o, near(r2.next.baseTotal + r2.next.markupTotal, r2.next.grandTotal, 0.011), 'cost plus markup no longer foots to the grand total');
  // "Added" is said only when the removed lines are seen to be gone.
  check(o, PRICING.estimateHoldsPush(projectWith(r2.next), r2) === true && PRICING.estimateHoldsPush(projectWith({ ...r2.next, items: [...r2.next.items, item(est1, gone[0])[0]] }), r2) === false, 'the push is called kept while a removed line is still on the project');
  // A third send with nothing changed removes nothing and still leaves the crown.
  const wrote2 = { ...wrote1, ...OPRICE.orderWroteFrom(r2, ids(send2)) };
  for (const id of r2.removedIds) delete wrote2[id];
  const plan3 = w.M.resend({ estimate: r2.next, scanId: scan.id, pushed: r2.pushed, wrote: wrote2, lines: PRICING.draftPushLines(d2) });
  check(o, plan3.remove.length === 0 && plan3.leftAlone.map((x) => x.conditionId).join() === cid('crown'), `a third send with nothing changed would remove ${plan3.remove.length} lines`);
  // The removal is the takeoff push's own arithmetic: re-push the line at zero, then take the emptied line out.
  const zero = applyTakeoffPush(est1, plan.remove.map((x) => { const it = item(est1, x.conditionId)[0]; return { conditionId: x.conditionId, name: it.name, trade: it.category, unit: it.unit as 'EA', quantity: 0, rate: it.unitPrice, priceSource: undefined }; }), r1.pushed, newId).next;
  const cutOnly = OPRICE.removeOrderLines(est1, plan.remove).next;
  check(o, cutOnly.grandTotal === zero.grandTotal && cutOnly.baseTotal === zero.baseTotal && cutOnly.markupTotal === zero.markupTotal && cutOnly.items.length === est1.items.length - 4, `removing four lines leaves totals ${cutOnly.baseTotal}/${cutOnly.markupTotal}/${cutOnly.grandTotal}, and the takeoff push at zero gives ${zero.baseTotal}/${zero.markupTotal}/${zero.grandTotal}`);
  const pcore = stripComments(w.F['utils/roomScan/orderPricingCore.ts']);
  check(o, !/roundCents|lineTotal\s*[:=]|markup\s*\/\s*100|Total\s*[-+]=|Total - |Total \+ /.test(pcore) && /const res = applyTakeoffPush\(est, zeroed,/.test(pcore), 'the order pricing core subtracts from the estimate by arithmetic of its own');
  // Never by one id alone, never without the record, never another scan's.
  check(o, OPRICE.removeOrderLines(est1, [{ conditionId: cid('primer'), materialId: 'not-the-line' }, { conditionId: 'not-the-id', materialId: 'm1' }]).removedIds.length === 0, 'a line was removed on one matching id');
  const blind = w.M.resend({ estimate: est1, scanId: scan.id, pushed: r1.pushed, wrote: undefined, lines: PRICING.draftPushLines(d2) });
  check(o, blind.remove.length === 0 && blind.leftAlone.length === 12, `with no record of what the send wrote, ${blind.remove.length} lines would be removed`);
  const elsewhere = w.M.resend({ estimate: est1, scanId: 'another-scan', pushed: { 'scanorder:another-scan:paint_walls': 'x-other', ...r1.pushed }, wrote: { 'scanorder:another-scan:paint_walls': { materialId: 'x-other', name: 'paint_walls, Kitchen', unit: 'EA', quantity: 3, unitPrice: 30 } }, lines: [] });
  check(o, elsewhere.remove.map((x) => x.materialId).join() === 'x-other', 'a plan for one scan reaches another scan\'s lines');
  // A line he deleted from the estimate himself is neither removed nor protected.
  const deleted = w.M.resend({ estimate: { ...est1, items: est1.items.filter((it) => it.sourceTakeoffConditionId !== cid('primer')) }, scanId: scan.id, pushed: r1.pushed, wrote: wrote1, lines: PRICING.draftPushLines(d2) });
  check(o, deleted.remove.length === 3 && !deleted.remove.some((x) => x.conditionId === cid('primer')), 'a line he already deleted is in the plan');
  // The record survives a save.
  const back = parseSavedScans(JSON.stringify({ version: 1, scans: [{ scan, pushed: {}, manualRates: {}, excluded: [], savedAt: AT, pricedAt: null, orderPushed: r1.pushed, orderWrote: wrote1 }] }));
  check(o, back.scans[0]?.orderWrote?.[cid('baseboard')]?.quantity === 28 && Object.keys(back.scans[0]?.orderWrote ?? {}).length === 12, 'the record of what a send wrote is lost on save');
  // THE WIRING: one plan, shown on the sheet by name and handed to the patch.
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, /const resend = useMemo\(\(\) => planOrderResend\(\{\s*estimate: estimateNow, scanId: saved\?\.scan\.id \?\? '', pushed: saved\?\.orderPushed, wrote: saved\?\.orderWrote,\s*lines: orderDraft \? draftPushLines\(orderDraft\) : \[\],/.test(flow), 'the flow does not plan the second send from the estimate, the record and the list');
  check(o, /const orderSendDraft = useMemo\(\(\) => \(orderDraft \? orderDraftWithout\(orderDraft, resend\.skip\) : null\), \[orderDraft, resend\]\);/.test(flow) && /draft: orderSendDraft, pushed: saved\.orderPushed \?\? \{\},\s*newId: generateUUID, markupPct, now: snap\.at,\s*after: orderAfterPush\(\{ remove: resend\.remove,/.test(flow), 'the patch is not built from the same plan the sheet shows');
  check(o, /resend=\{\{ again: Object\.keys\(saved\.orderPushed \?\? \{\}\)\.length > 0, remove: resend\.remove\.map\(\(r\) => r\.name\), leftAlone: resend\.leftAlone\.map\(\(r\) => r\.name\) \}\}/.test(flow), 'the sheet is not handed the names of the lines to remove and to leave');
  check(o, /const orderWrote = \{ \.\.\.\(saved\.orderWrote \?\? \{\}\), \.\.\.orderWroteFrom\(res, draftPushLines\(orderSendDraft\)\.map\(\(l\) => l\.conditionId\)\) \};\s*for \(const id of res\.removedIds\) delete orderWrote\[id\];/.test(flow) && /orderPushed: res\.pushed, orderWrote, savedAt: snap\.at/.test(flow), 'the flow does not keep the record of what the send wrote');
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  const sheet = view.slice(view.indexOf('testID="scan-order-confirm-estimate"'));
  check(o, /\{p\.resend\.remove\.length > 0 && <Text[^>]*testID="scan-order-confirm-remove">\{ocopy\.resendRemoveBody\(p\.resend\.remove\)\}<\/Text>\}/.test(sheet) && /\{p\.resend\.leftAlone\.length > 0 && <Text[^>]*testID="scan-order-confirm-left-alone">\{ocopy\.resendLeftAloneBody\(p\.resend\.leftAlone\)\}<\/Text>\}/.test(sheet) && /\{p\.resend\.again && <Text[^>]*>\{ocopy\.resendUntouchedNote\}<\/Text>\}/.test(sheet), 'the estimate confirm sheet does not name the lines to be removed and the lines left alone');
  return o;
});

// ── casing, worked by hand ──────────────────────────────────────────────────
// THE BATHROOM'S DOOR is 30 by 80, its WINDOW 24 by 36. A mitred casing runs
// past the opening by its own width at each mitre.
//   DEFAULT: 2 1/4 in casing, the door cased on this side only, the window
//   picture-framed.
//     door    two legs 80 + 2 1/4 = 82 1/4 (one mitre, square at the floor)
//             head     30 + 4 1/2 = 34 1/2                     199 in
//     window  two legs 36 + 4 1/2 = 40 1/2 (a mitre at each end)
//             head and sill 24 + 4 1/2 = 28 1/2 each           138 in
//     337 in = 28.08 ft. (At the bare opening the door was 190 in and went on
//     one 16 ft stick with 2 in to spare. At 199 in it does not.)
//   BOTH SIDES: the door twice, 398 in. The window is not doubled. 536 in.
//   STOOL AND APRON: window legs 36 + 2 1/4 = 38 1/4 (square on the stool),
//     head 28 1/2, apron 28 1/2: 133 1/2 in. No sill. The stool is not counted.
//   3 1/2 IN CASING: door legs 83 1/2, head 37 (204 in); window legs 43, head
//     and sill 31 (148 in).
// The Quantities screen's Door Casing is the door at the bare opening, one
// side: 80 + 80 + 30 = 190 in = 15.83 ft. With both sides, 31.67 ft.
rule('O17 casing is cut with its mitres and says what it assumed', (w) => {
  const o: string[] = [];
  const scan = scanOf('bathroom');
  const cuts = (l: ORDER.OrderList, what?: string) => (l.trimPlans.casing?.sticks ?? []).flatMap((s) => s.cuts).filter((c) => !what || c.what === what).map((c) => c.lengthIn).sort((p, q) => q - p).join();
  const cb = (l: ORDER.OrderList) => { const b = l.lines.find((x) => x.key === 'casing')?.basis; return b?.kind === 'trim' ? b.casing : null; };
  const total = (l: ORDER.OrderList) => (l.trimPlans.casing?.sticks ?? []).flatMap((s) => s.cuts).reduce((t, c) => t + c.lengthIn, 0);
  const d = w.M.list(scan, opts(scan));
  check(o, ORDER.DEFAULT_CASING_WIDTH_IN === 2.25 && ORDER.CASING_WIDTHS_IN.join() === '2.25,2.5,3.25,3.5' && ORDER.defaultOrderOptions('bathroom').casingWidthIn === 2.25 && ORDER.defaultOrderOptions('bathroom').casingBothSides === false && ORDER.defaultOrderOptions('bathroom').windowTrim === 'picture', 'the casing defaults changed without their test');
  check(o, cuts(d) === '82.25,82.25,40.5,40.5,34.5,28.5,28.5' && total(d) === 337, `default casing is cut ${cuts(d)} (${total(d)} in), worked by hand as 82.25, 82.25, 40.5, 40.5, 34.5, 28.5, 28.5 (337 in)`);
  check(o, cuts(d, 'leg') === '82.25,82.25,40.5,40.5' && cuts(d, 'head') === '34.5,28.5' && cuts(d, 'sill') === '28.5' && cuts(d, 'apron') === '', `legs ${cuts(d, 'leg')}, heads ${cuts(d, 'head')}, sill ${cuts(d, 'sill')}`);
  // The door alone no longer fits one 16 ft stick.
  const doorOnly = w.M.list(scan, opts(scan, { casingWindows: false, stockFt: [16] }));
  check(o, cuts(doorOnly) === '82.25,82.25,34.5' && total(doorOnly) === 199 && doorOnly.trimPlans.casing?.stickCount === 2 && cb(doorOnly)?.windows === 0, `the door alone is ${total(doorOnly)} in on ${doorOnly.trimPlans.casing?.stickCount} sixteen-foot sticks`);
  const both = w.M.list(scan, opts(scan, { casingBothSides: true }));
  check(o, cuts(both) === '82.25,82.25,82.25,82.25,40.5,40.5,34.5,34.5,28.5,28.5' && total(both) === 536, `cased both sides: ${cuts(both)} (${total(both)} in, worked as 536)`);
  const stool = w.M.list(scan, opts(scan, { windowTrim: 'stool' }));
  check(o, cuts(stool) === '82.25,82.25,38.25,38.25,34.5,28.5,28.5' && cuts(stool, 'apron') === '28.5' && cuts(stool, 'sill') === '' && total(stool) === 199 + 133.5, `stool and apron: ${cuts(stool)}, apron ${cuts(stool, 'apron')}, sill "${cuts(stool, 'sill')}"`);
  const wide = w.M.list(scan, opts(scan, { casingWidthIn: 3.5 }));
  check(o, cuts(wide) === '83.5,83.5,43,43,37,31,31' && total(wide) === 352, `3 1/2 in casing: ${cuts(wide)} (${total(wide)} in, worked as 352)`);
  // What the line says it assumed, and the same number the Quantities screen shows.
  const b = cb(d);
  check(o, !!b && b.widthIn === 2.25 && b.bothSides === false && b.windowTrim === 'picture' && b.doors === 1 && b.windows === 1, `the casing line's assumptions: ${JSON.stringify(b)}`);
  check(o, !!b && near(b.doorOpeningFt, 190 / 12, 1e-9) && near(b.doorFt, 199 / 12, 1e-9) && near(b.windowFt, 138 / 12, 1e-9), `door ${b?.doorOpeningFt} ft bare and ${b?.doorFt} ft cut, window ${b?.windowFt} ft`);
  check(o, !!b && near(b.doorOpeningFt, computeQuantities(scan).casingLF, 0.001) && near(cb(both)?.doorOpeningFt, computeQuantities(scan, { casingSides: 2 }).casingLF, 0.001), `the Quantities screen shows ${computeQuantities(scan).casingLF} ft of door casing and the order list's bare door is ${b?.doorOpeningFt}`);
  const line = d.lines.find((x) => x.key === 'casing');
  check(o, line?.basis.kind === 'trim' && near(line.basis.runFt, 337 / 12, 1e-9) && near(line.net?.quantity, 337 / 12, 1e-9), 'the casing line\'s feet to cover are not the mitred pieces');
  // The sentences, and the controls.
  const hook = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  for (const k of ['casingWidthNote', 'casingDoorsBothNote', 'casingDoorsOneNote', 'casingWindowsPictureNote', 'casingWindowsStoolNote', 'casingNoWindowsNote', 'casingQuantitiesNote']) check(o, new RegExp(`'office\\.roomScan\\.order\\.basis\\.${k}'`).test(hook) && `office.roomScan.order.basis.${k}` in w.EN, `the casing sentence ${k} is not shown`);
  check(o, /mitred/.test(String(w.EN['office.roomScan.order.basis.casingWidthNote'])) && /\{width\} in wide/.test(String(w.EN['office.roomScan.order.basis.casingWidthNote'])), 'the casing line does not say the width and that it is mitred');
  check(o, /cased on the side in this room only/.test(forms(w.EN['office.roomScan.order.basis.casingDoorsOneNote']).join(' ')) && /picture-framed on four sides/.test(forms(w.EN['office.roomScan.order.basis.casingWindowsPictureNote']).join(' ')) && /The stool is a different stock and is not on this list/.test(forms(w.EN['office.roomScan.order.basis.casingWindowsStoolNote']).join(' ')), 'the casing line does not say what it assumed about doors and windows');
  check(o, /The Quantities screen shows door casing at the bare opening, \{bare\} ft\. With the mitres it is \{cut\} ft here\./.test(String(w.EN['office.roomScan.order.basis.casingQuantitiesNote'])) && /bare: n1\(c\.doorOpeningFt\), cut: n1\(c\.doorFt\)/.test(hook), 'the casing line does not square itself with the Quantities screen');
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  check(o, /CASING_WIDTHS_IN\.map\(\(w\) => <Chip[^>]*onPress=\{\(\) => p\.onOptions\(\{ casingWidthIn: w \}\)\}/.test(view) && /onPress=\{\(\) => p\.onOptions\(\{ casingBothSides: true \}\)\}/.test(view) && /WINDOW_TRIMS\.map\(\(w\) => <Chip[^>]*onPress=\{\(\) => p\.onOptions\(\{ windowTrim: w \}\)\}/.test(view), 'the screen has no control for the casing width, both sides, or the window trim');
  const back = w.M.parseOptions(JSON.parse(JSON.stringify(opts(scan, { casingWidthIn: 3.25, casingBothSides: true, windowTrim: 'stool' }))), scan.roomType);
  check(o, back.casingWidthIn === 3.25 && back.casingBothSides === true && back.windowTrim === 'stool', 'the casing choices do not survive a save');
  return o;
});

// ── the layout's rules on walls nobody drew by hand ─────────────────────────
/** A random wall with up to three openings that do not overlap: a door from the floor, a window, or a cased opening to the ceiling. */
function randomWall(rand: () => number, i: number): CUT.WallSurface {
  const W = r8v(20 + rand() * 380);
  const H = r8v([84, 96, 96, 97.125, 98, 108, 120][Math.floor(rand() * 7)] + (rand() < 0.3 ? rand() * 6 : 0));
  const openings: CUT.RectIn[] = [];
  let x = r8v(rand() * 30);
  for (let k = 0; k < 3 && x < W - 20; k++) {
    if (rand() < 0.35) { x += r8v(10 + rand() * 60); continue; }
    const kind = rand();
    const width = r8v(Math.min(W - x - 0.5, kind < 0.4 ? 24 + rand() * 12 : 18 + rand() * 54));
    if (width < 12) break;
    if (kind < 0.4) openings.push({ x0: x, x1: x + width, y0: 0, y1: Math.min(H, r8v(78 + rand() * 6)) });
    else if (kind < 0.85) { const sill = r8v(20 + rand() * 24); openings.push({ x0: x, x1: x + width, y0: sill, y1: Math.min(H - 4, r8v(sill + 24 + rand() * 30)) }); }
    else openings.push({ x0: x, x1: x + width, y0: 0, y1: H });
    x = r8v(x + width + (rand() < 0.2 ? 1 + rand() * 12 : 14 + rand() * 80));
  }
  return { kind: 'wall', id: `rw${i}`, widthIn: W, heightIn: H, openings };
}

rule('O18 the layout keeps a hanger\'s rules on a few hundred random walls and L-shaped ceilings', (w) => {
  const o: string[] = [];
  const rand = rng(20261009);
  const hangs: CUT.HangDirection[] = ['across', 'upright'];
  let jointed = 0;
  let narrow = 0;
  let gaps = 0;
  // 320 walls, one at a time and in rooms of four that share offcuts.
  for (let i = 0; i < 320 && o.length < 6; i++) {
    const walls = i % 4 === 0 ? [randomWall(rand, i), randomWall(rand, i + 1000), randomWall(rand, i + 2000), randomWall(rand, i + 3000)] : [randomWall(rand, i)];
    const sheet = CUT.SHEET_KEYS[Math.floor(rand() * 3)];
    const hang = hangs[Math.floor(rand() * 2)];
    const plan = w.M.sheets(walls, { sheet, hang });
    check(o, plan.sheet === sheet && plan.hang === hang, `random wall ${i}: asked for ${sheet} ${hang}, laid out ${plan.sheet} ${plan.hang}`);
    for (const p of wallPlanProblems(plan, walls, `random wall ${i} (${walls.map((x) => `${x.widthIn}x${x.heightIn}`).join(' ')}, ${sheet} ${hang})`).slice(0, 2)) o.push(p);
    for (const s of plan.surfaces) { if (s.pieces.length > 1) jointed += 1; if (s.pieces.some((p) => p.narrow)) narrow += 1; if (s.floorGapIn > 0) gaps += 1; }
  }
  check(o, jointed > 200 && narrow > 10 && gaps > 10, `the random walls did not exercise the rules: ${jointed} with joints, ${narrow} with a narrow strip, ${gaps} with a gap at the floor`);
  // 160 L-shaped ceilings: a rectangle with one corner taken out, every side at least 2 ft.
  for (let i = 0; i < 160 && o.length < 6; i++) {
    const W = r8v(120 + rand() * 300);
    const H = r8v(60 + rand() * Math.min(W - 60, 240));
    const nw = r8v(24 + rand() * (W - 48));
    const nh = r8v(24 + rand() * (H - 48));
    const polygon = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H - nh }, { x: W - nw, y: H - nh }, { x: W - nw, y: H }, { x: 0, y: H }];
    const sheet = CUT.SHEET_KEYS[Math.floor(rand() * 3)];
    const plan = w.M.sheets([{ kind: 'ceiling', id: `rc${i}`, polygon }], { sheet, hang: 'across' });
    for (const p of ceilingPlanProblems(plan, W * H - nw * nh, `random L ceiling ${i} (${W} by ${H} less ${nw} by ${nh}, ${sheet})`).slice(0, 2)) o.push(p);
  }
  // Every way a run may be cut: the pieces add to the run, none is longer than a sheet, none is under the minimum.
  for (const L of [96, 120, 144]) for (let len = L + 1; len <= 620 && o.length < 6; len += 0.125) {
    for (const way of CUT.waysToCut(len, L)) {
      if (Math.abs(way.reduce((t, x) => t + x, 0) - len) > 1e-6 || way.some((x) => x > L + 1e-6 || x < MIN_PIECE - 1e-6)) { o.push(`a ${len} in run on ${L} in sheets may be cut ${way.join(' + ')}`); break; }
    }
  }
  check(o, CUT.waysToCut(98, 96)[0].join() === '82,16' && CUT.waysToCut(96, 96).join() === '96' && CUT.waysToCut(61, 96).join() === '61', `a 98 in run on 96 in sheets is first cut ${CUT.waysToCut(98, 96)[0].join(' + ')}`);
  // THE GAP AT THE FLOOR. One 96 in wide wall under 4x8 sheets lying down. Up to 2 in taller than two courses, it is two
  // sheets and a gap for the baseboard; past that, the strip is boarded. The scan's own inch of error no longer flips it.
  for (const [h, sheets, gap] of [[96, 2, 0], [97, 2, 1], [97.125, 2, 1.125], [98, 2, 2], [98.125, 3, 0], [100, 3, 0]] as [number, number, number][]) {
    const plan = w.M.sheets([{ kind: 'wall', id: 'g', widthIn: 96, heightIn: h, openings: [] }], { sheet: '4x8', hang: 'across' });
    check(o, plan.sheets === sheets && plan.surfaces[0].floorGapIn === gap, `a ${h} in tall wall: ${plan.sheets} sheets and a ${plan.surfaces[0].floorGapIn} in gap at the floor, worked as ${sheets} and ${gap}`);
    const up = w.M.sheets([{ kind: 'wall', id: 'g', widthIn: 96, heightIn: h, openings: [] }], { sheet: '4x8', hang: 'upright' });
    check(o, up.surfaces[0].floorGapIn === gap && up.sheets === (gap > 0 || h === 96 ? 2 : 3), `the same wall with the sheets standing: ${up.sheets} sheets and a ${up.surfaces[0].floorGapIn} in gap`);
  }
  check(o, /A \{gap\} in gap at the floor is left for the baseboard\./.test(String(w.EN['office.roomScan.order.layout.floorGapNote'])), 'the gap at the floor is not reported in words');
  // A LONGER SHEET IS A SUGGESTION. 1 to 24 in over, and only when a longer sheet exists. The layout is not changed.
  const hint = (wide: number, sheet: CUT.SheetKey) => w.M.sheets([{ kind: 'wall', id: 'h', widthIn: wide, heightIn: 96, openings: [] }], { sheet, hang: 'across' });
  check(o, JSON.stringify(hint(98, '4x8').surfaces[0].longerSheet) === JSON.stringify({ sheet: '4x10', overIn: 2, along: 'length' }) && hint(98, '4x8').sheet === '4x8' && hint(98, '4x8').surfaces[0].pieces.length === 4, `a 98 in wall on 4x8: ${JSON.stringify(hint(98, '4x8').surfaces[0].longerSheet)}`);
  check(o, hint(121, '4x8').surfaces[0].longerSheet === null && hint(120, '4x8').surfaces[0].longerSheet?.sheet === '4x10' && hint(130, '4x10').surfaces[0].longerSheet?.sheet === '4x12' && hint(150, '4x12').surfaces[0].longerSheet === null && hint(96, '4x8').surfaces[0].longerSheet === null, 'the longer-sheet suggestion is offered outside 1 to 24 in, or with no longer sheet to offer');
  check(o, /Nothing here has been changed\./.test(String(w.EN['office.roomScan.order.layout.longerSheetNote'])) && /with no butt joint/.test(String(w.EN['office.roomScan.order.layout.longerSheetNote'])), 'the suggestion does not say it changed nothing');
  // NO SPARE unless he adds one, and the list says which.
  const scan = scanOf('bathroom');
  const plain = w.M.list(scan, opts(scan));
  const spared = w.M.list(scan, opts(scan, { spareSheets: 1 }));
  const sb = (l: ORDER.OrderList, key: string) => { const b = l.lines.find((x) => x.key === key)?.basis; return b?.kind === 'sheets' ? b.spare : undefined; };
  check(o, sb(plain, 'drywall_walls') === 0 && sb(plain, 'drywall_ceiling') === null && qty(plain, 'drywall_spare') === undefined && ORDER.defaultOrderOptions('bathroom').spareSheets === 0, `with no spare added the walls line carries ${sb(plain, 'drywall_walls')}`);
  check(o, qty(spared, 'drywall_spare') === 1 && sb(spared, 'drywall_walls') === 1 && qty(spared, 'drywall_walls') === spared.wallPlan?.sheets && qty(plain, 'drywall_walls') === plain.wallPlan?.sheets && qty(spared, 'drywall_walls') === qty(plain, 'drywall_walls'), 'a spare is hidden inside the wall count, or missing after it was added');
  check(o, w.EN['office.roomScan.order.layout.noSpareNote'] === 'No spare sheet included.' && w.EN['office.roomScan.order.layout.addSpareLabel'] === 'Add One Spare', 'the spare words changed');
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  check(o, /\{o\.spareSheets > 0 \? ocopy\.spareAddedNote\(o\.spareSheets\) : ocopy\.noSpareNote\}/.test(view) && /<Button label=\{ocopy\.addSpareLabel\}[^>]*onPress=\{\(\) => p\.onOptions\(\{ spareSheets: 1 \}\)\}/.test(view), 'the screen does not print "No spare sheet included." with a one-tap way to add one');
  check(o, /\{shown\.floorGapIn > 0 && <Text[^>]*>\{ocopy\.floorGapNote\(shown\.floorGapIn\)\}<\/Text>\}/.test(view) && /\{shown\.longerSheet && \(\s*<Text[^>]*>\{ocopy\.longerSheetNote\(shown\.longerSheet\.overIn, shown\.longerSheet\.sheet, shown\.longerSheet\.along\)\}<\/Text>\s*\)\}/.test(view) && /ocopy\.layoutRulesNote\(/.test(view), 'the screen does not show the gap at the floor, the longer-sheet suggestion and the two rules');
  check(o, /No piece is under \{piece\} in long unless the wall is that narrow\. Butt joints are kept \{stagger\} in apart/.test(String(w.EN['office.roomScan.order.layout.rulesNote'])), 'the minimum piece and the stagger are not stated');
  return o;
});

rule('O19 the core guards its own inputs: a wild option never makes a quantity that is not a number', (w) => {
  const o: string[] = [];
  const wild = { spreadSFPerGal: 0, primerSpreadSFPerGal: Number.NaN, coats: Number.NaN, floorWastePct: -500, wallTileWastePct: Number.POSITIVE_INFINITY, stockFt: [], sheet: '9x9', hang: 'sideways', minOffcutIn: -5, casingWidthIn: Number.NaN, spareSheets: 1e9, trimAllowanceIn: Number.POSITIVE_INFINITY, longWallAddIn: Number.NaN, boxSF: -3, wetHeightIn: Number.NaN, floorLayout: 'zigzag', typed: { floor: Number.POSITIVE_INFINITY, paint_walls: -4, screws: Number.NaN } } as unknown as Partial<ORDER.OrderOptions>;
  for (const name of FIXTURES) {
    const scan = scanOf(name);
    const l = w.M.list(scan, { ...opts(scan), ...wild, groups: { drywall: true, flooring: true, wallTile: true, paint: true, trim: true }, wetWallIds: [scan.walls[0].id] });
    for (const x of l.lines) check(o, Number.isFinite(x.quantity) && Number.isFinite(x.computed) && x.quantity >= 0 && x.computed >= 0, `${name}: ${x.key} is ${x.quantity} (worked ${x.computed}) with wild options`);
    check(o, l.lines.length >= 13, `${name}: only ${l.lines.length} lines survived wild options`);
    const c = l.options;
    check(o, c.spreadSFPerGal === 350 && c.primerSpreadSFPerGal === 300 && c.coats === 2 && c.floorWastePct === 0 && c.wallTileWastePct === null && c.stockFt.join() === '8,12,16' && c.sheet === '4x8' && c.hang === 'across' && c.minOffcutIn === 0 && c.casingWidthIn === 2.25 && c.spareSheets === ORDER.MAX_SPARE_SHEETS && c.trimAllowanceIn === 0 && c.longWallAddIn === 0 && c.boxSF === null && c.wetHeightIn === null && c.floorLayout === 'straight' && Object.keys(c.typed).length === 0, `${name}: the options the list used are ${JSON.stringify(c)}`);
  }
  const scan = scanOf('bathroom');
  // Held to a limit, not only replaced: 99 coats is 4, a spread of 5 is 50, of a million is 1,000, a waste of 1,000 percent is 100.
  const held = w.M.list(scan, opts(scan, { coats: 99, spreadSFPerGal: 5, primerSpreadSFPerGal: 1e6, floorWastePct: 1000 })).options;
  check(o, held.coats === 4 && held.spreadSFPerGal === 50 && held.primerSpreadSFPerGal === 1000 && held.floorWastePct === 100, `limits: ${JSON.stringify([held.coats, held.spreadSFPerGal, held.primerSpreadSFPerGal, held.floorWastePct])}`);
  // Good options pass through unchanged.
  check(o, JSON.stringify(ORDER.cleanOrderOptions(opts(scan))) === JSON.stringify(opts(scan)), 'the guard changes options that were fine');
  // A scan with a wall whose length is not a number: no line carries it, and nothing of it can be sent.
  const broken: RoomScan = { ...scan, walls: scan.walls.map((x, i) => (i === 0 ? { ...x, lengthM: Number.NaN } : x)) };
  const bl = w.M.list(broken, opts(broken));
  check(o, bl.lines.every((x) => Number.isFinite(x.quantity) && Number.isFinite(x.computed)), `a wall with no length made the line ${bl.lines.find((x) => !Number.isFinite(x.quantity))?.key}`);
  const snap = w.M.send({ confirmed: true, via: 'copy', list: bl, at: AT });
  check(o, !!snap && snap.lines.every((x) => Number.isFinite(x.quantity)), 'a quantity that is not a number was sent');
  const core = stripComments(w.F['utils/roomScan/orderListCore.ts']);
  check(o, /export function buildOrderList\(scan: RoomScan, options: OrderOptions\): OrderList \{\s*const o = cleanOrderOptions\(options\);/.test(core) && /if \(!Number\.isFinite\(line\.computed\) \|\| line\.computed < 0\) return;/.test(core), 'buildOrderList does not guard its options and its worked numbers itself');
  return o;
});

/** The line under the drawing for one piece, built from the shard the way the copy hook builds it. */
function pieceSentence(w: World, p: CUT.CutPiece): string {
  const frac = (n: number) => { const e = Math.round(n * 8); const whole = Math.floor(e / 8); let num = e % 8; let den = 8; while (num > 0 && num % 2 === 0) { num /= 2; den /= 2; } return num === 0 ? String(whole) : whole > 0 ? `${whole} ${num}/${den}` : `${num}/${den}`; };
  const L = (k: string) => String(w.EN[`office.roomScan.order.layout.${k}`]);
  const parts = [p.fromOffcut ? L('fromOffcutPart') : L('fromNewPart')];
  for (const k of [...new Set(p.cutouts.map((c) => c.kind))]) parts.push(k === 'door' ? L('cutDoorPart') : k === 'window' ? L('cutWindowPart') : L('cutOpeningPart'));
  if (p.narrow) parts.push(L('narrowPart'));
  if (p.cutToShape) parts.push(L('shapePart'));
  return L('pieceSub').replace('{sheet}', String(p.sheet)).replace('{long}', frac(p.w)).replace('{wide}', frac(p.h)).replace('{parts}', parts.join(', '));
}

rule('O20 the cut layout is written out in words under the drawing, and an offcut is not told apart by colour alone', (w) => {
  const o: string[] = [];
  const scan = scanOf('bathroom');
  const l = w.M.list(scan, opts(scan));
  const all = (l.wallPlan?.surfaces ?? []).flatMap((s) => s.pieces).map((p) => pieceSentence(w, p));
  // The bathroom, in the words a hanger would read: the two 82 in pieces over the window, the top of the door, and the strip beside it.
  check(o, all.filter((x) => /^Sheet \d+: 82 by 48 in, from a new sheet, window cut out$/.test(x)).length === 2, `the window wall's pieces read: ${all.filter((x) => /window/.test(x)).join(' | ')}`);
  check(o, all.some((x) => /^Sheet \d+: 61 by 48 in, from a new sheet, door cut out$/.test(x)), `the piece over the door reads: ${all.filter((x) => /door/.test(x)).join(' | ')}`);
  check(o, all.some((x) => /^Sheet \d+: 4 5\/8 by 48 in, from an offcut, the wall is this narrow here$/.test(x)) && all.some((x) => /^Sheet \d+: 26 3\/8 by 48 in, from an offcut$/.test(x)), `the pieces beside the door read: ${all.filter((x) => /5\/8|3\/8/.test(x)).join(' | ')}`);
  check(o, all.filter((x) => /^Sheet \d+: 16 by 48 in, from an offcut$/.test(x)).length === 4 && all.length === 13, `${all.length} pieces, ${all.filter((x) => / 16 in/.test(x)).length} of them 16 in`);
  const bay = w.M.list(scanOf('bay-room'), opts(scanOf('bay-room')));
  check(o, (bay.ceilingPlan?.surfaces[0].pieces ?? []).some((p) => /cut to the shape of the room$/.test(pieceSentence(w, p))), 'a ceiling piece cut to the bay is not said to be');
  // The layout carries what the words need: which kind of opening was cut out of a piece.
  const kinds = (l.wallPlan?.surfaces ?? []).flatMap((s) => s.pieces.flatMap((p) => p.cutouts.map((c) => c.kind))).sort().join();
  check(o, kinds === 'door,window,window', `the cutouts are of ${kinds}`);
  // The screen: the list is under the drawing, is what a screen reader hears, and the view is memoised.
  const cut = stripComments(w.F['components/roomScan/CutLayoutView.tsx']);
  check(o, /accessibilityLabel=\{\[a11yLabel, \.\.\.pieceLines\]\.join\('\. '\)\}/.test(cut), 'the drawing\'s accessibility label is only its title');
  check(o, /\{pieceLines\.map\(\(line, i\) => \(\s*<Text key=\{`line-\$\{i\}`\}[^>]*>\{line\}<\/Text>\s*\)\)\}/.test(cut) && cut.indexOf('</Svg>') < cut.indexOf('{pieceLines.map('), 'the pieces are not listed in words under the drawing');
  check(o, /export const CutLayoutView = React\.memo\(CutLayout, \(a, b\) =>\s*a\.surface === b\.surface/.test(cut), 'the cut layout is not memoised');
  // Not by colour alone: a piece from an offcut is striped, every piece has the same fill, and the list says it in words.
  check(o, /if \(p\.fromOffcut\) for \(let x = x0 \+ STRIPE; x < x0 \+ w - 1; x \+= STRIPE\) stripes\.push\(x\);/.test(cut) && /\{stripes\.map\(\(x\) => <Line /.test(cut) && !/fill=\{p\.fromOffcut/.test(cut) && !/fromOffcut \? colors\./.test(cut), 'a piece from an offcut is told from a new sheet by its colour alone');
  check(o, /striped/.test(String(w.EN['office.roomScan.order.layout.legendOffcutSub'])) && /striped/.test(String(w.EN['office.roomScan.order.layout.introBody'])) && !/shaded/.test(String(w.EN['office.roomScan.order.layout.introBody'])), 'the legend still describes a shade');
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  check(o, /const pieceLines = React\.useMemo\(\(\) => \(shown \? shown\.pieces\.map\(\(x\) => ocopy\.pieceSub\(x\)\) : \[\]\), \[shown, ocopy\]\);/.test(view) && /<CutLayoutView surface=\{shown\} a11yLabel=\{ocopy\.layoutA11y\(surfaceName\(shown\)\)\} listLabel=\{ocopy\.pieceListLabel\} pieceLines=\{pieceLines\}/.test(view) && /legendBoxOffcut\]\}><View style=\{styles\.legendStripe\} \/>/.test(view), 'the screen does not hand the drawing its piece list, or its legend is a colour swatch');
  const hook = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  check(o, /return t\('office\.roomScan\.order\.layout\.pieceSub', 'Sheet \{sheet\}: \{long\} by \{wide\} in, \{parts\}', \{ sheet: p\.sheet, long: inchFraction\(p\.w\), wide: inchFraction\(p\.h\), parts: parts\.join\(', '\) \}\);/.test(hook) && /const parts: string\[\] = \[p\.fromOffcut\s*\? t\('office\.roomScan\.order\.layout\.fromOffcutPart', 'from an offcut'\)/.test(hook), 'the copy hook does not build the piece line from the piece');
  return o;
});

rule('O21 the "material is in there twice" warning is on every confirm that can cause it, and is specific when the other lines are already there', (w) => {
  const o: string[] = [];
  // The order list's confirm: the sentence is in BOTH bodies (adding to an estimate, and starting one), not inside the choice between them.
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  const sheet = view.slice(view.indexOf('testID="scan-order-confirm-estimate"'));
  check(o, /\{p\.starting && p\.markupPct != null \? ocopy\.confirmEstimateStartBody\(p\.pushCount, total, p\.markupPct\) : ocopy\.confirmEstimateBody\(p\.pushCount, total\)\}\s*<\/Text>\s*<Text style=\{styles\.para\} testID="scan-order-confirm-double-count">\{ocopy\.doubleCountBody\(p\.installedAlreadyIn\)\}<\/Text>/.test(sheet), 'the double-count sentence is not on the order list\'s confirm for both "add" and "start an estimate"');
  const general = String(w.EN['office.roomScan.order.send.doubleCountBody']);
  const specific = String(w.EN['office.roomScan.order.send.doubleCountInBody']);
  check(o, /material only/.test(general) && /twice/.test(general) && /now or later/.test(general), `the general sentence reads "${general}"`);
  check(o, /installed lines for this room/.test(specific) && /already in this estimate/.test(specific) && /twice/.test(specific) && /until you take one of the two out/.test(specific), `the specific sentence reads "${specific}"`);
  const hook = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  check(o, /doubleCountBody: \(installedAlreadyIn\) => \(installedAlreadyIn\s*\? t\('office\.roomScan\.order\.send\.doubleCountInBody'/.test(hook), 'the copy hook does not choose the specific sentence');
  // "Already there" is read off the estimate, by both ids the push recorded.
  const scan = { ...scanOf('bathroom'), name: 'Hall Bathroom' };
  const l = w.M.list(scan, opts(scan));
  const d = w.M.draft(scan, l, BOOK, RATER);
  idSeq = 0;
  const r = w.M.patch({ confirmed: true, mayEdit: true, project: projectWith(EST), draft: d, pushed: {}, newId, markupPct: 20, now: AT });
  check(o, !!r && PRICING.pushedLinesInEstimate(projectWith(r.next), r.pushed) === 8 && PRICING.pushedLinesInEstimate(projectWith(EST), r.pushed) === 0 && PRICING.pushedLinesInEstimate(null, r.pushed) === 0 && PRICING.pushedLinesInEstimate(projectWith(r.next), undefined) === 0 && PRICING.pushedLinesInEstimate(projectWith(r.next), {}) === 0, 'the count of pushed lines still in the estimate is wrong');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, /installedAlreadyIn=\{pushedLinesInEstimate\(project, saved\.pushed\) > 0\}/.test(flow), 'the order list is not told when this room\'s installed lines are already in the estimate');
  // THE MIRROR: Price It's confirm, when the order list's material lines are already there.
  check(o, /materialsAlreadyIn=\{pushedLinesInEstimate\(project, saved\.orderPushed\) > 0\}/.test(flow), 'Price It is not told when this room\'s material lines are already in the estimate');
  const priced = stripComments(w.F['components/roomScan/PricedDraftView.tsx']);
  const confirm = priced.slice(priced.indexOf('testID="scan-confirm-sheet"'));
  check(o, /\{p\.materialsAlreadyIn === true && <Text style=\{styles\.para\} testID="scan-confirm-materials-in">\{copy\.confirmMaterialsInBody\}<\/Text>\}/.test(confirm), 'Price It\'s confirm does not carry the mirror sentence');
  const mirror = String(w.EN['office.roomScan.confirm.materialsInBody']);
  check(o, /order list are already in this estimate/.test(mirror) && /twice/.test(mirror) && !!w.ES['office.roomScan.confirm.materialsInBody'], `the mirror sentence reads "${mirror}"`);
  check(o, /confirmMaterialsInBody: t\('office\.roomScan\.confirm\.materialsInBody'/.test(stripComments(w.F['hooks/useRoomScanCopy.ts'])), 'the mirror sentence is not in the Scan The Room copy');
  return o;
});

// ── B. the learning loop ────────────────────────────────────────────────────

/** A taped wall: the scan said `scanFt`, the tape read `diffIn` inches more. */
function pair(i: number, scanFt: number, diffIn: number, more: Partial<LEARN.TapePair> = {}): LEARN.TapePair {
  const scannedM = scanFt / 3.28084;
  return { scanId: `hist-${Math.floor(i / 3)}`, wallId: `wall-${i}`, scannedM, tapedM: scannedM + diffIn * IN, lengthClass: LEARN.lengthClass(scannedM), deviceModel: 'iPhone16,1', roomType: 'room', at: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`, ...more };
}
// THE FIXTURE HISTORY: 14 walls he taped. Nine under 12 ft, five 12 ft and over.
//   under 12 ft, tape minus scan, inches:  0, 1/4, 1/4, -1/4, 1/2, 1/2, -1/2, 1/2, 1
//   12 ft and over:                        3/4, 1, 1 1/2, 2, 2 1/2
//   Within 1 inch: all nine short ones, and 3/4 and 1 of the long ones = 11.
//   Largest: 2 1/2. The fourteen sizes in order: 0, 1/4, 1/4, 1/4, 1/2, 1/2,
//   1/2, 1/2, 3/4, 1, 1, 1 1/2, 2, 2 1/2: the middle two are both 1/2.
//   Long walls: all five taped longer by 1/2 in or more; the middle one is 1 1/2.
const HISTORY: LEARN.TapePair[] = [
  ...[0, 0.25, 0.25, -0.25, 0.5, 0.5, -0.5, 0.5, 1].map((d, i) => pair(i, 5 + i * 0.7, d)),
  ...[0.75, 1, 1.5, 2, 2.5].map((d, i) => pair(9 + i, 12 + i * 2, d)),
];

/** The English sentence the screen would show, built from the shard the way the copy hook does. */
function factsSentence(w: World, f: LEARN.TapeFacts): string {
  const inches = (n: number) => (n === 1 ? String(w.EN['office.roomScan.order.tape.inchOneValue']) : String(w.EN['office.roomScan.order.tape.inchesValue']).replace('{n}', String(Math.round(n * 100) / 100)));
  if (!f.enough) {
    if (f.count === 0) return String(w.EN['office.roomScan.order.tape.noneBody']).replace('{needed}', String(f.needed));
    const forms = w.EN['office.roomScan.order.tape.notEnoughBody'] as { one: string; other: string };
    return (f.count === 1 ? forms.one : forms.other).replace('{count}', String(f.count)).replace('{needed}', String(f.needed));
  }
  return String(w.EN['office.roomScan.order.tape.factsBody'])
    .replace('{count}', String(f.count)).replace('{within}', String(f.withinCount))
    .replace('{largest}', inches(f.largestIn)).replace('{typical}', inches(f.typicalIn));
}

rule('L1 the facts on the fixture history of 14 taped walls', (w) => {
  const o: string[] = [];
  const f = w.M.facts(HISTORY);
  check(o, f.enough === true, 'fourteen walls are not enough');
  if (f.enough) {
    check(o, f.count === 14 && f.withinCount === 11, `${f.withinCount} of ${f.count} within an inch, worked as 11 of 14`);
    check(o, f.largestIn === 2.5 && f.typicalIn === 0.5, `largest ${f.largestIn}, typical ${f.typicalIn}, worked as 2.5 and 0.5`);
    check(o, f.longCount === 5 && f.farCount === 0 && f.withinIn === 1, `long ${f.longCount}, far ${f.farCount}`);
  }
  const s = factsSentence(w, f);
  check(o, s === 'Across 14 walls you taped, the scan was within 1 inch on 11. The largest difference was 2.5 inches. The typical difference was 0.5 inches.', `the sentence reads "${s}"`);
  // A scan that read long counts the same as one that read short: the difference has no sign in the facts.
  const flipped = w.M.facts(HISTORY.map((p) => ({ ...p, tapedM: p.scannedM - (p.tapedM - p.scannedM) })));
  check(o, flipped.enough && f.enough && flipped.withinCount === f.withinCount && flipped.largestIn === f.largestIn, 'the facts change when every difference changes sign');
  const hook = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  check(o, /count: f\.count, within: f\.withinCount, largest: inchesText\(f\.largestIn\), typical: inchesText\(f\.typicalIn\),/.test(hook), 'the copy hook does not fill the sentence from the facts');
  return o;
});

rule('L2 below the minimum count there are no differences at all', (w) => {
  const o: string[] = [];
  check(o, LEARN.MIN_TAPE_PAIRS === 5, 'the minimum count changed without its test');
  for (const n of [0, 1, 4]) {
    const f = w.M.facts(HISTORY.slice(9, 9 + n).concat(HISTORY.slice(0, 0)));
    check(o, f.enough === false && f.count === n && (f as { needed?: number }).needed === 5, `${n} walls: ${JSON.stringify(f)}`);
    for (const k of ['withinCount', 'typicalIn', 'largestIn', 'longCount', 'withinIn']) check(o, !(k in f), `${n} walls: the result carries ${k}`);
  }
  check(o, w.M.facts(HISTORY.slice(0, 5)).enough === true, 'five walls are not enough');
  const one = factsSentence(w, w.M.facts(HISTORY.slice(0, 1)));
  check(o, one === 'You have taped 1 wall on this phone. That is not enough to tell. It takes 5.', `one wall reads "${one}"`);
  const four = factsSentence(w, w.M.facts(HISTORY.slice(0, 4)));
  check(o, /^You have taped 4 walls on this phone\. That is not enough to tell\./.test(four) && !/inch|within|largest|typical/i.test(four), `four walls reads "${four}"`);
  const none = factsSentence(w, w.M.facts([]));
  check(o, /not taped a wall/.test(none) && !/\binch\b|within|largest/i.test(none), `no walls reads "${none}"`);
  const panel = stripComments(w.F['components/roomScan/TapeFactsPanel.tsx']);
  check(o, /\{copy\.tapeFactsBody\(facts\)\}/.test(panel) && !/facts\.(typicalIn|largestIn|withinCount)/.test(panel), 'the panel reads a difference itself instead of through the sentence that checks the count');
  return o;
});

rule('L3 no percentage, score or grade anywhere in the facts', (w) => {
  const o: string[] = [];
  const allowed = new Set(['enough', 'count', 'needed', 'farCount', 'withinCount', 'withinIn', 'typicalIn', 'largestIn', 'longCount']);
  for (const pairs of [HISTORY, HISTORY.slice(0, 3), []]) {
    const f = w.M.facts(pairs);
    for (const [k, v] of Object.entries(f)) {
      check(o, allowed.has(k), `the facts carry "${k}"`);
      check(o, !/pct|percent|score|accura|rate|ratio|grade|confiden|share/i.test(k), `the facts carry a score-like field "${k}"`);
      check(o, typeof v === 'boolean' || (typeof v === 'number' && (Number.isInteger(v) || /In$/.test(k))), `${k} = ${String(v)} is not a count or inches`);
    }
  }
  const s = w.M.suggest(HISTORY);
  for (const k of Object.keys(s ?? {})) check(o, ['addIn', 'longCount', 'shortCount', 'typicalIn', 'pooled'].includes(k), `the suggestion carries "${k}"`);
  for (const [k, v] of Object.entries(w.EN)) {
    if (!/^office\.roomScan\.order\.(tape|suggest)\./.test(k)) continue;
    const text = typeof v === 'string' ? v : Object.values(v as Record<string, string>).join(' ');
    check(o, !/percent|%|score|accura|\bexact|precis|confiden|reliab|grade/i.test(text), `${k}: "${text}" scores the scan`);
  }
  check(o, /say nothing about a wall you did not check/.test(String(w.EN['office.roomScan.order.tape.scopeNote'])), 'the panel no longer says the numbers are only about the walls he taped');
  const panel = stripComments(w.F['components/roomScan/TapeFactsPanel.tsx']);
  check(o, /<Text style=\{styles\.note\}>\{copy\.tapeScopeNote\}<\/Text>/.test(panel), 'the panel does not show that sentence');
  return o;
});

rule('L4 a wall taped at more than double or less than half is counted, said, and left out', (w) => {
  const o: string[] = [];
  const wild = [pair(20, 8, 120), pair(21, 10, -70)];
  const f = w.M.facts([...HISTORY, ...wild]);
  check(o, f.enough && f.count === 14 && f.farCount === 2 && f.largestIn === 2.5, `with two wild walls: ${JSON.stringify(f)}`);
  const few = w.M.facts([...HISTORY.slice(0, 4), ...wild]);
  check(o, few.enough === false && few.count === 4 && few.farCount === 2, 'a wild wall counted toward the minimum');
  check(o, JSON.stringify(w.M.suggest([...HISTORY, pair(22, 14, 200)])) === JSON.stringify(w.M.suggest(HISTORY)), 'a wild wall moved the suggestion');
  const panel = stripComments(w.F['components/roomScan/TapeFactsPanel.tsx']);
  check(o, /\{facts\.farCount > 0 && <Text[^>]*>\{copy\.tapeFarNote\(facts\.farCount\)\}<\/Text>\}/.test(panel), 'the panel does not say how many walls were left out');
  return o;
});

rule('L5 a suggestion needs enough long walls that agree, and never suggests ordering less', (w) => {
  const o: string[] = [];
  const s = w.M.suggest(HISTORY);
  // Long walls: 3/4, 1, 1 1/2, 2, 2 1/2. All five taped longer; the middle is 1 1/2.
  check(o, !!s && s.addIn === 1.5 && s.longCount === 5 && s.shortCount === 5 && s.typicalIn === 1.5, `the suggestion is ${JSON.stringify(s)}`);
  check(o, LEARN.MIN_LONG_PAIRS === 4 && LEARN.MAX_SUGGEST_IN === 3 && LEARN.LEAN_MIN_IN === 0.5, 'a suggestion rule changed without its test');
  check(o, w.M.suggest(HISTORY.slice(0, 9)) === null, 'a suggestion was made from walls under 12 ft');
  check(o, w.M.suggest(HISTORY.slice(9, 12)) === null, 'a suggestion was made from three long walls');
  // Two of five long walls short, three long: they do not agree.
  const mixed = [pair(30, 13, 1), pair(31, 14, 1.5), pair(32, 15, -1), pair(33, 16, -0.5), pair(34, 17, 0)];
  check(o, w.M.suggest(mixed) === null, 'a suggestion was made from long walls that do not agree');
  // Scans that run LONG: the tape reads shorter. Nothing is suggested.
  check(o, w.M.suggest(HISTORY.map((p) => ({ ...p, tapedM: p.scannedM - (p.tapedM - p.scannedM) }))) === null, 'a suggestion was made to order less');
  // The most it ever adds.
  const big = [0, 1, 2, 3].map((i) => pair(40 + i, 14 + i, 5 + i));
  check(o, w.M.suggest(big)?.addIn === 3, `a 6 in shortfall suggests ${w.M.suggest(big)?.addIn} in`);
  // A quarter of an inch is not "running short".
  check(o, w.M.suggest([0, 1, 2, 3].map((i) => pair(50 + i, 14 + i, 0.25))) === null, 'a quarter of an inch made a suggestion');
  const body = String(w.EN['office.roomScan.order.suggest.body']);
  check(o, /the tape read longer than the scan/.test(body) && /\{short\} of the \{long\} long walls/.test(body) && /It does not change the floor, the ceiling, any tile or the scan\./.test(body), 'the suggestion does not say why, or that the scan is left alone');
  // WHAT IT CHANGES AND WHAT IT DOES NOT, and which walls: not one he taped, and not one adjusted to match a taped wall.
  check(o, /that you have not taped and that was not adjusted to match a taped wall/.test(body) && /it changes the wall board, the wall paint, the baseboard and the crown/.test(body), 'the suggestion does not say which walls it adds to, or what the added length changes');
  // THE PHONE MODEL. The fixture history is all one model. From that model: read alone. From another: pooled, and said.
  const own = w.M.suggest(HISTORY, 'iPhone16,1');
  check(o, !!own && own.pooled === false && own.addIn === 1.5 && own.longCount === 5, `read from the scan's own phone model: ${JSON.stringify(own)}`);
  const otherPhone = w.M.suggest(HISTORY, 'iPhone15,2');
  check(o, !!otherPhone && otherPhone.pooled === true && otherPhone.longCount === 5, `read for a phone with no taped walls of its own: ${JSON.stringify(otherPhone)}`);
  check(o, w.M.suggest(HISTORY)?.pooled === true && w.M.suggest(HISTORY, '')?.pooled === true, 'a scan that names no phone model is not said to be pooled');
  // Five long walls on phone A that taped longer, four on phone B that taped SHORTER.
  const phoneA = [0.75, 1, 1.5, 2, 2.5].map((d, i) => pair(60 + i, 13 + i, d, { deviceModel: 'A' }));
  const phoneB = [-1, -1, -1.5, -0.75].map((d, i) => pair(70 + i, 13 + i, d, { deviceModel: 'B' }));
  const sA = w.M.suggest([...phoneA, ...phoneB], 'A');
  check(o, !!sA && sA.pooled === false && sA.longCount === 5 && sA.shortCount === 5 && sA.addIn === 1.5, `phone A, with enough walls of its own, was read as ${JSON.stringify(sA)} (phone B's walls must not be mixed in)`);
  check(o, w.M.suggest([...phoneA, ...phoneB], 'B') === null, 'phone B, whose own walls taped shorter, was given phone A\'s suggestion');
  check(o, w.M.suggest([...phoneA, ...phoneB], 'C') === null, 'nine pooled walls that do not agree made a suggestion');
  // Three on each phone, all longer: neither has enough alone, so they are pooled and that is said.
  const few = [...phoneA.slice(0, 3), ...[1, 1.5, 2].map((d, i) => pair(80 + i, 14 + i, d, { deviceModel: 'B' }))];
  const pooled = w.M.suggest(few, 'A');
  check(o, !!pooled && pooled.pooled === true && pooled.longCount === 6, `three walls on each of two phones: ${JSON.stringify(pooled)}`);
  const hook = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  check(o, /\$\{s\.pooled\s*\? t\('office\.roomScan\.order\.suggest\.pooledNote'/.test(hook) && /walls scanned with other phones are counted with them/.test(String(w.EN['office.roomScan.order.suggest.pooledNote'])) && /same phone model as this scan/.test(String(w.EN['office.roomScan.order.suggest.sameModelNote'])), 'the card does not say whether the walls are from this phone model or pooled');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, /longWallSuggestion\(tapePairs, scan\?\.device\?\.model \?\? ''\)/.test(flow), 'the flow does not hand the scan\'s phone model to the suggestion');
  return o;
});

rule('L6 a suggestion never changes a quantity by itself', (w) => {
  const o: string[] = [];
  const scan = scanOf('hallway');
  const before = JSON.stringify(scan);
  const plain = w.M.list(scan, opts(scan));
  // The history is not an input: with a strong suggestion standing, the list is what it was.
  check(o, !!w.M.suggest(HISTORY), 'the fixture history makes no suggestion');
  check(o, w.M.list.length === 2, `buildOrderList takes ${w.M.list.length} arguments: a scan and his choices, nothing else`);
  check(o, JSON.stringify(w.M.list(scan, opts(scan))) === JSON.stringify(plain), 'the list is not the same twice');
  check(o, plain.walls.every((x) => x.addedIn === 0), 'a wall was lengthened with no suggestion accepted');
  // Accepted: 1 1/2 in on each 22 ft wall he has not taped, and on nothing else.
  const added = w.M.list(scan, opts(scan, { longWallAddIn: 1.5 }));
  const long = added.walls.filter((x) => x.addedIn > 0);
  check(o, long.length === 2 && long.every((x) => x.lengthIn === 265.5 && x.addedIn === 1.5), `accepting 1.5 in changed ${long.length} walls: ${JSON.stringify(long)}`);
  check(o, added.walls.filter((x) => x.lengthIn < 144).every((x) => x.addedIn === 0), 'a wall under 12 ft was lengthened');
  check(o, JSON.stringify(scan) === before, 'accepting a suggestion changed the scan');
  // A wall he taped is already his number: nothing is added to it.
  const longWall = scan.walls.find((x) => x.lengthM > 6) as RoomScan['walls'][number];
  const taped = correctWallLength(scan, longWall.id, 265 * IN, AT);
  const afterTape = w.M.list(taped, opts(taped, { longWallAddIn: 1.5 }));
  check(o, afterTape.walls.find((x) => x.wallId === longWall.id)?.addedIn === 0 && afterTape.walls.find((x) => x.wallId === longWall.id)?.taped === true, 'inches were added to a wall he taped');
  check(o, (added.trimPlans.crown?.cutFt ?? 0) > (plain.trimPlans.crown?.cutFt ?? 0), 'an accepted allowance did not reach the trim');
  // "Not taped" does not mean "the scan's own": taping one 22 ft wall moved the one across from it to match
  // ('adjusted'). That wall is not a scan reading either, and gets nothing.
  const across = taped.walls.find((x) => x.lengthSource === 'adjusted');
  const acrossUsed = afterTape.walls.find((x) => x.wallId === across?.id);
  check(o, !!across && across.lengthM > 6 && acrossUsed?.addedIn === 0 && acrossUsed?.source === 'adjusted' && afterTape.walls.every((x) => x.addedIn === 0), `inches were added to a wall the app adjusted to match a taped one: ${JSON.stringify(acrossUsed)}`);
  // WHAT THE ADDED LENGTH CHANGES: the wall board, the wall paint, the baseboard and the crown. And what it does
  // not: the floor, the ceiling, and any tile (the 22 ft wall as a wet wall measures what the scan said).
  const tileOn = { groups: { ...opts(scan).groups, wallTile: true }, wetWallIds: [longWall.id] };
  const t0 = w.M.list(scan, opts(scan, tileOn));
  const t1 = w.M.list(scan, opts(scan, { ...tileOn, longWallAddIn: 1.5 }));
  const netOf = (l: ORDER.OrderList, key: string) => l.lines.find((x) => x.key === key)?.net?.quantity ?? -1;
  for (const k of ['floor', 'wall_tile', 'drywall_ceiling', 'paint_ceiling']) check(o, netOf(t1, k) === netOf(t0, k) && qty(t1, k) === qty(t0, k), `an accepted allowance changed ${k}: ${netOf(t0, k)} to ${netOf(t1, k)}`);
  for (const k of ['drywall_walls', 'paint_walls', 'baseboard', 'crown']) check(o, netOf(t1, k) > netOf(t0, k), `an accepted allowance did not reach ${k}`);
  const note = forms(w.EN['office.roomScan.order.addedNote']).join(' ');
  check(o, /It changes the wall board, the wall paint, the baseboard and the crown\. It does not change the floor, the ceiling or any tile\./.test(note) && /not adjusted to match a taped wall/.test(note), 'the note on the list does not say what the added length changes and what it does not');
  // The wiring: the core does not read the history, and only the accept button sets the allowance.
  const core = stripComments(w.F['utils/roomScan/orderListCore.ts']);
  check(o, !/learnCore|longWallSuggestion|tapeFacts|TapePair/.test(core), 'orderListCore reads the tape history');
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  const sets = [...view.matchAll(/longWallAddIn: /g)].length;
  check(o, sets === 2 && /onAccept=\{\(addIn\) => p\.onOptions\(\{ longWallAddIn: addIn \}\)\}/.test(view) && /onRemove=\{\(\) => p\.onOptions\(\{ longWallAddIn: 0 \}\)\}/.test(view), `OrderListView sets the allowance in ${sets} places (the accept and the take-it-off buttons only)`);
  const panel = stripComments(w.F['components/roomScan/TapeFactsPanel.tsx']);
  check(o, [...panel.matchAll(/p\.onAccept\(/g)].length === 1 && /onPress=\{\(\) => p\.onAccept\(\(p\.suggestion as LongWallSuggestion\)\.addIn\)\}/.test(panel), 'the panel accepts a suggestion somewhere other than its accept button');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, !/longWallAddIn/.test(flow) && /suggestion=\{suggestion\}/.test(flow), 'the flow sets the allowance itself');
  check(o, w.M.parseOptions({ longWallAddIn: 1.5 }, 'room').longWallAddIn === 1.5 && w.M.parseOptions({ longWallAddIn: 40 }, 'room').longWallAddIn === 0 && ORDER.defaultOrderOptions('room').longWallAddIn === 0, 'the allowance is on by default, or an absurd one is read back');
  return o;
});

rule('L7 pairs: from a scan reading only, one per wall, kept and removed', (w) => {
  const o: string[] = [];
  const scan = scanOf('bathroom');
  const wall = scan.walls[0];
  const p = w.M.pair(scan, wall.id, wall.lengthM + IN, AT);
  check(o, !!p && p.scannedM === wall.lengthM && near(p.tapedM, wall.lengthM + IN, 1e-9) && p.deviceModel === 'iPhone16,1' && p.roomType === 'bathroom' && p.scanId === scan.id && p.lengthClass === 'short', `the pair is ${JSON.stringify(p)}`);
  check(o, LEARN.lengthClass(12 / 3.28084) === 'long' && LEARN.lengthClass(11.9 / 3.28084) === 'mid' && LEARN.lengthClass(5.9 / 3.28084) === 'short', 'the wall length classes moved');
  // After the edit the opposite wall is 'adjusted': the app moved it, so it is not a scan reading.
  const edited = correctWallLength(scan, wall.id, wall.lengthM + IN, AT);
  const moved = edited.walls.find((x) => x.lengthSource === 'adjusted');
  check(o, !!moved && w.M.pair(edited, moved.id, moved.lengthM, AT) === null, 'a wall the app moved made a pair');
  // Typing the same wall again keeps the scan's first number.
  const again = w.M.pair(edited, wall.id, wall.lengthM + 2 * IN, AT, p ? [p] : []);
  check(o, !!again && again.scannedM === wall.lengthM && near(again.tapedM, wall.lengthM + 2 * IN, 1e-9), 'a second typed length lost the scan\'s first number');
  check(o, w.M.pair(edited, wall.id, wall.lengthM, AT) === null, 'a typed wall with no first pair made one from the typed number');
  check(o, w.M.pair(scan, 'nope', 2, AT) === null && w.M.pair(scan, wall.id, 0, AT) === null && w.M.pair(scan, wall.id, Number.NaN, AT) === null, 'a pair was made from nothing');
  const log = w.M.upsert(HISTORY, again ? [again] : []);
  check(o, log.length === 15 && w.M.upsert(log, again ? [{ ...again, tapedM: 2 }] : []).length === 15, 'a wall has two pairs');
  check(o, LEARN.removeScanPairs(log, scan.id).length === 14, 'deleting a scan left its pairs');
  check(o, w.M.upsert(Array.from({ length: 600 }, (_x, i) => pair(i, 8, 0.5, { scanId: `s${i}` })), []).length === LEARN.MAX_TAPE_PAIRS, 'the list is not capped');
  check(o, LEARN.parseTapePairs('not json').length === 0 && LEARN.parseTapePairs(JSON.stringify({ version: 1, pairs: [...HISTORY, { scanId: 1 }, null, { scanId: 'a', wallId: 'b', scannedM: -1, tapedM: 2 }] })).length === 14, 'a broken row was read as a pair');
  // The flow: the pair is made from the scan BEFORE the edit, and written to his list only with a save.
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  const at = flow.indexOf('tapePairFromEdit(cur.scan, e.id, metres, at, cur.tapePairs ?? [])');
  check(o, at > 0 && at < flow.indexOf('change((s) => correctWallLength(s, e.id, metres, at));'), 'the pair is not made before the wall is corrected');
  const writes = [...flow.matchAll(/recordTapePairs\(/g)].length;
  const keeps = [...flow.matchAll(/await keepTape\(next\);/g)].length;
  check(o, writes === 1 && /const keepTape = useCallback\(async \(s: SavedScan\) => \{\s*const log = await recordTapePairs\(userId, s\.tapePairs \?\? \[\]\);/.test(flow), `the flow writes his tape list in ${writes} places (keepTape only)`);
  check(o, keeps === 3 && [...flow.matchAll(/saveScan\(next, rawJson, dropTape\)/g)].length === 3 && [...flow.matchAll(/keepTape\(/g)].length === 3 && /if \(ok\) await keepTape\(next\);/.test(flow) && [...flow.matchAll(/if \(stored\) await keepTape\(next\);/g)].length === 2, `his tape list is kept in ${keeps} places (once after each of the three saves, and only when the save took)`);
  check(o, /if \(ok\) \{\s*await forgetScanTapePairs\(userId, target\.scan\.id\);/.test(flow), 'deleting a scan does not remove its pairs');
  // A scan the saved-list cap pushes off the phone takes its pairs with it, in the same save.
  const three = [pair(90, 8, 0.5, { scanId: 'old-1' }), pair(91, 8, 0.5, { scanId: 'old-2' }), pair(92, 8, 0.5, { scanId: 'kept' })];
  check(o, LEARN.removeScansPairs(three, ['old-1', 'old-2']).map((x) => x.scanId).join() === 'kept' && LEARN.removeScansPairs(three, []).length === 3, 'the pairs of scans pushed off the saved list are not removed');
  const store = stripComments(w.F['utils/roomScan/store.ts']);
  check(o, /if \(dropped\.length && onDropped\) \{\s*try \{ await onDropped\(dropped\); \}/.test(store) && /const \{ list, dropped \} = upsertSavedScan\(before, saved\);/.test(store), 'the scan store does not hand over the scans the cap pushed off');
  check(o, /const dropTape = useCallback\(async \(scanIds: string\[\]\) => \{\s*const log = await forgetScansTapePairs\(userId, scanIds\);\s*if \(log\) setTapeLog\(log\);/.test(flow), 'the flow does not remove the taped walls of a scan the cap pushed off');
  const tapeStore = stripComments(w.F['utils/roomScan/learnStore.ts']);
  check(o, /const next = removeScansPairs\(await loadTapePairs\(userId\), scanIds\);/.test(tapeStore), 'the tape store does not remove several scans\' pairs');
  return o;
});

// A FIXTURE FOR "BOUGHT VERSUS SCANNED". Tile, square feet. The order list said
// the rooms measured 100, 80, 120 and 50 sq ft; he bought 108, 88, 130 and 55.
//   over: 8, 10, 8.3, 10 percent. In order 8, 8.3, 10, 10: the middle is 9.2.  9 percent.
const BOUGHT: LEARN.BoughtRecord[] = [
  { jobId: 'j1', closedAt: '2026-03-01', trade: 'Tile', unit: 'SF', listed: 100, bought: 108 },
  { jobId: 'j2', closedAt: '2026-04-01', trade: 'tile', unit: 'sf', listed: 80, bought: 88 },
  { jobId: 'j3', closedAt: '2026-05-01', trade: 'Tile', unit: 'SF', listed: 120, bought: 130 },
  { jobId: 'j4', closedAt: '2026-06-01', trade: 'Tile ', unit: 'SF', listed: 50, bought: 55 },
];

rule('L8 bought versus scanned: the pure core on fixtures, and not wired to any data', (w) => {
  const o: string[] = [];
  const f = w.M.waste(BOUGHT);
  check(o, f.length === 1 && f[0].trade === 'tile' && f[0].jobCount === 4 && f[0].pct === 9 && f[0].setAside === 0, `tile on four jobs: ${JSON.stringify(f)}`);
  const offer = w.M.wasteOffer(f[0], 10);
  check(o, !!offer && offer.pct === 9 && offer.jobCount === 4, `the offer is ${JSON.stringify(offer)}`);
  const body = String(w.EN['office.roomScan.order.wasteOffer.body']).replace('{jobs}', '4').replace('{pct}', '9').replace('{trade}', 'tile');
  check(o, body === 'On your last 4 jobs you bought about 9 percent more tile than the scan said.' && w.EN['office.roomScan.order.wasteOffer.acceptLabel'] === 'Use {pct} Percent', `the offer reads "${body}"`);
  // Fewer than three jobs: nothing is said.
  check(o, LEARN.MIN_WASTE_JOBS === 3 && w.M.waste(BOUGHT.slice(0, 2)).length === 0, 'a waste figure was stated from two jobs');
  check(o, w.M.wasteOffer(undefined, 10) === null && w.M.wasteOffer({ ...f[0], jobCount: 2 }, 10) === null, 'an offer was made from too few jobs');
  // The same as the allowance in use: nothing to offer.
  check(o, w.M.wasteOffer(f[0], 9) === null, 'the allowance already in use was offered');
  // He bought no more than the list: no offer to lower it.
  const lean = w.M.waste(BOUGHT.map((r) => ({ ...r, bought: r.listed * 0.97 })));
  check(o, lean[0]?.pct === -3 && w.M.wasteOffer(lean[0], 10) === null, 'an offer was made to order less than the room measures');
  // Two receipts on one job add up; a job that was plainly another scope is set aside and counted.
  const split = w.M.waste([...BOUGHT.slice(1), { ...BOUGHT[0], listed: 100, bought: 60 }, { jobId: 'j1', closedAt: '2026-03-02', trade: 'Tile', unit: 'SF', listed: 0.0001, bought: 48 }]);
  check(o, split[0]?.jobCount === 4 && near(split[0]?.pct, 9, 1), `two receipts on one job: ${JSON.stringify(split)}`);
  const odd = w.M.waste([...BOUGHT, { jobId: 'j5', closedAt: '2026-07-01', trade: 'Tile', unit: 'SF', listed: 100, bought: 240 }, { jobId: 'j6', closedAt: '2026-07-02', trade: 'Tile', unit: 'SF', listed: 100, bought: 40 }]);
  check(o, odd[0]?.jobCount === 4 && odd[0]?.setAside === 2 && odd[0]?.pct === 9, `out-of-scope jobs: ${JSON.stringify(odd)}`);
  // Units are never mixed: boxes bought cannot be compared with square feet listed.
  const units = w.M.waste([...BOUGHT, { jobId: 'j7', closedAt: '2026-07-03', trade: 'Tile', unit: 'box', listed: 100, bought: 109 }]);
  check(o, units.length === 1 && units[0].jobCount === 4, 'a job in another unit was mixed in');
  // Only the newest six jobs are read.
  const many = Array.from({ length: 9 }, (_x, i) => ({ jobId: `m${i}`, closedAt: `2026-0${i + 1}-01`, trade: 'Paint', unit: 'gal', listed: 10, bought: i < 3 ? 15 : 11 }));
  check(o, w.M.waste(many)[0]?.jobCount === 6 && w.M.waste(many)[0]?.pct === 10, `nine jobs: ${JSON.stringify(w.M.waste(many))}`);
  // NOT WIRED. No file of the feature feeds it, and the flow hands the panel no offers.
  for (const f2 of [...NEW_FILES, 'components/roomScan/RoomScanFlow.tsx']) {
    if (f2 === 'utils/roomScan/learnCore.ts') continue;
    const s = stripComments(w.F[f2]);
    check(o, !/wasteFactors|wasteSuggestion|BoughtRecord|useMaterialReceipts|material_receipts|qbo_cost_lines|DeliveryReceipt|mageid_material_receipts/.test(s), `${f2} feeds the bought-versus-scanned core from app data`);
  }
  check(o, !/wasteOffers=/.test(stripComments(w.F['components/roomScan/RoomScanFlow.tsx'])) && !/wasteOffers=/.test(stripComments(w.F['components/roomScan/OrderListView.tsx'])), 'a screen hands the panel waste offers (there is no data to make one from)');
  check(o, /IT IS NOT WIRED TO ANY DATA IN THIS LANE/.test(w.F['utils/roomScan/learnCore.ts']), 'learnCore.ts no longer says the waste core is not wired');
  return o;
});

// ── C. the wiring ───────────────────────────────────────────────────────────

rule('S1 storage keys are owned and carry the user\'s id', (w) => {
  const o: string[] = [];
  const store = stripComments(w.F['utils/roomScan/learnStore.ts']);
  const prefix = store.match(/ROOM_SCAN_TAPE_KEY_PREFIX = '([^']+)'/)?.[1] ?? '';
  check(o, prefix === 'mageid_room_scan_tape::' && isAppStorageKey(`${prefix}user-1`), `the tape list key prefix is "${prefix}" (it must be under an owned prefix, or it survives a tenant switch)`);
  check(o, /export const tapeLogKey = \(userId: string\): string => `\$\{ROOM_SCAN_TAPE_KEY_PREFIX\}\$\{userId\}`;/.test(store), 'the key does not carry the user\'s id');
  const writes = store.match(/AsyncStorage\.(setItem|removeItem|getItem)\(([^,)]+)/g) ?? [];
  check(o, writes.length === 3 && writes.every((c) => /\(tapeLogKey\(userId$/.test(c)), `the store touches a key it did not build from the user's id: ${writes.join(' ; ')}`);
  check(o, (store.match(/if \(!userId\) return/g) ?? []).length === 3, 'a read or write runs with nobody signed in');
  for (const f of NEW_FILES) {
    if (f === 'utils/roomScan/learnStore.ts') continue;
    check(o, !/AsyncStorage|SecureStore|localStorage|FileSystem/.test(stripComments(w.F[f])), `${f} stores something itself`);
  }
  // The order list's choices and sends ride on the saved scan, under the scan's own owned key.
  const core = stripComments(w.F['utils/roomScan/storeCore.ts']);
  check(o, /order\?: OrderOptions;/.test(core) && /orderSent\?: OrderSnapshot\[\];/.test(core) && /tapePairs\?: TapePair\[\];/.test(core) && (core.match(/['"`]([a-z_]+::)['"`]/g) ?? []).length === 2, 'the order list added a storage key of its own to the scan store');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, /const \{ user \} = useAuth\(\);\s*const userId = user\?\.id \?\? null;/.test(flow) && /loadTapePairs\(userId\)/.test(flow), 'the flow does not read his tape list by his own id');
  return o;
});

rule('S2 nothing in the lane talks to a server or a model', (w) => {
  const o: string[] = [];
  for (const f of NEW_FILES) {
    const s = stripComments(w.F[f]);
    check(o, !/supabase|fetch\(|XMLHttpRequest|offlineQueue|supabaseWrite|functions\.invoke|aiService|mageAI|generateText|anthropic|gemini|openai|posthog|analytics|Sentry/i.test(s), `${f} can reach a server or a model`);
  }
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, !/supabase|fetch\(|offlineQueue|supabaseWrite|functions\.invoke|aiService/i.test(flow), 'the flow reaches a server');
  return o;
});

rule('N1 with the flag off there is no entry point, and nothing outside the feature imports the lane', (w) => {
  const o: string[] = [];
  check(o, w.M.flag === false && /^export const SCAN_ROOM_ENABLED = false;$/m.test(w.F['constants/featureFlags.ts']), 'SCAN_ROOM_ENABLED is not false');
  check(o, /export default function ScanRoomRoute\(\) \{\s*if \(!SCAN_ROOM_ENABLED\) return <Redirect href="[^"]+" \/>;/.test(stripComments(w.F['app/scan-room.tsx'])), 'the route does not redirect before it mounts anything');
  const names = /OrderListView|CutLayoutView|TapeFactsPanel|useScanOrderCopy|orderListCore|cutPlanCore|trimPackCore|learnCore|learnStore|orderPricingCore/;
  for (const [f, text] of Object.entries(w.outside)) {
    if (f === 'i18n/surfaces.ts') continue;
    if (names.test(stripComments(text))) o.push(`${f} imports the order list`);
  }
  // One way in: the Quantities step, inside the flow the route mounts.
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, [...flow.matchAll(/setStep\('order'\)/g)].length === 1 && /order=\{\{ label: ocopy\.openLabel, onPress: \(\) => \{ setOrderSend\('idle'\); setStep\('order'\); \} \}\}/.test(flow), 'the order list can be reached from somewhere other than The Quantities');
  check(o, [...flow.matchAll(/<OrderListView/g)].length === 1 && /\{step === 'order' && saved && orderList && orderDraft && orderSendDraft && orderOptions && \(\s*<OrderListView/.test(flow), 'the order list is mounted outside its step');
  const q = stripComments(w.F['components/roomScan/QuantitiesView.tsx']);
  check(o, /\{order && <Button label=\{order\.label\} variant="secondary" onPress=\{order\.onPress\} disabled=\{block != null\} testID="scan-order-open" \/>\}/.test(q), 'the order list opens for a room that cannot be priced (an open outline, no ceiling height, an unsure wall, no name)');
  // validate-scan-room's own house rules read the new files too.
  const room = w.F['scripts/validate-scan-room.ts'];
  for (const f of NEW_FILES) check(o, room.includes(`'${f}'`), `scripts/validate-scan-room.ts does not list ${f} as a feature file`);
  check(o, /"test:scan-order": "bun run scripts\/validate-scan-order\.ts"/.test(w.F['package.json']) && /bun run test:scan-room && bun run test:code-flags.*bun run test:scan-order|bun run test:scan-order/.test(w.F['package.json'].split('\n').find((x) => x.includes('"ship-check"')) ?? ''), 'test:scan-order is not registered in package.json and in ship-check');
  return o;
});


rule('W1 the words: the plain notice, no "exact", no "accurate", English and Spanish', (w) => {
  const o: string[] = [];
  const keys = Object.keys(w.EN).filter((k) => k.startsWith('office.roomScan.order.'));
  check(o, keys.length >= 150, `the order list has ${keys.length} English keys`);
  check(o, w.EN['office.roomScan.order.noticeBody'] === 'A phone scan can be off by an inch or more. Check before you order.', `the notice reads "${String(w.EN['office.roomScan.order.noticeBody'])}"`);
  for (const k of keys) {
    for (const f of forms(w.EN[k])) {
      check(o, !/\bexact|accura|precis|guarantee|perfect|\d\s*%/i.test(f), `en ${k}: "${f}" promises how right a number is`);
      check(o, !/[—–]|&|\be\.g\.|->|=>|!/.test(f), `en ${k}: "${f}" breaks the house style`);
    }
    const es = w.ES[k];
    check(o, !!es && forms(es.s).every((x) => x.trim().length > 0), `no Spanish for ${k}`);
    for (const f of forms(es?.s)) check(o, !/exact[oa]|precis[oa]|garantiz|perfect[oa]/i.test(f), `es ${k}: promises how right a number is`);
  }
  check(o, /off by an inch or more/.test(forms(w.EN['office.roomScan.order.send.shareBody']).join(' ')), 'the share confirm does not repeat that a scan can be off');
  check(o, /material only/.test(String(w.EN['office.roomScan.order.send.doubleCountBody'])) && /in the estimate twice/.test(String(w.EN['office.roomScan.order.send.doubleCountBody'])) && /Nothing is sent to your client/.test(forms(w.EN['office.roomScan.order.send.estimateBody']).join(' ')) && /Nothing is sent to your client/.test(forms(w.EN['office.roomScan.order.send.estimateStartBody']).join(' ')), 'the estimate confirm does not say the lines are material only, could double up, and go to nobody');
  const view = stripComments(w.F['components/roomScan/OrderListView.tsx']);
  const notice = view.indexOf('{ocopy.noticeBody}');
  check(o, notice > 0 && notice < view.indexOf('{ocopy.introBody(p.roomName)}') && /testID="scan-order-notice"/.test(view), 'the notice is not the first thing on the screen');
  const hook = stripComments(w.F['hooks/useScanOrderCopy.ts']);
  check(o, /notice: noticeBody,/.test(hook), 'the copied text does not carry the notice');
  for (const f of ['components/roomScan/OrderListView.tsx', 'components/roomScan/CutLayoutView.tsx', 'components/roomScan/TapeFactsPanel.tsx']) {
    const s = stripComments(w.F[f]);
    check(o, !/\bt\(\s*['"]|\btn\(\s*['"]/.test(s), `${f} has its own t() key`);
    check(o, !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(s), `${f} writes a colour`);
    check(o, !/react-native-reanimated|@expo\/vector-icons/.test(s), `${f} uses reanimated or another icon set`);
  }
  return o;
});

rule('D1 the checklist says what a cloud phase needs and what data is missing', (w) => {
  const o: string[] = [];
  const doc = w.F['docs/scan-the-room-native-checklist.md'];
  for (const [what, re] of [
    ['the order list section', /## The Order List And The Learning Loop/],
    ['where the tape list is kept', /mageid_room_scan_tape::/],
    ['a proposed table for tape pairs', /create table public\.room_scan_tape_pairs/],
    ['what is missing for bought versus scanned', /bought versus scanned/i],
    ['the receipt type that comes closest', /MaterialReceipt/],
    ['that QuickBooks lines carry no quantity', /qbo_cost_lines/],
    ['that nothing is uploaded in this lane', /nothing (is )?uploaded/i],
    ['that the rules of thumb need a real job to check', /rule[s]? of thumb/i],
    ['that no real scan has been through it', /no real scan/i],
  ] as [string, RegExp][]) check(o, re.test(doc), `the checklist is missing ${what}`);
  return o;
});

// ── run ─────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
console.log('validate-scan-order');
for (const [id, fn] of Object.entries(RULES)) {
  let problems: string[];
  try { problems = fn(REAL); } catch (e) { problems = [`threw ${e instanceof Error ? e.stack ?? e.message : String(e)}`]; }
  if (problems.length === 0) { pass += 1; console.log(`  ✓ ${id}`); }
  else { fail += 1; console.log(`  ✗ ${id}`); for (const p of problems.slice(0, 12)) console.log(`      ${p}`); if (problems.length > 12) console.log(`      ... and ${problems.length - 12} more`); }
}

// ── planted mutations ───────────────────────────────────────────────────────
interface Mutation { rule: string; what: string; plant: (w: World) => World }
const mod = (patch: (m: Mods) => Partial<Mods>) => (w: World): World => ({ ...w, M: { ...w.M, ...patch(w.M) } });
const text = (file: string, from: string | RegExp, to: string) => (w: World): World => {
  const before = w.F[file];
  const after = typeof from === 'string' ? before.split(from).join(to) : before.replace(from, to);
  if (after === before) throw new Error(`nothing to replace in ${file}`);
  return { ...w, F: { ...w.F, [file]: after } };
};
const en = (key: string, value: unknown) => (w: World): World => {
  if (!(key in w.EN)) throw new Error(`no key ${key}`);
  return { ...w, EN: { ...w.EN, [key]: value } };
};
const es = (key: string, value: { s: unknown; src: string } | undefined) => (w: World): World => ({ ...w, ES: { ...w.ES, [key]: value } });
/** A copy of the list with its lines changed. */
const lines = (fn: (l: ORDER.OrderLine, list: ORDER.OrderList) => ORDER.OrderLine | null) => mod((m) => ({
  list: (scan, o) => { const l = m.list(scan, o); return { ...l, lines: l.lines.map((x) => fn(x, l)).filter((x): x is ORDER.OrderLine => !!x) }; },
}));
const wallPlan = (fn: (p: CUT.CutPlan) => CUT.CutPlan) => mod((m) => ({
  list: (scan, o) => { const l = m.list(scan, o); return l.wallPlan ? { ...l, wallPlan: fn(l.wallPlan) } : l; },
}));
const V = 'components/roomScan/OrderListView.tsx';
const FL = 'components/roomScan/RoomScanFlow.tsx';

const MUTATIONS: Mutation[] = [
  { rule: 'O1', what: 'the bathroom walls take one sheet fewer', plant: lines((l) => (l.key === 'drywall_walls' ? { ...l, computed: l.computed - 1, quantity: l.quantity - 1 } : l)) },
  { rule: 'O1', what: 'paint is rounded down', plant: lines((l) => (l.key === 'paint_walls' ? { ...l, quantity: Math.floor((l.basis as { workedGal: number }).workedGal) } : l)) },
  { rule: 'O1', what: 'a line is dropped from the bathroom', plant: lines((l) => (l.key === 'primer' ? null : l)) },
  { rule: 'O2', what: 'a wall sheet count drifts on one fixture', plant: wallPlan((p) => (p.sheet === '4x10' ? { ...p, sheets: p.sheets + 1, boardSF: (p.sheets + 1) * p.sheetAreaSF } : p)) },
  { rule: 'O2', what: 'the count falls below what the area needs', plant: wallPlan((p) => ({ ...p, sheets: Math.floor(p.hungSF / p.sheetAreaSF) - 1 })) },
  { rule: 'O2', what: 'reusing offcuts takes more sheets than using none', plant: mod((m) => ({ sheets: (s, o) => { const p = m.sheets(s, o); return o.reuse === false ? { ...p, sheets: 1 } : p; } })) },
  { rule: 'O3', what: 'an opening is taken off twice', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => (x.cutouts.length ? { ...x, netAreaIn2: x.netAreaIn2 - CUT.rectUnionArea(x.cutouts) } : x)) })) })) },
  { rule: 'O3', what: 'an opening is not cut out at all', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => ({ ...x, cutouts: [], netAreaIn2: x.w * x.h })) })) })) },
  { rule: 'O3', what: 'board is bought for the doorway', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => (s.openings.length === 3 ? { ...s, pieces: [...s.pieces, { ...s.pieces[0], x: 6, y: 0, w: 32, h: 48, cutouts: [], netAreaIn2: 0 }] } : s)) })) },
  { rule: 'O3', what: 'two pieces overlap on a wall', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s, i) => (i === 0 ? { ...s, pieces: [...s.pieces, { ...s.pieces[0], netAreaIn2: 0, cutouts: [] }] } : s)) })) },
  { rule: 'O4', what: 'a piece is larger than the offcut it came from', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => (x.fromOffcut ? { ...x, src: { ...x.src, a: x.src.a - 30 } } : x)) })) })) },
  { rule: 'O4', what: 'two pieces come from the same part of one sheet', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => ({ ...x, sheet: 1, src: { ...x.src, a: 0, c: 0 } })) })) })) },
  { rule: 'O4', what: 'offcuts are never reused', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); const strip = (p: CUT.CutPlan | null) => (p ? { ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => ({ ...x, fromOffcut: false })) })) } : p); return { ...l, wallPlan: strip(l.wallPlan), ceilingPlan: strip(l.ceilingPlan) }; } })) },
  { rule: 'O5', what: 'the ceiling is the rectangle around the room', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); return l.ceilingPlan ? { ...l, ceilingPlan: { ...l.ceilingPlan, hungSF: (l.ceilingPlan.surfaces[0].widthIn * l.ceilingPlan.surfaces[0].heightIn) / 144 } } : l; } })) },
  { rule: 'O5', what: 'the bay\'s angled pieces lose their mark', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); return l.ceilingPlan ? { ...l, ceilingPlan: { ...l.ceilingPlan, surfaces: l.ceilingPlan.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => ({ ...x, cutToShape: false })) })) } } : l; } })) },
  { rule: 'O6', what: 'screws lose the rule of thumb mark', plant: lines((l) => (l.key === 'screws' ? { ...l, ruleOfThumb: false } : l)) },
  { rule: 'O6', what: 'a measured line is called a rule of thumb', plant: lines((l) => (l.key === 'paint_walls' ? { ...l, ruleOfThumb: true } : l)) },
  { rule: 'O6', what: 'the screen drops the Rule Of Thumb label', plant: text(V, '{l.ruleOfThumb && (', '{false && (') },
  { rule: 'O6', what: 'the compound sentence stops saying it is a rule of thumb', plant: en('office.roomScan.order.basis.compoundNote', 'You need 1 gallon for each 100 sq ft of board, on {board} sq ft.') },
  { rule: 'O6', what: 'the screen stops showing how a line was worked out', plant: text(V, '{ocopy.assumption(l)}', '{ocopy.lineName(l)}') },
  { rule: 'O7', what: 'corner bead counts every corner', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); return { ...l, outsideCorners: scan.floor.length }; } })) },
  { rule: 'O8', what: 'herringbone takes the straight allowance', plant: lines((l) => (l.key === 'floor' && l.basis.kind === 'area' && l.basis.reasons.some((r) => r.kind === 'layout' && r.layout === 'herringbone') ? { ...l, quantity: Math.ceil(l.basis.netSF * 1.1), basis: { ...l.basis, wastePct: 10 } } : l)) },
  { rule: 'O8', what: 'the shape adds nothing', plant: lines((l) => (l.key === 'floor' && l.basis.kind === 'area' ? { ...l, basis: { ...l.basis, reasons: l.basis.reasons.filter((r) => r.kind !== 'shape') } } : l)) },
  { rule: 'O8', what: 'wall tile ignores the window', plant: lines((l) => (l.key === 'wall_tile' && l.basis.kind === 'area' ? { ...l, basis: { ...l.basis, netSF: l.basis.netSF + 5 } } : l)) },
  { rule: 'O8', what: 'the flooring sentence drops the reasons', plant: text('hooks/useScanOrderCopy.ts', "return `${head} ${why}${box}`;", 'return `${head}${box}`;') },
  { rule: 'O9', what: 'primer is folded into the paint', plant: lines((l) => (l.key === 'primer' ? null : l)) },
  { rule: 'O9', what: 'coats are ignored', plant: lines((l) => (l.key === 'paint_walls' && l.basis.kind === 'paint' ? { ...l, quantity: Math.ceil(l.basis.netSF / l.basis.spreadSFPerGal) } : l)) },
  { rule: 'O9', what: 'the paint sentence drops the spread rate', plant: en('office.roomScan.order.basis.paintNote', { one: '{net} sq ft, 1 coat, comes to {worked} gallons.', other: '{net} sq ft, {count} coats, comes to {worked} gallons.' }) },
  { rule: 'O10', what: 'a cut is longer than its stick', plant: mod((m) => ({ pack: (r, s, a) => { const p = m.pack(r, s, a); return { ...p, sticks: p.sticks.map((x, i) => (i === 0 ? { ...x, stockFt: 8, cuts: x.cuts.map((c) => ({ ...c, lengthIn: c.lengthIn + 200 })) } : x)) }; } })) },
  { rule: 'O10', what: 'the packing buys more than one stick per piece', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); const t = { ...l.trimPlans }; for (const k of ORDER.TRIM_KINDS) if (t[k]) t[k] = { ...(t[k] as TRIM.TrimPlan), boughtFt: (t[k] as TRIM.TrimPlan).onePerPiece.boughtFt + 8 }; return { ...l, trimPlans: t }; } })) },
  { rule: 'O10', what: 'a long run gets an extra joint', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); const t = { ...l.trimPlans }; if (t.crown) t.crown = { ...t.crown, joints: t.crown.joints + 1 }; return { ...l, trimPlans: t }; } })) },
  { rule: 'O10', what: 'a random list is packed with a stick over its length', plant: mod((m) => ({ pack: (r, s, a) => { const p = m.pack(r, s, a); return r.length > 9 ? { ...p, sticks: p.sticks.map((x) => ({ ...x, usedIn: x.usedIn + 400 })) } : p; } })) },
  { rule: 'O11', what: 'a typed quantity is overwritten by the worked one', plant: lines((l) => ({ ...l, quantity: l.computed })) },
  { rule: 'O11', what: 'a typed quantity is not marked', plant: lines((l) => ({ ...l, typed: false })) },
  { rule: 'O11', what: 'typed quantities are dropped on save', plant: mod((m) => ({ parseOptions: (raw, rt) => ({ ...m.parseOptions(raw, rt), typed: {} }) })) },
  { rule: 'O11', what: 'the screen stops marking a typed quantity', plant: text(V, '{l.typed && (', '{false && (') },
  { rule: 'O12', what: 'the sheet size is ignored', plant: mod((m) => ({ list: (scan, o) => m.list(scan, { ...o, sheet: '4x8' }) })) },
  { rule: 'O12', what: 'an open outline is given a ceiling', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); return scan.closure.closed ? l : { ...l, gaps: [] }; } })) },
  { rule: 'O12', what: 'the flow works the list out once and keeps it', plant: text(FL, '[scan, orderOptions]);', '[]);') },
  { rule: 'O13', what: 'the core records a send without a yes', plant: mod((m) => ({ send: (a) => m.send({ ...a, confirmed: true }) })) },
  { rule: 'O13', what: 'the estimate patch is built without a yes', plant: mod((m) => ({ patch: (a) => m.patch({ ...a, confirmed: true }) })) },
  { rule: 'O13', what: 'the copy button sends straight away', plant: text(V, "onPress={() => setConfirming('copy')}", "onPress={() => p.onSend('copy', true)}") },
  { rule: 'O13', what: 'the flow copies before it checks the record', plant: text(FL, "    const snap = confirmOrderSend({ confirmed, via, list: orderList, at: new Date().toISOString() });\n", "    await copyToClipboard(orderListText(orderList, saved.scan.name, ocopy.text));\n    const snap = confirmOrderSend({ confirmed, via, list: orderList, at: new Date().toISOString() });\n") },
  { rule: 'O13', what: 'the flow ignores a refused record', plant: text(FL, /if \(!snap\) \{ setOrderSend\([^;]+; return; \}/, 'if (!snap) { /* go on */ }') },
  { rule: 'O13', what: 'the flow confirms the estimate for him', plant: text(FL, 'confirmed, mayEdit: mayEditEstimate, project, draft: orderSendDraft,', 'confirmed: true, mayEdit: mayEditEstimate, project, draft: orderSendDraft,') },
  { rule: 'O13', what: 'the order list says added without reading the project back', plant: text(FL, /kept = estimateHoldsPush\(getProjectRef\.current\(project\.id\) \?\? null, res\);(?![\s\S]*kept = estimateHoldsPush)/, 'kept = true;') },
  { rule: 'O13', what: 'the view shares the list itself', plant: text(V, "import { formatMoney } from '@/utils/formatters';", "import { formatMoney } from '@/utils/formatters';\nimport { shareText } from '@/utils/shareText';") },
  { rule: 'O14', what: 'a catalog price is labelled as his own', plant: mod((m) => ({ draft: (s, l, db, c, ch) => { const d = m.draft(s, l, db, c, ch); return { ...d, lines: d.lines.map((x) => (x.source === 'engine' ? { ...x, source: 'yours' as never } : x)) }; } })) },
  { rule: 'O14', what: 'an unpriced line is shown at a price', plant: mod((m) => ({ draft: (s, l, db, c, ch) => { const d = m.draft(s, l, db, c, ch); return { ...d, lines: d.lines.map((x) => (x.source === null ? { ...x, rate: 0, amountCents: 0 } : x)) }; } })) },
  { rule: 'O14', what: 'waste is added a second time at pricing', plant: mod((m) => ({ draft: (s, l, db, c, ch) => { const d = m.draft(s, l, db, c, ch); return { ...d, lines: d.lines.map((x) => ({ ...x, quantity: Math.ceil(x.quantity * 1.1) + 1 })) }; } })) },
  { rule: 'O14', what: 'the order core looks his cost book up itself', plant: text('utils/roomScan/orderPricingCore.ts', 'const price = priceCondition(db, condition, l.quantity);', "const price = priceCondition(db, { ...condition, trade: lookupRate(db, 'Drywall', 'EA') ? 'Drywall' : null }, l.quantity);") },
  { rule: 'O14', what: 'the screen drops the price source label', plant: text(V, "{ocopy.materialSourceLabel(price?.source ?? null, copy.sourceLabel('manual', null), copy.sourceLabel(null, null))}", '{ocopy.typedLabel}') },
  { rule: 'O15', what: 'the text drops the notice', plant: mod((m) => ({ text: (l, r, wd) => m.text(l, r, { ...wd, notice: '' }) })) },
  { rule: 'O15', what: 'the text lists a line with nothing to buy', plant: mod((m) => ({ text: (l, r, wd) => `${m.text(l, r, wd)}\n  corner_bead: 0 stick` })) },
  { rule: 'O15', what: 'the text loses the typed mark', plant: mod((m) => ({ text: (l, r, wd) => m.text(l, r, { ...wd, typedMark: '' }) })) },
  { rule: 'L1', what: 'the facts count a wall within an inch that was not', plant: mod((m) => ({ facts: (p) => { const f = m.facts(p); return f.enough ? { ...f, withinCount: f.count } : f; } })) },
  { rule: 'L1', what: 'the largest difference is the average', plant: mod((m) => ({ facts: (p) => { const f = m.facts(p); return f.enough ? { ...f, largestIn: f.typicalIn } : f; } })) },
  { rule: 'L1', what: 'the sentence turns into a share', plant: en('office.roomScan.order.tape.factsBody', 'Your scans were within 1 inch on {within} of {count} walls. That is a good record.') },
  { rule: 'L2', what: 'three walls are enough', plant: mod((m) => ({ facts: (p) => (p.length >= 1 && p.length < 5 ? { enough: true, count: p.length, withinCount: p.length, withinIn: 1, typicalIn: 0.5, largestIn: 1, farCount: 0, longCount: 0 } : m.facts(p)) })) },
  { rule: 'L2', what: 'a short history still carries its largest difference', plant: mod((m) => ({ facts: (p) => { const f = m.facts(p); return f.enough ? f : { ...f, largestIn: 1 } as never; } })) },
  { rule: 'L2', what: 'the panel reads a difference past the sentence', plant: text('components/roomScan/TapeFactsPanel.tsx', '{copy.tapeFactsBody(facts)}', '{copy.inchesText((facts as { largestIn: number }).largestIn)}') },
  { rule: 'L3', what: 'the facts gain a percentage', plant: mod((m) => ({ facts: (p) => ({ ...m.facts(p), accuracyPct: 79 }) as never })) },
  { rule: 'L3', what: 'the facts gain a rate', plant: mod((m) => ({ facts: (p) => ({ ...m.facts(p), hitRate: 0.79 }) as never })) },
  { rule: 'L3', what: 'the panel words gain a score', plant: en('office.roomScan.order.tape.scopeNote', 'Your scans are 79 percent reliable.') },
  { rule: 'L3', what: 'the panel drops the scope sentence', plant: text('components/roomScan/TapeFactsPanel.tsx', '<Text style={styles.note}>{copy.tapeScopeNote}</Text>', '') },
  { rule: 'L4', what: 'a wild wall sets the largest difference', plant: mod((m) => ({ facts: (p) => { const f = m.facts(p); return f.enough && p.length > 14 ? { ...f, largestIn: 120, farCount: 0, count: p.length } : f; } })) },
  { rule: 'L4', what: 'the panel does not say walls were left out', plant: text('components/roomScan/TapeFactsPanel.tsx', '{facts.farCount > 0 && ', '{false && ') },
  { rule: 'L5', what: 'a suggestion from three long walls', plant: mod((m) => ({ suggest: (p, dm) => m.suggest(p, dm) ?? (p.length === 3 ? { addIn: 1, longCount: 3, shortCount: 3, typicalIn: 1, pooled: true } : null) })) },
  { rule: 'L5', what: 'a suggestion to order less', plant: mod((m) => ({ suggest: (p, dm) => m.suggest(p, dm) ?? (p.length === 14 ? { addIn: -1.5, longCount: 5, shortCount: 0, typicalIn: -1.5, pooled: true } : null) })) },
  { rule: 'L5', what: 'the suggestion has no cap', plant: mod((m) => ({ suggest: (p, dm) => { const s = m.suggest(p, dm); return s && s.addIn === 3 ? { ...s, addIn: 6 } : s; } })) },
  { rule: 'L5', what: 'the suggestion stops saying why', plant: en('office.roomScan.order.suggest.body', 'Add {add} to each long wall that you have not taped and that was not adjusted to match a taped wall. On this order list it changes the wall board, the wall paint, the baseboard and the crown. It does not change the floor, the ceiling, any tile or the scan.') },
  { rule: 'L6', what: 'the list applies an allowance nobody accepted', plant: mod((m) => ({ list: (scan, o) => m.list(scan, { ...o, longWallAddIn: o.longWallAddIn || 1.5 }) })) },
  { rule: 'L6', what: 'accepting changes the scan itself', plant: mod((m) => ({ list: (scan, o) => { if (o.longWallAddIn > 0) (scan.walls[0] as { lengthM: number }).lengthM += 0.0001; return m.list(scan, o); } })) },
  { rule: 'L6', what: 'the flow accepts the suggestion for him', plant: text(FL, "[tapePairs, scan]);", "[tapePairs, scan]);\n  const autoAdd = { longWallAddIn: suggestion?.addIn ?? 0 };") },
  { rule: 'L6', what: 'the order core reads the tape history', plant: text('utils/roomScan/orderListCore.ts', "import type { RoomScan, RoomType, ScanOpening, ScanWall } from './types';", "import type { RoomScan, RoomType, ScanOpening, ScanWall } from './types';\nimport { longWallSuggestion } from './learnCore';") },
  { rule: 'L6', what: 'the panel accepts on mount', plant: text('components/roomScan/TapeFactsPanel.tsx', "const styles = useThemedStyles(makeRoomScanStyles);", "const styles = useThemedStyles(makeRoomScanStyles);\n  if (p.suggestion) p.onAccept(p.suggestion.addIn);") },
  { rule: 'L7', what: 'a wall the app moved makes a pair', plant: mod((m) => ({ pair: (s, id, t, at, so) => m.pair(s, id, t, at, so) ?? (s.walls.find((x) => x.id === id)?.lengthSource === 'adjusted' ? { scanId: s.id, wallId: id, scannedM: 1, tapedM: t, lengthClass: 'short', deviceModel: '', roomType: 'room', at } : null) })) },
  { rule: 'L7', what: 'a wall keeps two pairs', plant: mod(() => ({ upsert: (l, a) => [...a, ...l] })) },
  { rule: 'L7', what: 'the pair is written the moment he types, not when he saves', plant: text(FL, 'return pair ? { ...cur, tapePairs: upsertTapePairs(cur.tapePairs ?? [], [pair]) } : cur;', 'if (pair) void recordTapePairs(userId, [pair]);\n        return pair ? { ...cur, tapePairs: upsertTapePairs(cur.tapePairs ?? [], [pair]) } : cur;') },
  { rule: 'L7', what: 'a deleted scan leaves its pairs', plant: text(FL, 'await forgetScanTapePairs(userId, target.scan.id);', '') },
  { rule: 'L8', what: 'a waste figure from two jobs', plant: mod((m) => ({ waste: (r) => (m.waste(r).length ? m.waste(r) : r.length === 2 ? [{ trade: 'tile', unit: 'sf', jobCount: 2, pct: 9, setAside: 0 }] : []) })) },
  { rule: 'L8', what: 'an offer to order less than the room measures', plant: mod(() => ({ wasteOffer: (wst) => (wst ? { trade: wst.trade, pct: wst.pct, jobCount: wst.jobCount } : null) })) },
  { rule: 'L8', what: 'boxes are compared with square feet', plant: mod((m) => ({ waste: (r) => m.waste(r.map((x) => ({ ...x, unit: 'sf' }))) })) },
  { rule: 'L8', what: 'the flow feeds the panel from receipts', plant: text(FL, 'suggestion={suggestion}', 'suggestion={suggestion}\n            wasteOffers={[]}') },
  { rule: 'S1', what: 'the tape list leaves the owned prefix', plant: text('utils/roomScan/learnStore.ts', "'mageid_room_scan_tape::'", "'room_scan_tape::'") },
  { rule: 'S1', what: 'the tape list is one key for every user', plant: text('utils/roomScan/learnStore.ts', '`${ROOM_SCAN_TAPE_KEY_PREFIX}${userId}`', '`${ROOM_SCAN_TAPE_KEY_PREFIX}all`') },
  { rule: 'S1', what: 'a write runs with nobody signed in', plant: text('utils/roomScan/learnStore.ts', 'if (!userId) return null;', '') },
  { rule: 'S2', what: 'the tape list is uploaded', plant: text('utils/roomScan/learnStore.ts', "import AsyncStorage from '@react-native-async-storage/async-storage';", "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport { supabase } from '@/lib/supabase';") },
  { rule: 'S2', what: 'the facts are sent to a model', plant: text('utils/roomScan/learnCore.ts', "import type { RoomScan, RoomType } from './types';", "import type { RoomScan, RoomType } from './types';\nimport { mageAI } from '@/utils/mageAI';") },
  { rule: 'N1', what: 'the flag is on', plant: mod(() => ({ flag: true })) },
  { rule: 'N1', what: 'another screen imports the order list', plant: (w) => ({ ...w, outside: { ...w.outside, 'app/project-detail.tsx': `${w.outside['app/project-detail.tsx'] ?? ''}\nimport { OrderListView } from '@/components/roomScan/OrderListView';` } }) },
  { rule: 'N1', what: 'the order list opens for a room that cannot be priced', plant: text('components/roomScan/QuantitiesView.tsx', 'onPress={order.onPress} disabled={block != null}', 'onPress={order.onPress}') },
  { rule: 'N1', what: 'the order list is mounted outside its step', plant: text(FL, "{step === 'order' && saved && orderList", "{saved && orderList") },
  { rule: 'W1', what: 'the notice is softened', plant: en('office.roomScan.order.noticeBody', 'Scans are usually close. Check before you order.') },
  { rule: 'W1', what: 'a line says "exact"', plant: en('office.roomScan.order.introBody', 'The exact materials to buy for {room}.') },
  { rule: 'W1', what: 'a line says "accurate"', plant: en('office.roomScan.order.layout.introBody', 'An accurate layout, one wall at a time.') },
  { rule: 'W1', what: 'a key has no Spanish', plant: es('office.roomScan.order.noticeBody', undefined) },
  { rule: 'W1', what: 'the notice moves below the list', plant: text(V, '<Text style={[styles.factText, styles.factCheck]}>{ocopy.noticeBody}</Text>', '<Text style={[styles.factText, styles.factCheck]}>{ocopy.titleLabel}</Text>') },
  { rule: 'W1', what: 'the estimate confirm drops the double-count warning', plant: en('office.roomScan.order.send.doubleCountBody', 'These lines go into the estimate with the rest.') },
  // ── the review round: every new rule, broken on purpose ──
  { rule: 'O1', what: 'the 98 in wall goes back to a full sheet and a 2 in strip', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => (x.w === 82 ? { ...x, w: 96, x: x.x === 0 ? 0 : 2 } : x.w === 16 ? { ...x, w: 2, x: x.x === 0 ? 0 : 96 } : x)) })) })) },
  { rule: 'O1', what: 'casing is cut to the bare opening again', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); const c = l.trimPlans.casing; return c ? { ...l, trimPlans: { ...l.trimPlans, casing: { ...c, sticks: c.sticks.map((st) => ({ ...st, cuts: st.cuts.map((x) => ({ ...x, lengthIn: x.lengthIn - 2.25 })) })) } } } : l; } })) },
  { rule: 'O2', what: 'a strip under the minimum is left at the end of a course', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => (x.w === 16 && x.x > 0 ? { ...x, x: x.x + 12, w: 4 } : x.w === 82 && x.x === 0 ? { ...x, w: 94 } : x)) })) })) },
  { rule: 'O2', what: 'the butt joints of two courses are stacked', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => (x.y === 0 && x.w === 16 && x.x === 0 ? { ...x, x: 82 } : x.y === 0 && x.w === 82 && x.x === 16 ? { ...x, x: 0 } : x)) })) })) },
  { rule: 'O2', what: 'a piece of a course is not hung', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s, i) => (i === 1 ? { ...s, pieces: s.pieces.slice(1) } : s)) })) },
  { rule: 'O2', what: 'more sheets than one for every sheet-length of every course', plant: wallPlan((p) => ({ ...p, sheets: p.sheets + 40, boardSF: (p.sheets + 40) * p.sheetAreaSF })) },
  { rule: 'O2', what: 'the layout hides a stacked joint it reports', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s, i) => (i === 0 ? { ...s, stackedJoints: 1 } : s)) })) },
  { rule: 'O8', what: 'wall tile takes the floor layout\'s allowance', plant: lines((l, list) => (l.key === 'wall_tile' && l.basis.kind === 'area' && list.options.floorLayout === 'herringbone' ? { ...l, quantity: Math.ceil(l.basis.netSF * 1.2), basis: { ...l.basis, wastePct: 20 } } : l)) },
  { rule: 'O8', what: 'one tap sets the floor and the wall allowance together', plant: text(V, 'onPress={() => p.onOptions({ floorWastePct: w })}', 'onPress={() => p.onOptions({ floorWastePct: w, wallTileWastePct: w })}') },
  { rule: 'O10', what: 'the plan under-reports what one stick per piece buys', plant: mod((m) => ({ pack: (r, st, a) => { const p = m.pack(r, st, a); return { ...p, onePerPiece: { ...p.onePerPiece, boughtFt: p.onePerPiece.boughtFt + 8 } }; } })) },
  { rule: 'O10', what: 'the allowance is dropped from the pieces', plant: mod((m) => ({ pack: (r, st) => m.pack(r, st, 0) })) },
  { rule: 'O10', what: 'a short list is called searched but is not the least', plant: mod((m) => ({ pack: (r, st, a) => { const p = m.pack(r, st, a); const big = Math.max(...p.stockFt); return p.method === 'searched' && p.sticks.length > 1 ? { ...p, sticks: p.sticks.map((x) => ({ ...x, stockFt: big })), boughtFt: big * p.sticks.length } : p; } })) },
  { rule: 'O10', what: 'the trim sentence says "the fewest feet" again', plant: en('office.roomScan.order.basis.trimNote', { one: '{run} ft to cover in 1 piece. {bought} ft of stick bought in all.', other: '{run} ft to cover in {count} pieces, packed into the fewest feet of stick. {bought} ft of stick bought in all.' }) },
  { rule: 'O10', what: 'a run under an inch is cut as a piece of baseboard', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); const b = l.trimPlans.baseboard; return b && scan.openings.some((x) => Math.abs(x.offsetM - 30.5 * IN) < 1e-9) ? { ...l, trimPlans: { ...l.trimPlans, baseboard: { ...b, sticks: b.sticks.map((st, i) => (i === 0 ? { ...st, cuts: [...st.cuts, { ...st.cuts[0], runId: 'sliver', lengthIn: 0.5 }] } : st)) } } } : l; } })) },
  { rule: 'O11', what: 'the trim line\'s key carries the stick length again', plant: lines((l, list) => (l.key === 'baseboard' ? { ...l, key: `baseboard:${list.options.stockFt.join('-')}`, typed: false, quantity: l.computed } : l)) },
  { rule: 'O12', what: 'changing the stick lengths changes which lines there are', plant: lines((l, list) => (l.group === 'trim' ? { ...l, key: `${l.key}:${Math.max(...list.options.stockFt)}` } : l)) },
  { rule: 'O14', what: 'a catalog material price is stamped as his measured cost', plant: mod((m) => ({ patch: (a) => { const r = m.patch(a); return r && a.after ? { ...r, next: { ...r.next, items: r.next.items.map((it) => (it.priceSource === 'regional' ? { ...it, priceSource: 'learned' as const } : it)) } } : r; } })) },
  { rule: 'O14', what: 'the pushed lines carry no price source', plant: mod((m) => ({ patch: (a) => m.patch({ ...a, after: undefined }) })) },
  { rule: 'O14', what: 'the material label says "No Past Jobs Yet" again', plant: en('office.roomScan.order.source.catalogLabel', 'No Past Jobs Yet, Catalog Price') },
  { rule: 'O16', what: 'the patch does not remove the stale lines', plant: mod((m) => ({ patch: (a) => m.patch({ ...a, after: undefined }) })) },
  { rule: 'O16', what: 'the plan removes a line he changed by hand', plant: mod((m) => ({ resend: (a) => { const p = m.resend(a); return { remove: [...p.remove, ...p.leftAlone.filter((x) => !a.lines.some((y) => y.conditionId === x.conditionId))], leftAlone: [], skip: [] }; } })) },
  { rule: 'O16', what: 'a line he changed by hand is overwritten', plant: mod((m) => ({ resend: (a) => ({ ...m.resend(a), skip: [] }) })) },
  { rule: 'O16', what: 'the plan reaches a line from another scan', plant: mod((m) => ({ resend: (a) => { const p = m.resend(a); return a.scanId === 'scan-1' ? { ...p, remove: [...p.remove, { conditionId: 'scanorder:another-scan:paint_walls', materialId: 'x-other', name: 'x' }] } : p; } })) },
  { rule: 'O16', what: 'the plan removes the room draft\'s installed line', plant: mod((m) => ({ resend: (a) => { const p = m.resend(a); return a.scanId === 'scan-1' ? { ...p, remove: [...p.remove, { conditionId: 'scan:scan-1:drywall_walls', materialId: 'x-installed', name: 'x' }] } : p; } })) },
  { rule: 'O16', what: 'with no record of the send, the stale lines are removed anyway', plant: mod((m) => ({ resend: (a) => (a.wrote ? m.resend(a) : m.resend({ ...a, wrote: Object.fromEntries((a.estimate?.items ?? []).filter((it) => it.sourceTakeoffConditionId).map((it) => [it.sourceTakeoffConditionId as string, { materialId: it.materialId, name: it.name, unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice }])) })) })) },
  { rule: 'O16', what: 'the sheet does not name the lines to be removed', plant: text(V, '{ocopy.resendRemoveBody(p.resend.remove)}', '{null}') },
  { rule: 'O16', what: 'the sheet shows one plan and the patch uses another', plant: text(FL, 'remove: resend.remove, sources', 'remove: [], sources') },
  { rule: 'O16', what: 'the removal sentence loses the names', plant: en('office.roomScan.order.send.resendRemoveBody', { one: '1 line will be removed.', other: '{count} lines will be removed.' }) },
  { rule: 'O16', what: 'the trim key changes with the stick length, so the old line is stale', plant: lines((l, list) => (l.key === 'baseboard' ? { ...l, key: `baseboard:${Math.min(...list.options.stockFt)}` } : l)) },
  { rule: 'O17', what: 'no mitre is added to the casing', plant: mod((m) => ({ list: (scan, o) => m.list(scan, { ...o, casingWidthIn: 1 }) })) },
  { rule: 'O17', what: 'both sides is ignored', plant: mod((m) => ({ list: (scan, o) => m.list(scan, { ...o, casingBothSides: false }) })) },
  { rule: 'O17', what: 'stool and apron is ignored', plant: mod((m) => ({ list: (scan, o) => m.list(scan, { ...o, windowTrim: 'picture' }) })) },
  { rule: 'O17', what: 'the casing line stops saying doors are cased one side', plant: en('office.roomScan.order.basis.casingDoorsOneNote', { one: '1 door.', other: '{count} doors.' }) },
  { rule: 'O17', what: 'the order list and the Quantities screen count different doors', plant: lines((l) => (l.key === 'casing' && l.basis.kind === 'trim' && l.basis.casing ? { ...l, basis: { ...l.basis, casing: { ...l.basis.casing, doorOpeningFt: l.basis.casing.doorOpeningFt + 3 } } } : l)) },
  { rule: 'O17', what: 'the screen loses the casing width control', plant: text(V, 'onPress={() => p.onOptions({ casingWidthIn: w })}', 'onPress={() => undefined}') },
  { rule: 'O18', what: 'a run ends in a strip', plant: mod((m) => ({ sheets: (su, op) => { const p = m.sheets(su, op); return { ...p, surfaces: p.surfaces.map((s) => { const i = s.pieces.findIndex((x, k) => k > 0 && x.y === s.pieces[k - 1].y && Math.abs(s.pieces[k - 1].x + s.pieces[k - 1].w - x.x) < 1e-6 && x.w > 6 && op.hang === 'across'); if (i < 0) return s; const cut = s.pieces[i].w - 3; return { ...s, pieces: s.pieces.map((x, k) => (k === i - 1 ? { ...x, w: x.w + cut } : k === i ? { ...x, x: x.x + cut, w: 3 } : x)) }; }) }; } })) },
  { rule: 'O18', what: 'every course is cut the same way, so the joints stack', plant: mod((m) => ({ sheets: (su, op) => { const p = m.sheets(su, op); if (op.hang !== 'across') return p; return { ...p, surfaces: p.surfaces.map((s) => { const top = s.pieces.filter((x) => x.y === s.pieces[0].y); const rows = [...new Set(s.pieces.map((x) => x.y))]; if (s.openings.length || rows.length < 2 || top.length < 2) return s; return { ...s, pieces: rows.flatMap((y) => top.map((x) => ({ ...x, y, h: s.pieces.find((q) => q.y === y)?.h ?? x.h }))) }; }) }; } })) },
  { rule: 'O18', what: 'a 1 1/8 in strip is boarded at the floor', plant: mod((m) => ({ sheets: (su, op) => { const p = m.sheets(su, op); return p.surfaces.some((s) => s.floorGapIn > 0) ? { ...p, sheets: p.sheets + 1, surfaces: p.surfaces.map((s) => ({ ...s, floorGapIn: 0 })) } : p; } })) },
  { rule: 'O18', what: 'the longer sheet is used without asking', plant: mod((m) => ({ sheets: (su, op) => m.sheets(su, { ...op, sheet: op.sheet === '4x8' ? '4x10' : op.sheet }) })) },
  { rule: 'O18', what: 'a ceiling piece overlaps another', plant: mod((m) => ({ sheets: (su, op) => { const p = m.sheets(su, op); return su[0]?.kind === 'ceiling' ? { ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: [...s.pieces, { ...s.pieces[0] }] })) } : p; } })) },
  { rule: 'O18', what: 'part of an L-shaped ceiling is not boarded', plant: mod((m) => ({ sheets: (su, op) => { const p = m.sheets(su, op); return su[0]?.kind === 'ceiling' ? { ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x, i) => (i === 0 ? { ...x, netAreaIn2: x.netAreaIn2 * 0.4 } : x)) })) } : p; } })) },
  { rule: 'O18', what: 'a spare sheet is hidden inside the wall count', plant: lines((l) => (l.key === 'drywall_walls' ? { ...l, computed: l.computed + 1, quantity: l.quantity + 1 } : l)) },
  { rule: 'O18', what: 'the screen drops "No spare sheet included."', plant: text(V, ': ocopy.noSpareNote}', ": ''}") },
  { rule: 'O18', what: 'the gap at the floor is not shown', plant: text(V, '{shown.floorGapIn > 0 && ', '{false && ') },
  { rule: 'O19', what: 'the options are not guarded in the core', plant: text('utils/roomScan/orderListCore.ts', 'const o = cleanOrderOptions(options);', 'const o = options;') },
  { rule: 'O19', what: 'a quantity that is not a number reaches a line', plant: lines((l, list) => (l.key === 'paint_walls' && list.options.coats === 2 && list.options.spreadSFPerGal === 350 && list.options.floorWastePct === 0 ? { ...l, quantity: Number.NaN, computed: Number.NaN } : l)) },
  { rule: 'O19', what: 'a wild spread rate is used as it comes', plant: mod((m) => ({ list: (scan, o) => { const l = m.list(scan, o); return o.spreadSFPerGal === 5 ? { ...l, options: { ...l.options, spreadSFPerGal: 5 } } : l; } })) },
  { rule: 'O20', what: 'the drawing\'s accessibility label is only its title', plant: text('components/roomScan/CutLayoutView.tsx', "accessibilityLabel={[a11yLabel, ...pieceLines].join('. ')}", 'accessibilityLabel={a11yLabel}') },
  { rule: 'O20', what: 'an offcut is shown by colour alone', plant: text('components/roomScan/CutLayoutView.tsx', 'if (p.fromOffcut) for (let x = x0 + STRIPE; x < x0 + w - 1; x += STRIPE) stripes.push(x);', '') },
  { rule: 'O20', what: 'the cut layout is not memoised', plant: text('components/roomScan/CutLayoutView.tsx', 'export const CutLayoutView = React.memo(CutLayout, (a, b) =>', 'export const CutLayoutView = pass(CutLayout, (a, b) =>') },
  { rule: 'O20', what: 'the piece list is dropped from under the drawing', plant: text(V, 'pieceLines={pieceLines}', 'pieceLines={[]}') },
  { rule: 'O20', what: 'a cutout no longer says what it was cut for', plant: wallPlan((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, pieces: s.pieces.map((x) => ({ ...x, cutouts: x.cutouts.map((c) => ({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 })) })) })) })) },
  { rule: 'O20', what: 'the piece line drops its size', plant: en('office.roomScan.order.layout.pieceSub', 'Sheet {sheet}, {parts}') },
  { rule: 'O21', what: 'the warning is missing when the send starts an estimate', plant: text(V, '{ocopy.doubleCountBody(p.installedAlreadyIn)}</Text>', '{p.starting ? null : ocopy.doubleCountBody(p.installedAlreadyIn)}</Text>') },
  { rule: 'O21', what: 'the warning is never the specific one', plant: text(FL, 'installedAlreadyIn={pushedLinesInEstimate(project, saved.pushed) > 0}', 'installedAlreadyIn={false}') },
  { rule: 'O21', what: 'Price It\'s confirm has no mirror sentence', plant: text('components/roomScan/PricedDraftView.tsx', '{p.materialsAlreadyIn === true && <Text style={styles.para} testID="scan-confirm-materials-in">{copy.confirmMaterialsInBody}</Text>}', '') },
  { rule: 'O21', what: 'the specific sentence stops saying the material is in twice', plant: en('office.roomScan.order.send.doubleCountInBody', 'The installed lines for this room are already in this estimate.') },
  { rule: 'L5', what: 'another phone\'s walls are mixed in without saying so', plant: mod((m) => ({ suggest: (p, dm) => { const sg = m.suggest(p, dm); return sg ? { ...sg, pooled: false } : sg; } })) },
  { rule: 'L5', what: 'the phone model is ignored', plant: mod((m) => ({ suggest: (p) => m.suggest(p, '') })) },
  { rule: 'L5', what: 'the flow does not say which phone the scan came from', plant: text(FL, "longWallSuggestion(tapePairs, scan?.device?.model ?? '')", 'longWallSuggestion(tapePairs)') },
  { rule: 'L6', what: 'inches are added to a wall the app adjusted', plant: mod((m) => ({ list: (scan, o) => m.list({ ...scan, walls: scan.walls.map((x) => (x.lengthSource === 'adjusted' ? { ...x, lengthSource: 'scan' as const } : x)) }, o) })) },
  { rule: 'L6', what: 'the added length reaches the wall tile', plant: lines((l, list) => (l.key === 'wall_tile' && list.options.longWallAddIn > 0 && l.net ? { ...l, net: { ...l.net, quantity: l.net.quantity + 1 } } : l)) },
  { rule: 'L6', what: 'the note stops saying what the added length does not change', plant: en('office.roomScan.order.addedNote', { one: 'This list adds {inches} to 1 long wall.', other: 'This list adds {inches} to each of {count} long walls.' }) },
  { rule: 'L7', what: 'a scan pushed off the saved list keeps its taped walls', plant: text('utils/roomScan/store.ts', 'try { await onDropped(dropped); }', 'try { /* nothing */ }') },
  { rule: 'L7', what: 'a save does not hand over the dropped scans', plant: text(FL, 'saveScan(next, rawJson, dropTape)', 'saveScan(next, rawJson)') },
  { rule: 'D1', what: 'the checklist loses what is missing', plant: text('docs/scan-the-room-native-checklist.md', /qbo_cost_lines/g, 'the accounting import') },
];

if (process.env.LIST === '1') for (const m of MUTATIONS) console.log(`  ${m.rule}: ${m.what}`);

// ── what the bathroom comes to (printed for the report; O1 pins the numbers) ──
{
  const scan = { ...scanOf('bathroom'), name: 'Hall Bathroom' };
  const l = ORDER.buildOrderList(scan, opts(scan));
  console.log(`\n  bathroom order list: ${l.lines.map((x) => `${x.key} ${x.quantity} ${x.unit}`).join(', ')}`);
  const f = LEARN.tapeFacts(HISTORY);
  console.log(`  tape facts on the 14-wall fixture: ${factsSentence(REAL, f)}`);
  const s = LEARN.longWallSuggestion(HISTORY);
  console.log(`  suggestion: ${s ? `add ${s.addIn} in to each untaped long wall (${s.shortCount} of ${s.longCount} long walls taped longer, typical ${s.typicalIn} in)` : 'none'}`);
}

console.log('\n── planted mutations (each must turn its own rule red)');
const proven = new Set<string>();
for (const m of MUTATIONS) {
  const id = Object.keys(RULES).find((k) => k.startsWith(`${m.rule} `));
  let caught = false;
  let how = '';
  try {
    if (!id) throw new Error(`no rule ${m.rule}`);
    scanCache.clear();
    const w = m.plant(REAL);
    let problems: string[];
    try { problems = RULES[id](w); } catch (e) { problems = [`threw ${e instanceof Error ? e.message : String(e)}`]; }
    caught = problems.length > 0;
    if (caught && process.env.WHY === '1') console.log(`  ${m.rule}: ${m.what}\n      caught by: ${problems[0].slice(0, 200)}`);
    if (!caught) how = 'the rule stayed green';
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (caught) { pass += 1; proven.add(m.rule); }
  else { fail += 1; console.log(`  ✗ ${m.rule}: ${m.what} (${how})`); }
}
scanCache.clear();
const unproven = Object.keys(RULES).map((k) => k.split(' ')[0]).filter((r) => !proven.has(r));
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-scan-order: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
if (fail > 0) process.exit(1);
