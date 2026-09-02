// scripts/validate-schedule-board-perf.ts
//
// Guards the two things that made the Schedule tab's Board view unusable with a
// real imported schedule (launch-readiness audit 2026-09-02, finding #15):
//
//   1. UNVIRTUALIZED ROWS. app/(tabs)/schedule/index.tsx rendered
//      `Object.entries(phaseGroups).map(...)` with `tasks.map(renderTaskCard)`
//      inside the screen's outer ScrollView, so every task card mounted at
//      once. The importer's hard cap is the realistic N: MAX_ROWS = 1000 in
//      supabase/functions/import-schedule/index.ts. The cheapest task card is
//      24 views, so a full MS Project / P6 import built 24,000+ views in one
//      synchronous pass before the Board's first frame.
//
//   2. QUADRATIC BASELINE LOOKUP. Each card called getBaselineVariance(), which
//      does a linear `baseline.tasks.find(...)` (utils/scheduleEngine.ts). One
//      scan per row over a baseline that import captures automatically =
//      O(tasks x baselineTasks) = up to 1,000,000 id comparisons per render
//      pass, repeated on every progress tap, filter change and phase collapse.
//
// This guard is text-based for the screen (it is a .tsx and cannot be imported
// by bun without a bundler) and behavioural for the arithmetic: the Map-based
// replacement must return EXACTLY what getBaselineVariance returns, because the
// variance chip is a number the user reads off the card ("+3d" / "-2d").
//
// Run via: bun run test:schedule-board-perf

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getBaselineVariance } from '../utils/scheduleEngine';
import type { ScheduleTask } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCREEN = join(ROOT, 'app', '(tabs)', 'schedule', 'index.tsx');
const IMPORTER = join(ROOT, 'supabase', 'functions', 'import-schedule', 'index.ts');

const screenRaw = readFileSync(SCREEN, 'utf8');
const importer = readFileSync(IMPORTER, 'utf8');

