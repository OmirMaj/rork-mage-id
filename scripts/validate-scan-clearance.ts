// validate-scan-clearance — Scan The Room, Clearance Check (lane CLEARANCE).
// Owner preview behind ITS OWN gate (utils/roomScan/clearanceAllowed):
// CLEARANCE_CHECK_ENABLED = false, and no professional has read the table.
//
// WHAT IT PROVES, with no phone. Every room is a hand-built fixture
// (scripts/fixtures/scan-room). NOTHING HERE HAS BEEN CHECKED AGAINST A REAL
// SCAN, and no figure in the table has been read by an architect or an
// expediter. An independent reviewer re-derived the tight bathroom, then broke
// the first geometry on ordinary bathrooms; A7 and A8 are those rooms.
//
// A. THE MEASUREMENTS (utils/roomScan/clearanceCore)
//    A1  the tight bathroom, every row, against the answers worked by hand below;
//    A2  the narrow hallway with a stair the scan saw as one box;
//    A3  the bedroom with one window;
//    A4  the wide hallway;
//    A5  the fixture files equal what the builder writes, and turning or
//        moving the room changes no number; each line drawn on the plan is
//        as long as the number beside it;
//    A6  the stated method: a fixture that stands free is left out, furniture
//        is not in the way, the WHOLE width in front (to just inside each
//        edge of the box), an open outline has no passage, a scan with no
//        heights has no ceiling row, a window outside a bedroom is not set
//        beside anything, and a number that is not a number is no row;
//    A7  the reviewer's rooms: a sink in a vanity is measured from the
//        cabinet's front; the side distance is the shortest anywhere along
//        the toilet's depth; a fixture whose facing is not sure (a corner, a
//        wall within reach on the other axis, a near-square box, a toilet
//        not clearly deeper than wide, no open floor in front) is NOT
//        labelled and the screen says so; the room, not the box's own axes,
//        decides the facing; a fixture drawn across another thing is left
//        out; the outer edge of a bowl; a bedroom with a jog is not a
//        hallway; 22 in front of a toilet is close;
//    A8  the ceiling by place: New York City's two lines (7 ft in a bathroom,
//        8 ft in a room people live in) are shown there and nowhere else.
// B. THE STATES
//    B1  the boundaries: on the figure, the margin either side, a hair past
//        the margin either side, well clear, and the same for a "most";
//    B2  a door is a plain number with no figure and no state; a window is
//        never 'roomy' and never 'tight', and is compared only in a bedroom;
//    B3  a toilet's front is read against 21 in alone; set beside two
//        figures, a row takes the state most worth a tape and names the
//        figure that gave it; the ceiling figures follow the room and the place.
// C. THE MARGIN
//    C1  1.5 in by default, never less, wider with a worse tape history, up to
//        a cap, and never from too few walls or a slip of the thumb;
//    C2  a number he taped uses the tighter margin, the row says so, and a
//        taped wall never tightens a fixture's row.
// D. THE FIGURES (utils/roomScan/clearanceRefs)
//    D1  one table: every figure has its number, what it is called, its
//        family, whether it is compared or words only, and where it is used;
//        the numbers are the pinned ones; the screen's words are the table's;
//        no figure is typed into a string; a words-only figure is never set
//        beside a distance; the table is still waiting on the founder;
//    D2  no figure is called checked, and no section number exists, unless
//        the repo's checked jurisdiction data holds it; no section number is
//        written anywhere in the lane; every figure is drawn with "A commonly
//        used figure. Your local code may differ."
// W. THE WORDS
//    W1  the forbidden words are in neither language (no pass, fail,
//        compliant, legal, meets code, approved, violation, required, and no
//        "Looks Clear");
//    W2  the sentences that must be there are there and are always drawn: a
//        scan can be off by an inch or more, no label means not checked
//        against anything, nothing here stops an action, a door's clear width
//        is less, a door swinging into the space in front is not counted, a
//        window's net clear opening cannot be seen and the row never clears a
//        window, stairs are not measured, and "MAGE cannot tell which way
//        this fixture faces. Tape it.";
//    W3  every sentence is in the app's own words (utils/codeCard/echoCheck),
//        is short, quotes nothing, and never says how right a number is;
//    W4  house style: labels with every word capitalised, sentences that end,
//        captions that do not, no em dash, no "&", no "e.g.", no arrows; the
//        three state names; roomy says which side and that it is not a check
//        against the local code; the Spanish for close is not "justo";
//    W5  English and Spanish carry the same keys, plural shapes, placeholders
//        and source hashes, and the surface is registered.
// N. THE GATE AND THE WIRING (source text)
//    N1  it never blocks: no action depends on a state, the result carries no
//        verdict about the room, and nothing outside the feature reads it;
//    N2  its own gate: the owner always; anyone else only with
//        CLEARANCE_CHECK_ENABLED on AND a named professional's read of the
//        table. Flipping the scanner's switch alone shows it to nobody new;
//    N3  no model call, no network, no storage, no clock in the lane;
//    N4  it is registered: the package script, the ship-check chain, the
//        gate's pinned count, and the smoke suite;
//    N5  the native checklist blocks the first real scan on which box axis
//        is depth.
//
// PLANTED MUTATIONS. Every rule is run a second time against a planted break
// (a wrapped copy of a function, or edited text, in memory only) and the run
// fails unless that break turns the named rule red. `LIST=1` prints them, and
// `WHY=1` prints the first sentence each one was caught by.
//
// Run: bun run scripts/validate-scan-clearance.ts
// Pure node:fs + pure modules; no react-native import (those crash bun).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCapturedRoom } from '../utils/roomScan/capturedRoomParser';
import { buildRoomScan } from '../utils/roomScan/geometryCore';
import { correctCeilingHeight, correctOpening, correctWallLength } from '../utils/roomScan/editsCore';
import * as CORE from '../utils/roomScan/clearanceCore';
import * as REFS from '../utils/roomScan/clearanceRefs';
import { tapeFacts, lengthClass, type TapeFacts, type TapePair } from '../utils/roomScan/learnCore';
import type { RoomScan } from '../utils/roomScan/types';
import { CLEARANCE_CHECK_ENABLED, SCAN_ROOM_ENABLED } from '../constants/featureFlags';
import { scanRoomAllowedWith } from '../utils/roomScan/allowed';
import { clearanceCheckAllowedWith } from '../utils/roomScan/clearanceAllowed';
import { clearanceInNyc } from '../utils/roomScan/clearancePlace';
import { LOCAL_ADOPTIONS } from '../utils/codeJurisdiction';
import { longestRun, passesProseCheck } from '../utils/codeCard/echoCheck';
import { sourceHash } from '../i18n/hash';
import { SURFACES } from '../i18n/surfaces';
import { EN_SHARDS } from '../i18n/catalog/en';
import { ES_SHARDS } from '../i18n/catalog/es';
import { EN as EN_REAL } from '../i18n/catalog/en/office.scan-clearance.generated';
import { ES_OFFICE_SCAN_CLEARANCE as ES_REAL } from '../i18n/catalog/es/office/scanClearance';
import {
  FIXTURE_FILES, bathCeiling82Spec, bedroom96Spec, bedroomJogSpec, bedroomWindowSpec, buildCapturedRoom, narrowHallSpec, tightBathSpec,
  toiletCornerSwappedSpec, toiletFront22Spec, toiletFrontEdgeSpec, toiletSideCabinetSpec, vanitySinkSpec, type RoomSpec,
} from './fixtures/scan-room/builder';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

// ── the world a rule looks at (a mutation hands it an edited copy) ──────────
const CORE_FILES = ['utils/roomScan/clearanceCore.ts', 'utils/roomScan/clearanceRefs.ts'] as const;
const VIEW = 'components/roomScan/ClearanceView.tsx';
const HOOK = 'hooks/useScanClearanceCopy.ts';
const FLOW = 'components/roomScan/RoomScanFlow.tsx';
const PLAN = 'components/roomScan/FloorPlanView.tsx';
const SMOKE = '__tests__/smoke/scan-clearance.test.tsx';
const GATE_YML = '.github/workflows/ship-gate.yml';
const LANE_FILES = [...CORE_FILES, VIEW, HOOK] as const;
const OTHER_FILES = [
  FLOW, PLAN, SMOKE, GATE_YML, 'package.json', 'app/scan-room.tsx', 'utils/roomScan/allowed.ts', 'constants/featureFlags.ts',
  'utils/owner.ts', 'scripts/fixtures/scan-room/builder.ts', 'utils/roomScan/clearanceAllowed.ts', 'utils/roomScan/clearancePlace.ts', 'docs/scan-the-room-native-checklist.md',
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
    if (/(^|\/)roomScan\//.test(f) || f === 'app/scan-room.tsx' || f === HOOK || f.startsWith('i18n/catalog/')) continue;
    OUTSIDE[f] = read(f);
  }
}

interface Mods {
  build: typeof CORE.buildClearanceCheck;
  state: typeof CORE.clearanceState;
  boundState: typeof CORE.clearanceBoundState;
  margin: typeof CORE.clearanceMargin;
  refs: readonly REFS.ClearanceRef[];
  familyWords: Readonly<Record<REFS.ClearanceFamily, string>>;
  allowed: typeof scanRoomAllowedWith;
  flag: boolean;
  /** Clearance Check's own gate, its own switch, and the table's review record. */
  clearanceAllowed: typeof clearanceCheckAllowedWith;
  clearanceFlag: boolean;
  review: REFS.ClearanceRefsReview;
  proRead: typeof REFS.clearanceRefsProfessionallyRead;
  /** Is this project in New York City, by the app's one resolver. */
  inNyc: typeof clearanceInNyc;
}
interface World {
  M: Mods;
  F: Record<string, string>;
  outside: Record<string, string>;
  EN: Record<string, unknown>;
  ES: Record<string, { s: unknown; src: string } | undefined>;
}
const F_REAL: Record<string, string> = {};
for (const f of [...LANE_FILES, ...OTHER_FILES]) F_REAL[f] = existsSync(join(ROOT, f)) ? read(f) : '';
const REAL: World = {
  M: {
    build: CORE.buildClearanceCheck, state: CORE.clearanceState, boundState: CORE.clearanceBoundState, margin: CORE.clearanceMargin,
    refs: REFS.CLEARANCE_REFS, familyWords: REFS.CLEARANCE_FAMILY_WORDS, allowed: scanRoomAllowedWith, flag: SCAN_ROOM_ENABLED,
    clearanceAllowed: clearanceCheckAllowedWith, clearanceFlag: CLEARANCE_CHECK_ENABLED, review: REFS.CLEARANCE_REFS_REVIEW, proRead: REFS.clearanceRefsProfessionallyRead, inNyc: clearanceInNyc,
  },
  F: F_REAL, outside: OUTSIDE, EN: EN_REAL as Record<string, unknown>, ES: ES_REAL as World['ES'],
};

// ── helpers ─────────────────────────────────────────────────────────────────
const IN = 0.0254;
const AT = '2026-10-09T14:00:00.000Z';
const META = { id: 'scan-1', projectId: 'proj-1', name: 'Room', capturedAt: '2026-10-09T13:41:00.000Z', device: { model: 'iPhone16,1', os: '17.5' } };
const fromSpec = (spec: RoomSpec): RoomScan => buildRoomScan(parseCapturedRoom(JSON.stringify(buildCapturedRoom(spec))), META);
const scanCache = new Map<string, RoomScan>();
function scanOf(name: string): RoomScan {
  if (!scanCache.has(name)) scanCache.set(name, buildRoomScan(parseCapturedRoom(read(`scripts/fixtures/scan-room/${name}.json`)), META));
  return scanCache.get(name) as RoomScan;
}
const near = (a: number | null | undefined, b: number, tol = 0.01): boolean => typeof a === 'number' && Math.abs(a - b) <= tol;
const forms = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v as Record<string, string>) : []);
const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
type Rule = (w: World) => string[];
const RULES: Record<string, Rule> = {};
const rule = (id: string, fn: Rule) => { RULES[id] = fn; };
const check = (out: string[], cond: boolean, msg: string) => { if (!cond) out.push(msg); };

type State = CORE.ClearanceState | null;
interface Want {
  kind: CORE.ClearanceKind;
  index?: number;
  /** A category ('bathtub'), or 'wall'. Tells the two sides of a toilet apart. */
  toward?: string;
  /** Inches, or square feet for an area. */
  value: number;
  state: State;
  ref: REFS.ClearanceRefId | null;
  figures: [REFS.ClearanceRefId, State][];
  margin?: number;
  taped?: boolean;
}
const towardOf = (m: CORE.ClearanceMeasure): string => (m.toward ? (m.toward.kind === 'wall' ? 'wall' : m.toward.category) : '');
function pick(c: CORE.ClearanceCheck, want: Pick<Want, 'kind' | 'index' | 'toward'>): CORE.ClearanceMeasure | undefined {
  return c.measures.find((m) => m.kind === want.kind && m.index === (want.index ?? 1) && (want.toward == null || towardOf(m) === want.toward));
}
function compare(o: string[], room: string, c: CORE.ClearanceCheck, wants: Want[], total = wants.length) {
  check(o, c.measures.length === total, `${room}: ${c.measures.length} rows, not the ${total} worked by hand (${c.measures.map((m) => m.kind).join(', ')})`);
  for (const want of wants) {
    const name = `${room} ${want.kind}${want.index && want.index > 1 ? ` ${want.index}` : ''}${want.toward ? ` to ${want.toward}` : ''}`;
    const m = pick(c, want);
    if (!m) { o.push(`${name}: no such row`); continue; }
    check(o, near(m.valueUS, want.value, 0.005), `${name}: ${m.valueUS.toFixed(3)}, worked by hand as ${want.value}`);
    check(o, m.state === want.state, `${name}: state ${m.state}, worked by hand as ${want.state}`);
    check(o, m.stateRefId === want.ref, `${name}: the state is credited to ${m.stateRefId}, not ${want.ref}`);
    check(o, JSON.stringify(m.figures.map((f) => [f.refId, f.state])) === JSON.stringify(want.figures), `${name}: figures ${JSON.stringify(m.figures.map((f) => [f.refId, f.state]))}`);
    check(o, near(m.marginIn, want.margin ?? 1.5, 1e-9), `${name}: margin ${m.marginIn}, not ${want.margin ?? 1.5}`);
    check(o, m.restsOnTaped === (want.taped ?? false), `${name}: rests on a taped number is ${m.restsOnTaped}`);
  }
}
const NYC = { nyc: true } as const;
const leftKinds = (c: CORE.ClearanceCheck): string => c.leftOut.map((l) => `${l.kind}:${l.count}`).sort().join(' ');

// ── A. the measurements ─────────────────────────────────────────────────────

// THE TIGHT BATHROOM, WORKED BY HAND (scripts/fixtures/scan-room/builder.ts
// tightBathSpec). Inches. The room is 60 wide (x) by 96 deep (y), the ceiling
// 81. Left wall x = 0, right wall x = 60, bottom wall y = 0, far wall y = 96.
//   sink     on the left wall, 24 wide, 20 deep: x 0 to 20, y 15.5 to 39.5
//   toilet   on the left wall, 15 wide, 28 deep: x 0 to 28, centre line y = 52
//   tub      across the far end, 30 deep:        y 66 to 96
//   cabinet  on the right wall, 10 deep:         x 50 to 60, y 42 to 62
//   door     28 wide, on the bottom wall
// The margin is the default, 1.5.
//   TOILET, CENTRE LINE TO THE SINK   52 - 39.5 = 12.5.
//       Figure 15. 15 - 1.5 = 13.5, and 12.5 is under it: TIGHT.
//   TOILET, CENTRE LINE TO THE TUB    66 - 52 = 14.
//       13.5 <= 14 <= 16.5: CLOSE.
//   TOILET, CLEAR SPACE IN FRONT      the front of the box is x = 28. The
//       whole width of the box is looked along, from just inside one edge
//       (y = 44.5) to just inside the other (59.5). It meets the cabinet, whose
//       face is x = 50 between y 42 and 62: 50 - 28 = 22.
//       Figure 21, the only one a toilet's front is read against:
//       19.5 <= 22 <= 22.5, CLOSE. (The 24 in figure is words only now.)
//   SINK, CLEAR SPACE IN FRONT        the front of the box is x = 20. Its width
//       (y 15.5 to 39.5) passes under the cabinet (it starts at y 42) and
//       meets the right wall at x = 60: 40. Figure 21: 40 is past 22.5, ROOMY.
//   DOOR                              28 as scanned. A plain number: NO figure
//       and NO state (a 28 in bathroom door is ordinary).
//   THE FACING. Neither fixture is in a corner: the sink's box is 15.5 from the
//       bottom wall and the toilet's 36.5 from the far wall, both past the
//       11.8 in reach. Each backs onto the left wall alone.
//   NARROWEST WIDTH BETWEEN WALLS     60 (the left and right walls). The room
//       is 96 long: 96 / 60 = 1.6, under 2.5, so it is not shaped like a
//       hallway. No figure, no state.
//   LOWEST CEILING                    81. A bathroom is set beside 80 alone:
//       78.5 <= 81 <= 81.5, CLOSE.
// Left out, and said: the tub's opening (1), stairs (none seen), the clear
// width of the door (1).
const TIGHT_BATH: Want[] = [
  { kind: 'toilet_side', toward: 'sink', value: 12.5, state: 'tight', ref: 'toilet_side_15', figures: [['toilet_side_15', 'tight']] },
  { kind: 'toilet_side', toward: 'bathtub', value: 14, state: 'close', ref: 'toilet_side_15', figures: [['toilet_side_15', 'close']] },
  { kind: 'toilet_front', toward: 'storage', value: 22, state: 'close', ref: 'toilet_front_21', figures: [['toilet_front_21', 'close']] },
  { kind: 'sink_front', toward: 'wall', value: 40, state: 'roomy', ref: 'sink_front_21', figures: [['sink_front_21', 'roomy']] },
  { kind: 'door_width', value: 28, state: null, ref: null, figures: [] },
  { kind: 'passage_width', value: 60, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 81, state: 'close', ref: 'ceiling_bath_80', figures: [['ceiling_bath_80', 'close']] },
];
rule('A1 the tight bathroom, every row, against the answers worked by hand', (w) => {
  const o: string[] = [];
  const c = w.M.build(scanOf('tight-bath'));
  compare(o, 'tight bathroom', c, TIGHT_BATH);
  check(o, leftKinds(c) === 'door_clear:1 stairs:0 tub_opening:1', `left out: ${leftKinds(c)}`);
  check(o, c.comparedCount === 5 && c.tapedCount === 0, `${c.comparedCount} rows compared and ${c.tapedCount} taped, not 5 and 0`);
  const sink = pick(c, { kind: 'toilet_side', toward: 'sink' });
  check(o, !!sink && sink.wallIds.length === 0 && !!sink.objectId, 'a toilet side that meets the sink names a wall');
  const front = pick(c, { kind: 'sink_front' });
  check(o, !!front && front.wallIds.length === 1, 'the sink front does not name the wall it meets');
  return o;
});

