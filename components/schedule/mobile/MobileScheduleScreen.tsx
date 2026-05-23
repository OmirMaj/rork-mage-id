import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Bell, MoreHorizontal, ChevronDown, FolderOpen } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useProjects } from '@/contexts/ProjectContext';
import type { ScheduleTask } from '@/types';
import { buildScheduleFromTasks, createId } from '@/utils/scheduleEngine';
import EmptyState from '@/components/EmptyState';
import { AddTaskModal, type NewTaskValues } from '@/components/schedule/AddTaskModal';
import { WeekStrip } from './WeekStrip';
import { MobileGantt } from './MobileGantt';
import { MobileScheduleList } from './MobileScheduleList';
import { TaskDetailSheet } from './TaskDetailSheet';
import { ProgressTab } from './ProgressTab';
import { TeamTab } from './TeamTab';
import { FourDComingSoon } from './FourDComingSoon';

type SubTab = 'schedule' | '4d' | 'progress' | 'team';
const MS_DAY = 24 * 60 * 60 * 1000;
const SUBTABS: [SubTab, string][] = [['schedule', 'Schedule'], ['4d', '4D Model'], ['progress', 'Progress'], ['team', 'Team']];

// Mobile-native "Schedule Pro" — touch-first gantt + task-detail sheet +
// sub-tabs, rendered on phones (web/tablet keep the desktop schedule screen).
export function MobileScheduleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, updateProject } = useProjects();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [tab, setTab] = useState<SubTab>('schedule');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [detailTask, setDetailTask] = useState<ScheduleTask | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [scheduleView, setScheduleView] = useState<'list' | 'timeline'>('list');
  const [addPrefillDate, setAddPrefillDate] = useState<string | undefined>(undefined);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  const activeSchedule = selectedProject?.schedule ?? null;
  const tasks = useMemo(() => activeSchedule?.tasks ?? [], [activeSchedule]);
  const startDate = activeSchedule?.startDate ?? new Date().toISOString().slice(0, 10);

  const saveTasks = useCallback((nextTasks: ScheduleTask[]) => {
    if (!selectedProject) return;
    const name = activeSchedule?.name ?? `${selectedProject.name} Schedule`;
    const next = buildScheduleFromTasks(name, selectedProject.id, nextTasks, activeSchedule?.baseline ?? null, {
      startDate: activeSchedule?.startDate ?? startDate,
    });
    updateProject(selectedProject.id, {
      schedule: { ...next, projectId: selectedProject.id, updatedAt: new Date().toISOString() },
    });
  }, [selectedProject, activeSchedule, startDate, updateProject]);

  const onUpdateTask = useCallback((next: ScheduleTask) => {
    saveTasks(tasks.map((t) => (t.id === next.id ? next : t)));
    setDetailTask(next);
  }, [tasks, saveTasks]);

  const onCreate = useCallback((values: NewTaskValues) => {
    const base = new Date(startDate); base.setHours(0, 0, 0, 0);
    let startDay: number;
    if (values.startIso) {
      const target = new Date(values.startIso); target.setHours(0, 0, 0, 0);
      startDay = Math.max(0, Math.round((target.getTime() - base.getTime()) / MS_DAY));
    } else {
      startDay = tasks.length === 0 ? 0 : Math.max(...tasks.map((t) => (t.startDay ?? 0) + Math.max(1, t.durationDays || 1)));
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

  const cycleProject = useCallback(() => {
    if (projects.length < 2 || !selectedProject) return;
    const idx = projects.findIndex((p) => p.id === selectedProject.id);
    setSelectedProjectId(projects[(idx + 1) % projects.length].id);
  }, [projects, selectedProject]);

  if (!selectedProject) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <EmptyState
          icon={<FolderOpen size={36} color={colors.accent} />}
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
        <TouchableOpacity style={{ flex: 1, minWidth: 0 }} activeOpacity={0.7} onPress={cycleProject}>
          <View style={styles.titleRow}>
            <Text style={styles.projName} numberOfLines={1}>{selectedProject.name}</Text>
            {projects.length > 1 && <ChevronDown size={18} color={colors.text} />}
          </View>
          {!!selectedProject.location && <Text style={styles.loc} numberOfLines={1}>{selectedProject.location}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/notifications-inbox' as never)} accessibilityLabel="Notifications">
          <Bell size={19} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push({ pathname: '/schedule-pro', params: { id: selectedProject.id } } as never)} accessibilityLabel="More">
          <MoreHorizontal size={19} color={colors.text} />
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
          <EmptyState
            icon={<FolderOpen size={36} color={colors.accent} />}
            title="No schedule yet"
            message="Add work packages to start building the schedule."
            actionLabel="New Work Package"
            onAction={() => setShowAdd(true)}
          />
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
        <ScrollView contentContainerStyle={{ paddingTop: 12 }}><FourDComingSoon /></ScrollView>
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
    </View>
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
});
