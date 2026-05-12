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

import { View, StyleSheet } from 'react-native';
import GridPaneDefault from '../GridPane';
import InteractiveGanttDefault from '../InteractiveGantt';
import { useScheduler } from '../SchedulerContext';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';

export interface GanttTabProps {
  /** Propagated from schedule-pro — feeds GridPane + InteractiveGantt. */
  projectStartDate: Date;
  workingDaysPerWeek: number;
  nonWorkingDates?: string[];
  /** CPM result from utils/cpm (not SchedulerContext.CpmResult). */
  cpm: CpmResult;
  /** Callback wired to schedule-pro's undo-aware commit. */
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  onAddTask: () => void;
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
  onEdit,
  onAddTask,
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
          compact
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  grid: {
    width: '38%',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.border,
  },
  gantt: { flex: 1 },
});
