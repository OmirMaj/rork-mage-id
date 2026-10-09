// validate-scan-room — Scan The Room, Phase 1 (lane SCANROOM). Dark behind
// SCAN_ROOM_ENABLED = false.
//
// WHAT IT PROVES, with no phone.
//
// A. THE GEOMETRY (utils/roomScan, run directly, no React), on three hand-built
//    CapturedRoom files and on rooms built in memory:
//    - the bathroom, the L-shaped room and the room with a missing wall each
//      match answers worked out by hand (floor, walls, openings, baseboard,
//      crown, casing, door and window sizes, fixtures);
//    - the plan is not mirrored, and the answer does not depend on how the room
//      is turned or what order the walls arrive in;
//    - walls that miss by a few centimetres close; walls that miss by more do
//      not, and an open outline never reports a floor area;
//    - a slanted wall, a missing ceiling height, a curved wall, a room past
//      Apple's size limit and a wall the scan was unsure of are each said in
//      plain facts;
//    - openings are subtracted exactly once and clipped to their wall;
//      baseboard loses doors and floor openings only; no waste is added.
// B. UNITS: feet and inches round once, a typed tape measurement reads, door
//    widths snap only within an inch.
// C. THE PARSER: unknown keys ignored, iOS 17 keys optional, other encodings
//    of the same room give the same model, a wall that cannot be placed is a
//    typed error. THE FIXTURES ARE HAND-BUILT; the parser must still be
//    re-checked against a real export from a phone, and this file checks that
//    the code says so.
// D. CORRECTIONS: a typed measurement recomputes the quantities, is recorded
//    with before and after, and is marked typed by hand; typed lengths that do
//    not close are refused a floor area; a tape check never changes the scan.
// E. PRICING: every priced line names where its price came from; a price that
//    is not his own is never labelled his; a line with no price is not $0 and
//    is not pushed; the draft goes through the app's existing takeoff path
//    (priceCondition, pushLinesFrom, applyTakeoffPush, commitEstimatePatch)
//    and equals what those functions give; NOTHING is built or saved without
//    `confirmed: true` from the person's tap.
// F. THE WIRING (source text): the flag is false; the route redirects before
//    it mounts anything; nothing outside the feature links to it or imports
//    it; the native module is reached by ONE optional lookup that is not at
//    module scope and is refused while the flag is off; the Swift module waits
//    in native-staging/, OUTSIDE the folder Expo autolinking builds from, and
//    the autolinking search itself is run to prove the next iOS build does not
//    carry it; it holds no JavaScript; the Swift that touches RoomPlan is
//    iOS 16 guarded, settles its promise exactly once on every path and
//    typechecks; no react-native-reanimated; theme colours only; Lucide icons
//    only; storage keys under an owned prefix; no server write; the Pro gate
//    through hooks/useTierAccess; app.json is not changed by this lane.
// G. THE WORDS (the English shard and the Spanish catalog): labels with every
//    word capitalised, sentences that end, no em dash, no "&", no "e.g.", no
//    arrows, no promise of how right a number is, and the plain statement that
//    a phone scan can be off by an inch or more; English and Spanish key sets,
//    plural shapes and placeholders equal.
//
// H. THE REVIEW ROUND (2026-10-06, an independent read of the lane), each a
//    behaviour check with planted mutations:
//    C1  a trade of his that only shares a word is never taken as his price
//        (seven cases that used to be), and the label names which of his
//        trades was used when it is not the line's own;
//    D1  a scan is never named for him, and a room with no name is not priced;
//    A1  only an owner or editor seat can push, and "Added to the estimate."
//        waits until the project is seen to hold the lines;
//    F1  overlapping openings on one wall come off once, and an opening that
//        matched no wall is said;
//    G10 the floor is the loop that covers the most ground, and a ring that
//        crosses itself is open;
//    H1  a typed length far from the scan is shown back and asked about;
//    S1  a saved scan can be deleted, and a scan the cap drops takes its raw
//        file with it;
//    K1  a project with no estimate gets one started by the same yes, through
//        utils/estimateLanding.buildNewEstimate, at his stated markup;
//    J1  no $0.00 line, an honest start sentence, Back asks before it drops.
//
// PLANTED MUTATIONS. Every rule is run a second time against a planted break
// (a wrapped copy of a module, or edited text, in memory only; nothing on disk
// changes) and the run fails unless that break turns the named rule red.
// `LIST=1` prints them.
//
// Run: bun run scripts/validate-scan-room.ts
// Pure node:fs + pure modules; no react-native import (those crash bun).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as PARSER from '../utils/roomScan/capturedRoomParser';
import * as GEO from '../utils/roomScan/geometryCore';
import * as QTY from '../utils/roomScan/quantitiesCore';
import * as EDITS from '../utils/roomScan/editsCore';
import * as UNITS from '../utils/roomScan/units';
import * as PRICING from '../utils/roomScan/pricingCore';
import * as STORE from '../utils/roomScan/storeCore';
import { roomScanAvailability } from '../utils/roomScan/availability';
import { makeCatalogRater } from '../utils/roomScan/catalogRate';
import { ROOM_RECIPES, RECIPE_NAMES_EN, type RecipeKey, type RecipeLine } from '../utils/roomScan/recipesCore';
import { RoomScanParseError, type RoomScan, type ScanQuantities } from '../utils/roomScan/types';
import { SCAN_ROOM_FEATURE, SCAN_ROOM_REQUIRED_TIER, scanSeat } from '../utils/roomScan/gate';
import { SCAN_ROOM_ENABLED } from '../constants/featureFlags';
import { isAppStorageKey } from '../utils/localCacheKeys';
import { buildCostDatabase, lookupRate, type CostBookEntry, type CostDatabase } from '../utils/costDatabase';
import { KIND_UNIT, priceCondition } from '../utils/takeoff/conditions';
import { matchOwnRate } from '../utils/takeoffPricing';
import { buildNewEstimate } from '../utils/estimateLanding';
import { applyTakeoffPush, pushLinesFrom } from '../utils/takeoff/conditionPush';
import { commitEstimatePatch } from '../utils/estimateCommit';
import { sourceHash } from '../i18n/hash';
import { EN as EN_REAL } from '../i18n/catalog/en/office.room-scan.generated';
import { ES_OFFICE_ROOM_SCAN as ES_REAL } from '../i18n/catalog/es/office/roomScan';
import { EN_SHARDS } from '../i18n/catalog/en';
import { ES_SHARDS } from '../i18n/catalog/es';
import { SURFACES } from '../i18n/surfaces';
import type { LinkedEstimate, Project } from '../types';
import {
  FIXTURE_FILES, bathroomSpec, buildCapturedRoom, lShapeSpec, ring,
  type RoomSpec,
} from './fixtures/scan-room/builder';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

// ── the world a rule looks at (a mutation hands it an edited copy) ──────────
const FEATURE_FILES = [
  'app/scan-room.tsx',
  'components/roomScan/RoomScanFlow.tsx', 'components/roomScan/FloorPlanView.tsx', 'components/roomScan/QuantitiesView.tsx',
  'components/roomScan/PricedDraftView.tsx', 'components/roomScan/EditMeasureSheet.tsx', 'components/roomScan/styles.ts',
  'hooks/useRoomScanCopy.ts',
  'utils/roomScan/availability.ts', 'utils/roomScan/capturedRoomParser.ts', 'utils/roomScan/catalogRate.ts',
  'utils/roomScan/editsCore.ts', 'utils/roomScan/gate.ts', 'utils/roomScan/geometryCore.ts', 'utils/roomScan/native.ts',
  'utils/roomScan/pricingCore.ts', 'utils/roomScan/quantitiesCore.ts', 'utils/roomScan/recipesCore.ts',
  'utils/roomScan/store.ts', 'utils/roomScan/storeCore.ts', 'utils/roomScan/types.ts', 'utils/roomScan/units.ts',
  // The order list and the learning loop (lane SCANORDER; its own rules are in scripts/validate-scan-order.ts).
  'components/roomScan/OrderListView.tsx', 'components/roomScan/CutLayoutView.tsx', 'components/roomScan/TapeFactsPanel.tsx',
  'hooks/useScanOrderCopy.ts',
  'utils/roomScan/cutPlanCore.ts', 'utils/roomScan/trimPackCore.ts', 'utils/roomScan/orderListCore.ts',
  'utils/roomScan/learnCore.ts', 'utils/roomScan/learnStore.ts', 'utils/roomScan/orderPricingCore.ts',
] as const;
const SWIFT_FILES = ['RoomScanTypes.swift', 'MageRoomScanModule.swift', 'RoomScanSupport.swift'] as const;
const OTHER_FILES = [
  'constants/featureFlags.ts', 'app.json', 'package.json', '.gitignore', 'docs/scan-the-room-native-checklist.md',
  'native-staging/mage-room-scan/package.json', 'native-staging/mage-room-scan/expo-module.config.json',
  'native-staging/mage-room-scan/ios/MageRoomScan.podspec', 'native-staging/mage-room-scan/README.md',
  'scripts/fixtures/scan-room/builder.ts',
  ...SWIFT_FILES.map((f) => `native-staging/mage-room-scan/ios/${f}`),
] as const;

/** Every source file outside the feature, for "nothing links to it". Read once. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = `${dir}/${name}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const OUTSIDE: Record<string, string> = {};
for (const dir of ['app', 'components', 'utils', 'hooks', 'contexts', 'constants', 'lib', 'i18n']) {
  for (const f of walk(dir)) {
    if ((FEATURE_FILES as readonly string[]).includes(f) || f.startsWith('i18n/catalog/')) continue;
    OUTSIDE[f] = read(f);
  }
}

interface Mods {
  parse: typeof PARSER.parseCapturedRoom;
  build: typeof GEO.buildRoomScan;
  quantities: typeof QTY.computeQuantities;
  pricingBlock: typeof QTY.pricingBlock;
  facts: typeof QTY.scanFacts;
  wall: typeof EDITS.correctWallLength;
  ceiling: typeof EDITS.correctCeilingHeight;
  opening: typeof EDITS.correctOpening;
  tape: typeof EDITS.addTapeCheck;
  feetInches: typeof UNITS.formatFeetInches;
  nominal: typeof UNITS.nominalDoorWidthIn;
  parseTape: typeof UNITS.parseTapeMeasure;
  draft: typeof PRICING.buildScanDraft;
  patch: typeof PRICING.buildEstimatePatch;
  tradeFor: typeof PRICING.resolveTrade;
  draftBlock: typeof PRICING.draftBlock;
  holds: typeof PRICING.estimateHoldsPush;
  scanBlock: typeof QTY.scanPricingBlock;
  rename: typeof EDITS.renameScan;
  far: typeof UNITS.tapeFarFromScan;
  upsert: typeof STORE.upsertSavedScan;
  seat: typeof scanSeat;
  flag: boolean;
}
interface World {
  /** The folders under modules/, the one place Expo autolinking looks (package.json sets no other). */
  modulesDirs: string[];
  M: Mods;
  F: Record<string, string>;
  outside: Record<string, string>;
  EN: Record<string, unknown>;
  ES: Record<string, { s: unknown; src: string } | undefined>;
}
const REAL_MODS: Mods = {
  parse: PARSER.parseCapturedRoom, build: GEO.buildRoomScan, quantities: QTY.computeQuantities,
  pricingBlock: QTY.pricingBlock, facts: QTY.scanFacts,
  wall: EDITS.correctWallLength, ceiling: EDITS.correctCeilingHeight, opening: EDITS.correctOpening, tape: EDITS.addTapeCheck,
  feetInches: UNITS.formatFeetInches, nominal: UNITS.nominalDoorWidthIn, parseTape: UNITS.parseTapeMeasure,
  draft: PRICING.buildScanDraft, patch: PRICING.buildEstimatePatch, flag: SCAN_ROOM_ENABLED,
  tradeFor: PRICING.resolveTrade, draftBlock: PRICING.draftBlock, holds: PRICING.estimateHoldsPush,
  scanBlock: QTY.scanPricingBlock, rename: EDITS.renameScan, far: UNITS.tapeFarFromScan, upsert: STORE.upsertSavedScan, seat: scanSeat,
};
const F_REAL: Record<string, string> = {};
for (const f of [...FEATURE_FILES, ...OTHER_FILES]) F_REAL[f] = existsSync(join(ROOT, f)) ? read(f) : '';
const REAL: World = { modulesDirs: existsSync(join(ROOT, 'modules')) ? readdirSync(join(ROOT, 'modules')) : [], M: REAL_MODS, F: F_REAL, outside: OUTSIDE, EN: EN_REAL as Record<string, unknown>, ES: ES_REAL as World['ES'] };

// ── helpers ─────────────────────────────────────────────────────────────────
const META = { id: 'scan-1', projectId: 'proj-1', name: 'Hall Bathroom', capturedAt: '2026-10-06T13:41:00.000Z', device: { model: 'iPhone16,1', os: '17.5' } };
const near = (a: number | null | undefined, b: number, tol = 0.01): boolean => typeof a === 'number' && Math.abs(a - b) <= tol;
const fixtureJson = (name: string): string => read(`scripts/fixtures/scan-room/${name}`);
function room(w: World, spec: RoomSpec | string, meta: Partial<typeof META> & { roomType?: RoomScan['roomType'] } = {}): { scan: RoomScan; q: ScanQuantities } {
  const json = typeof spec === 'string' ? fixtureJson(spec) : JSON.stringify(buildCapturedRoom(spec));
  const scan = w.M.build(w.M.parse(json), { ...META, ...meta });
  return { scan, q: w.M.quantities(scan) };
}
const RECT = (wM: number, dM: number, h = 2.4): RoomSpec => ({ walls: ring([{ x: 0, y: 0 }, { x: wM, y: 0 }, { x: wM, y: dM }, { x: 0, y: dM }], h) });
const AT = '2026-10-06T14:00:00.000Z';
const IN = 0.0254;

function bookWith(rows: { trade: string; unit: string; rate: number; kind: 'earned' | 'seeded' | 'mixed' | 'signed'; jobs?: number }[]): CostDatabase {
  const db = buildCostDatabase([], [], [], [], rows.map((r, i) => ({ id: `seed-${i}`, trade: r.trade, unit: r.unit, rate: r.rate })) as never);
  const entries: CostBookEntry[] = db.entries.map((e) => {
    const r = rows.find((x) => x.trade.toLowerCase() === e.trade.toLowerCase());
    if (!r || r.kind === 'seeded') return e;
    return {
      ...e,
      provenance: r.kind === 'mixed' ? 'mixed' : 'earned',
      jobCount: r.jobs ?? 1,
      seededSampleCount: r.kind === 'mixed' ? 1 : 0,
      earnedBasis: r.kind === 'signed' ? 'contracted' : 'paid',
    } as CostBookEntry;
  });
  return { ...db, entries };
}
const EMPTY_BOOK = buildCostDatabase([], [], [], [], []);
const CATALOG = makeCatalogRater('');
const NO_CATALOG = () => null;
function projectWith(est: LinkedEstimate | null): Project {
  return { id: 'proj-1', name: 'Maple St', linkedEstimate: est ?? undefined, estimateVersions: [] } as unknown as Project;
}
const EST: LinkedEstimate = {
  id: 'est-1', globalMarkup: 20, baseTotal: 1000, markupTotal: 200, grandTotal: 1200, createdAt: '2026-09-01T00:00:00.000Z',
  items: [{ materialId: 'm1', name: 'Demo', category: 'Demolition', unit: 'LS', quantity: 1, unitPrice: 1000, bulkPrice: 1000, markup: 20, usesBulk: false, lineTotal: 1200, supplier: '' }],
};
let idSeq = 0;
const newId = () => `new-${++idSeq}`;
/** What a push needs beyond the draft: an owner or editor seat, his stated markup, the clock. */
const PUSH = { mayEdit: true, markupPct: 20 as number | null, now: AT };
const OK_CTX = { mayEdit: true, markupPct: 20 as number | null };

// ── rules ───────────────────────────────────────────────────────────────────
type Rule = (w: World) => string[];
const RULES: Record<string, Rule> = {};
const rule = (id: string, fn: Rule) => { RULES[id] = fn; };
const check = (out: string[], cond: boolean, msg: string) => { if (!cond) out.push(msg); };

rule('G1 the bathroom matches the hand-worked answers', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  // 61 in by 98 in, 96 in ceiling. Door 30 by 80. Window 24 by 36.
  check(o, near(q.floorAreaSF, (61 * 98) / 144), `floor ${q.floorAreaSF} is not 41.51 sq ft`);
  check(o, near(q.ceilingAreaSF, (61 * 98) / 144), `ceiling ${q.ceilingAreaSF}`);
  check(o, near(q.perimeterLF, 26.5), `perimeter ${q.perimeterLF} is not 26.5 ft`);
  check(o, near(q.grossWallSF, 26.5 * 8), `gross wall ${q.grossWallSF} is not 212.0`);
  check(o, near(q.openingSF, (30 * 80 + 24 * 36) / 144), `openings ${q.openingSF} is not 22.67`);
  check(o, near(q.netWallSF, 212 - (30 * 80 + 24 * 36) / 144), `net wall ${q.netWallSF} is not 189.33`);
  check(o, near(q.baseboardLF, 24), `baseboard ${q.baseboardLF} is not 24.0`);
  check(o, near(q.crownLF, 26.5), `crown ${q.crownLF} is not 26.5`);
  check(o, near(q.casingLF, (2 * 80 + 30) / 12), `casing ${q.casingLF} is not 15.83`);
  check(o, q.doorCount === 1 && q.doors[0]?.widthIn === 30 && q.doors[0]?.heightIn === 80 && q.doors[0]?.nominalWidthIn === 30, 'the door is not one 30 by 80');
  check(o, q.windowCount === 1 && q.windows[0]?.widthIn === 24 && q.windows[0]?.heightIn === 36, 'the window is not one 24 by 36');
  check(o, q.fixtureCount === 3 && q.fixtures.map((f) => f.category).sort().join() === 'bathtub,sink,toilet', `fixtures are ${JSON.stringify(q.fixtures)}`);
  check(o, scan.ceilingHeightM.known && near(scan.ceilingHeightM.typical, 96 * IN, 1e-4), 'ceiling height is not 8 ft');
  check(o, scan.closure.closed && scan.walls.length === 4 && scan.walls.every((x) => x.onOutline), 'the four walls do not form the outline');
  check(o, scan.suggestedRoomType === 'bathroom' && scan.roomType === 'bathroom', 'the iOS 17 section did not suggest a bathroom');
  check(o, q.flags.length === 0, `unexpected flags ${q.flags.join()}`);
  return o;
});

rule('G2 the L-shaped room matches the hand-worked answers (iOS 16 file, no parent ids)', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'l-shape.json');
  const SF = 10.7639;
  const FT = 3.28084;
  check(o, near(q.floorAreaSF, 25 * SF, 0.02), `floor ${q.floorAreaSF} is not 269.10`);
  check(o, near(q.perimeterLF, 22 * FT, 0.01), `perimeter ${q.perimeterLF} is not 72.18`);
  check(o, near(q.grossWallSF, 59.4 * SF, 0.05), `gross ${q.grossWallSF} is not 639.38`);
  check(o, near(q.openingSF, 7.53 * SF, 0.02), `openings ${q.openingSF} is not 81.05`);
  check(o, near(q.netWallSF, 51.87 * SF, 0.05), `net ${q.netWallSF} is not 558.32`);
  check(o, near(q.baseboardLF, 19.9 * FT, 0.01), `baseboard ${q.baseboardLF} is not 65.29 (less the door and the cased opening)`);
  check(o, near(q.crownLF, 20.8 * FT, 0.01), `crown ${q.crownLF} is not 68.24 (less the full-height opening only)`);
  check(o, scan.walls.length === 6 && scan.closure.closed, 'six walls, closed');
  check(o, scan.openings.length === 4 && scan.openings.every((x) => x.wallId), 'an opening found no wall');
  check(o, q.windowCount === 2 && q.windows.length === 1 && q.windows[0].count === 2, 'two windows of one size');
  check(o, q.fixtureCount === 0, 'a sofa or a table was counted as a fixture');
  check(o, scan.suggestedRoomType === null && scan.roomType === 'room', 'a room type was invented');
  return o;
});

