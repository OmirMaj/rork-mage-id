// validate-living-model — The Living Model, Phase 1 (lane LIVINGMODEL). Dark
// behind LIVING_MODEL_ENABLED = false, with an owner preview.
//
// WHAT IT PROVES, with no browser and no phone. Every rule below has at least
// one PLANTED MUTATION (a deliberately wrong copy of the code or the words)
// that the rule must turn red; the run fails if a rule catches none.
//
// A. THE JOB MODEL (utils/livingModel/modelCore, run directly): a three-room
//    and a seven-room job match bounding boxes and areas worked out by hand; a
//    number that is not a number is an error; an open outline, an opening off
//    its wall and two rooms that overlap are warnings; rooms that only touch
//    are not mentioned; a saved scan becomes a placed room that is not
//    mirrored and keeps its numbers; a move snaps; four quarter turns come
//    back to the start; a copy takes no ticked tasks; a saved model reads back
//    whole or not at all; undo and redo.
// B. THE STAGE TABLE: every trade in types/index.ts TradeKey maps to a stage or
//    to Other Work; no task is dropped; an inspection is not a building stage.
// C. PLANNED AND REPORTED: the plan is arithmetic; Reported NEVER falls back to
//    the plan; nothing after today is drawn solid; the wall layers follow the
//    stages.
// D. THE LINKS: a suggestion is never a link until the person confirms it.
// E. THE 3D LIBRARY: `three` is loaded by ONE dynamic import, in the web-only
//    view, behind Platform.OS === 'web'. A static import anywhere fails. The
//    phone's file draws nothing. The version is pinned and the licence is MIT.
// F. THE WORDS (the English shard and the Spanish file): none of accurate,
//    exact, verified, real-time, live, as-built, digital twin or BIM; the two
//    honesty lines are present and are on both views; a scanned room carries
//    the scanner's "off by an inch or more"; Title Case labels, sentences that
//    end, no em dash, no "and" sign, no "e.g.", no arrows; English and Spanish
//    key sets, plural shapes and placeholders equal.
// G. THE GATE: the flag is false and read in one file; the owner only; the
//    route redirects before it mounts anything; one row, on the project page;
//    only a seat that may edit the schedule.
// H. STORAGE: the key is under an app-owned prefix, per person and project;
//    nothing is sent to the server; no migration.
// I. THE LOOK: theme tokens only in the components, no gradient, no blur, no
//    emoji, Lucide icons, no react-native-reanimated, Reduce Motion respected.
// J. THE 3D SHAPES, AS NUMBERS (utils/livingModel/sceneCore): a wall's pieces
//    add up to the wall less its doors and windows; the cut is the cut; pipes
//    only in wet rooms; the faint part starts where the solid part ends.
// K. REGISTRATION: the script, the gate chain, the route, the i18n surface.
//
// NOT PROVED HERE: that WebGL draws what the numbers say (looked at through a
// headless-Chrome harness, see the lane report), pointer and touch handling
// in a real browser, and the web export's chunking of the library.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEVEN_ROOM_ANSWERS, THREE_ROOM_ANSWERS, sevenRoomJob, tenWeekSchedule, threeRoomJob } from '../__tests__/fixtures/livingModelJobs';
import { EN as EN_SHARD } from '../i18n/catalog/en/office.living-model.generated';
import { ES_OFFICE_LIVING_MODEL } from '../i18n/catalog/es/office/livingModel';
import { livingModelAllowedWith, livingModelSeat } from '../utils/livingModel/allowed';
import { canRedo, canUndo, historyOf, historyPush, historyRedo, historyUndo } from '../utils/livingModel/historyCore';
import { confirmSuggestions, liveLinks, suggestLinks, type LinkTask } from '../utils/livingModel/linkCore';
import {
  GRID_M, addOpening, addRoom, deleteRoom, duplicateRoom, emptyJobModel, linkedTaskIds, makeRectRoom, modelBounds, moveRoom, openingRefusal,
  parseJobModel, polygonsOverlap, rectRoomRefusal, roomAreaM2, roomBounds, roomFromScan, rotateRoom, setRoomTaskLink, validateModel, worldFloor, worldWalls,
} from '../utils/livingModel/modelCore';
import {
  hasAnyReport, plannedAt, reportedAt, roomCard, roomLayers, roomMoment, taskMoment, weekCount, weekOf,
  type ReplayClock, type ReplayTask,
} from '../utils/livingModel/replayCore';
import { VERTS_PER_BOX, buildRoomGeometry, revealRange, roomHasPipes, triangulate, wallSpans } from '../utils/livingModel/sceneCore';
import { BUILD_STAGES, STAGE_BY_TRADE, stageForTask } from '../utils/livingModel/stageCore';
import { LIVING_MODEL_KEY_PREFIX, livingModelKey } from '../utils/livingModel/storeCore';
import type { JobModel } from '../utils/livingModel/types';
import { isAppStorageKey } from '../utils/localCacheKeys';
import { polygonArea } from '../utils/roomScan/geometryCore';
import type { RoomScan } from '../utils/roomScan/types';
import { M2_TO_SF, M_TO_FT, feetToMetres as ft } from '../utils/roomScan/units';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// ── the world a rule looks at (a mutation hands it an edited copy) ──────────

const SOURCE_DIRS = ['app', 'components', 'contexts', 'hooks', 'utils', 'constants', 'lib', 'i18n', 'stubs', 'modules', 'backend'];
function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(relative(ROOT, p));
  }
}
const ALL_SOURCE: string[] = [];
for (const d of SOURCE_DIRS) walk(join(ROOT, d), ALL_SOURCE);
for (const f of ['metro.config.js', 'babel.config.js', 'index.js', 'index.ts', 'App.tsx']) if (existsSync(join(ROOT, f))) ALL_SOURCE.push(f);

const impl = {
  reportedAt, taskMoment, roomMoment, roomLayers, plannedAt, stageForTask, suggestLinks, confirmSuggestions,
  STAGE_BY_TRADE: STAGE_BY_TRADE as Record<string, string>,
  /** What the replay reads as a room's tasks. In the app: the ticked ids still in the schedule, and nothing else. */
  tickedFor: (model: JobModel, roomId: string, tasks: readonly LinkTask[]): string[] => liveLinks(model, roomId, new Set(tasks.map((t) => t.id))).ids,
  modelBounds, roomAreaM2, validateModel, polygonsOverlap, roomFromScan, moveRoom, rotateRoom, duplicateRoom, parseJobModel,
  livingModelAllowedWith, livingModelSeat, livingModelKey, revealRange, buildRoomGeometry, wallSpans, roomHasPipes,
};
type Impl = typeof impl;
type Catalog = Record<string, unknown>;
interface World { files: Record<string, string>; EN: Catalog; ES: Catalog; impl: Impl; pkg: { scripts: Record<string, string>; dependencies: Record<string, string> } }

const files: Record<string, string> = {};
for (const f of ALL_SOURCE) files[f] = read(f);
for (const f of ['types/index.ts', 'package.json', '.github/workflows/ship-gate.yml']) if (existsSync(join(ROOT, f))) files[f] = read(f);
const esPlain: Catalog = {};
for (const [k, v] of Object.entries(ES_OFFICE_LIVING_MODEL as Record<string, { s: unknown }>)) esPlain[k] = v.s;
const WORLD: World = { files, EN: EN_SHARD as Catalog, ES: esPlain, impl, pkg: JSON.parse(read('package.json')) };

// ── small helpers ────────────────────────────────────────────────────────────

/** Source with its comments taken out, so a rule reads code and not what a comment says about it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const feet = (m: number): number => m * M_TO_FT;
const sqft = (m2: number): number => m2 * M2_TO_SF;
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v as Record<string, string>) : []);
const K = 'office.livingModel.';
const SCHEMATIC = 'Schematic made from typed and scanned sizes. Not to scale for building.';
const PROGRESS = 'Progress shown is what was reported in MAGE ID.';
const LM_COMPONENTS = (w: World): string[] => Object.keys(w.files).filter((f) => f.startsWith('components/livingModel/'));
const PURE_CORE = ['types', 'modelCore', 'historyCore', 'stageCore', 'replayCore', 'linkCore', 'sceneCore', 'planView', 'storeCore', 'allowed', 'palette'].map((n) => `utils/livingModel/${n}.ts`);

function task(id: string, title: string, stage: ReplayTask['stage'], startDay: number, durationDays: number, progress = 0, status: ReplayTask['status'] = 'not_started'): ReplayTask {
  return { id, title, stage, startDay, durationDays, progress, status, actualEndOffset: null, actualStartOffset: null };
}
const CLOCK: ReplayClock = { totalDays: 50, workingDaysPerWeek: 5, todayOffset: 28, hasStartDate: true };

/** An L-shaped scan, in the SCANNER's axes (y up), 4 m by 3 m with a 2 m by 1 m notch out of the top right. Area 10 m2. */
function lScan(): RoomScan {
  const pts = [{ x: 10, y: 5 }, { x: 14, y: 5 }, { x: 14, y: 7 }, { x: 12, y: 7 }, { x: 12, y: 8 }, { x: 10, y: 8 }];
  const walls = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { id: `w${i + 1}`, label: `Wall ${i + 1}`, a, b, lengthM: len, scanLengthM: len, lengthSource: 'scan' as const, heightM: 2.4, confidence: 'high' as const, curved: false, onOutline: true };
  });
  return {
    id: 'scan-1', projectId: 'p', name: 'Hall Bathroom', version: 1, capturedAt: '2026-10-01T12:00:00.000Z', device: { model: 'iPhone', os: '18' },
    roomType: 'bathroom', suggestedRoomType: null, walls,
    openings: [{ id: 'o1', kind: 'door', wallId: 'w1', offsetM: 0.5, widthM: 0.8, heightM: 2.03, sillM: 0, confidence: 'high', widthSource: 'scan', heightSource: 'scan' }],
    objects: [], floor: pts, closure: { closed: true, gapM: 0, gaps: 0, gapWallIds: [], cause: 'scan' },
    ceilingHeightM: { known: true, min: 2.4, max: 2.4, typical: 2.4, source: 'scan' }, warnings: [], tapeChecks: [], edits: [], rawSha256: '',
  };
}

const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'on', 'per', 'to', 'vs', 'via', 'with', 'from', 'into']);
/** docs/VOICE.md section 3, "Title Case, exactly". Placeholders, numbers and all-caps words pass as they are. */
function titleCaseProblem(label: string): string | null {
  const words = label.replace(/\{[a-zA-Z]+\}/g, 'X').split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (const part of words[i].split('-')) {
      const core = part.replace(/^[("“]+|[)"”,.:]+$/g, '');
      if (!core || !/[a-z]/i.test(core[0])) continue;
      const lower = core.toLowerCase();
      const edge = i === 0 || i === words.length - 1;
      if (!edge && SMALL.has(lower)) { if (core !== lower) return `"${core}" should be lower case in "${label}"`; continue; }
      if (core[0] !== core[0].toUpperCase()) return `"${core}" should be capitalised in "${label}"`;
    }
  }
  return null;
}

// ── the rules ────────────────────────────────────────────────────────────────

interface Rule { id: string; what: string; run: (w: World) => string[] }
const RULES: Rule[] = [];
const rule = (id: string, what: string, run: (w: World) => string[]): void => { RULES.push({ id, what, run }); };

// A. the job model
rule('A1', 'the three-room job matches its hand-worked box and areas, with nothing to warn about', (w) => {
  const out: string[] = [];
  const m = threeRoomJob();
  const b = w.impl.modelBounds(m);
  const want = THREE_ROOM_ANSWERS.boxFt;
  if (!b || !near(feet(b.minX), want.minX, 1e-4) || !near(feet(b.minY), want.minY, 1e-4) || !near(feet(b.maxX), want.maxX, 1e-4) || !near(feet(b.maxY), want.maxY, 1e-4)) out.push(`box is ${b ? [b.minX, b.minY, b.maxX, b.maxY].map((v) => feet(v).toFixed(3)).join(', ') : 'null'} ft, want 0, 0, 20, 14`);
  let total = 0;
  for (const r of m.rooms) {
    const a = w.impl.roomAreaM2(r);
    const wantA = (THREE_ROOM_ANSWERS.areasSqFt as Record<string, number>)[r.id];
    if (a == null || !near(sqft(a), wantA, 0.01)) out.push(`${r.id} is ${a == null ? 'null' : sqft(a).toFixed(2)} sq ft, want ${wantA}`);
    total += a ?? 0;
  }
  if (!near(sqft(total), THREE_ROOM_ANSWERS.totalSqFt, 0.02)) out.push(`total is ${sqft(total).toFixed(2)}, want 280`);
  const c = w.impl.validateModel(m);
  if (!c.ok || c.warnings.length) out.push(`three rooms that only touch gave ${JSON.stringify(c.warnings)}`);
  return out;
});

