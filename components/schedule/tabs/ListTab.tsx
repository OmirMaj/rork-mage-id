// components/schedule/tabs/ListTab.tsx — Phase 27.
//
// Full-width GridPane variant. Same component as the Gantt tab's grid
// pane, but rendered alone (no Gantt chart) with extended columns
// (Float, Resources, Phase) that don't fit in the narrower Gantt-mode
// layout.
//
// Prop choice: GridPane's projectStartDate, workingDaysPerWeek, and
// the edit callbacks are required and not stored in SchedulerContext
// (they live in schedule-pro to keep the undo stack co-located with
// the data). ListTab accepts them as direct props, mirroring GanttTab's
// approach.

import { View, StyleSheet } from 'react-native';
import GridPaneDefault from '../GridPane';
import { useScheduler } from '../SchedulerContext';
import type { ScheduleTask } from '@/types';

export interface ListTabProps {
  projectStartDate: Date;
  workingDaysPerWeek: number;
  nonWorkingDates?: string[];
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  onAddTask: () => void;
  onDeleteTask: (taskId: string) => void;
  focusedTaskId?: string | null;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onBulkDelete?: (ids: string[]) => void;
  onBulkDuplicate?: (ids: string[]) => void;
  onBulkShiftDays?: (ids: string[], days: number) => void;
  onBulkSetPhase?: (ids: string[], phase: string) => void;
  onBulkSetCrew?: (ids: string[], crew: string) => void;
  onBulkAskAI?: (ids: string[]) => void;
}

export function ListTab({
  projectStartDate,
  workingDaysPerWeek,
  nonWorkingDates,
  onEdit,
  onAddTask,
  onDeleteTask,
  focusedTaskId,
  selectedIds,
  onSelectionChange,
  onBulkDelete,
  onBulkDuplicate,
  onBulkShiftDays,
  onBulkSetPhase,
  onBulkSetCrew,
  onBulkAskAI,
}: ListTabProps) {
  const { tasks } = useScheduler();

  return (
    <View style={styles.root}>
      <GridPaneDefault
        tasks={tasks as ScheduleTask[]}
        projectStartDate={projectStartDate}
        workingDaysPerWeek={workingDaysPerWeek}
        nonWorkingDates={nonWorkingDates}
        onEdit={onEdit}
        onAddTask={onAddTask}
        onDeleteTask={onDeleteTask}
        focusedTaskId={focusedTaskId}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
});