rule('G3 a missing wall: open outline, no floor area, said in facts', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'missing-wall.json');
  check(o, scan.closure.closed === false && scan.closure.cause === 'scan', 'the outline closed');
  check(o, q.floorAreaSF === null && q.ceilingAreaSF === null, `an open outline reported a floor area (${q.floorAreaSF})`);
  check(o, scan.floor.length === 0, 'an open outline kept a floor polygon');
  check(o, scan.closure.gaps === 1 && near(scan.closure.gapM, 3.0, 0.05), `gap ${scan.closure.gapM}`);
  check(o, q.flags.includes('not_closed'), 'no not_closed flag');
  const facts = w.M.facts(scan, q);
  const wf = facts.find((f) => f.kind === 'walls_found');
  check(o, !!wf && wf.found === 3 && wf.needed === 4 && wf.tone === 'check', `walls found reads ${wf?.found} of ${wf?.needed}`);
  const open = facts.find((f) => f.kind === 'outline_open');
  check(o, !!open && (open.wallLabels ?? []).length === 2, 'the open outline does not name the two walls to check');
  check(o, facts.every((f) => !('percent' in f) && !('score' in f)), 'a fact carries a score');
  check(o, w.M.pricingBlock(q) === 'not_closed', 'an open outline can be priced');
  check(o, q.grossWallSF != null && q.perimeterLF > 0, 'the walls that were found lost their area');
  return o;
});

rule('G4 the plan is not mirrored', (w) => {
  const o: string[] = [];
  const { scan } = room(w, { ...lShapeSpec(), rotateDeg: 0, shift: { x: 0, y: 0 } });
  const has = (x: number, y: number) => scan.floor.some((p) => Math.abs(p.x - x) < 1e-3 && Math.abs(p.y - y) < 1e-3);
  check(o, has(3.5, 5) && has(6, 3) && has(0, 5), `the L's corners are not where they were drawn: ${JSON.stringify(scan.floor.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]))}`);
  check(o, GEO.signedArea(scan.floor) > 0, 'the floor polygon is not counter-clockwise');
  return o;
});

rule('G5 the answer does not depend on rotation or wall order', (w) => {
  const o: string[] = [];
  const base = RECT(3, 4);
  const variants: RoomSpec[] = [
    base,
    { ...base, rotateDeg: 37, shift: { x: 5, y: -2 } },
    { ...base, rotateDeg: 90 },
    { ...base, rotateDeg: 213, walls: [base.walls[2], base.walls[0], base.walls[3], base.walls[1]] },
    { ...base, walls: base.walls.map((x, i) => (i % 2 ? { ...x, a: x.b, b: x.a } : x)) },
  ];
  variants.forEach((v, i) => {
    const { scan, q } = room(w, v);
    check(o, near((q.floorAreaSF ?? 0) / 10.7639, 12, 1e-3), `variant ${i}: floor ${(q.floorAreaSF ?? 0) / 10.7639} m2 is not 12.000`);
    check(o, near(q.perimeterLF / 3.28084, 14, 1e-3), `variant ${i}: perimeter is not 14.000 m`);
    check(o, scan.closure.closed, `variant ${i}: did not close`);
  });
  return o;
});

rule('G6 a small miss closes, a large one does not', (w) => {
  const o: string[] = [];
  const small = RECT(3, 4);
  small.walls = small.walls.map((x) => ({ ...x, shortA: 0.02, shortB: 0.02 }));
  const s = room(w, small);
  check(o, s.scan.closure.closed, 'walls that stop 2 cm short of each corner did not close');
  check(o, near((s.q.floorAreaSF ?? 0) / 10.7639, 12, 0.02), `the corners were not pulled to where the walls cross: ${(s.q.floorAreaSF ?? 0) / 10.7639}`);
  check(o, s.scan.closure.gapM > 0.02 && s.scan.closure.gapM < 0.06, `the gap that was closed is ${s.scan.closure.gapM}`);
  const big = RECT(3, 4);
  big.walls = big.walls.map((x, i) => (i === 1 ? { ...x, shortB: 0.4 } : x));
  const b = room(w, big);
  check(o, b.scan.closure.closed === false && b.q.floorAreaSF === null, 'a 40 cm gap was closed and given a floor area');
  return o;
});

rule('G7 slanted and missing ceilings are said, not guessed', (w) => {
  const o: string[] = [];
  const slant = RECT(3, 4, 2.4);
  // One wall rises from 2.4 m to 3.0 m (a trapezoid in the wall's own plane).
  slant.walls[0] = { ...slant.walls[0], height: 3.0, polygonCorners: [[-1.5, -1.5, 0], [1.5, -1.5, 0], [1.5, 1.5, 0], [-1.5, 0.9, 0]] };
  const s = room(w, slant);
  check(o, s.q.flags.includes('ceiling_varies'), 'a slanted wall did not raise ceiling_varies');
  check(o, near(s.scan.ceilingHeightM.min, 2.4, 1e-3) && near(s.scan.ceilingHeightM.max, 3.0, 1e-3), `ceiling range ${s.scan.ceilingHeightM.min} to ${s.scan.ceilingHeightM.max}`);
  const expectGross = (3 * (2.4 + 3.0) / 2 + (4 + 3 + 4) * 2.4) * 10.7639;
  check(o, near(s.q.grossWallSF, expectGross, 0.05), `gross ${s.q.grossWallSF} did not use the slanted wall's own shape (${expectGross})`);
  const none = room(w, { ...RECT(3, 4), noHeights: true });
  check(o, none.scan.ceilingHeightM.known === false, 'a ceiling height was invented');
  check(o, none.q.grossWallSF === null && none.q.netWallSF === null, `wall area ${none.q.grossWallSF} was reported with no ceiling height`);
  check(o, none.q.flags.includes('ceiling_height_missing') && w.M.pricingBlock(none.q) === 'ceiling_height_missing', 'a missing ceiling height does not block pricing');
  const typed = w.M.ceiling(none.scan, 2.5, AT);
  const tq = w.M.quantities(typed);
  check(o, near(tq.grossWallSF, 14 * 2.5 * 10.7639, 0.05) && typed.ceilingHeightM.source === 'typed', 'typing the ceiling height did not give the wall area');
  return o;
});

rule('G8 a curved wall and an oversize room are flagged', (w) => {
  const o: string[] = [];
  const curved = RECT(3, 4);
  curved.walls[2] = { ...curved.walls[2], curveRadius: 2.2 };
  const c = room(w, curved);
  check(o, c.q.flags.includes('curved_wall') && w.M.facts(c.scan, c.q).some((f) => f.kind === 'curved'), 'a curved wall was not flagged');
  const big = room(w, RECT(31 / 3.28084, 4));
  check(o, big.q.flags.includes('over_size_limit'), 'a 31 ft room was not flagged');
  const ok = room(w, { ...RECT(29 / 3.28084, 4), rotateDeg: 45 });
  check(o, !ok.q.flags.includes('over_size_limit'), 'a 29 ft room turned 45 degrees was flagged');
  return o;
});

rule('G9 a wall the scan was unsure of must be typed before pricing', (w) => {
  const o: string[] = [];
  const spec = RECT(3, 4);
  spec.walls[1] = { ...spec.walls[1], confidence: 'low' };
  const r = room(w, spec);
  check(o, r.q.flags.includes('low_confidence_wall'), 'no low_confidence_wall flag');
  check(o, w.M.pricingBlock(r.q) === 'low_confidence_wall', 'a low-confidence wall does not block pricing');
  const low = r.scan.walls.find((x) => x.confidence === 'low');
  const fixed = low ? w.M.wall(r.scan, low.id, low.lengthM, AT) : r.scan;
  check(o, w.M.pricingBlock(w.M.quantities(fixed)) === null, 'typing the wall (even the same number) does not clear the block');
  check(o, fixed.edits.length === 1, 'confirming a wall was not recorded');
  return o;
});

rule('Q1 openings are subtracted exactly once', (w) => {
  const o: string[] = [];
  for (const f of ['bathroom.json', 'l-shape.json']) {
    const { scan, q } = room(w, f);
    const area = scan.openings.reduce((s, x) => s + x.widthM * x.heightM, 0) * 10.7639;
    check(o, near((q.grossWallSF ?? 0) - (q.netWallSF ?? 0), area, 0.01), `${f}: gross less net is ${(q.grossWallSF ?? 0) - (q.netWallSF ?? 0)}, the openings are ${area}`);
    const doubled = w.M.quantities({ ...scan, openings: [...scan.openings, ...scan.openings] });
    check(o, near(doubled.netWallSF, q.netWallSF ?? -1, 0.01) && doubled.doorCount === q.doorCount, `${f}: the same opening listed twice was subtracted twice`);
    const none = w.M.quantities({ ...scan, openings: [] });
    check(o, near(none.netWallSF, none.grossWallSF ?? -1, 1e-6), `${f}: with no openings, net is not gross`);
  }
  return o;
});

rule('Q2 baseboard loses doors and floor openings only; crown loses full-height openings only', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  check(o, near(q.perimeterLF - q.baseboardLF, 30 / 12, 0.005), `baseboard lost ${q.perimeterLF - q.baseboardLF} ft, the door is 2.5 ft`);
  check(o, near(q.crownLF, q.perimeterLF, 1e-6), 'crown lost a door or a window');
  const noWindow = w.M.quantities({ ...scan, openings: scan.openings.filter((x) => x.kind !== 'window') });
  check(o, near(noWindow.baseboardLF, q.baseboardLF, 1e-6), 'a window changed the baseboard');
  return o;
});

rule('Q3 an opening is clipped to its wall', (w) => {
  const o: string[] = [];
  const spec = RECT(3, 4);
  // A 0.9 m door centred 0.15 m from the corner: 0.3 m of it hangs past the wall end.
  spec.openings = [{ kind: 'door', wall: 0, at: 0.15, width: 0.9, height: 2.0, sill: 0 }];
  const { q } = room(w, spec);
  check(o, near(q.openingSF, 0.6 * 2.0 * 10.7639, 0.02), `opening area ${q.openingSF} is not the 0.6 m that is on the wall`);
  check(o, near(q.perimeterLF - q.baseboardLF, 0.6 * 3.28084, 0.01), 'baseboard lost more than the part of the door on the wall');
  return o;
});

rule('Q4 quantities carry no waste; pricing adds it once', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  check(o, near(q.floorAreaSF, GEO.polygonArea(scan.floor) * 10.7639, 1e-6), 'the floor quantity is not the polygon area');
  const d = w.M.draft(scan, q, EMPTY_BOOK, CATALOG);
  const floor = d.lines.find((l) => l.key === 'floor_tile');
  // 41.51 sq ft plus 10 percent is 45.67, which the takeoff rounds to 46. Twice would be 50.
  check(o, !!floor && floor.wastePct === 10 && floor.quantity === 46, `the tile line prices ${floor?.quantity} sq ft, not 46`);
  check(o, !!floor && near(floor.netQuantity, 41.5139, 0.01), 'the line lost the scan quantity before waste');
  const door = d.lines.find((l) => l.key === 'door');
  check(o, !!door && door.quantity === 1, 'a count got waste');
  return o;
});

rule('U1 feet and inches round once; a typed measurement reads', (w) => {
  const o: string[] = [];
  const fi = w.M.feetInches;
  check(o, fi(61 * IN) === '5 ft 1 in', `61 in reads "${fi(61 * IN)}"`);
  check(o, fi(98 * IN) === '8 ft 2 in', `98 in reads "${fi(98 * IN)}"`);
  check(o, fi(96 * IN) === '8 ft 0 in', `96 in reads "${fi(96 * IN)}"`);
  check(o, fi(23.6 * IN) === '2 ft 0 in', `23.6 in reads "${fi(23.6 * IN)}" (must carry to the next foot)`);
  check(o, UNITS.formatSqFt(41.5139) === '41.5 sq ft' && UNITS.formatRunFt(24) === '24.0 ft', 'area or run formatting');
  check(o, UNITS.formatSizeIn(30, 80) === '2 ft 6 in by 6 ft 8 in', 'door size formatting');
  const pt = w.M.parseTape;
  const inches = (s: string) => { const m = pt(s); return m == null ? null : Math.round((m / IN) * 100) / 100; };
  for (const [text, want] of [['8 ft 2 in', 98], ["8' 2\"", 98], ['8 2', 98], ['8-2', 98], ['8ft', 96], ['98 in', 98], ['98"', 98], ['8.5', 102], ['8 2 1/2', 98.5], ["5' 1\"", 61]] as [string, number][]) {
    check(o, inches(text) === want, `"${text}" reads ${inches(text)} in, not ${want}`);
  }
  for (const bad of ['', 'about eight', '8 13', '0', '-4', '900', '8 ft 12 in']) check(o, pt(bad) === null, `"${bad}" was read as a length`);
  const back = pt(fi(2.4892));
  check(o, back != null && Math.abs(back - 2.4892) < 0.0005, 'feet and inches do not round trip');
  check(o, w.M.nominal(29.6) === 30 && w.M.nominal(30) === 30 && w.M.nominal(35.4) === 36, 'a door within an inch did not snap');
  check(o, w.M.nominal(31) === null && w.M.nominal(40) === null, 'a 31 in door snapped');
  return o;
});

rule('P1 the parser reads other encodings of the same room, and ignores what it does not know', (w) => {
  const o: string[] = [];
  const src = buildCapturedRoom(bathroomSpec());
  const want = JSON.stringify(room(w, 'bathroom.json').q);
  const remap = (fn: (s: Record<string, unknown>) => Record<string, unknown>) => {
    const copy = JSON.parse(JSON.stringify(src)) as Record<string, unknown[]>;
    for (const k of ['walls', 'doors', 'windows', 'openings', 'objects']) copy[k] = (copy[k] as Record<string, unknown>[]).map(fn);
    return JSON.stringify(copy);
  };
  const q = (json: string) => JSON.stringify(w.M.quantities(w.M.build(w.M.parse(json), META)));
  const strings = remap((s) => ({ ...s, category: Object.keys(s.category as object)[0], confidence: Object.keys(s.confidence as object)[0] }));
  check(o, q(strings) === want, 'enum values written as plain strings changed the room');
  const nested = remap((s) => { const t = s.transform as number[]; return { ...s, transform: [t.slice(0, 4), t.slice(4, 8), t.slice(8, 12), t.slice(12, 16)] }; });
  check(o, q(nested) === want, 'a transform written as four columns changed the room');
  const dims = remap((s) => { const d = s.dimensions as number[]; return { ...s, dimensions: { x: d[0], y: d[1], z: d[2] }, somethingNew: { a: 1 } }; });
  check(o, q(dims) === want, 'dimensions written as x, y, z (and an unknown key) changed the room');
  const bare = JSON.parse(JSON.stringify(src)) as Record<string, unknown>;
  for (const k of ['version', 'story', 'floors', 'sections', 'referenceOriginTransform', 'doors', 'windows', 'openings', 'objects']) delete bare[k];
  let threw = false;
  try { w.M.build(w.M.parse(JSON.stringify(bare)), META); } catch { threw = true; }
  check(o, !threw, 'a room with only walls threw');
  return o;
});

rule('P2 a wall that cannot be placed is a typed error, never a guess', (w) => {
  const o: string[] = [];
  const code = (json: string): string => {
    try { w.M.build(w.M.parse(json), META); return 'no error'; }
    catch (e) { return e instanceof RoomScanParseError ? e.code : `untyped ${String(e)}`; }
  };
  const src = () => JSON.parse(JSON.stringify(buildCapturedRoom(bathroomSpec()))) as { walls: Record<string, unknown>[]; doors: Record<string, unknown>[] };
  const a = src(); a.walls[1].transform = [1, 0, 0];
  check(o, code(JSON.stringify(a)) === 'bad_transform', `a 3-number wall transform gave "${code(JSON.stringify(a))}"`);
  const b = src(); b.walls[0].transform = new Array(16).fill(0);
  check(o, code(JSON.stringify(b)) === 'bad_transform', 'an all-zero wall transform was accepted');
  const c = src(); c.walls[0].dimensions = [0, 2.4, 0];
  check(o, code(JSON.stringify(c)) === 'bad_dimensions', 'a wall with no width was accepted');
  check(o, code('{not json') === 'not_json', 'bad JSON is not a typed error');
  check(o, code('{"walls":[]}') === 'no_walls', 'a room with no walls is not a typed error');
  check(o, code('[1,2]') === 'not_a_room' && code('{"doors":[]}') === 'not_a_room', 'something that is not a room is not a typed error');
  const d = src(); d.doors[0].transform = 'oops';
  let scan: RoomScan | null = null;
  try { scan = w.M.build(w.M.parse(JSON.stringify(d)), META); } catch { /* reported below */ }
  check(o, !!scan && scan.openings.every((x) => x.kind !== 'door') && scan.warnings.some((n) => /door 1/.test(n)), 'a door that cannot be read was not dropped with a note');
  return o;
});

rule('P3 the fixtures are the hand-built ones, and the code says a real export is still owed', (w) => {
  const o: string[] = [];
  for (const [name, spec] of Object.entries(FIXTURE_FILES)) {
    check(o, fixtureJson(name) === JSON.stringify(buildCapturedRoom(spec()), null, 1) + '\n', `${name} no longer equals what builder.ts writes (run scripts/fixtures/scan-room/make-fixtures.ts)`);
  }
  check(o, /has NOT been run against a\s+\/\/ real export/.test(w.F['utils/roomScan/capturedRoomParser.ts']) || /NOT been run against a[\s\S]{0,12}real export/.test(w.F['utils/roomScan/capturedRoomParser.ts']), 'the parser no longer says it has not read a real export');
  check(o, /NOT FROM A PHONE/.test(w.F['scripts/fixtures/scan-room/builder.ts']), 'the fixture builder no longer says its rooms are not from a phone');
  check(o, /real export/i.test(w.F['docs/scan-the-room-native-checklist.md']), 'the checklist does not ask for a real export');
  return o;
});

rule('E1 a typed measurement recomputes the quantities', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  const short = scan.walls.find((x) => near(x.lengthM, 61 * IN, 1e-3));
  if (!short) return ['no 5 ft 1 in wall'];
  const next = w.M.wall(scan, short.id, 62 * IN, AT);
  const nq = w.M.quantities(next);
  check(o, near(nq.floorAreaSF, (62 * 98) / 144), `floor is ${nq.floorAreaSF} after typing 5 ft 2 in, not 42.19`);
  check(o, near(nq.perimeterLF, (2 * (62 + 98)) / 12), `perimeter is ${nq.perimeterLF}, not 26.67`);
  check(o, near(nq.grossWallSF, ((2 * (62 + 98)) / 12) * 8), 'wall area did not follow');
  check(o, next.closure.closed, 'the outline opened');
  check(o, near(q.floorAreaSF, (61 * 98) / 144) && near(w.M.quantities(scan).floorAreaSF, (61 * 98) / 144), 'the scan that was corrected was changed in place');
  const door = scan.openings.find((x) => x.kind === 'door');
  const od = door ? w.M.opening(scan, door.id, 'widthM', 32 * IN, AT) : scan;
  const oq = w.M.quantities(od);
  check(o, near(oq.baseboardLF, 26.5 - 32 / 12) && near(oq.openingSF, (32 * 80 + 24 * 36) / 144), 'a typed door width did not change baseboard and openings');
  const cq = w.M.quantities(w.M.ceiling(scan, 108 * IN, AT));
  check(o, near(cq.grossWallSF, 26.5 * 9), 'a typed ceiling height did not change the wall area');
  return o;
});

