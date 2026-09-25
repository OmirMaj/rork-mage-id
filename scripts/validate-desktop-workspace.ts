// scripts/validate-desktop-workspace.ts — the pure rules under the wave-6b
// desktop workspace primitives (DataTable, SplitView, SidePanel, KpiStrip,
// FormGrid, LineItemGrid, useHotkeys) and the one project-stage mapping.
//
// WHY THIS EXISTS. These primitives are what every web register adopts in wave
// 6c, so a wrong rule here is wrong on twenty screens at once. What goes wrong
// silently, and is pinned below:
//
//   • a sort that is not STABLE reshuffles rows he was not sorting by; a sort
//     that puts unknown values first calls an RFI with no due date "the most
//     overdue"; dates compared as text order "Oct 2" before "Sep 30";
//   • an unknown number shown as 0 ("$0 contract") — the table must say '—';
//   • shift-click selecting in SOURCE order instead of the order he sees;
//   • a split that ignores its 420 px list floor / 60 % cap, or a side panel
//     outside 360–560;
//   • a keyboard shortcut firing while he types in a field, a dialog that
//     lets j/k move the list behind it, or the app taking Cmd+W from the
//     browser;
//   • 'closeout' meaning status 'completed' on Home and 'closed' on the job
//     page (web-PM audit, plan.bugs) — the mapping must be one table, in the
//     audit's lifecycle names (Pre-Con / Construction / Post-Con / Closeout);
//   • a row / KPI link that hard-reloads the SPA on a plain click (a Link
//     given an onPress key loses its router handler on web) — pinned in E;
//   • a shortcut that cannot hear a key typed in a field (react-native-web
//     stops TextInput keydown propagation) — keys are split by phase;
//   • a persisted key outside APP_STORAGE_PREFIXES, which the sign-out sweep
//     cannot see (one GC's table prefs following the next person).
//
// HOW IT CHECKS. A–D execute utils/dataTable, utils/splitViewLayout,
// utils/projectStage and the pure core of hooks/useHotkeys under bun. E pins
// source facts: the phone branches, the Project status union, no hex colours.
//
// Run via: bun run scripts/validate-desktop-workspace.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UNKNOWN_CELL,
  applySelectionClick,
  cursorForActiveKey,
  filterRowsBySearch,
  formatCellValue,
  isPlainClick,
  moveCursor,
  nextGridCell,
  nextSortState,
  normalizeSortValue,
  parseGridNumber,
  parsePastedGrid,
  parseTablePrefs,
  pruneSelection,
  rowsToCsv,
  selectionRange,
  selectionState,
  stableSortRows,
  stepOpenRow,
  tableKeyGates,
  sumColumn,
  tablePrefsKey,
  visibleColumnKeys,
} from '../utils/dataTable';
import {
  FORM_GRID_COL_GAP,
  SIDE_PANEL_MAX,
  SIDE_PANEL_MIN,
  SPLIT_DIVIDER,
  SPLIT_LIST_MIN,
  clampSidePanelWidth,
  clampSplitRatio,
  dragSidePanelWidth,
  dragSplitRatio,
  formGridColumns,
  formGridSlotWidth,
  kpiCellsPerRow,
  parseStoredRatio,
  sidePanelMode,
  sidePanelWidthKey,
  splitMode,
  splitRatioKey,
  splitWidths,
} from '../utils/splitViewLayout';
import {
  PROJECT_STAGES,
  STAGE_LABELS,
  STAGE_TO_STATUS,
  STATUS_LABELS,
  migrateStageKey,
  projectInStageFilter,
  stageForStatus,
  statusesInStage,
  type ProjectStatus,
} from '../utils/projectStage';
import {
  SEQUENCE_TIMEOUT_MS,
  bindingsLive,
  createHotkeyRegistry,
  focusSnapshot,
  subscribeFocus,
  type FocusSource,
  formatCombo,
  isReservedCombo,
  isTypingTarget,
  keyPhaseFor,
  parseCombo,
  passesTypingGuard,
  stepMatches,
  targetWithin,
  type KeyLike,
} from '../hooks/useHotkeys';
import { isAppStorageKey } from '../utils/localCacheKeys';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nA. utils/dataTable');
// ─────────────────────────────────────────────────────────────────────────────

type R = { id: string; due: string | null; amount: number | null; name: string };
const rows: R[] = [
  { id: 'a', due: '2026-10-02', amount: 300, name: 'Drywall' },
  { id: 'b', due: null, amount: 100, name: 'electrical' },
  { id: 'c', due: '2026-09-30', amount: 300, name: 'Framing' },
  { id: 'd', due: '2026-09-30', amount: null, name: 'drywall patch' },
  { id: 'e', due: '', amount: NaN, name: 'Item 10' },
  { id: 'f', due: '2026-11-01', amount: 100, name: 'Item 9' },
];
const ids = (xs: readonly R[]) => xs.map((r) => r.id).join('');

ok('unknown sort values normalise to null (null, undefined, NaN, blank, Invalid Date)',
  [null, undefined, NaN, Infinity, '', '  ', new Date('nope')].every((v) => normalizeSortValue(v as never) === null));
ok('a Date normalises to its timestamp', normalizeSortValue(new Date('2026-09-30T00:00:00Z')) === Date.parse('2026-09-30T00:00:00Z'));
ok('0 is a KNOWN value (not unknown)', normalizeSortValue(0) === 0);

const byAmountAsc = stableSortRows(rows, (r) => r.amount, 'asc');
ok('asc sort: ties keep input order, unknowns last', ids(byAmountAsc) === 'bfacde', ids(byAmountAsc));
const byAmountDesc = stableSortRows(rows, (r) => r.amount, 'desc');
ok('desc sort: ties STILL keep input order, unknowns STILL last', ids(byAmountDesc) === 'acbfde', ids(byAmountDesc));
ok('sort does not mutate its input', ids(rows) === 'abcdef');

const byDue = stableSortRows(rows, (r) => (r.due ? new Date(`${r.due}T00:00:00Z`) : null), 'asc');
ok('dates sort by timestamp; blank/null dates last', ids(byDue) === 'cdafbe', ids(byDue));
const byName = stableSortRows(rows, (r) => r.name, 'asc');
ok('strings: case-insensitive, numeric-aware ("Item 9" before "Item 10")', ids(byName) === 'adbcfe', ids(byName));
ok('mixed number/string: numbers first', eq(stableSortRows([{ v: 'x' }, { v: 2 }, { v: 1 }], (r) => r.v, 'asc').map((r) => r.v), [1, 2, 'x']));

