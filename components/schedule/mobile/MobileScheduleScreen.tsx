import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Bell, Check, ChevronDown, FolderOpen, CalendarDays, Download, FileInput, Mic, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useProjects } from '@/contexts/ProjectContext';
import type { Project, ScheduleTask } from '@/types';
import { buildScheduleFromTasks, mergeEditedSchedule, createId } from '@/utils/scheduleEngine';
import { stampActuals, todayScheduleDay } from '@/utils/pace/stampActuals';
import { recordDidForYou } from '@/utils/brain/didForYou';
import { runCpm } from '@/utils/cpm';
import EmptyState from '@/components/EmptyState';
import { AddTaskModal, type NewTaskValues } from '@/components/schedule/AddTaskModal';
import { WeekStrip } from './WeekStrip';
import { MobileGantt } from './MobileGantt';
import { MobileScheduleList } from './MobileScheduleList';
import { TaskDetailSheet } from './TaskDetailSheet';
import { MonthCalendarSheet } from './MonthCalendarSheet';
import { ExportCenterSheet } from './ExportCenterSheet';
import { exportScheduleIcal } from '@/utils/scheduleExportIcal';
import { ProgressTab } from './ProgressTab';
import { TeamTab } from './TeamTab';
import { FourDComingSoon } from './FourDComingSoon';
import { LivingFloorPlan } from './LivingFloorPlan';
import { PlanZoneEditor } from './PlanZoneEditor';
import { displayText } from '@/utils/formatters';

type SubTab = 'schedule' | '4d' | 'progress' | 'team';
const MS_DAY = 24 * 60 * 60 * 1000;
const SUBTABS: [SubTab, string][] = [['schedule', 'Schedule'], ['4d', '4D Model'], ['progress', 'Progress'], ['team', 'Team']];