rule('E2 a correction is recorded and marked typed by hand', (w) => {
  const o: string[] = [];
  const { scan } = room(w, 'bathroom.json');
  const short = scan.walls.find((x) => near(x.lengthM, 61 * IN, 1e-3));
  if (!short) return ['no 5 ft 1 in wall'];
  const next = w.M.wall(scan, short.id, 62 * IN, AT);
  const e = next.edits[0];
  check(o, next.edits.length === 1 && !!e, 'no edit was recorded');
  check(o, !!e && e.by === 'typed' && e.target === `wall:${short.id}` && e.field === 'lengthM' && near(e.from, 61 * IN, 1e-4) && near(e.to, 62 * IN, 1e-9) && e.at === AT, `the edit is ${JSON.stringify(e)}`);
  const wall = next.walls.find((x) => x.id === short.id);
  check(o, wall?.lengthSource === 'typed', 'the wall is not marked typed');
  check(o, next.walls.filter((x) => x.lengthSource === 'adjusted').length === 1 && next.walls.filter((x) => x.lengthSource === 'scan').length === 2, 'exactly one opposite wall should be marked adjusted, and the other two left as scanned');
  check(o, near(wall?.scanLengthM, 61 * IN, 1e-3), "the scan's own number was not kept");
  const facts = w.M.facts(next, w.M.quantities(next));
  check(o, facts.some((f) => f.kind === 'typed_by_hand' && f.count === 1) && facts.some((f) => f.kind === 'adjusted'), 'the facts do not say a number was typed and a wall was moved');
  check(o, scan.edits.length === 0 && scan.walls.every((x) => x.lengthSource === 'scan'), 'the original scan was mutated');
  const c = w.M.ceiling(scan, 2.5, AT);
  check(o, c.edits.length === 1 && c.edits[0].target === 'ceiling' && c.edits[0].by === 'typed' && c.ceilingHeightM.source === 'typed', 'a typed ceiling height is not recorded or marked');
  const door = scan.openings.find((x) => x.kind === 'door');
  const d = door ? w.M.opening(scan, door.id, 'heightM', 2.1, AT) : scan;
  check(o, d.edits.length === 1 && d.openings.find((x) => x.kind === 'door')?.heightSource === 'typed', 'a typed door height is not recorded or marked');
  check(o, w.M.wall(scan, short.id, Number.NaN, AT) === scan && w.M.wall(scan, short.id, -1, AT) === scan && w.M.wall(scan, 'nope', 2, AT) === scan, 'an unusable value changed the scan');
  return o;
});

rule('E3 typed lengths that do not close are refused a floor area', (w) => {
  const o: string[] = [];
  const { scan } = room(w, 'bathroom.json');
  const shorts = scan.walls.filter((x) => near(x.lengthM, 61 * IN, 1e-3));
  if (shorts.length !== 2) return ['expected two 5 ft 1 in walls'];
  let next = w.M.wall(scan, shorts[0].id, 62 * IN, AT);
  next = w.M.wall(next, shorts[1].id, 70 * IN, AT);
  const q = w.M.quantities(next);
  check(o, next.closure.closed === false && next.closure.cause === 'typed', 'two opposite walls typed 8 in apart still closed');
  check(o, q.floorAreaSF === null && q.flags.includes('typed_lengths_do_not_close'), `a floor area (${q.floorAreaSF}) was reported from typed lengths that do not close`);
  check(o, w.M.pricingBlock(q) === 'typed_lengths_do_not_close', 'it can still be priced');
  check(o, w.M.facts(next, q).some((f) => f.kind === 'typed_open'), 'the facts do not say so');
  const fixed = w.M.wall(next, shorts[1].id, 62 * IN, AT);
  check(o, fixed.closure.closed && near(w.M.quantities(fixed).floorAreaSF, (62 * 98) / 144), 'typing matching lengths did not close it again');
  return o;
});

rule('E4 a tape check is kept beside the scan and never changes it', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  const next = w.M.tape(scan, scan.walls[0].id, scan.walls[0].lengthM * 1.05, AT);
  check(o, next.tapeChecks.length === 1 && near(next.tapeChecks[0].scanM, scan.walls[0].scanLengthM, 1e-9), 'the tape check was not kept');
  check(o, JSON.stringify(w.M.quantities(next)) === JSON.stringify(q) && next.edits.length === 0, 'a tape check changed the quantities (the scan must never be scaled to a tape)');
  return o;
});

const OWN_BOOK = () => bookWith([
  { trade: 'Tile', unit: 'SF', rate: 18.5, kind: 'earned', jobs: 6 },
  { trade: 'Drywall', unit: 'SF', rate: 4.2, kind: 'signed', jobs: 2 },
  { trade: 'Painting', unit: 'SF', rate: 2.1, kind: 'seeded' },
  { trade: 'Interior Door', unit: 'EA', rate: 420, kind: 'mixed', jobs: 4 },
  { trade: 'Plumbing', unit: 'EA', rate: 50, kind: 'earned', jobs: 9 },
]);

rule('R1 every priced line names where its price came from, and never claims more', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  const d = w.M.draft(scan, q, OWN_BOOK(), CATALOG);
  const by = (k: string) => d.lines.find((l) => l.key === k);
  for (const l of d.lines) {
    if (l.amountCents != null) check(o, l.source === 'yours' || l.source === 'engine' || l.source === 'manual', `${l.key} has a price and no source`);
    else check(o, l.source === null && l.rate === null, `${l.key} has no price but says "${l.source}"`);
    check(o, l.amountCents !== 0, `${l.key} is priced at $0`);
    if (l.source === 'yours') check(o, !!l.claim, `${l.key} says it is his price and cannot say why`);
    else check(o, l.claim === null, `${l.key} is not his price and carries a claim`);
  }
  const tile = by('floor_tile');
  check(o, tile?.source === 'yours' && tile.claim?.tone === 'measured' && tile.claim.jobCount === 6 && tile.rate === 18.5, `tile: ${tile?.source}, ${JSON.stringify(tile?.claim)}`);
  check(o, tile?.amountCents === 46 * 1850, `tile amount ${tile?.amountCents}`);
  const dry = by('wall_drywall');
  check(o, dry?.source === 'yours' && dry.claim?.tone === 'contracted' && dry.claim.jobCount === 2, 'a signed, unpaid rate is called measured');
  const paint = by('wall_paint');
  check(o, paint?.source === 'yours' && paint.claim?.provenance === 'seeded' && paint.claim.jobCount === 0 && paint.claim.tone !== 'measured', 'a rate he only set is given past jobs');
  const door = by('door');
  check(o, door?.source === 'yours' && door.claim?.provenance === 'mixed' && door.claim.tone !== 'measured', 'a mixed rate is called measured');
  const toilet = by('toilet');
  check(o, toilet?.source === 'engine' && toilet.claim === null && toilet.rate !== 50, `the toilet borrowed the "Plumbing, each" rate: ${toilet?.source} at ${toilet?.rate}`);
  const base = by('baseboard');
  check(o, !!base && base.source === null && base.amountCents === null, 'baseboard has no price of his and none in the catalog, yet it is priced');
  const none = w.M.draft(scan, q, EMPTY_BOOK, NO_CATALOG);
  check(o, none.lines.length > 0 && none.lines.every((l) => l.source === null && l.amountCents === null) && none.totalCents === 0 && none.pricedCount === 0, 'with no book and no catalog something was still priced');
  const manual = w.M.draft(scan, q, OWN_BOOK(), CATALOG, { manualRates: { baseboard: 7.5, floor_tile: 20 } });
  check(o, manual.lines.find((l) => l.key === 'baseboard')?.source === 'manual' && manual.lines.find((l) => l.key === 'floor_tile')?.source === 'manual', 'a typed price is not labelled as typed');
  check(o, d.ownCount === 5 && d.catalogCount === 2 && d.ownCount + d.catalogCount + d.manualCount === d.pricedCount, `counts: own ${d.ownCount}, catalog ${d.catalogCount}, priced ${d.pricedCount}`);
  return o;
});

rule('R2 the draft is the existing takeoff path, to the cent', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  const db = OWN_BOOK();
  const d = w.M.draft(scan, q, db, CATALOG);
  for (const l of d.lines) {
    const p = priceCondition(db, l.row.condition, l.row.totals.billable);
    check(o, p.amountCents === l.amountCents && p.qty === l.quantity && p.rate === l.rate, `${l.key}: the line is not what priceCondition gives`);
  }
  const lines = pushLinesFrom(d.lines.filter((l) => l.included).map((l) => l.row)).lines;
  check(o, JSON.stringify(PRICING.draftPushLines(d)) === JSON.stringify(lines), 'the push lines are not pushLinesFrom of the rows');
  idSeq = 0;
  const viaHouse = applyTakeoffPush(EST, lines, {}, newId);
  const housePatch = commitEstimatePatch(projectWith(EST), viaHouse.next, { reason: 'pre_overwrite' });
  idSeq = 0;
  const mine = w.M.patch({ ...PUSH, confirmed: true, project: projectWith(EST), draft: d, pushed: {}, newId });
  check(o, !!mine && JSON.stringify(mine.next) === JSON.stringify(viaHouse.next), 'the estimate is not what applyTakeoffPush gives');
  check(o, !!mine && JSON.stringify(mine.patch.linkedEstimate) === JSON.stringify(housePatch.linkedEstimate) && (mine.patch.estimateVersions ?? []).length === 1, 'the patch is not commitEstimatePatch, or the old estimate was not kept in its history');
  if (mine) {
    const sum = mine.next.items.reduce((s, it) => s + it.lineTotal, 0);
    check(o, Math.abs(sum - mine.next.grandTotal) < 0.005, 'the line totals no longer foot to the grand total');
    check(o, mine.next.items.filter((it) => it.priceSource === 'learned').length === 3 && mine.next.items.some((it) => it.priceSource === 'seeded'), 'estimate lines lost where their price came from');
    const cat = mine.next.items.find((it) => /Toilet/.test(it.name));
    check(o, !!cat && cat.priceSource === undefined, 'a catalog-priced line was stamped as learned on the estimate');
  }
  const src = stripComments(w.F['utils/roomScan/pricingCore.ts']);
  for (const fn of ['priceCondition', 'pushLinesFrom', 'applyTakeoffPush', 'commitEstimatePatch', 'provenanceClaimModel', 'matchOwnRate', 'buildNewEstimate']) {
    check(o, new RegExp(`\\b${fn}\\(`).test(src), `pricingCore no longer calls ${fn}`);
  }
  check(o, !/roundCents|lineTotal\s*[:=]|markup\s*\/\s*100|\.items\.push/.test(src), 'pricingCore does estimate arithmetic of its own');
  return o;
});

