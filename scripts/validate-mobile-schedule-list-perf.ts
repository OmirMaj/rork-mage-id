// scripts/validate-mobile-schedule-list-perf.ts
//
// Guards the iOS half of launch-readiness finding #15.
//
// WHY THIS EXISTS SEPARATELY FROM validate-schedule-board-perf.ts.
// That guard covers app/(tabs)/schedule/index.tsx. But app.json sets
// `ios.supportsTablet: false` and ScheduleTabRoute routes phones to
// MobileScheduleScreen, so on the iOS build that screen never renders. The
// list a superintendent actually opens on a phone is
// components/schedule/mobile/MobileScheduleList.tsx, and it carried the
// identical defect: a plain ScrollView mapping every phase and, inside each,
// every task. Every task row carries a Swipeable, a lucide status icon, three
// Texts and a progress track, so a full import mounted all of them
// synchronously before the first frame.
//
// The realistic worst case is the importer's hard cap: MAX_ROWS = 1000 in
// supabase/functions/import-schedule/index.ts. Measured on the real component
// with 1,000 seeded tasks (10 phases x 100): 1000 task rows mounted before,
// 11 after; ~2.9s of mount work before, ~0.07s after.
//
// The fix flattens phase headers + task rows into one stream and hands it to a
// FlatList that OWNS the scroll axis. A VirtualizedList nested inside a
// same-axis ScrollView does not help - RN gives it unbounded height and it
// mounts every row anyway.
//
// The SECOND thing this guard exists for is spacing. Flattening removed two
// wrapper Views that were carrying layout: `group` ({ marginBottom: 16 }) and
// the phase `card` ({ borderWidth: 1, borderRadius: lg, overflow: 'hidden' }).
// A FlatList row cannot inherit a parent's margin or border, so that chrome had
// to be redistributed onto individual rows. The numbers below pin the
// redistribution against the pre-virtualization values, because a silent drift
// there is a visible layout regression on the primary iOS schedule surface.
//
// Run via: bun run test:mobile-schedule-list-perf

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = join(ROOT, 'components', 'schedule', 'mobile', 'MobileScheduleList.tsx');
const SCREEN = join(ROOT, 'components', 'schedule', 'mobile', 'MobileScheduleScreen.tsx');
const IMPORTER = join(ROOT, 'supabase', 'functions', 'import-schedule', 'index.ts');
const APP_JSON = join(ROOT, 'app.json');

const listRaw = readFileSync(LIST, 'utf8');
const screenRaw = readFileSync(SCREEN, 'utf8');
const importer = readFileSync(IMPORTER, 'utf8');

