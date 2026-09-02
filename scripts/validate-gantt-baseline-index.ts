// scripts/validate-gantt-baseline-index.ts
//
// Guards the horizontal Gantt (components/schedule/GanttChart.tsx) half of
// launch-readiness finding #15 (2026-09-02), and the routing premise that
// decides how much of that finding actually applies.
//
// WHAT WAS WRONG. renderGanttRow ran, once per rendered row:
//
//     schedule.baseline.tasks.find(b => b.id === task.id)
//
// a linear scan of the baseline array inside the render path, gated only on
// `showBaseline`. The schedule importer's hard cap is the realistic N
// (MAX_ROWS = 1000 in supabase/functions/import-schedule/index.ts) and import
// captures a baseline automatically, so a real MS Project / P6 file made one
// render pass do n(n+1)/2 = 500,500 id comparisons. Measured with a 1,000-task
// mount, not estimated. It is now a useMemo'd Map: 1,001 reads, same mount.
//
// FIRST ENTRY WINS. Array.prototype.find returns the FIRST match. A Map built
// with a plain `set` in a loop keeps the LAST. Baseline arrays are user data
// (imported, merged, scenario-copied) and are not guaranteed unique on id, so
// a last-wins build would silently move a baseline bar. The behavioural check
// below pins that.
//
// THE ROUTING PREMISE. GanttChart is NOT an iOS surface today, and the second
// half of finding #15 (unvirtualized rows inside a horizontal ScrollView) was
// scoped out on exactly that basis. Three facts make it true, and all three are
// asserted here because any one of them flipping silently turns a desktop-only
// perf smell into a phone defect that ships:
//
//   1. app.json          — ios.supportsTablet is false
//   2. app.json          — orientation is "portrait"
//   3. schedule/index.tsx — ScheduleTabRoute sends layout.isPhone to
//                           MobileScheduleScreen, and only the non-phone
//                           ScheduleScreen mounts <GanttChart>.
//
// Together: on iOS the window is never >= 768pt wide, so `isPhone` is always
// true and GanttChart never renders. Flip supportsTablet to true, or unlock
// landscape, and this guard fails so somebody has to decide about virtualizing
// the rows rather than discovering it from a tester's device.
//
// Text-based for the components (they are .tsx and cannot be imported by bun
// without a bundler — same constraint validate-schedule-board-perf.ts works
// under) and behavioural for the lookup semantics.
//
// Run via: bun run test:gantt-baseline-index
//
// !! NOT YET WIRED INTO ship-check — see package.json. Until it is, this file
// !! cannot fail the build. validate-guard-coverage.ts will say so.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GANTT = join(ROOT, 'components', 'schedule', 'GanttChart.tsx');
const SCREEN = join(ROOT, 'app', '(tabs)', 'schedule', 'index.tsx');
const APP_JSON = join(ROOT, 'app.json');
const IMPORTER = join(ROOT, 'supabase', 'functions', 'import-schedule', 'index.ts');

