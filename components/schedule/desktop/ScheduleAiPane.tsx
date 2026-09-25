// components/schedule/desktop/ScheduleAiPane.tsx — Schedule Pro's docked
// Change / Ask / Task pane on a desktop browser (wave 6c, lane DB).
//
// WHY. "The scheduler does not work well." On the founder's 1512 × 945
// MacBook Schedule Pro had THREE things that opened over the Gantt: the AI
// drawer (a scrim over everything), the "Tell me what to change" sheet (82 %
// of the window) and the task inspector (a 340 px column squeezed in beside
// the tab shell). He could not see the schedule while asking about it, which
// is the whole point of asking. Now they are the three tabs of one
// SidePanel on the right:
//
//   Change  the schedule editor (ScheduleEditPanel, docked — no Modal). Its
//           review hands the proposal up (onPreview) and the Gantt draws it as
//           dashed "proposed" bars BEFORE Apply.
//   Ask     the AI assistant (AIAssistantPanel, embedded): questions, risks,
//           optimise, as-built, generate.
//   Task    the focused task's detail (TaskInspector, embedded) — only while a
//           task is focused.
//
// GEOMETRY (lane DA's contract). GanttTab measures the whole work row W. When
// W ≥ PANE_DOCK_MIN (1288) its split view stops PANE (440) px short and leaves
// an empty slot on the right (testID gantt-pane-slot): this pane is drawn OVER
// that slot (absolute, right 0), so the shell is never narrowed twice. In the
// other views (Gantt-only, List, Board, …) there is no slot and the pane docks
// as the row's right-hand sibling. Below 1288 it overlays the timeline with no
// scrim (SidePanel's overlayBelow).
//
// Keys: the SidePanel's own Esc closes it (page scope). No onToggle: Cmd+J
// belongs to the screen, which focuses its command field instead.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { SidePanel, type SidePanelTab } from '@/components/desktop/SidePanel';
import ScheduleEditPanel from '@/components/copilot/ScheduleEditPanel';
import AIAssistantPanel, { type AIAssistantPanelProps } from '@/components/schedule/AIAssistantPanel';
import TaskInspector from '@/components/schedule/TaskInspector';
import { Layout } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { PANE, PANE_DOCK_MIN } from '@/utils/scheduleProLayout';
import type { SchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';
import type { CommitOutcome } from '@/utils/copilot/types';
import type { RunCpmOptions, CpmResult } from '@/utils/cpm';
import type { ScheduleTask } from '@/types';

export type SchedulePaneTab = 'change' | 'ask' | 'task';

/** The pane's tabs: Task only while a task is focused. Pure. */
export function schedulePaneTabs(hasTask: boolean): SidePanelTab[] {
  const tabs: SidePanelTab[] = [
    { key: 'change', label: 'Change' },
    { key: 'ask', label: 'Ask' },
  ];
  if (hasTask) tabs.push({ key: 'task', label: 'Task' });
  return tabs;
}

/** Selecting a task opens the pane on Task ONLY when the pane is closed or
 *  already on Task — an AI review in flight on Change / Ask is never yanked
 *  away by a click on the Gantt. Pure. */
export function paneTabOnTaskSelect(paneOpen: boolean, tab: SchedulePaneTab): SchedulePaneTab | null {
  if (!paneOpen || tab === 'task') return 'task';
  return null;
}

export interface ScheduleAiPaneProps {
  open: boolean;
  tab: SchedulePaneTab;
  onTabChange: (tab: SchedulePaneTab) => void;
  onClose: () => void;
  /** The work row's measured width (W): docks at ≥ PANE_DOCK_MIN, overlays below. */
  containerWidth: number;
  /** Draw over GanttTab's empty pane slot (the split view, docked). */
  overSlot: boolean;

  // ── Change ──
  /** Bumped on every open: a fresh editor (and a retry after a refused open). */
  editNonce: number;
  projectId: string;
  tasks: ScheduleTask[];
  commit: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => CommitOutcome;
  cpmOptions: RunCpmOptions;
  seed?: string;
  autoSubmitSeed?: string;
  onPreview: (overlay: SchedulePreviewOverlay | null) => void;

  // ── Ask ──
  assistant: Omit<AIAssistantPanelProps, 'visible' | 'embedded'>;

  // ── Task ──
  focusedTask: ScheduleTask | null;
  allTasks: ScheduleTask[];
  cpm: CpmResult;
  projectStartDate: Date;
  onEditTask: (taskId: string, patch: Partial<ScheduleTask>) => void;
  onCloseTask: () => void;
}

export function ScheduleAiPane(p: ScheduleAiPaneProps) {
  const styles = useThemedStyles(makeStyles);
  const hasTask = !!p.focusedTask;
  const tab: SchedulePaneTab = p.tab === 'task' && !hasTask ? 'change' : p.tab;

  // Change and Ask stay mounted once visited (display:none while the other
  // tab is up), so switching to Ask never throws away a review in flight.
  // Everything unmounts when the pane closes (SidePanel renders nothing).
  const [visited, setVisited] = useState<Record<SchedulePaneTab, boolean>>({ change: false, ask: false, task: false });
  useEffect(() => {
    if (!p.open) { setVisited({ change: false, ask: false, task: false }); return; }
    setVisited((v) => (v[tab] ? v : { ...v, [tab]: true }));
  }, [p.open, tab]);

  const slotStyle: ViewStyle | null = p.overSlot ? styles.overSlot : null;
  const onTab = (key: string) => p.onTabChange(key as SchedulePaneTab);

  return (
    <SidePanel
      open={p.open}
      onClose={p.onClose}
      title="Schedule assistant"
      panelId="schedule-pro-ai"
      tabs={schedulePaneTabs(hasTask)}
      activeTab={tab}
      onTabChange={onTab}
      scroll={false}
      containerWidth={p.containerWidth}
      overlayBelow={PANE_DOCK_MIN}
      style={slotStyle}
      printHide
      testID="schedule-pro-pane"
    >
      {visited.change || tab === 'change' ? (
        <View style={[styles.tabBody, tab !== 'change' && styles.hidden]} testID="schedule-pane-change">
          <ScheduleEditPanel
            key={p.editNonce}
            presentation="docked"
            visible
            onClose={p.onClose}
            projectId={p.projectId}
            tasks={p.tasks}
            commit={p.commit}
            cpmOptions={p.cpmOptions}
            seed={p.seed}
            autoSubmitSeed={p.autoSubmitSeed}
            onPreview={p.onPreview}
            hasToolbarUndo
          />
        </View>
      ) : null}
      {visited.ask || tab === 'ask' ? (
        <View style={[styles.tabBody, tab !== 'ask' && styles.hidden]} testID="schedule-pane-ask">
          <AIAssistantPanel {...p.assistant} visible embedded />
        </View>
      ) : null}
      {tab === 'task' ? (
        <View style={styles.tabBody} testID="schedule-pane-task">
          {p.focusedTask ? (
            <TaskInspector
              task={p.focusedTask}
              allTasks={p.allTasks}
              cpm={p.cpm}
              projectStartDate={p.projectStartDate}
              onClose={p.onCloseTask}
              onEdit={p.onEditTask}
              embedded
            />
          ) : (
            <Text style={styles.hint}>Click a bar or a row to see that task here.</Text>
          )}
        </View>
      ) : null}
    </SidePanel>
  );
}

export { PANE };

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  // Over GanttTab's 440 px slot: the same width, flush right, full height.
  overSlot: { position: 'absolute', top: 0, right: 0, bottom: 0, width: PANE },
  tabBody: { flex: 1 },
  hidden: { display: 'none' },
  hint: { ...Type.footnote, color: t.textSecondary, padding: Layout.cardPad },
});