// Stability over a large input with many ties (catches an engine-dependent sort).
const big = Array.from({ length: 500 }, (_, i) => ({ i, k: i % 3 }));
const bigSorted = stableSortRows(big, (r) => r.k, 'asc');
ok('500-row stability: within each key, original order preserved',
  bigSorted.every((r, j) => j === 0 || bigSorted[j - 1].k < r.k || (bigSorted[j - 1].k === r.k && bigSorted[j - 1].i < r.i)));

ok('header click cycles off → asc → desc → off',
  eq(nextSortState(null, 'x'), { key: 'x', dir: 'asc' })
  && eq(nextSortState({ key: 'x', dir: 'asc' }, 'x'), { key: 'x', dir: 'desc' })
  && nextSortState({ key: 'x', dir: 'desc' }, 'x') === null);
ok('clicking another column starts it at asc', eq(nextSortState({ key: 'x', dir: 'desc' }, 'y'), { key: 'y', dir: 'asc' }));

const st = (r: R) => `${r.name} ${r.due ?? ''}`;
ok('empty search returns the same array', filterRowsBySearch(rows, '   ', st) === rows);
ok('search: every word, any order, case-insensitive', ids(filterRowsBySearch(rows, 'PATCH dry', st) as R[]) === 'd');
ok('search folds accents', filterRowsBySearch([{ n: 'Café Renovation' }], 'cafe', (r) => r.n).length === 1);

const vis = ['c', 'a', 'f', 'b'];
ok('range follows VISIBLE order (anchor c → target f = c,a,f)', eq(selectionRange(vis, 'c', 'f'), ['c', 'a', 'f']));
ok('range works backwards', eq(selectionRange(vis, 'b', 'a'), ['a', 'f', 'b']));
ok('range with a filtered-away anchor is just the target', eq(selectionRange(vis, 'zz', 'f'), ['f']));
ok('range to an invisible target is empty', eq(selectionRange(vis, 'c', 'zz'), []));

let sel = applySelectionClick(new Set(), null, vis, { key: 'a', shift: false });
ok('plain click selects and becomes the anchor', eq([...sel.selected], ['a']) && sel.anchor === 'a');
sel = applySelectionClick(sel.selected, sel.anchor, vis, { key: 'b', shift: true });
ok('shift-click adds the range a..b, anchor kept', eq([...sel.selected].sort(), ['a', 'b', 'f']) && sel.anchor === 'a');
sel = applySelectionClick(sel.selected, sel.anchor, vis, { key: 'f', shift: false });
ok('plain click on a selected row deselects it', eq([...sel.selected].sort(), ['a', 'b']) && sel.anchor === 'f');
const noAnchor = applySelectionClick(new Set(), null, vis, { key: 'f', shift: true });
ok('shift-click with no anchor acts like a plain click', eq([...noAnchor.selected], ['f']) && noAnchor.anchor === 'f');
ok('prune drops keys no longer live', eq([...pruneSelection(new Set(['a', 'x']), vis)], ['a']));
ok('selectionState none/some/all', selectionState(new Set(), vis) === 'none'
  && selectionState(new Set(['a']), vis) === 'some'
  && selectionState(new Set(vis), vis) === 'all'
  && selectionState(new Set(['a']), []) === 'none');
ok('cursor: from nothing, j → first, k → last; clamps at ends',
  moveCursor(-1, 1, 5) === 0 && moveCursor(-1, -1, 5) === 4 && moveCursor(4, 1, 5) === 4 && moveCursor(0, -1, 5) === 0 && moveCursor(2, 1, 0) === -1);
ok('cursor follows the record open beside the table (SplitView activeKey)',
  cursorForActiveKey(vis, 'f', 0) === 2 && cursorForActiveKey(vis, 'c', 3) === 0);
// The reviewer's case: rows r1 Drywall / r2 Electrical / r3 Framing, sorted
// title DESC → he sees [r3, r2, r1]. With r2 open, j must open r1 (the row
// BELOW on screen), not r3 (next in source order, the row above).
const seenDesc = ['r3', 'r2', 'r1'];
ok('j/k step the open record in the order he SEES (sorted desc: r2 → j → r1, k → r3)',
  stepOpenRow(seenDesc, 'r2', 1) === 'r1' && stepOpenRow(seenDesc, 'r2', -1) === 'r3');
ok('j/k at the ends stay put (null = nothing to open)',
  stepOpenRow(seenDesc, 'r1', 1) === null && stepOpenRow(seenDesc, 'r3', -1) === null && stepOpenRow([], 'r1', 1) === null);
// Search 'l' hides Framing: he sees [r2 Electrical, r1 Drywall] (source order).
const searched = ['r2', 'r1'];
ok('searched: j from r2 opens r1; a row the search hides (r3) is never opened',
  stepOpenRow(searched, 'r2', 1) === 'r1' && ![1, -1, 2, -2].some((d) => stepOpenRow(searched, 'r2', d) === 'r3'));
ok('open record searched out of view: j → first visible, k → last visible',
  stepOpenRow(searched, 'r3', 1) === 'r2' && stepOpenRow(searched, 'r3', -1) === 'r1' && stepOpenRow(searched, null, 1) === 'r2');
// The table's keys, as ONE executed rule (reviewer round 3). A SplitView in
// single mode keeps the list mounted but display:none while a record fills
// the pane: only record stepping may reach it.
{
  const base = { stepping: true, cursor: 1, selectable: true, searchable: true, somethingToClear: true };
  const hidden = tableKeyGates({ ...base, listHidden: true });
  ok('hidden list (single mode, record open): j/k still step the record',
    hidden.j && hidden.k);
  ok("hidden list: Esc is off, so the FIRST Esc closes the record (not an invisible search/selection)",
    hidden.escape === false);
  ok("hidden list: '/' is off (no focus into an invisible search box)", hidden.search === false);
  ok('hidden list: x and Cmd+A are off (no ticking invisible rows; Cmd+A stays the page\'s)',
    hidden.x === false && hidden.selectAll === false);
  ok('hidden list: Enter and ↑/↓ are off', hidden.enter === false && hidden.arrows === false);
  const hiddenNoStep = tableKeyGates({ ...base, stepping: false, listHidden: true });
  ok('hidden list without stepping wired: j/k off too (nothing visible to move)', !hiddenNoStep.j && !hiddenNoStep.k);
  const shown = tableKeyGates({ ...base, listHidden: false });
  ok('visible list with a record open: Esc / search / x / Cmd+A / j / k all live',
    shown.escape && shown.search && shown.x && shown.selectAll && shown.j && shown.k);
  ok('record open (stepping): ↑/↓ scroll the record, not step it; Enter belongs to the record',
    shown.arrows === false && shown.enter === false);
  const browsing = tableKeyGates({ ...base, stepping: false, listHidden: false });
  ok('no record open, cursor set: ↑/↓ and Enter drive the table', browsing.arrows && browsing.enter);
  const fresh = tableKeyGates({ ...base, stepping: false, cursor: -1, listHidden: false });
  ok('no cursor yet: ↑/↓, Enter and x stay the page\'s', !fresh.arrows && !fresh.enter && !fresh.x && fresh.j);
  ok('nothing to clear: Esc off (reaches the record / panel)',
    !tableKeyGates({ ...base, somethingToClear: false, listHidden: false }).escape);
}
ok('no open record, or one searched away → cursor unchanged',
  cursorForActiveKey(vis, null, 1) === 1 && cursorForActiveKey(vis, undefined, -1) === -1 && cursorForActiveKey(vis, 'zz', 3) === 3);

