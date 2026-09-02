// scripts/validate-mobile-gantt-perf.ts
//
// Guards the iOS half of launch-readiness finding #15 (2026-09-02).
//
// The Board fix in app/(tabs)/schedule/index.tsx is real but UNREACHABLE on
// iOS: app.json sets ios.supportsTablet:false and ScheduleTabRoute sends phones
// to MobileScheduleScreen, whose Timeline view is
// components/schedule/mobile/MobileGantt.tsx. That component carried the
// identical defect and is guarded here:
//
//   1. UNVIRTUALIZED ROWS. `rows` (the flattened phase/task union) was mapped
//      TWICE inside one plain vertical ScrollView — once for the frozen left
//      WORK PACKAGES column, once for the bars — plus one <Path> per dependency
//      link into a single Svg. Measured at the importer's cap (1,000 tasks,
//      supabase/functions/import-schedule MAX_ROWS): 1,007 left rows + 1,000
//      bars + 1,675 arrow paths mounted before the first frame.
//
//   2. QUADRATIC COLUMN MATH IN WEEKDAY-ONLY MODE. colOf() counted weekdays
//      from day 0 on every call — an O(d) loop doing `new Date(...).getDay()`
//      per step — and barById calls it twice per task. O(tasks x days) with a
//      Date allocation as the inner operation, recomputed on every zoom, drag
//      and phase collapse. This is the same shape as the Board's per-row
//      baseline .find(), and it is replaced by the same kind of fix: index it
//      once, read it O(1).
//
// This gantt is a FROZEN-COLUMN GRID, so unlike the Board it cannot become a
// FlatList: the left column must not scroll horizontally (so it cannot live
// inside the timeline's horizontal ScrollView) yet must scroll vertically in
// lockstep with it, and the timeline carries three full-content-height absolute
// overlays plus an absoluteFill long-press target. It keeps ONE scroll owner
// and windows both columns arithmetically off a uniform ROW_H. That makes the
// window math the thing worth guarding, so this file re-implements it from the
// constants parsed out of the component and proves the two properties that
// make hand-windowing safe:
//
//   COVERAGE  - every row is reachable; no index is skipped by any scroll offset
//   BOUNDED   - the mounted count never grows with N
//
// plus behavioural equivalence of the indexed weekday math against the original
// walk, because a drift there moves every bar on screen.
//
// Run via: bun run test:mobile-gantt-perf

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GANTT = join(ROOT, 'components', 'schedule', 'mobile', 'MobileGantt.tsx');
const IMPORTER = join(ROOT, 'supabase', 'functions', 'import-schedule', 'index.ts');

const ganttRaw = readFileSync(GANTT, 'utf8');
const importer = readFileSync(IMPORTER, 'utf8');

