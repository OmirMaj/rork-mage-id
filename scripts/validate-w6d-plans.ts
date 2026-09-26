// validate-w6d-plans.ts — wave 6d, lane P1: Plans as a thumbnail grid with
// discipline chips, and the plan viewer's sheet rail and ↑ / ↓ sheet flips
// (desktop web only).
//
// Pure logic first — utils/plans/planDiscipline (which discipline a sheet
// number files under, the chips) and utils/plans/planRail (the rail's set and
// order, the neighbour ↑ / ↓ opens, the stored rail flag) — then source pins
// on the two screens: the grid and the rail are desktop-WEB switches only, the
// arrow keys are page-scope and nothing else, the new route is typed (no
// `as never`), and mageid_plan_rail_open is the only new storage key.
//
// Run: bun scripts/validate-w6d-plans.ts   (package.json: test:w6d-plans)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  disciplineOf, disciplineChips, DISCIPLINE_ORDER, DISCIPLINE_LABEL, type Discipline,
} from '../utils/plans/planDiscipline';
import { PLAN_RAIL_OPEN_KEY, parseRailOpen, railSheets, adjacentSheetId } from '../utils/plans/planRail';

// fileURLToPath + join because the repo path contains a space.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Comments out, so a pin reads code, not prose. */
const code = (rel: string) => src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  ok(name, same, same ? undefined : `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

// ── 1. disciplineOf ─────────────────────────────────────────────────────────
console.log('\ndisciplineOf — the first letter of the designator decides:');
const CASES: [string | undefined, Discipline][] = [
  ['A-101', 'A'], ['A101', 'A'], ['A1.01', 'A'], ['a-101', 'A'], [' A-101 ', 'A'],
  ['FP-101', 'F'], ['AD-1', 'A'], ['ID-101', 'I'], ['EP-2', 'E'],
  ['E0.1', 'E'], ['M-1', 'M'], ['S-201', 'S'], ['C1', 'C'], ['G-001', 'G'],
  ['L 101', 'L'], ['P_201', 'P'], ['Q-1', 'Q'], ['W-100', 'W'], ['Z-1', 'Z'], ['O-1', 'O'],
  ['x-9', 'X'],
  ['1', 'unnumbered'], ['101', 'unnumbered'], ['Cover', 'unnumbered'], ['', 'unnumbered'],
  [undefined, 'unnumbered'], ['   ', 'unnumbered'], ['ABC-1', 'unnumbered'], ['A--1', 'unnumbered'],
  ['Y-1', 'unnumbered'], ['J-2', 'unnumbered'], ['N-3', 'unnumbered'], ['K-4', 'unnumbered'], ['U-5', 'unnumbered'],
];
for (const [input, want] of CASES) eq(`disciplineOf(${JSON.stringify(input)}) = ${want}`, disciplineOf(input), want);

console.log('\nthe NCS order and labels:');
eq('DISCIPLINE_ORDER is the US National CAD Standard order, unnumbered last', DISCIPLINE_ORDER,
  ['G', 'H', 'V', 'B', 'W', 'C', 'L', 'S', 'A', 'I', 'Q', 'F', 'P', 'D', 'M', 'E', 'T', 'R', 'X', 'Z', 'O', 'unnumbered']);
ok('every discipline in the order has a label, and nothing else does',
  DISCIPLINE_ORDER.every((d) => typeof DISCIPLINE_LABEL[d] === 'string' && DISCIPLINE_LABEL[d].length > 0)
    && Object.keys(DISCIPLINE_LABEL).length === DISCIPLINE_ORDER.length);
eq('labels read in plain words', [DISCIPLINE_LABEL.A, DISCIPLINE_LABEL.S, DISCIPLINE_LABEL.F, DISCIPLINE_LABEL.unnumbered],
  ['Architectural', 'Structural', 'Fire protection', 'Unnumbered']);

// ── 2. disciplineChips ─────────────────────────────────────────────────────
console.log('\ndisciplineChips — All first, then only the present disciplines, in order:');
const SET = [
  { sheetNumber: 'S-201' }, { sheetNumber: 'A-102' }, { sheetNumber: undefined }, { sheetNumber: 'A-101' },
  { sheetNumber: 'E-1' }, { sheetNumber: 'G-001' }, { sheetNumber: 'FP-1' }, { sheetNumber: 'Cover' },
];
eq('chips for a mixed set', disciplineChips(SET), [
  { value: 'all', label: 'All', count: 8 },
  { value: 'G', label: 'General', count: 1 },
  { value: 'S', label: 'Structural', count: 1 },
  { value: 'A', label: 'Architectural', count: 2 },
  { value: 'F', label: 'Fire protection', count: 1 },
  { value: 'E', label: 'Electrical', count: 1 },
  { value: 'unnumbered', label: 'Unnumbered', count: 2 },
]);
eq('the golden set (A-101, S-201, Cover) reads All 3, Architectural 1, Structural 1, Unnumbered 1',
  disciplineChips([{ sheetNumber: 'A-101' }, { sheetNumber: 'S-201' }, { sheetNumber: undefined }]).map((c) => `${c.label} ${c.count}`),
  ['All 3', 'Structural 1', 'Architectural 1', 'Unnumbered 1']);
eq('an empty set is only All 0', disciplineChips([]), [{ value: 'all', label: 'All', count: 0 }]);
const CHIPS = disciplineChips(SET);
ok('no chip ever has a zero count past All', CHIPS.slice(1).every((c) => c.count > 0));
ok('the chip counts past All add up to All', CHIPS.slice(1).reduce((n, c) => n + c.count, 0) === CHIPS[0].count);

// ── 3. railSheets ──────────────────────────────────────────────────────────
console.log('\nrailSheets — the live set in natural sheet order, unnumbered last:');
type S = { id: string; name: string; sheetNumber?: string; superseded?: boolean };
const RAIL: S[] = [
  { id: 'cover', name: 'Cover' },
  { id: 'a10', name: 'Sections', sheetNumber: 'A-10' },
  { id: 's201', name: 'Foundation', sheetNumber: 'S-201' },
  { id: 'a2', name: 'Floor plan', sheetNumber: 'A-2' },
  { id: 'a2old', name: 'Floor plan', sheetNumber: 'A-2', superseded: true },
  { id: 'index', name: 'Index' },
  { id: 'a1', name: 'Site', sheetNumber: 'a-1' },
];
const ids = (list: { id: string }[]) => list.map((s) => s.id);
eq('A-2 before A-10 (numeric), case-insensitive, unnumbered last by name', ids(railSheets(RAIL, 'a2')),
  ['a1', 'a2', 'a10', 's201', 'cover', 'index']);
eq('a superseded sheet is left off the rail', ids(railSheets(RAIL, 's201')).includes('a2old'), false);
eq('…unless it is the sheet open now (then it sits in number order)', ids(railSheets(RAIL, 'a2old')),
  ['a1', 'a2', 'a2old', 'a10', 's201', 'cover', 'index']);
eq('two sheets with one number fall back to the name', ids(railSheets([
  { id: 'b', name: 'Zeta', sheetNumber: 'M-1' }, { id: 'a', name: 'Alpha', sheetNumber: 'M-1' },
], 'a')), ['a', 'b']);
eq('a blank sheet number counts as unnumbered', ids(railSheets([
  { id: 'blank', name: 'Blank', sheetNumber: '  ' }, { id: 'e', name: 'Power', sheetNumber: 'E-1' },
], 'e')), ['e', 'blank']);
ok('railSheets never mutates its input', JSON.stringify(RAIL.map((s) => s.id)) === JSON.stringify(['cover', 'a10', 's201', 'a2', 'a2old', 'index', 'a1']));

// ── 4. adjacentSheetId ─────────────────────────────────────────────────────
console.log('\nadjacentSheetId — no wrap:');
const LIST = railSheets(RAIL, 'a2');
eq('↓ from A-2 is A-10', adjacentSheetId(LIST, 'a2', 1), 'a10');
eq('↑ from A-2 is A-1', adjacentSheetId(LIST, 'a2', -1), 'a1');
eq('↑ at the top is null', adjacentSheetId(LIST, 'a1', -1), null);
eq('↓ at the bottom is null', adjacentSheetId(LIST, 'index', 1), null);
eq('a sheet not on the rail has no neighbour', adjacentSheetId(LIST, 'nope', 1), null);
eq('an empty rail has no neighbour', adjacentSheetId([], 'a2', 1), null);
eq('a one-sheet rail has no neighbour', [adjacentSheetId([{ id: 'x' }], 'x', 1), adjacentSheetId([{ id: 'x' }], 'x', -1)], [null, null]);

// ── 5. parseRailOpen / the key ──────────────────────────────────────────────
console.log('\nthe stored rail flag:');
eq('PLAN_RAIL_OPEN_KEY', PLAN_RAIL_OPEN_KEY, 'mageid_plan_rail_open');
eq("'false' reads closed", parseRailOpen('false'), false);
eq("'true' reads open", parseRailOpen('true'), true);
eq('missing reads open', [parseRailOpen(null), parseRailOpen(undefined)], [true, true]);
eq('garbage reads open', [parseRailOpen(''), parseRailOpen('0'), parseRailOpen('FALSE '), parseRailOpen('{}')], [true, true, true, true]);

// ── 6. Source pins ──────────────────────────────────────────────────────────
console.log('\nsource pins — app/plans.tsx:');
const plans = code('app/plans.tsx');
const tileAll = plans.match(/<TileGrid\b/g)?.length ?? 0;
const tileGated = plans.match(/isDesktopWeb \? <TileGrid preset="action" testID="plans-sheet-grid">\{cards\}<\/TileGrid> : cards/g)?.length ?? 0;
ok('<TileGrid preset="action"> renders only inside the isDesktopWeb ternary (the phone renders `cards` bare)', tileAll === 1 && tileGated === 1,
  `TileGrid tags ${tileAll}, gated ${tileGated}`);
ok('the phone list maps the same `shownSheets`, which is `sheets` unless desktop web picked a discipline',
  /const shownSheets = isDesktopWeb && discipline !== 'all' && chips\.some\(c => c\.value === discipline\)\s*\?\s*sheets\.filter\(s => disciplineOf\(s\.sheetNumber\) === discipline\)\s*:\s*sheets;/.test(plans)
    && /const cards = shownSheets\.map\(/.test(plans));
ok('the discipline chips render on desktop web only', /\{isDesktopWeb && sheets\.length > 0 \? \(\s*<FilterChipRow chips=\{chips\} value=\{discipline\} onChange=\{setDiscipline\} testID="plans-discipline-chips" \/>\s*\) : null\}/.test(plans));
for (const st of ['sheetCardDesktop', 'sheetThumbWrapDesktop', 'sheetDeleteDesktop']) {
  const all = plans.match(new RegExp(`styles\\.${st}\\b`, 'g'))?.length ?? 0;
  const gated = plans.match(new RegExp(`isDesktopWeb && styles\\.${st}\\b`, 'g'))?.length ?? 0;
  ok(`styles.${st} is appended only as \`isDesktopWeb && …\``, all === 1 && gated === 1, `uses ${all}, gated ${gated}`);
}
ok('the chevron drops on desktop web only (today’s element in the else branch)',
  /\{isDesktopWeb \? null : <ChevronRight size=\{16\} color=\{themeColors\.textMuted\} strokeWidth=\{1\.75\} \/>\}/.test(plans));