rule('A2', 'the seven-room job matches its hand-worked box and areas; the turned bath stands 6 by 10', (w) => {
  const out: string[] = [];
  const m = sevenRoomJob();
  const b = w.impl.modelBounds(m);
  if (!b || !near(feet(b.minX), 0, 1e-4) || !near(feet(b.minY), 0, 1e-4) || !near(feet(b.maxX), 28, 1e-4) || !near(feet(b.maxY), 28, 1e-4)) out.push('box is not 0, 0, 28, 28 ft');
  let total = 0;
  for (const r of m.rooms) {
    const a = w.impl.roomAreaM2(r);
    const wantA = (SEVEN_ROOM_ANSWERS.areasSqFt as Record<string, number>)[r.id];
    if (a == null || !near(sqft(a), wantA, 0.01)) out.push(`${r.id} is ${a == null ? 'null' : sqft(a).toFixed(2)} sq ft, want ${wantA}`);
    total += a ?? 0;
  }
  if (!near(sqft(total), 784, 0.05)) out.push(`total is ${sqft(total).toFixed(2)}, want 784`);
  const bath = roomBounds(m.rooms.find((r) => r.id === 'bath')!)!;
  if (!near(feet(bath.minX), 12, 1e-4) || !near(feet(bath.maxX), 18, 1e-4) || !near(feet(bath.minY), 18, 1e-4) || !near(feet(bath.maxY), 28, 1e-4)) out.push('the bath, typed 10 by 6 and turned, does not stand 6 by 10 at (12, 18)');
  const c = w.impl.validateModel(m);
  if (!c.ok || c.warnings.length) out.push(`seven rooms that only touch gave ${JSON.stringify(c.warnings)}`);
  return out;
});

rule('A3', 'a bad number is an error; an open outline and an overlap are warnings; touching is neither', (w) => {
  const out: string[] = [];
  const base = threeRoomJob();
  const nan: JobModel = { ...base, rooms: base.rooms.map((r, i) => (i === 0 ? { ...r, placement: { ...r.placement, xM: Number.NaN } } : r)) };
  const c1 = w.impl.validateModel(nan);
  if (c1.ok || !c1.errors.some((e) => e.code === 'not_a_number')) out.push('a NaN placement is not an error');
  const inf: JobModel = { ...base, rooms: base.rooms.map((r, i) => (i === 1 ? { ...r, room: { ...r.room, walls: r.room.walls.map((x, j) => (j === 0 ? { ...x, lengthM: Infinity } : x)) } } : r)) };
  if (w.impl.validateModel(inf).ok) out.push('an infinite wall length is not an error');
  const open: JobModel = { ...base, rooms: base.rooms.map((r, i) => (i === 0 ? { ...r, room: { ...r.room, floor: [] } } : r)) };
  const c2 = w.impl.validateModel(open);
  if (!c2.ok || !c2.warnings.some((x) => x.code === 'outline_open' && x.roomIds[0] === 'kitchen')) out.push('an open outline is not a warning');
  const over = moveRoom(base, 'bath', ft(11), 0);
  const c3 = w.impl.validateModel(over);
  const hit = c3.warnings.find((x) => x.code === 'rooms_overlap');
  if (!c3.ok || !hit || hit.roomIds.slice().sort().join() !== 'bath,kitchen') out.push(`a one foot overlap gave ${JSON.stringify(c3.warnings)}`);
  const stacked = addRoom(base, makeRectRoom({ id: 'twin', name: 'Twin', kind: 'other', widthM: ft(12), lengthM: ft(10), heightM: ft(8) }));
  if (!w.impl.validateModel(stacked).warnings.some((x) => x.code === 'rooms_overlap')) out.push('one room exactly on another is not an overlap');
  const upstairs: JobModel = { ...stacked, rooms: stacked.rooms.map((r) => (r.id === 'twin' ? { ...r, level: 1 } : r)) };
  if (w.impl.validateModel(upstairs).warnings.some((x) => x.code === 'rooms_overlap')) out.push('rooms on different floors were called overlapping');
  const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  if (w.impl.polygonsOverlap(sq(0, 0, 2), sq(2, 0, 2))) out.push('two squares sharing an edge were called overlapping');
  if (w.impl.polygonsOverlap(sq(0, 0, 2), sq(2, 2, 2))) out.push('two squares sharing a corner were called overlapping');
  if (!w.impl.polygonsOverlap(sq(0, 0, 2), sq(1, 1, 2))) out.push('two squares that cross were not called overlapping');
  if (!w.impl.polygonsOverlap(sq(0, 0, 4), sq(1, 1, 1))) out.push('a square inside another was not called overlapping');
  const dup: JobModel = { ...base, rooms: [...base.rooms, base.rooms[0]] };
  if (!w.impl.validateModel(dup).errors.some((e) => e.code === 'duplicate_room_id')) out.push('two rooms with one id are not an error');
  return out;
});

rule('A4', 'a saved scan becomes a placed room: not mirrored, its numbers kept, the scanner types reused', (w) => {
  const out: string[] = [];
  const scan = lScan();
  const r = w.impl.roomFromScan(scan, { id: 'r1', level: 0, placement: { xM: 3, yM: 4 } });
  if (r.source !== 'scan' || r.scanId !== 'scan-1' || r.name !== 'Hall Bathroom' || r.kind !== 'bathroom') out.push('the scan lost its source, id, name or kind');
  const a = roomAreaM2(r);
  if (a == null || !near(a, 10, 1e-9)) out.push(`floor area is ${a}, want 10 m2`);
  r.room.walls.forEach((x, i) => { if (!near(x.lengthM, scan.walls[i].lengthM) || !near(Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y), scan.walls[i].lengthM, 1e-9)) out.push(`wall ${i + 1} changed length`); });
  if (r.room.openings[0].offsetM !== 0.5 || r.room.openings[0].widthM !== 0.8 || r.room.openings[0].wallId !== 'w1') out.push('the door moved or changed');
  const b = roomBounds(r);
  if (!b || !near(b.minX, 3) || !near(b.minY, 4) || !near(b.maxX, 7) || !near(b.maxY, 7)) out.push(`the placed box is ${JSON.stringify(b)}, want 3, 4 to 7, 7`);
  // Not mirrored. In the scan (y up) the notch is out of the TOP RIGHT. Drawn with y down, the top right of the box must be empty and the bottom right full.
  const floor = worldFloor(r);
  const inside = (x: number, y: number): boolean => { let c = false; for (let i = 0, j = floor.length - 1; i < floor.length; j = i++) { const p = floor[i]; const q = floor[j]; if ((p.y > y) !== (q.y > y) && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) c = !c; } return c; };
  if (inside(6.5, 4.5)) out.push('the notch is not at the top right: the room is drawn mirrored or upside down');
  if (!inside(6.5, 6.5) || !inside(3.5, 4.5)) out.push('floor is missing where the scan has floor');
  // The door is on the scan's bottom wall (y = 5 with y up), so it must be on the bottom edge of the drawing.
  const door = worldWalls(r).find((x) => x.openings.length > 0);
  if (!door || !near(door.a.y, 7) || !near(door.b.y, 7)) out.push('the wall with the door is not along the bottom of the drawing');
  if (!/Pick<RoomScan, /.test(w.files['utils/livingModel/types.ts']) || !/from '@\/utils\/roomScan\/types'/.test(w.files['utils/livingModel/types.ts'])) out.push('RoomShape is not a Pick of the scanner\'s RoomScan');
  if (/interface\s+(ScanWall|ScanOpening|ScanObject|CeilingHeight)\b/.test(w.files['utils/livingModel/types.ts'])) out.push('the scanner\'s wall or opening type is declared a second time');
  return out;
});

rule('A5', 'a move snaps to six inches; four quarter turns return; a copy takes no ticked tasks; a delete takes its ticks', (w) => {
  const out: string[] = [];
  const base = sevenRoomJob();
  const moved = w.impl.moveRoom(base, 'bed2', ft(40.2), ft(3.3));
  const p = moved.rooms.find((r) => r.id === 'bed2')!.placement;
  if (!near(feet(p.xM), 40, 1e-6) || !near(feet(p.yM), 3.5, 1e-6)) out.push(`a move to 40.2, 3.3 ft landed on ${feet(p.xM).toFixed(3)}, ${feet(p.yM).toFixed(3)}; want 40, 3.5`);
  if (!near(GRID_M, ft(0.5))) out.push('the snap is not six inches');
  let turned = base;
  const before = roomBounds(base.rooms.find((r) => r.id === 'living')!)!;
  turned = w.impl.rotateRoom(turned, 'living');
  const once = roomBounds(turned.rooms.find((r) => r.id === 'living')!)!;
  if (!near(once.minX, before.minX) || !near(once.minY, before.minY)) out.push('a turn moved the top left corner');
  if (!near(feet(once.maxX - once.minX), 14, 1e-4) || !near(feet(once.maxY - once.minY), 16, 1e-4)) out.push('a quarter turn of a 16 by 14 room is not 14 by 16');
  for (let i = 0; i < 3; i++) turned = w.impl.rotateRoom(turned, 'living');
  const back = worldFloor(turned.rooms.find((r) => r.id === 'living')!);
  const start = worldFloor(base.rooms.find((r) => r.id === 'living')!);
  if (!start.every((s) => back.some((q) => near(q.x, s.x, 1e-9) && near(q.y, s.y, 1e-9)))) out.push('four quarter turns did not come back to the start');
  const copy = w.impl.duplicateRoom(base, 'kitchen', 'kitchen-2', 'Kitchen Copy');
  const twin = copy.rooms.find((r) => r.id === 'kitchen-2');
  if (!twin) out.push('duplicate made no room');
  else {
    if (linkedTaskIds(copy, 'kitchen-2').length !== 0) out.push('the copy took the original\'s ticked tasks');
    if (linkedTaskIds(copy, 'kitchen').length !== linkedTaskIds(base, 'kitchen').length) out.push('duplicating changed the original\'s ticks');
    const ids = new Set(base.rooms.flatMap((r) => [...r.room.walls.map((x) => x.id), ...r.room.openings.map((x) => x.id)]));
    if ([...twin.room.walls.map((x) => x.id), ...twin.room.openings.map((x) => x.id)].some((id) => ids.has(id))) out.push('the copy shares a wall or opening id with another room');
    if (twin.room.openings.some((o) => !twin.room.walls.some((x) => x.id === o.wallId))) out.push('an opening on the copy points at the original\'s wall');
  }
  const gone = deleteRoom(base, 'bath');
  if (gone.rooms.some((r) => r.id === 'bath') || 'bath' in gone.links) out.push('delete left the room or its ticks');
  // openings
  const one = addRoom(emptyJobModel('p'), makeRectRoom({ id: 'r', name: 'Room', kind: 'other', widthM: ft(10), lengthM: ft(8), heightM: ft(8) }));
  if (openingRefusal(one, { roomId: 'r', wallId: 'r-w1', kind: 'door', widthM: ft(11) }) !== 'wider_than_wall') out.push('a door wider than its wall was not refused');
  const d1 = addOpening(one, { roomId: 'r', wallId: 'r-w1', id: 'd1', kind: 'door', widthM: ft(3) });
  const o1 = d1.rooms[0].room.openings[0];
  if (!o1 || !near(feet(o1.offsetM), 3.5, 1e-6)) out.push('a 3 ft door on a 10 ft wall is not centred at 3.5 ft');
  const d2 = addOpening(d1, { roomId: 'r', wallId: 'r-w1', id: 'd2', kind: 'window', widthM: ft(3) });
  const [p1, p2] = d2.rooms[0].room.openings;
  if (!p2 || !(p2.offsetM + p2.widthM <= p1.offsetM + 1e-9 || p2.offsetM >= p1.offsetM + p1.widthM - 1e-9)) out.push('a second opening landed on the first');
  if (p2 && (p2.sillM <= 0 || p2.sillM + p2.heightM > ft(8))) out.push('a window has no sill or runs through the ceiling');
  if (rectRoomRefusal({ name: ' ', widthM: 3, lengthM: 3, heightM: 2.4 }) !== 'name_missing') out.push('a room with no name was not refused');
  if (rectRoomRefusal({ name: 'A', widthM: Number.NaN, lengthM: 3, heightM: 2.4 }) !== 'bad_width') out.push('a NaN width was not refused');
  // history
  let h = historyOf(one);
  h = historyPush(h, d1);
  h = historyPush(h, d2);
  if (historyPush(h, d2) !== h) out.push('a refused edit (the same model back) was recorded');
  const u = historyUndo(h);
  if (u.present !== d1 || !canRedo(u) || !canUndo(u)) out.push('undo did not step back one change');
  if (historyRedo(u).present !== d2) out.push('redo did not step forward');
  if (canRedo(historyPush(u, one))) out.push('a new change kept the undone future');
  return out;
});

rule('A6', 'a saved model reads back whole, and anything else reads back as nothing', (w) => {
  const out: string[] = [];
  const m = sevenRoomJob();
  const back = w.impl.parseJobModel(JSON.stringify(m), 'p-seven');
  if (!back || back.rooms.length !== 7 || JSON.stringify(back.links) !== JSON.stringify(m.links)) out.push('a round trip lost rooms or ticks');
  if (w.impl.parseJobModel(JSON.stringify(m), 'another-project') !== null) out.push('another project\'s model was read');
  if (w.impl.parseJobModel('{"version":1', 'p-seven') !== null || w.impl.parseJobModel(null, 'p-seven') !== null) out.push('broken JSON or nothing was read as a model');
  const bad = JSON.stringify({ ...m, rooms: m.rooms.map((r, i) => (i === 0 ? { ...r, placement: { ...r.placement, xM: null } } : r)) });
  if (w.impl.parseJobModel(bad, 'p-seven') !== null) out.push('a model with a missing number was read');
  return out;
});

