// components/schedule/SchedulerTabShell.tsx — Phase 27.
//
// 7-tab nav at the top + SchedulerHeader below + the active tab's content.
// Wraps everything in SchedulerProvider so each tab can pull from
// useScheduler() instead of receiving 12 props.
//
// Props the shell passes through to GanttTab are the ones owned by
// schedule-pro (callbacks, derived CPM from utils/cpm, projectStartDate,
// etc.). They live at the screen level so the undo stack / persist
// debounce stays in one place.

import { useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { SchedulerProvider, type CpmResult as ContextCpmResult } from './SchedulerContext';
import { SchedulerHeader } from './SchedulerHeader';
import { GanttTab } from './tabs/GanttTab';
import type { ProjectSchedule, ScheduleTask } from '@/types';
import type { CpmResult as UtilsCpmResult } from '@/utils/cpm';

export type SchedulerTabKey =
  | 'gantt'
  | 'board'
  | 'list'
  | 'calendar'
  | 'workload'
  | 'dashboard'
  | 'timeline';

const TABS: { key: SchedulerTabKey; label: string; soon?: boolean }[] = [
  { key: 'gantt',     label: 'Gantt' },
  { key: 'board',     label: 'Board',     soon: true },
  { key: 'list',      label: 'List',      soon: true },
  { key: 'calendar',  label: 'Calendar',  soon: true },
  { key: 'workload',  label: 'Workload',  soon: true },
  { key: 'dashboard', label: 'Dashboard', soon: true },
  { key: 'timeline',  label: 'Timeline',  soon: true },
];

export interface SchedulerTabShellProps {
  // ---- Context-level props (fed into SchedulerProvider) ----
  schedule: ProjectSchedule;
  /** SchedulerContext-shaped KPI summary (criticalPathDays, slipDaysVsBaseline, criticalTaskIds). */
  contextCpm: ContextCpmResult;

  // ---- Header props ----
  projectName: string;
  onExportPress: () => void;
  onBaselinePress: () => void;

  // ---- GanttTab pass-through props (owned by schedule-pro) ----
  projectStartDate: Date;
  workingDaysPerWeek: number;
  nonWorkingDates?: string[];
  /** Full CpmResult from utils/cpm — needed by GridPane/InteractiveGantt. */
  utilsCpm: UtilsCpmResult;
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

export function SchedulerTabShell(props: SchedulerTabShellProps) {
  useTheme();
  const [active, setActive] = useState<SchedulerTabKey>('gantt');

  return (
    <SchedulerProvider schedule={props.schedule} cpm={props.contextCpm}>
      {/* Tab bar — horizontal scroll so it never wraps on narrow screens. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBar}
        style={styles.tabBarOuter}
      >
        {TABS.map(t => (
          <Pressable
            key={t.key}
            onPress={() => setActive(t.key)}
            style={styles.tab}
            hitSlop={4}
          >
            <Text style={[styles.tabLabel, active === t.key && styles.tabLabelActive]}>
              {t.label}{t.soon ? ' · soon' : ''}
            </Text>
            {active === t.key && <View style={styles.tabIndicator} />}
          </Pressable>
        ))}
      </ScrollView>

      <SchedulerHeader
        projectName={props.projectName}
        onExportPress={props.onExportPress}
        onBaselinePress={props.onBaselinePress}
      />

      <View style={styles.body}>
        {renderTab(active, props)}
      </View>
    </SchedulerProvider>
  );
}

function renderTab(key: SchedulerTabKey, props: SchedulerTabShellProps): ReactNode {
  if (key === 'gantt') {
    return (
      <GanttTab
        projectStartDate={props.projectStartDate}
        workingDaysPerWeek={props.workingDaysPerWeek}
        nonWorkingDates={props.nonWorkingDates}
        cpm={props.utilsCpm}
        onEdit={props.onEdit}
        onAddTask={props.onAddTask}
        onDeleteTask={props.onDeleteTask}
        onDependencyCreate={props.onDependencyCreate}
        focusedTaskId={props.focusedTaskId}
        onFocusTask={props.onFocusTask}
        selectedIds={props.selectedIds}
        onSelectionChange={props.onSelectionChange}
        onBulkDelete={props.onBulkDelete}
        onBulkDuplicate={props.onBulkDuplicate}
        onBulkShiftDays={props.onBulkShiftDays}
        onBulkSetPhase={props.onBulkSetPhase}
        onBulkSetCrew={props.onBulkSetCrew}
        onBulkAskAI={props.onBulkAskAI}
      />
    );
  }

  return (
    <View style={styles.comingSoon}>
      <Text style={styles.comingSoonTitle}>Coming soon</Text>
      <Text style={styles.comingSoonSub}>
        This tab ships next week. The Gantt tab is your current home.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBarOuter: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
    flexGrow: 0,
  },
  tabBar: {
    paddingHorizontal: 16,
    gap: 18,
    flexDirection: 'row',
  },
  tab: { paddingVertical: 12, position: 'relative' },
  tabLabel: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: Colors.tradeColors.general,
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.tradeColors.general,
  },
  body: { flex: 1 },
  comingSoon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  comingSoonTitle: {
    fontSize: Type.subheadline.fontSize,
    color: Colors.text,
    fontWeight: '700',
  },
  comingSoonSub: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 280,
  },
});
