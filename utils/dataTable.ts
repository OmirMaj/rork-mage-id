// utils/dataTable.ts — the pure half of the desktop DataTable and LineItemGrid
// (components/desktop/DataTable.tsx, components/desktop/LineItemGrid.tsx).
//
// PURE: no React, no react-native import, so scripts/validate-desktop-workspace.ts
// can execute every function here under bun.
//
// WHY THIS EXISTS. The web audits (wave 6b) found the same list re-built by
// hand in a dozen screens — RFIs, submittals, change orders, invoices, subs,
// COIs, payments — each with its own sort (or none), its own "0" for a value
// nobody entered, and no way to pick more than one row. A general contractor
// working a register on a 1512 px laptop expects what every other desktop tool
// gives him: click a header to sort, shift-click a range, search as you type.
// The rules for those are here, once, and tested:
//
//   • sort is STABLE (equal keys keep the screen's order, so a re-sort never
//     shuffles rows he was not sorting by) and puts unknown values LAST in both
//     directions — an RFI with no due date is not "the most overdue";
//   • dates compare by timestamp, never as text ("2026-10-02" vs "Oct 2");
//   • an unknown value renders '—', never 0 — a blank contract value shown as
//     $0 reads as "this job is free";
//   • shift-click selects the range between the anchor and the row clicked, in
//     the order he SEES (sorted + filtered), not the order of the source array.

import { csvCell } from '@/utils/punchExportCore';
import { MAX_PASTE_ROWS } from '@/utils/pasteRows';

// ─────────────────────────────────────────────────────────────────────────────
// Values
// ─────────────────────────────────────────────────────────────────────────────

/** What a column's sortValue may return. */
export type SortValue = string | number | boolean | Date | null | undefined;

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDirection;
}

/** The dash the whole app uses for "we don't know". */
export const UNKNOWN_CELL = '—';

/**
 * A comparable form of a sort value, or null when the value is unknown.
 * Unknown = null, undefined, NaN/±Infinity, an empty or whitespace string, or
 * an Invalid Date. A date becomes its timestamp; a boolean becomes 0/1.
 */
export function normalizeSortValue(v: SortValue): number | string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim();
  return s ? s : null;
}

const COLLATOR = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
  ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  : null;

/** Compare two KNOWN normalized values. Numbers before strings when mixed. */
function compareKnown(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  if (COLLATOR) return COLLATOR.compare(a, b);
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la === lb ? 0 : la < lb ? -1 : 1;
}

/**
 * Stable sort of `rows` by `getValue`. Unknown values go LAST whichever way
 * the sort runs. Ties keep their input order (the index is the tie-breaker, so
 * this does not rely on the engine's Array.prototype.sort being stable).
 * Returns a new array; the input is not mutated.
 */
export function stableSortRows<T>(rows: readonly T[], getValue: (row: T) => SortValue, dir: SortDirection): T[] {
  const decorated = rows.map((row, index) => ({ row, index, v: normalizeSortValue(getValue(row)) }));
  const sign = dir === 'desc' ? -1 : 1;
  decorated.sort((a, b) => {
    if (a.v === null && b.v === null) return a.index - b.index;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    const c = compareKnown(a.v, b.v) * sign;
    return c !== 0 ? c : a.index - b.index;
  });
  return decorated.map((d) => d.row);
}

