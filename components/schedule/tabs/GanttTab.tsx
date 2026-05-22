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

import { View, StyleSheet, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GridPaneDefault from '../GridPane';
import InteractiveGanttDefault from '../InteractiveGantt';
import { useScheduler } from '../SchedulerContext';
import { Colors } from '@/constants/colors';
import { useResponsive } from '@/utils/useResponsive';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';

export type GanttPaneMode = 'grid' | 'split' | 'gantt';

export interface GanttTabProps {
  /** Propagated from schedule-pro — feeds GridPane + InteractiveGantt. */
  projectStartDate: Date;
  workingDaysPerWeek: number;
  nonWorkingDates?: string[];
  /** CPM result from utils/cpm (not SchedulerContext.CpmResult). */
  cpm: CpmResult;
  /**
   * Which sub-view to show in the Gantt tab.
   *   - 'grid'  → full-width GridPane only (table view)
   *   - 'split' → GridPane + InteractiveGantt side-by-side (default)
   *   - 'gantt' → full-width InteractiveGantt only (timeline view)
   * Driven by the top-toolbar paneMode buttons in schedule-pro.
   */
  paneMode?: GanttPaneMode;
  /** Callback wired to schedule-pro's undo-aware commit. */
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  onAddTask: () => void;
  /** Passed through to InteractiveGantt for double-tap-empty-timeline flow. */
  onAddTaskAtDay?: (dayNumber: number) => void;
  onDeleteTask: (taskId: string) => void;
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
  paneMode = 'split',
  onEdit,
  onAddTask,
  onAddTaskAtDay,
  onDeleteTask,
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

  if (bp === 'phone') {
    return (
      <View style={styles.phoneRoot}>
        <InteractiveGanttDefault
          tasks={tasks as ScheduleTask[]}
          cpm={cpm}
          projectStartDate={projectStartDate}
          onEdit={onEdit}
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

  if (paneMode === 'grid') {
    return (
      <View style={styles.full}>
        <GridPaneDefault
          tasks={tasks as ScheduleTask[]}
          projectStartDate={projectStartDate}
          workingDaysPerWeek={workingDaysPerWeek}
          nonWorkingDates={nonWorkingDates}
          focusedTaskId={focusedTaskId}
          onEdit={onEdit}
          onAddTask={onAddTask}
          onDeleteTask={onDeleteTask}
          selectedIds={selectedIds}
          onSelectionChange={onSelectionChange}
          onBulkDelete={onBulkDelete}
          onBulkDuplicate={onBulkDuplicate}
          onBulkShiftDays={onBulkShiftDays}
          onBulkSetPhase={onBulkSetPhase}
          onBulkSetCrew={onBulkSetCrew}
          onBulkAskAI={onBulkAskAI}
          showExtendedColumns
        />
      </View>
    );
  }

  if (paneMode === 'gantt') {
    return (
      <View style={styles.full}>
        <InteractiveGanttDefault
          tasks={tasks as ScheduleTask[]}
          cpm={cpm}
          projectStartDate={projectStartDate}
          onEdit={onEdit}
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
          onDeleteTask={onDeleteTask}
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
          onDependencyCreate={onDependencyCreate}
          focusedTaskId={focusedTaskId}
          onFocusTask={onFocusTask}
          onAddTaskAtDay={onAddTaskAtDay}
          compact
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  // Used for paneMode 'grid' and 'gantt' (single full-width child).
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
