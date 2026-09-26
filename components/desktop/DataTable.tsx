// components/desktop/DataTable.tsx — the register a GC expects on a laptop.
//
// WHY THIS EXISTS. The wave-6b web audits found every log in the app (RFIs,
// submittals, change orders, invoices, dailies, subs, COIs, payments, lien
// waivers, contacts, crew, leads, documents…) rendered as the phone's card list
// stretched across a 1512 px screen: one record per 120 px card, no sort, no
// multi-select, no keyboard. This is the one table they all adopt (wave 6c).
//
// PHONE IDENTICAL. Below the desktop gate (useResponsiveLayout().isDesktop —
// web ≥ 900 CSS px) the component returns EXACTLY `rows.map(renderCard)` in a
// fragment: no wrapper View, no extra style. A screen that adopts it keeps the
// iPhone tree it has today (proved by __tests__/smoke/desktop-primitives).
//
// DESKTOP (≥ 900):
//   • 32 px sticky header; click a sortable header: asc → desc → off;
//   • 40 px rows (36 compact), hover highlight, numeric columns right-aligned
//     in tabular figures; an unknown value is '—', never 0;
//   • optional checkbox column: click, shift-click for a range (in the order
//     he SEES), Cmd/Ctrl+A for all; a bulk bar appears while anything is
//     selected; a blocked bulk action stays visible and says why;
//   • keyboard (web): j/k (and ↑/↓ once the table has a cursor and no record
//     is open) move, Enter opens, x selects, / searches, Esc clears
//     (selection, then search). Which key is live is ONE executed rule,
//     tableKeyGates in utils/dataTable.ts;
//   • columns hide by the TABLE's measured width (hideBelow) and by his own
//     choice; sort + hidden columns persist in `mageid_table_<tableId>`;
//   • rows with getRowHref are real links on web (expo-router Link → <a>), so
//     Cmd/Ctrl-click and middle-click open a new tab. A plain click runs
//     onRowOpen when given (SplitView opens the record beside the list),
//     otherwise expo-router navigates in-app (no page reload — proved in a
//     real DOM by __tests__/web/desktop-primitives.webtest.tsx);
//   • inside a SplitView pass activeKey={openId} and onRowOpen: while a record
//     is open, j/k open the next / previous row IN THE ORDER HE SEES
//     (sort + search — only the table knows it, so SplitView binds no j/k),
//     never a row the search hides; the cursor follows the open row.
//   • Esc precedence is fixed, not registration order: the table's Esc
//     (priority 1) clears its selection, then its search; only when the table
//     has nothing left to clear does SplitView's Esc close the record.
//   • hidden list (SplitView single mode, record filling the pane): the
//     table stays mounted but only j/k reach it — no Esc, '/', x or Cmd+A
//     acting on rows he cannot see; its search box gives up focus.
//
// The pure rules (stable sort, search, selection ranges, column hiding, prefs
// parsing, CSV) live in utils/dataTable.ts, executed by
// scripts/validate-desktop-workspace.ts.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, useRouter, type Href } from 'expo-router';
import { ArrowDown, ArrowUp, Check, Columns3, Minus, Search, X } from 'lucide-react-native';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useSplitListHidden } from '@/components/desktop/SplitView';
import { cardSurface } from '@/components/ui/Card';
import { labelOn } from '@/components/ui/ink';
import { webMotion } from '@/components/ui/motion';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { showAlert } from '@/utils/alert';
import {
  applySelectionClick,
  cursorForActiveKey,
  filterRowsBySearch,
  formatCellValue,
  isPlainClick,
  moveCursor,
  nextSortState,
  parseTablePrefs,
  pruneSelection,
  selectionState,
  stableSortRows,
  stepOpenRow,
  tableKeyGates,
  tablePrefsKey,
  UNKNOWN_CELL,
  visibleColumnKeys,
  type SortState,
  type SortValue,
} from '@/utils/dataTable';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  /** Fixed width (px). Otherwise the column flexes. */
  width?: number;
  flex?: number;
  minWidth?: number;
  align?: 'left' | 'right' | 'center';
  /** Money, counts, days: right-aligned, tabular figures. */
  numeric?: boolean;
  /** Present → the header sorts. Return null/undefined for unknown (sorts last). */
  sortValue?: (row: T) => SortValue;
  /** Custom cell. Without it the cell shows value(row) (or row[key]) as text,
   *  with '—' for anything unknown. */
  render?: (row: T) => React.ReactNode;
  value?: (row: T) => unknown;
  /** Hide the column when the table is narrower than this (px). */
  hideBelow?: number;
}