/**
 * The component documents WHY the old shapes were wrong and quotes them
 * verbatim ("rows.map"), so a guard that greps the raw file would fire on its
 * own explanation. The "must not appear" checks run against code only.
 * `://` is left alone so URLs inside string literals survive.
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

const gantt = stripComments(ganttRaw);

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}

console.log('\nMobileGantt perf (windowed rows + indexed weekday columns):');

// ── the premise: how many rows can actually land on this screen ──────────────
const capMatch = importer.match(/const MAX_ROWS\s*=\s*(\d+);/);
ok('importer still declares MAX_ROWS', capMatch !== null,
  'supabase/functions/import-schedule/index.ts no longer has `const MAX_ROWS = <n>;`');
const MAX_ROWS = capMatch ? Number(capMatch[1]) : 0;
ok(`importer cap is 1000 rows (realistic N for this screen) - read ${MAX_ROWS}`, MAX_ROWS === 1000,
  'This guard is written against a 1,000-row worst case. Update both if the cap moved.');

// ── 1. rows are windowed, not all mounted ───────────────────────────────────
ok('neither column maps the full rows array any more',
  !/\brows\.map\(/.test(gantt),
  'rows.map() mounts every phase header and every bar. Render the windowed slice.');

const visibleUses = (gantt.match(/visibleRows\.map\(/g) ?? []).length;
ok(`both columns render the windowed slice (found ${visibleUses})`, visibleUses === 2,
  'The frozen left column AND the timeline bars must both render `visibleRows`.');

ok('the slice comes from one [firstRow, lastRow) window',
  /const visibleRows = useMemo\(\(\) => rows\.slice\(firstRow, lastRow\)/.test(gantt),
  'Expected `rows.slice(firstRow, lastRow)` so both columns are guaranteed the same rows.');

ok('the rows outside the window are replaced by exact-height spacers',
  /const topSpacerH = firstRow \* ROW_H;/.test(gantt)
  && /const bottomSpacerH = \(rows\.length - lastRow\) \* ROW_H;/.test(gantt),
  'Without spacers of exactly N * ROW_H the left column shortens and the two columns desync.');

ok('the single scroll owner drives the window',
  /onScroll=\{onOuterScroll\}/.test(gantt)
  && /onLayout=\{onOuterLayout\}/.test(gantt)
  && /scrollEventThrottle=\{16\}/.test(gantt)
  && /onLayout=\{onGridLayout\}/.test(gantt),
  'The outer ScrollView must report scroll + viewport, and the grid must report where row 0 starts.');

ok('dependency arrows are banded to the window too',
  /a\.y1 < bandTop \|\| a\.y0 > bandBottom \? null/.test(gantt),
  'A 1,000-task import emits ~1,000 <Path> nodes into one Svg unless they are banded.');

// ── 2. weekday-only column math is indexed, not re-walked ───────────────────
ok('the weekday index is built once per anchor/span',
  /const weekdayIndex = useMemo\(/.test(gantt)
  && /colAt = new Int32Array\(/.test(gantt),
  'Expected a memo producing colAt (weekdays before day d) and dayAt (day of column c).');

ok('colOf reads the index instead of walking',
  /return weekdayIndex\.colAt\[upper\];/.test(gantt),
  'colOf must be an O(1) lookup; the walk survives only as an out-of-range fallback.');

ok('colToDay reads the index instead of walking',
  /return weekdayIndex\.dayAt\[target\] \?\? weekdayIndex\.span;/.test(gantt),
  'colToDay must be an O(1) lookup with the old loop-ran-off-the-end value as the fallback.');

// ── 3. the window arithmetic, re-implemented from the component's constants ─
// Parsed rather than hard-coded: if someone retunes the overscan, this guard
// re-proves coverage at the NEW numbers instead of silently guarding the old.
function num(name: string): number {
  const m = gantt.match(new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`));
  if (!m) { fail++; console.log('  FAIL  could not read', name, 'from MobileGantt.tsx'); return NaN; }
  return Number(m[1]);
}
const ROW_H = num('ROW_H');
const OVERSCAN_ROWS = num('OVERSCAN_ROWS');
const SCROLL_BLOCK_ROWS = num('SCROLL_BLOCK_ROWS');
const INITIAL_ROWS = num('INITIAL_ROWS');
ok(`constants read: ROW_H=${ROW_H} OVERSCAN=${OVERSCAN_ROWS} BLOCK=${SCROLL_BLOCK_ROWS} INITIAL=${INITIAL_ROWS}`,
  [ROW_H, OVERSCAN_ROWS, SCROLL_BLOCK_ROWS, INITIAL_ROWS].every((n) => Number.isFinite(n) && n > 0));

// The formulas are asserted textually so this mirror cannot drift from the
// component without the guard failing first.
ok('the window formula in the component is the one modelled here',
  /const block = Math\.max\(0, Math\.floor\(y \/ \(ROW_H \* SCROLL_BLOCK_ROWS\)\)\);/.test(gantt)
  && /const top = Math\.min\(scrollBlock \* SCROLL_BLOCK_ROWS, Math\.max\(0, rows\.length - 1\)\);/.test(gantt)
  && /const first = Math\.max\(0, top - OVERSCAN_ROWS\);/.test(gantt)
  && /const last = Math\.min\(rows\.length, Math\.max\(first, top \+ SCROLL_BLOCK_ROWS \+ perScreen \+ OVERSCAN_ROWS\)\);/.test(gantt),
  'MobileGantt changed its window math; update this mirror and re-prove coverage.');

/** The component's own arithmetic, mirrored. */
function blockFor(scrollYFromFirstRow: number): number {
  return Math.max(0, Math.floor(scrollYFromFirstRow / (ROW_H * SCROLL_BLOCK_ROWS)));
}
function windowFor(block: number, viewportH: number, rowCount: number): [number, number] {
  const perScreen = viewportH > 0 ? Math.ceil(viewportH / ROW_H) : INITIAL_ROWS;
  const top = Math.min(block * SCROLL_BLOCK_ROWS, Math.max(0, rowCount - 1));
  const first = Math.max(0, top - OVERSCAN_ROWS);
  const last = Math.min(rowCount, Math.max(first, top + SCROLL_BLOCK_ROWS + perScreen + OVERSCAN_ROWS));
  return [first, last];
}

