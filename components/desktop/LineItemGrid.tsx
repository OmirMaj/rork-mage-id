// components/desktop/LineItemGrid.tsx — dense, editable line items.
//
// WHY THIS EXISTS. Change-order lines, invoice lines, the AIA G703 schedule of
// values, buyout and estimate review are all a spreadsheet in the GC's head —
// Description | Qty | Unit | Unit $ | Total — but on the web app each line is
// the phone's stacked card with a full-width input per value (the audit
// measured quantity boxes 1000+ px wide). This is the grid:
//
//   • Tab / Shift-Tab move cell to cell across the row and on to the next
//     (past either end the browser's own Tab leaves the grid);
//   • Enter adds a line under the current one and puts the cursor in it;
//   • Cmd/Ctrl+Backspace deletes the current line;
//   • pasting a block copied from Excel/Sheets hands the rows to the screen
//     (utils/dataTable parsePastedGrid — the same split and row cap as the
//     scheduler's paste-rows parser); a single value pastes normally;
//   • a totals footer sums the columns marked `total`, and says how many
//     lines it could not count instead of treating text as $0;
//   • `rowWarning` tints a line and says why (e.g. billed past the line's
//     scheduled value — lineOverBill).
//
// Desktop widths (visual spec): Qty 88, Unit 72, Unit price 128, Total 128
// (right-aligned), Description flex up to 480 — the screen passes them.
//
// PHONE IDENTICAL: below the desktop gate the grid renders `renderCard` for
// each line, in a fragment — today's line cards, untouched.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from 'react-native';
import { AlertTriangle, Plus, X } from 'lucide-react-native';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { cardSurface } from '@/components/ui/Card';
import { showAlert } from '@/utils/alert';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { UNKNOWN_CELL, nextGridCell, parseGridNumber, parsePastedGrid, sumColumn } from '@/utils/dataTable';

export interface LineItemColumn<R> {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'money';
  width?: number;
  flex?: number;
  maxWidth?: number;
  align?: 'left' | 'right';
  /** The cell's text. Default: String(row[key] ?? ''). */
  getValue?: (row: R) => string;
  /** Read-only computed cell (Total = Qty × Unit $). null → '—'. */
  compute?: (row: R) => number | null;
  /** Display of a number (computed cells and totals). Default: 2 decimals for money. */
  format?: (n: number) => string;
  /** Sum this column in the footer. */
  total?: boolean;
  placeholder?: string;
  /** Default true unless `compute` is set. */
  editable?: boolean;
}

export interface LineItemGridProps<R> {
  rows: readonly R[];
  rowKey: (row: R) => string;
  columns: readonly LineItemColumn<R>[];
  onChangeCell: (rowKey: string, colKey: string, text: string) => void;
  /** Insert a line after `afterRowKey` (null = at the end). */
  onAddRow: (afterRowKey: string | null) => void;
  onDeleteRow: (rowKey: string) => void;
  /** A block pasted from a spreadsheet, starting at the focused cell. */
  onPasteRows?: (cells: string[][], at: { rowKey: string; colKey: string }) => void;
  /** Non-null → the line is tinted and the reason shown. */
  rowWarning?: (row: R) => string | null;
  /** REQUIRED: today's phone line card. */
  renderCard: (row: R, index: number) => React.ReactNode;
  addLabel?: string;
  /** Delete is refused with this reason (e.g. a billed line). */
  deleteBlockedReason?: (row: R) => string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  // ── Wave 6d (lane M1) — additive, every default is the behaviour above. ──
  /** Every cell shows its display text: no input, no delete column, no add
   *  row, no paste listener (a certified pay application in review). */
  readOnly?: boolean;
  /** Default true. False: the line set is fixed — no delete column, no add
   *  row, Cmd+Backspace does nothing, and Enter moves to the same column on
   *  the next line instead of adding one (a no-op on the last line). */
  rowsEditable?: boolean;
  /** Per-cell editability on top of the column's own. False renders the
   *  display text, and Tab / Shift-Tab skip the cell. */
  isCellEditable?: (row: R, colKey: string) => boolean;
  /** A cell lost focus (the screen commits a draft there). */
  onCellBlur?: (rowKey: string, colKey: string) => void;
  /** For each key present, REPLACES the column's footer sum with the screen's
   *  own engine total (null → '—', and no "not counted" note). */
  footerTotals?: Readonly<Record<string, number | null>>;
  /** The footer's first-column label. Default 'Total'. */
  footerLabel?: string;
}

