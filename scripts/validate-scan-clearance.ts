// validate-scan-clearance — Scan The Room, Clearance Check (lane CLEARANCE).
// Owner preview: the scanner's own gate, SCAN_ROOM_ENABLED = false.
//
// WHAT IT PROVES, with no phone. Every room is a hand-built fixture
// (scripts/fixtures/scan-room). NOTHING HERE HAS BEEN CHECKED AGAINST A REAL
// SCAN, and no figure in the table has been read by an architect or an
// expediter.
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
//        is not in the way, the three lines in front, an open outline has no
//        passage, a scan with no heights has no ceiling row, and a window
//        outside a bedroom is not set beside anything.
// B. THE STATES
//    B1  the boundaries: on the figure, the margin either side, a hair past
//        the margin either side, well clear, and the same for a "most";
//    B2  a door and a window are never 'roomy' and never 'tight', and a window
//        is compared only in a bedroom;
//    B3  set beside two figures, a row takes the state most worth a tape and
//        names the figure that gave it; the ceiling figures follow the room.
// C. THE MARGIN
//    C1  1.5 in by default, never less, wider with a worse tape history, up to
//        a cap, and never from too few walls or a slip of the thumb;
//    C2  a number he taped uses the tighter margin, the row says so, and a
//        taped wall never tightens a fixture's row.
// D. THE FIGURES (utils/roomScan/clearanceRefs)
//    D1  one table: every figure has its number, what it is called and its
//        family; the numbers are the pinned ones; the screen's words are the
//        table's; no figure is typed into a string;
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
//        is less, a window's net clear opening cannot be seen, stairs are not
//        measured;
//    W3  every sentence is in the app's own words (utils/codeCard/echoCheck),
//        is short, quotes nothing, and never says how right a number is;
//    W4  house style: labels with every word capitalised, sentences that end,
//        captions that do not, no em dash, no "&", no "e.g.", no arrows; the
//        three state names;
//    W5  English and Spanish carry the same keys, plural shapes, placeholders
//        and source hashes, and the surface is registered.
// N. THE GATE AND THE WIRING (source text)
//    N1  it never blocks: no action depends on a state, the result carries no
//        verdict about the room, and nothing outside the feature reads it;
//    N2  with the flag off, someone who is not the owner sees nothing;
//    N3  no model call, no network, no storage, no clock in the lane;
//    N4  it is registered: the package script, the ship-check chain, the
//        gate's pinned count, and the smoke suite.
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
import { SCAN_ROOM_ENABLED } from '../constants/featureFlags';
import { scanRoomAllowedWith } from '../utils/roomScan/allowed';
import { LOCAL_ADOPTIONS } from '../utils/codeJurisdiction';
import { longestRun, passesProseCheck } from '../utils/codeCard/echoCheck';
import { sourceHash } from '../i18n/hash';
import { SURFACES } from '../i18n/surfaces';
import { EN_SHARDS } from '../i18n/catalog/en';
import { ES_SHARDS } from '../i18n/catalog/es';
import { EN as EN_REAL } from '../i18n/catalog/en/office.scan-clearance.generated';
import { ES_OFFICE_SCAN_CLEARANCE as ES_REAL } from '../i18n/catalog/es/office/scanClearance';
import {
  FIXTURE_FILES, bedroomWindowSpec, buildCapturedRoom, narrowHallSpec, tightBathSpec, type RoomSpec,
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
  'utils/owner.ts', 'scripts/fixtures/scan-room/builder.ts',
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
function compare(o: string[], room: string, c: CORE.ClearanceCheck, wants: Want[]) {
  check(o, c.measures.length === wants.length, `${room}: ${c.measures.length} rows, not the ${wants.length} worked by hand (${c.measures.map((m) => m.kind).join(', ')})`);
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
//   TOILET, CLEAR SPACE IN FRONT      the front of the box is x = 28. Three
//       lines run ahead from it, at y = 52 and a quarter of the width either
//       side (52 - 3.75 = 48.25 and 55.75). All three meet the cabinet, whose
//       face is x = 50 between y 42 and 62: 50 - 28 = 22.
//       Figure 21: 19.5 <= 22 <= 22.5, CLOSE.
//       Figure 24: 24 - 1.5 = 22.5, and 22 is under it, TIGHT.
//       The row takes TIGHT and credits the 24 in figure.
//   SINK, CLEAR SPACE IN FRONT        the front of the box is x = 20. Lines at
//       y = 27.5, 21.5 and 33.5 pass under the cabinet (it starts at y 42) and
//       meet the right wall at x = 60: 40. Figure 21: 40 is past 22.5, ROOMY.
//   DOOR                              28 as scanned. Figure 32, the CLEAR
//       width, which the scan cannot see. 28 is not past 32 + 1.5: CLOSE
//       (never TIGHT, never ROOMY).
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
  { kind: 'toilet_front', toward: 'storage', value: 22, state: 'tight', ref: 'toilet_front_24', figures: [['toilet_front_21', 'close'], ['toilet_front_24', 'tight']] },
  { kind: 'sink_front', toward: 'wall', value: 40, state: 'roomy', ref: 'sink_front_21', figures: [['sink_front_21', 'roomy']] },
  { kind: 'door_width', value: 28, state: 'close', ref: 'door_clear_32', figures: [['door_clear_32', 'close']] },
  { kind: 'passage_width', value: 60, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 81, state: 'close', ref: 'ceiling_bath_80', figures: [['ceiling_bath_80', 'close']] },
];
rule('A1 the tight bathroom, every row, against the answers worked by hand', (w) => {
  const o: string[] = [];
  const c = w.M.build(scanOf('tight-bath'));
  compare(o, 'tight bathroom', c, TIGHT_BATH);
  check(o, leftKinds(c) === 'door_clear:1 stairs:0 tub_opening:1', `left out: ${leftKinds(c)}`);
  check(o, c.comparedCount === 6 && c.tapedCount === 0, `${c.comparedCount} rows compared and ${c.tapedCount} taped, not 6 and 0`);
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
//   DOORS             30 each. Not past 33.5: CLOSE.
//   LOWEST CEILING    96. A room shaped like a hallway is set beside 84 alone:
//                     96 is past 85.5, ROOMY.
//   STAIRS            left out: one box, no risers or treads.
const NARROW_HALL: Want[] = [
  { kind: 'door_width', index: 1, value: 30, state: 'close', ref: 'door_clear_32', figures: [['door_clear_32', 'close']] },
  { kind: 'door_width', index: 2, value: 30, state: 'close', ref: 'door_clear_32', figures: [['door_clear_32', 'close']] },
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
//   DOOR            36. Past 32 + 1.5 = 33.5: no state (never ROOMY).
//   WINDOW WIDTH    24. Figure 20 (net clear). Past 21.5: no state.
//   WINDOW HEIGHT   36. Figure 24 (net clear). Past 25.5: no state.
//   WINDOW AREA     24 x 36 = 864 sq in = 6.0 sq ft. Figure 5.7 sq ft (net
//                   clear) = 820.8 sq in. With the margin off each side,
//                   22.5 x 34.5 = 776.25 sq in = 5.39 sq ft, under 5.7: CLOSE.
//   WINDOW SILL     43. Figure 44, a most. 44 - 1.5 = 42.5, and 43 is past
//                   it: CLOSE.
//   NARROWEST WIDTH 120. 132 / 120 = 1.1: not a hallway, no state.
//   LOWEST CEILING  96. Figure 84: past 85.5, ROOMY. Figure 96: on it, CLOSE.
//                   The row takes CLOSE and credits the 96 in figure.
const BEDROOM: Want[] = [
  { kind: 'door_width', value: 36, state: null, ref: null, figures: [['door_clear_32', null]] },
  { kind: 'window_width', value: 24, state: null, ref: null, figures: [['escape_width_20', null]] },
  { kind: 'window_height', value: 36, state: null, ref: null, figures: [['escape_height_24', null]] },
  { kind: 'window_area', value: 6, state: 'close', ref: 'escape_area_5_7', figures: [['escape_area_5_7', 'close']] },
  { kind: 'window_sill', value: 43, state: 'close', ref: 'escape_sill_44', figures: [['escape_sill_44', 'close']] },
  { kind: 'passage_width', value: 120, state: null, ref: null, figures: [] },
  { kind: 'ceiling_low', value: 96, state: 'close', ref: 'ceiling_96', figures: [['ceiling_84', 'roomy'], ['ceiling_96', 'close']] },
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
//   DOORS             30 each: CLOSE.
//   LOWEST CEILING    96 beside 84 alone: ROOMY.
const HALLWAY: Want[] = [
  { kind: 'door_width', index: 1, value: 30, state: 'close', ref: 'door_clear_32', figures: [['door_clear_32', 'close']] },
  { kind: 'door_width', index: 2, value: 30, state: 'close', ref: 'door_clear_32', figures: [['door_clear_32', 'close']] },
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
  for (const name of ['tight-bath.json', 'narrow-hall.json', 'bedroom-window.json']) {
    const spec = FIXTURE_FILES[name];
    check(o, !!spec && read(`scripts/fixtures/scan-room/${name}`) === JSON.stringify(buildCapturedRoom(spec()), null, 1) + '\n', `${name} no longer equals what builder.ts writes`);
  }
  check(o, /NOT FROM A PHONE/.test(w.F['scripts/fixtures/scan-room/builder.ts']), 'the fixture builder no longer says its rooms are not from a phone');
  for (const [name, spec] of [['tight bathroom', tightBathSpec], ['narrow hallway', narrowHallSpec], ['bedroom', bedroomWindowSpec]] as [string, () => RoomSpec][]) {
    const base = w.M.build(fromSpec(spec()));
    for (const turn of [0, 90, 211]) {
      const c = w.M.build(fromSpec({ ...spec(), rotateDeg: turn, shift: { x: -3.3, y: 7.1 } }));
      check(o, c.measures.length === base.measures.length, `${name} turned ${turn} degrees has ${c.measures.length} rows`);
      for (const m of base.measures) {
        const t = pick(c, { kind: m.kind, index: m.index, toward: m.toward ? towardOf(m) : undefined });
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

rule('A6 the stated method: what is left out, what is in the way, and the three lines in front', (w) => {
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
  // The three lines in front are at y = 48.25, 52 and 55.75. A cabinet covering only y 54 to 62 is met by the last one: still 22.
  const noCabinet = objects.filter((x) => x.category !== 'storage');
  const quarter = withObjects([...noCabinet, { category: 'storage', at: inPt(55, 58), w: 8 * IN, h: 72 * IN, d: 10 * IN, turnDeg: 90 }]);
  check(o, near(pick(quarter, { kind: 'toilet_front' })?.valueUS, 22, 0.005), `a cabinet in front of a quarter of the toilet is missed: ${pick(quarter, { kind: 'toilet_front' })?.valueUS}`);
  // One covering only y 57 to 63 is past all three lines: the right wall, 60 - 28 = 32.
  const past = withObjects([...noCabinet, { category: 'storage', at: inPt(55, 60), w: 6 * IN, h: 72 * IN, d: 10 * IN, turnDeg: 90 }]);
  check(o, near(pick(past, { kind: 'toilet_front' })?.valueUS, 32, 0.005) && towardOf(pick(past, { kind: 'toilet_front' }) as CORE.ClearanceMeasure) === 'wall', `the space in front does not reach the wall: ${pick(past, { kind: 'toilet_front' })?.valueUS}`);
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

rule('B2 a door and a window are never roomy and never tight, and a window is compared only in a bedroom', (w) => {
  const o: string[] = [];
  for (let v = 0; v <= 80; v += 0.25) {
    const s = w.M.boundState(v, 32, 'min', 1.5);
    check(o, s === (v <= 33.5 + 1e-9 ? 'close' : null), `a door ${v} in wide as scanned is ${s}`);
  }
  for (const name of ['tight-bath', 'narrow-hall', 'bedroom-window', 'hallway', 'bathroom', 'bay-room', 'three-openings', 'l-shape']) {
    for (const m of w.M.build(scanOf(name)).measures) {
      if (m.kind !== 'door_width' && !m.kind.startsWith('window_')) continue;
      check(o, m.boundOnly === true, `${name} ${m.kind} is not marked as something the scan can only see larger`);
      check(o, m.state === null || m.state === 'close', `${name} ${m.kind} is ${m.state}`);
      check(o, m.figures.every((f) => f.state === null || f.state === 'close'), `${name} ${m.kind} has a figure that is roomy or tight`);
    }
  }
  // A door 4 in under the figure is still only 'close': the scan cannot see the clear width.
  check(o, pick(w.M.build(scanOf('tight-bath')), { kind: 'door_width' })?.state === 'close', 'a 28 in door is not close');
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

rule('B3 beside two figures a row takes the state most worth a tape, and the ceiling figures follow the room', (w) => {
  const o: string[] = [];
  const front = pick(w.M.build(scanOf('tight-bath')), { kind: 'toilet_front' });
  check(o, front?.state === 'tight' && front.stateRefId === 'toilet_front_24', `22 in front of a toilet is ${front?.state} by ${front?.stateRefId}`);
  // 22.5 in (a cabinet 9.5 deep, its face at x = 50.5): the margin over 21 and the margin under 24, so close by both
  // figures. The one asking for more room is credited.
  const bath = tightBathSpec();
  const moved = (bath.objects ?? []).map((x) => (x.category === 'storage' ? { ...x, at: { x: 55.25 * IN, y: 52 * IN }, d: 9.5 * IN } : x));
  const both = pick(w.M.build(fromSpec({ ...bath, objects: moved })), { kind: 'toilet_front' });
  check(o, near(both?.valueUS, 22.5, 0.005) && both?.state === 'close' && both.figures.every((f) => f.state === 'close') && both.stateRefId === 'toilet_front_24', `22.5 in front of a toilet is ${both?.valueUS} ${both?.state} by ${both?.stateRefId}`);
  // 24 in (a cabinet 8 deep): past 21 by more than the margin, on the 24 in figure. Close, by the 24 in figure.
  const at24 = (bath.objects ?? []).map((x) => (x.category === 'storage' ? { ...x, at: { x: 56 * IN, y: 52 * IN }, d: 8 * IN } : x));
  const f24 = pick(w.M.build(fromSpec({ ...bath, objects: at24 })), { kind: 'toilet_front' });
  check(o, near(f24?.valueUS, 24, 0.005) && f24?.state === 'close' && f24.stateRefId === 'toilet_front_24' && f24.figures[0].state === 'roomy', `24 in front of a toilet is ${f24?.valueUS} ${f24?.state} by ${f24?.stateRefId}`);
  const refsOf = (scan: RoomScan) => (pick(w.M.build(scan), { kind: 'ceiling_low' })?.figures ?? []).map((f) => f.refId).join();
  check(o, refsOf(scanOf('tight-bath')) === 'ceiling_bath_80', `a bathroom ceiling is set beside ${refsOf(scanOf('tight-bath'))}`);
  check(o, refsOf(scanOf('narrow-hall')) === 'ceiling_84', `a hallway ceiling is set beside ${refsOf(scanOf('narrow-hall'))}`);
  check(o, refsOf(scanOf('bedroom-window')) === 'ceiling_84,ceiling_96', `a bedroom ceiling is set beside ${refsOf(scanOf('bedroom-window'))}`);
  // The lowest height the scan saw, not the typical one.
  const scan = scanOf('bedroom-window');
  const low = pick(w.M.build({ ...scan, ceilingHeightM: { ...scan.ceilingHeightM, min: 82 * IN } }), { kind: 'ceiling_low' });
  check(o, near(low?.valueUS, 82, 0.005) && low?.state === 'tight' && low.stateRefId === 'ceiling_96', `a ceiling that drops to 82 in reads ${low?.valueUS} ${low?.state}`);
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
  //   in front of the toilet, 22: beside 24, 24 - 3 = 21, so CLOSE (it was TIGHT);
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
  // A door he typed at 33: the margin is 0.5, 33 is past 32.5, no state. The other door, still scanned at 30, keeps 1.5.
  const door = hall.openings.find((x) => x.kind === 'door');
  if (!door) return [...o, 'the narrow hallway has no door'];
  const typedDoor = w.M.build(correctOpening(hall, door.id, 'widthM', 33 * IN, AT));
  const d1 = typedDoor.measures.find((m) => m.openingId === door.id);
  const d2 = typedDoor.measures.find((m) => m.kind === 'door_width' && m.openingId !== door.id);
  check(o, !!d1 && d1.restsOnTaped && d1.marginIn === 0.5 && d1.state === null, `a door typed at 33 in reads ${d1?.state} with margin ${d1?.marginIn}`);
  check(o, !!d2 && !d2.restsOnTaped && d2.marginIn === 1.5 && d2.state === 'close', 'the door he did not tape lost its scan margin');
  // The same 33 in door read from the scan is within 1.5 of 32: CLOSE.
  const spec = narrowHallSpec();
  const scanned33 = w.M.build(fromSpec({ ...spec, openings: (spec.openings ?? []).map((x, i) => (i === 0 ? { ...x, width: 33 * IN } : x)) }));
  check(o, pick(scanned33, { kind: 'door_width', index: 1 })?.state === 'close', 'a door scanned at 33 in is not close');
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
const PINNED: Record<REFS.ClearanceRefId, [number, 'in' | 'sqft', 'min' | 'max', REFS.ClearanceFamily]> = {
  toilet_side_15: [15, 'in', 'min', 'residential_and_plumbing_model'],
  toilet_front_21: [21, 'in', 'min', 'residential_and_plumbing_model'],
  toilet_front_24: [24, 'in', 'min', 'other_plumbing'],
  sink_front_21: [21, 'in', 'min', 'residential_and_plumbing_model'],
  door_clear_32: [32, 'in', 'min', 'building_model'],
  passage_36: [36, 'in', 'min', 'residential_model'],
  ceiling_84: [84, 'in', 'min', 'residential_model'],
  ceiling_bath_80: [80, 'in', 'min', 'residential_model'],
  ceiling_96: [96, 'in', 'min', 'some_city'],
  escape_area_5_7: [5.7, 'sqft', 'min', 'residential_model'],
  escape_height_24: [24, 'in', 'min', 'residential_model'],
  escape_width_20: [20, 'in', 'min', 'residential_model'],
  escape_sill_44: [44, 'in', 'max', 'residential_model'],
};
const CALLED_KEY: Record<REFS.ClearanceRefId, string> = {
  toilet_side_15: 'toiletSideText', toilet_front_21: 'toiletFrontText', toilet_front_24: 'toiletFrontText', sink_front_21: 'sinkFrontText',
  door_clear_32: 'doorClearText', passage_36: 'passageText', ceiling_84: 'ceilingText', ceiling_bath_80: 'ceilingBathText', ceiling_96: 'ceilingText',
  escape_area_5_7: 'escapeAreaText', escape_height_24: 'escapeHeightText', escape_width_20: 'escapeWidthText', escape_sill_44: 'escapeSillText',
};
const FAMILY_KEY: Record<REFS.ClearanceFamily, string> = {
  residential_model: 'residentialModelText', residential_and_plumbing_model: 'residentialAndPlumbingModelText', other_plumbing: 'otherPlumbingText',
  building_model: 'buildingModelText', some_city: 'someCityText',
};

rule('D1 one table: every figure has its number, its name and its family, and the screen uses the table', (w) => {
  const o: string[] = [];
  const ids = w.M.refs.map((r) => r.id);
  check(o, new Set(ids).size === ids.length, 'a figure is in the table twice');
  check(o, ids.slice().sort().join() === Object.keys(PINNED).sort().join(), `the table holds ${ids.join(', ')}`);
  for (const r of w.M.refs) {
    const pin = PINNED[r.id];
    if (!pin) continue;
    check(o, r.value === pin[0] && r.unit === pin[1] && r.bound === pin[2] && r.family === pin[3], `${r.id} is ${r.value} ${r.unit} ${r.bound} ${r.family}, pinned as ${pin.join(' ')}`);
    check(o, Number.isFinite(r.value) && r.value > 0, `${r.id} has no usable number`);
    check(o, typeof r.called === 'string' && r.called.length >= 10 && /^[a-z]/.test(r.called) && !/[.!?]$/.test(r.called), `${r.id} has no plain name: "${r.called}"`);
    check(o, typeof w.M.familyWords[r.family] === 'string' && w.M.familyWords[r.family].length > 5, `${r.id} has no family in plain words`);
    check(o, w.EN[`office.scanClearance.called.${CALLED_KEY[r.id]}`] === r.called, `${r.id}: the screen calls it "${String(w.EN[`office.scanClearance.called.${CALLED_KEY[r.id]}`])}", the table "${r.called}"`);
    check(o, w.EN[`office.scanClearance.family.${FAMILY_KEY[r.family]}`] === w.M.familyWords[r.family], `${r.id}: the screen's family words are not the table's`);
    check(o, typeof r.checked?.nyc === 'boolean' && typeof r.checked?.baltimore === 'boolean', `${r.id} does not say whether the repo's checked data confirms it for New York City and for Baltimore`);
  }
  // The core uses every figure, and only figures the table holds.
  const core = stripComments(w.F['utils/roomScan/clearanceCore.ts']);
  const used = new Set((core.match(/'(?:toilet|sink|door|passage|ceiling|escape)_[a-z0-9_]+'/g) ?? []).map((x) => x.slice(1, -1)).filter((x) => /_\d/.test(x)));
  for (const id of ids) check(o, used.has(id), `${id} is in the table and is never used`);
  for (const id of used) check(o, ids.includes(id as REFS.ClearanceRefId), `the core uses a figure the table does not hold: ${id}`);
  // No figure is typed into a string: the number in a sentence is the table's.
  const hook = stripComments(w.F[HOOK]);
  check(o, /figureBody: \(refId\) => t\('office\.scanClearance\.figureBody', '\{value\}: \{called\}\. From \{family\}\.', \{ value: figureValue\(refId\), called: called\(refId\), family: family\(clearanceRef\(refId\)\.family\) \}\)/.test(hook), 'the figure sentence is not built from the table');
  check(o, /const r = clearanceRef\(refId\);/.test(hook) && /r\.value/.test(hook), 'the number shown is not read from the table');
  const typed = /(?<![\d.{])\b(?:15|20|21|24|32|36|44|80|84|96|5\.7)\b(?![\d}])/;
  for (const [k, v] of Object.entries(w.EN)) for (const f of forms(v)) if (typed.test(f)) o.push(`English ${k} types a figure into the words: "${f}"`);
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) if (typed.test(f)) o.push(`Spanish ${k} types a figure into the words`);
  check(o, REFS.CLEARANCE_REFS_REVIEW.professionalReview === 'none' ? /No architect or expediter has read it yet/.test(String(w.EN['office.scanClearance.starterBody'])) : true, 'the screen no longer says nobody has read the list');
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
  const block = view.slice(view.indexOf('{m.figures.map((f) => ('), view.indexOf('{note && '));
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
  check(o, /\{note && <Text style=\{styles\.note\}>\{note\}<\/Text>\}/.test(view) && /const note = copy\.measureNote\(m\);/.test(view), 'a row does not carry its own note');
  // Every door row carries the door note and every window row the window note.
  const hook = stripComments(w.F[HOOK]);
  check(o, /case 'door_width': return t\('office\.scanClearance\.note\.doorNote'/.test(hook), 'a door row has no note saying the clear width is less');
  check(o, /case 'ceiling_low': return null;\s*default: return t\('office\.scanClearance\.note\.windowNote'/.test(hook), 'a window row has no note saying the scan cannot see the net clear opening');
  // Stairs are always in the left-out list, seen or not.
  for (const name of ['tight-bath', 'narrow-hall', 'bedroom-window', 'hallway', 'missing-wall']) {
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
    ['office.scanClearance.state.closeLabel', 'Close, Tape It', 'Justo, mídelo con cinta'],
    ['office.scanClearance.state.tightLabel', 'Tight, Tape It And Check Your Local Code', 'Apretado, mídelo con cinta y revisa tu código local'],
    ['office.scanClearance.titleLabel', 'Clearance Check', 'Revisión de espacios libres'],
  ];
  for (const [k, en, es] of names) check(o, w.EN[k] === en && w.ES[k]?.s === es, `${k} reads "${String(w.EN[k])}" and "${String(w.ES[k]?.s)}"`);
  // What each state means is said in the words of its rule.
  check(o, /Further from the commonly used figure than the margin/.test(String(w.EN['office.scanClearance.state.roomyBody'])), 'roomy is not explained as further from the figure than the margin');
  check(o, /Within the margin of the commonly used figure, on either side of it\./.test(String(w.EN['office.scanClearance.state.closeBody'])) && /A door or a window gets this label/.test(String(w.EN['office.scanClearance.state.closeBody'])), 'close is not explained, or does not say what it means on a door or a window');
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
    "'clearance'", 'const clearance = useMemo(() => (scan && clearanceOn ? buildClearanceCheck(scan, tapePairs) : null), [scan, clearanceOn, tapePairs]);',
    "clearanceOn && scan && clearance && (", 'check={clearance}', 'clearance={clearanceOn ? { label: ccopy.openLabel, onPress: () => setStep(', 'clearanceOn',
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
  const names = /clearanceCore|clearanceRefs|ClearanceView|useScanClearanceCopy|buildClearanceCheck/;
  for (const [f, text] of Object.entries(w.outside)) {
    if (f === 'i18n/surfaces.ts') continue;
    if (names.test(stripComments(text))) o.push(`${f} reads Clearance Check`);
  }
  const plan = stripComments(w.F[PLAN]);
  check(o, /\{p\.clearance && <Button label=\{p\.clearance\.label\} variant="secondary" onPress=\{p\.clearance\.onPress\} testID="scan-open-clearance" \/>\}/.test(plan) && !/clearanceCore|ClearanceState/.test(plan), 'the plan draws more than a door to the check');
  return o;
});

rule('N2 with the flag off, someone who is not the owner sees nothing', (w) => {
  const o: string[] = [];
  check(o, w.M.flag === false && /^export const SCAN_ROOM_ENABLED = false;$/m.test(w.F['constants/featureFlags.ts']), 'SCAN_ROOM_ENABLED is not false');
  const owner = (w.F['utils/owner.ts'].match(/'([^'\s]+@[^'\s]+)'/) ?? [])[1] ?? '';
  check(o, !!owner && w.M.allowed(false, owner) === true, 'with the flag off the gate refuses the owner');
  check(o, w.M.allowed(false, 'someone@example.com') === false && w.M.allowed(false, null) === false && w.M.allowed(false, undefined) === false && w.M.allowed(false, '') === false, 'with the flag off the gate lets in someone who is not the owner');
  const flow = stripComments(w.F[FLOW]);
  check(o, /const clearanceOn = scanRoomAllowed\(userEmail\);/.test(flow) && /import \{ scanRoomAllowed \} from '@\/utils\/roomScan\/allowed';/.test(flow), 'the flow does not ask the scanner\'s gate, with the signed-in email');
  check(o, /const clearance = useMemo\(\(\) => \(scan && clearanceOn \? buildClearanceCheck\(scan, tapePairs\) : null\)/.test(flow), 'the check is worked out for someone the gate refuses');
  check(o, /\{step === 'clearance' && clearanceOn && scan && clearance && \(\s*<ClearanceView/.test(flow), 'the screen is drawn without asking the gate');
  check(o, /clearance=\{clearanceOn \? \{ label: ccopy\.openLabel, onPress: \(\) => setStep\('clearance'\) \} : undefined\}/.test(flow), 'the door on the plan is handed over without asking the gate');
  check(o, (flow.match(/setStep\('clearance'\)/g) ?? []).length === 1, 'there is a second way into the step');
  check(o, !/SCAN_ROOM_ENABLED|isOwner\b|OWNER_EMAILS/.test(flow) && !/SCAN_ROOM_ENABLED|isOwner\b|scanRoomAllowed/.test(stripComments(w.F[VIEW])), 'the flow or the screen reads the flag or the owner list itself');
  check(o, /if \(!scanRoomAllowed\(userEmail\)\) return <Redirect href="[^"]+" \/>;/.test(stripComments(w.F['app/scan-room.tsx'])), 'the route does not redirect someone the gate refuses');
  check(o, /return flagOn === true \|\| isOwner\(userEmail\);/.test(stripComments(w.F['utils/roomScan/allowed.ts'])), 'the gate is not "the flag, or the owner"');
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
  for (const id of ['SC1', 'SC2', 'SC3', 'SC4', 'SC5', 'SC6']) check(o, new RegExp(`it\\('${id} `).test(smoke), `the smoke suite has no ${id}`);
  check(o, /tight-bath/.test(smoke) && /scan-open-clearance/.test(smoke) && /someone@example\.com/.test(smoke), 'the smoke suite does not mount the tight bathroom, for the owner and for someone else');
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
  build: (scan, pairs) => { const c = m.build(scan, pairs); return { ...c, measures: c.measures.map((x) => fn(x, scan)).filter((x): x is CORE.ClearanceMeasure => !!x) }; },
}));
const result = (fn: (c: CORE.ClearanceCheck, scan: RoomScan) => CORE.ClearanceCheck) => mod((m) => ({ build: (scan, pairs) => fn(m.build(scan, pairs), scan) }));
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
  { rule: 'A1', what: 'the front of the toilet is judged by the 21 in figure alone', plant: rows((m) => (m.kind === 'toilet_front' ? { ...m, state: 'close', stateRefId: 'toilet_front_21' } : m)) },
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
  { rule: 'B2', what: 'a narrow door is called tight in a room', plant: rows((m) => (m.kind === 'door_width' && m.valueUS < 30.4 ? restate(m, 'tight') : m)) },
  { rule: 'B2', what: 'a big window is called roomy', plant: rows((m) => (m.kind === 'window_height' && m.valueUS > 39 ? restate(m, 'roomy') : m)) },
  { rule: 'B2', what: 'a window is compared in a plain room', plant: result((c, scan) => (scan.roomType === 'room' && scan.openings.some((x) => x.kind === 'window') && scan.walls.length === 4 && near(scan.walls[0].lengthM / IN, 120, 1) ? { ...c, measures: [...c.measures, { ...c.measures[0], id: 'w', kind: 'window_area', boundOnly: true, state: 'close' }] } : c)) },
  { rule: 'B2', what: 'the window area forgets the margin', plant: rows((m) => (m.kind === 'window_area' && near(m.valueUS, 6, 0.01) ? restate(m, null) : m)) },
  { rule: 'B2', what: 'a door row is not marked as larger than the clear width', plant: rows((m) => (m.kind === 'door_width' ? { ...m, boundOnly: false } : m)) },
  { rule: 'B3', what: 'a row takes the gentler of two states', plant: rows((m) => (m.kind === 'toilet_front' && m.figures.length === 2 && m.figures[0].state !== m.figures[1].state ? { ...m, state: 'close', stateRefId: 'toilet_front_21' } : m)) },
  { rule: 'B3', what: 'the figure asking for less room is credited', plant: rows((m) => (m.kind === 'toilet_front' && m.figures.every((f) => f.state === 'close') ? { ...m, stateRefId: 'toilet_front_21' } : m)) },
  { rule: 'B3', what: 'a bathroom ceiling is set beside the room figures', plant: rows((m, scan) => (m.kind === 'ceiling_low' && scan.roomType === 'bathroom' ? { ...m, figures: [{ refId: 'ceiling_84', state: 'tight' }, { refId: 'ceiling_96', state: 'tight' }] } : m)) },
  { rule: 'B3', what: 'the typical ceiling height is used, not the lowest', plant: mod((m) => ({ build: (scan, pairs) => m.build({ ...scan, ceilingHeightM: { ...scan.ceilingHeightM, min: scan.ceilingHeightM.typical } }, pairs) })) },
  // ── C ──
  { rule: 'C1', what: 'the default margin is 1 in', plant: mod((m) => ({ margin: (t) => { const x = m.margin(t); return x.basis === 'scan_default' ? { ...x, scanIn: 1 } : x; } })) },
  { rule: 'C1', what: 'a good history takes the margin down to its largest difference', plant: mod((m) => ({ margin: (t) => (t && t.enough ? { ...m.margin(t), scanIn: t.largestIn } : m.margin(t)) })) },
  { rule: 'C1', what: 'a worse history does not widen the margin', plant: mod((m) => ({ margin: () => m.margin(null) })) },
  { rule: 'C1', what: 'there is no cap on the margin', plant: mod((m) => ({ margin: (t) => (t && t.enough && t.largestIn > 6 ? { ...m.margin(t), scanIn: t.largestIn } : m.margin(t)) })) },
  { rule: 'C1', what: 'the typical difference is used, not the largest', plant: mod((m) => ({ margin: (t) => (t && t.enough ? m.margin({ ...t, largestIn: t.typicalIn }) : m.margin(t)) })) },
  { rule: 'C1', what: 'in a room the history is ignored', plant: mod((m) => ({ build: (scan) => m.build(scan, []) })) },
  { rule: 'C1', what: 'four walls are enough to widen the margin', plant: mod((m) => ({ build: (scan, pairs) => { const c = m.build(scan, pairs); return pairs && pairs.length === 4 ? { ...c, margin: { ...c.margin, scanIn: 5, basis: 'tape_history' as const } } : c; } })) },
  { rule: 'C1', what: 'a wider margin is stated and not used', plant: mod((m) => ({ build: (scan, pairs) => ({ ...m.build(scan, []), margin: m.build(scan, pairs).margin }) })) },
  { rule: 'C2', what: 'a taped hallway keeps the scan margin', plant: rows((m) => (m.kind === 'passage_width' && m.restsOnTaped ? { ...m, marginIn: 1.5, marginBasis: 'scan_default', state: CORE.clearanceState(m.valueUS, 36, 'min', 1.5) } : m)) },
  { rule: 'C2', what: 'a taped hallway is not marked', plant: rows((m) => (m.kind === 'passage_width' ? { ...m, restsOnTaped: false } : m)) },
  { rule: 'C2', what: 'any taped wall tightens the hallway', plant: mod((m) => ({ build: (scan, pairs) => { const c = m.build(scan, pairs); return scan.walls.some((x) => x.lengthSource === 'typed') ? { ...c, measures: c.measures.map((x) => (x.kind === 'passage_width' ? { ...x, restsOnTaped: true, marginIn: 0.5 } : x)) } : c; } })) },
  { rule: 'C2', what: 'a taped wall tightens the toilet beside it', plant: mod((m) => ({ build: (scan, pairs) => { const c = m.build(scan, pairs); return scan.walls.some((x) => x.lengthSource === 'typed') ? { ...c, measures: c.measures.map((x) => (x.kind === 'toilet_side' ? { ...x, restsOnTaped: true, marginIn: 0.5 } : x)) } : c; } })) },
  { rule: 'C2', what: 'a typed door keeps the scan margin', plant: rows((m) => (m.kind === 'door_width' && m.restsOnTaped ? { ...m, marginIn: 1.5, state: 'close' } : m)) },
  { rule: 'C2', what: 'a typed ceiling is not marked', plant: rows((m) => (m.kind === 'ceiling_low' ? { ...m, restsOnTaped: false } : m)) },
  { rule: 'C2', what: 'a worse history widens a taped number', plant: mod((m) => ({ build: (scan, pairs) => { const c = m.build(scan, pairs); return { ...c, measures: c.measures.map((x) => (x.restsOnTaped ? { ...x, marginIn: c.margin.scanIn } : x)) }; } })) },
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
  { rule: 'W2', what: 'a door row loses its note', plant: text(HOOK, "case 'door_width': return t('office.scanClearance.note.doorNote'", "case 'door_width': return null; case 'door_width_old': return t('office.scanClearance.note.doorNote'") },
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
  { rule: 'N2', what: 'the flag is turned on', plant: mod(() => ({ flag: true })) },
  { rule: 'N2', what: 'the gate lets everyone in', plant: mod(() => ({ allowed: () => true })) },
  { rule: 'N2', what: 'the gate refuses the owner', plant: mod(() => ({ allowed: (flagOn) => flagOn === true })) },
  { rule: 'N2', what: 'the door on the plan is drawn for everyone', plant: text(FLOW, "clearance={clearanceOn ? { label: ccopy.openLabel, onPress: () => setStep('clearance') } : undefined}", "clearance={{ label: ccopy.openLabel, onPress: () => setStep('clearance') }}") },
  { rule: 'N2', what: 'the screen is drawn without the gate', plant: text(FLOW, "{step === 'clearance' && clearanceOn && scan && clearance && (", "{step === 'clearance' && scan && clearance && (") },
  { rule: 'N2', what: 'the flow decides for itself who may see it', plant: text(FLOW, 'const clearanceOn = scanRoomAllowed(userEmail);', 'const clearanceOn = true;') },
  { rule: 'N2', what: 'the check is worked out for everyone', plant: text(FLOW, '(scan && clearanceOn ? buildClearanceCheck(scan, tapePairs) : null)', '(scan ? buildClearanceCheck(scan, tapePairs) : null)') },
  { rule: 'N2', what: 'a second way into the step', plant: text(FLOW, "    else if (step === 'quantities' || step === 'clearance') setStep('plan');", "    else if (step === 'quantities') setStep('clearance');\n    else if (step === 'clearance') setStep('plan');") },
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