rule('R3 nothing is built or saved without the person confirming', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  const d = w.M.draft(scan, q, OWN_BOOK(), CATALOG);
  const args = { ...PUSH, project: projectWith(EST), draft: d, pushed: {}, newId };
  check(o, w.M.patch({ ...args, confirmed: false }) === null, 'a patch was built with confirmed false');
  check(o, w.M.patch({ ...args, confirmed: 'yes' as unknown as boolean }) === null && w.M.patch({ ...args, confirmed: 1 as unknown as boolean }) === null, 'a patch was built with something other than true');
  check(o, w.M.patch({ ...args, confirmed: true }) !== null, 'a confirmed draft built nothing');
  check(o, w.M.patch({ ...args, confirmed: true, markupPct: null, project: projectWith(null) }) === null && w.M.draftBlock(projectWith(null), d, { mayEdit: true, markupPct: null }) === 'no_markup', 'a project with no estimate was given one at a markup he never chose');
  check(o, w.M.patch({ ...args, confirmed: false, project: projectWith(null) }) === null, 'an estimate was started without the yes');
  check(o, w.M.patch({ ...args, confirmed: true, project: null }) === null, 'a patch was built with no project');

  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  const body = (name: string): string => {
    const i = flow.indexOf(`const ${name} = useCallback(`);
    if (i < 0) return '';
    const j = flow.indexOf('\n  }, [', i);
    return flow.slice(i, j < 0 ? undefined : j);
  };
  const confirm = body('confirmDraft');
  const save = body('save');
  const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;
  // Two ways into the estimate, each from its own confirm sheet: the priced
  // draft (confirmDraft, the literal true) and the order list's material lines
  // (sendOrder, which is handed the confirm sheet's own `true` and refuses
  // first through orderListCore.confirmOrderSend; scripts/validate-scan-order.ts
  // rule O13 pins that side).
  const order = body('sendOrder');
  check(o, count(/buildEstimatePatch\(/g, flow) === 2 && /buildEstimatePatch\(\{\s*confirmed: true, mayEdit: mayEditEstimate,/.test(confirm) && /buildEstimatePatch\(\{\s*confirmed, mayEdit: mayEditEstimate, project, draft: orderDraft,/.test(order), 'buildEstimatePatch is not called exactly twice: inside confirmDraft with confirmed: true, and inside sendOrder with the confirm sheet\'s own value, each with the seat it was handed');
  check(o, count(/updateProject\(/g, flow) === 2 && confirm.indexOf('updateProject(') > confirm.indexOf('buildEstimatePatch(') && order.indexOf('updateProject(') > order.indexOf('buildEstimatePatch(') && order.indexOf('buildEstimatePatch(') > order.indexOf('if (!snap)') && order.indexOf('if (!snap)') > 0, 'updateProject is not called exactly once in confirmDraft and once in sendOrder, each after its patch is built');
  check(o, count(/\bsaveScan\(/g, flow) === 3 && /saveScan\(/.test(save) && /saveScan\(/.test(confirm) && order.indexOf('saveScan(') > order.indexOf('updateProject('), 'saveScan is called somewhere other than the Save tap, the confirmed draft and the confirmed order list');
  check(o, count(/sendOrder\(/g, flow) === 1 && /onSend=\{\(via, confirmed\) => void sendOrder\(via, confirmed\)\}/.test(flow), 'sendOrder is reachable from somewhere other than the order list\'s onSend');
  for (const m of flow.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/g)) {
    check(o, !/saveScan|updateProject|buildEstimatePatch|confirmDraft|sendOrder|recordTapePairs|keepTape|\bsave\(|startScan/.test(m[1]), 'an effect saves, prices, sends or starts a scan by itself');
  }
  check(o, count(/confirmDraft\(\)/g, flow) === 1 && /onConfirm=\{\(\) => void confirmDraft\(\)\}/.test(flow), 'confirmDraft is reachable from somewhere other than the draft view\'s onConfirm');
  check(o, count(/void save\(\)/g, flow) === 1 && /onSave=\{\(\) => void save\(\)\}/.test(flow), 'save is reachable from somewhere other than the Save Scan button');
  const view = stripComments(w.F['components/roomScan/PricedDraftView.tsx']);
  check(o, count(/p\.onConfirm\(\)/g, view) === 1 && /primaryAction=\{\{ label: p\.starting \? copy\.startYesLabel : copy\.confirmYesLabel, onPress: \(\) => \{ setConfirming\(false\); p\.onConfirm\(\); \}/.test(view), 'onConfirm is not called only by the confirm sheet\'s yes button');
  check(o, /testID="scan-open-estimate"/.test(view) && /onPress=\{\(\) => setConfirming\(true\)\} disabled=\{p\.block != null \|\| p\.busy\}[^>]*testID="scan-open-estimate"/.test(view), 'Open In Estimate does something other than open the confirm sheet');
  for (const f of FEATURE_FILES) {
    const s = stripComments(w.F[f]);
    check(o, !/@\/lib\/supabase|supabase\.from\(|\.functions\.invoke\(|\bfetch\(|offlineQueue|sendEmail|Sharing\./.test(s), `${f} talks to a server or shares something`);
  }
  return o;
});

rule('R4 the total is the included, priced lines; a second pricing updates in place', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  const db = OWN_BOOK();
  const d = w.M.draft(scan, q, db, CATALOG);
  const sum = d.lines.filter((l) => l.included && l.amountCents != null).reduce((s, l) => s + (l.amountCents as number), 0);
  check(o, d.totalCents === sum && d.totalCents > 0, `total ${d.totalCents} is not the sum ${sum}`);
  const less = w.M.draft(scan, q, db, CATALOG, { excluded: ['floor_tile'] });
  const tile = d.lines.find((l) => l.key === 'floor_tile');
  check(o, less.totalCents === d.totalCents - (tile?.amountCents ?? 0), 'a line left out is still in the total');
  check(o, !PRICING.draftPushLines(less).some((l) => l.conditionId.endsWith(':floor_tile')), 'a line left out would still be pushed');
  check(o, PRICING.draftPushLines(d).length === d.pricedCount && d.unpricedCount === d.lines.length - d.pricedCount, 'a line with no price would be pushed');
  idSeq = 0;
  const first = w.M.patch({ ...PUSH, confirmed: true, project: projectWith(EST), draft: d, pushed: {}, newId });
  if (!first) return [...o, 'no first patch'];
  const second = w.M.patch({ ...PUSH, confirmed: true, project: projectWith(first.next), draft: d, pushed: first.pushed, newId });
  check(o, !!second && second.added === 0 && second.next.items.length === first.next.items.length && Math.abs(second.afterGrand - first.afterGrand) < 0.005, 'pricing the same scan twice added the lines twice');
  return o;
});

// ── the review round: what an independent read of the lane found ─────────────
const bodyOf = (src: string, name: string): string => {
  const i = src.indexOf(`const ${name} = useCallback(`);
  if (i < 0) return '';
  const j = src.indexOf('\n  }, [', i);
  return src.slice(i, j < 0 ? undefined : j);
};
const recipeOf = (rt: RoomScan['roomType'], key: RecipeKey): RecipeLine => ROOM_RECIPES[rt].find((r) => r.key === key) as RecipeLine;

/** His trades that share ONE word with a scan line. Each was taken as "Your Price" before; none may be. */
const WRONG_TRADES: [RoomScan['roomType'], RecipeKey, string, string, number][] = [
  ['bathroom', 'door', 'Garage Door', 'EA', 2400],
  ['bathroom', 'baseboard', 'Base Cabinets', 'LF', 310],
  ['bathroom', 'wall_paint', 'Retaining Walls', 'SF', 55],
  ['bathroom', 'door', 'Exterior Door', 'EA', 1350],
  ['bathroom', 'floor_tile', 'Tile Roofing', 'SF', 14],
  ['kitchen', 'sink', 'Kitchen Cabinets', 'EA', 900],
  ['kitchen', 'floor', 'Floor Sanding', 'SF', 4],
];

rule('C1 a trade of his that only shares a word is never taken as his price', (w) => {
  const o: string[] = [];
  for (const [rt, key, trade, unit, rate] of WRONG_TRADES) {
    const db = bookWith([{ trade, unit, rate, kind: 'earned', jobs: 3 }]);
    const recipe = recipeOf(rt, key);
    check(o, w.M.tradeFor(db, recipe) === recipe.defaultTrade, `"${RECIPE_NAMES_EN[key]}" took his "${trade}" trade`);
    const { scan, q } = room(w, 'bathroom.json', { roomType: rt });
    const line = w.M.draft(scan, q, db, NO_CATALOG).lines.find((l) => l.key === key);
    check(o, !!line && line.source === null && line.rate === null && line.claim === null, `"${RECIPE_NAMES_EN[key]}" is priced at $${line?.rate} from "${trade}" and labelled ${line?.source}`);
  }
  // The takeoff's own default is untouched: its other callers still get the looser match.
  const garage = bookWith([{ trade: 'Garage Door', unit: 'EA', rate: 2400, kind: 'earned', jobs: 3 }]);
  check(o, matchOwnRate({ description: 'interior door doors', unit: 'EA' }, garage.entries)?.trade === 'Garage Door', 'the default score in utils/takeoffPricing was changed for every caller');
  check(o, matchOwnRate({ description: 'interior door doors', unit: 'EA' }, garage.entries, PRICING.STRICT_TRADE_MATCH) === null, 'the strict score still takes "Garage Door" for an interior door');
  // A trade whose EVERY word names the work is still his price, and the line says which trade it was.
  const doors = bookWith([{ trade: 'Doors', unit: 'EA', rate: 380, kind: 'earned', jobs: 3 }]);
  const { scan, q } = room(w, 'bathroom.json');
  check(o, w.M.tradeFor(doors, recipeOf('bathroom', 'door')) === 'Doors', 'his "Doors" trade is not used for an interior door');
  const viaDoors = w.M.draft(scan, q, doors, NO_CATALOG).lines.find((l) => l.key === 'door');
  check(o, viaDoors?.source === 'yours' && viaDoors.rate === 380 && viaDoors.claim?.trade === 'Doors' && viaDoors.claim.exactTrade === false && viaDoors.claim.jobCount === 3, `the door line does not say it used his "Doors" price: ${JSON.stringify(viaDoors?.claim)}`);
  const exact = w.M.draft(scan, q, OWN_BOOK(), NO_CATALOG).lines.find((l) => l.key === 'door');
  check(o, exact?.claim?.exactTrade === true && exact.claim.trade === 'Interior Door', 'the line\'s own trade is not marked as exact');
  check(o, PRICING.STRICT_TRADE_MATCH.minScore === 1, 'the strict score is not 1 (every word of his trade label)');
  const src = stripComments(w.F['utils/roomScan/pricingCore.ts']);
  check(o, /STRICT_TRADE_MATCH = \{ minScore: 1 \} as const/.test(src) && /matchOwnRate\(\{ description: line\.matchWords, unit \}, db\.entries, STRICT_TRADE_MATCH\)/.test(src), 'resolveTrade does not pass the strict score to matchOwnRate');
  for (const lines of Object.values(ROOM_RECIPES)) for (const r of lines) {
    check(o, !/\b(walls?|ceilings?|kitchen|vanity|bath|bathroom|room)\b/.test(r.matchWords), `${r.key}: "${r.matchWords}" has a word that names a place, not the work`);
  }
  const hook = w.F['hooks/useRoomScanCopy.ts'];
  for (const k of ['yoursSet', 'yoursMixed', 'yoursSigned', 'yoursMeasured']) {
    check(o, new RegExp(`claim\\.exactTrade\\s*\\? tn?\\('office\\.roomScan\\.source\\.${k}Label'[^\\n]*\\n\\s*: tn?\\('office\\.roomScan\\.source\\.${k}ForLabel'[^\\n]*\\{ trade \\}`).test(hook), `the copy hook does not name his trade on the ${k} label when it is not the line's own`);
    check(o, forms(w.EN[`office.roomScan.source.${k}ForLabel`]).every((f) => /^Your (Set )?Price For \{trade\}, /.test(f)) && forms(w.EN[`office.roomScan.source.${k}ForLabel`]).length > 0, `office.roomScan.source.${k}ForLabel does not read "Your Price For {trade}, ..."`);
  }
  return o;
});

rule('D1 a scan is never named for him, and a room with no name is not priced', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json', { name: '' });
  check(o, scan.name === '', 'a scan built with no name was given one');
  check(o, w.M.scanBlock(scan, q) === 'no_name', 'a room with no name can go on to pricing');
  const d = w.M.draft(scan, q, OWN_BOOK(), CATALOG);
  check(o, d.roomName === '' && w.M.draftBlock(projectWith(EST), d, OK_CTX) === 'no_name', 'a draft with no room name is not blocked');
  check(o, w.M.patch({ ...PUSH, confirmed: true, project: projectWith(EST), draft: d, pushed: {}, newId }) === null, 'estimate lines were written for a room with no name');
  const named = w.M.rename(scan, '  Hall Bath  ');
  check(o, named.name === 'Hall Bath' && w.M.scanBlock(named, q) === null, 'a typed name is not taken, or still blocks');
  check(o, w.M.rename(named, '   ').name === '' && w.M.scanBlock(w.M.rename(named, '   '), q) === 'no_name', 'a name of only spaces counts as a name');
  const dn = w.M.draft(named, q, OWN_BOOK(), CATALOG);
  check(o, dn.roomName === 'Hall Bath' && w.M.draftBlock(projectWith(EST), dn, OK_CTX) === null, 'a named room is blocked');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, /name: '',/.test(bodyOf(flow, 'startScan')) && !/namePlaceholder/.test(flow), 'a new scan is given the placeholder as its name');
  check(o, /if \(!saved\.scan\.name\.trim\(\)\) \{ setSaveState\('needsName'\); return; \}/.test(bodyOf(flow, 'save')), 'Save Scan does not ask for a name');
  check(o, /block=\{scanPricingBlock\(scan, quantities\)\}/.test(flow), 'Price It is not blocked by the missing name');
  const plan = stripComments(w.F['components/roomScan/FloorPlanView.tsx']);
  check(o, /onChangeText=\{\(v\) => \{ setNameText\(v\); p\.onRename\(v\); \}\}/.test(plan) && !/onEndEditing|defaultValue=/.test(plan), 'the name is not taken on every keystroke (a tap on Save with the keyboard up would drop it)');
  check(o, (plan.match(/copy\.namePlaceholder/g) ?? []).length === 1 && /placeholder=\{copy\.namePlaceholder\}/.test(plan), 'the example name is used as something other than the field\'s placeholder');
  return o;
});

rule('A1 only a seat that may change the estimate can push, and "Added" waits for the write to be seen', (w) => {
  const o: string[] = [];
  const seat = (role: 'owner' | 'editor' | 'viewer' | 'field' | null, isLoading = false, isError = false) => w.M.seat({ role, isLoading, isError });
  check(o, seat('owner') === 'open' && seat('editor') === 'open', 'the owner or an editor is refused');
  check(o, seat('viewer') === 'refused' && seat('field') === 'refused', 'a viewer or a field seat can price into the estimate');
  check(o, seat(null, true) === 'checking' && seat(null, false, true) === 'unknown' && seat(null) === 'refused', 'a seat that is not known yet is let in');
  check(o, seat('viewer', true) === 'refused' && seat('field', false, true) === 'refused', 'a known viewer or field seat gets in while the read is busy');
  const { scan, q } = room(w, 'bathroom.json');
  const d = w.M.draft(scan, q, OWN_BOOK(), CATALOG);
  const args = { ...PUSH, confirmed: true, project: projectWith(EST), draft: d, pushed: {}, newId };
  check(o, w.M.patch({ ...args, mayEdit: false }) === null && w.M.patch({ ...args, mayEdit: 'yes' as unknown as boolean }) === null, 'a patch was built for a seat that may not change the estimate');
  check(o, w.M.draftBlock(projectWith(EST), d, { mayEdit: false, markupPct: 20 }) === 'no_access', 'the push is not blocked for a seat that may not change the estimate');
  check(o, w.M.patch(args) !== null, 'an owner or editor seat built nothing');
  // "Added to the estimate." only once the project is seen to hold the lines.
  idSeq = 0;
  const res = w.M.patch(args);
  if (!res) return [...o, 'no patch'];
  const before = projectWith(EST);
  const after = { ...before, ...res.patch } as Project;
  check(o, w.M.holds(before, res) === false && w.M.holds(null, res) === false, 'a project that does not hold the lines is read as holding them');
  check(o, w.M.holds(after, res) === true, 'a project that holds the lines is not recognised');
  const short = { ...after, linkedEstimate: { ...res.next, items: res.next.items.slice(0, -1) } } as Project;
  check(o, w.M.holds(short, res) === false, 'a project missing one of the lines is read as holding them');
  const route = stripComments(w.F['app/scan-room.tsx']);
  check(o, /const roleState = useProjectRoleState\(projectId\);/.test(route) && /const seat = scanSeat\(\{ role: roleState\.role, isLoading: roleState\.isLoading, isError: roleState\.isError \}\);/.test(route), 'the route does not read his seat on the project');
  check(o, /if \(seat !== 'open'\) \{/.test(route) && route.indexOf("if (seat !== 'open') {") < route.indexOf('<RoomScanFlow') && route.indexOf("if (seat !== 'open') {") > 0, 'the flow mounts before the seat check');
  check(o, (route.match(/<RoomScanFlow /g) ?? []).length === 1 && /<RoomScanFlow projectId=\{projectId\} mayEditEstimate \/>/.test(route), 'the flow is mounted somewhere other than after the seat check');
  check(o, /copy\.seatBody\(seat\)/.test(route), 'a refused seat is not told why');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  const confirm = bodyOf(flow, 'confirmDraft');
  check(o, /draftBlock\(project, draft, \{ mayEdit: mayEditEstimate, markupPct \}\)/.test(flow), 'the price screen does not block the push by seat');
  const iKept = confirm.indexOf("if (!kept) { setResult('unconfirmed'); return; }");
  check(o, /kept = estimateHoldsPush\(getProjectRef\.current\(project\.id\) \?\? null, res\);/.test(confirm) && iKept > confirm.indexOf('updateProject('), 'the flow does not read the project back after the write');
  check(o, (flow.match(/setResult\('added'\)/g) ?? []).length === 1 && iKept > 0 && confirm.indexOf("setResult('added')") > iKept && confirm.indexOf('router.push(') > iKept && confirm.indexOf('saveScan(') > iKept,
    '"Added to the estimate." is said, the scan is marked priced or the estimate is opened before the write is seen');
  const view = stripComments(w.F['components/roomScan/PricedDraftView.tsx']);
  check(o, /p\.result === 'added' && <Text[^>]*>\{copy\.addedBody\}/.test(view) && /p\.result === 'unconfirmed' && <Text[^>]*>\{copy\.unconfirmedBody\}/.test(view), 'the price screen does not tell "added" from "not seen yet"');
  return o;
});

const withOpenings = (scan: RoomScan, list: Partial<RoomScan['openings'][number]>[]): RoomScan => ({
  ...scan,
  openings: list.map((x, i) => ({
    id: `op-${i}`, kind: 'door', wallId: scan.walls[0].id, offsetM: 1, widthM: 0.9, heightM: 2, sillM: 0,
    confidence: 'high', widthSource: 'scan', heightSource: 'scan', ...x,
  })),
});

rule('F1 overlapping openings on one wall come off once; an opening with no wall is said', (w) => {
  const o: string[] = [];
  const base = room(w, RECT(3, 4)).scan; // 2.4 m ceiling
  const SF = 10.7639;
  const FT = 3.28084;
  const q0 = w.M.quantities(base);
  const one = w.M.quantities(withOpenings(base, [{}]));
  const same = w.M.quantities(withOpenings(base, [{}, { kind: 'opening' }]));
  check(o, near(one.openingSF, 1.8 * SF) && near(same.openingSF, 1.8 * SF), `a door and an opening at the same spot took ${same.openingSF} sq ft off the wall, not ${(1.8 * SF).toFixed(2)}`);
  check(o, near(same.netWallSF, (q0.grossWallSF ?? 0) - 1.8 * SF), 'the wall area lost the same hole twice');
  check(o, near(same.baseboardLF, q0.perimeterLF - 0.9 * FT), `the baseboard lost the same doorway twice: ${same.baseboardLF}`);
  // A door 1.0 to 1.9 m, floor to 2.0 m, and a window 1.5 to 2.5 m, 1.0 to 2.2 m up: 1.8 + 1.2 less the 0.4 they share.
  const part = w.M.quantities(withOpenings(base, [{}, { kind: 'window', offsetM: 1.5, widthM: 1, heightM: 1.2, sillM: 1 }]));
  check(o, near(part.openingSF, 2.6 * SF), `a door and a window that partly overlap took ${part.openingSF} sq ft, not ${(2.6 * SF).toFixed(2)}`);
  // The same two holes on DIFFERENT walls are two holes.
  const apart = w.M.quantities(withOpenings(base, [{}, { kind: 'opening', wallId: base.walls[2].id }]));
  check(o, near(apart.openingSF, 3.6 * SF), 'openings on two walls were merged into one');
  // Two full-height openings that overlap lose the crown once.
  const tall = w.M.quantities(withOpenings(base, [{ kind: 'opening', heightM: 2.4 }, { kind: 'opening', heightM: 2.4, offsetM: 1.4 }]));
  check(o, near(tall.crownLF, q0.perimeterLF - 1.3 * FT) && near(tall.baseboardLF, q0.perimeterLF - 1.3 * FT), `overlapping full-height openings: crown ${tall.crownLF}, baseboard ${tall.baseboardLF}`);
  check(o, near(QTY.unionLength([[0, 2], [1, 3], [5, 6]]), 4, 1e-9) && near(QTY.unionArea([{ x0: 0, x1: 2, y0: 0, y1: 2 }, { x0: 1, x1: 3, y0: 1, y1: 3 }]), 7, 1e-9), 'the union helpers are wrong');
  // An opening that matched no wall: not subtracted, and SAID.
  const lostScan = withOpenings(base, [{}, { kind: 'window', wallId: null }]);
  const lost = w.M.quantities(lostScan);
  check(o, near(lost.openingSF, 1.8 * SF) && lost.flags.includes('opening_without_wall'), 'an opening with no wall was subtracted, or not flagged');
  const fact = w.M.facts(lostScan, lost).find((f) => f.kind === 'opening_no_wall');
  check(o, !!fact && fact.tone === 'check' && fact.count === 1, 'an opening that matched no wall is dropped without a word');
  check(o, !w.M.facts(withOpenings(base, [{}]), one).some((f) => f.kind === 'opening_no_wall'), 'the "matched no wall" fact shows when every opening has a wall');
  const hook = w.F['hooks/useRoomScanCopy.ts'];
  check(o, /case 'opening_no_wall': return tn\('office\.roomScan\.fact\.openingNoWallBody'/.test(hook) && /matched no wall/.test(forms(w.EN['office.roomScan.fact.openingNoWallBody']).join(' ')), 'there is no sentence for an opening that matched no wall');
  check(o, /p\.facts\.map\(/.test(w.F['components/roomScan/FloorPlanView.tsx']) && /copy\.fact\(f\)/.test(w.F['components/roomScan/FloorPlanView.tsx']), 'the plan does not show the facts');
  return o;
});

const PENT: { x: number; y: number }[] = [0, 1, 2, 3, 4].map((i) => ({ x: 20 + 0.6 * Math.cos((i * 2 * Math.PI) / 5), y: 20 + 0.6 * Math.sin((i * 2 * Math.PI) / 5) }));
const BOW: RoomSpec = { walls: ring([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }, { x: 3, y: 4 }], 2.4) };

rule('G10 the floor is the loop that covers the most ground, and a ring that crosses itself is open', (w) => {
  const o: string[] = [];
  // A 3 m by 4 m room (four walls) and a small five-sided closet off to one side (five walls).
  for (const order of [0, 1]) {
    const a = ring([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }, { x: 0, y: 4 }], 2.4);
    const b = ring(PENT, 2.4);
    const { scan, q } = room(w, { walls: order ? [...b, ...a] : [...a, ...b], rotateDeg: order ? 33 : 0 });
    check(o, scan.closure.closed && near((q.floorAreaSF ?? 0) / 10.7639, 12, 1e-3), `order ${order}: the floor is ${((q.floorAreaSF ?? 0) / 10.7639).toFixed(3)} m2, not the 12.000 of the room (the loop with the most walls was taken)`);
    check(o, scan.walls.filter((x) => x.onOutline).length === 4 && scan.walls.filter((x) => !x.onOutline).length === 5, `order ${order}: the outline is not the room's four walls`);
  }
  check(o, near(GEO.hullArea([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 1 }]), 4, 1e-9), 'hullArea is wrong');
  check(o, GEO.ringCrossing([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }, { x: 0, y: 4 }]) === null && GEO.ringCrossing([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }, { x: 3, y: 4 }]) !== null, 'ringCrossing is wrong');
  // Four walls that join end to end but cross in the middle (a bow tie).
  for (const deg of [0, 61]) {
    const { scan, q } = room(w, { ...BOW, rotateDeg: deg });
    check(o, scan.closure.closed === false && scan.closure.crossing === true && scan.floor.length === 0, `turned ${deg}: a ring that crosses itself was closed`);
    check(o, q.floorAreaSF === null && q.ceilingAreaSF === null, `turned ${deg}: a ring that crosses itself reported a floor area (${q.floorAreaSF})`);
    check(o, w.M.pricingBlock(q) === 'not_closed', `turned ${deg}: a ring that crosses itself can be priced`);
    const f = w.M.facts(scan, q).find((x) => x.kind === 'outline_crosses');
    check(o, !!f && f.tone === 'check' && (f.wallLabels ?? []).length === 2, `turned ${deg}: the walls that cross are not named`);
    const wf = w.M.facts(scan, q).find((x) => x.kind === 'walls_found');
    check(o, !!wf && wf.found === 4 && wf.needed === 4 && wf.tone === 'check', `turned ${deg}: a ring that crosses itself reads "${wf?.found} of ${wf?.needed} walls found" (no wall is missing)`);
  }
  check(o, /case 'outline_crosses': return t\('office\.roomScan\.fact\.crossesBody'/.test(w.F['hooks/useRoomScanCopy.ts']), 'there is no sentence for walls that cross');
  // An ordinary L still closes (a concave room is not a crossing one).
  check(o, room(w, 'l-shape.json').scan.closure.closed, 'the L-shaped room no longer closes');
  return o;
});

rule('H1 a typed length far from the scan is shown back and asked about before it is used', (w) => {
  const o: string[] = [];
  const wall = 98 * IN;
  const bare = w.M.parseTape('98');
  check(o, bare != null && near(bare, 98 / 3.28084, 1e-6) && w.M.feetInches(bare as number) === '98 ft 0 in', 'a bare number no longer reads as feet (the sheet shows the reading, so the rule must match it)');
  check(o, w.M.far(bare as number, wall) === true, '98 ft on a 98 in wall is taken without a question');
  check(o, w.M.far(w.M.parseTape('98 in') as number, wall) === false && w.M.far(w.M.parseTape('8 1') as number, wall) === false, 'a reading close to the scan is questioned');
  check(o, w.M.far(wall * 2.01, wall) === true && w.M.far(wall * 2, wall) === false, 'more than double is not questioned, or exactly double is');
  check(o, w.M.far(wall * 0.49, wall) === true && w.M.far(wall * 0.5, wall) === false, 'less than half is not questioned, or exactly half is');
  check(o, w.M.far(3, 0) === false, 'a wall the scan gave no length for cannot be typed');
  const sheet = stripComments(w.F['components/roomScan/EditMeasureSheet.tsx']);
  const iAsk = sheet.indexOf('if (far && asked !== text) { setAsked(text); return; }');
  check(o, /const far = reading != null && tapeFarFromScan\(reading, target\.currentM\);/.test(sheet) && iAsk > 0 && iAsk < sheet.indexOf('onSave(reading);'), 'the sheet does not ask again before using a far reading');
  check(o, /onChangeText=\{\(v\) => \{ setText\(v\); setBad\(false\); setAsked\(null\); \}\}/.test(sheet), 'changing the text does not ask again');
  check(o, /\{reading != null && <Text[^>]*>\{copy\.editReadsAsSub\(formatFeetInches\(reading\)\)\}<\/Text>\}/.test(sheet), 'the sheet does not show the parsed value before Use This Number');
  check(o, /copy\.editFarBody\(formatFeetInches\(reading\), formatFeetInches\(target\.currentM\)\)/.test(sheet), 'the question does not show both lengths');
  check(o, /\{typed\}/.test(String(w.EN['office.roomScan.edit.farBody'])) && /\{scan\}/.test(String(w.EN['office.roomScan.edit.farBody'])), 'the question sentence lost a length');
  return o;
});

const savedRow = (id: string): STORE.SavedScan => ({ scan: { ...room(REAL, RECT(3, 4)).scan, id }, pushed: {}, manualRates: {}, excluded: [], savedAt: AT, pricedAt: null });

rule('S1 a saved scan can be deleted, and a scan the cap drops takes its raw file with it', (w) => {
  const o: string[] = [];
  let list: STORE.SavedScanList = { version: 1, scans: [] };
  const droppedAll: string[] = [];
  for (let i = 1; i <= STORE.MAX_SCANS_PER_PROJECT + 1; i++) {
    const r = w.M.upsert(list, savedRow(`s${i}`));
    list = r.list;
    droppedAll.push(...r.dropped);
  }
  check(o, list.scans.length === STORE.MAX_SCANS_PER_PROJECT && list.scans[0].scan.id === `s${STORE.MAX_SCANS_PER_PROJECT + 1}` && !list.scans.some((x) => x.scan.id === 's1'), 'the list is not capped newest first');
  check(o, droppedAll.join() === 's1', `the scan the cap dropped is not reported (its raw JSON would stay on the phone): "${droppedAll.join()}"`);
  const again = w.M.upsert(list, savedRow('s5'));
  check(o, again.dropped.length === 0 && again.list.scans.length === STORE.MAX_SCANS_PER_PROJECT && again.list.scans[0].scan.id === 's5', 'saving a scan already in the list dropped another');
  check(o, STORE.removeSavedScan(list, 's7').scans.length === STORE.MAX_SCANS_PER_PROJECT - 1, 'a scan is not removed from the list');
  const store = stripComments(w.F['utils/roomScan/store.ts']);
  check(o, /const \{ list, dropped \} = upsertSavedScan\(before, saved\);/.test(store) && /for \(const id of dropped\) \{\s*try \{ await AsyncStorage\.removeItem\(roomScanRawKey\(id\)\); \}/.test(store), 'the store does not remove the raw key of a scan the cap dropped');
  const del = store.slice(store.indexOf('export async function deleteScan'));
  check(o, /removeSavedScan\(list, scanId\)/.test(del) && /AsyncStorage\.removeItem\(roomScanRawKey\(scanId\)\)/.test(del), 'deleteScan does not remove both the list row and the raw key');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, (flow.match(/\bdeleteScan\(/g) ?? []).length === 1 && /deleteScan\(projectId, target\.scan\.id\)/.test(bodyOf(flow, 'confirmDelete')), 'deleteScan is called somewhere other than confirmDelete');
  check(o, (flow.match(/confirmDelete\(\)/g) ?? []).length === 1 && /destructiveAction=\{\{ label: copy\.deleteYesLabel, onPress: \(\) => void confirmDelete\(\)/.test(flow), 'a scan can be deleted without the yes on the delete sheet');
  check(o, /onPress=\{\(\) => \{ setDeleteFailed\(false\); setDeleting\(s\); \}\}/.test(flow) && /copy\.deleteA11yLabel\(s\.scan\.name\)/.test(flow), 'a saved scan has no delete button');
  check(o, /await refreshSavedList\(\);/.test(bodyOf(flow, 'confirmDelete')), 'the list is not read again after a delete');
  return o;
});

rule('K1 a project with no estimate gets one started by the same yes, at his stated markup', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  const d = w.M.draft(scan, q, OWN_BOOK(), CATALOG);
  const bare = projectWith(null);
  check(o, PRICING.startsEstimate(bare) === true && PRICING.startsEstimate(projectWith(EST)) === false && PRICING.startsEstimate(null) === false, 'startsEstimate is wrong');
  check(o, w.M.draftBlock(bare, d, OK_CTX) === null, 'a project with no estimate is still blocked when he has a markup');
  check(o, w.M.draftBlock(bare, d, { mayEdit: true, markupPct: null }) === 'no_markup', 'a project with no estimate and no stated markup is not blocked');
  const args = { ...PUSH, project: bare, draft: d, pushed: {}, newId };
  check(o, w.M.patch({ ...args, confirmed: false }) === null && w.M.patch({ ...args, confirmed: true, mayEdit: false }) === null, 'an estimate was started without the yes, or for a seat that may not');
  check(o, w.M.patch({ ...args, confirmed: true, markupPct: null }) === null, 'an estimate was started at a markup he never chose');
  idSeq = 0;
  const res = w.M.patch({ ...args, confirmed: true });
  if (!res) return [...o, 'the confirm did not start the estimate'];
  // The house path: the lines at cost through the takeoff push, then buildNewEstimate at his markup.
  idSeq = 0;
  const lines = PRICING.draftPushLines(d);
  const atCost = applyTakeoffPush({ id: '', items: [], globalMarkup: 0, baseTotal: 0, markupTotal: 0, grandTotal: 0, createdAt: AT }, lines, {}, newId);
  const house = { ...buildNewEstimate(atCost.next.items, 20, newId(), AT), globalMarkup: 20 };
  check(o, JSON.stringify(res.next) === JSON.stringify(house), 'the new estimate is not what buildNewEstimate gives from the pushed cost lines');
  check(o, res.started === true && res.next.globalMarkup === 20 && res.next.items.length === lines.length && res.added === lines.length, 'the new estimate does not carry his markup or the lines');
  check(o, res.next.items.every((it) => it.markup === 20 && Math.abs(it.lineTotal - Math.round(it.quantity * it.unitPrice * 1.2 * 100) / 100) < 0.005), 'a line on the new estimate is not at cost plus his markup');
  const base = res.next.items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  check(o, Math.abs(res.next.baseTotal - base) < 0.005 && Math.abs(res.next.grandTotal - res.next.items.reduce((s, it) => s + it.lineTotal, 0)) < 0.005 && res.next.grandTotal > res.next.baseTotal, 'the new estimate does not foot');
  check(o, Math.abs(res.next.baseTotal - d.totalCents / 100) < 0.005, 'the new estimate\'s cost is not the draft total');
  check(o, res.next.items.every((it) => !!it.sourceTakeoffConditionId && res.pushed[it.sourceTakeoffConditionId] === it.materialId), 'a line on the new estimate lost its scan line id');
  check(o, res.next.items.filter((it) => it.priceSource === 'learned').length === 3 && res.next.items.some((it) => it.priceSource === 'seeded') && res.next.items.find((it) => /Toilet/.test(it.name))?.priceSource === undefined, 'lines on the new estimate lost where their price came from');
  check(o, JSON.stringify(res.patch.linkedEstimate) === JSON.stringify(res.next) && (res.patch.estimateVersions ?? []).length === 0, 'the patch is not commitEstimatePatch of the new estimate');
  check(o, w.M.holds({ ...bare, ...res.patch } as Project, res) === true && w.M.holds(bare, res) === false, 'the started estimate cannot be seen to be kept');
  const second = w.M.patch({ ...PUSH, confirmed: true, project: { ...bare, ...res.patch } as Project, draft: d, pushed: res.pushed, newId });
  check(o, !!second && second.started === false && second.added === 0 && second.next.items.length === res.next.items.length && Math.abs(second.afterGrand - res.next.grandTotal) < 0.005, 'pricing the scan again after starting the estimate added the lines twice');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  check(o, /const \{ globalMarkup: savedMarkup, markupDecided \} = useMaterialCart\(\);/.test(flow) && /const markupPct: MarkupPct = markupDecided === true \? savedMarkup : null;/.test(flow), 'the markup is not his stated one (an unanswered markup must stay null)');
  check(o, /starting=\{startsEstimate\(project\)\}/.test(flow), 'the price screen is not told the confirm starts an estimate');
  const view = stripComments(w.F['components/roomScan/PricedDraftView.tsx']);
  check(o, /p\.starting && p\.markupPct != null \? copy\.startConfirmBody\(p\.pushCount, total, p\.markupPct\) : copy\.confirmBody\(p\.pushCount, total\)/.test(view) && /title=\{p\.starting \? copy\.startTitleLabel : copy\.confirmTitleLabel\}/.test(view), 'the confirm sheet does not say it starts the estimate');
  const body = forms(w.EN['office.roomScan.confirm.startBody']).join(' ');
  check(o, /no estimate yet/.test(body) && /\{markup\} percent/.test(body) && /Nothing is sent to your client/.test(body), 'the start sentence does not say what happens, at which markup, and that nothing is sent');
  check(o, !('office.roomScan.block.noEstimateBody' in w.EN), 'the old "start one in Estimate" block is still in the copy');
  return o;
});

rule('J1 small things: no $0.00 line, the start says where a price can come from, Back asks before it drops a scan', (w) => {
  const o: string[] = [];
  const { scan, q } = room(w, 'bathroom.json');
  const sliver = { ...q, baseboardLF: 0.3 };
  const d = w.M.draft(scan, sliver, OWN_BOOK(), CATALOG, { manualRates: { baseboard: 7.5 } });
  check(o, !d.lines.some((l) => l.key === 'baseboard'), 'a quantity that rounds to zero is shown as a line');
  check(o, d.lines.every((l) => l.quantity > 0 && l.amountCents !== 0), 'a line is priced at $0.00');
  check(o, !!w.M.draft(scan, { ...q, baseboardLF: 0.6 }, OWN_BOOK(), CATALOG, { manualRates: { baseboard: 7.5 } }).lines.find((l) => l.key === 'baseboard' && l.quantity === 1), 'a quantity that rounds to one was dropped');
  check(o, /a draft price, from your own past jobs where you have them\./.test(String(w.EN['office.roomScan.start.body'])), 'the start screen promises a price from past jobs he may not have');
  const flow = stripComments(w.F['components/roomScan/RoomScanFlow.tsx']);
  const back = bodyOf(flow, 'back');
  check(o, /else if \(step === 'plan' && dirty\) setLeaving\(true\);/.test(back) && back.indexOf("step === 'plan' && dirty") < back.indexOf('leavePlan()'), 'Back leaves the plan without asking when the scan is not saved');
  check(o, (flow.match(/leavePlan\b/g) ?? []).length >= 3 && /destructiveAction=\{\{ label: copy\.leaveYesLabel, onPress: leavePlan,/.test(flow), 'the leave sheet does not own the discard');
  check(o, /setDirty\(true\);/.test(bodyOf(flow, 'change')) && /setDirty\(true\);/.test(bodyOf(flow, 'startScan')) && /if \(ok\) \{ setSaved\(next\); setDirty\(false\);/.test(bodyOf(flow, 'save')), 'the flow does not track what the phone does not hold');
  const confirm = bodyOf(flow, 'confirmDraft');
  check(o, confirm.indexOf('await refreshSavedList()') > confirm.indexOf('saveScan('), 'the saved list is not read again after a confirmed push');
  return o;
});

rule('N1 the flag is off', (w) => {
  const o: string[] = [];
  check(o, w.M.flag === false, 'SCAN_ROOM_ENABLED is not false');
  check(o, /^export const SCAN_ROOM_ENABLED = false;$/m.test(w.F['constants/featureFlags.ts']), 'constants/featureFlags.ts does not read "export const SCAN_ROOM_ENABLED = false;"');
  return o;
});

rule('N2 the route redirects before it mounts anything', (w) => {
  const o: string[] = [];
  const s = stripComments(w.F['app/scan-room.tsx']);
  check(o, /export default function ScanRoomRoute\(\) \{\s*if \(!SCAN_ROOM_ENABLED\) return <Redirect href="[^"]+" \/>;\s*return <ScanRoomScreen \/>;\s*\}/.test(s), 'the default export is not "flag off: redirect, else the screen"');
  check(o, /import \{ SCAN_ROOM_ENABLED \} from '@\/constants\/featureFlags';/.test(s), 'the route does not read the flag from constants/featureFlags');
  const fn = s.slice(s.indexOf('export default function ScanRoomRoute'), s.indexOf('function ScanRoomScreen'));
  check(o, !/use[A-Z]\w*\(/.test(fn), 'the route calls a hook before the flag check');
  return o;
});

rule('N3 nothing outside the feature links to it or imports it', (w) => {
  const o: string[] = [];
  const allowedMention: Record<string, RegExp> = {
    'app/_layout.tsx': /<Stack\.Screen name="scan-room"/,
    'utils/desktopPage.ts': /'scan-room': 'form'/,
    'i18n/surfaces.ts': /hooks\/useRoomScanCopy\.ts/,
  };
  for (const [f, text] of Object.entries(w.outside)) {
    const s = stripComments(text);
    if (/roomScan\/|useRoomScanCopy|RoomScanFlow/.test(s) && !(f === 'i18n/surfaces.ts')) o.push(`${f} imports the feature`);
    const mentions = (s.match(/scan-room/g) ?? []).length;
    if (mentions > 0) {
      const allow = allowedMention[f];
      if (!allow || !allow.test(s) || mentions > 1) o.push(`${f} mentions the scan-room route`);
    }
    if (/SCAN_ROOM_ENABLED/.test(s) && f !== 'constants/featureFlags.ts') o.push(`${f} reads the flag (an entry point belongs in the change that turns it on)`);
  }
  return o;
});

rule('N4 the native module is one optional lookup, not at module scope, refused while the flag is off', (w) => {
  const o: string[] = [];
  const nat = stripComments(w.F['utils/roomScan/native.ts']);
  check(o, (nat.match(/requireOptionalNativeModule</g) ?? []).length === 1 && /requireOptionalNativeModule<MageRoomScanNative>\('MageRoomScan'\)/.test(nat), 'native.ts does not make exactly one optional lookup of MageRoomScan');
  check(o, !/\brequireNativeModule\b/.test(nat), 'native.ts uses requireNativeModule, which throws on a build without the module');
  const fnStart = nat.indexOf('function native(): MageRoomScanNative | null {');
  const call = nat.indexOf("requireOptionalNativeModule<MageRoomScanNative>('MageRoomScan')");
  const guard = nat.indexOf('if (!SCAN_ROOM_ENABLED) return null;');
  check(o, fnStart >= 0 && guard > fnStart && call > guard, 'the lookup is not inside native(), after the flag check');
  check(o, !/^(?:export )?(?:const|let|var) \w+\s*(?::[^=]+)?=\s*requireOptionalNativeModule/m.test(nat), 'the lookup runs at module scope');
  check(o, /try \{\s*cached = requireOptionalNativeModule/.test(nat), 'the lookup is not inside a try');
  for (const f of FEATURE_FILES) {
    if (f === 'utils/roomScan/native.ts') continue;
    const s = stripComments(w.F[f]);
    check(o, !/MageRoomScan|requireOptionalNativeModule|requireNativeModule|NativeModules\b/.test(s), `${f} names the native module`);
    check(o, !/from ['"][^'"]*modules\//.test(s), `${f} imports from modules/`);
  }
  for (const [f, text] of Object.entries(w.outside)) check(o, !/MageRoomScan/.test(text), `${f} names the native module`);
  // NOT AUTOLINKED. Expo autolinking builds every folder under modules/ into the
  // next iOS binary by itself. This Swift has never been compiled against the
  // real ExpoModulesCore, linked, or run, so it waits in native-staging/, which
  // autolinking does not look at, until the checklist's build steps are done.
  check(o, !w.modulesDirs.includes('mage-room-scan'), 'modules/mage-room-scan exists: Expo autolinking would compile the unproven Swift into the next iOS build');
  check(o, !!w.F['native-staging/mage-room-scan/expo-module.config.json'] && !!w.F['native-staging/mage-room-scan/ios/MageRoomScan.podspec'], 'the module is not waiting in native-staging/mage-room-scan');
  const rootPkg = JSON.parse(w.F['package.json'] || '{}') as { expo?: { autolinking?: Record<string, unknown> }; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const linking = JSON.stringify(rootPkg.expo?.autolinking ?? {});
  check(o, !/native-staging/.test(linking) && !/nativeModulesDir/.test(linking), `package.json points Expo autolinking somewhere new: ${linking}`);
  check(o, !('mage-room-scan' in (rootPkg.dependencies ?? {})) && !('mage-room-scan' in (rootPkg.devDependencies ?? {})) && !/native-staging/.test(JSON.stringify(rootPkg.dependencies ?? {})), 'package.json depends on the staged module (a dependency is autolinked too)');
  check(o, /^!\/native-staging\/\*\/ios\/$/m.test(w.F['.gitignore']), '.gitignore would drop the staged Swift (the `ios/` rule matches at any depth; native-staging needs its own negation)');
  const pkg = JSON.parse(w.F['native-staging/mage-room-scan/package.json'] || '{}') as Record<string, unknown>;
  check(o, pkg.private === true && !('main' in pkg) && !('module' in pkg) && !('exports' in pkg), 'the module package has a JS entry point');
  const cfg = JSON.parse(w.F['native-staging/mage-room-scan/expo-module.config.json'] || '{}') as { platforms?: string[]; apple?: { modules?: string[] } };
  check(o, JSON.stringify(cfg.platforms) === '["apple"]' && JSON.stringify(cfg.apple?.modules) === '["MageRoomScanModule"]', 'the module config is not apple-only with one module');
  const podspec = w.F['native-staging/mage-room-scan/ios/MageRoomScan.podspec'].replace(/^\s*#.*$/gm, '');
  check(o, /:ios => '15\.1'/.test(podspec) && /weak_frameworks = 'RoomPlan'/.test(podspec), 'the podspec raises the iOS floor or does not weak-link RoomPlan');
  check(o, !/UIRequiredDeviceCapabilities/.test(w.F['app.json']), 'app.json requires a device capability');
  return o;
});

rule('N5 the Swift that touches RoomPlan is guarded for iOS 16', (w) => {
  const o: string[] = [];
  const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, '');
  const sup = strip(w.F['native-staging/mage-room-scan/ios/RoomScanSupport.swift']);
  const mod = strip(w.F['native-staging/mage-room-scan/ios/MageRoomScanModule.swift']);
  const types = strip(w.F['native-staging/mage-room-scan/ios/RoomScanTypes.swift']);
  check(o, !/RoomCapture|CapturedRoom|import RoomPlan/.test(mod) && !/RoomCapture|CapturedRoom|import RoomPlan/.test(types), 'RoomPlan is named outside RoomScanSupport.swift');
  check(o, /#if canImport\(RoomPlan\) && !targetEnvironment\(simulator\)\nimport RoomPlan\n#endif/.test(sup), 'import RoomPlan is not behind canImport and off the simulator');
  // Every line that names a RoomPlan type sits inside a guarded region.
  let depth = 0;
  sup.split('\n').forEach((line, i) => {
    if (/^#if canImport\(RoomPlan\) && !targetEnvironment\(simulator\)$/.test(line.trim())) depth++;
    else if (/^#endif$/.test(line.trim()) && depth > 0) depth--;
    else if (/RoomCapture|CapturedRoom\b|RoomPlan\b/.test(line) && !/import RoomPlan|canImport/.test(line) && depth === 0) o.push(`RoomScanSupport.swift line ${i + 1} names RoomPlan outside the guard`);
  });
  check(o, /@available\(iOS 16\.0, \*\)\ninternal final class RoomScanViewController/.test(sup), 'the scanner controller is not marked iOS 16');
  check(o, (sup.match(/if #available\(iOS 16\.0, \*\)/g) ?? []).length >= 3, 'isSupported, capabilities and present do not each check iOS 16');
  check(o, /guard #available\(iOS 16\.0, \*\) else \{\s*promise\.reject\(Exceptions\.RoomScanOsTooOld\(\)\)/.test(mod), 'startScan does not refuse iOS 15 with a typed error');
  check(o, /Name\("MageRoomScan"\)/.test(mod) && /JSONEncoder\(\)\.encode\(processedResult\)/.test(sup), 'the module name or the untouched JSON hand-over changed');
  check(o, !/requestAccess\(for:/.test(sup + mod), 'the module raises the camera prompt itself');
  // ── the promise settles exactly once, on every path ──
  const fn = (name: string): string => { const i = sup.indexOf(name); if (i < 0) return ''; const j = sup.indexOf('\n  }\n', i); return sup.slice(i, j < 0 ? undefined : j); };
  const should = fn('func captureView(shouldPresent');
  check(o, /if let error = error \{[\s\S]*onMain \{ self\.fail\(message\) \}\s*return false/.test(should), 'captureView(shouldPresent:error:) returns false on an error without failing the scan (the screen would wait for ever)');
  const gone = fn('override func viewWillDisappear');
  check(o, /let leaving = isBeingDismissed \|\| \(navigationController\?\.isBeingDismissed \?\? false\)/.test(gone) && /if leaving, let pending = take\(\) \{\s*cancelled = true\s*pending\(\.success\(payload\(status: "cancelled"/.test(gone), 'a scanner dismissed from outside does not settle as cancelled');
  check(o, !/finish\(/.test(gone), 'viewWillDisappear starts a second dismissal');
  const present = fn('static func present(');
  check(o, /guard presenter\.presentedViewController == nil, presenter\.viewIfLoaded\?\.window != nil else \{\s*done\(\.failure\(Exceptions\.RoomScanNoPresenter\(\)\)\)\s*return/.test(present), 'present does not refuse a presenter that cannot present');
  check(o, /if nav\.presentingViewController == nil \{\s*scanner\.abandon\(\)\?\(\.failure\(Exceptions\.RoomScanNoPresenter\(\)\)\)/.test(present), 'present does not reject when the presentation did not happen');
  check(o, /var settled = false[\s\S]*if settled \{ return \}\s*settled = true\s*self\.scanning = false/.test(mod), 'the module does not clear its scanning guard exactly once when the scan settles');
  check(o, (sup.match(/\bdone = nil\b/g) ?? []).length === 1 && /private func take\(\)[^{]*\{\s*let pending = done\s*done = nil\s*return pending/.test(sup), 'the completion is cleared somewhere other than take()');
  check(o, !/\bdone\(/.test(sup.slice(sup.indexOf('internal final class RoomScanViewController'))) && !/\bdone\?\(/.test(sup), 'the controller calls its completion without taking it first');
  const instr = fn('func captureSession(_ session: RoomCaptureSession, didProvide');
  check(o, /onMain \{ if !self\.warnings\.contains\(name\) \{ self\.warnings\.append\(name\) \} \}/.test(instr), 'warnings are changed off the main queue');
  const iMain = sup.indexOf('private func onMain(');
  const appends = [...sup.matchAll(/warnings\.append\(/g)].map((m) => m.index ?? 0);
  check(o, iMain > 0 && appends.length === 2 && appends.filter((i) => i > iMain).length === 1, 'warnings are appended somewhere that is not moved to the main queue');
  check(o, /func captureView\(didPresent processedResult: CapturedRoom, error: Error\?\) \{\s*let message = error\?\.localizedDescription\s*onMain \{ self\.deliver\(processedResult, errorMessage: message\) \}/.test(sup), 'the finished room is handled off the main queue');
  check(o, !/isIdleTimerDisabled = false/.test(sup) && /if priorIdleTimerDisabled == nil \{ priorIdleTimerDisabled = UIApplication\.shared\.isIdleTimerDisabled \}/.test(sup) && /UIApplication\.shared\.isIdleTimerDisabled = prior\b/.test(sup), 'the idle timer is not put back to what it was before the scan');
  for (const code of ['UNSUPPORTED_DEVICE', 'OS_TOO_OLD', 'SIMULATOR', 'CAMERA_DENIED', 'CAMERA_UNDETERMINED', 'ALREADY_RUNNING', 'SESSION_FAILED', 'NO_PRESENTER']) {
    check(o, types.includes(`"E_ROOM_SCAN_${code}"`), `no typed error E_ROOM_SCAN_${code}`);
  }
  return o;
});

rule('N6 each way it can be "no" has its own reason', (w) => {
  const o: string[] = [];
  const caps = (reason: string, supported: boolean) => ({ linked: true, supported, reason, multiRoom: false, osVersion: '17.5', deviceModel: 'iPhone16,1' }) as never;
  check(o, roomScanAvailability(null).reason === 'notInThisBuild' && roomScanAvailability(null).available === false, 'no module is not "not in this build"');
  check(o, roomScanAvailability(caps('noLidar', false)).reason === 'noLidar', 'no LiDAR');
  check(o, roomScanAvailability(caps('osTooOld', false)).reason === 'osTooOld', 'iOS below 16');
  const denied = roomScanAvailability(caps('cameraDenied', true));
  check(o, denied.reason === 'cameraDenied' && denied.action === 'openSettings' && !denied.available, 'camera refused');
  const ask = roomScanAvailability(caps('cameraUndetermined', true));
  check(o, ask.reason === 'cameraUndetermined' && ask.action === 'requestCamera' && !ask.available, 'camera not asked');
  check(o, roomScanAvailability(caps('ok', true)).available === true, 'a phone that can scan is refused');
  check(o, roomScanAvailability(caps('ok', false)).available === false && roomScanAvailability(caps('somethingNew', true)).available === false, 'an answer this code does not know was read as yes');
  const hook = w.F['hooks/useRoomScanCopy.ts'];
  for (const r of ['notInThisBuild', 'osTooOld', 'noLidar', 'simulator', 'cameraUndetermined', 'cameraDenied']) {
    check(o, new RegExp(`case '${r}': return t\\('office\\.roomScan\\.unavailable\\.${r}Body'`).test(hook), `no sentence of its own for ${r}`);
  }
  const flow = w.F['components/roomScan/RoomScanFlow.tsx'];
  check(o, /copy\.unavailableBody\(avail\.reason \?\? 'notInThisBuild'\)/.test(flow), 'the screen does not show the reason');
  return o;
});

rule('N7 house rules: no reanimated, Lucide icons, theme colours, owned storage keys, the Pro gate', (w) => {
  const o: string[] = [];
  for (const f of FEATURE_FILES) {
    const s = stripComments(w.F[f]);
    check(o, !/react-native-reanimated|useSharedValue|useAnimatedStyle|\bworklet\b/.test(s), `${f} uses reanimated`);
    check(o, !/@expo\/vector-icons/.test(s), `${f} uses @expo/vector-icons`);
    if (/^(app|components)\//.test(f)) {
      check(o, !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(s), `${f} writes a colour instead of a theme token`);
      check(o, !/\bt\(\s*['"]|\btn\(\s*['"]/.test(s), `${f} has its own t() key (every string lives in hooks/useRoomScanCopy.ts)`);
      check(o, !/>\s*[A-Za-z][A-Za-z ,.']{3,}\s*</.test(s.replace(/<[A-Z]\w*[^>]*>/g, (m) => m)) || !/<Text[^>]*>\s*[A-Za-z][A-Za-z ,.']{3,}\s*<\/Text>/.test(s), `${f} has English written straight into the screen`);
    }
  }
  const storeSrc = stripComments(w.F['utils/roomScan/storeCore.ts']) + stripComments(w.F['utils/roomScan/store.ts']);
  const keys = [...storeSrc.matchAll(/['"`]([a-z_]+::)['"`]/g)].map((m) => m[1]);
  check(o, keys.length === 2 && keys.every((k) => k.startsWith('mageid_')), `storage keys are ${keys.join(', ')}`);
  check(o, isAppStorageKey(STORE.roomScansKey('p1')) && isAppStorageKey(STORE.roomScanRawKey('s1')), 'a storage key is not under an app-owned prefix (it would survive a tenant switch)');
  check(o, (storeSrc.match(/AsyncStorage\.(setItem|removeItem)\(([^,)]+)/g) ?? []).every((c) => /roomScansKey\(|roomScanRawKey\(/.test(c)), 'the store writes a key it did not build from the two owned prefixes');
  const route = stripComments(w.F['app/scan-room.tsx']);
  check(o, /const \{ canAccess \} = useProjectAccess\(projectId\);/.test(route) && /if \(!canAccess\(SCAN_ROOM_FEATURE\)\) \{\s*return <Paywall /.test(route), 'the route is not gated through hooks/useProjectAccess (the project-scoped tier gate)');
  check(o, SCAN_ROOM_REQUIRED_TIER === 'pro' && SCAN_ROOM_FEATURE === 'job_costing', 'the gate is not Pro');
  check(o, route.indexOf('canAccess(SCAN_ROOM_FEATURE)') < route.indexOf('<RoomScanFlow'), 'the flow mounts before the tier check');
  return o;
});

rule('N8 app.json is not changed by this lane, and the checklist carries what the next native build needs', (w) => {
  const o: string[] = [];
  const app = w.F['app.json'];
  check(o, !/room scan|RoomPlan|depth sensor/i.test(app), 'app.json was changed for room scanning (the permission sentence and its two validators change together, in the native-build change)');
  const doc = w.F['docs/scan-the-room-native-checklist.md'];
  for (const [what, re] of [
    ['the proposed camera sentence', /measure a room when you start a room scan/],
    ['validate-ar-spike', /validate-ar-spike/],
    ['validate-ios-permission-strings', /validate-ios-permission-strings/],
    ['the iOS 15 launch check', /iOS 15/],
    ['the ten-room tape test', /ten rooms/i],
    ['the list of unsure Swift lines', /UNSURE/],
    ['the proposed table', /create table public\.room_scans/],
    ['the old-build check', /without the module/i],
    ['where the module waits', /native-staging\/mage-room-scan/],
    ['the move back into modules/', /git mv native-staging\/mage-room-scan modules\/mage-room-scan/],
    ['one compile against the real ExpoModulesCore', /real ExpoModulesCore/],
    ['the otool check', /otool -L/],
    ['RoomPlan as a weak link', /weak/i],
    ['a physical iOS 15 phone', /PHYSICAL iOS 15/],
  ] as [string, RegExp][]) check(o, re.test(doc), `the checklist is missing ${what}`);
  check(o, !/phone or simulator|or (a |the )?simulator that|iOS 15 (phone or )?simulator/i.test(doc) && /simulator (compiles RoomPlan out|proves nothing)/i.test(doc), 'the checklist still lets a simulator stand in for the iOS 15 launch (the simulator slice compiles RoomPlan out, so it proves nothing)');
  check(o, /native-staging/.test(w.F['native-staging/mage-room-scan/README.md']) && !/phone or simulator/i.test(w.F['native-staging/mage-room-scan/README.md']), 'the module README does not say where it waits, or still accepts a simulator');
  check(o, /requireOptionalNativeModule/.test(w.F['native-staging/mage-room-scan/README.md']), 'the module README does not explain the optional lookup');
  return o;
});

// ── the words ───────────────────────────────────────────────────────────────
const forms = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v as Record<string, string>) : []);
const placeholders = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

rule('W1 labels are written with every word capitalised', (w) => {
  const o: string[] = [];
  for (const [k, v] of Object.entries(w.EN)) {
    if (!/Label$/.test(k)) continue;
    for (const f of forms(v)) {
      for (const word of f.replace(/\{\w+\}/g, '').split(/[\s,]+/).filter(Boolean)) {
        if (/^[a-z]/.test(word)) o.push(`${k}: "${f}" has the word "${word}" in lower case`);
      }
      if (/[.!?]$/.test(f)) o.push(`${k}: a label ends in punctuation`);
    }
  }
  return o;
});

rule('W2 sentences end, captions do not', (w) => {
  const o: string[] = [];
  for (const [k, v] of Object.entries(w.EN)) {
    for (const f of forms(v)) {
      if (/(Body|Note|\.body)$/.test(k)) {
        if (!/[.]$/.test(f)) o.push(`${k}: "${f}" does not end with a period`);
        if (!/^(\{|[A-Z0-9])/.test(f)) o.push(`${k}: does not start with a capital`);
      }
      if (/Sub$/.test(k)) {
        if (/\.$/.test(f)) o.push(`${k}: a caption ends with a period`);
        if (!/^(\{|[A-Z0-9])/.test(f)) o.push(`${k}: a caption does not start with a capital`);
      }
    }
  }
  return o;
});

rule('W3 no em dash, no "&", no "e.g.", no arrows, no exclamation', (w) => {
  const o: string[] = [];
  const check2 = (k: string, f: string, lang: string) => {
    if (/[—–]/.test(f)) o.push(`${lang} ${k}: a dash used as punctuation`);
    if (/&/.test(f)) o.push(`${lang} ${k}: "&"`);
    if (/\be\.g\.|\bi\.e\.|\betc\./i.test(f)) o.push(`${lang} ${k}: "e.g.", "i.e." or "etc."`);
    if (/[←-⇿➡➔]|->|=>/.test(f)) o.push(`${lang} ${k}: an arrow`);
    if (/!/.test(f)) o.push(`${lang} ${k}: an exclamation mark`);
    if (/ - /.test(f)) o.push(`${lang} ${k}: a hyphen used as a dash`);
  };
  for (const [k, v] of Object.entries(w.EN)) for (const f of forms(v)) check2(k, f, 'en');
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) check2(k, f, 'es');
  return o;
});

rule('W4 no promise of how right a number is, and the plain statement that a scan can be off', (w) => {
  const o: string[] = [];
  const BAN_EN = /accura|\bexact|precis|guarantee|perfect|survey[- ]grade|certif|error[- ]free|\bto the inch\b|\d\s*%|percent (sure|confident|accurate)|confidence/i;
  const BAN_ES = /exact[oa]|precis[oa]|precisi[oó]n|garantiz|perfect[oa]|certific|sin errores|confianza/i;
  for (const [k, v] of Object.entries(w.EN)) for (const f of forms(v)) if (BAN_EN.test(f)) o.push(`en ${k}: "${f}" promises or scores how right a number is`);
  for (const [k, v] of Object.entries(w.ES)) for (const f of forms(v?.s)) if (BAN_ES.test(f)) o.push(`es ${k}: promises or scores how right a number is`);
  check(o, /can be off by an inch or more/.test(String(w.EN['office.roomScan.plan.noteBody'])), 'the plan no longer says a phone scan can be off by an inch or more');
  check(o, /not a survey/.test(String(w.EN['office.roomScan.start.body'])), 'the start no longer says a scan is not a survey');
  check(o, /No video is saved/.test(String(w.EN['office.roomScan.unavailable.cameraUndeterminedBody'])) && /keeps the shape and sizes/.test(String(w.EN['office.roomScan.unavailable.cameraUndeterminedBody'])), 'the camera sentence no longer says what a scan keeps');
  check(o, /Nothing is sent to your client/.test(forms(w.EN['office.roomScan.confirm.body']).join(' ')), 'the confirm sheet no longer says nothing is sent');
  const src = String(forms(w.EN['office.roomScan.source.yoursMeasuredLabel']).join('|'));
  check(o, src === 'Your Price, 1 Past Job|Your Price, {count} Past Jobs', `the measured label reads "${src}"`);
  check(o, /Catalog Price/.test(String(w.EN['office.roomScan.source.catalogLabel'])) && !/Your/.test(String(w.EN['office.roomScan.source.catalogLabel'])), 'a catalog price is not labelled as one');
  check(o, !/Past Job/.test(String(w.EN['office.roomScan.source.manualLabel'])) && /No Past Jobs Yet/.test(String(w.EN['office.roomScan.source.yoursSetLabel'])), 'a typed or set price claims past jobs');
  const hook = w.F['hooks/useRoomScanCopy.ts'];
  check(o, /if \(source === 'engine'\) return t\('office\.roomScan\.source\.catalogLabel'/.test(hook) && /if \(claim\.provenance === 'seeded' \|\| claim\.jobCount < 1\) return claim\.exactTrade\s*\? t\('office\.roomScan\.source\.yoursSetLabel'/.test(hook), 'the copy hook no longer maps a catalog price and a set price to their own labels');
  check(o, hook.indexOf("claim.provenance === 'seeded'") < hook.indexOf('office.roomScan.source.yoursMeasuredLabel') && hook.indexOf("claim.tone === 'contracted'") < hook.indexOf('office.roomScan.source.yoursMeasuredLabel'), 'the measured label is reachable before the set, mixed and signed cases are ruled out');
  return o;
});

rule('W5 English and Spanish carry the same keys, plural shapes and placeholders', (w) => {
  const o: string[] = [];
  const en = Object.keys(w.EN).sort();
  const es = Object.keys(w.ES).sort();
  for (const k of en) if (!(k in w.ES)) o.push(`no Spanish for ${k}`);
  for (const k of es) if (!(k in w.EN)) o.push(`Spanish for a key English does not have: ${k}`);
  for (const k of en) {
    const e = w.EN[k];
    const s = w.ES[k];
    if (!s) continue;
    if ((typeof e === 'string') !== (typeof s.s === 'string')) { o.push(`${k}: one language is plural and the other is not`); continue; }
    const ef = forms(e);
    const sf = forms(s.s);
    if (new Set(ef.map(placeholders).concat(sf.map(placeholders)).filter(Boolean)).size > (typeof e === 'string' ? 1 : 2)) o.push(`${k}: placeholders differ`);
    if (typeof e === 'string' && placeholders(e) !== placeholders(String(s.s))) o.push(`${k}: placeholders differ`);
    if (s.src !== sourceHash(e as never)) o.push(`${k}: the Spanish was translated from older English`);
    if (sf.some((x) => !x.trim())) o.push(`${k}: empty Spanish`);
  }
  check(o, en.length >= 150 && en.every((k) => k.startsWith('office.roomScan.')), `the English shard has ${en.length} keys`);
  return o;
});

rule('W6 the surface is registered the way the newest ones are', () => {
  const o: string[] = [];
  const s = SURFACES.find((x) => x.id === 'office.room-scan');
  check(o, !!s && s.state === 'complete' && s.keyPrefixes.join() === 'office.roomScan.' && s.files.join() === 'hooks/useRoomScanCopy.ts,hooks/useScanOrderCopy.ts', 'i18n/surfaces.ts does not list office.room-scan as complete with its two copy hooks');
  check(o, EN_SHARDS['office.room-scan'] === (EN_REAL as unknown) && ES_SHARDS['office/roomScan'] === (ES_REAL as unknown), 'the shards are not listed in EN_SHARDS and ES_SHARDS');
  for (const key of Object.keys(RECIPE_NAMES_EN)) {
    const camel = key.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase());
    check(o, `office.roomScan.line.${camel}Label` in (EN_REAL as Record<string, unknown>), `no line name for ${key}`);
  }
  check(o, Object.values(ROOM_RECIPES).every((r) => r.length >= 5), 'a room type has too few lines');
  return o;
});

// ── run the rules on the real tree ──────────────────────────────────────────
let pass = 0;
let fail = 0;
console.log('validate-scan-room');
for (const [id, fn] of Object.entries(RULES)) {
  let problems: string[];
  try { problems = fn(REAL); } catch (e) { problems = [`threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`]; }
  if (problems.length === 0) { pass += 1; console.log(`  ✓ ${id}`); }
  else { fail += 1; console.log(`  ✗ ${id}`); for (const p of problems.slice(0, 8)) console.log(`      ${p}`); }
}

// ── the Swift typechecks (device slice, and the slice with RoomPlan compiled out) ──
{
  const swiftc = ['/Library/Developer/CommandLineTools/usr/bin/swiftc'].find((p) => existsSync(p));
  const sdkRoot = '/Library/Developer/CommandLineTools/SDKs';
  const sdk = existsSync(join(sdkRoot, 'MacOSX.sdk')) ? join(sdkRoot, 'MacOSX.sdk') : null;
  if (!swiftc || !sdk) {
    const msg = 'Swift typecheck SKIPPED: no Command Line Tools swiftc or macOS SDK on this machine';
    if (process.env.SCAN_ROOM_REQUIRE_SWIFT === '1') { fail += 1; console.log(`  ✗ ${msg}`); } else console.log(`  - ${msg}`);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'scan-room-swift-'));
    try {
      const stubs = join(ROOT, 'native-staging/mage-room-scan/typecheck/Stubs.swift');
      for (const [label, flag] of [['with RoomPlan', '#if true'], ['with RoomPlan compiled out', '#if false']] as const) {
        const files = SWIFT_FILES.map((f) => {
          const src = read(`native-staging/mage-room-scan/ios/${f}`)
            .replace(/^import (ExpoModulesCore|UIKit|RoomPlan)$/gm, '')
            .replace(/^#if canImport\(RoomPlan\) && !targetEnvironment\(simulator\)$/gm, flag);
          const out = join(dir, `${flag === '#if true' ? 'a' : 'b'}-${f}`);
          writeFileSync(out, src);
          return out;
        });
        const r = spawnSync(swiftc, ['-typecheck', '-sdk', sdk, '-target', 'arm64-apple-macos14', stubs, ...files], { encoding: 'utf8', timeout: 120_000 });
        const errs = (r.stderr || r.error?.message || '').split('\n').filter((l) => /error/.test(l)).slice(0, 5);
        if (r.status === 0) { pass += 1; console.log(`  ✓ the Swift typechecks ${label} (against typecheck/Stubs.swift, which is a claim about Apple's API, not a check of it)`); }
        else { fail += 1; console.log(`  ✗ the Swift does not typecheck ${label}`); for (const e of errs) console.log(`      ${e}`); }
      }
      const swiftFiles = readdirSync(join(ROOT, 'native-staging/mage-room-scan/ios'));
      const js = walk('native-staging/mage-room-scan');
      if (js.length === 0 && swiftFiles.filter((f) => f.endsWith('.swift')).sort().join() === [...SWIFT_FILES].sort().join()) { pass += 1; console.log('  ✓ native-staging/mage-room-scan holds no JavaScript, and exactly the three Swift files this check reads'); }
      else { fail += 1; console.log(`  ✗ native-staging/mage-room-scan: JavaScript ${js.join(', ') || 'none'}; Swift ${swiftFiles.join(', ')}`); }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ── the Swift against APPLE'S OWN iOS SDK (only when full Xcode is on the machine) ──
// The stub check above proves the Swift is well formed. This one proves it
// matches the real UIKit, AVFoundation and RoomPlan: the three files are
// typechecked UNCHANGED against the iPhoneOS SDK (deployment target 15.1, the
// app's floor) and the simulator SDK. Only ExpoModulesCore is still a stub
// (the top section of typecheck/Stubs.swift, built as a module of that name);
// its signatures were read against node_modules/expo-modules-core/ios.
// A typecheck is not a link and not a run: the weak link on iOS 15 and
// everything RoomPlan does on a phone are still on the device checklist.
{
  const sdkPath = (name: string): string | null => {
    if (!existsSync('/usr/bin/xcrun')) return null;
    const r = spawnSync('/usr/bin/xcrun', ['--sdk', name, '--show-sdk-path'], { encoding: 'utf8', timeout: 30_000 });
    const out = (r.stdout || '').trim();
    return r.status === 0 && out && existsSync(join(out, 'System/Library/Frameworks/RoomPlan.framework')) ? out : null;
  };
  const slices = [
    ['a real iPhone (iPhoneOS SDK, iOS 15.1 floor)', sdkPath('iphoneos'), 'arm64-apple-ios15.1'],
    ['the simulator (iPhoneSimulator SDK)', sdkPath('iphonesimulator'), 'arm64-apple-ios15.1-simulator'],
  ] as const;
  if (slices.some(([, sdk]) => !sdk)) {
    const msg = "Swift typecheck against Apple's iOS SDK SKIPPED: no Xcode with an iOS SDK that has RoomPlan on this machine";
    if (process.env.SCAN_ROOM_REQUIRE_SWIFT === '1') { fail += 1; console.log(`  ✗ ${msg}`); } else console.log(`  - ${msg}`);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'scan-room-sdk-'));
    try {
      const stubs = read('native-staging/mage-room-scan/typecheck/Stubs.swift');
      const cut = stubs.indexOf('// ── UIKit');
      const expoOnly = stubs.slice(0, cut).replace(/^import AVFoundation$/m, 'import AVFoundation\nimport UIKit');
      if (cut < 0 || !/open class Module/.test(expoOnly) || /class UIViewController/.test(expoOnly)) {
        fail += 1; console.log('  ✗ typecheck/Stubs.swift: the ExpoModulesCore section could not be cut out on its own');
      } else {
        const expoFile = join(dir, 'ExpoModulesCore.swift');
        writeFileSync(expoFile, expoOnly);
        const sources = SWIFT_FILES.map((f) => join(ROOT, 'native-staging/mage-room-scan/ios', f));
        for (const [label, sdk, target] of slices) {
          const out = join(dir, target);
          mkdirSync(out);
          const mod = spawnSync('/usr/bin/xcrun', ['swiftc', '-emit-module', '-module-name', 'ExpoModulesCore', '-parse-as-library', '-sdk', sdk as string, '-target', target, expoFile, '-emit-module-path', join(out, 'ExpoModulesCore.swiftmodule')], { encoding: 'utf8', timeout: 180_000 });
          const r = mod.status === 0
            ? spawnSync('/usr/bin/xcrun', ['swiftc', '-typecheck', '-sdk', sdk as string, '-target', target, '-I', out, '-module-name', 'MageRoomScan', ...sources], { encoding: 'utf8', timeout: 180_000 })
            : mod;
          const errs = (r.stderr || r.error?.message || '').split('\n').filter((l) => /error/.test(l)).slice(0, 5);
          if (r.status === 0) { pass += 1; console.log(`  ✓ the Swift, unchanged, typechecks against Apple's real UIKit, AVFoundation and RoomPlan for ${label}`); }
          else { fail += 1; console.log(`  ✗ the Swift does not typecheck against Apple's SDK for ${label}`); for (const e of errs) console.log(`      ${e}`); }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ── Expo autolinking, asked directly: is the scanner in the next iOS build? ──
// The rule N4 reads the folders. This runs the SAME search `pod install` runs
// (expo-modules-autolinking search, platform apple) and requires that it finds
// the AR module (so the search works) and does NOT find the room scanner.
{
  const cli = join(ROOT, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js');
  if (!existsSync(cli)) {
    console.log('  - Expo autolinking search SKIPPED: expo-modules-autolinking is not installed here');
  } else {
    const r = spawnSync(process.execPath.endsWith('bun') ? 'node' : process.execPath, [cli, 'search', '--platform', 'apple', '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
    let found: string[] | null = null;
    try { found = Object.keys(JSON.parse(r.stdout || '') as Record<string, unknown>); } catch { found = null; }
    if (r.status !== 0 || !found) { fail += 1; console.log(`  ✗ Expo autolinking search could not be run: ${(r.stderr || r.error?.message || '').split('\n')[0]}`); }
    else if (!found.includes('mage-ar-track')) { fail += 1; console.log('  ✗ Expo autolinking search did not find modules/mage-ar-track, so it proves nothing about the scanner'); }
    else if (found.includes('mage-room-scan')) { fail += 1; console.log('  ✗ Expo autolinking FINDS mage-room-scan: the next iOS build would compile the unproven Swift'); }
    else { pass += 1; console.log(`  ✓ Expo autolinking (search, apple) finds ${found.length} modules, mage-ar-track among them, and NOT mage-room-scan`); }
  }
}

// ── planted mutations ───────────────────────────────────────────────────────
interface Mutation { rule: string; what: string; plant: (w: World) => World }
const mods = (over: Partial<Mods>) => (w: World): World => ({ ...w, M: { ...w.M, ...over } });
function text(file: string, from: string | RegExp, to: string) {
  return (w: World): World => {
    const s = w.F[file];
    const next = s.replace(from as never, to);
    if (next === s) throw new Error(`mutation anchor not found in ${file}: ${String(from)}`);
    return { ...w, F: { ...w.F, [file]: next } };
  };
}
const outside = (file: string, add: string) => (w: World): World => {
  if (!(file in w.outside)) throw new Error(`no such outside file ${file}`);
  return { ...w, outside: { ...w.outside, [file]: w.outside[file] + add } };
};
const en = (key: string, value: unknown) => (w: World): World => {
  if (!(key in w.EN)) throw new Error(`mutation key not found: ${key}`);
  return { ...w, EN: { ...w.EN, [key]: value } };
};
const es = (key: string, value: { s: unknown; src: string } | undefined) => (w: World): World => {
  const next = { ...w.ES };
  if (value === undefined) delete next[key]; else next[key] = value;
  return { ...w, ES: next };
};
const qWrap = (fn: (q: ScanQuantities, scan: RoomScan) => ScanQuantities) => mods({ quantities: (scan, opts) => fn(QTY.computeQuantities(scan, opts), scan) });
const mirror = (json: string | unknown) => {
  const p = PARSER.parseCapturedRoom(json);
  const flip = <T extends { transform: number[] }>(s: T): T => { const t = [...s.transform]; t[2] = -t[2]; t[14] = -t[14]; return { ...s, transform: t }; };
  return { ...p, walls: p.walls.map(flip), doors: p.doors.map(flip), windows: p.windows.map(flip), openings: p.openings.map(flip), objects: p.objects.map(flip) };
};

const MUTATIONS: Mutation[] = [
  { rule: 'G1', what: 'the floor area is 1 percent high', plant: qWrap((q) => ({ ...q, floorAreaSF: q.floorAreaSF == null ? null : q.floorAreaSF * 1.01 })) },
  { rule: 'G1', what: 'a storage cabinet is counted as a fixture', plant: qWrap((q, s) => ({ ...q, fixtureCount: s.objects.length })) },
  { rule: 'G2', what: 'openings with no parent id are left without a wall', plant: mods({ build: (p, m) => { const s = GEO.buildRoomScan(p, m); return p.doors.some((d) => d.parentId) ? s : { ...s, openings: s.openings.map((x) => ({ ...x, wallId: null })) }; } }) },
  { rule: 'G3', what: 'an open outline is given a floor area', plant: qWrap((q) => ({ ...q, floorAreaSF: q.floorAreaSF ?? 100, ceilingAreaSF: q.ceilingAreaSF ?? 100 })) },
  { rule: 'G3', what: 'an open outline can be priced', plant: mods({ pricingBlock: () => null }) },
  { rule: 'G4', what: 'the z sign is flipped (a mirrored plan)', plant: mods({ parse: mirror }) },
  { rule: 'G5', what: 'the floor is taken in the order the walls arrive', plant: mods({ build: (p, m) => { const s = GEO.buildRoomScan(p, m); return { ...s, floor: p.walls.map((x) => GEO.wallSegment(x).a) }; } }) },
  { rule: 'G6', what: 'any gap is closed', plant: mods({ build: (p, m) => { const s = GEO.buildRoomScan(p, m); return s.closure.closed ? s : { ...s, floor: s.walls.map((x) => x.a), closure: { ...s.closure, closed: true, gaps: 0 } }; } }) },
  { rule: 'G6', what: 'a 2 cm miss is left open', plant: mods({ build: (p, m) => { const s = GEO.buildRoomScan(p, m); return s.closure.gapM > 0.01 ? { ...s, floor: [], closure: { ...s.closure, closed: false, gaps: 1 } } : s; } }) },
  { rule: 'G7', what: 'a varying ceiling is not flagged', plant: qWrap((q) => ({ ...q, flags: q.flags.filter((f) => f !== 'ceiling_varies') })) },
  { rule: 'G7', what: 'wall area is 0 instead of not known when there is no ceiling height', plant: qWrap((q) => ({ ...q, grossWallSF: q.grossWallSF ?? 0, netWallSF: q.netWallSF ?? 0 })) },
  { rule: 'G8', what: 'the size limit flag is dropped', plant: qWrap((q) => ({ ...q, flags: q.flags.filter((f) => f !== 'over_size_limit') })) },
  { rule: 'G8', what: 'a curved wall is not flagged', plant: qWrap((q) => ({ ...q, flags: q.flags.filter((f) => f !== 'curved_wall') })) },
  { rule: 'G9', what: 'a low-confidence wall does not block pricing', plant: mods({ pricingBlock: (q) => { const b = QTY.pricingBlock(q); return b === 'low_confidence_wall' ? null : b; } }) },
  { rule: 'Q1', what: 'openings are subtracted twice', plant: qWrap((q) => ({ ...q, netWallSF: q.grossWallSF == null || q.openingSF == null ? null : q.grossWallSF - 2 * q.openingSF })) },
  { rule: 'Q1', what: 'openings are not subtracted', plant: qWrap((q) => ({ ...q, netWallSF: q.grossWallSF })) },
  { rule: 'Q1', what: 'an opening listed twice is subtracted twice', plant: mods({ quantities: (scan, opts) => { const q = QTY.computeQuantities(scan, opts); const extra = scan.openings.length - new Set(scan.openings.map((x) => x.id)).size; return extra > 0 && q.netWallSF != null && q.openingSF != null ? { ...q, netWallSF: q.netWallSF - q.openingSF / 2 } : q; } }) },
  { rule: 'Q2', what: 'baseboard loses the windows too', plant: mods({ quantities: (scan, opts) => { const q = QTY.computeQuantities(scan, opts); const win = scan.openings.filter((x) => x.kind === 'window').reduce((s, x) => s + x.widthM, 0); return { ...q, baseboardLF: q.baseboardLF - win * 3.28084 }; } }) },
  { rule: 'Q2', what: 'crown loses the doors', plant: mods({ quantities: (scan, opts) => { const q = QTY.computeQuantities(scan, opts); const doors = scan.openings.filter((x) => x.kind === 'door').reduce((s, x) => s + x.widthM, 0); return { ...q, crownLF: q.crownLF - doors * 3.28084 }; } }) },
  { rule: 'Q3', what: 'an opening is not clipped to its wall', plant: mods({ quantities: (scan, opts) => { const q = QTY.computeQuantities(scan, opts); const raw = scan.openings.reduce((s, x) => s + x.widthM * x.heightM, 0) * 10.7639; return { ...q, openingSF: q.openingSF == null ? null : raw }; } }) },
  { rule: 'Q4', what: 'waste is applied twice', plant: mods({ draft: (s, q, db, cat, ch) => PRICING.buildScanDraft(s, { ...q, floorAreaSF: q.floorAreaSF == null ? null : q.floorAreaSF * 1.1 }, db, cat, ch) }) },
  { rule: 'Q4', what: 'a count gets waste', plant: mods({ draft: (s, q, db, cat, ch) => { const d = PRICING.buildScanDraft(s, q, db, cat, ch); return { ...d, lines: d.lines.map((l) => (l.unit === 'EA' ? { ...l, quantity: l.quantity * 1.1 } : l)) }; } }) },
  { rule: 'U1', what: 'feet and inches are cut off instead of rounded', plant: mods({ feetInches: (m) => { const t = Math.floor(UNITS.metresToInches(m) - 0.5); return `${Math.floor(t / 12)} ft ${t % 12} in`; } }) },
  { rule: 'U1', what: 'a 31 in door snaps to 30', plant: mods({ nominal: (n) => UNITS.nominalDoorWidthIn(n) ?? (n < 32 ? 30 : null) }) },
  { rule: 'U1', what: 'inches of 12 or more are accepted after feet', plant: mods({ parseTape: (s) => UNITS.parseTapeMeasure(s) ?? (/^8 13$/.test(s) ? 2.7 : null) }) },
  { rule: 'P1', what: 'enum values written as strings are not understood', plant: mods({ parse: (j) => { const p = PARSER.parseCapturedRoom(j); const raw = typeof j === 'string' ? j : ''; return /"category":"/.test(raw) ? { ...p, objects: [] } : p; } }) },
  { rule: 'P1', what: 'a room with only walls throws', plant: mods({ parse: (j) => { const raw = typeof j === 'string' ? j : ''; if (!/"doors"/.test(raw)) throw new Error('doors missing'); return PARSER.parseCapturedRoom(j); } }) },
  { rule: 'P2', what: 'a wall that cannot be placed is put at the origin', plant: mods({ parse: (j) => { try { return PARSER.parseCapturedRoom(j); } catch { return PARSER.parseCapturedRoom(JSON.stringify(buildCapturedRoom(bathroomSpec()))); } } }) },
  { rule: 'P3', what: 'the parser stops saying it has not read a real export', plant: text('utils/roomScan/capturedRoomParser.ts', /It has NOT been run against a/, 'It has been checked against a') },
  { rule: 'E1', what: 'a typed wall does not recompute', plant: mods({ wall: (s, id, to, at) => ({ ...s, edits: EDITS.correctWallLength(s, id, to, at).edits }) }) },
  { rule: 'E1', what: 'a typed door width changes nothing', plant: mods({ opening: (s) => s }) },
  { rule: 'E2', what: 'a correction is not recorded', plant: mods({ wall: (s, id, to, at) => ({ ...EDITS.correctWallLength(s, id, to, at), edits: s.edits }) }) },
  { rule: 'E2', what: 'a typed wall is not marked typed', plant: mods({ wall: (s, id, to, at) => { const n = EDITS.correctWallLength(s, id, to, at); return { ...n, walls: n.walls.map((x) => ({ ...x, lengthSource: 'scan' as const })) }; } }) },
  { rule: 'E2', what: 'an edit is recorded without "typed"', plant: mods({ wall: (s, id, to, at) => { const n = EDITS.correctWallLength(s, id, to, at); return { ...n, edits: n.edits.map((e) => ({ ...e, by: 'app' as never })) }; } }) },
  { rule: 'E3', what: 'typed lengths that do not close still report a floor', plant: mods({ quantities: (scan, opts) => { const q = QTY.computeQuantities(scan, opts); return scan.closure.cause === 'typed' ? { ...q, floorAreaSF: 40 } : q; } }) },
  { rule: 'E4', what: 'a tape check scales the scan', plant: mods({ tape: (s, id, m, at) => { const n = EDITS.addTapeCheck(s, id, m, at); return { ...n, walls: n.walls.map((x) => ({ ...x, lengthM: x.lengthM * 1.05 })) }; } }) },
  { rule: 'R1', what: 'a catalog price is labelled as his', plant: mods({ draft: (...a) => { const d = PRICING.buildScanDraft(...a); return { ...d, lines: d.lines.map((l) => (l.source === 'engine' ? { ...l, source: 'yours' as const } : l)) }; } }) },
  { rule: 'R1', what: 'a line with no price is $0', plant: mods({ draft: (...a) => { const d = PRICING.buildScanDraft(...a); return { ...d, lines: d.lines.map((l) => (l.amountCents == null ? { ...l, amountCents: 0, rate: 0 } : l)) }; } }) },
  { rule: 'R1', what: 'a priced line has no source', plant: mods({ draft: (...a) => { const d = PRICING.buildScanDraft(...a); return { ...d, lines: d.lines.map((l, i) => (i === 0 ? { ...l, source: null } : l)) }; } }) },
  { rule: 'R1', what: 'a rate he only set is called measured', plant: mods({ draft: (...a) => { const d = PRICING.buildScanDraft(...a); return { ...d, lines: d.lines.map((l) => (l.claim ? { ...l, claim: { ...l.claim, tone: 'measured' as const, provenance: 'earned' as const, jobCount: Math.max(1, l.claim.jobCount) } } : l)) }; } }) },
  { rule: 'R2', what: 'the draft rounds its own quantity', plant: mods({ draft: (...a) => { const d = PRICING.buildScanDraft(...a); return { ...d, lines: d.lines.map((l) => (l.unit === 'SF' ? { ...l, quantity: l.quantity + 1 } : l)) }; } }) },
  { rule: 'R2', what: 'pricingCore stops calling applyTakeoffPush', plant: text('utils/roomScan/pricingCore.ts', /applyTakeoffPush\(/g, 'myOwnPush(') },
  { rule: 'R2', what: 'the patch skips the history snapshot', plant: mods({ patch: (a) => { const r = PRICING.buildEstimatePatch(a); return r ? { ...r, patch: { linkedEstimate: r.next, estimateVersions: [] } } : r; } }) },
  { rule: 'R3', what: 'an unanswered markup is written as zero on a new estimate', plant: mods({ patch: (a) => PRICING.buildEstimatePatch({ ...a, markupPct: a.markupPct ?? 0 }) }) },
  { rule: 'R3', what: 'a patch is built without confirmation', plant: mods({ patch: (a) => PRICING.buildEstimatePatch({ ...a, confirmed: true }) }) },
  { rule: 'R3', what: 'the flow saves by itself in an effect', plant: text('components/roomScan/RoomScanFlow.tsx', "  const scan = saved?.scan ?? null;", "  useEffect(() => {\n    if (saved) void saveScan(saved, rawJson);\n  }, [saved, rawJson]);\n  const scan = saved?.scan ?? null;") },
  { rule: 'R3', what: 'Open In Estimate writes the estimate directly', plant: text('components/roomScan/PricedDraftView.tsx', 'onPress={() => setConfirming(true)} disabled={p.block != null || p.busy}', 'onPress={() => p.onConfirm()} disabled={p.block != null || p.busy}') },
  { rule: 'R3', what: 'the flow confirms without the literal true', plant: text('components/roomScan/RoomScanFlow.tsx', 'confirmed: true, mayEdit: mayEditEstimate,', 'confirmed: !!draft, mayEdit: mayEditEstimate,') },
  { rule: 'R3', what: 'the store writes a row to the server', plant: text('utils/roomScan/store.ts', "import * as Crypto from 'expo-crypto';", "import * as Crypto from 'expo-crypto';\nimport { supabase } from '@/lib/supabase';") },
  { rule: 'R4', what: 'a line left out stays in the total', plant: mods({ draft: (s, q, db, cat, ch) => { const d = PRICING.buildScanDraft(s, q, db, cat, ch); const all = PRICING.buildScanDraft(s, q, db, cat, { ...ch, excluded: [] }); return { ...d, totalCents: all.totalCents }; } }) },
  { rule: 'R4', what: 'a second pricing appends again', plant: mods({ patch: (a) => PRICING.buildEstimatePatch({ ...a, pushed: {}, draft: { ...a.draft, lines: a.draft.lines.map((l) => ({ ...l, row: { ...l.row, condition: { ...l.row.condition, id: `${l.row.condition.id}:${a.project?.linkedEstimate?.items.length ?? 0}` } } })) } }) }) },
  { rule: 'C1', what: 'the trade match goes back to one shared word', plant: mods({ tradeFor: (db, line) => (lookupRate(db, line.defaultTrade, KIND_UNIT[line.kind]) ? line.defaultTrade : matchOwnRate({ description: line.matchWords, unit: KIND_UNIT[line.kind] }, db.entries)?.trade ?? line.defaultTrade) }) },
  { rule: 'C1', what: 'the strict score is loosened to half the words', plant: text('utils/roomScan/pricingCore.ts', '{ minScore: 1 } as const', '{ minScore: 0.5 } as const') },
  { rule: 'C1', what: 'resolveTrade stops passing the strict score', plant: text('utils/roomScan/pricingCore.ts', 'db.entries, STRICT_TRADE_MATCH)', 'db.entries)') },
  { rule: 'C1', what: 'the label stops naming which of his trades was used', plant: text('hooks/useRoomScanCopy.ts', "tn('office.roomScan.source.yoursMeasuredForLabel'", "tn('office.roomScan.source.yoursMeasuredLabel'") },
  { rule: 'C1', what: 'a line borrowed from another trade is marked as the line\'s own', plant: mods({ draft: (...a) => { const d = PRICING.buildScanDraft(...a); return { ...d, lines: d.lines.map((l) => (l.claim ? { ...l, claim: { ...l.claim, exactTrade: true } } : l)) }; } }) },
  { rule: 'D1', what: 'a room with no name can be priced', plant: mods({ scanBlock: (_s, q) => QTY.pricingBlock(q) }) },
  { rule: 'D1', what: 'a draft with no room name can be pushed', plant: mods({ draftBlock: (p, d, c) => { const b = PRICING.draftBlock(p, d, c); return b === 'no_name' ? null : b; } }) },
  { rule: 'D1', what: 'every scan is named Hall Bathroom again', plant: text('components/roomScan/RoomScanFlow.tsx', "          name: '',", "          name: copy.namePlaceholder,") },
  { rule: 'D1', what: 'the name is only taken when the keyboard closes', plant: text('components/roomScan/FloorPlanView.tsx', 'onChangeText={(v) => { setNameText(v); p.onRename(v); }}', 'onEndEditing={(e) => p.onRename(e.nativeEvent.text)}') },
  { rule: 'D1', what: 'a name of spaces counts as a name', plant: mods({ rename: (s, n) => (n.trim() ? EDITS.renameScan(s, n) : { ...s, name: n }), scanBlock: (s, q) => QTY.pricingBlock(q) ?? (s.name ? null : 'no_name') }) },
  { rule: 'A1', what: 'every seat is let in', plant: mods({ seat: () => 'open' }) },
  { rule: 'A1', what: 'the patch ignores the seat', plant: mods({ patch: (a) => PRICING.buildEstimatePatch({ ...a, mayEdit: true }), draftBlock: (p, d, c) => PRICING.draftBlock(p, d, { ...c, mayEdit: true }) }) },
  { rule: 'A1', what: 'any project counts as holding the lines', plant: mods({ holds: () => true }) },
  { rule: 'A1', what: 'the route mounts the flow for a refused seat', plant: text('app/scan-room.tsx', "if (seat !== 'open') {", 'if (false) {') },
  { rule: 'A1', what: '"Added to the estimate." is said as soon as the write is sent', plant: text('components/roomScan/RoomScanFlow.tsx', '      updateProject(project.id, res.patch);', "      updateProject(project.id, res.patch);\n      setResult('added');") },
  { rule: 'A1', what: 'the flow stops reading the project back', plant: text('components/roomScan/RoomScanFlow.tsx', 'kept = estimateHoldsPush(getProjectRef.current(project.id) ?? null, res);', 'kept = true;') },
  { rule: 'F1', what: 'overlapping openings are summed', plant: mods({ quantities: (scan, opts) => { const q = QTY.computeQuantities(scan, opts); const seen = new Set<string>(); let m2 = 0; for (const x of scan.openings) { const wl = scan.walls.find((y) => y.id === x.wallId && y.onOutline); if (!wl || seen.has(x.id)) continue; seen.add(x.id); m2 += QTY.clippedWidthM(x, wl) * Math.min(x.heightM, (wl.heightM || scan.ceilingHeightM.typical) - x.sillM); } return q.openingSF == null || q.grossWallSF == null ? q : { ...q, openingSF: m2 * 10.7639, netWallSF: q.grossWallSF - m2 * 10.7639 }; } }) },
  { rule: 'F1', what: 'a doorway covered twice loses the baseboard twice', plant: mods({ quantities: (scan, opts) => { const q = QTY.computeQuantities(scan, opts); const out = scan.openings.filter((x) => x.wallId && (x.kind === 'door' || (x.kind === 'opening' && x.sillM < 0.05))).reduce((t, x) => t + x.widthM, 0); return { ...q, baseboardLF: q.perimeterLF - out * 3.28084 }; } }) },
  { rule: 'F1', what: 'an opening with no wall is dropped without a word', plant: mods({ facts: (s, q) => QTY.scanFacts(s, q).filter((f) => f.kind !== 'opening_no_wall') }) },
  { rule: 'F1', what: 'an opening with no wall is subtracted anyway', plant: qWrap((q, scan) => { const lost = scan.openings.filter((x) => !x.wallId).reduce((t, x) => t + x.widthM * x.heightM, 0) * 10.7639; return q.openingSF == null ? q : { ...q, openingSF: q.openingSF + lost }; }) },
  { rule: 'G10', what: 'the loop with the most walls is the floor', plant: mods({ build: (p, m) => { const s = GEO.buildRoomScan(p, m); const off = s.walls.filter((x) => !x.onOutline); const on = s.walls.filter((x) => x.onOutline); return off.length > on.length ? { ...s, walls: s.walls.map((x) => ({ ...x, onOutline: !x.onOutline })), floor: off.map((x) => x.a) } : s; } }) },
  { rule: 'G10', what: 'a ring that crosses itself is given a floor', plant: mods({ build: (p, m) => { const s = GEO.buildRoomScan(p, m); return s.closure.crossing ? { ...s, floor: s.walls.map((x) => x.a), closure: { closed: true, gapM: 0, gaps: 0, gapWallIds: [], cause: 'scan' as const } } : s; } }) },
  { rule: 'G10', what: 'walls that cross are not named', plant: mods({ facts: (s, q) => QTY.scanFacts(s, q).map((f) => (f.kind === 'outline_crosses' ? { ...f, kind: 'outline_open' as const } : f)) }) },
  { rule: 'H1', what: 'no reading is ever far from the scan', plant: mods({ far: () => false }) },
  { rule: 'H1', what: 'only ten times the scan is questioned', plant: mods({ far: (t, sc) => sc > 0 && (t > sc * 10 || t < sc / 10) }) },
  { rule: 'H1', what: 'the sheet takes a far reading on the first tap', plant: text('components/roomScan/EditMeasureSheet.tsx', '    if (far && asked !== text) { setAsked(text); return; }\n', '') },
  { rule: 'H1', what: 'the sheet stops showing what it read', plant: text('components/roomScan/EditMeasureSheet.tsx', '{copy.editReadsAsSub(formatFeetInches(reading))}', '{copy.editHintBody}') },
  { rule: 'S1', what: 'the scan the cap drops is not reported', plant: mods({ upsert: (l, sv) => ({ list: STORE.upsertSavedScan(l, sv).list, dropped: [] }) }) },
  { rule: 'S1', what: 'the store leaves the dropped scan\'s raw key behind', plant: text('utils/roomScan/store.ts', 'for (const id of dropped) {', 'for (const id of [] as string[]) {') },
  { rule: 'S1', what: 'the trash button deletes without asking', plant: text('components/roomScan/RoomScanFlow.tsx', 'onPress={() => { setDeleteFailed(false); setDeleting(s); }}', 'onPress={() => void deleteScan(projectId, s.scan.id)}') },
  { rule: 'S1', what: 'deleteScan leaves the raw JSON', plant: text('utils/roomScan/store.ts', '    await AsyncStorage.removeItem(roomScanRawKey(scanId));\n', '') },
  { rule: 'K1', what: 'a project with no estimate is still blocked', plant: mods({ draftBlock: (p, d, c) => (p && !p.linkedEstimate ? 'no_markup' : PRICING.draftBlock(p, d, c)) }) },
  { rule: 'K1', what: 'the new estimate is written at cost', plant: mods({ patch: (a) => { const r = PRICING.buildEstimatePatch(a); return r && r.started ? { ...r, next: { ...r.next, globalMarkup: 0, items: r.next.items.map((it) => ({ ...it, markup: 0, lineTotal: it.quantity * it.unitPrice })) } } : r; } }) },
  { rule: 'K1', what: 'an unanswered markup starts the estimate at zero', plant: mods({ patch: (a) => PRICING.buildEstimatePatch({ ...a, markupPct: a.markupPct ?? 0 }) }) },
  { rule: 'K1', what: 'the new estimate is started without the yes', plant: mods({ patch: (a) => PRICING.buildEstimatePatch({ ...a, confirmed: a.project?.linkedEstimate ? a.confirmed : true }) }) },
  { rule: 'K1', what: 'the markup defaults to a number he never chose', plant: text('components/roomScan/RoomScanFlow.tsx', 'const markupPct: MarkupPct = markupDecided === true ? savedMarkup : null;', 'const markupPct: MarkupPct = savedMarkup;') },
  { rule: 'K1', what: 'the confirm sheet hides that it starts an estimate', plant: text('components/roomScan/PricedDraftView.tsx', 'p.starting && p.markupPct != null ? copy.startConfirmBody(p.pushCount, total, p.markupPct) : copy.confirmBody(p.pushCount, total)', 'copy.confirmBody(p.pushCount, total)') },
  { rule: 'J1', what: 'a sliver is shown as a priced line', plant: mods({ draft: (s, q, db, cat, ch) => PRICING.buildScanDraft(s, { ...q, baseboardLF: Math.max(q.baseboardLF, 1) }, db, cat, ch) }) },
  { rule: 'J1', what: 'the start promises a price from past jobs', plant: en('office.roomScan.start.body', 'Walk the room once with this iPhone. You get a floor plan, the quantities and a draft price from your own past jobs. A scan is a fast first measure, not a survey.') },
  { rule: 'J1', what: 'Back drops an unsaved scan without asking', plant: text('components/roomScan/RoomScanFlow.tsx', "    else if (step === 'plan' && dirty) setLeaving(true);\n", '') },
  { rule: 'J1', what: 'the saved list is not read again after a push', plant: text('components/roomScan/RoomScanFlow.tsx', 'if (stored) { setDirty(false); await refreshSavedList(); }', 'if (stored) { setDirty(false); }') },
  { rule: 'N4', what: 'the module is moved back under modules/ (autolinked)', plant: (w) => ({ ...w, modulesDirs: [...w.modulesDirs, 'mage-room-scan'] }) },
  { rule: 'N4', what: '.gitignore drops the staged Swift', plant: text('.gitignore', '!/native-staging/*/ios/', '') },
  { rule: 'N4', what: 'package.json points autolinking at the staging folder', plant: text('package.json', '"scripts": {', '"expo": { "autolinking": { "nativeModulesDir": "./native-staging" } },\n  "scripts": {') },
  { rule: 'N5', what: 'the idle timer is set to false instead of what it was', plant: text('native-staging/mage-room-scan/ios/RoomScanSupport.swift', 'UIApplication.shared.isIdleTimerDisabled = prior', 'UIApplication.shared.isIdleTimerDisabled = false') },
  { rule: 'N5', what: 'shouldPresent returns false on an error and tells nobody', plant: text('native-staging/mage-room-scan/ios/RoomScanSupport.swift', '      onMain { self.fail(message) }\n      return false', '      return false') },
  { rule: 'N5', what: 'a scanner dismissed from outside never settles', plant: text('native-staging/mage-room-scan/ios/RoomScanSupport.swift', 'if leaving, let pending = take() {', 'if false, let pending = take() {') },
  { rule: 'N5', what: 'present does not reject when nothing was presented', plant: text('native-staging/mage-room-scan/ios/RoomScanSupport.swift', 'scanner.abandon()?(.failure(Exceptions.RoomScanNoPresenter()))', '_ = scanner') },
  { rule: 'N5', what: 'warnings are appended on RoomPlan\'s queue', plant: text('native-staging/mage-room-scan/ios/RoomScanSupport.swift', 'onMain { if !self.warnings.contains(name) { self.warnings.append(name) } }', 'if !warnings.contains(name) { warnings.append(name) }') },
  { rule: 'N8', what: 'the checklist loses the otool weak-link check', plant: text('docs/scan-the-room-native-checklist.md', /otool -L/g, 'a look at') },
  { rule: 'N8', what: 'the checklist accepts a simulator for the iOS 15 launch', plant: text('docs/scan-the-room-native-checklist.md', /PHYSICAL iOS 15 phone/, 'iOS 15 phone or simulator that') },
  { rule: 'N1', what: 'the flag is turned on', plant: (w) => mods({ flag: true })(text('constants/featureFlags.ts', 'export const SCAN_ROOM_ENABLED = false;', 'export const SCAN_ROOM_ENABLED = true;')(w)) },
  { rule: 'N2', what: 'the route mounts the screen with the flag off', plant: text('app/scan-room.tsx', /  if \(!SCAN_ROOM_ENABLED\) return <Redirect href="\/\(tabs\)\/\(home\)" \/>;\n  return <ScanRoomScreen \/>;/, '  return <ScanRoomScreen />;') },
  { rule: 'N3', what: 'the project page links to the route', plant: outside('app/project-detail.tsx', "\nrouter.push({ pathname: '/scan-room', params: { projectId: id } });\n") },
  { rule: 'N3', what: 'another screen imports the flow', plant: outside('app/area-takeoff.tsx', "\nimport { RoomScanFlow } from '@/components/roomScan/RoomScanFlow';\n") },
  { rule: 'N3', what: 'a second file reads the flag', plant: outside('components/DesktopSidebar.tsx', "\nimport { SCAN_ROOM_ENABLED } from '@/constants/featureFlags';\n") },
  { rule: 'N4', what: 'the lookup moves to module scope', plant: text('utils/roomScan/native.ts', 'let looked = false;', "const Native = requireOptionalNativeModule<MageRoomScanNative>('MageRoomScan');\nlet looked = false;") },
  { rule: 'N4', what: 'the lookup uses requireNativeModule', plant: text('utils/roomScan/native.ts', "cached = requireOptionalNativeModule<MageRoomScanNative>('MageRoomScan');", "cached = requireNativeModule<MageRoomScanNative>('MageRoomScan');") },
  { rule: 'N4', what: 'the lookup no longer checks the flag', plant: text('utils/roomScan/native.ts', '  if (!SCAN_ROOM_ENABLED) return null;\n', '') },
  { rule: 'N4', what: 'a screen names the native module', plant: text('components/roomScan/RoomScanFlow.tsx', "type Step = 'start'", "const MODULE = 'MageRoomScan';\ntype Step = 'start'") },
  { rule: 'N4', what: 'the podspec raises the iOS floor', plant: text('native-staging/mage-room-scan/ios/MageRoomScan.podspec', ":ios => '15.1'", ":ios => '16.0'") },
  { rule: 'N4', what: 'the module package gets a JS entry point', plant: text('native-staging/mage-room-scan/package.json', '"private": true,', '"private": true,\n  "main": "index.js",') },
  { rule: 'N5', what: 'the scanner controller loses its iOS 16 mark', plant: text('native-staging/mage-room-scan/ios/RoomScanSupport.swift', '@available(iOS 16.0, *)\ninternal final class RoomScanViewController', 'internal final class RoomScanViewController') },
  { rule: 'N5', what: 'import RoomPlan is unguarded', plant: text('native-staging/mage-room-scan/ios/RoomScanSupport.swift', '#if canImport(RoomPlan) && !targetEnvironment(simulator)\nimport RoomPlan\n#endif', 'import RoomPlan') },
  { rule: 'N5', what: 'the module raises the camera prompt', plant: text('native-staging/mage-room-scan/ios/MageRoomScanModule.swift', 'case .authorized: break', 'case .authorized: AVCaptureDevice.requestAccess(for: .video) { _ in }') },
  { rule: 'N6', what: 'no LiDAR and not-in-this-build share one sentence', plant: text('hooks/useRoomScanCopy.ts', "case 'noLidar': return t('office.roomScan.unavailable.noLidarBody'", "case 'noLidar': return t('office.roomScan.unavailable.notInThisBuildBody'") },
  { rule: 'N7', what: 'a screen imports reanimated', plant: text('components/roomScan/FloorPlanView.tsx', "import { AlertTriangle, Check } from 'lucide-react-native';", "import { AlertTriangle, Check } from 'lucide-react-native';\nimport Animated from 'react-native-reanimated';") },
  { rule: 'N7', what: 'a screen writes a colour', plant: text('components/roomScan/styles.ts', 'screen: { flex: 1, backgroundColor: t.bg },', "screen: { flex: 1, backgroundColor: '#ECEDE9' },") },
  { rule: 'N7', what: 'a storage key leaves the owned prefix', plant: text('utils/roomScan/storeCore.ts', "'mageid_room_scans::'", "'roomscans::'") },
  { rule: 'N7', what: 'the route loses the tier gate', plant: text('app/scan-room.tsx', 'if (!canAccess(SCAN_ROOM_FEATURE)) {', 'if (false) {') },
  { rule: 'N7', what: 'a screen uses @expo/vector-icons', plant: text('components/roomScan/RoomScanFlow.tsx', "import { ChevronLeft, Ruler, Trash2 } from 'lucide-react-native';", "import { ChevronLeft, Ruler, Trash2 } from 'lucide-react-native';\nimport { Ionicons } from '@expo/vector-icons';") },
  { rule: 'N7', what: 'a screen carries its own t() key', plant: text('components/roomScan/QuantitiesView.tsx', "const sf = copy.unitWord('SF');", "const sf = t('office.roomScan.unit.sf', 'sq ft');") },
  { rule: 'N8', what: 'app.json gets the scan sentence in this lane', plant: text('app.json', '"NSCameraUsageDescription": "', '"NSCameraUsageDescription": "It also measures a room when you start a room scan. ') },
  { rule: 'N8', what: 'the checklist loses the ten-room test', plant: text('docs/scan-the-room-native-checklist.md', /ten rooms/gi, 'some rooms') },
  { rule: 'W1', what: 'a label goes to sentence case', plant: en('office.roomScan.plan.seeQuantitiesLabel', 'See the quantities') },
  { rule: 'W2', what: 'a sentence loses its period', plant: en('office.roomScan.plan.noteBody', 'A phone scan can be off by an inch or more') },
  { rule: 'W2', what: 'a caption gains a period', plant: en('office.roomScan.q.floorSub', 'Inside the room outline.') },
  { rule: 'W3', what: 'an em dash', plant: en('office.roomScan.q.introBody', 'Worked out from the scan — check before you price.') },
  { rule: 'W3', what: 'an ampersand in Spanish', plant: es('office.roomScan.object.washerDryerLabel', { s: 'Lavadora & secadora', src: sourceHash('Washer And Dryer') }) },
  { rule: 'W3', what: '"e.g."', plant: en('office.roomScan.edit.hintBody', 'Type feet and inches, e.g. 8 ft 2 in.') },
  { rule: 'W3', what: 'an arrow', plant: en('office.roomScan.price.openLabel', 'Open In Estimate →') },
  { rule: 'W4', what: 'the plan promises accuracy', plant: en('office.roomScan.plan.noteBody', 'Scans are accurate to the inch.') },
  { rule: 'W4', what: 'a fact becomes a score', plant: en('office.roomScan.fact.closedBody', 'The outline closed with 98% confidence.') },
  { rule: 'W4', what: 'a catalog price is called yours', plant: en('office.roomScan.source.catalogLabel', 'Your Price') },
  { rule: 'W4', what: 'the copy hook labels a catalog price with the measured label', plant: text('hooks/useRoomScanCopy.ts', "if (source === 'engine') return t('office.roomScan.source.catalogLabel'", "if (source === 'engine') return t('office.roomScan.source.yoursSetLabel'") },
  { rule: 'W5', what: 'a key has no Spanish', plant: es('office.roomScan.plan.noteBody', undefined) },
  { rule: 'W5', what: 'the Spanish drops a placeholder', plant: es('office.roomScan.plan.scannedSub', { s: 'Escaneado el {date}', src: sourceHash('Scanned {date}, {time}') }) },
  { rule: 'W5', what: 'the English changed under the Spanish', plant: en('office.roomScan.tips.doorsBody', 'Close every door.') },
];

if (process.env.LIST === '1') for (const m of MUTATIONS) console.log(`  ${m.rule}: ${m.what}`);
// ── what the bathroom fixture comes to (printed for the report, not a check: G1 and R1 pin the numbers) ──
{
  const { q } = room(REAL, 'bathroom.json');
  const { scan } = room(REAL, 'bathroom.json');
  const d = REAL.M.draft(scan, q, OWN_BOOK(), CATALOG);
  const n = (v: number | null) => (v == null ? 'not known' : v.toFixed(2));
  console.log(`\n  bathroom fixture: floor ${n(q.floorAreaSF)} sq ft, walls ${n(q.netWallSF)} sq ft net of ${n(q.grossWallSF)}, baseboard ${n(q.baseboardLF)} ft`);
  for (const l of d.lines) console.log(`    ${l.name}: ${l.quantity} ${l.unit}${l.rate == null ? ', no price yet' : ` at $${l.rate.toFixed(2)} = $${((l.amountCents as number) / 100).toFixed(2)} (${l.source}${l.claim ? `, ${l.claim.tone}, ${l.claim.jobCount} jobs` : ''})`}`);
  console.log(`    draft total with the test cost book: $${(d.totalCents / 100).toFixed(2)} (${d.ownCount} his own, ${d.catalogCount} catalog, ${d.unpricedCount} with no price)`);
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
    if (!caught) how = 'the rule stayed green';
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (caught) { pass += 1; proven.add(m.rule); }
  else { fail += 1; console.log(`  ✗ ${m.rule}: ${m.what} (${how})`); }
}
const unproven = Object.keys(RULES).map((k) => k.split(' ')[0]).filter((r) => !proven.has(r) && r !== 'W6');
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-scan-room: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
if (fail > 0) process.exit(1);