ok('plain click: left button, no modifier; a keyboard press (no button) counts',
  isPlainClick({ button: 0 }) && isPlainClick({}) && isPlainClick(undefined) && isPlainClick({ button: undefined }));
ok('Cmd / Ctrl / Shift / Alt / middle click belong to the browser (new tab)',
  !isPlainClick({ button: 0, metaKey: true }) && !isPlainClick({ ctrlKey: true }) && !isPlainClick({ shiftKey: true })
  && !isPlainClick({ altKey: true }) && !isPlainClick({ button: 1 }));

const cols = [{ key: 'name' }, { key: 'due', hideBelow: 700 }, { key: 'amount' }, { key: 'owner', hideBelow: 1000 }];
ok('columns hide below their width', eq(visibleColumnKeys(cols, 800, []), ['name', 'due', 'amount']));
ok('user-hidden columns hide; the first column never hides', eq(visibleColumnKeys(cols, 1200, ['name', 'amount']), ['name', 'due', 'owner']));
ok('an unmeasured (0) width hides nothing by width', eq(visibleColumnKeys(cols, 0, []), ['name', 'due', 'amount', 'owner']));

ok("unknown cell values render '—', never 0",
  [null, undefined, NaN, '', '  ', new Date('x')].every((v) => formatCellValue(v) === UNKNOWN_CELL));
ok('a real 0 renders "0"', formatCellValue(0) === '0');

ok('table prefs key is inside APP_STORAGE_PREFIXES (swept on sign-out)', isAppStorageKey(tablePrefsKey('rfis')));
ok('prefs parse: good', eq(parseTablePrefs(JSON.stringify({ sort: { key: 'due', dir: 'desc' }, hidden: ['owner'] }), ['due', 'owner']), { sort: { key: 'due', dir: 'desc' }, hidden: ['owner'] }));
ok('prefs parse: unknown column / bad dir / junk → defaults',
  eq(parseTablePrefs(JSON.stringify({ sort: { key: 'gone', dir: 'asc' }, hidden: ['gone', 3] }), ['due']), { sort: null, hidden: [] })
  && eq(parseTablePrefs('{not json', ['due']), { sort: null, hidden: [] })
  && eq(parseTablePrefs(JSON.stringify({ sort: { key: 'due', dir: 'up' } }), ['due']), { sort: null, hidden: [] }));

const csv = rowsToCsv(
  [{ key: 'name', label: 'Name' }, { key: 'amount', label: 'Amount' }],
  [{ name: '=HYPERLINK("x")', amount: null }, { name: 'a, b', amount: -5 }],
);
ok('CSV: formula-injection guarded, unknown → empty cell (not 0), negatives kept',
  csv === 'Name,Amount\r\n"\'=HYPERLINK(""x"")",\r\n"a, b",-5', JSON.stringify(csv));

ok('paste grid: tabs + newlines, blank lines dropped, trailing newline ignored',
  eq(parsePastedGrid('Drywall\t12\tsf\t4.50\r\n\r\nPaint\t3\tgal\t\n'), [['Drywall', '12', 'sf', '4.50'], ['Paint', '3', 'gal', '']]));
ok('paste grid: a single plain value is NOT a grid paste', eq(parsePastedGrid('just text'), []));
ok('paste grid: one line with a tab IS a grid paste', eq(parsePastedGrid('a\tb'), [['a', 'b']]));
ok('paste grid: capped at MAX_PASTE_ROWS (200)', parsePastedGrid(Array.from({ length: 250 }, (_, i) => `r${i}\t1`).join('\n')).length === 200);

ok('numbers as typed: $1,234.50 · 12 % · (250) · -3',
  parseGridNumber('$1,234.50') === 1234.5 && parseGridNumber('12 %') === 12 && parseGridNumber('(250)') === -250 && parseGridNumber('-3') === -3);
ok('not numbers → null (never 0): blank, TBD, 1.2.3, 12abc',
  [' ', 'TBD', '1.2.3', '12abc', null, undefined].every((v) => parseGridNumber(v) === null));
const tot = sumColumn(['100', '', null, '0.1', '0.2', 'TBD', 5]);
ok('sum: skips blanks, counts unparsed, cents-exact', tot.total === 105.3 && tot.unparsed === 1, JSON.stringify(tot));
ok('sum of nothing numeric is null (—), not 0', sumColumn(['', null, 'n/a']).total === null);

ok('Tab: next editable cell, wrapping rows', eq(nextGridCell(3, [0, 1, 3], { row: 0, col: 1 }, false), { row: 0, col: 3 })
  && eq(nextGridCell(3, [0, 1, 3], { row: 0, col: 3 }, false), { row: 1, col: 0 }));
ok('Shift-Tab: previous editable cell, wrapping back', eq(nextGridCell(3, [0, 1, 3], { row: 1, col: 0 }, true), { row: 0, col: 3 }));
ok('Tab past either end leaves the grid (null)', nextGridCell(3, [0, 1, 3], { row: 2, col: 3 }, false) === null
  && nextGridCell(3, [0, 1, 3], { row: 0, col: 0 }, true) === null);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nB. utils/splitViewLayout');
// ─────────────────────────────────────────────────────────────────────────────

ok('phone is always single', splitMode(2000, false) === 'single');
ok('desktop container ≥ 1100 splits; < 1100 is single', splitMode(1100, true) === 'split' && splitMode(1099, true) === 'single');
ok('non-number width is single', splitMode(NaN, true) === 'single');
const w1270 = splitWidths(1270);
ok('1270 px (1512 window − sidebar): list 42 % = 533, detail = rest − divider',
  w1270.listWidth === 533 && w1270.detailWidth === 1270 - 533 - SPLIT_DIVIDER, JSON.stringify(w1270));