/**
 * The screen documents WHY the old shapes were wrong, quoting them verbatim
 * ("tasks.map(renderTaskCard)", "getBaselineVariance"). A guard that greps the
 * raw file would fire on its own explanation, so the "must not appear" checks
 * run against code only. Block comments and line comments go; `://` is left
 * alone so URLs in string literals survive.
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

const screen = stripComments(screenRaw);

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nschedule Board perf (virtualized rows + O(1) baseline lookup):');

// ── the premise: how many rows can actually land on this screen ──────────────
// If the importer's cap moves, the numbers in this guard's comments and in the
// screen's own comments are stale — fail loudly rather than quietly guard the
// wrong N.
const capMatch = importer.match(/const MAX_ROWS\s*=\s*(\d+);/);
ok('importer still declares MAX_ROWS', capMatch !== null,
  'supabase/functions/import-schedule/index.ts no longer has `const MAX_ROWS = <n>;`');
const MAX_ROWS = capMatch ? Number(capMatch[1]) : 0;
ok(`importer cap is 1000 rows (realistic N for the Board) — read ${MAX_ROWS}`, MAX_ROWS === 1000,
  'The Board guard is written against a 1,000-row worst case. Update both if the cap moved.');

// ── 1. rows are windowed, not all mounted ───────────────────────────────────
ok('Board no longer maps every task card into a View',
  !/\.map\(renderTaskCard\)/.test(screen),
  '`tasks.map(renderTaskCard)` renders all N cards synchronously. Feed a FlatList instead.');

ok('the phase-grouped Board tree is gone',
  !/styles\.phaseTaskList/.test(screen),
  'phaseTaskList wrapped a whole phase\'s cards; the virtualized Board uses flat phaseTaskRow rows.');

ok('Board rows are flattened into a single windowable list',
  /const boardRows = useMemo<BoardRow\[\]>/.test(screen),
  'Expected a `boardRows` memo producing one row stream of phase headers + task rows.');

// Both surfaces in this file (desktop split-pane at >=1024/900px, and the
// tablet/narrow-web screen) have to feed the FlatList, not a ScrollView.
const boardListCount = (screen.match(/data=\{boardRows\}/g) ?? []).length;
ok(`both Board surfaces render through a FlatList (found ${boardListCount})`, boardListCount === 2,
  'Desktop split-pane and the tablet/narrow-web screen must BOTH pass boardRows to a FlatList.');

ok('the Board FlatList is the scroll container, not nested in a ScrollView',
  /isBoardVirtualized/.test(screen) && /viewMode === 'board' \? \(/.test(screen),
  'A VirtualizedList inside a same-axis ScrollView gets unbounded height and renders every row.');

// ── 2. baseline lookup is indexed, not scanned ──────────────────────────────
ok('the screen no longer calls the linear getBaselineVariance',
  !/getBaselineVariance\s*\(/.test(screen),
  'getBaselineVariance does baseline.tasks.find() — one full scan per rendered row.');

ok('baseline is indexed by task id once per baseline change',
  /const baselineEndByTaskId = useMemo\(/.test(screen) && /new Map<string, number>\(\)/.test(screen),
  'Expected a Map<taskId, endDay> built in a useMemo keyed on activeSchedule?.baseline.');

// ── 3. the indexed lookup returns the SAME number the user reads ────────────
// The variance chip renders `${variance > 0 ? '+' : ''}${variance}d`. Any drift
// between the two implementations is a wrong number on a task card, so pin them
// against each other over the full worst-case shape: 1,000 tasks, some moved,
// some not in the baseline at all, some with no baseline saved.
function makeTask(i: number, startDay: number, durationDays: number): ScheduleTask {
  return {
    id: `t${i}`,
    title: `Task ${i}`,
    phase: 'General',
    startDay,
    durationDays,
    progress: 0,
    status: 'not_started',
    crew: '',
    notes: '',
    dependencies: [],
  };
}

const N = MAX_ROWS || 1000;
const tasks: ScheduleTask[] = [];
for (let i = 0; i < N; i++) tasks.push(makeTask(i, 1 + i, 1 + (i % 9)));

// Baseline covers everything except the last 10 tasks (tasks added after the
// baseline was captured must read as "no variance", not as zero).
const baseline = {
  savedAt: '2026-09-01T00:00:00.000Z',
  tasks: tasks.slice(0, N - 10).map((t, i) => ({
    id: t.id,
    startDay: t.startDay,
    // Every third task slipped by (i % 5) - 2 days, so the set covers positive,
    // negative and exactly-zero variance.
    endDay: t.startDay + t.durationDays + (i % 3 === 0 ? (i % 5) - 2 : 0),
  })),
};

const index = new Map<string, number>();
for (const bt of baseline.tasks) index.set(bt.id, bt.endDay);
const indexed = (task: ScheduleTask): number | null => {
  const end = index.get(task.id);
  if (end === undefined) return null;
  return (task.startDay + task.durationDays) - end;
};

let mismatches = 0;
let sawPositive = false, sawNegative = false, sawZero = false, sawNull = false;
for (const t of tasks) {
  const scanned = getBaselineVariance(t, baseline);
  const looked = indexed(t);
  if (scanned !== looked) mismatches++;
  if (looked === null) sawNull = true;
  else if (looked > 0) sawPositive = true;
  else if (looked < 0) sawNegative = true;
  else sawZero = true;
}
ok(`indexed variance matches the scan for all ${N} tasks`, mismatches === 0,
  `${mismatches} task(s) would show a different variance chip than before.`);
ok('the comparison actually covered slip, recovery, on-time and un-baselined',
  sawPositive && sawNegative && sawZero && sawNull,
  'The fixture degenerated — it is no longer exercising every variance branch.');

// No baseline at all must stay null (the chip is hidden), not 0 (which would
// render "0d" on every card of an un-baselined schedule).
const emptyIndex = new Map<string, number>();
ok('no baseline saved -> null, never 0',
  getBaselineVariance(tasks[0], null) === null
  && (emptyIndex.get(tasks[0].id) === undefined ? null : 0) === null);

// ── 4. the quadratic term is actually gone ──────────────────────────────────
// Count id comparisons the way each implementation does them: the scan is
// O(tasks x baselineTasks), the index is O(baselineTasks) to build + O(1) each.
let scanComparisons = 0;
for (const t of tasks) {
  for (const bt of baseline.tasks) { scanComparisons++; if (bt.id === t.id) break; }
}
const indexComparisons = baseline.tasks.length + tasks.length;
ok(`scan cost was ~${scanComparisons.toLocaleString()} comparisons per render pass`,
  scanComparisons > 100_000);
ok(`indexed cost is ${indexComparisons.toLocaleString()} — at least 100x cheaper`,
  scanComparisons / indexComparisons >= 100);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
