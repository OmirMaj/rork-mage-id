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
// ADDED AFTER THE REVIEW (each with fixtures worked by hand and planted mutations):
//    A7  a saved model that cannot be read (a null wall, an unknown version, a
//        NaN) never throws, is never replaced silently and is never saved over.
//    B2  the stage table against a list of plain task names with false friends
//        ("Rough framing", "Pour concrete floor", "Floor protection").
//    B4  a person's own choice of stage wins over the table.
//    C6  the room card: a plain average with unreported tasks at 0, at the week
//        the scrubber is on, and the plan only past today.
//    C7  dates are local calendar days (9 pm in New York), a daily report dated
//        after today does not count, and the card uses the schedule's closed days.
//    C8  with no start date the notice says what Reported really shows.
//    D3  what the Suggested box lists is what Confirm ticks.
//    E6  the phone's import graph never reaches the 3D library (the same thing
//        scripts/validate-native-surface.ts checks on the real phone bundle).
//    E7  a theme change makes a new scene and the rooms are drawn into it; the
//        WebGL context is given back; a lost context is said and can be reloaded.
//    E8  the wheel and one finger still scroll the page.
//    J5  the home view fits full-height walls; a room's label gives way in a
//        small room; each room's floor carries its stage colour.
//
// NOT PROVED HERE: that WebGL draws what the numbers say (looked at through a
// headless-Chrome harness, see the lane report), pointer and touch handling
// in a real browser, and the web export's chunking of the library.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE_LIB from 'three';

import { BATH_CARD_ANSWERS, SEVEN_ROOM_ANSWERS, STAGE_TITLE_CASES, THREE_ROOM_ANSWERS, cardFixture, sevenRoomJob, tenWeekSchedule, threeRoomJob } from '../__tests__/fixtures/livingModelJobs';
import { createJobScene } from '../components/livingModel/threeScene';
import { Theme, deriveAccentPalette, getCustomPrimary, type ThemeColors } from '../constants/colors';
import { EN as EN_SHARD } from '../i18n/catalog/en/office.living-model.generated';
import { ES_OFFICE_LIVING_MODEL } from '../i18n/catalog/es/office/livingModel';
import { livingModelAllowedWith, livingModelSeat } from '../utils/livingModel/allowed';
import { canRedo, canUndo, historyOf, historyPush, historyRedo, historyUndo } from '../utils/livingModel/historyCore';
import { confirmSuggestions, liveLinks, suggestLinks, suggestionBox, type LinkTask } from '../utils/livingModel/linkCore';
import {
  GRID_M, addOpening, addRoom, deleteRoom, duplicateRoom, emptyJobModel, linkedTaskIds, makeRectRoom, modelBounds, moveRoom, openingRefusal,
  parseJobModel, polygonsOverlap, readSavedModel, rectRoomRefusal, renameRoom, roomAreaM2, roomBounds, roomFromScan, rotateRoom, setRoomKind, setRoomLevel, setRoomTaskLink, setTaskStage, validateModel, worldFloor, worldWalls,
} from '../utils/livingModel/modelCore';
import { MATERIALS, livingModelPalette, paletteModeOf } from '../utils/livingModel/palette';
import {
  cardWhen, hasAnyReport, plannedAt, reportedAt, roomCard, roomLayers, roomMoment, taskMoment, weekCount, weekOf,
  type ReplayClock, type ReplayTask,
} from '../utils/livingModel/replayCore';
import { buildReplayInput, dateOfOffset } from '../utils/livingModel/replayInput';
import {
  PIN_FULL_PX, PIN_NAME_PX, VERTS_PER_BOX, VIEW_FILL, buildRoomGeometry, canvasTouchAction, fitZoom, labelRoomPx, oneFingerTurnsModel, pinSize, revealRange, roomHasPipes,
  screenPoint, triangulate, viewExtent, wallSpans, wheelShouldZoom,
} from '../utils/livingModel/sceneCore';
import { BUILD_STAGES, STAGE_BY_TRADE, TASK_STAGES, resolveStage, stageForTask } from '../utils/livingModel/stageCore';
import { LIVING_MODEL_BACKUP_PREFIX, LIVING_MODEL_KEY_PREFIX, livingModelBackupKey, livingModelKey, mayWriteModel } from '../utils/livingModel/storeCore';
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
  // added after the review
  roomCard, buildReplayInput, readSavedModel, mayWriteModel, livingModelBackupKey, suggestionBox, resolveStage, setTaskStage, setRoomKind,
  viewExtent, pinSize, labelRoomPx, wheelShouldZoom, oneFingerTurnsModel, canvasTouchAction, createJobScene,
  MATERIALS: MATERIALS as unknown as Record<'light' | 'dark', Record<string, string | number>>,
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
const PURE_CORE = ['types', 'modelCore', 'historyCore', 'stageCore', 'replayCore', 'replayInput', 'linkCore', 'sceneCore', 'planView', 'storeCore', 'allowed', 'palette'].map((n) => `utils/livingModel/${n}.ts`);

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
  // An edit that changes nothing hands the same model back, so Undo never has an empty step to take.
  const k = base.rooms.find((r) => r.id === 'kitchen')!;
  if (w.impl.moveRoom(base, 'kitchen', k.placement.xM, k.placement.yM) !== base) out.push('a move to where the room already is made a new model: Undo would appear to do nothing');
  if (w.impl.moveRoom(base, 'kitchen', k.placement.xM + GRID_M * 0.2, k.placement.yM) !== base) out.push('a move that snaps back to the same spot made a new model');
  if (w.impl.moveRoom(base, 'no-such-room', 1, 1) !== base || w.impl.rotateRoom(base, 'no-such-room') !== base) out.push('moving or turning a room that is not there made a new model');
  if (w.impl.setRoomKind(base, 'kitchen', 'kitchen') !== base || w.impl.setRoomKind(base, 'no-such-room', 'hall') !== base) out.push('setting the kind a room already has made a new model');
  if (w.impl.setRoomKind(base, 'kitchen', 'hall') === base) out.push('a real change of kind handed the same model back');
  if (renameRoom(base, 'kitchen', ' Kitchen ') !== base || setRoomLevel(base, 'kitchen', 0) !== base) out.push('a rename or a floor change to what it already is made a new model');
  let hh = historyOf(base);
  hh = historyPush(hh, w.impl.moveRoom(base, 'kitchen', k.placement.xM, k.placement.yM));
  hh = historyPush(hh, w.impl.setRoomKind(base, 'kitchen', 'kitchen'));
  if (canUndo(hh)) out.push('edits that changed nothing were recorded for Undo');
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

/** Saved text that is there and is not a sound model of the seven-room job. [what it is, the text] */
function unreadableTexts(): [string, string][] {
  const m = sevenRoomJob();
  const withRoom0 = (fn: (r: JobModel['rooms'][number]) => unknown): string => JSON.stringify({ ...m, rooms: m.rooms.map((r, i) => (i === 0 ? fn(r) : r)) });
  return [
    ['a null wall', withRoom0((r) => ({ ...r, room: { ...r.room, walls: [null] } }))],
    ['a null wall among sound ones', withRoom0((r) => ({ ...r, room: { ...r.room, walls: [...r.room.walls, null] } }))],
    ['a wall with no end point', withRoom0((r) => ({ ...r, room: { ...r.room, walls: r.room.walls.map((x, j) => (j === 0 ? { ...x, a: null } : x)) } }))],
    ['a null opening', withRoom0((r) => ({ ...r, room: { ...r.room, openings: [null] } }))],
    ['a null floor corner', withRoom0((r) => ({ ...r, room: { ...r.room, floor: [null, ...r.room.floor] } }))],
    ['a null room', JSON.stringify({ ...m, rooms: [null, ...m.rooms] })],
    ['an unknown version', JSON.stringify({ ...m, version: 2 })],
    ['no version', JSON.stringify({ ...m, version: undefined })],
    // JSON has no NaN: JSON.stringify writes null for it, and a hand-edited file may hold the word.
    ['a NaN placement (written as null)', withRoom0((r) => ({ ...r, placement: { ...r.placement, xM: Number.NaN } }))],
    ['a NaN wall length (written as null)', withRoom0((r) => ({ ...r, room: { ...r.room, walls: r.room.walls.map((x, j) => (j === 0 ? { ...x, lengthM: Number.NaN } : x)) } }))],
    ['the bare word NaN', 'NaN'],
    ['a wall coordinate that is the text "NaN"', withRoom0((r) => ({ ...r, room: { ...r.room, walls: r.room.walls.map((x, j) => (j === 0 ? { ...x, a: { x: 'NaN', y: 0 } } : x)) } }))],
    ['cut-off JSON', JSON.stringify(m).slice(0, 400)],
    ['a list, not a model', '[1, 2, 3]'],
    ['another job\'s model', JSON.stringify({ ...m, projectId: 'p-other' })],
    ['rooms that is not a list', JSON.stringify({ ...m, rooms: { 0: m.rooms[0] } })],
  ];
}