ok('plans.tsx reads no browser storage', !/AsyncStorage|localStorage/.test(plans));

console.log('\nsource pins — app/plan-viewer.tsx:');
const viewer = code('app/plan-viewer.tsx');
const hotkeyCalls = [...viewer.matchAll(/useHotkeys\(\[([\s\S]*?)\], \{([^}]*)\}\);/g)];
ok('the viewer mounts exactly one useHotkeys', hotkeyCalls.length === 1, `found ${hotkeyCalls.length}`);
const combos = hotkeyCalls.flatMap((m) => [...m[1].matchAll(/combo: '([^']+)'/g)].map((c) => c[1]));
eq("…binding only 'arrowup' and 'arrowdown'", combos, ['arrowup', 'arrowdown']);
ok("…in scope 'page', enabled only on desktop web with 2+ sheets on the rail",
  hotkeyCalls.length === 1 && /scope: 'page', enabled: isDesktopWeb && rail\.length > 1/.test(hotkeyCalls[0][2]));
ok('…never overriding the typing guard (no allowInInput)', hotkeyCalls.every((m) => !/allowInInput/.test(m[1])));
ok('…each arrow flips through adjacentSheetId, up = -1, down = 1',
  hotkeyCalls.length === 1
    && /combo: 'arrowup', handler: \(\) => \{ const id = adjacentSheetId\(rail, sheet\?\.id \?\? '', -1\); if \(id\) openSheet\(id\); \}/.test(hotkeyCalls[0][1])
    && /combo: 'arrowdown', handler: \(\) => \{ const id = adjacentSheetId\(rail, sheet\?\.id \?\? '', 1\); if \(id\) openSheet\(id\); \}/.test(hotkeyCalls[0][1]));
const openSheet = /const openSheet = useCallback\(\(id: string\) => \{([\s\S]*?)\}, \[sheet, router\]\);/.exec(viewer);
ok('the flip is a typed router.replace to /plan-viewer — no `as never`',
  !!openSheet && /router\.replace\(\{ pathname: '\/plan-viewer', params: \{ sheetId: id \} \}\)/.test(openSheet[1]) && !/as never/.test(openSheet[1]));
const asNeverBase = { 'app/plans.tsx': 15, 'app/plan-viewer.tsx': 14 };
for (const [f, n] of Object.entries(asNeverBase)) {
  const now = src(f).match(/as never/g)?.length ?? 0;
  ok(`${f} adds no \`as never\` (base ${n})`, now <= n, `now ${now}`);
}
for (const [st, want] of [['toolbarDesktop', 1], ['toolBtnDesktop', 6]] as const) {
  const all = viewer.match(new RegExp(`styles\\.${st}\\b`, 'g'))?.length ?? 0;
  const gated = viewer.match(new RegExp(`isDesktopWeb && styles\\.${st}\\b`, 'g'))?.length ?? 0;
  ok(`styles.${st} is appended only as \`isDesktopWeb && …\` (never isDesktop: an Android tablet has no row wrapper)`, all === want && gated === want,
    `uses ${all}, gated ${gated}, want ${want}`);
}
ok('the rail and the side toolbar sit behind one isDesktopWeb ternary; the phone renders canvas, hint, toolbar as siblings',
  /\{isDesktopWeb \? \(\s*<View style=\{styles\.bodyRow\}>[\s\S]*?<PlanSheetRail [\s\S]*?\{toolbarEl\}\s*<\/View>\s*\) : \(\s*<>\s*(?:\{\}\s*)?\{canvasEl\}\s*(?:\{\}\s*)?\{hintEl\}\s*(?:\{\}\s*)?\{toolbarEl\}\s*<\/>\s*\)\}/.test(viewer));
ok('the hoisted header scale pill comes before the toolbar (validate-plan-scale-frame reads the first Re-check alert)',
  viewer.indexOf('const scalePillEl = ') > 0 && viewer.indexOf('const scalePillEl = ') < viewer.indexOf('const toolbarEl = ')
    && viewer.indexOf('{scalePillEl}') > viewer.indexOf('const toolbarEl = '));
ok('the rail toggle renders on desktop web only', /\{isDesktopWeb \? \(\s*<TouchableOpacity\s+onPress=\{toggleRail\}/.test(viewer));
ok('the stored flag is read only on desktop web', /useEffect\(\(\) => \{\s*if \(!isDesktopWeb\) return undefined;/.test(viewer));

console.log('\nstorage — mageid_plan_rail_open is the only new key:');
const OWNED = ['app/plans.tsx', 'app/plan-viewer.tsx', 'components/plans/PlanSheetRail.tsx', 'utils/plans/planDiscipline.ts', 'utils/plans/planRail.ts'];
const keys = OWNED.flatMap((f) => [...src(f).matchAll(/['"`](mageid_[a-z0-9_]+)/g)].map((m) => `${f}:${m[1]}`));
eq('the only mageid_ literal in the lane’s files is PLAN_RAIL_OPEN_KEY', keys, ['utils/plans/planRail.ts:mageid_plan_rail_open']);
const storageCalls = OWNED.flatMap((f) => [...code(f).matchAll(/AsyncStorage\.(\w+)\(([^,)]*)/g)].map((m) => ({ f, fn: m[1], key: m[2].trim() })));
ok('every AsyncStorage call reads or writes PLAN_RAIL_OPEN_KEY and nothing else',
  storageCalls.length === 2 && storageCalls.every((c) => c.f === 'app/plan-viewer.tsx' && (c.fn === 'getItem' || c.fn === 'setItem') && c.key === 'PLAN_RAIL_OPEN_KEY'),
  JSON.stringify(storageCalls));
ok('…each inside a try', [...viewer.matchAll(/(.{0,12})await AsyncStorage\.(getItem|setItem)\(PLAN_RAIL_OPEN_KEY/g)].length === 2
  && [...viewer.matchAll(/try \{ (?:raw = )?await AsyncStorage\.(?:getItem|setItem)\(PLAN_RAIL_OPEN_KEY/g)].length === 2);

console.log('\ncomponents/plans/PlanSheetRail.tsx:');
const railSrc = code('components/plans/PlanSheetRail.tsx');
ok('returns null below the desktop gate, after its hooks', /if \(!isDesktop\) return null;/.test(railSrc)
  && railSrc.indexOf('if (!isDesktop) return null;') > railSrc.lastIndexOf('useEffect('));
ok('every row is a button carrying its selected state and testID plan-rail-<id>',
  /<Pressable[\s\S]*?accessibilityRole="button"\s+accessibilityState=\{\{ selected \}\}[\s\S]*?testID=\{`plan-rail-\$\{s\.id\}`\}/.test(railSrc));
ok('the active row is surfaceAlt with an accent edge — the accent is never a fill',
  /railRowActive: \{ backgroundColor: t\.surfaceAlt, borderLeftColor: t\.accent \}/.test(railSrc) && !/backgroundColor: t\.accent/.test(railSrc));
ok('the rail surface has no radius (not a hand-rolled card)', /rail: \{\s*width: Layout\.column\.index,\s*borderRightWidth: 1,\s*borderRightColor: t\.line,\s*backgroundColor: t\.surface,\s*\}/.test(railSrc));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