ok('list never under 420 px', splitWidths(1100, 0.1).listWidth >= SPLIT_LIST_MIN);
ok('list never over 60 %', splitWidths(2000, 0.95).listWidth === 1200);
ok('garbage ratio → default', clampSplitRatio(NaN, 1500) === 0.42);
ok('drag: +200 px from 42 % of 1500 → 55.33 %', Math.abs(dragSplitRatio(0.42, 200, 1500) - (630 + 200) / 1500) < 1e-9);
ok('drag clamps at both ends', dragSplitRatio(0.42, -2000, 1500) === 420 / 1500 && dragSplitRatio(0.42, 5000, 1500) === 0.6);
ok('stored ratio parse: good / junk', parseStoredRatio('0.5') === 0.5 && parseStoredRatio('abc') === null && parseStoredRatio('1.5') === null && parseStoredRatio(null) === null);
ok('split key is inside APP_STORAGE_PREFIXES', isAppStorageKey(splitRatioKey('rfis')));

ok('side panel width clamps 360–560, garbage → 440',
  clampSidePanelWidth(100) === SIDE_PANEL_MIN && clampSidePanelWidth(9999) === SIDE_PANEL_MAX && clampSidePanelWidth(NaN) === 440);
ok('dragging the LEFT edge left widens the panel', dragSidePanelWidth(440, -60) === 500 && dragSidePanelWidth(440, 200) === 360);
ok('panel overlays under a 1200 container, docks at ≥ 1200 or unknown',
  sidePanelMode(1199) === 'overlay' && sidePanelMode(1200) === 'dock' && sidePanelMode(undefined) === 'dock');
ok('panel key is inside APP_STORAGE_PREFIXES', isAppStorageKey(sidePanelWidthKey('ask')));

ok('KPI: one row at ≥ 900, two rows under it, 2 columns on a phone',
  kpiCellsPerRow(6, 1200, true) === 6 && kpiCellsPerRow(6, 899, true) === 3 && kpiCellsPerRow(5, 899, true) === 3
  && kpiCellsPerRow(6, 390, false) === 2 && kpiCellsPerRow(1, 390, false) === 1 && kpiCellsPerRow(0, 1200, true) === 0);

ok('form grid: 2 columns at ≥ 1100 on desktop, else 1; phone 1',
  formGridColumns(1100, true) === 2 && formGridColumns(1099, true) === 1 && formGridColumns(1600, false) === 1);
ok('form slot: half = (w − 24)/2; full = w; 1-col = w',
  formGridSlotWidth(1200, 2, 'half') === (1200 - FORM_GRID_COL_GAP) / 2 && formGridSlotWidth(1200, 2, 'full') === 1200 && formGridSlotWidth(700, 1, 'half') === 700);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nC. utils/projectStage');
// ─────────────────────────────────────────────────────────────────────────────

const STATUSES: ProjectStatus[] = ['draft', 'estimated', 'in_progress', 'completed', 'closed'];
ok('status → stage: draft/estimated precon, in_progress construction, completed postcon, closed closeout',
  eq(STATUSES.map(stageForStatus), ['precon', 'precon', 'construction', 'postcon', 'closeout']));
ok("the audit's four lifecycle names, in order: Pre-Con / Construction / Post-Con / Closeout",
  eq(PROJECT_STAGES.map((s) => STAGE_LABELS[s].label), ['Pre-Con', 'Construction', 'Post-Con', 'Closeout']));
ok("the job page's phone stepper keeps its short forms (Pre / Con / Post / Done)",
  eq(PROJECT_STAGES.map((s) => STAGE_LABELS[s].short), ['Pre', 'Con', 'Post', 'Done']));
ok("'Closeout' is ONE status everywhere: 'closed' (the job page's meaning); 'completed' reads Post-Con",
  STAGE_LABELS[stageForStatus('closed')].label === 'Closeout' && STATUS_LABELS.closed === 'Closeout'
  && STAGE_LABELS[stageForStatus('completed')].label === 'Post-Con' && STATUS_LABELS.completed === 'Post-Con');
ok('a status badge past pre-con reads as its stage (the badge can never contradict its chip)',
  (['in_progress', 'completed', 'closed'] as const).every((s) => STATUS_LABELS[s] === STAGE_LABELS[stageForStatus(s)].label));
ok('unknown / missing status → precon', stageForStatus(undefined) === 'precon' && stageForStatus('weird') === 'precon');
ok('advancing to a stage lands on a status IN that stage (the job page\'s STAGE_TO_STATUS)',
  PROJECT_STAGES.every((s) => stageForStatus(STAGE_TO_STATUS[s]) === s)
  && STAGE_TO_STATUS.postcon === 'completed' && STAGE_TO_STATUS.closeout === 'closed');
ok('every status belongs to exactly one stage', STATUSES.every((st2) => PROJECT_STAGES.filter((s) => statusesInStage(s).includes(st2)).length === 1));
ok('stage labels are unique', new Set(PROJECT_STAGES.map((s) => STAGE_LABELS[s].label)).size === PROJECT_STAGES.length);
ok('filter: all keeps everything; postcon keeps completed only; closeout keeps closed only',
  STATUSES.every((s) => projectInStageFilter(s, 'all'))
  && STATUSES.filter((s) => projectInStageFilter(s, 'postcon')).join() === 'completed'
  && STATUSES.filter((s) => projectInStageFilter(s, 'closeout')).join() === 'closed');
ok("migrate: the job page's keys are already canonical",
  (['precon', 'construction', 'postcon', 'closeout'] as const).every((k) => migrateStageKey(k, 'job-page') === k));
ok("migrate: Home's saved chip still selects the SAME jobs (closeout→postcon, closed→closeout, active→construction)",
  (['all', 'precon', 'active', 'closeout', 'closed'] as const).every((k) => {
    const to = migrateStageKey(k, 'home-filter');
    // Home's old buckets, by status (app/(tabs)/(home)/index.tsx statusBuckets).
    const old: Record<string, ProjectStatus[]> = {
      all: STATUSES, precon: ['draft', 'estimated'], active: ['in_progress'], closeout: ['completed'], closed: ['closed'],
    };
    return to !== null && eq(STATUSES.filter((s) => projectInStageFilter(s, to)), old[k]);
  }));
ok('migrate: junk / missing → null', migrateStageKey('nope', 'home-filter') === null && migrateStageKey(undefined, 'job-page') === null
  && migrateStageKey('active', 'job-page') === null);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nD. hooks/useHotkeys (pure core)');
// ─────────────────────────────────────────────────────────────────────────────

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike & { prevented: boolean } => {
  const ev = { key: k, prevented: false, ...mods } as KeyLike & { prevented: boolean };
  ev.preventDefault = () => { ev.prevented = true; };
  return ev;
};
const INPUT = { tagName: 'INPUT', type: 'text' };