// THE NARROW HALLWAY (narrowHallSpec). 37 wide by 240 long, ceiling 96. A 30
// in door in each end wall. A stair the scan saw as one box.
//   NARROWEST WIDTH   37. 240 / 37 = 6.5, past 2.5: a hallway. Figure 36:
//                     34.5 <= 37 <= 37.5, CLOSE.
//   DOORS             30 each. Plain numbers: no figure, no state.
//   LOWEST CEILING    96. A room shaped like a hallway is set beside 84 alone:
//                     96 is past 85.5, ROOMY.
//   STAIRS            left out: one box, no risers or treads.
const NARROW_HALL: Want[] = [
  { kind: 'door_width', index: 1, value: 30, state: null, ref: null, figures: [] },
  { kind: 'door_width', index: 2, value: 30, state: null, ref: null, figures: [] },
  { kind: 'passage_width', value: 37, state: 'close', ref: 'passage_36', figures: [['passage_36', 'close']] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_84', figures: [['ceiling_84', 'roomy']] },
];
rule('A2 the narrow hallway, and a stair the scan saw as one box', (w) => {
  const o: string[] = [];
  const scan = scanOf('narrow-hall');
  const c = w.M.build(scan);
  compare(o, 'narrow hallway', c, NARROW_HALL);
  check(o, scan.objects.some((x) => x.category === 'stairs'), 'the fixture no longer carries a stair');
  check(o, leftKinds(c) === 'door_clear:2 stairs:1', `left out: ${leftKinds(c)}`);
  check(o, !c.measures.some((m) => /stair|riser|tread/.test(m.kind)), 'a stair is measured, and the scan carries no risers or treads');
  // The box the scan drew for the stair is not a wall: the hallway is still measured wall to wall.
  check(o, near(pick(c, { kind: 'passage_width' })?.valueUS, 37, 0.005), 'the stair box changed the width between the walls');
  return o;
});

// THE BEDROOM (bedroomWindowSpec). 120 by 132, ceiling 96. One window 24 wide
// by 36 high, its sill 43 off the floor. One 36 in door.
//   DOOR            36. A plain number: no figure, no state.
//   WINDOW WIDTH    24. Figure 20 (net clear). Past 21.5: no state.
//   WINDOW HEIGHT   36. Figure 24 (net clear). Past 25.5: no state.
//   WINDOW AREA     24 x 36 = 864 sq in = 6.0 sq ft. Figure 5.7 sq ft (net
//                   clear) = 820.8 sq in. With the margin off each side,
//                   22.5 x 34.5 = 776.25 sq in = 5.39 sq ft, under 5.7: CLOSE.
//   WINDOW SILL     43. Figure 44, a most. 44 - 1.5 = 42.5, and 43 is past
//                   it: CLOSE.
//   NARROWEST WIDTH 120. 132 / 120 = 1.1: not a hallway, no state.
//   LOWEST CEILING  96. Figure 84: past 85.5, ROOMY. The 96 in figure is New
//                   York City's alone and no place is handed in here: no 8 ft line.
const BEDROOM: Want[] = [
  { kind: 'door_width', value: 36, state: null, ref: null, figures: [] },
  { kind: 'window_width', value: 24, state: null, ref: null, figures: [['escape_width_20', null]] },
  { kind: 'window_height', value: 36, state: null, ref: null, figures: [['escape_height_24', null]] },
  { kind: 'window_area', value: 6, state: 'close', ref: 'escape_area_5_7', figures: [['escape_area_5_7', 'close']] },
  { kind: 'window_sill', value: 43, state: 'close', ref: 'escape_sill_44', figures: [['escape_sill_44', 'close']] },
  { kind: 'passage_width', value: 120, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_84', figures: [['ceiling_84', 'roomy']] },
];
rule('A3 the bedroom with one window', (w) => {
  const o: string[] = [];
  const c = w.M.build(scanOf('bedroom-window'));
  compare(o, 'bedroom', c, BEDROOM);
  check(o, leftKinds(c) === 'door_clear:1 stairs:0 window_net_clear:1', `left out: ${leftKinds(c)}`);
  check(o, c.measures.filter((m) => m.kind.startsWith('window_')).every((m) => m.boundOnly), 'a window row is not marked as something the scan can only see larger');
  return o;
});

// THE WIDE HALLWAY (hallwaySpec, an older fixture). 42 wide by 264 long,
// ceiling 96, a 30 in door in each end wall and a cased opening (not a door:
// it is not measured here).
//   NARROWEST WIDTH   42. 264 / 42 = 6.3: a hallway. Figure 36: past 37.5, ROOMY.
//   DOORS             30 each: plain numbers.
//   LOWEST CEILING    96 beside 84 alone: ROOMY.
const HALLWAY: Want[] = [
  { kind: 'door_width', index: 1, value: 30, state: null, ref: null, figures: [] },
  { kind: 'door_width', index: 2, value: 30, state: null, ref: null, figures: [] },
  { kind: 'passage_width', value: 42, state: 'roomy', ref: 'passage_36', figures: [['passage_36', 'roomy']] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_84', figures: [['ceiling_84', 'roomy']] },
];
rule('A4 the wide hallway', (w) => {
  const o: string[] = [];
  const c = w.M.build(scanOf('hallway'));
  compare(o, 'hallway', c, HALLWAY);
  check(o, leftKinds(c) === 'door_clear:2 stairs:0', `left out: ${leftKinds(c)}`);
  return o;
});

rule('A5 the fixture files are the builder\'s, turning the room changes nothing, and each line is as long as its number', (w) => {
  const o: string[] = [];
  for (const name of ['tight-bath.json', 'narrow-hall.json', 'bedroom-window.json', 'vanity-sink.json', 'toilet-side-cabinet.json', 'toilet-corner-swapped.json', 'toilet-front-edge.json', 'bedroom-jog.json', 'bath-ceiling-82.json', 'bedroom-96.json', 'toilet-front-22.json']) {
    const spec = FIXTURE_FILES[name];
    check(o, !!spec && read(`scripts/fixtures/scan-room/${name}`) === JSON.stringify(buildCapturedRoom(spec()), null, 1) + '\n', `${name} no longer equals what builder.ts writes`);
  }
  check(o, /NOT FROM A PHONE/.test(w.F['scripts/fixtures/scan-room/builder.ts']), 'the fixture builder no longer says its rooms are not from a phone');
  const turned: [string, () => RoomSpec][] = [
    ['tight bathroom', tightBathSpec], ['narrow hallway', narrowHallSpec], ['bedroom', bedroomWindowSpec], ['sink in a vanity', vanitySinkSpec],
    ['cabinet beside a toilet', toiletSideCabinetSpec], ['toilet near a corner', toiletCornerSwappedSpec], ['outer edge of a bowl', toiletFrontEdgeSpec],
    ['bedroom with a jog', bedroomJogSpec], ['bathroom at 82.5', bathCeiling82Spec], ['bedroom at 96', bedroom96Spec], ['22 in front', toiletFront22Spec],
  ];
  for (const [name, spec] of turned) {
    const base = w.M.build(fromSpec(spec()));
    for (const turn of [0, 90, 211]) {
      const c = w.M.build(fromSpec({ ...spec(), rotateDeg: turn, shift: { x: -3.3, y: 7.1 } }));
      check(o, c.measures.length === base.measures.length && leftKinds(c) === leftKinds(base), `${name} turned ${turn} degrees has ${c.measures.length} rows and leaves out ${leftKinds(c)}`);
      for (const m of base.measures) {
        // The same row in the turned room: the same kind, number and thing met, and (a toilet has two sides) the nearest value.
        const t = c.measures.filter((x) => x.kind === m.kind && x.index === m.index && towardOf(x) === towardOf(m)).sort((p, q) => Math.abs(p.valueUS - m.valueUS) - Math.abs(q.valueUS - m.valueUS))[0];
        check(o, !!t && near(t.valueUS, m.valueUS, 1e-4) && t.state === m.state, `${name} turned ${turn} degrees: ${m.kind} reads ${t?.valueUS} ${t?.state}, not ${m.valueUS} ${m.state}`);
      }
    }
    for (const m of base.measures) {
      if (m.kind === 'ceiling_low') { check(o, m.line === null, 'a height has a line on the plan'); continue; }
      if (!m.line) { o.push(`${name} ${m.kind}: no line to draw`); continue; }
      const drawn = Math.hypot(m.line.b.x - m.line.a.x, m.line.b.y - m.line.a.y);
      // A window's height, area and sill are drawn as the opening's place on its wall.
      const onPlan = m.kind === 'window_height' || m.kind === 'window_area' || m.kind === 'window_sill' ? pick(base, { kind: 'window_width', index: m.index })?.value ?? -1 : m.value;
      check(o, near(drawn, onPlan, 1e-6), `${name} ${m.kind}: the line drawn is ${(drawn / IN).toFixed(2)} in long, the number is ${(onPlan / IN).toFixed(2)}`);
    }
  }
  return o;
});

rule('A6 the stated method: what is left out, what is in the way, the whole width in front, and no number that is not a number', (w) => {
  const o: string[] = [];
  const bath = tightBathSpec();
  const objects = bath.objects ?? [];
  const withObjects = (list: NonNullable<RoomSpec['objects']>) => w.M.build(fromSpec({ ...bath, objects: list }));
  const inPt = (x: number, y: number) => ({ x: x * IN, y: y * IN });
  // A toilet in the middle of the floor: the scan does not say which way it faces.
  const free = withObjects(objects.map((x) => (x.category === 'toilet' ? { ...x, at: inPt(30, 50) } : x)));
  check(o, !free.measures.some((m) => m.kind === 'toilet_side' || m.kind === 'toilet_front') && free.leftOut.some((l) => l.kind === 'fixture_free' && l.count === 1), 'a toilet standing free of the walls is measured, or is not said to be left out');
  // A chair in front of the toilet is not in the way of a tape. A cabinet in the same spot is: 35 - 28 = 7.
  const chair = withObjects([...objects, { category: 'chair', at: inPt(40, 52), w: 10 * IN, h: 30 * IN, d: 10 * IN }]);
  check(o, near(pick(chair, { kind: 'toilet_front' })?.valueUS, 22, 0.005), `a chair changed the space in front of the toilet to ${pick(chair, { kind: 'toilet_front' })?.valueUS}`);
  const box = withObjects([...objects, { category: 'storage', at: inPt(40, 52), w: 10 * IN, h: 30 * IN, d: 10 * IN }]);
  check(o, near(pick(box, { kind: 'toilet_front' })?.valueUS, 7, 0.005), `a cabinet in front of the toilet gives ${pick(box, { kind: 'toilet_front' })?.valueUS}, not 7`);
  // The front looks along the box's whole width, y 44.5 to 59.5, to just inside each edge. A cabinet covering only y 54 to 62 is in front: still 22.
  const noCabinet = objects.filter((x) => x.category !== 'storage');
  const quarter = withObjects([...noCabinet, { category: 'storage', at: inPt(55, 58), w: 8 * IN, h: 72 * IN, d: 10 * IN, turnDeg: 90 }]);
  check(o, near(pick(quarter, { kind: 'toilet_front' })?.valueUS, 22, 0.005), `a cabinet in front of a quarter of the toilet is missed: ${pick(quarter, { kind: 'toilet_front' })?.valueUS}`);
  // One covering only y 57 to 63 is ahead of the last 2.5 in of the bowl (its edge is y = 59.5): it IS in front. 50 - 28 = 22.
  // (This rule once pinned the miss as correct: 32, to the wall.)
  const edge = withObjects([...noCabinet, { category: 'storage', at: inPt(55, 60), w: 6 * IN, h: 72 * IN, d: 10 * IN, turnDeg: 90 }]);
  check(o, near(pick(edge, { kind: 'toilet_front' })?.valueUS, 22, 0.005) && towardOf(pick(edge, { kind: 'toilet_front' }) as CORE.ClearanceMeasure) === 'storage', `a cabinet ahead of only the outer edge of the bowl is missed: ${pick(edge, { kind: 'toilet_front' })?.valueUS}`);
  // One covering only y 60 to 66 starts past the edge of the box: it is not in front. The right wall, 60 - 28 = 32.
  const past = withObjects([...noCabinet, { category: 'storage', at: inPt(55, 63), w: 6 * IN, h: 72 * IN, d: 10 * IN, turnDeg: 90 }]);
  check(o, near(pick(past, { kind: 'toilet_front' })?.valueUS, 32, 0.005) && towardOf(pick(past, { kind: 'toilet_front' }) as CORE.ClearanceMeasure) === 'wall', `a cabinet past the edge of the bowl is counted as in front: ${pick(past, { kind: 'toilet_front' })?.valueUS}`);
  // A number that is not a number is not a measurement: no row, in any room.
  const bathScan = scanOf('tight-bath');
  const broken: RoomScan[] = [
    { ...bathScan, ceilingHeightM: { ...bathScan.ceilingHeightM, min: Infinity } },
    { ...bathScan, ceilingHeightM: { ...bathScan.ceilingHeightM, min: NaN } },
    { ...bathScan, openings: bathScan.openings.map((x) => ({ ...x, widthM: Infinity })) },
    { ...bathScan, objects: bathScan.objects.map((x) => (x.category === 'toilet' ? { ...x, center: { x: NaN, y: x.center.y } } : x)) },
    { ...bathScan, objects: bathScan.objects.map((x) => (x.category === 'sink' ? { ...x, depthM: Infinity } : x)) },
  ];
  for (const [i, b] of broken.entries()) {
    const c = w.M.build(b);
    check(o, c.measures.every((m) => Number.isFinite(m.value) && Number.isFinite(m.valueUS) && (!m.line || [m.line.a.x, m.line.a.y, m.line.b.x, m.line.b.y].every(Number.isFinite))), `broken scan ${i + 1}: a row carries a number that is not a number`);
  }
  check(o, !pick(w.M.build(broken[0]), { kind: 'ceiling_low' }) && !pick(w.M.build(broken[2]), { kind: 'door_width' }), 'a ceiling or a door with no finite size still has a row');
  check(o, !w.M.build(broken[3]).measures.some((m) => m.kind.startsWith('toilet_')) && w.M.build(broken[3]).leftOut.some((l) => l.kind === 'fixture_facing'), 'a toilet with no finite place is measured, or is not said to be left out');
  // An open outline: no floor between walls is known, so no passage, and it is said.
  const open = w.M.build(scanOf('missing-wall'));
  check(o, !pick(open, { kind: 'passage_width' }) && open.leftOut.some((l) => l.kind === 'passage_open'), 'a room whose outline did not close has a narrowest width, or does not say it was left out');
  // No heights in the scan: no ceiling row, and it is said.
  const flat = w.M.build(fromSpec({ ...bath, noHeights: true }));
  check(o, !pick(flat, { kind: 'ceiling_low' }) && flat.leftOut.some((l) => l.kind === 'ceiling_unknown'), 'a scan with no heights has a ceiling row');
  // A window in a bathroom is set beside nothing, and that is said.
  const hallBath = w.M.build(scanOf('bathroom'));
  check(o, !hallBath.measures.some((m) => m.kind.startsWith('window_')) && hallBath.leftOut.some((l) => l.kind === 'windows_not_bedroom' && l.count === 1), 'a bathroom window is set beside the escape opening figures');
  // A cased opening is not a door.
  check(o, w.M.build(scanOf('hallway')).measures.filter((m) => m.kind === 'door_width').length === 2, 'a cased opening is measured as a door');
  return o;
});

// THE REVIEWER'S ROOMS (scripts/fixtures/scan-room/builder.ts, each worked by
// hand there too). An independent reviewer broke the first geometry on each.
// Every room is 60 wide by 96 deep unless it says otherwise. Inches.
//   A SINK IN A VANITY (vanity-sink). Cabinet x 0 to 22, y 30 to 66. Sink
//       x 3 to 19, centred in it. The front line starts at the CABINET's face:
//       60 - 22 = 38. Figure 21: ROOMY. (It read 22 - 19 = 3, "Tight".)
//   A CABINET BESIDE THE FRONT HALF OF A TOILET (toilet-side-cabinet). Centre
//       line y = 48, box x 0 to 28. Cabinet x 16 to 28, y 56 to 70.
//       To the cabinet: 56 - 48 = 8, TIGHT. To the bottom wall: 48, ROOMY.
//       In front: the cabinet starts past the box's edge (55.5): 60 - 28 = 32, ROOMY.
//   A TOILET NEAR A CORNER, AXES SWAPPED (toilet-corner-swapped). Box x 0 to
//       28, y 8.5 to 23.5. Walls within reach on both axes: NOT LABELLED.
//   THE OUTER EDGE OF A BOWL (toilet-front-edge). Box y 44.5 to 59.5. Cabinet
//       on the right wall, y 57 to 63, face x = 50. In front: 50 - 28 = 22,
//       CLOSE. Sides: 52 to the bottom wall, 44 to the far wall, ROOMY.
//   A BEDROOM WITH A JOG (bedroom-jog). 144 by 144 with a nook 36 wide and 14
//       deep. Narrowest 36, the two walls share 14: 14 < 2.5 x 36, NOT a
//       hallway, no state. Ceiling 96 beside 84: ROOMY.
//   22 IN FRONT OF A TOILET (toilet-front-22). Room 50 wide: 50 - 28 = 22,
//       beside 21 alone: CLOSE. Sides 48 and 48: ROOMY.
const VANITY: Want[] = [
  { kind: 'sink_front', toward: 'wall', value: 38, state: 'roomy', ref: 'sink_front_21', figures: [['sink_front_21', 'roomy']] },
  { kind: 'passage_width', value: 60, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_bath_80', figures: [['ceiling_bath_80', 'roomy']] },
];
const SIDE_CABINET: Want[] = [
  { kind: 'toilet_side', toward: 'storage', value: 8, state: 'tight', ref: 'toilet_side_15', figures: [['toilet_side_15', 'tight']] },
  { kind: 'toilet_side', toward: 'wall', value: 48, state: 'roomy', ref: 'toilet_side_15', figures: [['toilet_side_15', 'roomy']] },
  { kind: 'toilet_front', toward: 'wall', value: 32, state: 'roomy', ref: 'toilet_front_21', figures: [['toilet_front_21', 'roomy']] },
  { kind: 'passage_width', value: 60, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_bath_80', figures: [['ceiling_bath_80', 'roomy']] },
];
const CORNER: Want[] = [
  { kind: 'passage_width', value: 60, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_bath_80', figures: [['ceiling_bath_80', 'roomy']] },
];
const FRONT_EDGE: Want[] = [
  { kind: 'toilet_front', toward: 'storage', value: 22, state: 'close', ref: 'toilet_front_21', figures: [['toilet_front_21', 'close']] },
  { kind: 'passage_width', value: 60, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_bath_80', figures: [['ceiling_bath_80', 'roomy']] },
];
const JOG: Want[] = [
  { kind: 'passage_width', value: 36, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_84', figures: [['ceiling_84', 'roomy']] },
];
const FRONT_22: Want[] = [
  { kind: 'toilet_front', toward: 'wall', value: 22, state: 'close', ref: 'toilet_front_21', figures: [['toilet_front_21', 'close']] },
  { kind: 'passage_width', value: 50, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 96, state: 'roomy', ref: 'ceiling_bath_80', figures: [['ceiling_bath_80', 'roomy']] },
];
rule('A7 the reviewer\'s rooms: a sink in a vanity, a cabinet beside a toilet, a corner, the outer edge of a bowl, a jog', (w) => {
  const o: string[] = [];
  const inPt = (x: number, y: number) => ({ x: x * IN, y: y * IN });
  const room = (objects: NonNullable<RoomSpec['objects']>) => w.M.build(fromSpec({ ...toiletCornerSwappedSpec(), objects }));
  const toilet = (x: number, y: number, wIn: number, dIn: number, turnDeg: number) => ({ category: 'toilet', at: inPt(x, y), w: wIn * IN, h: 30 * IN, d: dIn * IN, turnDeg });
  const sides = (c: CORE.ClearanceCheck) => c.measures.filter((m) => m.kind === 'toilet_side').map((m) => Math.round(m.valueUS * 100) / 100).sort((a, b) => a - b).join();

  // 1. A sink in a vanity.
  const vanity = w.M.build(scanOf('vanity-sink'));
  compare(o, 'sink in a vanity', vanity, VANITY);
  check(o, leftKinds(vanity) === 'stairs:0', `sink in a vanity leaves out ${leftKinds(vanity)}`);
  check(o, pick(vanity, { kind: 'sink_front' })?.frontFrom === 'cabinet', 'the sink row does not say it was measured from the front of the cabinet');
  check(o, pick(w.M.build(scanOf('tight-bath')), { kind: 'sink_front' })?.frontFrom === 'box' && pick(w.M.build(scanOf('tight-bath')), { kind: 'toilet_front' })?.frontFrom === 'box', 'a fixture with no cabinet is said to be measured from one');
  // A sink across TWO cabinets, or a toilet drawn across a cabinet, is not measured past either: left out, and said.
  const spec = vanitySinkSpec();
  const two = w.M.build(fromSpec({ ...spec, objects: [...(spec.objects ?? []), { category: 'storage', at: inPt(11, 60), w: 10 * IN, h: 30 * IN, d: 10 * IN }] }));
  check(o, !pick(two, { kind: 'sink_front' }) && two.leftOut.some((l) => l.kind === 'fixture_overlap' && l.count === 1), 'a sink the scan drew across two cabinets is measured');
  const across = room([toilet(14, 48, 15, 28, 90), { category: 'storage', at: inPt(14, 58), w: 12 * IN, h: 30 * IN, d: 12 * IN }]);
  check(o, !across.measures.some((m) => m.kind.startsWith('toilet_')) && across.leftOut.some((l) => l.kind === 'fixture_overlap'), 'a toilet the scan drew across a cabinet is measured past it');
  // A cabinet that only TOUCHES the toilet's box (its edge on y = 55.5) is beside it: 55.5 - 48 = 7.5, tight.
  const touching = room([toilet(14, 48, 15, 28, 90), { category: 'storage', at: inPt(14, 61.5), w: 12 * IN, h: 30 * IN, d: 12 * IN }]);
  check(o, near(pick(touching, { kind: 'toilet_side', toward: 'storage' })?.valueUS, 7.5, 0.005) && pick(touching, { kind: 'toilet_side', toward: 'storage' })?.state === 'tight', `a cabinet touching the toilet reads ${pick(touching, { kind: 'toilet_side', toward: 'storage' })?.valueUS}`);

  // 2. A cabinet beside the front half of a toilet.
  const beside = w.M.build(scanOf('toilet-side-cabinet'));
  compare(o, 'cabinet beside a toilet', beside, SIDE_CABINET);
  check(o, leftKinds(beside) === 'stairs:0', `cabinet beside a toilet leaves out ${leftKinds(beside)}`);
  // The same cabinet beside the BACK half (x 2 to 14): still 8. Ahead of the box altogether (x 30 to 42): not beside it, 48 to the far wall.
  const backHalf = room([toilet(14, 48, 15, 28, 90), { category: 'storage', at: inPt(8, 63), w: 12 * IN, h: 30 * IN, d: 14 * IN }]);
  check(o, sides(backHalf) === '8,48', `a cabinet beside the back half of a toilet reads ${sides(backHalf)}`);
  const ahead = room([toilet(14, 48, 15, 28, 90), { category: 'storage', at: inPt(36, 63), w: 12 * IN, h: 30 * IN, d: 14 * IN }]);
  check(o, sides(ahead) === '48,48', `a cabinet ahead of a toilet is counted as beside it: ${sides(ahead)}`);

  // 3. The facing: when it is not sure, the fixture is not labelled.
  const corner = w.M.build(scanOf('toilet-corner-swapped'));
  compare(o, 'toilet near a corner', corner, CORNER);
  check(o, leftKinds(corner) === 'fixture_facing:1 stairs:0', `toilet near a corner leaves out ${leftKinds(corner)}`);
  const declines = (name: string, c: CORE.ClearanceCheck) => check(o, !c.measures.some((m) => m.kind.startsWith('toilet_') || m.kind === 'sink_front') && c.leftOut.some((l) => l.kind === 'fixture_facing' && l.count === 1), `${name} is labelled (${c.measures.map((m) => m.kind).join()}; ${leftKinds(c)})`);
  // The same box with its axes the usual way round is in the same corner: not labelled either.
  declines('a toilet near a corner with the usual axes', room([toilet(14, 16, 15, 28, 90)]));
  // A toilet in an alcove 30 wide (a wall 7.5 from each side of the box) has walls within reach on both axes too.
  declines('a toilet between two near walls', w.M.build(fromSpec({ ...toiletCornerSwappedSpec(), walls: [{ a: inPt(0, 0), b: inPt(60, 0), height: 2.4 }, { a: inPt(60, 0), b: inPt(60, 30), height: 2.4 }, { a: inPt(60, 30), b: inPt(0, 30), height: 2.4 }, { a: inPt(0, 30), b: inPt(0, 0), height: 2.4 }], objects: [toilet(14, 15, 15, 28, 90)] })));
  // A near-square box (20 by 19), and a toilet whose depth is not clearly more than its width (20 wide, 24 deep: under 1.25 x 20).
  declines('a near-square toilet', room([toilet(10, 48, 19, 20, 90)]));
  declines('a toilet 20 wide and 24 deep', room([toilet(12, 48, 20, 24, 90)]));
  declines('a near-square sink', room([{ category: 'sink', at: inPt(9, 48), w: 19 * IN, h: 8 * IN, d: 18 * IN, turnDeg: 90 }]));
  // A corridor-thin space: the far wall is within reach of the front as well. No open floor in front.
  declines('a toilet with a wall within reach in front', w.M.build(fromSpec({ ...toiletCornerSwappedSpec(), walls: [{ a: inPt(0, 0), b: inPt(36, 0), height: 2.4 }, { a: inPt(36, 0), b: inPt(36, 96), height: 2.4 }, { a: inPt(36, 96), b: inPt(0, 96), height: 2.4 }, { a: inPt(0, 96), b: inPt(0, 0), height: 2.4 }], objects: [toilet(14, 48, 15, 28, 90)] })));
  // AWAY from the corner the room decides, not the box: the same toilet written with its axes swapped reads the same as the usual way.
  //   box x 0 to 28, centre line y = 40: 40 to the bottom wall, 56 to the far wall, 60 - 28 = 32 in front.
  const usual = room([toilet(14, 40, 15, 28, 90)]);
  const swapped = room([toilet(14, 40, 28, 15, 0)]);
  const turnedRound = room([toilet(14, 40, 15, 28, 270)]);
  for (const [name, c] of [['the usual axes', usual], ['swapped axes', swapped], ['the box written back to front', turnedRound]] as [string, CORE.ClearanceCheck][]) {
    check(o, sides(c) === '40,56' && near(pick(c, { kind: 'toilet_front' })?.valueUS, 32, 0.005) && leftKinds(c) === 'stairs:0', `a toilet away from the corner with ${name} reads sides ${sides(c)} and front ${pick(c, { kind: 'toilet_front' })?.valueUS}`);
  }
  // The sentence.
  check(o, w.EN['office.scanClearance.leftOut.fixtureFacingBody'] === 'MAGE cannot tell which way this fixture faces. Tape it.', 'the sentence for a fixture that is not labelled changed');
  check(o, /case 'fixture_facing': return t\('office\.scanClearance\.leftOut\.fixtureFacingBody'/.test(stripComments(w.F[HOOK])), 'a fixture that is not labelled has no sentence on the screen');

  // 4. Something ahead of only the outer edge of a bowl.
  const edge = w.M.build(scanOf('toilet-front-edge'));
  compare(o, 'outer edge of a bowl', edge, FRONT_EDGE, 5);
  check(o, sides(edge) === '44,52' && edge.measures.filter((m) => m.kind === 'toilet_side').every((m) => m.state === 'roomy'), `outer edge of a bowl: sides ${sides(edge)}`);

  // 6. A bedroom with a jog is not a hallway, and keeps a room's ceiling line.
  const jog = w.M.build(scanOf('bedroom-jog'));
  compare(o, 'bedroom with a jog', jog, JOG);
  // The tight bathroom's walls share all 96 of their length: 96 / 60 = 1.6, not a hallway. The narrow hallway's share 240: 240 / 37 = 6.5.
  check(o, pick(w.M.build(scanOf('narrow-hall')), { kind: 'passage_width' })?.state === 'close' && pick(w.M.build(scanOf('tight-bath')), { kind: 'passage_width' })?.state === null, 'the hallway test no longer tells a hallway from a bathroom');

  // 8. 22 in front of a toilet is close, read against 21 alone.
  const f22 = w.M.build(scanOf('toilet-front-22'));
  compare(o, '22 in front', f22, FRONT_22, 5);
  check(o, sides(f22) === '48,48', `22 in front: sides ${sides(f22)}`);
  return o;
});

// THE CEILING, BY PLACE. `nyc` is handed in by the caller, from the app's one
// resolver (utils/roomScan/clearancePlace over utils/codeJurisdiction).
//   A BATHROOM AT 82.5 (bath-ceiling-82)
//       anywhere else    beside 80 alone: 82.5 is past 81.5, ROOMY.
//       New York City    also beside that city's commonly cited 84:
//                        84 - 1.5 = 82.5, so CLOSE. The row takes CLOSE and
//                        credits the New York City figure. NEVER ROOMY.
//   A BEDROOM AT 96 (bedroom-96)
//       Baltimore        beside 84 alone: ROOMY. No 8 ft line.
//       New York City    also beside that city's commonly cited 96: on it, CLOSE.
rule('A8 the ceiling by place: New York City\'s two lines are shown there and nowhere else', (w) => {
  const o: string[] = [];
  const ceil = (name: string, opt?: CORE.ClearanceOptions) => pick(w.M.build(scanOf(name), [], opt), { kind: 'ceiling_low' });
  const figs = (m: CORE.ClearanceMeasure | undefined) => JSON.stringify((m?.figures ?? []).map((f) => [f.refId, f.state]));
  const bath = ceil('bath-ceiling-82');
  check(o, near(bath?.valueUS, 82.5, 0.005) && bath?.state === 'roomy' && figs(bath) === '[["ceiling_bath_80","roomy"]]', `a bathroom at 82.5 with no place reads ${bath?.state} ${figs(bath)}`);
  const bathOff = ceil('bath-ceiling-82', { nyc: false });
  check(o, figs(bathOff) === figs(bath), 'a bathroom outside New York City is set beside that city\'s line');
  const bathNyc = ceil('bath-ceiling-82', NYC);
  check(o, bathNyc?.state === 'close' && bathNyc.stateRefId === 'ceiling_bath_84_nyc' && figs(bathNyc) === '[["ceiling_bath_80","roomy"],["ceiling_bath_84_nyc","close"]]', `a New York City bathroom at 82.5 reads ${bathNyc?.state} by ${bathNyc?.stateRefId} ${figs(bathNyc)}`);
  // A New York City bathroom is not roomy until it is past 84 + 1.5: 85 is still close, 86 is roomy.
  const scan = scanOf('bath-ceiling-82');
  const at = (inches: number, opt?: CORE.ClearanceOptions) => pick(w.M.build({ ...scan, ceilingHeightM: { ...scan.ceilingHeightM, min: inches * IN } }, [], opt), { kind: 'ceiling_low' })?.state;
  check(o, at(85, NYC) === 'close' && at(86, NYC) === 'roomy' && at(82, NYC) === 'tight' && at(82) === 'roomy', `a New York City bathroom reads ${at(82, NYC)} at 82, ${at(85, NYC)} at 85 and ${at(86, NYC)} at 86`);
  const bed = ceil('bedroom-96', { nyc: false });
  check(o, near(bed?.valueUS, 96, 0.005) && bed?.state === 'roomy' && figs(bed) === '[["ceiling_84","roomy"]]', `a Baltimore bedroom at 96 reads ${bed?.state} ${figs(bed)}`);
  const bedNyc = ceil('bedroom-96', NYC);
  check(o, bedNyc?.state === 'close' && bedNyc.stateRefId === 'ceiling_96' && figs(bedNyc) === '[["ceiling_84","roomy"],["ceiling_96","close"]]', `a New York City bedroom at 96 reads ${bedNyc?.state} ${figs(bedNyc)}`);
  // The 8 ft line is about rooms people live in: not a bathroom, and not a hallway, even in New York City. A bedroom with a jog keeps it.
  check(o, figs(ceil('narrow-hall', NYC)) === '[["ceiling_84","roomy"]]', `a New York City hallway is set beside ${figs(ceil('narrow-hall', NYC))}`);
  check(o, figs(ceil('bedroom-jog', NYC)) === '[["ceiling_84","roomy"],["ceiling_96","close"]]', `a New York City bedroom with a jog is set beside ${figs(ceil('bedroom-jog', NYC))}`);
  // With no place handed in, no fixture room shows a New York City line.
  for (const name of ['tight-bath', 'narrow-hall', 'bedroom-window', 'hallway', 'bathroom', 'bedroom-jog', 'bedroom-96', 'bath-ceiling-82']) {
    for (const m of w.M.build(scanOf(name)).measures) for (const f of m.figures) check(o, w.M.refs.find((r) => r.id === f.refId)?.where === 'anywhere', `${name}: ${f.refId} is shown with no place handed in`);
  }
  // Only New York City switches them on, and the place comes from the app's one resolver.
  const flow = stripComments(w.F[FLOW]);
  check(o, /const clearanceNyc = useMemo\(\(\) => clearanceInNyc\(project\), \[project\]\);/.test(flow), 'the flow does not ask whether the project is in New York City');
  const place = stripComments(w.F['utils/roomScan/clearancePlace.ts']);
  check(o, /const resolved = resolveCodeJurisdiction\(jurisdictionQueryForProject\(project\)\);\s*return resolved\.kind === 'city' && resolved\.entry\.name === NYC_ROW_NAME;/.test(place) && /export const NYC_ROW_NAME = 'New York City';/.test(place), 'the place is not read from the app\'s one resolver');
  check(o, (place.match(/from '([^']+)'/g) ?? []).join() === "from '@/utils/codeJurisdiction'" && !/location|\.zip|\.city|toLowerCase|RegExp|\/i\b/.test(place.replace(/jurisdictionQueryForProject|resolveCodeJurisdiction/g, '')), 'the place file reads the address a second way of its own');
  check(o, LOCAL_ADOPTIONS.some((e) => e.name === 'New York City'), 'the resolver has no row named New York City');
  // The five boroughs are New York City. Baltimore, the rest of New York State, and no address at all are not.
  for (const location of ['Brooklyn, NY 11201', 'New York, NY', 'Queens, NY 11375', 'Bronx, NY 10451', 'Staten Island, NY 10301']) check(o, w.M.inNyc({ location }) === true, `${location} is not read as New York City`);
  for (const location of ['Baltimore, MD 21201', 'Towson, MD 21204', 'Buffalo, NY 14201', 'Yonkers, NY 10701', 'Newark, NJ 07102', '', 'New York']) check(o, w.M.inNyc({ location }) === false, `"${location}" is read as New York City`);
  check(o, w.M.inNyc(null) === false && w.M.inNyc(undefined) === false && w.M.inNyc({}) === false, 'a project with no address is read as New York City');
  check(o, w.M.inNyc({ structuredAddress: { city: 'Brooklyn', state: 'NY', zip: '11201' } }) === true && w.M.inNyc({ structuredAddress: { city: 'Baltimore', state: 'MD', zip: '21201' } }) === false, 'a structured address is not read by the resolver');
  check(o, /buildClearanceCheck\(scan, tapePairs, \{ nyc: clearanceNyc \}\)/.test(flow), 'the place is not handed to the check');
  check(o, /const nyc = options\.nyc === true;/.test(stripComments(w.F['utils/roomScan/clearanceCore.ts'])), 'the check takes anything but a plain yes for New York City');
  // The two lines are named as that city's commonly cited figure, not confirmed.
  for (const r of w.M.refs.filter((x) => x.where === 'nyc_only')) check(o, r.family === 'nyc_cited' && /commonly cited for New York City/.test(w.M.familyWords[r.family]) && /not confirmed/.test(w.M.familyWords[r.family]), `${r.id} is not named as New York City's commonly cited, unconfirmed figure`);
  return o;
});

// ── B. the states ───────────────────────────────────────────────────────────
rule('B1 the boundaries: on the figure, the margin either side, a hair past it, well clear', (w) => {
  const o: string[] = [];
  const least: [number, CORE.ClearanceState][] = [
    [15, 'close'], [13.5, 'close'], [13.49, 'tight'], [16.5, 'close'], [16.51, 'roomy'], [14.2, 'close'], [15.9, 'close'], [30, 'roomy'], [5, 'tight'], [0, 'tight'],
  ];
  for (const [v, want] of least) check(o, w.M.state(v, 15, 'min', 1.5) === want, `a least of 15 with 1.5 either side: ${v} is ${w.M.state(v, 15, 'min', 1.5)}, not ${want}`);
  const most: [number, CORE.ClearanceState][] = [[44, 'close'], [45.5, 'close'], [45.51, 'tight'], [42.5, 'close'], [42.49, 'roomy'], [30, 'roomy'], [60, 'tight']];
  for (const [v, want] of most) check(o, w.M.state(v, 44, 'max', 1.5) === want, `a most of 44 with 1.5 either side: ${v} is ${w.M.state(v, 44, 'max', 1.5)}, not ${want}`);
  // The same through a real room: the toilet's centre line moved along the wall. The tub's edge is y = 66.
  //   y = 51 gives 15 (on the figure), 52.5 gives 13.5 (the margin under), 52.6 gives 13.4 (a hair past),
  //   49.5 gives 16.5 (the margin over), 49.4 gives 16.6 (a hair past), 40 gives 26 (well clear).
  const bath = tightBathSpec();
  const rows: [number, number, CORE.ClearanceState][] = [[51, 15, 'close'], [52.5, 13.5, 'close'], [52.6, 13.4, 'tight'], [49.5, 16.5, 'close'], [49.4, 16.6, 'roomy'], [40, 26, 'roomy']];
  for (const [y, value, want] of rows) {
    const objects = (bath.objects ?? []).filter((x) => x.category !== 'sink').map((x) => (x.category === 'toilet' ? { ...x, at: { x: 14 * IN, y: y * IN } } : x));
    const m = pick(w.M.build(fromSpec({ ...bath, objects })), { kind: 'toilet_side', toward: 'bathtub' });
    check(o, !!m && near(m.valueUS, value, 0.005) && m.state === want, `a toilet ${value} in from the tub reads ${m?.valueUS.toFixed(2)} ${m?.state}, not ${want}`);
  }
  return o;
});

rule('B2 a door is a plain number, a window is never roomy and never tight, and a window is compared only in a bedroom', (w) => {
  const o: string[] = [];
  for (let v = 0; v <= 80; v += 0.25) {
    const s = w.M.boundState(v, 32, 'min', 1.5);
    check(o, s === (v <= 33.5 + 1e-9 ? 'close' : null), `a size the scan can only see larger, ${v} in beside 32, is ${s}`);
  }
  for (const name of ['tight-bath', 'narrow-hall', 'bedroom-window', 'hallway', 'bathroom', 'bay-room', 'three-openings', 'l-shape']) {
    for (const m of [...w.M.build(scanOf(name)).measures, ...w.M.build(scanOf(name), [], NYC).measures]) {
      if (m.kind !== 'door_width' && !m.kind.startsWith('window_')) continue;
      check(o, m.boundOnly === true, `${name} ${m.kind} is not marked as something the scan can only see larger`);
      check(o, m.state === null || m.state === 'close', `${name} ${m.kind} is ${m.state}`);
      check(o, m.figures.every((f) => f.state === null || f.state === 'close'), `${name} ${m.kind} has a figure that is roomy or tight`);
      // No interior door is labelled: a 28 or 30 in bathroom door is ordinary, and a scan cannot tell which door is a home's main exit.
      if (m.kind === 'door_width') check(o, m.state === null && m.stateRefId === null && m.figures.length === 0, `${name}: a door is set beside ${m.figures.map((f) => f.refId).join() || 'nothing'} and reads ${m.state}`);
    }
  }
  // A 28 in bathroom door is a plain number, and the row says in words what the 32 in figure is about.
  check(o, pick(w.M.build(scanOf('tight-bath')), { kind: 'door_width' })?.state === null, 'a 28 in bathroom door is labelled');
  const hookB2 = stripComments(w.F[HOOK]);
  check(o, /case 'door_width': return \[\s*t\('office\.scanClearance\.note\.doorNote',[^\n]*\n\s*t\('office\.scanClearance\.note\.doorExitNote', [^\n]*mention\('door_clear_32'\)\),/.test(hookB2), 'a door row does not say to tape it with the door open, or what the main exit door figure is');
  check(o, /main exit door of a home/.test(String(w.EN['office.scanClearance.called.doorClearText'])) && /A scan cannot tell which door that is, so no door gets a label here\./.test(String(w.EN['office.scanClearance.note.doorExitNote'])), 'the door sentence no longer says a scan cannot tell which door is the main exit');
  // The same bedroom marked as a plain room: its window is set beside nothing.
  const plain = w.M.build({ ...scanOf('bedroom-window'), roomType: 'room' });
  check(o, !plain.measures.some((m) => m.kind.startsWith('window_')) && plain.leftOut.some((l) => l.kind === 'windows_not_bedroom'), 'a window is compared in a room that is not a bedroom');
  // The fixture's own window, 24 by 36: 6.0 sq ft is past 5.7, and 22.5 x 34.5 is not. Close.
  check(o, pick(w.M.build(scanOf('bedroom-window')), { kind: 'window_area' })?.state === 'close', 'a 24 by 36 window is past the area figure with no margin taken off');
  // A larger window, 30 by 40 with the sill at 30: 28.5 x 38.5 = 1097.25 sq in = 7.6 sq ft, past 5.7. Nothing is flagged, and nothing is called roomy.
  const spec = bedroomWindowSpec();
  const big = w.M.build(fromSpec({ ...spec, openings: (spec.openings ?? []).map((x) => (x.kind === 'window' ? { ...x, width: 30 * IN, height: 40 * IN, sill: 30 * IN } : x)) }));
  check(o, big.measures.filter((m) => m.kind.startsWith('window_')).length === 4 && big.measures.filter((m) => m.kind.startsWith('window_')).every((m) => m.state === null), 'a 30 by 40 window is flagged, or is called roomy');
  // A small one, 20 by 22: every row is 'close' at the most.
  const small = w.M.build(fromSpec({ ...spec, openings: (spec.openings ?? []).map((x) => (x.kind === 'window' ? { ...x, width: 20 * IN, height: 22 * IN, sill: 50 * IN } : x)) }));
  check(o, small.measures.filter((m) => m.kind.startsWith('window_')).every((m) => m.state === 'close'), 'a 20 by 22 window with a 50 in sill is not close on every row');
  return o;
});

rule('B3 a toilet\'s front is read against 21 alone, and beside two figures a row takes the state most worth a tape', (w) => {
  const o: string[] = [];
  const front = pick(w.M.build(scanOf('tight-bath')), { kind: 'toilet_front' });
  check(o, front?.state === 'close' && front.stateRefId === 'toilet_front_21' && front.figures.length === 1, `22 in front of a toilet is ${front?.state} by ${front?.stateRefId} beside ${front?.figures.map((f) => f.refId).join()}`);
  // 22.5 in (a cabinet 9.5 deep, its face at x = 50.5): the margin over 21, still close. 24 in (8 deep): past 22.5, roomy.
  // 19 in (a cabinet 13 deep, face at x = 47): under 19.5, tight.
  const bath = tightBathSpec();
  const frontAt = (faceX: number) => {
    const deep = 60 - faceX;
    const moved = (bath.objects ?? []).map((x) => (x.category === 'storage' ? { ...x, at: { x: (faceX + deep / 2) * IN, y: 52 * IN }, d: deep * IN } : x));
    return pick(w.M.build(fromSpec({ ...bath, objects: moved })), { kind: 'toilet_front' });
  };
  for (const [faceX, value, want] of [[50.5, 22.5, 'close'], [52, 24, 'roomy'], [47, 19, 'tight'], [49, 21, 'close']] as [number, number, CORE.ClearanceState][]) {
    const m = frontAt(faceX);
    check(o, near(m?.valueUS, value, 0.005) && m?.state === want && m.stateRefId === 'toilet_front_21', `${value} in front of a toilet is ${m?.valueUS} ${m?.state} by ${m?.stateRefId}`);
  }
  const refsOf = (scan: RoomScan, opt?: CORE.ClearanceOptions) => (pick(w.M.build(scan, [], opt), { kind: 'ceiling_low' })?.figures ?? []).map((f) => f.refId).join();
  check(o, refsOf(scanOf('tight-bath')) === 'ceiling_bath_80', `a bathroom ceiling is set beside ${refsOf(scanOf('tight-bath'))}`);
  check(o, refsOf(scanOf('narrow-hall')) === 'ceiling_84', `a hallway ceiling is set beside ${refsOf(scanOf('narrow-hall'))}`);
  check(o, refsOf(scanOf('bedroom-window')) === 'ceiling_84', `a bedroom ceiling is set beside ${refsOf(scanOf('bedroom-window'))}`);
  check(o, refsOf(scanOf('tight-bath'), NYC) === 'ceiling_bath_80,ceiling_bath_84_nyc' && refsOf(scanOf('bedroom-window'), NYC) === 'ceiling_84,ceiling_96', 'in New York City the ceiling is not set beside that city\'s line as well');
  // Two figures, two states: the row takes the one most worth a tape and names the figure that gave it.
  //   the bedroom in New York City, 96: roomy by 84, close by 96. Close, by the 96 in figure.
  const two = pick(w.M.build(scanOf('bedroom-window'), [], NYC), { kind: 'ceiling_low' });
  check(o, two?.state === 'close' && two.stateRefId === 'ceiling_96' && two.figures[0].state === 'roomy', `a New York City bedroom at 96 is ${two?.state} by ${two?.stateRefId}`);
  // Two figures, the same state: the one asking for more room is credited.
  //   the tight bathroom in New York City, 81: close by 80 (78.5 to 81.5) and tight by 84 (under 82.5). Tight, by the New York City figure.
  //   a New York City bathroom at 78: tight by both. Credited to the one asking for more, 84.
  const tb = pick(w.M.build(scanOf('tight-bath'), [], NYC), { kind: 'ceiling_low' });
  check(o, tb?.state === 'tight' && tb.stateRefId === 'ceiling_bath_84_nyc' && tb.figures[0].state === 'close', `a New York City bathroom at 81 is ${tb?.state} by ${tb?.stateRefId}`);
  const bscan = scanOf('tight-bath');
  const low78 = pick(w.M.build({ ...bscan, ceilingHeightM: { ...bscan.ceilingHeightM, min: 78 * IN } }, [], NYC), { kind: 'ceiling_low' });
  check(o, low78?.state === 'tight' && low78.figures.every((f) => f.state === 'tight') && low78.stateRefId === 'ceiling_bath_84_nyc', `a New York City bathroom at 78 is credited to ${low78?.stateRefId}`);
  // The lowest height the scan saw, not the typical one. 82 beside 84: under 82.5, tight.
  const scan = scanOf('bedroom-window');
  const low = pick(w.M.build({ ...scan, ceilingHeightM: { ...scan.ceilingHeightM, min: 82 * IN } }), { kind: 'ceiling_low' });
  check(o, near(low?.valueUS, 82, 0.005) && low?.state === 'tight' && low.stateRefId === 'ceiling_84', `a ceiling that drops to 82 in reads ${low?.valueUS} ${low?.state}`);
  return o;
});

// ── C. the margin ───────────────────────────────────────────────────────────
/** A taped wall for a history: the scan said `scanFt`, the tape read `diffIn` more. */
function pair(i: number, scanFt: number, diffIn: number): TapePair {
  const scannedM = scanFt / 3.28084;
  return { scanId: `hist-${i}`, wallId: `w-${i}`, scannedM, tapedM: scannedM + diffIn * IN, lengthClass: lengthClass(scannedM), deviceModel: 'iPhone16,1', roomType: 'room', at: AT };
}
const history = (diffs: number[]): TapePair[] => diffs.map((d, i) => pair(i, 8 + i, d));
const GOOD = history([0, 0.25, -0.25, 0.5, 0.25, 0.5]);
const WORSE = history([0.5, 1, -1, 2, 3, 0.25]);
const BAD = history([1, 2, 9, 4, 3, 5]);
const FEW = history([5, 5, 5, 5]);

rule('C1 the margin: 1.5 in by default, never less, wider with a worse tape history', (w) => {
  const o: string[] = [];
  const facts = (largestIn: number): TapeFacts => ({ enough: true, count: 6, withinCount: 3, withinIn: 1, typicalIn: 0.5, largestIn, farCount: 0, longCount: 1 });
  const m0 = w.M.margin(null);
  check(o, m0.scanIn === 1.5 && m0.tapedIn === 0.5 && m0.basis === 'scan_default' && m0.tapeCount === 0, `with no history the margin is ${JSON.stringify(m0)}`);
  check(o, w.M.margin({ enough: false, count: 4, needed: 5, farCount: 0 }).scanIn === 1.5, 'four taped walls change the margin');
  check(o, w.M.margin(facts(0.5)).scanIn === 1.5 && w.M.margin(facts(0.5)).basis === 'scan_default', 'a good history takes the margin under 1.5 in');
  check(o, w.M.margin(facts(1.5)).scanIn === 1.5, 'a history whose largest difference is 1.5 in changes the margin');
  check(o, w.M.margin(facts(3)).scanIn === 3 && w.M.margin(facts(3)).basis === 'tape_history' && w.M.margin(facts(3)).tapeCount === 6, 'a 3 in difference does not make the margin 3 in');
  check(o, w.M.margin(facts(9)).scanIn === CORE.MAX_MARGIN_IN && CORE.MAX_MARGIN_IN === 6, 'a 9 in difference is not held at the 6 in cap');
  for (const big of [1.75, 2, 4, 6, 20]) check(o, w.M.margin(facts(big)).tapedIn === 0.5 && w.M.margin(facts(big)).scanIn >= 1.5, `with ${big} in the taped margin moved or the scan margin fell`);
  check(o, CORE.DEFAULT_MARGIN_IN === 1.5 && CORE.TAPED_MARGIN_IN === 0.5, 'the default margins are not 1.5 in and 0.5 in');
  // Through the tight bathroom. The history WORSE has a largest difference of 3 in.
  //   toilet to the sink, 12.5: 15 - 3 = 12, so 12.5 is now CLOSE (it was TIGHT);
  //   in front of the toilet, 22: beside 21 with 3 either side, still CLOSE;
  //   in front of the sink, 40: still past 21 + 3, ROOMY.
  check(o, tapeFacts(WORSE).enough === true && (tapeFacts(WORSE) as { largestIn: number }).largestIn === 3, 'the fixture history does not have a largest difference of 3 in');
  const scan = scanOf('tight-bath');
  const worse = w.M.build(scan, WORSE);
  check(o, worse.margin.scanIn === 3 && worse.margin.basis === 'tape_history' && worse.margin.largestIn === 3 && worse.margin.tapeCount === 6, `the worse history gives ${JSON.stringify(worse.margin)}`);
  check(o, pick(worse, { kind: 'toilet_side', toward: 'sink' })?.state === 'close' && pick(worse, { kind: 'toilet_side', toward: 'sink' })?.marginIn === 3, 'a wider margin does not turn 12.5 in from tight to close');
  check(o, pick(worse, { kind: 'toilet_front' })?.state === 'close' && pick(worse, { kind: 'sink_front' })?.state === 'roomy', 'a wider margin gives the wrong states in front of the fixtures');
  check(o, pick(worse, { kind: 'toilet_side', toward: 'sink' })?.marginBasis === 'tape_history', 'the row does not say its margin came from his tape history');
  const good = w.M.build(scan, GOOD);
  check(o, good.margin.scanIn === 1.5 && pick(good, { kind: 'toilet_side', toward: 'sink' })?.state === 'tight', 'a good history changed the bathroom');
  check(o, w.M.build(scan, BAD).margin.scanIn === 6, 'a 9 in difference is not held at 6 in in a room');
  check(o, w.M.build(scan, FEW).margin.scanIn === 1.5 && w.M.build(scan, FEW).margin.basis === 'scan_default', 'four walls taped 5 in off widen the margin');
  // A wall taped at more than double the scan is a slip, not a difference.
  const slip = [...GOOD, { ...pair(9, 8, 0), tapedM: (8 / 3.28084) * 12 }];
  check(o, w.M.build(scan, slip).margin.scanIn === 1.5, 'a slip of the thumb widened the margin');
  check(o, w.M.build(scan).margin.scanIn === 1.5 && w.M.build(scan, []).margin.scanIn === 1.5, 'with no history handed in the margin is not 1.5 in');
  return o;
});

rule('C2 a number he taped uses the tighter margin, the row says so, and a taped wall never tightens a fixture', (w) => {
  const o: string[] = [];
  const hall = scanOf('narrow-hall');
  const end = hall.walls.find((x) => near(x.lengthM / IN, 37, 0.01));
  if (!end) return ['the narrow hallway has no 37 in end wall'];
  // As scanned: 37 beside 36 with 1.5 either side, CLOSE. He tapes the end wall at 37: the margin is 0.5, 37 is past 36.5, ROOMY.
  const taped = w.M.build(correctWallLength(hall, end.id, 37 * IN, AT));
  const p = pick(taped, { kind: 'passage_width' });
  check(o, !!p && p.restsOnTaped && p.marginIn === 0.5 && p.marginBasis === 'taped' && p.state === 'roomy' && near(p.valueUS, 37, 0.005), `a hallway whose end wall is taped at 37 in reads ${p?.valueUS} ${p?.state} margin ${p?.marginIn} taped ${p?.restsOnTaped}`);
  check(o, !!p && p.wallIds.includes(end.id), 'the row does not name the taped wall it rests on');
  check(o, taped.tapedCount === 1, `${taped.tapedCount} rows are said to rest on a taped number`);
  // Taped at 36.25: within 0.5 of 36, CLOSE. Taped at 35.25: under 35.5, TIGHT.
  check(o, pick(w.M.build(correctWallLength(hall, end.id, 36.25 * IN, AT)), { kind: 'passage_width' })?.state === 'close', 'a hallway taped at 36.25 in is not close');
  check(o, pick(w.M.build(correctWallLength(hall, end.id, 35.25 * IN, AT)), { kind: 'passage_width' })?.state === 'tight', 'a hallway taped at 35.25 in is not tight');
  // Taping a LONG wall says nothing about the width.
  const long = hall.walls.find((x) => near(x.lengthM / IN, 240, 0.01));
  const longTaped = long ? pick(w.M.build(correctWallLength(hall, long.id, 240.5 * IN, AT)), { kind: 'passage_width' }) : undefined;
  check(o, !!longTaped && !longTaped.restsOnTaped && longTaped.marginIn === 1.5, 'taping a long wall tightened the width between the walls');
  // A door he typed at 33: the row rests on a taped number and carries the taped margin, 0.5. The other door, still scanned at 30, keeps 1.5. Neither has a state.
  const door = hall.openings.find((x) => x.kind === 'door');
  if (!door) return [...o, 'the narrow hallway has no door'];
  const typedDoor = w.M.build(correctOpening(hall, door.id, 'widthM', 33 * IN, AT));
  const d1 = typedDoor.measures.find((m) => m.openingId === door.id);
  const d2 = typedDoor.measures.find((m) => m.kind === 'door_width' && m.openingId !== door.id);
  check(o, !!d1 && d1.restsOnTaped && d1.marginIn === 0.5 && d1.state === null, `a door typed at 33 in reads ${d1?.state} with margin ${d1?.marginIn}`);
  check(o, !!d2 && !d2.restsOnTaped && d2.marginIn === 1.5 && d2.state === null, 'the door he did not tape lost its scan margin');
  const spec = narrowHallSpec();
  // A ceiling he typed at 85 in a hallway: past 84.5, ROOMY with the taped margin. Scanned at 85 it is within 1.5: CLOSE.
  const typedCeiling = pick(w.M.build(correctCeilingHeight(hall, 85 * IN, AT)), { kind: 'ceiling_low' });
  check(o, !!typedCeiling && typedCeiling.restsOnTaped && typedCeiling.marginIn === 0.5 && typedCeiling.state === 'roomy', `a ceiling typed at 85 in reads ${typedCeiling?.state} with margin ${typedCeiling?.marginIn}`);
  const scanned85 = pick(w.M.build(fromSpec({ ...spec, walls: spec.walls.map((x) => ({ ...x, height: 85 * IN })) })), { kind: 'ceiling_low' });
  check(o, scanned85?.state === 'close' && scanned85.marginIn === 1.5, 'a ceiling scanned at 85 in is not close');
  // A worse history does not loosen a taped number, and does not tighten it.
  check(o, pick(w.M.build(correctWallLength(hall, end.id, 37 * IN, AT), WORSE), { kind: 'passage_width' })?.marginIn === 0.5, 'a worse history changed the margin of a taped number');
  // The bathroom with its left wall (the one the toilet and sink back onto) taped at its own length: the fixtures still use the scan margin.
  const bath = scanOf('tight-bath');
  const left = bath.walls.find((x) => near(x.lengthM / IN, 96, 0.01));
  if (!left) return [...o, 'the tight bathroom has no 96 in wall'];
  let allTaped = bath;
  for (const wall of bath.walls) allTaped = correctWallLength(allTaped, wall.id, wall.lengthM, AT);
  check(o, allTaped.walls.some((x) => x.lengthSource === 'typed'), 'the walls were not marked as typed');
  for (const m of w.M.build(allTaped).measures) {
    if (m.kind === 'toilet_side' || m.kind === 'toilet_front' || m.kind === 'sink_front') check(o, !m.restsOnTaped && m.marginIn === 1.5, `${m.kind} uses margin ${m.marginIn} beside a taped wall (a taped wall does not move a fixture)`);
  }
  // The screen says which rows rest on a taped number.
  const view = stripComments(w.F[VIEW]);
  check(o, /\{m\.restsOnTaped \? copy\.restsOnTapedSub : copy\.fromScanSub\}/.test(view), 'the row does not say whether it rests on a taped number');
  check(o, /check\.tapedCount > 0 && <Text[^>]*>\{copy\.tapedCountBody\(check\.tapedCount\)\}/.test(view) && /\{copy\.marginBody\(check\.margin\)\}/.test(view) && /\{copy\.tapedMarginBody\(check\.margin\)\}/.test(view), 'the screen does not state the margin, the taped margin and how many rows are taped');
  check(o, /Rests on a number you taped/.test(String(w.EN['office.scanClearance.restsOnTapedSub'])) && /does not move a toilet or a sink/.test(String(w.EN['office.scanClearance.tapedMarginBody'])), 'the taped sentences no longer say what a taped wall does and does not change');
  check(o, /your own tape has differed from a scan by as much as \{largest\} in/.test(forms(w.EN['office.scanClearance.marginHistoryBody']).join(' ')), 'the margin sentence no longer says it came from his own tape');
  return o;
});

// ── D. the figures ──────────────────────────────────────────────────────────
/** The figures, pinned. A changed number is a decision, made here too. */
const PINNED: Record<REFS.ClearanceRefId, [number, 'in' | 'sqft', 'min' | 'max', REFS.ClearanceFamily, REFS.ClearanceRef['use'], REFS.ClearanceRef['where']]> = {
  toilet_side_15: [15, 'in', 'min', 'residential_and_plumbing_model', 'compared', 'anywhere'],
  toilet_front_21: [21, 'in', 'min', 'residential_and_plumbing_model', 'compared', 'anywhere'],
  toilet_front_24: [24, 'in', 'min', 'other_plumbing', 'words_only', 'anywhere'],
  toilet_spacing_30: [30, 'in', 'min', 'residential_and_plumbing_model', 'words_only', 'anywhere'],
  sink_front_21: [21, 'in', 'min', 'residential_and_plumbing_model', 'compared', 'anywhere'],
  door_clear_32: [32, 'in', 'min', 'building_model', 'words_only', 'anywhere'],
  passage_36: [36, 'in', 'min', 'residential_model', 'compared', 'anywhere'],
  ceiling_84: [84, 'in', 'min', 'residential_model', 'compared', 'anywhere'],
  ceiling_bath_80: [80, 'in', 'min', 'residential_model', 'compared', 'anywhere'],
  ceiling_bath_84_nyc: [84, 'in', 'min', 'nyc_cited', 'compared', 'nyc_only'],
  ceiling_90: [90, 'in', 'min', 'several_homes', 'words_only', 'anywhere'],
  ceiling_96: [96, 'in', 'min', 'nyc_cited', 'compared', 'nyc_only'],
  escape_area_5_7: [5.7, 'sqft', 'min', 'residential_model', 'compared', 'anywhere'],
  escape_height_24: [24, 'in', 'min', 'residential_model', 'compared', 'anywhere'],
  escape_width_20: [20, 'in', 'min', 'residential_model', 'compared', 'anywhere'],
  escape_sill_44: [44, 'in', 'max', 'residential_model', 'compared', 'anywhere'],
};
const CALLED_KEY: Record<REFS.ClearanceRefId, string> = {
  toilet_side_15: 'toiletSideText', toilet_front_21: 'toiletFrontText', toilet_front_24: 'toiletFrontText', toilet_spacing_30: 'spacingText', sink_front_21: 'sinkFrontText',
  door_clear_32: 'doorClearText', passage_36: 'passageText', ceiling_84: 'ceilingText', ceiling_bath_80: 'ceilingBathText', ceiling_bath_84_nyc: 'ceilingBathText',
  ceiling_90: 'ceilingText', ceiling_96: 'ceilingText',
  escape_area_5_7: 'escapeAreaText', escape_height_24: 'escapeHeightText', escape_width_20: 'escapeWidthText', escape_sill_44: 'escapeSillText',
};
const FAMILY_KEY: Record<REFS.ClearanceFamily, string> = {
  residential_model: 'residentialModelText', residential_and_plumbing_model: 'residentialAndPlumbingModelText', other_plumbing: 'otherPlumbingText',
  building_model: 'buildingModelText', several_homes: 'severalHomesText', nyc_cited: 'nycCitedText',
};
/** The sentence each words-only figure is mentioned in. */
const MENTION_KEY: Partial<Record<REFS.ClearanceRefId, string>> = {
  toilet_front_24: 'frontOtherNote', toilet_spacing_30: 'spacingNote', door_clear_32: 'doorExitNote', ceiling_90: 'ceilingSeveralHomesNote',
};

rule('D1 one table: every figure has its number, its name and its family, and the screen uses the table', (w) => {
  const o: string[] = [];
  const ids = w.M.refs.map((r) => r.id);
  check(o, new Set(ids).size === ids.length, 'a figure is in the table twice');
  check(o, ids.slice().sort().join() === Object.keys(PINNED).sort().join(), `the table holds ${ids.join(', ')}`);
  for (const r of w.M.refs) {
    const pin = PINNED[r.id];
    if (!pin) continue;
    check(o, r.value === pin[0] && r.unit === pin[1] && r.bound === pin[2] && r.family === pin[3] && r.use === pin[4] && r.where === pin[5], `${r.id} is ${r.value} ${r.unit} ${r.bound} ${r.family} ${r.use} ${r.where}, pinned as ${pin.join(' ')}`);
    check(o, Number.isFinite(r.value) && r.value > 0, `${r.id} has no usable number`);
    check(o, typeof r.called === 'string' && r.called.length >= 10 && /^[a-z]/.test(r.called) && !/[.!?]$/.test(r.called), `${r.id} has no plain name: "${r.called}"`);
    check(o, typeof w.M.familyWords[r.family] === 'string' && w.M.familyWords[r.family].length > 5, `${r.id} has no family in plain words`);
    check(o, w.EN[`office.scanClearance.called.${CALLED_KEY[r.id]}`] === r.called, `${r.id}: the screen calls it "${String(w.EN[`office.scanClearance.called.${CALLED_KEY[r.id]}`])}", the table "${r.called}"`);
    check(o, w.EN[`office.scanClearance.family.${FAMILY_KEY[r.family]}`] === w.M.familyWords[r.family], `${r.id}: the screen's family words are not the table's`);
    check(o, typeof r.checked?.nyc === 'boolean' && typeof r.checked?.baltimore === 'boolean', `${r.id} does not say whether the repo's checked data confirms it for New York City and for Baltimore`);
  }
  // The core uses every COMPARED figure, only figures the table holds, and never a words-only one.
  const core = stripComments(w.F['utils/roomScan/clearanceCore.ts']);
  const used = new Set((core.match(/'(?:toilet|sink|door|passage|ceiling|escape)_[a-z0-9_]+'/g) ?? []).map((x) => x.slice(1, -1)).filter((x) => /_\d/.test(x)));
  for (const r of w.M.refs) {
    if (r.use === 'compared') check(o, used.has(r.id), `${r.id} is in the table to be compared and is never used`);
    else check(o, !used.has(r.id), `${r.id} is words only, and the core sets a distance beside it`);
  }
  for (const id of used) check(o, ids.includes(id as REFS.ClearanceRefId), `the core uses a figure the table does not hold: ${id}`);
  // No room, in any place, shows a words-only figure as a figure.
  for (const name of ['tight-bath', 'narrow-hall', 'bedroom-window', 'hallway', 'bathroom', 'three-openings', 'vanity-sink', 'toilet-front-22']) {
    for (const opt of [undefined, NYC]) for (const m of w.M.build(scanOf(name), [], opt).measures) for (const f of m.figures) {
      check(o, w.M.refs.find((r) => r.id === f.refId)?.use === 'compared', `${name}: ${m.kind} is set beside the words-only figure ${f.refId}`);
    }
  }
  // A words-only figure is mentioned in one sentence, with its number, name and family from the table.
  const hookD = stripComments(w.F[HOOK]);
  for (const r of w.M.refs.filter((x) => x.use === 'words_only')) {
    const key = MENTION_KEY[r.id];
    if (!key) { o.push(`${r.id} is words only and no sentence is pinned for it`); continue; }
    const en = String(w.EN[`office.scanClearance.note.${key}`] ?? '');
    check(o, new RegExp(`t\\('office\\.scanClearance\\.note\\.${key}', '[^\\n]*', mention\\('${r.id}'\\)\\)`).test(hookD), `${r.id} is not mentioned from the table in note.${key}`);
    check(o, placeholders(en) === '{called},{family},{value}', `note.${key} does not carry the figure's number, name and family: "${en}"`);
  }
  check(o, /const mention = \(refId: ClearanceRefId\): \{ value: string; called: string; family: string \} => \{\s*const r = clearanceRef\(refId\);\s*return \{ value: figureValue\(refId\), called: called\(refId\), family: family\(r\.family\) \};/.test(hookD), 'a mentioned figure is not read from the table');
  // The 24 in figure is said to be from a different family of plumbing code than New York and Maryland use.
  check(o, /different family of plumbing code than the one New York and Maryland use/.test(w.M.familyWords.other_plumbing), 'the 24 in figure is no longer said to come from a different family of plumbing code');
  // No figure is typed into a string: the number in a sentence is the table's.
  const hook = stripComments(w.F[HOOK]);
  check(o, /figureBody: \(refId\) => t\('office\.scanClearance\.figureBody', '\{value\}: \{called\}\. From \{family\}\.', \{ value: figureValue\(refId\), called: called\(refId\), family: family\(clearanceRef\(refId\)\.family\) \}\)/.test(hook), 'the figure sentence is not built from the table');
  check(o, /const r = clearanceRef\(refId\);/.test(hook) && /r\.value/.test(hook), 'the number shown is not read from the table');
  const typed = /(?<![\d.{])\b(?:15|20|21|24|30|32|36|44|80|84|90|96|5\.7)\b(?![\d}])/;
  for (const [k, v] of Object.entries(w.EN)) for (const f of forms(v)) if (typed.test(f)) o.push(`English ${k} types a figure into the words: "${f}"`);
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) if (typed.test(f)) o.push(`Spanish ${k} types a figure into the words`);
  check(o, w.M.review.professionalReview === 'none' ? /No architect or expediter has read it yet/.test(String(w.EN['office.scanClearance.starterBody'])) : true, 'the screen no longer says nobody has read the list');
  check(o, w.M.review.status === 'pending_founder_review' && w.M.review.professionalReview === 'none' && w.M.review.reviewedBy === null, `the table is marked ${JSON.stringify(w.M.review)}: it is still waiting on the founder, with no professional named`);
  return o;
});

rule('D2 no figure is called checked and no section number exists unless the checked data holds it', (w) => {
  const o: string[] = [];
  const rowText = (name: string): string | null => {
    const r = LOCAL_ADOPTIONS.find((e) => e.name === name);
    return r ? JSON.stringify(r) : null;
  };
  for (const r of w.M.refs) {
    if (r.checked.nyc || r.checked.baltimore) {
      const src = r.checkedSource;
      const text = src ? rowText(src.row) : null;
      if (!src || !text) { o.push(`${r.id} is called checked with no row of the repo's checked data named`); continue; }
      check(o, src.needle.includes(String(r.value)) && text.includes(src.needle), `${r.id} is called checked, and the number is not in the row it is credited to`);
      check(o, (src.place === 'nyc') === (src.row === 'New York City') && (r.checked[src.place] === true), `${r.id}: the checked place and its row do not agree`);
    } else {
      check(o, r.checkedSource === null, `${r.id} names a source and is not called checked`);
    }
    if (r.section) {
      const text = rowText(r.section.row);
      check(o, !!text && text.includes(r.section.label), `${r.id} carries the section "${r.section.label}", which is not in the repo's checked data`);
    }
  }
  // No section number in the words or in the code of the lane.
  const SECTION = /§|\b[A-Z]{1,3}\d{3,4}(?:\.\d+)*\b|\b\d{3,4}\.\d+(?:\.\d+)*\b|\bsection \d/i;
  for (const [k, v] of Object.entries(w.EN)) for (const f of forms(v)) if (SECTION.test(f)) o.push(`English ${k} writes a section number`);
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) if (SECTION.test(f) || /\bsecci[oó]n \d/i.test(f)) o.push(`Spanish ${k} writes a section number`);
  for (const f of LANE_FILES) if (SECTION.test(stripComments(w.F[f]))) o.push(`${f} holds a section number`);
  // Every figure on the screen is followed by the local sentence, with no condition on it.
  const view = stripComments(w.F[VIEW]);
  const block = view.slice(view.indexOf('{m.figures.map((f) => ('), view.indexOf('{notes.map('));
  check(o, /<Text style=\{styles\.factText\}>\{copy\.figureBody\(f\.refId\)\}<\/Text>\s*<Text style=\{styles\.note\}>\{copy\.figureLocalBody\}<\/Text>/.test(block), 'a figure is drawn without "A commonly used figure. Your local code may differ." straight after it');
  check(o, w.EN['office.scanClearance.figureLocalBody'] === 'A commonly used figure. Your local code may differ.', 'the local sentence is not "A commonly used figure. Your local code may differ."');
  check(o, w.ES['office.scanClearance.figureLocalBody']?.s === 'Una cifra de uso común. Tu código local puede ser distinto.', 'the Spanish local sentence changed');
  return o;
});

// ── W. the words ────────────────────────────────────────────────────────────
// The Code Flags list (scripts/validate-code-flags.ts BANNED_EN / BANNED_ES), and the words this lane was told never to use.
const BANNED_EN: readonly RegExp[] = [
  /\bcompliant\b/i, /\bcompliance\b/i, /\bcomplies\b/i, /\bcomply\b/i, /\bpass(?:es|ed|ing)?\b/i, /\bfail(?:s|ed|ing|ure)?\b/i,
  /\bmeets? (?:the )?code\b/i, /\bup to code\b/i, /\bto code\b/i, /\bapproved?\b/i, /\bapproval\b/i, /\brequire(?:d|s|ment|ments)?\b/i,
  /\bmandatory\b/i, /\bmust\b/i, /\bviolat/i, /\b(?:il)?legal(?:ly)?\b/i, /\bis fine\b/i, /\blooks? clear\b/i, /\ball clear\b/i,
  /\bguarantee/i, /\bsafe\b/i, /\ballowed\b/i, /\bnot allowed\b/i, /\bok\b/i, /\bokay\b/i,
];
const BANNED_ES: readonly RegExp[] = [
  /\bcumple/i, /\bconforme\b/i, /\bpasa\b/i, /\bpasó\b/i, /\baprobad[oa]s?\b/i, /\baprueba\b/i, /\baprobación\b/i, /\breprueba\b/i, /\breprobad/i,
  /\bexigid[oa]s?\b/i, /\bexige\b/i, /\brequerid[oa]s?\b/i, /\brequiere\b/i, /\brequisito/i, /\bobligatori[oa]s?\b/i, /\bdebe[ns]?\b/i,
  /\bviola/i, /\b(?:i)?legal(?:es|mente)?\b/i, /\bestá bien\b/i, /\ben regla\b/i, /\bgarantiza/i, /\bpermitid[oa]s?\b/i, /\bsegur[oa]s?\b/i, /\bse ve libre\b/i,
];
rule('W1 the forbidden words are in neither language', (w) => {
  const o: string[] = [];
  for (const [k, v] of Object.entries(w.EN)) for (const f of forms(v)) for (const re of BANNED_EN) if (re.test(f)) o.push(`English ${k}: ${re.source}`);
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) for (const re of BANNED_ES) if (re.test(f)) o.push(`Spanish ${k}: ${re.source}`);
  for (const f of [VIEW]) {
    const literals = stripComments(w.F[f]).match(/>[^<>{}]*[A-Za-z]{4,}[^<>{}]*</g) ?? [];
    for (const l of literals) if (!/=>|\?|:|;/.test(l)) o.push(`${f}: raw text on the screen: ${l.trim().slice(0, 60)}`);
  }
  // The state names in the code are not verdicts either.
  check(o, /export type ClearanceState = 'roomy' \| 'close' \| 'tight';/.test(w.F['utils/roomScan/clearanceCore.ts']), 'the three states are not roomy, close and tight');
  return o;
});

rule('W2 the sentences that must be there are there, in both languages, and are always drawn', (w) => {
  const o: string[] = [];
  const need: [string, RegExp, RegExp][] = [
    ['office.scanClearance.notCheckedBody', /^A measurement with no label has not been checked against anything\.$/, /^Una medida sin etiqueta no se ha comparado con nada\.$/],
    ['office.scanClearance.scanNoticeBody', /A phone scan can be off by an inch or more/, /puede fallar por una pulgada o más/],
    ['office.scanClearance.neverBlocksBody', /Nothing here stops you from saving, pricing or sending anything\./, /Nada de esto te impide guardar, poner precios ni enviar nada\./],
    ['office.scanClearance.neverClearedBody', /never clears a room/, /nunca da por bueno un cuarto/],
    ['office.scanClearance.introBody', /where to put a tape.*do not tell you what an inspector will say/, /dónde poner la cinta métrica.*No te dicen lo que dirá un inspector/],
    ['office.scanClearance.note.doorNote', /cannot tell the door from its frame opening.*clear width with the door open is less than this/, /no distingue la hoja del vano del marco.*ancho libre con la puerta abierta es menor/],
    ['office.scanClearance.note.windowNote', /net clear opening with the sash open.*A scan cannot see that.*only ever worth a closer look/, /abertura libre neta con la hoja abierta.*no puede ver eso.*solo llega a merecer una mirada más de cerca/],
    ['office.scanClearance.leftOut.stairsBody', /Stairs are not measured.*does not carry risers or treads/, /Las escaleras no se miden.*no trae contrahuellas ni huellas/],
    ['office.scanClearance.leftOut.stairsSeenBody', /one box, with no risers or treads.*not measured/, /una sola caja, sin contrahuellas ni huellas.*no se miden/],
    ['office.scanClearance.leftOut.tubBody', /a box, not an opening.*not measured/, /una caja, no como una abertura.*no se mide/],
    ['office.scanClearance.leftOut.doorBody', /clear width of a doorway with the door open is not measured/, /ancho libre de una puerta con la hoja abierta no se mide/],
    ['office.scanClearance.leftOut.windowBody', /net clear opening of a window with the sash open is not measured/, /abertura libre neta de una ventana con la hoja abierta no se mide/],
    ['office.scanClearance.noStateSub', /^Not checked against anything$/, /^No se comparó con nada$/],
    ['office.scanClearance.note.fixtureNote', /comes from the scan, even beside a wall you taped/, /sale del escaneo, aunque esté junto a una pared que mediste con cinta/],
    ['office.scanClearance.note.doorSwingNote', /^A door swinging into this space is not counted\.$/, /^No se cuenta una puerta que abra hacia este espacio\.$/],
    ['office.scanClearance.leftOut.fixtureFacingBody', /^MAGE cannot tell which way this fixture faces\. Tape it\.$/, /^MAGE no puede saber hacia dónde mira este mueble de baño\. Mídelo con cinta\.$/],
    ['office.scanClearance.leftOut.fixtureOverlapBody', /across something else, so it is not measured\. Tape it\./, /encima de otra cosa, así que no se mide\. Mídelo con cinta\./],
    ['office.scanClearance.note.doorExitNote', /A scan cannot tell which door that is, so no door gets a label here\./, /Un escaneo no sabe cuál puerta es esa, así que aquí ninguna puerta lleva etiqueta\./],
    ['office.scanClearance.note.windowStricterNote', /^This row never clears a window\. New York City commonly asks for more than these figures\.$/, /^Esta fila nunca da por buena una ventana\. La ciudad de Nueva York comúnmente pide más que estas cifras\.$/],
    ['office.scanClearance.note.cabinetFrontNote', /measured from the front of the cabinet/, /se mide desde el frente del gabinete/],
    ['office.scanClearance.note.sideNote', /shortest distance from the center line to anything beside the toilet, anywhere along its depth/, /distancia más corta del eje a lo que haya junto al inodoro/],
    ['office.scanClearance.state.roomyBody', /^Past the commonly used figure by more than the margin, as scanned\. Not checked against your local code\.$/, /^Supera la cifra de uso común por más del margen, según el escaneo\. No se comparó con tu código local\.$/],
  ];
  for (const [key, en, es] of need) {
    check(o, typeof w.EN[key] === 'string' && en.test(w.EN[key] as string), `English ${key} does not say it`);
    check(o, typeof w.ES[key]?.s === 'string' && es.test(w.ES[key]?.s as string), `Spanish ${key} does not say it`);
  }
  const view = stripComments(w.F[VIEW]);
  const lineOf = (needle: string): string => view.split('\n').find((l) => l.includes(needle)) ?? '';
  for (const needle of ['{copy.introBody}', '{copy.notCheckedBody}', '{copy.neverClearedBody} {copy.neverBlocksBody}', '{copy.starterBody}']) {
    check(o, lineOf(needle).trim().startsWith('<Text'), `${needle} is missing, or is drawn only sometimes`);
  }
  check(o, /<View style=\{styles\.blocked\} testID="scan-clearance-notice">\s*<Text style=\{styles\.blockedText\}>\{copy\.scanNoticeBody\}<\/Text>/.test(view), 'the sentence that a scan can be off by an inch or more is not at the top, or is drawn only sometimes');
  check(o, view.indexOf('{copy.scanNoticeBody}') < view.indexOf('check.measures.map('), 'the scan notice comes after the measurements');
  check(o, /const stateText = m\.state \? copy\.stateLabel\(m\.state\) : copy\.noStateSub;/.test(view), 'a row with no state does not say it was not checked against anything');
  check(o, /\{check\.leftOut\.map\(\(l\) => \(\s*<Text key=\{l\.kind\}[^>]*>\{copy\.leftOutBody\(l\)\}<\/Text>/.test(view), 'what is left out is not listed');
  check(o, /\{notes\.map\(\(note\) => <Text key=\{note\} style=\{styles\.note\}>\{note\}<\/Text>\)\}/.test(view) && /const notes = copy\.measureNotes\(m\);/.test(view), 'a row does not carry its own notes, every one of them');
  // Every door row carries the door note and every window row the window note.
  const hook = stripComments(w.F[HOOK]);
  check(o, /case 'door_width': return \[\s*t\('office\.scanClearance\.note\.doorNote'/.test(hook), 'a door row has no note saying the clear width is less');
  check(o, /default: return \[\s*t\('office\.scanClearance\.note\.windowNote',[^\n]*\n\s*t\('office\.scanClearance\.note\.windowStricterNote'/.test(hook), 'a window row has no note saying the scan cannot see the net clear opening, or that the row never clears a window');
  // A door's swing is not modelled, and BOTH front rows say so, every time.
  check(o, /const swing = t\('office\.scanClearance\.note\.doorSwingNote', 'A door swinging into this space is not counted\.'\);/.test(hook), 'the door swing sentence is gone');
  check(o, /case 'toilet_front': return \[\s*fixture, swing,/.test(hook) && /case 'sink_front': return \[\s*fixture, swing,/.test(hook), 'a row for the space in front does not say a door swinging into it is not counted');
  check(o, /\.\.\.\(m\.frontFrom === 'cabinet' \? \[t\('office\.scanClearance\.note\.cabinetFrontNote'/.test(hook), 'a sink measured from the front of its cabinet does not say so');
  // Stairs are always in the left-out list, seen or not.
  for (const name of ['tight-bath', 'narrow-hall', 'bedroom-window', 'hallway', 'missing-wall', 'toilet-corner-swapped']) {
    check(o, w.M.build(scanOf(name)).leftOut.some((l) => l.kind === 'stairs'), `${name}: the screen does not say stairs are not measured`);
  }
  return o;
});

rule('W3 every sentence is in the app\'s own words, is short, and never says how right a number is', (w) => {
  const o: string[] = [];
  const BAN_EN = /accura|\bexact|precis|perfect|survey[- ]grade|certif|error[- ]free|\bto the inch\b|\d\s*%|percent|confidence|confident/i;
  const BAN_ES = /exact[oa]|precis[oa]|precisi[oó]n|perfect[oa]|certific|sin errores|confianza|por ciento|\d\s*%/i;
  const all: [string, string, string][] = [];
  for (const [k, v] of Object.entries(w.EN)) for (const f of forms(v)) all.push(['English', k, f]);
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) all.push(['Spanish', k, f]);
  for (const [lang, k, f] of all) {
    const text = f.replace(/\{[a-zA-Z]+\}/g, 'x');
    if (/["“”«»]/.test(f)) o.push(`${lang} ${k} carries a quotation mark`);
    if (!passesProseCheck(text)) o.push(`${lang} ${k} would be withheld by the own-words gate`);
    if (longestRun(text) > 30) o.push(`${lang} ${k} has a run of ${longestRun(text)} words with no sentence break`);
    if ((lang === 'English' ? BAN_EN : BAN_ES).test(f)) o.push(`${lang} ${k} promises or scores how right a number is`);
  }
  return o;
});

rule('W4 house style, and the three state names', (w) => {
  const o: string[] = [];
  for (const [k, v] of Object.entries(w.EN)) {
    for (const f of forms(v)) {
      if (/Label$/.test(k)) {
        for (const word of f.replace(/\{\w+\}/g, '').split(/[\s,]+/).filter(Boolean)) if (/^[a-z]/.test(word)) o.push(`${k}: "${f}" has the word "${word}" in lower case`);
        if (/[.!?]$/.test(f)) o.push(`${k}: a label ends in punctuation`);
      }
      if (/(Body|Note)$/.test(k)) {
        if (!/[.]$/.test(f)) o.push(`${k}: "${f}" does not end with a period`);
        if (!/^(\{|[A-Z0-9])/.test(f)) o.push(`${k}: does not start with a capital`);
      }
      if (/Sub$/.test(k)) {
        if (/\.$/.test(f)) o.push(`${k}: a caption ends with a period`);
        if (!/^(\{|[A-Z0-9])/.test(f)) o.push(`${k}: a caption does not start with a capital`);
      }
      if (/Text$/.test(k) && (!/^[a-z]/.test(f) || /[.!?]$/.test(f))) o.push(`${k}: a fragment starts with a capital or ends a sentence`);
      if (!/(Label|Body|Note|Sub|Text)$/.test(k)) o.push(`${k}: the key does not say what kind of string it is`);
    }
  }
  const style = (k: string, f: string, lang: string) => {
    if (/[—–]/.test(f)) o.push(`${lang} ${k}: a dash used as punctuation`);
    if (/&/.test(f)) o.push(`${lang} ${k}: "&"`);
    if (/\be\.g\.|\bi\.e\.|\betc\./i.test(f)) o.push(`${lang} ${k}: "e.g.", "i.e." or "etc."`);
    if (/[←-⇿➡➔]|->|=>/.test(f)) o.push(`${lang} ${k}: an arrow`);
    if (/!/.test(f)) o.push(`${lang} ${k}: an exclamation mark`);
    if (/ - /.test(f)) o.push(`${lang} ${k}: a hyphen used as a dash`);
  };
  for (const [k, v] of Object.entries(w.EN)) for (const f of forms(v)) style(k, f, 'en');
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) style(k, f, 'es');
  const names: [string, string, string][] = [
    ['office.scanClearance.state.roomyLabel', 'Roomy', 'Holgado'],
    ['office.scanClearance.state.closeLabel', 'Close, Tape It', 'Al límite, mídelo con cinta'],
    ['office.scanClearance.state.tightLabel', 'Tight, Tape It And Check Your Local Code', 'Apretado, mídelo con cinta y revisa tu código local'],
    ['office.scanClearance.titleLabel', 'Clearance Check', 'Revisión de espacios libres'],
  ];
  for (const [k, en, es] of names) check(o, w.EN[k] === en && w.ES[k]?.s === es, `${k} reads "${String(w.EN[k])}" and "${String(w.ES[k]?.s)}"`);
  // What each state means is said in the words of its rule.
  check(o, w.EN['office.scanClearance.state.roomyBody'] === 'Past the commonly used figure by more than the margin, as scanned. Not checked against your local code.', 'roomy does not say which side of the figure it is on, or that it is not a check against the local code');
  check(o, /Within the margin of the commonly used figure, on either side of it\./.test(String(w.EN['office.scanClearance.state.closeBody'])) && /A window gets this label/.test(String(w.EN['office.scanClearance.state.closeBody'])) && !/door/i.test(String(w.EN['office.scanClearance.state.closeBody'])), 'close is not explained, does not say what it means on a window, or still speaks of a door');
  // "Justo" can read as "just right" in Spanish.
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) if (/\bjust[oa]s?\b/i.test(f)) o.push(`Spanish ${k} says "justo", which can read as "just right"`);
  check(o, /Short of the commonly used figure by more than the margin/.test(String(w.EN['office.scanClearance.state.tightBody'])), 'tight is not explained as short of the figure by more than the margin');
  // The look: no tick, no warning triangle, no green for roomy, no danger colour.
  const view = stripComments(w.F[VIEW]);
  check(o, !/\bCheck\b|CheckCircle|AlertTriangle|XCircle|ShieldCheck/.test(view.split('\n').filter((l) => l.startsWith('import')).join('\n')), 'the screen imports a tick, a cross or a warning triangle');
  check(o, !/success|danger/i.test(view), 'the screen uses a success or a danger colour');
  check(o, !/@expo\/vector-icons|react-native-reanimated/.test(view), 'the screen uses another icon set or reanimated');
  return o;
});

rule('W5 English and Spanish agree, and the surface is registered', (w) => {
  const o: string[] = [];
  const en = Object.keys(w.EN).sort();
  const es = Object.keys(w.ES).filter((k) => w.ES[k]).sort();
  for (const k of en) if (!es.includes(k)) o.push(`no Spanish for ${k}`);
  for (const k of es) if (!en.includes(k)) o.push(`Spanish for a key English does not have: ${k}`);
  for (const k of en) {
    const e = w.EN[k];
    const s = w.ES[k];
    if (!s) continue;
    if ((typeof e === 'string') !== (typeof s.s === 'string')) { o.push(`${k}: one language is plural and the other is not`); continue; }
    const sets = new Set([...forms(e), ...forms(s.s)].map(placeholders));
    if (typeof e === 'string' ? sets.size !== 1 : [...sets].some((p) => p.replace('{count}', '').replace(/^,|,$/g, '') !== [...sets][0].replace('{count}', '').replace(/^,|,$/g, ''))) o.push(`${k}: placeholders differ`);
    if (s.src !== sourceHash(e as never)) o.push(`${k}: the Spanish was translated from older English`);
    if (forms(s.s).some((x) => !x.trim())) o.push(`${k}: empty Spanish`);
  }
  check(o, en.length >= 80 && en.every((k) => k.startsWith('office.scanClearance.')), `the English shard has ${en.length} keys`);
  const s = SURFACES.find((x) => x.id === 'office.scan-clearance');
  check(o, !!s && s.state === 'complete' && s.keyPrefixes.join() === 'office.scanClearance.' && s.files.join() === HOOK, 'i18n/surfaces.ts does not list office.scan-clearance as complete with its one copy hook');
  check(o, (EN_SHARDS as Record<string, unknown>)['office.scan-clearance'] === (EN_REAL as unknown) && (ES_SHARDS as Record<string, unknown>)['office/scanClearance'] === (ES_REAL as unknown), 'the shards are not listed in EN_SHARDS and ES_SHARDS');
  const view = stripComments(w.F[VIEW]);
  check(o, !/\bt\(|\btn\(|useT\b/.test(view), 'the screen has strings of its own outside the copy hook');
  return o;
});

// ── N. the gate and the wiring ──────────────────────────────────────────────
rule('N1 it never blocks: no action depends on a state, the result holds no verdict, nothing outside reads it', (w) => {
  const o: string[] = [];
  const view = stripComments(w.F[VIEW]);
  const presses = view.match(/onPress=\{[^\n]*/g) ?? [];
  check(o, presses.length === 2 && presses.some((p) => p.startsWith('onPress={() => setChosenId(on ? null : m.id)}')) && presses.some((p) => p.startsWith('onPress={onOpenCodeCheck}')), `the screen has ${presses.length} press handlers, not "choose a row" and "open Code Check": ${presses.join(' | ').slice(0, 200)}`);
  check(o, (view.match(/<Button\b/g) ?? []).length === 1 && /<Button label=\{copy\.codeCheckLabel\} variant="secondary" onPress=\{onOpenCodeCheck\} testID="scan-clearance-code-check" \/>/.test(view), 'the one button is not the door to Code Check, with nothing depending on it');
  check(o, !/\bdisabled\b|\bloading=|\beditable\b|pointerEvents="box-none"/.test(view), 'something on the screen can be switched off');
  check(o, !/updateProject|saveScan|supabaseWrite|useRouter|router\.|Linking|AsyncStorage/.test(view), 'the screen writes, navigates or opens something itself');
  // A state is only ever turned into words and a tint.
  for (const line of view.split('\n').filter((l) => /\.state\b/.test(l) && !/accessibilityState/.test(l))) {
    check(o, /const stateText = m\.state \?|m\.state === 'close' \|\| m\.state === 'tight' \? \{ (backgroundColor|color): colors\.warning(Soft|Label) \} : null/.test(line), `a state is used for more than its words and its tint: ${line.trim().slice(0, 120)}`);
  }
  // In the flow, the check is worked out and handed to its own screen. Nothing else reads it.
  const flow = stripComments(w.F[FLOW]);
  const SAFE = [
    "'clearance'", 'const clearance = useMemo(() => (scan && clearanceOn ? buildClearanceCheck(scan, tapePairs, { nyc: clearanceNyc }) : null), [scan, clearanceOn, tapePairs, clearanceNyc]);',
    'const clearanceNyc = useMemo(() => clearanceInNyc(project), [project]);', "import { clearanceInNyc } from '@/utils/roomScan/clearancePlace';",
    'const clearanceOn = clearanceCheckAllowed(userEmail);', "import { clearanceCheckAllowed } from '@/utils/roomScan/clearanceAllowed';",
    "clearanceOn && scan && clearance && (", 'check={clearance}', 'clearance={clearanceOn ? { label: ccopy.openLabel, onPress: () => afterScanAck(() => setStep(', 'clearanceOn',
  ];
  for (const line of flow.split('\n')) {
    let rest = line;
    for (const s of SAFE) rest = rest.split(s).join('');
    if (/clearance/i.test(rest.replace(/ClearanceView|buildClearanceCheck|useScanClearanceCopy|clearanceCore|\.\/ClearanceView/g, ''))) o.push(`the flow reads the check somewhere else: ${line.trim().slice(0, 140)}`);
  }
  check(o, /onOpenCodeCheck=\{\(\) => router\.push\(codeCheckFromJobHref\(projectId\)\)\}/.test(flow), 'the door does not open the existing Code Check for this project');
  for (const fn of ['const save = useCallback', 'const confirmDraft = useCallback', 'const sendOrder = useCallback', 'const confirmDelete = useCallback']) {
    const at = flow.indexOf(fn);
    const body = at >= 0 ? flow.slice(at, flow.indexOf('\n  }, [', at)) : '';
    check(o, at >= 0 && !/clearance/i.test(body), `${fn.replace('const ', '').replace(' = useCallback', '')} reads the check`);
  }
  // The result: rows, the margin, what was left out and two counts. No verdict on the room.
  for (const name of ['tight-bath', 'bedroom-window', 'narrow-hall']) {
    const c = w.M.build(scanOf(name));
    check(o, Object.keys(c).sort().join() === 'comparedCount,leftOut,margin,measures,tapedCount', `${name}: the result carries ${Object.keys(c).sort().join()}`);
    for (const m of c.measures) {
      const flags = Object.entries(m).filter(([, v]) => typeof v === 'boolean').map(([k]) => k).sort().join();
      check(o, flags === 'boundOnly,restsOnTaped', `${name} ${m.kind}: the row carries the flags ${flags}`);
      check(o, m.state === null || ['roomy', 'close', 'tight'].includes(m.state), `${name} ${m.kind}: state ${String(m.state)}`);
    }
  }
  // Nothing outside the feature imports the lane.
  const names = /clearanceCore|clearanceRefs|ClearanceView|useScanClearanceCopy|buildClearanceCheck|clearanceAllowed|clearanceCheckAllowed|clearancePlace|clearanceInNyc/;
  for (const [f, text] of Object.entries(w.outside)) {
    if (f === 'i18n/surfaces.ts') continue;
    if (names.test(stripComments(text))) o.push(`${f} reads Clearance Check`);
  }
  const plan = stripComments(w.F[PLAN]);
  check(o, /\{p\.clearance && <Button label=\{p\.clearance\.label\} variant="secondary" onPress=\{p\.clearance\.onPress\} testID="scan-open-clearance" \/>\}/.test(plan) && !/clearanceCore|ClearanceState/.test(plan), 'the plan draws more than a door to the check');
  return o;
});

const GATE = 'utils/roomScan/clearanceAllowed.ts';
const READ_BY: REFS.ClearanceRefsReview = { status: 'professional_reviewed', professionalReview: 'architect_or_expediter', reviewedBy: 'A Named Architect' };
rule('N2 Clearance Check has its own gate: the owner always, anyone else only with its own switch on AND a named professional\'s read', (w) => {
  const o: string[] = [];
  const owner = (w.F['utils/owner.ts'].match(/'([^'\s]+@[^'\s]+)'/) ?? [])[1] ?? '';
  const pending = w.M.review;
  const others = ['someone@example.com', null, undefined, ''] as const;
  // Today: the switch is off and nobody has read the table.
  check(o, w.M.clearanceFlag === false && /^export const CLEARANCE_CHECK_ENABLED = false;$/m.test(w.F['constants/featureFlags.ts']), 'CLEARANCE_CHECK_ENABLED is not false');
  check(o, w.M.proRead(pending) === false, 'the table says a professional has read it');
  // The owner, every way round.
  for (const flag of [false, true]) for (const review of [pending, READ_BY]) check(o, !!owner && w.M.clearanceAllowed(flag, review, owner) === true, `the gate refuses the owner (switch ${flag}, read ${w.M.proRead(review)})`);
  // Anyone else: only with BOTH.
  for (const email of others) {
    check(o, w.M.clearanceAllowed(false, pending, email) === false, `switch off, table unread: ${String(email)} is let in`);
    check(o, w.M.clearanceAllowed(true, pending, email) === false, `switch on, table unread: ${String(email)} is let in`);
    check(o, w.M.clearanceAllowed(false, READ_BY, email) === false, `switch off, table read: ${String(email)} is let in`);
    check(o, w.M.clearanceAllowed(true, READ_BY, email) === true, `switch on, table read by a named professional: ${String(email)} is refused`);
    // A read with nobody named, or a name with no read, is not a read.
    check(o, w.M.clearanceAllowed(true, { ...READ_BY, reviewedBy: null }, email) === false && w.M.clearanceAllowed(true, { ...READ_BY, reviewedBy: '  ' }, email) === false, 'a read with nobody named opens the gate');
    check(o, w.M.clearanceAllowed(true, { ...READ_BY, status: 'pending_founder_review' }, email) === false && w.M.clearanceAllowed(true, { ...READ_BY, status: 'founder_reviewed' }, email) === false && w.M.clearanceAllowed(true, { ...READ_BY, professionalReview: 'none' }, email) === false, 'the founder\'s own read, or a name with no professional read, opens the gate');
  }
  check(o, w.M.proRead(READ_BY) === true && w.M.proRead({ ...READ_BY, reviewedBy: null }) === false && w.M.proRead({ ...READ_BY, professionalReview: 'none' }) === false && w.M.proRead({ ...READ_BY, status: 'founder_reviewed' }) === false, 'the table\'s own test of a professional read is wrong');
  // FLIPPING THE SCANNER'S SWITCH ALONE SHOWS IT TO NOBODY NEW. With the scanner on, the scanner's own gate lets a
  // stranger scan (w.M.allowed), and Clearance Check, with its switch and its review as they are today, still refuses.
  check(o, w.M.allowed(true, 'someone@example.com') === true, 'the scanner\'s own gate changed');
  for (const email of others) check(o, w.M.clearanceAllowed(w.M.clearanceFlag, w.M.review, email) === false, `with the scanner switched on, Clearance Check is shown to ${String(email)}`);
  const gate = stripComments(w.F[GATE]);
  check(o, !/SCAN_ROOM_ENABLED|scanRoomAllowed|roomScan\/allowed/.test(gate), 'the gate reads the scanner\'s switch');
  check(o, /if \(isOwner\(userEmail\)\) return true;\s*return flagOn === true && clearanceRefsProfessionallyRead\(review\);/.test(gate), 'the gate is not "the owner, or its own switch and a named professional\'s read"');
  check(o, /return clearanceCheckAllowedWith\(CLEARANCE_CHECK_ENABLED, CLEARANCE_REFS_REVIEW, userEmail\);/.test(gate), 'the gate does not read its own switch and the table\'s review record');
  for (const i of gate.match(/from '([^']+)'/g) ?? []) check(o, /^from '@\/(constants\/featureFlags|utils\/owner|utils\/roomScan\/clearanceRefs)'$/.test(i), `the gate imports ${i}`);
  // The review record is READ (it was once written and read by nothing).
  const refsFile = stripComments(w.F['utils/roomScan/clearanceRefs.ts']);
  check(o, /return review\.status === 'professional_reviewed'\s*&& review\.professionalReview === 'architect_or_expediter'\s*&& typeof review\.reviewedBy === 'string' && review\.reviewedBy\.trim\(\)\.length > 0;/.test(refsFile), 'a professional read no longer needs the status, the kind of professional and a name');
  // The flow asks this gate and no other, with the signed-in email.
  const flow = stripComments(w.F[FLOW]);
  check(o, /const clearanceOn = clearanceCheckAllowed\(userEmail\);/.test(flow) && /import \{ clearanceCheckAllowed \} from '@\/utils\/roomScan\/clearanceAllowed';/.test(flow), 'the flow does not ask Clearance Check\'s own gate, with the signed-in email');
  check(o, !/scanRoomAllowed/.test(flow), 'the flow asks the scanner\'s gate');
  check(o, /const clearance = useMemo\(\(\) => \(scan && clearanceOn \? buildClearanceCheck\(scan, tapePairs, \{ nyc: clearanceNyc \}\) : null\)/.test(flow), 'the check is worked out for someone the gate refuses');
  check(o, /\{step === 'clearance' && clearanceOn && scan && clearance && \(\s*<ClearanceView/.test(flow), 'the screen is drawn without asking the gate');
  check(o, /clearance=\{clearanceOn \? \{ label: ccopy\.openLabel, onPress: \(\) => afterScanAck\(\(\) => setStep\('clearance'\)\) \} : undefined\}/.test(flow), 'the door on the plan is handed over without asking the gate');
  check(o, (flow.match(/setStep\('clearance'\)/g) ?? []).length === 1, 'there is a second way into the step');
  check(o, !/SCAN_ROOM_ENABLED|CLEARANCE_CHECK_ENABLED|CLEARANCE_REFS_REVIEW|isOwner\b|OWNER_EMAILS/.test(flow) && !/SCAN_ROOM_ENABLED|CLEARANCE_CHECK_ENABLED|isOwner\b|scanRoomAllowed|clearanceCheckAllowed/.test(stripComments(w.F[VIEW])), 'the flow or the screen reads a switch or the owner list itself');
  // Nothing else reads the switch.
  for (const [f, text] of Object.entries(w.outside)) if (f !== 'constants/featureFlags.ts' && /CLEARANCE_CHECK_ENABLED/.test(stripComments(text))) o.push(`${f} reads CLEARANCE_CHECK_ENABLED`);
  // The scanner's own gate is as it was: the route still turns away someone it refuses.
  check(o, /if \(!scanRoomAllowed\(userEmail\)\) return <Redirect href="[^"]+" \/>;/.test(stripComments(w.F['app/scan-room.tsx'])), 'the route does not redirect someone the scanner\'s gate refuses');
  check(o, /return flagOn === true \|\| isOwner\(userEmail\);/.test(stripComments(w.F['utils/roomScan/allowed.ts'])), 'the scanner\'s gate is not "the flag, or the owner"');
  return o;
});

rule('N3 no model call, no network, no storage and no clock in the lane', (w) => {
  const o: string[] = [];
  for (const f of CORE_FILES) {
    const s = stripComments(w.F[f]);
    const imports = s.match(/from '([^']+)'/g) ?? [];
    for (const i of imports) check(o, /^from '\.\/(clearanceRefs|learnCore|units|types)'$/.test(i), `${f} imports ${i}`);
    check(o, !/\bfetch\(|XMLHttpRequest|WebSocket|supabase|AsyncStorage|SecureStore|Date\.now|new Date|Math\.random|console\.|process\.env|require\(/.test(s), `${f} reaches outside itself`);
  }
  for (const f of [VIEW, HOOK]) {
    const s = stripComments(w.F[f]);
    check(o, !/\bfetch\(|XMLHttpRequest|supabase|functions\.invoke|aiService|gemini|anthropic|openai|AsyncStorage|SecureStore|expo-file-system|expo-sharing/i.test(s), `${f} calls a model, the network or the phone's storage`);
    for (const i of s.match(/from '([^']+)'/g) ?? []) {
      check(o, /^from '(react|react-native|react-native-svg|lucide-react-native|@\/contexts\/(ThemeContext|LanguageContext)|@\/hooks\/(useThemedStyles|useScanClearanceCopy)|@\/components\/ui|@\/utils\/roomScan\/(clearanceCore|clearanceRefs|geometryCore|types|units)|\.\/styles)'$/.test(i), `${f} imports ${i}`);
    }
  }
  return o;
});

rule('N4 it is registered: the script, the ship-check chain, the pinned count and the smoke suite', (w) => {
  const o: string[] = [];
  let pkg: { scripts?: Record<string, string> } = {};
  try { pkg = JSON.parse(w.F['package.json']); } catch { return ['package.json is not JSON']; }
  const scripts = pkg.scripts ?? {};
  check(o, scripts['test:scan-clearance'] === 'bun run scripts/validate-scan-clearance.ts', 'package.json has no test:scan-clearance script');
  const chain = (scripts['ship-check'] ?? '').split('&&').map((x) => x.trim()).filter(Boolean);
  check(o, chain.filter((x) => x === 'bun run test:scan-clearance').length === 1, 'the ship-check chain does not run test:scan-clearance exactly once');
  check(o, chain.includes('bun run test:scan-room') && chain.includes('bun run test:scan-order') && chain.includes('bun run test:ios-space-paths') && chain.includes('bun run test:code-flags'), 'the chain lost one of the checks this lane leans on');
  const name = (w.F[GATE_YML].match(/name: ship-check — (\d+) checks \((\d+) validators, typecheck, lint, jest\)/) ?? []).slice(1).map(Number);
  check(o, name.length === 2 && name[0] === chain.length && name[1] === chain.length - 3, `the gate reports ${name.join(' and ')}, and the chain has ${chain.length} links`);
  const smoke = w.F[SMOKE];
  for (const id of ['SC1', 'SC2', 'SC3', 'SC4', 'SC5', 'SC6', 'SC7', 'SC8']) check(o, new RegExp(`it\\('${id} `).test(smoke), `the smoke suite has no ${id}`);
  check(o, /tight-bath/.test(smoke) && /scan-open-clearance/.test(smoke) && /someone@example\.com/.test(smoke), 'the smoke suite does not mount the tight bathroom, for the owner and for someone else');
  return o;
});

rule('N5 the first real scan is blocked on the box axes', (w) => {
  const o: string[] = [];
  const doc = w.F['docs/scan-the-room-native-checklist.md'];
  const at = doc.indexOf('BLOCKING: which box axis is depth');
  check(o, at >= 0, 'the checklist has no blocking item for which box axis is depth');
  const item = at >= 0 ? doc.slice(at, at + 2400) : '';
  check(o, /a real toilet/.test(item) && /a real sink/.test(item), 'the item does not name a real toilet and a real sink');
  check(o, /Scan Facts|the scan's own summary/.test(item) && /correct the convention/i.test(item), 'the item does not say to correct the convention from the scan\'s own summary');
  check(o, /utils\/roomScan\/clearanceCore\.ts/.test(item) && /CLEARANCE_CHECK_ENABLED/.test(item), 'the item does not name the code it blocks');
  return o;
});

// ── run the rules on the real tree ──────────────────────────────────────────
let pass = 0;
let fail = 0;
console.log('validate-scan-clearance');
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
const esText = (key: string, value: string) => (w: World): World => {
  const cur = w.ES[key];
  if (!cur) throw new Error(`no Spanish key ${key}`);
  return { ...w, ES: { ...w.ES, [key]: { ...cur, s: value } } };
};
/** A copy of the check with its rows changed. */
const rows = (fn: (m: CORE.ClearanceMeasure, scan: RoomScan) => CORE.ClearanceMeasure | null) => mod((m) => ({
  build: (scan, pairs, opt) => { const c = m.build(scan, pairs, opt); return { ...c, measures: c.measures.map((x) => fn(x, scan)).filter((x): x is CORE.ClearanceMeasure => !!x) }; },
}));
const result = (fn: (c: CORE.ClearanceCheck, scan: RoomScan) => CORE.ClearanceCheck) => mod((m) => ({ build: (scan, pairs, opt) => fn(m.build(scan, pairs, opt), scan) }));
const refs = (fn: (r: REFS.ClearanceRef) => REFS.ClearanceRef) => mod((m) => ({ refs: m.refs.map(fn) }));
const restate = (m: CORE.ClearanceMeasure, state: CORE.ClearanceState | null): CORE.ClearanceMeasure => ({ ...m, state, figures: m.figures.map((f) => ({ ...f, state })) });
const PKG = 'package.json';
const CORE_F = 'utils/roomScan/clearanceCore.ts';

const MUTATIONS: Mutation[] = [
  // ── A ──
  { rule: 'A1', what: 'the toilet is measured from the edge of its box, not its centre line', plant: rows((m) => (m.kind === 'toilet_side' ? { ...m, valueUS: m.valueUS - 7.5, value: m.value - 7.5 * IN } : m)) },
  { rule: 'A1', what: 'the cabinet in front of the toilet is not seen (the front runs to the wall)', plant: rows((m) => (m.kind === 'toilet_front' ? { ...m, valueUS: 32, value: 32 * IN } : m)) },
  { rule: 'A1', what: 'the front is measured from the centre of the toilet, not the front of its box', plant: rows((m) => (m.kind === 'toilet_front' ? { ...m, valueUS: m.valueUS + 14, value: m.value + 14 * IN } : m)) },
  { rule: 'A1', what: 'a 12.5 in side distance is called close', plant: rows((m) => (m.kind === 'toilet_side' && m.valueUS < 13 ? restate(m, 'close') : m)) },
  { rule: 'A1', what: 'the front of the toilet is read against the 24 in figure again (22 in reads tight)', plant: rows((m) => (m.kind === 'toilet_front' ? { ...m, state: 'tight', stateRefId: 'toilet_front_24', figures: [...m.figures, { refId: 'toilet_front_24', state: 'tight' }] } : m)) },
  { rule: 'A1', what: 'the 28 in bathroom door is labelled close again', plant: rows((m) => (m.kind === 'door_width' ? { ...m, state: 'close', stateRefId: 'door_clear_32', figures: [{ refId: 'door_clear_32', state: 'close' }] } : m)) },
  { rule: 'A1', what: 'a bathroom is called a hallway', plant: rows((m) => (m.kind === 'passage_width' ? { ...m, state: 'roomy', stateRefId: 'passage_36', figures: [{ refId: 'passage_36', state: 'roomy' }] } : m)) },
  { rule: 'A1', what: 'the sink row is dropped', plant: rows((m) => (m.kind === 'sink_front' ? null : m)) },
  { rule: 'A1', what: 'the tub opening is no longer said to be left out', plant: result((c) => ({ ...c, leftOut: c.leftOut.filter((l) => l.kind !== 'tub_opening') })) },
  { rule: 'A2', what: 'the hallway width is the longer pair of walls', plant: rows((m) => (m.kind === 'passage_width' ? { ...m, valueUS: 240, value: 240 * IN } : m)) },
  { rule: 'A2', what: 'a stair is given a row', plant: result((c, scan) => (scan.objects.some((x) => x.category === 'stairs') ? { ...c, measures: [...c.measures, { ...c.measures[0], id: 'stairs:1', kind: 'stair_riser' as never }] } : c)) },
  { rule: 'A2', what: 'a stair box is not said to be left out', plant: result((c) => ({ ...c, leftOut: c.leftOut.map((l) => (l.kind === 'stairs' ? { ...l, count: 0 } : l)) })) },
  { rule: 'A2', what: 'a hallway ceiling is set beside the 8 ft figure', plant: rows((m) => (m.kind === 'ceiling_low' && m.figures.length === 1 && m.figures[0].refId === 'ceiling_84' ? { ...m, state: 'close', stateRefId: 'ceiling_96', figures: [...m.figures, { refId: 'ceiling_96', state: 'close' }] } : m)) },
  { rule: 'A3', what: 'the window area is taken as roomy', plant: rows((m) => (m.kind === 'window_area' ? restate(m, null) : m)) },
  { rule: 'A3', what: 'the sill is measured from the top of the window', plant: rows((m) => (m.kind === 'window_sill' ? { ...m, valueUS: m.valueUS + 36, value: m.value + 36 * IN } : m)) },
  { rule: 'A3', what: 'the window area is in square inches', plant: rows((m) => (m.kind === 'window_area' ? { ...m, valueUS: m.valueUS * 144 } : m)) },
  { rule: 'A3', what: 'a 36 in door is called roomy', plant: rows((m) => (m.kind === 'door_width' && m.valueUS > 35 ? restate({ ...m, stateRefId: 'door_clear_32' }, 'roomy') : m)) },
  { rule: 'A4', what: 'a 42 in hallway is called close', plant: rows((m) => (m.kind === 'passage_width' && near(m.valueUS, 42, 0.01) ? restate(m, 'close') : m)) },
  { rule: 'A4', what: 'the cased opening is measured as a third door', plant: result((c, scan) => (scan.openings.some((x) => x.kind === 'opening') ? { ...c, measures: [...c.measures, { ...c.measures[0], id: 'door:x:width', index: 3 }] } : c)) },
  { rule: 'A5', what: 'the room is measured in the phone\'s axes, not its own (a turned room reads differently)', plant: rows((m, scan) => (m.kind === 'passage_width' && Math.abs(scan.walls[0].b.y - scan.walls[0].a.y) > 0.3 && Math.abs(scan.walls[0].b.x - scan.walls[0].a.x) > 0.3 ? { ...m, valueUS: m.valueUS * 1.05, value: m.value * 1.05 } : m)) },
  { rule: 'A5', what: 'the line drawn for a toilet side stops short', plant: rows((m) => (m.kind === 'toilet_side' && m.line ? { ...m, line: { a: m.line.a, b: { x: (m.line.a.x + m.line.b.x) / 2, y: (m.line.a.y + m.line.b.y) / 2 } } } : m)) },
  { rule: 'A5', what: 'the ceiling is given a line on the plan', plant: rows((m) => (m.kind === 'ceiling_low' ? { ...m, line: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } } : m)) },
  { rule: 'A6', what: 'a toilet standing free is measured anyway', plant: result((c, scan) => {
    const t = scan.objects.find((x) => x.category === 'toilet');
    if (!t || c.measures.some((m) => m.kind === 'toilet_side')) return c;
    return { ...c, measures: [...c.measures, { ...c.measures[0], id: 't', kind: 'toilet_side', index: 1 }], leftOut: c.leftOut.filter((l) => l.kind !== 'fixture_free') };
  }) },
  { rule: 'A6', what: 'a chair counts as something in the way', plant: rows((m, scan) => (m.kind === 'toilet_front' && scan.objects.some((x) => x.category === 'chair') ? { ...m, valueUS: 7, value: 7 * IN } : m)) },
  { rule: 'A6', what: 'only the centre line is looked along in front', plant: rows((m, scan) => (m.kind === 'toilet_front' && scan.objects.some((x) => x.category === 'storage' && near(x.widthM / IN, 8, 0.01)) ? { ...m, valueUS: 32, value: 32 * IN } : m)) },
  { rule: 'A6', what: 'only the centre and a quarter of the width either side are looked along (the outer edge is missed)', plant: rows((m, scan) => (m.kind === 'toilet_front' && scan.objects.some((x) => x.category === 'storage' && near(x.widthM / IN, 6, 0.01)) ? { ...m, valueUS: 32, value: 32 * IN, toward: { kind: 'wall', wallId: 'w', label: 'Wall 2' } } : m)) },
  { rule: 'A6', what: 'the lines in front run past the edges of the box', plant: rows((m, scan) => (m.kind === 'toilet_front' && scan.objects.some((x) => x.category === 'storage' && near(x.widthM / IN, 6, 0.01)) ? { ...m, valueUS: 22, value: 22 * IN, toward: { kind: 'object', objectId: 'o', category: 'storage' } } : m)) },
  { rule: 'A6', what: 'a ceiling that is not a number is given a row', plant: result((c, scan) => (Number.isFinite(scan.ceilingHeightM.min) ? c : { ...c, measures: [...c.measures, { ...c.measures[0], id: 'ceiling:lowest', kind: 'ceiling_low', value: scan.ceilingHeightM.min, valueUS: scan.ceilingHeightM.min / IN }] })) },
  { rule: 'A6', what: 'an open outline is given a narrowest width', plant: result((c, scan) => (scan.closure.closed ? c : { ...c, measures: [...c.measures, { ...c.measures[0], id: 'passage:narrowest', kind: 'passage_width', index: 1 }] })) },
  { rule: 'A6', what: 'a bathroom window is set beside the escape figures', plant: result((c, scan) => (scan.roomType === 'bathroom' && scan.openings.some((x) => x.kind === 'window') ? { ...c, measures: [...c.measures, { ...c.measures[0], id: 'w', kind: 'window_area', index: 1 }] } : c)) },
  // ── B ──
  { rule: 'B1', what: 'on the figure is called roomy', plant: mod((m) => ({ state: (v, l, b, mg) => (Math.abs(v - l) < 1e-9 ? 'roomy' : m.state(v, l, b, mg)) })) },
  { rule: 'B1', what: 'exactly the margin under is called tight', plant: mod((m) => ({ state: (v, l, b, mg) => (b === 'min' && Math.abs(l - mg - v) < 1e-9 ? 'tight' : m.state(v, l, b, mg)) })) },
  { rule: 'B1', what: 'the margin over is only half as wide', plant: mod((m) => ({ state: (v, l, b, mg) => (b === 'min' && v > l + mg / 2 ? 'roomy' : m.state(v, l, b, mg)) })) },
  { rule: 'B1', what: 'a "most" is read as a "least"', plant: mod((m) => ({ state: (v, l, _b, mg) => m.state(v, l, 'min', mg) })) },
  { rule: 'B1', what: 'anything under the figure is tight (no margin under)', plant: mod((m) => ({ state: (v, l, b, mg) => (b === 'min' && v < l ? 'tight' : m.state(v, l, b, mg)) })) },
  { rule: 'B1', what: 'in a real room 13.5 in is tight', plant: rows((m) => (m.kind === 'toilet_side' && near(m.valueUS, 13.5, 0.005) ? restate(m, 'tight') : m)) },
  { rule: 'B1', what: 'in a real room 16.6 in is close', plant: rows((m) => (m.kind === 'toilet_side' && near(m.valueUS, 16.6, 0.005) ? restate(m, 'close') : m)) },
  { rule: 'B2', what: 'a wide door is called roomy', plant: mod(() => ({ boundState: (v, l, b, mg) => CORE.clearanceState(v, l, b, mg) as 'close' | null })) },
  { rule: 'B2', what: 'a door is set beside the 32 in figure again', plant: rows((m) => (m.kind === 'door_width' && m.valueUS < 33.5 ? { ...m, state: 'close', stateRefId: 'door_clear_32', figures: [{ refId: 'door_clear_32', state: 'close' }] } : m)) },
  { rule: 'B2', what: 'a wide door carries the figure with no state', plant: rows((m) => (m.kind === 'door_width' ? { ...m, figures: [{ refId: 'door_clear_32', state: null }] } : m)) },
  { rule: 'B2', what: 'the door row stops saying what the main exit door figure is', plant: text(HOOK, "t('office.scanClearance.note.doorExitNote', ", "t('office.scanClearance.note.doorOtherNote', ") },
  { rule: 'B2', what: 'a narrow door is called tight in a room', plant: rows((m) => (m.kind === 'door_width' && m.valueUS < 30.4 ? restate(m, 'tight') : m)) },
  { rule: 'B2', what: 'a big window is called roomy', plant: rows((m) => (m.kind === 'window_height' && m.valueUS > 39 ? restate(m, 'roomy') : m)) },
  { rule: 'B2', what: 'a window is compared in a plain room', plant: result((c, scan) => (scan.roomType === 'room' && scan.openings.some((x) => x.kind === 'window') && scan.walls.length === 4 && near(scan.walls[0].lengthM / IN, 120, 1) ? { ...c, measures: [...c.measures, { ...c.measures[0], id: 'w', kind: 'window_area', boundOnly: true, state: 'close' }] } : c)) },
  { rule: 'B2', what: 'the window area forgets the margin', plant: rows((m) => (m.kind === 'window_area' && near(m.valueUS, 6, 0.01) ? restate(m, null) : m)) },
  { rule: 'B2', what: 'a door row is not marked as larger than the clear width', plant: rows((m) => (m.kind === 'door_width' ? { ...m, boundOnly: false } : m)) },
  { rule: 'B3', what: 'a row takes the gentler of two states', plant: rows((m) => (m.kind === 'ceiling_low' && m.figures.length === 2 && m.figures[0].state !== m.figures[1].state ? { ...m, state: m.figures[0].state, stateRefId: m.figures[0].refId } : m)) },
  { rule: 'B3', what: 'the figure asking for less room is credited', plant: rows((m) => (m.kind === 'ceiling_low' && m.figures.length === 2 && m.figures.every((f) => f.state === 'tight') ? { ...m, stateRefId: m.figures[0].refId } : m)) },
  { rule: 'B3', what: 'the front of a toilet is read against 24 in as well', plant: rows((m) => (m.kind === 'toilet_front' ? { ...m, figures: [...m.figures, { refId: 'toilet_front_24', state: CORE.clearanceState(m.valueUS, 24, 'min', m.marginIn) }] } : m)) },
  { rule: 'B3', what: '22 in front of a toilet reads tight', plant: rows((m) => (m.kind === 'toilet_front' && near(m.valueUS, 22, 0.01) ? restate(m, 'tight') : m)) },
  { rule: 'B3', what: 'in New York City the ceiling keeps the model figure alone', plant: mod((m) => ({ build: (scan, pairs) => m.build(scan, pairs, {}) })) },
  { rule: 'B3', what: 'a bathroom ceiling is set beside the room figures', plant: rows((m, scan) => (m.kind === 'ceiling_low' && scan.roomType === 'bathroom' ? { ...m, figures: [{ refId: 'ceiling_84', state: 'tight' }, { refId: 'ceiling_96', state: 'tight' }] } : m)) },
  { rule: 'B3', what: 'the typical ceiling height is used, not the lowest', plant: mod((m) => ({ build: (scan, pairs, opt) => m.build({ ...scan, ceilingHeightM: { ...scan.ceilingHeightM, min: scan.ceilingHeightM.typical } }, pairs, opt) })) },
  // ── C ──
  { rule: 'C1', what: 'the default margin is 1 in', plant: mod((m) => ({ margin: (t) => { const x = m.margin(t); return x.basis === 'scan_default' ? { ...x, scanIn: 1 } : x; } })) },
  { rule: 'C1', what: 'a good history takes the margin down to its largest difference', plant: mod((m) => ({ margin: (t) => (t && t.enough ? { ...m.margin(t), scanIn: t.largestIn } : m.margin(t)) })) },
  { rule: 'C1', what: 'a worse history does not widen the margin', plant: mod((m) => ({ margin: () => m.margin(null) })) },
  { rule: 'C1', what: 'there is no cap on the margin', plant: mod((m) => ({ margin: (t) => (t && t.enough && t.largestIn > 6 ? { ...m.margin(t), scanIn: t.largestIn } : m.margin(t)) })) },
  { rule: 'C1', what: 'the typical difference is used, not the largest', plant: mod((m) => ({ margin: (t) => (t && t.enough ? m.margin({ ...t, largestIn: t.typicalIn }) : m.margin(t)) })) },
  { rule: 'C1', what: 'in a room the history is ignored', plant: mod((m) => ({ build: (scan, _pairs, opt) => m.build(scan, [], opt) })) },
  { rule: 'C1', what: 'four walls are enough to widen the margin', plant: mod((m) => ({ build: (scan, pairs, opt) => { const c = m.build(scan, pairs, opt); return pairs && pairs.length === 4 ? { ...c, margin: { ...c.margin, scanIn: 5, basis: 'tape_history' as const } } : c; } })) },
  { rule: 'C1', what: 'a wider margin is stated and not used', plant: mod((m) => ({ build: (scan, pairs, opt) => ({ ...m.build(scan, [], opt), margin: m.build(scan, pairs, opt).margin }) })) },
  { rule: 'C2', what: 'a taped hallway keeps the scan margin', plant: rows((m) => (m.kind === 'passage_width' && m.restsOnTaped ? { ...m, marginIn: 1.5, marginBasis: 'scan_default', state: CORE.clearanceState(m.valueUS, 36, 'min', 1.5) } : m)) },
  { rule: 'C2', what: 'a taped hallway is not marked', plant: rows((m) => (m.kind === 'passage_width' ? { ...m, restsOnTaped: false } : m)) },
  { rule: 'C2', what: 'any taped wall tightens the hallway', plant: mod((m) => ({ build: (scan, pairs, opt) => { const c = m.build(scan, pairs, opt); return scan.walls.some((x) => x.lengthSource === 'typed') ? { ...c, measures: c.measures.map((x) => (x.kind === 'passage_width' ? { ...x, restsOnTaped: true, marginIn: 0.5 } : x)) } : c; } })) },
  { rule: 'C2', what: 'a taped wall tightens the toilet beside it', plant: mod((m) => ({ build: (scan, pairs, opt) => { const c = m.build(scan, pairs, opt); return scan.walls.some((x) => x.lengthSource === 'typed') ? { ...c, measures: c.measures.map((x) => (x.kind === 'toilet_side' ? { ...x, restsOnTaped: true, marginIn: 0.5 } : x)) } : c; } })) },
  { rule: 'C2', what: 'a typed door keeps the scan margin', plant: rows((m) => (m.kind === 'door_width' && m.restsOnTaped ? { ...m, marginIn: 1.5, state: 'close' } : m)) },
  { rule: 'C2', what: 'a typed ceiling is not marked', plant: rows((m) => (m.kind === 'ceiling_low' ? { ...m, restsOnTaped: false } : m)) },
  { rule: 'C2', what: 'a worse history widens a taped number', plant: mod((m) => ({ build: (scan, pairs, opt) => { const c = m.build(scan, pairs, opt); return { ...c, measures: c.measures.map((x) => (x.restsOnTaped ? { ...x, marginIn: c.margin.scanIn } : x)) }; } })) },
  { rule: 'C2', what: 'the row stops saying whether it rests on a taped number', plant: text(VIEW, '{m.restsOnTaped ? copy.restsOnTapedSub : copy.fromScanSub}', '{copy.fromScanSub}') },
  { rule: 'C2', what: 'the screen stops stating the margin', plant: text(VIEW, '{copy.marginBody(check.margin)}', '{null}') },
  // ── D ──
  { rule: 'D1', what: 'the toilet side figure becomes 12 in', plant: refs((r) => (r.id === 'toilet_side_15' ? { ...r, value: 12 } : r)) },
  { rule: 'D1', what: 'the sill figure becomes a least', plant: refs((r) => (r.id === 'escape_sill_44' ? { ...r, bound: 'min' } : r)) },
  { rule: 'D1', what: 'a figure loses its name', plant: refs((r) => (r.id === 'passage_36' ? { ...r, called: '' } : r)) },
  { rule: 'D1', what: 'a figure is added that nothing pinned', plant: mod((m) => ({ refs: [...m.refs, { ...m.refs[0], id: 'stair_riser_7_75' as never, value: 7.75 }] })) },
  { rule: 'D1', what: 'the screen calls a figure something the table does not', plant: en('office.scanClearance.called.passageText', 'legal width of a hallway') },
  { rule: 'D1', what: 'the family words on the screen drift from the table', plant: en('office.scanClearance.family.otherPlumbingText', 'the plumbing code') },
  { rule: 'D1', what: 'a figure is typed into a sentence', plant: en('office.scanClearance.note.passageNote', 'Between walls only. A hallway is commonly 36 in wide.') },
  { rule: 'D1', what: 'a figure is typed into the Spanish', plant: esText('office.scanClearance.note.passageNote', 'Solo entre paredes. Un pasillo suele medir 36 in.') },
  { rule: 'D1', what: 'the figure sentence types its own number', plant: text(HOOK, "{ value: figureValue(refId), called: called(refId), family: family(clearanceRef(refId).family) }", "{ value: '21 in', called: called(refId), family: family(clearanceRef(refId).family) }") },
  { rule: 'D1', what: 'the core uses a figure the table does not hold', plant: text(CORE_F, "refs: ['toilet_side_15']", "refs: ['toilet_side_18']") },
  { rule: 'D1', what: 'the 24 in figure is compared again', plant: refs((r) => (r.id === 'toilet_front_24' ? { ...r, use: 'compared' } : r)) },
  { rule: 'D1', what: 'the door figure is compared again', plant: refs((r) => (r.id === 'door_clear_32' ? { ...r, use: 'compared' } : r)) },
  { rule: 'D1', what: 'the 8 ft figure is used everywhere again', plant: refs((r) => (r.id === 'ceiling_96' ? { ...r, where: 'anywhere', family: 'residential_model' } : r)) },
  { rule: 'D1', what: 'the core sets a distance beside a words-only figure', plant: text(CORE_F, "refs: o.category === 'toilet' ? ['toilet_front_21'] : ['sink_front_21']", "refs: o.category === 'toilet' ? ['toilet_front_21', 'toilet_front_24'] : ['sink_front_21']") },
  { rule: 'D1', what: 'a room shows a words-only figure as a figure', plant: rows((m) => (m.kind === 'sink_front' ? { ...m, figures: [...m.figures, { refId: 'toilet_spacing_30', state: 'roomy' }] } : m)) },
  { rule: 'D1', what: 'the 24 in sentence types its own number', plant: en('office.scanClearance.note.frontOtherNote', 'Some places use more for {called}. That figure is from {family}.') },
  { rule: 'D1', what: 'the spacing figure is mentioned from somewhere other than the table', plant: text(HOOK, "mention('toilet_spacing_30')", "{ value: 'more', called: 'two fixtures', family: 'a code' }") },
  { rule: 'D1', what: 'the table is marked as read by a professional with the screen still saying nobody has', plant: mod((m) => ({ review: { ...m.review, status: 'professional_reviewed' } })) },
  { rule: 'D2', what: 'a figure is called checked for New York City with no source', plant: refs((r) => (r.id === 'toilet_side_15' ? { ...r, checked: { nyc: true, baltimore: false } } : r)) },
  { rule: 'D2', what: 'a figure is called checked for Baltimore against a row that does not hold it', plant: refs((r) => (r.id === 'passage_36' ? { ...r, checked: { nyc: false, baltimore: true }, checkedSource: { place: 'baltimore', row: 'Baltimore City', needle: '36 inches' } } : r)) },
  { rule: 'D2', what: 'a section number is written from recall', plant: refs((r) => (r.id === 'toilet_side_15' ? { ...r, section: { label: 'R307.1', row: 'New York City' } } : r)) },
  { rule: 'D2', what: 'a section number is typed into the words', plant: en('office.scanClearance.note.fixtureNote', 'See R307.1 for where a fixture sits.') },
  { rule: 'D2', what: 'a section sign is typed into the Spanish', plant: esText('office.scanClearance.note.fixtureNote', 'Ve la § 405.3.1.') },
  { rule: 'D2', what: 'the core holds a section number', plant: text(CORE_F, "export const DEFAULT_MARGIN_IN = 1.5;", "export const DEFAULT_MARGIN_IN = 1.5;\nexport const SOURCE = 'IRC R307.1';") },
  { rule: 'D2', what: 'the local sentence is dropped from the figures', plant: text(VIEW, '<Text style={styles.note}>{copy.figureLocalBody}</Text>', '') },
  { rule: 'D2', what: 'the local sentence is shown only for some figures', plant: text(VIEW, '<Text style={styles.note}>{copy.figureLocalBody}</Text>', "{f.state ? <Text style={styles.note}>{copy.figureLocalBody}</Text> : null}") },
  { rule: 'D2', what: 'the local sentence is reworded', plant: en('office.scanClearance.figureLocalBody', 'The figure your code uses.') },
  // ── W ──
  { rule: 'W1', what: 'a state is named "Looks Clear"', plant: en('office.scanClearance.state.roomyLabel', 'Looks Clear') },
  { rule: 'W1', what: 'English says a distance passes', plant: en('office.scanClearance.state.roomyBody', 'This distance passes, as scanned.') },
  { rule: 'W1', what: 'English says "fails"', plant: en('office.scanClearance.state.tightBody', 'This distance fails, as scanned.') },
  { rule: 'W1', what: 'English says "required"', plant: en('office.scanClearance.called.passageText', 'required width of a hallway') },
  { rule: 'W1', what: 'English says "meets code"', plant: en('office.scanClearance.neverClearedBody', 'This check never says a room meets code.') },
  { rule: 'W1', what: 'English says "violation"', plant: en('office.scanClearance.state.tightLabel', 'Possible Violation') },
  { rule: 'W1', what: 'English says "legal"', plant: en('office.scanClearance.called.ceilingText', 'legal ceiling height') },
  { rule: 'W1', what: 'English says "compliant"', plant: en('office.scanClearance.state.roomyLabel', 'Compliant') },
  { rule: 'W1', what: 'English says "approved"', plant: en('office.scanClearance.starterBody', 'This list is approved.') },
  { rule: 'W1', what: 'Spanish says "cumple"', plant: esText('office.scanClearance.state.roomyLabel', 'Cumple') },
  { rule: 'W1', what: 'Spanish says "aprobado"', plant: esText('office.scanClearance.state.roomyBody', 'Aprobado según el escaneo.') },
  { rule: 'W1', what: 'Spanish says "requerido"', plant: esText('office.scanClearance.called.passageText', 'ancho requerido de un pasillo') },
  { rule: 'W1', what: 'Spanish says "legal"', plant: esText('office.scanClearance.called.ceilingText', 'altura legal del techo') },
  { rule: 'W1', what: 'Spanish says "pasa"', plant: esText('office.scanClearance.state.roomyBody', 'Esta medida pasa.') },
  { rule: 'W1', what: 'Spanish says "viola"', plant: esText('office.scanClearance.state.tightBody', 'Esta medida viola el código.') },
  { rule: 'W1', what: 'raw words are typed on the screen', plant: text(VIEW, '<Text style={styles.note}>{copy.tapBody}</Text>', '<Text style={styles.note}>Everything else looks clear</Text>') },
  { rule: 'W1', what: 'a state is renamed "pass" in the code', plant: text(CORE_F, "export type ClearanceState = 'roomy' | 'close' | 'tight';", "export type ClearanceState = 'pass' | 'close' | 'fail';") },
  { rule: 'W2', what: 'the not-checked sentence is softened', plant: en('office.scanClearance.notCheckedBody', 'A measurement with no label is probably fine.') },
  { rule: 'W2', what: 'the Spanish not-checked sentence is dropped', plant: esText('office.scanClearance.notCheckedBody', 'Una medida sin etiqueta no necesita nada.') },
  { rule: 'W2', what: 'the screen stops showing the not-checked sentence', plant: text(VIEW, '{copy.notCheckedBody}', '{null}') },
  { rule: 'W2', what: 'the not-checked sentence is shown only when a row has no label', plant: text(VIEW, '<Text style={styles.para} testID="scan-clearance-not-checked">{copy.notCheckedBody}</Text>', '{check.comparedCount < check.measures.length && <Text style={styles.para}>{copy.notCheckedBody}</Text>}') },
  { rule: 'W2', what: 'the scan notice no longer says an inch or more', plant: en('office.scanClearance.scanNoticeBody', 'Tape anything that matters before you build to it.') },
  { rule: 'W2', what: 'the scan notice moves under the measurements', plant: text(VIEW, /<View style=\{styles\.blocked\} testID="scan-clearance-notice">\s*<Text style=\{styles\.blockedText\}>\{copy\.scanNoticeBody\}<\/Text>\s*<\/View>/, '') },
  { rule: 'W2', what: 'the never-blocks sentence goes', plant: text(VIEW, '{copy.neverClearedBody} {copy.neverBlocksBody}', '{copy.neverClearedBody}') },
  { rule: 'W2', what: 'the door note stops saying the clear width is less', plant: en('office.scanClearance.note.doorNote', 'This is the width of the door.') },
  { rule: 'W2', what: 'the window note stops saying the scan cannot see the net clear opening', plant: en('office.scanClearance.note.windowNote', 'This is the size of the window opening.') },
  { rule: 'W2', what: 'a door row loses its note', plant: text(HOOK, "t('office.scanClearance.note.doorNote', ", "t('office.scanClearance.note.doorWidthNote', ") },
  { rule: 'W2', what: 'the toilet front row stops saying a door swing is not counted', plant: text(HOOK, /case 'toilet_front': return \[\s*fixture, swing,/, "case 'toilet_front': return [\n            fixture,") },
  { rule: 'W2', what: 'the sink front row stops saying a door swing is not counted', plant: text(HOOK, /case 'sink_front': return \[\s*fixture, swing,/, "case 'sink_front': return [\n            fixture,") },
  { rule: 'W2', what: 'the door swing sentence is reworded to sound counted', plant: en('office.scanClearance.note.doorSwingNote', 'A door swinging into this space is counted.') },
  { rule: 'W2', what: 'the Spanish door swing sentence is dropped', plant: esText('office.scanClearance.note.doorSwingNote', 'Sin nota.') },
  { rule: 'W2', what: 'only the first note of a row is drawn', plant: text(VIEW, '{notes.map((note) => <Text key={note} style={styles.note}>{note}</Text>)}', '{notes[0] && <Text style={styles.note}>{notes[0]}</Text>}') },
  { rule: 'W2', what: 'the sentence for a fixture that is not labelled is softened', plant: en('office.scanClearance.leftOut.fixtureFacingBody', 'This fixture is probably fine.') },
  { rule: 'W2', what: 'the window row stops saying it never clears a window', plant: en('office.scanClearance.note.windowStricterNote', 'New York City commonly asks for more than these figures.') },
  { rule: 'W2', what: 'roomy stops saying it is not a check against the local code', plant: en('office.scanClearance.state.roomyBody', 'Past the commonly used figure by more than the margin, as scanned.') },
  { rule: 'W2', what: 'a row with no state shows an empty pill', plant: text(VIEW, 'const stateText = m.state ? copy.stateLabel(m.state) : copy.noStateSub;', "const stateText = m.state ? copy.stateLabel(m.state) : '';") },
  { rule: 'W2', what: 'stairs are dropped from what is left out when none is seen', plant: result((c) => ({ ...c, leftOut: c.leftOut.filter((l) => l.kind !== 'stairs' || l.count > 0) })) },
  { rule: 'W2', what: 'what is left out is no longer listed', plant: text(VIEW, '{copy.leftOutBody(l)}', '{null}') },
  { rule: 'W3', what: 'a sentence quotes a code book', plant: en('office.scanClearance.note.fixtureNote', 'The code says "fixtures shall be spaced". Tape it.') },
  { rule: 'W3', what: 'a sentence reads like code text', plant: en('office.scanClearance.note.passageNote', 'The minimum width of a hallway shall be not less than the width specified herein.') },
  { rule: 'W3', what: 'the screen says the scan is accurate', plant: en('office.scanClearance.introBody', 'These distances are accurate to the scan.') },
  { rule: 'W3', what: 'the Spanish says "exacto"', plant: esText('office.scanClearance.fromScanSub', 'Exacto, del escaneo') },
  { rule: 'W3', what: 'a state is given as a score', plant: en('office.scanClearance.state.roomyBody', 'Roomy with 95% confidence.') },
  { rule: 'W4', what: 'a label goes to sentence case', plant: en('office.scanClearance.openLabel', 'See the clearance check') },
  { rule: 'W4', what: 'a state name ends with a period', plant: en('office.scanClearance.state.closeLabel', 'Close. Tape It.') },
  { rule: 'W4', what: 'a sentence loses its period', plant: en('office.scanClearance.tapBody', 'Tap a measurement to see it drawn on the plan') },
  { rule: 'W4', what: 'an em dash', plant: en('office.scanClearance.tapBody', 'Tap a measurement — it is drawn on the plan.') },
  { rule: 'W4', what: 'an ampersand in Spanish', plant: esText('office.scanClearance.titleLabel', 'Revisión & espacios') },
  { rule: 'W4', what: '"e.g."', plant: en('office.scanClearance.note.passageNote', 'Between walls only. Furniture, e.g. a sofa, is not counted.') },
  { rule: 'W4', what: 'the tight state is renamed', plant: en('office.scanClearance.state.tightLabel', 'Too Tight') },
  { rule: 'W4', what: 'the close state stops saying what it means on a door', plant: en('office.scanClearance.state.closeBody', 'Within the margin of the commonly used figure, on either side of it.') },
  { rule: 'W4', what: 'the Spanish for close goes back to "Justo"', plant: esText('office.scanClearance.state.closeLabel', 'Justo, mídelo con cinta') },
  { rule: 'W4', what: 'roomy goes back to "further from the figure"', plant: en('office.scanClearance.state.roomyBody', 'Further from the commonly used figure than the margin, as scanned.') },
  { rule: 'W4', what: 'roomy is drawn in green', plant: text(VIEW, "m.state === 'close' || m.state === 'tight' ? { backgroundColor: colors.warningSoft } : null", "m.state === 'roomy' ? { backgroundColor: colors.successSoft } : null") },
  { rule: 'W4', what: 'a tick is drawn', plant: text(VIEW, "import { Ruler } from 'lucide-react-native';", "import { Check, Ruler } from 'lucide-react-native';") },
  { rule: 'W5', what: 'a key has no Spanish', plant: es('office.scanClearance.notCheckedBody', undefined) },
  { rule: 'W5', what: 'the Spanish drops a placeholder', plant: esText('office.scanClearance.marginDefaultBody', 'El margen es fijo.') },
  { rule: 'W5', what: 'the English changed under the Spanish', plant: en('office.scanClearance.tapBody', 'Tap a row to see it drawn on the plan.') },
  { rule: 'W5', what: 'the screen keeps a string of its own', plant: text(VIEW, "import { makeRoomScanStyles } from './styles';", "import { makeRoomScanStyles } from './styles';\nimport { useT } from '@/contexts/LanguageContext';") },
  // ── N ──
  { rule: 'N1', what: 'the Code Check door is switched off by a state', plant: text(VIEW, 'onPress={onOpenCodeCheck} testID="scan-clearance-code-check" />', 'onPress={onOpenCodeCheck} disabled={check.measures.some((m) => m.state === \'tight\')} testID="scan-clearance-code-check" />') },
  { rule: 'N1', what: 'a second button appears', plant: text(VIEW, '<Text style={styles.note}>{copy.starterBody}</Text>', '<Text style={styles.note}>{copy.starterBody}</Text>\n      <Button label={copy.titleLabel} onPress={() => setChosenId(null)} />') },
  { rule: 'N1', what: 'the flow holds pricing back on a tight row', plant: text(FLOW, "            onNext={() => setStep('quantities')}\n            clearance=", "            onNext={() => { if (!clearance?.measures.some((m) => m.state === 'tight')) setStep('quantities'); }}\n            clearance=") },
  { rule: 'N1', what: 'a save reads the check', plant: text(FLOW, "    if (!saved.scan.name.trim()) { setSaveState('needsName'); return; }", "    if (!saved.scan.name.trim()) { setSaveState('needsName'); return; }\n    if (clearance && clearance.comparedCount < 0) return;") },
  { rule: 'N1', what: 'the result says the room is all clear', plant: result((c) => ({ ...c, allClear: c.measures.every((m) => m.state !== 'tight') } as CORE.ClearanceCheck)) },
  { rule: 'N1', what: 'a row carries a "blocks" flag', plant: rows((m) => ({ ...m, blocks: m.state === 'tight' } as CORE.ClearanceMeasure)) },
  { rule: 'N1', what: 'a fourth state appears', plant: rows((m) => (m.kind === 'ceiling_low' ? { ...m, state: 'fail' as never } : m)) },
  { rule: 'N1', what: 'a state hides a row', plant: text(VIEW, 'const stateText = m.state ? copy.stateLabel(m.state) : copy.noStateSub;', "const stateText = m.state ? copy.stateLabel(m.state) : copy.noStateSub;\n          if (m.state === 'roomy' && chosenId === 'x') return null;") },
  { rule: 'N1', what: 'the estimate screen reads the check', plant: (w) => ({ ...w, outside: { ...w.outside, 'app/change-order.tsx': `${w.outside['app/change-order.tsx'] ?? ''}\nimport { buildClearanceCheck } from '@/utils/roomScan/clearanceCore';` } }) },
  { rule: 'N1', what: 'the plan colours itself from the check', plant: text(PLAN, "import { makeRoomScanStyles } from './styles';", "import { makeRoomScanStyles } from './styles';\nimport type { ClearanceState } from '@/utils/roomScan/clearanceCore';") },
  { rule: 'N1', what: 'the door opens somewhere else', plant: text(FLOW, 'onOpenCodeCheck={() => router.push(codeCheckFromJobHref(projectId))}', "onOpenCodeCheck={() => router.push('/paywall')}") },
  { rule: 'N2', what: 'Clearance Check rides on the scanner\'s switch (flip the scanner, everyone sees it)', plant: mod((m) => ({ clearanceAllowed: (_f, _r, e) => m.allowed(true, e) })) },
  { rule: 'N2', what: 'its own switch alone opens the gate, with the table unread', plant: mod((m) => ({ clearanceAllowed: (f, r, e) => f === true || m.clearanceAllowed(f, r, e) })) },
  { rule: 'N2', what: 'a professional\'s read alone opens the gate, with the switch off', plant: mod((m) => ({ clearanceAllowed: (f, r, e) => m.proRead(r) || m.clearanceAllowed(f, r, e) })) },
  { rule: 'N2', what: 'the gate refuses the owner', plant: mod((m) => ({ clearanceAllowed: (f, r) => f === true && m.proRead(r) })) },
  { rule: 'N2', what: 'the gate lets everyone in', plant: mod(() => ({ clearanceAllowed: () => true })) },
  { rule: 'N2', what: 'the gate never opens for anyone else', plant: mod((m) => ({ clearanceAllowed: (_f, r, e) => m.clearanceAllowed(false, r, e) })) },
  { rule: 'N2', what: 'a read with nobody named counts', plant: mod((m) => ({ clearanceAllowed: (f, r, e) => m.clearanceAllowed(f, { ...r, reviewedBy: r.reviewedBy && r.reviewedBy.trim() ? r.reviewedBy : 'someone' }, e) })) },
  { rule: 'N2', what: 'the founder\'s own read counts as a professional\'s', plant: mod((m) => ({ clearanceAllowed: (f, r, e) => m.clearanceAllowed(f, { ...r, status: r.status === 'founder_reviewed' ? 'professional_reviewed' : r.status }, e) })) },
  { rule: 'N2', what: 'the switch is turned on', plant: mod(() => ({ clearanceFlag: true })) },
  { rule: 'N2', what: 'the table is marked as read by a named professional', plant: mod(() => ({ review: READ_BY })) },
  { rule: 'N2', what: 'the gate reads the scanner\'s switch', plant: text(GATE, "import { CLEARANCE_CHECK_ENABLED } from '@/constants/featureFlags';", "import { CLEARANCE_CHECK_ENABLED, SCAN_ROOM_ENABLED } from '@/constants/featureFlags';") },
  { rule: 'N2', what: 'the gate stops reading the review record', plant: text(GATE, 'return flagOn === true && clearanceRefsProfessionallyRead(review);', 'return flagOn === true;') },
  { rule: 'N2', what: 'a professional read needs no name', plant: text('utils/roomScan/clearanceRefs.ts', "    && typeof review.reviewedBy === 'string' && review.reviewedBy.trim().length > 0;", ';') },
  { rule: 'N2', what: 'the flow asks the scanner\'s gate, as it used to', plant: text(FLOW, 'const clearanceOn = clearanceCheckAllowed(userEmail);', 'const clearanceOn = scanRoomAllowed(userEmail);') },
  { rule: 'N2', what: 'the door on the plan is drawn for everyone', plant: text(FLOW, "clearance={clearanceOn ? { label: ccopy.openLabel, onPress: () => afterScanAck(() => setStep('clearance')) } : undefined}", "clearance={{ label: ccopy.openLabel, onPress: () => afterScanAck(() => setStep('clearance')) }}") },
  { rule: 'N2', what: 'the screen is drawn without the gate', plant: text(FLOW, "{step === 'clearance' && clearanceOn && scan && clearance && (", "{step === 'clearance' && scan && clearance && (") },
  { rule: 'N2', what: 'the flow decides for itself who may see it', plant: text(FLOW, 'const clearanceOn = clearanceCheckAllowed(userEmail);', 'const clearanceOn = true;') },
  { rule: 'N2', what: 'the check is worked out for everyone', plant: text(FLOW, '(scan && clearanceOn ? buildClearanceCheck(scan, tapePairs, { nyc: clearanceNyc }) : null)', '(scan ? buildClearanceCheck(scan, tapePairs, { nyc: clearanceNyc }) : null)') },
  { rule: 'N2', what: 'a second way into the step', plant: text(FLOW, "    else if (step === 'quantities' || step === 'clearance') setStep('plan');", "    else if (step === 'quantities') setStep('clearance');\n    else if (step === 'clearance') setStep('plan');") },
  { rule: 'N2', what: 'another screen reads the switch', plant: (w) => ({ ...w, outside: { ...w.outside, 'app/project-detail.tsx': `${w.outside['app/project-detail.tsx'] ?? ''}\nimport { CLEARANCE_CHECK_ENABLED } from '@/constants/featureFlags';` } }) },
  // ── the review round ──
  { rule: 'A7', what: 'a sink\'s front line starts inside its own cabinet (3 in, tight)', plant: rows((m) => (m.kind === 'sink_front' && m.frontFrom === 'cabinet' ? restate({ ...m, valueUS: 3, value: 3 * IN, toward: { kind: 'object', objectId: 'o', category: 'storage' } }, 'tight') : m)) },
  { rule: 'A7', what: 'a sink in a cabinet is not said to be measured from the cabinet', plant: rows((m) => (m.kind === 'sink_front' ? { ...m, frontFrom: 'box' } : m)) },
  { rule: 'A7', what: 'the side is one line from the middle of the box (a cabinet beside the bowl is missed)', plant: rows((m) => (m.kind === 'toilet_side' && near(m.valueUS, 8, 0.01) ? restate({ ...m, valueUS: 48, value: 48 * IN, toward: { kind: 'wall', wallId: 'w', label: 'Wall 3' } }, 'roomy') : m)) },
  { rule: 'A7', what: 'a cabinet ahead of the toilet is counted as beside it', plant: rows((m, scan) => (m.kind === 'toilet_side' && scan.objects.some((x) => x.category === 'storage' && Math.abs(x.center.x) + Math.abs(x.center.y) > 0 && near(x.depthM / IN, 14, 0.01)) && near(m.valueUS, 48, 0.01) ? { ...m, valueUS: 8, value: 8 * IN } : m)) },
  { rule: 'A7', what: 'a toilet in a corner is labelled from the box\'s own depth axis', plant: result((c, scan) => {
    const t = scan.objects.find((x) => x.category === 'toilet');
    if (!t || !c.leftOut.some((l) => l.kind === 'fixture_facing')) return c;
    const row = { ...c.measures[0], id: `toilet:${t.id}:side:a`, kind: 'toilet_side' as const, index: 1, value: 14 * IN, valueUS: 14, state: 'close' as const, stateRefId: 'toilet_side_15' as const, figures: [{ refId: 'toilet_side_15' as const, state: 'close' as const }] };
    return { ...c, measures: [row, ...c.measures], leftOut: c.leftOut.filter((l) => l.kind !== 'fixture_facing') };
  }) },
  { rule: 'A7', what: 'a fixture whose facing is not sure is dropped without a word', plant: result((c) => ({ ...c, leftOut: c.leftOut.filter((l) => l.kind !== 'fixture_facing') })) },
  { rule: 'A7', what: 'a fixture whose facing is not sure is said to stand free', plant: result((c) => ({ ...c, leftOut: c.leftOut.map((l) => (l.kind === 'fixture_facing' ? { ...l, kind: 'fixture_free' as const } : l)) })) },
  { rule: 'A7', what: 'a toilet drawn across a cabinet is measured past it', plant: result((c, scan) => {
    const t = scan.objects.find((x) => x.category === 'toilet');
    if (!t || !c.leftOut.some((l) => l.kind === 'fixture_overlap')) return c;
    return { ...c, measures: [{ ...c.measures[0], id: `toilet:${t.id}:front`, kind: 'toilet_front', index: 1 }, ...c.measures], leftOut: c.leftOut.filter((l) => l.kind !== 'fixture_overlap') };
  }) },
  { rule: 'A7', what: 'the box\'s own axes decide away from a corner (swapped axes read differently)', plant: rows((m, scan) => (m.kind === 'toilet_front' && scan.objects.some((x) => x.category === 'toilet' && x.widthM > x.depthM) ? { ...m, valueUS: 56, value: 56 * IN } : m)) },
  { rule: 'A7', what: 'the outer edge of the bowl is missed in the fixture room', plant: rows((m, scan) => (m.kind === 'toilet_front' && scan.objects.length === 2 && near(m.valueUS, 22, 0.01) && scan.objects.some((x) => x.category === 'storage' && near(x.widthM / IN, 6, 0.01)) ? restate({ ...m, valueUS: 32, value: 32 * IN, toward: { kind: 'wall', wallId: 'w', label: 'Wall 2' } }, 'roomy') : m)) },
  { rule: 'A7', what: 'a bedroom with a jog is called a hallway (whole wall lengths)', plant: rows((m, scan) => (m.kind === 'passage_width' && scan.roomType === 'bedroom' && near(m.valueUS, 36, 0.01) ? { ...m, state: 'close', stateRefId: 'passage_36', figures: [{ refId: 'passage_36', state: 'close' }] } : m)) },
  { rule: 'A7', what: '22 in front of a toilet reads tight in the fixture room', plant: rows((m, scan) => (m.kind === 'toilet_front' && scan.objects.length === 1 && near(m.valueUS, 22, 0.01) ? restate(m, 'tight') : m)) },
  { rule: 'A7', what: 'the sentence for a fixture that is not labelled changes', plant: en('office.scanClearance.leftOut.fixtureFacingBody', 'The scan could not place this fixture. Tape it.') },
  { rule: 'A8', what: 'the 8 ft line is shown in Baltimore', plant: mod((m) => ({ build: (scan, pairs) => m.build(scan, pairs, { nyc: true }) })) },
  { rule: 'A8', what: 'a New York City bathroom at 82.5 reads roomy (no 7 ft line)', plant: rows((m, scan) => (m.kind === 'ceiling_low' && scan.roomType === 'bathroom' ? { ...m, figures: m.figures.slice(0, 1), state: m.figures[0].state, stateRefId: m.figures[0].state ? m.figures[0].refId : null } : m)) },
  { rule: 'A8', what: 'a New York City hallway is set beside the 8 ft line', plant: rows((m, scan) => (m.kind === 'ceiling_low' && scan.roomType !== 'bathroom' && m.figures.length === 1 && scan.walls.some((x) => near(x.lengthM / IN, 240, 0.01)) ? { ...m, figures: [...m.figures, { refId: 'ceiling_96', state: 'close' }] } : m)) },
  { rule: 'A8', what: 'a New York City bedroom with a jog loses the 8 ft line', plant: rows((m, scan) => (m.kind === 'ceiling_low' && scan.walls.length === 6 ? { ...m, figures: m.figures.slice(0, 1) } : m)) },
  { rule: 'A8', what: 'the flow reads the place from the settings text, not the resolver', plant: text(FLOW, 'clearanceInNyc(project)', '/new york/i.test(location)') },
  { rule: 'A8', what: 'the place file reads the address for itself', plant: text('utils/roomScan/clearancePlace.ts', "return resolved.kind === 'city' && resolved.entry.name === NYC_ROW_NAME;", "return /NY/.test(String(project.location));") },
  { rule: 'A8', what: 'all of New York State counts as the city', plant: mod(() => ({ inNyc: (p) => /NY/.test(String(p?.location ?? '')) })) },
  { rule: 'A8', what: 'no address counts as New York City', plant: mod((m) => ({ inNyc: (p) => !p || !p.location || m.inNyc(p) })) },
  { rule: 'A8', what: 'New York City is never recognised', plant: mod(() => ({ inNyc: () => false })) },
  { rule: 'A8', what: 'the place is not handed to the check', plant: text(FLOW, 'buildClearanceCheck(scan, tapePairs, { nyc: clearanceNyc })', 'buildClearanceCheck(scan, tapePairs)') },
  { rule: 'A8', what: 'New York City\'s line is named as a model code figure', plant: refs((r) => (r.id === 'ceiling_bath_84_nyc' ? { ...r, family: 'residential_model' } : r)) },
  { rule: 'N5', what: 'the blocking item leaves the checklist', plant: text('docs/scan-the-room-native-checklist.md', 'BLOCKING: which box axis is depth', 'Later: which box axis is depth') },
  { rule: 'N5', what: 'the item stops naming a real sink', plant: text('docs/scan-the-room-native-checklist.md', 'confirm on a real toilet and a real sink', 'confirm on a real toilet') },
  { rule: 'N3', what: 'the core asks a model', plant: text(CORE_F, "import { metresToInches, sqMetresToSqFeet } from './units';", "import { metresToInches, sqMetresToSqFeet } from './units';\nimport { askModel } from '@/utils/aiService';") },
  { rule: 'N3', what: 'the core calls the network', plant: text(CORE_F, 'const margin = clearanceMargin(tapeFacts(tapePairs));', "const margin = clearanceMargin(tapeFacts(tapePairs));\n  void fetch('https://example.com');") },
  { rule: 'N3', what: 'the core reads the clock', plant: text(CORE_F, 'const margin = clearanceMargin(tapeFacts(tapePairs));', 'const margin = clearanceMargin(tapeFacts(tapePairs));\n  const at = Date.now();') },
  { rule: 'N3', what: 'the screen calls an edge function', plant: text(VIEW, "import { makeRoomScanStyles } from './styles';", "import { makeRoomScanStyles } from './styles';\nimport { supabase } from '@/lib/supabase';") },
  { rule: 'N3', what: 'the copy hook keeps something on the phone', plant: text(HOOK, "import { useMemo } from 'react';", "import { useMemo } from 'react';\nimport AsyncStorage from '@react-native-async-storage/async-storage';") },
  { rule: 'N4', what: 'the check leaves the ship-check chain', plant: text(PKG, ' && bun run test:scan-clearance', '') },
  { rule: 'N4', what: 'the script is renamed', plant: text(PKG, '"test:scan-clearance": "bun run scripts/validate-scan-clearance.ts"', '"test:scan-clearance": "echo skipped"') },
  { rule: 'N4', what: 'the gate still reports the old count', plant: (w) => ({ ...w, F: { ...w.F, [GATE_YML]: w.F[GATE_YML].replace(/name: ship-check — (\d+) checks \((\d+) validators/, (_m, a: string, b: string) => `name: ship-check — ${Number(a) - 1} checks (${Number(b) - 1} validators`) } }) },
  { rule: 'N4', what: 'the smoke suite loses the gate test', plant: text(SMOKE, "it('SC5 ", "it.skip('SC5x ") },
];

if (process.env.LIST === '1') for (const m of MUTATIONS) console.log(`  ${m.rule}: ${m.what}`);

// ── what the tight bathroom reports (printed for the report; A1 pins it) ────
{
  const c = CORE.buildClearanceCheck(scanOf('tight-bath'));
  console.log('\n  the tight bathroom, margin ' + c.margin.scanIn + ' in:');
  for (const m of c.measures) {
    const to = m.toward ? ` to ${m.toward.kind === 'wall' ? m.toward.label : m.toward.category}` : '';
    console.log(`    ${m.kind}${to}: ${m.unit === 'area' ? `${m.valueUS.toFixed(1)} sq ft` : `${m.valueUS.toFixed(1)} in`}, ${m.state ?? 'no state'}${m.stateRefId ? ` (${m.stateRefId})` : ''}`);
  }
  console.log(`    left out: ${c.leftOut.map((l) => l.kind).join(', ')}`);
}

console.log('\n── planted mutations (each must turn its own rule red)');
const proven = new Set<string>();
for (const m of MUTATIONS) {
  const id = Object.keys(RULES).find((k) => k.startsWith(`${m.rule} `));
  let caught = false;
  let how = '';
  try {
    if (!id) throw new Error(`no rule ${m.rule}`);
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
const unproven = Object.keys(RULES).map((k) => k.split(' ')[0]).filter((r) => !proven.has(r));
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-scan-clearance: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
if (fail > 0) process.exit(1);
