// GridPane — the spreadsheet-style editable task list.
//
// Why a dedicated grid instead of extending the existing task cards
// -----------------------------------------------------------------
// The current schedule screen forces every edit through a modal. That's the
// #1 complaint and the main reason the tool "feels stiff". MS Project and
// Smartsheet solved this 20 years ago: a dense, editable table where you
// tab through cells. This component rebuilds that pattern in React Native
// so it works in a web browser, on iPad touch, and on a laptop with a mouse.
//
// Design contract
// ---------------
// 1. Every write goes through `onEdit(taskId, patch)` — the parent owns state.
//    The grid itself never mutates tasks; it just proposes edits.
// 2. On every edit, the parent re-runs `runCpm(tasks)` and passes the result
//    back as `cpm`. We render Start/Finish/Float from that result, not from
//    raw task fields, so Start and Finish are ALWAYS in sync with the math.
// 3. Dependency edits are gated by `wouldCreateCycle()` — if the user tries
//    to enter a cycle, we surface an inline error and DO NOT commit. This is
//    the "forgiving UI" property from the playbook.
// 4. Actual-start / actual-finish columns exist but are rendered faded until
//    Phase 5 wires the field-reporting flow. We reserve the column space now
//    so the layout doesn't shift later.
//
// Platform notes
// --------------
// - Web: full keyboard nav (Enter=commit+down, Tab=right, Shift+Tab=left,
//   Esc=cancel). Uses native DOM onKeyDown via TextInput refs.
// - iPad/mobile: tap-to-edit, tap-outside-to-commit, hardware-keyboard
//   Enter also commits. No Tab navigation on touch — unnecessary friction.
// - We target screens ≥ 900px wide. The parent should only render GridPane
//   at that breakpoint; below that it stays with the existing card UI.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Alert, Modal,
} from 'react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, TaskStatus, AnchorType } from '@/types';
import {
  runCpm, formatFloat, wouldCreateCycle,
  type CpmResult, type CpmTaskResult,
} from '@/utils/cpm';
import { addWorkingDays, formatShortDate, getPhaseColor } from '@/utils/scheduleEngine';
import { getHiddenTaskIds } from '@/utils/summaryRollup';
import { AlertTriangle, Plus, Trash2, Check, Circle, Pause, Play, GripVertical, Copy, CalendarRange, Users, Layers, Sparkles, X, Anchor } from 'lucide-react-native';

// ---------------------------------------------------------------------------
// Column definition — single source of truth for widths, alignment, editability
// ---------------------------------------------------------------------------

type ColumnKey =
  | 'rowNum' | 'wbs' | 'name' | 'duration' | 'start' | 'finish' | 'float'
  | 'deadline' | 'predecessors' | 'crew' | 'status' | 'progress' | 'actions';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  /** 'text' = inline text input; 'number' = numeric; 'readonly' = display; 'custom' = special. */
  kind: 'text' | 'number' | 'readonly' | 'custom';
}

// Column keys that stay pinned to the left on horizontal scroll (web only).
// Module-level so memoization dependency arrays don't complain.
const FROZEN_KEYS: ColumnKey[] = ['rowNum', 'wbs', 'name'];

const COLUMNS: ColumnDef[] = [
  { key: 'rowNum',       label: '#',              width: 40,  align: 'center', kind: 'readonly' },
  { key: 'wbs',          label: 'WBS',            width: 70,  align: 'left',   kind: 'readonly' },
  { key: 'name',         label: 'Task Name',      width: 240, align: 'left',   kind: 'text' },
  { key: 'duration',     label: 'Dur.',           width: 62,  align: 'right',  kind: 'number' },
  { key: 'start',        label: 'Start',          width: 88,  align: 'left',   kind: 'readonly' },
  { key: 'finish',       label: 'Finish',         width: 88,  align: 'left',   kind: 'readonly' },
  { key: 'float',        label: 'Float',          width: 96,  align: 'left',   kind: 'readonly' },
  { key: 'deadline',     label: 'Due by',         width: 110, align: 'left',   kind: 'custom' },
  { key: 'predecessors', label: 'Predecessors',   width: 140, align: 'left',   kind: 'text' },
  { key: 'crew',         label: 'Crew',           width: 140, align: 'left',   kind: 'text' },
  { key: 'status',       label: 'Status',         width: 110, align: 'center', kind: 'custom' },
  { key: 'progress',     label: '% Done',         width: 72,  align: 'right',  kind: 'number' },
  { key: 'actions',      label: '',               width: 44,  align: 'center', kind: 'custom' },
];

