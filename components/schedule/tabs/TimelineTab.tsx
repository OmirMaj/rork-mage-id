// components/schedule/tabs/TimelineTab.tsx — Phase 27 (real impl).
//
// Slim, full-width Gantt without the editing grid. Same InteractiveGantt
// component as the main Gantt tab, but rendered alone (no GridPane sibling
// to share width with) and in `compact` mode so the task-name gutter
// disappears — leaving a one-page timeline suitable for owner/stakeholder
// sharing or print.
//
// Why this isn't just a `<GanttTab paneMode="gantt" />` wrapper: that
// path keeps the full per-task gutter (task names inline on each bar
// row). Timeline is intentionally stripped further — `compact` hides the
// gutter entirely so the bars themselves are the whole story. Two
// different stakeholder needs:
//   - Gantt tab → the PM editing the plan
//   - Timeline tab → the owner looking at a one-pager

import { View, StyleSheet } from 'react-native';
import InteractiveGanttDefault from '../InteractiveGantt';
import { useScheduler } from '../SchedulerContext';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';

interface TimelineTabProps {
  projectStartDate: Date;
  cpm: CpmResult;
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  focusedTaskId?: string | null;
  onFocusTask?: (id: string | null) => void;
}

export function TimelineTab({
  projectStartDate,
  cpm,
  onEdit,
  focusedTaskId,
  onFocusTask,
}: TimelineTabProps) {
  const { tasks } = useScheduler();
  return (
    <View style={styles.root}>
      <InteractiveGanttDefault
        tasks={tasks as ScheduleTask[]}
        cpm={cpm}
        projectStartDate={projectStartDate}
        onEdit={onEdit}
        focusedTaskId={focusedTaskId}
        onFocusTask={onFocusTask}
        compact
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
});