// Mobile-native "Schedule Pro" — touch-first gantt + task-detail sheet +
// sub-tabs, rendered on phones (web/tablet keep the desktop schedule screen).
export function MobileScheduleScreen({ consumedFocusRef: sharedFocusRef }: { consumedFocusRef?: React.MutableRefObject<string | null> } = {}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    projects,
    updateProject,
    getPlanSheetsForProject,
  } = useProjects();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.id ?? null);

  // Honor a projectId passed by callers (e.g. project-detail's "Open Full
  // Schedule") — without this the tab keeps whichever project was last
  // active here, which reads as "my schedule vanished" (P0 sim-audit bug).
  // The `focus` nonce distinguishes a fresh navigation from the tab's sticky
  // params: each arrival mints a new nonce, so re-opening from the same
  // project re-applies, while plain tab presses (stale nonce) never yank the
  // selection away from a project the user cycled to manually.
  const { projectId: routeProjectId, focus: routeFocus } =
    useLocalSearchParams<{ projectId?: string; focus?: string }>();
  // Shared with the desktop sibling via the parent wrapper so a nonce already
  // consumed on one surface stays consumed after a breakpoint remount — a
  // fresh local ref would re-yank a manually-cycled project back to the CTA's
  // projectId. Falls back to a local ref if rendered standalone.
  const localFocusRef = useRef<string | null>(null);
  const consumedFocusRef = sharedFocusRef ?? localFocusRef;
  useEffect(() => {
    if (!routeProjectId) return;
    const nonce = `${routeProjectId}:${routeFocus ?? ''}`;
    if (consumedFocusRef.current === nonce) return;
    if (!projects.some((p) => p.id === routeProjectId)) return;
    consumedFocusRef.current = nonce;
    setSelectedProjectId(routeProjectId);
  }, [routeProjectId, routeFocus, projects, consumedFocusRef]);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [tab, setTab] = useState<SubTab>('schedule');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [detailTask, setDetailTask] = useState<ScheduleTask | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [scheduleView, setScheduleView] = useState<'list' | 'timeline'>('list');
  const [addPrefillDate, setAddPrefillDate] = useState<string | undefined>(undefined);
  const [showZoneEditor, setShowZoneEditor] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  const activeSchedule = selectedProject?.schedule ?? null;
  // Voice-build generates the schedule FROM the linked estimate — without one the
  // Copilot interview would run and then dead-end at "Build it". Gate the voice
  // entries on it so estimate-less projects only see the manual path.
  const hasEstimate = !!selectedProject?.linkedEstimate;
  const tasks = useMemo(() => activeSchedule?.tasks ?? [], [activeSchedule]);
  const startDate = activeSchedule?.startDate ?? new Date().toISOString().slice(0, 10);

  const [showExport, setShowExport] = useState(false);
  const reportCpm = useMemo(
    () => runCpm(tasks, { scheduleStartDate: startDate, workingDaysPerWeek: activeSchedule?.workingDaysPerWeek, nonWorkingDates: activeSchedule?.nonWorkingDates }),
    [tasks, startDate, activeSchedule?.workingDaysPerWeek, activeSchedule?.nonWorkingDates],
  );

  const saveTasks = useCallback((nextTasks: ScheduleTask[]) => {
    if (!selectedProject) return;
    const name = activeSchedule?.name ?? `${selectedProject.name} Schedule`;
    // Mobile Pro is a MANUAL scheduler — startDay is user-authoritative (drag +
    // steppers). Run CPM ONLY to refresh critical-path flags (which tasks sit on
    // the longest dependency chain) + the engine-true project finish, then keep
    // each task's manual startDay. Passing criticalPathDays makes
    // buildScheduleFromTasks skip its forward-pass resolver, so manual positions
    // stick even for dependent tasks and day-0 isn't clamped to day-1.
    // CPM runs on the schedule's OWN calendar (anchor + working week +
    // closures) so the stored finish agrees with every other surface — a raw
    // 7-day run here used to disagree with the calendar-aware numbers the
    // export/report path computes (sim-audit #2).
    const cpm = runCpm(nextTasks, {
      scheduleStartDate: activeSchedule?.startDate,
      workingDaysPerWeek: activeSchedule?.workingDaysPerWeek,
      nonWorkingDates: activeSchedule?.nonWorkingDates,
    });
    const critical = new Set(cpm.criticalPath);
    const flagged = nextTasks.map((t) => (critical.has(t.id) !== !!t.isCriticalPath ? { ...t, isCriticalPath: critical.has(t.id) } : t));
    // startDate policy (finish-jump bug): an EXISTING schedule keeps its
    // anchor exactly — including "no anchor" (retro-stamping today flips CPM
    // raw-day → calendar mode and the finish jumps). Only schedule CREATION
    // (first task on a project with no schedule yet) anchors at today.
    const anchor = activeSchedule ? activeSchedule.startDate : startDate;
    const next = buildScheduleFromTasks(name, selectedProject.id, flagged, activeSchedule?.baseline ?? null, {
      ...(anchor ? { startDate: anchor } : {}),
      criticalPathDays: cpm.projectFinish,
    });
    // Merge the freshly-derived scalars onto the EXISTING schedule so every
    // sidecar field survives (nonWorkingDates, scenarios, activeScenarioId,
    // criticalFloatThresholdDays, resources, resourceCalendars, fragnets,
    // baselines[], weatherAlerts, weatherDelayLog) and bufferDays /
    // workingDaysPerWeek aren't reset to buildScheduleFromTasks' hardcoded
    // defaults — a naive `{ ...next }` write silently wiped all of these on
    // every task edit, and (post the calendar-aware CPM fix) it also fed
    // nonWorkingDates into the finish computation and then dropped it. On
    // schedule CREATION (no activeSchedule) there is nothing to preserve, so
    // `next` is written as-is (it already carries the creation anchor).
    const merged = activeSchedule
      ? mergeEditedSchedule(activeSchedule, next, { projectId: selectedProject.id })
      : { ...next, projectId: selectedProject.id, updatedAt: new Date().toISOString() };
    updateProject(selectedProject.id, { schedule: merged });
  }, [selectedProject, activeSchedule, startDate, updateProject]);

  const onUpdateTask = useCallback((next: ScheduleTask) => {
    // Pace flywheel: this is a full-object sink — `next` spreads the previous
    // task, so it already carries any existing actuals. The stamp (computed
    // from the PREVIOUS task + the NEW status) only adds fields that were
    // unset, so merging it over `next` never overwrites history.
    const prev = tasks.find((t) => t.id === next.id);
    let stamped: ScheduleTask = next;
    if (prev && next.status !== prev.status) {
      const stamp = stampActuals(prev, next.status, todayScheduleDay(activeSchedule?.startDate), new Date().toISOString());
      stamped = { ...next, ...stamp };
      // Morning-brief ledger: a real capture (stamp set an ISO date) is a
      // did-for-you moment. recordDidForYou is G4-safe by contract.
      if (stamp.actualStartDate != null || stamp.actualEndDate != null) {
        recordDidForYou(`Auto-stamped actual dates for ${prev.title}`, selectedProject?.id);
      }
    }
    saveTasks(tasks.map((t) => (t.id === stamped.id ? stamped : t)));
    setDetailTask(stamped);
  }, [tasks, saveTasks, activeSchedule?.startDate, selectedProject?.id]);

  const onCreate = useCallback((values: NewTaskValues) => {
    // startDay is 1-indexed to MATCH the desktop + CPM engine (day 1 = schedule
    // start). Legacy mobile-created tasks stored 0-indexed self-correct on their
    // next edit; we intentionally do NOT mutate stored data (can't safely tell a
    // 0-indexed mobile task apart from a 1-indexed desktop one).
    const base = new Date(startDate); base.setHours(0, 0, 0, 0);
    let startDay: number;
    if (values.startIso) {
      const target = new Date(values.startIso); target.setHours(0, 0, 0, 0);
      startDay = 1 + Math.max(0, Math.round((target.getTime() - base.getTime()) / MS_DAY));
    } else {
      startDay = tasks.length === 0 ? 1 : Math.max(...tasks.map((t) => (t.startDay ?? 1) + Math.max(1, t.durationDays || 1)));
    }
    const newTask: ScheduleTask = {
      id: createId('task'),
      title: values.title,
      phase: 'General',
      durationDays: values.durationDays,
      startDay,
      progress: 0,
      crew: values.crew ?? '',
      dependencies: values.predecessorIds ?? [],
      notes: values.notes ?? '',
      status: 'not_started',
    };
    saveTasks([...tasks, newTask]);
    setShowAdd(false);
    setAddPrefillDate(undefined);
  }, [tasks, saveTasks, startDate]);

  const onDeleteTask = useCallback((id: string) => {
    saveTasks(tasks.filter((t) => t.id !== id));
    setDetailTask(null);
  }, [tasks, saveTasks]);

  const openAddAt = useCallback((iso: string) => {
    setAddPrefillDate(iso);
    setShowAdd(true);
  }, []);

  // Explicit project picker (sim-audit #11): tapping the title used to
  // silently CYCLE through projects — zero affordance, and with several
  // projects it read as "my schedule changed by itself". The chevron now
  // opens a bottom sheet listing every project, current one checked.
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  if (!selectedProject) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <EmptyState
          icon={<FolderOpen size={36} color={colors.accent} strokeWidth={1.75} />}
          title="No project yet"
          message="Create a project to build its schedule."
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as never)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={{ flex: 1, minWidth: 0 }}
          activeOpacity={0.7}
          onPress={() => { if (projects.length > 1) setShowProjectPicker(true); }}
          disabled={projects.length < 2}
          accessibilityRole="button"
          accessibilityLabel={`Schedule for ${selectedProject.name}. ${projects.length > 1 ? 'Tap to switch project.' : ''}`}
          testID="schedule-project-switcher"
        >
          <View style={styles.titleRow}>
            <Text style={styles.projName} numberOfLines={1}>{selectedProject.name}</Text>
            {projects.length > 1 && <ChevronDown size={18} color={colors.text} strokeWidth={1.75} />}
          </View>
          {!!displayText(selectedProject.location) && <Text style={styles.loc} numberOfLines={1}>{displayText(selectedProject.location)}</Text>}
        </TouchableOpacity>
        {/* MAGE Copilot — the flagship phone-create path: speak the scope, the
            AI asks grounded clarifying questions, then builds the schedule.
            Accent-tinted so it reads as the primary "make one" action. Only shown
            when there's a linked estimate to build from (voice-build needs it). */}
        {hasEstimate && (
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push(`/copilot?capabilityId=schedule&projectId=${selectedProject.id}`)} accessibilityLabel="Build schedule by voice" testID="open-copilot-schedule">
            <Mic size={19} color={colors.accent} strokeWidth={2} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.iconBtn} onPress={() => setShowCalendar(true)} accessibilityLabel="Jump to date" testID="open-calendar">
          <CalendarDays size={19} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        {/* Import Excel / MS Project schedule. This is the ONLY phone entry to
            the Schedule Import feature — Schedule Pro (its desktop home) shows a
            "best on a bigger screen" redirect on phones, so without this button
            the feature is unreachable on iOS (the primary target). */}
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push(`/schedule-import?projectId=${selectedProject.id}`)} accessibilityLabel="Import schedule" testID="open-schedule-import">
          <FileInput size={19} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setShowExport(true)} accessibilityLabel="Export schedule" testID="open-export" disabled={tasks.length === 0}>
          <Download size={19} color={tasks.length === 0 ? colors.textMuted : colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/notifications-inbox' as never)} accessibilityLabel="Notifications">
          <Bell size={19} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      <WeekStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <View style={styles.subtabs}>
        {SUBTABS.map(([k, label]) => (
          <TouchableOpacity key={k} style={styles.subtab} onPress={() => setTab(k)}>
            <Text style={[styles.subtabText, tab === k ? { color: colors.accent } : null]}>{label}</Text>
            {tab === k && <View style={[styles.subtabBar, { backgroundColor: colors.accent }]} />}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'schedule' ? (
        tasks.length === 0 ? (
          hasEstimate ? (
            <EmptyState
              icon={<Mic size={36} color={colors.accent} strokeWidth={1.75} />}
              title="No schedule yet"
              message="Say the scope out loud — MAGE asks a few grounded questions, then builds the schedule for you. Or add work packages by hand."
              actionLabel="Build by voice"
              onAction={() => router.push(`/copilot?capabilityId=schedule&projectId=${selectedProject.id}`)}
              secondaryLabel="Add manually"
              onSecondaryAction={() => setShowAdd(true)}
            />
          ) : (
            <EmptyState
              icon={<FolderOpen size={36} color={colors.accent} strokeWidth={1.75} />}
              title="No schedule yet"
              message="Add work packages to start building the schedule. Add an estimate first to build it by voice."
              actionLabel="New Work Package"
              onAction={() => setShowAdd(true)}
            />
          )
        ) : (
          <>
            <View style={styles.viewToggle}>
              {(['list', 'timeline'] as const).map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.viewSeg, scheduleView === v ? styles.viewSegOn : null]}
                  activeOpacity={0.8}
                  onPress={() => setScheduleView(v)}
                >
                  <Text style={[styles.viewSegText, scheduleView === v ? { color: colors.accent } : null]}>
                    {v === 'list' ? 'List' : 'Timeline'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {scheduleView === 'list' ? (
              <MobileScheduleList
                tasks={tasks}
                startDate={startDate}
                collapsedPhases={collapsed}
                onTogglePhase={(p) => setCollapsed((c) => ({ ...c, [p]: !c[p] }))}
                onPressTask={setDetailTask}
                onAddTask={() => setShowAdd(true)}
                onUpdateTask={onUpdateTask}
                onDeleteTask={onDeleteTask}
              />
            ) : (
              <MobileGantt
                tasks={tasks}
                startDate={startDate}
                selectedDate={selectedDate}
                collapsedPhases={collapsed}
                onTogglePhase={(p) => setCollapsed((c) => ({ ...c, [p]: !c[p] }))}
                onPressTask={setDetailTask}
                onAddTask={() => setShowAdd(true)}
                onLongPressEmpty={openAddAt}
                onUpdateTask={onUpdateTask}
              />
            )}
          </>
        )
      ) : tab === 'progress' ? (
        <ProgressTab tasks={tasks} startDate={startDate} />
      ) : tab === 'team' ? (
        <TeamTab tasks={tasks} onPressTask={setDetailTask} />
      ) : (
        <LivingFloorPlanContainer project={selectedProject} onShowEditor={() => setShowZoneEditor(true)} />
      )}

      <TaskDetailSheet
        visible={!!detailTask}
        task={detailTask}
        allTasks={tasks}
        startDate={startDate}
        onClose={() => setDetailTask(null)}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
      />
      <AddTaskModal visible={showAdd} onCancel={() => { setShowAdd(false); setAddPrefillDate(undefined); }} onCreate={onCreate} tasks={tasks} defaultStartDate={addPrefillDate} />

      <ProjectPickerSheet
        visible={showProjectPicker}
        projects={projects}
        selectedProjectId={selectedProject.id}
        onSelect={(id) => { setSelectedProjectId(id); setShowProjectPicker(false); }}
        onClose={() => setShowProjectPicker(false)}
      />

      <MonthCalendarSheet
        visible={showCalendar}
        selectedDate={selectedDate}
        tasks={tasks}
        startDateIso={startDate}
        onSelect={setSelectedDate}
        onClose={() => setShowCalendar(false)}
      />

      <ExportCenterSheet
        visible={showExport}
        onClose={() => setShowExport(false)}
        project={selectedProject}
        tasks={tasks}
        startDateIso={startDate}
        cpm={reportCpm}
        baseline={activeSchedule?.baseline ?? null}
        nonWorkingDates={activeSchedule?.nonWorkingDates}
        onExportIcal={() => { void exportScheduleIcal({ project: selectedProject }); }}
      />

      {/* Living Floor Plan zone editor (full-screen modal) */}
      <Modal visible={showZoneEditor} animationType="slide" onRequestClose={() => setShowZoneEditor(false)}>
        {(() => {
          const planSheets = getPlanSheetsForProject(selectedProject.id).filter((s) => !s.superseded);
          const firstSheet = planSheets[0] ?? null;
          if (!firstSheet) return null;
          return (
            <PlanZoneEditor
              project={selectedProject}
              planSheetId={firstSheet.id}
              imageUri={firstSheet.imageUri}
              imageW={firstSheet.width}
              imageH={firstSheet.height}
              onClose={() => setShowZoneEditor(false)}
            />
          );
        })()}
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ProjectPickerSheet — explicit "switch project" bottom sheet (the app's
// sheet idiom: backdrop + grab handle + slide-up panel, same as
// MonthCalendarSheet). Replaces the old tap-to-cycle title behavior.
// ---------------------------------------------------------------------------

function ProjectPickerSheet({ visible, projects, selectedProjectId, onSelect, onClose }: {
  visible: boolean;
  projects: Project[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const pick = (id: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onSelect(id);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 16 }]} testID="schedule-project-picker">
        <View style={styles.pickerGrab} />
        <View style={styles.pickerHead}>
          <Text style={styles.pickerTitle}>Switch project</Text>
          <TouchableOpacity onPress={onClose} style={styles.pickerClose} accessibilityRole="button" accessibilityLabel="Close">
            <X size={18} color={colors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {projects.map((p, i) => {
            const active = p.id === selectedProjectId;
            const taskCount = p.schedule?.tasks?.length ?? 0;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.pickerRow, i > 0 ? styles.pickerRowDivider : null]}
                activeOpacity={0.7}
                onPress={() => pick(p.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`schedule-pick-project-${p.id}`}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.pickerRowName, active ? { color: colors.accent } : null]} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.pickerRowMeta} numberOfLines={1}>
                    {taskCount > 0 ? `${taskCount} task${taskCount === 1 ? '' : 's'}` : 'No schedule yet'}
                    {displayText(p.location) ? ` · ${displayText(p.location)}` : ''}
                  </Text>
                </View>
                {active && <Check size={18} color={colors.accent} strokeWidth={2.2} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Living Floor Plan container — resolves the first non-superseded plan sheet
// for the project and wires the LivingFloorPlan component.
// ---------------------------------------------------------------------------

function LivingFloorPlanContainer({
  project,
  onShowEditor,
}: {
  project: Project;
  onShowEditor: () => void;
}) {
  const router = useRouter();
  const {
    getPlanSheetsForProject,
    getPlanZonesForProject,
    getPinsForPlan,
    getPhotosForProject,
  } = useProjects();

  const planSheets = getPlanSheetsForProject(project.id).filter((s) => !s.superseded);
  const firstSheet = planSheets[0] ?? null;

  const zones = getPlanZonesForProject(project.id).filter(
    (z) => firstSheet ? z.planSheetId === firstSheet.id : false,
  );
  const pins = firstSheet ? getPinsForPlan(firstSheet.id) : [];
  const photos = getPhotosForProject(project.id);
  const photoById = (photoId: string) => { const p = photos.find((ph) => ph.id === photoId); return p ? { uri: p.uri, createdAt: p.createdAt } : undefined; };

  return (
    <LivingFloorPlan
      project={project}
      planSheetId={firstSheet?.id ?? ''}
      zones={zones}
      pins={pins}
      photoById={photoById}
      imageUri={firstSheet?.imageUri ?? ''}
      imageW={firstSheet?.width}
      imageH={firstSheet?.height}
      onEdit={onShowEditor}
      onAddPlan={() => router.push('/plans' as never)}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  projName: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.4 },
  loc: { fontSize: 12, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  subtabs: { flexDirection: 'row' as const, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: t.line, marginTop: 2 },
  subtab: { paddingVertical: 10, marginRight: 22 },
  subtabText: { fontSize: 14, fontWeight: '700' as const, color: t.textMuted },
  subtabBar: { height: 2.5, borderRadius: 2, marginTop: 8 },
  viewToggle: { flexDirection: 'row' as const, alignSelf: 'flex-start' as const, marginHorizontal: 16, marginTop: 12, marginBottom: 2, backgroundColor: t.surfaceAlt, borderRadius: 9, padding: 3, gap: 2 },
  viewSeg: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 7 },
  viewSegOn: { backgroundColor: t.surface },
  viewSegText: { fontSize: 13, fontWeight: '700' as const, color: t.textMuted },
  // Project picker sheet (idiom shared with MonthCalendarSheet)
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 16 },
  pickerGrab: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginBottom: 12 },
  pickerHead: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: 4 },
  pickerTitle: { flex: 1, fontSize: 17, fontWeight: '800' as const, color: t.text },
  pickerClose: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 17, backgroundColor: t.surfaceAlt },
  pickerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 13 },
  pickerRowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  pickerRowName: { fontSize: 15, fontWeight: '700' as const, color: t.text },
  pickerRowMeta: { fontSize: 12, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
});
