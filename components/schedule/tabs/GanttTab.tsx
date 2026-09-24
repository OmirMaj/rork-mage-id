// components/schedule/tabs/GanttTab.tsx — Phase 27.
//
// Renders the existing GridPane + InteractiveGantt side-by-side.
// Reads shared schedule state from SchedulerContext; receives the
// callbacks and derived values that the context doesn't store (onEdit,
// onAddTask, onDeleteTask, cpm from utils/cpm, etc.) as direct props.
//
// Why props instead of pure context for callbacks:
//   GridPane and InteractiveGantt call `onEdit(taskId, patch)` on every
//   keystroke / drag-end. Those callbacks live in schedule-pro and feed
//   the undo stack + persist debounce — threading them through context
//   would couple SchedulerContext to the edit/undo machinery, which is
//   owned by the screen. Props keeps the separation clear.
//
// Phone fallback: at bp === 'phone' the GridPane disappears and only
// InteractiveGantt is rendered, with `mode="phone"` so it knows to swap
// to its sticky-task-column / horizontal-scroll layout.
//
// Desktop (wave 6c). The founder on his 1512 px MacBook: "the scheduler does
// not work well". The split was a flat 38 % grid that hid Start / Finish /
// Float, the two panes scrolled separately, and the bars sat a toolbar-height
// below their rows. On a desktop layout now:
//   - the grid width is proPanes(W) (utils/scheduleProLayout): 520 of the
//     1448 px work row, 400 with the right-hand pane docked; he can drag the
//     8 px divider and the width is remembered (mageid_schedule_grid_width);
//   - W is THIS tab's measured width, the whole work row. When the pane docks
//     (W ≥ 1288) the Gantt stops `pane` px short and that slot is left empty
//     for the screen's docked pane, drawn over it: the screen must NOT also
//     narrow the shell, or the pane is subtracted twice;
//   - the grid and the Gantt scroll vertically together;
//   - with a controlled `layout` the screen owns the toolbar: the local layout
//     bar hides, the Gantt's own toolbar hides (zoom / Fit / Today come in
//     through the ref), the conflict banner leaves the grid and the selection
//     bar floats — so the grid header and the Gantt header start on the same
//     pixel and row i's centre is bar i's centre;
//   - `density` sets the rows (compact 32, comfortable 40; default legacy 56).
// A tablet and the phone keep today's tab untouched.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, StyleSheet, Pressable, Text, PanResponder, Platform, type ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GridPaneDefault from '../GridPane';
import InteractiveGanttDefault, { type InteractiveGanttHandle } from '../InteractiveGantt';
import { useScheduler } from '../SchedulerContext';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useResponsive } from '@/utils/useResponsive';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import {
  DENSITY, GRID_WIDTH_STORAGE_KEY, committedGridWidth, dragGridWidth, parseStoredGrid, proPanes, type Density,
} from '@/utils/scheduleProLayout';
import { SPLIT_DIVIDER } from '@/utils/splitViewLayout';
import type { SchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';

export type GanttPaneMode = 'split' | 'gantt' | 'lanes' | 'living';

const LAYOUT_LABEL: Record<GanttPaneMode, string> = {
  split: 'Split',
  gantt: 'Gantt',
  lanes: 'Lanes',
  living: 'Living Plan',
};

/** What the Pro toolbar can ask of the Timeline tab (lane DB's toolbar). */
export type GanttTabHandle = {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  today(): void;
  scrollToTask(id: string): void;
};

export interface GanttTabProps {
  /** Propagated from schedule-pro — feeds GridPane + InteractiveGantt. */
  projectStartDate: Date;
  workingDaysPerWeek: number;
  nonWorkingDates?: string[];
  /** CPM result from utils/cpm (not SchedulerContext.CpmResult). */
  cpm: CpmResult;
  /**
   * Which layout the Timeline tab opens on. The tab owns a local segmented
   * control that switches between all four modes (the spreadsheet lives in the
   * dedicated List view now, so there is no full-width 'grid' layout here):
   *   - 'split'  → GridPane + InteractiveGantt side-by-side (default)
   *   - 'gantt'  → full-width InteractiveGantt only (timeline view)
   *   - 'lanes'  → ResourceSwimlanes (rendered via renderLanes)
   *   - 'living' → LivingFloorPlan (rendered via renderLiving)
   */
  initialLayout?: GanttPaneMode;
  /** Rendered when the user picks the Lanes layout. */
  renderLanes?: () => ReactNode;
  /** Rendered when the user picks the Living Plan layout. */
  renderLiving?: () => ReactNode;
  /** Callback wired to schedule-pro's undo-aware commit. */
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  onAddTask: () => void;
  /** Bulk-create tasks in one undo step (ghost row / paste / insert). */
  onAddTasks?: (partials: { title: string; durationDays?: number; phase?: string }[], atIndex?: number) => string[];
  /** Passed through to InteractiveGantt for double-tap-empty-timeline flow. */
  onAddTaskAtDay?: (dayNumber: number) => void;
  onDeleteTask: (taskId: string) => void;
  /** Outline authoring — indent/outdent a task (parentId + outlineLevel). */
  onOutline?: (id: string, dir: 'indent' | 'outdent') => void;
  /** Reorder — move a task up (-1) or down (+1) in array position. */
  onReorder?: (id: string, delta: number) => void;
  onDependencyCreate?: (fromId: string, toId: string) => void;
  focusedTaskId?: string | null;
  onFocusTask?: (id: string | null) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onBulkDelete?: (ids: string[]) => void;
  onBulkDuplicate?: (ids: string[]) => void;
  onBulkShiftDays?: (ids: string[], days: number) => void;
  onBulkSetPhase?: (ids: string[], phase: string) => void;
  onBulkSetCrew?: (ids: string[], crew: string) => void;
  onBulkAskAI?: (ids: string[]) => void;

  // ---- Wave 6c (all optional; the defaults are today's tab) ----
  /** Controlled layout: the screen's toolbar owns the view switch, so the
   *  local layout bar hides (and so does the Gantt's own toolbar). */
  layout?: GanttPaneMode;
  /** Row density. Omitted = legacy 56 px rows. */
  density?: Density;
  /** The right-hand pane is open (docks at W ≥ 1288, overlays below). */
  paneOpen?: boolean;
  /** A proposed change, drawn on the Gantt and listed under the grid. */
  preview?: SchedulePreviewOverlay | null;
}

/** The legacy (tablet / native) split: the grid's share of the row. The
 *  desktop split never uses it — its width is proPanes'. */
const TABLET_GRID_SHARE = '38%';

export const GanttTab = forwardRef<GanttTabHandle, GanttTabProps>(function GanttTab({
  projectStartDate,
  workingDaysPerWeek,
  nonWorkingDates,
  cpm,
  initialLayout,
  renderLanes,
  renderLiving,
  onEdit,
  onAddTask,
  onAddTasks,
  onAddTaskAtDay,
  onDeleteTask,
  onOutline,
  onReorder,
  onDependencyCreate,
  focusedTaskId,
  onFocusTask,
  selectedIds,
  onSelectionChange,
  onBulkDelete,
  onBulkDuplicate,
  onBulkShiftDays,
  onBulkSetPhase,
  onBulkSetCrew,
  onBulkAskAI,
  layout: controlledLayout,
  density,
  paneOpen,
  preview,
}: GanttTabProps, ref) {
  // Built per theme: the split-pane chrome (divider, layout bar, phone FAB)
  // baked its Colors.surface/surfaceAlt/border at import (audit 2026-09-07).
  const styles = useThemedStyles(makeStyles);
  const { tasks } = useScheduler();
  const { bp } = useResponsive();
  const insets = useSafeAreaInsets();
  const [localLayout, setLayout] = useState<GanttPaneMode>(initialLayout ?? 'split');
  const layout = controlledLayout ?? localLayout;
  // The screen's toolbar owns the chrome once it controls the layout.
  const proCanvas = controlledLayout !== undefined;

  // ---- Desktop split geometry (wave 6c) ----
  const { isDesktop } = useResponsiveLayout();
  const { width: rowWidth, onLayout: onRowLayout } = useContainerWidth();
  const [storedGrid, setStoredGrid] = useState<number | null>(null);
  const [dragGrid, setDragGrid] = useState<number | null>(null);
  useEffect(() => {
    if (!isDesktop) return undefined;
    let cancelled = false;
    AsyncStorage.getItem(GRID_WIDTH_STORAGE_KEY)
      .then((raw) => { if (!cancelled) setStoredGrid(parseStoredGrid(raw)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isDesktop]);
  const panes = useMemo(
    () => proPanes(rowWidth, { paneOpen: !!paneOpen, storedGrid: dragGrid ?? storedGrid }),
    [rowWidth, paneOpen, dragGrid, storedGrid],
  );
  // The divider: drag to resize the grid (clamped by dragGridWidth), saved on release.
  const dragStart = useRef(0);
  const liveGrid = useRef(panes.grid);
  liveGrid.current = panes.grid;
  const rowWidthRef = useRef(rowWidth);
  rowWidthRef.current = rowWidth;
  const paneOpenRef = useRef(!!paneOpen);
  paneOpenRef.current = !!paneOpen;
  const divider = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { dragStart.current = liveGrid.current; },
    onPanResponderMove: (_e, g) => { setDragGrid(dragGridWidth(dragStart.current, g.dx, rowWidthRef.current)); },
    onPanResponderRelease: (_e, g) => {
      // Save the width he SAW: with the pane docked a drag cannot widen the
      // grid past the pane's cap, so the cap is what is kept.
      const w = committedGridWidth(dragStart.current, g.dx, rowWidthRef.current, paneOpenRef.current);
      setDragGrid(null);
      setStoredGrid(w);
      void AsyncStorage.setItem(GRID_WIDTH_STORAGE_KEY, String(w)).catch(() => {});
    },
    onPanResponderTerminate: () => { setDragGrid(null); },
  }), []);

  // ---- Rows ----
  const dims = density ? DENSITY[density] : undefined;

  // ---- Vertical scroll sync (the desktop Pro canvas): the grid and the Gantt
  // move as one. Only with the Pro canvas (controlled layout: no Gantt toolbar,
  // no grid conflict banner, the 24 px footer strip), because only there do
  // both panes start their rows on the same pixel and end on the same maximum
  // scrollTop (GANTT_SYNC_TAIL, utils/scheduleProLayout). The legacy chrome
  // keeps today's independent scrolling.
  // `syncing` names the pane that is driving; the other's echo is ignored
  // until it has been quiet for a moment.
  const gridBodyRef = useRef<ScrollView | null>(null);
  const ganttVRef = useRef<ScrollView | null>(null);
  const syncing = useRef<'grid' | 'gantt' | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);
  const holdSync = (who: 'grid' | 'gantt') => {
    syncing.current = who;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { syncing.current = null; }, 80);
  };
  const onGridScroll = useCallback((y: number) => {
    if (syncing.current === 'gantt') return;
    holdSync('grid');
    ganttVRef.current?.scrollTo({ y, animated: false });
  }, []);
  const onGanttScroll = useCallback((y: number) => {
    if (syncing.current === 'grid') return;
    holdSync('gantt');
    gridBodyRef.current?.scrollTo({ y, animated: false });
  }, []);

  // ---- The toolbar's handle ----
  const ganttCtl = useRef<InteractiveGanttHandle | null>(null);
  useImperativeHandle(ref, () => ({
    zoomIn: () => ganttCtl.current?.zoomIn(),
    zoomOut: () => ganttCtl.current?.zoomOut(),
    fit: () => ganttCtl.current?.fit(),
    today: () => ganttCtl.current?.today(),
    scrollToTask: (id: string) => ganttCtl.current?.scrollToTask(id),
  }), []);

  if (bp === 'phone') {
    return (
      <View style={styles.phoneRoot}>
        <InteractiveGanttDefault
          tasks={tasks as ScheduleTask[]}
          cpm={cpm}
          projectStartDate={projectStartDate}
          workingDaysPerWeek={workingDaysPerWeek}
          nonWorkingDates={nonWorkingDates}
          onEdit={onEdit}
          onDeleteTask={onDeleteTask}
          onOutline={onOutline}
          onReorder={onReorder}
          onDependencyCreate={onDependencyCreate}
          focusedTaskId={focusedTaskId}
          onFocusTask={onFocusTask}
          onAddTaskAtDay={onAddTaskAtDay}
          compact={false}
          mode="phone"
        />
        <Pressable
          onPress={onAddTask}
          // Runtime audit 2026-09-06, VIS-02. This sat at `insets.bottom + 70`
          // — byte-for-byte the global Brain FAB's own offset
          // (components/brain/BrainFab.tsx). schedule-pro is a ROOT stack
          // route, so both read the same raw home-indicator inset: the Brain
          // FAB's 56pt circle spans x[20,76] y[70,126] and this 44pt one spans
          // x[16,60] y[70,114], i.e. entirely inside it. The Brain FAB is
          // mounted above the router, so it painted over the "+" and ate every
          // tap meant for "add task" on the Pro scheduler's phone view.
          // Stacked clear of it instead: 70 (its base) + 56 (its height) + 12
          // gap = 138, the same convention components/UniversalMicButton.tsx
          // already uses on project-detail.
          style={[styles.fab, { bottom: insets.bottom + 70 + 56 + 12 }]}
          testID="gantt-phone-fab"
          accessibilityLabel="Add task"
          accessibilityRole="button"
        >
          <Text style={styles.fabIcon}>＋</Text>
        </Pressable>
      </View>
    );
  }

  // Non-phone: a local segmented control switches between all five layouts.
  // Lanes / Living Plan are supplied by the screen as render-props so their
  // data-fetching stays in schedule-pro; the other three render inline.
  const body = (() => {
    if (layout === 'lanes') return renderLanes?.() ?? null;
    if (layout === 'living') return renderLiving?.() ?? null;

    if (layout === 'gantt') {
      return (
        <View style={styles.full}>
          <InteractiveGanttDefault
            tasks={tasks as ScheduleTask[]}
            cpm={cpm}
            projectStartDate={projectStartDate}
            workingDaysPerWeek={workingDaysPerWeek}
            nonWorkingDates={nonWorkingDates}
            onEdit={onEdit}
            onDeleteTask={onDeleteTask}
            onOutline={onOutline}
            onReorder={onReorder}
            onDependencyCreate={onDependencyCreate}
            focusedTaskId={focusedTaskId}
            onFocusTask={onFocusTask}
            onAddTaskAtDay={onAddTaskAtDay}
            controllerRef={ganttCtl}
            rowHeight={dims?.row}
            headerHeight={dims?.header}
            barHeight={dims?.bar}
            hideToolbar={proCanvas || undefined}
            preview={preview ?? undefined}
          />
        </View>
      );
    }

    // 'split' — the default. Grid on the left, Gantt on the right.
    return (
      <View style={styles.row}>
        <View
          style={[styles.grid, isDesktop && { width: panes.grid, borderRightWidth: 0 }]}
          testID={isDesktop ? 'gantt-split-grid' : undefined}
        >
          <GridPaneDefault
            tasks={tasks as ScheduleTask[]}
            // The SAME CpmResult the Gantt beside it draws from. Without this
            // the grid re-ran the engine itself, and its own run has no
            // `taskCalendars` and no `criticalFloatThresholdDays` — so a
            // per-resource calendar and the near-critical threshold applied to
            // one half of the split view and not the other. Dates already
            // agreed (GridPane's fallback is calendar-aware), which is exactly
            // why nothing caught it.
            cpm={cpm}
            projectStartDate={projectStartDate}
            workingDaysPerWeek={workingDaysPerWeek}
            nonWorkingDates={nonWorkingDates}
            focusedTaskId={focusedTaskId}
            onEdit={onEdit}
            onAddTask={onAddTask}
            onAddTasks={onAddTasks}
            onDeleteTask={onDeleteTask}
            onOutline={onOutline}
            onReorder={onReorder}
            selectedIds={selectedIds}
            onSelectionChange={onSelectionChange}
            onBulkDelete={onBulkDelete}
            onBulkDuplicate={onBulkDuplicate}
            onBulkShiftDays={onBulkShiftDays}
            onBulkSetPhase={onBulkSetPhase}
            onBulkSetCrew={onBulkSetCrew}
            onBulkAskAI={onBulkAskAI}
            compact
            splitWidth={isDesktop ? panes.grid : undefined}
            rowHeight={dims?.row}
            headerHeight={dims?.header}
            onBodyScroll={isDesktop && proCanvas ? onGridScroll : undefined}
            bodyScrollRef={isDesktop && proCanvas ? gridBodyRef : undefined}
            conflictBanner={proCanvas ? 'none' : undefined}
            bulkBarPlacement={proCanvas ? 'float' : undefined}
            previewAddedTitles={preview ? preview.added.map(a => a.title) : undefined}
          />
        </View>
        {isDesktop ? (
          <View
            style={styles.splitDivider}
            {...divider.panHandlers}
            {...(Platform.OS === 'web' ? ({ dataSet: { print: 'hide' } } as object) : {})}
            accessibilityRole="adjustable"
            accessibilityLabel="Resize the task grid"
            testID="gantt-split-divider"
          >
            <View style={styles.dividerLine} />
          </View>
        ) : null}
        <View
          style={[styles.gantt, isDesktop && panes.paneMode === 'dock' && { flex: 0, width: panes.gantt }]}
          testID={isDesktop ? 'gantt-split-timeline' : undefined}
        >
          <InteractiveGanttDefault
            tasks={tasks as ScheduleTask[]}
            cpm={cpm}
            projectStartDate={projectStartDate}
            workingDaysPerWeek={workingDaysPerWeek}
            nonWorkingDates={nonWorkingDates}
            onEdit={onEdit}
            onDeleteTask={onDeleteTask}
            onOutline={onOutline}
            onReorder={onReorder}
            onDependencyCreate={onDependencyCreate}
            focusedTaskId={focusedTaskId}
            onFocusTask={onFocusTask}
            onAddTaskAtDay={onAddTaskAtDay}
            compact
            controllerRef={ganttCtl}
            rowHeight={dims?.row}
            headerHeight={dims?.header}
            barHeight={dims?.bar}
            hideToolbar={proCanvas || undefined}
            onVerticalScroll={isDesktop && proCanvas ? onGanttScroll : undefined}
            verticalScrollRef={isDesktop && proCanvas ? ganttVRef : undefined}
            preview={preview ?? undefined}
          />
        </View>
        {isDesktop && panes.paneMode === 'dock' ? (
          // The docked pane's slot: the screen draws its pane over it.
          <View style={{ width: panes.pane }} testID="gantt-pane-slot" />
        ) : null}
      </View>
    );
  })();

  return (
    <View
      style={styles.nonPhoneRoot}
      onLayout={isDesktop ? onRowLayout : undefined}
      testID={isDesktop ? 'gantt-tab-root' : undefined}
    >
      {proCanvas ? null : (
      <View style={styles.layoutBar}>
        {(['split', 'gantt', 'lanes', 'living'] as GanttPaneMode[]).map(m => (
          <Pressable
            key={m}
            onPress={() => setLayout(m)}
            style={[styles.layoutBtn, layout === m && styles.layoutBtnActive]}
            hitSlop={4}
          >
            <Text style={[styles.layoutBtnText, layout === m && styles.layoutBtnTextActive]}>
              {LAYOUT_LABEL[m]}
            </Text>
          </Pressable>
        ))}
      </View>
      )}
      {body}
    </View>
  );
});

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  nonPhoneRoot: { flex: 1 },
  // Local layout segmented control — mirrors the retired top-toolbar pane
  // toggle (schedule-pro PaneBtn) so the Timeline tab now owns all five modes.
  layoutBar: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.sm,
    padding: 2,
    margin: 12,
  },
  layoutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.xs,
  },
  layoutBtnActive: {
    backgroundColor: t.surface,
  },
  layoutBtnText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: t.textSecondary,
  },
  layoutBtnTextActive: {
    // accentLabel, not accent: this is a caption-size LABEL on t.surface, where
    // the brand #FF6A1A measures 2.87:1.
    color: t.accentLabel,
  },
  row: { flex: 1, flexDirection: 'row' },
  // Used for the 'gantt' layout (single full-width child).
  full: { flex: 1 },
  grid: {
    width: TABLET_GRID_SHARE,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: t.line,
  },
  // The desktop split's draggable divider: 8 px of hit area (SPLIT_DIVIDER),
  // a 1 px line, the col-resize cursor.
  splitDivider: {
    width: SPLIT_DIVIDER,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'col-resize' } as object) : {}),
  },
  dividerLine: {
    flex: 1,
    width: StyleSheet.hairlineWidth,
    backgroundColor: t.line,
  },
  gantt: { flex: 1 },
  phoneRoot: { flex: 1 },
  // `bottom` is set inline via useSafeAreaInsets() so the FAB clears both
  // the home indicator and the safe-area-aware PhoneTabBar above it.
  fab: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.tradeColors.general,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 10,
  },
  fabIcon: {
    fontSize: 26,
    lineHeight: 28,
    fontWeight: '300',
    color: '#0B0D10',
  },
});