// B. the stage table
rule('B1', 'every trade in types/index.ts TradeKey maps to a stage or to Other Work, and no trade is made up', (w) => {
  const out: string[] = [];
  const m = /export type TradeKey =([^;]+);/.exec(w.files['types/index.ts']);
  const trades = m ? Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]) : [];
  if (trades.length < 10) return ['could not read TradeKey out of types/index.ts'];
  const allowed = new Set<string>([...BUILD_STAGES, 'other']);
  for (const t of trades) {
    if (!(t in w.impl.STAGE_BY_TRADE)) out.push(`trade "${t}" has no row in STAGE_BY_TRADE: its tasks would be dropped`);
    else if (!allowed.has(w.impl.STAGE_BY_TRADE[t])) out.push(`trade "${t}" maps to "${w.impl.STAGE_BY_TRADE[t]}", which is not a stage`);
  }
  for (const t of Object.keys(w.impl.STAGE_BY_TRADE)) if (!trades.includes(t)) out.push(`STAGE_BY_TRADE has "${t}", which is not a trade in the app`);
  return out;
});

rule('B2', 'the words table reads plain task names; a task that fits nothing is Other Work, never dropped', (w) => {
  const out: string[] = [];
  const cases: [string, string, string][] = [
    ['Demo kitchen', 'general', 'demolition'], ['Tear out old tile', 'finish', 'demolition'], ['Framing', 'framing', 'framing'],
    ['Frame new wall', 'general', 'framing'], ['Rough plumbing', 'plumbing', 'rough_in'], ['Electrical rough-in', 'electrical', 'rough_in'],
    ['Run ductwork', 'hvac', 'rough_in'], ['Insulation', 'general', 'insulation'], ['Hang drywall', 'finish', 'drywall'], ['Tape and mud', 'general', 'drywall'],
    ['Paint', 'finish', 'finishes'], ['Tile shower', 'finish', 'finishes'], ['Install cabinets', 'general', 'finishes'], ['Finish electrical', 'electrical', 'finishes'],
    ['Plumbing fixtures', 'plumbing', 'finishes'], ['Plumbing', 'plumbing', 'rough_in'], ['Steel beam', 'steel', 'framing'], ['Site work', 'demo', 'demolition'],
    ['Pour footings', 'concrete', 'other'], ['Shingles', 'roofing', 'other'], ['Sod', 'landscaping', 'other'], ['Coordination', 'general', 'other'], ['Final walk', 'closeout', 'other'],
  ];
  for (const [title, trade, want] of cases) {
    const got = w.impl.stageForTask(title, trade as never).stage;
    if (got !== want) out.push(`"${title}" (${trade}) is ${got}, want ${want}`);
  }
  const allowed = new Set<string>([...BUILD_STAGES, 'other']);
  for (const title of ['', null, undefined, '???', '12345', 'Zzz']) {
    const a = w.impl.stageForTask(title as string | null, null);
    if (!a || !allowed.has(a.stage)) out.push(`a task named ${JSON.stringify(title)} came back with no stage`);
    else if (a.stage !== 'other') out.push(`a task named ${JSON.stringify(title)} was guessed to be ${a.stage}`);
  }
  // Counted, not dropped: a room whose only task is Other Work still has one task and can move.
  const other = [task('x', 'Coordination', 'other', 1, 10, 50, 'in_progress')];
  const rm = w.impl.roomMoment(other, [], 28, CLOCK, 'reported');
  if (rm.taskCount !== 1 || rm.stage !== 'other' || !near(rm.overall, 0.5)) out.push(`a room with one Other Work task reads ${rm.stage}, ${rm.taskCount} tasks, ${rm.overall}`);
  return out;
});

rule('B3', 'an inspection, a delivery or a punch list is not a building stage, whatever its trade', (w) => {
  const out: string[] = [];
  for (const [title, trade] of [['Rough inspection', 'electrical'], ['Framing inspection', 'framing'], ['Order cabinets', 'finish'], ['Drywall delivery', 'finish'], ['Punch list', 'finish'], ['Plumbing permit', 'plumbing'], ['Final clean-up', 'general']] as const) {
    const a = w.impl.stageForTask(title, trade);
    if (a.stage !== 'other') out.push(`"${title}" was put in ${a.stage}`);
  }
  return out;
});

// C. planned and reported
rule('C1', 'the plan is arithmetic on the schedule', (w) => {
  const out: string[] = [];
  const dry = task('dry', 'Drywall', 'drywall', 24, 8);
  if (!near(w.impl.plannedAt(dry, 28), 0.625)) out.push(`drywall, days 24 to 31, at the end of day 28 is ${w.impl.plannedAt(dry, 28)}, want 0.625`);
  if (w.impl.plannedAt(dry, 23) !== 0 || w.impl.plannedAt(dry, 31) !== 1 || w.impl.plannedAt(dry, 99) !== 1 || w.impl.plannedAt(dry, 0) !== 0) out.push('the plan is not held between 0 and 1');
  if (weekCount(CLOCK) !== 10 || weekOf(0, CLOCK) !== 1 || weekOf(5, CLOCK) !== 1 || weekOf(5.1, CLOCK) !== 2 || weekOf(50, CLOCK) !== 10) out.push('weeks are miscounted');
  return out;
});

rule('C2', 'Reported never falls back to the plan', (w) => {
  const out: string[] = [];
  // Planned to be finished three weeks ago. Nothing reported.
  const silent = task('s', 'Framing', 'framing', 1, 5);
  for (const at of [0, 3, 5, 10, 28, 40, 50]) {
    const v = w.impl.reportedAt(silent, [], at, 28);
    if (v !== 0) out.push(`a task with nothing reported reads ${v} at day ${at}`);
    const m = w.impl.taskMoment(silent, [], at, CLOCK, 'reported');
    if (m.solid !== 0) out.push(`a task with nothing reported is drawn solid at ${m.solid} on day ${at}`);
  }
  if (hasAnyReport(silent, [])) out.push('a task with nothing reported is said to have a report');
  const rm = w.impl.roomMoment([silent], [], 28, CLOCK, 'reported');
  if (rm.overall !== 0 || rm.unreported !== 1 || rm.stage !== 'not_started') out.push(`a room whose only task has nothing reported reads ${rm.stage}, ${rm.overall}, ${rm.unreported} unreported`);
  const planned = w.impl.roomMoment([silent], [], 28, CLOCK, 'planned');
  if (planned.overall !== 1 || planned.stage !== 'done') out.push('the same room in Planned is not at its plan (the test needs the two to differ)');
  const card = roomCard([silent], [], CLOCK);
  if (card.rows[0].reportedPct !== null) out.push(`the room card shows ${card.rows[0].reportedPct} percent for a task with nothing reported`);
  if (card.rows[0].plannedPctToday !== 100) out.push('the room card lost the planned percent');
  // On the fixture job: the four later tasks have nothing reported, in every room.
  const s = tenWeekSchedule();
  for (const id of ['tile', 'paint', 'trim', 'cab', 'clean']) {
    const t = s.tasks.find((x) => x.id === id)!;
    if (w.impl.reportedAt(t, s.points, 50, s.clock.todayOffset) !== 0) out.push(`${id} has nothing reported and reads above 0`);
  }
  return out;
});

rule('C3', 'Reported is the daily reports by their dates, then the schedule\'s own progress from today', (w) => {
  const out: string[] = [];
  const s = tenWeekSchedule();
  const frame = s.tasks.find((t) => t.id === 'frame')!;
  const R = (at: number) => w.impl.reportedAt(frame, s.points, at, s.clock.todayOffset);
  if (R(8) !== 0) out.push(`framing before its first daily report reads ${R(8)}`);
  if (!near(R(9), 0.5) || !near(R(12.9), 0.5)) out.push('framing does not hold at the 50 percent a daily report gave it');
  if (R(13) !== 1 || R(28) !== 1) out.push('framing is not finished from the day a daily report said 100');
  const dry = s.tasks.find((t) => t.id === 'dry')!;
  const D = (at: number) => w.impl.reportedAt(dry, s.points, at, s.clock.todayOffset);
  if (!near(D(27), 0.2)) out.push(`drywall the day of its daily report reads ${D(27)}, want 0.2`);
  if (!near(D(28), 0.3)) out.push(`drywall today reads ${D(28)}, want the schedule's 30`);
  if (!near(D(45), 0.3)) out.push('a moment after today is not read as today');
  const undated = task('u', 'Paint', 'finishes', 1, 5, 60, 'in_progress');
  if (w.impl.reportedAt(undated, [], 20, 28) !== 0) out.push('progress with no date was shown before today');
  if (!near(w.impl.reportedAt(undated, [], 28, 28), 0.6)) out.push('the schedule\'s own progress is not shown today');
  const ended: ReplayTask = { ...task('e', 'Demo', 'demolition', 1, 5), actualEndOffset: 6 };
  if (w.impl.reportedAt(ended, [], 5, 28) !== 0 || w.impl.reportedAt(ended, [], 6, 28) !== 1) out.push('an actual finish does not count from its day');
  return out;
});

rule('C4', 'nothing after today is drawn solid: it is held at today, and the plan ahead is faint', (w) => {
  const out: string[] = [];
  const s = tenWeekSchedule();
  for (const mode of ['planned', 'reported'] as const) {
    for (const t of s.tasks) {
      const today = w.impl.taskMoment(t, s.points, s.clock.todayOffset, s.clock, mode);
      if (today.ghost !== today.solid) out.push(`${t.id} (${mode}) has a faint part today`);
      for (const at of [30, 40, 50]) {
        const m = w.impl.taskMoment(t, s.points, at, s.clock, mode);
        if (!near(m.solid, today.solid)) out.push(`${t.id} (${mode}) is drawn solid at ${m.solid} on day ${at}; today it is ${today.solid}`);
        if (m.ghost < m.solid - 1e-9) out.push(`${t.id} (${mode}) has a faint part behind its solid part`);
        if (!near(m.ghost, Math.max(m.solid, plannedAt(t, at)))) out.push(`${t.id} (${mode}) faint part on day ${at} is not the plan`);
      }
    }
  }
  const tile = s.tasks.find((t) => t.id === 'tile')!;
  if (w.impl.taskMoment(tile, s.points, 50, s.clock, 'planned').solid !== 0) out.push('a task planned for next month is drawn solid at the end of the job');
  const bath = s.tasks.filter((t) => sevenRoomJob().links.bath.includes(t.id));
  const end = w.impl.roomMoment(bath, s.points, 50, s.clock, 'reported');
  if (end.stage !== 'drywall' || end.ghostStage !== 'done') out.push(`at the end of the job the bath reads ${end.stage} solid and ${end.ghostStage} faint; want drywall and done`);
  return out;
});

rule('C5', 'the wall layers follow the stages', (w) => {
  const out: string[] = [];
  const none = { demolition: null, framing: null, rough_in: null, insulation: null, drywall: null, finishes: null, other: null };
  const L = w.impl.roomLayers;
  const paintOnly = L({ ...none, finishes: 0.5 });
  if (paintOnly.skin !== 1 || paintOnly.studs !== 0 || paintOnly.finish !== 0.5) out.push('a room with only finishes opened its walls');
  const gut = L({ ...none, demolition: 0.4, framing: 0, rough_in: 0, drywall: 0, finishes: 0 });
  if (!near(gut.skin, 0.6) || gut.studs !== 0) out.push('demolition at 40 does not leave 60 of the old wall');
  const rough = L({ ...none, demolition: 1, framing: 1, rough_in: 0.5, insulation: 0, drywall: 0, finishes: 0 });
  if (rough.skin !== 0 || rough.studs !== 1 || rough.roughIn !== 0.5 || rough.board !== 0) out.push('rough-in at 50 is not an open wall with half its pipes and wires');
  const noDemo = L({ ...none, rough_in: 0, finishes: 0 });
  if (noDemo.skin !== 1) out.push('a wall with no demolition task came off before any work began');
  const noDemoBegun = L({ ...none, rough_in: 0.2, finishes: 0 });
  if (noDemoBegun.skin !== 0 || noDemoBegun.studs !== 1) out.push('a wall with rough-in under way is not shown open');
  const closed = L({ ...none, rough_in: 1, finishes: 0.3 });
  if (closed.board !== 1) out.push('a room with no drywall task is not shown closed once finishes begin');
  const dry = L({ ...none, framing: 1, rough_in: 1, drywall: 0.3, finishes: 0 });
  if (!near(dry.board, 0.3)) out.push('drywall at 30 is not 30 of the board');
  return out;
});

// D. the links
rule('D1', 'a suggestion is never a link until the person confirms it', (w) => {
  const out: string[] = [];
  const tasks: LinkTask[] = [
    { id: 't1', title: 'Demo kitchen', trade: 'demo' }, { id: 't2', title: 'Rough plumbing', trade: 'plumbing' },
    { id: 't3', title: 'Kitchen cabinets', trade: 'finish' }, { id: 't4', title: 'Roof repair', trade: 'roofing' }, { id: 't5', title: 'Paint bedrooms', trade: 'finish' },
  ];
  const model = addRoom(emptyJobModel('p'), makeRectRoom({ id: 'k', name: 'Kitchen', kind: 'kitchen', widthM: ft(12), lengthM: ft(10), heightM: ft(8) }));
  const frozen = JSON.stringify(model);
  const sug = w.impl.suggestLinks(model.rooms[0], tasks, []);
  if (sug.map((s) => s.taskId).sort().join() !== 't1,t2,t3') out.push(`the kitchen was suggested ${sug.map((s) => s.taskId).join()}, want t1, t2, t3`);
  if (sug.find((s) => s.taskId === 't2')?.reason !== 'trade' || sug.find((s) => s.taskId === 't1')?.reason !== 'room_name') out.push('a suggestion does not say why it was made');
  if (JSON.stringify(model) !== frozen) out.push('suggesting changed the model');
  if (linkedTaskIds(model, 'k').length !== 0) out.push('a suggested task is in the room\'s ticked list');
  const read = w.impl.tickedFor(model, 'k', tasks);
  if (read.length !== 0) out.push(`the replay reads ${read.length} tasks for a room with none ticked: a suggestion was applied without the person`);
  const rt = read.map((id) => task(id, id, 'finishes', 1, 5, 100, 'done'));
  if (w.impl.roomMoment(rt, [], 28, CLOCK, 'planned').stage !== 'no_tasks') out.push('a room with only suggestions is coloured');
  const done = w.impl.confirmSuggestions(model, 'k', sug.map((s) => s.taskId));
  if (linkedTaskIds(done, 'k').slice().sort().join() !== 't1,t2,t3') out.push('confirming did not tick the suggested tasks');
  if (w.impl.suggestLinks(done.rooms[0], tasks, linkedTaskIds(done, 'k')).length !== 0) out.push('a ticked task is still suggested');
  const un = setRoomTaskLink(done, 'k', 't2', false);
  if (linkedTaskIds(un, 'k').includes('t2')) out.push('a tick could not be taken off');
  if (liveLinks(done, 'k', new Set(['t1'])).gone !== 2) out.push('ticks for tasks no longer in the schedule are not counted as gone');
  return out;
});