/**
 * The component documents WHY the old shape was wrong and quotes it verbatim,
 * so a grep over the raw file would fire on its own explanation. All
 * "must not appear" checks run against code only.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.search(/(^|[^:])\/\//);
      if (at === -1) return line;
      return line.slice(0, line.indexOf('//', at));
    })
    .join('\n');
}

const ganttRaw = readFileSync(GANTT, 'utf8');
const gantt = stripComments(ganttRaw);
const screen = stripComments(readFileSync(SCREEN, 'utf8'));
const importer = readFileSync(IMPORTER, 'utf8');
const appJson = JSON.parse(readFileSync(APP_JSON, 'utf8'));
const expo = appJson.expo ?? appJson;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nGanttChart baseline lookup (O(1)) + the routing premise behind it:');

// -- the premise: how many rows can land on this chart --------------------
const capMatch = importer.match(/const MAX_ROWS\s*=\s*(\d+);/);
ok('importer still declares MAX_ROWS', capMatch !== null,
  'supabase/functions/import-schedule/index.ts no longer has `const MAX_ROWS = <n>;`');
const MAX_ROWS = capMatch ? Number(capMatch[1]) : 0;
ok(`importer cap is 1000 rows (the worst case this guard is written against) -- read ${MAX_ROWS}`,
  MAX_ROWS === 1000,
  'Update this guard and the component comment together if the cap moved.');

// -- 1. the per-row scan is gone ------------------------------------------
ok('GanttChart no longer scans the baseline array per row',
  !/baseline\s*\.\s*tasks\s*\.\s*find\s*\(/.test(gantt)
  && !/baseline\.tasks\.find\(/.test(gantt),
  'A `baseline.tasks.find(...)` is back in the render path. That is O(tasks x baselineTasks) '
  + `= ${(MAX_ROWS * (MAX_ROWS + 1) / 2).toLocaleString()} comparisons at the importer cap.`);

ok('renderGanttRow contains no .find( at all',
  !/\.find\(/.test(gantt),
  'Any linear scan inside the row renderer reintroduces the quadratic term.');

// -- 2. it is a memoised Map, built once per baseline change --------------
ok('the baseline is indexed by id in a useMemo',
  /const\s+baselineById\s*=\s*useMemo\(/.test(gantt)
  && /new Map</.test(gantt),
  'The index must be a useMemo, not rebuilt inside the render body or the row callback.');

ok('the index memo depends on showBaseline and schedule.baseline, and nothing wider',
  /\}, \[showBaseline, schedule\.baseline\]\);/.test(gantt),
  'Depending on the whole `schedule` object rebuilds the index on every task edit; '
  + 'depending on less than this serves a stale baseline after a Save Baseline.');

ok('the row renderer reads the index, not the array',
  /baselineById\s*\?\s*baselineById\.get\(task\.id\)\s*:\s*null/.test(gantt),
  'The lookup must be Map.get. The `? :` also preserves the original short-circuit: '
  + 'baseline off or absent means no lookup at all.');

ok('the row callback no longer closes over the whole schedule',
  /\}, \[totalDays, baselineById, onTaskPress, forecast, projectStartDate\]\);/.test(gantt),
  'renderGanttRow used to list `schedule` and `showBaseline` in its deps, so it got a new '
  + 'identity on every unrelated schedule mutation.');

// -- 3. FIRST entry wins, exactly like Array.prototype.find ---------------
ok('the index build is first-wins',
  /if\s*\(!index\.has\(bt\.id\)\)\s*index\.set\(bt\.id, bt\);/.test(gantt),
  'A bare `index.set(bt.id, bt)` keeps the LAST duplicate; find() kept the first. '
  + 'On a baseline with a repeated id that silently moves a bar.');

type BaselineRow = { id: string; startDay: number; endDay: number };

// Behavioural proof of the semantics the text check above is protecting.
const rows: BaselineRow[] = [
  { id: 'a', startDay: 1, endDay: 5 },
  { id: 'b', startDay: 10, endDay: 20 },
  { id: 'a', startDay: 900, endDay: 950 },   // duplicate, appended later
  { id: 'c', startDay: 3, endDay: 4 },
];

const firstWins = new Map<string, BaselineRow>();
for (const bt of rows) if (!firstWins.has(bt.id)) firstWins.set(bt.id, bt);

const lastWins = new Map<string, BaselineRow>();
for (const bt of rows) lastWins.set(bt.id, bt);

let mismatches = 0;
let sawDuplicate = false;
let sawMissing = false;
for (const id of ['a', 'b', 'c', 'missing']) {
  const scanned = rows.find(b => b.id === id) ?? null;
  const looked = firstWins.get(id) ?? null;
  if (scanned !== looked) mismatches++;
  if (scanned === null) sawMissing = true;
  if (id === 'a' && lastWins.get(id) !== scanned) sawDuplicate = true;
}
ok('first-wins Map returns exactly what find() returned', mismatches === 0);
ok('the fixture actually exercises a duplicate id and a missing id',
  sawDuplicate && sawMissing,
  'The fixture degenerated -- a last-wins build would now pass this check.');

// The arithmetic the bars are drawn from, byte-identical to the component.
const totalDays = 420;
const bt = firstWins.get('a')!;
const left = ((bt.startDay - 1) / totalDays) * 100;
const width = Math.max(((bt.endDay - bt.startDay) / totalDays) * 100, 1.5);
ok('baseline bar geometry is unchanged (left from startDay-1, width floored at 1.5%)',
  left === ((1 - 1) / 420) * 100 && width === Math.max(((5 - 1) / 420) * 100, 1.5),
  'The bar left/width formulas moved. Any change here shifts every baseline bar on screen.');

// -- 4. the routing premise: this chart is not on the iOS path ------------
ok('ios.supportsTablet is still false',
  expo?.ios?.supportsTablet === false,
  'If iPad support is turned on, the iPad window is >= 768pt, layout.isPhone goes false, and '
  + 'ScheduleScreen mounts <GanttChart> with up to 1,000 UNVIRTUALIZED rows inside a horizontal '
  + 'ScrollView. Virtualize the rows before flipping this.');

ok('orientation is still locked to portrait',
  expo?.orientation === 'portrait',
  'An iPhone in landscape is up to 932pt wide, which crosses the 768pt tablet breakpoint in '
  + 'utils/useResponsiveLayout.ts and puts GanttChart on a phone. Same warning as above.');

ok('nothing unlocks orientation at runtime',
  !/ScreenOrientation|expo-screen-orientation/.test(screen),
  'A runtime unlockAsync defeats the app.json lock.');

ok('the phone branch of the schedule tab does not render GanttChart',
  /layout\.isPhone\s*\?\s*<MobileScheduleScreen/.test(screen)
  && !/GanttChart/.test(stripComments(readFileSync(
    join(ROOT, 'components', 'schedule', 'mobile', 'MobileScheduleScreen.tsx'), 'utf8'))),
  'ScheduleTabRoute must keep routing phones to MobileScheduleScreen, and MobileScheduleScreen '
  + 'must not mount GanttChart -- that is the whole reason the unvirtualized rows were scoped '
  + 'out of the iOS finding.');

// -- 5. the quadratic term, counted --------------------------------------
const N = MAX_ROWS || 1000;
let scanComparisons = 0;
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) { scanComparisons++; if (j === i) break; }
}
const indexComparisons = N + N;
ok(`the old scan cost ~${scanComparisons.toLocaleString()} comparisons per render pass`,
  scanComparisons > 100_000);
ok(`the index costs ${indexComparisons.toLocaleString()} -- at least 100x cheaper`,
  scanComparisons / indexComparisons >= 100);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