export interface DataTableBulkAction {
  key?: string;
  label: string;
  run: (ids: string[]) => void;
  /** Non-null → the button stays visible, disabled, and says this when pressed. */
  disabledReason?: string | null;
  destructive?: boolean;
}

export interface DataTableProps<T> {
  /** Stable id — names the persisted prefs (`mageid_table_<tableId>`). */
  tableId: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  getRowHref?: (row: T) => Href;
  onRowOpen?: (row: T) => void;
  defaultSort?: SortState | null;
  /** Present → a search box; the text a row is searched by. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** The screen's own filter chips, shown in the toolbar (the screen filters `rows`). */
  filterChips?: React.ReactNode;
  selectable?: boolean;
  bulkActions?: readonly DataTableBulkAction[];
  /** Footer cell per column key. A key present with null/undefined shows '—'. */
  footerTotals?: Readonly<Record<string, React.ReactNode>>;
  emptyState?: React.ReactNode;
  /** REQUIRED: today's phone card. Below the desktop gate this is all that renders. */
  renderCard: (row: T, index: number) => React.ReactNode;
  density?: 'comfortable' | 'compact';
  /** Keyboard shortcuts (web). Default on; turn off when two tables share a page. */
  hotkeys?: boolean;
  /** The row whose record is open beside the table (SplitView's openId).
   *  Highlights it and keeps the cursor on it. With onRowOpen, j/k step the
   *  open record through the visible rows (sorted + searched order). */
  activeKey?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** CSS sticky, web only. RN's ViewStyle has no 'sticky' — react-native-web
 *  passes it straight to the DOM, where it pins the header to the page's
 *  scroll container. Native never reads this (the phone renders cards). */
const STICKY_HEADER: ViewStyle | null = Platform.OS === 'web'
  ? ({ position: 'sticky', top: 0, zIndex: 2 } as unknown as ViewStyle)
  : null;

const CHECK_COL = 40;

// Rows that APPEAR on a search or filter change fade in (slicker pass, web).
// Hoist into Motion.duration after round 2.
const ENTER_STAGGER_MS = 16;
/** The stagger stops growing after this many rows (8 × 16 = 128 ms at most). */
const ENTER_STAGGER_STEPS = 8;
/** Past this many appearing rows the rest simply show (no fade at all). */
const ENTER_MAX_ROWS = 30;
const EMPTY_SET: ReadonlySet<string> = new Set();

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function eventShift(e: GestureResponderEvent | undefined): boolean {
  const n = e?.nativeEvent as unknown as { shiftKey?: boolean } | undefined;
  return !!n?.shiftKey;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const { isDesktop } = useResponsiveLayout();
  if (!isDesktop) {
    // Today's phone list, untouched.
    return (
      <>
        {props.rows.map((row, i) => (
          <React.Fragment key={props.rowKey(row)}>{props.renderCard(row, i)}</React.Fragment>
        ))}
      </>
    );
  }
  return <DesktopDataTable {...props} />;
}

function DesktopDataTable<T>({
  tableId,
  columns,
  rows,
  rowKey,
  getRowHref,
  onRowOpen,
  defaultSort = null,
  searchText,
  searchPlaceholder = 'Search',
  filterChips,
  selectable = false,
  bulkActions,
  footerTotals,
  emptyState,
  density = 'comfortable',
  hotkeys: hotkeysOn = true,
  activeKey = null,
  style,
  testID,
}: DataTableProps<T>) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { width: containerWidth, onLayout } = useContainerWidth();