rule('D2', 'only the Confirm Suggested button applies suggestions, and nothing but the tick list reads links', (w) => {
  const out: string[] = [];
  const callers = Object.keys(w.files).filter((f) => f !== 'utils/livingModel/linkCore.ts' && /\bconfirmSuggestions\s*\(/.test(code(w.files[f])));
  if (callers.join() !== 'components/livingModel/TaskLinks.tsx') out.push(`confirmSuggestions is called from ${callers.join(', ') || 'nowhere'}; want only TaskLinks.tsx`);
  const tl = w.files['components/livingModel/TaskLinks.tsx'] ?? '';
  const calls = tl.match(/confirmSuggestions\s*\(/g) ?? [];
  if (calls.length !== 1 || !/onPress=\{\(\) => onChange\(confirmSuggestions\(/.test(tl)) out.push('confirmSuggestions is not called from exactly one onPress');
  if (/useEffect[\s\S]{0,400}confirmSuggestions/.test(tl)) out.push('confirmSuggestions is called from an effect');
  const suggesters = Object.keys(w.files).filter((f) => f !== 'utils/livingModel/linkCore.ts' && /\bsuggestLinks\s*\(/.test(code(w.files[f])));
  if (suggesters.join() !== 'components/livingModel/TaskLinks.tsx') out.push(`suggestLinks is called from ${suggesters.join(', ')}; the replay must never see a suggestion`);
  const core = w.files['utils/livingModel/linkCore.ts'];
  const body = core.slice(core.indexOf('export function suggestLinks'), core.indexOf('export function confirmSuggestions'));
  if (/setRoomTaskLink|\.links\[/.test(body)) out.push('suggestLinks writes a link');
  return out;
});

// E. the 3D library
const THREE_SPEC = /['"]three(?:\/[^'"]*)?['"]/;
rule('E1', 'no file imports the 3D library with a static import or a require', (w) => {
  const out: string[] = [];
  for (const [f, src] of Object.entries(w.files)) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) || f === 'utils/livingModel/three-shim.d.ts') continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!THREE_SPEC.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (/\bfrom\s+['"]three(?:\/[^'"]*)?['"]/.test(line) || /^\s*import\s+['"]three/.test(line) || /\brequire\s*\(\s*['"]three/.test(line)) out.push(`${f}:${i + 1} imports the 3D library statically`);
    });
  }
  return out;
});

rule('E2', 'the 3D library is loaded by ONE dynamic import, in the web-only view, behind Platform.OS === \'web\'', (w) => {
  const out: string[] = [];
  const hits: string[] = [];
  for (const [f, src] of Object.entries(w.files)) {
    if (!/\.(ts|tsx|js|jsx)$/.test(f) || f.endsWith('.d.ts')) continue;
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const all = code.match(/import\s*\(\s*['"]three(?:\/[^'"]*)?['"]\s*\)/g) ?? [];
    const typeOnly = code.match(/typeof\s+import\s*\(\s*['"]three['"]\s*\)/g) ?? [];
    for (let i = 0; i < all.length - typeOnly.length; i++) hits.push(f);
  }
  if (hits.join() !== 'components/livingModel/JobReplay3D.web.tsx') out.push(`the library is loaded from ${hits.join(', ') || 'nowhere'}; want once, from JobReplay3D.web.tsx`);
  const web = w.files['components/livingModel/JobReplay3D.web.tsx'] ?? '';
  const fn = /function loadThree\(\)[^{]*\{([\s\S]*?)\n\}/.exec(web);
  if (!fn) out.push('loadThree is missing');
  else {
    const guard = fn[1].indexOf("Platform.OS !== 'web'");
    const load = fn[1].search(/return import\(\s*'three'\s*\)/);
    if (guard < 0 || load < 0 || guard > load || !/Platform\.OS !== 'web'\) return Promise\.reject/.test(fn[1])) out.push('the load is not behind Platform.OS === \'web\'');
  }
  const eff = web.indexOf('useEffect(');
  if (eff < 0 || web.indexOf('loadThree()', eff) < 0) out.push('the library is not loaded from an effect when the view opens');
  if (/^(?:const|let|var)\s[^\n]*loadThree\(\)|^void loadThree\(\)|^loadThree\(\)/m.test(web)) out.push('the library is loaded at module scope');
  return out;
});

rule('E3', 'the phone\'s file for the 3D view draws nothing and reaches no 3D code; the scene builder has one importer', (w) => {
  const out: string[] = [];
  const phone = w.files['components/livingModel/JobReplay3D.tsx'] ?? '';
  if (!phone) return ['components/livingModel/JobReplay3D.tsx is missing: the phone would bundle the web view'];
  if (/threeScene|sceneCore|import\s*\(/.test(phone.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))) out.push('the phone file reaches 3D code');
  if (!/JOB_REPLAY_3D_ON_THIS_PLATFORM = false/.test(phone) || !/return null;/.test(phone)) out.push('the phone file does not say it draws nothing');
  if (!/JOB_REPLAY_3D_ON_THIS_PLATFORM = true/.test(w.files['components/livingModel/JobReplay3D.web.tsx'] ?? '')) out.push('the web file does not say it draws');
  const importers = Object.keys(w.files).filter((f) => /from ['"](\.\/|@\/components\/livingModel\/)threeScene['"]/.test(w.files[f]));
  if (importers.join() !== 'components/livingModel/JobReplay3D.web.tsx') out.push(`threeScene is imported by ${importers.join(', ') || 'nobody'}; want only the web view`);
  for (const [f, src] of Object.entries(w.files)) {
    if (/JobReplay3D\.web['"]/.test(src)) out.push(`${f} imports the web file by its full name, so the phone would bundle it`);
  }
  const scene = w.files['components/livingModel/threeScene.ts'] ?? '';
  if (!/type Three = typeof import\('three'\);/.test(scene) || !/export function createJobScene\(THREE: Three,/.test(scene)) out.push('the scene builder does not take the library as an argument');
  return out;
});

rule('E4', '`three` is pinned to one version, and its licence is MIT', (w) => {
  const out: string[] = [];
  const v = w.pkg.dependencies.three;
  if (!v) out.push('three is not a dependency');
  else if (!/^\d+\.\d+\.\d+$/.test(v)) out.push(`three is "${v}": not pinned to one version`);
  const p = join(ROOT, 'node_modules', 'three', 'package.json');
  if (!existsSync(p)) out.push('node_modules/three is not installed, so its licence cannot be read');
  else {
    const meta = JSON.parse(readFileSync(p, 'utf8')) as { license?: string; version?: string };
    if (meta.license !== 'MIT') out.push(`three's licence reads "${meta.license}"`);
    if (v && meta.version !== v) out.push(`three ${meta.version} is installed; package.json pins ${v}`);
  }
  for (const banned of ['@react-three/fiber', '@react-three/drei', 'expo-gl', 'expo-three', '@types/three', 'react-native-webview', '@shopify/react-native-skia']) {
    if (banned in w.pkg.dependencies) out.push(`${banned} was added: three is the only new dependency this phase allows`);
  }
  return out;
});

rule('E5', 'the pure core imports no React, no React Native, no storage and no 3D library', (w) => {
  const out: string[] = [];
  for (const f of PURE_CORE) {
    const src = w.files[f];
    if (!src) { out.push(`${f} is missing`); continue; }
    const bad = src.match(/from ['"](react|react-native|react-native-svg|expo-[a-z-]+|@react-native-async-storage\/async-storage|@\/lib\/supabase|@\/contexts\/[A-Za-z]+)['"]/);
    if (bad) out.push(`${f} imports ${bad[1]}`);
  }
  return out;
});

// F. the words
const BANNED_EN = /\baccurate|\baccuracy|\bexact|\bprecise|\bprecision|\bverified\b|\bverify|real[- ]time|\blive\b|as[- ]built|digital twin|\bBIM\b|\bguarantee/i;
const BANNED_ES = /\bexact[oa]|\bprecis[oa]|\bprecisión|\bverificad|tiempo real|\ben vivo\b|\ben directo\b|conforme a obra|como se construyó|gemelo digital|\bBIM\b|\bgarantiz|\bgarantía/i;
rule('F1', 'no accurate, exact, verified, real-time, live, as-built, digital twin or BIM, in English or in Spanish', (w) => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(w.EN)) for (const s of strings(v)) { const m = BANNED_EN.exec(s); if (m) out.push(`English ${k} says "${m[0]}"`); }
  for (const [k, v] of Object.entries(w.ES)) for (const s of strings(v)) { const m = BANNED_ES.exec(s) ?? BANNED_EN.exec(s); if (m) out.push(`Spanish ${k} says "${m[0]}"`); }
  return out;
});

rule('F2', 'the two honesty lines are the exact sentences, in English, and Spanish has both', (w) => {
  const out: string[] = [];
  if (w.EN[`${K}honesty.schematicBody`] !== SCHEMATIC) out.push(`the schematic line reads ${JSON.stringify(w.EN[`${K}honesty.schematicBody`])}`);
  if (w.EN[`${K}honesty.progressBody`] !== PROGRESS) out.push(`the progress line reads ${JSON.stringify(w.EN[`${K}honesty.progressBody`])}`);
  const es1 = String(w.ES[`${K}honesty.schematicBody`] ?? '');
  const es2 = String(w.ES[`${K}honesty.progressBody`] ?? '');
  if (!/esquema/i.test(es1) || !/no está a escala para construir/i.test(es1)) out.push('the Spanish schematic line does not say schematic and not to scale for building');
  if (!/report/i.test(es2) || !/MAGE ID/.test(es2)) out.push('the Spanish progress line does not say it is what was reported in MAGE ID');
  return out;
});

rule('F3', 'both honesty lines are on the 3D view, the flat view and the editor, at all times', (w) => {
  const out: string[] = [];
  const h = w.files['components/livingModel/HonestyLines.tsx'] ?? '';
  if (!/\{copy\.schematicBody\}/.test(h) || !/copy\.progressBody/.test(h)) out.push('HonestyLines does not print both lines');
  if (/\?\s*<Text[^>]*>\{copy\.schematicBody\}|schematicBody[^\n]*:\s*null|&&\s*<Text[^>]*>\{copy\.schematicBody\}/.test(h)) out.push('the schematic line is drawn only some of the time');
  const s = w.files['components/livingModel/LivingModelScreen.tsx'] ?? '';
  const replay = s.slice(s.indexOf('function ReplayTab'));
  if (!/<HonestyLines ghost=\{past\} testID=\{threeD \? 'lm-honesty-3d' : 'lm-honesty-flat'\} \/>/.test(replay)) out.push('the replay does not draw the honesty lines under both the 3D and the flat view');
  const viewBlock = replay.slice(replay.indexOf('const view = ('), replay.indexOf('const side = ('));
  if (!/<HonestyLines/.test(viewBlock) || /\{[^{}\n]*(&&|\?)[^{}\n]*<HonestyLines/.test(viewBlock)) out.push('the honesty lines in the replay sit behind a condition');
  if (!/<HonestyLines testID="lm-honesty-rooms" \/>/.test(s)) out.push('the Room Editor view has no honesty lines');
  if (!/<HonestyLines \/>/.test(replay.slice(0, replay.indexOf('const view = (')))) out.push('the empty replay has no honesty lines');
  return out;
});

rule('F4', 'a scanned room carries the scanner\'s own "off by an inch or more", and the device-only line is shown', (w) => {
  const out: string[] = [];
  const caveat = String(w.EN[`${K}honesty.scanCaveatBody`] ?? '');
  if (!caveat.includes('A phone scan can be off by an inch or more.')) out.push('the scan line does not say a phone scan can be off by an inch or more');
  const scanner = w.files['hooks/useRoomScanCopy.ts'] ?? '';
  if (!scanner.includes('A phone scan can be off by an inch or more.')) out.push('the scanner no longer says that sentence, so this is no longer the scanner\'s own line');
  for (const f of ['components/livingModel/RoomEditor.tsx', 'components/livingModel/replayShared.tsx']) {
    if (!/room\.source === 'scan' \? <Text[^>]*>\{copy\.scanCaveatBody\}<\/Text> : null/.test(w.files[f] ?? '')) out.push(`${f} does not show the scan line on a scanned room`);
  }
  if (w.EN[`${K}honesty.savedLocalBody`] !== 'Saved on this device only for now.') out.push('the device-only line changed');
  if (!/<Text[^>]*testID="lm-saved-local">\{copy\.savedLocalBody\}<\/Text>/.test(w.files['components/livingModel/RoomEditor.tsx'] ?? '')) out.push('the editor does not say the model is saved on this device only');
  if (w.EN[`${K}stage.otherLabel`] !== 'Other Work') out.push('a task that maps to no stage is not called Other Work');
  if (w.EN[`${K}card.noProgressLabel`] !== 'No Progress Reported') out.push('a task with nothing reported does not say No Progress Reported');
  if (!/row\.reportedPct == null\s*\?\s*<Text[^>]*>\{copy\.noProgressLabel\}/.test(w.files['components/livingModel/replayShared.tsx'] ?? '')) out.push('the room card does not print No Progress Reported for a task with nothing reported');
  return out;
});

rule('F5', 'labels in Title Case, sentences that end, no em dash, no "and" sign, no "e.g.", no arrows', (w) => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(w.EN)) {
    for (const s of strings(v)) {
      if (/[—–]/.test(s)) out.push(`${k} has a dash: ${s}`);
      if (/&/.test(s)) out.push(`${k} has an "and" sign`);
      if (/\be\.g\.|\bi\.e\./i.test(s)) out.push(`${k} has e.g. or i.e.`);
      if (/[→←↑↓⇒➜►]|->|=>/.test(s)) out.push(`${k} has an arrow`);
      if (/\p{Extended_Pictographic}/u.test(s)) out.push(`${k} has an emoji`);
      if (/Label$/.test(k)) { const p = titleCaseProblem(s); if (p) out.push(`${k}: ${p}`); if (/[.!]$/.test(s)) out.push(`${k} is a label and ends like a sentence`); }
      if (/Body$/.test(k)) { if (!/[.?]$/.test(s)) out.push(`${k} is a sentence with no end: ${s}`); if (s[0] !== s[0].toUpperCase()) out.push(`${k} does not start with a capital`); }
      if (/Sub$/.test(k)) { if (/\.$/.test(s)) out.push(`${k} is a caption and ends with a period`); if (/^[a-z]/.test(s)) out.push(`${k} does not start with a capital`); }
    }
  }
  for (const [k, v] of Object.entries(w.ES)) for (const s of strings(v)) {
    if (/[—–]/.test(s) || /&/.test(s) || /[→←⇒]|->/.test(s) || /\bp\. ej\./i.test(s)) out.push(`Spanish ${k} has a dash, an "and" sign, an arrow or "p. ej."`);
    if (/Body$/.test(k) && !/[.?]$/.test(s)) out.push(`Spanish ${k} is a sentence with no end`);
  }
  return out;
});

rule('F6', 'English and Spanish have the same keys, plural shapes and placeholders', (w) => {
  const out: string[] = [];
  const ph = (s: string): string => Array.from(s.matchAll(/\{([a-zA-Z]+)\}/g)).map((m) => m[1]).sort().join();
  for (const k of Object.keys(w.EN)) {
    if (!(k in w.ES)) { out.push(`Spanish is missing ${k}`); continue; }
    const en = w.EN[k];
    const es = w.ES[k];
    if (typeof en !== typeof es) { out.push(`${k} is plural in one language and not the other`); continue; }
    if (typeof en === 'string') { if (ph(en) !== ph(es as string)) out.push(`${k} placeholders differ`); } else {
      for (const form of Object.keys(en as object)) {
        const e = (en as Record<string, string>)[form];
        const s = (es as Record<string, string>)[form];
        if (typeof s !== 'string') out.push(`${k} has no Spanish "${form}" form`); else if (ph(e) !== ph(s)) out.push(`${k}.${form} placeholders differ`);
      }
    }
  }
  for (const k of Object.keys(w.ES)) if (!(k in w.EN)) out.push(`Spanish has ${k}, which English does not`);
  for (const k of Object.keys(w.EN)) if (!k.startsWith(K)) out.push(`${k} is outside office.livingModel.`);
  return out;
});

rule('F7', 'every string of the feature lives in the one copy hook', (w) => {
  const out: string[] = [];
  for (const f of [...LM_COMPONENTS(w), 'app/living-model.tsx']) {
    const src = w.files[f] ?? '';
    if (/\bt\(\s*'|\btn\(\s*'/.test(src)) out.push(`${f} has its own t() key`);
    const stripped = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const m = />\s*([A-Z][a-z]+(?: [A-Za-z]+){1,})\s*</.exec(stripped);
    if (m) out.push(`${f} prints a hard-coded phrase: "${m[1]}"`);
    const lit = /(?:accessibilityLabel|label|title|placeholder)=["']([^"']*[a-z][^"']*)["']/.exec(stripped);
    if (lit) out.push(`${f} has a hard-coded label: "${lit[1]}"`);
  }
  return out;
});

// G. the gate
rule('G1', 'the flag is false', (w) => (/export const LIVING_MODEL_ENABLED = false;/.test(w.files['constants/featureFlags.ts']) ? [] : ['LIVING_MODEL_ENABLED is not false']));

rule('G2', 'with the flag off only the owner account is let in; a signed-out person never is', (w) => {
  const out: string[] = [];
  const A = w.impl.livingModelAllowedWith;
  if (!A(false, 'omirmajeed2000@gmail.com') || !A(false, '  OmirMajeed2000@Gmail.com ')) out.push('the owner is refused');
  for (const e of ['someone@example.com', '', null, undefined, 'omirmajeed2000@gmail.com.evil.com', 'xomirmajeed2000@gmail.com']) if (A(false, e)) out.push(`${JSON.stringify(e)} is let in with the flag off`);
  if (!A(true, 'someone@example.com') || !A(true, null)) out.push('the flag on does not open it');
  return out;
});

rule('G3', 'the flag is read in one file', (w) => {
  const readers = Object.keys(w.files).filter((f) => f !== 'constants/featureFlags.ts' && /\bLIVING_MODEL_ENABLED\b/.test(code(w.files[f])));
  return readers.join() === 'utils/livingModel/allowed.ts' ? [] : [`LIVING_MODEL_ENABLED is read in ${readers.join(', ') || 'no file'}; want only utils/livingModel/allowed.ts`];
});

rule('G4', 'the route redirects before it mounts anything, and the screen waits for an open seat', (w) => {
  const out: string[] = [];
  const r = w.files['app/living-model.tsx'] ?? '';
  const fn = /export default function LivingModelRoute\(\) \{([\s\S]*?)\n\}/.exec(r);
  if (!fn) return ['the route has no default export named LivingModelRoute'];
  const body = fn[1];
  if (!/if \(!livingModelAllowed\(user\?\.email\)\) return <Redirect href="\/\(tabs\)\/\(home\)" \/>;/.test(body)) out.push('the route does not redirect a person the gate refuses');
  const before = body.slice(0, body.indexOf('livingModelAllowed('));
  if (/use(?!Auth)[A-Z][A-Za-z]*\(/.test(before)) out.push('the route calls a hook before the gate');
  if (/LivingModelScreen|loadJobModel|useProjects/.test(body)) out.push('the route\'s first function mounts the screen or reads data');
  const gated = r.slice(r.indexOf('function Gated'));
  const seatAt = gated.indexOf("if (seat !== 'open')");
  const screenAt = gated.indexOf('<LivingModelScreen');
  if (seatAt < 0 || screenAt < 0 || screenAt < seatAt) out.push('the screen is drawn before the seat is known to be open');
  if (!/livingModelSeat\(\{ role: roleState\.role, isLoading: roleState\.isLoading, isError: roleState\.isError \}\)/.test(gated)) out.push('the seat is not asked from the project role');
  return out;
});

rule('G5', 'one row leads here, on the project page, and it draws nothing for anyone the gate refuses', (w) => {
  const out: string[] = [];
  const row = w.files['components/livingModel/LivingModelEntryRow.tsx'] ?? '';
  const fn = /export function LivingModelEntryRow\([^)]*\) \{([\s\S]*?)\n\}/.exec(row);
  if (!fn || !/if \(!livingModelAllowed\(user\?\.email\)\) return null;/.test(fn[1])) out.push('the row does not return nothing for a person the gate refuses');
  else if (/use(?!Auth)[A-Z][A-Za-z]*\(/.test(fn[1].slice(0, fn[1].indexOf('livingModelAllowed(')))) out.push('the row calls a hook before the gate');
  if (/loadJobModel|threeScene|JobReplay3D|LivingModelScreen/.test(row)) out.push('the row reads the model or reaches the screen');
  const linkers = Object.keys(w.files).filter((f) => /['"`]\/living-model['"`?]/.test(w.files[f]));
  if (linkers.join() !== 'components/livingModel/LivingModelEntryRow.tsx') out.push(`/living-model is linked from ${linkers.join(', ') || 'nowhere'}; want only the entry row`);
  const users = Object.keys(w.files).filter((f) => /<LivingModelEntryRow\b/.test(w.files[f]));
  if (users.join() !== 'app/project-detail.tsx') out.push(`the row is drawn by ${users.join(', ') || 'nobody'}; want only the project page`);
  for (const f of ['app/(tabs)/_layout.tsx', 'components/DesktopSidebar.tsx']) if (/living-model|LivingModel/.test(w.files[f] ?? '')) out.push(`${f} mentions the Living Model: it must not be in the tabs or the sidebar`);
  const outside = Object.keys(w.files).filter((f) => !f.startsWith('components/livingModel/') && !f.startsWith('utils/livingModel/') && f !== 'app/living-model.tsx' && f !== 'app/project-detail.tsx' && f !== 'hooks/useLivingModelCopy.ts'
    && /from ['"]@\/(components|utils)\/livingModel\//.test(w.files[f]));
  if (outside.length) out.push(`files outside the feature import it: ${outside.join(', ')}`);
  return out;
});

rule('G6', 'only a seat that may edit the schedule opens it', (w) => {
  const out: string[] = [];
  const S = w.impl.livingModelSeat;
  const at = (role: string | null, isLoading = false, isError = false) => S({ role: role as never, isLoading, isError });
  if (at('owner') !== 'open' || at('editor') !== 'open') out.push('the owner or an editor is refused');
  if (at('viewer') !== 'refused' || at('field') !== 'refused') out.push('a viewer or a field seat is let in');
  if (at(null, true) !== 'checking' || at(null, false, true) !== 'unknown' || at(null) !== 'refused') out.push('a seat that is not known yet is not handled');
  return out;
});

// H. storage
rule('H1', 'the model is kept under an app-owned prefix, per person and per project', (w) => {
  const out: string[] = [];
  const k = w.impl.livingModelKey('user-1', 'proj-9');
  if (!k || !k.startsWith('mageid_') || !isAppStorageKey(k)) out.push(`the key ${k} is not under an app-owned prefix: the tenant sweep would miss it`);
  if (k && (!k.includes('user-1') || !k.includes('proj-9'))) out.push('the key does not carry both the person and the project');
  if (w.impl.livingModelKey(null, 'p') !== null || w.impl.livingModelKey('u', '') !== null || w.impl.livingModelKey(undefined, undefined) !== null) out.push('a key is made with no person or no project');
  if (w.impl.livingModelKey('a', 'p') === w.impl.livingModelKey('b', 'p')) out.push('two people share one key');
  if (!LIVING_MODEL_KEY_PREFIX.startsWith('mageid_')) out.push('the prefix is not mageid_');
  return out;
});

rule('H2', 'nothing is sent to the server, and no migration was written', (w) => {
  const out: string[] = [];
  for (const f of Object.keys(w.files).filter((x) => x.startsWith('components/livingModel/') || x.startsWith('utils/livingModel/') || x === 'app/living-model.tsx')) {
    const m = /from ['"](@\/lib\/supabase|@\/utils\/offlineQueue|@supabase\/[a-z-]+)['"]|\bfetch\(|supabase\.from\(|updateProject\(/.exec(w.files[f]);
    if (m) out.push(`${f} reaches the server (${m[0]})`);
  }
  const mig = join(ROOT, 'supabase', 'migrations');
  if (existsSync(mig)) for (const name of readdirSync(mig)) if (/living[_-]?model|job[_-]?model/i.test(name)) out.push(`a migration was written: ${name}`);
  const store = w.files['utils/livingModel/store.ts'] ?? '';
  if (!/AsyncStorage\.setItem\(key, json\)/.test(store) || (store.match(/AsyncStorage\.setItem\(/g) ?? []).length !== 1) out.push('the store writes somewhere other than the one model key');
  if (/AsyncStorage\.(clear|multiRemove|removeItem)\(/.test(store)) out.push('the store removes keys');
  return out;
});

// I. the look
rule('I1', 'theme tokens only in the components: no colour is written in them', (w) => {
  const out: string[] = [];
  for (const f of [...LM_COMPONENTS(w), 'app/living-model.tsx']) {
    const code = (w.files[f] ?? '').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const m = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.exec(code.replace(/'#ffffff'/g, "''"));
    if (m) out.push(`${f} writes a colour: ${m[0]}`);
  }
  const scene = w.files['components/livingModel/threeScene.ts'] ?? '';
  if ((scene.match(/'#ffffff'/g) ?? []).length > 6) out.push('threeScene writes more than its white lights and vertex-colour bases');
  if (!/palette\.[a-zA-Z]+/.test(scene)) out.push('the 3D materials do not take their colours from the palette');
  return out;
});

rule('I2', 'no gradient, no blur, no emoji, Lucide icons only, no react-native-reanimated', (w) => {
  const out: string[] = [];
  for (const f of [...LM_COMPONENTS(w), 'app/living-model.tsx', 'hooks/useLivingModelCopy.ts']) {
    const src = w.files[f] ?? '';
    const m = /react-native-reanimated|expo-linear-gradient|LinearGradient|expo-blur|BlurView|backdropFilter|@expo\/vector-icons|linear-gradient\(/.exec(src);
    if (m) out.push(`${f} uses ${m[0]}`);
    if (/\p{Extended_Pictographic}/u.test(src)) out.push(`${f} has an emoji`);
  }
  return out;
});

rule('I3', 'Reduce Motion is respected: the replay steps and tweens nothing', (w) => {
  const out: string[] = [];
  const s = w.files['components/livingModel/replayShared.tsx'] ?? '';
  if (!/const reduce = useReducedMotion\(\);/.test(s)) out.push('the replay clock does not read Reduce Motion');
  const eff = s.slice(s.indexOf('if (!playing) return;'), s.indexOf('const togglePlay'));
  const at = eff.indexOf('if (reduce) {');
  if (at < 0 || eff.indexOf('requestAnimationFrame') < at || !/setInterval\(/.test(eff.slice(at, eff.indexOf('requestAnimationFrame')))) out.push('under Reduce Motion the clock still runs frame by frame');
  const web = w.files['components/livingModel/JobReplay3D.web.tsx'] ?? '';
  if (!/if \(dirty\.current && handle\)/.test(web)) out.push('the 3D view draws every frame instead of only when something changed');
  if (/Animated\.(timing|spring|loop)\(/.test(web + (w.files['components/livingModel/threeScene.ts'] ?? ''))) out.push('the 3D view animates on its own');
  return out;
});

// J. the 3D shapes, as numbers
rule('J1', 'a wall\'s pieces add up to the wall less its doors and windows, and every number is a number', (w) => {
  const out: string[] = [];
  let area = 0;
  let maxPiece = 0;
  const holes = [{ id: 'd', kind: 'door' as const, s0: 1, s1: 1.9, y0: 0, y1: 2.03 }, { id: 'w', kind: 'window' as const, s0: 2.5, s1: 3.5, y0: 0.9, y1: 2.1 }];
  w.impl.wallSpans(holes, 4, 2.4, 1.2, (s0, s1, y0, y1) => { area += (s1 - s0) * (y1 - y0); maxPiece = Math.max(maxPiece, s1 - s0); if (s0 < 1.9 - 1e-9 && s1 > 1 + 1e-9 && y0 < 2.03 - 1e-9) out.push('a piece of wall stands in the doorway'); });
  if (!near(area, 4 * 2.4 - 0.9 * 2.03 - 1 * 1.2, 1e-9)) out.push(`a 4 by 2.4 wall with a door and a window has ${area.toFixed(4)} m2 of wall; want 6.5730`);
  if (maxPiece > 1.2 + 1e-9) out.push('a piece of wall is longer than its step');
  for (const r of sevenRoomJob().rooms) {
    const g = w.impl.buildRoomGeometry(r, { cutHeightM: null });
    for (const [name, buf] of Object.entries({ shell: g.shell, skin: g.skin, studs: g.studs, pipes: g.pipes, wires: g.wires, insulation: g.insulation, trim: g.trim, glass: g.glass })) {
      if (buf.p.length !== buf.boxes * VERTS_PER_BOX * 3 || buf.n.length !== buf.p.length) out.push(`${r.id} ${name}: the corners do not match the box count`);
      if (buf.p.some((v) => !Number.isFinite(v)) || buf.n.some((v) => !Number.isFinite(v))) out.push(`${r.id} ${name} has a number that is not a number`);
      if (buf.c.length && buf.c.length !== buf.p.length) out.push(`${r.id} ${name}: the colours do not match the corners`);
    }
    if (g.skin.boxes === 0 || g.studs.boxes === 0 || g.shell.boxes === 0) out.push(`${r.id} has no walls or no frame`);
    let floorArea = 0;
    for (let i = 0; i + 8 < g.floor.p.length; i += 9) floorArea += Math.abs((g.floor.p[i + 3] - g.floor.p[i]) * (g.floor.p[i + 8] - g.floor.p[i + 2]) - (g.floor.p[i + 6] - g.floor.p[i]) * (g.floor.p[i + 5] - g.floor.p[i + 2])) / 2;
    if (!near(floorArea, roomAreaM2(r) ?? -1, 1e-6)) out.push(`${r.id}: the floor slab is ${floorArea.toFixed(4)} m2, the room is ${(roomAreaM2(r) ?? 0).toFixed(4)}`);
    if (g.floor.n.some((v, i) => (i % 3 === 1 ? v !== 1 : v !== 0))) out.push(`${r.id}: the floor does not face up`);
  }
  const L = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 0, y: 3 }];
  const tri = triangulate(L);
  let a = 0;
  for (let i = 0; i < tri.length; i += 3) a += Math.abs((L[tri[i + 1]].x - L[tri[i]].x) * (L[tri[i + 2]].y - L[tri[i]].y) - (L[tri[i + 2]].x - L[tri[i]].x) * (L[tri[i + 1]].y - L[tri[i]].y)) / 2;
  if (tri.length !== 12 || !near(a, polygonArea(L), 1e-9)) out.push('an L-shaped floor is not cut into four triangles of the same area');
  return out;
});

rule('J2', 'cut-away walls stop at the cut; full walls reach the ceiling; glass sits in the window', (w) => {
  const out: string[] = [];
  const kitchen = sevenRoomJob().rooms.find((r) => r.id === 'kitchen')!;
  const top = (buf: { p: number[] }): number => { let m = 0; for (let i = 1; i < buf.p.length; i += 3) m = Math.max(m, buf.p[i]); return m; };
  const cut = w.impl.buildRoomGeometry(kitchen, { cutHeightM: 1.25 });
  if (top(cut.skin) > 1.25 + 1e-6 || top(cut.studs) > 1.25 + 1e-6 || top(cut.shell) > 1.25 + 1e-6 || !near(cut.heightM, 1.25)) out.push(`cut-away walls reach ${top(cut.skin).toFixed(3)} m; the cut is 1.25`);
  const full = w.impl.buildRoomGeometry(kitchen, { cutHeightM: null });
  if (!near(top(full.skin), ft(8), 1e-6)) out.push(`full walls reach ${top(full.skin).toFixed(3)} m; the ceiling is ${ft(8).toFixed(3)}`);
  if (full.glass.boxes !== 1) out.push('the kitchen\'s one window has no pane');
  if (cut.glass.boxes !== 1) out.push('the window is lost when the walls are cut');
  return out;
});

rule('J3', 'the faint part starts where the solid part ends, and never runs backwards', (w) => {
  const out: string[] = [];
  const R = w.impl.revealRange;
  const a = R(10, 0.3, 0.6);
  if (a.solidCount !== 3 * 36 || a.ghostStart !== 3 * 36 || a.ghostCount !== 3 * 36) out.push(`10 boxes, 30 solid, 60 planned: ${JSON.stringify(a)}`);
  const b = R(10, 0.7, 0.2);
  if (b.solidCount !== 7 * 36 || b.ghostCount !== 0) out.push('a plan behind what is solid still draws a faint part');
  const c = R(10, Number.NaN, 2);
  if (c.solidCount !== 0 || c.ghostCount !== 360) out.push('a bad amount is not held between nothing and everything');
  for (const [s, g] of [[0, 0], [1, 1], [0.05, 0.95], [0.5, 0.5]] as const) { const r = R(7, s, g); if (r.ghostStart !== r.solidCount || r.solidCount + r.ghostCount > 7 * 36 || r.ghostCount < 0) out.push(`the ranges for ${s}, ${g} overlap or overrun`); }
  return out;
});

rule('J4', 'pipes are drawn only in a kitchen, a bathroom or a laundry; wires in every room', (w) => {
  const out: string[] = [];
  for (const r of sevenRoomJob().rooms) {
    const g = w.impl.buildRoomGeometry(r, {});
    const wet = r.kind === 'kitchen' || r.kind === 'bathroom' || r.kind === 'laundry';
    if (wet !== w.impl.roomHasPipes(r.kind)) out.push(`${r.kind} pipes rule is wrong`);
    if (wet && g.pipes.boxes === 0) out.push(`${r.id} is a wet room with no pipes`);
    if (!wet && g.pipes.boxes > 0) out.push(`${r.id} is not a wet room and has pipes`);
    if (g.wires.boxes === 0) out.push(`${r.id} has no wires`);
  }
  return out;
});

// K. registration
rule('K1', 'the script, the gate chain, the route and the i18n surface are registered', (w) => {
  const out: string[] = [];
  if (w.pkg.scripts['test:living-model'] !== 'bun run scripts/validate-living-model.ts') out.push('package.json has no test:living-model');
  if (!/&& bun run test:living-model(\s|&&|$)/.test(w.pkg.scripts['ship-check'] ?? '')) out.push('ship-check does not run test:living-model');
  if (!/<Stack\.Screen name="living-model" options=\{\{ title: 'Living Model', headerShown: false \}\} \/>/.test(w.files['app/_layout.tsx'] ?? '')) out.push('app/_layout.tsx does not declare the route');
  if (!/'living-model': 'dashboard'/.test(w.files['utils/desktopPage.ts'] ?? '')) out.push('utils/desktopPage.ts has no page type for the route');
  if (!/id: 'office\.living-model'[^\n]*keyPrefixes: \['office\.livingModel\.'\][^\n]*hooks\/useLivingModelCopy\.ts/.test(w.files['i18n/surfaces.ts'] ?? '')) out.push('the i18n surface is not registered');
  if (!/'office\.living-model': EN_OFFICE_LIVING_MODEL/.test(w.files['i18n/catalog/en/index.ts'] ?? '') || !/'office\/livingModel': ES_OFFICE_LIVING_MODEL/.test(w.files['i18n/catalog/es/index.ts'] ?? '')) out.push('a catalog index does not list the shard');
  if (!existsSync(join(ROOT, '__tests__', 'smoke', 'living-model.test.tsx'))) out.push('the smoke suite is missing');
  return out;
});

// ── planted mutations ────────────────────────────────────────────────────────

interface Mutation { rule: string; name: string; plant: (w: World) => World }
const edit = (file: string, from: string | RegExp, to: string) => (w: World): World => {
  const s = w.files[file];
  if (s === undefined) throw new Error(`mutation file not found: ${file}`);
  const next = s.replace(from as string, to);
  if (next === s) throw new Error(`mutation anchor not found in ${file}: ${String(from)}`);
  return { ...w, files: { ...w.files, [file]: next } };
};
const addFile = (file: string, body: string) => (w: World): World => ({ ...w, files: { ...w.files, [file]: body } });
const swap = (over: Partial<Impl>) => (w: World): World => ({ ...w, impl: { ...w.impl, ...over } });
const en = (key: string, value: unknown) => (w: World): World => {
  if (!(`${K}${key}` in w.EN)) throw new Error(`mutation key not found: ${key}`);
  return { ...w, EN: { ...w.EN, [`${K}${key}`]: value } };
};
const es = (key: string, value: unknown) => (w: World): World => {
  if (!(`${K}${key}` in w.ES)) throw new Error(`mutation key not found: ${key}`);
  return { ...w, ES: { ...w.ES, [`${K}${key}`]: value } };
};
const pkgEdit = (fn: (p: World['pkg']) => World['pkg']) => (w: World): World => ({ ...w, pkg: fn(JSON.parse(JSON.stringify(w.pkg))) });

const MUTATIONS: Mutation[] = [
  { rule: 'A1', name: 'the box ignores the last room', plant: swap({ modelBounds: (m, l) => modelBounds({ ...m, rooms: m.rooms.slice(0, -1) }, l) }) },
  { rule: 'A1', name: 'areas come back in square feet', plant: swap({ roomAreaM2: (r) => { const a = roomAreaM2(r); return a == null ? null : a * M2_TO_SF; } }) },
  { rule: 'A1', name: 'touching rooms are called overlapping', plant: swap({ validateModel: (m) => { const c = validateModel(m); return { ...c, warnings: [...c.warnings, { code: 'rooms_overlap', level: 'warning', roomIds: [m.rooms[0]?.id ?? '', m.rooms[1]?.id ?? ''] }] }; } }) },
  { rule: 'A2', name: 'the box is the first room only', plant: swap({ modelBounds: (m) => (m.rooms[0] ? roomBounds(m.rooms[0]) : null) }) },
  { rule: 'A2', name: 'a turned room keeps its unturned area but the area is doubled', plant: swap({ roomAreaM2: (r) => { const a = roomAreaM2(r); return a == null ? null : (r.placement.rotationDeg ? a * 2 : a); } }) },
  { rule: 'A3', name: 'a NaN is let through', plant: swap({ validateModel: (m) => { const c = validateModel(m); const errors = c.errors.filter((e) => e.code !== 'not_a_number'); return { ...c, errors, ok: errors.length === 0 }; } }) },
  { rule: 'A3', name: 'overlap is never warned about', plant: swap({ validateModel: (m) => { const c = validateModel(m); return { ...c, warnings: c.warnings.filter((x) => x.code !== 'rooms_overlap') }; } }) },
  { rule: 'A3', name: 'a shared edge counts as an overlap', plant: swap({ polygonsOverlap: (p, q) => polygonsOverlap(p, q, -0.5) || p.some((a) => q.some((b) => near(a.x, b.x) && near(a.y, b.y))) }) },
  { rule: 'A3', name: 'an open outline is not mentioned', plant: swap({ validateModel: (m) => { const c = validateModel(m); return { ...c, warnings: c.warnings.filter((x) => x.code !== 'outline_open') }; } }) },
  { rule: 'A4', name: 'the scan is not turned over, so it is drawn mirrored', plant: swap({ roomFromScan: (scan, o) => { const r = roomFromScan(scan, o); const ys = r.room.floor.map((p) => p.y); const max = Math.max(...ys); const flip = (p: { x: number; y: number }) => ({ x: p.x, y: max - p.y }); return { ...r, room: { ...r.room, floor: r.room.floor.map(flip), walls: r.room.walls.map((x) => ({ ...x, a: flip(x.a), b: flip(x.b) })) } }; } }) },
  { rule: 'A4', name: 'the scan is given a name by the app', plant: swap({ roomFromScan: (scan, o) => ({ ...roomFromScan(scan, o), name: 'Room 1' }) }) },
  { rule: 'A4', name: 'the scanner\'s wall type is forked', plant: edit('utils/livingModel/types.ts', 'export type RoomShape = Pick<RoomScan, ', 'export interface ScanWall { id: string }\nexport type RoomShape = Pick<RoomScan, ') },
  { rule: 'A4', name: 'the placement is ignored', plant: swap({ roomFromScan: (scan, o) => roomFromScan(scan, { ...o, placement: { xM: 0, yM: 0 } }) }) },
  { rule: 'A5', name: 'a move does not snap', plant: swap({ moveRoom: (m, id, x, y) => ({ ...m, rooms: m.rooms.map((r) => (r.id === id ? { ...r, placement: { ...r.placement, xM: x, yM: y } } : r)) }) }) },
  { rule: 'A5', name: 'a copy takes the original\'s ticks', plant: swap({ duplicateRoom: (m, id, nid, nn) => { const d = duplicateRoom(m, id, nid, nn); return { ...d, links: { ...d.links, [nid]: [...(m.links[id] ?? [])] } }; } }) },
  { rule: 'A5', name: 'a turn does nothing', plant: swap({ rotateRoom: (m) => m }) },
  { rule: 'A6', name: 'another project\'s model is read', plant: swap({ parseJobModel: (raw, pid) => parseJobModel(raw, pid) ?? (raw ? parseJobModel(raw, (JSON.parse(raw.endsWith('}') ? raw : '{}') as { projectId?: string }).projectId ?? pid) : null) }) },
  { rule: 'B1', name: 'a trade has no row', plant: swap({ STAGE_BY_TRADE: Object.fromEntries(Object.entries(STAGE_BY_TRADE).filter(([k]) => k !== 'hvac')) }) },
  { rule: 'B1', name: 'a trade maps to a made-up stage', plant: swap({ STAGE_BY_TRADE: { ...STAGE_BY_TRADE, roofing: 'exterior' } }) },
  { rule: 'B1', name: 'a trade the app does not have', plant: swap({ STAGE_BY_TRADE: { ...STAGE_BY_TRADE, masonry: 'other' } }) },
  { rule: 'B2', name: 'an unknown task is guessed to be finishes', plant: swap({ stageForTask: (t, tr) => { const a = stageForTask(t, tr); return a.stage === 'other' && a.by === 'nothing' ? { stage: 'finishes', by: 'trade' } : a; } }) },
  { rule: 'B2', name: 'Other Work tasks are dropped from the room', plant: swap({ roomMoment: (tasks, p, o, c, m) => roomMoment(tasks.filter((t) => t.stage !== 'other'), p, o, c, m) }) },
  { rule: 'B2', name: 'the trade wins over the words', plant: swap({ stageForTask: (t, tr) => (tr && STAGE_BY_TRADE[tr] !== 'other' ? { stage: STAGE_BY_TRADE[tr], by: 'trade' } : stageForTask(t, tr)) }) },
  { rule: 'B3', name: 'an inspection takes its trade\'s stage', plant: swap({ stageForTask: (t, tr) => { const a = stageForTask(t, tr); return a.by === 'not_build_work' && tr && STAGE_BY_TRADE[tr] ? { stage: STAGE_BY_TRADE[tr], by: 'trade' } : a; } }) },
  { rule: 'C1', name: 'the plan counts from day 1 as day 1, not day 0', plant: swap({ plannedAt: (t, o) => plannedAt(t, o - 1) }) },
  { rule: 'C2', name: 'Reported falls back to the plan when nothing was reported', plant: swap({ reportedAt: (t, p, o, today) => (hasAnyReport(t, p) ? reportedAt(t, p, o, today) : plannedAt(t, Math.min(o, today))) }) },
  { rule: 'C2', name: 'the drawing falls back to the plan when nothing was reported', plant: swap({ taskMoment: (t, p, o, c, m) => (m === 'reported' && !hasAnyReport(t, p) ? taskMoment(t, p, o, c, 'planned') : taskMoment(t, p, o, c, m)) }) },
  { rule: 'C2', name: 'the room is filled from the plan when nothing was reported', plant: swap({ roomMoment: (tasks, p, o, c, m) => (m === 'reported' && tasks.every((t) => !hasAnyReport(t, p)) ? { ...roomMoment(tasks, p, o, c, 'planned'), unreported: tasks.length } : roomMoment(tasks, p, o, c, m)) }) },
  { rule: 'C3', name: 'undated progress is spread back over the plan', plant: swap({ reportedAt: (t, p, o, today) => Math.max(reportedAt(t, p, o, today), (t.progress / 100) * plannedAt(t, o)) }) },
  { rule: 'C3', name: 'a daily report counts before its day', plant: swap({ reportedAt: (t, p, o, today) => reportedAt(t, p.map((x) => ({ ...x, offset: x.offset - 3 })), o, today) }) },
  { rule: 'C4', name: 'Planned draws the future solid', plant: swap({ taskMoment: (t, p, o, c, m) => (m === 'planned' ? { solid: plannedAt(t, o), ghost: plannedAt(t, o) } : taskMoment(t, p, o, c, m)) }) },
  { rule: 'C4', name: 'no faint plan past today', plant: swap({ taskMoment: (t, p, o, c, m) => { const x = taskMoment(t, p, o, c, m); return { solid: x.solid, ghost: x.solid }; } }) },
  { rule: 'C5', name: 'the walls never open', plant: swap({ roomLayers: (a) => ({ ...roomLayers(a), skin: 1 }) }) },
  { rule: 'C5', name: 'a paint-only room is shown gutted', plant: swap({ roomLayers: (a) => (a.demolition == null && a.framing == null && a.rough_in == null && a.insulation == null && a.drywall == null ? { ...roomLayers(a), skin: 0, studs: 1 } : roomLayers(a)) }) },
  { rule: 'D1', name: 'the replay reads suggestions as links', plant: swap({ tickedFor: (model, roomId, tasks) => { const r = model.rooms.find((x) => x.id === roomId)!; const live = liveLinks(model, roomId, new Set(tasks.map((t) => t.id))).ids; return [...live, ...suggestLinks(r, tasks, live).map((s) => s.taskId)]; } }) },
  { rule: 'D1', name: 'suggesting writes the links', plant: swap({ suggestLinks: (room, tasks, ticked) => { const s = suggestLinks(room, tasks, ticked); (room as unknown as { __mutated?: boolean }).__mutated = true; (room as { name: string }).name = `${room.name} `; return s; } }) },
  { rule: 'D1', name: 'every task is suggested for every room', plant: swap({ suggestLinks: (_room, tasks, ticked) => tasks.filter((t) => !ticked.includes(t.id)).map((t) => ({ taskId: t.id, reason: 'trade' as const })) }) },
  { rule: 'D2', name: 'suggestions are confirmed from an effect', plant: edit('components/livingModel/TaskLinks.tsx', '  if (model.rooms.length === 0) return', '  React.useEffect(() => { if (room) onChange(confirmSuggestions(model, room.id, suggestions.map((s) => s.taskId))); }, []);\n  if (model.rooms.length === 0) return') },
  { rule: 'D2', name: 'the screen applies suggestions when the model loads', plant: edit('components/livingModel/LivingModelScreen.tsx', "      setHistory(historyOf(m));", "      setHistory(historyOf(m.rooms.reduce((acc, r) => confirmSuggestions(acc, r.id, suggestLinks(r, [], []).map((s) => s.taskId)), m)));") },
  { rule: 'E1', name: 'a static import in the web view', plant: edit('components/livingModel/JobReplay3D.web.tsx', "import { createJobScene, type JobSceneHandle, type RoomLook } from './threeScene';", "import { createJobScene, type JobSceneHandle, type RoomLook } from './threeScene';\nimport * as THREE from 'three';") },
  { rule: 'E1', name: 'a static import in the scene builder', plant: edit('components/livingModel/threeScene.ts', "type Three = typeof import('three');", "import { Color } from 'three';\ntype Three = typeof import('three');") },
  { rule: 'E1', name: 'a require in the screen', plant: edit('components/livingModel/LivingModelScreen.tsx', "type Tab = 'rooms' | 'tasks' | 'replay';", "const THREE = require('three');\ntype Tab = 'rooms' | 'tasks' | 'replay';") },
  { rule: 'E1', name: 'a static import of a file inside the package', plant: addFile('utils/livingModel/orbit.ts', "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';\nexport { OrbitControls };\n") },
  { rule: 'E2', name: 'the platform guard is removed', plant: edit('components/livingModel/JobReplay3D.web.tsx', "  if (Platform.OS !== 'web') return Promise.reject(new Error('The 3D view is on the web only.'));\n", '') },
  { rule: 'E2', name: 'a second dynamic import on the phone screen', plant: edit('components/livingModel/LivingModelScreen.tsx', "type Tab = 'rooms' | 'tasks' | 'replay';", "export const preload = () => import('three');\ntype Tab = 'rooms' | 'tasks' | 'replay';") },
  { rule: 'E2', name: 'the library is loaded at module scope', plant: edit('components/livingModel/JobReplay3D.web.tsx', 'export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;', 'export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;\nvoid loadThree();') },
  { rule: 'E3', name: 'the phone file is deleted', plant: (w) => { const f = { ...w.files }; delete f['components/livingModel/JobReplay3D.tsx']; return { ...w, files: f }; } },
  { rule: 'E3', name: 'the phone file builds the scene', plant: edit('components/livingModel/JobReplay3D.tsx', "import type { JobReplay3DProps } from './jobReplay3DProps';", "import type { JobReplay3DProps } from './jobReplay3DProps';\nimport { createJobScene } from './threeScene';\nexport const make = createJobScene;") },
  { rule: 'E3', name: 'the screen imports the web file by name', plant: edit('components/livingModel/LivingModelScreen.tsx', "from './JobReplay3D';", "from './JobReplay3D.web';") },
  { rule: 'E4', name: 'a caret range', plant: pkgEdit((p) => { p.dependencies.three = '^0.180.0'; return p; }) },
  { rule: 'E4', name: 'a second 3D dependency', plant: pkgEdit((p) => { p.dependencies['@react-three/fiber'] = '9.0.0'; return p; }) },
  { rule: 'E4', name: 'three is removed', plant: pkgEdit((p) => { delete p.dependencies.three; return p; }) },
  { rule: 'E5', name: 'the model core imports React Native', plant: edit('utils/livingModel/modelCore.ts', "import { polygonArea } from '@/utils/roomScan/geometryCore';", "import { Platform } from 'react-native';\nimport { polygonArea } from '@/utils/roomScan/geometryCore';") },
  { rule: 'E5', name: 'the replay core reads storage', plant: edit('utils/livingModel/replayCore.ts', "import { BUILD_STAGES,", "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport { BUILD_STAGES,") },
  { rule: 'F1', name: 'English says accurate', plant: en('entry.sub', 'An accurate model of the job, room by room') },
  { rule: 'F1', name: 'English says live', plant: en('tab.replayLabel', 'Live Replay') },
  { rule: 'F1', name: 'English says digital twin', plant: en('titleLabel', 'Digital Twin') },
  { rule: 'F1', name: 'English says as-built', plant: en('replay.reportedLabel', 'As-Built') },
  { rule: 'F1', name: 'English says BIM', plant: en('replay.legendHeadingLabel', 'BIM Stages') },
  { rule: 'F1', name: 'English says real-time and verified', plant: en('honesty.progressBody', 'Progress shown is verified in real time.') },
  { rule: 'F1', name: 'English says exact', plant: en('room.sizeSub', '{width} by {length}, exactly {sqFt}') },
  { rule: 'F1', name: 'Spanish says exacto', plant: es('entry.sub', 'Un modelo exacto del trabajo') },
  { rule: 'F1', name: 'Spanish says en vivo', plant: es('tab.replayLabel', 'Repetición en vivo') },
  { rule: 'F1', name: 'Spanish says gemelo digital', plant: es('titleLabel', 'Gemelo digital') },
  { rule: 'F1', name: 'Spanish says tiempo real', plant: es('honesty.progressBody', 'El avance se muestra en tiempo real según MAGE ID.') },
  { rule: 'F2', name: 'the schematic line drops "Not to scale for building"', plant: en('honesty.schematicBody', 'Schematic made from typed and scanned sizes.') },
  { rule: 'F2', name: 'the progress line says the work was done', plant: en('honesty.progressBody', 'Progress shown is what was done on site.') },
  { rule: 'F2', name: 'Spanish drops not to scale', plant: es('honesty.schematicBody', 'Esquema hecho con medidas escritas y escaneadas.') },
  { rule: 'F3', name: 'the lines are only under the flat view', plant: edit('components/livingModel/LivingModelScreen.tsx', "      <HonestyLines ghost={past} testID={threeD ? 'lm-honesty-3d' : 'lm-honesty-flat'} />", "      {!threeD ? <HonestyLines ghost={past} testID=\"lm-honesty-flat\" /> : null}") },
  { rule: 'F3', name: 'the lines are removed from the replay', plant: edit('components/livingModel/LivingModelScreen.tsx', "      <HonestyLines ghost={past} testID={threeD ? 'lm-honesty-3d' : 'lm-honesty-flat'} />\n", '') },
  { rule: 'F3', name: 'the component prints one line', plant: edit('components/livingModel/HonestyLines.tsx', '      <Text style={styles.noteStrong}>{copy.schematicBody}</Text>\n', '') },
  { rule: 'F3', name: 'the editor loses the lines', plant: edit('components/livingModel/LivingModelScreen.tsx', '            <HonestyLines testID="lm-honesty-rooms" />\n', '') },
  { rule: 'F4', name: 'the scan line loses the inch', plant: en('honesty.scanCaveatBody', 'This room came from a phone scan.') },
  { rule: 'F4', name: 'the room card drops the scan line', plant: edit('components/livingModel/replayShared.tsx', "      {room.source === 'scan' ? <Text style={styles.warn}>{copy.scanCaveatBody}</Text> : null}\n", '') },
  { rule: 'F4', name: 'the device-only line is not shown', plant: edit('components/livingModel/RoomEditor.tsx', '        <Text style={styles.note} testID="lm-saved-local">{copy.savedLocalBody}</Text>\n', '') },
  { rule: 'F4', name: 'a task with nothing reported shows 0 percent', plant: edit('components/livingModel/replayShared.tsx', 'row.reportedPct == null', 'row.reportedPct == undefined && false') },
  { rule: 'F4', name: 'Other Work is renamed General', plant: en('stage.otherLabel', 'General') },
  { rule: 'F5', name: 'a lower-case label', plant: en('editor.addRoomLabel', 'Add room') },
  { rule: 'F5', name: 'an em dash', plant: en('replay.phoneNoteBody', 'Open this job in the web app — the model turns there.') },
  { rule: 'F5', name: 'an "and" sign', plant: en('card.tasksLabel', 'Tasks & Stages') },
  { rule: 'F5', name: 'a sentence with no end', plant: en('editor.emptyBody', 'Add a room by typing its size') },
  { rule: 'F5', name: 'an arrow', plant: en('tasks.introBody', 'Rooms -> tasks. Tick the tasks that happen in each room.') },
  { rule: 'F5', name: 'e.g.', plant: en('form.unreadableBody', 'Type each size the way you read a tape, e.g. 12 ft 6 in.') },
  { rule: 'F5', name: 'a small word capitalised in a label', plant: en('editor.addFromScanLabel', 'Add From Scan') },
  { rule: 'F6', name: 'Spanish loses a key', plant: (w) => { const ES = { ...w.ES }; delete ES[`${K}card.closeLabel`]; return { ...w, ES }; } },
  { rule: 'F6', name: 'Spanish loses a placeholder', plant: es('replay.weekLabel', 'Semana {n}') },
  { rule: 'F6', name: 'Spanish loses a plural form', plant: es('card.unreportedBody', { other: '{count} tareas marcadas no tienen avance reportado.' }) },
  { rule: 'F7', name: 'a hard-coded phrase in the screen', plant: edit('components/livingModel/LivingModelScreen.tsx', '{!model ? <Text style={styles.note}>{copy.loadingBody}</Text> : null}', '{!model ? <Text style={styles.note}>Loading the model</Text> : null}') },
  { rule: 'F7', name: 'a t() key outside the hook', plant: edit('components/livingModel/HonestyLines.tsx', '{copy.schematicBody}', "{t('office.livingModel.x', 'Schematic.')}") },
  { rule: 'G1', name: 'the flag is turned on', plant: edit('constants/featureFlags.ts', 'export const LIVING_MODEL_ENABLED = false;', 'export const LIVING_MODEL_ENABLED = true;') },
  { rule: 'G2', name: 'anyone signed in is let in', plant: swap({ livingModelAllowedWith: (on, e) => on || !!e }) },
  { rule: 'G2', name: 'an address that only contains the owner\'s is let in', plant: swap({ livingModelAllowedWith: (on, e) => on || (e ?? '').toLowerCase().includes('omirmajeed2000@gmail.com') }) },
  { rule: 'G2', name: 'the owner is refused', plant: swap({ livingModelAllowedWith: (on) => on }) },
  { rule: 'G3', name: 'the row reads the flag itself', plant: edit('components/livingModel/LivingModelEntryRow.tsx', "import { useAuth } from '@/contexts/AuthContext';", "import { useAuth } from '@/contexts/AuthContext';\nimport { LIVING_MODEL_ENABLED } from '@/constants/featureFlags';\nexport const on = LIVING_MODEL_ENABLED;") },
  { rule: 'G4', name: 'the route does not redirect', plant: edit('app/living-model.tsx', "  if (!livingModelAllowed(user?.email)) return <Redirect href=\"/(tabs)/(home)\" />;\n", '') },
  { rule: 'G4', name: 'the screen is drawn before the seat check', plant: edit('app/living-model.tsx', "  const seat = livingModelSeat(", "  if (projectId) return <LivingModelScreen projectId={projectId} userId={userId} />;\n  const seat = livingModelSeat(") },
  { rule: 'G4', name: 'the route reads the project before the gate', plant: edit('app/living-model.tsx', "  const { user } = useAuth();\n  if (!livingModelAllowed(", "  const { user } = useAuth();\n  const role = useProjectRoleState('p');\n  if (role && !livingModelAllowed(") },
  { rule: 'G5', name: 'the row is drawn for everyone', plant: edit('components/livingModel/LivingModelEntryRow.tsx', '  if (!livingModelAllowed(user?.email)) return null;\n', '') },
  { rule: 'G5', name: 'a sidebar row', plant: (w) => edit('components/DesktopSidebar.tsx', /$/, "\n// { label: 'Living Model', href: '/living-model' }\nexport const LM = '/living-model';\n")(w) },
  { rule: 'G5', name: 'a second screen draws the row', plant: addFile('app/schedule-extra.tsx', "import { LivingModelEntryRow } from '@/components/livingModel/LivingModelEntryRow';\nexport default function X() { return <LivingModelEntryRow projectId=\"p\" />; }\n") },
  { rule: 'G6', name: 'a viewer is let in', plant: swap({ livingModelSeat: (a) => (a.role ? 'open' : livingModelSeat(a)) }) },
  { rule: 'G6', name: 'a field seat is let in', plant: swap({ livingModelSeat: (a) => ((a.role as string) === 'field' ? 'open' : livingModelSeat(a)) }) },
  { rule: 'H1', name: 'a key under a new prefix', plant: swap({ livingModelKey: (u, p) => (u && p ? `livingmodel::${u}::${p}` : null) }) },
  { rule: 'H1', name: 'one key for every person', plant: swap({ livingModelKey: (u, p) => (u && p ? `mageid_living_model::${p}` : null) }) },
  { rule: 'H1', name: 'a key with no person', plant: swap({ livingModelKey: (u, p) => `mageid_living_model::${u ?? 'anon'}::${p ?? 'none'}` }) },
  { rule: 'H2', name: 'the model is written into the project', plant: edit('components/livingModel/LivingModelScreen.tsx', '    void saveJobModel(userId, m, new Date().toISOString())', '    updateProject(projectId, { schedule: { livingModel: m } });\n    void saveJobModel(userId, m, new Date().toISOString())') },
  { rule: 'H2', name: 'the store calls the server', plant: edit('utils/livingModel/store.ts', "import AsyncStorage from '@react-native-async-storage/async-storage';", "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport { supabase } from '@/lib/supabase';\nexport const s = supabase;") },
  { rule: 'H2', name: 'the store clears storage', plant: edit('utils/livingModel/store.ts', '    await AsyncStorage.setItem(key, json);', '    await AsyncStorage.clear();\n    await AsyncStorage.setItem(key, json);') },
  { rule: 'I1', name: 'a hex colour in a component', plant: edit('components/livingModel/styles.ts', "screen: { flex: 1, backgroundColor: t.bg },", "screen: { flex: 1, backgroundColor: '#ECEDE9' },") },
  { rule: 'I1', name: 'an rgba in the web view', plant: edit('components/livingModel/JobReplay3D.web.tsx', "display: 'block',", "display: 'block', background: 'rgba(0,0,0,0.1)',") },
  { rule: 'I2', name: 'a gradient', plant: edit('components/livingModel/LivingModelScreen.tsx', "type Tab = 'rooms' | 'tasks' | 'replay';", "import { LinearGradient } from 'expo-linear-gradient';\ntype Tab = 'rooms' | 'tasks' | 'replay';") },
  { rule: 'I2', name: 'a blur', plant: edit('components/livingModel/styles.ts', "screen: { flex: 1, backgroundColor: t.bg },", "screen: { flex: 1, backgroundColor: t.bg, backdropFilter: 'blur(8px)' },") },
  { rule: 'I2', name: 'reanimated', plant: edit('components/livingModel/replayShared.tsx', "import { labelOn } from '@/components/ui/ink';", "import { labelOn } from '@/components/ui/ink';\nimport Animated from 'react-native-reanimated';") },
  { rule: 'I2', name: 'an emoji in the copy hook', plant: edit('hooks/useLivingModelCopy.ts', "'Living Model (Owner Preview)'", "'Living Model \u{1F3D7} (Owner Preview)'") },
  { rule: 'I3', name: 'Reduce Motion is ignored', plant: edit('components/livingModel/replayShared.tsx', '    if (reduce) {', '    if (false as boolean) {') },
  { rule: 'I3', name: 'the 3D view draws every frame', plant: edit('components/livingModel/JobReplay3D.web.tsx', 'if (dirty.current && handle) {', 'if (handle) {') },
  { rule: 'J1', name: 'walls are solid through the doors', plant: swap({ wallSpans: (_o, L, H, step, fn) => wallSpans([], L, H, step, fn) }) },
  { rule: 'J1', name: 'the floor slab is left out', plant: swap({ buildRoomGeometry: (r, o) => ({ ...buildRoomGeometry(r, o), floor: { p: [], n: [] } }) }) },
  { rule: 'J1', name: 'a NaN in the frame', plant: swap({ buildRoomGeometry: (r, o) => { const g = buildRoomGeometry(r, o); return { ...g, studs: { ...g.studs, p: g.studs.p.map((v, i) => (i === 4 ? Number.NaN : v)) } }; } }) },
  { rule: 'J2', name: 'the cut is ignored', plant: swap({ buildRoomGeometry: (r) => buildRoomGeometry(r, { cutHeightM: null }) }) },
  { rule: 'J2', name: 'walls are always cut', plant: swap({ buildRoomGeometry: (r) => buildRoomGeometry(r, { cutHeightM: 1.25 }) }) },
  { rule: 'J3', name: 'the faint part starts at the beginning', plant: swap({ revealRange: (b, s, g) => ({ ...revealRange(b, s, g), ghostStart: 0 }) }) },
  { rule: 'J3', name: 'the faint part is the whole plan, over the solid part', plant: swap({ revealRange: (b, s, g) => { const r = revealRange(b, s, g); return { ...r, ghostCount: Math.round(Math.max(0, Math.min(1, g || 0)) * b) * 36 }; } }) },
  { rule: 'J4', name: 'pipes in every room', plant: swap({ buildRoomGeometry: (r, o) => buildRoomGeometry({ ...r, kind: 'kitchen' }, o) }) },
  { rule: 'J4', name: 'no pipes anywhere', plant: swap({ buildRoomGeometry: (r, o) => buildRoomGeometry({ ...r, kind: 'other' }, o), roomHasPipes: () => false }) },
  { rule: 'K1', name: 'the script is not in the gate', plant: pkgEdit((p) => { p.scripts['ship-check'] = p.scripts['ship-check'].replace(' && bun run test:living-model', ''); return p; }) },
  { rule: 'K1', name: 'the route is not declared', plant: edit('app/_layout.tsx', /\s*<Stack\.Screen name="living-model"[^\n]*\n/, '\n') },
  { rule: 'K1', name: 'the i18n surface is not registered', plant: edit('i18n/surfaces.ts', "id: 'office.living-model'", "id: 'office.living-model-x'") },
];

// ── run ──────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
console.log('validate-living-model: The Living Model, Phase 1\n');
for (const r of RULES) {
  let problems: string[];
  try { problems = r.run(WORLD); } catch (e) { problems = [`threw: ${e instanceof Error ? e.message : String(e)}`]; }
  if (problems.length === 0) { pass += 1; console.log(`  ✓ ${r.id}  ${r.what}`); }
  else { fail += 1; console.log(`  ✗ ${r.id}  ${r.what}`); for (const p of problems.slice(0, 12)) console.log(`        ${p}`); }
}

console.log('\n── planted mutations (each must turn its own rule red)');
const caught = new Set<string>();
for (const m of MUTATIONS) {
  const r = RULES.find((x) => x.id === m.rule);
  let red = false;
  let how = '';
  try {
    const w = m.plant(WORLD);
    let problems: string[];
    try { problems = r ? r.run(w) : []; } catch (e) { problems = [`threw: ${e instanceof Error ? e.message : String(e)}`]; }
    red = problems.length > 0;
    how = red ? '' : 'the rule stayed green';
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (red) { pass += 1; caught.add(m.rule); } else { fail += 1; console.log(`  ✗ ${m.rule}  NOT CAUGHT: ${m.name} (${how})`); }
}
console.log(`  ${caught.size} of ${RULES.length} rules caught a planted mutation`);
const unproven = RULES.filter((r) => !caught.has(r.id)).map((r) => r.id);
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-living-model: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