// N is the true worst case: 1,000 imported tasks plus one header per phase.
const PHASES = 6;
const ROW_COUNT = MAX_ROWS + PHASES;
const VIEWPORTS = [568, 640, 736, 852, 932]; // SE through Pro Max, minus chrome

let coverageHoles = 0;
let widestWindow = 0;
let offscreenMisses = 0;
const reached = new Set<number>();

for (const viewportH of VIEWPORTS) {
  const contentH = ROW_COUNT * ROW_H;
  // Walk the whole content one pixel at a time and check, at every offset, that
  // the window the component would be showing contains every row the viewport
  // actually exposes. This is the property that makes hand-windowing safe: a
  // gap here is a blank stripe on a real phone.
  for (let y = 0; y <= contentH; y++) {
    const [first, last] = windowFor(blockFor(y), viewportH, ROW_COUNT);
    widestWindow = Math.max(widestWindow, last - first);
    const firstOnScreen = Math.max(0, Math.floor(y / ROW_H));
    const lastOnScreen = Math.min(ROW_COUNT, Math.ceil((y + viewportH) / ROW_H));
    if (firstOnScreen < first || lastOnScreen > last) offscreenMisses++;
    if (viewportH === VIEWPORTS[0]) for (let i = first; i < last; i++) reached.add(i);
  }
}
for (let i = 0; i < ROW_COUNT; i++) if (!reached.has(i)) coverageHoles++;

ok('COVERAGE: every one of the ' + ROW_COUNT + ' rows is reachable by scrolling',
  coverageHoles === 0, `${coverageHoles} row index(es) can never be mounted.`);
ok('COVERAGE: no scroll offset ever exposes a row outside the mounted window',
  offscreenMisses === 0,
  `${offscreenMisses} scroll offset(s) would show a blank stripe. Raise OVERSCAN_ROWS.`);
ok(`BOUNDED: the window never exceeds ${widestWindow} rows (was ${ROW_COUNT})`,
  widestWindow < 120 && widestWindow < ROW_COUNT / 8,
  'The window has to stay independent of N or nothing was gained.');

// ── 4. indexed weekday math == the original walk, exactly ───────────────────
// A drift of one column here moves every bar on the screen sideways, so pin the
// two implementations against each other over the whole schedule horizon plus
// the out-of-range tail a drag can reach.
const MS_DAY = 24 * 60 * 60 * 1000;
// Anchored on a Wednesday so the sweep starts mid-week rather than on a
// boundary that would hide an off-by-one.
const baseMs = new Date(2026, 8, 2).getTime();
const isWeekendOffset = (d: number): boolean => {
  const dow = new Date(baseMs + d * MS_DAY).getDay();
  return dow === 0 || dow === 6;
};
const numDays = MAX_ROWS + 2;