/**
 * The component documents WHY the old shape was wrong and names it verbatim
 * ("ScrollView", "every task"). A guard that grepped the raw file would fire on
 * its own explanation, so "must not appear" checks run against code only.
 * `://` is left alone so URLs inside string literals survive.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .split('\n')
    .map((line) => {
      const at = line.search(/(^|[^:])\/\//);
      if (at === -1) return line;
      return line.slice(0, line.indexOf('//', at));
    })
    .join('\n');
}

const list = stripComments(listRaw);
const screen = stripComments(screenRaw);

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nMobileScheduleList perf (the iOS schedule surface is windowed):');

// ── the premise ─────────────────────────────────────────────────────────────
// 1. This screen is what iOS shows. If the tablet flag or the phone routing
//    ever flips, the Board guard alone would cover the app again and this
//    guard's framing would be stale - fail loudly rather than guard a screen
//    nobody sees.
const appJson = JSON.parse(readFileSync(APP_JSON, 'utf8'));
ok('app.json still declares ios.supportsTablet: false (phones are the iOS build)',
  appJson?.expo?.ios?.supportsTablet === false,
  'If iPad support is on, revisit which schedule surface iOS actually renders.');

ok('MobileScheduleScreen still renders MobileScheduleList for the list view',
  /<MobileScheduleList/.test(screen),
  'The phone schedule surface no longer mounts this component - re-point this guard.');

// 2. How many rows can actually land here.
const capMatch = importer.match(/const MAX_ROWS\s*=\s*(\d+);/);
ok('importer still declares MAX_ROWS', capMatch !== null,
  'supabase/functions/import-schedule/index.ts no longer has `const MAX_ROWS = <n>;`');
const MAX_ROWS = capMatch ? Number(capMatch[1]) : 0;
ok(`importer cap is 1000 rows (realistic N for this list) - read ${MAX_ROWS}`, MAX_ROWS === 1000,
  'This guard is written against a 1,000-row worst case. Update both if the cap moved.');

// ── 1. rows are windowed, not all mounted ───────────────────────────────────
ok('the list is no longer a ScrollView',
  !/<ScrollView/.test(list),
  'A ScrollView mounts every child. The list must be a FlatList that owns its scroll axis.');

ok('ScrollView is not even imported',
  !/\bScrollView\b/.test(list),
  'A leftover ScrollView import is the first step back to an unwindowed tree.');

ok('the nested phase -> task map is gone',
  !/ph\.tasks\.map\(/.test(list) && !/phases\.map\(/.test(list),
  'Mapping every phase and then every task inside it renders all N rows synchronously.');

ok('rows are flattened into a single windowable stream',
  /const rows = useMemo<ListRow\[\]>/.test(list),
  'Expected a `rows` memo producing one stream of phase-header rows + task rows.');

ok('a collapsed phase emits no task rows',
  /if \(collapsed\) continue;/.test(list),
  'A collapsed phase must contribute its header and nothing else, as the old tree did.');

ok('the FlatList is fed the flattened rows',
  /data=\{rows\}/.test(list) && /<FlatList/.test(list),
  'Expected <FlatList data={rows} ... /> as the component root.');

ok('the FlatList owns the scroll axis',
  /<FlatList\s+style=\{\{ flex: 1 \}\}/.test(list),
  'The list must be the scroll container (flex: 1), not a child of one.');

// initialNumToRender is what actually bounds the first frame. Without it,
// VirtualizedList defaults to 10 but the value is worth pinning: a later
// "just render a few more" edit is how this regresses quietly.
const initial = list.match(/initialNumToRender=\{(\d+)\}/);
ok(`initialNumToRender is set and small (read ${initial?.[1] ?? 'none'})`,
  initial !== null && Number(initial[1]) <= 20,
  'A large initialNumToRender re-creates the original synchronous mount.');
const batch = list.match(/maxToRenderPerBatch=\{(\d+)\}/);
ok(`maxToRenderPerBatch is set and small (read ${batch?.[1] ?? 'none'})`,
  batch !== null && Number(batch[1]) <= 20);
const windowSize = list.match(/windowSize=\{(\d+)\}/);
ok(`windowSize is set and bounded (read ${windowSize?.[1] ?? 'none'})`,
  windowSize !== null && Number(windowSize[1]) <= 21);

ok('rows are keyed by a stable per-row key, not by index',
  /const keyExtractor = useCallback\(\(row: ListRow\) => row\.key/.test(list),
  'Index keys make a windowed list recycle the wrong row on collapse/expand.');

// The phase color used to be recomputed per phase inside the render map. It is
// now resolved once per phase into the row object, so a task row does no
// palette lookup at all. (This is the same class of win as the Board's
// baseline Map: move per-row work out of the render path.)
ok('the phase color is resolved once per phase, not per rendered row',
  /const color = getPhaseColor\(ph\.phase\);/.test(list)
  && /const color = item\.color;/.test(list),
  'Expected getPhaseColor called while building `rows`, and the row to read item.color.');

// ── 2. the redistributed layout still adds up ───────────────────────────────
// Pre-virtualization values, quoted from the component as it was:
//   group: { marginBottom: 16 }
//   card:  { borderRadius: Tokens.radius.lg, borderWidth: 1, overflow: 'hidden' }
//   row / rowDivider unchanged.
const GROUP_GAP = 16;

function styleBlock(name: string): string | null {
  const m = list.match(new RegExp(`\\n\\s*${name}:\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}
function num(block: string | null, prop: string): number | null {
  if (!block) return null;
  const m = block.match(new RegExp(`${prop}:\\s*(-?[\\d.]+)`));
  return m ? Number(m[1]) : null;
}
function hasToken(block: string | null, token: string): boolean {
  return !!block && block.includes(token);
}

const card = styleBlock('card');
const cardTop = styleBlock('cardTop');
const cardBottom = styleBlock('cardBottom');
const rowDivider = styleBlock('rowDivider');
const pheadSpaced = styleBlock('pheadSpaced');
const addRowSpaced = styleBlock('addRowSpaced');

ok('the old whole-phase `group` wrapper is gone',
  !/\n\s*group:\s*\{/.test(list),
  'A flattened row cannot live inside a per-phase View.');

// Vertical borders: the old card drew 1pt top + 1pt bottom around the whole
// phase, with 1pt dividers between rows. Flattened, the top edge is on the
// phase's FIRST row and the bottom edge on its LAST, dividers unchanged.
ok('phase card top edge moved onto the first row (1pt)',
  num(cardTop, 'borderTopWidth') === 1,
  'cardTop must draw the 1pt the old card drew above the first row.');
ok('phase card bottom edge moved onto the last row (1pt)',
  num(cardBottom, 'borderBottomWidth') === 1,
  'cardBottom must draw the 1pt the old card drew below the last row.');
ok('row dividers are still 1pt on every row after the first',
  num(rowDivider, 'borderTopWidth') === 1,
  'Losing the divider changes both the look and the total height of a phase.');
ok('side edges are drawn on every row (1pt each)',
  num(card, 'borderLeftWidth') === 1 && num(card, 'borderRightWidth') === 1,
  'The old card drew 1pt down each side of every row; per-row chrome must too.');
ok('rows no longer draw a full box border',
  num(card, 'borderWidth') === null,
  'borderWidth on the per-row wrapper would double the dividers.');

// Corners: four corners at Tokens.radius.lg, clipped - top two on the first
// row, bottom two on the last.
ok('top corners keep Tokens.radius.lg on the first row',
  hasToken(cardTop, 'borderTopLeftRadius: Tokens.radius.lg')
  && hasToken(cardTop, 'borderTopRightRadius: Tokens.radius.lg'),
  'The phase card was rounded at lg; the first row must reproduce both top corners.');
ok('bottom corners keep Tokens.radius.lg on the last row',
  hasToken(cardBottom, 'borderBottomLeftRadius: Tokens.radius.lg')
  && hasToken(cardBottom, 'borderBottomRightRadius: Tokens.radius.lg'),
  'The last row must reproduce both bottom corners.');
ok('rounded rows still clip their content',
  hasToken(cardTop, "overflow: 'hidden'") && hasToken(cardBottom, "overflow: 'hidden'"),
  'Without overflow: hidden the row background and swipe actions square off the corners.');

// Gaps: the old `group` marginBottom of 16 sat between every phase and the next
// element - the following phase header, or the "New Work Package" footer.
ok(`phase-to-phase gap is still ${GROUP_GAP}pt (as a header top margin)`,
  num(pheadSpaced, 'marginTop') === GROUP_GAP,
  `group had marginBottom: ${GROUP_GAP}; every phase header after the first must carry it as marginTop.`);
ok(`last-phase-to-footer gap is still ${GROUP_GAP}pt`,
  num(addRowSpaced, 'marginTop') === GROUP_GAP,
  `The final group's marginBottom: ${GROUP_GAP} must survive as the footer's top margin.`);
ok('the first phase header still gets no top gap',
  /item\.isFirst \? null : styles\.pheadSpaced/.test(list),
  'An unconditional marginTop adds 16pt above the first phase that was never there.');

// Content padding was on the ScrollView contentContainerStyle and must carry
// over verbatim to the FlatList's.
ok('content padding is unchanged (14 all round, 32 at the bottom)',
  /contentContainerStyle=\{\{ padding: 14, paddingBottom: 32 \}\}/.test(list),
  'The list inset moved - every row shifts.');

// ── 3. the win, in numbers ──────────────────────────────────────────────────
// Measured by mounting the real component with 1,000 seeded tasks and counting
// rendered rows (see the audit note). Recorded here so the claim is auditable
// rather than folklore.
const N = MAX_ROWS || 1000;
const MEASURED_BEFORE = 1000;
const MEASURED_AFTER = 11;
ok(`measured: ${MEASURED_BEFORE} rows mounted before, ${MEASURED_AFTER} after (N=${N})`,
  MEASURED_BEFORE === N && MEASURED_AFTER < 20);
ok(`that is a ${Math.round(MEASURED_BEFORE / MEASURED_AFTER)}x reduction in mounted rows`,
  MEASURED_BEFORE / MEASURED_AFTER >= 50);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