/** Click a header: off → asc → desc → off. A different column starts at asc. */
export function nextSortState(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Search / filter
// ─────────────────────────────────────────────────────────────────────────────

/** Lower-cased, accent-folded, whitespace-collapsed. */
export function foldSearchText(s: string): string {
  let out = String(s ?? '').toLowerCase();
  try { out = out.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch { /* old engine: skip folding */ }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Rows whose search text contains EVERY word of the query, in any order —
 * "henderson drywall" finds "Drywall — Henderson Residence". An empty query
 * returns the rows unchanged (same array).
 */
export function filterRowsBySearch<T>(rows: readonly T[], query: string, searchText: (row: T) => string): readonly T[] {
  const q = foldSearchText(query);
  if (!q) return rows;
  const words = q.split(' ').filter(Boolean);
  return rows.filter((row) => {
    const hay = foldSearchText(searchText(row) ?? '');
    return words.every((w) => hay.includes(w));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────

/** The keys between `anchor` and `target` inclusive, in VISIBLE order. If the
 *  anchor is no longer visible (filtered out) the range is just the target. */
export function selectionRange(visibleKeys: readonly string[], anchor: string | null, target: string): string[] {
  const ti = visibleKeys.indexOf(target);
  if (ti < 0) return [];
  const ai = anchor === null ? -1 : visibleKeys.indexOf(anchor);
  if (ai < 0) return [target];
  const [lo, hi] = ai <= ti ? [ai, ti] : [ti, ai];
  return visibleKeys.slice(lo, hi + 1);
}

export interface SelectionClick {
  key: string;
  shift: boolean;
}

/**
 * The selection after a checkbox click.
 *   plain  toggles that row; it becomes the anchor.
 *   shift  selects the whole visible range from the anchor to it (added to what
 *          is already selected — the spreadsheet convention); the anchor stays.
 */
export function applySelectionClick(
  selected: ReadonlySet<string>,
  anchor: string | null,
  visibleKeys: readonly string[],
  click: SelectionClick,
): { selected: Set<string>; anchor: string | null } {
  const next = new Set(selected);
  if (click.shift && anchor !== null && visibleKeys.includes(anchor)) {
    for (const k of selectionRange(visibleKeys, anchor, click.key)) next.add(k);
    return { selected: next, anchor };
  }
  if (next.has(click.key)) next.delete(click.key);
  else next.add(click.key);
  return { selected: next, anchor: click.key };
}

/** Drop selected keys that are no longer rows (deleted, filtered by the screen). */
export function pruneSelection(selected: ReadonlySet<string>, liveKeys: readonly string[]): Set<string> {
  const live = new Set(liveKeys);
  const out = new Set<string>();
  for (const k of selected) if (live.has(k)) out.add(k);
  return out;
}

/** 'none' | 'some' | 'all' — drives the header checkbox. */
export function selectionState(selected: ReadonlySet<string>, visibleKeys: readonly string[]): 'none' | 'some' | 'all' {
  if (visibleKeys.length === 0) return 'none';
  let n = 0;
  for (const k of visibleKeys) if (selected.has(k)) n++;
  if (n === 0) return 'none';
  return n === visibleKeys.length ? 'all' : 'some';
}

/** j/k cursor: clamp to the list; -1 (nothing focused) + down lands on row 0. */
export function moveCursor(index: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0) return delta < 0 ? count - 1 : 0;
  return Math.max(0, Math.min(count - 1, index + delta));
}

/**
 * Where the keyboard cursor sits when a record is open beside the table
 * (SplitView passes `activeKey`). While a record is open SplitView OWNS j/k —
 * it steps the open record — and the table only follows, so its cursor must
 * track the open row; otherwise a later Enter re-opens a stale row. An active
 * key that is not in the visible rows (searched away) leaves the cursor alone.
 */
export function cursorForActiveKey(visibleKeys: readonly string[], activeKey: string | null | undefined, current: number): number {
  // null/undefined → -1 is a type guard, not a rule: indexOf of a missing key
  // is already -1 (so mutating the guard is an equivalent mutant).
  const i = activeKey == null ? -1 : visibleKeys.indexOf(activeKey);
  return i >= 0 ? i : current;
}

/**
 * j/k while a record is open beside the table: the key of the record to open
 * next, in the order he SEES (the table's sort + search), or null for "stay".
 * The table is the only thing that knows that order, so it steps records
 * itself (SplitView binds no j/k). The open record searched out of view →
 * j opens the first visible row, k the last; a hidden row is never opened.
 */
export function stepOpenRow(visibleKeys: readonly string[], activeKey: string | null | undefined, delta: number): string | null {
  if (visibleKeys.length === 0) return null;
  const i = activeKey == null ? -1 : visibleKeys.indexOf(activeKey);
  const next = i < 0
    ? (delta < 0 ? visibleKeys[visibleKeys.length - 1] : visibleKeys[0])
    : visibleKeys[Math.max(0, Math.min(visibleKeys.length - 1, i + delta))];
  return next === activeKey ? null : next;
}

/** What decides which of the table's keys are live. */
export interface TableKeyState {
  /** A record is open beside the table (activeKey + onRowOpen — a SplitView). */
  stepping: boolean;
  /** Row index of the keyboard cursor; -1 = he has not driven the table yet. */
  cursor: number;
  selectable: boolean;
  searchable: boolean;
  /** Selection or search text exists for Esc to clear. */
  somethingToClear: boolean;
  /** The table is on the page but NOT on screen: a SplitView in single mode
   *  (container < 1100) with a record filling the pane keeps it mounted
   *  behind display:none so his search / scroll survive "Back to list". */
  listHidden: boolean;
}

export interface TableKeyGates {
  j: boolean; k: boolean; arrows: boolean; enter: boolean;
  x: boolean; selectAll: boolean; search: boolean; escape: boolean;
}

/**
 * THE RULE for the table's keys, in one place (so it can be executed, not
 * just read):
 *
 *  • j/k are the table's: they move the cursor, or — with a record open —
 *    step it in the order he sees. Stepping is the ONLY thing a hidden
 *    table may still do, because it is the only thing that changes what he
 *    SEES (the record). Every other key acting on an invisible table would
 *    be a silent surprise: Esc clearing a search he cannot see (so Esc, the
 *    close key, looks broken), '/' dropping focus into an invisible box
 *    (every later keystroke types there), Cmd+A ticking invisible rows
 *    instead of selecting page text.
 *  • ↑/↓ belong to the table only while he is driving the cursor and NO
 *    record is open. With a record open the arrows scroll the record he is
 *    reading (the browser default); j/k step records.
 *  • Enter opens the cursor's row only when nothing is open (the open
 *    record owns Enter).
 */
export function tableKeyGates(s: TableKeyState): TableKeyGates {
  const visible = !s.listHidden;
  return {
    // A hidden table without stepping (no activeKey wired) would only move
    // a cursor nobody can see — so nothing.
    j: s.stepping || visible,
    k: s.stepping || visible,
    arrows: !s.stepping && s.cursor >= 0 && visible,
    enter: !s.stepping && s.cursor >= 0 && visible,
    x: s.selectable && s.cursor >= 0 && visible,
    selectAll: s.selectable && visible,
    search: s.searchable && visible,
    escape: s.somethingToClear && visible,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Links
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A plain left click on a link (no Cmd/Ctrl/Shift/Alt, left button). Anything
 * else belongs to the browser — Cmd/Ctrl-click and middle-click open a new
 * tab, Shift-click a new window — exactly as on any other link. A keyboard
 * "press" (Enter on a focused link) has no button and counts as plain.
 */
export function isPlainClick(e: unknown): boolean {
  const ev = e as { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number } | null | undefined;
  if (!ev || typeof ev !== 'object') return true;
  return !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey && (ev.button == null || ev.button === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────────────────

export interface ColumnVisibilityInput {
  key: string;
  /** Hide the column when the TABLE's container is narrower than this. */
  hideBelow?: number;
}

/** Columns shown at `containerWidth`, minus any the user hid. The first column
 *  (the record's name) can never be hidden — a table of bare numbers is not a
 *  list of anything. */
export function visibleColumnKeys(
  columns: readonly ColumnVisibilityInput[],
  containerWidth: number,
  userHidden: readonly string[],
): string[] {
  const hidden = new Set(userHidden);
  return columns
    .filter((c, i) => {
      if (i === 0) return true;
      if (hidden.has(c.key)) return false;
      if (typeof c.hideBelow === 'number' && Number.isFinite(containerWidth) && containerWidth > 0 && containerWidth < c.hideBelow) return false;
      return true;
    })
    .map((c) => c.key);
}

/** The text a cell shows when the column has no render(): unknown → '—'. */
export function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return UNKNOWN_CELL;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : UNKNOWN_CELL;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : UNKNOWN_CELL;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v).trim();
  return s ? s : UNKNOWN_CELL;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted table preferences (sort + hidden columns)
// ─────────────────────────────────────────────────────────────────────────────

/** mageid_ prefix: swept by wipeLocalUserCache on sign-out / tenant switch
 *  (utils/localCacheKeys APP_STORAGE_PREFIXES), so one GC's column choices
 *  never follow the next person onto a shared laptop. */
export function tablePrefsKey(tableId: string): string {
  return `mageid_table_${tableId}`;
}

export interface TablePrefs {
  sort: SortState | null;
  hidden: string[];
}

/** Parse what was stored; anything malformed falls back to the defaults. */
export function parseTablePrefs(raw: string | null | undefined, knownKeys: readonly string[]): TablePrefs {
  const empty: TablePrefs = { sort: null, hidden: [] };
  if (!raw) return empty;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return empty; }
  if (!parsed || typeof parsed !== 'object') return empty;
  const p = parsed as { sort?: unknown; hidden?: unknown };
  const known = new Set(knownKeys);
  let sort: SortState | null = null;
  if (p.sort && typeof p.sort === 'object') {
    const s = p.sort as { key?: unknown; dir?: unknown };
    if (typeof s.key === 'string' && known.has(s.key) && (s.dir === 'asc' || s.dir === 'desc')) sort = { key: s.key, dir: s.dir };
  }
  const hidden = Array.isArray(p.hidden) ? p.hidden.filter((k): k is string => typeof k === 'string' && known.has(k)) : [];
  return { sort, hidden };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

/** Rows as CSV, one cell per column, through the app's one csvCell (RFC 4180
 *  quoting + the formula-injection guard). An unknown value is an EMPTY cell,
 *  not '—' and not 0, so a spreadsheet SUM is not lied to. */
export function rowsToCsv<T>(
  columns: readonly { key: string; label: string; csvValue?: (row: T) => string | number | null | undefined }[],
  rows: readonly T[],
): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => {
      const v = c.csvValue ? c.csvValue(row) : (row as Record<string, unknown>)[c.key];
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return csvCell(v);
      return csvCell(String(v));
    }).join(','));
  }
  return lines.join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// LineItemGrid — paste, numbers, totals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clipboard text → a matrix of cells. The same line split and row cap as the
 * scheduler's paste-rows parser (utils/pasteRows), but columns stay generic —
 * a change-order line is Description | Qty | Unit | Unit $, not Title |
 * Duration | Phase. Blank lines are dropped; trailing empty cells are kept so
 * column positions line up. Text with no tab and no newline is NOT a grid
 * paste (returns []), so an ordinary paste into one cell is left alone.
 */
export function parsePastedGrid(text: string): string[][] {
  if (!text) return [];
  const trimmed = text.replace(/(\r\n|\r|\n)+$/, '');
  if (trimmed.indexOf('\t') < 0 && !/\r\n|\r|\n/.test(trimmed)) return [];
  const out: string[][] = [];
  for (const line of trimmed.split(/\r\n|\r|\n/)) {
    if (out.length >= MAX_PASTE_ROWS) break;
    if (!line.trim()) continue;
    out.push(line.split('\t').map((c) => c.trim()));
  }
  return out;
}

/**
 * A number as a GC types or pastes it: "$1,234.50", "12 %", "(250)" (the
 * accountant's negative), "-3". Anything else (blank, "TBD", "n/a") is null —
 * unknown, never zero.
 */
export function parseGridNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/[$€£\s,%]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export interface ColumnTotal {
  /** Sum of the cells that are numbers. Null when no cell is a number. */
  total: number | null;
  /** Cells with text that is not a number — the total leaves them out and says so. */
  unparsed: number;
}

/** Sum a column. Empty cells are skipped silently (an unfilled line adds
 *  nothing); a cell with text that is not a number is counted in `unparsed`,
 *  so the footer can say "2 lines not counted" instead of pretending. */
export function sumColumn(values: readonly unknown[]): ColumnTotal {
  let total = 0;
  let any = false;
  let unparsed = 0;
  for (const v of values) {
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) continue;
    const n = parseGridNumber(v);
    if (n === null) { unparsed++; continue; }
    total += n;
    any = true;
  }
  // Cents: 0.1 + 0.2 must not print as 0.30000000000000004.
  return { total: any ? Math.round(total * 100) / 100 : null, unparsed };
}

/**
 * Where Tab / Shift-Tab goes in the grid: the next editable cell to the right,
 * wrapping to the next row's first. Null past either end (the browser's own
 * Tab then leaves the grid, which is what a keyboard user expects).
 */
export function nextGridCell(
  rowCount: number,
  editableCols: readonly number[],
  at: { row: number; col: number },
  backwards: boolean,
): { row: number; col: number } | null {
  if (rowCount <= 0 || editableCols.length === 0) return null;
  const cols = [...editableCols].sort((a, b) => a - b);
  const ci = cols.indexOf(at.col);
  if (ci < 0) return { row: Math.max(0, Math.min(rowCount - 1, at.row)), col: cols[0] };
  if (!backwards) {
    if (ci + 1 < cols.length) return { row: at.row, col: cols[ci + 1] };
    return at.row + 1 < rowCount ? { row: at.row + 1, col: cols[0] } : null;
  }
  if (ci > 0) return { row: at.row, col: cols[ci - 1] };
  return at.row > 0 ? { row: at.row - 1, col: cols[cols.length - 1] } : null;
}