const ROW_HEIGHT = 40;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GridPaneProps {
  /** The schedule tasks. Parent owns the source of truth. */
  tasks: ScheduleTask[];
  /** Project calendar anchor for rendering Start/Finish as real dates. */
  projectStartDate: Date;
  /** 5 = workdays only, 7 = calendar days. */
  workingDaysPerWeek: number;
  /**
   * Split-view mode. The gantt on the right already shows Start / Finish /
   * Float visually, so repeating them as text columns makes the layout feel
   * cramped and forces users to hunt for the same data twice. When
   * `compact`, those three columns are hidden and the grid becomes a pure
   * edit-the-fields view (name, duration, predecessors, crew, status,
   * progress). The timeline remains the single source of schedule truth.
   */
  compact?: boolean;
  /**
   * Commit edits back. The parent should:
   *   1. Apply the patch
   *   2. Re-run runCpm(newTasks)
   *   3. Pass the new tasks + cpm back into this component
   * All in one render cycle so the grid never shows stale derived values.
   */
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  /** Creates a new empty task at the bottom. */
  onAddTask: () => void;
  /** Deletes a task (also removes any dep references to it — parent's job). */
  onDeleteTask: (taskId: string) => void;
  /** Optional: highlight a specific task (e.g. the one dragged on the Gantt). */
  focusedTaskId?: string | null;
  // ---- Multi-select + bulk edit (optional — grid still works without these) ----
  /** Currently selected task ids. Controlled from the parent so the AI drawer
   *  can read the same selection. */
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Bulk ops — each should be ONE commit in the parent so undo restores the whole batch. */
  onBulkDelete?: (ids: string[]) => void;
  onBulkDuplicate?: (ids: string[]) => void;
  onBulkShiftDays?: (ids: string[], days: number) => void;
  onBulkSetPhase?: (ids: string[], phase: string) => void;
  onBulkSetCrew?: (ids: string[], crew: string) => void;
  /** Open the AI drawer pre-scoped to selection. */
  onBulkAskAI?: (ids: string[]) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GridPane({
  tasks, projectStartDate, workingDaysPerWeek,
  onEdit, onAddTask, onDeleteTask, focusedTaskId,
  selectedIds, onSelectionChange,
  onBulkDelete, onBulkDuplicate, onBulkShiftDays,
  onBulkSetPhase, onBulkSetCrew, onBulkAskAI,
  compact = false,
}: GridPaneProps) {
  // Column list — filtered for split view so the grid doesn't duplicate the
  // date axis rendered by the gantt. Order preserved.
  const visibleColumns = useMemo(
    () => (compact ? COLUMNS.filter(c => c.key !== 'start' && c.key !== 'finish' && c.key !== 'float') : COLUMNS),
    [compact],
  );
  // Freeze the first few columns (select, wbs, name) so long horizontal
  // scrolling doesn't push the task name off-screen. On web we use the
  // native `position: sticky` trick with a per-cell `left` offset; on
  // native we fall back to normal flow (sticky isn't supported).
  const frozenLeftOffset = useMemo(() => {
    const map = new Map<ColumnKey, number>();
    let x = 0;
    for (const c of visibleColumns) {
      if (FROZEN_KEYS.includes(c.key)) {
        map.set(c.key, x);
        x += c.width;
      }
    }
    return map;
  }, [visibleColumns]);
  const visibleTotalWidth = useMemo(
    () => visibleColumns.reduce((s, c) => s + c.width, 0),
    [visibleColumns],
  );
  // Re-run CPM on every render. It's fast (< 1ms for a few hundred tasks) and
  // keeps the grid's derived columns honest. If profiling ever shows this as
  // a bottleneck, memoize on a tasks signature.
  const cpm: CpmResult = useMemo(() => runCpm(tasks), [tasks]);

  // Which cell is currently being edited. `null` means read-only mode.
  const [editing, setEditing] = useState<{ row: number; col: ColumnKey } | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [cellError, setCellError] = useState<string | null>(null);
  // Anchor-picker popover. Shows the MAGE "Anchor" modal for a single task.
  // Opens from the ⚓ glyph on the Start cell. We keep this as in-grid state
  // (rather than lifting to schedule-pro) because the trigger is per-row and
  // the modal is small; lifting would mean threading another callback.
  const [anchorFor, setAnchorFor] = useState<ScheduleTask | null>(null);

  // ---------------------------------------------------------------------------
  // Multi-select state helpers
  // ---------------------------------------------------------------------------
  // Selection is parent-controlled when `selectedIds` is provided (the AI
  // drawer needs to see it). We keep a local fallback for consumers who don't
  // care about selection, so the component still works standalone.
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const selected = selectedIds ?? localSelected;
  const setSelection = useCallback((next: Set<string>) => {
    if (onSelectionChange) onSelectionChange(next);
    else setLocalSelected(next);
  }, [onSelectionChange]);

  // Anchor for shift-click range selection. Cleared when selection is cleared.
  const anchorRef = useRef<number | null>(null);

  const toggleRow = useCallback((rowIndex: number, modKey: boolean, shiftKey: boolean) => {
    const task = tasks[rowIndex];
    if (!task) return;

    if (shiftKey && anchorRef.current != null) {
      const from = Math.min(anchorRef.current, rowIndex);
      const to = Math.max(anchorRef.current, rowIndex);
      const next = new Set(selected);
      for (let i = from; i <= to; i++) {
        const t = tasks[i];
        if (t) next.add(t.id);
      }
      setSelection(next);
      return;
    }

    const next = new Set(selected);
    if (modKey || next.has(task.id)) {
      // cmd/ctrl-click or clicking an already-selected row → toggle
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
    } else {
      // plain click on the # cell → replace selection with this one row
      next.clear();
      next.add(task.id);
    }
    anchorRef.current = rowIndex;
    setSelection(next);
  }, [tasks, selected, setSelection]);

  const clearSelection = useCallback(() => {
    anchorRef.current = null;
    setSelection(new Set());
  }, [setSelection]);

  const selectAll = useCallback(() => {
    setSelection(new Set(tasks.map(t => t.id)));
  }, [tasks, setSelection]);

  const selectedArray = useMemo(() => Array.from(selected), [selected]);

  // Map of task.id → wbsCode, used to let users type "1.2" as a predecessor
  // instead of the machine id. Falls back to the id if no WBS.
  const wbsToIdMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      if (t.wbsCode) m.set(t.wbsCode.trim(), t.id);
      m.set(t.id, t.id);
    }
    return m;
  }, [tasks]);

  const idToWbsMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) m.set(t.id, t.wbsCode || t.id);
    return m;
  }, [tasks]);

  // -------------------------------------------------------------------------
  // Begin / commit / cancel edit helpers
  // -------------------------------------------------------------------------

  const beginEdit = useCallback((row: number, col: ColumnKey) => {
    const colDef = COLUMNS.find(c => c.key === col);
    if (!colDef || colDef.kind === 'readonly' || colDef.kind === 'custom') return;

    const task = tasks[row];
    if (!task) return;

    let seed = '';
    switch (col) {
      case 'name':     seed = task.title; break;
      case 'duration': seed = String(task.durationDays ?? 0); break;
      case 'progress': seed = String(task.progress ?? 0); break;
      case 'crew':     seed = task.crew ?? ''; break;
      case 'predecessors':
        seed = (task.dependencyLinks ?? task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 })))
          .map(l => {
            const wbs = idToWbsMap.get(l.taskId) ?? l.taskId;
            const type = l.type && l.type !== 'FS' ? l.type : '';
            const lag = l.lagDays ? (l.lagDays > 0 ? `+${l.lagDays}` : `${l.lagDays}`) : '';
            return `${wbs}${type}${lag}`;
          })
          .join(', ');
        break;
    }
    setDraft(seed);
    setCellError(null);
    setEditing({ row, col });
  }, [tasks, idToWbsMap]);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft('');
    setCellError(null);
  }, []);

  /**
   * Apply the current draft to the task. Returns true iff the edit was
   * committed; false if validation failed (and error surfaced inline).
   */
  const commitEdit = useCallback((): boolean => {
    if (!editing) return false;
    const task = tasks[editing.row];
    if (!task) { cancelEdit(); return false; }

    const patch: Partial<ScheduleTask> = {};

    switch (editing.col) {
      case 'name': {
        const v = draft.trim();
        if (!v) { setCellError('Name cannot be empty'); return false; }
        patch.title = v;
        break;
      }
      case 'duration': {
        const v = Number.parseFloat(draft);
        if (!Number.isFinite(v) || v < 0) { setCellError('Duration must be 0 or more'); return false; }
        patch.durationDays = Math.round(v);
        break;
      }
      case 'progress': {
        const v = Number.parseFloat(draft);
        if (!Number.isFinite(v) || v < 0 || v > 100) { setCellError('Progress must be 0–100'); return false; }
        patch.progress = Math.round(v);
        if (v >= 100 && task.status !== 'done') patch.status = 'done';
        else if (v > 0 && v < 100 && task.status === 'not_started') patch.status = 'in_progress';
        break;
      }
      case 'crew': {
        patch.crew = draft.trim();
        break;
      }
      case 'predecessors': {
        // Parse "1.2, 2.1SS+2, 3.4FF-1" → DependencyLink[]
        // Reject early if any token is malformed or would create a cycle.
        const raw = draft.trim();
        if (!raw) {
          patch.dependencies = [];
          patch.dependencyLinks = [];
          break;
        }
        const tokens = raw.split(/[,;\s]+/).filter(Boolean);
        const links: NonNullable<ScheduleTask['dependencyLinks']> = [];
        for (const tok of tokens) {
          const m = tok.match(/^([A-Za-z0-9._-]+?)(FS|SS|FF|SF)?([+\-]\d+)?$/i);
          if (!m) { setCellError(`"${tok}" is not a valid dependency`); return false; }
          const [, ref, typeRaw, lagRaw] = m;
          const depId = wbsToIdMap.get(ref.trim());
          if (!depId) { setCellError(`No task matches "${ref}"`); return false; }
          if (depId === task.id) { setCellError('A task cannot depend on itself'); return false; }
          // Cycle guard — the headline "forgiving UI" feature.
          if (wouldCreateCycle(tasks, task.id, depId)) {
            setCellError(`"${ref}" would create a dependency loop`);
            return false;
          }
          const type = (typeRaw?.toUpperCase() ?? 'FS') as 'FS' | 'SS' | 'FF' | 'SF';
          const lagDays = lagRaw ? Number.parseInt(lagRaw, 10) : 0;
          links.push({ taskId: depId, type, lagDays });
        }
        patch.dependencies = links.map(l => l.taskId);
        patch.dependencyLinks = links;
        break;
      }
    }

    onEdit(task.id, patch);
    setEditing(null);
    setDraft('');
    setCellError(null);
    return true;
  }, [editing, draft, tasks, wbsToIdMap, onEdit, cancelEdit]);

  // -------------------------------------------------------------------------
  // Keyboard navigation (web). iPad/mobile rely on tap-to-edit + blur.
  // -------------------------------------------------------------------------

  const moveEdit = useCallback((direction: 'next' | 'prev' | 'down' | 'up') => {
    if (!editing) return;
    const editableCols = COLUMNS.filter(c => c.kind === 'text' || c.kind === 'number').map(c => c.key);
    const colIdx = editableCols.indexOf(editing.col);
    const rowCount = tasks.length;

    let nextRow = editing.row;
    let nextCol = editing.col;

    if (direction === 'next' || direction === 'prev') {
      const delta = direction === 'next' ? 1 : -1;
      let newColIdx = colIdx + delta;
      if (newColIdx >= editableCols.length) { newColIdx = 0; nextRow = (editing.row + 1) % rowCount; }
      if (newColIdx < 0) { newColIdx = editableCols.length - 1; nextRow = (editing.row - 1 + rowCount) % rowCount; }
      nextCol = editableCols[newColIdx];
    } else {
      const delta = direction === 'down' ? 1 : -1;
      nextRow = Math.max(0, Math.min(rowCount - 1, editing.row + delta));
    }

    if (!commitEdit()) return; // don't move if current cell is invalid
    setTimeout(() => beginEdit(nextRow, nextCol), 0);
  }, [editing, tasks.length, commitEdit, beginEdit]);

  // -------------------------------------------------------------------------
  // Date display helpers — all dates derived from CPM, never raw startDay
  // -------------------------------------------------------------------------

  const renderDate = useCallback((dayNumber: number): string => {
    if (!Number.isFinite(dayNumber) || dayNumber < 1) return '—';
    const d = addWorkingDays(projectStartDate, dayNumber - 1, workingDaysPerWeek);
    return formatShortDate(d);
  }, [projectStartDate, workingDaysPerWeek]);

  // ISO yyyy-mm-dd for a given 1-indexed day number. Used to seed the native
  // web date picker with the cell's current value. Native is left as display
  // only for dates — the phone flow uses the classic schedule screen.
  const renderIso = useCallback((dayNumber: number): string => {
    const d = addWorkingDays(projectStartDate, Math.max(1, dayNumber) - 1, workingDaysPerWeek);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [projectStartDate, workingDaysPerWeek]);

  // Reverse of addWorkingDays: given a target calendar date, return the
  // 1-indexed day number it represents on the project calendar. Matches the
  // forward helper so click-to-edit round-trips cleanly.
  const dateToDayNumber = useCallback((target: Date): number => {
    const base = new Date(projectStartDate.getFullYear(), projectStartDate.getMonth(), projectStartDate.getDate());
    const tgt = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    if (tgt <= base) return 1;
    if (workingDaysPerWeek >= 7) {
      return Math.floor((tgt.getTime() - base.getTime()) / 86400000) + 1;
    }
    let count = 1;
    const cur = new Date(base);
    while (cur < tgt) {
      cur.setDate(cur.getDate() + 1);
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  }, [projectStartDate, workingDaysPerWeek]);

  // Native-web date picker. We mount a throwaway <input type="date"> off
  // screen, fire showPicker(), read the value, and tear it down. This is
  // cheaper than pulling in a date-picker library and matches the UX users
  // already know from every browser form on earth.
  const openDatePicker = useCallback((iso: string, onPick: (picked: Date) => void) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'date';
    input.value = iso;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    input.style.left = '0';
    input.style.top = '0';
    document.body.appendChild(input);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { document.body.removeChild(input); } catch { /* already gone */ }
    };
    input.addEventListener('change', () => {
      const v = input.value;
      if (v) {
        const [y, m, d] = v.split('-').map(n => parseInt(n, 10));
        if (y && m && d) onPick(new Date(y, m - 1, d));
      }
      cleanup();
    });
    input.addEventListener('blur', () => setTimeout(cleanup, 0));
    const anyInput = input as unknown as { showPicker?: () => void };
    if (typeof anyInput.showPicker === 'function') {
      try { anyInput.showPicker(); } catch { input.focus(); input.click(); }
    } else {
      input.focus();
      input.click();
    }
  }, []);

  // Start / Finish click handlers. Start rewrites `startDay`; Finish rewrites
  // `durationDays` so the bar's right edge lands on the picked date. Both
  // flow through `onEdit`, so they're undoable like any other grid edit.
  const handlePickStart = useCallback((task: ScheduleTask) => {
    if (Platform.OS !== 'web') return;
    openDatePicker(renderIso(task.startDay), (picked) => {
      const newStartDay = dateToDayNumber(picked);
      if (newStartDay === task.startDay) return;
      onEdit(task.id, { startDay: newStartDay });
    });
  }, [openDatePicker, renderIso, dateToDayNumber, onEdit]);

  const handlePickFinish = useCallback((task: ScheduleTask, cpmRow: CpmTaskResult | undefined) => {
    if (Platform.OS !== 'web') return;
    const currentFinishDay = cpmRow?.ef ?? (task.startDay + Math.max(1, task.durationDays) - 1);
    openDatePicker(renderIso(currentFinishDay), (picked) => {
      const newFinishDay = dateToDayNumber(picked);
      const newDuration = newFinishDay - task.startDay + 1;
      if (newDuration < 1) {
        setCellError('Finish date must be on or after Start');
        setTimeout(() => setCellError(null), 1800);
        return;
      }
      if (newDuration === task.durationDays) return;
      onEdit(task.id, { durationDays: newDuration });
    });
  }, [openDatePicker, renderIso, dateToDayNumber, onEdit]);

  // -------------------------------------------------------------------------
  // Row render
  // -------------------------------------------------------------------------

  const hasCycleConflict = cpm.conflicts.some(c => c.kind === 'cycle');

  const renderCell = (task: ScheduleTask, rowIndex: number, col: ColumnDef, cpmRow: CpmTaskResult | undefined, rowBgColor: string) => {
    const isEditingThis = editing?.row === rowIndex && editing?.col === col.key;
    const isEditable = col.kind === 'text' || col.kind === 'number';

    // Sticky freeze on web: keep rowNum/wbs/name cells pinned to the left of
    // the horizontal scroll viewport. Native RN has no sticky equivalent so
    // those cells flow normally there. `backgroundColor` must match the row
    // underneath or the pinned cell will render transparent over scrolled-in
    // content. The last frozen cell gets a soft right-edge shadow so the
    // freeze boundary is legible.
    const isFrozen = Platform.OS === 'web' && FROZEN_KEYS.includes(col.key);
    const isLastFrozen = isFrozen && col.key === FROZEN_KEYS[FROZEN_KEYS.length - 1];
    const frozenStyle: any = isFrozen ? {
      position: 'sticky',
      left: frozenLeftOffset.get(col.key) ?? 0,
      zIndex: 2,
      backgroundColor: rowBgColor,
      ...(isLastFrozen ? { boxShadow: '2px 0 4px -2px rgba(0,0,0,0.15)' } : {}),
    } : null;

    const cellStyle = [
      styles.cell,
      { width: col.width, alignItems: col.align === 'center' ? 'center' : col.align === 'right' ? 'flex-end' : 'flex-start' } as const,
      isEditingThis && styles.cellEditing,
      isEditingThis && cellError && styles.cellError,
      frozenStyle,
    ];

    // Active edit state: TextInput
    if (isEditingThis) {
      return (
        <View key={col.key} style={cellStyle}>
          <TextInput
            autoFocus
            style={[styles.cellInput, col.align === 'right' && { textAlign: 'right' }, col.align === 'center' && { textAlign: 'center' }]}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => commitEdit()}
            onBlur={() => { commitEdit(); }}
            keyboardType={col.kind === 'number' ? 'decimal-pad' : 'default'}
            returnKeyType="done"
            selectTextOnFocus
            // Web-only: Tab / Shift-Tab / Escape handling. onKeyPress in RN
            // isn't reliable cross-platform; on web it fires with native key.
            onKeyPress={(e: any) => {
              if (Platform.OS !== 'web') return;
              const key = e?.nativeEvent?.key;
              if (key === 'Tab') { e.preventDefault?.(); moveEdit(e.shiftKey ? 'prev' : 'next'); }
              else if (key === 'Escape') { e.preventDefault?.(); cancelEdit(); }
              else if (key === 'Enter' && !e.shiftKey) { /* handled by onSubmitEditing */ }
              else if (key === 'ArrowDown') { e.preventDefault?.(); moveEdit('down'); }
              else if (key === 'ArrowUp')   { e.preventDefault?.(); moveEdit('up'); }
            }}
            testID={`grid-edit-${rowIndex}-${col.key}`}
          />
          {cellError && (
            <View style={styles.cellErrorTip}>
              <Text style={styles.cellErrorText}>{cellError}</Text>
            </View>
          )}
        </View>
      );
    }

    // Display state
    let display: React.ReactNode = null;

    switch (col.key) {
      case 'rowNum': {
        // The # cell doubles as the selection target. Plain click = select
        // just this row; Cmd/Ctrl-click = toggle; Shift-click = range-extend
        // from last anchor. Selected rows show a filled blue pill; unselected
        // show the row number. Click on any other cell opens cell-edit as
        // before — selection and edit never fight each other.
        const isSelected = selected.has(task.id);
        return (
          <TouchableOpacity
            key={col.key}
            style={[
              styles.cell,
              { width: col.width, alignItems: 'center' } as const,
              styles.selectCell,
              isSelected && styles.selectCellActive,
            ]}
            onPress={(e: any) => {
              const native = e?.nativeEvent ?? {};
              const modKey = !!(native.metaKey || native.ctrlKey);
              const shiftKey = !!native.shiftKey;
              toggleRow(rowIndex, modKey, shiftKey);
            }}
            activeOpacity={0.6}
            testID={`grid-select-${rowIndex}`}
          >
            {isSelected ? (
              <View style={styles.selectDot}>
                <Check size={10} color="#fff" />
              </View>
            ) : (
              <Text style={styles.cellTextMuted}>{rowIndex + 1}</Text>
            )}
          </TouchableOpacity>
        );
      }
      case 'wbs':
        display = <Text style={styles.cellTextMuted}>{task.wbsCode || '—'}</Text>;
        break;
      case 'name': {
        // WBS / stack indent. Each outline level adds 12px of left padding so
        // summary trees read as a hierarchy. Summary rows also get a chevron
        // that toggles `collapsed` — children then hide via getHiddenTaskIds
        // at the parent level.
        const level = task.outlineLevel ?? 0;
        const isSummary = !!task.isSummary;
        display = (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: level * 12 }}>
            {isSummary ? (
              <TouchableOpacity
                onPress={() => onEdit(task.id, { collapsed: !task.collapsed })}
                style={styles.chevronBtn}
                activeOpacity={0.6}
                testID={`grid-chevron-${rowIndex}`}
              >
                <Text style={styles.chevronText}>{task.collapsed ? '▸' : '▾'}</Text>
              </TouchableOpacity>
            ) : (
              level > 0 && <View style={{ width: 14 }} />
            )}
            {cpmRow?.isCritical && <View style={styles.criticalDot} />}
            {task.isMilestone && <Text style={styles.milestoneDiamond}>◆</Text>}
            <Text
              style={[
                styles.cellText,
                cpmRow?.isCritical && styles.criticalText,
                isSummary && styles.summaryText,
              ]}
              numberOfLines={1}
            >
              {task.title}
            </Text>
          </View>
        );
        break;
      }
      case 'duration':
        display = <Text style={styles.cellText}>{task.durationDays}d</Text>;
        break;
      case 'start': {
        const label = cpmRow ? renderDate(cpmRow.es) : '—';
        const hasAnchor = task.anchorType && task.anchorType !== 'none';
        if (Platform.OS === 'web' && !compact && cpmRow) {
          return (
            <View key={col.key} style={[...cellStyle, styles.cellDate, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <TouchableOpacity
                onPress={() => handlePickStart(task)}
                activeOpacity={0.6}
                style={{ flex: 1 }}
                testID={`grid-cell-${rowIndex}-${col.key}`}
              >
                <Text style={[styles.cellText, styles.cellDateText]}>{label}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setAnchorFor(task)}
                activeOpacity={0.6}
                style={styles.anchorGlyph}
                testID={`grid-anchor-${rowIndex}`}
              >
                <Anchor
                  size={12}
                  color={hasAnchor ? Colors.primary : Colors.textMuted}
                  strokeWidth={hasAnchor ? 2.5 : 1.6}
                />
              </TouchableOpacity>
            </View>
          );
        }
        display = (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {hasAnchor && <Anchor size={10} color={Colors.primary} />}
            <Text style={styles.cellText}>{label}</Text>
          </View>
        );
        break;
      }
      case 'finish': {
        const label = cpmRow ? renderDate(cpmRow.ef) : '—';
        if (Platform.OS === 'web' && !compact && cpmRow) {
          return (
            <TouchableOpacity
              key={col.key}
              style={[...cellStyle, styles.cellDate]}
              onPress={() => handlePickFinish(task, cpmRow)}
              activeOpacity={0.6}
              testID={`grid-cell-${rowIndex}-${col.key}`}
            >
              <Text style={[styles.cellText, styles.cellDateText]}>{label}</Text>
            </TouchableOpacity>
          );
        }
        display = <Text style={styles.cellText}>{label}</Text>;
        break;
      }
      case 'float': {
        if (!cpmRow) { display = <Text style={styles.cellTextMuted}>—</Text>; break; }
        const label = formatFloat(cpmRow.totalFloat);
        const color = cpmRow.isCritical ? Colors.error : cpmRow.totalFloat < 3 ? Colors.warning : Colors.success;
        display = <Text style={[styles.cellText, { color, fontWeight: '600' }]}>{label}</Text>;
        break;
      }
      case 'deadline': {
        // Soft due-by marker. If the task's EF exceeds the deadline, render
        // red "Nd late". If it lands on or before, render the deadline itself.
        if (!task.deadline) {
          if (Platform.OS === 'web') {
            return (
              <TouchableOpacity
                key={col.key}
                style={[...cellStyle, styles.cellDate]}
                onPress={() => {
                  openDatePicker(renderIso(cpmRow?.ef ?? task.startDay), (picked) => {
                    const iso = `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`;
                    onEdit(task.id, { deadline: iso });
                  });
                }}
                activeOpacity={0.6}
                testID={`grid-cell-${rowIndex}-${col.key}`}
              >
                <Text style={[styles.cellText, styles.cellTextMuted]}>+ set</Text>
              </TouchableOpacity>
            );
          }
          display = <Text style={styles.cellTextMuted}>—</Text>;
          break;
        }
        // Deadline present — compute variance from EF.
        const deadlineDay = (() => {
          const parsed = Date.parse(task.deadline + 'T00:00:00');
          if (!Number.isFinite(parsed)) return null;
          const d = new Date(parsed);
          return Math.floor((d.getTime() - projectStartDate.getTime()) / 86400000) + 1;
        })();
        const ef = cpmRow?.ef ?? (task.startDay + Math.max(0, task.durationDays - 1));
        const variance = deadlineDay != null ? ef - deadlineDay : 0;
        const label = deadlineDay != null
          ? (variance > 0 ? `${variance}d late` : variance < 0 ? `${-variance}d early` : 'on time')
          : task.deadline;
        const color = variance > 0 ? Colors.error : variance < 0 ? Colors.success : Colors.textSecondary;
        if (Platform.OS === 'web') {
          return (
            <TouchableOpacity
              key={col.key}
              style={[...cellStyle, styles.cellDate]}
              onPress={() => {
                openDatePicker(task.deadline!, (picked) => {
                  const iso = `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`;
                  onEdit(task.id, { deadline: iso });
                });
              }}
              activeOpacity={0.6}
              testID={`grid-cell-${rowIndex}-${col.key}`}
            >
              <Text style={[styles.cellText, { color, fontWeight: '600' }]}>{label}</Text>
            </TouchableOpacity>
          );
        }
        display = <Text style={[styles.cellText, { color, fontWeight: '600' }]}>{label}</Text>;
        break;
      }
      case 'predecessors': {
        const links = task.dependencyLinks ?? task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
        if (links.length === 0) { display = <Text style={styles.cellTextMuted}>—</Text>; break; }
        const labels = links.map(l => {
          const wbs = idToWbsMap.get(l.taskId) ?? l.taskId;
          const type = l.type && l.type !== 'FS' ? l.type : '';
          const lag = l.lagDays ? (l.lagDays > 0 ? `+${l.lagDays}` : `${l.lagDays}`) : '';
          return `${wbs}${type}${lag}`;
        });
        display = <Text style={styles.cellText} numberOfLines={1}>{labels.join(', ')}</Text>;
        break;
      }
      case 'crew':
        display = <Text style={[styles.cellText, !task.crew && styles.cellTextMuted]}>{task.crew || '—'}</Text>;
        break;
      case 'status': {
        const chip = statusChip(task.status);
        display = (
          <TouchableOpacity
            style={[styles.statusChip, { backgroundColor: chip.bg }]}
            onPress={() => onEdit(task.id, { status: nextStatus(task.status) })}
            activeOpacity={0.7}
          >
            {chip.Icon && <chip.Icon size={10} color={chip.fg} />}
            <Text style={[styles.statusChipText, { color: chip.fg }]}>{chip.label}</Text>
          </TouchableOpacity>
        );
        break;
      }
      case 'progress':
        display = <Text style={styles.cellText}>{task.progress}%</Text>;
        break;
      case 'actions':
        display = (
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS === 'web') {
                if (window.confirm?.(`Delete "${task.title}"?`)) onDeleteTask(task.id);
              } else {
                Alert.alert('Delete task?', `"${task.title}" will be removed.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => onDeleteTask(task.id) },
                ]);
              }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Trash2 size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        );
        break;
    }

    if (isEditable) {
      return (
        <TouchableOpacity
          key={col.key}
          style={cellStyle}
          onPress={() => beginEdit(rowIndex, col.key)}
          activeOpacity={0.6}
          testID={`grid-cell-${rowIndex}-${col.key}`}
        >
          {display}
        </TouchableOpacity>
      );
    }
    return <View key={col.key} style={cellStyle}>{display}</View>;
  };

  // -------------------------------------------------------------------------
  // Cycle warning banner — surfaces CPM conflicts at the top of the grid
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Bulk action handlers — each wraps the parent's batch op in a sensible
  // confirm/prompt and then clears selection so the user sees the result.
  // ---------------------------------------------------------------------------

  const runBulkDelete = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const confirmMsg = `Delete ${ids.length} selected task${ids.length === 1 ? '' : 's'}? This can be undone.`;
    const go = () => {
      onBulkDelete?.(ids);
      clearSelection();
    };
    if (Platform.OS === 'web') {
      if (window.confirm?.(confirmMsg)) go();
    } else {
      Alert.alert('Delete tasks', confirmMsg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: go },
      ]);
    }
  }, [selected, onBulkDelete, clearSelection]);

  const runBulkDuplicate = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    onBulkDuplicate?.(ids);
    // Don't clear selection — the user probably wants to edit what they just
    // duplicated, and the parent is responsible for updating the selection
    // if it wants to move focus to the clones.
  }, [selected, onBulkDuplicate]);

  const runBulkShiftDays = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let daysStr: string | null = '1';
    if (Platform.OS === 'web') {
      daysStr = window.prompt?.('Shift selected tasks by how many days? (Negative = earlier)', '1') ?? null;
    } else {
      // No inline input on native — default to +1 and show a toast. A real
      // native UI would need a modal; punt until bulk edit is validated on web.
      daysStr = '1';
    }
    if (daysStr == null) return;
    const days = Number.parseInt(daysStr, 10);
    if (!Number.isFinite(days) || days === 0) return;
    onBulkShiftDays?.(ids, days);
  }, [selected, onBulkShiftDays]);

  const runBulkSetPhase = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let phase: string | null = '';
    if (Platform.OS === 'web') {
      phase = window.prompt?.('Set phase for selected tasks:', '') ?? null;
    }
    if (phase == null) return;
    const trimmed = phase.trim();
    if (!trimmed) return;
    onBulkSetPhase?.(ids, trimmed);
  }, [selected, onBulkSetPhase]);

  const runBulkSetCrew = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let crew: string | null = '';
    if (Platform.OS === 'web') {
      crew = window.prompt?.('Set crew for selected tasks:', '') ?? null;
    }
    if (crew == null) return;
    onBulkSetCrew?.(ids, crew.trim());
  }, [selected, onBulkSetCrew]);

  const runBulkAskAI = useCallback(() => {
    if (selected.size === 0) return;
    onBulkAskAI?.(Array.from(selected));
  }, [selected, onBulkAskAI]);

  // ---------------------------------------------------------------------------
  // Keyboard (web): Cmd/Ctrl-A to select all, Escape to clear, Delete to bulk-delete.
  // All gated on "not currently editing a cell" so we never steal focus from a
  // mid-edit TextInput.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (editing) return; // defer to the in-cell TextInput
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'a' && !inInput) {
        e.preventDefault();
        selectAll();
      } else if (key === 'escape' && selected.size > 0) {
        clearSelection();
      } else if ((key === 'delete' || key === 'backspace') && selected.size > 0 && !inInput) {
        e.preventDefault();
        runBulkDelete();
      } else if (mod && key === 'd' && selected.size > 0 && !inInput) {
        e.preventDefault();
        runBulkDuplicate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, selected, selectAll, clearSelection, runBulkDelete, runBulkDuplicate]);

  // ---------------------------------------------------------------------------
  // Paste handler (web): TSV / CSV → selected rows.
  //
  // When the user copies a range from Excel/Sheets/MSP and pastes onto the
  // grid while one or more rows are selected, distribute the cells onto
  // those rows. Column mapping mirrors MSP's default export order so a
  // round-trip feels natural:
  //   col 1 → title        col 2 → durationDays (number)
  //   col 3 → phase        col 4 → crew
  //   col 5 → progress (%) col 6 → notes
  // Extra columns are ignored; missing columns leave fields untouched.
  //
  // If the clipboard has ONE row of values and the user has N selected
  // rows, the single row fills all of them (classic "fill down"). If the
  // clipboard has many rows, we pair them with selected rows 1:1 in row
  // order until either side runs out.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: ClipboardEvent) => {
      if (editing) return;
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (inInput) return;
      if (selected.size === 0) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;

      // Parse: prefer tabs (Excel/Sheets); fall back to commas if no tabs
      // on any line.
      const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0);
      if (lines.length === 0) return;
      const delim = lines[0].includes('\t') ? '\t' : ',';
      const rows = lines.map(l => l.split(delim));

      // Resolve the selected ids back to the original task order so pastes
      // land predictably from top to bottom.
      const orderedIds = tasks.filter(t => selected.has(t.id)).map(t => t.id);
      if (orderedIds.length === 0) return;

      e.preventDefault();
      for (let i = 0; i < orderedIds.length; i++) {
        const row = rows.length === 1 ? rows[0] : rows[i];
        if (!row) break;
        const patch: Partial<ScheduleTask> = {};
        const [title, dur, phase, crew, progress, notes] = row;
        if (title !== undefined && title !== '') patch.title = title;
        if (dur !== undefined && dur !== '') {
          const n = Number.parseFloat(dur);
          if (Number.isFinite(n) && n >= 0) patch.durationDays = Math.round(n);
        }
        if (phase !== undefined && phase !== '') patch.phase = phase;
        if (crew !== undefined && crew !== '') patch.crew = crew;
        if (progress !== undefined && progress !== '') {
          const p = Number.parseFloat(progress.replace('%', ''));
          if (Number.isFinite(p)) patch.progress = Math.max(0, Math.min(100, Math.round(p)));
        }
        if (notes !== undefined && notes !== '') patch.notes = notes;
        if (Object.keys(patch).length > 0) onEdit(orderedIds[i], patch);
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [editing, selected, tasks, onEdit]);

  const renderConflictBanner = () => {
    if (cpm.conflicts.length === 0) return null;
    const summary = cpm.conflicts[0];
    return (
      <View style={[styles.banner, summary.kind === 'cycle' ? styles.bannerError : styles.bannerWarn]}>
        <AlertTriangle size={14} color={summary.kind === 'cycle' ? Colors.error : Colors.warning} />
        <Text style={styles.bannerText}>{summary.message}</Text>
        {cpm.conflicts.length > 1 && (
          <Text style={styles.bannerCount}>+{cpm.conflicts.length - 1} more</Text>
        )}
      </View>
    );
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const renderBulkBar = () => {
    if (selected.size === 0) return null;
    const n = selected.size;
    return (
      <View style={styles.bulkBar}>
        <TouchableOpacity onPress={clearSelection} style={styles.bulkClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.bulkCount}>{n} selected</Text>
        <View style={styles.bulkBtnRow}>
          {onBulkAskAI && (
            <TouchableOpacity style={[styles.bulkBtn, styles.bulkBtnAI]} onPress={runBulkAskAI} activeOpacity={0.7}>
              <Sparkles size={12} color="#fff" />
              <Text style={[styles.bulkBtnText, { color: '#fff' }]}>Ask AI</Text>
            </TouchableOpacity>
          )}
          {onBulkShiftDays && (
            <TouchableOpacity style={styles.bulkBtn} onPress={runBulkShiftDays} activeOpacity={0.7}>
              <CalendarRange size={12} color={Colors.primary} />
              <Text style={styles.bulkBtnText}>Shift days</Text>
            </TouchableOpacity>
          )}
          {onBulkSetPhase && (
            <TouchableOpacity style={styles.bulkBtn} onPress={runBulkSetPhase} activeOpacity={0.7}>
              <Layers size={12} color={Colors.primary} />
              <Text style={styles.bulkBtnText}>Phase</Text>
            </TouchableOpacity>
          )}
          {onBulkSetCrew && (
            <TouchableOpacity style={styles.bulkBtn} onPress={runBulkSetCrew} activeOpacity={0.7}>
              <Users size={12} color={Colors.primary} />
              <Text style={styles.bulkBtnText}>Crew</Text>
            </TouchableOpacity>
          )}
          {onBulkDuplicate && (
            <TouchableOpacity style={styles.bulkBtn} onPress={runBulkDuplicate} activeOpacity={0.7}>
              <Copy size={12} color={Colors.primary} />
              <Text style={styles.bulkBtnText}>Duplicate</Text>
            </TouchableOpacity>
          )}
          {onBulkDelete && (
            <TouchableOpacity style={[styles.bulkBtn, styles.bulkBtnDanger]} onPress={runBulkDelete} activeOpacity={0.7}>
              <Trash2 size={12} color={Colors.error} />
              <Text style={[styles.bulkBtnText, { color: Colors.error }]}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {renderConflictBanner()}

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ width: visibleTotalWidth }}>
          {/* Sticky header row */}
          <View style={styles.headerRow}>
            {visibleColumns.map(col => {
              const isFrozen = Platform.OS === 'web' && FROZEN_KEYS.includes(col.key);
              const isLastFrozen = isFrozen && col.key === FROZEN_KEYS[FROZEN_KEYS.length - 1];
              const frozenStyle: any = isFrozen ? {
                position: 'sticky',
                left: frozenLeftOffset.get(col.key) ?? 0,
                zIndex: 4,
                backgroundColor: Colors.surfaceAlt,
                ...(isLastFrozen ? { boxShadow: '2px 0 4px -2px rgba(0,0,0,0.15)' } : {}),
              } : null;
              return (
                <View
                  key={col.key}
                  style={[
                    styles.headerCell,
                    { width: col.width, alignItems: col.align === 'center' ? 'center' : col.align === 'right' ? 'flex-end' : 'flex-start' },
                    frozenStyle,
                  ]}
                >
                  <Text style={styles.headerText}>{col.label}</Text>
                </View>
              );
            })}
          </View>

          {/* Body rows — children of collapsed summaries are hidden. We keep
              their data intact (CPM still respects them) but suppress the row. */}
          <ScrollView style={{ maxHeight: 640 }} showsVerticalScrollIndicator>
            {(() => {
              const hidden = getHiddenTaskIds(tasks);
              return tasks
                .map((task, rowIndex) => ({ task, rowIndex }))
                .filter(({ task }) => !hidden.has(task.id));
            })().map(({ task, rowIndex }) => {
              const cpmRow = cpm.perTask.get(task.id);
              const isFocused = focusedTaskId === task.id;
              const isSelected = selected.has(task.id);
              const inCycleConflict = hasCycleConflict &&
                cpm.conflicts.some(c => c.kind === 'cycle' && c.taskIds.includes(task.id));

              // Effective row background color. Precedence mirrors the
              // StyleSheet: conflict > selected > focused > alt-stripe > base.
              // Sticky cells paint this so horizontally-scrolled content
              // doesn't bleed through them.
              const rowBgColor = inCycleConflict ? Colors.error + '10'
                : isSelected ? Colors.primary + '18'
                : isFocused ? Colors.primary + '10'
                : rowIndex % 2 === 1 ? Colors.surface
                : Colors.card;

              return (
                <View
                  key={task.id}
                  style={[
                    styles.row,
                    rowIndex % 2 === 1 && styles.rowAlt,
                    isFocused && styles.rowFocused,
                    isSelected && styles.rowSelected,
                    inCycleConflict && styles.rowConflict,
                    { borderLeftColor: getPhaseColor(task.phase) },
                  ]}
                  testID={`grid-row-${rowIndex}`}
                >
                  {visibleColumns.map(col => renderCell(task, rowIndex, col, cpmRow, rowBgColor))}
                </View>
              );
            })}

            {/* Footer: add-task button */}
            <TouchableOpacity
              style={styles.addRow}
              onPress={onAddTask}
              activeOpacity={0.6}
              testID="grid-add-task"
            >
              <Plus size={14} color={Colors.primary} />
              <Text style={styles.addRowText}>Add task</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </ScrollView>
      {renderBulkBar()}
      <AnchorPickerModal
        task={anchorFor}
        onClose={() => setAnchorFor(null)}
        onApply={(patch) => {
          if (!anchorFor) return;
          onEdit(anchorFor.id, patch);
          setAnchorFor(null);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// AnchorPickerModal — small popover for setting a task's MAGE "anchor".
//
// Intentionally simple: a segmented list of the 8 anchor types + a date
// picker (web: native HTML input; native: text input for now). Writes back
// a {anchorType, anchorDate} patch. Uses MAGE's orange accent and the
// lucide Anchor icon to stay visually distinct from MSP.
// ---------------------------------------------------------------------------

const ANCHOR_OPTIONS: { value: AnchorType; label: string; help: string }[] = [
  { value: 'none', label: 'No anchor', help: 'CPM decides. Task floats with its predecessors.' },
  { value: 'start-no-earlier', label: 'Start no earlier than', help: 'Task may start on or after the anchor date.' },
  { value: 'start-no-later', label: 'Start no later than', help: 'Task must start on or before the anchor date.' },
  { value: 'finish-no-earlier', label: 'Finish no earlier than', help: 'Task may finish on or after the anchor date.' },
  { value: 'finish-no-later', label: 'Finish no later than', help: 'Task must finish on or before the anchor date.' },
  { value: 'must-start-on', label: 'Must start on', help: 'Hard pin — task starts exactly on this date.' },
  { value: 'must-finish-on', label: 'Must finish on', help: 'Hard pin — task finishes exactly on this date.' },
  { value: 'as-late-as-possible', label: 'As late as possible', help: 'Push task to its late-start without slipping the project.' },
];

interface AnchorPickerModalProps {
  task: ScheduleTask | null;
  onClose: () => void;
  onApply: (patch: Partial<ScheduleTask>) => void;
}

function AnchorPickerModal({ task, onClose, onApply }: AnchorPickerModalProps) {
  const [type, setType] = useState<AnchorType>('none');
  const [date, setDate] = useState<string>('');

  useEffect(() => {
    if (task) {
      setType(task.anchorType ?? 'none');
      setDate(task.anchorDate ?? '');
    }
  }, [task]);

  const needsDate = type !== 'none' && type !== 'as-late-as-possible';

  const apply = () => {
    if (needsDate && !date) return;
    onApply({
      anchorType: type,
      anchorDate: needsDate ? date : undefined,
    });
  };

  return (
    <Modal
      visible={!!task}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={anchorStyles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={anchorStyles.card} onPress={() => {}}>
          <View style={anchorStyles.header}>
            <Anchor size={16} color={Colors.primary} />
            <Text style={anchorStyles.title}>Anchor</Text>
            <Text style={anchorStyles.subtitle} numberOfLines={1}>{task?.title || ''}</Text>
            <TouchableOpacity onPress={onClose} style={anchorStyles.closeBtn}>
              <X size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 360 }}>
            {ANCHOR_OPTIONS.map(opt => {
              const active = opt.value === type;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[anchorStyles.option, active && anchorStyles.optionActive]}
                  onPress={() => setType(opt.value)}
                  activeOpacity={0.7}
                >
                  <View style={[anchorStyles.radio, active && anchorStyles.radioActive]}>
                    {active && <View style={anchorStyles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[anchorStyles.optionLabel, active && anchorStyles.optionLabelActive]}>
                      {opt.label}
                    </Text>
                    <Text style={anchorStyles.optionHelp}>{opt.help}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {needsDate && (
            <View style={anchorStyles.dateRow}>
              <Text style={anchorStyles.dateLabel}>Anchor date</Text>
              {Platform.OS === 'web' ? (
                // Native HTML date input — clean picker, no extra deps.
                React.createElement('input' as any, {
                  type: 'date',
                  value: date,
                  onChange: (e: any) => setDate(e.target.value),
                  style: {
                    border: `1px solid ${Colors.border}`,
                    borderRadius: 6,
                    padding: '6px 8px',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    color: Colors.text,
                  },
                })
              ) : (
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  style={anchorStyles.dateInput}
                />
              )}
            </View>
          )}
          <View style={anchorStyles.footer}>
            <TouchableOpacity style={anchorStyles.btnGhost} onPress={onClose} activeOpacity={0.7}>
              <Text style={anchorStyles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[anchorStyles.btnPrimary, needsDate && !date && anchorStyles.btnDisabled]}
              onPress={apply}
              disabled={needsDate && !date}
              activeOpacity={0.7}
            >
              <Text style={anchorStyles.btnPrimaryText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const anchorStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 420,
    maxWidth: '92%',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  subtitle: { flex: 1, fontSize: 13, color: Colors.textSecondary, marginLeft: 4 },
  closeBtn: { padding: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  optionActive: { backgroundColor: Colors.primaryLight },
  radio: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  optionLabel: { fontSize: 13, fontWeight: '600', color: Colors.text },
  optionLabelActive: { color: Colors.primary },
  optionHelp: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  dateLabel: { fontSize: 13, fontWeight: '600', color: Colors.text },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    color: Colors.text,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  btnGhost: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
  },
  btnGhostText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  btnPrimary: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  btnDisabled: { opacity: 0.45 },
  btnPrimaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});

// ---------------------------------------------------------------------------
// Status chip helper
// ---------------------------------------------------------------------------

function statusChip(status: TaskStatus): { bg: string; fg: string; label: string; Icon?: any } {
  switch (status) {
    case 'done':
      return { bg: Colors.successLight, fg: Colors.success, label: 'Done', Icon: Check };
    case 'in_progress':
      return { bg: Colors.infoLight, fg: Colors.info, label: 'Active', Icon: Play };
    case 'on_hold':
      return { bg: Colors.warningLight, fg: Colors.warning, label: 'Hold', Icon: Pause };
    default:
      return { bg: Colors.fillTertiary, fg: Colors.textSecondary, label: 'Not Started', Icon: Circle };
  }
}

function nextStatus(status: TaskStatus): TaskStatus {
  const order: TaskStatus[] = ['not_started', 'in_progress', 'on_hold', 'done'];
  const idx = order.indexOf(status);
  return order[(idx + 1) % order.length];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    height: 36,
    alignItems: 'center',
  },
  headerCell: {
    paddingHorizontal: 10,
    height: '100%',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.borderLight,
  },
  headerText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    height: ROW_HEIGHT,
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
    borderLeftWidth: 3,
  },
  rowAlt: {
    backgroundColor: Colors.surface,
  },
  rowFocused: {
    backgroundColor: Colors.primary + '10',
  },
  rowConflict: {
    backgroundColor: Colors.error + '10',
  },
  cell: {
    paddingHorizontal: 10,
    height: '100%',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.borderLight,
  },
  cellEditing: {
    backgroundColor: Colors.primary + '10',
    borderColor: Colors.primary,
    borderWidth: 1.5,
    borderRadius: 4,
  },
  cellError: {
    backgroundColor: Colors.error + '15',
    borderColor: Colors.error,
  },
  cellText: {
    fontSize: 13,
    color: Colors.text,
  },
  cellTextMuted: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  cellDate: {
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  cellDateText: {
    color: Colors.primary,
    fontWeight: '600',
  },
  anchorGlyph: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  chevronBtn: {
    width: 14,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  chevronText: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '700',
  },
  summaryText: {
    fontWeight: '700',
  },
  cellInput: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    paddingVertical: 0,
    paddingHorizontal: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  cellErrorTip: {
    position: 'absolute',
    top: ROW_HEIGHT,
    left: 0,
    backgroundColor: Colors.error,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    zIndex: 100,
    minWidth: 180,
  },
  cellErrorText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  criticalDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: Colors.error,
  },
  criticalText: {
    fontWeight: '700',
    color: Colors.error,
  },
  milestoneDiamond: {
    fontSize: 12,
    color: Colors.primary,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderLight,
  },
  addRowText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  bannerError: {
    backgroundColor: Colors.error + '15',
    borderBottomColor: Colors.error + '40',
  },
  bannerWarn: {
    backgroundColor: Colors.warning + '15',
    borderBottomColor: Colors.warning + '40',
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
    fontWeight: '500',
  },
  bannerCount: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
  },

  // Selection + bulk edit
  rowSelected: {
    backgroundColor: Colors.primary + '18',
  },
  selectCell: {
    // Visually distinguish the # column as a clickable selection target.
    backgroundColor: Colors.surfaceAlt,
  },
  selectCellActive: {
    backgroundColor: Colors.primary + '20',
  },
  selectDot: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  bulkClear: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  bulkCount: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    marginRight: 4,
  },
  bulkBtnRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
  },
  bulkBtnAI: {
    backgroundColor: Colors.primary,
  },
  bulkBtnDanger: {
    backgroundColor: Colors.error + '15',
  },
  bulkBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
});
