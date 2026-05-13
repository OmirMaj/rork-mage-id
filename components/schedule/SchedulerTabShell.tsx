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
//
// Phone fallback (bp === 'phone') moves the tab bar to the BOTTOM with 4
// visible tabs (Gantt · Board · Dash · More). "More" opens a sheet for the
// remaining tabs (List, Calendar, Workload, Timeline). iOS convention.

import { useState, useEffect, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { SchedulerProvider, type CpmResult as ContextCpmResult } from './SchedulerContext';
import { SchedulerHeader } from './SchedulerHeader';
import { GanttTab, type GanttPaneMode } from './tabs/GanttTab';
import { BoardTab } from './tabs/BoardTab';
import { DashboardTab } from './tabs/DashboardTab';
import { TabComingSoon } from './tabs/TabComingSoon';
import { ListTab } from './tabs/ListTab';
import { WorkloadTab } from './tabs/WorkloadTab';
import { useResponsive } from '@/utils/useResponsive';
import type { ProjectSchedule, ScheduleTask, ProjectResource } from '@/types';
import type { CpmResult as UtilsCpmResult } from '@/utils/cpm';

export type SchedulerTabKey =
  | 'gantt'
  | 'board'
  | 'list'
  | 'calendar'
  | 'workload'
  | 'dashboard';

// Timeline tab was retired — it duplicated the Gantt tab's slim-mode
// rendering and didn't earn its slot in the tab strip. If a one-page
// stakeholder view is needed later, surface it through Export instead.
const TABS: { key: SchedulerTabKey; label: string; soon?: boolean }[] = [
  { key: 'gantt',     label: 'Gantt' },
  { key: 'board',     label: 'Board' },
  { key: 'list',      label: 'List' },
  { key: 'calendar',  label: 'Calendar',  soon: true },
  { key: 'workload',  label: 'Workload' },
  { key: 'dashboard', label: 'Dashboard' },
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

  // ---- Externally-controlled sub-mode for the Gantt tab ----
  /**
   * Driven by the top-toolbar Grid/Split/Gantt buttons in schedule-pro.
   * When set, the shell forces the active tab to 'gantt' and passes this
   * sub-mode down so the GanttTab swaps between full-grid / split /
   * full-gantt rendering. Other tabs (Board, List, Dashboard, etc.)
   * ignore this prop.
   */
  ganttPaneMode?: GanttPaneMode;
  /** Bumped by the parent whenever a paneMode button is pressed, so we can
   *  re-force the active tab to 'gantt' even if the user navigated away. */
  paneModeNonce?: number;

  // ---- GanttTab pass-through props (owned by schedule-pro) ----
  projectStartDate: Date;
  workingDaysPerWeek: number;
  nonWorkingDates?: string[];
  /** Full CpmResult from utils/cpm — needed by GridPane/InteractiveGantt. */
  utilsCpm: UtilsCpmResult;
  /** Resource pool — feeds WorkloadTab (and ResourceSwimlanes when wired). */
  resources?: ProjectResource[];
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
  const { bp } = useResponsive();
  const [active, setActive] = useState<SchedulerTabKey>('gantt');

  // When the parent toggles a paneMode button (Grid/Split/Gantt in the top
  // toolbar), bump the nonce — that forces the Gantt tab to be active so
  // the user sees the sub-mode change even if they were on Board / List /
  // Dashboard at the time. We don't want to keep forcing it on every render,
  // so the effect keys on the nonce, not the paneMode value itself.
  useEffect(() => {
    if (props.paneModeNonce !== undefined) {
      setActive('gantt');
    }
  }, [props.paneModeNonce]);

  if (bp === 'phone') {
    return (
      <SchedulerProvider schedule={props.schedule} cpm={props.contextCpm}>
        <View style={styles.shellRoot}>
          <SchedulerHeader
            projectName={props.projectName}
            onExportPress={props.onExportPress}
            onBaselinePress={props.onBaselinePress}
          />
          <View style={styles.body}>
            {renderTab(active, props)}
          </View>
          <PhoneTabBar active={active} onChange={setActive} />
        </View>
      </SchedulerProvider>
    );
  }

  return (
    <SchedulerProvider schedule={props.schedule} cpm={props.contextCpm}>
      <View style={styles.shellRoot}>
        {/* Desktop: no standalone tab strip — the tabs render inline in the
            SchedulerHeader's right side, between KPIs and BASELINE/VIEW/
            Export. Phone keeps the bottom bar (see the bp === 'phone' branch
            above). */}
        <SchedulerHeader
          projectName={props.projectName}
          onExportPress={props.onExportPress}
          onBaselinePress={props.onBaselinePress}
          tabs={TABS}
          activeTab={active}
          onTabChange={(k) => setActive(k as SchedulerTabKey)}
        />

        <View style={styles.body}>
          {renderTab(active, props)}
        </View>
      </View>
    </SchedulerProvider>
  );
}

interface PhoneTabBarProps {
  active: SchedulerTabKey;
  onChange: (k: SchedulerTabKey) => void;
}

function PhoneTabBar({ active, onChange }: PhoneTabBarProps) {
  const insets = useSafeAreaInsets();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const VISIBLE: { key: SchedulerTabKey; icon: string; label: string }[] = [
    { key: 'gantt',     icon: '⬚', label: 'Gantt' },
    { key: 'board',     icon: '⊞', label: 'Board' },
    { key: 'dashboard', icon: '◐', label: 'Dash' },
  ];
  const OVERFLOW: SchedulerTabKey[] = ['list', 'calendar', 'workload'];
  const isOverflowActive = OVERFLOW.includes(active);

  return (
    <View style={[styles.bottomTabBar, { paddingBottom: insets.bottom + 6 }]}>
      {VISIBLE.map(t => {
        const isActive = active === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={styles.bottomTab}
            hitSlop={4}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.bottomTabIcon, isActive && styles.bottomTabActive]}>{t.icon}</Text>
            <Text style={[styles.bottomTabLabel, isActive && styles.bottomTabActive]}>{t.label}</Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => setOverflowOpen(true)}
        style={styles.bottomTab}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel="More tabs"
        accessibilityState={{ selected: isOverflowActive }}
      >
        <Text style={[styles.bottomTabIcon, isOverflowActive && styles.bottomTabActive]}>⋯</Text>
        <Text style={[styles.bottomTabLabel, isOverflowActive && styles.bottomTabActive]}>More</Text>
      </Pressable>
      <Modal
        visible={overflowOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setOverflowOpen(false)}
      >
        <Pressable style={styles.overflowBackdrop} onPress={() => setOverflowOpen(false)} />
        <View style={[styles.overflowSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.overflowHandle} />
          {OVERFLOW.map(k => {
            const tabMeta = TABS.find(t => t.key === k);
            if (!tabMeta) return null;
            return (
              <Pressable
                key={k}
                onPress={() => { onChange(k); setOverflowOpen(false); }}
                style={styles.overflowItem}
                accessibilityRole="button"
                accessibilityLabel={tabMeta.label}
                accessibilityState={{ selected: active === k }}
              >
                <Text style={[styles.overflowText, active === k && styles.bottomTabActive]}>
                  {tabMeta.label}{tabMeta.soon ? ' · soon' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
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
        paneMode={props.ganttPaneMode ?? 'split'}
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

  if (key === 'list') {
    return (
      <ListTab
        projectStartDate={props.projectStartDate}
        workingDaysPerWeek={props.workingDaysPerWeek}
        nonWorkingDates={props.nonWorkingDates}
        onEdit={props.onEdit}
        onAddTask={props.onAddTask}
        onDeleteTask={props.onDeleteTask}
        focusedTaskId={props.focusedTaskId}
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

  if (key === 'board') {
    return <BoardTab />;
  }

  if (key === 'calendar') {
    return (
      <TabComingSoon
        tabName="Calendar"
        eventKey="scheduler_calendar_tab"
        tagline="Month view with tasks plotted on dates. Drag to reschedule."
        previewMock={<CalendarPreviewMock />}
      />
    );
  }

  if (key === 'workload') {
    return <WorkloadTab resources={props.resources} />;
  }

  if (key === 'dashboard') {
    return <DashboardTab />;
  }

  // list, handled in later tasks — generic placeholder for now
  return (
    <View style={styles.comingSoon}>
      <Text style={styles.comingSoonTitle}>Coming soon</Text>
      <Text style={styles.comingSoonSub}>
        This tab ships next week. The Gantt tab is your current home.
      </Text>
    </View>
  );
}

function CalendarPreviewMock() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
      {Array.from({ length: 21 }).map((_, i) => (
        <View key={i} style={{ width: 30, height: 30, backgroundColor: Colors.surface, borderRadius: 4 }}>
          {(i % 5 === 0 || i % 7 === 0) && (
            <View style={{ position: 'absolute', bottom: 2, left: 2, width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.tradeColors.general }} />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // The single flex:1 column wrapper around the tab-bar + header + body.
  // Without this, SchedulerProvider (a pure Context.Provider with no View
  // of its own) leaks its 3 children as direct siblings of whatever flex-row
  // container the shell is mounted into — they compete for horizontal space
  // and the body collapses to whatever the tab bar + header didn't claim.
  shellRoot: { flex: 1 },
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

  // ---- Phone bottom tab bar ----
  // paddingBottom is set inline via useSafeAreaInsets() in PhoneTabBar so the
  // home indicator on iPhone X+ doesn't overlap tab labels.
  bottomTabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
  },
  bottomTab: { flex: 1, alignItems: 'center', paddingVertical: 4, gap: 2 },
  bottomTabIcon: { fontSize: 17, color: Colors.textSecondary },
  bottomTabLabel: { fontSize: 8, color: Colors.textSecondary, fontWeight: '600' },
  bottomTabActive: { color: Colors.tradeColors.general },
  overflowBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  // paddingBottom is set inline via useSafeAreaInsets() in PhoneTabBar.
  overflowSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
  },
  overflowHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.fillTertiary,
    marginBottom: 12,
  },
  overflowItem: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(31,37,45,0.6)',
  },
  overflowText: { color: Colors.text, fontSize: 14, fontWeight: '500' },
});