ok('parse: mod+shift+z', eq(parseCombo('mod+shift+z'), [{ key: 'z', mod: true, alt: false, shift: true }]));
ok('parse: "g h" is a two-step sequence', parseCombo('g h').length === 2 && parseCombo('g h')[1].key === 'h');
ok('parse: aliases (esc, backslash, plus)', parseCombo('esc')[0].key === 'escape' && parseCombo('mod+backslash')[0].key === '\\' && parseCombo('mod+plus')[0].key === '+');
ok('parse: modifier-only is invalid', parseCombo('mod+shift').length === 0);
ok('reserved: Cmd+P/W/T/N/L; not Cmd+K or plain w', ['mod+p', 'mod+w', 'mod+t', 'mod+n', 'mod+l', 'mod+shift+t'].every(isReservedCombo)
  && !isReservedCombo('mod+k') && !isReservedCombo('w'));
ok('match: Cmd OR Ctrl satisfies mod', stepMatches(parseCombo('mod+k')[0], key('k', { metaKey: true })) && stepMatches(parseCombo('mod+k')[0], key('K', { ctrlKey: true })));
ok('match: plain j does not fire on Cmd+J', !stepMatches(parseCombo('j')[0], key('j', { metaKey: true })));
ok('match: x is not shift+X; ? ignores its own shift', !stepMatches(parseCombo('x')[0], key('X', { shiftKey: true })) && stepMatches(parseCombo('?')[0], key('?', { shiftKey: true })));
ok('typing targets: input/textarea/select/contenteditable yes; checkbox no',
  isTypingTarget(INPUT) && isTypingTarget({ tagName: 'textarea' }) && isTypingTarget({ tagName: 'SELECT' }) && isTypingTarget({ isContentEditable: true })
  && !isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }) && !isTypingTarget({ tagName: 'DIV' }) && !isTypingTarget(null));
ok('key phase: typing-target keys are read in CAPTURE (RNW TextInput stops their bubbling), all others in BUBBLE',
  keyPhaseFor(INPUT) === 'capture' && keyPhaseFor({ tagName: 'TEXTAREA' }) === 'capture' && keyPhaseFor({ isContentEditable: true }) === 'capture'
  && keyPhaseFor({ tagName: 'DIV' }) === 'bubble' && keyPhaseFor({ tagName: 'INPUT', type: 'checkbox' }) === 'bubble'
  && keyPhaseFor(undefined) === 'bubble' && keyPhaseFor(null) === 'bubble');
ok('typing guard: plain key blocked in a field; Esc and Cmd chords pass; blockInInput blocks even those',
  !passesTypingGuard(key('j', { target: INPUT })) && passesTypingGuard(key('Escape', { target: INPUT }))
  && passesTypingGuard(key('Enter', { target: INPUT, metaKey: true })) && !passesTypingGuard(key('a', { target: INPUT, metaKey: true }), false, true)
  && passesTypingGuard(key('j', { target: INPUT }), true));