  const [sort, setSort] = useState<SortState | null>(defaultSort);
  const [hidden, setHidden] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const rowRefs = useRef(new Map<number, View | null>());
  const prefsLoaded = useRef(false);

  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns]);

  // Prefs: read once. A failed read (private window, blocked storage) keeps
  // the defaults — the table works without them.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(tablePrefsKey(tableId));
        if (!alive) return;
        const prefs = parseTablePrefs(raw, columnKeys);
        if (raw) {
          setSort(prefs.sort);
          setHidden(prefs.hidden);
        }
      } catch { /* defaults */ }
      prefsLoaded.current = true;
    })();
    return () => { alive = false; };
    // tableId only: re-reading on every columns identity change would undo
    // what he just clicked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  const persist = useCallback((next: { sort: SortState | null; hidden: string[] }) => {
    if (!prefsLoaded.current) return;
    AsyncStorage.setItem(tablePrefsKey(tableId), JSON.stringify(next)).catch(() => { /* best effort */ });
  }, [tableId]);

  const onHeaderPress = useCallback((key: string) => {
    const next = nextSortState(sort, key);
    setSort(next);
    persist({ sort: next, hidden });
  }, [sort, hidden, persist]);

  const toggleHidden = useCallback((key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    persist({ sort, hidden: next });
  }, [hidden, sort, persist]);

  const shownKeys = useMemo(
    () => new Set(visibleColumnKeys(columns, containerWidth - (selectable ? CHECK_COL : 0), hidden)),
    [columns, containerWidth, selectable, hidden],
  );
  const shownColumns = useMemo(() => columns.filter((c) => shownKeys.has(c.key)), [columns, shownKeys]);

  const visibleRows = useMemo(() => {
    const filtered = searchText ? filterRowsBySearch(rows, query, searchText) : rows;
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !col?.sortValue) return filtered;
    return stableSortRows(filtered, col.sortValue, sort.dir);
  }, [rows, query, searchText, sort, columns]);

  const visibleKeys = useMemo(() => visibleRows.map(rowKey), [visibleRows, rowKey]);

  // Which rows just APPEARED (a cleared search, another filter chip). Only a
  // key that was NOT in the previous visibleKeys ever fades; a row that stays
  // never flashes. The set persists until the visible keys change again, so
  // the follow-up renders (the cursor/selection effects below, a hover) keep
  // the same animation-name and never cancel a fade mid-flight. At mount it is
  // empty, so nothing fades and no golden moves. A sort (same keys, new
  // order) or a filter that only removes rows makes an empty set. Idempotent
  // under StrictMode: a second pass sees the keys it already recorded. A
  // caller whose rows/rowKey change identity every render gives a new array
  // with the same keys — that is not a change, the set is kept.
  const enterRef = useRef<{ keys: readonly string[]; entering: ReadonlySet<string> }>({ keys: visibleKeys, entering: EMPTY_SET });
  if (enterRef.current.keys !== visibleKeys) {
    if (sameKeys(enterRef.current.keys, visibleKeys)) {
      enterRef.current = { keys: visibleKeys, entering: enterRef.current.entering };
    } else {
      const prev = new Set(enterRef.current.keys);
      enterRef.current = { keys: visibleKeys, entering: new Set(visibleKeys.filter((k) => !prev.has(k))) };
    }
  }
  const entering = enterRef.current.entering;
  // The appearing rows' styles, in display order: a stagger of
  // ENTER_STAGGER_MS per row, capped at ENTER_STAGGER_STEPS steps; the rows
  // past ENTER_MAX_ROWS get none. null under Reduce Motion and on native
  // (webMotion), and whenever nothing appeared.
  const enterFade = entering.size > 0 ? webMotion('fadeIn') : null;
  let enterStyles: Map<string, StyleProp<ViewStyle>> | null = null;
  if (enterFade) {
    enterStyles = new Map();
    let n = 0;
    for (const k of visibleKeys) {
      if (!entering.has(k)) continue;
      if (n >= ENTER_MAX_ROWS) break;
      enterStyles.set(k, [enterFade, { animationDelay: `${Math.min(n, ENTER_STAGGER_STEPS) * ENTER_STAGGER_MS}ms` } as unknown as ViewStyle]);
      n += 1;
    }
  }

  // A deleted or searched-away row must not stay selected: a bulk action acts
  // on exactly the rows he can see ticked, never on one hidden by the search.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = pruneSelection(prev, visibleKeys);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleKeys]);

  useEffect(() => {
    if (cursor >= visibleRows.length) setCursor(visibleRows.length - 1);
  }, [cursor, visibleRows.length]);

  // A record open beside the table (SplitView → activeKey): the cursor follows
  // it, so j/k resume from the open row once it closes and Enter never
  // re-opens a stale one.
  useEffect(() => {
    setCursor((c) => cursorForActiveKey(visibleKeys, activeKey, c));
  }, [activeKey, visibleKeys]);

  // Keep the keyboard cursor's row on screen (web: a row's View is its DOM node).
  useEffect(() => {
    if (cursor < 0) return;
    const node = rowRefs.current.get(cursor) as unknown as { scrollIntoView?: (o: object) => void } | null | undefined;
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  const openRow = useCallback((row: T) => {
    if (onRowOpen) onRowOpen(row);
    else if (getRowHref) router.push(getRowHref(row));
  }, [onRowOpen, getRowHref, router]);

  const onCheck = useCallback((key: string, shift: boolean) => {
    const r = applySelectionClick(selected, anchor, visibleKeys, { key, shift });
    setSelected(r.selected);
    setAnchor(r.anchor);
  }, [selected, anchor, visibleKeys]);

  const allState = selectionState(selected, visibleKeys);
  const onCheckAll = useCallback(() => {
    if (allState === 'all') setSelected(new Set());
    else setSelected(new Set(visibleKeys));
  }, [allState, visibleKeys]);

  const moveTo = useCallback((delta: number) => {
    setCursor((c) => moveCursor(c, delta, visibleRows.length));
  }, [visibleRows.length]);

  const somethingToClear = selected.size > 0 || query.length > 0;
  // ONE owner for j/k: the table. While a record is open beside it
  // (activeKey + onRowOpen — a SplitView), j/k open the next / previous row
  // in the order he SEES: the table's own sort and search, which no screen
  // can see (it is internal state, restored from mageid_table_<id>). So
  // SplitView binds no j/k at all. With nothing open, j/k move the cursor.
  const stepping = activeKey !== null && activeKey !== undefined && !!onRowOpen;
  // Inside a SplitView in single mode with a record open, this table is
  // mounted but display:none. Only stepping may reach it.
  const listHidden = useSplitListHidden();
  // Every key's on/off, from one executed rule (utils/dataTable.ts).
  const gates = tableKeyGates({
    stepping,
    cursor,
    selectable: !!selectable,
    searchable: !!searchText,
    somethingToClear,
    listHidden,
  });
  // A search box he was typing in must not keep focus once it is hidden:
  // every later keystroke would land in a field he cannot see.
  useEffect(() => {
    if (listHidden) searchRef.current?.blur();
  }, [listHidden]);
  const step = (delta: number) => {
    if (!stepping) { moveTo(delta); return; }
    const next = stepOpenRow(visibleKeys, activeKey, delta);
    const row = next === null ? undefined : visibleRows[visibleKeys.indexOf(next)];
    if (row) onRowOpen?.(row);
  };
  useHotkeys(
    [
      { combo: 'j', enabled: gates.j, handler: () => step(1), label: 'Next row', group: 'Table' },
      // ↑/↓ only while he drives the cursor and nothing is open: with a
      // record open they scroll the record he is reading (browser default).
      { combo: 'arrowdown', enabled: gates.arrows, handler: () => step(1) },
      { combo: 'k', enabled: gates.k, handler: () => step(-1), label: 'Previous row', group: 'Table' },
      { combo: 'arrowup', enabled: gates.arrows, handler: () => step(-1) },
      {
        combo: 'enter',
        label: 'Open row',
        group: 'Table',
        // The open record is already open; Enter belongs to it.
        enabled: gates.enter,
        handler: () => { const row = visibleRows[cursor]; if (row) openRow(row); },
      },
      {
        combo: 'x',
        label: 'Select row',
        group: 'Table',
        enabled: gates.x,
        handler: () => { const k = visibleKeys[cursor]; if (k) onCheck(k, false); },
      },
      {
        combo: 'mod+a',
        label: 'Select all rows',
        group: 'Table',
        enabled: gates.selectAll,
        // Cmd+A inside the search box selects its text, not every row.
        blockInInput: true,
        handler: () => setSelected(new Set(visibleKeys)),
      },
      { combo: '/', label: 'Search the table', group: 'Table', enabled: gates.search, handler: () => searchRef.current?.focus() },
      {
        combo: 'escape',
        label: 'Clear selection / search',
        group: 'Table',
        // Only when there is something to clear, so Esc otherwise reaches the
        // SplitView record or panel it belongs to. Priority 1 beats their
        // Esc (priority 0) whatever order they registered in: clear the
        // table first, then close the record — every time.
        // Hidden (SplitView single mode): off, so the first Esc closes the
        // record he is looking at instead of clearing a search he can't see.
        enabled: gates.escape,
        priority: 1,
        handler: () => {
          if (selected.size > 0) setSelected(new Set());
          else { setQuery(''); searchRef.current?.blur(); }
        },
      },
    ],
    { enabled: hotkeysOn },
  );

  const rowHeight = density === 'compact' ? 36 : Layout.control.row;

  const cellBox = (c: DataTableColumn<T>): ViewStyle => (
    typeof c.width === 'number'
      ? { width: c.width, flexGrow: 0, flexShrink: 0 }
      : { flex: c.flex ?? 1, minWidth: c.minWidth ?? 80 }
  );
  const cellAlign = (c: DataTableColumn<T>): 'left' | 'right' | 'center' => c.align ?? (c.numeric ? 'right' : 'left');

  const renderCell = (c: DataTableColumn<T>, row: T) => {
    if (c.render) return c.render(row);
    const v = c.value ? c.value(row) : (row as Record<string, unknown>)[c.key];
    return (
      <Text
        numberOfLines={1}
        style={[styles.cellText, c.numeric && styles.numeric, { textAlign: cellAlign(c) }]}
      >
        {formatCellValue(v)}
      </Text>
    );
  };

  const hideable = columns.slice(1);
  const hasToolbar = !!searchText || !!filterChips || hideable.length > 0;

  return (
    <View style={[styles.wrap, style]} onLayout={onLayout} testID={testID}>
      {hasToolbar ? (
        <View style={styles.toolbar}>
          {searchText ? (
            <View style={styles.search}>
              <Search {...Tokens.iconSize.small} color={t.textMuted} />
              <TextInput
                ref={searchRef}
                value={query}
                onChangeText={setQuery}
                placeholder={searchPlaceholder}
                placeholderTextColor={t.textMuted}
                style={styles.searchInput}
                accessibilityLabel={searchPlaceholder}
                testID={testID ? `${testID}-search` : undefined}
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
                  <X {...Tokens.iconSize.small} color={t.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {filterChips ? <View style={styles.chips}>{filterChips}</View> : null}
          <View style={styles.spacer} />
          {hideable.length > 0 ? (
            <Pressable
              onPress={() => setShowColumnPicker((s) => !s)}
              style={[styles.toolButton, showColumnPicker && styles.toolButtonOn]}
              accessibilityRole="button"
              accessibilityLabel="Choose columns"
              accessibilityState={{ expanded: showColumnPicker }}
              testID={testID ? `${testID}-columns` : undefined}
            >
              <Columns3 {...Tokens.iconSize.small} color={t.textSecondary} />
              <Text style={styles.toolButtonText}>Columns</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showColumnPicker ? (
        <View style={styles.columnPicker}>
          {hideable.map((c) => {
            const on = !hidden.includes(c.key);
            const narrowHidden = on && !shownKeys.has(c.key);
            return (
              <Pressable
                key={c.key}
                onPress={() => toggleHidden(c.key)}
                style={[styles.columnChip, on && styles.columnChipOn]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                {on ? <Check {...Tokens.iconSize.micro} color={t.accentLabel} /> : null}
                <Text style={[styles.columnChipText, on && styles.columnChipTextOn]} numberOfLines={1}>
                  {c.label}{narrowHidden ? ' (needs a wider window)' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {selectable && selected.size > 0 ? (
        <View style={styles.bulkBar} testID={testID ? `${testID}-bulkbar` : undefined}>
          <Text style={styles.bulkCount}>{selected.size} selected</Text>
          {(bulkActions ?? []).map((a) => {
            const blocked = !!a.disabledReason;
            return (
              <Pressable
                key={a.key ?? a.label}
                onPress={() => {
                  if (blocked) showAlert(a.label, a.disabledReason ?? undefined);
                  else a.run(visibleKeys.filter((k) => selected.has(k)));
                }}
                style={[styles.bulkButton, blocked && styles.blocked]}
                accessibilityRole="button"
                accessibilityState={{ disabled: blocked }}
                accessibilityHint={a.disabledReason ?? undefined}
              >
                <Text style={[styles.bulkButtonText, a.destructive && !blocked && styles.destructiveText]}>{a.label}</Text>
              </Pressable>
            );
          })}
          <View style={styles.spacer} />
          <Pressable onPress={() => setSelected(new Set())} accessibilityRole="button" style={styles.bulkButton}>
            <Text style={styles.bulkButtonText}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Header */}
      <View style={[styles.headerRow, STICKY_HEADER]} accessibilityRole="header">
        {selectable ? (
          <Pressable
            onPress={onCheckAll}
            style={styles.checkCell}
            accessibilityRole="checkbox"
            accessibilityLabel="Select all rows"
            accessibilityState={{ checked: allState === 'all' ? true : allState === 'some' ? 'mixed' : false }}
            testID={testID ? `${testID}-check-all` : undefined}
          >
            <View style={[styles.box, allState !== 'none' && styles.boxOn]}>
              {allState === 'all' ? <Check size={12} strokeWidth={3} color={labelOn(t.accentFill)} /> : null}
              {allState === 'some' ? <Minus size={12} strokeWidth={3} color={labelOn(t.accentFill)} /> : null}
            </View>
          </Pressable>
        ) : null}
        {shownColumns.map((c) => {
          const sorted = sort?.key === c.key ? sort.dir : null;
          const label = (
            <Text numberOfLines={1} style={[styles.headerText, { textAlign: cellAlign(c) }]}>{c.label}</Text>
          );
          return c.sortValue ? (
            <Pressable
              key={c.key}
              onPress={() => onHeaderPress(c.key)}
              style={[styles.headerCell, cellBox(c), cellAlign(c) === 'right' && styles.headerCellRight]}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${c.label}${sorted ? (sorted === 'asc' ? ', ascending' : ', descending') : ''}`}
              testID={testID ? `${testID}-sort-${c.key}` : undefined}
            >
              {label}
              {sorted === 'asc' ? <ArrowUp {...Tokens.iconSize.micro} color={t.text} /> : null}
              {sorted === 'desc' ? <ArrowDown {...Tokens.iconSize.micro} color={t.text} /> : null}
            </Pressable>
          ) : (
            <View key={c.key} style={[styles.headerCell, cellBox(c), cellAlign(c) === 'right' && styles.headerCellRight]}>{label}</View>
          );
        })}
      </View>

      {/* Body */}
      {visibleRows.length === 0 ? (
        <View style={styles.empty} testID={testID ? `${testID}-empty` : undefined}>
          {rows.length > 0 && query ? (
            <>
              <Text style={styles.emptyText}>No rows match “{query}”.</Text>
              <Pressable onPress={() => setQuery('')} accessibilityRole="button" style={styles.bulkButton}>
                <Text style={styles.bulkButtonText}>Clear search</Text>
              </Pressable>
            </>
          ) : (
            emptyState ?? <Text style={styles.emptyText}>Nothing here yet.</Text>
          )}
        </View>
      ) : (
        visibleRows.map((row, i) => {
          const key = visibleKeys[i];
          return (
            <DataRow
              key={key}
              enter={enterStyles?.get(key)}
              rowRef={(n) => { rowRefs.current.set(i, n); }}
              height={rowHeight}
              focused={i === cursor}
              active={activeKey === key}
              selected={selected.has(key)}
              selectable={selectable}
              onCheck={(shift) => onCheck(key, shift)}
              href={getRowHref ? getRowHref(row) : undefined}
              onOpen={() => { setCursor(i); openRow(row); }}
              onPlainLinkClick={onRowOpen ? () => { setCursor(i); onRowOpen(row); } : undefined}
              styles={styles}
              testID={testID ? `${testID}-row-${key}` : undefined}
              checkColor={labelOn(t.accentFill)}
            >
              {shownColumns.map((c) => (
                <View key={c.key} style={[styles.cell, cellBox(c), cellAlign(c) === 'right' && styles.cellRight, cellAlign(c) === 'center' && styles.cellCenter]}>
                  {renderCell(c, row)}
                </View>
              ))}
            </DataRow>
          );
        })
      )}

      {footerTotals && visibleRows.length > 0 ? (
        <View style={styles.footerRow}>
          {selectable ? <View style={styles.checkCell} /> : null}
          {shownColumns.map((c) => {
            const has = Object.prototype.hasOwnProperty.call(footerTotals, c.key);
            const v = has ? footerTotals[c.key] : null;
            return (
              <View key={c.key} style={[styles.cell, cellBox(c), cellAlign(c) === 'right' && styles.cellRight]}>
                {has ? (
                  v === null || v === undefined ? (
                    <Text style={[styles.footerText, styles.numeric]}>{UNKNOWN_CELL}</Text>
                  ) : typeof v === 'string' || typeof v === 'number' ? (
                    <Text numberOfLines={1} style={[styles.footerText, c.numeric && styles.numeric, { textAlign: cellAlign(c) }]}>{String(v)}</Text>
                  ) : v
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

interface DataRowProps {
  children: React.ReactNode;
  rowRef: (n: View | null) => void;
  height: number;
  focused: boolean;
  active: boolean;
  selected: boolean;
  selectable: boolean;
  onCheck: (shift: boolean) => void;
  href?: Href;
  onOpen: () => void;
  onPlainLinkClick?: () => void;
  styles: Styles;
  testID?: string;
  checkColor: string;
  /** The appear fade (web, a row that just appeared); appended only when set. */
  enter?: StyleProp<ViewStyle>;
}

/** One row. Its own hover state, so moving the mouse re-renders one row, not
 *  the table. The checkbox sits OUTSIDE the link, so ticking a row never
 *  navigates. */
function DataRow({
  children, rowRef, height, focused, active, selected, selectable, onCheck, href, onOpen, onPlainLinkClick, styles, testID, checkColor, enter,
}: DataRowProps) {
  const [hovered, setHovered] = useState(false);
  // A real <a> only on web, where a link means Cmd-click / middle-click / copy
  // link address. On native (a ≥ 1024 tablet) there is no new tab; the row is
  // a plain button, which also keeps Link's native press path from racing an
  // in-place open.
  const linkHref = Platform.OS === 'web' ? href : undefined;
  const main = (
    <Pressable
      onPress={linkHref ? undefined : onOpen}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.rowMain, { minHeight: height }]}
      accessibilityRole={linkHref ? 'link' : 'button'}
      testID={testID}
    >
      {children}
    </Pressable>
  );
  return (
    <View
      ref={rowRef}
      style={[
        styles.row,
        hovered && styles.rowHover,
        selected && styles.rowSelected,
        active && styles.rowActive,
        focused && styles.rowFocused,
        // The row has no role, so the global hover CSS never reaches it: its
        // hover/selection fill glides here (120 ms; null under Reduce Motion).
        Platform.OS === 'web' && webMotion('bgGlide'),
        ...(enter ? [enter] : []),
      ]}
    >
      {selectable ? (
        <Pressable
          onPress={(e) => onCheck(eventShift(e))}
          style={styles.checkCell}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel="Select row"
          testID={testID ? `${testID}-check` : undefined}
        >
          <View style={[styles.box, selected && styles.boxOn]}>
            {selected ? <Check size={12} strokeWidth={3} color={checkColor} /> : null}
          </View>
        </Pressable>
      ) : null}
      {linkHref ? (
        // WEB ONLY. expo-router's Link spreads OUR `onPress` over its own
        // navigation handler (and react-native-web drops the onClick copy),
        // so passing any onPress — even `undefined` as a key — silences the
        // router and the browser follows the <a href> with a full page
        // reload. Hence: no onPress at all unless the screen opens rows in
        // place, and then we own the plain click entirely (preventDefault +
        // open); a Cmd/Ctrl/middle click still falls through to the browser.
        <Link
          href={linkHref}
          asChild
          {...(onPlainLinkClick
            ? {
                onPress: (e: { preventDefault?: () => void }) => {
                  if (!isPlainClick(e)) return;
                  e.preventDefault?.();
                  onPlainLinkClick();
                },
              }
            : {})}
        >
          {main}
        </Link>
      ) : main}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: {
    ...cardSurface(t, { radius: 'card', pad: 'none' }),
    // Clip the rows to the card's rounded corners — except on web, where
    // overflow would break the sticky header.
    overflow: Platform.OS === 'web' ? 'visible' : 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Layout.rowGap,
    paddingHorizontal: Layout.cardPad,
    paddingVertical: Layout.rowGap,
    minHeight: Layout.control.toolbar,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: Layout.field.search,
    minWidth: 200,
    height: Layout.control.sm,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: t.line,
    backgroundColor: t.bg,
  },
  searchInput: { flex: 1, ...Type.bodyCompact, color: t.text, paddingVertical: 0 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  spacer: { flex: 1 },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: Layout.control.sm,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: t.line,
  },
  toolButtonOn: { backgroundColor: t.neutralSoft },
  toolButtonText: { ...Type.footnoteEmphasized, color: t.textSecondary },
  columnPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: Layout.cardPad,
    paddingVertical: Layout.rowGap,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  columnChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    maxWidth: Layout.chip.maxWidth,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: t.line,
  },
  columnChipOn: { backgroundColor: t.accentSoft, borderColor: t.accentSoft },
  columnChipText: { ...Type.caption1, color: t.textSecondary },
  columnChipTextOn: { color: t.accentLabel },
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Layout.rowGap,
    paddingHorizontal: Layout.cardPad,
    minHeight: Layout.control.md,
    backgroundColor: t.accentSoft,
  },
  bulkCount: { ...Type.footnoteEmphasized, color: t.accentLabel, marginRight: 4 },
  bulkButton: {
    ...cardSurface(t, { radius: 'sm', pad: 'none' }),
    height: 28,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignSelf: 'center',
  },
  bulkButtonText: { ...Type.footnoteEmphasized, color: t.text },
  destructiveText: { color: t.dangerLabel },
  blocked: { opacity: 0.55 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: Layout.control.tableHeader,
    backgroundColor: t.surfaceAlt,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  headerCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: '100%',
    paddingHorizontal: 10,
  },
  headerCellRight: { justifyContent: 'flex-end' },
  headerText: { ...Type.caption1, fontWeight: '600', color: t.textSecondary, flexShrink: 1 },
  checkCell: { width: CHECK_COL, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  box: {
    width: 16,
    height: 16,
    borderRadius: Tokens.radius.xs,
    borderWidth: 1.5,
    borderColor: t.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: t.accentFill, borderColor: t.accentFill },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  rowHover: { backgroundColor: t.neutralSoft },
  rowSelected: { backgroundColor: t.accentSoft },
  rowActive: { backgroundColor: t.accentSoft, borderLeftWidth: 3, borderLeftColor: t.accentFill },
  rowFocused: { borderLeftWidth: 3, borderLeftColor: t.accent },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  cell: { paddingHorizontal: 10, justifyContent: 'center' },
  cellRight: { alignItems: 'flex-end' },
  cellCenter: { alignItems: 'center' },
  cellText: { ...Type.bodyCompact, color: t.text },
  numeric: { fontVariant: ['tabular-nums'] },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Layout.control.row,
    backgroundColor: t.surfaceAlt,
  },
  footerText: { ...Type.bodyCompactEmphasized, color: t.text },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 32, paddingHorizontal: Layout.cardPad },
  emptyText: { ...Type.bodyCompact, color: t.textSecondary, textAlign: 'center' },
});