// The ORIGINAL implementations, verbatim.
let walkComparisons = 0;
function colOfWalk(dayOffset: number): number {
  const upper = Math.max(0, Math.floor(dayOffset));
  let cols = 0;
  for (let d = 0; d < upper; d++) { walkComparisons++; if (!isWeekendOffset(d)) cols++; }
  return cols;
}
function colToDayWalk(col: number): number {
  const target = Math.max(0, col);
  let seen = 0;
  let d = 0;
  for (; d < numDays + 366; d++) {
    walkComparisons++;
    if (!isWeekendOffset(d)) { if (seen === target) return d; seen++; }
  }
  return d;
}

// The INDEXED implementations, mirrored from the component.
const span = numDays + 366;
const colAt = new Int32Array(Math.max(1, numDays + 2));
const dayAt: number[] = [];
let indexComparisons = 0;
{
  let cols = 0;
  for (let d = 0; d < span; d++) {
    indexComparisons++;
    if (d < colAt.length) colAt[d] = cols;
    if (!isWeekendOffset(d)) { dayAt.push(d); cols++; }
  }
}
function colOfIndexed(dayOffset: number): number {
  const upper = Math.max(0, Math.floor(dayOffset));
  indexComparisons++;
  if (upper < colAt.length) return colAt[upper];
  let cols = 0;
  for (let d = 0; d < upper; d++) if (!isWeekendOffset(d)) cols++;
  return cols;
}
function colToDayIndexed(col: number): number {
  const target = Math.max(0, col);
  indexComparisons++;
  return dayAt[target] ?? span;
}

let colOfMismatch = 0;
for (let d = -5; d <= numDays; d++) if (colOfWalk(d) !== colOfIndexed(d)) colOfMismatch++;
ok(`colOf: indexed matches the walk for every day-offset in [-5, ${numDays}]`,
  colOfMismatch === 0, `${colOfMismatch} day(s) would place their bar in a different column.`);

let colToDayMismatch = 0;
const maxCol = colOfWalk(numDays) + 400; // past the end, where a drag can land
for (let c = -5; c <= maxCol; c++) if (colToDayWalk(c) !== colToDayIndexed(c)) colToDayMismatch++;
ok(`colToDay: indexed matches the walk for every column in [-5, ${maxCol}] (incl. past the end)`,
  colToDayMismatch === 0,
  `${colToDayMismatch} column(s) would resolve to a different calendar day - long-press-to-add and drag-to-reschedule would land on the wrong date.`);

// Round-trip: a column resolved to a day and back must be the same column, or
// dragging a bar one column right would not move it one column right.
let roundTripMismatch = 0;
for (let c = 0; c < Math.min(dayAt.length, 2000); c++) {
  if (colOfIndexed(colToDayIndexed(c)) !== c) roundTripMismatch++;
}
ok('colOf(colToDay(c)) === c for every visible column', roundTripMismatch === 0,
  `${roundTripMismatch} column(s) do not round-trip; drag-to-reschedule would drift.`);

// ── 5. the quadratic term is actually gone ──────────────────────────────────
// Count the way each implementation does: barById calls colOf twice per task,
// which is the render-pass cost the user waits on.
walkComparisons = 0;
for (let i = 0; i < MAX_ROWS; i++) { colOfWalk(i); colOfWalk(i + 5); }
const walkCost = walkComparisons;
indexComparisons = 0;
for (let i = 0; i < MAX_ROWS; i++) { colOfIndexed(i); colOfIndexed(i + 5); }
const indexedCost = indexComparisons + span; // + the one-time build

ok(`walk cost was ~${walkCost.toLocaleString()} weekend tests per geometry pass`,
  walkCost > 500_000);
ok(`indexed cost is ${indexedCost.toLocaleString()} - at least 100x cheaper`,
  walkCost / indexedCost >= 100);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