{
  let now = 0;
  const warnings: string[] = [];
  const reg = createHotkeyRegistry({ now: () => now, warn: (m) => warnings.push(m) });
  const log: string[] = [];
  const offG = reg.register('global', { combo: 'mod+k', handler: () => log.push('palette'), label: 'Search', group: 'Go' });
  reg.register('global', { combo: 'mod+j', handler: () => log.push('global-dock') });
  const offP = reg.register('page', { combo: 'mod+j', handler: () => log.push('page-panel') });
  reg.handle(key('j', { metaKey: true }));
  ok('page scope beats global for the same combo (Schedule Pro takes Cmd+J)', eq(log, ['page-panel']));
  offP();
  reg.handle(key('j', { metaKey: true }));
  ok('unregistering hands the key back to global', eq(log, ['page-panel', 'global-dock']));

  log.length = 0;
  reg.register('page', { combo: 'e', handler: () => log.push('old') });
  reg.register('page', { combo: 'e', handler: () => log.push('new') });
  reg.handle(key('e'));
  ok('within a scope, the newest registration wins', eq(log, ['new']));

  {
    // Esc precedence is fixed by priority, not by who registered last: the
    // table's clear (priority 1) beats SplitView's close (0) in EITHER order.
    for (const order of ['table-first', 'split-first'] as const) {
      const r2 = createHotkeyRegistry();
      const hits: string[] = [];
      const table = () => r2.register('page', { combo: 'escape', priority: 1, handler: () => hits.push('clear') });
      const split = () => r2.register('page', { combo: 'escape', handler: () => hits.push('close') });
      if (order === 'table-first') { table(); split(); } else { split(); table(); }
      r2.handle(key('Escape'));
      ok(`Esc precedence (${order}): the table clears first, the record stays open`, eq(hits, ['clear']));
    }
    const r3 = createHotkeyRegistry();
    const hits: string[] = [];
    r3.register('page', { combo: 'escape', priority: 1, enabled: false, handler: () => hits.push('clear') });
    r3.register('page', { combo: 'escape', handler: () => hits.push('close') });
    r3.handle(key('Escape'));
    ok('nothing left to clear (table Esc disabled) → Esc closes the record', eq(hits, ['close']));
    const r4 = createHotkeyRegistry();
    const imeHits: string[] = [];
    r4.register('page', { combo: 'escape', handler: () => imeHits.push('close') });
    const composing = key('Escape', { target: INPUT, isComposing: true });
    const safariIme = key('Escape', { target: INPUT, keyCode: 229 });
    ok('an Esc during IME composition belongs to the IME (not fired, not prevented)',
      r4.handle(composing) === false && r4.handle(safariIme) === false && imeHits.length === 0 && !composing.prevented && !safariIme.prevented);
  }

  log.length = 0;
  const offD = reg.register('dialog', { combo: 'escape', handler: () => log.push('dialog-esc') });
  reg.handle(key('e'));
  reg.handle(key('k', { metaKey: true }));
  reg.handle(key('Escape'));
  ok('a mounted dialog is EXCLUSIVE: page and global keys do not fire behind it', eq(log, ['dialog-esc']));
  offD();
  reg.handle(key('k', { metaKey: true }));
  ok('after the dialog closes, global keys work again', eq(log, ['dialog-esc', 'palette']));

  // ── Wave 6c (X0.6): a HANDLER-LESS dialog entry is still a dialog. Every
  // open sheet registers exactly that (components/ui/Sheet
  // SHEET_DIALOG_BINDINGS: Esc with no handler — RN-web's Modal does the
  // closing). The WS1 mutant (hasDialog counts only entries WITH a handler)
  // let the page's j and the record's Esc fire behind every open sheet.
  for (const [name, dialogEsc] of [
    ['(a) handler-less', { combo: 'escape' }],
    ['(b) handler-less AND disabled', { combo: 'escape', enabled: false }],
  ] as const) {
    const r = createHotkeyRegistry();
    let page = 0; let global = 0;
    r.register('page', { combo: 'j', handler: () => { page++; } });
    r.register('global', { combo: 'escape', handler: () => { global++; } });
    r.register('page', { combo: 'escape', handler: () => { page++; } });
    r.register('dialog', dialogEsc);
    const esc = key('Escape');
    const fired = [r.handle(key('j')), r.handle(esc)];
    ok(`${name} dialog Esc is still EXCLUSIVE: j and Esc fire nothing behind it`,
      page === 0 && global === 0 && fired.every((f) => f === false) && !esc.prevented, `page ${page}, global ${global}`);
  }
  {
    // (c) Cmd+S under an open sheet with no primary: the dialog's noop
    // consumes it (one preventDefault — no "Save page as…"), the page save
    // behind the dialog never runs.
    const r = createHotkeyRegistry();
    let saves = 0; let prevented = 0;
    r.register('page', { combo: 'mod+s', handler: () => { saves++; } });
    r.register('dialog', { combo: 'escape' });
    r.register('dialog', { combo: 'mod+s', handler: () => {} });
    const ev = { key: 's', metaKey: true, preventDefault: () => { prevented++; } } as KeyLike;
    ok('(c) Cmd+S in a dialog with no primary: consumed once, the page save runs 0 times',
      r.handle(ev) === true && prevented === 1 && saves === 0, `prevented ${prevented}, saves ${saves}`);
    // …and a sheet WITH a primary outranks the noop (priority 1).
    let primary = 0;
    r.register('dialog', { combo: 'mod+s', priority: 1, handler: () => { primary++; } });
    r.handle(key('s', { metaKey: true }));
    ok('(c2) a sheet primary (priority 1) outranks the dialog Cmd+S noop', primary === 1 && saves === 0);
  }
  {
    // (d) `when` (wave 6c): the shell dock's GLOBAL Esc skips an Esc typed in
    // a page field — the page's own Esc (or nothing) gets it — but still fires
    // for an Esc typed in the dock's own field.
    const r = createHotkeyRegistry();
    let dock = 0;
    const DOCK_FIELD = { tagName: 'INPUT', type: 'text', closest: (sel: string) => (sel === '#shell-dock' ? {} : null) };
    r.register('global', {
      combo: 'escape', handler: () => { dock++; },
      when: (ev) => !isTypingTarget(ev.target) || targetWithin(ev.target, 'shell-dock'),
    });
    const inPageField = key('Escape', { target: { tagName: 'INPUT', type: 'text', closest: () => null } });
    ok('(d) when: an Esc typed in a PAGE field leaves the dock open (not fired, not prevented)',
      r.handle(inPageField) === false && dock === 0 && !inPageField.prevented);
    ok('(d) when: an Esc typed in the dock\'s own field closes it', r.handle(key('Escape', { target: DOCK_FIELD })) === true && dock === 1);
    ok('(d) when: an Esc outside any field closes it', r.handle(key('Escape', { target: { tagName: 'DIV' } })) === true && dock === 2);
    ok('targetWithin: only a DOM-like target with a matching closest()',
      targetWithin(DOCK_FIELD, 'shell-dock') && !targetWithin(DOCK_FIELD, 'other') && !targetWithin(null, 'x') && !targetWithin({ tagName: 'DIV' }, 'x'));
  }

  log.length = 0;
  const ev = key('j', { target: INPUT });
  reg.register('page', { combo: 'j', handler: () => log.push('j') });
  ok('typing j in a field is NOT a shortcut', reg.handle(ev) === false && log.length === 0 && !ev.prevented);
  const ev2 = key('j');
  let stopped = false;
  ev2.stopPropagation = () => { stopped = true; };
  reg.handle(ev2);
  ok('j outside a field fires and consumes the key', eq(log, ['j']) && ev2.prevented);
  ok('firing never stops propagation (the focused field keeps its own Esc / Enter)', !stopped);
  log.length = 0;
  reg.register('page', { combo: 'mod+enter', handler: () => log.push('save') });
  const inField = key('Enter', { target: INPUT, metaKey: true });
  ok('Cmd+Enter typed IN a field fires (capture-phase key) and is consumed', reg.handle(inField) === true && eq(log, ['save']) && inField.prevented);

  log.length = 0;
  reg.register('page', { combo: 'n', handler: () => log.push('disabled'), enabled: false });
  reg.register('page', { combo: 'm', label: 'Listed only' });
  ok('disabled and listing-only bindings never fire', reg.handle(key('n')) === false && reg.handle(key('m')) === false && log.length === 0);

  const before = reg.size();
  const off = reg.register('global', { combo: 'mod+w', handler: () => log.push('stolen') });
  off();
  ok('Cmd+W is refused (never registered, warned)', reg.size() === before && warnings.some((w) => w.includes('mod+w')));

  log.length = 0;
  reg.register('global', { combo: 'g h', handler: () => log.push('home') });
  reg.register('global', { combo: 'g p', handler: () => log.push('projects') });
  now = 1000; reg.handle(key('g'));
  now = 1500; reg.handle(key('p'));
  ok('sequence g then p goes to Projects', eq(log, ['projects']));
  now = 5000; reg.handle(key('g'));
  now = 5000 + SEQUENCE_TIMEOUT_MS + 1; reg.handle(key('h'));
  ok('a sequence expires after the timeout', eq(log, ['projects']));
  now = 9000; reg.handle(key('g', { target: INPUT }));
  now = 9100; reg.handle(key('h', { target: INPUT }));
  ok('typing "gh" in a field is not a sequence', eq(log, ['projects']));

  const listed = reg.list();
  ok('list(): labelled bindings, one row per scope+combo, grouped', listed.some((l) => l.label === 'Search' && l.group === 'Go') && listed.some((l) => l.label === 'Listed only'));
  offG();
  ok('formatCombo: ⌘⇧Z on a Mac, Ctrl+Shift+Z elsewhere, sequences read "G then H"',
    formatCombo('mod+shift+z', true) === '⌘⇧Z' && formatCombo('mod+shift+z', false) === 'Ctrl+Shift+Z' && formatCombo('g h', true) === 'G then H');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nE. source pins');
// ─────────────────────────────────────────────────────────────────────────────

// ── Navigator focus (reviewer round 4): a screen under a pushed route stays
// mounted behind display:none on web; its bindings must be off. ─────────────
{
  ok('bindingsLive: all three must hold', bindingsLive(true, true, true)
    && !bindingsLive(true, true, false) && !bindingsLive(true, false, true) && !bindingsLive(false, true, true));
  ok('focusSnapshot: outside any navigator counts as focused', focusSnapshot(null) === true && focusSnapshot(undefined) === true);
  let focused = true;
  const listeners: Record<string, Set<() => void>> = { focus: new Set(), blur: new Set() };
  const nav: FocusSource = {
    isFocused: () => focused,
    addListener: (type, cb) => { listeners[type].add(cb); return () => { listeners[type].delete(cb); }; },
  };
  ok('focusSnapshot: a focused screen is live', focusSnapshot(nav) === true);
  focused = false;
  ok('focusSnapshot: a screen under a pushed route is NOT live', focusSnapshot(nav) === false);
  let calls = 0;
  const off = subscribeFocus(nav, () => { calls++; });
  ok('subscribeFocus: listens to BOTH focus and blur', listeners.focus.size === 1 && listeners.blur.size === 1);
  for (const cb of listeners.blur) cb();
  focused = true;
  for (const cb of listeners.focus) cb();
  ok('subscribeFocus: each focus / blur re-reads', calls === 2);
  off();
  ok('subscribeFocus: unsubscribes both', listeners.focus.size === 0 && listeners.blur.size === 0);
  ok('subscribeFocus: no navigator = nothing to listen to', typeof subscribeFocus(null, () => {}) === 'function');
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const typesSrc = read('types/index.ts');
const statusUnion = /export interface Project \{[\s\S]*?\n\s*status: ([^;]+);/.exec(typesSrc)?.[1] ?? '';
ok("Project['status'] in types/index.ts is exactly projectStage's ProjectStatus",
  eq(statusUnion.split('|').map((s) => s.trim().replace(/'/g, '')).sort(), [...STATUSES].sort()), statusUnion);

const L4 = [
  'components/desktop/DataTable.tsx', 'components/desktop/SplitView.tsx', 'components/desktop/KpiStrip.tsx',
  'components/desktop/SidePanel.tsx', 'components/desktop/NoticeStrip.tsx', 'components/desktop/LineItemGrid.tsx',
  'components/desktop/ToolbarActions.tsx', 'components/desktop/FormGrid.tsx',
];
for (const f of L4) {
  const src = strip(read(f));
  ok(`${f}: gated on useResponsiveLayout().isDesktop`, /useResponsiveLayout\(\)/.test(src) && /isDesktop/.test(src));
  ok(`${f}: no hex colours (theme tokens only)`, !/['"]#[0-9a-fA-F]{3,8}['"]/.test(src));
  ok(`${f}: never AsyncStorage.clear()`, !/AsyncStorage\.clear\(/.test(src));
  const keys = [...src.matchAll(/AsyncStorage\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  ok(`${f}: every storage key comes from a mageid_ key helper`,
    keys.every((k) => /^(tablePrefsKey|splitRatioKey|sidePanelWidthKey|noticeDismissKey)\(/.test(k)), keys.join(' | '));
  ok(`${f}: imports nothing from the other 6b lanes`, !/components\/desktop\/(DesktopPageFrame|ShellDock|RowLink|JobSwitcher)|ActiveProjectContext|components\/ui\/(SegmentedControl|Sheet|ActionBar|TileGrid|ChipRail|desktop)/.test(src));
}
// The phone paths: exactly the screen's own nodes, no wrapper.
const phoneFragment = (f: string, expr: RegExp) => ok(`${f}: phone renders the screen's own nodes in a bare fragment`, expr.test(strip(read(f))));
phoneFragment('components/desktop/DataTable.tsx', /if \(!isDesktop\) \{[\s\S]{0,120}return \(\s*<>\s*\{props\.rows\.map\(\(row, i\) => \(\s*<React\.Fragment key=\{props\.rowKey\(row\)\}>\{props\.renderCard\(row, i\)\}<\/React\.Fragment>/);
phoneFragment('components/desktop/LineItemGrid.tsx', /if \(!isDesktop\) \{\s*return \(\s*<>\s*\{props\.rows\.map\(\(row, i\) => \(\s*<React\.Fragment key=\{props\.rowKey\(row\)\}>\{props\.renderCard\(row, i\)\}<\/React\.Fragment>/);
phoneFragment('components/desktop/SplitView.tsx', /if \(!isDesktop\) return <>\{props\.list\}<\/>;/);
phoneFragment('components/desktop/FormGrid.tsx', /if \(!isDesktop\) return <>\{children\}<\/>;[\s\S]*if \(!ctx \|\| !isDesktop\) return <>\{children\}<\/>;/);
// A Link on web loses its router handler to ANY onPress key we pass (it is
// spread over Link's own, and react-native-web drops the onClick copy), so a
// plain click hard-reloads the SPA. The only allowed shape is a CONDITIONAL
// spread of onPress; never an `onPress=` attribute on <Link>.
for (const f of ['components/desktop/DataTable.tsx', 'components/desktop/KpiStrip.tsx', 'components/desktop/ToolbarActions.tsx']) {
  const src = strip(read(f));
  const links = [...src.matchAll(/<Link\b[^>]*>/g)].map((m) => m[0]);
  ok(`${f}: no <Link onPress=…> (would hard-reload the SPA on web)`, links.length > 0 && links.every((l) => !/\bonPress=/.test(l)), links.join(' | '));
}
{
  const dt = strip(read('components/desktop/DataTable.tsx'));
  ok('DataTable: Link onPress only when rows open in place, and it preventDefaults the plain click',
    /\.\.\.\(onPlainLinkClick\s*\?\s*\{\s*onPress:[\s\S]{0,160}isPlainClick\(e\)[\s\S]{0,60}preventDefault/.test(dt));
  ok('DataTable: with a record open, j/k step it through the VISIBLE keys (stepOpenRow over visibleKeys)',
    /stepOpenRow\(visibleKeys, activeKey, delta\)/.test(dt) && /combo: 'j', enabled: gates\.j, handler: \(\) => step\(1\)/.test(dt) && /combo: 'k', enabled: gates\.k, handler: \(\) => step\(-1\)/.test(dt));
  ok("DataTable: its Esc outranks SplitView's (priority 1) and is gated by tableKeyGates",
    /combo: 'escape',[\s\S]{0,400}enabled: gates\.escape,\s*priority: 1/.test(dt));
  ok('DataTable: every key reads its gate from tableKeyGates, fed by the SplitView hidden flag',
    /const listHidden = useSplitListHidden\(\)/.test(dt) && /tableKeyGates\(\{[\s\S]{0,200}listHidden,?\s*\}\)/.test(dt)
    && /combo: 'arrowdown', enabled: gates\.arrows/.test(dt) && /combo: 'arrowup', enabled: gates\.arrows/.test(dt)
    && /enabled: gates\.enter/.test(dt) && /enabled: gates\.x/.test(dt) && /enabled: gates\.selectAll/.test(dt)
    && /combo: '\/'[\s\S]{0,80}enabled: gates\.search/.test(dt));
  ok('DataTable: a search box that becomes hidden gives up focus', /if \(listHidden\) searchRef\.current\?\.blur\(\)/.test(dt));
  const sv = strip(read('components/desktop/SplitView.tsx'));
  ok('SplitView: binds Esc only — no j/k (the list owns the visible order)',
    /combo: 'escape'/.test(sv) && !/combo: '[jk]'/.test(sv) && !/recordIds/.test(sv) && !/priority:/.test(sv));
  ok('SplitView: single mode tells the hidden list it is hidden (SplitListHiddenContext = single && hasRecord)',
    /styles\.pane, hasRecord && styles\.hidden[\s\S]{0,300}<SplitListHiddenContext\.Provider value=\{single && hasRecord\}>\{list\}/.test(sv));
  // Crossing 1100 px must not remount the list (reviewer round 4): ONE return
  // in the desktop split, whose FIRST child is the list's pane in both modes.
  const desk = sv.slice(sv.indexOf('function DesktopSplitView'), sv.indexOf('const makeStyles'));
  const returns = desk.match(/\breturn \(?\s*</g) ?? []; // JSX returns only
  ok('SplitView: one render tree for split AND single (a single return)', returns.length === 1, String(returns.length));
  ok("SplitView: the list's pane is the root's FIRST child in both modes",
    /return \(\s*<View style=\{\[single \? styles\.single : styles\.split, style\]\}[^>]*>\s*<View\s+style=\{single \? \[styles\.pane, hasRecord && styles\.hidden\] : \[styles\.listPane, \{ width: listWidth \}\]\}[^>]*>\s*<SplitListHiddenContext\.Provider/.test(desk));
  const kpi = strip(read('components/desktop/KpiStrip.tsx'));
  ok('KpiStrip: onPress key only when the cell has one; web plain click navigates in-app',
    /c\.onPress \? \{ onPress: linkPressWithSideEffect\(/.test(kpi) && /isPlainClick\(e\)\)\s*return;\s*e\.preventDefault\?\.\(\);\s*navigate\(\)/.test(kpi));
}
const hk = strip(read('hooks/useHotkeys.ts'));
ok('useHotkeys: a CAPTURE listener for typing-target keys + a bubble listener for the rest',
  /addEventListener\('keydown', onCaptureKeyDown, true\)/.test(hk) && /addEventListener\('keydown', onBubbleKeyDown\)/.test(hk)
  && /removeEventListener\('keydown', onCaptureKeyDown, true\)/.test(hk));
ok('useHotkeys: registers only on desktop AND only while its screen is focused',
  /const isDesktop = useIsDesktop\(\)/.test(hk) && /const screenFocused = useIsScreenFocused\(\)/.test(hk)
  && /const enabled = bindingsLive\(options\.enabled \?\? true, isDesktop, screenFocused\)/.test(hk)
  && /\}, \[signature, scope, enabled\]\)/.test(hk));
ok('useIsScreenFocused: NavigationContext (never useIsFocused, which throws outside a navigator), kept live by focus/blur',
  /const \{ NavigationContext \} = require\('@react-navigation\/native'\)/.test(hk) && /useContext\(NavigationContext\)/.test(hk)
  && /useSyncExternalStore\(subscribe, snapshot, snapshot\)/.test(hk) && /subscribeFocus\(nav, cb\)/.test(hk)
  && /focusSnapshot\(nav\)/.test(hk) && !/useIsFocused\(/.test(hk));
ok('useHotkeys: no react-native import (bun-executable, and a no-op without a DOM)', !/from 'react-native'/.test(hk) && /typeof g\.document === 'undefined'/.test(hk));
ok('usePrimaryAction binds Cmd+Enter AND Cmd+S, and explains a blocked action', /combo: 'mod\+enter'/.test(hk) && /combo: 'mod\+s'/.test(hk) && /explainBlocked\(/.test(hk));
ok('useHotkeys: `when` is forwarded through the ref and recorded in the signature',
  /when: b\.when \? \(ev\) => ref\.current\[i\]\?\.when\?\.\(ev\)/.test(hk) && /\|\$\{b\.when \? 1 : 0\}/.test(hk)
  && (hk.match(/if \(e\.binding\.when && !e\.binding\.when\(ev\)\) continue;/g) ?? []).length === 3);

// ── Wave 6c (X0.6 §E): the dialog wiring the registry tests above assume.
{
  const sheet = strip(read('components/ui/Sheet.tsx'));
  const bindings = /const SHEET_DIALOG_BINDINGS[^=]*=\s*\[([\s\S]*?)\];/.exec(sheet)?.[1] ?? '';
  ok('Sheet: SHEET_DIALOG_BINDINGS = a handler-less Esc + a Cmd+S noop',
    /\{\s*combo:\s*'escape'\s*\}/.test(bindings) && /\{\s*combo:\s*'mod\+s',\s*handler:\s*NOOP\s*\}/.test(bindings), bindings);
  const primary = sheet.slice(sheet.indexOf('export function useSheetPrimaryHotkey'));
  const primaryBody = primary.slice(0, primary.indexOf('\n}\n') + 2);
  ok("Sheet: useSheetPrimaryHotkey binds 'mod+enter' AND 'mod+s' at priority 1 in scope 'dialog'",
    /\{\s*combo:\s*'mod\+enter',[^}]*priority:\s*1\s*\}/.test(primaryBody)
    && /\{\s*combo:\s*'mod\+s',[^}]*priority:\s*1\s*\}/.test(primaryBody)
    && /scope:\s*'dialog'/.test(primaryBody), primaryBody.slice(0, 300));
  const frameFn = sheet.slice(sheet.indexOf('export function useSheetFrame('), sheet.indexOf('export function SheetOverlay'));
  ok('Sheet: useSheetFrame claims the dialog scope while visible === true',
    /useSheetDialogScope\(opts\.visible === true\);/.test(frameFn) && frameFn.indexOf('useSheetDialogScope(') < frameFn.indexOf('if (!isDesktop)'));
  const alertHost = strip(read('components/AlertHost.tsx'));
  const scopeAt = alertHost.indexOf('useSheetDialogScope(current !== null)');
  ok('AlertHost: an open alert is a dialog — useSheetDialogScope before the early return',
    scopeAt > 0 && scopeAt < alertHost.indexOf('if (!current) return null'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