rule('A7', 'a saved model that cannot be read never throws, is said to be unreadable, and is never saved over until the person starts a new one', (w) => {
  const out: string[] = [];
  for (const [what, text] of unreadableTexts()) {
    let got: { state: string } | null = null;
    try { got = w.impl.readSavedModel(text, 'p-seven'); } catch (e) { out.push(`${what}: reading it THREW (${e instanceof Error ? e.message.slice(0, 60) : e}); the screen would hang on "Reading the model"`); continue; }
    if (got.state !== 'unreadable') out.push(`${what}: read as "${got.state}", want "unreadable" (an empty model here is saved over the person's rooms on the first edit)`);
    try { if (w.impl.parseJobModel(text, 'p-seven') !== null) out.push(`${what}: parseJobModel handed back a model`); } catch { out.push(`${what}: parseJobModel threw`); }
  }
  for (const nothing of [null, undefined, '']) if (w.impl.readSavedModel(nothing as never, 'p-seven').state !== 'empty') out.push(`${JSON.stringify(nothing)} (nothing saved) is not read as "empty"`);
  const good = w.impl.readSavedModel(JSON.stringify(sevenRoomJob()), 'p-seven');
  if (good.state !== 'ok' || good.model.rooms.length !== 7) out.push('a sound model is not read as "ok"');
  // Nothing is written while unread text sits under the key.
  if (w.impl.mayWriteModel('unreadable') !== false) out.push('a change may be saved over text that could not be read');
  if (w.impl.mayWriteModel('ready') !== true || w.impl.mayWriteModel('started_new') !== true) out.push('a sound model, or a new one the person chose to start, cannot be saved');
  const bk = w.impl.livingModelBackupKey('user-1', 'proj-9');
  if (!bk || bk === w.impl.livingModelKey('user-1', 'proj-9') || !bk.startsWith('mageid_') || !isAppStorageKey(bk) || !bk.includes('user-1') || !bk.includes('proj-9')) out.push(`the backup key ${bk} is not an app-owned key of its own, per person and project`);
  if (w.impl.livingModelBackupKey(null, 'p') !== null) out.push('a backup key is made with no person');
  if (!LIVING_MODEL_BACKUP_PREFIX.startsWith(LIVING_MODEL_KEY_PREFIX.replace('::', '')) || (LIVING_MODEL_BACKUP_PREFIX as string) === (LIVING_MODEL_KEY_PREFIX as string)) out.push('the backup prefix is not beside the model prefix');
  // The store: the unread text is copied as it is, and the model key is written only past the guard.
  const store = code(w.files['utils/livingModel/store.ts'] ?? '');
  const load = store.slice(store.indexOf('export async function loadJobModel'), store.indexOf('export async function keepUnreadText'));
  if (!/readSavedModel\(raw, projectId\)/.test(load) || !/await keepUnreadText\(userId, projectId, raw as string\);\s*return \{ model: emptyJobModel\(projectId\), state: 'unreadable' \};/.test(load)) out.push('loadJobModel does not keep unread text and answer "unreadable"');
  if (/setItem\(key|removeItem|\.clear\(/.test(load)) out.push('loadJobModel writes over or removes the stored model');
  const keep = store.slice(store.indexOf('export async function keepUnreadText'), store.indexOf('export async function saveJobModel'));
  if (!/AsyncStorage\.setItem\(backup, raw\)/.test(keep)) out.push('the unread text is not copied untouched under the backup key');
  const save = store.slice(store.indexOf('export async function saveJobModel'));
  const guardAt = save.indexOf('!mayWriteModel(state)');
  const writeAt = save.indexOf('AsyncStorage.setItem(key, json)');
  if (guardAt < 0 || writeAt < 0 || guardAt > writeAt || !/if \(!key \|\| !mayWriteModel\(state\)\) return false;/.test(save)) out.push('saveJobModel writes the model key without asking mayWriteModel first');
  // The screen: a plain sentence, no editor until the person chooses, and the choice is a tap.
  const scr = code(w.files['components/livingModel/LivingModelScreen.tsx'] ?? '');
  if (!/\.catch\(\(\) => \{/.test(scr.slice(scr.indexOf('void loadJobModel('), scr.indexOf('const persist =')))) out.push('the screen has no catch on the load: a failed read would leave it on "Reading the model"');
  if (!/const blocked = loadState === 'unreadable';/.test(scr)) out.push('the screen does not know when the saved model could not be read');
  if (!/\{model && blocked \? \(\s*<View[^>]*testID="lm-unreadable">[\s\S]{0,400}\{copy\.unreadableTitleBody\}[\s\S]{0,200}\{copy\.unreadableBody\}[\s\S]{0,200}<Button label=\{copy\.startNewLabel\}[^>]*onPress=\{onStartNew\}/.test(scr)) out.push('the screen does not say the model could not be read, with a Start a New Model button');
  for (const tab of ['rooms', 'tasks', 'replay']) if (!new RegExp(`\\{model && !blocked && tab === '${tab}' \\?`).test(scr)) out.push(`the ${tab} tab is drawn while the saved model is unread: an edit there would be the first step to saving over it`);
  if (!/if \(!mayWriteModel\(loadStateRef\.current\)\) return;\s*void saveJobModel\(userId, m, new Date\(\)\.toISOString\(\), loadStateRef\.current\)/.test(scr)) out.push('the screen saves without asking mayWriteModel');
  const startFn = /const onStartNew = useCallback\(\(\) => \{([\s\S]*?)\}, \[\]\);/.exec(scr);
  if (!startFn || !startFn[1].includes("loadStateRef.current = 'started_new'")) out.push('the Start a New Model button does not start a new model');
  // The words 'started_new' appear in the button's own function and in the one place the screen asks about it, and nowhere else.
  const elsewhere = scr.replace(startFn ? startFn[0] : '', '').replace(/loadState === 'started_new'/g, '');
  if (/started_new/.test(elsewhere)) out.push('"started_new" is set somewhere other than the Start a New Model button: the screen would start a new model without being asked');
  if (/useEffect\([^)]*onStartNew\(\)/.test(scr)) out.push('Start a New Model is called from an effect');
  if (w.EN[`${K}load.startNewLabel`] !== 'Start a New Model') out.push('the button is not called Start a New Model');
  const said = `${w.EN[`${K}load.unreadableTitleBody`]} ${w.EN[`${K}load.unreadableBody`]}`;
  if (!/could not be read/.test(said) || !/has not been changed or removed/.test(said) || !/Nothing is saved over the old one until you do\./.test(said)) out.push(`the sentence does not say the model could not be read, was not changed, and is not saved over: "${said}"`);
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
  // The plain names with false friends (__tests__/fixtures/livingModelJobs.ts STAGE_TITLE_CASES).
  if (STAGE_TITLE_CASES.length < 30) out.push('the list of task names was cut down');
  for (const [title, trade, want] of STAGE_TITLE_CASES) {
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

rule('B4', 'a person may pick a task\'s stage himself; his choice wins over the table, is kept with the ticks, and can be taken back', (w) => {
  const out: string[] = [];
  const a = w.impl.resolveStage('Rough framing', 'framing', 'finishes');
  if (a.stage !== 'finishes' || a.by !== 'person') out.push(`a picked stage reads ${a.stage} by ${a.by}; want finishes by person`);
  for (const junk of [undefined, null, '', 'done', 'no_tasks', 'Finishes', 7, {}]) {
    const b = w.impl.resolveStage('Rough framing', 'framing', junk);
    if (b.stage !== 'framing' || b.by === 'person') out.push(`a choice of ${JSON.stringify(junk)} was taken as a stage`);
  }
  if (w.impl.resolveStage('Coordination', 'general', 'other').by !== 'person') out.push('picking Other Work is not recorded as the person\'s choice');
  if (TASK_STAGES.length !== 7 || TASK_STAGES[TASK_STAGES.length - 1] !== 'other') out.push('the picker does not offer the six stages and Other Work');
  // Kept in the model, beside the ticks.
  const base = sevenRoomJob();
  const picked = w.impl.setTaskStage(base, 'frame', 'finishes');
  if (picked === base || picked.stages?.frame !== 'finishes') out.push('picking a stage did not write it into the model');
  if (JSON.stringify(picked.links) !== JSON.stringify(base.links) || picked.rooms !== base.rooms) out.push('picking a stage changed the ticks or the rooms');
  if (w.impl.setTaskStage(picked, 'frame', 'finishes') !== picked) out.push('picking the stage a task already has made a new model');
  if (w.impl.setTaskStage(base, 'frame', null) !== base) out.push('taking back a choice that was never made changed the model');
  const back = w.impl.setTaskStage(picked, 'frame', null);
  if (back.stages !== undefined) out.push('taking the last choice back left an empty list in the model');
  if (w.impl.setTaskStage(base, 'frame', 'done' as never) !== base) out.push('a stage that is not a task stage was written');
  const round = w.impl.readSavedModel(JSON.stringify(picked), 'p-seven');
  if (round.state !== 'ok' || round.model.stages?.frame !== 'finishes') out.push('the picked stage did not survive a save and a read');
  const dirty = w.impl.readSavedModel(JSON.stringify({ ...picked, stages: { frame: 'finishes', demo: 'nonsense', elec: 3 } }), 'p-seven');
  if (dirty.state !== 'ok' || dirty.model.stages?.demo !== undefined || dirty.model.stages?.frame !== 'finishes') out.push('a saved stage that is not a stage was read back');
  // The replay reads it.
  const sched = { id: 's', projectId: 'p', startDate: '2026-10-05', workingDaysPerWeek: 5, tasks: [{ id: 'frame', title: 'Rough framing', startDay: 1, durationDays: 5, progress: 0, status: 'not_started', dependencies: [] }] } as never;
  const plain = w.impl.buildReplayInput(sched, [], new Date(2026, 9, 9, 10));
  const chosen = w.impl.buildReplayInput(sched, [], new Date(2026, 9, 9, 10), { frame: 'finishes' });
  if (plain.tasks[0].stage !== 'framing' || plain.stageBy.frame === 'person') out.push(`with no choice "Rough framing" reads ${plain.tasks[0].stage}`);
  if (chosen.tasks[0].stage !== 'finishes' || chosen.stageBy.frame !== 'person') out.push(`with Finishes picked the replay still reads ${chosen.tasks[0].stage}`);
  // The Tasks tab: a small picker per task, writing through setTaskStage from a tap.
  const tl = code(w.files['components/livingModel/TaskLinks.tsx'] ?? '');
  if (!/TASK_STAGES\.map\(\(st\) =>/.test(tl) || !/onPress=\{\(\) => \{ onChange\(setTaskStage\(model, t\.id, st\)\); setStageFor\(null\); \}\}/.test(tl)) out.push('the Tasks tab has no stage picker that writes the picked stage');
  if (!/onChange\(setTaskStage\(model, t\.id, null\)\)/.test(tl) || !/\{copy\.stageFromTitleLabel\}/.test(tl)) out.push('the picker cannot go back to reading the title');
  if (!/input\.stageBy\[t\.id\] === 'person'/.test(tl) || !/copy\.stagePickedSub\(/.test(tl)) out.push('a stage the person picked is not marked as his');
  const scr = code(w.files['components/livingModel/LivingModelScreen.tsx'] ?? '');
  if (!/buildReplayInput\(project\?\.schedule \?\? null, reports, now, chosenStages\)/.test(scr) || !/const chosenStages = model\?\.stages;/.test(scr)) out.push('the screen does not hand the picked stages to the replay');
  const callers = Object.keys(w.files).filter((f) => f !== 'utils/livingModel/modelCore.ts' && /\bsetTaskStage\s*\(/.test(code(w.files[f])));
  if (callers.join() !== 'components/livingModel/TaskLinks.tsx') out.push(`setTaskStage is called from ${callers.join(', ') || 'nowhere'}; want only the Tasks tab`);
  if (w.EN[`${K}tasks.stageFromTitleLabel`] !== 'Read from the Title') out.push('the way back is not called Read from the Title');
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

const AVERAGE_LINE = 'Average of the {count} ticked tasks. A task with nothing reported counts as 0.';

rule('C6', 'the room card is a plain average with unreported tasks at 0, for the week the scrubber is on, and the plan only past today', (w) => {
  const out: string[] = [];
  // The hand-worked three: 100, 50 and nothing reported.
  const f = cardFixture();
  const c = w.impl.roomCard(f.tasks, f.points, f.clock, f.clock.todayOffset, 'reported');
  if (c.pct === f.answers.weightedWouldBe) out.push(`the card reads ${c.pct}: that is an average weighted by duration, which the line under it does not say`);
  else if (c.pct === f.answers.leftOutWouldBe) out.push(`the card reads ${c.pct}: the task with nothing reported was left out instead of counting as 0`);
  else if (c.pct !== f.answers.pct) out.push(`the card reads ${c.pct}; (100 + 50 + 0) / 3 is ${f.answers.pct}`);
  if (c.unreported !== f.answers.unreported || c.taskCount !== 3) out.push(`the card counts ${c.unreported} unreported of ${c.taskCount}; want 1 of 3`);
  if (c.when !== 'today' || c.reading !== 'reported') out.push(`on today the card says ${c.when}, ${c.reading}`);
  const rowC = c.rows.find((r) => r.id === 'C');
  if (!rowC || rowC.reportedPct !== null) out.push('the task with nothing reported shows a percent on its row');
  // The bath on the ten-week job, at three places on the scrubber.
  const s = tenWeekSchedule();
  const bath = s.tasks.filter((t) => sevenRoomJob().links.bath.includes(t.id));
  const A = BATH_CARD_ANSWERS;
  const wk3 = w.impl.roomCard(bath, s.points, s.clock, A.week3.offset, 'reported');
  if (wk3.when !== 'earlier' || wk3.reading !== 'reported') out.push(`at week 3 the card says ${wk3.when}, ${wk3.reading}; want earlier, reported`);
  if (wk3.pct !== A.week3.reported) out.push(`at week 3 the card reads ${wk3.pct}; that week it was ${A.week3.reported} (today it is ${A.today.reported}: the card must follow the scrubber)`);
  if (wk3.unreported !== A.week3.unreported) out.push(`at week 3 the card counts ${wk3.unreported} with nothing reported; by then it was ${A.week3.unreported}`);
  if (wk3.rows.find((r) => r.id === 'dry')?.reportedPct !== null) out.push('at week 3 drywall shows a percent it was not reported at until week 6');
  if (wk3.rows.find((r) => r.id === 'plumb')?.reportedPct !== 40) out.push('at week 3 rough plumbing does not show the 40 its daily report gave it that week');
  const wk3p = w.impl.roomCard(bath, s.points, s.clock, A.week3.offset, 'planned');
  if (wk3p.pct !== A.week3.planned || wk3p.reading !== 'planned' || wk3p.unreported !== 0) out.push(`at week 3, Planned reads ${wk3p.pct} (${wk3p.reading}); want ${A.week3.planned}`);
  const now = w.impl.roomCard(bath, s.points, s.clock, A.today.offset, 'reported');
  if (now.pct !== A.today.reported || now.unreported !== A.today.unreported || now.when !== 'today') out.push(`today the card reads ${now.pct}, ${now.unreported} unreported, ${now.when}; want ${A.today.reported}, ${A.today.unreported}, today`);
  if (w.impl.roomCard(bath, s.points, s.clock, A.today.offset + 0.2, 'reported').when !== 'today' || cardWhen(A.today.offset + 0.4, s.clock) !== 'ahead' || cardWhen(A.today.offset - 0.4, s.clock) !== 'earlier') out.push('"as of today" is said when the scrubber is not on today, or not said when it is');
  for (const mode of ['reported', 'planned'] as const) {
    const ahead = w.impl.roomCard(bath, s.points, s.clock, A.week8.offset, mode);
    if (ahead.when !== 'ahead' || ahead.reading !== 'plan_ahead') out.push(`past today (${mode}) the card says ${ahead.when}, ${ahead.reading}; want ahead, plan_ahead`);
    if (ahead.pct !== A.week8.planOnly) out.push(`past today (${mode}) the card reads ${ahead.pct}; the plan for that week is ${A.week8.planOnly}`);
    if (ahead.unreported !== 0) out.push('past today the card still counts unreported tasks, though it shows the plan only');
  }
  const none: ReplayClock = { ...s.clock, hasStartDate: false, todayOffset: 0 };
  if (w.impl.roomCard(bath, [], none, 15, 'reported').when !== 'undated') out.push('with no start date the card claims a today');
  if (w.impl.roomCard([], [], s.clock, 10, 'reported').pct !== 0) out.push('a room with no ticked tasks does not read 0');
  // The words under the number say what it is, and the number on the screen is the card's.
  const en = w.EN[`${K}card.averageReportedBody`] as Record<string, string> | undefined;
  if (!en || en.other !== AVERAGE_LINE) out.push(`the line under the number reads ${JSON.stringify(en?.other)}`);
  if (!en || !/counts as 0\.$/.test(en.one ?? '') || /\{count\}/.test(en.one ?? '') === false && !/\b1\b/.test(en.one ?? '')) out.push('the line for a single task does not say a task with nothing reported counts as 0');
  for (const k of ['card.averageReportedBody', 'card.averagePlannedBody']) for (const form of strings(w.EN[`${K}${k}`])) if (/weight|duration|longer/i.test(form)) out.push(`${k} speaks of weighting, and the arithmetic does not weight`);
  if (w.EN[`${K}card.asOfTodaySub`] !== 'As of today') out.push('"As of today" changed');
  if (!/past today/.test(String(w.EN[`${K}card.planOnlyBody`])) || !/plan only\.$/.test(String(w.EN[`${K}card.planOnlyBody`]))) out.push('the past-today line does not say the card shows the plan only');
  const sh = code(w.files['components/livingModel/replayShared.tsx'] ?? '');
  const panel = sh.slice(sh.indexOf('export function RoomCardPanel('));
  if (!/roomCard\(tasks, input\.points, input\.clock, offset, mode\)/.test(panel)) out.push('the room card is not worked out for the moment the scrubber is on');
  if (/todayOffset/.test(panel)) out.push('the room card reads today\'s moment itself: it must take the scrubber\'s');
  if (!/testID="lm-card-pct">\{`\$\{card\.pct\}%`\}/.test(panel)) out.push('the big number is not the card\'s own figure');
  if (!/<Text[^>]*testID="lm-card-average">\{card\.reading === 'reported' \? copy\.averageReportedBody\(card\.taskCount\) : copy\.averagePlannedBody\(card\.taskCount\)\}<\/Text>/.test(panel)) out.push('the card does not say, under the number, what the number is');
  if (/\{[^{}\n]*(&&|\?)[^{}\n]*<Text[^>]*testID="lm-card-average"/.test(panel)) out.push('the line under the number sits behind a condition');
  if (!/card\.when === 'today' \? copy\.asOfTodaySub/.test(panel)) out.push('"As of today" is not tied to the scrubber being on today');
  if (!/\{card\.reading === 'plan_ahead' \? <Text[^>]*testID="lm-card-plan-only">\{copy\.planOnlyBody\}<\/Text> : null\}/.test(panel)) out.push('past today the card does not say it shows the plan only');
  const scr = code(w.files['components/livingModel/LivingModelScreen.tsx'] ?? '');
  if (!/<RoomCardPanel[^>]*mode=\{state\.mode\} offset=\{state\.offset\}/.test(scr)) out.push('the screen does not hand the scrubber\'s moment to the room card');
  return out;
});

/** Run with the clock of one place, whatever machine this is: a wrong date read shows only where local and UTC days differ. */
function inZone<T>(zone: string, fn: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try { return fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

rule('C7', 'dates are local calendar days (9 pm in New York), a daily report dated after today does not count, and the card uses the schedule\'s closed days', (w) => {
  const out: string[] = [];
  inZone('America/New_York', () => {
    // Monday 5 October 2026 is day 1. Tuesday the 6th is day 2. Today is Friday the 9th: day 5.
    const ninePm = new Date(2026, 9, 6, 21, 0, 0);
    const iso = ninePm.toISOString();
    if (!iso.startsWith('2026-10-07')) { out.push(`the probe is not set up: 9 pm on the 6th in New York should be the 7th in UTC text, got ${iso}`); return; }
    const sched = {
      id: 's', projectId: 'p', startDate: '2026-10-05', workingDaysPerWeek: 5,
      tasks: [
        { id: 'a', title: 'Demo', startDay: 1, durationDays: 5, progress: 100, status: 'done', actualStartDate: new Date(2026, 9, 5, 7, 30).toISOString(), actualEndDate: iso, dependencies: [] },
        { id: 'b', title: 'Framing', startDay: 6, durationDays: 5, progress: 0, status: 'not_started', dependencies: [] },
      ],
    } as never;
    const reports = [
      { id: 'r1', projectId: 'p', date: iso, workProgress: [{ taskId: 'a', pct: 40 }] },
      { id: 'r2', projectId: 'p', date: '2026-10-08', workProgress: [{ taskId: 'a', pct: 80 }] },
      { id: 'r3', projectId: 'p', date: new Date(2026, 9, 20, 12).toISOString(), workProgress: [{ taskId: 'b', pct: 90 }] },
      { id: 'r4', projectId: 'p', date: '2026-10-10', workProgress: [{ taskId: 'b', pct: 70 }] },
      { id: 'r5', projectId: 'p', date: new Date(2026, 9, 9, 23, 30).toISOString(), workProgress: [{ taskId: 'b', pct: 10 }] },
    ] as never;
    const inp = w.impl.buildReplayInput(sched, reports, new Date(2026, 9, 9, 10, 0));
    const a = inp.tasks.find((t) => t.id === 'a')!;
    if (a.actualEndOffset !== 2) out.push(`a task finished at 9 pm on Tuesday the 6th in New York is placed on day ${a.actualEndOffset}; want day 2 (its UTC text reads the 7th, which is day 3)`);
    if (a.actualStartOffset !== 1) out.push(`a task started at 7:30 am on day 1 is placed on day ${a.actualStartOffset}`);
    const r1 = inp.points.find((p) => p.taskId === 'a' && p.pct === 40);
    if (!r1 || r1.offset !== 2) out.push(`a daily report filed at 9 pm on the 6th is placed on day ${r1?.offset}; want day 2`);
    const r2 = inp.points.find((p) => p.taskId === 'a' && p.pct === 80);
    if (!r2 || r2.offset !== 4) out.push(`a daily report dated the bare day 2026-10-08 is placed on day ${r2?.offset}; want day 4`);
    if (inp.clock.todayOffset !== 5) out.push(`today, Friday the 9th, is day ${inp.clock.todayOffset}; want 5`);
    // After today: left out, and the task is still said to have nothing reported.
    if (inp.points.some((p) => p.pct === 90 || p.pct === 70)) out.push('a daily report dated after today was counted');
    if (inp.futureReports !== 2) out.push(`${inp.futureReports} daily reports were left out as dated after today; want 2`);
    const r5 = inp.points.find((p) => p.pct === 10);
    if (!r5 || r5.offset !== 5) out.push('a daily report filed late this evening (today, though tomorrow in UTC text) was left out or misplaced');
    const b = inp.tasks.find((t) => t.id === 'b')!;
    const justFuture = w.impl.buildReplayInput(sched, [reports[2], reports[3]] as never, new Date(2026, 9, 9, 10, 0));
    if (hasAnyReport(b, justFuture.points)) out.push('a task whose only daily reports are dated after today is said to have progress reported');
    if (w.impl.roomCard([b], justFuture.points, justFuture.clock, justFuture.clock.todayOffset, 'reported').rows[0].reportedPct !== null) out.push('a room card row shows a percent from a daily report dated after today');
  });
  inZone('Asia/Tokyo', () => {
    // East of Greenwich the same mistake shows in the morning: 1 am on the 7th in Tokyo is still the 6th in UTC text.
    const oneAm = new Date(2026, 9, 7, 1, 0, 0);
    const sched = { id: 's', projectId: 'p', startDate: '2026-10-05', workingDaysPerWeek: 5, tasks: [{ id: 'a', title: 'Demo', startDay: 1, durationDays: 5, progress: 100, status: 'done', actualEndDate: oneAm.toISOString(), dependencies: [] }] } as never;
    const inp = w.impl.buildReplayInput(sched, [], new Date(2026, 9, 9, 10, 0));
    if (inp.tasks[0].actualEndOffset !== 3) out.push(`a task finished at 1 am on Wednesday the 7th in Tokyo is placed on day ${inp.tasks[0].actualEndOffset}; want day 3`);
  });
  // The schedule's closed days reach the card's dates.
  const closed = { id: 's', projectId: 'p', startDate: '2026-10-05', workingDaysPerWeek: 5, nonWorkingDates: ['2026-10-07'], tasks: [{ id: 'a', title: 'Demo', startDay: 1, durationDays: 5, progress: 0, status: 'not_started', dependencies: [] }] } as never;
  const ci = w.impl.buildReplayInput(closed, [], new Date(2026, 9, 9, 10, 0));
  if (ci.nonWorkingDates.join() !== '2026-10-07') out.push('the schedule\'s closed days are not carried to the replay');
  const d2 = dateOfOffset(ci, 2);
  const d4 = dateOfOffset(ci, 4);
  if (!d2 || d2.getDate() !== 8) out.push(`with Wednesday the 7th closed, the third working day is the ${d2?.getDate()}th; the schedule screen says the 8th`);
  if (!d4 || d4.getDate() !== 12) out.push(`with Wednesday the 7th closed, the fifth working day is the ${d4?.getDate()}th; the schedule screen says Monday the 12th`);
  if (dateOfOffset({ ...ci, startDate: null }, 2) !== null) out.push('a date is made up for a schedule with no start date');
  const sh = code(w.files['components/livingModel/replayShared.tsx'] ?? '');
  if (!/const d = dateOfOffset\(input, at\);/.test(sh)) out.push('the room card does not work its dates out with the schedule\'s closed days');
  if (/addWorkingDays\(/.test(sh)) out.push('the room card counts working days itself, without the schedule\'s closed days');
  const ri = code(w.files['utils/livingModel/replayInput.ts'] ?? '');
  if (/\.slice\(0, 10\)/.test(ri)) out.push('replayInput reads a date by cutting its text: an evening in New York lands on the next day');
  if (!/calendarDayStart\(value\)/.test(ri) || !/calendarDayStart\(r\.date\)/.test(ri)) out.push('replayInput does not read dates through utils/calendarDate.calendarDayStart');
  return out;
});

const NO_START = 'Daily reports cannot be placed without a start date. Reported shows only the schedule’s own progress.';
rule('C8', 'with no start date the notice says what Reported really shows, and leads to where the date is set', (w) => {
  const out: string[] = [];
  const sched = {
    id: 's', projectId: 'p', workingDaysPerWeek: 5,
    tasks: [
      { id: 'a', title: 'Demo', startDay: 1, durationDays: 5, progress: 40, status: 'in_progress', dependencies: [] },
      { id: 'b', title: 'Framing', startDay: 6, durationDays: 5, progress: 0, status: 'not_started', dependencies: [] },
    ],
  } as never;
  const reports = [{ id: 'r', projectId: 'p', date: '2026-10-06', workProgress: [{ taskId: 'a', pct: 90 }, { taskId: 'b', pct: 55 }] }] as never;
  const inp = w.impl.buildReplayInput(sched, reports, new Date(2026, 9, 9, 10, 0));
  if (inp.clock.hasStartDate || inp.startDate !== null) out.push('a schedule with no start date is said to have one');
  if (inp.points.length !== 0) out.push(`${inp.points.length} daily report percents were placed with no start date: there is no day to put them on`);
  const a = inp.tasks.find((t) => t.id === 'a')!;
  const b = inp.tasks.find((t) => t.id === 'b')!;
  for (const at of [0, 3, 10]) {
    if (!near(w.impl.reportedAt(a, inp.points, at, inp.clock.todayOffset), 0.4)) out.push(`with no start date, Reported for a task at 40 in the schedule reads ${w.impl.reportedAt(a, inp.points, at, inp.clock.todayOffset)} at day ${at}: the notice says it shows the schedule's own progress`);
    if (w.impl.reportedAt(b, inp.points, at, inp.clock.todayOffset) !== 0) out.push('with no start date, a task with only a daily report shows that report');
  }
  const card = w.impl.roomCard([a, b], inp.points, inp.clock, 3, 'reported');
  if (card.when !== 'undated' || card.pct !== 20) out.push(`with no start date the card reads ${card.pct} (${card.when}); want 20, the plain average of the schedule's own 40 and 0`);
  if (w.EN[`${K}replay.noStartBody`] !== NO_START) out.push(`the notice reads ${JSON.stringify(w.EN[`${K}replay.noStartBody`])}`);
  if (/shows as the plan/i.test(String(w.EN[`${K}replay.noStartBody`]))) out.push('the notice says all of it shows as the plan, which is not so: Reported still draws the schedule\'s own progress');
  if (w.EN[`${K}replay.setStartLabel`] !== 'Set a Start Date') out.push('the link is not called Set a Start Date');
  const sh = code(w.files['components/livingModel/replayShared.tsx'] ?? '');
  if (!/\{!clock\.hasStartDate \? \(\s*<View[^>]*testID="lm-no-start">\s*<Text[^>]*>\{copy\.noStartBody\}<\/Text>\s*\{onSetStartDate \? <Button label=\{copy\.setStartLabel\}[^>]*onPress=\{onSetStartDate\}/.test(sh)) out.push('the notice is not shown with its link while the schedule has no start date');
  const scr = code(w.files['components/livingModel/LivingModelScreen.tsx'] ?? '');
  if (!/const onSetStartDate = useCallback\(\(\) => router\.push\(\{ pathname: '\/schedule-pro', params: \{ projectId \} \}\), \[router, projectId\]\);/.test(scr)) out.push('the link does not open this project\'s schedule, where the start date is set');
  if (!/<ReplayControls input=\{input\} state=\{state\} onSetStartDate=\{onSetStartDate\} \/>/.test(scr)) out.push('the replay controls are not handed the link');
  if (!w.files['app/schedule-pro.tsx']) out.push('/schedule-pro is not a route');
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
  const tl = code(w.files['components/livingModel/TaskLinks.tsx'] ?? '');
  const calls = tl.match(/confirmSuggestions\s*\(/g) ?? [];
  if (calls.length !== 1 || !/onPress=\{\(\) => onChange\(confirmSuggestions\(/.test(tl)) out.push('confirmSuggestions is not called from exactly one onPress');
  if (/useEffect[\s\S]{0,400}confirmSuggestions/.test(tl)) out.push('confirmSuggestions is called from an effect');
  const suggesters = Object.keys(w.files).filter((f) => f !== 'utils/livingModel/linkCore.ts' && /\b(suggestLinks|suggestionBox)\s*\(/.test(code(w.files[f])));
  if (suggesters.join() !== 'components/livingModel/TaskLinks.tsx') out.push(`suggestions are asked for from ${suggesters.join(', ')}; the replay must never see a suggestion`);
  const core = w.files['utils/livingModel/linkCore.ts'];
  const body = core.slice(core.indexOf('export function suggestLinks'), core.indexOf('export function confirmSuggestions'));
  if (/setRoomTaskLink|\.links\[/.test(body)) out.push('suggestLinks or suggestionBox writes a link');
  return out;
});

rule('D3', 'what the Suggested box lists is what Confirm ticks: every name on screen, and no task whose name was not', (w) => {
  const out: string[] = [];
  // Nine suggestions for one kitchen: more than the six the box once stopped at.
  const tasks: LinkTask[] = [
    { id: 'k1', title: 'Demo kitchen', trade: 'demo' }, { id: 'k2', title: 'Kitchen cabinets', trade: 'finish' }, { id: 'k3', title: 'Countertop template', trade: 'finish' },
    { id: 'k4', title: 'Backsplash tile', trade: 'finish' }, { id: 'k5', title: 'Set appliances', trade: 'general' }, { id: 'k6', title: 'Range hood duct', trade: 'hvac' },
    { id: 'k7', title: 'Rough plumbing', trade: 'plumbing' }, { id: 'k8', title: 'Set sink and faucet', trade: 'plumbing' }, { id: 'k9', title: 'Kitchen paint', trade: 'finish' },
    { id: 'x1', title: 'Roof repair', trade: 'roofing' }, { id: 'x2', title: 'Paint bedrooms', trade: 'finish' },
  ];
  const model = addRoom(emptyJobModel('p'), makeRectRoom({ id: 'k', name: 'Kitchen', kind: 'kitchen', widthM: ft(12), lengthM: ft(10), heightM: ft(8) }));
  const box = w.impl.suggestionBox(model.rooms[0], tasks, []);
  const want = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'];
  const listedIds = box.listed.map((l) => l.taskId);
  if (listedIds.join() !== want.join()) out.push(`the box lists ${listedIds.join(', ') || 'nothing'}; nine tasks are suggested for this kitchen and every one has to be on screen`);
  if (box.confirmIds.join() !== listedIds.join()) out.push(`Confirm would tick ${box.confirmIds.join(', ')}, but the box lists ${listedIds.join(', ')}: a task whose name was not on screen would be ticked`);
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  for (const l of box.listed) if (!l.title || l.title !== titleOf.get(l.taskId)) out.push(`the box lists task ${l.taskId} as "${l.title}", not by its own name`);
  for (const id of box.confirmIds) if (!box.listed.some((l) => l.taskId === id && l.title)) out.push(`Confirm would tick ${id}, whose name is not listed`);
  // Confirming exactly those ticks exactly those.
  const done = w.impl.confirmSuggestions(model, 'k', box.confirmIds);
  if (linkedTaskIds(done, 'k').slice().sort().join() !== listedIds.slice().sort().join()) out.push('after Confirm the ticked tasks are not the listed ones');
  if (linkedTaskIds(done, 'k').some((id) => id.startsWith('x'))) out.push('Confirm ticked a task that was never suggested');
  if (w.impl.suggestionBox(done.rooms[0], tasks, linkedTaskIds(done, 'k')).listed.length !== 0) out.push('a ticked task is still listed as suggested');
  const some = w.impl.suggestionBox(model.rooms[0], tasks, ['k1', 'k7']);
  if (some.listed.length !== 7 || some.confirmIds.includes('k1') || some.confirmIds.includes('k7')) out.push('a task already ticked is listed or would be ticked again');
  // The screen prints every listed line and confirms the box's own ids.
  const tl = code(w.files['components/livingModel/TaskLinks.tsx'] ?? '');
  if (!/const box = useMemo\(\(\) => \(room \? suggestionBox\(room, input\.linkTasks, live\.ids\)/.test(tl)) out.push('the Tasks tab does not build the Suggested box from suggestionBox');
  if (!/\{box\.listed\.map\(\(s, i\) => <Text[^>]*>\{s\.title\}<\/Text>\)\}/.test(tl)) out.push('the Suggested box does not print every listed task');
  if (!/onPress=\{\(\) => onChange\(confirmSuggestions\(model, room\.id, box\.confirmIds\)\)\}/.test(tl)) out.push('Confirm Suggested does not tick the box\'s own list');
  if (/\.slice\(/.test(tl)) out.push('the Tasks tab cuts a list short: the box would list fewer tasks than Confirm ticks');
  if (/numberOfLines/.test(tl.slice(tl.indexOf('testID="lm-suggestion-list"'), tl.indexOf('testID="lm-confirm-suggested"')))) out.push('a suggested task\'s name may be cut off in the box');
  if (!/<ScrollView[^>]*testID="lm-suggestion-list">/.test(tl)) out.push('the Suggested box does not scroll, so a long list would push Confirm off the screen');
  if (!/\{copy\.suggestedBody\(box\.listed\.length\)\}/.test(tl)) out.push('the count in the Suggested box is not the count of what it lists');
  return out;
});

// E. the 3D library
const THREE_SPEC = /['"]three(?:\/[^'"]*)?['"]/;
/** The one file the phone reaches its 3D engine through (lane PHONE3D; scripts/validate-phone-3d.ts holds the rest of its rules). */
const PHONE_ENGINE = 'components/livingModel/phone3d/engine.ts';
/** The simulator check: the one file outside the feature that may draw the model, and only in a Mac-made build (see rule G5). */
const PHONE_SPIKE = 'app/dev-phone-3d.tsx';
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

rule('E2', 'the 3D library is loaded by ONE dynamic import per platform: the web view behind Platform.OS === \'web\', and the phone\'s engine file behind its optional lookup', (w) => {
  const out: string[] = [];
  const hits: string[] = [];
  for (const [f, src] of Object.entries(w.files)) {
    if (!/\.(ts|tsx|js|jsx)$/.test(f) || f.endsWith('.d.ts')) continue;
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const all = code.match(/import\s*\(\s*['"]three(?:\/[^'"]*)?['"]\s*\)/g) ?? [];
    const typeOnly = code.match(/typeof\s+import\s*\(\s*['"]three['"]\s*\)/g) ?? [];
    for (let i = 0; i < all.length - typeOnly.length; i++) hits.push(f);
  }
  const WANT = ['components/livingModel/JobReplay3D.web.tsx', PHONE_ENGINE];
  if (hits.slice().sort().join() !== WANT.slice().sort().join()) out.push(`the library is loaded from ${hits.join(', ') || 'nowhere'}; want once from JobReplay3D.web.tsx and once from ${PHONE_ENGINE}`);
  const web = w.files['components/livingModel/JobReplay3D.web.tsx'] ?? '';
  const fn = /function loadThree\(\)[^{]*\{([\s\S]*?)\n\}/.exec(web);
  if (!fn) out.push('loadThree is missing');
  else {
    const guard = fn[1].indexOf("Platform.OS !== 'web'");
    const load = fn[1].search(/return import\(\s*'three'\s*\)/);
    if (guard < 0 || load < 0 || guard > load || !/Platform\.OS !== 'web'\) return Promise\.reject/.test(fn[1])) out.push('the load is not behind Platform.OS === \'web\'');
  }
  const eff = web.indexOf('useEffect(');
  if (eff < 0 || web.indexOf('void loadLibrary().then(', eff) < 0 || !/loadLibrary = loadThree \}: JobReplay3DProps/.test(web)) out.push('the library is not loaded from an effect when the view opens, through loadThree');
  // `loadLibrary` is the jest suite's stand-in. Nothing in the app may hand one in: the library then comes from loadThree alone.
  for (const [f, src] of Object.entries(w.files)) if (f !== 'components/livingModel/JobReplay3D.web.tsx' && /\bloadLibrary\b/.test(code(src))) out.push(`${f} hands the 3D view a library of its own`);
  if (/^(?:const|let|var)\s[^\n]*loadThree\(\)|^void loadThree\(\)|^loadThree\(\)/m.test(web)) out.push('the library is loaded at module scope');
  // The phone: the import sits inside loadPhone3DEngine, after the build has answered that it has the engine, inside a try.
  const engine = code(w.files[PHONE_ENGINE] ?? '');
  const pf = /export function loadPhone3DEngine\(\)[^{]*\{([\s\S]*?)\n\}/.exec(engine);
  if (!pf) out.push('loadPhone3DEngine is missing');
  else {
    const guard = pf[1].indexOf('if (!phone3DEngineInBuild()) return Promise.resolve(null);');
    const tryAt = pf[1].indexOf('try {');
    const load = pf[1].search(/import\(\s*'three'\s*\)/);
    if (guard < 0 || tryAt < 0 || load < 0 || !(guard < tryAt && tryAt < load)) out.push('the phone reads the library without first asking whether the build has the engine, or outside a try');
    if (!/\} catch \(e\) \{\s*lastError = say\(e\);\s*return null;\s*\}/.test(pf[1])) out.push('a failed read on the phone is not answered with null');
  }
  for (const [f, src] of Object.entries(w.files)) {
    if (/^(?:export\s+)?(?:const|let|var)\s[^\n]*loadPhone3DEngine\(\)|^void loadPhone3DEngine\(\)|^loadPhone3DEngine\(\)/m.test(src)) out.push(`${f} reads the phone's engine at module scope`);
  }
  return out;
});

rule('E3', 'the phone\'s file for the 3D view reaches 3D code only through its engine file, and still draws the flat replay; the scene builder has one static importer and one lazy one', (w) => {
  const out: string[] = [];
  const phoneRaw = w.files['components/livingModel/JobReplay3D.tsx'] ?? '';
  if (!phoneRaw) return ['components/livingModel/JobReplay3D.tsx is missing: the phone would bundle the web view'];
  const phone = code(phoneRaw);
  if (/threeScene|sceneCore|import\s*\(|\brequire\s*\(|['"]expo-gl['"]|['"]three['"]/.test(phone)) out.push('the phone file reaches 3D code itself instead of through phone3d/engine');
  if (!/from '\.\/phone3d\/engine';/.test(phone) || !/useState<Mode>\(\(\) => \(phone3DEngineInBuild\(\) \? 'loading' : 'no_engine'\)\)/.test(phone)) out.push('the phone file does not ask its engine file, from inside the component, whether this build can draw');
  if (!/export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;/.test(phone)) out.push('the phone file does not say it has a 3D view to try');
  if (!/import \{ FlatReplay \} from '\.\/FlatReplay';/.test(phone) || !/<FlatReplay model=\{model\} level=\{level\} moments=\{moments\} selectedId=\{selectedId\} onSelect=\{onSelect\} \/>/.test(phone)) out.push('the phone file no longer draws the flat replay when it cannot draw in 3D');
  if (!/JOB_REPLAY_3D_ON_THIS_PLATFORM = true/.test(w.files['components/livingModel/JobReplay3D.web.tsx'] ?? '')) out.push('the web file does not say it draws');
  const SCENE_FROM = /from ['"](?:\.\.?\/|@\/components\/livingModel\/)threeScene['"]/;
  const valueImporters = Object.keys(w.files).filter((f) => code(w.files[f]).split('\n').some((l) => SCENE_FROM.test(l) && !/^\s*import type\b/.test(l)));
  if (valueImporters.join() !== 'components/livingModel/JobReplay3D.web.tsx') out.push(`threeScene is imported at module scope by ${valueImporters.join(', ') || 'nobody'}; want only the web view`);
  const typeImporters = Object.keys(w.files).filter((f) => code(w.files[f]).split('\n').some((l) => SCENE_FROM.test(l) && /^\s*import type\b/.test(l)));
  for (const f of typeImporters) if (!f.startsWith('components/livingModel/phone3d/')) out.push(`${f} names the scene builder's types: only the phone's 3D files may`);
  const lazy = Object.keys(w.files).filter((f) => /import\s*\(\s*['"][^'"]*threeScene['"]\s*\)/.test(code(w.files[f])));
  if (lazy.join() !== PHONE_ENGINE) out.push(`threeScene is read lazily by ${lazy.join(', ') || 'nobody'}; want only ${PHONE_ENGINE}`);
  for (const [f, src] of Object.entries(w.files)) {
    if (/JobReplay3D\.web['"]/.test(src)) out.push(`${f} imports the web file by its full name, so the phone would bundle it`);
  }
  const scene = w.files['components/livingModel/threeScene.ts'] ?? '';
  if (!/type Three = typeof import\('three'\);/.test(scene) || !/export function createJobScene\(THREE: Three,/.test(scene)) out.push('the scene builder does not take the library as an argument');
  return out;
});

rule('E4', '`three` is pinned to one version, its licence is MIT, expo-gl is at the SDK\'s range, and no other 3D dependency is added', (w) => {
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
  // The phone draws the same scene through expo-gl (lane PHONE3D), at the range this Expo SDK ships.
  const gl = w.pkg.dependencies['expo-gl'];
  const sdk = (JSON.parse(readFileSync(join(ROOT, 'node_modules', 'expo', 'bundledNativeModules.json'), 'utf8')) as Record<string, string>)['expo-gl'];
  if (!gl) out.push('expo-gl is not a dependency: the phone has no surface to draw the 3D view on');
  else if (gl !== sdk) out.push(`expo-gl is "${gl}"; this Expo SDK ships "${sdk}"`);
  for (const banned of ['@react-three/fiber', '@react-three/drei', 'expo-three', '@types/three', 'react-native-webview', '@shopify/react-native-skia']) {
    if (banned in w.pkg.dependencies) out.push(`${banned} was added: three and expo-gl are the only 3D dependencies allowed`);
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

/** The files the PHONE bundle reaches from a file, by the phone's own rule for picking a file (never a `.web.` one). Feature files only. */
function phoneGraph(w: World, roots: string[]): { reached: string[]; libs: Map<string, string[]> } {
  const EXT = ['.ios.tsx', '.ios.ts', '.native.tsx', '.native.ts', '.tsx', '.ts', '.js', '/index.tsx', '/index.ts'];
  const inFeature = (f: string): boolean => f.startsWith('components/livingModel/') || f.startsWith('utils/livingModel/') || f === 'app/living-model.tsx';
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = spec.slice(2);
    else if (spec.startsWith('.')) base = join(dirname(from), spec);
    else return null;
    if (w.files[base] !== undefined) return base;
    for (const e of EXT) if (w.files[base + e] !== undefined) return base + e;
    return null;
  };
  const seen = new Set<string>();
  const libs = new Map<string, string[]>();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.shift() as string;
    if (seen.has(f) || w.files[f] === undefined) continue;
    seen.add(f);
    const src = code(w.files[f]).split('\n').filter((l) => !/^\s*import type\b/.test(l)).join('\n').replace(/typeof\s+import\s*\(\s*['"][^'"]+['"]\s*\)/g, '');
    const re = /(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const m of src.matchAll(re)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!spec.startsWith('@/') && !spec.startsWith('.')) { libs.set(spec, [...(libs.get(spec) ?? []), f]); continue; }
      const to = resolve(f, spec);
      if (to && inFeature(to)) queue.push(to);
    }
  }
  return { reached: [...seen], libs };
}

/** The names scripts/validate-native-surface.ts looks for in the real phone bundle. One list, read out of that script. */
function nativeSurface3dMarkers(): string[] {
  const m = /const LIB_3D = \[([^\]]+)\]/.exec(read('scripts/validate-native-surface.ts'));
  return m ? Array.from(m[1].matchAll(/'([A-Za-z]+)'/g)).map((x) => x[1]) : [];
}

rule('E6', 'the phone reaches the 3D library and the scene builder through ONE file, its engine file, and only lazily: with that file\'s lazy reads taken away, the walk from the route finds no `three`, no web view and no scene builder', (w) => {
  const out: string[] = [];
  const roots = ['app/living-model.tsx', 'components/livingModel/LivingModelEntryRow.tsx'];
  const g = phoneGraph(w, roots);
  if (!g.reached.includes('components/livingModel/LivingModelScreen.tsx') || !g.reached.includes('components/livingModel/JobReplay3D.tsx') || !g.reached.includes(PHONE_ENGINE) || g.reached.length < 15) out.push(`the walk from the route reached only ${g.reached.length} files: it is not following the phone's imports`);
  // Everything the phone reaches at all: the library has exactly one importer, the engine file (lane PHONE3D).
  for (const [lib, from] of g.libs) if ((lib === 'three' || lib.startsWith('three/')) && from.join() !== PHONE_ENGINE) out.push(`the phone reaches the 3D library from ${from.join(', ')}; want only ${PHONE_ENGINE}`);
  for (const f of g.reached) if (/\.web\.(tsx|ts|js)$/.test(f)) out.push(`the phone reaches a web-only file: ${f}`);
  // What the phone reaches when the bundle LOADS: the same walk with the engine file's lazy reads taken away. Nothing 3D may be left.
  const engine = w.files[PHONE_ENGINE] ?? '';
  const eager = phoneGraph({ ...w, files: { ...w.files, [PHONE_ENGINE]: engine.replace(/import\s*\(\s*['"][^'"]+['"]\s*\)/g, 'null') } }, roots);
  for (const [lib, from] of eager.libs) if (lib === 'three' || lib.startsWith('three/') || lib === 'expo-gl') out.push(`${from.join(', ')} reaches "${lib}" when the bundle loads, not when the 3D view opens`);
  if (eager.reached.includes('components/livingModel/threeScene.ts')) out.push('the phone reaches the scene builder (threeScene.ts) when the bundle loads, not when the 3D view opens');
  if (!g.reached.includes('components/livingModel/threeScene.ts')) out.push('the phone no longer reaches the scene builder at all: it would not be drawing the web\'s scene');
  // The bundle check in validate-native-surface looks for these names in the real phone bundle. Each has to be a name the 3D code really carries,
  // so that check is not looking for words nothing has.
  const markers = nativeSurface3dMarkers();
  if (markers.length < 3) out.push('scripts/validate-native-surface.ts no longer lists the names of the 3D code it looks for in the phone bundle');
  const scene = w.files['components/livingModel/threeScene.ts'] ?? '';
  for (const name of markers) {
    if (!scene.includes(name)) out.push(`validate-native-surface looks for "${name}" in the phone bundle, a name the scene builder does not have: that check would say nothing about the 3D code`);
  }
  return out;
});

/** The real three.js with a renderer that draws nothing, so the scene builder runs here with no WebGL. */
function fakeThree(): { lib: typeof import('three'); log: { made: number; clear: string[]; released: number; disposed: number; antialias: unknown[]; ratios: number[] } } {
  const log = { made: 0, clear: [] as string[], released: 0, disposed: 0, antialias: [] as unknown[], ratios: [] as number[] };
  class Renderer {
    shadowMap = { enabled: false, type: 0 };
    domElement = {};
    constructor(p?: { antialias?: unknown }) { log.made += 1; log.antialias.push(p?.antialias); }
    setClearColor(c: string): void { log.clear.push(String(c)); }
    setPixelRatio(n: number): void { log.ratios.push(n); }
    setSize(): void { /* nothing to draw on */ }
    render(): void { /* nothing to draw on */ }
    dispose(): void { log.disposed += 1; }
    forceContextLoss(): void { log.released += 1; }
  }
  return { lib: { ...(THREE_LIB as object), WebGLRenderer: Renderer } as unknown as typeof import('three'), log };
}
const hexDist = (a: string, b: string): number => {
  const n = (h: string) => { const v = parseInt(h.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const p = n(a); const q = n(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
/** The colours the app's ThemeContext hands out: the base theme with the accent family derived onto it. */
const themeColors = (name: 'light' | 'dark'): ThemeColors => ({ ...Theme[name], ...deriveAccentPalette(getCustomPrimary(), name) }) as ThemeColors;
const LIGHT_THEME = themeColors('light');
const DARK_THEME = themeColors('dark');
const LIGHT = livingModelPalette(LIGHT_THEME);
const DARK = livingModelPalette(DARK_THEME);

rule('E7', 'a theme change makes a new scene and the rooms are drawn into it again; the WebGL context is given back; a lost context is said and can be reloaded', (w) => {
  const out: string[] = [];
  const rooms = sevenRoomJob().rooms;
  // The scene itself, run here: a scene that was just made holds no rooms. That is why the view has to draw them again after a theme change.
  const first = fakeThree();
  const a = w.impl.createJobScene(first.lib, {} as HTMLCanvasElement, LIGHT);
  if (a.roomCount() !== 0) out.push('a scene that was just made already holds rooms');
  a.setRooms(rooms, 1.25);
  a.resize(1100, 560, 1);
  if (a.roomCount() !== 7 || a.project('kitchen') === null) out.push('setRooms did not put the seven rooms in the scene');
  a.dispose();
  if (first.log.released !== 1) out.push(`throwing a scene away gave the WebGL context back ${first.log.released} times; want once`);
  if (a.roomCount() !== 0) out.push('a scene that was thrown away still holds rooms');
  const second = fakeThree();
  const b = w.impl.createJobScene(second.lib, {} as HTMLCanvasElement, DARK);
  if (b.roomCount() !== 0 || b.project('kitchen') !== null) out.push('the scene made for the new theme is not empty at the start');
  if (second.log.clear[0]?.toLowerCase() !== DARK.ground.toLowerCase()) out.push(`the new scene's ground is ${second.log.clear[0]}; the dark theme's is ${DARK.ground}`);
  b.setRooms(rooms, 1.25);
  if (b.roomCount() !== 7) out.push('the rooms could not be drawn into the new scene');
  b.dispose();
  // The web's own settings, unchanged: the renderer smooths its edges, and a screen past 2 pixels a point is drawn at 2.
  const third = fakeThree();
  const c = w.impl.createJobScene(third.lib, {} as HTMLCanvasElement, LIGHT);
  c.resize(1100, 560, 3);
  c.resize(1100, 560, 1.5);
  c.dispose();
  if (third.log.antialias.join() !== 'true') out.push(`with no options the renderer was made with antialias ${String(third.log.antialias[0])}; the web's is true`);
  if (third.log.ratios.join() !== '2,1.5') out.push(`with no options a 3x and a 1.5x screen were drawn at ${third.log.ratios.join(', ')}; the web's cap is 2`);
  // A caller may set them (the phone does): no renderer smoothing, and its own cap.
  const fourth = fakeThree();
  const d = w.impl.createJobScene(fourth.lib, {} as HTMLCanvasElement, LIGHT, { antialias: false, maxPixelRatio: 4, shadowMapSize: 1024 });
  d.resize(390, 380, 3);
  d.dispose();
  if (fourth.log.antialias.join() !== 'false' || fourth.log.ratios.join() !== '3') out.push(`a caller's own settings were not used: antialias ${String(fourth.log.antialias[0])}, ratio ${fourth.log.ratios.join(', ')}`);
  // The context is given back where it can be, and not asked for where it cannot (a phone's drawing surface): asking prints a warning there.
  for (const [can, want] of [[true, 1], [false, 0]] as const) {
    const t = fakeThree();
    const Base = (t.lib as unknown as { WebGLRenderer: new (p?: unknown) => object }).WebGLRenderer;
    class WithExtensions extends Base { extensions = { has: (name: string): boolean => name === 'WEBGL_lose_context' && can }; }
    const h = w.impl.createJobScene({ ...(t.lib as object), WebGLRenderer: WithExtensions } as unknown as typeof import('three'), {} as HTMLCanvasElement, LIGHT);
    h.dispose();
    if (t.log.released !== want) out.push(`a renderer whose context ${can ? 'can' : 'cannot'} be given back had it given back ${t.log.released} times; want ${want}`);
  }
  // The view: when the scene goes, `ready` goes with it, so the two effects that draw rooms and stages run again for the next scene.
  const web = code(w.files['components/livingModel/JobReplay3D.web.tsx'] ?? '');
  const start = web.slice(web.indexOf('void loadLibrary().then('), web.indexOf('// The rooms, or the wall height, changed'));
  const cleanup = start.slice(start.lastIndexOf('return () => {'));
  if (!/handle\?\.dispose\(\);[\s\S]*setReady\(false\);/.test(cleanup)) out.push('the view does not reset `ready` when its scene is thrown away: after a theme change the new scene would stay empty (a blank 3D view)');
  if (!/\}, \[palette, reloads, loadLibrary\]\);/.test(start)) out.push('the view does not make a new scene when the palette changes or the person reloads the view');
  if (!/if \(!ready \|\| !sceneRef\.current\) return;\s*sceneRef\.current\.setRooms\(rooms, cut \? DEFAULT_CUT_M : null\);[\s\S]{0,80}\}, \[ready, rooms, cut\]\);/.test(web)) out.push('the rooms are not drawn again when a scene becomes ready');
  if (!/sceneRef\.current\.apply\(looks\);[\s\S]{0,80}\}, \[ready, rooms, moments, cut\]\);/.test(web)) out.push('the stages are not drawn again when a scene becomes ready');
  if (!/key: canvasKey,/.test(web) || !/const sceneKey = useMemo\(\(\) => \(\{ palette, reloads \}\), \[palette, reloads\]\);/.test(web)) out.push('each scene does not get a canvas of its own: a canvas whose context was given back cannot draw again');
  const scene = code(w.files['components/livingModel/threeScene.ts'] ?? '');
  if (!/renderer\.dispose\(\);[\s\S]{0,260}renderer\.forceContextLoss\(\)/.test(scene)) out.push('the scene does not give its WebGL context back when it is thrown away');
  // A lost context.
  if (!/canvas\.addEventListener\('webglcontextlost', onLost\);/.test(web) || !/canvas\.removeEventListener\('webglcontextlost', onLost\);/.test(web)) out.push('the view does not listen for a lost WebGL context');
  if (!/const onLost = \(e: Event\) => \{ e\.preventDefault\(\); if \(alive\) setLost\(true\); \};/.test(web)) out.push('a lost context is not recorded');
  if (!/\{lost \? \(\s*<View[^>]*testID="lm-3d-lost">\s*<Text[^>]*>\{copy\.contextLostBody\}<\/Text>\s*<Button label=\{copy\.reloadViewLabel\}[^>]*onPress=\{\(\) => \{ setLost\(false\); setReloads\(\(n\) => n \+ 1\); \}\}/.test(web)) out.push('a lost context is not said in a plain sentence with a Reload View button that makes a new scene');
  if (w.EN[`${K}replay.reloadViewLabel`] !== 'Reload View') out.push('the button is not called Reload View');
  return out;
});

rule('E8', 'the page still scrolls: the wheel zooms the model only after a click or with Ctrl or Cmd, and on a narrow screen one finger belongs to the page', (w) => {
  const out: string[] = [];
  const Z = w.impl.wheelShouldZoom;
  if (Z({}, false) || Z({ ctrlKey: false, metaKey: false }, false)) out.push('a plain wheel over the model zooms it: the page cannot be scrolled past the 3D view');
  if (!Z({ ctrlKey: true }, false) || !Z({ metaKey: true }, false)) out.push('Ctrl or Cmd with the wheel does not zoom');
  if (!Z({}, true)) out.push('the wheel does not zoom after the person clicked the model');
  const T = w.impl.oneFingerTurnsModel;
  if (T('touch', true)) out.push('on a narrow screen one finger turns the model: it cannot scroll the page');
  if (!T('touch', false) || !T('mouse', true) || !T('mouse', false) || !T('pen', true)) out.push('a mouse, a pen, or a finger on a wide screen no longer turns the model');
  if (w.impl.canvasTouchAction(true) !== 'pan-y' || w.impl.canvasTouchAction(false) !== 'none') out.push('the canvas does not leave the up and down swipe to the page on a narrow screen');
  const web = code(w.files['components/livingModel/JobReplay3D.web.tsx'] ?? '');
  const wheel = /const onWheel = \(e: WheelEvent\) => \{([\s\S]*?)\n {6}\};/.exec(web);
  if (!wheel) out.push('the wheel handler is missing');
  else {
    const guard = wheel[1].indexOf('if (!wheelShouldZoom(e, ');
    const stop = wheel[1].indexOf('e.preventDefault()');
    if (guard < 0 || stop < 0 || guard > stop || !/if \(!wheelShouldZoom\(e, [^\n]*document\.activeElement === canvas\)\) return;/.test(wheel[1])) out.push('the wheel handler stops the page from scrolling before asking whether the wheel is for the model');
  }
  if (!/if \(ptr\.size === 1\) \{\s*if \(!oneFingerTurnsModel\(e\.pointerType, compactRef\.current\)\) return;/.test(web)) out.push('one finger is not left to the page on a narrow screen');
  if (!/touchAction: canvasTouchAction\(compact\),/.test(web)) out.push('the canvas does not take its touch-action from canvasTouchAction');
  if (/touchAction: 'none'/.test(web)) out.push('the canvas takes every touch for itself');
  if (!/const onTouch = \(e: TouchEvent\) => \{ if \(e\.touches\.length >= 2 && e\.cancelable\) e\.preventDefault\(\); \};/.test(web)) out.push('two fingers on the model are not kept from scrolling the page');
  if (!/canvas\.addEventListener\('pointercancel', onCancel\);/.test(web)) out.push('a touch the browser took for scrolling is treated as a tap on a room');
  const scr = code(w.files['components/livingModel/LivingModelScreen.tsx'] ?? '');
  if (!/<Text[^>]*testID="lm-3d-hint">\{onPhone \? phoneCopy\.touchHelpSub : wide \? copy\.orbitHelpSub : copy\.touchHelpSub\}<\/Text>/.test(scr)) out.push('the one-line hint under the 3D view is missing, or a browser no longer gets its own two sentences (the wheel on a wide screen, one finger scrolls on a narrow one)');
  const hint = String(w.EN[`${K}replay.orbitHelpSub`] ?? '');
  if (!/Ctrl or Cmd/.test(hint) || !/click the model first/.test(hint) || /Scroll or pinch to zoom/.test(hint)) out.push(`the hint does not say how the wheel zooms: "${hint}"`);
  const touch = String(w.EN[`${K}replay.touchHelpSub`] ?? '');
  if (!/One finger scrolls the page/.test(touch) || !/Two fingers/.test(touch)) out.push(`the narrow-screen hint does not say one finger scrolls and two move the model: "${touch}"`);
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
  if (!/\{footer\}/.test(w.files['components/livingModel/RoomEditor.tsx'] ?? '')) out.push('the Room Editor does not draw the lines it is handed');
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
  if (w.EN[`${K}honesty.otherDevicesBody`] !== 'It will not appear on your other devices.') out.push('the other-devices line changed');
  if (!/<Text[^>]*testID="lm-saved-local">\{`\$\{copy\.savedLocalBody\} \$\{copy\.otherDevicesBody\}`\}<\/Text>/.test(w.files['components/livingModel/RoomEditor.tsx'] ?? '')) out.push('the editor does not say the model is saved on this device only and will not appear on other devices');
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
  // A refresh: until the saved sign-in is read back nobody is signed in YET. Wait; do not send the owner Home.
  const waitAt = body.indexOf('if (isLoading) return <AuthSettling />;');
  const gateAt = body.indexOf('if (!livingModelAllowed(');
  if (!/const \{ user, isLoading \} = useAuth\(\);/.test(body) || waitAt < 0 || waitAt > gateAt) out.push('the route redirects while the saved sign-in is still being read: a browser refresh sends the owner to Home');
  const settling = /function AuthSettling\(\) \{([\s\S]*?)\n\}/.exec(r);
  if (!settling || /LivingModelScreen|Gated|useProjectRoleState|loadJobModel|copy\./.test(settling[1])) out.push('the page shown while the sign-in is read mounts part of the feature');
  for (const f of [...LM_COMPONENTS(w), 'app/living-model.tsx']) if (/\bas any\b/.test(code(w.files[f] ?? ''))) out.push(`${f} casts with "as any": typed routes are on, so a route string is checked as it is`);
  if (!/router\.push\(\{ pathname: '\/living-model', params: \{ projectId \} \}\)/.test(w.files['components/livingModel/LivingModelEntryRow.tsx'] ?? '')) out.push('the entry row does not open /living-model as a typed route');
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
    && f !== PHONE_SPIKE && /from ['"]@\/(components|utils)\/livingModel\//.test(w.files[f]));
  if (outside.length) out.push(`files outside the feature import it: ${outside.join(', ')}`);
  // The one other importer is the simulator check (lane PHONE3D). It may draw the model only in a bundle made with
  // the variable set in the builder's own shell; in every other bundle it sends everyone Home before any hook.
  const spike = code(w.files[PHONE_SPIKE] ?? '');
  if (spike) {
    if (!/export const PHONE3D_SPIKE_ON = process\.env\.EXPO_PUBLIC_PHONE3D_SPIKE === '1';/.test(spike)) out.push(`${PHONE_SPIKE} is not switched by the builder's own variable`);
    const route = /export default function DevPhone3DRoute\(\) \{([\s\S]*?)\n\}/.exec(spike);
    if (!route || !/^\s*if \(!PHONE3D_SPIKE_ON\) return <Redirect href="\/\(tabs\)\/\(home\)" \/>;\s*return <Spike \/>;\s*$/.test(route[1])) out.push(`${PHONE_SPIKE} does not send everyone Home, before anything else, when the variable is not set`);
    if (/loadJobModel|saveJobModel|useAuth|useProjects|supabase/.test(spike)) out.push(`${PHONE_SPIKE} reads an account or a saved model: it may only draw its built-in sample`);
  }
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
  const writes = (code(store).match(/AsyncStorage\.setItem\([^)]*\)/g) ?? []).sort().join(' ');
  if (writes !== 'AsyncStorage.setItem(backup, raw) AsyncStorage.setItem(key, json)') out.push(`the store writes ${writes || 'nothing'}; want the model key and the backup of unread text, once each`);
  if (/AsyncStorage\.(clear|multiRemove|removeItem)\(/.test(store)) out.push('the store removes keys');
  return out;
});

// I. the look
rule('I1', 'theme tokens only in the components: no colour is written in them', (w) => {
  const out: string[] = [];
  for (const f of [...LM_COMPONENTS(w), 'app/living-model.tsx']) {
    const code = (w.files[f] ?? '').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const m = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.exec(code);
    if (m) out.push(`${f} writes a colour: ${m[0]}`);
  }
  const scene = w.files['components/livingModel/threeScene.ts'] ?? '';
  if (!/new THREE\.HemisphereLight\(palette\.sky, palette\.plinth, palette\.skyStrength\)/.test(scene) || !/new THREE\.DirectionalLight\(palette\.sun, palette\.sunStrength\)/.test(scene)) out.push('the 3D lights do not take their colour and strength from the palette');
  if (!/palette\.[a-zA-Z]+/.test(scene)) out.push('the 3D materials do not take their colours from the palette');
  // A dark table beside the light one, and the theme decides which.
  const L = w.impl.MATERIALS.light;
  const D = w.impl.MATERIALS.dark;
  if (!L || !D) return [...out, 'the palette has no light and dark tables'];
  if (Object.keys(L).sort().join() !== Object.keys(D).sort().join()) out.push('the light and dark tables do not hold the same materials');
  const lum = (h: string): number => { const v = parseInt(h.slice(1), 16); return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255; };
  for (const [k, v] of [...Object.entries(L), ...Object.entries(D)]) if (typeof v === 'string' && !/^#[0-9A-Fa-f]{6}$/.test(v)) out.push(`the palette's ${k} is not a colour: ${v}`);
  for (const k of ['plinth', 'shell', 'wallOld', 'wallBoard', 'wallFinished', 'trim', 'floorOld', 'floorSub']) {
    if (typeof L[k] !== 'string' || typeof D[k] !== 'string') { out.push(`the palette has no ${k}`); continue; }
    if (lum(D[k] as string) >= lum(L[k] as string) - 0.08) out.push(`in the dark table ${k} (${D[k]}) is not darker than in the light one (${L[k]}): pale walls would glare on a dark page`);
  }
  if (!((D.skyStrength as number) < (L.skyStrength as number))) out.push('the dark scene is lit as strongly as the light one');
  if (paletteModeOf(DARK_THEME) !== 'dark' || paletteModeOf(LIGHT_THEME) !== 'light') out.push('the theme does not decide which table is used');
  if (DARK.mode !== 'dark' || DARK.ground !== DARK_THEME.bg || LIGHT.ground !== LIGHT_THEME.bg || !DARK_THEME.accent || DARK.stage.finishes !== DARK_THEME.accent || DARK.stage.done !== DARK_THEME.success) out.push('the palette does not take its ground, its accent and its Done colour from the theme');
  if (!/return useMemo\(\(\) => livingModelPalette\(colors\), \[colors\]\);/.test(w.files['components/livingModel/replayShared.tsx'] ?? '')) out.push('the views do not build the palette from the theme in use');
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

rule('J5', 'the home view fits full-height walls; a small room\'s label gives way; each room\'s floor carries its stage colour', (w) => {
  const out: string[] = [];
  // 1. The fit, as numbers: every corner of the model, at the top of its walls and at the floor, lands inside the frame at the home view.
  const AZ = 0.72;
  const EL = 0.9;
  const box = modelBounds(sevenRoomJob())!;
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minY + box.maxY) / 2;
  let zoomCut = 0;
  let zoomFull = 0;
  for (const [what, H] of [['cut-away', 1.25], ['full-height', ft(8)]] as const) {
    for (const [W, Hpx] of [[1100, 560], [360, 380], [700, 900]] as const) {
      const ext = w.impl.viewExtent(box, H, AZ, EL);
      const zoom = fitZoom(ext, W, Hpx);
      if (what === 'cut-away' && W === 1100) zoomCut = zoom;
      if (what === 'full-height' && W === 1100) zoomFull = zoom;
      for (const x of [box.minX, box.maxX]) for (const z of [box.minY, box.maxY]) for (const y of [0, H]) {
        const p = screenPoint({ x, y, z }, { x: cx, y: H / 2, z: cz }, AZ, EL, zoom);
        if (Math.abs(p.x) > (W / 2) * VIEW_FILL + 0.5 || Math.abs(p.y) > (Hpx / 2) * VIEW_FILL + 0.5) out.push(`${what} walls on a ${W} by ${Hpx} canvas: the corner at height ${y.toFixed(2)} m lands ${Math.abs(p.x).toFixed(0)}, ${Math.abs(p.y).toFixed(0)} px from the middle, outside the frame's ${((W / 2) * VIEW_FILL).toFixed(0)}, ${((Hpx / 2) * VIEW_FILL).toFixed(0)}`);
      }
    }
  }
  if (!(zoomFull < zoomCut)) out.push('the view does not pull back for full-height walls');
  const flat = w.impl.viewExtent(box, 0, AZ, EL);
  const tall = w.impl.viewExtent(box, ft(8), AZ, EL);
  if (!near(tall.halfH - flat.halfH, (Math.cos(EL) * ft(8)) / 2, 1e-9) || !near(tall.halfW, flat.halfW)) out.push('the wall height is not counted in how tall the model stands on the screen');
  if (w.impl.viewExtent(null, Number.NaN, AZ, EL).halfW < 1) out.push('an empty model has no size to fit');
  const scene = code(w.files['components/livingModel/threeScene.ts'] ?? '');
  if (!/fitZoom\(viewExtent\(floorBox, V\.wallH, DEFAULT_VIEW\.azimuth, DEFAULT_VIEW\.elevation\), V\.w, V\.h\)/.test(scene) || !/V\.wallH = list\.length \? Math\.max\(/.test(scene)) out.push('the scene does not fit its home view to the walls it draws');
  // 2. Labels: a label is never wider than its room allows, except for the room the person picked or is pointing at.
  const P = w.impl.pinSize;
  if (P(PIN_FULL_PX, false) !== 'full' || P(PIN_FULL_PX - 1, false) !== 'name' || P(PIN_NAME_PX, false) !== 'name' || P(PIN_NAME_PX - 1, false) !== 'dot') out.push('a label does not give way as its room gets smaller');
  if (P(10, true) !== 'full') out.push('the selected room\'s label is not shown in full');
  if (P(Number.NaN, false) === 'full') out.push('a room whose size is not known gets a full label');
  // The room a label has is the level strip through the middle of the room as drawn, not the room's whole box on the canvas.
  const R = w.impl.labelRoomPx;
  if (!near(R({ x: 50, y: 0 }, { x: 0, y: 30 }), 100, 1e-9)) out.push(`a room drawn square-on, 100 px wide, has ${R({ x: 50, y: 0 }, { x: 0, y: 30 })} px for its label`);
  // A long thin room seen at an angle: its box on the canvas is 220 px wide, the strip through its middle 40.
  if (!near(R({ x: 100, y: 60 }, { x: -10, y: 6 }), 40, 1e-9)) out.push(`a long thin slanted room has ${R({ x: 100, y: 60 }, { x: -10, y: 6 }).toFixed(1)} px for its label; the strip through its middle is 40 (its box is 220)`);
  // A square room seen corner-on is a diamond 240 px from side point to side point, and the strip through its middle is that whole width.
  if (!near(R({ x: 60, y: 30 }, { x: -60, y: 30 }), 240, 1e-9)) out.push('a square room seen corner-on does not have its full width, point to point, for a label');
  if (R({ x: 0, y: 0 }, { x: 0, y: 0 }) !== 0 || !Number.isFinite(R({ x: Number.NaN, y: 1 }, { x: 1, y: 1 }))) out.push('a room with no size, or a bad number, does not give a plain number');
  const web = code(w.files['components/livingModel/JobReplay3D.web.tsx'] ?? '');
  if (!/pinSize\(handle\?\.roomWidthPx\(roomId\) \?\? Number\.NaN, roomId === selectedRef\.current \|\| roomId === hoverRef\.current\)/.test(web)) out.push('the 3D view does not size each label from how wide its room is drawn');
  if (!/if \(sub\) sub\.style\.display = size === 'full' \? '' : 'none';/.test(web) || !/if \(name\) name\.style\.display = size === 'dot' \? 'none' : '';/.test(web)) out.push('the stage line and the name are not hidden in a small room');
  // 3. The scene, run with no WebGL: floors by stage, in the light table and the dark one.
  for (const pal of [LIGHT, DARK]) {
    const t3 = fakeThree();
    const h = w.impl.createJobScene(t3.lib, {} as HTMLCanvasElement, pal);
    h.setRooms(sevenRoomJob().rooms, 1.25);
    h.resize(1100, 560, 1);
    const idle = { skin: 1, studs: 0, roughIn: 0, insulation: 0, board: 0, finish: 0 };
    const stages = { living: 'rough_in', kitchen: 'drywall', hall: 'no_tasks', bed1: 'not_started', bath: 'done', closet: 'framing', bed2: 'demolition' } as const;
    const looks = new Map(Object.entries(stages).map(([id, stage]) => [id, { solid: idle, ghost: idle, opens: false, stage }]));
    h.apply(looks as never);
    const plain = h.floorHex('hall');
    if (!plain || h.floorHex('bed1') !== plain) out.push(`${pal.mode}: a room with no ticked tasks and a room not started do not share the plain floor`);
    const seenFloors = new Set<string>();
    for (const [id, stage] of Object.entries(stages)) {
      const hex = h.floorHex(id);
      if (!hex) { out.push(`${pal.mode}: ${id} has no floor`); continue; }
      if (stage === 'no_tasks' || stage === 'not_started') continue;
      seenFloors.add(hex);
      if (hex === plain) out.push(`${pal.mode}: the floor of a room in ${stage} is the plain floor: its stage shows only on the label`);
      else if (plain && !(hexDist(hex, pal.stage[stage]) < hexDist(plain, pal.stage[stage]) * 0.6)) out.push(`${pal.mode}: the floor of a room in ${stage} (${hex}) is not clearly the stage colour ${pal.stage[stage]}`);
    }
    if (seenFloors.size !== 5) out.push(`${pal.mode}: five rooms in five stages are drawn on ${seenFloors.size} floor colours`);
    const wide = h.roomWidthPx('living');
    const small = h.roomWidthPx('closet');
    const thin = h.roomWidthPx('hall');
    if (wide == null || small == null || !(wide > small * 2)) out.push(`${pal.mode}: the 16 by 14 ft living room has ${wide?.toFixed(0)} px for its label and the 4 ft closet ${small?.toFixed(0)} px: the label sizes have nothing to go on`);
    if (wide == null || thin == null || !(thin < wide / 2)) out.push(`${pal.mode}: the hall is 28 ft long but only 4 ft deep, and is given ${thin?.toFixed(0)} px for its label: a label that wide would cover the rooms beside it`);
    if (wide != null && w.impl.pinSize(wide, false) !== 'full') out.push(`${pal.mode}: on an 1100 px canvas the living room's label is not shown in full`);
    if (small != null && w.impl.pinSize(small, false) === 'full') out.push(`${pal.mode}: on an 1100 px canvas the closet's label is shown in full, over its neighbours`);
    if (h.roomWidthPx('no-such-room') !== null) out.push('a room that is not in the scene has a width');
    h.dispose();
  }
  if (!(LIGHT.floorTint >= 0.4 && LIGHT.floorTint <= 0.8 && DARK.floorTint >= 0.4 && DARK.floorTint <= 0.8)) out.push('the floor tint is so weak the stage cannot be read, or so strong the floor is lost');
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
  { rule: 'D2', name: 'the screen applies suggestions when the model loads', plant: edit('components/livingModel/LivingModelScreen.tsx', "      setHistory(historyOf(loaded.model));", "      setHistory(historyOf(loaded.model.rooms.reduce((acc, r) => confirmSuggestions(acc, r.id, suggestLinks(r, [], []).map((s) => s.taskId)), loaded.model)));") },
  { rule: 'E1', name: 'a static import in the web view', plant: edit('components/livingModel/JobReplay3D.web.tsx', "import { createJobScene, type JobSceneHandle, type RoomLook } from './threeScene';", "import { createJobScene, type JobSceneHandle, type RoomLook } from './threeScene';\nimport * as THREE from 'three';") },
  { rule: 'E1', name: 'a static import in the scene builder', plant: edit('components/livingModel/threeScene.ts', "type Three = typeof import('three');", "import { Color } from 'three';\ntype Three = typeof import('three');") },
  { rule: 'E1', name: 'a require in the screen', plant: edit('components/livingModel/LivingModelScreen.tsx', "type Tab = 'rooms' | 'tasks' | 'replay';", "const THREE = require('three');\ntype Tab = 'rooms' | 'tasks' | 'replay';") },
  { rule: 'E1', name: 'a static import of a file inside the package', plant: addFile('utils/livingModel/orbit.ts', "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';\nexport { OrbitControls };\n") },
  { rule: 'E2', name: 'the platform guard is removed', plant: edit('components/livingModel/JobReplay3D.web.tsx', "  if (Platform.OS !== 'web') return Promise.reject(new Error('The 3D view is on the web only.'));\n", '') },
  { rule: 'E2', name: 'a second dynamic import on the phone screen', plant: edit('components/livingModel/LivingModelScreen.tsx', "type Tab = 'rooms' | 'tasks' | 'replay';", "export const preload = () => import('three');\ntype Tab = 'rooms' | 'tasks' | 'replay';") },
  { rule: 'E2', name: 'the screen hands the 3D view a library of its own', plant: edit('components/livingModel/LivingModelScreen.tsx', "type Tab = 'rooms' | 'tasks' | 'replay';", "export const loadLibrary = () => Promise.resolve({});\ntype Tab = 'rooms' | 'tasks' | 'replay';") },
  { rule: 'E2', name: 'the library is loaded at module scope', plant: edit('components/livingModel/JobReplay3D.web.tsx', 'export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;', 'export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;\nvoid loadThree();') },
  { rule: 'E2', name: 'the phone reads the library without asking whether the build has the engine', plant: edit(PHONE_ENGINE, "  if (!phone3DEngineInBuild()) return Promise.resolve(null);\n", '') },
  { rule: 'E2', name: 'the phone reads the library outside a try', plant: edit(PHONE_ENGINE, "    try {\n      const [gl, THREE, scene] = await Promise.all([import('expo-gl'), import('three'), import('../threeScene')]);", "    const [gl, THREE, scene] = await Promise.all([import('expo-gl'), import('three'), import('../threeScene')]);\n    try {") },
  { rule: 'E2', name: 'a second dynamic import in the phone view', plant: edit('components/livingModel/phone3d/Phone3DView.tsx', "const touchesOf = ", "export const preload = () => import('three');\nconst touchesOf = ") },
  { rule: 'E2', name: 'the phone engine is read at module scope', plant: edit('components/livingModel/JobReplay3D.tsx', "type Mode = ", "void loadPhone3DEngine();\ntype Mode = ") },
  { rule: 'E3', name: 'the phone file imports the drawing surface itself', plant: edit('components/livingModel/JobReplay3D.tsx', "import type { JobReplay3DProps } from './jobReplay3DProps';", "import type { JobReplay3DProps } from './jobReplay3DProps';\nimport { GLView } from 'expo-gl';\nexport const Surface = GLView;") },
  { rule: 'E3', name: 'the phone file asks for the engine at module scope', plant: edit('components/livingModel/JobReplay3D.tsx', "useState<Mode>(() => (phone3DEngineInBuild() ? 'loading' : 'no_engine'))", "useState<Mode>(HAS ? 'loading' : 'no_engine')") },
  { rule: 'E3', name: 'the phone file no longer draws the flat replay', plant: edit('components/livingModel/JobReplay3D.tsx', "      <FlatReplay model={model} level={level} moments={moments} selectedId={selectedId} onSelect={onSelect} />\n", '') },
  { rule: 'E3', name: 'the phone view builds the scene at module scope', plant: edit('components/livingModel/phone3d/Phone3DView.tsx', "import type { RoomLook } from '../threeScene';", "import { createJobScene, type RoomLook } from '../threeScene';\nexport const make = createJobScene;") },
  { rule: 'E3', name: 'a second lazy reader of the scene builder', plant: edit('components/livingModel/LivingModelScreen.tsx', "type Tab = 'rooms' | 'tasks' | 'replay';", "export const warm = () => import('./threeScene');\ntype Tab = 'rooms' | 'tasks' | 'replay';") },
  { rule: 'G5', name: 'the simulator check draws for everyone', plant: edit(PHONE_SPIKE, "  if (!PHONE3D_SPIKE_ON) return <Redirect href=\"/(tabs)/(home)\" />;\n", '') },
  { rule: 'G5', name: 'the simulator check is switched on in every build', plant: edit(PHONE_SPIKE, "process.env.EXPO_PUBLIC_PHONE3D_SPIKE === '1'", "true") },
  { rule: 'G5', name: 'the simulator check reads a saved model', plant: edit(PHONE_SPIKE, "function Spike() {", "function Spike() {\n  void loadJobModel(null, 'p');") },
  { rule: 'E4', name: 'expo-gl is removed', plant: pkgEdit((p) => { delete p.dependencies['expo-gl']; return p; }) },
  { rule: 'E4', name: 'expo-gl is moved off the SDK\'s range', plant: pkgEdit((p) => { p.dependencies['expo-gl'] = '^15.0.0'; return p; }) },
  { rule: 'E4', name: 'a 3D wrapper is added for the phone', plant: pkgEdit((p) => { p.dependencies['expo-three'] = '8.0.0'; return p; }) },
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
  { rule: 'F3', name: 'the editor loses the lines', plant: edit('components/livingModel/LivingModelScreen.tsx', '              footer={<HonestyLines testID="lm-honesty-rooms" />}\n', '') },
  { rule: 'F3', name: 'the editor is handed the lines and does not draw them', plant: edit('components/livingModel/RoomEditor.tsx', '        {footer}\n', '') },
  { rule: 'F4', name: 'the scan line loses the inch', plant: en('honesty.scanCaveatBody', 'This room came from a phone scan.') },
  { rule: 'F4', name: 'the room card drops the scan line', plant: edit('components/livingModel/replayShared.tsx', "      {room.source === 'scan' ? <Text style={styles.warn}>{copy.scanCaveatBody}</Text> : null}\n", '') },
  { rule: 'F4', name: 'the device-only line is not shown', plant: edit('components/livingModel/RoomEditor.tsx', '        <Text style={styles.note} testID="lm-saved-local">{`${copy.savedLocalBody} ${copy.otherDevicesBody}`}</Text>\n', '') },
  { rule: 'F4', name: 'the editor drops "It will not appear on your other devices."', plant: edit('components/livingModel/RoomEditor.tsx', '{`${copy.savedLocalBody} ${copy.otherDevicesBody}`}', '{copy.savedLocalBody}') },
  { rule: 'F4', name: 'the other-devices line promises sync', plant: en('honesty.otherDevicesBody', 'It will appear on your other devices soon.') },
  { rule: 'F4', name: 'a task with nothing reported shows 0 percent', plant: edit('components/livingModel/replayShared.tsx', 'row.reportedPct == null', 'row.reportedPct == undefined && false') },
  { rule: 'F4', name: 'Other Work is renamed General', plant: en('stage.otherLabel', 'General') },
  { rule: 'F5', name: 'a lower-case label', plant: en('editor.addRoomLabel', 'Add room') },
  { rule: 'F5', name: 'an em dash', plant: en('replay.noWebglBody', 'This browser could not start the 3D view — the same replay is drawn flat below.') },
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
  { rule: 'G4', name: 'the route reads the project before the gate', plant: edit('app/living-model.tsx', "  const { user, isLoading } = useAuth();\n", "  const { user, isLoading } = useAuth();\n  const role = useProjectRoleState('p');\n") },
  { rule: 'G4', name: 'a refresh redirects before the sign-in is read back', plant: edit('app/living-model.tsx', '  if (isLoading) return <AuthSettling />;\n', '') },
  { rule: 'G4', name: 'the wait comes after the redirect', plant: (w) => edit('app/living-model.tsx', "  if (!livingModelAllowed(user?.email)) return <Redirect href=\"/(tabs)/(home)\" />;\n  return <Gated", "  if (!livingModelAllowed(user?.email)) return <Redirect href=\"/(tabs)/(home)\" />;\n  if (isLoading) return <AuthSettling />;\n  return <Gated")(edit('app/living-model.tsx', '  if (isLoading) return <AuthSettling />;\n', '')(w)) },
  { rule: 'G4', name: 'the waiting page mounts the screen', plant: edit('app/living-model.tsx', '      <View style={styles.screen} testID="living-model-auth-settling" />', '      <LivingModelScreen projectId="p" userId={null} />') },
  { rule: 'G4', name: 'the route string is cast with as any again', plant: edit('components/livingModel/LivingModelEntryRow.tsx', "pathname: '/living-model', params", "pathname: '/living-model' as any, params") },
  { rule: 'G5', name: 'the row is drawn for everyone', plant: edit('components/livingModel/LivingModelEntryRow.tsx', '  if (!livingModelAllowed(user?.email)) return null;\n', '') },
  { rule: 'G5', name: 'a sidebar row', plant: (w) => edit('components/DesktopSidebar.tsx', /$/, "\n// { label: 'Living Model', href: '/living-model' }\nexport const LM = '/living-model';\n")(w) },
  { rule: 'G5', name: 'a second screen draws the row', plant: addFile('app/schedule-extra.tsx', "import { LivingModelEntryRow } from '@/components/livingModel/LivingModelEntryRow';\nexport default function X() { return <LivingModelEntryRow projectId=\"p\" />; }\n") },
  { rule: 'G6', name: 'a viewer is let in', plant: swap({ livingModelSeat: (a) => (a.role ? 'open' : livingModelSeat(a)) }) },
  { rule: 'G6', name: 'a field seat is let in', plant: swap({ livingModelSeat: (a) => ((a.role as string) === 'field' ? 'open' : livingModelSeat(a)) }) },
  { rule: 'H1', name: 'a key under a new prefix', plant: swap({ livingModelKey: (u, p) => (u && p ? `livingmodel::${u}::${p}` : null) }) },
  { rule: 'H1', name: 'one key for every person', plant: swap({ livingModelKey: (u, p) => (u && p ? `mageid_living_model::${p}` : null) }) },
  { rule: 'H1', name: 'a key with no person', plant: swap({ livingModelKey: (u, p) => `mageid_living_model::${u ?? 'anon'}::${p ?? 'none'}` }) },
  { rule: 'H2', name: 'the model is written into the project', plant: edit('components/livingModel/LivingModelScreen.tsx', '    void saveJobModel(userId, m, new Date().toISOString(), loadStateRef.current)', '    updateProject(projectId, { schedule: { livingModel: m } });\n    void saveJobModel(userId, m, new Date().toISOString(), loadStateRef.current)') },
  { rule: 'H2', name: 'the store writes a third key', plant: edit('utils/livingModel/store.ts', '    await AsyncStorage.setItem(key, json);', "    await AsyncStorage.setItem('mageid_living_model_last', json);\n    await AsyncStorage.setItem(key, json);") },
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
  // ── added after the review ──
  { rule: 'A5', name: 'a move to the same spot makes a new model', plant: swap({ moveRoom: (m, id, x, y) => { const n = moveRoom(m, id, x, y); return n === m ? { ...m } : n; } }) },
  { rule: 'A5', name: 'turning a room that is not there makes a new model', plant: swap({ rotateRoom: (m, id) => { const n = rotateRoom(m, id); return n === m ? { ...m, rooms: [...m.rooms] } : n; } }) },
  { rule: 'A5', name: 'setting the same kind makes a new model', plant: swap({ setRoomKind: (m, id, k) => ({ ...m, rooms: m.rooms.map((r) => (r.id === id ? { ...r, kind: k } : r)) }) }) },
  { rule: 'A7', name: 'a null wall throws, as it did', plant: swap({ readSavedModel: (raw, pid) => { if (raw && /"walls":\[[^\]]*null/.test(raw)) throw new TypeError("null is not an object (evaluating 'w.a')"); return readSavedModel(raw, pid); } }) },
  { rule: 'A7', name: 'text that cannot be read is treated as nothing saved', plant: swap({ readSavedModel: (raw, pid) => { const r = readSavedModel(raw, pid); return r.state === 'unreadable' ? { state: 'empty' } : r; } }) },
  { rule: 'A7', name: 'an unknown version is read anyway', plant: swap({ readSavedModel: (raw, pid) => { const r = readSavedModel(raw, pid); if (r.state !== 'unreadable' || !raw) return r; try { const v = JSON.parse(raw) as { version?: number }; return v.version === 2 ? readSavedModel(JSON.stringify({ ...v, version: 1 }), pid) : r; } catch { return r; } } }) },
  { rule: 'A7', name: 'a change may be saved over unread text', plant: swap({ mayWriteModel: () => true }) },
  { rule: 'A7', name: 'the backup is the model key itself', plant: swap({ livingModelBackupKey: (u, p) => livingModelKey(u, p) }) },
  { rule: 'A7', name: 'the store saves without the guard', plant: edit('utils/livingModel/store.ts', '  if (!key || !mayWriteModel(state)) return false;', '  if (!key) return false;') },
  { rule: 'A7', name: 'the store drops the unread text instead of keeping it', plant: edit('utils/livingModel/store.ts', '  await keepUnreadText(userId, projectId, raw as string);\n', '') },
  { rule: 'A7', name: 'the store answers "ready" for unread text, so the first edit saves over it', plant: edit('utils/livingModel/store.ts', "  return { model: emptyJobModel(projectId), state: 'unreadable' };", "  return { model: emptyJobModel(projectId), state: 'ready' };") },
  { rule: 'A7', name: 'the Room Editor is drawn while the model is unread', plant: edit('components/livingModel/LivingModelScreen.tsx', "{model && !blocked && tab === 'rooms' ? (", "{model && tab === 'rooms' ? (") },
  { rule: 'A7', name: 'the screen starts a new model by itself', plant: edit('components/livingModel/LivingModelScreen.tsx', "      loadStateRef.current = loaded.state;\n", "      loadStateRef.current = loaded.state === 'unreadable' ? 'started_new' : loaded.state;\n") },
  { rule: 'A7', name: 'the screen saves without the guard', plant: edit('components/livingModel/LivingModelScreen.tsx', '    if (!mayWriteModel(loadStateRef.current)) return;\n', '') },
  { rule: 'A7', name: 'the load has no catch', plant: edit('components/livingModel/LivingModelScreen.tsx', /\}\)\.catch\(\(\) => \{\n {6}if \(!alive\) return;\n {6}loadStateRef\.current = 'unreadable';\n {6}setLoadState\('unreadable'\);\n {6}setHistory\(historyOf\(emptyJobModel\(projectId\)\)\);\n {4}\}\);/, '});') },
  { rule: 'A7', name: 'the unreadable sentence is not shown', plant: edit('components/livingModel/LivingModelScreen.tsx', '            <Text style={styles.para}>{copy.unreadableBody}</Text>\n', '') },
  { rule: 'A7', name: 'the sentence stops saying nothing is saved over the old model', plant: en('load.unreadableBody', 'It has not been changed or removed, and a copy of it is kept on this device. You can start a new model for this job.') },
  { rule: 'B2', name: 'the word "rough" alone is rough-in again', plant: swap({ stageForTask: (t, tr) => (/\brough\b/i.test(t ?? '') && !/inspect|grad/i.test(t ?? '') ? { stage: 'rough_in', by: 'words' } : stageForTask(t, tr)) }) },
  { rule: 'B2', name: '"floor" is always Finishes', plant: swap({ stageForTask: (t, tr) => (/floor/i.test(t ?? '') && !/joist|subfloor/i.test(t ?? '') ? { stage: 'finishes', by: 'words' } : stageForTask(t, tr)) }) },
  { rule: 'B2', name: '"finish" is always Finishes', plant: swap({ stageForTask: (t, tr) => (/finish/i.test(t ?? '') ? { stage: 'finishes', by: 'words' } : stageForTask(t, tr)) }) },
  { rule: 'B2', name: 'carpentry is always framing', plant: swap({ stageForTask: (t, tr) => (/carpentry/i.test(t ?? '') ? { stage: 'framing', by: 'words' } : stageForTask(t, tr)) }) },
  { rule: 'B3', name: 'a frame inspection is framing', plant: swap({ stageForTask: (t, tr) => (/\bfram/i.test(t ?? '') ? { stage: 'framing', by: 'words' } : stageForTask(t, tr)) }) },
  { rule: 'B4', name: 'the person\'s choice is ignored', plant: swap({ resolveStage: (t, tr) => stageForTask(t, tr) }) },
  { rule: 'B4', name: 'any text is taken as a stage', plant: swap({ resolveStage: (t, tr, c) => (typeof c === 'string' && c ? { stage: c as never, by: 'person' } : stageForTask(t, tr)) }) },
  { rule: 'B4', name: 'picking a stage unticks the task', plant: swap({ setTaskStage: (m, id, st) => { const n = setTaskStage(m, id, st); return n === m ? m : { ...n, links: Object.fromEntries(Object.entries(n.links).map(([r, ids]) => [r, ids.filter((x) => x !== id)])) }; } }) },
  { rule: 'B4', name: 'the picked stage is not saved', plant: swap({ readSavedModel: (raw, pid) => { const r = readSavedModel(raw, pid); if (r.state !== 'ok') return r; const model = { ...r.model }; delete model.stages; return { state: 'ok', model }; } }) },
  { rule: 'B4', name: 'the replay does not read the picked stage', plant: swap({ buildReplayInput: (s, r, n) => buildReplayInput(s, r, n) }) },
  { rule: 'B4', name: 'the screen does not hand the picked stages over', plant: edit('components/livingModel/LivingModelScreen.tsx', 'buildReplayInput(project?.schedule ?? null, reports, now, chosenStages), [project?.schedule, reports, now, chosenStages]', 'buildReplayInput(project?.schedule ?? null, reports, now), [project?.schedule, reports, now]') },
  { rule: 'B4', name: 'the picker is removed from the Tasks tab', plant: edit('components/livingModel/TaskLinks.tsx', 'onPress={() => { onChange(setTaskStage(model, t.id, st)); setStageFor(null); }}', 'onPress={() => setStageFor(null)}') },
  { rule: 'B4', name: 'the picker cannot go back to the title', plant: edit('components/livingModel/TaskLinks.tsx', 'onChange(setTaskStage(model, t.id, null)); ', '') },
  { rule: 'C6', name: 'the card is always today\'s', plant: swap({ roomCard: (t, p, c, _o, m) => roomCard(t, p, c, c.todayOffset, m) }) },
  { rule: 'C6', name: 'the average is weighted by duration and does not say so', plant: swap({ roomCard: (t, p, c, o, m) => { const card = roomCard(t, p, c, o, m); const at = card.offset; let num = 0; let den = 0; for (const x of t) { const v = card.reading === 'reported' ? reportedAt(x, p, at, c.todayOffset) : plannedAt(x, at); num += v * x.durationDays; den += x.durationDays; } return { ...card, pct: den ? Math.round((num / den) * 100) : 0 }; } }) },
  { rule: 'C6', name: 'a task with nothing reported is left out of the average', plant: swap({ roomCard: (t, p, c, o, m) => { const card = roomCard(t, p, c, o, m); if (card.reading !== 'reported') return card; const got = card.rows.filter((r) => r.reportedPct != null); return { ...card, pct: got.length ? Math.round(got.reduce((a, r) => a + (r.reportedPct as number), 0) / got.length) : 0 }; } }) },
  { rule: 'C6', name: 'past today the card still shows the reported number', plant: swap({ roomCard: (t, p, c, o, m) => { const card = roomCard(t, p, c, o, m); return card.when === 'ahead' ? { ...roomCard(t, p, c, c.todayOffset, m), when: 'ahead', reading: 'plan_ahead' } : card; } }) },
  { rule: 'C6', name: 'past today is called reported', plant: swap({ roomCard: (t, p, c, o, m) => { const card = roomCard(t, p, c, o, m); return card.reading === 'plan_ahead' ? { ...card, reading: m ?? 'reported' } : card; } }) },
  { rule: 'C6', name: 'rows keep today\'s percent at an earlier week', plant: swap({ roomCard: (t, p, c, o, m) => { const card = roomCard(t, p, c, o, m); const now = roomCard(t, p, c, c.todayOffset, m); return { ...card, rows: now.rows }; } }) },
  { rule: 'C6', name: 'the line under the number is reworded', plant: en('card.averageReportedBody', { one: '1 ticked task.', other: 'Across {count} ticked tasks.' }) },
  { rule: 'C6', name: 'the line claims a weighting', plant: en('card.averagePlannedBody', { one: 'This is the 1 ticked task, by its planned dates.', other: 'Average of the {count} ticked tasks, weighted by how long each runs.' }) },
  { rule: 'C6', name: 'the card drops the line under the number', plant: edit('components/livingModel/replayShared.tsx', /\n {10}<Text style=\{styles\.note\} testID="lm-card-average">[^\n]*\n/, '\n') },
  { rule: 'C6', name: 'the card is worked out for today whatever the scrubber says', plant: edit('components/livingModel/replayShared.tsx', 'roomCard(tasks, input.points, input.clock, offset, mode), [tasks, input.points, input.clock, offset, mode]', 'roomCard(tasks, input.points, input.clock, input.clock.todayOffset, mode), [tasks, input.points, input.clock, mode]') },
  { rule: 'C6', name: 'the screen does not hand the scrubber to the card', plant: edit('components/livingModel/LivingModelScreen.tsx', 'mode={state.mode} offset={state.offset}', 'mode={state.mode} offset={input.clock.todayOffset}') },
  { rule: 'C6', name: '"As of today" is said every week', plant: edit('components/livingModel/replayShared.tsx', "const whenLine = card.when === 'today' ? copy.asOfTodaySub", "const whenLine = card.when !== 'undated' ? copy.asOfTodaySub") },
  { rule: 'C6', name: 'the plan-only line is dropped', plant: edit('components/livingModel/replayShared.tsx', /\n {10}\{card\.reading === 'plan_ahead' \? <Text style=\{styles\.warn\} testID="lm-card-plan-only">[^\n]*\n/, '\n') },
  { rule: 'C7', name: 'dates are read by cutting the text, as they were', plant: swap({ buildReplayInput: (s, r, n, st) => buildReplayInput(s ? ({ ...s, tasks: (s.tasks ?? []).map((t) => ({ ...t, actualStartDate: t.actualStartDate?.slice(0, 10), actualEndDate: t.actualEndDate?.slice(0, 10) })) }) : s, r.map((x) => ({ ...x, date: x.date.slice(0, 10) })), n, st) }) },
  { rule: 'C7', name: 'a daily report dated after today is counted', plant: swap({ buildReplayInput: (s, r, n, st) => { const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; const real = buildReplayInput(s, r, n, st); const moved = buildReplayInput(s, r.map((x) => ({ ...x, date: today })), n, st); return { ...real, points: moved.points, futureReports: 0 }; } }) },
  { rule: 'C7', name: 'the closed days are not carried', plant: swap({ buildReplayInput: (s, r, n, st) => ({ ...buildReplayInput(s, r, n, st), nonWorkingDates: [] }) }) },
  { rule: 'C7', name: 'the card works its dates out without the closed days', plant: edit('components/livingModel/replayShared.tsx', '    const d = dateOfOffset(input, at);', '    const d = input.startDate ? addWorkingDays(input.startDate, Math.max(0, Math.round(at)), input.clock.workingDaysPerWeek) : null;') },
  { rule: 'C7', name: 'replayInput cuts the date text again', plant: edit('utils/livingModel/replayInput.ts', '    const d = calendarDayStart(value);', '    const d = parseCalendarDay(value.slice(0, 10));') },
  { rule: 'C8', name: 'the notice says all of it shows as the plan', plant: en('replay.noStartBody', 'The schedule has no start date, so nothing can be placed against today. All of it shows as the plan.') },
  { rule: 'C8', name: 'daily reports are placed with no start date', plant: swap({ buildReplayInput: (s, r, n, st) => { const real = buildReplayInput(s, r, n, st); if (real.clock.hasStartDate) return real; return { ...real, points: r.flatMap((x) => (x.workProgress ?? []).map((q) => ({ taskId: q.taskId, offset: 0, pct: q.pct }))) }; } }) },
  { rule: 'C8', name: 'Reported shows nothing with no start date', plant: swap({ reportedAt: (t, p, o, today) => (today === 0 ? 0 : reportedAt(t, p, o, today)) }) },
  { rule: 'C8', name: 'the link to the schedule is removed', plant: edit('components/livingModel/replayShared.tsx', /\n {10}\{onSetStartDate \? <Button label=\{copy\.setStartLabel\}[^\n]*\n/, '\n') },
  { rule: 'C8', name: 'the link opens Home', plant: edit('components/livingModel/LivingModelScreen.tsx', "router.push({ pathname: '/schedule-pro', params: { projectId } })", "router.push('/(tabs)/(home)')") },
  { rule: 'D3', name: 'the box lists six and Confirm ticks all nine', plant: swap({ suggestionBox: (room, tasks, ticked) => { const b = suggestionBox(room, tasks, ticked); return { listed: b.listed.slice(0, 6), confirmIds: b.confirmIds }; } }) },
  { rule: 'D3', name: 'the box lists nine and Confirm ticks six', plant: swap({ suggestionBox: (room, tasks, ticked) => { const b = suggestionBox(room, tasks, ticked); return { listed: b.listed, confirmIds: b.confirmIds.slice(0, 6) }; } }) },
  { rule: 'D3', name: 'Confirm ticks every task in the schedule', plant: swap({ suggestionBox: (room, tasks, ticked) => ({ listed: suggestionBox(room, tasks, ticked).listed, confirmIds: tasks.map((t) => t.id) }) }) },
  { rule: 'D3', name: 'the box lists ids, not names', plant: swap({ suggestionBox: (room, tasks, ticked) => { const b = suggestionBox(room, tasks, ticked); return { listed: b.listed.map((l) => ({ ...l, title: '' })), confirmIds: b.confirmIds }; } }) },
  { rule: 'D3', name: 'the screen shows only the first six again', plant: edit('components/livingModel/TaskLinks.tsx', '{box.listed.map((s, i) =>', '{box.listed.slice(0, 6).map((s, i) =>') },
  { rule: 'D3', name: 'the screen confirms its own list of suggestions', plant: edit('components/livingModel/TaskLinks.tsx', 'confirmSuggestions(model, room.id, box.confirmIds)', 'confirmSuggestions(model, room.id, input.linkTasks.map((t) => t.id))') },
  { rule: 'D3', name: 'the Suggested box does not scroll', plant: edit('components/livingModel/TaskLinks.tsx', '<ScrollView style={styles.suggestList} nestedScrollEnabled testID="lm-suggestion-list">', '<ScrollView style={styles.suggestList} nestedScrollEnabled>') },
  // The same plant the phone-bundle check in scripts/validate-native-surface.ts exists for: the library imported in the PHONE's file.
  { rule: 'E1', name: '`import \'three\'` in the phone file', plant: edit('components/livingModel/JobReplay3D.tsx', "import type { JobReplay3DProps } from './jobReplay3DProps';", "import 'three';\nimport type { JobReplay3DProps } from './jobReplay3DProps';") },
  { rule: 'E6', name: '`import \'three\'` in the phone file', plant: edit('components/livingModel/JobReplay3D.tsx', "import type { JobReplay3DProps } from './jobReplay3DProps';", "import 'three';\nimport type { JobReplay3DProps } from './jobReplay3DProps';") },
  { rule: 'E6', name: 'the phone file loads the library with a dynamic import', plant: edit('components/livingModel/JobReplay3D.tsx', 'export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;', "export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;\nexport const warm = () => import('three');") },
  { rule: 'E6', name: 'the engine file imports the scene builder when the bundle loads', plant: edit(PHONE_ENGINE, "import type { JobSceneHandle, JobSceneOptions } from '../threeScene';", "import { createJobScene, type JobSceneHandle } from '../threeScene';\nexport const make = createJobScene;") },
  { rule: 'E6', name: 'the engine file imports the drawing surface when the bundle loads', plant: edit(PHONE_ENGINE, "import { requireOptionalNativeModule } from 'expo';", "import { requireOptionalNativeModule } from 'expo';\nimport * as Surface from 'expo-gl';\nexport { Surface };") },
  { rule: 'E6', name: 'the flat view builds the scene', plant: edit('components/livingModel/FlatReplay.tsx', "import { ModelPlan } from './ModelPlan';", "import { ModelPlan } from './ModelPlan';\nimport { createJobScene } from './threeScene';\nexport const make = createJobScene;") },
  { rule: 'E6', name: 'the screen names the web file', plant: edit('components/livingModel/LivingModelScreen.tsx', "from './JobReplay3D';", "from './JobReplay3D.web';") },
  { rule: 'E6', name: 'a core file the phone reads requires the library', plant: edit('utils/livingModel/replayCore.ts', "import { BUILD_STAGES,", "const T3 = require('three');\nexport const t3 = T3;\nimport { BUILD_STAGES,") },
  { rule: 'E6', name: 'the bundle check looks for names the 3D code does not have', plant: (w) => ({ ...w, files: { ...w.files, 'components/livingModel/threeScene.ts': w.files['components/livingModel/threeScene.ts'].replace(/createJobScene/g, 'makeScene') } }) },
  { rule: 'E7', name: '`ready` is not reset when the scene is thrown away (the blank view after a theme change)', plant: edit('components/livingModel/JobReplay3D.web.tsx', '      setReady(false);\n    };\n  }, [palette, reloads, loadLibrary]);', '    };\n  }, [palette, reloads, loadLibrary]);') },
  { rule: 'E7', name: 'the palette does not make a new scene', plant: edit('components/livingModel/JobReplay3D.web.tsx', '  }, [palette, reloads, loadLibrary]);', '  }, [reloads, loadLibrary]);') },
  { rule: 'E7', name: 'the next scene reuses the old canvas', plant: edit('components/livingModel/JobReplay3D.web.tsx', '        key: canvasKey,\n', '') },
  { rule: 'E7', name: 'the rooms effect does not wait for a ready scene', plant: edit('components/livingModel/JobReplay3D.web.tsx', '  }, [ready, rooms, cut]);', '  }, [rooms, cut]);') },
  { rule: 'E7', name: 'the WebGL context is not given back', plant: swap({ createJobScene: (T, c, p, o) => { const h = createJobScene(T, c, p, o); return { ...h, dispose: () => { h.setRooms([], null); } }; } }) },
  { rule: 'E7', name: 'the scene keeps the old theme\'s ground', plant: swap({ createJobScene: (T, c, _p, o) => createJobScene(T, c, LIGHT, o) }) },
  { rule: 'E7', name: 'the scene does not release its context in dispose', plant: edit('components/livingModel/threeScene.ts', '      try { if (canLoseContext(renderer)) renderer.forceContextLoss(); } catch { /* the context is already gone */ }\n', '') },
  { rule: 'E7', name: 'the scene gives back a context that cannot be given back', plant: swap({ createJobScene: (lib, canvas, palette, opts) => { const R = (lib as unknown as { WebGLRenderer: new (p?: unknown) => object }).WebGLRenderer; class Blind extends R { constructor(p?: unknown) { super(p); (this as { extensions?: unknown }).extensions = undefined; } } return createJobScene({ ...(lib as object), WebGLRenderer: Blind } as unknown as typeof import('three'), canvas, palette, opts); } }) },
  { rule: 'E7', name: 'the web\'s renderer loses its smoothing', plant: swap({ createJobScene: (lib, canvas, palette, opts) => createJobScene(lib, canvas, palette, { antialias: false, ...opts }) }) },
  { rule: 'E7', name: 'the web\'s pixel-ratio cap moves', plant: swap({ createJobScene: (lib, canvas, palette, opts) => createJobScene(lib, canvas, palette, { maxPixelRatio: 3, ...opts }) }) },
  { rule: 'E7', name: 'a lost context is not listened for', plant: edit('components/livingModel/JobReplay3D.web.tsx', "      canvas.addEventListener('webglcontextlost', onLost);\n", '') },
  { rule: 'E7', name: 'Reload View does not make a new scene', plant: edit('components/livingModel/JobReplay3D.web.tsx', 'onPress={() => { setLost(false); setReloads((n) => n + 1); }}', 'onPress={() => { setLost(false); }}') },
  { rule: 'E8', name: 'the wheel always zooms', plant: swap({ wheelShouldZoom: () => true }) },
  { rule: 'E8', name: 'the wheel never zooms', plant: swap({ wheelShouldZoom: () => false }) },
  { rule: 'E8', name: 'one finger always turns the model', plant: swap({ oneFingerTurnsModel: () => true }) },
  { rule: 'E8', name: 'the canvas takes every touch', plant: swap({ canvasTouchAction: () => 'none' }) },
  { rule: 'E8', name: 'the wheel handler stops the page first', plant: edit('components/livingModel/JobReplay3D.web.tsx', /        if \(!wheelShouldZoom\(e, [^\n]*\n        e\.preventDefault\(\);/, '        e.preventDefault();') },
  { rule: 'E8', name: 'touch-action is none on every screen', plant: edit('components/livingModel/JobReplay3D.web.tsx', 'touchAction: canvasTouchAction(compact),', "touchAction: 'none',") },
  { rule: 'E8', name: 'one finger turns the model on a narrow screen', plant: edit('components/livingModel/JobReplay3D.web.tsx', '          if (!oneFingerTurnsModel(e.pointerType, compactRef.current)) return;\n', '') },
  { rule: 'E8', name: 'the hint is removed', plant: edit('components/livingModel/LivingModelScreen.tsx', /\n {10}\{threeD \? <Text style=\{styles\.note\} testID="lm-3d-hint">[^\n]*\n/, '\n') },
  { rule: 'E8', name: 'the hint still says scroll to zoom', plant: en('replay.orbitHelpSub', 'Drag to turn. Hold Shift and drag, or use two fingers, to move. Scroll or pinch to zoom') },
  { rule: 'I1', name: 'a white light written in the scene', plant: edit('components/livingModel/threeScene.ts', 'new THREE.DirectionalLight(palette.sun, palette.sunStrength)', "new THREE.DirectionalLight('#ffffff', 1.0)") },
  { rule: 'I1', name: 'a stray #ffffff in the scene', plant: edit('components/livingModel/threeScene.ts', 'none: faint(palette.vertexBase, 0),', "none: faint('#ffffff', 0),") },
  { rule: 'I1', name: 'the dark table is the light table', plant: swap({ MATERIALS: { light: MATERIALS.light, dark: MATERIALS.light } as never }) },
  { rule: 'I1', name: 'the dark table loses a material', plant: swap({ MATERIALS: { light: MATERIALS.light, dark: Object.fromEntries(Object.entries(MATERIALS.dark).filter(([k]) => k !== 'trim')) } as never }) },
  { rule: 'J5', name: 'the fit ignores the wall height', plant: swap({ viewExtent: (b, _h, az, el) => viewExtent(b, 0, az, el) }) },
  { rule: 'J5', name: 'the fit is the old one, from the floor box alone', plant: swap({ viewExtent: (b) => { const span = b ? Math.max(4, Math.hypot(b.maxX - b.minX, b.maxY - b.minY)) : 8; return { halfW: (span * 1.3 * 0.84) / 2, halfH: (span * 1.3 * 0.84) / 2 / 1.4 }; } }) },
  { rule: 'J5', name: 'a label is sized from the room\'s whole box on the canvas', plant: swap({ labelRoomPx: (u, v) => 2 * (Math.abs(u.x) + Math.abs(v.x)) }) },
  { rule: 'J5', name: 'every label is shown in full', plant: swap({ pinSize: () => 'full' }) },
  { rule: 'J5', name: 'the selected room\'s label is cut down too', plant: swap({ pinSize: (px) => pinSize(px, false) }) },
  { rule: 'J5', name: 'the floors do not take the stage colour', plant: swap({ createJobScene: (T, c, p, o) => { const h = createJobScene(T, c, p, o); return { ...h, apply: (looks) => h.apply(new Map(Array.from(looks.entries()).map(([id, l]) => [id, { ...l, stage: 'no_tasks' as const }]))) }; } }) },
  { rule: 'J5', name: 'every room in work gets one floor colour', plant: swap({ createJobScene: (T, c, p, o) => { const h = createJobScene(T, c, p, o); return { ...h, apply: (looks) => h.apply(new Map(Array.from(looks.entries()).map(([id, l]) => [id, { ...l, stage: l.stage === 'no_tasks' || l.stage === 'not_started' ? l.stage : ('other' as const) }]))) }; } }) },
  { rule: 'J5', name: 'the stage line is always shown', plant: edit('components/livingModel/JobReplay3D.web.tsx', "if (sub) sub.style.display = size === 'full' ? '' : 'none';", "if (sub) sub.style.display = '';") },
  { rule: 'J5', name: 'the scene fits the floor and not the walls', plant: edit('components/livingModel/threeScene.ts', 'fitZoom(viewExtent(floorBox, V.wallH, DEFAULT_VIEW.azimuth, DEFAULT_VIEW.elevation), V.w, V.h)', 'fitZoom(viewExtent(floorBox, 0, DEFAULT_VIEW.azimuth, DEFAULT_VIEW.elevation), V.w, V.h)') },
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
