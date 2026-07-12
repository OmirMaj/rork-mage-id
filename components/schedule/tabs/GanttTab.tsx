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

import { useState, type ReactNode } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GridPaneDefault from '../GridPane';
import InteractiveGanttDefault from '../InteractiveGantt';
import { useScheduler } from '../SchedulerContext';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useResponsive } from '@/utils/useResponsive';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';

export type GanttPaneMode = 'split' | 'gantt' | 'lanes' | 'living';

const LAYOUT_LABEL: Record<GanttPaneMode, string> = {
  split: 'Split',
  gantt: 'Gantt',
  lanes: 'Lanes',
  living: 'Living Plan',
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
}

export function GanttTab({
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
}: GanttTabProps) {
  const { tasks } = useScheduler();
  const { bp } = useResponsive();
  const insets = useSafeAreaInsets();
  const [layout, setLayout] = useState<GanttPaneMode>(initialLayout ?? 'split');

  if (bp === 'phone') {
    return (
      <View style={styles.phoneRoot}>
        <InteractiveGanttDefault
          tasks={tasks as ScheduleTask[]}
          cpm={cpm}
          projectStartDate={projectStartDate}
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
          style={[styles.fab, { bottom: insets.bottom + 70 }]}
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
            onEdit={onEdit}
            onDeleteTask={onDeleteTask}
            onOutline={onOutline}
            onReorder={onReorder}
            onDependencyCreate={onDependencyCreate}
            focusedTaskId={focusedTaskId}
            onFocusTask={onFocusTask}
            onAddTaskAtDay={onAddTaskAtDay}
          />
        </View>
      );
    }

    // 'split' — the default. Grid on the left, Gantt on the right.
    return (
      <View style={styles.row}>
        <View style={styles.grid}>
          <GridPaneDefault
            tasks={tasks as ScheduleTask[]}
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
          />
        </View>
        <View style={styles.gantt}>
          <InteractiveGanttDefault
            tasks={tasks as ScheduleTask[]}
            cpm={cpm}
            projectStartDate={projectStartDate}
            onEdit={onEdit}
            onDeleteTask={onDeleteTask}
            onOutline={onOutline}
            onReorder={onReorder}
            onDependencyCreate={onDependencyCreate}
            focusedTaskId={focusedTaskId}
            onFocusTask={onFocusTask}
            onAddTaskAtDay={onAddTaskAtDay}
            compact
          />
        </View>
      </View>
    );
  })();

  return (
    <View style={styles.nonPhoneRoot}>
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
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  nonPhoneRoot: { flex: 1 },
  // Local layout segmented control — mirrors the retired top-toolbar pane
  // toggle (schedule-pro PaneBtn) so the Timeline tab now owns all five modes.
  layoutBar: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceAlt,
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
    backgroundColor: Colors.surface,
  },
  layoutBtnText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  layoutBtnTextActive: {
    color: Colors.accent,
  },
  row: { flex: 1, flexDirection: 'row' },
  // Used for the 'gantt' layout (single full-width child).
  full: { flex: 1 },
  grid: {
    width: '38%',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.border,
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