const DELETE_COL = 36;

function defaultFormat(kind: LineItemColumn<unknown>['kind'], n: number): string {
  if (kind === 'money') {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function LineItemGrid<R>(props: LineItemGridProps<R>) {
  const { isDesktop } = useResponsiveLayout();
  if (!isDesktop) {
    return (
      <>
        {props.rows.map((row, i) => (
          <React.Fragment key={props.rowKey(row)}>{props.renderCard(row, i)}</React.Fragment>
        ))}
      </>
    );
  }
  return <DesktopLineItemGrid {...props} />;
}

function DesktopLineItemGrid<R>({
  rows, rowKey, columns, onChangeCell, onAddRow, onDeleteRow, onPasteRows, rowWarning, addLabel = 'Add line',
  deleteBlockedReason, style, testID,
  readOnly = false, rowsEditable = true, isCellEditable, onCellBlur, footerTotals, footerLabel,
}: LineItemGridProps<R>) {
  // The line set can change (delete column, add row, Cmd+Backspace, Enter adds).
  const linesMutable = !readOnly && rowsEditable;
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const cellRefs = useRef(new Map<string, TextInput | null>());
  const pendingFocus = useRef<{ row: number; col: number } | null>(null);
  const [focused, setFocused] = useState<{ row: number; col: number } | null>(null);

  const editableCols = useMemo(
    () => columns.map((c, i) => ((c.editable ?? !c.compute) ? i : -1)).filter((i) => i >= 0),
    [columns],
  );
  const refKey = (r: number, c: number) => `${r}:${c}`;
  const focusCell = useCallback((r: number, c: number) => {
    cellRefs.current.get(refKey(r, c))?.focus();
  }, []);
  /** Is this cell an input right now (column editable, grid not read-only,
   *  and the screen's per-cell rule agrees)? */
  const cellIsInput = (c: LineItemColumn<R>, row: R): boolean => (
    (c.editable ?? !c.compute) && !readOnly && (isCellEditable ? isCellEditable(row, c.key) : true)
  );

  // A new line (Enter) or a deleted one moves the cursor once the rows render.
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    if (p.row >= 0 && p.row < rows.length) {
      pendingFocus.current = null;
      focusCell(p.row, p.col);
    }
  }, [rows.length, focusCell]);

  // Spreadsheet paste. RN-web's TextInput drops onPaste (the scheduler hit the
  // same wall — components/schedule/GridPane listens on window too), so listen
  // while a cell has focus and take only multi-cell blocks.
  useEffect(() => {
    if (Platform.OS !== 'web' || !onPasteRows || !focused || readOnly) return undefined;
    const g = globalThis as unknown as { window?: { addEventListener?: (t: string, f: (e: unknown) => void) => void; removeEventListener?: (t: string, f: (e: unknown) => void) => void } };
    const w = g.window;
    if (!w?.addEventListener || !w.removeEventListener) return undefined;
    const handler = (e: unknown) => {
      const ev = e as { clipboardData?: { getData(type: string): string } | null; preventDefault(): void };
      const cells = parsePastedGrid(ev.clipboardData?.getData('text/plain') ?? '');
      if (cells.length === 0) return;
      const row = rows[focused.row];
      const col = columns[focused.col];
      if (!row || !col) return;
      ev.preventDefault();
      onPasteRows(cells, { rowKey: rowKey(row), colKey: col.key });
    };
    w.addEventListener('paste', handler);
    return () => w.removeEventListener?.('paste', handler);
  }, [onPasteRows, focused, rows, columns, rowKey, readOnly]);

  const deleteRow = useCallback((r: number, colIndex: number) => {
    const row = rows[r];
    if (!row) return;
    const blocked = deleteBlockedReason?.(row);
    if (blocked) {
      showAlert("Can't delete this line", blocked);
      return;
    }
    pendingFocus.current = { row: Math.max(0, r - 1), col: colIndex };
    onDeleteRow(rowKey(row));
  }, [rows, rowKey, onDeleteRow, deleteBlockedReason]);

  const onKeyPress = (r: number, c: number) => (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const ne = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };
    if (ne.key === 'Tab') {
      // Skip cells that are display text (isCellEditable false): walk on until
      // a registered input exists, bounded by rows × cols.
      let next = nextGridCell(rows.length, editableCols, { row: r, col: c }, !!ne.shiftKey);
      for (let guard = rows.length * columns.length; next && guard > 0 && !cellRefs.current.get(refKey(next.row, next.col)); guard--) {
        next = nextGridCell(rows.length, editableCols, next, !!ne.shiftKey);
      }
      if (next && cellRefs.current.get(refKey(next.row, next.col))) {
        e.preventDefault();
        focusCell(next.row, next.col);
      }
      return;
    }
    if (ne.key === 'Backspace' && (ne.metaKey || ne.ctrlKey)) {
      if (!linesMutable) return;
      e.preventDefault();
      deleteRow(r, c);
    }
  };

  /** Enter: add a line under this one — or, when the line set is fixed,
   *  move to the same column on the next line (nothing on the last line). */
  const onEnter = (r: number, c: number) => {
    if (linesMutable) { addAfter(r); return; }
    if (r + 1 < rows.length) focusCell(r + 1, c);
  };
  const addAfter = (r: number | null) => {
    const firstEditable = editableCols[0] ?? 0;
    pendingFocus.current = { row: r === null ? rows.length : r + 1, col: firstEditable };
    onAddRow(r === null ? null : rowKey(rows[r]));
  };

  const cellBox = (c: LineItemColumn<R>): ViewStyle => (
    typeof c.width === 'number'
      ? { width: c.width, flexGrow: 0, flexShrink: 0 }
      : { flex: c.flex ?? 1, minWidth: 120, maxWidth: c.maxWidth ?? Layout.field.search }
  );
  const alignOf = (c: LineItemColumn<R>) => c.align ?? (c.kind === 'number' || c.kind === 'money' ? 'right' : 'left');
  const fmt = (c: LineItemColumn<R>, n: number) => (c.format ? c.format(n) : defaultFormat(c.kind, n));
  const cellValue = (c: LineItemColumn<R>, row: R): string => {
    if (c.getValue) return c.getValue(row);
    const v = (row as Record<string, unknown>)[c.key];
    return v === null || v === undefined ? '' : String(v);
  };
  /** An editable column shown as text (readOnly / isCellEditable false):
   *  numbers through the column's format, text as typed, blank as '—'. */
  const displayText = (c: LineItemColumn<R>, row: R): string => {
    const raw = cellValue(c, row);
    if (c.kind === 'number' || c.kind === 'money') {
      const n = parseGridNumber(raw);
      return n === null ? (raw.trim() ? raw : UNKNOWN_CELL) : fmt(c, n);
    }
    return raw.trim() ? raw : UNKNOWN_CELL;
  };

  const totals = useMemo(() => {
    const out: Record<string, ReturnType<typeof sumColumn>> = {};
    for (const c of columns) {
      if (!c.total) continue;
      if (footerTotals && Object.prototype.hasOwnProperty.call(footerTotals, c.key)) {
        // The screen's engine total, not a re-sum of the cells.
        out[c.key] = { total: footerTotals[c.key] ?? null, unparsed: 0 };
        continue;
      }
      out[c.key] = sumColumn(rows.map((row) => (c.compute ? c.compute(row) : cellValue(c, row))));
    }
    return out;
    // cellValue is derived from columns
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rows, footerTotals]);
  const anyTotals = columns.some((c) => c.total);
  // Only a screen-named footer label spans (the default keeps today's cells).
  const firstTotal = columns.findIndex((c) => !!totals[c.key]);
  const labelSpan = footerLabel !== undefined && firstTotal > 1 ? firstTotal : 0;
  /** One cell as wide as `cols` side by side (fixed widths add; flex columns
   *  keep their flex and their min / max). */
  const spanBox = (cols: readonly LineItemColumn<R>[]): ViewStyle => {
    let fixed = 0;
    let flex = 0;
    let min = 0;
    let max = 0;
    for (const c of cols) {
      if (typeof c.width === 'number') { fixed += c.width; continue; }
      flex += c.flex ?? 1;
      min += 120;
      max += c.maxWidth ?? Layout.field.search;
    }
    return flex === 0
      ? { width: fixed, flexGrow: 0, flexShrink: 0 }
      : { flex, minWidth: fixed + min, maxWidth: fixed + max };
  };

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={styles.headerRow}>
        {columns.map((c) => (
          <View key={c.key} style={[styles.headerCell, cellBox(c)]}>
            <Text style={[styles.headerText, { textAlign: alignOf(c) }]} numberOfLines={1}>{c.label}</Text>
          </View>
        ))}
        {linesMutable ? <View style={{ width: DELETE_COL }} /> : null}
      </View>

      {rows.map((row, r) => {
        const key = rowKey(row);
        const warning = rowWarning?.(row) ?? null;
        return (
          <View key={key} style={[styles.row, warning ? styles.rowWarn : null]} testID={testID ? `${testID}-row-${key}` : undefined}>
            <View style={styles.cells}>
              {columns.map((c, ci) => {
                const editable = c.editable ?? !c.compute;
                if (editable && !cellIsInput(c, row)) {
                  return (
                    <View key={c.key} style={[styles.cell, cellBox(c)]} testID={testID ? `${testID}-text-${key}-${c.key}` : undefined}>
                      <Text style={[styles.computed, { textAlign: alignOf(c) }]} numberOfLines={1}>
                        {displayText(c, row)}
                      </Text>
                    </View>
                  );
                }
                if (!editable) {
                  const n = c.compute ? c.compute(row) : parseGridNumber(cellValue(c, row));
                  return (
                    <View key={c.key} style={[styles.cell, cellBox(c)]}>
                      <Text style={[styles.computed, { textAlign: alignOf(c) }]} numberOfLines={1}>
                        {n === null || n === undefined ? UNKNOWN_CELL : fmt(c, n)}
                      </Text>
                    </View>
                  );
                }
                return (
                  <View key={c.key} style={[styles.cell, cellBox(c)]}>
                    <TextInput
                      ref={(n) => { cellRefs.current.set(refKey(r, ci), n); }}
                      value={cellValue(c, row)}
                      onChangeText={(text) => onChangeCell(key, c.key, text)}
                      onKeyPress={onKeyPress(r, ci)}
                      onSubmitEditing={() => onEnter(r, ci)}
                      onFocus={() => setFocused({ row: r, col: ci })}
                      onBlur={() => {
                        setFocused((f) => (f && f.row === r && f.col === ci ? null : f));
                        onCellBlur?.(key, c.key);
                      }}
                      blurOnSubmit={false}
                      placeholder={c.placeholder}
                      placeholderTextColor={t.textMuted}
                      keyboardType={c.kind === 'number' || c.kind === 'money' ? 'decimal-pad' : 'default'}
                      style={[styles.input, { textAlign: alignOf(c) }, (c.kind === 'number' || c.kind === 'money') && styles.numeric]}
                      accessibilityLabel={`${c.label}, line ${r + 1}`}
                      testID={testID ? `${testID}-cell-${key}-${c.key}` : undefined}
                    />
                  </View>
                );
              })}
              {linesMutable ? (
                <Pressable
                  onPress={() => deleteRow(r, editableCols[0] ?? 0)}
                  style={styles.deleteCell}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete line ${r + 1}`}
                  testID={testID ? `${testID}-delete-${key}` : undefined}
                >
                  <X {...Tokens.iconSize.small} color={t.textMuted} />
                </Pressable>
              ) : null}
            </View>
            {warning ? (
              <View style={styles.warning}>
                <AlertTriangle {...Tokens.iconSize.micro} color={t.warningLabel} />
                <Text style={styles.warningText}>{warning}</Text>
              </View>
            ) : null}
          </View>
        );
      })}

      {linesMutable ? (
        <Pressable
          onPress={() => addAfter(rows.length > 0 ? rows.length - 1 : null)}
          style={styles.addRow}
          accessibilityRole="button"
          testID={testID ? `${testID}-add` : undefined}
        >
          <Plus {...Tokens.iconSize.small} color={t.accentLabel} />
          <Text style={styles.addText}>{addLabel}</Text>
        </Pressable>
      ) : null}

      {anyTotals && rows.length > 0 ? (
        <View style={styles.footerRow} testID={testID ? `${testID}-totals` : undefined}>
          {labelSpan > 1 ? (
            // A named footer ('Grand total') spans the leading columns that
            // carry no total, so a 48 px item-number column never wraps it.
            <View style={[styles.cell, spanBox(columns.slice(0, labelSpan))]}>
              <Text style={styles.totalLabel} numberOfLines={1}>{footerLabel}</Text>
            </View>
          ) : null}
          {columns.map((c, ci) => {
            if (ci < labelSpan && labelSpan > 1) return null;
            const tot = totals[c.key];
            return (
              <View key={c.key} style={[styles.cell, cellBox(c)]}>
                {tot ? (
                  <>
                    <Text style={[styles.totalText, { textAlign: alignOf(c) }]} numberOfLines={1}>
                      {tot.total === null ? UNKNOWN_CELL : fmt(c, tot.total)}
                    </Text>
                    {tot.unparsed > 0 ? (
                      <Text style={[styles.totalNote, { textAlign: alignOf(c) }]} numberOfLines={1}>
                        {tot.unparsed} {tot.unparsed === 1 ? 'line' : 'lines'} not counted
                      </Text>
                    ) : null}
                  </>
                ) : ci === 0 ? (
                  <Text style={styles.totalLabel}>{footerLabel ?? 'Total'}</Text>
                ) : null}
              </View>
            );
          })}
          {linesMutable ? <View style={{ width: DELETE_COL }} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { ...cardSurface(t, { radius: 'card', pad: 'none' }), overflow: 'hidden' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: Layout.control.tableHeader,
    backgroundColor: t.surfaceAlt,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  headerCell: { paddingHorizontal: 8, justifyContent: 'center' },
  headerText: { ...Type.caption1, fontWeight: '600', color: t.textSecondary },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line },
  rowWarn: { backgroundColor: t.warningSoft },
  cells: { flexDirection: 'row', alignItems: 'center', minHeight: Layout.control.row },
  cell: { paddingHorizontal: 4, justifyContent: 'center' },
  input: {
    ...Type.bodyCompact,
    color: t.text,
    height: 32,
    paddingHorizontal: 6,
    borderRadius: Tokens.radius.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  numeric: { fontVariant: ['tabular-nums'] },
  computed: { ...Type.bodyCompact, color: t.text, paddingHorizontal: 6, fontVariant: ['tabular-nums'] },
  deleteCell: { width: DELETE_COL, height: Layout.control.row, alignItems: 'center', justifyContent: 'center' },
  warning: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6 },
  warningText: { ...Type.caption1, color: t.warningLabel, flexShrink: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: Layout.control.md, paddingHorizontal: 10 },
  addText: { ...Type.footnoteEmphasized, color: t.accentLabel },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Layout.control.row,
    backgroundColor: t.surfaceAlt,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.line,
  },
  totalText: { ...Type.bodyCompactEmphasized, color: t.text, paddingHorizontal: 6, fontVariant: ['tabular-nums'] },
  totalNote: { ...Type.caption1, color: t.warningLabel, paddingHorizontal: 6 },
  totalLabel: { ...Type.bodyCompactEmphasized, color: t.text, paddingHorizontal: 6 },
});
