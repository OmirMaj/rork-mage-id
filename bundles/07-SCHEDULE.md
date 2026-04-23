# Schedule — Tasks, Gantt, CPM & AI Builder


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Scheduling subsystem.

- `app/(tabs)/schedule/index.tsx` — main schedule view (Gantt / Grid /
  Lookahead / Today toggles). Recently fixed: mobile date-picker modal was
  missing; `extraModals` is now shared between desktop and mobile render
  branches.
- `app/schedule-pro.tsx` — full-screen power view.
- `components/schedule/` — Gantt, grid, lookahead, today, scenarios, share,
  quick-build, AI assistant panel, swipeable task card.
- `utils/scheduleEngine.ts`, `scheduleOps.ts`, `cpm.ts`, `scheduleAI.ts`,
  `autoScheduleFromEstimate.ts`, `demoSchedule.ts` — scheduling logic.
- `components/AIAutoScheduleButton.tsx` — generates a full schedule from an
  estimate's line items.
- `app/shared-schedule.tsx` — read-only public view (shareable link).


## Files in this bundle

- `app/(tabs)/schedule/index.tsx`
- `app/schedule-pro.tsx`
- `app/shared-schedule.tsx`
- `components/AIAutoScheduleButton.tsx`
- `components/AIScheduleRisk.tsx`
- `components/schedule/GanttChart.tsx`
- `components/schedule/InteractiveGantt.tsx`
- `components/schedule/VerticalGantt.tsx`
- `components/schedule/GridPane.tsx`
- `components/schedule/LookaheadView.tsx`
- `components/schedule/TodayView.tsx`
- `components/schedule/SwipeableTaskCard.tsx`
- `components/schedule/QuickBuildModal.tsx`
- `components/schedule/ScenariosModal.tsx`
- `components/schedule/AIAssistantPanel.tsx`
- `components/schedule/ScheduleShareSheet.tsx`
- `utils/scheduleEngine.ts`
- `utils/scheduleOps.ts`
- `utils/cpm.ts`
- `utils/scheduleAI.ts`
- `utils/autoScheduleFromEstimate.ts`
- `utils/demoSchedule.ts`


---

### `app/(tabs)/schedule/index.tsx`

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Switch,
  KeyboardAvoidingView,
  ActivityIndicator,
  Image,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudRain,
  FolderOpen,
  Flag,
  GitBranch,
  Link2,
  Minus,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
  BarChart3,
  LayoutGrid,
  FileText,
  Zap,
  Save,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { Project, ProjectSchedule, ScheduleTask, DependencyLink, DependencyType } from '@/types';
import {
  createId,
  getDepLinks,
  getSuccessors,
  getPredecessors,
  getDepTypeForDep,
  calculateHealthScore,
  getHealthColor,
  addWorkingDays,
  formatShortDate,
  getTaskDateRange,
  getStatusLabel,
  getStatusColor,
  getTaskBorderColor,
  suggestDuration,
  buildScheduleFromTasks,
  saveBaseline,
  getBaselineVariance,
  getPhaseColor,
  PHASE_OPTIONS,
} from '@/utils/scheduleEngine';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate } from '@/constants/scheduleTemplates';
import GanttChart from '@/components/schedule/GanttChart';
import TodayView from '@/components/schedule/TodayView';
import LookaheadView from '@/components/schedule/LookaheadView';
import VerticalGantt from '@/components/schedule/VerticalGantt';
import QuickBuildModal from '@/components/schedule/QuickBuildModal';
import ScheduleShareSheet from '@/components/schedule/ScheduleShareSheet';
import ScenariosModal from '@/components/schedule/ScenariosModal';
import { getSimulatedForecast, getConditionIcon, getForecastWithFallback, type DayForecast } from '@/utils/weatherService';
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import AIScheduleRisk from '@/components/AIScheduleRisk';
import AICopilot from '@/components/AICopilot';
import VoiceFieldButton from '@/components/VoiceFieldButton';

interface TaskDraft {
  title: string;
  phase: string;
  durationDays: string;
  startDayOverride: string;
  /**
   * Optional calendar start date (YYYY-MM-DD). When set, takes precedence
   * over dependency chaining and startDayOverride — the task's startDay is
   * computed as the day offset from the schedule's projectStartDate.
   */
  startDateOverride: string;
  crew: string;
  crewSize: string;
  notes: string;
  isMilestone: boolean;
  wbsCode: string;
  isCriticalPath: boolean;
  isWeatherSensitive: boolean;
  dependencyLinks: DependencyLink[];
  status: ScheduleTask['status'];
  progress: string;
  assignedSubId: string;
  assignedSubName: string;
}

type ScheduleViewMode = 'today' | 'lookahead' | 'board' | 'gantt' | 'resources' | 'summary';
type FilterMode = 'all' | 'critical' | 'milestones' | 'overdue';

const EMPTY_DRAFT: TaskDraft = {
  title: '', phase: 'General', durationDays: '5', startDayOverride: '',
  startDateOverride: '',
  crew: '', crewSize: '2', notes: '', isMilestone: false, wbsCode: '',
  isCriticalPath: false, isWeatherSensitive: false, dependencyLinks: [],
  status: 'not_started', progress: '0',
  assignedSubId: '', assignedSubName: '',
};

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const { projects, updateProject, addProject, contacts } = useProjects();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduleTask | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // projectStartDate is derived from activeSchedule.startDate when set; otherwise today.
  // Changes persist through the schedule object via setProjectStartDate().
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('today');
  const [isVerticalGantt, setIsVerticalGantt] = useState(false);
  const [isQuickBuildOpen, setIsQuickBuildOpen] = useState(false);
  const [isShareSheetOpen, setIsShareSheetOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [taskDetailModal, setTaskDetailModal] = useState<ScheduleTask | null>(null);
  const [isFieldMode, setIsFieldMode] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({});
  const [quickAddCount, setQuickAddCount] = useState(0);
  const [isAIBuilderOpen, setIsAIBuilderOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAILoading, setIsAILoading] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [showDepPicker, setShowDepPicker] = useState(false);
  const [weatherAlerts, setWeatherAlerts] = useState<{ taskName: string; date: string; condition: string }[]>([]);

  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ ...EMPTY_DRAFT });
  const [isProjectStartDatePickerOpen, setIsProjectStartDatePickerOpen] = useState(false);
  const [projectStartDateInput, setProjectStartDateInput] = useState<string>('');

  const selectedProject = useMemo<Project | null>(() => {
    return projects.find(p => p.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const activeSchedule = useMemo<ProjectSchedule | null>(() => {
    return selectedProject?.schedule ?? null;
  }, [selectedProject]);

  // Derive project start date from the schedule; default to today if missing.
  // Using noon local time avoids timezone rollover surprises for comparisons.
  const projectStartDate = useMemo<Date>(() => {
    if (activeSchedule?.startDate) {
      const d = new Date(activeSchedule.startDate + 'T12:00:00');
      if (!Number.isNaN(d.getTime())) return d;
    }
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  }, [activeSchedule?.startDate]);

  /**
   * When a What-If scenario is selected, the Gantt reads from that scenario's
   * task snapshot instead of the baseline. This is a DISPLAY-only swap for
   * v1 — task edit handlers still mutate the baseline `schedule.tasks`. The
   * UX surfaces this via a banner so PMs know they're in a read-only view
   * of the branch. Future iteration: route edits into the active scenario.
   */
  const activeScenarioTasks = useMemo<ScheduleTask[] | null>(() => {
    if (!activeSchedule || !activeSchedule.activeScenarioId) return null;
    const scenario = (activeSchedule.scenarios ?? []).find(
      (s) => s.id === activeSchedule.activeScenarioId,
    );
    return scenario?.tasks ?? null;
  }, [activeSchedule]);

  const sortedTasks = useMemo<ScheduleTask[]>(() => {
    if (!activeSchedule) return [];
    const source = activeScenarioTasks ?? activeSchedule.tasks;
    return source.slice().sort((a, b) => a.startDay - b.startDay || a.title.localeCompare(b.title));
  }, [activeSchedule, activeScenarioTasks]);

  const [showScenariosModal, setShowScenariosModal] = useState(false);

  const handleScheduleScenariosChange = useCallback(
    (patch: Partial<ProjectSchedule>) => {
      if (!selectedProject || !activeSchedule) return;
      updateProject(selectedProject.id, {
        schedule: { ...activeSchedule, ...patch, updatedAt: new Date().toISOString() },
      });
    },
    [selectedProject, activeSchedule, updateProject],
  );

  /**
   * Forecast driving the Gantt weather badges. We prime synchronously with
   * simulated data so the first render has something to show, then kick off
   * a real OpenWeather fetch (keyed to the project's location string) in
   * an effect and swap in the real payload when it resolves. The service
   * layer caps real calls to once per 10 minutes per location so this
   * won't rate-limit us even if the effect re-runs.
   *
   * Fallback order: live OpenWeather → cached OpenWeather (<10 min) →
   * simulated. If no EXPO_PUBLIC_OPENWEATHER_API_KEY is set, we stay on
   * simulated forever, which is fine for dev and demo.
   */
  const [ganttForecast, setGanttForecast] = useState<DayForecast[]>(() =>
    getSimulatedForecast(projectStartDate, 21),
  );

  useEffect(() => {
    let cancelled = false;
    const locationHint = selectedProject?.location?.trim();
    setGanttForecast(getSimulatedForecast(projectStartDate, 21));
    void getForecastWithFallback(
      { city: locationHint },
      projectStartDate,
      21,
    ).then((forecast) => {
      if (!cancelled) setGanttForecast(forecast);
    });
    return () => {
      cancelled = true;
    };
  }, [projectStartDate, selectedProject?.location]);

  const filteredTasks = useMemo(() => {
    switch (filterMode) {
      case 'critical': return sortedTasks.filter(t => t.isCriticalPath);
      case 'milestones': return sortedTasks.filter(t => t.isMilestone);
      case 'overdue': return sortedTasks.filter(t => {
        if (t.status === 'done') return false;
        const { end } = getTaskDateRange(t, projectStartDate, activeSchedule?.workingDaysPerWeek ?? 5);
        return end < new Date() && t.progress < 100;
      });
      default: return sortedTasks;
    }
  }, [sortedTasks, filterMode, projectStartDate, activeSchedule]);

  const phaseGroups = useMemo(() => {
    const groups: Record<string, ScheduleTask[]> = {};
    for (const task of filteredTasks) {
      if (!groups[task.phase]) groups[task.phase] = [];
      groups[task.phase].push(task);
    }
    return groups;
  }, [filteredTasks]);

  const totalProgress = useMemo(() => {
    if (sortedTasks.length === 0) return 0;
    return Math.round(sortedTasks.reduce((sum, t) => sum + t.progress, 0) / sortedTasks.length);
  }, [sortedTasks]);

  const healthScore = useMemo(() => {
    return activeSchedule?.healthScore ?? calculateHealthScore(sortedTasks, activeSchedule?.updatedAt ?? new Date().toISOString());
  }, [activeSchedule, sortedTasks]);

  const daysRemaining = useMemo(() => {
    if (!activeSchedule) return 0;
    const endDate = addWorkingDays(projectStartDate, activeSchedule.totalDurationDays, activeSchedule.workingDaysPerWeek);
    return Math.max(0, Math.ceil((endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
  }, [activeSchedule, projectStartDate]);

  const crewMap = useMemo(() => {
    const map: Record<string, ScheduleTask[]> = {};
    for (const task of sortedTasks) {
      const crew = task.crew || 'Unassigned';
      if (!map[crew]) map[crew] = [];
      map[crew].push(task);
    }
    return map;
  }, [sortedTasks]);

  const todayTasks = useMemo(() => {
    const now = new Date();
    return sortedTasks.filter(t => {
      if (t.status === 'done') return false;
      const { start, end } = getTaskDateRange(t, projectStartDate, activeSchedule?.workingDaysPerWeek ?? 5);
      return start <= now && end >= now;
    });
  }, [sortedTasks, projectStartDate, activeSchedule]);

  const saveSchedule = useCallback((schedule: ProjectSchedule, project: Project | null) => {
    console.log('[Schedule] Saving schedule', { projectId: project?.id, taskCount: schedule.tasks.length });
    if (project) {
      updateProject(project.id, {
        schedule: { ...schedule, projectId: project.id, updatedAt: new Date().toISOString() },
        status: project.estimate ? 'estimated' : 'draft',
      });
      return;
    }
    const now = new Date().toISOString();
    const newProject: Project = {
      id: createId('project'), name: 'Schedule Project', type: 'renovation',
      location: 'United States', squareFootage: 0, quality: 'standard',
      description: 'Created from Schedule', createdAt: now, updatedAt: now,
      estimate: null,
      schedule: { ...schedule, projectId: null, updatedAt: now },
      status: 'draft',
    };
    addProject(newProject);
    setSelectedProjectId(newProject.id);
  }, [addProject, updateProject]);

  // Save a new project start date onto the schedule. Tasks keep their startDay
  // offsets, so the schedule "slides" to the new date wholesale.
  const setProjectStartDate = useCallback((isoYYYYMMDD: string) => {
    // Validate YYYY-MM-DD
    const m = /^\d{4}-\d{2}-\d{2}$/.exec(isoYYYYMMDD.trim());
    if (!m) { Alert.alert('Invalid date', 'Use format YYYY-MM-DD (e.g. 2026-05-01).'); return; }
    const parsed = new Date(isoYYYYMMDD + 'T12:00:00');
    if (Number.isNaN(parsed.getTime())) { Alert.alert('Invalid date'); return; }
    if (!activeSchedule) {
      Alert.alert('No schedule', 'Add at least one task before setting a project start date.');
      return;
    }
    const next: ProjectSchedule = { ...activeSchedule, startDate: isoYYYYMMDD };
    saveSchedule(next, selectedProject);
    setIsProjectStartDatePickerOpen(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [activeSchedule, saveSchedule, selectedProject]);

  const handleSaveTask = useCallback((draft: TaskDraft, editing: ScheduleTask | null) => {
    const title = draft.title.trim();
    if (!title) { Alert.alert('Missing task name'); return; }
    const durationDays = parseInt(draft.durationDays, 10);
    if (Number.isNaN(durationDays) || durationDays < 0 || durationDays > 365) {
      Alert.alert('Invalid duration', 'Enter 0-365 days.'); return;
    }
    const crewSize = parseInt(draft.crewSize, 10) || 1;
    const depLinks = draft.dependencyLinks;
    const depIds = depLinks.map(l => l.taskId);

    // If user set a calendar start date, translate to a startDay offset from
    // projectStartDate. +1 because startDay is 1-indexed (Day 1 = project start).
    let startDayFromDate: number | null = null;
    const rawStartDate = draft.startDateOverride.trim();
    if (rawStartDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawStartDate)) {
        Alert.alert('Invalid start date', 'Use format YYYY-MM-DD (e.g. 2026-05-01).');
        return;
      }
      const picked = new Date(rawStartDate + 'T12:00:00');
      if (Number.isNaN(picked.getTime())) { Alert.alert('Invalid start date'); return; }
      const ms = picked.getTime() - projectStartDate.getTime();
      const dayOffset = Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
      if (dayOffset < 1) {
        Alert.alert('Start date too early', `Pick a date on or after the project start (${projectStartDate.toLocaleDateString()}).`);
        return;
      }
      startDayFromDate = dayOffset;
    }

    if (editing) {
      const progress = Math.max(0, Math.min(100, parseInt(draft.progress, 10) || 0));
      const startDayOverride = parseInt(draft.startDayOverride, 10);
      const nextTasks: ScheduleTask[] = sortedTasks.map(item => {
        if (item.id !== editing.id) return item;
        const updated: ScheduleTask = {
          ...item, title, phase: draft.phase, crew: draft.crew.trim() || 'General crew',
          crewSize, durationDays, notes: draft.notes.trim(),
          isMilestone: draft.isMilestone, wbsCode: draft.wbsCode.trim() || undefined,
          isCriticalPath: draft.isCriticalPath, isWeatherSensitive: draft.isWeatherSensitive,
          dependencies: depIds, dependencyLinks: depLinks,
          status: draft.status, progress,
          assignedSubId: draft.assignedSubId || undefined,
          assignedSubName: draft.assignedSubName || undefined,
        };
        // Calendar-picked start date wins over day-number override.
        if (startDayFromDate !== null) {
          updated.startDay = startDayFromDate;
          updated.dependencies = [];
          updated.dependencyLinks = [];
        } else if (!Number.isNaN(startDayOverride) && startDayOverride > 0 && depLinks.length === 0) {
          // Only apply startDay override when no deps are set (deps control start day automatically)
          updated.startDay = startDayOverride;
        }
        return updated;
      });
      const scheduleName = activeSchedule?.name ?? 'Project Schedule';
      const nextSchedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, nextTasks, activeSchedule?.baseline);
      saveSchedule(nextSchedule, selectedProject);
    } else {
      const lastTask = sortedTasks[sortedTasks.length - 1];
      // Calendar-picked start date wins: skip auto-dependency chaining so the
      // task truly starts on the picked date rather than trailing the last task.
      const useExplicitDate = startDayFromDate !== null;
      const autoLinks: DependencyLink[] = useExplicitDate
        ? []
        : (depLinks.length > 0
          ? depLinks
          : (lastTask ? [{ taskId: lastTask.id, type: 'FS' as DependencyType, lagDays: 0 }] : []));
      const autoDepIds = autoLinks.map(l => l.taskId);

      const startDay = useExplicitDate
        ? (startDayFromDate as number)
        : (autoLinks.length > 0
          ? Math.max(...autoLinks.map(link => {
              const dep = sortedTasks.find(t => t.id === link.taskId);
              return dep ? dep.startDay + dep.durationDays + (link.lagDays || 0) : 1;
            }))
          : (lastTask ? lastTask.startDay + lastTask.durationDays : 1));

      const newTask: ScheduleTask = {
        id: createId('task'), title, phase: draft.phase, durationDays, startDay,
        progress: 0, crew: draft.crew.trim() || 'General crew', crewSize,
        dependencies: autoDepIds, dependencyLinks: autoLinks, notes: draft.notes.trim(),
        status: 'not_started', isMilestone: draft.isMilestone,
        wbsCode: draft.wbsCode.trim() || undefined,
        isCriticalPath: draft.isCriticalPath, isWeatherSensitive: draft.isWeatherSensitive,
        assignedSubId: draft.assignedSubId || undefined,
        assignedSubName: draft.assignedSubName || undefined,
      };
      const currentTasks = sortedTasks.length > 0 ? sortedTasks : [];
      const scheduleName = activeSchedule?.name ?? (selectedProject ? `${selectedProject.name} Schedule` : 'Project Schedule');
      const nextSchedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, [...currentTasks, newTask], activeSchedule?.baseline);
      saveSchedule(nextSchedule, selectedProject);
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeSchedule, saveSchedule, selectedProject, sortedTasks, projectStartDate]);

  const handleQuickAdd = useCallback(() => {
    handleSaveTask(taskDraft, null);
    setQuickAddCount(c => c + 1);
    setTaskDraft({ ...EMPTY_DRAFT });
  }, [handleSaveTask, taskDraft]);

  const handleEditSave = useCallback(() => {
    handleSaveTask(taskDraft, editingTask);
    setIsEditModalOpen(false);
    setEditingTask(null);
    setTaskDraft({ ...EMPTY_DRAFT });
  }, [handleSaveTask, taskDraft, editingTask]);

  const openEditTask = useCallback((task: ScheduleTask) => {
    setEditingTask(task);
    setTaskDraft({
      title: task.title, phase: task.phase, durationDays: String(task.durationDays),
      startDayOverride: String(task.startDay),
      startDateOverride: '',
      crew: task.crew, crewSize: String(task.crewSize || 1), notes: task.notes,
      isMilestone: task.isMilestone ?? false, wbsCode: task.wbsCode ?? '',
      isCriticalPath: task.isCriticalPath ?? false,
      isWeatherSensitive: task.isWeatherSensitive ?? false,
      dependencyLinks: getDepLinks(task),
      status: task.status,
      progress: String(task.progress),
      assignedSubId: task.assignedSubId ?? '',
      assignedSubName: task.assignedSubName ?? '',
    });
    setIsEditModalOpen(true);
    setTaskDetailModal(null);
  }, []);

  const handleProgressUpdate = useCallback((task: ScheduleTask, nextProgress: number) => {
    const clamped = Math.max(0, Math.min(100, nextProgress));
    const nextStatus = clamped >= 100 ? 'done' as const : clamped > 0 ? 'in_progress' as const : 'not_started' as const;
    const nextTasks = sortedTasks.map(item =>
      item.id !== task.id ? item : { ...item, progress: clamped, status: nextStatus }
    );
    const scheduleName = activeSchedule?.name ?? 'Project Schedule';
    const nextSchedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, nextTasks, activeSchedule?.baseline);
    saveSchedule(nextSchedule, selectedProject);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [activeSchedule, saveSchedule, selectedProject, sortedTasks]);

  const handlePhotoAdded = useCallback((task: ScheduleTask, photo: { uri: string; timestamp: string; note?: string }) => {
    console.log('[Schedule] Photo added to task:', task.title);
    const existingPhotos = task.photos ?? [];
    const nextTasks = sortedTasks.map(item =>
      item.id !== task.id ? item : { ...item, photos: [...existingPhotos, photo] }
    );
    const scheduleName = activeSchedule?.name ?? 'Project Schedule';
    const nextSchedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, nextTasks, activeSchedule?.baseline);
    saveSchedule(nextSchedule, selectedProject);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [activeSchedule, saveSchedule, selectedProject, sortedTasks]);

  const handleDeleteTask = useCallback((taskId: string) => {
    Alert.alert('Delete Task', 'Remove this task?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          const nextTasks = sortedTasks
            .filter(t => t.id !== taskId)
            .map(t => ({
              ...t,
              dependencies: t.dependencies.filter(d => d !== taskId),
              dependencyLinks: (t.dependencyLinks ?? []).filter(l => l.taskId !== taskId),
            }));
          const scheduleName = activeSchedule?.name ?? 'Project Schedule';
          const nextSchedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, nextTasks, activeSchedule?.baseline);
          saveSchedule(nextSchedule, selectedProject);
        },
      },
    ]);
  }, [activeSchedule, saveSchedule, selectedProject, sortedTasks]);

  const handleSaveBaseline = useCallback(() => {
    if (!activeSchedule) return;
    const baseline = saveBaseline(activeSchedule);
    const updated = { ...activeSchedule, baseline };
    saveSchedule(updated, selectedProject);
    Alert.alert('Baseline Saved', 'Current schedule saved as baseline for comparison.');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [activeSchedule, saveSchedule, selectedProject]);

  const handleAIGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) { Alert.alert('Describe your project first.'); return; }
    setIsAILoading(true);
    try {
      const taskItemSchema = z.object({
        id: z.string(),
        name: z.string(),
        phase: z.string(),
        duration: z.number(),
        predecessorIds: z.array(z.string()),
        isMilestone: z.boolean(),
        isCriticalPath: z.boolean(),
        crewSize: z.number(),
        wbs: z.string(),
      });

      const responseSchema = z.object({
        tasks: z.array(taskItemSchema),
      });

      console.log('[Schedule] Starting AI generation with prompt:', aiPrompt.trim());

      const aiResult = await mageAI({
        prompt: `You are a professional construction scheduler. Generate a complete construction schedule for this project. Return a JSON object with a "tasks" array.

Project description: ${aiPrompt.trim()}

Each task in the tasks array must have: id (string like "t1", "t2"), name (string), phase (one of: Site Work, Demo, Foundation, Framing, Roofing, MEP, Plumbing, Electrical, HVAC, Insulation, Drywall, Interior, Finishes, Landscaping, Inspections, General), duration (number of working days), predecessorIds (array of id strings referencing other task ids), isMilestone (boolean), isCriticalPath (boolean), crewSize (number 1-8), wbs (string like "1.1", "2.3").

Include a Project Start milestone (duration 0) and Project Complete milestone (duration 0). Group tasks into logical phases with realistic durations and dependencies. Generate 15-40 tasks depending on project size.`,
        schema: responseSchema,
        tier: 'smart',
        maxTokens: 2000,
      });

      if (!aiResult.success) {
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
        setIsAILoading(false);
        return;
      }

      let parsed: any = aiResult.data;
      console.log('[Schedule] AI raw response type:', typeof parsed);

      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          let cleaned = parsed.trim();
          if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
          if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
          if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
          try {
            parsed = JSON.parse(cleaned.trim());
          } catch {
            console.log('[Schedule] Could not parse AI string response');
            Alert.alert('Generation Failed', 'AI returned invalid data. Please try again.');
            setIsAILoading(false);
            return;
          }
        }
      }

      let taskArray: any[] | null = null;
      if (Array.isArray(parsed)) {
        taskArray = parsed;
      } else if (parsed && Array.isArray(parsed.tasks)) {
        taskArray = parsed.tasks;
      } else if (parsed && typeof parsed === 'object') {
        const firstArrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
        if (firstArrayKey) taskArray = parsed[firstArrayKey];
      }

      console.log('[Schedule] AI response parsed, tasks count:', taskArray?.length);

      const result = taskArray;

      if (result && result.length > 0) {
        const safeResult = result.map((t: any, idx: number) => ({
          id: t.id || `t${idx + 1}`,
          name: t.name || t.title || `Task ${idx + 1}`,
          phase: t.phase || 'General',
          duration: typeof t.duration === 'number' ? t.duration : (typeof t.durationDays === 'number' ? t.durationDays : 5),
          predecessorIds: Array.isArray(t.predecessorIds) ? t.predecessorIds : (Array.isArray(t.dependencies) ? t.dependencies : []),
          isMilestone: !!t.isMilestone,
          isCriticalPath: !!t.isCriticalPath,
          crewSize: typeof t.crewSize === 'number' ? t.crewSize : 2,
          wbs: t.wbs || t.wbsCode || `${idx + 1}.0`,
        }));
        const tasks: ScheduleTask[] = safeResult.map((t: any, idx: number) => ({
          id: createId('task'),
          title: t.name,
          phase: t.phase,
          durationDays: Math.max(t.isMilestone ? 0 : 1, t.duration),
          startDay: 1,
          progress: 0,
          crew: `Crew ${idx + 1}`,
          crewSize: t.crewSize,
          dependencies: [],
          dependencyLinks: [],
          notes: '',
          status: 'not_started' as const,
          isMilestone: t.isMilestone,
          wbsCode: t.wbs,
          isCriticalPath: t.isCriticalPath,
          isWeatherSensitive: false,
        }));

        const idMap = new Map<string, string>();
        safeResult.forEach((t: any, idx: number) => {
          idMap.set(t.id, tasks[idx].id);
        });

        for (let i = 0; i < tasks.length; i++) {
          const original = safeResult[i];
          tasks[i].dependencyLinks = (original.predecessorIds ?? [])
            .filter((pid: string) => idMap.has(pid))
            .map((pid: string) => ({
              taskId: idMap.get(pid)!,
              type: 'FS' as DependencyType,
              lagDays: 0,
            }));
          tasks[i].dependencies = tasks[i].dependencyLinks!.map(l => l.taskId);
        }

        const scheduleName = selectedProject ? `${selectedProject.name} Schedule` : 'AI Generated Schedule';
        const schedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, tasks);
        saveSchedule(schedule, selectedProject);
        setIsAIBuilderOpen(false);
        setAiPrompt('');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        console.log('[Schedule] AI returned empty or no tasks');
        Alert.alert('Generation Failed', 'AI returned no tasks. Please try a more detailed description.');
      }
    } catch (err) {
      console.log('[Schedule] AI generation failed:', err);
      Alert.alert('Generation Failed', 'Could not generate schedule. Please try again.');
    } finally {
      setIsAILoading(false);
    }
  }, [aiPrompt, saveSchedule, selectedProject]);

  const handleTemplateSelect = useCallback((template: ScheduleTemplate, _startDate: Date) => {
    const tasks: ScheduleTask[] = [];
    const idMap = new Map<string, string>();

    template.tasks.forEach(tt => {
      const newId = createId('task');
      idMap.set(tt.id, newId);
    });

    template.tasks.forEach(tt => {
      const newId = idMap.get(tt.id)!;
      const depLinks: DependencyLink[] = tt.predecessorIds
        .filter(pid => idMap.has(pid))
        .map(pid => ({ taskId: idMap.get(pid)!, type: 'FS' as DependencyType, lagDays: 0 }));

      tasks.push({
        id: newId, title: tt.name, phase: tt.phase,
        durationDays: tt.isMilestone ? 0 : Math.max(1, tt.duration),
        startDay: 1, progress: 0, crew: `Crew`, crewSize: tt.crewSize || 1,
        dependencies: depLinks.map(l => l.taskId), dependencyLinks: depLinks,
        notes: '', status: 'not_started', isMilestone: tt.isMilestone,
        isCriticalPath: tt.isCriticalPath, isWeatherSensitive: false,
      });
    });

    const scheduleName = selectedProject ? `${selectedProject.name} Schedule` : template.name;
    const schedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, tasks);
    saveSchedule(schedule, selectedProject);
    setIsTemplatePickerOpen(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [saveSchedule, selectedProject]);

  const handleBuildFromEstimate = useCallback(() => {
    if (!selectedProject?.estimate && !selectedProject?.linkedEstimate) {
      Alert.alert('No Estimate', 'This project needs an estimate first.');
      return;
    }

    const tasks: ScheduleTask[] = [];
    const linkedEst = selectedProject.linkedEstimate;
    const legacyEst = selectedProject.estimate;

    if (linkedEst) {
      const categories = new Map<string, { items: string[]; totalQty: number }>();
      linkedEst.items.forEach(item => {
        if (!categories.has(item.category)) {
          categories.set(item.category, { items: [], totalQty: 0 });
        }
        const cat = categories.get(item.category)!;
        cat.items.push(item.name);
        cat.totalQty += item.quantity;
      });

      let prevId: string | null = null;
      const startMilestone: ScheduleTask = {
        id: createId('task'), title: 'Project Start', phase: 'General',
        durationDays: 0, startDay: 1, progress: 0, crew: '', crewSize: 0,
        dependencies: [], notes: '', status: 'not_started', isMilestone: true,
        isCriticalPath: true, isWeatherSensitive: false,
      };
      tasks.push(startMilestone);
      prevId = startMilestone.id;

      categories.forEach((data, category) => {
        const duration = Math.max(1, Math.round(data.totalQty / 50));
        const task: ScheduleTask = {
          id: createId('task'), title: category, phase: guessPhase(category),
          durationDays: Math.min(duration, 20), startDay: 1, progress: 0,
          crew: `${category} crew`, crewSize: 2,
          dependencies: prevId ? [prevId] : [],
          dependencyLinks: prevId ? [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }] : [],
          notes: `Items: ${data.items.slice(0, 3).join(', ')}${data.items.length > 3 ? '...' : ''}`,
          status: 'not_started', isMilestone: false, isCriticalPath: true,
          isWeatherSensitive: false, linkedEstimateItems: data.items,
        };
        tasks.push(task);
        prevId = task.id;
      });

      const endMilestone: ScheduleTask = {
        id: createId('task'), title: 'Project Complete', phase: 'General',
        durationDays: 0, startDay: 1, progress: 0, crew: '', crewSize: 0,
        dependencies: prevId ? [prevId] : [],
        dependencyLinks: prevId ? [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }] : [],
        notes: '', status: 'not_started', isMilestone: true, isCriticalPath: true,
        isWeatherSensitive: false,
      };
      tasks.push(endMilestone);
    } else if (legacyEst) {
      const categories = new Map<string, number>();
      legacyEst.materials.forEach(m => {
        categories.set(m.category, (categories.get(m.category) || 0) + m.quantity);
      });
      let prevId: string | null = null;
      categories.forEach((qty, category) => {
        const task: ScheduleTask = {
          id: createId('task'), title: category, phase: guessPhase(category),
          durationDays: Math.max(1, Math.min(Math.round(qty / 50), 15)),
          startDay: 1, progress: 0, crew: `${category} crew`, crewSize: 2,
          dependencies: prevId ? [prevId] : [],
          dependencyLinks: prevId ? [{ taskId: prevId, type: 'FS' as DependencyType, lagDays: 0 }] : [],
          notes: '', status: 'not_started', isMilestone: false, isCriticalPath: true,
          isWeatherSensitive: false,
        };
        tasks.push(task);
        prevId = task.id;
      });
    }

    if (tasks.length > 0) {
      const scheduleName = `${selectedProject.name} Schedule`;
      const schedule = buildScheduleFromTasks(scheduleName, selectedProject.id, tasks);
      saveSchedule(schedule, selectedProject);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [selectedProject, saveSchedule]);

  const togglePhaseCollapse = useCallback((phase: string) => {
    setCollapsedPhases(prev => ({ ...prev, [phase]: !prev[phase] }));
  }, []);

  const toggleDep = useCallback((taskId: string) => {
    setTaskDraft(prev => {
      const exists = prev.dependencyLinks.some(l => l.taskId === taskId);
      if (exists) return { ...prev, dependencyLinks: prev.dependencyLinks.filter(l => l.taskId !== taskId) };
      return { ...prev, dependencyLinks: [...prev.dependencyLinks, { taskId, type: 'FS' as DependencyType, lagDays: 0 }] };
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleTaskNameChange = useCallback((name: string) => {
    setTaskDraft(prev => {
      const suggested = suggestDuration(name);
      return { ...prev, title: name, durationDays: String(suggested) };
    });
  }, []);

  const fetchWeather = useCallback(async () => {
    try {
      const response = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&daily=precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=7'
      );
      const data = await response.json();
      if (data.daily) {
        const alerts: { taskName: string; date: string; condition: string }[] = [];
        const weatherSensitiveTasks = sortedTasks.filter(t => t.isWeatherSensitive);
        data.daily.time.forEach((date: string, idx: number) => {
          const precip = data.daily.precipitation_probability_max[idx];
          const wind = data.daily.wind_speed_10m_max[idx];
          if (precip > 60 || wind > 40) {
            weatherSensitiveTasks.forEach(task => {
              const { start, end } = getTaskDateRange(task, projectStartDate, activeSchedule?.workingDaysPerWeek ?? 5);
              const forecastDate = new Date(date);
              if (forecastDate >= start && forecastDate <= end) {
                alerts.push({
                  taskName: task.title,
                  date,
                  condition: precip > 60 ? `Rain likely (${precip}%)` : `High wind (${Math.round(wind)} km/h)`,
                });
              }
            });
          }
        });
        setWeatherAlerts(alerts);
        console.log('[Schedule] Weather alerts:', alerts.length);
      }
    } catch (err) {
      console.log('[Schedule] Weather fetch failed:', err);
    }
  }, [sortedTasks, projectStartDate, activeSchedule]);

  const hasSchedule = sortedTasks.length > 0;
  const hasEstimate = selectedProject?.estimate !== null || selectedProject?.linkedEstimate !== null;

  const renderHealthBadge = useCallback(() => {
    const color = getHealthColor(healthScore);
    return (
      <View style={[styles.healthBadge, { backgroundColor: color + '18' }]}>
        <View style={[styles.healthDot, { backgroundColor: color }]} />
        <Text style={[styles.healthScore, { color }]}>{healthScore}</Text>
      </View>
    );
  }, [healthScore]);

  const renderTaskCard = useCallback((task: ScheduleTask) => {
    const statusColor = getStatusColor(task.status);
    const borderColor = getTaskBorderColor(task, projectStartDate, activeSchedule?.workingDaysPerWeek ?? 5);
    const dateRange = activeSchedule ? getTaskDateRange(task, projectStartDate, activeSchedule.workingDaysPerWeek) : null;
    const variance = getBaselineVariance(task, activeSchedule?.baseline);

    return (
      <TouchableOpacity
        key={task.id}
        style={[styles.taskCard, { borderLeftColor: borderColor, borderLeftWidth: 4 }]}
        onPress={() => setTaskDetailModal(task)}
        activeOpacity={0.7}
        testID={`schedule-task-${task.id}`}
      >
        <View style={styles.taskTopRow}>
          <View style={styles.taskBadgeRow}>
            <View style={[styles.statusChip, { backgroundColor: statusColor + '14' }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusChipText, { color: statusColor }]}>{getStatusLabel(task.status)}</Text>
            </View>
            {task.isMilestone && (
              <View style={[styles.tagChip, { backgroundColor: '#007AFF14' }]}>
                <Flag size={9} color="#007AFF" />
                <Text style={[styles.tagChipText, { color: '#007AFF' }]}>Milestone</Text>
              </View>
            )}
            {task.isCriticalPath && (
              <View style={[styles.tagChip, { backgroundColor: '#FF3B3014' }]}>
                <GitBranch size={9} color="#FF3B30" />
              </View>
            )}
            {task.isWeatherSensitive && (
              <Cloud size={12} color="#007AFF" />
            )}
          </View>
          {variance !== null && variance !== 0 && (
            <Text style={[styles.varianceText, { color: variance > 0 ? '#FF3B30' : '#34C759' }]}>
              {variance > 0 ? '+' : ''}{variance}d
            </Text>
          )}
        </View>

        <Text style={styles.taskName}>{task.title}</Text>

        <View style={styles.taskMeta}>
          {dateRange && (
            <Text style={styles.taskMetaText}>
              {formatShortDate(dateRange.start)} – {formatShortDate(dateRange.end)}
            </Text>
          )}
          <Text style={styles.taskMetaText}>{task.durationDays}d</Text>
          {task.crew ? <Text style={styles.taskMetaText}>{task.crew}</Text> : null}
          {task.assignedSubName ? <Text style={[styles.taskMetaText, { color: Colors.primary, fontWeight: '600' as const }]}>👷 {task.assignedSubName}</Text> : null}
        </View>

        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${task.progress}%` as any, backgroundColor: statusColor }]} />
          </View>
          <Text style={styles.progressText}>{task.progress}%</Text>
        </View>

        <View style={styles.taskActions}>
          <View style={styles.progressBtnGroup}>
            {[25, 50, 75, 100].map(val => (
              <Pressable
                key={val}
                style={[styles.progressBtn, task.progress >= val && styles.progressBtnActive]}
                onPress={(e) => { e.stopPropagation(); handleProgressUpdate(task, val); }}
              >
                <Text style={[styles.progressBtnText, task.progress >= val && styles.progressBtnTextActive]}>
                  {val === 100 ? 'Done' : `${val}%`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [activeSchedule, projectStartDate, handleProgressUpdate]);

  const renderFieldMode = useCallback(() => (
    <View style={styles.fieldModeContainer}>
      <View style={styles.fieldModeHeader}>
        <Zap size={20} color="#FF9500" />
        <Text style={styles.fieldModeTitle}>Field Update Mode</Text>
        <TouchableOpacity style={styles.fieldModeClose} onPress={() => setIsFieldMode(false)}>
          <X size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.fieldModeSubtitle}>Today's tasks — tap to update progress</Text>

      {todayTasks.length === 0 && (
        <View style={styles.fieldModeEmpty}>
          <CheckCircle2 size={32} color={Colors.success} />
          <Text style={styles.fieldModeEmptyText}>No tasks scheduled for today</Text>
        </View>
      )}

      {todayTasks.map(task => (
        <View key={task.id} style={styles.fieldCard}>
          <Text style={styles.fieldCardTitle}>{task.title}</Text>
          <View style={styles.fieldProgressRow}>
            <View style={styles.fieldProgressTrack}>
              <View style={[styles.fieldProgressFill, { width: `${task.progress}%` as any }]} />
            </View>
            <Text style={styles.fieldProgressText}>{task.progress}%</Text>
          </View>
          <View style={styles.fieldBtnRow}>
            {[0, 25, 50, 75, 100].map(val => (
              <TouchableOpacity
                key={val}
                style={[styles.fieldBtn, task.progress === val && styles.fieldBtnActive]}
                onPress={() => handleProgressUpdate(task, val)}
              >
                <Text style={[styles.fieldBtnText, task.progress === val && styles.fieldBtnTextActive]}>
                  {val}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.fieldNotes}
            placeholder="Add notes..."
            placeholderTextColor={Colors.textMuted}
            multiline
          />
        </View>
      ))}
    </View>
  ), [todayTasks, handleProgressUpdate]);

  const renderResourceView = useCallback(() => (
    <View style={styles.resourceContainer}>
      <Text style={styles.resourceTitle}>Crew Assignments</Text>
      {Object.entries(crewMap).map(([crew, tasks]) => {
        const totalDays = tasks.reduce((s, t) => s + t.durationDays, 0);
        const avgProgress = tasks.length > 0
          ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length) : 0;

        return (
          <View key={crew} style={styles.resourceCard}>
            <View style={styles.resourceCardHeader}>
              <View style={styles.resourceCrewInfo}>
                <Users size={14} color={Colors.primary} />
                <Text style={styles.resourceCrewName}>{crew}</Text>
              </View>
              <Text style={styles.resourceCrewMeta}>{tasks.length} tasks · {totalDays}d</Text>
            </View>
            <View style={styles.resourceProgressRow}>
              <View style={styles.resourceProgressTrack}>
                <View style={[styles.resourceProgressFill, { width: `${avgProgress}%` as any }]} />
              </View>
              <Text style={styles.resourceProgressText}>{avgProgress}%</Text>
            </View>
            {tasks.map(task => {
              const dateRange = activeSchedule
                ? getTaskDateRange(task, projectStartDate, activeSchedule.workingDaysPerWeek) : null;
              return (
                <TouchableOpacity
                  key={task.id}
                  style={styles.resourceTaskRow}
                  onPress={() => setTaskDetailModal(task)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.resourceTaskDot, { backgroundColor: getStatusColor(task.status) }]} />
                  <Text style={styles.resourceTaskName} numberOfLines={1}>{task.title}</Text>
                  <Text style={styles.resourceTaskDate}>
                    {dateRange ? formatShortDate(dateRange.start) : `Day ${task.startDay}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}
    </View>
  ), [crewMap, activeSchedule, projectStartDate]);

  const renderSummary = useCallback(() => {
    if (!activeSchedule) return null;
    const milestones = sortedTasks.filter(t => t.isMilestone);
    const criticalTasks = sortedTasks.filter(t => t.isCriticalPath);
    const overdueTasks = sortedTasks.filter(t => {
      if (t.status === 'done') return false;
      const { end } = getTaskDateRange(t, projectStartDate, activeSchedule.workingDaysPerWeek);
      return end < new Date();
    });
    const endDate = addWorkingDays(projectStartDate, activeSchedule.totalDurationDays, activeSchedule.workingDaysPerWeek);

    return (
      <View style={styles.summaryContainer}>
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryProjectName}>{selectedProject?.name ?? 'Project'}</Text>
          <Text style={styles.summaryDateRange}>
            {formatShortDate(projectStartDate)} – {formatShortDate(endDate)}
          </Text>
        </View>

        <View style={styles.healthRing}>
          <View style={[styles.healthRingOuter, { borderColor: getHealthColor(healthScore) }]}>
            <Text style={[styles.healthRingScore, { color: getHealthColor(healthScore) }]}>{healthScore}</Text>
            <Text style={styles.healthRingLabel}>Health</Text>
          </View>
        </View>

        <View style={styles.summaryStatsRow}>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryStatValue}>{totalProgress}%</Text>
            <Text style={styles.summaryStatLabel}>Complete</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryStatValue}>{sortedTasks.length}</Text>
            <Text style={styles.summaryStatLabel}>Tasks</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryStatValue}>{daysRemaining}</Text>
            <Text style={styles.summaryStatLabel}>Days Left</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryStatValue, { color: Colors.error }]}>{overdueTasks.length}</Text>
            <Text style={styles.summaryStatLabel}>Overdue</Text>
          </View>
        </View>

        <Text style={styles.summarySectionTitle}>Phase Progress</Text>
        {Object.entries(phaseGroups).map(([phase, tasks]) => {
          const phaseProgress = tasks.length > 0
            ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length) : 0;
          return (
            <View key={phase} style={styles.summaryPhaseRow}>
              <View style={[styles.summaryPhaseDot, { backgroundColor: getPhaseColor(phase) }]} />
              <Text style={styles.summaryPhaseName}>{phase}</Text>
              <View style={styles.summaryPhaseProgressTrack}>
                <View style={[styles.summaryPhaseProgressFill, {
                  width: `${phaseProgress}%` as any,
                  backgroundColor: getPhaseColor(phase),
                }]} />
              </View>
              <Text style={styles.summaryPhasePercent}>{phaseProgress}%</Text>
            </View>
          );
        })}

        {milestones.length > 0 && (
          <>
            <Text style={styles.summarySectionTitle}>Milestones</Text>
            {milestones.map(m => {
              const dr = getTaskDateRange(m, projectStartDate, activeSchedule.workingDaysPerWeek);
              const hit = m.status === 'done';
              const missed = !hit && dr.end < new Date();
              return (
                <View key={m.id} style={styles.summaryMilestoneRow}>
                  <Flag size={12} color={hit ? '#34C759' : missed ? '#FF3B30' : '#FF9500'} />
                  <Text style={styles.summaryMilestoneName}>{m.title}</Text>
                  <View style={[styles.summaryMilestoneChip, {
                    backgroundColor: hit ? '#34C75914' : missed ? '#FF3B3014' : '#FF950014'
                  }]}>
                    <Text style={[styles.summaryMilestoneChipText, {
                      color: hit ? '#34C759' : missed ? '#FF3B30' : '#FF9500'
                    }]}>
                      {hit ? 'Hit' : missed ? 'Missed' : formatShortDate(dr.end)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </>
        )}

        {criticalTasks.length > 0 && (
          <>
            <Text style={styles.summarySectionTitle}>Critical Path</Text>
            {criticalTasks.map(t => (
              <View key={t.id} style={styles.summaryCriticalRow}>
                <View style={styles.summaryCriticalDot} />
                <Text style={styles.summaryCriticalName} numberOfLines={1}>{t.title}</Text>
                <Text style={styles.summaryCriticalDur}>{t.durationDays}d</Text>
              </View>
            ))}
          </>
        )}

        {activeSchedule.riskItems.length > 0 && (
          <>
            <Text style={styles.summarySectionTitle}>Risks</Text>
            {activeSchedule.riskItems.map(risk => (
              <View key={risk.id} style={styles.summaryRiskRow}>
                <AlertTriangle size={13} color={risk.severity === 'high' ? '#FF3B30' : '#FF9500'} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryRiskTitle}>{risk.title}</Text>
                  <Text style={styles.summaryRiskDetail}>{risk.detail}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </View>
    );
  }, [activeSchedule, sortedTasks, phaseGroups, healthScore, totalProgress, daysRemaining, projectStartDate, selectedProject]);

  const hasScheduleData = hasSchedule;

  const renderDesktopTaskListPanel = useCallback(() => {
    if (!activeSchedule) return null;
    return (
      <View style={desktopStyles.taskListPanel}>
        <View style={desktopStyles.taskListHeader}>
          <Text style={desktopStyles.taskListTitle}>Tasks</Text>
          <Text style={desktopStyles.taskListCount}>{sortedTasks.length}</Text>
        </View>
        <FlatList
          data={filteredTasks}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: task }) => {
            const statusColor = getStatusColor(task.status);
            const isSelected = taskDetailModal?.id === task.id;
            return (
              <TouchableOpacity
                style={[desktopStyles.taskListRow, isSelected && desktopStyles.taskListRowSelected]}
                onPress={() => setTaskDetailModal(task)}
                activeOpacity={0.7}
              >
                <View style={[desktopStyles.taskListPhaseBar, { backgroundColor: getPhaseColor(task.phase) }]} />
                <View style={desktopStyles.taskListRowContent}>
                  <Text style={desktopStyles.taskListRowTitle} numberOfLines={1}>{task.title}</Text>
                  <View style={desktopStyles.taskListRowMeta}>
                    <Text style={desktopStyles.taskListRowMetaText}>{task.durationDays}d</Text>
                    <View style={[desktopStyles.taskListRowDot, { backgroundColor: statusColor }]} />
                    <Text style={[desktopStyles.taskListRowMetaText, { color: statusColor }]}>{task.progress}%</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    );
  }, [activeSchedule, filteredTasks, sortedTasks.length, taskDetailModal]);

  const renderDesktopStatusBar = useCallback(() => {
    const completedCount = sortedTasks.filter(t => t.status === 'done').length;
    const inProgressCount = sortedTasks.filter(t => t.status === 'in_progress').length;
    const criticalLen = sortedTasks.filter(t => t.isCriticalPath).length;
    return (
      <View style={desktopStyles.statusBar}>
        <Text style={desktopStyles.statusBarItem}>Tasks: {sortedTasks.length}</Text>
        <View style={desktopStyles.statusBarDivider} />
        <Text style={desktopStyles.statusBarItem}>Done: {completedCount}</Text>
        <View style={desktopStyles.statusBarDivider} />
        <Text style={desktopStyles.statusBarItem}>In Progress: {inProgressCount}</Text>
        <View style={desktopStyles.statusBarDivider} />
        <Text style={[desktopStyles.statusBarItem, { color: getHealthColor(healthScore) }]}>Health: {healthScore}%</Text>
        <View style={desktopStyles.statusBarDivider} />
        <Text style={desktopStyles.statusBarItem}>{daysRemaining} Days Left</Text>
        <View style={desktopStyles.statusBarDivider} />
        <Text style={[desktopStyles.statusBarItem, { color: Colors.error }]}>Critical: {criticalLen}</Text>
      </View>
    );
  }, [sortedTasks, healthScore, daysRemaining]);

  // Shared modals rendered in both desktop and mobile branches. Previously only the
  // mobile branch's return tree contained these modals, so on desktop, tapping
  // "Edit", "AI Builder", "Templates", "What-If Scenarios", or a dep-picker
  // trigger set state but rendered nothing (they live inside an early-return
  // branch the desktop layout never reaches). See bug report 2026-04-23.
  const extraModals = (
    <>
      {/* Edit Task Modal */}
      <Modal visible={isEditModalOpen} transparent animationType="slide" onRequestClose={() => setIsEditModalOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.bottomSheetOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}>
                <View style={styles.bottomSheetHandle} />
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{editingTask ? 'Edit Task' : 'New Task'}</Text>
                  <TouchableOpacity onPress={() => setIsEditModalOpen(false)}>
                    <X size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Task Name</Text>
                <TextInput style={styles.input} value={taskDraft.title} onChangeText={val => setTaskDraft(p => ({ ...p, title: val }))} placeholder="Task name" placeholderTextColor={Colors.textMuted} />

                <Text style={styles.fieldLabel}>Phase</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.phaseScroller}>
                  <View style={styles.phaseChipRow}>
                    {PHASE_OPTIONS.map(phase => (
                      <TouchableOpacity key={phase} style={[styles.phaseChip, taskDraft.phase === phase && styles.phaseChipActive]} onPress={() => setTaskDraft(p => ({ ...p, phase }))}>
                        <Text style={[styles.phaseChipText, taskDraft.phase === phase && styles.phaseChipTextActive]}>{phase}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                {/* Status */}
                {editingTask && (
                  <>
                    <Text style={styles.fieldLabel}>Status</Text>
                    <View style={styles.statusChipRow}>
                      {(['not_started', 'in_progress', 'on_hold', 'done'] as ScheduleTask['status'][]).map(s => {
                        const colors: Record<string, string> = { done: '#34C759', in_progress: '#007AFF', on_hold: '#FF9500', not_started: '#8E8E93' };
                        const labels: Record<string, string> = { done: 'Done', in_progress: 'In Progress', on_hold: 'On Hold', not_started: 'Not Started' };
                        const active = taskDraft.status === s;
                        return (
                          <TouchableOpacity
                            key={s}
                            style={[styles.modalStatusChip, { borderColor: colors[s], backgroundColor: active ? colors[s] : 'transparent' }]}
                            onPress={() => {
                              const autoProgress = s === 'done' ? '100' : s === 'not_started' ? '0' : taskDraft.progress;
                              setTaskDraft(p => ({ ...p, status: s, progress: autoProgress }));
                            }}
                          >
                            <Text style={[styles.modalStatusChipText, { color: active ? '#FFF' : colors[s] }]}>{labels[s]}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={styles.fieldLabel}>Progress — {taskDraft.progress}%</Text>
                    <View style={styles.modalProgressRow}>
                      {[0, 25, 50, 75, 100].map(pct => (
                        <TouchableOpacity
                          key={pct}
                          style={[styles.modalProgressBtn, parseInt(taskDraft.progress, 10) === pct && styles.modalProgressBtnActive]}
                          onPress={() => {
                            const nextStatus = pct >= 100 ? 'done' as const : pct > 0 ? 'in_progress' as const : 'not_started' as const;
                            setTaskDraft(p => ({ ...p, progress: String(pct), status: nextStatus }));
                          }}
                        >
                          <Text style={[styles.modalProgressBtnText, parseInt(taskDraft.progress, 10) === pct && styles.modalProgressBtnTextActive]}>{pct}%</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                <View style={styles.dualRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Duration (days)</Text>
                    <TextInput style={styles.input} value={taskDraft.durationDays} onChangeText={val => setTaskDraft(p => ({ ...p, durationDays: val }))} keyboardType="number-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Crew Size</Text>
                    <TextInput style={styles.input} value={taskDraft.crewSize} onChangeText={val => setTaskDraft(p => ({ ...p, crewSize: val }))} keyboardType="number-pad" placeholder="# people" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <View style={styles.dualRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Crew / Trade</Text>
                    <TextInput style={styles.input} value={taskDraft.crew} onChangeText={val => setTaskDraft(p => ({ ...p, crew: val }))} placeholder="Crew name" placeholderTextColor={Colors.textMuted} />
                  </View>
                  {editingTask && taskDraft.dependencyLinks.length === 0 && (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Start Day Override</Text>
                      <TextInput style={styles.input} value={taskDraft.startDayOverride} onChangeText={val => setTaskDraft(p => ({ ...p, startDayOverride: val }))} keyboardType="number-pad" placeholder="Auto" placeholderTextColor={Colors.textMuted} />
                    </View>
                  )}
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={styles.fieldLabel}>Assign Subcontractor</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                    <TouchableOpacity
                      style={[styles.phaseChip, !taskDraft.assignedSubId && styles.phaseChipActive]}
                      onPress={() => setTaskDraft(p => ({ ...p, assignedSubId: '', assignedSubName: '' }))}
                    >
                      <Text style={[styles.phaseChipText, !taskDraft.assignedSubId && styles.phaseChipTextActive]}>None</Text>
                    </TouchableOpacity>
                    {contacts.filter(c => c.role === 'Sub').map(sub => {
                      const displayName = `${sub.firstName} ${sub.lastName}`.trim() || sub.companyName || 'Sub';
                      const active = taskDraft.assignedSubId === sub.id;
                      return (
                        <TouchableOpacity
                          key={sub.id}
                          style={[styles.phaseChip, active && styles.phaseChipActive]}
                          onPress={() => setTaskDraft(p => ({ ...p, assignedSubId: sub.id, assignedSubName: displayName }))}
                        >
                          <Text style={[styles.phaseChipText, active && styles.phaseChipTextActive]} numberOfLines={1}>
                            {displayName}{sub.companyName ? ` · ${sub.companyName}` : ''}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {contacts.filter(c => c.role === 'Sub').length === 0 ? (
                      <Text style={{ fontSize: 12, color: Colors.textMuted, alignSelf: 'center' as const, paddingHorizontal: 8 }}>
                        No subs in contacts. Add one from the Contacts tab.
                      </Text>
                    ) : null}
                  </ScrollView>
                </View>

                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}><Flag size={14} color="#FF9500" /><Text style={styles.toggleLabel}>Milestone</Text></View>
                  <Switch value={taskDraft.isMilestone} onValueChange={val => setTaskDraft(p => ({ ...p, isMilestone: val }))} trackColor={{ false: Colors.border, true: '#FF9500' }} thumbColor="#FFF" />
                </View>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}><GitBranch size={14} color={Colors.error} /><Text style={styles.toggleLabel}>Critical Path</Text></View>
                  <Switch value={taskDraft.isCriticalPath} onValueChange={val => setTaskDraft(p => ({ ...p, isCriticalPath: val }))} trackColor={{ false: Colors.border, true: Colors.error }} thumbColor="#FFF" />
                </View>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}><Cloud size={14} color="#007AFF" /><Text style={styles.toggleLabel}>Weather Sensitive</Text></View>
                  <Switch value={taskDraft.isWeatherSensitive} onValueChange={val => setTaskDraft(p => ({ ...p, isWeatherSensitive: val }))} trackColor={{ false: Colors.border, true: '#007AFF' }} thumbColor="#FFF" />
                </View>

                <Text style={styles.fieldLabel}>Predecessors {taskDraft.dependencyLinks.length > 0 ? '(controls start day)' : '(optional)'}</Text>
                <TouchableOpacity style={styles.depPickerBtn} onPress={() => setShowDepPicker(true)}>
                  <Link2 size={14} color={Colors.info} />
                  <Text style={styles.depPickerBtnText}>{taskDraft.dependencyLinks.length > 0 ? `${taskDraft.dependencyLinks.length} predecessor${taskDraft.dependencyLinks.length > 1 ? 's' : ''} linked` : 'Tap to link predecessors'}</Text>
                </TouchableOpacity>
                {/* Dep type and lag per link */}
                {taskDraft.dependencyLinks.length > 0 && (
                  <View style={styles.depDetailList}>
                    {taskDraft.dependencyLinks.map(link => {
                      const depTask = sortedTasks.find(t => t.id === link.taskId);
                      if (!depTask) return null;
                      return (
                        <View key={link.taskId} style={styles.depDetailRow}>
                          <Text style={styles.depDetailName} numberOfLines={1}>{depTask.title}</Text>
                          <View style={styles.depTypeRow}>
                            {(['FS', 'SS', 'FF', 'SF'] as DependencyType[]).map(type => (
                              <TouchableOpacity
                                key={type}
                                style={[styles.depTypeBtn, link.type === type && styles.depTypeBtnActive]}
                                onPress={() => setTaskDraft(p => ({
                                  ...p,
                                  dependencyLinks: p.dependencyLinks.map(l =>
                                    l.taskId === link.taskId ? { ...l, type } : l
                                  ),
                                }))}
                              >
                                <Text style={[styles.depTypeBtnText, link.type === type && styles.depTypeBtnTextActive]}>{type}</Text>
                              </TouchableOpacity>
                            ))}
                            <TextInput
                              style={styles.lagInput}
                              value={String(link.lagDays || 0)}
                              onChangeText={val => setTaskDraft(p => ({
                                ...p,
                                dependencyLinks: p.dependencyLinks.map(l =>
                                  l.taskId === link.taskId ? { ...l, lagDays: parseInt(val, 10) || 0 } : l
                                ),
                              }))}
                              keyboardType="number-pad"
                              placeholder="+lag"
                              placeholderTextColor={Colors.textMuted}
                            />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
                {editingTask && taskDraft.dependencyLinks.length > 0 && (
                  <View style={styles.cascadeNote}>
                    <Text style={styles.cascadeNoteText}>Linked successors will auto-shift when duration changes</Text>
                  </View>
                )}

                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: 'top' as const }]} value={taskDraft.notes} onChangeText={val => setTaskDraft(p => ({ ...p, notes: val }))} placeholder="Notes..." placeholderTextColor={Colors.textMuted} multiline />

                <View style={styles.editActionRow}>
                  <TouchableOpacity style={styles.editCancelBtn} onPress={() => setIsEditModalOpen(false)}>
                    <Text style={styles.editCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editSaveBtn} onPress={handleEditSave}>
                    <Text style={styles.editSaveBtnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Dependency Picker */}
      <Modal visible={showDepPicker} transparent animationType="fade" onRequestClose={() => setShowDepPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowDepPicker(false)}>
          <Pressable style={[styles.modalCard, { maxHeight: '80%' }]} onPress={() => undefined}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Link Predecessors</Text>
              <TouchableOpacity onPress={() => setShowDepPicker(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {sortedTasks.filter(t => t.id !== editingTask?.id).map(task => {
                const isSelected = taskDraft.dependencyLinks.some(l => l.taskId === task.id);
                return (
                  <TouchableOpacity key={task.id} style={[styles.depOption, isSelected && styles.depOptionSelected]} onPress={() => toggleDep(task.id)}>
                    <View style={[styles.depCheckbox, isSelected && styles.depCheckboxSelected]}>
                      {isSelected && <CheckCircle2 size={14} color="#FFF" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.depOptionTitle}>{task.title}</Text>
                      <Text style={styles.depOptionMeta}>{task.phase} · {task.durationDays}d</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.depDoneBtn} onPress={() => setShowDepPicker(false)}>
              <Text style={styles.depDoneBtnText}>Done ({taskDraft.dependencyLinks.length})</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* AI Builder Modal */}
      <Modal visible={isAIBuilderOpen} transparent animationType="slide" onRequestClose={() => setIsAIBuilderOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.bottomSheetOverlay}>
            <Pressable style={{ flex: 1 }} onPress={() => setIsAIBuilderOpen(false)} />
            <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.bottomSheetHandle} />
              <View style={styles.aiHeader}>
                <Sparkles size={22} color="#FF9500" />
                <Text style={styles.aiTitle}>AI Schedule Builder</Text>
              </View>
              <Text style={styles.aiSubtitle}>
                Describe your project and we&apos;ll generate a complete schedule with phases, tasks, durations, and dependencies.
              </Text>
              <TextInput
                style={styles.aiInput}
                value={aiPrompt}
                onChangeText={setAiPrompt}
                placeholder="e.g. 3,000 sq ft home renovation. Gut kitchen and two bathrooms, new flooring throughout, paint the whole house. 12 weeks total."
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.aiGenerateBtn, isAILoading && { opacity: 0.6 }]}
                onPress={handleAIGenerate}
                disabled={isAILoading}
                activeOpacity={0.85}
              >
                {isAILoading ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Sparkles size={16} color="#FFF" />
                )}
                <Text style={styles.aiGenerateBtnText}>
                  {isAILoading ? 'Building your schedule...' : 'Generate Schedule'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* What-If Scenarios */}
      {activeSchedule && (
        <ScenariosModal
          visible={showScenariosModal}
          onClose={() => setShowScenariosModal(false)}
          schedule={activeSchedule}
          onScheduleChange={handleScheduleScenariosChange}
        />
      )}

      {/* Template Picker */}
      <Modal visible={isTemplatePickerOpen} transparent animationType="slide" onRequestClose={() => setIsTemplatePickerOpen(false)}>
        <View style={styles.bottomSheetOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setIsTemplatePickerOpen(false)} />
          <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16, maxHeight: '75%' }]}>
            <View style={styles.bottomSheetHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Schedule Templates</Text>
              <TouchableOpacity onPress={() => setIsTemplatePickerOpen(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {SCHEDULE_TEMPLATES.map(template => (
                <TouchableOpacity
                  key={template.id}
                  style={styles.templateCard}
                  onPress={() => handleTemplateSelect(template, projectStartDate)}
                  activeOpacity={0.7}
                >
                  <View style={styles.templateInfo}>
                    <Text style={styles.templateName}>{template.name}</Text>
                    <Text style={styles.templateMeta}>
                      {template.taskCount} tasks · {template.typicalDuration}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );

  if (layout.isDesktop && hasScheduleData && activeSchedule) {
    return (
      <View style={styles.container}>
        <View style={desktopStyles.desktopHeader}>
          <View style={desktopStyles.desktopHeaderLeft}>
            <TouchableOpacity
              style={styles.projectPickerBtn}
              onPress={() => setIsProjectPickerOpen(true)}
              activeOpacity={0.8}
            >
              <FolderOpen size={15} color={Colors.primary} />
              <Text style={styles.projectPickerText} numberOfLines={1}>
                {selectedProject?.name ?? 'Select project'}
              </Text>
              <ChevronDown size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.viewTabBar}>
              {([
                { key: 'today' as const, label: 'Today', icon: CalendarDays },
                { key: 'lookahead' as const, label: 'Lookahead', icon: ChevronRight },
                { key: 'board' as const, label: 'Board', icon: LayoutGrid },
                { key: 'gantt' as const, label: 'Gantt', icon: BarChart3 },
                { key: 'resources' as const, label: 'Crew', icon: Users },
                { key: 'summary' as const, label: 'Summary', icon: Target },
              ]).map(tab => {
                const Icon = tab.icon;
                const active = viewMode === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.viewTab, active && styles.viewTabActive]}
                    onPress={() => { setViewMode(tab.key); setIsFieldMode(false); }}
                    activeOpacity={0.7}
                  >
                    <Icon size={14} color={active ? Colors.textOnPrimary : Colors.textSecondary} />
                    <Text style={[styles.viewTabText, active && styles.viewTabTextActive]}>{tab.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          {/* Open in Schedule Pro — MS-Project-style grid + CPM, web/iPad only.
              Only rendered when a project is selected; routes to /schedule-pro. */}
          {selectedProjectId && (
            <TouchableOpacity
              style={desktopStyles.proBtn}
              onPress={() => router.push({ pathname: '/schedule-pro', params: { projectId: selectedProjectId } } as any)}
              activeOpacity={0.85}
              testID="open-schedule-pro"
            >
              <Zap size={14} color={Colors.textOnPrimary} />
              <Text style={desktopStyles.proBtnText}>Pro</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.fab}
            onPress={() => { setTaskDraft({ ...EMPTY_DRAFT }); setQuickAddCount(0); setIsQuickAddOpen(true); }}
            activeOpacity={0.85}
          >
            <Plus size={18} color="#FFF" />
          </TouchableOpacity>
        </View>

        {activeSchedule && (
          <View style={styles.projectStartBar}>
            <CalendarDays size={14} color={Colors.textMuted} />
            <Text style={styles.projectStartLabel}>Starts</Text>
            <Text style={styles.projectStartValue}>{projectStartDate.toLocaleDateString()}</Text>
            <TouchableOpacity
              style={styles.projectStartEdit}
              onPress={() => {
                const yyyy = projectStartDate.getFullYear();
                const mm = String(projectStartDate.getMonth() + 1).padStart(2, '0');
                const dd = String(projectStartDate.getDate()).padStart(2, '0');
                setProjectStartDateInput(`${yyyy}-${mm}-${dd}`);
                setIsProjectStartDatePickerOpen(true);
              }}
              testID="edit-project-start-date-desktop"
            >
              <Text style={styles.projectStartEditText}>Change</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={desktopStyles.splitContainer}>
          {viewMode === 'gantt' && renderDesktopTaskListPanel()}
          <View style={desktopStyles.mainPanel}>
            <ScrollView
              contentContainerStyle={{ paddingBottom: 60 }}
              showsVerticalScrollIndicator={false}
            >
              {viewMode === 'today' && (
                <TodayView
                  tasks={sortedTasks}
                  schedule={activeSchedule}
                  projectStartDate={projectStartDate}
                  onProgressUpdate={handleProgressUpdate}
                  onTaskPress={setTaskDetailModal}
                  onPhotoAdded={handlePhotoAdded}
                  healthScore={healthScore}
                  daysRemaining={daysRemaining}
                />
              )}
              {viewMode === 'lookahead' && (
                <LookaheadView
                  tasks={sortedTasks}
                  schedule={activeSchedule}
                  projectStartDate={projectStartDate}
                  onProgressUpdate={handleProgressUpdate}
                  onTaskPress={setTaskDetailModal}
                />
              )}
              {viewMode === 'board' && (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar}>
                    <View style={styles.filterChipRow}>
                      {([
                        { key: 'all' as const, label: 'All' },
                        { key: 'critical' as const, label: 'Critical Path' },
                        { key: 'milestones' as const, label: 'Milestones' },
                        { key: 'overdue' as const, label: 'Overdue' },
                      ]).map(f => (
                        <TouchableOpacity
                          key={f.key}
                          style={[styles.filterChip, filterMode === f.key && styles.filterChipActive]}
                          onPress={() => setFilterMode(f.key)}
                        >
                          <Text style={[styles.filterChipText, filterMode === f.key && styles.filterChipTextActive]}>
                            {f.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                  {Object.entries(phaseGroups).map(([phase, tasks]) => {
                    const isCollapsed = collapsedPhases[phase] === true;
                    const phaseProgress = tasks.length > 0
                      ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length) : 0;
                    return (
                      <View key={phase} style={styles.phaseSection}>
                        <TouchableOpacity style={styles.phaseHeader} onPress={() => togglePhaseCollapse(phase)} activeOpacity={0.7}>
                          <View style={styles.phaseHeaderLeft}>
                            <View style={[styles.phaseColorDot, { backgroundColor: getPhaseColor(phase) }]} />
                            <ChevronRight size={14} color={Colors.textSecondary} style={isCollapsed ? undefined : { transform: [{ rotate: '90deg' }] }} />
                            <Text style={styles.phaseHeaderName}>{phase}</Text>
                          </View>
                          <View style={styles.phaseHeaderRight}>
                            <View style={styles.phaseProgressMini}>
                              <View style={[styles.phaseProgressMiniFill, { width: `${phaseProgress}%` as any, backgroundColor: getPhaseColor(phase) }]} />
                            </View>
                            <Text style={styles.phaseHeaderMeta}>{phaseProgress}% · {tasks.length}</Text>
                          </View>
                        </TouchableOpacity>
                        {!isCollapsed && <View style={styles.phaseTaskList}>{tasks.map(renderTaskCard)}</View>}
                      </View>
                    );
                  })}
                </>
              )}
              {viewMode === 'gantt' && (
                <View style={styles.ganttWrapper}>
                  {activeScenarioTasks && (
                    <TouchableOpacity
                      style={styles.scenarioBanner}
                      onPress={() => setShowScenariosModal(true)}
                      activeOpacity={0.85}
                      testID="scenario-banner"
                    >
                      <GitBranch size={13} color={Colors.primary} />
                      <Text style={styles.scenarioBannerText} numberOfLines={1}>
                        Viewing What-If scenario (read-only). Tap to manage.
                      </Text>
                    </TouchableOpacity>
                  )}
                  <View style={styles.ganttControls}>
                    <TouchableOpacity style={[styles.ganttOrientBtn, !isVerticalGantt && styles.ganttOrientBtnActive]} onPress={() => setIsVerticalGantt(false)}>
                      <BarChart3 size={12} color={!isVerticalGantt ? '#FFF' : Colors.textSecondary} />
                      <Text style={[styles.ganttOrientBtnText, !isVerticalGantt && styles.ganttOrientBtnTextActive]}>Horizontal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.ganttOrientBtn, isVerticalGantt && styles.ganttOrientBtnActive]} onPress={() => setIsVerticalGantt(true)}>
                      <CalendarDays size={12} color={isVerticalGantt ? '#FFF' : Colors.textSecondary} />
                      <Text style={[styles.ganttOrientBtnText, isVerticalGantt && styles.ganttOrientBtnTextActive]}>Vertical</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity style={[styles.baselineToggle, showBaseline && styles.baselineToggleActive]} onPress={() => setShowBaseline(!showBaseline)}>
                      <Text style={[styles.baselineToggleText, showBaseline && styles.baselineToggleTextActive]}>Baseline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.saveBaselineBtn} onPress={handleSaveBaseline}>
                      <Save size={13} color={Colors.primary} />
                      <Text style={styles.saveBaselineBtnText}>Save Baseline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.saveBaselineBtn}
                      onPress={() => setShowScenariosModal(true)}
                      testID="scenarios-open-btn"
                    >
                      <GitBranch size={13} color={Colors.primary} />
                      <Text style={styles.saveBaselineBtnText}>What-If</Text>
                    </TouchableOpacity>
                  </View>
                  {isVerticalGantt ? (
                    <VerticalGantt schedule={activeSchedule} tasks={sortedTasks} projectStartDate={projectStartDate} onTaskPress={setTaskDetailModal} showBaseline={showBaseline} />
                  ) : (
                    <GanttChart schedule={activeSchedule} tasks={sortedTasks} projectStartDate={projectStartDate} onTaskPress={setTaskDetailModal} showBaseline={showBaseline} forecast={ganttForecast} />
                  )}
                </View>
              )}
              {viewMode === 'resources' && renderResourceView()}
              {viewMode === 'summary' && renderSummary()}
            </ScrollView>
          </View>
        </View>

        {renderDesktopStatusBar()}

        <Modal visible={isProjectPickerOpen} transparent animationType="fade" onRequestClose={() => setIsProjectPickerOpen(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setIsProjectPickerOpen(false)}>
            <Pressable style={styles.modalCard} onPress={() => undefined}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Project</Text>
                <TouchableOpacity onPress={() => setIsProjectPickerOpen(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 400 }}>
                {projects.map(project => (
                  <TouchableOpacity
                    key={project.id}
                    style={[styles.pickerOption, selectedProjectId === project.id && styles.pickerOptionSelected]}
                    onPress={() => { setSelectedProjectId(project.id); setIsProjectPickerOpen(false); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.pickerOptionTitle}>{project.name}</Text>
                    <Text style={styles.pickerOptionMeta}>
                      {project.schedule ? `${project.schedule.tasks.length} tasks` : 'No schedule'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
        <Modal visible={isProjectStartDatePickerOpen} transparent animationType="fade" onRequestClose={() => setIsProjectStartDatePickerOpen(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setIsProjectStartDatePickerOpen(false)}>
            <Pressable style={[styles.modalCard, { maxWidth: 380, alignSelf: 'center' }]} onPress={() => undefined}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Project Start Date</Text>
              </View>
              <Text style={styles.quickAddHint}>
                This is Day 1 of the schedule. Changing it shifts every task&apos;s calendar dates but keeps their relative order.
              </Text>
              <TextInput
                style={[styles.quickAddInput, { marginTop: 10 }]}
                value={projectStartDateInput}
                onChangeText={setProjectStartDateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  style={[styles.addTaskBtn, { flex: 1, backgroundColor: Colors.surfaceAlt }]}
                  onPress={() => setIsProjectStartDatePickerOpen(false)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.addTaskBtnText, { color: Colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addTaskBtn, { flex: 1 }]}
                  onPress={() => setProjectStartDate(projectStartDateInput)}
                  activeOpacity={0.85}
                  testID="save-project-start-date"
                >
                  <Check size={16} color="#FFF" />
                  <Text style={styles.addTaskBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal visible={isQuickAddOpen} transparent animationType="slide" onRequestClose={() => setIsQuickAddOpen(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.bottomSheetOverlay}>
              <Pressable style={{ flex: 1 }} onPress={() => setIsQuickAddOpen(false)} />
              <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}>
                <View style={styles.bottomSheetHandle} />
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Quick Add Task</Text>
                </View>
                <TextInput
                  style={styles.quickAddInput}
                  value={taskDraft.title}
                  onChangeText={handleTaskNameChange}
                  placeholder="Task name..."
                  placeholderTextColor={Colors.textMuted}
                  autoFocus
                />
                <View style={{ marginTop: 4 }}>
                  <Text style={styles.quickAddFieldLabel}>Start date</Text>
                  {(() => {
                    const wdpw = activeSchedule?.workingDaysPerWeek ?? 5;
                    const toISO = (d: Date) => {
                      const y = d.getFullYear();
                      const m = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      return `${y}-${m}-${day}`;
                    };
                    const suggestions: { key: string; label: string; date: Date; iso: string }[] = [];
                    suggestions.push({
                      key: 'project-start',
                      label: 'Project Start',
                      date: projectStartDate,
                      iso: toISO(projectStartDate),
                    });
                    const recent = sortedTasks.slice(-6);
                    recent.forEach((t) => {
                      const { end } = getTaskDateRange(t, projectStartDate, wdpw);
                      const next = addWorkingDays(end, 1, wdpw);
                      suggestions.push({
                        key: `after-${t.id}`,
                        label: `After ${t.title}`,
                        date: next,
                        iso: toISO(next),
                      });
                    });
                    const pickChip = (iso: string) => {
                      setTaskDraft(prev => ({ ...prev, startDateOverride: iso }));
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    };
                    return (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.quickAddDateScroller}
                        contentContainerStyle={styles.quickAddDateChipRow}
                      >
                        {suggestions.map((s) => {
                          const active = taskDraft.startDateOverride === s.iso;
                          return (
                            <TouchableOpacity
                              key={s.key}
                              onPress={() => pickChip(s.iso)}
                              activeOpacity={0.75}
                              style={[styles.quickAddDateChip, active && styles.quickAddDateChipActive]}
                            >
                              <Text
                                style={[styles.quickAddDateChipLabel, active && styles.quickAddDateChipLabelActive]}
                                numberOfLines={1}
                              >
                                {s.label}
                              </Text>
                              <Text
                                style={[styles.quickAddDateChipValue, active && styles.quickAddDateChipValueActive]}
                              >
                                {formatShortDate(s.date)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    );
                  })()}
                </View>
                <View style={styles.quickAddFieldRow}>
                  <View style={styles.quickAddField}>
                    <Text style={styles.quickAddFieldLabel}>Custom date</Text>
                    <TextInput
                      style={styles.quickAddSmallInput}
                      value={taskDraft.startDateOverride}
                      onChangeText={(text) => setTaskDraft(prev => ({ ...prev, startDateOverride: text }))}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                    />
                  </View>
                  <View style={styles.quickAddField}>
                    <Text style={styles.quickAddFieldLabel}>Duration (days)</Text>
                    <TextInput
                      style={styles.quickAddSmallInput}
                      value={taskDraft.durationDays}
                      onChangeText={(text) => setTaskDraft(prev => ({ ...prev, durationDays: text.replace(/[^0-9]/g, '') }))}
                      placeholder="5"
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
                <Text style={styles.quickAddHint}>
                  Project starts {projectStartDate.toLocaleDateString()} · leave custom date blank to chain after the last task
                </Text>
                <TouchableOpacity style={styles.addTaskBtn} onPress={handleQuickAdd} activeOpacity={0.85}>
                  <Plus size={16} color="#FFF" />
                  <Text style={styles.addTaskBtnText}>Add Task</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
        <Modal visible={taskDetailModal !== null} transparent animationType="fade" onRequestClose={() => setTaskDetailModal(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setTaskDetailModal(null)}>
            <Pressable style={[styles.modalCard, { maxHeight: '85%' }]} onPress={() => undefined}>
              {taskDetailModal && (() => {
                const task = taskDetailModal;
                const statusColor = getStatusColor(task.status);
                return (
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={styles.modalHeader}>
                      <Text style={[styles.modalTitle, { flex: 1, marginRight: 12 }]}>{task.title}</Text>
                      <TouchableOpacity onPress={() => setTaskDetailModal(null)}>
                        <X size={20} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.detailProgressRow}>
                      {[0, 25, 50, 75, 100].map(val => (
                        <TouchableOpacity
                          key={val}
                          style={[styles.detailProgressBtn, task.progress === val && styles.detailProgressBtnActive]}
                          onPress={() => { handleProgressUpdate(task, val); setTaskDetailModal({ ...task, progress: val, status: val >= 100 ? 'done' : val > 0 ? 'in_progress' : 'not_started' }); }}
                        >
                          <Text style={[styles.detailProgressBtnText, task.progress === val && styles.detailProgressBtnTextActive]}>
                            {val === 100 ? 'Done' : `${val}%`}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.detailActions}>
                      <TouchableOpacity style={styles.detailEditBtn} onPress={() => openEditTask(task)}>
                        <Text style={styles.detailEditBtnText}>Edit Task</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.detailDeleteBtn} onPress={() => { setTaskDetailModal(null); handleDeleteTask(task.id); }}>
                        <Trash2 size={16} color="#FF3B30" />
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                );
              })()}
            </Pressable>
          </Pressable>
        </Modal>
        {activeSchedule && (
          <ScheduleShareSheet
            visible={isShareSheetOpen}
            onClose={() => setIsShareSheetOpen(false)}
            schedule={activeSchedule}
            tasks={sortedTasks}
            projectStartDate={projectStartDate}
            projectName={selectedProject?.name ?? 'Project'}
          />
        )}
        <QuickBuildModal
          visible={isQuickBuildOpen}
          onClose={() => setIsQuickBuildOpen(false)}
          onTemplateSelect={handleTemplateSelect}
        />
        {extraModals}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Schedule</Text>
              <Text style={styles.subtitle}>Plan, track, and manage your project timeline</Text>
            </View>
            {hasScheduleData && renderHealthBadge()}
          </View>
        </View>

        <View style={styles.projectPickerRow}>
          <TouchableOpacity
            style={styles.projectPickerBtn}
            onPress={() => setIsProjectPickerOpen(true)}
            activeOpacity={0.8}
            testID="schedule-project-picker"
          >
            <FolderOpen size={15} color={Colors.primary} />
            <Text style={styles.projectPickerText} numberOfLines={1}>
              {selectedProject?.name ?? 'Select project'}
            </Text>
            <ChevronDown size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {!selectedProject && (
          <View style={styles.emptyPrompt}>
            <CalendarDays size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Project Selected</Text>
            <Text style={styles.emptyDesc}>Select a project above to view or create a schedule.</Text>
          </View>
        )}

        {selectedProject && !hasScheduleData && (
          <View style={styles.emptySchedule}>
            <CalendarDays size={44} color={Colors.primary} />
            <Text style={styles.emptyTitle}>Build Your Schedule</Text>
            <Text style={styles.emptyDesc}>Choose how to get started:</Text>

            <TouchableOpacity style={styles.emptyAction} onPress={() => setIsAIBuilderOpen(true)}>
              <Sparkles size={20} color="#FF9500" />
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyActionTitle}>Generate with AI</Text>
                <Text style={styles.emptyActionDesc}>Describe your project, get a full schedule in seconds</Text>
              </View>
              <ChevronRight size={16} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.emptyAction} onPress={() => setIsTemplatePickerOpen(true)}>
              <FileText size={20} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyActionTitle}>Start from Template</Text>
                <Text style={styles.emptyActionDesc}>Kitchen, bathroom, new home, and more</Text>
              </View>
              <ChevronRight size={16} color={Colors.textMuted} />
            </TouchableOpacity>

            {hasEstimate && (
              <TouchableOpacity style={styles.emptyAction} onPress={handleBuildFromEstimate}>
                <BarChart3 size={20} color={Colors.info} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.emptyActionTitle}>Build from Estimate</Text>
                  <Text style={styles.emptyActionDesc}>Auto-generate tasks from your estimate line items</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.emptyManualBtn}
              onPress={() => { setTaskDraft({ ...EMPTY_DRAFT }); setIsQuickAddOpen(true); }}
            >
              <Plus size={16} color={Colors.textOnPrimary} />
              <Text style={styles.emptyManualBtnText}>Add Tasks Manually</Text>
            </TouchableOpacity>
          </View>
        )}

        {hasScheduleData && activeSchedule && (
          <>
            {weatherAlerts.length > 0 && (
              <View style={styles.weatherBanner}>
                <CloudRain size={16} color="#FF9500" />
                <Text style={styles.weatherBannerText}>
                  {weatherAlerts.length} weather alert{weatherAlerts.length > 1 ? 's' : ''} for upcoming tasks
                </Text>
                <TouchableOpacity onPress={() => setWeatherAlerts([])}>
                  <X size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.topBar}>
              <View style={styles.topBarStats}>
                <View style={styles.topBarStat}>
                  <Text style={styles.topBarStatValue}>{totalProgress}%</Text>
                  <Text style={styles.topBarStatLabel}>Done</Text>
                </View>
                <View style={styles.topBarDivider} />
                <View style={styles.topBarStat}>
                  <Text style={styles.topBarStatValue}>{daysRemaining}</Text>
                  <Text style={styles.topBarStatLabel}>Days Left</Text>
                </View>
                <View style={styles.topBarDivider} />
                <View style={styles.topBarStat}>
                  <Text style={styles.topBarStatValue}>{sortedTasks.length}</Text>
                  <Text style={styles.topBarStatLabel}>Tasks</Text>
                </View>
              </View>
              <View style={styles.overallProgress}>
                <View style={[styles.overallProgressFill, { width: `${totalProgress}%` as any }]} />
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.viewTabScroll}>
              <View style={styles.viewTabBar}>
                {([
                  { key: 'today' as const, label: 'Today', icon: CalendarDays },
                  { key: 'lookahead' as const, label: 'Lookahead', icon: ChevronRight },
                  { key: 'board' as const, label: 'Board', icon: LayoutGrid },
                  { key: 'gantt' as const, label: 'Gantt', icon: BarChart3 },
                  { key: 'resources' as const, label: 'Crew', icon: Users },
                  { key: 'summary' as const, label: 'Summary', icon: Target },
                ]).map(tab => {
                  const Icon = tab.icon;
                  const active = viewMode === tab.key;
                  return (
                    <TouchableOpacity
                      key={tab.key}
                      style={[styles.viewTab, active && styles.viewTabActive]}
                      onPress={() => { setViewMode(tab.key); setIsFieldMode(false); }}
                      activeOpacity={0.7}
                    >
                      <Icon size={14} color={active ? Colors.textOnPrimary : Colors.textSecondary} />
                      <Text style={[styles.viewTabText, active && styles.viewTabTextActive]}>{tab.label}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={styles.weatherBtn}
                  onPress={fetchWeather}
                >
                  <Cloud size={13} color="#007AFF" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.fieldModeBtn, isFieldMode && styles.fieldModeBtnActive]}
                  onPress={() => setIsFieldMode(!isFieldMode)}
                >
                  <Zap size={13} color={isFieldMode ? '#FFF' : '#FF9500'} />
                </TouchableOpacity>
              </View>
            </ScrollView>

            {activeSchedule && !isFieldMode && (
              <View style={styles.projectStartBar}>
                <CalendarDays size={14} color={Colors.textMuted} />
                <Text style={styles.projectStartLabel}>Starts</Text>
                <Text style={styles.projectStartValue}>{projectStartDate.toLocaleDateString()}</Text>
                <TouchableOpacity
                  style={styles.projectStartEdit}
                  onPress={() => {
                    const yyyy = projectStartDate.getFullYear();
                    const mm = String(projectStartDate.getMonth() + 1).padStart(2, '0');
                    const dd = String(projectStartDate.getDate()).padStart(2, '0');
                    setProjectStartDateInput(`${yyyy}-${mm}-${dd}`);
                    setIsProjectStartDatePickerOpen(true);
                  }}
                  testID="edit-project-start-date-mobile"
                >
                  <Text style={styles.projectStartEditText}>Change</Text>
                </TouchableOpacity>
              </View>
            )}

            {isFieldMode ? renderFieldMode() : (
              <>
                {viewMode === 'today' && activeSchedule && (
                  <TodayView
                    tasks={sortedTasks}
                    schedule={activeSchedule}
                    projectStartDate={projectStartDate}
                    onProgressUpdate={handleProgressUpdate}
                    onTaskPress={setTaskDetailModal}
                    onPhotoAdded={handlePhotoAdded}
                    healthScore={healthScore}
                    daysRemaining={daysRemaining}
                  />
                )}

                {viewMode === 'lookahead' && activeSchedule && (
                  <LookaheadView
                    tasks={sortedTasks}
                    schedule={activeSchedule}
                    projectStartDate={projectStartDate}
                    onProgressUpdate={handleProgressUpdate}
                    onTaskPress={setTaskDetailModal}
                  />
                )}

                {viewMode === 'board' && (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar}>
                      <View style={styles.filterChipRow}>
                        {([
                          { key: 'all' as const, label: 'All' },
                          { key: 'critical' as const, label: 'Critical Path' },
                          { key: 'milestones' as const, label: 'Milestones' },
                          { key: 'overdue' as const, label: 'Overdue' },
                        ]).map(f => (
                          <TouchableOpacity
                            key={f.key}
                            style={[styles.filterChip, filterMode === f.key && styles.filterChipActive]}
                            onPress={() => setFilterMode(f.key)}
                          >
                            <Text style={[styles.filterChipText, filterMode === f.key && styles.filterChipTextActive]}>
                              {f.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>

                    {Object.entries(phaseGroups).map(([phase, tasks]) => {
                      const isCollapsed = collapsedPhases[phase] === true;
                      const phaseProgress = tasks.length > 0
                        ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length) : 0;
                      return (
                        <View key={phase} style={styles.phaseSection}>
                          <TouchableOpacity
                            style={styles.phaseHeader}
                            onPress={() => togglePhaseCollapse(phase)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.phaseHeaderLeft}>
                              <View style={[styles.phaseColorDot, { backgroundColor: getPhaseColor(phase) }]} />
                              <ChevronRight
                                size={14}
                                color={Colors.textSecondary}
                                style={isCollapsed ? undefined : { transform: [{ rotate: '90deg' }] }}
                              />
                              <Text style={styles.phaseHeaderName}>{phase}</Text>
                            </View>
                            <View style={styles.phaseHeaderRight}>
                              <View style={styles.phaseProgressMini}>
                                <View style={[styles.phaseProgressMiniFill, {
                                  width: `${phaseProgress}%` as any,
                                  backgroundColor: getPhaseColor(phase),
                                }]} />
                              </View>
                              <Text style={styles.phaseHeaderMeta}>{phaseProgress}% · {tasks.length}</Text>
                            </View>
                          </TouchableOpacity>
                          {!isCollapsed && (
                            <View style={styles.phaseTaskList}>
                              {tasks.map(renderTaskCard)}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </>
                )}

                {viewMode === 'gantt' && activeSchedule && (
                  <View style={styles.ganttWrapper}>
                    <View style={styles.ganttControls}>
                      <TouchableOpacity
                        style={[styles.ganttOrientBtn, !isVerticalGantt && styles.ganttOrientBtnActive]}
                        onPress={() => setIsVerticalGantt(false)}
                      >
                        <BarChart3 size={12} color={!isVerticalGantt ? '#FFF' : Colors.textSecondary} />
                        <Text style={[styles.ganttOrientBtnText, !isVerticalGantt && styles.ganttOrientBtnTextActive]}>Horizontal</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.ganttOrientBtn, isVerticalGantt && styles.ganttOrientBtnActive]}
                        onPress={() => setIsVerticalGantt(true)}
                      >
                        <CalendarDays size={12} color={isVerticalGantt ? '#FFF' : Colors.textSecondary} />
                        <Text style={[styles.ganttOrientBtnText, isVerticalGantt && styles.ganttOrientBtnTextActive]}>Vertical</Text>
                      </TouchableOpacity>
                      <View style={{ flex: 1 }} />
                      <TouchableOpacity
                        style={[styles.baselineToggle, showBaseline && styles.baselineToggleActive]}
                        onPress={() => setShowBaseline(!showBaseline)}
                      >
                        <Text style={[styles.baselineToggleText, showBaseline && styles.baselineToggleTextActive]}>
                          Baseline
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.saveBaselineBtn} onPress={handleSaveBaseline}>
                        <Save size={13} color={Colors.primary} />
                        <Text style={styles.saveBaselineBtnText}>Save Baseline</Text>
                      </TouchableOpacity>
                    </View>
                    {isVerticalGantt ? (
                      <VerticalGantt
                        schedule={activeSchedule}
                        tasks={sortedTasks}
                        projectStartDate={projectStartDate}
                        onTaskPress={setTaskDetailModal}
                        showBaseline={showBaseline}
                      />
                    ) : (
                      <GanttChart
                        schedule={activeSchedule}
                        tasks={sortedTasks}
                        projectStartDate={projectStartDate}
                        onTaskPress={setTaskDetailModal}
                        showBaseline={showBaseline}
                        forecast={ganttForecast}
                      />
                    )}
                  </View>
                )}

                {viewMode === 'resources' && renderResourceView()}
                {viewMode === 'summary' && renderSummary()}

                {(viewMode === 'today' || viewMode === 'summary') && activeSchedule && activeSchedule.tasks.length > 0 && (
                  <AIScheduleRisk
                    schedule={activeSchedule}
                    projectId={selectedProject?.id ?? 'none'}
                  />
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      <AICopilot />

      {hasScheduleData && (viewMode === 'today' || viewMode === 'lookahead') && activeSchedule && selectedProject && (
        <VoiceFieldButton
          tasks={sortedTasks}
          projectName={selectedProject.name}
          projectId={selectedProject.id}
          updateFunctions={{
            handleProgressUpdate,
            onAddNote: (task, note) => {
              const updatedNotes = task.notes
                ? `${task.notes}\n[${new Date().toLocaleDateString()}] ${note}`
                : `[${new Date().toLocaleDateString()}] ${note}`;
              const nextTasks = sortedTasks.map(item =>
                item.id !== task.id ? item : { ...item, notes: updatedNotes }
              );
              const scheduleName = activeSchedule?.name ?? 'Project Schedule';
              const nextSchedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, nextTasks, activeSchedule?.baseline);
              saveSchedule(nextSchedule, selectedProject);
            },
          }}
          activeTodayTask={todayTasks[0] ?? null}
          bottomOffset={insets.bottom + 16}
        />
      )}

      {hasScheduleData && !isFieldMode && (
        <View style={[styles.fabContainer, { bottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={styles.fabSecondary}
            onPress={() => setIsShareSheetOpen(true)}
            activeOpacity={0.85}
            testID="open-share-sheet"
          >
            <FileText size={18} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.fabSecondary}
            onPress={() => setIsQuickBuildOpen(true)}
            activeOpacity={0.85}
            testID="open-quick-build"
          >
            <Zap size={18} color="#FF9500" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.fab}
            onPress={() => { setTaskDraft({ ...EMPTY_DRAFT }); setQuickAddCount(0); setIsQuickAddOpen(true); }}
            activeOpacity={0.85}
            testID="open-quick-add"
          >
            <Plus size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Project Picker */}
      <Modal visible={isProjectPickerOpen} transparent animationType="fade" onRequestClose={() => setIsProjectPickerOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setIsProjectPickerOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Project</Text>
              <TouchableOpacity onPress={() => setIsProjectPickerOpen(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {projects.map(project => (
                <TouchableOpacity
                  key={project.id}
                  style={[styles.pickerOption, selectedProjectId === project.id && styles.pickerOptionSelected]}
                  onPress={() => { setSelectedProjectId(project.id); setIsProjectPickerOpen(false); }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.pickerOptionTitle}>{project.name}</Text>
                  <Text style={styles.pickerOptionMeta}>
                    {project.schedule ? `${project.schedule.tasks.length} tasks` : 'No schedule'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Project Start Date Picker (mobile) */}
      <Modal visible={isProjectStartDatePickerOpen} transparent animationType="fade" onRequestClose={() => setIsProjectStartDatePickerOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setIsProjectStartDatePickerOpen(false)}>
          <Pressable style={[styles.modalCard, { maxWidth: 380, alignSelf: 'center' }]} onPress={() => undefined}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Project Start Date</Text>
            </View>
            <Text style={styles.quickAddHint}>
              This is Day 1 of the schedule. Changing it shifts every task&apos;s calendar dates but keeps their relative order.
            </Text>
            <TextInput
              style={[styles.quickAddInput, { marginTop: 10 }]}
              value={projectStartDateInput}
              onChangeText={setProjectStartDateInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.addTaskBtn, { flex: 1, backgroundColor: Colors.surfaceAlt }]}
                onPress={() => setIsProjectStartDatePickerOpen(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.addTaskBtnText, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addTaskBtn, { flex: 1 }]}
                onPress={() => setProjectStartDate(projectStartDateInput)}
                activeOpacity={0.85}
                testID="save-project-start-date-mobile"
              >
                <Check size={16} color="#FFF" />
                <Text style={styles.addTaskBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Quick Add Bottom Sheet */}
      <Modal visible={isQuickAddOpen} transparent animationType="slide" onRequestClose={() => setIsQuickAddOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.bottomSheetOverlay}>
            <Pressable style={{ flex: 1 }} onPress={() => setIsQuickAddOpen(false)} />
            <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.bottomSheetHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Quick Add Task</Text>
                {quickAddCount >= 3 && (
                  <TouchableOpacity style={styles.doneBtn} onPress={() => setIsQuickAddOpen(false)}>
                    <Text style={styles.doneBtnText}>Done</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TextInput
                style={styles.quickAddInput}
                value={taskDraft.title}
                onChangeText={handleTaskNameChange}
                placeholder="Task name..."
                placeholderTextColor={Colors.textMuted}
                autoFocus
                testID="quick-add-name"
              />

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.phaseScroller}>
                <View style={styles.phaseChipRow}>
                  {PHASE_OPTIONS.map(phase => (
                    <TouchableOpacity
                      key={phase}
                      style={[styles.phaseChip, taskDraft.phase === phase && styles.phaseChipActive]}
                      onPress={() => setTaskDraft(prev => ({ ...prev, phase }))}
                    >
                      <Text style={[styles.phaseChipText, taskDraft.phase === phase && styles.phaseChipTextActive]}>
                        {phase}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={{ marginTop: 4 }}>
                <Text style={styles.quickAddFieldLabel}>Start date (optional)</Text>
                {(() => {
                  // Quick-pick suggestions so the user doesn't have to type a
                  // raw YYYY-MM-DD when the date they want is already obvious
                  // from the schedule (project start, or right after an
                  // existing task finishes). Custom date input still works
                  // below the chips.
                  const wdpw = activeSchedule?.workingDaysPerWeek ?? 5;
                  const toISO = (d: Date) => {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    return `${y}-${m}-${day}`;
                  };
                  const suggestions: { key: string; label: string; date: Date; iso: string }[] = [];
                  suggestions.push({
                    key: 'project-start',
                    label: 'Project Start',
                    date: projectStartDate,
                    iso: toISO(projectStartDate),
                  });
                  // "After X" = first working day after task X ends. Show
                  // last 6 tasks in chronological order (most recent last).
                  const recent = sortedTasks.slice(-6);
                  recent.forEach((t) => {
                    const { end } = getTaskDateRange(t, projectStartDate, wdpw);
                    const next = addWorkingDays(end, 1, wdpw);
                    suggestions.push({
                      key: `after-${t.id}`,
                      label: `After ${t.title}`,
                      date: next,
                      iso: toISO(next),
                    });
                  });
                  const pickChip = (iso: string) => {
                    setTaskDraft(prev => ({ ...prev, startDateOverride: iso }));
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  };
                  return (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.quickAddDateScroller}
                      contentContainerStyle={styles.quickAddDateChipRow}
                    >
                      {suggestions.map((s) => {
                        const active = taskDraft.startDateOverride === s.iso;
                        return (
                          <TouchableOpacity
                            key={s.key}
                            onPress={() => pickChip(s.iso)}
                            activeOpacity={0.75}
                            style={[styles.quickAddDateChip, active && styles.quickAddDateChipActive]}
                            testID={`quick-add-date-${s.key}`}
                          >
                            <Text
                              style={[styles.quickAddDateChipLabel, active && styles.quickAddDateChipLabelActive]}
                              numberOfLines={1}
                            >
                              {s.label}
                            </Text>
                            <Text
                              style={[styles.quickAddDateChipValue, active && styles.quickAddDateChipValueActive]}
                            >
                              {formatShortDate(s.date)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  );
                })()}
                <TextInput
                  style={styles.quickAddSmallInput}
                  value={taskDraft.startDateOverride}
                  onChangeText={(text) => setTaskDraft(prev => ({ ...prev, startDateOverride: text }))}
                  placeholder="Or type a custom date: YYYY-MM-DD"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                  testID="quick-add-start-date"
                />
                <Text style={styles.quickAddHint}>
                  Project starts {projectStartDate.toLocaleDateString()} · leave blank to chain after the last task
                </Text>
              </View>

              <View style={styles.quickAddRow}>
                <View style={styles.quickAddField}>
                  <Text style={styles.quickAddLabel}>Duration</Text>
                  <View style={styles.stepperRow}>
                    <Pressable style={styles.stepperBtn} onPress={() =>
                      setTaskDraft(prev => ({ ...prev, durationDays: String(Math.max(0, parseInt(prev.durationDays) - 1)) }))
                    }><Minus size={14} color={Colors.text} /></Pressable>
                    <Text style={styles.stepperValue}>{taskDraft.durationDays}d</Text>
                    <Pressable style={styles.stepperBtn} onPress={() =>
                      setTaskDraft(prev => ({ ...prev, durationDays: String(parseInt(prev.durationDays) + 1) }))
                    }><Plus size={14} color={Colors.text} /></Pressable>
                  </View>
                </View>
                <View style={styles.quickAddField}>
                  <Text style={styles.quickAddLabel}>Crew Size</Text>
                  <View style={styles.stepperRow}>
                    <Pressable style={styles.stepperBtn} onPress={() =>
                      setTaskDraft(prev => ({ ...prev, crewSize: String(Math.max(1, parseInt(prev.crewSize) - 1)) }))
                    }><Minus size={14} color={Colors.text} /></Pressable>
                    <Text style={styles.stepperValue}>{taskDraft.crewSize}</Text>
                    <Pressable style={styles.stepperBtn} onPress={() =>
                      setTaskDraft(prev => ({ ...prev, crewSize: String(parseInt(prev.crewSize) + 1) }))
                    }><Plus size={14} color={Colors.text} /></Pressable>
                  </View>
                </View>
              </View>

              <View style={styles.quickAddToggleRow}>
                <TouchableOpacity
                  style={[styles.quickAddToggle, taskDraft.isMilestone && styles.quickAddToggleActive]}
                  onPress={() => setTaskDraft(prev => ({ ...prev, isMilestone: !prev.isMilestone }))}
                >
                  <Flag size={12} color={taskDraft.isMilestone ? '#FFF' : '#FF9500'} />
                  <Text style={[styles.quickAddToggleText, taskDraft.isMilestone && styles.quickAddToggleTextActive]}>Milestone</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAddToggle, taskDraft.isCriticalPath && { backgroundColor: Colors.error }]}
                  onPress={() => setTaskDraft(prev => ({ ...prev, isCriticalPath: !prev.isCriticalPath }))}
                >
                  <GitBranch size={12} color={taskDraft.isCriticalPath ? '#FFF' : Colors.error} />
                  <Text style={[styles.quickAddToggleText, taskDraft.isCriticalPath && { color: '#FFF' }]}>Critical</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickAddToggle, taskDraft.isWeatherSensitive && { backgroundColor: '#007AFF' }]}
                  onPress={() => setTaskDraft(prev => ({ ...prev, isWeatherSensitive: !prev.isWeatherSensitive }))}
                >
                  <Cloud size={12} color={taskDraft.isWeatherSensitive ? '#FFF' : '#007AFF'} />
                  <Text style={[styles.quickAddToggleText, taskDraft.isWeatherSensitive && { color: '#FFF' }]}>Weather</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.addTaskBtn} onPress={handleQuickAdd} activeOpacity={0.85} testID="quick-add-btn">
                <Plus size={16} color="#FFF" />
                <Text style={styles.addTaskBtnText}>Add Task</Text>
              </TouchableOpacity>

              {quickAddCount > 0 && (
                <Text style={styles.quickAddCountText}>{quickAddCount} task{quickAddCount > 1 ? 's' : ''} added</Text>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Task Detail */}
      <Modal visible={taskDetailModal !== null} transparent animationType="fade" onRequestClose={() => setTaskDetailModal(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setTaskDetailModal(null)}>
          <Pressable style={[styles.modalCard, { maxHeight: '85%' }]} onPress={() => undefined}>
            {taskDetailModal && (() => {
              const task = taskDetailModal;
              const statusColor = getStatusColor(task.status);
              const dateRange = activeSchedule ? getTaskDateRange(task, projectStartDate, activeSchedule.workingDaysPerWeek) : null;
              const preds = getPredecessors(task, sortedTasks);
              const succs = getSuccessors(task.id, sortedTasks);
              const variance = getBaselineVariance(task, activeSchedule?.baseline);

              return (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { flex: 1, marginRight: 12 }]}>{task.title}</Text>
                    <TouchableOpacity onPress={() => setTaskDetailModal(null)}>
                      <X size={20} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.detailBadges}>
                    <View style={[styles.statusChip, { backgroundColor: statusColor + '14' }]}>
                      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                      <Text style={[styles.statusChipText, { color: statusColor }]}>{getStatusLabel(task.status)}</Text>
                    </View>
                    {task.isMilestone && <View style={[styles.tagChip, { backgroundColor: '#007AFF14' }]}><Flag size={10} color="#007AFF" /><Text style={[styles.tagChipText, { color: '#007AFF' }]}>Milestone</Text></View>}
                    {task.isCriticalPath && <View style={[styles.tagChip, { backgroundColor: '#FF3B3014' }]}><GitBranch size={10} color="#FF3B30" /><Text style={[styles.tagChipText, { color: '#FF3B30' }]}>Critical</Text></View>}
                    {task.isWeatherSensitive && <View style={[styles.tagChip, { backgroundColor: '#007AFF14' }]}><Cloud size={10} color="#007AFF" /><Text style={[styles.tagChipText, { color: '#007AFF' }]}>Weather</Text></View>}
                  </View>

                  <View style={styles.detailGrid}>
                    <View style={styles.detailGridItem}>
                      <Text style={styles.detailGridLabel}>Phase</Text>
                      <Text style={styles.detailGridValue}>{task.phase}</Text>
                    </View>
                    <View style={styles.detailGridItem}>
                      <Text style={styles.detailGridLabel}>Duration</Text>
                      <Text style={styles.detailGridValue}>{task.durationDays} days</Text>
                    </View>
                    {dateRange && <>
                      <View style={styles.detailGridItem}>
                        <Text style={styles.detailGridLabel}>Start</Text>
                        <Text style={styles.detailGridValue}>{formatShortDate(dateRange.start)}</Text>
                      </View>
                      <View style={styles.detailGridItem}>
                        <Text style={styles.detailGridLabel}>End</Text>
                        <Text style={styles.detailGridValue}>{formatShortDate(dateRange.end)}</Text>
                      </View>
                    </>}
                    <View style={styles.detailGridItem}>
                      <Text style={styles.detailGridLabel}>Crew</Text>
                      <Text style={styles.detailGridValue}>{task.crew || '—'}</Text>
                    </View>
                    <View style={styles.detailGridItem}>
                      <Text style={styles.detailGridLabel}>Progress</Text>
                      <Text style={[styles.detailGridValue, { color: statusColor }]}>{task.progress}%</Text>
                    </View>
                    {variance !== null && (
                      <View style={styles.detailGridItem}>
                        <Text style={styles.detailGridLabel}>vs Baseline</Text>
                        <Text style={[styles.detailGridValue, { color: variance > 0 ? '#FF3B30' : '#34C759' }]}>
                          {variance > 0 ? '+' : ''}{variance}d
                        </Text>
                      </View>
                    )}
                    {task.wbsCode && (
                      <View style={styles.detailGridItem}>
                        <Text style={styles.detailGridLabel}>WBS</Text>
                        <Text style={styles.detailGridValue}>{task.wbsCode}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.detailProgressRow}>
                    {[0, 25, 50, 75, 100].map(val => (
                      <TouchableOpacity
                        key={val}
                        style={[styles.detailProgressBtn, task.progress === val && styles.detailProgressBtnActive]}
                        onPress={() => { handleProgressUpdate(task, val); setTaskDetailModal({ ...task, progress: val, status: val >= 100 ? 'done' : val > 0 ? 'in_progress' : 'not_started' }); }}
                      >
                        <Text style={[styles.detailProgressBtnText, task.progress === val && styles.detailProgressBtnTextActive]}>
                          {val === 100 ? 'Done' : `${val}%`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {preds.length > 0 && (
                    <View style={styles.detailDepSection}>
                      <Text style={styles.detailDepTitle}>Predecessors</Text>
                      {preds.map(p => (
                        <View key={p.id} style={styles.detailDepRow}>
                          <View style={[styles.detailDepDot, { backgroundColor: getStatusColor(p.status) }]} />
                          <Text style={styles.detailDepName} numberOfLines={1}>{p.title}</Text>
                          <Text style={styles.detailDepMeta}>{getDepTypeForDep(task, p.id)}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {succs.length > 0 && (
                    <View style={styles.detailDepSection}>
                      <Text style={[styles.detailDepTitle, { color: '#FF9500' }]}>Successors</Text>
                      {succs.map(s => (
                        <View key={s.id} style={styles.detailDepRow}>
                          <View style={[styles.detailDepDot, { backgroundColor: getStatusColor(s.status) }]} />
                          <Text style={styles.detailDepName} numberOfLines={1}>{s.title}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {task.notes ? <Text style={styles.detailNotes}>{task.notes}</Text> : null}

                  {(() => {
                    const { end } = activeSchedule ? getTaskDateRange(task, projectStartDate, activeSchedule.workingDaysPerWeek) : { end: new Date() };
                    const isOverdue = task.status !== 'done' && end < new Date() && task.progress < 100;
                    const daysLate = isOverdue ? Math.ceil((new Date().getTime() - end.getTime()) / (1000 * 60 * 60 * 24)) : 0;
                    const succTasks = getSuccessors(task.id, sortedTasks);
                    const dailyOverhead = 350;
                    const avgHourlyRate = 30;
                    const crewDailyCost = (task.crewSize ?? 2) * avgHourlyRate * 8;
                    const delayCost = daysLate > 0 ? (daysLate * crewDailyCost) + (daysLate * dailyOverhead) : 0;

                    if (isOverdue && daysLate > 0) {
                      return (
                        <View style={styles.delayImpactSection}>
                          <View style={styles.delayImpactHeader}>
                            <AlertTriangle size={14} color="#FF3B30" />
                            <Text style={styles.delayImpactTitle}>Schedule Impact</Text>
                          </View>
                          <Text style={styles.delayImpactBody}>
                            This task is {daysLate} day{daysLate > 1 ? 's' : ''} behind schedule.
                          </Text>
                          {succTasks.length > 0 && (
                            <View style={styles.delayImpactDownstream}>
                              <Text style={styles.delayImpactLabel}>Downstream impact:</Text>
                              {succTasks.slice(0, 4).map(s => (
                                <Text key={s.id} style={styles.delayImpactItem}>
                                  → "{s.title}" pushed {daysLate} day{daysLate > 1 ? 's' : ''}
                                </Text>
                              ))}
                            </View>
                          )}
                          <View style={styles.delayImpactCost}>
                            <Text style={styles.delayImpactLabel}>Estimated cost of delay:</Text>
                            <Text style={styles.delayImpactItem}>Labor idle: {daysLate} crew-day{daysLate > 1 ? 's' : ''} × ${crewDailyCost}/day = ${(daysLate * crewDailyCost).toLocaleString()}</Text>
                            <Text style={styles.delayImpactItem}>Overhead: {daysLate} day{daysLate > 1 ? 's' : ''} × ${dailyOverhead}/day = ${(daysLate * dailyOverhead).toLocaleString()}</Text>
                            <Text style={styles.delayImpactTotal}>Total: ~${delayCost.toLocaleString()}</Text>
                          </View>
                        </View>
                      );
                    }
                    return null;
                  })()}

                  {(() => {
                    if (!task.isWeatherSensitive) return null;
                    const weatherForecast = getSimulatedForecast(new Date(), 14);
                    const taskDr = activeSchedule ? getTaskDateRange(task, projectStartDate, activeSchedule.workingDaysPerWeek) : null;
                    if (!taskDr) return null;
                    const relevantDays = weatherForecast.filter(f => {
                      const fDate = new Date(f.date);
                      return fDate >= taskDr.start && fDate <= taskDr.end;
                    });
                    const badDays = relevantDays.filter(f => !f.isWorkable);
                    if (relevantDays.length === 0) return null;
                    return (
                      <View style={styles.weatherImpactSection}>
                        <View style={styles.weatherImpactHeader}>
                          <Cloud size={14} color="#007AFF" />
                          <Text style={styles.weatherImpactTitle}>Weather Impact</Text>
                        </View>
                        <View style={styles.weatherImpactForecastRow}>
                          {relevantDays.slice(0, 7).map(f => {
                            const d = new Date(f.date);
                            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                            return (
                              <View key={f.date} style={[styles.weatherImpactDay, !f.isWorkable && styles.weatherImpactDayBad]}>
                                <Text style={styles.weatherImpactDayName}>{dayName}</Text>
                                <Text style={styles.weatherImpactDayIcon}>{getConditionIcon(f.condition)}</Text>
                                <Text style={styles.weatherImpactDayTemp}>{f.tempHigh}°</Text>
                              </View>
                            );
                          })}
                        </View>
                        {badDays.length > 0 && (
                          <Text style={styles.weatherImpactWarning}>
                            ⚠️ {badDays.length} day{badDays.length > 1 ? 's' : ''} of poor weather may impact this task
                          </Text>
                        )}
                      </View>
                    );
                  })()}

                  <View style={styles.detailPhotosSection}>
                    <View style={styles.detailPhotosHeader}>
                      <Text style={styles.detailPhotosTitle}>Photos ({task.photos?.length ?? 0})</Text>
                      <TouchableOpacity
                        style={styles.addPhotoBtn}
                        onPress={async () => {
                          try {
                            const result = await ImagePicker.launchImageLibraryAsync({
                              mediaTypes: ['images'],
                              quality: 0.7,
                              allowsEditing: true,
                            });
                            if (!result.canceled && result.assets[0]) {
                              handlePhotoAdded(task, {
                                uri: result.assets[0].uri,
                                timestamp: new Date().toISOString(),
                              });
                              setTaskDetailModal({
                                ...task,
                                photos: [...(task.photos ?? []), { uri: result.assets[0].uri, timestamp: new Date().toISOString() }],
                              });
                            }
                          } catch (err) {
                            console.log('[Schedule] Photo pick error:', err);
                          }
                        }}
                      >
                        <Camera size={13} color={Colors.primary} />
                        <Text style={styles.addPhotoBtnText}>Add Photo</Text>
                      </TouchableOpacity>
                    </View>
                    {task.photos && task.photos.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.detailPhotosRow}>
                          {task.photos.map((photo, idx) => (
                            <View key={idx} style={styles.detailPhotoThumb}>
                              <Image source={{ uri: photo.uri }} style={styles.detailPhotoImg} />
                              <Text style={styles.detailPhotoTime}>
                                {new Date(photo.timestamp).toLocaleDateString()}
                              </Text>
                              {photo.note ? <Text style={styles.detailPhotoNote} numberOfLines={1}>{photo.note}</Text> : null}
                            </View>
                          ))}
                        </View>
                      </ScrollView>
                    ) : (
                      <Text style={styles.noPhotosText}>No photos yet. Tap "Add Photo" to attach progress photos.</Text>
                    )}
                  </View>

                  <View style={styles.detailActions}>
                    <TouchableOpacity style={styles.detailEditBtn} onPress={() => openEditTask(task)}>
                      <Text style={styles.detailEditBtnText}>Edit Task</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.detailDeleteBtn} onPress={() => { setTaskDetailModal(null); handleDeleteTask(task.id); }}>
                      <Trash2 size={16} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Quick Build Modal */}
      <QuickBuildModal
        visible={isQuickBuildOpen}
        onClose={() => setIsQuickBuildOpen(false)}
        onTemplateSelect={handleTemplateSelect}
      />

      {/* Schedule Share Sheet */}
      {activeSchedule && (
        <ScheduleShareSheet
          visible={isShareSheetOpen}
          onClose={() => setIsShareSheetOpen(false)}
          schedule={activeSchedule}
          tasks={sortedTasks}
          projectStartDate={projectStartDate}
          projectName={selectedProject?.name ?? 'Project'}
        />
      )}

      {extraModals}
    </View>
  );
}

function guessPhase(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('lumber') || c.includes('framing') || c.includes('wood')) return 'Framing';
  if (c.includes('electric') || c.includes('wiring')) return 'Electrical';
  if (c.includes('plumb') || c.includes('pipe')) return 'Plumbing';
  if (c.includes('roof') || c.includes('shingle')) return 'Roofing';
  if (c.includes('hvac') || c.includes('duct')) return 'HVAC';
  if (c.includes('concrete') || c.includes('foundation')) return 'Foundation';
  if (c.includes('drywall') || c.includes('gypsum')) return 'Drywall';
  if (c.includes('paint') || c.includes('finish')) return 'Finishes';
  if (c.includes('floor') || c.includes('tile') || c.includes('carpet')) return 'Finishes';
  if (c.includes('insulation')) return 'Insulation';
  if (c.includes('landscape')) return 'Landscaping';
  if (c.includes('hardware') || c.includes('fastener')) return 'General';
  return 'General';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingBottom: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 32, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.8 },
  subtitle: { marginTop: 4, fontSize: 14, color: Colors.textSecondary },

  healthBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  healthScore: { fontSize: 18, fontWeight: '800' as const },

  projectPickerRow: { paddingHorizontal: 16, marginTop: 14, marginBottom: 10 },
  projectPickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 14, paddingHorizontal: 14, minHeight: 46, borderWidth: 1, borderColor: Colors.cardBorder },
  projectPickerText: { flex: 1, fontSize: 14, fontWeight: '600' as const, color: Colors.text },

  emptyPrompt: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const },

  emptySchedule: { marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 20, padding: 24, gap: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.cardBorder },
  emptyAction: { flexDirection: 'row', alignItems: 'center', gap: 14, width: '100%', backgroundColor: Colors.surfaceAlt, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.borderLight },
  emptyActionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  emptyActionDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  emptyManualBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, marginTop: 4 },
  emptyManualBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },

  weatherBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: '#FF950010', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#FF950030' },
  weatherBannerText: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: '#FF9500' },

  topBar: { marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  topBarStats: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  topBarStat: { alignItems: 'center' },
  topBarStatValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  topBarStatLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' as const },
  topBarDivider: { width: 1, backgroundColor: Colors.borderLight },
  overallProgress: { height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  overallProgressFill: { height: '100%', borderRadius: 3, backgroundColor: Colors.primary },

  viewTabScroll: { marginBottom: 14 },
  viewTabBar: { flexDirection: 'row', paddingHorizontal: 16, gap: 6 },
  viewTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.fillTertiary },
  viewTabActive: { backgroundColor: Colors.primary },
  viewTabText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  viewTabTextActive: { color: '#FFF' },
  weatherBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#007AFF12', alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' as const },
  fieldModeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF950015', alignItems: 'center', justifyContent: 'center' },
  fieldModeBtnActive: { backgroundColor: '#FF9500' },

  filterBar: { marginBottom: 10, paddingLeft: 16 },
  filterChipRow: { flexDirection: 'row', gap: 6, paddingRight: 16 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.fillTertiary },
  filterChipActive: { backgroundColor: Colors.primary },
  filterChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: '#FFF' },

  phaseSection: { marginBottom: 6 },
  phaseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  phaseHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  phaseColorDot: { width: 8, height: 8, borderRadius: 4 },
  phaseHeaderName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  phaseHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phaseProgressMini: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  phaseProgressMiniFill: { height: '100%', borderRadius: 2 },
  phaseHeaderMeta: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' as const },
  phaseTaskList: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },

  taskCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, gap: 8 },
  taskTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  taskBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, flexWrap: 'wrap' as const },
  varianceText: { fontSize: 12, fontWeight: '700' as const },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: { fontSize: 10, fontWeight: '700' as const },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99 },
  tagChipText: { fontSize: 10, fontWeight: '700' as const },
  taskName: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  taskMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const },
  taskMetaText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  progressFill: { height: '100%', borderRadius: 3 },
  progressText: { fontSize: 12, fontWeight: '700' as const, color: Colors.text, minWidth: 30, textAlign: 'right' as const },
  taskActions: { flexDirection: 'row', alignItems: 'center' },
  progressBtnGroup: { flexDirection: 'row', gap: 5 },
  progressBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  progressBtnActive: { backgroundColor: Colors.primary + '18' },
  progressBtnText: { fontSize: 11, fontWeight: '700' as const, color: Colors.textSecondary },
  progressBtnTextActive: { color: Colors.primary },

  fabContainer: { position: 'absolute' as const, right: 20, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
  fabSecondary: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surface, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: Colors.cardBorder, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 4 },

  fieldModeContainer: { paddingHorizontal: 16, gap: 12 },
  fieldModeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldModeTitle: { flex: 1, fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  fieldModeClose: { padding: 4 },
  fieldModeSubtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: -4 },
  fieldModeEmpty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  fieldModeEmptyText: { fontSize: 15, color: Colors.textSecondary },
  fieldCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: Colors.cardBorder },
  fieldCardTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  fieldProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldProgressTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  fieldProgressFill: { height: '100%', borderRadius: 5, backgroundColor: Colors.primary },
  fieldProgressText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  fieldBtnRow: { flexDirection: 'row', gap: 8 },
  fieldBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.fillTertiary, alignItems: 'center' },
  fieldBtnActive: { backgroundColor: Colors.primary },
  fieldBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  fieldBtnTextActive: { color: '#FFF' },
  fieldNotes: { minHeight: 44, borderRadius: 10, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 14, color: Colors.text },

  resourceContainer: { paddingHorizontal: 16, gap: 12 },
  resourceTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  resourceCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: Colors.cardBorder },
  resourceCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resourceCrewInfo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resourceCrewName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  resourceCrewMeta: { fontSize: 12, color: Colors.textMuted },
  resourceProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resourceProgressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  resourceProgressFill: { height: '100%', borderRadius: 3, backgroundColor: Colors.primary },
  resourceProgressText: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  resourceTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  resourceTaskDot: { width: 6, height: 6, borderRadius: 3 },
  resourceTaskName: { flex: 1, fontSize: 13, fontWeight: '500' as const, color: Colors.text },
  resourceTaskDate: { fontSize: 11, color: Colors.textMuted },

  summaryContainer: { paddingHorizontal: 16, gap: 14 },
  summaryHeader: { gap: 2 },
  summaryProjectName: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  summaryDateRange: { fontSize: 13, color: Colors.textSecondary },
  healthRing: { alignItems: 'center', paddingVertical: 12 },
  healthRingOuter: { width: 100, height: 100, borderRadius: 50, borderWidth: 6, alignItems: 'center', justifyContent: 'center' },
  healthRingScore: { fontSize: 30, fontWeight: '800' as const },
  healthRingLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const },
  summaryStatsRow: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: Colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder },
  summaryStat: { alignItems: 'center' },
  summaryStatValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  summaryStatLabel: { fontSize: 11, color: Colors.textMuted },
  summarySectionTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginTop: 6 },
  summaryPhaseRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  summaryPhaseDot: { width: 8, height: 8, borderRadius: 4 },
  summaryPhaseName: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, width: 80 },
  summaryPhaseProgressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  summaryPhaseProgressFill: { height: '100%', borderRadius: 3 },
  summaryPhasePercent: { fontSize: 12, fontWeight: '700' as const, color: Colors.text, minWidth: 32, textAlign: 'right' as const },
  summaryMilestoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  summaryMilestoneName: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  summaryMilestoneChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  summaryMilestoneChipText: { fontSize: 11, fontWeight: '700' as const },
  summaryCriticalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  summaryCriticalDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  summaryCriticalName: { flex: 1, fontSize: 13, fontWeight: '500' as const, color: Colors.text },
  summaryCriticalDur: { fontSize: 12, fontWeight: '700' as const, color: '#FF3B30' },
  summaryRiskRow: { flexDirection: 'row', gap: 8, paddingVertical: 4, alignItems: 'flex-start' },
  summaryRiskTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  summaryRiskDetail: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  ganttWrapper: { paddingHorizontal: 16 },
  ganttControls: { flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' as const },
  ganttOrientBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  ganttOrientBtnActive: { backgroundColor: Colors.primary },
  ganttOrientBtnText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  ganttOrientBtnTextActive: { color: '#FFF' },
  baselineToggle: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  baselineToggleActive: { backgroundColor: Colors.primary },
  baselineToggleText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  baselineToggleTextActive: { color: '#FFF' },
  saveBaselineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  scenarioBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primary + '15', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, borderWidth: 1, borderColor: Colors.primary + '30' },
  scenarioBannerText: { flex: 1, fontSize: 12, fontWeight: '600' as const, color: Colors.primary },
  saveBaselineBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: Colors.surface, borderRadius: 24, padding: 20, gap: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  pickerOption: { backgroundColor: Colors.surfaceAlt, borderRadius: 12, padding: 14, gap: 2, marginTop: 6 },
  pickerOptionSelected: { borderWidth: 2, borderColor: Colors.primary },
  pickerOptionTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  pickerOptionMeta: { fontSize: 12, color: Colors.textSecondary },

  bottomSheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  bottomSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 8 },
  bottomSheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.fillTertiary, alignSelf: 'center', marginBottom: 8 },
  doneBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.primary },
  doneBtnText: { fontSize: 13, fontWeight: '700' as const, color: '#FFF' },

  quickAddInput: { minHeight: 48, borderRadius: 14, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  quickAddFieldRow: { flexDirection: 'row' as const, gap: 10, marginTop: 10 },
  quickAddFieldLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, marginBottom: 4, letterSpacing: 0.3 },
  quickAddSmallInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  quickAddHint: { fontSize: 11, color: Colors.textMuted, marginTop: 6, marginBottom: 4, lineHeight: 14 },
  quickAddDateScroller: { marginBottom: 8, marginTop: 2 },
  quickAddDateChipRow: { flexDirection: 'row' as const, gap: 8, paddingVertical: 2 },
  quickAddDateChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    minWidth: 96,
    alignItems: 'flex-start' as const,
    gap: 2,
  },
  quickAddDateChipActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary,
  },
  quickAddDateChipLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    maxWidth: 140,
  },
  quickAddDateChipLabelActive: {
    color: Colors.primary,
  },
  quickAddDateChipValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  quickAddDateChipValueActive: {
    color: Colors.primary,
  },
  projectStartBar: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: Colors.surfaceAlt, borderRadius: 10, marginHorizontal: 16, marginBottom: 8 },
  projectStartLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  projectStartValue: { flex: 1, fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  projectStartEdit: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.primary + '15' },
  projectStartEditText: { fontSize: 12, fontWeight: '700' as const, color: Colors.primary },
  phaseScroller: { marginBottom: 4 },
  phaseChipRow: { flexDirection: 'row', gap: 6 },
  phaseChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.fillTertiary },
  phaseChipActive: { backgroundColor: Colors.primary },
  phaseChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  phaseChipTextActive: { color: '#FFF' },
  quickAddRow: { flexDirection: 'row', gap: 12 },
  quickAddField: { flex: 1, gap: 4 },
  quickAddLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceAlt, borderRadius: 12, paddingHorizontal: 10, minHeight: 44, justifyContent: 'center' },
  stepperBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, minWidth: 30, textAlign: 'center' as const },
  quickAddToggleRow: { flexDirection: 'row', gap: 8 },
  quickAddToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  quickAddToggleActive: { backgroundColor: '#FF9500' },
  quickAddToggleText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  quickAddToggleTextActive: { color: '#FFF' },
  addTaskBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary },
  addTaskBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },
  quickAddCountText: { textAlign: 'center' as const, fontSize: 12, color: Colors.textMuted, fontWeight: '500' as const },

  fieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, marginTop: 4 },
  input: { minHeight: 46, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 14, color: Colors.text },
  dualRow: { flexDirection: 'row', gap: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceAlt, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 4 },
  toggleInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleLabel: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  depPickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceAlt, borderRadius: 12, paddingHorizontal: 14, minHeight: 44, borderWidth: 1, borderColor: Colors.cardBorder },
  depPickerBtnText: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  editActionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  editCancelBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  editCancelBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  editSaveBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  editSaveBtnText: { fontSize: 14, fontWeight: '700' as const, color: '#FFF' },

  depOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, marginBottom: 4, backgroundColor: Colors.surfaceAlt },
  depOptionSelected: { backgroundColor: Colors.infoLight, borderWidth: 1, borderColor: '#007AFF30' },
  depCheckbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  depCheckboxSelected: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  depOptionTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  depOptionMeta: { fontSize: 11, color: Colors.textSecondary },
  depDoneBtn: { marginTop: 8, minHeight: 44, borderRadius: 12, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  depDoneBtnText: { fontSize: 14, fontWeight: '700' as const, color: '#FFF' },

  // Status chips (modal)
  statusChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  modalStatusChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5 },
  modalStatusChipText: { fontSize: 12, fontWeight: '700' as const },

  // Progress buttons (modal)
  modalProgressRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  modalProgressBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  modalProgressBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modalProgressBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted },
  modalProgressBtnTextActive: { color: '#FFF' },

  // Dep detail
  depDetailList: { marginTop: 6, marginBottom: 8, gap: 8 },
  depDetailRow: { backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 10 },
  depDetailName: { fontSize: 12, fontWeight: '600' as const, color: Colors.text, marginBottom: 6 },
  depTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  depTypeBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  depTypeBtnActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  depTypeBtnText: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted },
  depTypeBtnTextActive: { color: '#FFF' },
  lagInput: { flex: 1, backgroundColor: Colors.card, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, color: Colors.text, textAlign: 'center' as const, maxWidth: 56 },

  // Cascade note
  cascadeNote: { backgroundColor: '#007AFF10', borderRadius: 8, padding: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  cascadeNoteText: { fontSize: 11, color: '#007AFF', fontStyle: 'italic' as const },

  detailBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  detailGridItem: { width: '46%' as any, backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 10, gap: 2 },
  detailGridLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  detailGridValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  detailProgressRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  detailProgressBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.fillTertiary, alignItems: 'center' },
  detailProgressBtnActive: { backgroundColor: Colors.primary },
  detailProgressBtnText: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary },
  detailProgressBtnTextActive: { color: '#FFF' },
  detailDepSection: { marginBottom: 12, gap: 6 },
  detailDepTitle: { fontSize: 13, fontWeight: '700' as const, color: '#007AFF' },
  detailDepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 10 },
  detailDepDot: { width: 6, height: 6, borderRadius: 3 },
  detailDepName: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  detailDepMeta: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const },
  detailNotes: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary, marginBottom: 12 },

  delayImpactSection: { backgroundColor: '#FF3B3008', borderRadius: 14, padding: 14, gap: 8, marginBottom: 12, borderWidth: 1, borderColor: '#FF3B3020' },
  delayImpactHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  delayImpactTitle: { fontSize: 14, fontWeight: '700' as const, color: '#FF3B30' },
  delayImpactBody: { fontSize: 13, color: Colors.text, fontWeight: '500' as const },
  delayImpactDownstream: { gap: 3, marginTop: 2 },
  delayImpactLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  delayImpactItem: { fontSize: 12, color: Colors.text, paddingLeft: 8 },
  delayImpactCost: { gap: 3, marginTop: 4, borderTopWidth: 1, borderTopColor: '#FF3B3015', paddingTop: 6 },
  delayImpactTotal: { fontSize: 13, fontWeight: '800' as const, color: '#FF3B30' },

  weatherImpactSection: { backgroundColor: '#007AFF08', borderRadius: 14, padding: 14, gap: 8, marginBottom: 12, borderWidth: 1, borderColor: '#007AFF20' },
  weatherImpactHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  weatherImpactTitle: { fontSize: 14, fontWeight: '700' as const, color: '#007AFF' },
  weatherImpactForecastRow: { flexDirection: 'row' as const, justifyContent: 'space-around' as const, gap: 4 },
  weatherImpactDay: { alignItems: 'center' as const, gap: 1, flex: 1 },
  weatherImpactDayBad: { backgroundColor: '#FF3B3010', borderRadius: 8, padding: 2 },
  weatherImpactDayName: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted },
  weatherImpactDayIcon: { fontSize: 14 },
  weatherImpactDayTemp: { fontSize: 10, fontWeight: '700' as const, color: Colors.text },
  weatherImpactWarning: { fontSize: 12, color: '#FF9500', fontWeight: '600' as const },

  detailPhotosSection: { marginBottom: 12, gap: 8 },
  detailPhotosHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  detailPhotosTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  addPhotoBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.primary + '12' },
  addPhotoBtnText: { fontSize: 12, fontWeight: '700' as const, color: Colors.primary },
  detailPhotosRow: { flexDirection: 'row' as const, gap: 8 },
  detailPhotoThumb: { width: 80, borderRadius: 10, backgroundColor: Colors.fillTertiary, overflow: 'hidden' as const },
  detailPhotoImg: { width: 80, height: 80, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  detailPhotoTime: { fontSize: 9, color: Colors.textMuted, fontWeight: '600' as const, textAlign: 'center' as const, paddingVertical: 3 },
  detailPhotoNote: { fontSize: 9, color: Colors.textSecondary, textAlign: 'center' as const, paddingBottom: 3, paddingHorizontal: 4 },
  noPhotosText: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' as const },
  detailActions: { flexDirection: 'row', gap: 10 },
  detailEditBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  detailEditBtnText: { fontSize: 14, fontWeight: '700' as const, color: '#FFF' },
  detailDeleteBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#FF3B3010', alignItems: 'center', justifyContent: 'center' },

  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  aiTitle: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  aiSubtitle: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary, marginBottom: 4 },
  aiInput: { minHeight: 100, borderRadius: 14, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, paddingTop: 14, fontSize: 14, color: Colors.text },
  aiGenerateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, borderRadius: 14, backgroundColor: '#FF9500' },
  aiGenerateBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },

  templateCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 14, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: Colors.borderLight },
  templateInfo: { flex: 1, gap: 2 },
  templateName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  templateMeta: { fontSize: 12, color: Colors.textSecondary },
});

const desktopStyles = StyleSheet.create({
  desktopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  proBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  proBtnText: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: Colors.textOnPrimary,
    letterSpacing: 0.3,
  },
  desktopHeaderLeft: {
    width: 260,
  },
  splitContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  taskListPanel: {
    width: 320,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
  },
  taskListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  taskListTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  taskListCount: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  taskListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  taskListRowSelected: {
    backgroundColor: Colors.primary + '0A',
  },
  taskListPhaseBar: {
    width: 3,
    height: 28,
    borderRadius: 2,
    marginRight: 10,
  },
  taskListRowContent: {
    flex: 1,
    gap: 2,
  },
  taskListRowTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  taskListRowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskListRowMetaText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textMuted,
  },
  taskListRowDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  mainPanel: {
    flex: 1,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 8,
  },
  statusBarItem: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  statusBarDivider: {
    width: 1,
    height: 14,
    backgroundColor: Colors.borderLight,
  },
});

```


---

### `app/schedule-pro.tsx`

```tsx
// Schedule Pro — the MS-Project-style rebuild of the schedule screen.
//
// Why a separate route
// --------------------
// The classic screen (app/(tabs)/schedule/index.tsx) is 2,909 lines with a
// fragile modal stack and a lot of business logic living inside it. Rather
// than rewrite in place — which would mean rebuilding 6 view modes in one
// go — we ship the new experience at a NEW route. Users opt in, the old
// screen keeps working, and once the pro version covers everything, we can
// collapse them.
//
// Route: /schedule-pro?projectId=<id>
//
// Responsibilities
// ----------------
// 1. Load the schedule from the selected project.
// 2. Run the CPM engine on every edit; persist tasks back via updateProject.
// 3. Render the GridPane for width ≥ 900px (laptop/iPad landscape).
// 4. On narrow screens, fall back to a link that sends the user to the
//    classic mobile UI (we are NOT abandoning the phone flows).
// 5. Maintain a local undo stack (Phase 4) — stubbed here, wired next phase.
//
// Playbook alignment
// ------------------
//   - Forgiving UI: GridPane rejects bad edits in-place (cycle guard).
//   - As-built: we preserve `baseline` as-is so the critical path is stable
//     even when users start logging actuals.
//   - Frictionless sharing: the "Share" button in the header is wired in
//     Phase 7 — snapshot-URL pattern already proven with the client portal.

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Zap, Activity, Share2, Undo2, Redo2, Columns, Table2, BarChart2, Sparkles, RefreshCcw, Bookmark, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import GridPane from '@/components/schedule/GridPane';
import InteractiveGantt from '@/components/schedule/InteractiveGantt';
import AIAssistantPanel from '@/components/schedule/AIAssistantPanel';
import { runCpm, type CpmResult } from '@/utils/cpm';
import { buildScheduleFromTasks, createId, generateWbsCodes } from '@/utils/scheduleEngine';
import { seedDemoSchedule } from '@/utils/demoSchedule';
import {
  reflowFromActuals,
  captureBaseline,
  applyBaselineToTasks,
  diffAgainstBaseline,
  exportTasksToCsv,
  downloadCsvInBrowser,
  encodeShareToken,
  buildSharePayload,
  type NamedBaseline,
} from '@/utils/scheduleOps';
import type { ScheduleTask, ProjectSchedule } from '@/types';

// Desktop/tablet-landscape breakpoint. Below this we send users to the
// classic mobile experience — the grid is genuinely unusable under 900px.
const GRID_BREAKPOINT = 900;
// Above this we auto-open the split view (grid + gantt side by side). Below,
// we default to grid alone because 1200px of timeline next to a 1170px grid
// means the gantt gets ~30px of width — useless.
const SPLIT_BREAKPOINT = 1600;

type PaneMode = 'grid' | 'split' | 'gantt';

export default function ScheduleProScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('schedule_gantt_pdf')) {
    return (
      <Paywall
        visible={true}
        feature="Schedule Pro (Gantt + PDF Export)"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <ScheduleProScreenInner />;
}

function ScheduleProScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const { projects, updateProject } = useProjects();

  const project = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId],
  );

  // Local working copy so the grid feels instant; we debounce persistence.
  // This is where Phase 4's undo stack will live.
  const [workingTasks, setWorkingTasks] = useState<ScheduleTask[]>(
    project?.schedule?.tasks ?? [],
  );
  const [history, setHistory] = useState<ScheduleTask[][]>([]);
  const [future, setFuture] = useState<ScheduleTask[][]>([]);

  // Pane mode: which view(s) to render. Defaults based on width; user can
  // override via the segmented control in the header.
  const [paneMode, setPaneMode] = useState<PaneMode>(() =>
    width >= SPLIT_BREAKPOINT ? 'split' : 'grid',
  );

  // AI assistant drawer (right-side slide-out).
  const [showAI, setShowAI] = useState(false);

  // Named baselines captured over the life of the schedule. Persisted into
  // `project.schedule.baselines` so variance comparisons survive reloads;
  // we seed from the project on mount and write through updateProject on
  // capture.
  const [namedBaselines, setNamedBaselines] = useState<NamedBaseline[]>(
    () => (project?.schedule?.baselines ?? []) as NamedBaseline[],
  );

  // Resync when the project changes (e.g. user switches projects in classic
  // screen and comes back). Only reset if the project identity itself changed.
  useEffect(() => {
    setWorkingTasks(project?.schedule?.tasks ?? []);
    setHistory([]);
    setFuture([]);
    setNamedBaselines((project?.schedule?.baselines ?? []) as NamedBaseline[]);
  }, [project?.id]);

  // Mirror baselines into the ref used by schedulePersist. Without this, the
  // next debounced write sees the stale list and silently drops captures.
  useEffect(() => {
    baselinesRef.current = namedBaselines;
  }, [namedBaselines]);

  // -------------------------------------------------------------------------
  // CPM + persistence
  // -------------------------------------------------------------------------

  const cpm: CpmResult = useMemo(() => runCpm(workingTasks), [workingTasks]);

  // Anchored early so the export/share/AI handlers below can reference it
  // without running into the `used before declaration` trap — TS is strict
  // about const TDZ inside useCallback closures.
  const projectStartDate = useMemo(() => {
    if (project?.createdAt) return new Date(project.createdAt);
    return new Date();
  }, [project?.createdAt]);

  const workingDaysPerWeek = project?.schedule?.workingDaysPerWeek ?? 5;

  const todayDayNumber = useMemo(() => {
    const ms = Date.now() - projectStartDate.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, days);
  }, [projectStartDate]);

  /**
   * Debounced persist. Every keystroke-level edit lands in workingTasks;
   * we only push to the global store every 500ms of quiet, OR when the user
   * navigates away. This keeps typing snappy even in a large schedule.
   */
  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref-mirror of namedBaselines so the persist closure always sees the
  // latest list without having to re-memoize schedulePersist on every
  // capture (which would kick off the debounce + potentially lose edits).
  const baselinesRef = React.useRef<NamedBaseline[]>([]);
  const schedulePersist = useCallback((tasks: ScheduleTask[]) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      if (!project) return;
      const newSchedule = buildScheduleFromTasks(
        project.schedule?.name ?? project.name ?? 'Schedule',
        project.id,
        tasks,
        project.schedule?.baseline ?? null,
      );
      // Preserve named baselines across debounced writes — `buildScheduleFromTasks`
      // rebuilds a fresh schedule object, so without this spread the baselines
      // column would silently vanish on the next keystroke.
      const withBaselines = { ...newSchedule, baselines: baselinesRef.current };
      console.log('[ScheduleProScreen] Persist', {
        tasks: tasks.length,
        baselines: baselinesRef.current.length,
      });
      updateProject(project.id, { schedule: withBaselines });
    }, 500);
  }, [project, updateProject]);

  // Flush on unmount so we never lose an edit to a pending timer.
  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        // One final sync using the latest working copy.
        if (project) {
          const newSchedule = buildScheduleFromTasks(
            project.schedule?.name ?? project.name ?? 'Schedule',
            project.id,
            workingTasks,
            project.schedule?.baseline ?? null,
          );
          updateProject(project.id, {
            schedule: { ...newSchedule, baselines: baselinesRef.current },
          });
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Edit handlers — all go through a single `commit` that snapshots history
  // -------------------------------------------------------------------------

  const commit = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => {
    setWorkingTasks(prev => {
      const next = producer(prev);
      // Push prev to undo stack, clear redo stack.
      setHistory(h => {
        const trimmed = h.length >= 20 ? h.slice(h.length - 19) : h;
        return [...trimmed, prev];
      });
      setFuture([]);
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  const handleEdit = useCallback((taskId: string, patch: Partial<ScheduleTask>) => {
    commit(prev => prev.map(t => (t.id === taskId ? { ...t, ...patch } : t)));
  }, [commit]);

  const handleAddTask = useCallback(() => {
    commit(prev => {
      const newTask: ScheduleTask = {
        id: createId('task'),
        title: 'New task',
        phase: 'General',
        durationDays: 1,
        startDay: prev.length === 0
          ? 1
          : Math.max(...prev.map(t => t.startDay + t.durationDays)),
        progress: 0,
        crew: '',
        dependencies: [],
        notes: '',
        status: 'not_started',
      };
      return generateWbsCodes([...prev, newTask]);
    });
  }, [commit]);

  // Phase 4: create a dependency edge between two tasks via drag in the Gantt.
  // Guards against self-link + cycles are handled in the Gantt before we get
  // the call, so here we just append.
  const handleDependencyCreate = useCallback((fromId: string, toId: string) => {
    commit(prev => prev.map(t => {
      if (t.id !== toId) return t;
      if (t.dependencies.includes(fromId)) return t;
      return { ...t, dependencies: [...t.dependencies, fromId] };
    }));
  }, [commit]);

  // Dev helper: replace the schedule with a realistic 35-task demo.
  const handleLoadDemo = useCallback(() => {
    const confirmMsg = workingTasks.length > 0
      ? 'Replace the current schedule with a 35-task demo project? (You can undo.)'
      : 'Load a 35-task demo project to explore the new features?';
    const go = () => {
      commit(() => seedDemoSchedule());
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(confirmMsg)) go();
    } else {
      Alert.alert(
        'Load demo schedule',
        confirmMsg,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Load demo', onPress: go },
        ],
      );
    }
  }, [commit, workingTasks.length]);

  const handleDeleteTask = useCallback((taskId: string) => {
    commit(prev => {
      // Also strip this id out of every other task's dependency references,
      // otherwise the CPM engine will silently skip dangling refs but the
      // grid would keep showing them in the Predecessors column.
      return prev
        .filter(t => t.id !== taskId)
        .map(t => ({
          ...t,
          dependencies: t.dependencies.filter(d => d !== taskId),
          dependencyLinks: (t.dependencyLinks ?? []).filter(l => l.taskId !== taskId),
        }));
    });
  }, [commit]);

  // -------------------------------------------------------------------------
  // AI patch application — AI hands us a typed Partial<ScheduleTask>, we
  // commit it like any grid edit so undo/redo works the same.
  // -------------------------------------------------------------------------

  const handleReplaceAll = useCallback((tasks: ScheduleTask[]) => {
    commit(() => generateWbsCodes(tasks));
  }, [commit]);

  // -------------------------------------------------------------------------
  // Bulk edit — every op is ONE commit() so undo restores the whole batch
  // -------------------------------------------------------------------------
  // Selection lives in the parent so the AI drawer reads the same Set. The
  // grid proposes ops; we apply them here, always as a single batch.

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleBulkDelete = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    commit(prev => prev
      .filter(t => !idSet.has(t.id))
      .map(t => ({
        ...t,
        dependencies: t.dependencies.filter(d => !idSet.has(d)),
        dependencyLinks: (t.dependencyLinks ?? []).filter(l => !idSet.has(l.taskId)),
      }))
    );
    setSelectedIds(new Set());
  }, [commit]);

  const handleBulkDuplicate = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    commit(prev => {
      const clones: ScheduleTask[] = prev
        .filter(t => idSet.has(t.id))
        .map(t => ({
          ...t,
          id: createId('task'),
          title: `${t.title} (copy)`,
          // Drop dependencies on the clone — the duplicate is standalone by
          // default. User can re-wire if they wanted a true parallel path.
          dependencies: [],
          dependencyLinks: [],
          // Reset actuals on the clone — those are for the original.
          actualStartDay: undefined,
          actualEndDay: undefined,
          actualStartDate: undefined,
          actualEndDate: undefined,
          progress: 0,
          status: 'not_started' as const,
        }));
      return generateWbsCodes([...prev, ...clones]);
    });
  }, [commit]);

  const handleBulkShiftDays = useCallback((ids: string[], days: number) => {
    const idSet = new Set(ids);
    commit(prev => prev.map(t => {
      if (!idSet.has(t.id)) return t;
      return { ...t, startDay: Math.max(1, t.startDay + days) };
    }));
  }, [commit]);

  const handleBulkSetPhase = useCallback((ids: string[], phase: string) => {
    const idSet = new Set(ids);
    commit(prev => prev.map(t => idSet.has(t.id) ? { ...t, phase } : t));
  }, [commit]);

  const handleBulkSetCrew = useCallback((ids: string[], crew: string) => {
    const idSet = new Set(ids);
    commit(prev => prev.map(t => idSet.has(t.id) ? { ...t, crew } : t));
  }, [commit]);

  const handleBulkAskAI = useCallback((ids: string[]) => {
    // Selection is already parent state; just open the drawer — the panel
    // reads selectedIds via its own prop and scopes ops to it.
    setSelectedIds(new Set(ids));
    setShowAI(true);
  }, []);

  // -------------------------------------------------------------------------
  // Reflow from actuals — cascade observed variance to successors
  // -------------------------------------------------------------------------

  const handleReflow = useCallback(() => {
    const withActuals = workingTasks.filter(t => t.actualStartDay != null);
    if (withActuals.length === 0) {
      const msg = 'No tasks have actual start dates logged yet. Log an actual on at least one task, then reflow to cascade the delta to downstream work.';
      if (Platform.OS === 'web') window.alert?.(msg);
      else Alert.alert('Nothing to reflow', msg);
      return;
    }
    const next = reflowFromActuals(workingTasks);
    const changedCount = next.filter((t, i) => t.startDay !== workingTasks[i].startDay).length;
    commit(() => next);
    const msg = changedCount === 0
      ? 'Everything is on track — no downstream shifts needed.'
      : `Pushed ${changedCount} task${changedCount === 1 ? '' : 's'} based on actuals. Undo if this looks off.`;
    if (Platform.OS === 'web') window.alert?.(msg);
    else Alert.alert('Reflow complete', msg);
  }, [workingTasks, commit]);

  // -------------------------------------------------------------------------
  // Named baselines — capture the current plan as a named version, diff later
  // -------------------------------------------------------------------------

  const handleCaptureBaseline = useCallback(() => {
    const defaultName = `v${namedBaselines.length + 1}`;
    const promptMsg = `Name this baseline (e.g. "Signed", "Approved rev 2"):`;
    let name: string | null = defaultName;
    if (Platform.OS === 'web') {
      name = window.prompt?.(promptMsg, defaultName) ?? null;
      if (name == null) return; // user cancelled
    }
    const trimmed = (name || defaultName).trim() || defaultName;
    const snap = captureBaseline(workingTasks, trimmed);
    // Order matters: update the ref first so the `commit` below, which
    // triggers a debounced persist, picks up the new baseline list. Without
    // this, the first-ever capture flushed before the ref effect ran.
    baselinesRef.current = [...baselinesRef.current, snap];
    setNamedBaselines(prev => [...prev, snap]);
    // Apply as the active baseline on each task so variance badges show
    // immediately — the user's mental model of "capture baseline" is "lock in
    // this plan as the target," and having the ghost stripes appear is the
    // fastest visual confirmation that it worked.
    commit(prev => applyBaselineToTasks(prev, snap));
    const msg = `Baseline "${trimmed}" captured. ${workingTasks.length} tasks snapshotted.`;
    if (Platform.OS === 'web') window.alert?.(msg);
    else Alert.alert('Baseline saved', msg);
  }, [namedBaselines.length, workingTasks, commit]);

  const handleCompareBaseline = useCallback(() => {
    if (namedBaselines.length === 0) {
      const msg = 'Capture a baseline first (Baseline button). Then come back here to see what changed against it.';
      if (Platform.OS === 'web') window.alert?.(msg);
      else Alert.alert('No baselines', msg);
      return;
    }
    const latest = namedBaselines[namedBaselines.length - 1];
    const diffs = diffAgainstBaseline(workingTasks, latest);
    if (diffs.length === 0) {
      const msg = `No variance against "${latest.name}" — the plan matches the baseline exactly.`;
      if (Platform.OS === 'web') window.alert?.(msg);
      else Alert.alert('No variance', msg);
      return;
    }
    const top = diffs.slice(0, 8).map(d => {
      const sign = d.endDelta > 0 ? '+' : '';
      return `  • ${d.title}: ${sign}${d.endDelta}d (finish)`;
    }).join('\n');
    const msg = `Variance vs "${latest.name}":\n\n${top}${diffs.length > 8 ? `\n  …and ${diffs.length - 8} more` : ''}`;
    if (Platform.OS === 'web') window.alert?.(msg);
    else Alert.alert('Baseline variance', msg);
  }, [namedBaselines, workingTasks]);

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------

  const handleExportCsv = useCallback(() => {
    const csv = exportTasksToCsv(workingTasks, projectStartDate);
    const safeName = (project?.name ?? 'schedule').replace(/[^a-z0-9\-_]+/gi, '-').toLowerCase();
    const filename = `${safeName}-${new Date().toISOString().slice(0, 10)}.csv`;
    if (Platform.OS === 'web') {
      const ok = downloadCsvInBrowser(csv, filename);
      if (!ok) window.alert?.('Could not trigger download. Try a different browser.');
    } else {
      // Native: pop the CSV into an alert so the user can at least grab it
      // via long-press. A real share-sheet flow comes later.
      Alert.alert('CSV ready', `Copy the text below:\n\n${csv.slice(0, 600)}${csv.length > 600 ? '…' : ''}`);
    }
  }, [workingTasks, projectStartDate, project?.name]);

  // -------------------------------------------------------------------------
  // Share link — base64 payload in URL, no backend
  // -------------------------------------------------------------------------

  const handleShare = useCallback(() => {
    if (!project) return;
    const payload = buildSharePayload(project.name ?? 'Schedule', projectStartDate, workingTasks);
    const token = encodeShareToken(payload);
    let url = `/shared-schedule?t=${token}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      url = `${window.location.origin}${url}`;
      // Try to copy. Not all browsers allow clipboard writes without https;
      // show the URL as a fallback either way so the user can grab it.
      try {
        navigator.clipboard?.writeText(url);
        window.alert?.(`Share link copied to clipboard.\n\n${url}`);
      } catch {
        window.prompt?.('Copy this share link:', url);
      }
    } else {
      Alert.alert(
        'Share link',
        `Open this URL in a laptop browser:\n\n${url}`,
      );
    }
  }, [project, projectStartDate, workingTasks]);

  // -------------------------------------------------------------------------
  // Undo / Redo (Phase 4 preview — works today for grid edits)
  // -------------------------------------------------------------------------

  const handleUndo = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture(f => [workingTasks, ...f.slice(0, 19)]);
      setWorkingTasks(prev);
      schedulePersist(prev);
      return h.slice(0, -1);
    });
  }, [workingTasks, schedulePersist]);

  const handleRedo = useCallback(() => {
    setFuture(f => {
      if (f.length === 0) return f;
      const next = f[0];
      setHistory(h => [...h, workingTasks].slice(-20));
      setWorkingTasks(next);
      schedulePersist(next);
      return f.slice(1);
    });
  }, [workingTasks, schedulePersist]);

  // -------------------------------------------------------------------------
  // Project start date — anchors the Start/Finish columns
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Keyboard shortcuts (web only)
  // -------------------------------------------------------------------------
  // Cmd/Ctrl-Z          → undo
  // Cmd/Ctrl-Shift-Z    → redo
  // Cmd/Ctrl-Y          → redo (Windows convention)
  // Cmd/Ctrl-K          → toggle AI drawer
  // Cmd/Ctrl-E          → export CSV
  // Cmd/Ctrl-Shift-S    → copy share link
  //
  // We deliberately skip single-key shortcuts. The grid has native text
  // inputs; fighting those for Delete/Escape is a minefield we don't need
  // to wade into tonight.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (key === 'z' && !e.shiftKey) {
        if (inInput) return; // let the browser handle in-field undo
        e.preventDefault();
        handleUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        if (inInput) return;
        e.preventDefault();
        handleRedo();
      } else if (key === 'k') {
        e.preventDefault();
        setShowAI(s => !s);
      } else if (key === 'e') {
        e.preventDefault();
        handleExportCsv();
      } else if (key === 's' && e.shiftKey) {
        e.preventDefault();
        handleShare();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo, handleExportCsv, handleShare]);

  // -------------------------------------------------------------------------
  // Early returns — no project, or screen too narrow
  // -------------------------------------------------------------------------

  if (!project) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ title: 'Schedule Pro' }} />
        <Text style={styles.emptyTitle}>No project selected</Text>
        <Text style={styles.emptyBody}>
          Open a project first, then return to Schedule Pro from the header.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.primaryBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (width < GRID_BREAKPOINT) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ title: 'Schedule Pro' }} />
        <Zap size={28} color={Colors.primary} />
        <Text style={styles.emptyTitle}>Best on a bigger screen</Text>
        <Text style={styles.emptyBody}>
          Schedule Pro is built for laptops and iPad. On a phone, the
          spreadsheet view is genuinely unusable — so we send you to the
          classic mobile-friendly schedule instead.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.replace('/(tabs)/schedule' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>Open classic schedule</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  const stats = {
    total: workingTasks.length,
    critical: cpm.criticalPath.length,
    finish: cpm.projectFinish,
    conflicts: cpm.conflicts.length,
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Custom header — the RN stack header is too cramped for our action row */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ChevronLeft size={20} color={Colors.primary} />
          <Text style={styles.headerBackText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.headerSub}>
            {stats.total} tasks · {stats.critical} on critical path · finish day {stats.finish}
            {stats.conflicts > 0 && ` · ${stats.conflicts} conflict${stats.conflicts === 1 ? '' : 's'}`}
          </Text>
        </View>

        <View style={styles.headerActions}>
          {/* Pane mode segmented control */}
          <View style={styles.paneToggle}>
            <PaneBtn icon={Table2} label="Grid" active={paneMode === 'grid'} onPress={() => setPaneMode('grid')} />
            <PaneBtn icon={Columns} label="Split" active={paneMode === 'split'} onPress={() => setPaneMode('split')} />
            <PaneBtn icon={BarChart2} label="Gantt" active={paneMode === 'gantt'} onPress={() => setPaneMode('gantt')} />
          </View>

          {/* AI first — the headline feature. Highlighted style so it stands out. */}
          <HeaderBtn icon={Sparkles} label="AI" onPress={() => setShowAI(true)} highlighted />
          <HeaderBtn icon={RefreshCcw} label="Reflow" onPress={handleReflow} />
          <HeaderBtn icon={Bookmark} label="Baseline" onPress={handleCaptureBaseline} onLongPress={handleCompareBaseline} />
          <HeaderBtn icon={Download} label="CSV" onPress={handleExportCsv} />
          <HeaderBtn icon={Sparkles} label="Demo" onPress={handleLoadDemo} />
          <HeaderBtn icon={Undo2} label="Undo" onPress={handleUndo} disabled={history.length === 0} />
          <HeaderBtn icon={Redo2} label="Redo" onPress={handleRedo} disabled={future.length === 0} />
          <HeaderBtn
            icon={Activity}
            label="CPM"
            onPress={() => {
              const msg = `Project finish: day ${cpm.projectFinish}\nCritical path: ${cpm.criticalPath.length} task(s)\nConflicts: ${cpm.conflicts.length}`;
              if (Platform.OS === 'web') window.alert?.(msg);
              else Alert.alert('Schedule analysis', msg);
            }}
          />
          <HeaderBtn icon={Share2} label="Share" onPress={handleShare} />
        </View>
      </View>

      {/* Body — renders grid, gantt, or both depending on pane mode */}
      <View style={styles.body}>
        {paneMode !== 'gantt' && (
          <View style={paneMode === 'split' ? styles.paneHalf : styles.paneFull}>
            <GridPane
              tasks={workingTasks}
              projectStartDate={projectStartDate}
              workingDaysPerWeek={workingDaysPerWeek}
              onEdit={handleEdit}
              onAddTask={handleAddTask}
              onDeleteTask={handleDeleteTask}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onBulkDelete={handleBulkDelete}
              onBulkDuplicate={handleBulkDuplicate}
              onBulkShiftDays={handleBulkShiftDays}
              onBulkSetPhase={handleBulkSetPhase}
              onBulkSetCrew={handleBulkSetCrew}
              onBulkAskAI={handleBulkAskAI}
            />
          </View>
        )}
        {paneMode !== 'grid' && (
          <View style={paneMode === 'split' ? styles.paneHalfRight : styles.paneFull}>
            <InteractiveGantt
              tasks={workingTasks}
              cpm={cpm}
              projectStartDate={projectStartDate}
              onEdit={handleEdit}
              onDependencyCreate={handleDependencyCreate}
            />
          </View>
        )}
      </View>

      {/* AI drawer — mounted always so opening/closing animates, but invisible
          (pointerEvents="none" inside) when !visible to avoid swallowing clicks. */}
      <AIAssistantPanel
        visible={showAI}
        onClose={() => setShowAI(false)}
        tasks={workingTasks}
        cpm={cpm}
        projectStartDate={projectStartDate}
        todayDayNumber={todayDayNumber}
        selectedIds={selectedIds}
        onApplyPatch={handleEdit}
        onApplyBulkPatches={(patches) => {
          // Batch a set of AI-proposed patches into one undoable commit.
          commit(prev => {
            const patchMap = new Map(patches.map(p => [p.taskId, p.patch]));
            return prev.map(t => {
              const patch = patchMap.get(t.id);
              return patch ? { ...t, ...patch } : t;
            });
          });
        }}
        onReplaceAll={handleReplaceAll}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pane toggle button
// ---------------------------------------------------------------------------

function PaneBtn({
  icon: Icon, label, active, onPress,
}: { icon: any; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.paneBtn, active && styles.paneBtnActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Icon size={13} color={active ? Colors.primary : Colors.textSecondary} />
      <Text style={[styles.paneBtnText, active && styles.paneBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Small header-button subcomponent (keeps the header JSX tidy)
// ---------------------------------------------------------------------------

function HeaderBtn({
  icon: Icon, label, onPress, onLongPress, disabled, highlighted,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  const tint = disabled ? Colors.textMuted : highlighted ? '#fff' : Colors.primary;
  return (
    <TouchableOpacity
      style={[
        styles.headerBtn,
        highlighted && styles.headerBtnHighlighted,
        disabled && styles.headerBtnDisabled,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Icon size={14} color={tint} />
      <Text style={[styles.headerBtnText, { color: tint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 440 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 12,
  },
  primaryBtnText: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 14 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  headerBack: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
  },
  headerBackText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  headerTitleWrap: { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
  },
  headerBtnDisabled: { backgroundColor: Colors.fillTertiary, opacity: 0.6 },
  headerBtnHighlighted: { backgroundColor: Colors.primary },
  headerBtnText: { fontSize: 12, fontWeight: '700', color: Colors.primary },

  body: {
    flex: 1,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
  },
  paneFull: { flex: 1 },
  paneHalf: { flex: 1, minWidth: 0 },
  paneHalfRight: { flex: 1, minWidth: 0 },

  paneToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 8,
    padding: 2,
    marginRight: 4,
  },
  paneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  paneBtnActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  paneBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  paneBtnTextActive: {
    color: Colors.primary,
  },
});

```


---

### `app/shared-schedule.tsx`

```tsx
// /shared-schedule?t=<token>
//
// Read-only viewer for a schedule snapshot shared via URL. The token is the
// base64-encoded payload — we decode it, run CPM for critical-path coloring,
// and render the InteractiveGantt in a locked mode (all edit handlers
// no-op). No backend needed.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, ChevronLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import InteractiveGantt from '@/components/schedule/InteractiveGantt';
import { runCpm } from '@/utils/cpm';
import { decodeShareToken, tasksFromSharePayload } from '@/utils/scheduleOps';

export default function SharedScheduleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLocalSearchParams<{ t?: string }>();
  const { width } = useWindowDimensions();

  const payload = useMemo(() => (t ? decodeShareToken(String(t)) : null), [t]);
  const tasks = useMemo(() => payload ? tasksFromSharePayload(payload) : [], [payload]);
  const cpm = useMemo(() => runCpm(tasks), [tasks]);
  const projectStartDate = useMemo(
    () => payload ? new Date(payload.projectStartISO) : new Date(),
    [payload],
  );

  if (!payload) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ title: 'Schedule' }} />
        <Lock size={28} color={Colors.textMuted} />
        <Text style={styles.title}>Invalid or expired link</Text>
        <Text style={styles.body}>
          This schedule link could not be opened. Ask the sender for a fresh link.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/' as any)} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const narrow = width < 900;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={18} color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{payload.name}</Text>
          <Text style={styles.sub}>
            Read-only · {tasks.length} tasks · finish day {cpm.projectFinish} ·
            {cpm.criticalPath.length} on critical path
          </Text>
        </View>
        <View style={styles.lockBadge}>
          <Lock size={12} color={Colors.textSecondary} />
          <Text style={styles.lockBadgeText}>Shared view</Text>
        </View>
      </View>

      {narrow ? (
        // Simple list fallback for phones.
        <View style={styles.body}>
          <Text style={styles.narrowIntro}>
            Open this link on a laptop or iPad to see the full Gantt chart.
          </Text>
          {tasks.map((task, i) => (
            <View key={task.id} style={styles.narrowRow}>
              <Text style={styles.narrowIdx}>{i + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.narrowTitle}>{task.title}</Text>
                <Text style={styles.narrowMeta}>
                  {task.phase} · {task.durationDays}d · day {task.startDay}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.body}>
          <InteractiveGantt
            tasks={tasks}
            cpm={cpm}
            projectStartDate={projectStartDate}
            onEdit={() => { /* locked */ }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  titleWrap: { flex: 1, marginHorizontal: 8 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  lockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    backgroundColor: Colors.fillSecondary,
  },
  lockBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
  body: { flex: 1, padding: 12 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  narrowIntro: { fontSize: 13, color: Colors.textSecondary, marginBottom: 16, fontStyle: 'italic' },
  narrowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  narrowIdx: { fontSize: 12, color: Colors.textMuted, width: 24, paddingTop: 2 },
  narrowTitle: { fontSize: 13, fontWeight: '600', color: Colors.text },
  narrowMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  body_: {},
});


```


---

### `components/AIAutoScheduleButton.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Sparkles, CalendarDays, Link2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { generateScheduleFromEstimate } from '@/utils/autoScheduleFromEstimate';
import type { Project, LinkedEstimate } from '@/types';

interface AIAutoScheduleButtonProps {
  project: Project;
  estimate: LinkedEstimate;
  onScheduleCreated: (schedule: Project['schedule']) => void;
  testID?: string;
}

export default function AIAutoScheduleButton({ project, estimate, onScheduleCreated, testID }: AIAutoScheduleButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handlePress = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (project.schedule && project.schedule.tasks.length > 0) {
      Alert.alert(
        'Schedule Exists',
        'This project already has a schedule. Generating will replace it. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: () => void runGenerate() },
        ],
      );
      return;
    }
    void runGenerate();
  }, [project]);

  const runGenerate = useCallback(async () => {
    setLoading(true);
    try {
      const result = await generateScheduleFromEstimate(project, estimate);
      onScheduleCreated(result.schedule);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Schedule Generated',
        `Created ${result.tasks.length} tasks across ${new Set(result.tasks.map(t => t.phase)).size} phases. ${result.linkedItemCount} estimate items linked to tasks.`,
        [
          { text: 'Stay Here', style: 'cancel' },
          { text: 'View Schedule', onPress: () => router.replace('/(tabs)/schedule' as any) },
        ],
      );
    } catch (err: any) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Generation Failed', err?.message || 'Could not build a schedule from this estimate. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [project, estimate, onScheduleCreated, router]);

  const itemCount = estimate.items.length;
  const categoryCount = new Set(estimate.items.map(i => (i.category || 'general').toLowerCase())).size;

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Sparkles size={16} color={Colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Auto-Schedule from Estimate</Text>
          <Text style={styles.subtitle}>
            AI builds tasks + dependencies from your {itemCount} line item{itemCount === 1 ? '' : 's'} across {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}.
          </Text>
        </View>
      </View>

      <View style={styles.benefitsRow}>
        <View style={styles.benefitChip}>
          <CalendarDays size={11} color={Colors.primary} />
          <Text style={styles.benefitText}>Realistic durations</Text>
        </View>
        <View style={styles.benefitChip}>
          <Link2 size={11} color={Colors.primary} />
          <Text style={styles.benefitText}>Linked to estimate items</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.actionBtn, loading && { opacity: 0.6 }]}
        onPress={handlePress}
        activeOpacity={0.85}
        disabled={loading}
        testID="auto-schedule-generate-btn"
      >
        {loading ? (
          <>
            <ActivityIndicator size="small" color="#FFF" />
            <Text style={styles.actionBtnText}>Building schedule…</Text>
          </>
        ) : (
          <>
            <Sparkles size={15} color="#FFF" />
            <Text style={styles.actionBtnText}>Generate Schedule</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.accent + '0C',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.accent + '30',
  },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.accent + '20', alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  benefitsRow: { flexDirection: 'row' as const, gap: 6, flexWrap: 'wrap' as const },
  benefitChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.primary + '12' },
  benefitText: { fontSize: 11, color: Colors.primary, fontWeight: '600' as const },
  actionBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.accent },
  actionBtnText: { fontSize: 14, fontWeight: '700' as const, color: '#FFF' },
});

```


---

### `components/AIScheduleRisk.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, RefreshCw, AlertTriangle, CheckCircle2, Zap, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  analyzeScheduleRisk, getCachedResult, setCachedResult,
  type ScheduleRiskResult,
} from '@/utils/aiService';
import type { ProjectSchedule } from '@/types';

interface Props {
  schedule: ProjectSchedule;
  projectId: string;
  weatherData?: string;
}

const SEVERITY_STYLES = {
  high: { bg: '#FFF0EF', border: '#FF3B30', icon: AlertTriangle, label: 'HIGH RISK', textColor: '#D32F2F' },
  medium: { bg: '#FFF8E1', border: '#FF9500', icon: Zap, label: 'MEDIUM RISK', textColor: '#E65100' },
  low: { bg: '#E8F5E9', border: '#34C759', icon: CheckCircle2, label: 'LOW RISK', textColor: '#2E7D32' },
} as const;

const TWO_HOURS = 2 * 60 * 60 * 1000;

export default React.memo(function AIScheduleRisk({ schedule, projectId, weatherData }: Props) {
  const [result, setResult] = useState<ScheduleRiskResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const cacheKey = `risk_${projectId}`;

  const loadOrAnalyze = useCallback(async (forceRefresh = false) => {
    if (isLoading) return;

    if (!forceRefresh && !hasLoaded) {
      const cached = await getCachedResult<ScheduleRiskResult & { analyzedAt: string }>(cacheKey, TWO_HOURS);
      if (cached) {
        setResult(cached);
        setLastAnalyzed(cached.analyzedAt);
        setHasLoaded(true);
        return;
      }
    }

    setIsLoading(true);
    try {
      const data = await analyzeScheduleRisk(schedule, weatherData);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const now = new Date().toISOString();
      setResult(data);
      setLastAnalyzed(now);
      setHasLoaded(true);
      await setCachedResult(cacheKey, { ...data, analyzedAt: now });
    } catch (err) {
      console.error('[AI Risk] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, schedule, weatherData, cacheKey, hasLoaded]);

  React.useEffect(() => {
    if (!hasLoaded && schedule.tasks.length > 0) {
      loadOrAnalyze();
    }
  }, [hasLoaded, schedule.tasks.length, loadOrAnalyze]);

  if (!hasLoaded && !isLoading) {
    return (
      <TouchableOpacity style={styles.initCard} onPress={() => loadOrAnalyze()}>
        <Sparkles size={18} color={Colors.primary} />
        <Text style={styles.initText}>Tap to run AI Risk Analysis</Text>
      </TouchableOpacity>
    );
  }

  if (isLoading && !result) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadingText}>Analyzing schedule risks...</Text>
        </View>
      </View>
    );
  }

  if (!result) return null;

  const risks = Array.isArray(result.risks) ? result.risks : [];
  const highRisks = risks.filter(r => r?.severity === 'high');
  const medRisks = risks.filter(r => r?.severity === 'medium');
  const lowCount = risks.filter(r => r?.severity === 'low').length;
  const otherCount = Math.max(0, schedule.tasks.length - risks.length);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Sparkles size={16} color={Colors.primary} />
          <Text style={styles.headerTitle}>AI Risk Forecast</Text>
        </View>
        <TouchableOpacity
          onPress={() => loadOrAnalyze(true)}
          disabled={isLoading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <RefreshCw size={16} color={Colors.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      {highRisks.map((risk, idx) => {
        const sev = SEVERITY_STYLES.high;
        return (
          <View key={`h-${idx}`} style={[styles.riskItem, { backgroundColor: sev.bg, borderLeftColor: sev.border }]}>
            <View style={styles.riskHeader}>
              <sev.icon size={14} color={sev.textColor} />
              <Text style={[styles.riskSeverity, { color: sev.textColor }]}>{sev.label}: "{risk.taskName}"</Text>
            </View>
            <Text style={styles.riskProb}>{risk.delayProbability ?? 0}% likely to be delayed {risk.delayDays ?? 0}+ days</Text>
            {(risk.reasons ?? []).map((r, i) => (
              <Text key={i} style={styles.riskReason}>• {r}</Text>
            ))}
            {risk.recommendation ? <Text style={styles.riskRec}>→ {risk.recommendation}</Text> : null}
          </View>
        );
      })}

      {medRisks.map((risk, idx) => {
        const sev = SEVERITY_STYLES.medium;
        return (
          <View key={`m-${idx}`} style={[styles.riskItem, { backgroundColor: sev.bg, borderLeftColor: sev.border }]}>
            <View style={styles.riskHeader}>
              <sev.icon size={14} color={sev.textColor} />
              <Text style={[styles.riskSeverity, { color: sev.textColor }]}>{sev.label}: "{risk.taskName}"</Text>
            </View>
            <Text style={styles.riskProb}>{risk.delayProbability ?? 0}% likely to slip {risk.delayDays ?? 0} days</Text>
            {risk.recommendation ? <Text style={styles.riskRec}>→ {risk.recommendation}</Text> : null}
          </View>
        );
      })}

      {(lowCount + otherCount) > 0 && (
        <View style={[styles.riskItem, { backgroundColor: '#E8F5E9', borderLeftColor: '#34C759' }]}>
          <View style={styles.riskHeader}>
            <CheckCircle2 size={14} color="#2E7D32" />
            <Text style={[styles.riskSeverity, { color: '#2E7D32' }]}>
              LOW RISK: {lowCount + otherCount} other tasks on track
            </Text>
          </View>
        </View>
      )}

      <View style={styles.confidenceRow}>
        <View style={styles.confItem}>
          <Text style={styles.confLabel}>Completion Confidence</Text>
          <Text style={[styles.confValue, { color: (result.overallConfidence ?? 0) >= 70 ? Colors.success : Colors.warning }]}>
            {result.overallConfidence ?? 0}%
          </Text>
        </View>
        {result.predictedEndDate ? (
          <View style={styles.confItem}>
            <Text style={styles.confLabel}>Predicted End</Text>
            <Text style={styles.confValue}>{result.predictedEndDate}</Text>
          </View>
        ) : null}
        {(result.predictedDelay ?? 0) > 0 && (
          <View style={styles.confItem}>
            <Text style={styles.confLabel}>Delay</Text>
            <Text style={[styles.confValue, { color: Colors.error }]}>+{result.predictedDelay}d</Text>
          </View>
        )}
      </View>

      {lastAnalyzed && (
        <Text style={styles.timestamp}>
          Last analyzed: {new Date(lastAnalyzed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  initCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: `${Colors.primary}08`,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${Colors.primary}20`,
    borderStyle: 'dashed',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  initText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontStyle: 'italic' as const,
  },
  riskItem: {
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    gap: 4,
  },
  riskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  riskSeverity: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  riskProb: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  riskReason: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  riskRec: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
    marginTop: 2,
  },
  confidenceRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  confItem: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  confLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  confValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  timestamp: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'right',
  },
});

```


---

### `components/schedule/GanttChart.tsx`

```tsx
import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Flag, GitBranch, CloudRain } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  formatShortDate,
  getStatusColor,
  getPhaseColor,
} from '@/utils/scheduleEngine';
import { findWeatherRisk, type DayForecast } from '@/utils/weatherService';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface GanttChartProps {
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  projectStartDate: Date;
  onTaskPress: (task: ScheduleTask) => void;
  showBaseline: boolean;
  /**
   * Optional forecast used to overlay weather warnings on tasks flagged
   * with `isWeatherSensitive`. When absent, no badges are rendered — the
   * chart stays visually identical to its pre-weather behavior. Callers
   * that want real-time weather coverage should pass the same forecast
   * they compute for the schedule screen so both views stay consistent.
   */
  forecast?: DayForecast[];
}

function GanttChart({ schedule, tasks, projectStartDate, onTaskPress, showBaseline, forecast }: GanttChartProps) {
  const totalDays = schedule.totalDurationDays;
  const ganttWidth = Math.max(SCREEN_WIDTH * 1.5, totalDays * 14 + 200);

  const phaseGroups = useMemo(() => {
    const groups: Record<string, ScheduleTask[]> = {};
    for (const task of tasks) {
      if (!groups[task.phase]) groups[task.phase] = [];
      groups[task.phase].push(task);
    }
    return groups;
  }, [tasks]);

  const todayOffset = useMemo(() => {
    const now = new Date();
    const diff = Math.ceil((now.getTime() - projectStartDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0 || diff > totalDays) return null;
    return (diff / totalDays) * 100;
  }, [projectStartDate, totalDays]);

  const renderGanttRow = useCallback((task: ScheduleTask) => {
    const statusColor = getStatusColor(task.status);
    const barLeft = totalDays > 0 ? ((task.startDay - 1) / totalDays) * 100 : 0;
    const barWidth = totalDays > 0 ? Math.max((task.durationDays / totalDays) * 100, 1.5) : 3;

    const weatherRisk =
      task.isWeatherSensitive && forecast && forecast.length > 0
        ? findWeatherRisk(
            projectStartDate,
            task.startDay,
            task.durationDays,
            forecast,
          )
        : null;

    const baselineTask = showBaseline && schedule.baseline
      ? schedule.baseline.tasks.find(b => b.id === task.id)
      : null;
    const baselineLeft = baselineTask && totalDays > 0
      ? ((baselineTask.startDay - 1) / totalDays) * 100 : null;
    const baselineWidth = baselineTask && totalDays > 0
      ? Math.max(((baselineTask.endDay - baselineTask.startDay) / totalDays) * 100, 1.5) : null;

    return (
      <TouchableOpacity
        key={task.id}
        style={s.ganttRow}
        onPress={() => onTaskPress(task)}
        activeOpacity={0.7}
      >
        <View style={s.ganttLabel}>
          <View style={s.ganttLabelIcons}>
            {task.isMilestone && <Flag size={9} color="#FF9500" />}
            {task.isCriticalPath && <GitBranch size={9} color={Colors.error} />}
            {weatherRisk && <CloudRain size={9} color="#F5A623" />}
          </View>
          <Text style={s.ganttLabelText} numberOfLines={1}>{task.title}</Text>
          <Text style={s.ganttLabelPercent}>{task.progress}%</Text>
        </View>
        <View style={s.ganttBarArea}>
          {baselineLeft !== null && baselineWidth !== null && (
            <View
              style={[
                s.ganttBaselineBar,
                { left: `${baselineLeft}%` as any, width: `${baselineWidth}%` as any },
              ]}
            />
          )}
          {task.isMilestone ? (
            <View
              style={[
                s.ganttDiamond,
                { left: `${barLeft}%` as any, backgroundColor: '#007AFF' },
              ]}
            />
          ) : (
            <View
              style={[
                s.ganttBar,
                {
                  left: `${barLeft}%` as any,
                  width: `${barWidth}%` as any,
                  backgroundColor: task.isCriticalPath ? Colors.error : statusColor,
                },
              ]}
            >
              {task.progress > 0 && (
                <View style={[s.ganttBarProgress, { width: `${task.progress}%` as any }]} />
              )}
            </View>
          )}
          {weatherRisk && (
            <View
              style={[
                s.ganttWeatherBadge,
                { left: `${Math.min(barLeft + barWidth, 99)}%` as any },
              ]}
              testID={`gantt-weather-warning-${task.id}`}
            >
              <Text style={s.ganttWeatherIcon}>{weatherRisk.icon}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [totalDays, schedule, showBaseline, onTaskPress, forecast, projectStartDate]);

  return (
    <View style={s.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator style={s.horizontalScroll}>
        <View style={{ width: ganttWidth }}>
          <View style={s.headerRow}>
            <View style={s.headerLabel}>
              <Text style={s.headerLabelText}>Task</Text>
            </View>
            <View style={s.headerTimeline}>
              {Array.from({ length: Math.ceil(totalDays / 7) }, (_, i) => {
                const weekStart = addDays(projectStartDate, i * 7);
                return (
                  <View key={i} style={[s.weekColumn, { width: `${(7 / totalDays) * 100}%` as any }]}>
                    <Text style={s.weekLabel}>{formatShortDate(weekStart)}</Text>
                  </View>
                );
              })}
              {todayOffset !== null && (
                <View style={[s.todayLine, { left: `${todayOffset}%` as any }]} />
              )}
            </View>
          </View>

          {Object.entries(phaseGroups).map(([phase, phaseTasks]) => (
            <View key={phase}>
              <View style={[s.phaseHeader, { borderLeftColor: getPhaseColor(phase) }]}>
                <Text style={s.phaseHeaderText}>{phase}</Text>
                <Text style={s.phaseHeaderCount}>{phaseTasks.length}</Text>
              </View>
              {phaseTasks.map(renderGanttRow)}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  horizontalScroll: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    height: 32,
  },
  headerLabel: {
    width: 130,
    justifyContent: 'center',
    paddingLeft: 12,
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
  },
  headerLabelText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  headerTimeline: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative' as any,
  },
  weekColumn: {
    borderRightWidth: 0.5,
    borderRightColor: Colors.borderLight,
    justifyContent: 'center',
    paddingLeft: 4,
  },
  weekLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  todayLine: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FF3B30',
    zIndex: 10,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.surfaceAlt,
    borderLeftWidth: 3,
  },
  phaseHeaderText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  phaseHeaderCount: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  ganttRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  ganttLabel: {
    width: 130,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
  },
  ganttLabelIcons: {
    flexDirection: 'row',
    gap: 2,
  },
  ganttLabelText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  ganttLabelPercent: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  ganttBarArea: {
    flex: 1,
    height: 20,
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  ganttBar: {
    position: 'absolute' as const,
    height: 16,
    borderRadius: 4,
    minWidth: 4,
    overflow: 'hidden' as const,
  },
  ganttBarProgress: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
  },
  ganttBaselineBar: {
    position: 'absolute' as const,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(120,120,128,0.2)',
    top: 14,
  },
  ganttDiamond: {
    position: 'absolute' as const,
    width: 10,
    height: 10,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  ganttWeatherBadge: {
    position: 'absolute' as const,
    top: -2,
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFF4E0',
    borderWidth: 1,
    borderColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ganttWeatherIcon: {
    fontSize: 8,
  },
});

export default React.memo(GanttChart);

```


---

### `components/schedule/InteractiveGantt.tsx`

```tsx
// InteractiveGantt — Phase 3 of the MS-Project-style rebuild.
//
// What this component does that the old GanttChart.tsx did not:
//   1. Drag the BODY of any bar horizontally → startDay changes.
//   2. Drag the RIGHT EDGE of any bar → durationDays changes.
//   3. Animated "marching ants" dependency lines drawn between predecessor and
//      successor bars. Red on the critical path, blue elsewhere. They glow
//      when either connected bar is hovered/dragged.
//   4. Smart tooltip follows the finger while dragging: "Pour foundation ·
//      Apr 22 → Apr 24 (+2d)".
//   5. "Today" red vertical line so field teams see where they are.
//   6. Milestone diamonds render for zero-duration tasks.
//   7. Zoom presets: Day (28px/day), Week (8px/day), Month (2px/day).
//
// Design rules we hold to
// -----------------------
//   * Parent owns state. We call `onEdit(taskId, patch)` with the final value
//     at drag-end; during the drag we animate a local overlay so the UI is
//     instant without round-tripping through the CPM engine on every frame.
//   * Cross-platform: uses PanResponder (works on web, iOS, iPadOS, Android)
//     and react-native-svg. No reanimated dependency — strokeDashoffset is
//     animated via Animated.Value which react-native-svg respects.
//   * Side-effect free render: we never mutate props. Bar positions are
//     derived from props every render; dragging writes to a ref+Animated.Value
//     and commits at the end.
//
// Interop with CPM
// ----------------
//   * We accept the CpmResult so we know which tasks are critical, and so
//     successor bars can snap to computed ES on commit. The parent is
//     expected to re-run runCpm() after each onEdit; we just show what we get.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  PanResponder,
  Animated,
  Easing,
  Platform,
  Pressable,
} from 'react-native';
import Svg, { Path, Defs, Marker, Polygon, Line as SvgLine, Rect as SvgRect } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { wouldCreateCycle, type CpmResult } from '@/utils/cpm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZoomMode = 'day' | 'week' | 'month';

export interface InteractiveGanttProps {
  tasks: ScheduleTask[];
  cpm: CpmResult;
  projectStartDate: Date;
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  /** Notify parent when the user requests a new dependency via drag (Phase 4). */
  onDependencyCreate?: (fromId: string, toId: string) => void;
  /** Forced initial zoom. Defaults to 'day' unless the project exceeds 90 days. */
  initialZoom?: ZoomMode;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 40;
const BAR_HEIGHT = 24;
const BAR_VERTICAL_PADDING = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const HEADER_HEIGHT = 52;          // month row (22) + day-number row (30)
const LEFT_GUTTER = 240;           // task-name column baked into the scroller
const RESIZE_HANDLE_WIDTH = 10;    // px on the right edge that triggers resize vs move
const MIN_BAR_PX_WIDTH = 14;       // don't let bars collapse below this during drag
const TODAY_COLOR = '#FF3B30';

const PX_PER_DAY: Record<ZoomMode, number> = {
  day: 28,
  week: 8,
  month: 2,
};

// ---------------------------------------------------------------------------
// Date helpers (1-indexed inclusive day numbering — matches the rest of the app)
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtShort(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtMonth(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InteractiveGantt(props: InteractiveGanttProps) {
  const { tasks, cpm, projectStartDate, onEdit, onDependencyCreate, initialZoom } = props;

  // --- Zoom -----------------------------------------------------------------
  const [zoom, setZoom] = useState<ZoomMode>(() => {
    if (initialZoom) return initialZoom;
    const span = Math.max(1, cpm.projectFinish);
    if (span > 180) return 'month';
    if (span > 60) return 'week';
    return 'day';
  });
  const pxPerDay = PX_PER_DAY[zoom];

  // --- Derived totals -------------------------------------------------------
  // Always render at least ~30 days to the right of project finish so users can
  // visually extend, and always start at day 1 (project start).
  const totalDays = useMemo(() => {
    const lastEf = cpm.projectFinish || 1;
    const tail = zoom === 'month' ? 60 : zoom === 'week' ? 30 : 14;
    return Math.max(30, lastEf + tail);
  }, [cpm.projectFinish, zoom]);

  const timelineWidth = totalDays * pxPerDay;
  const gridHeight = HEADER_HEIGHT + tasks.length * ROW_HEIGHT;

  // Today's offset in day coordinates (1-indexed). Can be negative (project
  // starts in the future) or > totalDays (project is ancient history).
  const todayDayNumber = useMemo(() => {
    const now = new Date();
    // "Day 1" is projectStartDate. So today = daysBetween + 1.
    return daysBetween(projectStartDate, now) + 1;
  }, [projectStartDate]);

  // --- Hover / drag state --------------------------------------------------
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    taskId: string;
    mode: 'move' | 'resize';
    originalStart: number;
    originalDuration: number;
    currentStart: number;
    currentDuration: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);

  // Phase 4: dependency-creation drag state. Separate from bar move/resize
  // because the gesture starts on a small handle, not the bar body, and it
  // needs to render a rubber-band line through release.
  const [linkDrag, setLinkDrag] = useState<{
    sourceTaskId: string;
    pointerLocalX: number;   // coords in the timeline's local space
    pointerLocalY: number;
    hoverTargetId: string | null;
    invalid: boolean;        // cycle or self-link → render red
  } | null>(null);
  const linkOriginRef = useRef<{ pageX: number; pageY: number; originX: number; originY: number } | null>(null);

  // --- Derived bar geometry ------------------------------------------------
  // During a drag, the active bar uses dragState values; everyone else uses
  // props. This lets the parent avoid re-running CPM 60 times/second.
  const bars = useMemo(() => {
    return tasks.map((task, index) => {
      const isDragging = dragState?.taskId === task.id;
      const startDay = isDragging ? dragState.currentStart : task.startDay;
      const duration = isDragging ? dragState.currentDuration : task.durationDays;
      const isMilestone = task.isMilestone || duration === 0;
      const cpmRow = cpm.perTask.get(task.id);
      const isCritical = !!cpmRow?.isCritical;
      const x = (startDay - 1) * pxPerDay;
      const w = Math.max(
        isMilestone ? 0 : MIN_BAR_PX_WIDTH,
        duration * pxPerDay,
      );
      const y = HEADER_HEIGHT + index * ROW_HEIGHT + BAR_VERTICAL_PADDING;
      return { task, index, startDay, duration, isMilestone, isCritical, x, y, w, cpmRow };
    });
  }, [tasks, dragState, cpm, pxPerDay]);

  // Quick lookup for dependency drawing.
  const barById = useMemo(() => {
    const m = new Map<string, (typeof bars)[number]>();
    bars.forEach(b => m.set(b.task.id, b));
    return m;
  }, [bars]);

  // --- Marching ants animation -------------------------------------------
  // A single Animated.Value shared by every dashed arrow. We animate it from
  // 0 → -16 (dash pattern length) in a loop; react-native-svg interpolates
  // strokeDashoffset natively.
  const dashOffset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(dashOffset, {
        toValue: -16,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [dashOffset]);

  // --- Drag machinery ------------------------------------------------------
  // We use a PanResponder per-bar (bound via onStartShouldSetResponder pattern
  // in the child). For perf it's one object per bar; that's fine because we
  // never have thousands of tasks on screen.
  const startPointer = useRef<{ x: number; y: number; startDay: number; duration: number } | null>(null);

  const beginDrag = useCallback((task: ScheduleTask, mode: 'move' | 'resize', evt: any) => {
    const { pageX, pageY } = evt.nativeEvent;
    startPointer.current = {
      x: pageX,
      y: pageY,
      startDay: task.startDay,
      duration: task.durationDays,
    };
    setDragState({
      taskId: task.id,
      mode,
      originalStart: task.startDay,
      originalDuration: task.durationDays,
      currentStart: task.startDay,
      currentDuration: task.durationDays,
      pointerX: pageX,
      pointerY: pageY,
    });
  }, []);

  const updateDrag = useCallback((evt: any) => {
    if (!startPointer.current) return;
    const { pageX, pageY } = evt.nativeEvent;
    const dx = pageX - startPointer.current.x;
    const deltaDays = Math.round(dx / pxPerDay);
    setDragState(prev => {
      if (!prev) return prev;
      if (prev.mode === 'move') {
        const nextStart = Math.max(1, startPointer.current!.startDay + deltaDays);
        return { ...prev, currentStart: nextStart, pointerX: pageX, pointerY: pageY };
      }
      // resize — only duration changes; clamp at 0 (milestone) min
      const nextDuration = Math.max(0, startPointer.current!.duration + deltaDays);
      return { ...prev, currentDuration: nextDuration, pointerX: pageX, pointerY: pageY };
    });
  }, [pxPerDay]);

  const endDrag = useCallback(() => {
    setDragState(prev => {
      if (!prev) return null;
      const patch: Partial<ScheduleTask> = {};
      if (prev.mode === 'move' && prev.currentStart !== prev.originalStart) {
        patch.startDay = prev.currentStart;
      } else if (prev.mode === 'resize' && prev.currentDuration !== prev.originalDuration) {
        patch.durationDays = prev.currentDuration;
        if (prev.currentDuration === 0) patch.isMilestone = true;
        else if (prev.originalDuration === 0 && prev.currentDuration > 0) patch.isMilestone = false;
      }
      if (Object.keys(patch).length > 0) {
        onEdit(prev.taskId, patch);
      }
      return null;
    });
    startPointer.current = null;
  }, [onEdit]);

  // --- Phase 4: drag-to-create dependencies -------------------------------
  // Hit-test: given pointer coords in timeline-local space, return the id of
  // the bar under it, or null. We don't care about pixel-perfect — we expand
  // the row hitbox to the full row height so sloppy drops still work.
  const hitTestBar = useCallback((localX: number, localY: number): string | null => {
    for (const b of bars) {
      const top = HEADER_HEIGHT + b.index * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (localY < top || localY > bottom) continue;
      // Match within the whole row left-of-bar-center to be forgiving; on miss
      // we still need something within the bar's horizontal footprint.
      if (localX >= b.x - 4 && localX <= b.x + Math.max(b.w, MIN_BAR_PX_WIDTH) + 4) {
        return b.task.id;
      }
    }
    return null;
  }, [bars]);

  const beginLinkDrag = useCallback((sourceTaskId: string, evt: any) => {
    const { pageX, pageY, locationX, locationY } = evt.nativeEvent;
    const src = barById.get(sourceTaskId);
    if (!src) return;
    // We store the origin in timeline-local coords. Since PanResponder gives
    // us pageX, we derive local by subtracting the delta between first page
    // position and the bar's known local position.
    const originLocalX = src.x + src.w;
    const originLocalY = src.y + BAR_HEIGHT / 2;
    linkOriginRef.current = {
      pageX, pageY,
      originX: originLocalX,
      originY: originLocalY,
    };
    setLinkDrag({
      sourceTaskId,
      pointerLocalX: originLocalX,
      pointerLocalY: originLocalY,
      hoverTargetId: null,
      invalid: false,
    });
  }, [barById]);

  const updateLinkDrag = useCallback((evt: any) => {
    if (!linkOriginRef.current) return;
    const { pageX, pageY } = evt.nativeEvent;
    const dx = pageX - linkOriginRef.current.pageX;
    const dy = pageY - linkOriginRef.current.pageY;
    const localX = linkOriginRef.current.originX + dx;
    const localY = linkOriginRef.current.originY + dy;
    setLinkDrag(prev => {
      if (!prev) return prev;
      const target = hitTestBar(localX, localY);
      let invalid = false;
      if (target) {
        if (target === prev.sourceTaskId) invalid = true;
        else if (wouldCreateCycle(tasks, target, prev.sourceTaskId)) invalid = true;
      }
      return {
        ...prev,
        pointerLocalX: localX,
        pointerLocalY: localY,
        hoverTargetId: target,
        invalid,
      };
    });
  }, [hitTestBar, tasks]);

  const endLinkDrag = useCallback(() => {
    setLinkDrag(prev => {
      if (!prev) return null;
      if (prev.hoverTargetId && !prev.invalid) {
        if (onDependencyCreate) {
          onDependencyCreate(prev.sourceTaskId, prev.hoverTargetId);
        } else {
          // Fallback: patch the successor ourselves.
          const target = tasks.find(t => t.id === prev.hoverTargetId);
          if (target && !target.dependencies.includes(prev.sourceTaskId)) {
            onEdit(prev.hoverTargetId, {
              dependencies: [...target.dependencies, prev.sourceTaskId],
            });
          }
        }
      }
      return null;
    });
    linkOriginRef.current = null;
  }, [onDependencyCreate, onEdit, tasks]);

  // --- Phase 5: as-built quick actions ------------------------------------
  const logStartToday = useCallback((task: ScheduleTask) => {
    const now = new Date();
    onEdit(task.id, {
      actualStartDay: todayDayNumber,
      actualStartDate: now.toISOString(),
      status: task.status === 'not_started' ? 'in_progress' : task.status,
    });
  }, [onEdit, todayDayNumber]);

  const logFinishToday = useCallback((task: ScheduleTask) => {
    const now = new Date();
    const patch: Partial<ScheduleTask> = {
      actualEndDay: todayDayNumber,
      actualEndDate: now.toISOString(),
      status: 'done',
      progress: 100,
    };
    if (task.actualStartDay == null) {
      patch.actualStartDay = task.startDay;
      patch.actualStartDate = now.toISOString();
    }
    onEdit(task.id, patch);
  }, [onEdit, todayDayNumber]);

  // One PanResponder for the whole timeline body. We decide move vs resize
  // based on where the gesture started relative to the bar's right edge.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false, // bars themselves claim gestures via Pressable + onLongPress won't work for drag; we use touch-down handler below
      onMoveShouldSetPanResponder: () => false,
    }),
  ).current;

  // --- Dependency paths ----------------------------------------------------
  // Draws a right-angle elbow from predecessor's right edge to successor's
  // left edge (FS). For SS we'd go left-to-left; FF right-to-right; SF
  // right-to-left inverted — we only render FS elbows for now and straight
  // lines for other types. Good enough for first pass.
  const dependencyPaths = useMemo(() => {
    const out: Array<{
      id: string;
      d: string;
      critical: boolean;
      highlighted: boolean;
    }> = [];
    for (const succ of bars) {
      const links = succ.task.dependencyLinks && succ.task.dependencyLinks.length > 0
        ? succ.task.dependencyLinks
        : succ.task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
      for (const link of links) {
        const pred = barById.get(link.taskId);
        if (!pred) continue;
        const linkType = link.type ?? 'FS';
        const criticalBoth = pred.isCritical && succ.isCritical;
        const highlighted =
          hoverTaskId === pred.task.id ||
          hoverTaskId === succ.task.id ||
          dragState?.taskId === pred.task.id ||
          dragState?.taskId === succ.task.id;

        // Endpoints
        let x1 = pred.x + pred.w;
        let y1 = pred.y + BAR_HEIGHT / 2;
        let x2 = succ.x;
        let y2 = succ.y + BAR_HEIGHT / 2;
        if (linkType === 'SS') {
          x1 = pred.x;
          x2 = succ.x;
        } else if (linkType === 'FF') {
          x1 = pred.x + pred.w;
          x2 = succ.x + succ.w;
        } else if (linkType === 'SF') {
          x1 = pred.x;
          x2 = succ.x + succ.w;
        }
        // Elbow path: short horizontal stub out, vertical, horizontal in.
        const stubOut = 14;
        const stubIn = 14;
        // If successor is left of predecessor, route above the predecessor to
        // avoid slicing through it.
        const goingForward = x2 >= x1;
        const midX = goingForward
          ? Math.max(x1 + stubOut, x2 - stubIn)
          : x1 + stubOut;
        const d = goingForward
          ? `M ${x1} ${y1} H ${midX} V ${y2} H ${x2 - 3}`
          : `M ${x1} ${y1} H ${midX} V ${pred.y - 8} H ${x2 - stubIn} V ${y2} H ${x2 - 3}`;
        out.push({
          id: `${pred.task.id}->${succ.task.id}`,
          d,
          critical: criticalBoth,
          highlighted,
        });
      }
    }
    return out;
  }, [bars, barById, hoverTaskId, dragState]);

  // --- Today marker -------------------------------------------------------
  const todayX = (todayDayNumber - 1) * pxPerDay;
  const todayVisible = todayX >= 0 && todayX <= timelineWidth;

  // --- Header (days) -------------------------------------------------------
  // Build day ticks. For zoom=day we label every day; week → every 7;
  // month → every 1st of month.
  const headerTicks = useMemo(() => {
    const ticks: Array<{ x: number; label: string; bold?: boolean; month?: string }> = [];
    if (zoom === 'day') {
      for (let d = 1; d <= totalDays; d++) {
        const date = addDays(projectStartDate, d - 1);
        ticks.push({
          x: (d - 1) * pxPerDay,
          label: String(date.getDate()),
          bold: date.getDate() === 1,
          month: date.getDate() === 1 || d === 1 ? fmtMonth(date) : undefined,
        });
      }
    } else if (zoom === 'week') {
      for (let d = 1; d <= totalDays; d += 7) {
        const date = addDays(projectStartDate, d - 1);
        ticks.push({
          x: (d - 1) * pxPerDay,
          label: fmtShort(date),
          month: d === 1 || date.getDate() <= 7 ? fmtMonth(date) : undefined,
        });
      }
    } else {
      // month
      let d = 1;
      while (d <= totalDays) {
        const date = addDays(projectStartDate, d - 1);
        ticks.push({
          x: (d - 1) * pxPerDay,
          label: fmtMonth(date),
          month: fmtMonth(date),
          bold: true,
        });
        // jump to next month's first
        const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
        d += Math.max(1, daysBetween(date, nextMonth));
      }
    }
    return ticks;
  }, [zoom, totalDays, projectStartDate, pxPerDay]);

  // --- Render ---------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>Gantt</Text>
        <View style={styles.zoomGroup}>
          {(['day', 'week', 'month'] as ZoomMode[]).map(z => (
            <TouchableOpacity
              key={z}
              onPress={() => setZoom(z)}
              style={[styles.zoomBtn, zoom === z && styles.zoomBtnActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.zoomBtnText, zoom === z && styles.zoomBtnTextActive]}>
                {z[0].toUpperCase() + z.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: Colors.error }]} />
          <Text style={styles.legendText}>Critical path</Text>
          <View style={[styles.legendDot, { backgroundColor: Colors.primary, marginLeft: 10 }]} />
          <Text style={styles.legendText}>Normal</Text>
        </View>
      </View>

      {/* Body: left task column + scrollable timeline */}
      <View style={styles.body}>
        {/* Left: task names, vertically synced with the timeline rows.
            We render this as its own ScrollView-coupled column. For simplicity
            we use a shared vertical ScrollView that contains both the gutter
            and the timeline side-by-side. The gutter stays fixed horizontally
            because the outer container clips. */}
        <View style={[styles.gutter, { width: LEFT_GUTTER }]}>
          <View style={[styles.gutterHeader, { height: HEADER_HEIGHT }]}>
            <Text style={styles.gutterHeaderText}>Task</Text>
          </View>
          {tasks.map((t, i) => {
            const isCritical = cpm.perTask.get(t.id)?.isCritical;
            const isHovered = hoverTaskId === t.id;
            return (
              <Pressable
                key={t.id}
                onHoverIn={() => setHoverTaskId(t.id)}
                onHoverOut={() => setHoverTaskId(null)}
                style={[
                  styles.gutterRow,
                  { height: ROW_HEIGHT },
                  isHovered && styles.gutterRowHover,
                ]}
              >
                <Text style={styles.gutterIndex}>{i + 1}</Text>
                {isCritical && <View style={styles.criticalDot} />}
                <Text
                  style={[styles.gutterName, isCritical && styles.gutterNameCritical]}
                  numberOfLines={1}
                >
                  {t.title || 'Untitled'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Right: horizontally scrolling timeline. We pair it with a vertical
            ScrollView so long schedules scroll both ways. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={{ minWidth: timelineWidth }}
          style={styles.timelineScroll}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ height: gridHeight, width: timelineWidth }}
            showsVerticalScrollIndicator
          >
            <View style={{ width: timelineWidth, height: gridHeight }}>
              {/* --- Header --- */}
              <View style={[styles.timelineHeader, { width: timelineWidth, height: HEADER_HEIGHT }]}>
                {/* Month row */}
                <View style={styles.timelineHeaderRow}>
                  {headerTicks
                    .filter(t => t.month)
                    .map((t, i) => (
                      <View key={`m-${i}-${t.x}`} style={[styles.monthCell, { left: t.x }]}>
                        <Text style={styles.monthText}>{t.month}</Text>
                      </View>
                    ))}
                </View>
                {/* Day row */}
                <View style={styles.timelineHeaderRow}>
                  {headerTicks.map((t, i) => (
                    <View key={`d-${i}-${t.x}`} style={[styles.dayCell, { left: t.x }]}>
                      <Text style={[styles.dayText, t.bold && styles.dayTextBold]}>
                        {t.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* --- Row backgrounds + weekend shading + today line --- */}
              {tasks.map((t, i) => (
                <View
                  key={`bg-${t.id}`}
                  style={[
                    styles.rowBg,
                    {
                      top: HEADER_HEIGHT + i * ROW_HEIGHT,
                      width: timelineWidth,
                      height: ROW_HEIGHT,
                      backgroundColor: i % 2 === 0 ? Colors.surface : Colors.surfaceAlt,
                    },
                  ]}
                />
              ))}

              {/* Vertical gridlines (every day for day-zoom, every week for week, every month for month) */}
              <Svg
                width={timelineWidth}
                height={gridHeight}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                {headerTicks.map((tick, i) => (
                  <SvgLine
                    key={`gl-${i}`}
                    x1={tick.x}
                    y1={HEADER_HEIGHT}
                    x2={tick.x}
                    y2={gridHeight}
                    stroke={tick.bold ? 'rgba(60,60,67,0.16)' : 'rgba(60,60,67,0.06)'}
                    strokeWidth={1}
                  />
                ))}
                {todayVisible && (
                  <SvgLine
                    x1={todayX}
                    y1={0}
                    x2={todayX}
                    y2={gridHeight}
                    stroke={TODAY_COLOR}
                    strokeWidth={2}
                    strokeDasharray="4,3"
                  />
                )}
              </Svg>

              {/* --- Dependency arrows with marching ants --- */}
              <Svg
                width={timelineWidth}
                height={gridHeight}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                <Defs>
                  <Marker
                    id="arrowRed"
                    markerWidth={8}
                    markerHeight={8}
                    refX={6}
                    refY={4}
                    orient="auto"
                  >
                    <Polygon points="0,0 8,4 0,8" fill={Colors.error} />
                  </Marker>
                  <Marker
                    id="arrowBlue"
                    markerWidth={8}
                    markerHeight={8}
                    refX={6}
                    refY={4}
                    orient="auto"
                  >
                    <Polygon points="0,0 8,4 0,8" fill={Colors.primary} />
                  </Marker>
                </Defs>

                {dependencyPaths.map(dep => {
                  const color = dep.critical ? Colors.error : Colors.primary;
                  return (
                    <AnimatedPath
                      key={dep.id}
                      d={dep.d}
                      stroke={color}
                      strokeWidth={dep.highlighted ? 2.2 : 1.5}
                      fill="none"
                      strokeDasharray="6,4"
                      strokeDashoffset={dashOffset as unknown as number}
                      markerEnd={`url(#${dep.critical ? 'arrowRed' : 'arrowBlue'})`}
                      opacity={dep.highlighted ? 1 : 0.75}
                    />
                  );
                })}

                {/* Today label pill (rendered in SVG so it scrolls with the timeline) */}
                {todayVisible && (
                  <>
                    <SvgLine
                      x1={todayX}
                      y1={HEADER_HEIGHT - 14}
                      x2={todayX}
                      y2={HEADER_HEIGHT - 14}
                      stroke={TODAY_COLOR}
                    />
                  </>
                )}
              </Svg>

              {/* --- Baseline ghost bars (Phase 5) --- */}
              {/* Rendered BEHIND planned bars so they show through as a dashed
                  silhouette of what was originally promised. Drawn in SVG so
                  they don't steal pointer events. */}
              <Svg
                width={timelineWidth}
                height={gridHeight}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                {bars.map(bar => {
                  const bStart = bar.task.baselineStartDay;
                  const bEnd = bar.task.baselineEndDay;
                  if (bStart == null || bEnd == null) return null;
                  const bx = (bStart - 1) * pxPerDay;
                  const bw = Math.max(MIN_BAR_PX_WIDTH, (bEnd - bStart + 1) * pxPerDay);
                  return (
                    <SvgRect
                      key={`baseline-${bar.task.id}`}
                      x={bx}
                      y={bar.y + BAR_HEIGHT - 6}
                      width={bw}
                      height={4}
                      fill="rgba(60,60,67,0.35)"
                      rx={1}
                    />
                  );
                })}

                {/* --- Actual overlay bars (Phase 5) --- */}
                {bars.map(bar => {
                  const aStart = bar.task.actualStartDay;
                  const aEnd = bar.task.actualEndDay ?? todayDayNumber;
                  if (aStart == null) return null;
                  const ax = (aStart - 1) * pxPerDay;
                  const aw = Math.max(MIN_BAR_PX_WIDTH, (aEnd - aStart + 1) * pxPerDay);
                  const finished = bar.task.actualEndDay != null;
                  const fillColor = finished
                    ? Colors.success
                    : 'rgba(52,199,89,0.55)';  // translucent green for in-progress
                  return (
                    <SvgRect
                      key={`actual-${bar.task.id}`}
                      x={ax}
                      y={bar.y + 2}
                      width={aw}
                      height={BAR_HEIGHT - 4}
                      fill={fillColor}
                      stroke={finished ? Colors.success : 'transparent'}
                      strokeWidth={finished ? 1 : 0}
                      rx={4}
                    />
                  );
                })}
              </Svg>

              {/* --- Bars --- */}
              {bars.map(bar => (
                <BarView
                  key={bar.task.id}
                  bar={bar}
                  isHovered={hoverTaskId === bar.task.id}
                  isDragging={dragState?.taskId === bar.task.id}
                  isLinkTarget={linkDrag?.hoverTargetId === bar.task.id}
                  linkInvalid={!!linkDrag?.invalid && linkDrag.hoverTargetId === bar.task.id}
                  todayDayNumber={todayDayNumber}
                  onHoverIn={() => setHoverTaskId(bar.task.id)}
                  onHoverOut={() => setHoverTaskId(null)}
                  onBeginDrag={(mode, evt) => beginDrag(bar.task, mode, evt)}
                  onMoveDrag={updateDrag}
                  onEndDrag={endDrag}
                  onBeginLink={(evt) => beginLinkDrag(bar.task.id, evt)}
                  onMoveLink={updateLinkDrag}
                  onEndLink={endLinkDrag}
                  onLogStartToday={() => logStartToday(bar.task)}
                  onLogFinishToday={() => logFinishToday(bar.task)}
                />
              ))}

              {/* --- Rubber-band dependency line (Phase 4) --- */}
              {linkDrag && (() => {
                const src = barById.get(linkDrag.sourceTaskId);
                if (!src) return null;
                const x1 = src.x + src.w;
                const y1 = src.y + BAR_HEIGHT / 2;
                const x2 = linkDrag.pointerLocalX;
                const y2 = linkDrag.pointerLocalY;
                const color = linkDrag.invalid ? Colors.error : (linkDrag.hoverTargetId ? Colors.success : Colors.primary);
                return (
                  <Svg
                    width={timelineWidth}
                    height={gridHeight}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                  >
                    <Path
                      d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
                      stroke={color}
                      strokeWidth={2.5}
                      fill="none"
                      strokeDasharray="5,4"
                    />
                    <SvgRect
                      x={x2 - 5}
                      y={y2 - 5}
                      width={10}
                      height={10}
                      fill={color}
                      stroke="#fff"
                      strokeWidth={2}
                      rx={5}
                    />
                  </Svg>
                );
              })()}

              {/* --- Drag tooltip (floats by bar) --- */}
              {dragState && (() => {
                const bar = barById.get(dragState.taskId);
                if (!bar) return null;
                const startDate = addDays(projectStartDate, dragState.currentStart - 1);
                const finishDate = addDays(
                  projectStartDate,
                  dragState.currentStart + Math.max(0, dragState.currentDuration - 1) - 1,
                );
                const deltaStart = dragState.currentStart - dragState.originalStart;
                const deltaDur = dragState.currentDuration - dragState.originalDuration;
                const tipX = Math.max(4, Math.min(timelineWidth - 220, bar.x));
                const tipY = Math.max(HEADER_HEIGHT + 4, bar.y - 44);
                return (
                  <View style={[styles.tooltip, { left: tipX, top: tipY }]} pointerEvents="none">
                    <Text style={styles.tooltipTitle} numberOfLines={1}>{bar.task.title || 'Task'}</Text>
                    <Text style={styles.tooltipBody}>
                      {fmtShort(startDate)} → {fmtShort(finishDate)}
                      {dragState.mode === 'move' && deltaStart !== 0 && (
                        <Text style={styles.tooltipDelta}> ({deltaStart > 0 ? '+' : ''}{deltaStart}d)</Text>
                      )}
                      {dragState.mode === 'resize' && deltaDur !== 0 && (
                        <Text style={styles.tooltipDelta}> ({deltaDur > 0 ? '+' : ''}{deltaDur}d dur)</Text>
                      )}
                    </Text>
                  </View>
                );
              })()}
            </View>
          </ScrollView>
        </ScrollView>
      </View>

      {/* Footer hints */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Drag middle to move · right edge to resize · blue dot to link · hover for Start/Finish today
          · grey stripe = baseline · green = actual
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BarView — a single Gantt bar, with drag-move and right-edge drag-resize.
// ---------------------------------------------------------------------------

interface BarViewProps {
  bar: {
    task: ScheduleTask;
    startDay: number;
    duration: number;
    isMilestone: boolean;
    isCritical: boolean;
    x: number;
    y: number;
    w: number;
    cpmRow: ReturnType<CpmResult['perTask']['get']>;
  };
  isHovered: boolean;
  isDragging: boolean;
  isLinkTarget: boolean;
  linkInvalid: boolean;
  todayDayNumber: number;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onBeginDrag: (mode: 'move' | 'resize', evt: any) => void;
  onMoveDrag: (evt: any) => void;
  onEndDrag: () => void;
  onBeginLink: (evt: any) => void;
  onMoveLink: (evt: any) => void;
  onEndLink: () => void;
  onLogStartToday: () => void;
  onLogFinishToday: () => void;
}

function BarView({
  bar, isHovered, isDragging, isLinkTarget, linkInvalid, todayDayNumber,
  onHoverIn, onHoverOut,
  onBeginDrag, onMoveDrag, onEndDrag,
  onBeginLink, onMoveLink, onEndLink,
  onLogStartToday, onLogFinishToday,
}: BarViewProps) {
  // Decide whether a touch at offsetX is on the body (move) or right edge (resize).
  const pickMode = (offsetX: number, width: number): 'move' | 'resize' => {
    if (bar.isMilestone) return 'move';
    return offsetX >= width - RESIZE_HANDLE_WIDTH ? 'resize' : 'move';
  };

  // One PanResponder per bar. onStartShouldSet = true so it grabs the
  // gesture the instant the user touches it (beats ScrollView's capture).
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const { locationX } = evt.nativeEvent;
        const mode = pickMode(locationX, bar.w);
        onBeginDrag(mode, evt);
      },
      onPanResponderMove: (evt) => {
        onMoveDrag(evt);
      },
      onPanResponderRelease: () => onEndDrag(),
      onPanResponderTerminate: () => onEndDrag(),
    }),
  ).current;

  // Separate PanResponder for the dependency handle dot. It floats just off
  // the bar's right edge on hover and drags to any other bar.
  const linkResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => onBeginLink(evt),
      onPanResponderMove: (evt) => onMoveLink(evt),
      onPanResponderRelease: () => onEndLink(),
      onPanResponderTerminate: () => onEndLink(),
    }),
  ).current;

  // --- Variance calc for as-built badge (Phase 5) ------------------------
  // Compare actual dates to baseline (if present) or planned (as fallback).
  // +N = late, -N = early.
  const baseStart = bar.task.baselineStartDay ?? bar.task.startDay;
  const baseEnd = bar.task.baselineEndDay ?? (bar.task.startDay + Math.max(0, bar.task.durationDays - 1));
  const aStart = bar.task.actualStartDay;
  const aEnd = bar.task.actualEndDay;
  let varianceLabel: string | null = null;
  let varianceColor = Colors.textSecondary;
  if (aEnd != null) {
    const v = aEnd - baseEnd;
    if (v > 0) { varianceLabel = `+${v}d late`; varianceColor = Colors.error; }
    else if (v < 0) { varianceLabel = `${v}d early`; varianceColor = Colors.success; }
    else varianceLabel = 'on time';
  } else if (aStart != null) {
    const v = aStart - baseStart;
    if (v > 0) { varianceLabel = `started +${v}d`; varianceColor = Colors.warning; }
    else if (v < 0) { varianceLabel = `started ${v}d early`; varianceColor = Colors.success; }
    else varianceLabel = 'started on time';
  }

  const barColor = bar.isCritical ? Colors.error : Colors.primary;
  const barBg = bar.isCritical ? Colors.errorLight : Colors.primary + '1A';
  const progressColor = bar.isCritical ? Colors.error : Colors.primary;
  const progressPct = Math.max(0, Math.min(1, (bar.task.progress ?? 0) / 100));

  if (bar.isMilestone) {
    // Diamond, centered at bar.x, fills its row vertically.
    const size = BAR_HEIGHT;
    const cx = bar.x;
    const cy = bar.y + BAR_HEIGHT / 2;
    return (
      <View
        style={{
          position: 'absolute',
          left: cx - size / 2,
          top: cy - size / 2,
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '45deg' }],
          backgroundColor: barColor,
          borderRadius: 4,
          shadowColor: barColor,
          shadowOpacity: isHovered || isDragging ? 0.4 : 0.15,
          shadowRadius: isHovered || isDragging ? 6 : 2,
          shadowOffset: { width: 0, height: 1 },
          zIndex: isDragging ? 20 : 2,
        }}
        // @ts-expect-error — RN web pointer events
        onMouseEnter={onHoverIn}
        onMouseLeave={onHoverOut}
        {...responder.panHandlers}
      />
    );
  }

  // Drop-target highlight when a link is being dragged onto us.
  const targetRingColor = linkInvalid ? Colors.error : Colors.success;
  const showTargetRing = isLinkTarget;

  return (
    <>
      {/* Drop-target glow (rendered BEHIND the bar) */}
      {showTargetRing && (
        <View
          style={{
            position: 'absolute',
            left: bar.x - 4,
            top: bar.y - 4,
            width: bar.w + 8,
            height: BAR_HEIGHT + 8,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: targetRingColor,
            backgroundColor: targetRingColor + '22',
            zIndex: 1,
          }}
        />
      )}
    <View
      style={{
        position: 'absolute',
        left: bar.x,
        top: bar.y,
        width: bar.w,
        height: BAR_HEIGHT,
        borderRadius: 6,
        backgroundColor: barBg,
        borderWidth: 1.5,
        borderColor: barColor,
        overflow: 'hidden',
        shadowColor: barColor,
        shadowOpacity: isHovered || isDragging ? 0.35 : 0,
        shadowRadius: isHovered || isDragging ? 8 : 0,
        shadowOffset: { width: 0, height: 1 },
        zIndex: isDragging ? 20 : 2,
        cursor: Platform.OS === 'web' ? 'grab' : undefined,
      } as any}
      // @ts-expect-error — RN web pointer events
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
      {...responder.panHandlers}
    >
      {/* Progress fill */}
      <View
        style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${progressPct * 100}%`,
          backgroundColor: progressColor,
          opacity: 0.35,
        }}
      />
      {/* Title */}
      <View style={styles.barLabel}>
        <Text style={[styles.barLabelText, bar.isCritical && { color: Colors.error }]} numberOfLines={1}>
          {bar.task.title || 'Task'}
        </Text>
      </View>
      {/* Resize handle visual */}
      <View
        style={{
          position: 'absolute',
          right: 0, top: 0, bottom: 0,
          width: RESIZE_HANDLE_WIDTH,
          backgroundColor: isHovered || isDragging ? barColor : 'transparent',
          opacity: isHovered || isDragging ? 0.4 : 0,
          cursor: Platform.OS === 'web' ? 'ew-resize' : undefined,
        } as any}
      />
    </View>

    {/* --- Link handle (Phase 4): floats just off the right edge on hover.
        Drag it onto another bar to create a dependency. --- */}
    {isHovered && !isDragging && (
      <View
        style={{
          position: 'absolute',
          left: bar.x + bar.w + 6,
          top: bar.y + BAR_HEIGHT / 2 - 7,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: Colors.primary,
          borderWidth: 2,
          borderColor: '#fff',
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          zIndex: 15,
          cursor: Platform.OS === 'web' ? 'crosshair' : undefined,
        } as any}
        {...linkResponder.panHandlers}
      />
    )}

    {/* --- As-built action chip (Phase 5) --- */}
    {isHovered && !isDragging && (
      <View
        style={{
          position: 'absolute',
          left: bar.x,
          top: bar.y - 28,
          flexDirection: 'row',
          gap: 4,
          zIndex: 16,
        }}
      >
        {bar.task.actualStartDay == null && (
          <TouchableOpacity
            onPress={onLogStartToday}
            style={styles.chipBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.chipBtnText}>▶ Start today</Text>
          </TouchableOpacity>
        )}
        {bar.task.actualEndDay == null && (
          <TouchableOpacity
            onPress={onLogFinishToday}
            style={[styles.chipBtn, styles.chipBtnDone]}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipBtnText, { color: '#fff' }]}>✓ Finish today</Text>
          </TouchableOpacity>
        )}
      </View>
    )}

    {/* --- Variance badge (Phase 5) --- */}
    {varianceLabel && (
      <View
        style={{
          position: 'absolute',
          left: bar.x + bar.w + 8,
          top: bar.y + BAR_HEIGHT / 2 - 8,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: varianceColor + '22',
          zIndex: 3,
        }}
        pointerEvents="none"
      >
        <Text style={{ fontSize: 10, fontWeight: '700', color: varianceColor }}>
          {varianceLabel}
        </Text>
      </View>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Animated Path wrapper
// ---------------------------------------------------------------------------

const AnimatedPath = Animated.createAnimatedComponent(Path);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    gap: 16,
    backgroundColor: Colors.surfaceAlt,
  },
  toolbarTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  zoomGroup: {
    flexDirection: 'row',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 8,
    padding: 2,
  },
  zoomBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  zoomBtnActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  zoomBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  zoomBtnTextActive: {
    color: Colors.text,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },

  body: {
    flex: 1,
    flexDirection: 'row',
  },
  gutter: {
    borderRightWidth: 1,
    borderRightColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  gutterHeader: {
    paddingHorizontal: 12,
    justifyContent: 'flex-end',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  gutterHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  gutterRowHover: {
    backgroundColor: Colors.primary + '0A',
  },
  gutterIndex: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
    width: 20,
  },
  criticalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.error,
  },
  gutterName: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
  },
  gutterNameCritical: {
    color: Colors.error,
    fontWeight: '700',
  },

  timelineScroll: {
    flex: 1,
  },
  timelineHeader: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    backgroundColor: Colors.surfaceAlt,
  },
  timelineHeaderRow: {
    height: HEADER_HEIGHT / 2,
    position: 'relative',
  },
  monthCell: {
    position: 'absolute',
    top: 0,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  monthText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dayCell: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    minWidth: 24,
    paddingTop: 6,
  },
  dayText: {
    fontSize: 10,
    color: Colors.textSecondary,
  },
  dayTextBold: {
    fontWeight: '700',
    color: Colors.text,
  },

  rowBg: {
    position: 'absolute',
    left: 0,
  },

  barLabel: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  barLabelText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
  },

  tooltip: {
    position: 'absolute',
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    maxWidth: 240,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  tooltipTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  tooltipBody: {
    color: '#fff',
    fontSize: 11,
    marginTop: 2,
  },
  tooltipDelta: {
    color: Colors.accentLight,
    fontWeight: '700',
  },

  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    backgroundColor: Colors.surfaceAlt,
  },
  footerText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },

  // As-built hover chips (Phase 5)
  chipBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  chipBtnDone: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  chipBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.text,
  },
});

```


---

### `components/schedule/VerticalGantt.tsx`

```tsx
import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { GitBranch } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  formatShortDate,
  getPhaseColor,
  getTaskDateRange,
} from '@/utils/scheduleEngine';
import { getSimulatedForecast, getConditionIcon } from '@/utils/weatherService';

interface VerticalGanttProps {
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  projectStartDate: Date;
  onTaskPress: (task: ScheduleTask) => void;
  showBaseline: boolean;
}

interface DayRow {
  date: Date;
  dateStr: string;
  isToday: boolean;
  isWeekend: boolean;
  dayLabel: string;
  weekdayLabel: string;
  tasks: ScheduleTask[];
  weatherIcon?: string;
  isWorkable?: boolean;
}

function VerticalGantt({ schedule, tasks, projectStartDate, onTaskPress, showBaseline: _showBaseline }: VerticalGanttProps) {
  const now = useMemo(() => new Date(), []);
  const totalDays = schedule.totalDurationDays;

  const forecast = useMemo(() => {
    return getSimulatedForecast(now, 21);
  }, [now]);

  const dayRows = useMemo<DayRow[]>(() => {
    const rows: DayRow[] = [];
    const displayDays = Math.min(totalDays + 5, 90);

    for (let d = 0; d < displayDays; d++) {
      const date = new Date(projectStartDate);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];
      const dow = date.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const todayStr = now.toISOString().split('T')[0];
      const isToday = dateStr === todayStr;

      const dayTasks = tasks.filter(t => {
        const range = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
        return date >= range.start && date <= range.end && !t.isMilestone;
      });

      const weather = forecast.find(f => f.date === dateStr);

      rows.push({
        date,
        dateStr,
        isToday,
        isWeekend,
        dayLabel: formatShortDate(date),
        weekdayLabel: date.toLocaleDateString('en-US', { weekday: 'short' }),
        tasks: dayTasks,
        weatherIcon: weather ? getConditionIcon(weather.condition) : undefined,
        isWorkable: weather?.isWorkable,
      });
    }
    return rows;
  }, [tasks, projectStartDate, schedule, totalDays, now, forecast]);

  const renderTaskBar = useCallback((task: ScheduleTask) => {
    const phaseColor = getPhaseColor(task.phase);

    return (
      <TouchableOpacity
        key={task.id}
        style={[s.taskBar, { backgroundColor: task.isCriticalPath ? Colors.error + '18' : phaseColor + '18' }]}
        onPress={() => onTaskPress(task)}
        activeOpacity={0.7}
      >
        <View style={[s.taskBarFill, { width: `${task.progress}%` as any, backgroundColor: phaseColor + '30' }]} />
        <View style={s.taskBarContent}>
          <View style={s.taskBarIcons}>
            {task.isCriticalPath && <GitBranch size={9} color={Colors.error} />}
          </View>
          <Text style={[s.taskBarTitle, { color: phaseColor }]} numberOfLines={1}>{task.title}</Text>
          <Text style={s.taskBarPercent}>{task.progress}%</Text>
        </View>
      </TouchableOpacity>
    );
  }, [onTaskPress]);

  const renderDayRow = useCallback((row: DayRow) => {
    if (row.isWeekend && row.tasks.length === 0) return null;

    return (
      <View key={row.dateStr} style={[s.dayRow, row.isToday && s.dayRowToday, row.isWeekend && s.dayRowWeekend]}>
        {row.isToday && <View style={s.todayIndicator} />}
        <View style={s.dayLabel}>
          <Text style={[s.dayWeekday, row.isToday && s.dayWeekdayToday]}>{row.weekdayLabel}</Text>
          <Text style={[s.dayDate, row.isToday && s.dayDateToday]}>{row.dayLabel}</Text>
          {row.weatherIcon && (
            <Text style={s.dayWeather}>{row.weatherIcon}</Text>
          )}
        </View>
        <View style={s.dayTasks}>
          {row.tasks.length === 0 ? (
            <View style={s.emptyDay} />
          ) : (
            row.tasks.map(renderTaskBar)
          )}
        </View>
      </View>
    );
  }, [renderTaskBar]);

  return (
    <View style={s.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={s.headerDateCol}>
            <Text style={s.headerLabel}>DATE</Text>
          </View>
          <View style={s.headerTaskCol}>
            <Text style={s.headerLabel}>TASKS</Text>
          </View>
        </View>
        {dayRows.map(renderDayRow)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  headerDateCol: { width: 80, paddingLeft: 8 },
  headerTaskCol: { flex: 1, paddingLeft: 8 },
  headerLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  dayRow: {
    flexDirection: 'row',
    minHeight: 44,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    alignItems: 'stretch',
  },
  dayRowToday: {
    backgroundColor: Colors.primary + '06',
  },
  dayRowWeekend: {
    backgroundColor: Colors.fillSecondary,
  },
  todayIndicator: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: Colors.error,
    borderRadius: 1.5,
  },
  dayLabel: {
    width: 80,
    paddingVertical: 8,
    paddingLeft: 10,
    justifyContent: 'center',
    gap: 1,
  },
  dayWeekday: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  dayWeekdayToday: { color: Colors.error, fontWeight: '800' as const },
  dayDate: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  dayDateToday: { color: Colors.error, fontWeight: '800' as const },
  dayWeather: { fontSize: 12, marginTop: 1 },
  dayTasks: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
    gap: 3,
    justifyContent: 'center',
  },
  emptyDay: { height: 20 },
  taskBar: {
    borderRadius: 8,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  taskBarFill: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 8,
  },
  taskBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  taskBarIcons: { flexDirection: 'row', gap: 2 },
  taskBarTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  taskBarPercent: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.textMuted,
  },
});

export default React.memo(VerticalGantt);

```


---

### `components/schedule/GridPane.tsx`

```tsx
// GridPane — the spreadsheet-style editable task list.
//
// Why a dedicated grid instead of extending the existing task cards
// -----------------------------------------------------------------
// The current schedule screen forces every edit through a modal. That's the
// #1 complaint and the main reason the tool "feels stiff". MS Project and
// Smartsheet solved this 20 years ago: a dense, editable table where you
// tab through cells. This component rebuilds that pattern in React Native
// so it works in a web browser, on iPad touch, and on a laptop with a mouse.
//
// Design contract
// ---------------
// 1. Every write goes through `onEdit(taskId, patch)` — the parent owns state.
//    The grid itself never mutates tasks; it just proposes edits.
// 2. On every edit, the parent re-runs `runCpm(tasks)` and passes the result
//    back as `cpm`. We render Start/Finish/Float from that result, not from
//    raw task fields, so Start and Finish are ALWAYS in sync with the math.
// 3. Dependency edits are gated by `wouldCreateCycle()` — if the user tries
//    to enter a cycle, we surface an inline error and DO NOT commit. This is
//    the "forgiving UI" property from the playbook.
// 4. Actual-start / actual-finish columns exist but are rendered faded until
//    Phase 5 wires the field-reporting flow. We reserve the column space now
//    so the layout doesn't shift later.
//
// Platform notes
// --------------
// - Web: full keyboard nav (Enter=commit+down, Tab=right, Shift+Tab=left,
//   Esc=cancel). Uses native DOM onKeyDown via TextInput refs.
// - iPad/mobile: tap-to-edit, tap-outside-to-commit, hardware-keyboard
//   Enter also commits. No Tab navigation on touch — unnecessary friction.
// - We target screens ≥ 900px wide. The parent should only render GridPane
//   at that breakpoint; below that it stays with the existing card UI.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Alert,
} from 'react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, TaskStatus } from '@/types';
import {
  runCpm, formatFloat, wouldCreateCycle,
  type CpmResult, type CpmTaskResult,
} from '@/utils/cpm';
import { addWorkingDays, formatShortDate, getPhaseColor } from '@/utils/scheduleEngine';
import { AlertTriangle, Plus, Trash2, Check, Circle, Pause, Play, GripVertical, Copy, CalendarRange, Users, Layers, Sparkles, X } from 'lucide-react-native';

// ---------------------------------------------------------------------------
// Column definition — single source of truth for widths, alignment, editability
// ---------------------------------------------------------------------------

type ColumnKey =
  | 'rowNum' | 'wbs' | 'name' | 'duration' | 'start' | 'finish' | 'float'
  | 'predecessors' | 'crew' | 'status' | 'progress' | 'actions';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  /** 'text' = inline text input; 'number' = numeric; 'readonly' = display; 'custom' = special. */
  kind: 'text' | 'number' | 'readonly' | 'custom';
}

const COLUMNS: ColumnDef[] = [
  { key: 'rowNum',       label: '#',              width: 40,  align: 'center', kind: 'readonly' },
  { key: 'wbs',          label: 'WBS',            width: 70,  align: 'left',   kind: 'readonly' },
  { key: 'name',         label: 'Task Name',      width: 240, align: 'left',   kind: 'text' },
  { key: 'duration',     label: 'Dur.',           width: 62,  align: 'right',  kind: 'number' },
  { key: 'start',        label: 'Start',          width: 88,  align: 'left',   kind: 'readonly' },
  { key: 'finish',       label: 'Finish',         width: 88,  align: 'left',   kind: 'readonly' },
  { key: 'float',        label: 'Float',          width: 96,  align: 'left',   kind: 'readonly' },
  { key: 'predecessors', label: 'Predecessors',   width: 140, align: 'left',   kind: 'text' },
  { key: 'crew',         label: 'Crew',           width: 140, align: 'left',   kind: 'text' },
  { key: 'status',       label: 'Status',         width: 110, align: 'center', kind: 'custom' },
  { key: 'progress',     label: '% Done',         width: 72,  align: 'right',  kind: 'number' },
  { key: 'actions',      label: '',               width: 44,  align: 'center', kind: 'custom' },
];

const TOTAL_WIDTH = COLUMNS.reduce((s, c) => s + c.width, 0);
const ROW_HEIGHT = 40;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GridPaneProps {
  /** The schedule tasks. Parent owns the source of truth. */
  tasks: ScheduleTask[];
  /** Project calendar anchor for rendering Start/Finish as real dates. */
  projectStartDate: Date;
  /** 5 = workdays only, 7 = calendar days. */
  workingDaysPerWeek: number;
  /**
   * Commit edits back. The parent should:
   *   1. Apply the patch
   *   2. Re-run runCpm(newTasks)
   *   3. Pass the new tasks + cpm back into this component
   * All in one render cycle so the grid never shows stale derived values.
   */
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  /** Creates a new empty task at the bottom. */
  onAddTask: () => void;
  /** Deletes a task (also removes any dep references to it — parent's job). */
  onDeleteTask: (taskId: string) => void;
  /** Optional: highlight a specific task (e.g. the one dragged on the Gantt). */
  focusedTaskId?: string | null;
  // ---- Multi-select + bulk edit (optional — grid still works without these) ----
  /** Currently selected task ids. Controlled from the parent so the AI drawer
   *  can read the same selection. */
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Bulk ops — each should be ONE commit in the parent so undo restores the whole batch. */
  onBulkDelete?: (ids: string[]) => void;
  onBulkDuplicate?: (ids: string[]) => void;
  onBulkShiftDays?: (ids: string[], days: number) => void;
  onBulkSetPhase?: (ids: string[], phase: string) => void;
  onBulkSetCrew?: (ids: string[], crew: string) => void;
  /** Open the AI drawer pre-scoped to selection. */
  onBulkAskAI?: (ids: string[]) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GridPane({
  tasks, projectStartDate, workingDaysPerWeek,
  onEdit, onAddTask, onDeleteTask, focusedTaskId,
  selectedIds, onSelectionChange,
  onBulkDelete, onBulkDuplicate, onBulkShiftDays,
  onBulkSetPhase, onBulkSetCrew, onBulkAskAI,
}: GridPaneProps) {
  // Re-run CPM on every render. It's fast (< 1ms for a few hundred tasks) and
  // keeps the grid's derived columns honest. If profiling ever shows this as
  // a bottleneck, memoize on a tasks signature.
  const cpm: CpmResult = useMemo(() => runCpm(tasks), [tasks]);

  // Which cell is currently being edited. `null` means read-only mode.
  const [editing, setEditing] = useState<{ row: number; col: ColumnKey } | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [cellError, setCellError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Multi-select state helpers
  // ---------------------------------------------------------------------------
  // Selection is parent-controlled when `selectedIds` is provided (the AI
  // drawer needs to see it). We keep a local fallback for consumers who don't
  // care about selection, so the component still works standalone.
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const selected = selectedIds ?? localSelected;
  const setSelection = useCallback((next: Set<string>) => {
    if (onSelectionChange) onSelectionChange(next);
    else setLocalSelected(next);
  }, [onSelectionChange]);

  // Anchor for shift-click range selection. Cleared when selection is cleared.
  const anchorRef = useRef<number | null>(null);

  const toggleRow = useCallback((rowIndex: number, modKey: boolean, shiftKey: boolean) => {
    const task = tasks[rowIndex];
    if (!task) return;

    if (shiftKey && anchorRef.current != null) {
      const from = Math.min(anchorRef.current, rowIndex);
      const to = Math.max(anchorRef.current, rowIndex);
      const next = new Set(selected);
      for (let i = from; i <= to; i++) {
        const t = tasks[i];
        if (t) next.add(t.id);
      }
      setSelection(next);
      return;
    }

    const next = new Set(selected);
    if (modKey || next.has(task.id)) {
      // cmd/ctrl-click or clicking an already-selected row → toggle
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
    } else {
      // plain click on the # cell → replace selection with this one row
      next.clear();
      next.add(task.id);
    }
    anchorRef.current = rowIndex;
    setSelection(next);
  }, [tasks, selected, setSelection]);

  const clearSelection = useCallback(() => {
    anchorRef.current = null;
    setSelection(new Set());
  }, [setSelection]);

  const selectAll = useCallback(() => {
    setSelection(new Set(tasks.map(t => t.id)));
  }, [tasks, setSelection]);

  const selectedArray = useMemo(() => Array.from(selected), [selected]);

  // Map of task.id → wbsCode, used to let users type "1.2" as a predecessor
  // instead of the machine id. Falls back to the id if no WBS.
  const wbsToIdMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      if (t.wbsCode) m.set(t.wbsCode.trim(), t.id);
      m.set(t.id, t.id);
    }
    return m;
  }, [tasks]);

  const idToWbsMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) m.set(t.id, t.wbsCode || t.id);
    return m;
  }, [tasks]);

  // -------------------------------------------------------------------------
  // Begin / commit / cancel edit helpers
  // -------------------------------------------------------------------------

  const beginEdit = useCallback((row: number, col: ColumnKey) => {
    const colDef = COLUMNS.find(c => c.key === col);
    if (!colDef || colDef.kind === 'readonly' || colDef.kind === 'custom') return;

    const task = tasks[row];
    if (!task) return;

    let seed = '';
    switch (col) {
      case 'name':     seed = task.title; break;
      case 'duration': seed = String(task.durationDays ?? 0); break;
      case 'progress': seed = String(task.progress ?? 0); break;
      case 'crew':     seed = task.crew ?? ''; break;
      case 'predecessors':
        seed = (task.dependencyLinks ?? task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 })))
          .map(l => {
            const wbs = idToWbsMap.get(l.taskId) ?? l.taskId;
            const type = l.type && l.type !== 'FS' ? l.type : '';
            const lag = l.lagDays ? (l.lagDays > 0 ? `+${l.lagDays}` : `${l.lagDays}`) : '';
            return `${wbs}${type}${lag}`;
          })
          .join(', ');
        break;
    }
    setDraft(seed);
    setCellError(null);
    setEditing({ row, col });
  }, [tasks, idToWbsMap]);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft('');
    setCellError(null);
  }, []);

  /**
   * Apply the current draft to the task. Returns true iff the edit was
   * committed; false if validation failed (and error surfaced inline).
   */
  const commitEdit = useCallback((): boolean => {
    if (!editing) return false;
    const task = tasks[editing.row];
    if (!task) { cancelEdit(); return false; }

    const patch: Partial<ScheduleTask> = {};

    switch (editing.col) {
      case 'name': {
        const v = draft.trim();
        if (!v) { setCellError('Name cannot be empty'); return false; }
        patch.title = v;
        break;
      }
      case 'duration': {
        const v = Number.parseFloat(draft);
        if (!Number.isFinite(v) || v < 0) { setCellError('Duration must be 0 or more'); return false; }
        patch.durationDays = Math.round(v);
        break;
      }
      case 'progress': {
        const v = Number.parseFloat(draft);
        if (!Number.isFinite(v) || v < 0 || v > 100) { setCellError('Progress must be 0–100'); return false; }
        patch.progress = Math.round(v);
        if (v >= 100 && task.status !== 'done') patch.status = 'done';
        else if (v > 0 && v < 100 && task.status === 'not_started') patch.status = 'in_progress';
        break;
      }
      case 'crew': {
        patch.crew = draft.trim();
        break;
      }
      case 'predecessors': {
        // Parse "1.2, 2.1SS+2, 3.4FF-1" → DependencyLink[]
        // Reject early if any token is malformed or would create a cycle.
        const raw = draft.trim();
        if (!raw) {
          patch.dependencies = [];
          patch.dependencyLinks = [];
          break;
        }
        const tokens = raw.split(/[,;\s]+/).filter(Boolean);
        const links: NonNullable<ScheduleTask['dependencyLinks']> = [];
        for (const tok of tokens) {
          const m = tok.match(/^([A-Za-z0-9._-]+?)(FS|SS|FF|SF)?([+\-]\d+)?$/i);
          if (!m) { setCellError(`"${tok}" is not a valid dependency`); return false; }
          const [, ref, typeRaw, lagRaw] = m;
          const depId = wbsToIdMap.get(ref.trim());
          if (!depId) { setCellError(`No task matches "${ref}"`); return false; }
          if (depId === task.id) { setCellError('A task cannot depend on itself'); return false; }
          // Cycle guard — the headline "forgiving UI" feature.
          if (wouldCreateCycle(tasks, task.id, depId)) {
            setCellError(`"${ref}" would create a dependency loop`);
            return false;
          }
          const type = (typeRaw?.toUpperCase() ?? 'FS') as 'FS' | 'SS' | 'FF' | 'SF';
          const lagDays = lagRaw ? Number.parseInt(lagRaw, 10) : 0;
          links.push({ taskId: depId, type, lagDays });
        }
        patch.dependencies = links.map(l => l.taskId);
        patch.dependencyLinks = links;
        break;
      }
    }

    onEdit(task.id, patch);
    setEditing(null);
    setDraft('');
    setCellError(null);
    return true;
  }, [editing, draft, tasks, wbsToIdMap, onEdit, cancelEdit]);

  // -------------------------------------------------------------------------
  // Keyboard navigation (web). iPad/mobile rely on tap-to-edit + blur.
  // -------------------------------------------------------------------------

  const moveEdit = useCallback((direction: 'next' | 'prev' | 'down' | 'up') => {
    if (!editing) return;
    const editableCols = COLUMNS.filter(c => c.kind === 'text' || c.kind === 'number').map(c => c.key);
    const colIdx = editableCols.indexOf(editing.col);
    const rowCount = tasks.length;

    let nextRow = editing.row;
    let nextCol = editing.col;

    if (direction === 'next' || direction === 'prev') {
      const delta = direction === 'next' ? 1 : -1;
      let newColIdx = colIdx + delta;
      if (newColIdx >= editableCols.length) { newColIdx = 0; nextRow = (editing.row + 1) % rowCount; }
      if (newColIdx < 0) { newColIdx = editableCols.length - 1; nextRow = (editing.row - 1 + rowCount) % rowCount; }
      nextCol = editableCols[newColIdx];
    } else {
      const delta = direction === 'down' ? 1 : -1;
      nextRow = Math.max(0, Math.min(rowCount - 1, editing.row + delta));
    }

    if (!commitEdit()) return; // don't move if current cell is invalid
    setTimeout(() => beginEdit(nextRow, nextCol), 0);
  }, [editing, tasks.length, commitEdit, beginEdit]);

  // -------------------------------------------------------------------------
  // Date display helpers — all dates derived from CPM, never raw startDay
  // -------------------------------------------------------------------------

  const renderDate = useCallback((dayNumber: number): string => {
    if (!Number.isFinite(dayNumber) || dayNumber < 1) return '—';
    const d = addWorkingDays(projectStartDate, dayNumber - 1, workingDaysPerWeek);
    return formatShortDate(d);
  }, [projectStartDate, workingDaysPerWeek]);

  // -------------------------------------------------------------------------
  // Row render
  // -------------------------------------------------------------------------

  const hasCycleConflict = cpm.conflicts.some(c => c.kind === 'cycle');

  const renderCell = (task: ScheduleTask, rowIndex: number, col: ColumnDef, cpmRow: CpmTaskResult | undefined) => {
    const isEditingThis = editing?.row === rowIndex && editing?.col === col.key;
    const isEditable = col.kind === 'text' || col.kind === 'number';

    const cellStyle = [
      styles.cell,
      { width: col.width, alignItems: col.align === 'center' ? 'center' : col.align === 'right' ? 'flex-end' : 'flex-start' } as const,
      isEditingThis && styles.cellEditing,
      isEditingThis && cellError && styles.cellError,
    ];

    // Active edit state: TextInput
    if (isEditingThis) {
      return (
        <View key={col.key} style={cellStyle}>
          <TextInput
            autoFocus
            style={[styles.cellInput, col.align === 'right' && { textAlign: 'right' }, col.align === 'center' && { textAlign: 'center' }]}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => commitEdit()}
            onBlur={() => { commitEdit(); }}
            keyboardType={col.kind === 'number' ? 'decimal-pad' : 'default'}
            returnKeyType="done"
            selectTextOnFocus
            // Web-only: Tab / Shift-Tab / Escape handling. onKeyPress in RN
            // isn't reliable cross-platform; on web it fires with native key.
            onKeyPress={(e: any) => {
              if (Platform.OS !== 'web') return;
              const key = e?.nativeEvent?.key;
              if (key === 'Tab') { e.preventDefault?.(); moveEdit(e.shiftKey ? 'prev' : 'next'); }
              else if (key === 'Escape') { e.preventDefault?.(); cancelEdit(); }
              else if (key === 'Enter' && !e.shiftKey) { /* handled by onSubmitEditing */ }
              else if (key === 'ArrowDown') { e.preventDefault?.(); moveEdit('down'); }
              else if (key === 'ArrowUp')   { e.preventDefault?.(); moveEdit('up'); }
            }}
            testID={`grid-edit-${rowIndex}-${col.key}`}
          />
          {cellError && (
            <View style={styles.cellErrorTip}>
              <Text style={styles.cellErrorText}>{cellError}</Text>
            </View>
          )}
        </View>
      );
    }

    // Display state
    let display: React.ReactNode = null;

    switch (col.key) {
      case 'rowNum': {
        // The # cell doubles as the selection target. Plain click = select
        // just this row; Cmd/Ctrl-click = toggle; Shift-click = range-extend
        // from last anchor. Selected rows show a filled blue pill; unselected
        // show the row number. Click on any other cell opens cell-edit as
        // before — selection and edit never fight each other.
        const isSelected = selected.has(task.id);
        return (
          <TouchableOpacity
            key={col.key}
            style={[
              styles.cell,
              { width: col.width, alignItems: 'center' } as const,
              styles.selectCell,
              isSelected && styles.selectCellActive,
            ]}
            onPress={(e: any) => {
              const native = e?.nativeEvent ?? {};
              const modKey = !!(native.metaKey || native.ctrlKey);
              const shiftKey = !!native.shiftKey;
              toggleRow(rowIndex, modKey, shiftKey);
            }}
            activeOpacity={0.6}
            testID={`grid-select-${rowIndex}`}
          >
            {isSelected ? (
              <View style={styles.selectDot}>
                <Check size={10} color="#fff" />
              </View>
            ) : (
              <Text style={styles.cellTextMuted}>{rowIndex + 1}</Text>
            )}
          </TouchableOpacity>
        );
      }
      case 'wbs':
        display = <Text style={styles.cellTextMuted}>{task.wbsCode || '—'}</Text>;
        break;
      case 'name':
        display = (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {cpmRow?.isCritical && <View style={styles.criticalDot} />}
            {task.isMilestone && <Text style={styles.milestoneDiamond}>◆</Text>}
            <Text style={[styles.cellText, cpmRow?.isCritical && styles.criticalText]} numberOfLines={1}>
              {task.title}
            </Text>
          </View>
        );
        break;
      case 'duration':
        display = <Text style={styles.cellText}>{task.durationDays}d</Text>;
        break;
      case 'start':
        display = <Text style={styles.cellText}>{cpmRow ? renderDate(cpmRow.es) : '—'}</Text>;
        break;
      case 'finish':
        display = <Text style={styles.cellText}>{cpmRow ? renderDate(cpmRow.ef) : '—'}</Text>;
        break;
      case 'float': {
        if (!cpmRow) { display = <Text style={styles.cellTextMuted}>—</Text>; break; }
        const label = formatFloat(cpmRow.totalFloat);
        const color = cpmRow.isCritical ? Colors.error : cpmRow.totalFloat < 3 ? Colors.warning : Colors.success;
        display = <Text style={[styles.cellText, { color, fontWeight: '600' }]}>{label}</Text>;
        break;
      }
      case 'predecessors': {
        const links = task.dependencyLinks ?? task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
        if (links.length === 0) { display = <Text style={styles.cellTextMuted}>—</Text>; break; }
        const labels = links.map(l => {
          const wbs = idToWbsMap.get(l.taskId) ?? l.taskId;
          const type = l.type && l.type !== 'FS' ? l.type : '';
          const lag = l.lagDays ? (l.lagDays > 0 ? `+${l.lagDays}` : `${l.lagDays}`) : '';
          return `${wbs}${type}${lag}`;
        });
        display = <Text style={styles.cellText} numberOfLines={1}>{labels.join(', ')}</Text>;
        break;
      }
      case 'crew':
        display = <Text style={[styles.cellText, !task.crew && styles.cellTextMuted]}>{task.crew || '—'}</Text>;
        break;
      case 'status': {
        const chip = statusChip(task.status);
        display = (
          <TouchableOpacity
            style={[styles.statusChip, { backgroundColor: chip.bg }]}
            onPress={() => onEdit(task.id, { status: nextStatus(task.status) })}
            activeOpacity={0.7}
          >
            {chip.Icon && <chip.Icon size={10} color={chip.fg} />}
            <Text style={[styles.statusChipText, { color: chip.fg }]}>{chip.label}</Text>
          </TouchableOpacity>
        );
        break;
      }
      case 'progress':
        display = <Text style={styles.cellText}>{task.progress}%</Text>;
        break;
      case 'actions':
        display = (
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS === 'web') {
                if (window.confirm?.(`Delete "${task.title}"?`)) onDeleteTask(task.id);
              } else {
                Alert.alert('Delete task?', `"${task.title}" will be removed.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => onDeleteTask(task.id) },
                ]);
              }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Trash2 size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        );
        break;
    }

    if (isEditable) {
      return (
        <TouchableOpacity
          key={col.key}
          style={cellStyle}
          onPress={() => beginEdit(rowIndex, col.key)}
          activeOpacity={0.6}
          testID={`grid-cell-${rowIndex}-${col.key}`}
        >
          {display}
        </TouchableOpacity>
      );
    }
    return <View key={col.key} style={cellStyle}>{display}</View>;
  };

  // -------------------------------------------------------------------------
  // Cycle warning banner — surfaces CPM conflicts at the top of the grid
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Bulk action handlers — each wraps the parent's batch op in a sensible
  // confirm/prompt and then clears selection so the user sees the result.
  // ---------------------------------------------------------------------------

  const runBulkDelete = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const confirmMsg = `Delete ${ids.length} selected task${ids.length === 1 ? '' : 's'}? This can be undone.`;
    const go = () => {
      onBulkDelete?.(ids);
      clearSelection();
    };
    if (Platform.OS === 'web') {
      if (window.confirm?.(confirmMsg)) go();
    } else {
      Alert.alert('Delete tasks', confirmMsg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: go },
      ]);
    }
  }, [selected, onBulkDelete, clearSelection]);

  const runBulkDuplicate = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    onBulkDuplicate?.(ids);
    // Don't clear selection — the user probably wants to edit what they just
    // duplicated, and the parent is responsible for updating the selection
    // if it wants to move focus to the clones.
  }, [selected, onBulkDuplicate]);

  const runBulkShiftDays = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let daysStr: string | null = '1';
    if (Platform.OS === 'web') {
      daysStr = window.prompt?.('Shift selected tasks by how many days? (Negative = earlier)', '1') ?? null;
    } else {
      // No inline input on native — default to +1 and show a toast. A real
      // native UI would need a modal; punt until bulk edit is validated on web.
      daysStr = '1';
    }
    if (daysStr == null) return;
    const days = Number.parseInt(daysStr, 10);
    if (!Number.isFinite(days) || days === 0) return;
    onBulkShiftDays?.(ids, days);
  }, [selected, onBulkShiftDays]);

  const runBulkSetPhase = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let phase: string | null = '';
    if (Platform.OS === 'web') {
      phase = window.prompt?.('Set phase for selected tasks:', '') ?? null;
    }
    if (phase == null) return;
    const trimmed = phase.trim();
    if (!trimmed) return;
    onBulkSetPhase?.(ids, trimmed);
  }, [selected, onBulkSetPhase]);

  const runBulkSetCrew = useCallback(() => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    let crew: string | null = '';
    if (Platform.OS === 'web') {
      crew = window.prompt?.('Set crew for selected tasks:', '') ?? null;
    }
    if (crew == null) return;
    onBulkSetCrew?.(ids, crew.trim());
  }, [selected, onBulkSetCrew]);

  const runBulkAskAI = useCallback(() => {
    if (selected.size === 0) return;
    onBulkAskAI?.(Array.from(selected));
  }, [selected, onBulkAskAI]);

  // ---------------------------------------------------------------------------
  // Keyboard (web): Cmd/Ctrl-A to select all, Escape to clear, Delete to bulk-delete.
  // All gated on "not currently editing a cell" so we never steal focus from a
  // mid-edit TextInput.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (editing) return; // defer to the in-cell TextInput
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'a' && !inInput) {
        e.preventDefault();
        selectAll();
      } else if (key === 'escape' && selected.size > 0) {
        clearSelection();
      } else if ((key === 'delete' || key === 'backspace') && selected.size > 0 && !inInput) {
        e.preventDefault();
        runBulkDelete();
      } else if (mod && key === 'd' && selected.size > 0 && !inInput) {
        e.preventDefault();
        runBulkDuplicate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, selected, selectAll, clearSelection, runBulkDelete, runBulkDuplicate]);

  const renderConflictBanner = () => {
    if (cpm.conflicts.length === 0) return null;
    const summary = cpm.conflicts[0];
    return (
      <View style={[styles.banner, summary.kind === 'cycle' ? styles.bannerError : styles.bannerWarn]}>
        <AlertTriangle size={14} color={summary.kind === 'cycle' ? Colors.error : Colors.warning} />
        <Text style={styles.bannerText}>{summary.message}</Text>
        {cpm.conflicts.length > 1 && (
          <Text style={styles.bannerCount}>+{cpm.conflicts.length - 1} more</Text>
        )}
      </View>
    );
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const renderBulkBar = () => {
    if (selected.size === 0) return null;
    const n = selected.size;
    return (
      <View style={styles.bulkBar}>
        <TouchableOpacity onPress={clearSelection} style={styles.bulkClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={14} color={Colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.bulkCount}>{n} selected</Text>
        <View style={styles.bulkBtnRow}>
          {onBulkAskAI && (
            <TouchableOpacity style={[styles.bulkBtn, styles.bulkBtnAI]} onPress={runBulkAskAI} activeOpacity={0.7}>
              <Sparkles size={12} color="#fff" />
              <Text style={[styles.bulkBtnText, { color: '#fff' }]}>Ask AI</Text>
            </TouchableOpacity>
          )}
          {onBulkShiftDays && (
            <TouchableOpacity style={styles.bulkBtn} onPress={runBulkShiftDays} activeOpacity={0.7}>
              <CalendarRange size={12} color={Colors.primary} />
              <Text style={styles.bulkBtnText}>Shift days</Text>
            </TouchableOpacity>
          )}
          {onBulkSetPhase && (
            <TouchableOpacity style={styles.bulkBtn} onPress={runBulkSetPhase} activeOpacity={0.7}>
              <Layers size={12} color={Colors.primary} />
              <Text style={styles.bulkBtnText}>Phase</Text>
            </TouchableOpacity>
          )}
          {onBulkSetCrew && (
            <TouchableOpacity style={styles.bulkBtn} onPress={runBulkSetCrew} activeOpacity={0.7}>
              <Users size={12} color={Colors.primary} />
              <Text style={styles.bulkBtnText}>Crew</Text>
            </TouchableOpacity>
          )}
          {onBulkDuplicate && (
            <TouchableOpacity style={styles.bulkBtn} onPress={runBulkDuplicate} activeOpacity={0.7}>
              <Copy size={12} color={Colors.primary} />
              <Text style={styles.bulkBtnText}>Duplicate</Text>
            </TouchableOpacity>
          )}
          {onBulkDelete && (
            <TouchableOpacity style={[styles.bulkBtn, styles.bulkBtnDanger]} onPress={runBulkDelete} activeOpacity={0.7}>
              <Trash2 size={12} color={Colors.error} />
              <Text style={[styles.bulkBtnText, { color: Colors.error }]}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {renderConflictBanner()}

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ width: TOTAL_WIDTH }}>
          {/* Sticky header row */}
          <View style={styles.headerRow}>
            {COLUMNS.map(col => (
              <View
                key={col.key}
                style={[
                  styles.headerCell,
                  { width: col.width, alignItems: col.align === 'center' ? 'center' : col.align === 'right' ? 'flex-end' : 'flex-start' },
                ]}
              >
                <Text style={styles.headerText}>{col.label}</Text>
              </View>
            ))}
          </View>

          {/* Body rows */}
          <ScrollView style={{ maxHeight: 640 }} showsVerticalScrollIndicator>
            {tasks.map((task, rowIndex) => {
              const cpmRow = cpm.perTask.get(task.id);
              const isFocused = focusedTaskId === task.id;
              const isSelected = selected.has(task.id);
              const inCycleConflict = hasCycleConflict &&
                cpm.conflicts.some(c => c.kind === 'cycle' && c.taskIds.includes(task.id));

              return (
                <View
                  key={task.id}
                  style={[
                    styles.row,
                    rowIndex % 2 === 1 && styles.rowAlt,
                    isFocused && styles.rowFocused,
                    isSelected && styles.rowSelected,
                    inCycleConflict && styles.rowConflict,
                    { borderLeftColor: getPhaseColor(task.phase) },
                  ]}
                  testID={`grid-row-${rowIndex}`}
                >
                  {COLUMNS.map(col => renderCell(task, rowIndex, col, cpmRow))}
                </View>
              );
            })}

            {/* Footer: add-task button */}
            <TouchableOpacity
              style={styles.addRow}
              onPress={onAddTask}
              activeOpacity={0.6}
              testID="grid-add-task"
            >
              <Plus size={14} color={Colors.primary} />
              <Text style={styles.addRowText}>Add task</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </ScrollView>
      {renderBulkBar()}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Status chip helper
// ---------------------------------------------------------------------------

function statusChip(status: TaskStatus): { bg: string; fg: string; label: string; Icon?: any } {
  switch (status) {
    case 'done':
      return { bg: Colors.successLight, fg: Colors.success, label: 'Done', Icon: Check };
    case 'in_progress':
      return { bg: Colors.infoLight, fg: Colors.info, label: 'Active', Icon: Play };
    case 'on_hold':
      return { bg: Colors.warningLight, fg: Colors.warning, label: 'Hold', Icon: Pause };
    default:
      return { bg: Colors.fillTertiary, fg: Colors.textSecondary, label: 'Not Started', Icon: Circle };
  }
}

function nextStatus(status: TaskStatus): TaskStatus {
  const order: TaskStatus[] = ['not_started', 'in_progress', 'on_hold', 'done'];
  const idx = order.indexOf(status);
  return order[(idx + 1) % order.length];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    height: 36,
    alignItems: 'center',
  },
  headerCell: {
    paddingHorizontal: 10,
    height: '100%',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.borderLight,
  },
  headerText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    height: ROW_HEIGHT,
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
    borderLeftWidth: 3,
  },
  rowAlt: {
    backgroundColor: Colors.surface,
  },
  rowFocused: {
    backgroundColor: Colors.primary + '10',
  },
  rowConflict: {
    backgroundColor: Colors.error + '10',
  },
  cell: {
    paddingHorizontal: 10,
    height: '100%',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.borderLight,
  },
  cellEditing: {
    backgroundColor: Colors.primary + '10',
    borderColor: Colors.primary,
    borderWidth: 1.5,
    borderRadius: 4,
  },
  cellError: {
    backgroundColor: Colors.error + '15',
    borderColor: Colors.error,
  },
  cellText: {
    fontSize: 13,
    color: Colors.text,
  },
  cellTextMuted: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  cellInput: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    paddingVertical: 0,
    paddingHorizontal: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  cellErrorTip: {
    position: 'absolute',
    top: ROW_HEIGHT,
    left: 0,
    backgroundColor: Colors.error,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    zIndex: 100,
    minWidth: 180,
  },
  cellErrorText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  criticalDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: Colors.error,
  },
  criticalText: {
    fontWeight: '700',
    color: Colors.error,
  },
  milestoneDiamond: {
    fontSize: 12,
    color: Colors.primary,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderLight,
  },
  addRowText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  bannerError: {
    backgroundColor: Colors.error + '15',
    borderBottomColor: Colors.error + '40',
  },
  bannerWarn: {
    backgroundColor: Colors.warning + '15',
    borderBottomColor: Colors.warning + '40',
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
    fontWeight: '500',
  },
  bannerCount: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
  },

  // Selection + bulk edit
  rowSelected: {
    backgroundColor: Colors.primary + '18',
  },
  selectCell: {
    // Visually distinguish the # column as a clickable selection target.
    backgroundColor: Colors.surfaceAlt,
  },
  selectCellActive: {
    backgroundColor: Colors.primary + '20',
  },
  selectDot: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  bulkClear: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  bulkCount: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    marginRight: 4,
  },
  bulkBtnRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
  },
  bulkBtnAI: {
    backgroundColor: Colors.primary,
  },
  bulkBtnDanger: {
    backgroundColor: Colors.error + '15',
  },
  bulkBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
});

```


---

### `components/schedule/LookaheadView.tsx`

```tsx
import React, { useMemo, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Plus,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  getPhaseColor,
  getTaskDateRange,
  getPredecessors,
} from '@/utils/scheduleEngine';
import { getSimulatedForecast, getConditionIcon } from '@/utils/weatherService';
import type { DayForecast } from '@/utils/weatherService';

interface LookaheadViewProps {
  tasks: ScheduleTask[];
  schedule: ProjectSchedule;
  projectStartDate: Date;
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onTaskPress: (task: ScheduleTask) => void;
}

interface WeekGroup {
  weekStart: Date;
  weekEnd: Date;
  label: string;
  tasks: ScheduleTask[];
  forecast: DayForecast[];
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const SwipeableLookaheadCard = React.memo(function SwipeableLookaheadCard({
  task,
  allTasks,
  schedule,
  projectStartDate,
  onProgressUpdate,
  onTaskPress,
}: {
  task: ScheduleTask;
  allTasks: ScheduleTask[];
  schedule: ProjectSchedule;
  projectStartDate: Date;
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onTaskPress: (task: ScheduleTask) => void;
}) {
  const phaseColor = getPhaseColor(task.phase);
  const preds = getPredecessors(task, allTasks);
  const isBlocked = preds.some(p => p.status !== 'done');
  const dateRange = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
  const totalDays = task.durationDays;
  const daysPassed = Math.max(
    0,
    Math.ceil((new Date().getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24))
  );
  const dayOfN = Math.min(Math.max(1, daysPassed), totalDays);

  const translateX = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const startProg = useRef(task.progress);

  const flashGreen = useCallback(() => {
    Animated.sequence([
      Animated.timing(flashOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [flashOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderGrant: () => {
        startProg.current = task.progress;
      },
      onPanResponderMove: (_e, gs) => {
        if (gs.dx > 0) {
          translateX.setValue(Math.min(gs.dx * 0.5, 60));
        }
      },
      onPanResponderRelease: (_e, gs) => {
        if (gs.dx > 50) {
          const next = Math.min(100, Math.ceil((startProg.current + 25) / 25) * 25);
          if (next !== startProg.current) {
            onProgressUpdate(task, next);
            flashGreen();
            if (next >= 100 && Platform.OS !== 'web') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else if (Platform.OS !== 'web') {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
          }
        }
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
      },
    })
  ).current;

  const handleIncrement = useCallback(() => {
    const next = Math.min(100, task.progress + 25);
    onProgressUpdate(task, next);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [task, onProgressUpdate]);

  return (
    <View style={s.swipeWrapper}>
      <View style={s.swipeBg}>
        <ChevronRight size={14} color="#FFF" />
        <Text style={s.swipeBgText}>+25%</Text>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[s.taskCard, isBlocked && s.taskCardBlocked]}
          onPress={() => onTaskPress(task)}
          activeOpacity={0.7}
        >
          <View style={[s.taskPhaseBar, { backgroundColor: phaseColor }]} />
          <View style={s.taskCardBody}>
            <View style={s.taskCardTop}>
              <Text style={s.taskCardTitle} numberOfLines={1}>{task.title}</Text>
              {isBlocked && (
                <View style={s.blockedTag}>
                  <AlertTriangle size={9} color="#FF3B30" />
                  <Text style={s.blockedTagText}>BLOCKED</Text>
                </View>
              )}
            </View>
            <View style={s.taskCardMeta}>
              {task.crew ? (
                <Text style={s.taskCardCrewText}>{task.crew}{task.crewSize ? ` (${task.crewSize})` : ''}</Text>
              ) : null}
              <Text style={s.taskCardDayText}>Day {dayOfN}/{totalDays}</Text>
            </View>
            <View style={s.taskCardProgressRow}>
              <View style={s.taskCardProgressTrack}>
                <View style={[s.taskCardProgressFill, { width: `${task.progress}%` as any, backgroundColor: phaseColor }]} />
              </View>
              <Text style={s.taskCardProgressText}>{task.progress}%</Text>
              <TouchableOpacity style={s.incrementBtn} onPress={handleIncrement}>
                <Plus size={12} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>

        <Animated.View
          style={[s.flashOverlay, { opacity: flashOpacity }]}
          pointerEvents="none"
        />
      </Animated.View>
    </View>
  );
});

function LookaheadView({
  tasks,
  schedule,
  projectStartDate,
  onProgressUpdate,
  onTaskPress,
}: LookaheadViewProps) {
  const [weekCount, setWeekCount] = useState<3 | 6>(3);
  const now = useMemo(() => new Date(), []);

  const forecast = useMemo(
    () => getSimulatedForecast(now, weekCount * 7),
    [now, weekCount]
  );

  const weekGroups = useMemo<WeekGroup[]>(() => {
    const groups: WeekGroup[] = [];
    const monday = getMonday(now);

    for (let w = 0; w < weekCount; w++) {
      const weekStart = new Date(monday);
      weekStart.setDate(weekStart.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 4);

      const weekTasks = tasks.filter(t => {
        if (t.isMilestone && t.durationDays === 0) return false;
        const { start, end } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
        return start <= weekEnd && end >= weekStart;
      });

      const weekForecast = forecast.filter(f => {
        const d = new Date(f.date);
        return d >= weekStart && d <= weekEnd;
      });

      const monthDay = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endDay = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      groups.push({
        weekStart,
        weekEnd,
        label: `${monthDay} – ${endDay}`,
        tasks: weekTasks,
        forecast: weekForecast,
      });
    }
    return groups;
  }, [tasks, schedule, projectStartDate, now, weekCount, forecast]);

  const renderWeekHeader = useCallback((week: WeekGroup) => {
    const taskCount = week.tasks.length;
    const crewSet = new Set(week.tasks.map(t => t.crew).filter(Boolean));
    const blocked = week.tasks.filter(t => {
      const preds = getPredecessors(t, tasks);
      return preds.some(p => p.status !== 'done');
    }).length;

    return (
      <View style={s.weekHeader}>
        <View style={s.weekHeaderTop}>
          <Text style={s.weekLabel}>{week.label}</Text>
          <Text style={s.weekSummary}>
            {taskCount} tasks · {crewSet.size} crews{blocked > 0 ? ` · ${blocked} blocked` : ''}
          </Text>
        </View>
        {week.forecast.length > 0 && (
          <View style={s.weekWeatherRow}>
            {week.forecast.map(f => {
              const d = new Date(f.date);
              const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
              const hasWeatherSensitive = week.tasks.some(t => t.isWeatherSensitive);
              const isRisky = !f.isWorkable && hasWeatherSensitive;
              return (
                <View key={f.date} style={[s.weekWeatherDay, !f.isWorkable && s.weekWeatherDayBad]}>
                  <Text style={s.weekWeatherDayName}>{dayName}</Text>
                  <Text style={s.weekWeatherIcon}>{getConditionIcon(f.condition)}</Text>
                  {isRisky && <Text style={s.weatherRisk}>⚠️</Text>}
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  }, [tasks]);

  const renderItem = useCallback(({ item }: { item: WeekGroup }) => (
    <View style={s.weekSection}>
      {renderWeekHeader(item)}
      {item.tasks.length === 0 ? (
        <View style={s.weekEmpty}>
          <Text style={s.weekEmptyText}>No tasks this week</Text>
        </View>
      ) : (
        item.tasks.map(task => (
          <SwipeableLookaheadCard
            key={task.id}
            task={task}
            allTasks={tasks}
            schedule={schedule}
            projectStartDate={projectStartDate}
            onProgressUpdate={onProgressUpdate}
            onTaskPress={onTaskPress}
          />
        ))
      )}
    </View>
  ), [tasks, schedule, projectStartDate, onProgressUpdate, onTaskPress, renderWeekHeader]);

  return (
    <View style={s.container}>
      <View style={s.segmentControl}>
        <TouchableOpacity
          style={[s.segmentBtn, weekCount === 3 && s.segmentBtnActive]}
          onPress={() => setWeekCount(3)}
        >
          <Text style={[s.segmentBtnText, weekCount === 3 && s.segmentBtnTextActive]}>3 Week</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.segmentBtn, weekCount === 6 && s.segmentBtnActive]}
          onPress={() => setWeekCount(6)}
        >
          <Text style={[s.segmentBtnText, weekCount === 6 && s.segmentBtnTextActive]}>6 Week</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={weekGroups}
        renderItem={renderItem}
        keyExtractor={(item) => item.label}
        scrollEnabled={false}
        contentContainerStyle={s.weekList}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 12 },

  segmentControl: {
    flexDirection: 'row',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 12,
    padding: 3,
    alignSelf: 'flex-start',
  },
  segmentBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  segmentBtnActive: { backgroundColor: Colors.primary },
  segmentBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  segmentBtnTextActive: { color: '#FFF' },

  weekList: { gap: 16 },

  weekSection: { gap: 8 },
  weekHeader: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 8,
  },
  weekHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekLabel: { fontSize: 15, fontWeight: '800' as const, color: Colors.text },
  weekSummary: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' as const },

  weekWeatherRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-around' },
  weekWeatherDay: { alignItems: 'center', gap: 1 },
  weekWeatherDayBad: { opacity: 0.5 },
  weekWeatherDayName: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted },
  weekWeatherIcon: { fontSize: 14 },
  weatherRisk: { fontSize: 10 },

  weekEmpty: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 12,
  },
  weekEmptyText: { fontSize: 13, color: Colors.textMuted },

  swipeWrapper: {
    position: 'relative' as const,
    borderRadius: 14,
    overflow: 'hidden' as const,
  },
  swipeBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C759',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    gap: 3,
  },
  swipeBgText: { fontSize: 12, fontWeight: '800' as const, color: '#FFF' },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C75920',
    borderRadius: 14,
  },

  taskCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  taskCardBlocked: { borderColor: '#FF3B3025' },
  taskPhaseBar: { width: 4 },
  taskCardBody: { flex: 1, padding: 12, gap: 6 },
  taskCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskCardTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, flex: 1, marginRight: 8 },
  blockedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FF3B3012',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  blockedTagText: { fontSize: 9, fontWeight: '800' as const, color: '#FF3B30' },
  taskCardMeta: { flexDirection: 'row', gap: 10 },
  taskCardCrewText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' as const },
  taskCardDayText: { fontSize: 11, color: Colors.textMuted },
  taskCardProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskCardProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.fillSecondary,
    overflow: 'hidden' as const,
  },
  taskCardProgressFill: { height: '100%', borderRadius: 3 },
  taskCardProgressText: { fontSize: 11, fontWeight: '700' as const, color: Colors.text, minWidth: 28, textAlign: 'right' as const },
  incrementBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default React.memo(LookaheadView);

```


---

### `components/schedule/TodayView.tsx`

```tsx
import React, { useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  Animated,
  PanResponder,
  Image,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  CheckCircle2,
  Plus,
  Camera,
  MessageSquare,
  Clock,
  AlertTriangle,
  ChevronRight,
  Trophy,
  Sun,
  ImageIcon,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  formatShortDate,
  getPhaseColor,
  getTaskDateRange,
  getPredecessors,
  getSuccessors,
} from '@/utils/scheduleEngine';
import { getSimulatedForecast, getConditionIcon } from '@/utils/weatherService';

interface TodayViewProps {
  tasks: ScheduleTask[];
  schedule: ProjectSchedule;
  projectStartDate: Date;
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onTaskPress: (task: ScheduleTask) => void;
  onPhotoPress?: (task: ScheduleTask) => void;
  onPhotoAdded?: (task: ScheduleTask, photo: { uri: string; timestamp: string; note?: string }) => void;
  healthScore: number;
  daysRemaining: number;
}

const SwipeableActiveCard = React.memo(function SwipeableActiveCard({
  task,
  schedule,
  projectStartDate,
  allTasks,
  onProgressUpdate,
  onTaskPress,
  onPhotoAdded,
}: {
  task: ScheduleTask;
  schedule: ProjectSchedule;
  projectStartDate: Date;
  allTasks: ScheduleTask[];
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onTaskPress: (task: ScheduleTask) => void;
  onPhotoAdded?: (task: ScheduleTask, photo: { uri: string; timestamp: string; note?: string }) => void;
}) {
  const phaseColor = getPhaseColor(task.phase);
  const dateRange = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
  const totalDays = task.durationDays;
  const daysPassed = Math.max(
    1,
    Math.ceil((new Date().getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24))
  );
  const dayOfN = Math.min(daysPassed, totalDays);

  const preds = getPredecessors(task, allTasks);
  const predsComplete = preds.every(p => p.status === 'done');
  const predsInProgress = preds.some(p => p.status === 'in_progress');

  const succs = getSuccessors(task.id, allTasks);
  const willUnblock = succs.filter(s => {
    const sPreds = getPredecessors(s, allTasks);
    const otherPreds = sPreds.filter(p => p.id !== task.id);
    return otherPreds.every(p => p.status === 'done');
  });

  const translateX = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const readyGlow = useRef(new Animated.Value(0)).current;
  const cardWidth = useRef(0);
  const startProg = useRef(task.progress);

  const flashGreen = useCallback(() => {
    Animated.sequence([
      Animated.timing(flashOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [flashOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dx) > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderGrant: () => {
        startProg.current = task.progress;
      },
      onPanResponderMove: (_e, gs) => {
        if (gs.dx > 0) {
          translateX.setValue(Math.min(gs.dx * 0.5, 60));
        }
      },
      onPanResponderRelease: (_e, gs) => {
        if (gs.dx > 50) {
          const increment = 25;
          const next = Math.min(100, Math.ceil((startProg.current + increment) / 25) * 25);
          if (next !== startProg.current) {
            onProgressUpdate(task, next);
            flashGreen();
            if (next >= 100 && Platform.OS !== 'web') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else if (Platform.OS !== 'web') {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
          }
        }
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
      },
    })
  ).current;

  const handleIncrement = useCallback(() => {
    const next = Math.min(100, task.progress + 10);
    onProgressUpdate(task, next);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (next >= 100 && willUnblock.length > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(readyGlow, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(readyGlow, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]),
        { iterations: 3 }
      ).start();
    }
  }, [task, onProgressUpdate, willUnblock, readyGlow]);

  const handleComplete = useCallback(() => {
    onProgressUpdate(task, 100);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [task, onProgressUpdate]);

  const handlePhotoCapture = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        const libResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          allowsEditing: true,
        });
        if (!libResult.canceled && libResult.assets[0]) {
          onPhotoAdded?.(task, {
            uri: libResult.assets[0].uri,
            timestamp: new Date().toISOString(),
          });
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        allowsEditing: true,
      });

      if (!result.canceled && result.assets[0]) {
        onPhotoAdded?.(task, {
          uri: result.assets[0].uri,
          timestamp: new Date().toISOString(),
        });
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.log('[TodayView] Photo capture error:', err);
      try {
        const libResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          allowsEditing: true,
        });
        if (!libResult.canceled && libResult.assets[0]) {
          onPhotoAdded?.(task, {
            uri: libResult.assets[0].uri,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (libErr) {
        console.log('[TodayView] Library pick error:', libErr);
      }
    }
  }, [task, onPhotoAdded]);

  const photoCount = task.photos?.length ?? 0;

  return (
    <View
      style={s.swipeWrapper}
      onLayout={(e) => { cardWidth.current = e.nativeEvent.layout.width; }}
    >
      <View style={s.swipeBg}>
        <ChevronRight size={16} color="#FFF" />
        <Text style={s.swipeBgText}>+25%</Text>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={s.activeCard}
          onPress={() => onTaskPress(task)}
          activeOpacity={0.85}
        >
          <View style={[s.activeCardPhaseBar, { backgroundColor: phaseColor }]} />
          <View style={s.activeCardContent}>
            <View style={s.activeCardHeader}>
              <Text style={s.activeCardTitle} numberOfLines={1}>{task.title}</Text>
              <View style={s.dayIndicator}>
                <Text style={s.dayIndicatorText}>Day {dayOfN} of {totalDays}</Text>
              </View>
            </View>

            {task.crew ? (
              <Text style={s.activeCardCrew}>{task.crew}{task.crewSize ? ` (${task.crewSize})` : ''}</Text>
            ) : null}

            {preds.length > 0 && (
              <View style={s.predRow}>
                {predsComplete ? (
                  <View style={s.predBadgeGreen}>
                    <CheckCircle2 size={10} color="#34C759" />
                    <Text style={s.predBadgeTextGreen}>Predecessors done</Text>
                  </View>
                ) : predsInProgress ? (
                  <View style={s.predBadgeYellow}>
                    <Clock size={10} color="#FF9500" />
                    <Text style={s.predBadgeTextYellow}>Predecessors in progress</Text>
                  </View>
                ) : (
                  <View style={s.predBadgeRed}>
                    <AlertTriangle size={10} color="#FF3B30" />
                    <Text style={s.predBadgeTextRed}>Blocked</Text>
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity
              style={s.progressBarContainer}
              onPress={handleIncrement}
              activeOpacity={0.8}
            >
              <View style={s.progressTrack}>
                <View
                  style={[s.progressFill, { width: `${task.progress}%` as any, backgroundColor: phaseColor }]}
                />
              </View>
              <Text style={[s.progressPercent, { color: phaseColor }]}>{task.progress}%</Text>
            </TouchableOpacity>

            <View style={s.quickActions}>
              <TouchableOpacity style={s.quickActionBtn} onPress={handleIncrement}>
                <Plus size={14} color={Colors.primary} />
                <Text style={s.quickActionLabel}>+10%</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.quickActionBtn, s.quickActionBtnComplete]}
                onPress={handleComplete}
              >
                <CheckCircle2 size={14} color="#34C759" />
                <Text style={[s.quickActionLabel, { color: '#34C759' }]}>Done</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.quickActionBtn} onPress={handlePhotoCapture}>
                <Camera size={14} color={Colors.info} />
                {photoCount > 0 && (
                  <Text style={[s.quickActionLabel, { color: Colors.info }]}>{photoCount}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={s.quickActionBtn} onPress={() => onTaskPress(task)}>
                <MessageSquare size={14} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {photoCount > 0 && (
              <View style={s.photoStrip}>
                {task.photos!.slice(-3).map((photo, idx) => (
                  <View key={idx} style={s.photoThumb}>
                    <Image source={{ uri: photo.uri }} style={s.photoThumbImg} />
                  </View>
                ))}
                {photoCount > 3 && (
                  <View style={s.photoMore}>
                    <ImageIcon size={10} color={Colors.textMuted} />
                    <Text style={s.photoMoreText}>+{photoCount - 3}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>

        <Animated.View
          style={[s.flashOverlay, { opacity: flashOpacity }]}
          pointerEvents="none"
        />
      </Animated.View>
    </View>
  );
});

function TodayView({
  tasks,
  schedule,
  projectStartDate,
  onProgressUpdate,
  onTaskPress,
  onPhotoAdded,
  healthScore,
  daysRemaining,
}: TodayViewProps) {
  const now = useMemo(() => new Date(), []);

  const forecast = useMemo(() => getSimulatedForecast(now, 4), [now]);
  const todayWeather = forecast[0];

  const activeTasks = useMemo(() => {
    return tasks.filter(t => {
      if (t.status === 'done') return false;
      if (t.isMilestone) return false;
      const { start, end } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
      return start <= now && end >= now;
    });
  }, [tasks, projectStartDate, schedule, now]);

  const comingUpTasks = useMemo(() => {
    const threeDaysOut = new Date(now);
    threeDaysOut.setDate(threeDaysOut.getDate() + 3);
    return tasks.filter(t => {
      if (t.status === 'done') return false;
      if (t.isMilestone) return false;
      const { start } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
      return start > now && start <= threeDaysOut;
    }).slice(0, 8);
  }, [tasks, projectStartDate, schedule, now]);

  const overdueTasks = useMemo(() => {
    return tasks.filter(t => {
      if (t.status === 'done') return false;
      if (t.isMilestone) return false;
      const { end } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
      return end < now && t.progress < 100;
    });
  }, [tasks, projectStartDate, schedule, now]);

  const completedToday = useMemo(() => {
    return tasks.filter(t => t.status === 'done').slice(0, 5);
  }, [tasks]);

  const blockedComingUp = useMemo(() => {
    return comingUpTasks.filter(t => {
      const preds = getPredecessors(t, tasks);
      return preds.some(p => p.status !== 'done');
    });
  }, [comingUpTasks, tasks]);

  const dateFormatted = useMemo(() => {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    };
    return now.toLocaleDateString('en-US', options);
  }, [now]);

  const renderActiveItem = useCallback(
    ({ item }: { item: ScheduleTask }) => (
      <SwipeableActiveCard
        task={item}
        schedule={schedule}
        projectStartDate={projectStartDate}
        allTasks={tasks}
        onProgressUpdate={onProgressUpdate}
        onTaskPress={onTaskPress}
        onPhotoAdded={onPhotoAdded}
      />
    ),
    [schedule, projectStartDate, tasks, onProgressUpdate, onTaskPress, onPhotoAdded]
  );

  return (
    <View style={s.container}>
      <View style={s.todayHeader}>
        <View style={s.todayHeaderLeft}>
          <Text style={s.todayDate}>{dateFormatted}</Text>
          <View style={s.todayBadges}>
            <View style={s.healthMini}>
              <View style={[s.healthMiniDot, { backgroundColor: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : '#FF3B30' }]} />
              <Text style={s.healthMiniText}>{healthScore}</Text>
            </View>
            <View style={s.daysLeftMini}>
              <Clock size={10} color={Colors.textSecondary} />
              <Text style={s.daysLeftMiniText}>{daysRemaining}d left</Text>
            </View>
          </View>
        </View>
        {todayWeather && (
          <View style={s.weatherCard}>
            <Text style={s.weatherIcon}>{getConditionIcon(todayWeather.condition)}</Text>
            <Text style={s.weatherTemp}>{todayWeather.tempHigh}°F</Text>
            <Text style={s.weatherPrecip}>{todayWeather.precipChance}%💧</Text>
          </View>
        )}
      </View>

      {forecast.length > 1 && (
        <View style={s.forecastRow}>
          {forecast.slice(1).map((f) => {
            const d = new Date(f.date);
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            return (
              <View key={f.date} style={[s.forecastDay, !f.isWorkable && s.forecastDayBad]}>
                <Text style={s.forecastDayName}>{dayName}</Text>
                <Text style={s.forecastDayIcon}>{getConditionIcon(f.condition)}</Text>
                <Text style={s.forecastDayTemp}>{f.tempHigh}°</Text>
              </View>
            );
          })}
        </View>
      )}

      {overdueTasks.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeaderOverdue}>
            <AlertTriangle size={14} color="#FF3B30" />
            <Text style={s.sectionTitleOverdue}>Overdue ({overdueTasks.length})</Text>
          </View>
          {overdueTasks.map(task => {
            const { end } = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
            const daysOver = Math.ceil((now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
            return (
              <TouchableOpacity
                key={task.id}
                style={s.overdueCard}
                onPress={() => onTaskPress(task)}
                activeOpacity={0.7}
              >
                <View style={s.overdueLeft}>
                  <Text style={s.overdueTitle} numberOfLines={1}>{task.title}</Text>
                  <Text style={s.overdueMeta}>{daysOver}d overdue · {task.progress}% done</Text>
                </View>
                <View style={s.overdueActions}>
                  <TouchableOpacity
                    style={s.overdueResolveBtn}
                    onPress={() => onProgressUpdate(task, 100)}
                  >
                    <Text style={s.overdueResolveBtnText}>Mark Done</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Sun size={14} color={Colors.accent} />
          <Text style={s.sectionTitle}>Active Now ({activeTasks.length})</Text>
        </View>
        {activeTasks.length > 0 && (
          <View style={s.swipeHint}>
            <ChevronRight size={10} color={Colors.textMuted} />
            <Text style={s.swipeHintText}>Swipe right on a task to update progress</Text>
          </View>
        )}
        {activeTasks.length === 0 ? (
          <View style={s.emptyActive}>
            <CheckCircle2 size={28} color={Colors.success} />
            <Text style={s.emptyActiveText}>No tasks active today</Text>
          </View>
        ) : (
          <FlatList
            data={activeTasks}
            renderItem={renderActiveItem}
            keyExtractor={item => item.id}
            scrollEnabled={false}
            contentContainerStyle={s.activeList}
          />
        )}
      </View>

      {comingUpTasks.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <ChevronRight size={14} color={Colors.info} />
            <Text style={s.sectionTitle}>Coming Up (Next 3 Days)</Text>
          </View>
          {comingUpTasks.map(task => {
            const { start } = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
            const isBlocked = blockedComingUp.includes(task);
            return (
              <TouchableOpacity
                key={task.id}
                style={[s.compactCard, isBlocked && s.compactCardBlocked]}
                onPress={() => onTaskPress(task)}
                activeOpacity={0.7}
              >
                <View style={[s.compactDot, { backgroundColor: getPhaseColor(task.phase) }]} />
                <View style={s.compactInfo}>
                  <Text style={s.compactTitle} numberOfLines={1}>{task.title}</Text>
                  <Text style={s.compactMeta}>
                    {formatShortDate(start)} · {task.durationDays}d{task.crew ? ` · ${task.crew}` : ''}
                  </Text>
                </View>
                {isBlocked && (
                  <View style={s.blockedBadge}>
                    <AlertTriangle size={10} color="#FF3B30" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {completedToday.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeaderGreen}>
            <Trophy size={14} color="#34C759" />
            <Text style={s.sectionTitleGreen}>Completed ({completedToday.length})</Text>
          </View>
          {completedToday.map(task => (
            <View key={task.id} style={s.completedCard}>
              <CheckCircle2 size={14} color="#34C759" />
              <Text style={s.completedTitle} numberOfLines={1}>{task.title}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 16 },

  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  todayHeaderLeft: { flex: 1, gap: 6 },
  todayDate: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  todayBadges: { flexDirection: 'row', gap: 8 },
  healthMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  healthMiniDot: { width: 6, height: 6, borderRadius: 3 },
  healthMiniText: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  daysLeftMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  daysLeftMiniText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },

  weatherCard: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    minWidth: 70,
    gap: 2,
  },
  weatherIcon: { fontSize: 22 },
  weatherTemp: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  weatherPrecip: { fontSize: 10, color: Colors.textSecondary },

  forecastRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-around',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  forecastDay: { alignItems: 'center', gap: 2, flex: 1 },
  forecastDayBad: { opacity: 0.6 },
  forecastDayName: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  forecastDayIcon: { fontSize: 16 },
  forecastDayTemp: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },

  section: { gap: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  sectionHeaderOverdue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitleOverdue: { fontSize: 15, fontWeight: '700' as const, color: '#FF3B30' },
  sectionHeaderGreen: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitleGreen: { fontSize: 15, fontWeight: '700' as const, color: '#34C759' },

  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 4,
  },
  swipeHintText: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' as const },

  emptyActive: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  emptyActiveText: { fontSize: 14, color: Colors.textSecondary },

  activeList: { gap: 10 },

  swipeWrapper: {
    position: 'relative' as const,
    borderRadius: 16,
    overflow: 'hidden' as const,
  },
  swipeBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C759',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    gap: 4,
  },
  swipeBgText: { fontSize: 13, fontWeight: '800' as const, color: '#FFF' },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C75920',
    borderRadius: 16,
  },

  activeCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  activeCardPhaseBar: { width: 5 },
  activeCardContent: { flex: 1, padding: 14, gap: 8 },
  activeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activeCardTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, flex: 1, marginRight: 8 },
  dayIndicator: {
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  dayIndicatorText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  activeCardCrew: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },

  predRow: { flexDirection: 'row' },
  predBadgeGreen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#34C75912',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  predBadgeTextGreen: { fontSize: 10, fontWeight: '600' as const, color: '#34C759' },
  predBadgeYellow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FF950012',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  predBadgeTextYellow: { fontSize: 10, fontWeight: '600' as const, color: '#FF9500' },
  predBadgeRed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FF3B3012',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  predBadgeTextRed: { fontSize: 10, fontWeight: '600' as const, color: '#FF3B30' },

  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.fillSecondary,
    overflow: 'hidden' as const,
  },
  progressFill: { height: '100%', borderRadius: 5 },
  progressPercent: { fontSize: 14, fontWeight: '800' as const, minWidth: 36, textAlign: 'right' as const },

  quickActions: { flexDirection: 'row', gap: 8 },
  quickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  quickActionBtnComplete: { backgroundColor: '#34C75912' },
  quickActionLabel: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },

  photoStrip: { flexDirection: 'row', gap: 6, marginTop: 2 },
  photoThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden' as const,
    backgroundColor: Colors.fillTertiary,
  },
  photoThumbImg: { width: 40, height: 40, borderRadius: 8 },
  photoMore: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  photoMoreText: { fontSize: 9, fontWeight: '700' as const, color: Colors.textMuted },

  overdueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF3B3008',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FF3B3020',
    gap: 10,
  },
  overdueLeft: { flex: 1, gap: 2 },
  overdueTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  overdueMeta: { fontSize: 12, color: '#FF3B30', fontWeight: '500' as const },
  overdueActions: { flexDirection: 'row', gap: 6 },
  overdueResolveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#34C75918',
  },
  overdueResolveBtnText: { fontSize: 12, fontWeight: '700' as const, color: '#34C759' },

  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  compactCardBlocked: { borderColor: '#FF3B3030' },
  compactDot: { width: 8, height: 8, borderRadius: 4 },
  compactInfo: { flex: 1, gap: 2 },
  compactTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  compactMeta: { fontSize: 12, color: Colors.textSecondary },
  blockedBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF3B3012',
    alignItems: 'center',
    justifyContent: 'center',
  },

  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#34C75908',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#34C75918',
  },
  completedTitle: { flex: 1, fontSize: 14, fontWeight: '500' as const, color: Colors.text },
});

export default React.memo(TodayView);

```


---

### `components/schedule/SwipeableTaskCard.tsx`

```tsx
import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor, getStatusColor } from '@/utils/scheduleEngine';

interface SwipeableTaskCardProps {
  task: ScheduleTask;
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onPress: (task: ScheduleTask) => void;
  children: React.ReactNode;
}

function SwipeableTaskCard({
  task,
  onProgressUpdate,
  onPress,
  children,
}: SwipeableTaskCardProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(task.progress)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const cardWidth = useRef(0);
  const startProgress = useRef(task.progress);
  const currentSnap = useRef(task.progress);

  const triggerHaptic = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const flashGreen = useCallback(() => {
    Animated.sequence([
      Animated.timing(flashOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(flashOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [flashOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return Math.abs(gestureState.dx) > 15 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5;
      },
      onPanResponderGrant: () => {
        startProgress.current = task.progress;
        currentSnap.current = task.progress;
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dx > 0 && cardWidth.current > 0) {
          const swipeRatio = gestureState.dx / cardWidth.current;
          const progressIncrease = swipeRatio * 100;
          const newProgress = Math.min(100, Math.max(0, startProgress.current + progressIncrease));
          const snapped = Math.round(newProgress / 25) * 25;

          if (snapped !== currentSnap.current) {
            currentSnap.current = snapped;
            triggerHaptic();
          }

          progressAnim.setValue(newProgress);
          translateX.setValue(Math.min(gestureState.dx, 80));
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dx > 30 && cardWidth.current > 0) {
          const swipeRatio = gestureState.dx / cardWidth.current;
          const progressIncrease = swipeRatio * 100;
          const newProgress = Math.min(100, Math.max(0, startProgress.current + progressIncrease));
          const snapped = Math.round(newProgress / 25) * 25;
          const finalProgress = Math.max(snapped, startProgress.current);

          if (finalProgress !== startProgress.current) {
            onProgressUpdate(task, finalProgress);
            flashGreen();

            if (finalProgress >= 100) {
              if (Platform.OS !== 'web') {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            }
          }
        }

        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }).start();

        progressAnim.setValue(task.progress);
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }).start();
        progressAnim.setValue(task.progress);
      },
    })
  ).current;

  const phaseColor = getPhaseColor(task.phase);
  const swipeProgressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={s.wrapper}
      onLayout={(e) => { cardWidth.current = e.nativeEvent.layout.width; }}
    >
      <View style={s.swipeBackground}>
        <View style={s.swipeBgContent}>
          <ChevronRight size={16} color="#FFF" />
          <Text style={s.swipeBgText}>+25%</Text>
        </View>
        <Animated.View
          style={[
            s.swipeProgressOverlay,
            { width: swipeProgressWidth as any, backgroundColor: phaseColor + '40' },
          ]}
        />
      </View>

      <Animated.View
        style={[
          s.cardContainer,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={s.cardTouchable}
          onPress={() => onPress(task)}
          activeOpacity={0.85}
        >
          {children}
        </TouchableOpacity>

        <Animated.View
          style={[
            s.flashOverlay,
            { opacity: flashOpacity, backgroundColor: '#34C75920' },
          ]}
          pointerEvents="none"
        />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    position: 'relative' as const,
    overflow: 'hidden' as const,
    borderRadius: 16,
  },
  swipeBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C759',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    overflow: 'hidden' as const,
  },
  swipeBgContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 2,
  },
  swipeBgText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#FFF',
  },
  swipeProgressOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 1,
  },
  cardContainer: {
    borderRadius: 16,
    overflow: 'hidden' as const,
  },
  cardTouchable: {
    borderRadius: 16,
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },
});

export default React.memo(SwipeableTaskCard);

```


---

### `components/schedule/QuickBuildModal.tsx`

```tsx
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  ChevronRight,
  X,
  Zap,
  Home,
  Building2,
  Wrench,
  Trees,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate } from '@/constants/scheduleTemplates';

interface QuickBuildModalProps {
  visible: boolean;
  onClose: () => void;
  onTemplateSelect: (template: ScheduleTemplate, startDate: Date) => void;
}

type ProjectSize = 'small' | 'medium' | 'large';

const SIZE_LABELS: Record<ProjectSize, { label: string; factor: number; desc: string }> = {
  small: { label: 'Small', factor: 0.7, desc: 'Compact scope' },
  medium: { label: 'Medium', factor: 1.0, desc: 'Standard scope' },
  large: { label: 'Large', factor: 1.5, desc: 'Extended scope' },
};

const TEMPLATE_ICONS: Record<string, typeof Home> = {
  'kitchen-remodel': Wrench,
  'bathroom-remodel': Wrench,
  'basement-finish': Home,
  'roof-replacement': Home,
  'new-home': Building2,
  'commercial-ti': Building2,
  'exterior-renovation': Home,
  'parking-lot': Trees,
};

function getNextMonday(): Date {
  const now = new Date();
  const dow = now.getDay();
  const daysUntilMonday = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  const nextMon = new Date(now);
  nextMon.setDate(nextMon.getDate() + daysUntilMonday);
  nextMon.setHours(0, 0, 0, 0);
  return nextMon;
}

function QuickBuildModal({ visible, onClose, onTemplateSelect }: QuickBuildModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTemplate, setSelectedTemplate] = useState<ScheduleTemplate | null>(null);
  const [selectedSize, setSelectedSize] = useState<ProjectSize>('medium');

  const startDate = useMemo(() => getNextMonday(), []);

  const handleSelectTemplate = useCallback((template: ScheduleTemplate) => {
    setSelectedTemplate(template);
    setStep(2);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleSelectSize = useCallback((size: ProjectSize) => {
    setSelectedSize(size);
    setStep(3);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const scaledTemplate = useMemo<ScheduleTemplate | null>(() => {
    if (!selectedTemplate) return null;
    const factor = SIZE_LABELS[selectedSize].factor;
    return {
      ...selectedTemplate,
      tasks: selectedTemplate.tasks.map(t => ({
        ...t,
        duration: t.isMilestone ? 0 : Math.max(1, Math.round(t.duration * factor)),
      })),
    };
  }, [selectedTemplate, selectedSize]);

  const totalDuration = useMemo(() => {
    if (!scaledTemplate) return 0;
    return scaledTemplate.tasks.reduce((sum, t) => sum + t.duration, 0);
  }, [scaledTemplate]);

  const handleCreate = useCallback(() => {
    if (!scaledTemplate) return;
    onTemplateSelect(scaledTemplate, startDate);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep(1);
    setSelectedTemplate(null);
    setSelectedSize('medium');
  }, [scaledTemplate, startDate, onTemplateSelect]);

  const handleClose = useCallback(() => {
    setStep(1);
    setSelectedTemplate(null);
    setSelectedSize('medium');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={handleClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Zap size={20} color={Colors.accent} />
              <Text style={s.headerTitle}>Quick Build</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <X size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={s.stepIndicator}>
            {[1, 2, 3].map(n => (
              <View key={n} style={[s.stepDot, step >= n && s.stepDotActive]} />
            ))}
          </View>

          {step === 1 && (
            <>
              <Text style={s.stepTitle}>What type of project?</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={s.scrollContent}>
                {SCHEDULE_TEMPLATES.map(template => {
                  const Icon = TEMPLATE_ICONS[template.id] ?? Wrench;
                  return (
                    <TouchableOpacity
                      key={template.id}
                      style={s.templateCard}
                      onPress={() => handleSelectTemplate(template)}
                      activeOpacity={0.7}
                    >
                      <View style={s.templateIconWrap}>
                        <Icon size={18} color={Colors.primary} />
                      </View>
                      <View style={s.templateInfo}>
                        <Text style={s.templateName}>{template.name}</Text>
                        <Text style={s.templateMeta}>{template.taskCount} tasks · {template.typicalDuration}</Text>
                      </View>
                      <ChevronRight size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.stepTitle}>How big is the project?</Text>
              <Text style={s.stepSubtitle}>{selectedTemplate?.name}</Text>
              <View style={s.sizeOptions}>
                {(Object.keys(SIZE_LABELS) as ProjectSize[]).map(size => {
                  const info = SIZE_LABELS[size];
                  const isActive = selectedSize === size;
                  return (
                    <TouchableOpacity
                      key={size}
                      style={[s.sizeCard, isActive && s.sizeCardActive]}
                      onPress={() => handleSelectSize(size)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.sizeLabel, isActive && s.sizeLabelActive]}>{info.label}</Text>
                      <Text style={[s.sizeDesc, isActive && s.sizeDescActive]}>{info.desc}</Text>
                      <Text style={[s.sizeFactor, isActive && s.sizeFactorActive]}>{info.factor}x</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {step === 3 && scaledTemplate && (
            <>
              <Text style={s.stepTitle}>Review & Go</Text>
              <View style={s.reviewCard}>
                <Text style={s.reviewLabel}>Template</Text>
                <Text style={s.reviewValue}>{scaledTemplate.name}</Text>
              </View>
              <View style={s.reviewRow}>
                <View style={s.reviewCard}>
                  <Text style={s.reviewLabel}>Tasks</Text>
                  <Text style={s.reviewValue}>{scaledTemplate.tasks.length}</Text>
                </View>
                <View style={s.reviewCard}>
                  <Text style={s.reviewLabel}>Est. Duration</Text>
                  <Text style={s.reviewValue}>{totalDuration}d</Text>
                </View>
                <View style={s.reviewCard}>
                  <Text style={s.reviewLabel}>Size</Text>
                  <Text style={s.reviewValue}>{SIZE_LABELS[selectedSize].label}</Text>
                </View>
              </View>
              <View style={s.reviewCard}>
                <Text style={s.reviewLabel}>Start Date</Text>
                <Text style={s.reviewValue}>
                  {startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </Text>
              </View>

              <ScrollView style={s.taskPreview} showsVerticalScrollIndicator={false}>
                {scaledTemplate.tasks.filter(t => !t.isMilestone).map(t => (
                  <View key={t.id} style={s.previewRow}>
                    <Text style={s.previewName} numberOfLines={1}>{t.name}</Text>
                    <Text style={s.previewDur}>{t.duration}d</Text>
                  </View>
                ))}
              </ScrollView>

              <TouchableOpacity style={s.createBtn} onPress={handleCreate} activeOpacity={0.85}>
                <Zap size={16} color="#FFF" />
                <Text style={s.createBtnText}>Create Schedule</Text>
              </TouchableOpacity>
            </>
          )}

          {step > 1 && (
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(prev => (prev - 1) as 1 | 2 | 3)}>
              <Text style={s.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
    gap: 10,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.fillTertiary, alignSelf: 'center', marginBottom: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },

  stepIndicator: { flexDirection: 'row', gap: 6, alignSelf: 'center' },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.fillTertiary },
  stepDotActive: { backgroundColor: Colors.primary },

  stepTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  stepSubtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: -4 },

  scrollContent: { maxHeight: 380 },

  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  templateIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateInfo: { flex: 1, gap: 2 },
  templateName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  templateMeta: { fontSize: 12, color: Colors.textSecondary },

  sizeOptions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  sizeCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 16,
    padding: 18,
    gap: 6,
    borderWidth: 2,
    borderColor: Colors.borderLight,
  },
  sizeCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  sizeLabel: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  sizeLabelActive: { color: Colors.primary },
  sizeDesc: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center' as const },
  sizeDescActive: { color: Colors.primary },
  sizeFactor: { fontSize: 13, fontWeight: '700' as const, color: Colors.textMuted },
  sizeFactorActive: { color: Colors.primary },

  reviewCard: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    gap: 2,
    flex: 1,
  },
  reviewRow: { flexDirection: 'row', gap: 8 },
  reviewLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  reviewValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },

  taskPreview: { maxHeight: 200, marginTop: 4 },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  previewName: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '500' as const },
  previewDur: { fontSize: 12, fontWeight: '700' as const, color: Colors.textMuted },

  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    marginTop: 6,
  },
  createBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#FFF' },

  backBtn: { alignSelf: 'center', paddingVertical: 8 },
  backBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
});

export default React.memo(QuickBuildModal);

```


---

### `components/schedule/ScenariosModal.tsx`

```tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  GitBranch,
  Plus,
  Trash2,
  Check,
  Lock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ProjectSchedule, ScheduleScenario, ScheduleTask } from '@/types';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';

/**
 * What-If Scenarios manager.
 *
 * Lets the user snapshot the current schedule into a named scenario, then
 * switch between the baseline plan and any scenario on-the-fly. Stored on
 * `ProjectSchedule.scenarios` — the baseline `tasks` array is never mutated
 * by scenario switches; the consumer chooses which tasks to render based
 * on `activeScenarioId`.
 *
 * Gated behind `schedule_scenarios` (Pro+). Free users see a paywall CTA.
 */
interface ScenariosModalProps {
  visible: boolean;
  onClose: () => void;
  schedule: ProjectSchedule;
  onScheduleChange: (patch: Partial<ProjectSchedule>) => void;
}

export default function ScenariosModal({
  visible,
  onClose,
  schedule,
  onScheduleChange,
}: ScenariosModalProps) {
  const insets = useSafeAreaInsets();
  const { canAccess } = useTierAccess();
  const hasAccess = canAccess('schedule_scenarios');

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNote, setNewNote] = useState('');

  const scenarios: ScheduleScenario[] = useMemo(
    () => schedule.scenarios ?? [],
    [schedule.scenarios],
  );
  const activeId = schedule.activeScenarioId ?? null;

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('Missing Name', 'Scenarios need a name so you can tell them apart.');
      return;
    }
    const scenario: ScheduleScenario = {
      id: `scn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      note: newNote.trim() || undefined,
      createdAt: new Date().toISOString(),
      tasks: schedule.tasks.map((t) => ({ ...t })) as ScheduleTask[],
    };
    onScheduleChange({
      scenarios: [...scenarios, scenario],
      activeScenarioId: scenario.id,
    });
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setNewName('');
    setNewNote('');
    setShowCreate(false);
  }, [newName, newNote, schedule.tasks, scenarios, onScheduleChange]);

  const handleSwitch = useCallback(
    (scenarioId: string | null) => {
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onScheduleChange({ activeScenarioId: scenarioId });
    },
    [onScheduleChange],
  );

  const handleDelete = useCallback(
    (scenarioId: string) => {
      Alert.alert(
        'Delete Scenario?',
        'The baseline plan is unaffected. This only removes the saved scenario.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              const next = scenarios.filter((s) => s.id !== scenarioId);
              onScheduleChange({
                scenarios: next,
                activeScenarioId:
                  activeId === scenarioId ? null : activeId,
              });
            },
          },
        ],
      );
    },
    [scenarios, activeId, onScheduleChange],
  );

  if (!hasAccess) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={onClose}
      >
        <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={onClose}>
              <ChevronLeft size={22} color={Colors.text} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>What-If Scenarios</Text>
            <View style={{ width: 56 }} />
          </View>
          <View style={styles.paywallWrap}>
            <View style={styles.lockBadge}>
              <Lock size={18} color={Colors.primary} />
            </View>
            <Paywall visible={true} requiredTier="pro" feature="schedule_scenarios" onClose={onClose} />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose} testID="scenarios-back">
            <ChevronLeft size={22} color={Colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>What-If Scenarios</Text>
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => setShowCreate(true)}
            activeOpacity={0.85}
            testID="scenarios-new-btn"
          >
            <Plus size={16} color={Colors.textOnPrimary} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.helpCard}>
            <GitBranch size={16} color={Colors.primary} />
            <Text style={styles.helpText}>
              Snapshot the schedule into a named alternate, like {'"'}Overtime push{'"'} or
              {' "'}Rain delay,{'"'} then toggle between the baseline plan and any
              scenario. The baseline is never overwritten.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.row, activeId === null && styles.rowActive]}
            onPress={() => handleSwitch(null)}
            activeOpacity={0.8}
            testID="scenarios-baseline-row"
          >
            <View style={styles.rowHeader}>
              <Text style={[styles.rowName, activeId === null && styles.rowNameActive]}>
                Baseline Plan
              </Text>
              {activeId === null && <Check size={16} color={Colors.primary} />}
            </View>
            <Text style={styles.rowMeta}>
              {schedule.tasks.length} tasks · {schedule.totalDurationDays} days
            </Text>
          </TouchableOpacity>

          {scenarios.map((s) => {
            const isActive = s.id === activeId;
            return (
              <View
                key={s.id}
                style={[styles.row, isActive && styles.rowActive]}
                testID={`scenarios-row-${s.id}`}
              >
                <TouchableOpacity
                  style={styles.rowMain}
                  onPress={() => handleSwitch(s.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.rowHeader}>
                    <Text
                      style={[styles.rowName, isActive && styles.rowNameActive]}
                      numberOfLines={1}
                    >
                      {s.name}
                    </Text>
                    {isActive && <Check size={16} color={Colors.primary} />}
                  </View>
                  {!!s.note && (
                    <Text style={styles.rowNote} numberOfLines={2}>
                      {s.note}
                    </Text>
                  )}
                  <Text style={styles.rowMeta}>
                    {s.tasks.length} tasks · created{' '}
                    {new Date(s.createdAt).toLocaleDateString()}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(s.id)}
                  activeOpacity={0.7}
                  testID={`scenarios-delete-${s.id}`}
                >
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              </View>
            );
          })}

          {scenarios.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No scenarios yet. Tap + to snapshot the current plan as
                {' "'}Scenario A{'"'} and start branching.
              </Text>
            </View>
          )}
        </ScrollView>

        <Modal
          visible={showCreate}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCreate(false)}
        >
          <View style={styles.createOverlay}>
            <View style={styles.createCard}>
              <Text style={styles.createTitle}>New Scenario</Text>
              <Text style={styles.createHint}>
                This snapshots the current schedule. Changes you make while a
                scenario is active only affect that scenario.
              </Text>

              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Overtime push"
                placeholderTextColor={Colors.textMuted}
                autoFocus
                testID="scenarios-new-name"
              />

              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={newNote}
                onChangeText={setNewNote}
                placeholder="Why this scenario exists..."
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
                testID="scenarios-new-note"
              />

              <View style={styles.createActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setShowCreate(false);
                    setNewName('');
                    setNewNote('');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleCreate}
                  activeOpacity={0.85}
                  testID="scenarios-save-btn"
                >
                  <Text style={styles.saveBtnText}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8, paddingRight: 12 },
  backText: { fontSize: 15, color: Colors.primary, fontWeight: '500' as const },
  title: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  newBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, gap: 10 },
  helpCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    marginBottom: 6,
  },
  helpText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  rowMain: { flex: 1, gap: 4 },
  rowActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  rowNameActive: { color: Colors.primary, fontWeight: '700' as const },
  rowNote: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  rowMeta: { fontSize: 11, color: Colors.textMuted },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.error + '10',
  },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  paywallWrap: { flex: 1 },
  lockBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 20,
  },
  createOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  createCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    gap: 6,
  },
  createTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  createHint: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 8,
    lineHeight: 17,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.text,
  },
  inputMulti: { minHeight: 70, paddingTop: 10, textAlignVertical: 'top' as const },
  createActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  saveBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
});

```


---

### `components/schedule/AIAssistantPanel.tsx`

```tsx
// AIAssistantPanel — the game-changer drawer for Schedule Pro.
//
// Lives on the right edge of the screen. One-click actions surface the
// highest-leverage AI capabilities, with a chat input at the bottom for
// anything else.
//
// Core principle: AI suggests, user applies. Every proposed change has an
// explicit "Apply" button — we never silently mutate the plan.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  X,
  Sparkles,
  ShieldAlert,
  Zap,
  Target,
  MessageSquare,
  Mic,
  Wand2,
  ArrowRight,
  Check,
  AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';
import {
  aiDetectRisks,
  aiOptimizeSchedule,
  aiExplainCriticalPath,
  aiAskSchedule,
  aiLogAsBuilt,
  aiGenerateSchedule,
  aiBulkEdit,
  materializeGeneratedTasks,
  type AIRiskFinding,
  type AIOptimizationIdea,
  type AIAsBuiltPatch,
  type AIBulkPatch,
} from '@/utils/scheduleAI';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AIAssistantPanelProps {
  visible: boolean;
  onClose: () => void;
  tasks: ScheduleTask[];
  cpm: CpmResult;
  projectStartDate: Date;
  todayDayNumber: number;
  /** Apply a single task patch (mirror schedule-pro handleEdit). */
  onApplyPatch: (taskId: string, patch: Partial<ScheduleTask>) => void;
  /** Replace the whole schedule (for generator). */
  onReplaceAll: (tasks: ScheduleTask[]) => void;
  /** Highlight a set of task ids so the Gantt/grid can scroll to them. */
  onFocusTasks?: (ids: string[]) => void;
  /** Currently selected task ids from the grid — scopes bulk AI ops. */
  selectedIds?: Set<string>;
  /** Apply a batch of AI-proposed patches as one commit (undoable as a unit). */
  onApplyBulkPatches?: (patches: Array<{ taskId: string; patch: Partial<ScheduleTask> }>) => void;
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

type Mode = 'home' | 'risks' | 'optimize' | 'explain' | 'ask' | 'asbuilt' | 'generate' | 'bulk';

export default function AIAssistantPanel(props: AIAssistantPanelProps) {
  const {
    visible, onClose, tasks, cpm, projectStartDate, todayDayNumber,
    onApplyPatch, onApplyBulkPatches, onReplaceAll, onFocusTasks, selectedIds,
  } = props;
  const [mode, setMode] = useState<Mode>('home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [riskResult, setRiskResult] = useState<{ summary: string; findings: AIRiskFinding[] } | null>(null);
  const [optResult, setOptResult] = useState<{ summary: string; ideas: AIOptimizationIdea[] } | null>(null);
  const [explainText, setExplainText] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<Array<{ q: string; a: string }>>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [asBuiltDraft, setAsBuiltDraft] = useState('');
  const [asBuiltPatches, setAsBuiltPatches] = useState<AIAsBuiltPatch[]>([]);
  const [genDraft, setGenDraft] = useState('');
  const [genPreview, setGenPreview] = useState<ScheduleTask[] | null>(null);
  const [bulkDraft, setBulkDraft] = useState('');
  const [bulkResult, setBulkResult] = useState<{
    summary: string;
    patches: AIBulkPatch[];
    fromCache?: boolean;
    errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unknown';
  } | null>(null);

  // Per-session call counter — helps the user see when they're hitting the
  // cache vs. burning a fresh model call. Resets on panel close (see resetAll).
  const [callStats, setCallStats] = useState<{ total: number; cached: number }>({ total: 0, cached: 0 });

  // Jump straight into bulk mode when the panel opens with a selection active.
  // That's almost always what the user wants after clicking "✨ Ask AI" on the
  // bulk bar — zero extra clicks to start typing their instruction.
  React.useEffect(() => {
    if (visible && selectedIds && selectedIds.size > 0 && mode === 'home') {
      setMode('bulk');
    }
  }, [visible, selectedIds, mode]);

  const selectedCount = selectedIds?.size ?? 0;
  const selectedTaskTitles = useMemo(() => {
    if (!selectedIds || selectedIds.size === 0) return [];
    return tasks.filter(t => selectedIds.has(t.id)).map(t => t.title);
  }, [tasks, selectedIds]);

  const handleBulkEdit = useCallback(() => {
    if (!bulkDraft.trim() || !selectedIds || selectedIds.size === 0) return;
    const instruction = bulkDraft.trim();
    run(async () => {
      const res = await aiBulkEdit(tasks, cpm, Array.from(selectedIds), instruction);
      setCallStats(s => ({ total: s.total + 1, cached: s.cached + (res.fromCache ? 1 : 0) }));
      // Surface timeout / network / http failures as the panel error banner so
      // the user sees a distinct message rather than an empty result card.
      if (res.errorKind === 'timeout' || res.errorKind === 'network' || res.errorKind === 'http' || res.errorKind === 'model') {
        setError(res.errorDetail || 'AI could not complete that edit.');
        setBulkResult(null);
        return;
      }
      setBulkResult({
        summary: res.summary,
        patches: res.patches,
        fromCache: res.fromCache,
        errorKind: res.errorKind,
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkDraft, selectedIds, tasks, cpm]);

  const handleBulkApplyAll = useCallback(() => {
    if (!bulkResult) return;
    if (onApplyBulkPatches) {
      onApplyBulkPatches(bulkResult.patches.map(p => ({ taskId: p.taskId, patch: p.patch })));
    } else {
      for (const p of bulkResult.patches) onApplyPatch(p.taskId, p.patch);
    }
    setBulkResult(null);
    setBulkDraft('');
  }, [bulkResult, onApplyBulkPatches, onApplyPatch]);

  const handleBulkApplyOne = useCallback((p: AIBulkPatch) => {
    onApplyPatch(p.taskId, p.patch);
    setBulkResult(prev => prev ? {
      ...prev,
      patches: prev.patches.filter(x => x.taskId !== p.taskId),
    } : prev);
  }, [onApplyPatch]);

  const resetAll = useCallback(() => {
    setMode('home');
    setBusy(false);
    setError(null);
    setRiskResult(null);
    setOptResult(null);
    setExplainText('');
    setAsBuiltPatches([]);
    setGenPreview(null);
    setCallStats({ total: 0, cached: 0 });
  }, []);

  // Wrap every async action with loading + error guard.
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); }
    catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally { setBusy(false); }
  }, []);

  const handleDetectRisks = useCallback(() => {
    setMode('risks');
    run(async () => {
      const res = await aiDetectRisks(tasks, cpm);
      setRiskResult({ summary: res.summary, findings: res.findings });
    });
  }, [tasks, cpm, run]);

  const handleOptimize = useCallback(() => {
    setMode('optimize');
    run(async () => {
      const res = await aiOptimizeSchedule(tasks, cpm);
      setOptResult({ summary: res.summary, ideas: res.ideas });
    });
  }, [tasks, cpm, run]);

  const handleExplain = useCallback(() => {
    setMode('explain');
    run(async () => {
      const res = await aiExplainCriticalPath(tasks, cpm);
      setExplainText(res.explanation);
    });
  }, [tasks, cpm, run]);

  const handleAsk = useCallback(() => {
    if (!chatDraft.trim()) return;
    const question = chatDraft.trim();
    setChatDraft('');
    run(async () => {
      const res = await aiAskSchedule(tasks, cpm, question, projectStartDate);
      setChatHistory(h => [...h, { q: question, a: res.answer }]);
    });
  }, [chatDraft, tasks, cpm, projectStartDate, run]);

  const handleAsBuiltParse = useCallback(() => {
    if (!asBuiltDraft.trim()) return;
    run(async () => {
      const res = await aiLogAsBuilt(tasks, asBuiltDraft.trim(), todayDayNumber);
      setAsBuiltPatches(res.patches);
    });
  }, [asBuiltDraft, tasks, todayDayNumber, run]);

  const handleAsBuiltApply = useCallback((p: AIAsBuiltPatch) => {
    onApplyPatch(p.taskId, p.patch);
    setAsBuiltPatches(prev => prev.filter(x => x.taskId !== p.taskId));
  }, [onApplyPatch]);

  const handleAsBuiltApplyAll = useCallback(() => {
    for (const p of asBuiltPatches) onApplyPatch(p.taskId, p.patch);
    setAsBuiltPatches([]);
    setAsBuiltDraft('');
  }, [asBuiltPatches, onApplyPatch]);

  const handleGenerate = useCallback(() => {
    if (!genDraft.trim()) return;
    run(async () => {
      const res = await aiGenerateSchedule(genDraft.trim());
      const materialized = materializeGeneratedTasks(res.tasks);
      setGenPreview(materialized);
    });
  }, [genDraft, run]);

  const handleGenerateApply = useCallback(() => {
    if (!genPreview) return;
    onReplaceAll(genPreview);
    setGenPreview(null);
    setGenDraft('');
    onClose();
  }, [genPreview, onReplaceAll, onClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <View style={styles.panel}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconWrap}>
              <Sparkles size={16} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.headerTitle}>AI Schedule Assistant</Text>
              <Text style={styles.headerSub}>
                {callStats.total > 0
                  ? `${callStats.total} call${callStats.total === 1 ? '' : 's'} · ${callStats.cached} cached`
                  : mode === 'home' ? 'Pick an action below' : `Mode: ${mode}`}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Mode switcher (always visible) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.modeRow}
        >
          {selectedCount > 0 && (
            <ModeChip icon={Sparkles} label={`Bulk (${selectedCount})`} active={mode === 'bulk'} onPress={() => setMode('bulk')} />
          )}
          <ModeChip icon={ShieldAlert} label="Risks"      active={mode === 'risks'}    onPress={handleDetectRisks} />
          <ModeChip icon={Zap}          label="Optimize"   active={mode === 'optimize'} onPress={handleOptimize} />
          <ModeChip icon={Target}       label="Explain CP" active={mode === 'explain'}  onPress={handleExplain} />
          <ModeChip icon={MessageSquare} label="Ask"       active={mode === 'ask'}      onPress={() => setMode('ask')} />
          <ModeChip icon={Mic}          label="As-built"  active={mode === 'asbuilt'}  onPress={() => setMode('asbuilt')} />
          <ModeChip icon={Wand2}        label="Generate"   active={mode === 'generate'} onPress={() => setMode('generate')} />
        </ScrollView>

        {/* Selection summary strip — informs the user that bulk ops are scoped. */}
        {selectedCount > 0 && mode === 'bulk' && (
          <View style={styles.selectionStrip}>
            <Sparkles size={12} color={Colors.primary} />
            <Text style={styles.selectionStripText} numberOfLines={2}>
              Bulk editing {selectedCount} task{selectedCount === 1 ? '' : 's'}:{' '}
              <Text style={styles.selectionStripNames}>
                {selectedTaskTitles.slice(0, 3).join(', ')}
                {selectedTaskTitles.length > 3 ? `, +${selectedTaskTitles.length - 3} more` : ''}
              </Text>
            </Text>
          </View>
        )}

        {/* Body — scroll area */}
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
          {busy && (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.busyText}>Thinking…</Text>
            </View>
          )}
          {error && (
            <View style={styles.errorCard}>
              <AlertTriangle size={14} color={Colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {mode === 'home' && !busy && (
            <HomeCard
              taskCount={tasks.length}
              criticalCount={cpm.criticalPath.length}
              onGenerate={() => setMode('generate')}
              onRisks={handleDetectRisks}
              onAsBuilt={() => setMode('asbuilt')}
            />
          )}

          {mode === 'risks' && riskResult && !busy && (
            <RisksView
              result={riskResult}
              tasks={tasks}
              onFocusTasks={onFocusTasks}
            />
          )}

          {mode === 'optimize' && optResult && !busy && (
            <OptimizeView result={optResult} tasks={tasks} onFocusTasks={onFocusTasks} />
          )}

          {mode === 'explain' && explainText !== '' && !busy && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Why this is the critical path</Text>
              <Text style={styles.cardBody}>{explainText}</Text>
            </View>
          )}

          {mode === 'ask' && (
            <View>
              {chatHistory.map((h, i) => (
                <View key={i} style={styles.chatTurn}>
                  <View style={styles.chatQ}>
                    <Text style={styles.chatQText}>{h.q}</Text>
                  </View>
                  <View style={styles.chatA}>
                    <Text style={styles.chatAText}>{h.a}</Text>
                  </View>
                </View>
              ))}
              {chatHistory.length === 0 && !busy && (
                <View style={styles.emptyHint}>
                  <Text style={styles.emptyHintText}>
                    Ask anything about the schedule. Try: {'\n'}
                    "When does drywall start?" {'\n'}
                    "What's on the critical path for week 6?" {'\n'}
                    "Which crew is busiest?"
                  </Text>
                </View>
              )}
            </View>
          )}

          {mode === 'asbuilt' && (
            <View>
              <View style={styles.emptyHint}>
                <Text style={styles.emptyHintText}>
                  Talk like you would to a site foreman. Try: {'\n'}
                  "We finished the foundation and started framing today." {'\n'}
                  AI will propose the matching task updates — you approve each.
                </Text>
              </View>
              {asBuiltPatches.length > 0 && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{asBuiltPatches.length} update(s) proposed</Text>
                    <TouchableOpacity style={styles.applyAllBtn} onPress={handleAsBuiltApplyAll}>
                      <Check size={12} color="#fff" />
                      <Text style={styles.applyAllBtnText}>Apply all</Text>
                    </TouchableOpacity>
                  </View>
                  {asBuiltPatches.map(p => (
                    <View key={p.taskId} style={styles.patchRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.patchTitle}>{p.taskTitle}</Text>
                        <Text style={styles.patchDetail}>{describePatch(p.patch)}</Text>
                        {p.rationale ? <Text style={styles.patchRationale}>"{p.rationale}"</Text> : null}
                      </View>
                      <TouchableOpacity style={styles.applyBtn} onPress={() => handleAsBuiltApply(p)}>
                        <Check size={12} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {mode === 'bulk' && (
            <View>
              {selectedCount === 0 ? (
                <View style={styles.emptyHint}>
                  <Text style={styles.emptyHintText}>
                    No tasks are selected. Click a row's number in the grid to
                    select it, then come back here to edit in bulk with AI.
                  </Text>
                </View>
              ) : (
                <View style={styles.emptyHint}>
                  <Text style={styles.emptyHintText}>
                    Tell AI what to do with the {selectedCount} selected task{selectedCount === 1 ? '' : 's'}. Try:{'\n'}
                    "Compress each of these by 20%"{'\n'}
                    "Move them all out by one week"{'\n'}
                    "Reassign to the Finish Carp crew"
                  </Text>
                </View>
              )}
              {bulkResult && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={[styles.cardTitle, { flex: 1 }]}>{bulkResult.patches.length} change(s) proposed</Text>
                    {bulkResult.fromCache && (
                      <View style={styles.cachedPill}>
                        <Text style={styles.cachedPillText}>cached</Text>
                      </View>
                    )}
                    {bulkResult.patches.length > 0 && (
                      <TouchableOpacity style={styles.applyAllBtn} onPress={handleBulkApplyAll}>
                        <Check size={12} color="#fff" />
                        <Text style={styles.applyAllBtnText}>Apply all</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {bulkResult.errorKind === 'validation' && (
                    <View style={styles.partialBanner}>
                      <AlertTriangle size={12} color={Colors.warning} />
                      <Text style={styles.partialBannerText}>
                        Partial result — AI response didn't fully match the expected shape. Review carefully before applying.
                      </Text>
                    </View>
                  )}
                  {bulkResult.summary ? (
                    <Text style={styles.cardBody}>{bulkResult.summary}</Text>
                  ) : null}
                  {bulkResult.patches.map(p => (
                    <View key={p.taskId} style={styles.patchRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.patchTitle}>{p.taskTitle}</Text>
                        <Text style={styles.patchDetail}>{describePatch(p.patch)}</Text>
                        {p.rationale ? <Text style={styles.patchRationale}>"{p.rationale}"</Text> : null}
                      </View>
                      <TouchableOpacity style={styles.applyBtn} onPress={() => handleBulkApplyOne(p)}>
                        <Check size={12} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {mode === 'generate' && (
            <View>
              <View style={styles.emptyHint}>
                <Text style={styles.emptyHintText}>
                  Describe your project and AI will draft the full schedule. Try: {'\n'}
                  "2500sqft two-story residential build, Dallas, break ground May 1, 4-month deadline" {'\n'}
                  You'll see a preview before anything replaces your current plan.
                </Text>
              </View>
              {genPreview && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{genPreview.length} tasks proposed</Text>
                  <Text style={styles.cardBody}>
                    Runs approximately{' '}
                    {Math.max(...genPreview.map(t => t.startDay + Math.max(0, t.durationDays - 1)))} days.
                  </Text>
                  <View style={{ maxHeight: 220, marginTop: 8 }}>
                    <ScrollView>
                      {genPreview.slice(0, 50).map((t, i) => (
                        <Text key={t.id} style={styles.genPreviewRow} numberOfLines={1}>
                          {i + 1}. {t.title}  ·  {t.durationDays}d  ·  {t.crew || '—'}
                        </Text>
                      ))}
                    </ScrollView>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setGenPreview(null)}>
                      <Text style={styles.secondaryBtnText}>Discard</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.primaryBtn} onPress={handleGenerateApply}>
                      <Check size={12} color="#fff" />
                      <Text style={styles.primaryBtnText}>Apply to project</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Input bar — changes by mode */}
        {mode === 'ask' && (
          <InputBar
            value={chatDraft}
            onChangeText={setChatDraft}
            onSubmit={handleAsk}
            placeholder="Ask anything about the schedule…"
            busy={busy}
          />
        )}
        {mode === 'asbuilt' && (
          <InputBar
            value={asBuiltDraft}
            onChangeText={setAsBuiltDraft}
            onSubmit={handleAsBuiltParse}
            placeholder="'We poured the slab and started framing today…'"
            busy={busy}
          />
        )}
        {mode === 'generate' && !genPreview && (
          <InputBar
            value={genDraft}
            onChangeText={setGenDraft}
            onSubmit={handleGenerate}
            placeholder="Describe your project in 1-2 sentences…"
            busy={busy}
          />
        )}
        {mode === 'bulk' && selectedCount > 0 && (
          <InputBar
            value={bulkDraft}
            onChangeText={setBulkDraft}
            onSubmit={handleBulkEdit}
            placeholder="What should I do with the selected tasks?"
            busy={busy}
          />
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModeChip({
  icon: Icon, label, active, onPress,
}: { icon: any; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.modeChip, active && styles.modeChipActive]} onPress={onPress} activeOpacity={0.8}>
      <Icon size={12} color={active ? '#fff' : Colors.primary} />
      <Text style={[styles.modeChipText, active && { color: '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function HomeCard({
  taskCount, criticalCount, onGenerate, onRisks, onAsBuilt,
}: { taskCount: number; criticalCount: number; onGenerate: () => void; onRisks: () => void; onAsBuilt: () => void; }) {
  const empty = taskCount === 0;
  return (
    <View>
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>{taskCount}</Text>
          <Text style={styles.statLabel}>Tasks</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: Colors.error }]}>{criticalCount}</Text>
          <Text style={styles.statLabel}>Critical</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Quick actions</Text>
      <View style={styles.quickGrid}>
        {empty ? (
          <QuickBtn icon={Wand2} title="Generate schedule" sub="Describe project → full plan" onPress={onGenerate} featured />
        ) : (
          <>
            <QuickBtn icon={ShieldAlert} title="Detect risks" sub="Scan for logic issues" onPress={onRisks} featured />
            <QuickBtn icon={Mic} title="Log progress" sub="Voice-to-actuals" onPress={onAsBuilt} />
          </>
        )}
      </View>
    </View>
  );
}

function QuickBtn({
  icon: Icon, title, sub, onPress, featured,
}: { icon: any; title: string; sub: string; onPress: () => void; featured?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.quickBtn, featured && styles.quickBtnFeatured]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Icon size={16} color={featured ? '#fff' : Colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.quickBtnTitle, featured && { color: '#fff' }]}>{title}</Text>
        <Text style={[styles.quickBtnSub, featured && { color: 'rgba(255,255,255,0.8)' }]}>{sub}</Text>
      </View>
      <ArrowRight size={14} color={featured ? '#fff' : Colors.textSecondary} />
    </TouchableOpacity>
  );
}

function RisksView({
  result, tasks, onFocusTasks,
}: { result: { summary: string; findings: AIRiskFinding[] }; tasks: ScheduleTask[]; onFocusTasks?: (ids: string[]) => void }) {
  const color = (s: AIRiskFinding['severity']) => s === 'high' ? Colors.error : s === 'medium' ? Colors.warning : Colors.textSecondary;
  const names = (ids: string[]) => ids.map(id => tasks.find(t => t.id === id)?.title).filter(Boolean).join(', ');
  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Summary</Text>
        <Text style={styles.cardBody}>{result.summary}</Text>
      </View>
      {result.findings.length === 0 && (
        <View style={styles.emptyHint}><Text style={styles.emptyHintText}>No issues found — the plan looks solid.</Text></View>
      )}
      {result.findings.map(f => (
        <View key={f.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.severityDot, { backgroundColor: color(f.severity) }]} />
            <Text style={[styles.cardTitle, { flex: 1 }]}>{f.title}</Text>
            <Text style={[styles.severityLabel, { color: color(f.severity) }]}>{f.severity.toUpperCase()}</Text>
          </View>
          <Text style={styles.cardBody}>{f.detail}</Text>
          {f.suggestion && <Text style={styles.cardSuggestion}>→ {f.suggestion}</Text>}
          {f.affectedTaskIds.length > 0 && (
            <TouchableOpacity
              style={styles.focusLink}
              onPress={() => onFocusTasks?.(f.affectedTaskIds)}
            >
              <Text style={styles.focusLinkText} numberOfLines={1}>
                Affects: {names(f.affectedTaskIds)}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

function OptimizeView({
  result, tasks, onFocusTasks,
}: { result: { summary: string; ideas: AIOptimizationIdea[] }; tasks: ScheduleTask[]; onFocusTasks?: (ids: string[]) => void }) {
  const names = (ids: string[]) => ids.map(id => tasks.find(t => t.id === id)?.title).filter(Boolean).join(', ');
  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Summary</Text>
        <Text style={styles.cardBody}>{result.summary}</Text>
      </View>
      {result.ideas.map(idea => (
        <View key={idea.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { flex: 1 }]}>{idea.title}</Text>
            {idea.expectedDaysSaved > 0 && (
              <Text style={styles.saveBadge}>−{idea.expectedDaysSaved}d</Text>
            )}
          </View>
          <Text style={styles.cardBody}>{idea.detail}</Text>
          {idea.affectedTaskIds.length > 0 && (
            <TouchableOpacity style={styles.focusLink} onPress={() => onFocusTasks?.(idea.affectedTaskIds)}>
              <Text style={styles.focusLinkText} numberOfLines={1}>
                Affects: {names(idea.affectedTaskIds)}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

function InputBar({
  value, onChangeText, onSubmit, placeholder, busy,
}: { value: string; onChangeText: (v: string) => void; onSubmit: () => void; placeholder: string; busy: boolean }) {
  return (
    <View style={styles.inputBar}>
      <TextInput
        style={styles.inputField}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        multiline
        blurOnSubmit
        onSubmitEditing={() => { if (!busy) onSubmit(); }}
      />
      <TouchableOpacity
        style={[styles.inputSend, (busy || !value.trim()) && { opacity: 0.5 }]}
        onPress={onSubmit}
        disabled={busy || !value.trim()}
      >
        {busy
          ? <ActivityIndicator size="small" color="#fff" />
          : <ArrowRight size={16} color="#fff" />}
      </TouchableOpacity>
    </View>
  );
}

function describePatch(patch: Partial<ScheduleTask>): string {
  const bits: string[] = [];
  if (patch.progress != null) bits.push(`${patch.progress}% progress`);
  if (patch.status) bits.push(patch.status.replace('_', ' '));
  if (patch.actualStartDay != null) bits.push(`start day ${patch.actualStartDay}`);
  if (patch.actualEndDay != null) bits.push(`finish day ${patch.actualEndDay}`);
  return bits.join(' · ') || 'update';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 420;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 2000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  panel: {
    width: PANEL_WIDTH,
    maxWidth: '100%',
    height: '100%',
    backgroundColor: Colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: -4, height: 0 },
    flexDirection: 'column',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.primary + '1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  closeBtn: { padding: 4 },

  modeRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.primary + '14',
  },
  modeChipActive: { backgroundColor: Colors.primary },
  modeChipText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  body: { flex: 1, padding: 12 },

  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  busyText: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' },

  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, marginBottom: 8,
    borderRadius: 8,
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.error + '33',
  },
  errorText: { fontSize: 12, color: Colors.error, flex: 1 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  statNum: { fontSize: 22, fontWeight: '800', color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, fontWeight: '600' },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  quickGrid: { gap: 8 },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  quickBtnFeatured: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  quickBtnTitle: { fontSize: 13, fontWeight: '700', color: Colors.text },
  quickBtnSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: Colors.text },
  cardBody: { fontSize: 12, color: Colors.text, lineHeight: 18 },
  cardSuggestion: { fontSize: 12, color: Colors.primary, marginTop: 6, fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },

  severityDot: { width: 8, height: 8, borderRadius: 4 },
  severityLabel: { fontSize: 9, fontWeight: '800' },

  saveBadge: {
    fontSize: 11, fontWeight: '800', color: Colors.success,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: Colors.success + '20',
  },

  focusLink: { marginTop: 6 },
  focusLinkText: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic' },

  emptyHint: {
    padding: 14, borderRadius: 10,
    backgroundColor: Colors.fillSecondary,
    marginBottom: 10,
  },
  emptyHintText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },

  chatTurn: { marginBottom: 14 },
  chatQ: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, alignSelf: 'flex-end',
    maxWidth: '90%', marginBottom: 4,
  },
  chatQText: { color: '#fff', fontSize: 12 },
  chatA: {
    backgroundColor: Colors.fillSecondary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, alignSelf: 'flex-start',
    maxWidth: '95%',
  },
  chatAText: { color: Colors.text, fontSize: 12, lineHeight: 18 },

  patchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  patchTitle: { fontSize: 12, fontWeight: '700', color: Colors.text },
  patchDetail: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  patchRationale: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic', marginTop: 2 },

  applyBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  applyAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  applyAllBtnText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8, backgroundColor: Colors.primary,
  },
  primaryBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  secondaryBtn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1, borderColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  secondaryBtnText: { color: Colors.text, fontSize: 12, fontWeight: '700' },

  genPreviewRow: { fontSize: 11, color: Colors.text, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    backgroundColor: Colors.surfaceAlt,
  },
  inputField: {
    flex: 1,
    maxHeight: 80,
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    fontSize: 12,
    color: Colors.text,
  },
  inputSend: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  selectionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.primary + '12',
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary + '30',
  },
  selectionStripText: {
    flex: 1,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 14,
  },
  selectionStripNames: {
    color: Colors.text,
    fontWeight: '600',
  },
  cachedPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: Colors.textSecondary + '22',
  },
  cachedPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  partialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    marginTop: 4,
    marginBottom: 6,
    borderRadius: 6,
    backgroundColor: Colors.warning + '18',
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  partialBannerText: {
    flex: 1,
    fontSize: 11,
    color: Colors.warning,
    lineHeight: 15,
  },
});

```


---

### `components/schedule/ScheduleShareSheet.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  Share2,
  X,
  FileText,
  Users,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  formatShortDate,
  getPhaseColor,
  getStatusLabel,
  getTaskDateRange,
  addWorkingDays,
} from '@/utils/scheduleEngine';

interface ScheduleShareSheetProps {
  visible: boolean;
  onClose: () => void;
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  projectStartDate: Date;
  projectName: string;
  companyName?: string;
}

function ScheduleShareSheet({
  visible,
  onClose,
  schedule,
  tasks,
  projectStartDate,
  projectName,
  companyName,
}: ScheduleShareSheetProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareMode, setShareMode] = useState<'full' | 'trade'>('full');
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);

  const phases = React.useMemo(() => {
    const set = new Set(tasks.map(t => t.phase));
    return Array.from(set);
  }, [tasks]);

  const generatePdfHtml = useCallback((filteredTasks: ScheduleTask[]): string => {
    const endDate = addWorkingDays(projectStartDate, schedule.totalDurationDays, schedule.workingDaysPerWeek);
    const totalProgress = filteredTasks.length > 0
      ? Math.round(filteredTasks.reduce((s, t) => s + t.progress, 0) / filteredTasks.length)
      : 0;

    const taskRows = filteredTasks.map(t => {
      const dr = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
      const phaseColor = getPhaseColor(t.phase);
      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${phaseColor};margin-right:6px;"></span>
            ${t.title}${t.isMilestone ? ' ⚑' : ''}${t.isCriticalPath ? ' ⚡' : ''}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#666;">${t.phase}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;">${formatShortDate(dr.start)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;">${formatShortDate(dr.end)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${t.durationDays}d</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;">
            <div style="background:#e5e5e5;border-radius:4px;height:8px;overflow:hidden;">
              <div style="background:${phaseColor};height:100%;width:${t.progress}%;border-radius:4px;"></div>
            </div>
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;font-weight:600;">${t.progress}%</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#888;">${getStatusLabel(t.status)}</td>
        </tr>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; padding: 30px; color: #1a1a1a; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
          .stats { display: flex; gap: 20px; margin-bottom: 24px; }
          .stat { background: #f5f5f5; border-radius: 10px; padding: 12px 16px; text-align: center; flex: 1; }
          .stat-value { font-size: 22px; font-weight: 800; }
          .stat-label { font-size: 11px; color: #888; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { text-align: left; padding: 8px 10px; background: #f8f8f8; border-bottom: 2px solid #ddd; font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
          .footer { margin-top: 30px; font-size: 10px; color: #aaa; text-align: center; }
        </style>
      </head>
      <body>
        ${companyName ? `<div style="font-size:11px;color:#888;margin-bottom:4px;">${companyName}</div>` : ''}
        <h1>${projectName} — Schedule</h1>
        <div class="subtitle">
          ${formatShortDate(projectStartDate)} – ${formatShortDate(endDate)} · ${schedule.totalDurationDays} working days
          ${shareMode === 'trade' && selectedPhase ? ` · ${selectedPhase} only` : ''}
        </div>
        <div class="stats">
          <div class="stat"><div class="stat-value">${totalProgress}%</div><div class="stat-label">Complete</div></div>
          <div class="stat"><div class="stat-value">${filteredTasks.length}</div><div class="stat-label">Tasks</div></div>
          <div class="stat"><div class="stat-value">${schedule.totalDurationDays}</div><div class="stat-label">Duration</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Task</th><th>Phase</th><th>Start</th><th>End</th><th>Duration</th><th style="width:80px;">Progress</th><th>%</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${taskRows}
          </tbody>
        </table>
        <div class="footer">Generated by MAGE ID · ${new Date().toLocaleDateString()}</div>
      </body>
      </html>
    `;
  }, [schedule, projectStartDate, projectName, companyName, shareMode, selectedPhase]);

  const handleShare = useCallback(async () => {
    setIsGenerating(true);
    try {
      const filteredTasks = shareMode === 'trade' && selectedPhase
        ? tasks.filter(t => t.phase === selectedPhase)
        : tasks;

      const html = generatePdfHtml(filteredTasks);
      const { uri } = await Print.printToFileAsync({ html });

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${projectName} Schedule`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Sharing not available', 'Sharing is not supported on this device.');
      }

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err) {
      console.log('[ScheduleShare] Error generating PDF:', err);
      Alert.alert('Error', 'Failed to generate schedule PDF.');
    } finally {
      setIsGenerating(false);
    }
  }, [tasks, shareMode, selectedPhase, generatePdfHtml, projectName, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={st.sheet}>
          <View style={st.handle} />
          <View style={st.header}>
            <View style={st.headerLeft}>
              <Share2 size={18} color={Colors.primary} />
              <Text style={st.headerTitle}>Share Schedule</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={st.modeRow}>
            <TouchableOpacity
              style={[st.modeBtn, shareMode === 'full' && st.modeBtnActive]}
              onPress={() => setShareMode('full')}
            >
              <FileText size={14} color={shareMode === 'full' ? '#FFF' : Colors.textSecondary} />
              <Text style={[st.modeBtnText, shareMode === 'full' && st.modeBtnTextActive]}>Full Schedule</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.modeBtn, shareMode === 'trade' && st.modeBtnActive]}
              onPress={() => setShareMode('trade')}
            >
              <Users size={14} color={shareMode === 'trade' ? '#FFF' : Colors.textSecondary} />
              <Text style={[st.modeBtnText, shareMode === 'trade' && st.modeBtnTextActive]}>By Trade</Text>
            </TouchableOpacity>
          </View>

          {shareMode === 'trade' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.phaseScroll}>
              <View style={st.phaseRow}>
                {phases.map(phase => (
                  <TouchableOpacity
                    key={phase}
                    style={[st.phaseChip, selectedPhase === phase && st.phaseChipActive]}
                    onPress={() => setSelectedPhase(phase)}
                  >
                    <View style={[st.phaseChipDot, { backgroundColor: getPhaseColor(phase) }]} />
                    <Text style={[st.phaseChipText, selectedPhase === phase && st.phaseChipTextActive]}>{phase}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          <TouchableOpacity
            style={[st.shareBtn, isGenerating && { opacity: 0.6 }]}
            onPress={handleShare}
            disabled={isGenerating || (shareMode === 'trade' && !selectedPhase)}
            activeOpacity={0.85}
          >
            {isGenerating ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Share2 size={16} color="#FFF" />
            )}
            <Text style={st.shareBtnText}>
              {isGenerating ? 'Generating PDF...' : 'Generate & Share PDF'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 14,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.fillTertiary, alignSelf: 'center', marginBottom: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },

  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
  },
  modeBtnActive: { backgroundColor: Colors.primary },
  modeBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
  modeBtnTextActive: { color: '#FFF' },

  phaseScroll: { marginVertical: 2 },
  phaseRow: { flexDirection: 'row', gap: 6 },
  phaseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  phaseChipActive: { backgroundColor: Colors.primary + '18', borderWidth: 1, borderColor: Colors.primary },
  phaseChipDot: { width: 6, height: 6, borderRadius: 3 },
  phaseChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  phaseChipTextActive: { color: Colors.primary },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  shareBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },
});

export default React.memo(ScheduleShareSheet);

```


---

### `utils/scheduleEngine.ts`

```ts
import type { ScheduleTask, DependencyLink, ProjectSchedule, ScheduleRiskItem, ScheduleBaseline } from '@/types';

export const PHASE_OPTIONS = [
  'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
  'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Insulation',
  'Drywall', 'Interior', 'Finishes', 'Landscaping', 'Inspections', 'General',
];

export const PHASE_COLORS: Record<string, string> = {
  'Site Work': '#8B6914',
  'Demo': '#C75050',
  'Foundation': '#6B7280',
  'Framing': '#B45309',
  'Roofing': '#7C3AED',
  'MEP': '#0891B2',
  'Plumbing': '#2563EB',
  'Electrical': '#DC2626',
  'HVAC': '#059669',
  'Insulation': '#D97706',
  'Drywall': '#9CA3AF',
  'Interior': '#EC4899',
  'Finishes': '#10B981',
  'Landscaping': '#22C55E',
  'Inspections': '#F59E0B',
  'General': '#6366F1',
};

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDepLinks(task: ScheduleTask): DependencyLink[] {
  if (task.dependencyLinks && task.dependencyLinks.length > 0) return task.dependencyLinks;
  return task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
}

export function recalculateStartDays(tasks: ScheduleTask[]): ScheduleTask[] {
  const taskMap = new Map<string, ScheduleTask>();
  for (const t of tasks) taskMap.set(t.id, { ...t });

  const resolved = new Set<string>();

  const resolve = (id: string): number => {
    const task = taskMap.get(id);
    if (!task) return 0;
    if (resolved.has(id)) return task.startDay + task.durationDays;

    resolved.add(id);

    const links = getDepLinks(task);
    if (links.length === 0) {
      if (task.startDay < 1) task.startDay = 1;
      return task.startDay + task.durationDays;
    }

    let latestEnd = 0;
    for (const link of links) {
      if (taskMap.has(link.taskId)) {
        const dep = taskMap.get(link.taskId)!;
        const depEnd = resolve(link.taskId);
        const depStart = dep.startDay;
        const lag = link.lagDays || 0;
        const type = link.type || 'FS';

        let effectiveStart = 0;
        switch (type) {
          case 'FS':
            effectiveStart = depEnd + lag;
            break;
          case 'SS':
            effectiveStart = depStart + lag;
            break;
          case 'FF':
            effectiveStart = (depEnd + lag) - task.durationDays;
            break;
          case 'SF':
            effectiveStart = depStart + lag - task.durationDays;
            break;
          default:
            effectiveStart = depEnd + lag;
        }
        latestEnd = Math.max(latestEnd, effectiveStart);
      }
    }

    task.startDay = latestEnd > 0 ? latestEnd : task.startDay;
    return task.startDay + task.durationDays;
  };

  for (const t of tasks) resolve(t.id);

  const result: ScheduleTask[] = [];
  for (const t of tasks) result.push(taskMap.get(t.id)!);
  return result;
}

export function getSuccessors(taskId: string, tasks: ScheduleTask[]): ScheduleTask[] {
  return tasks.filter(t => {
    const links = getDepLinks(t);
    return links.some(l => l.taskId === taskId);
  });
}

export function getPredecessors(task: ScheduleTask, tasks: ScheduleTask[]): ScheduleTask[] {
  const links = getDepLinks(task);
  return links
    .map(l => tasks.find(t => t.id === l.taskId))
    .filter((t): t is ScheduleTask => t !== undefined);
}

export function getLagForDep(task: ScheduleTask, depId: string): number {
  const links = getDepLinks(task);
  const link = links.find(l => l.taskId === depId);
  return link?.lagDays ?? 0;
}

export function getDepTypeForDep(task: ScheduleTask, depId: string): string {
  const links = getDepLinks(task);
  const link = links.find(l => l.taskId === depId);
  return link?.type ?? 'FS';
}

export function calculateHealthScore(tasks: ScheduleTask[], updatedAt: string): number {
  if (tasks.length === 0) return 100;

  const now = new Date();
  const totalTasks = tasks.length;

  const onTimeTasks = tasks.filter(t => {
    if (t.status === 'done') return true;
    if (t.status === 'not_started' && t.progress === 0) return true;
    return t.progress > 0;
  }).length;
  const onTimeScore = (onTimeTasks / totalTasks) * 40;

  const milestones = tasks.filter(t => t.isMilestone);
  const hitMilestones = milestones.filter(t => t.status === 'done');
  const milestoneScore = milestones.length > 0
    ? (hitMilestones.length / milestones.length) * 20
    : 20;

  const criticalTasks = tasks.filter(t => t.isCriticalPath);
  const criticalOnTrack = criticalTasks.filter(t => t.status === 'done' || t.progress > 0);
  const criticalScore = criticalTasks.length > 0
    ? (criticalOnTrack.length / criticalTasks.length) * 25
    : 25;

  const lastUpdate = new Date(updatedAt);
  const daysSinceUpdate = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));
  const recencyScore = daysSinceUpdate <= 3 ? 15 : daysSinceUpdate <= 7 ? 10 : 5;

  return Math.min(100, Math.max(0, Math.round(onTimeScore + milestoneScore + criticalScore + recencyScore)));
}

export function getHealthColor(score: number): string {
  if (score >= 80) return '#34C759';
  if (score >= 60) return '#FF9500';
  return '#FF3B30';
}

export function addWorkingDays(start: Date, days: number, workingDaysPerWeek: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (workingDaysPerWeek >= 7 || (dow !== 0 && dow !== 6)) {
      added++;
    }
  }
  return result;
}

export function formatShortDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export function getTaskDateRange(
  task: ScheduleTask,
  projectStartDate: Date,
  workingDaysPerWeek: number
): { start: Date; end: Date } {
  const start = addWorkingDays(projectStartDate, task.startDay - 1, workingDaysPerWeek);
  const end = addWorkingDays(start, task.durationDays - 1, workingDaysPerWeek);
  return { start, end };
}

export function getStatusLabel(status: ScheduleTask['status']): string {
  switch (status) {
    case 'done': return 'Complete';
    case 'in_progress': return 'In Progress';
    case 'on_hold': return 'On Hold';
    default: return 'Not Started';
  }
}

export function getStatusColor(status: ScheduleTask['status']): string {
  switch (status) {
    case 'done': return '#34C759';
    case 'in_progress': return '#007AFF';
    case 'on_hold': return '#FF9500';
    default: return '#8E8E93';
  }
}

export function getTaskBorderColor(task: ScheduleTask, projectStartDate: Date, workingDaysPerWeek: number): string {
  if (task.isMilestone) return '#007AFF';
  if (task.status === 'done') return '#34C759';
  if (task.status === 'not_started' && task.progress === 0) return '#C7C7CC';

  const { end } = getTaskDateRange(task, projectStartDate, workingDaysPerWeek);
  const now = new Date();
  const daysUntilEnd = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilEnd < 0) return '#FF3B30';
  if (daysUntilEnd <= 3) return '#FF9500';
  return '#34C759';
}

export function suggestDuration(taskName: string): number {
  const name = taskName.toLowerCase();
  if (name.includes('pour') || name.includes('concrete slab')) return 2;
  if (name.includes('framing') || name.includes('frame')) return 10;
  if (name.includes('paint')) return 3;
  if (name.includes('demo') || name.includes('demolition')) return 2;
  if (name.includes('inspection')) return 1;
  if (name.includes('roof')) return 5;
  if (name.includes('plumb')) return 5;
  if (name.includes('electric')) return 5;
  if (name.includes('hvac')) return 4;
  if (name.includes('drywall')) return 4;
  if (name.includes('floor')) return 3;
  if (name.includes('insulation')) return 2;
  if (name.includes('tile')) return 4;
  if (name.includes('cabinet')) return 2;
  if (name.includes('landscape')) return 3;
  if (name.includes('foundation')) return 5;
  if (name.includes('excavat')) return 3;
  if (name.includes('grading')) return 2;
  if (name.includes('permit')) return 5;
  return 5;
}

export function buildScheduleFromTasks(
  name: string,
  projectId: string | null,
  tasks: ScheduleTask[],
  existingBaseline?: ScheduleBaseline | null
): ProjectSchedule {
  const recalculated = recalculateStartDays(tasks);
  const sortedTasks = recalculated
    .slice()
    .sort((a, b) => a.startDay - b.startDay || a.title.localeCompare(b.title));

  const totalDurationDays = sortedTasks.reduce((max, task) => {
    return Math.max(max, task.startDay + task.durationDays);
  }, 0);

  const criticalTasks = sortedTasks.filter(t => t.isCriticalPath || getDepLinks(t).length > 0 || t.durationDays >= 4);
  const criticalPathDays = criticalTasks.reduce((sum, task) => sum + task.durationDays, 0);

  const averageProgress = sortedTasks.length > 0
    ? sortedTasks.reduce((sum, task) => sum + task.progress, 0) / sortedTasks.length
    : 0;

  const laborAlignmentScore = Math.max(56, Math.min(98, Math.round(82 - sortedTasks.length * 1.5 + averageProgress * 0.18)));

  const updatedAt = new Date().toISOString();
  const healthScore = calculateHealthScore(sortedTasks, updatedAt);

  const overdueTasks = sortedTasks.filter(t => {
    if (t.status === 'done') return false;
    const end = t.startDay + t.durationDays;
    const now = new Date();
    const projectStart = new Date();
    const endDate = addWorkingDays(projectStart, end, 5);
    return endDate < now && t.progress < 100;
  });

  const riskItems: ScheduleRiskItem[] = [];

  overdueTasks.slice(0, 2).forEach((task) => {
    riskItems.push({
      id: `${task.id}-risk-overdue`,
      title: `${task.title} is behind schedule`,
      detail: `This task is overdue with ${task.progress}% complete. It may impact downstream tasks.`,
      severity: 'high',
    });
  });

  const criticalBehind = sortedTasks.filter(t => t.isCriticalPath && t.status !== 'done' && t.progress < 50);
  criticalBehind.slice(0, 2).forEach((task) => {
    if (!riskItems.some(r => r.id.startsWith(task.id))) {
      riskItems.push({
        id: `${task.id}-risk-critical`,
        title: `Critical path at risk: ${task.title}`,
        detail: `Only ${task.progress}% complete. Delays here will push the project end date.`,
        severity: 'high',
      });
    }
  });

  if (riskItems.length === 0 && sortedTasks.length > 0) {
    const notStarted = sortedTasks.filter(t => t.status === 'not_started' && t.startDay <= 6);
    notStarted.slice(0, 2).forEach((task, i) => {
      riskItems.push({
        id: `${task.id}-risk-${i}`,
        title: `Early phase watch: ${task.title}`,
        detail: `Scheduled to start soon but not yet begun. Monitor closely.`,
        severity: 'medium',
      });
    });
  }

  return {
    id: createId('schedule'),
    name,
    projectId,
    workingDaysPerWeek: 5,
    bufferDays: 3,
    tasks: sortedTasks,
    totalDurationDays: totalDurationDays + 3,
    criticalPathDays,
    laborAlignmentScore,
    healthScore,
    riskItems,
    baseline: existingBaseline ?? null,
    updatedAt,
  };
}

export function saveBaseline(schedule: ProjectSchedule): ScheduleBaseline {
  return {
    savedAt: new Date().toISOString(),
    tasks: schedule.tasks.map(t => ({
      id: t.id,
      startDay: t.startDay,
      endDay: t.startDay + t.durationDays,
    })),
  };
}

export function getBaselineVariance(task: ScheduleTask, baseline: ScheduleBaseline | null | undefined): number | null {
  if (!baseline) return null;
  const bt = baseline.tasks.find(b => b.id === task.id);
  if (!bt) return null;
  const currentEnd = task.startDay + task.durationDays;
  return currentEnd - bt.endDay;
}

export function getPhaseColor(phase: string): string {
  return PHASE_COLORS[phase] || '#6366F1';
}

export function generateWbsCodes(tasks: ScheduleTask[]): ScheduleTask[] {
  const phaseMap = new Map<string, number>();
  let phaseIdx = 0;

  return tasks.map(task => {
    if (!phaseMap.has(task.phase)) {
      phaseIdx++;
      phaseMap.set(task.phase, phaseIdx);
    }
    const pIdx = phaseMap.get(task.phase)!;
    const tasksInPhase = tasks.filter(t => t.phase === task.phase);
    const taskIdx = tasksInPhase.indexOf(task) + 1;

    return {
      ...task,
      wbsCode: task.wbsCode || `${pIdx}.${taskIdx}`,
    };
  });
}

```


---

### `utils/scheduleOps.ts`

```ts
// scheduleOps.ts — higher-level operations on a schedule: reflow from
// actuals, named baselines, CSV export, share-link encode/decode.
//
// Keep each op pure (input → output). The caller commits via their own
// state manager / persist layer.

import type { ScheduleTask, ScheduleBaseline } from '@/types';

// ---------------------------------------------------------------------------
// 1) Reflow from actuals
// ---------------------------------------------------------------------------
// Philosophy: the plan is sacred until the PM says "reality is the plan now."
// This op takes the observed variance on each task with actuals and cascades
// it to downstream successors.
//
// Algorithm (simple & deterministic):
//   For each task with `actualStartDay` set:
//     delta = actualStartDay - baselineStartDay  (or startDay if no baseline)
//     If delta > 0, push every transitive successor's startDay by `delta` days
//       (unless that successor also already has an actualStartDay, in which
//        case its actuals override the cascade — they've already happened).
//   Idempotent: running twice on the same data produces the same output.
//
// This does NOT recompute the critical path — the caller re-runs `runCpm`
// after applying the reflow so all float numbers are fresh.

export function reflowFromActuals(tasks: ScheduleTask[]): ScheduleTask[] {
  const byId = new Map<string, ScheduleTask>();
  for (const t of tasks) byId.set(t.id, { ...t });

  // Build successor index.
  const successors = new Map<string, string[]>();
  for (const t of tasks) {
    for (const depId of t.dependencies) {
      const arr = successors.get(depId) ?? [];
      arr.push(t.id);
      successors.set(depId, arr);
    }
  }

  // For each task with actuals, compute delta and propagate.
  for (const seed of tasks) {
    if (seed.actualStartDay == null) continue;
    const basis = seed.baselineStartDay ?? seed.startDay;
    const delta = seed.actualStartDay - basis;
    // Also factor in a finished task that ran longer than baseline.
    let finishDelta = 0;
    if (seed.actualEndDay != null) {
      const baseEnd = seed.baselineEndDay ?? (basis + Math.max(0, seed.durationDays - 1));
      finishDelta = seed.actualEndDay - baseEnd;
    }
    const push = Math.max(delta, finishDelta);
    if (push <= 0) continue;

    // BFS through successors. Stop at any successor that has its own actuals
    // (they're already grounded in reality and should be trusted).
    const seen = new Set<string>();
    const q = [...(successors.get(seed.id) ?? [])];
    while (q.length) {
      const sid = q.shift()!;
      if (seen.has(sid)) continue;
      seen.add(sid);
      const succ = byId.get(sid);
      if (!succ) continue;
      if (succ.actualStartDay != null) continue; // don't touch started work
      succ.startDay = succ.startDay + push;
      // Keep baseline as-is — baseline = the original promise, not the new plan.
      for (const next of successors.get(sid) ?? []) q.push(next);
    }
  }

  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// 2) Named baselines
// ---------------------------------------------------------------------------
// Extends the existing single-baseline model non-breakingly: we keep the
// legacy `schedule.baseline` for back-compat and add a sidecar list of named
// versions captured over time.

export interface NamedBaseline extends ScheduleBaseline {
  id: string;
  name: string;          // "v1", "Signed", "Approved rev 2", ...
  note?: string;
}

export function captureBaseline(tasks: ScheduleTask[], name: string, note?: string): NamedBaseline {
  return {
    id: `baseline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    note,
    savedAt: new Date().toISOString(),
    tasks: tasks.map(t => ({
      id: t.id,
      startDay: t.startDay,
      endDay: t.startDay + Math.max(0, t.durationDays - 1),
    })),
  };
}

/** Apply a captured baseline onto each task's baselineStartDay/baselineEndDay. */
export function applyBaselineToTasks(tasks: ScheduleTask[], baseline: NamedBaseline): ScheduleTask[] {
  const byId = new Map(baseline.tasks.map(b => [b.id, b]));
  return tasks.map(t => {
    const b = byId.get(t.id);
    if (!b) return t;
    return { ...t, baselineStartDay: b.startDay, baselineEndDay: b.endDay };
  });
}

export interface BaselineDiff {
  taskId: string;
  title: string;
  startDelta: number;    // newStart - baselineStart
  durationDelta: number;
  endDelta: number;
}

/** Show variance between the current plan and a named baseline. */
export function diffAgainstBaseline(tasks: ScheduleTask[], baseline: NamedBaseline): BaselineDiff[] {
  const byId = new Map(baseline.tasks.map(b => [b.id, b]));
  const out: BaselineDiff[] = [];
  for (const t of tasks) {
    const b = byId.get(t.id);
    if (!b) continue;
    const end = t.startDay + Math.max(0, t.durationDays - 1);
    const bDur = b.endDay - b.startDay + 1;
    if (t.startDay === b.startDay && t.durationDays === bDur) continue; // unchanged
    out.push({
      taskId: t.id,
      title: t.title,
      startDelta: t.startDay - b.startDay,
      durationDelta: t.durationDays - bDur,
      endDelta: end - b.endDay,
    });
  }
  return out.sort((a, b) => Math.abs(b.endDelta) - Math.abs(a.endDelta));
}

// ---------------------------------------------------------------------------
// 3) CSV export
// ---------------------------------------------------------------------------

export function exportTasksToCsv(tasks: ScheduleTask[], projectStartDate: Date): string {
  const fmtDate = (dayNum: number) => {
    const d = new Date(projectStartDate);
    d.setDate(d.getDate() + dayNum - 1);
    return d.toISOString().slice(0, 10);
  };
  const headers = [
    'WBS', 'Task', 'Phase', 'Duration (d)', 'Start day', 'Start date',
    'Finish day', 'Finish date', 'Crew', 'Progress %', 'Status',
    'Dependencies', 'Baseline start', 'Baseline end', 'Actual start', 'Actual end',
  ];
  const rows: string[] = [headers.join(',')];
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const t of tasks) {
    const finishDay = t.startDay + Math.max(0, t.durationDays - 1);
    const depTitles = t.dependencies
      .map(id => byId.get(id)?.title ?? id)
      .join('; ');
    const row = [
      t.wbsCode ?? '',
      csvEscape(t.title),
      t.phase,
      t.durationDays,
      t.startDay,
      fmtDate(t.startDay),
      finishDay,
      fmtDate(finishDay),
      csvEscape(t.crew),
      t.progress,
      t.status,
      csvEscape(depTitles),
      t.baselineStartDay ?? '',
      t.baselineEndDay ?? '',
      t.actualStartDay ?? '',
      t.actualEndDay ?? '',
    ];
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

function csvEscape(v: string): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Trigger a CSV download in the browser. Returns true on success. */
export function downloadCsvInBrowser(csv: string, filename: string): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// 4) Share-link encode/decode (client-only, no backend)
// ---------------------------------------------------------------------------
//
// We stuff a minimal projection of the schedule into base64 in the URL hash.
// Downsides: 50-task schedule is ~6KB URL, which is fine. No server = no
// database migrations = ships immediately.
//
// The projection is intentionally minimal — we don't ship notes, progress
// history, or internal ids. The shared view is read-only so that's fine.

export interface SharedSchedulePayload {
  v: 1;
  name: string;
  projectStartISO: string;
  tasks: Array<{
    id: string;
    title: string;
    phase: string;
    startDay: number;
    durationDays: number;
    dependencies: string[];
    crew?: string;
    isMilestone?: boolean;
    baselineStartDay?: number;
    baselineEndDay?: number;
    actualStartDay?: number;
    actualEndDay?: number;
    progress?: number;
  }>;
}

export function encodeShareToken(payload: SharedSchedulePayload): string {
  const json = JSON.stringify(payload);
  // btoa only handles ASCII; use utf-8 round-trip.
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map(b => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  // Make URL-safe.
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShareToken(token: string): SharedSchedulePayload | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const ascii = typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('binary');
    const bytes = Uint8Array.from(ascii, c => c.charCodeAt(0));
    const json = typeof TextDecoder !== 'undefined'
      ? new TextDecoder().decode(bytes)
      : ascii;
    const parsed = JSON.parse(json) as SharedSchedulePayload;
    if (parsed.v !== 1 || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildSharePayload(
  name: string,
  projectStartDate: Date,
  tasks: ScheduleTask[],
): SharedSchedulePayload {
  return {
    v: 1,
    name,
    projectStartISO: projectStartDate.toISOString(),
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      phase: t.phase,
      startDay: t.startDay,
      durationDays: t.durationDays,
      dependencies: t.dependencies,
      crew: t.crew || undefined,
      isMilestone: t.isMilestone,
      baselineStartDay: t.baselineStartDay,
      baselineEndDay: t.baselineEndDay,
      actualStartDay: t.actualStartDay,
      actualEndDay: t.actualEndDay,
      progress: t.progress,
    })),
  };
}

/** Reconstruct ScheduleTask[] from the shared payload so our viewer can render. */
export function tasksFromSharePayload(payload: SharedSchedulePayload): ScheduleTask[] {
  return payload.tasks.map(t => ({
    id: t.id,
    title: t.title,
    phase: t.phase,
    durationDays: t.durationDays,
    startDay: t.startDay,
    progress: t.progress ?? 0,
    crew: t.crew ?? '',
    dependencies: t.dependencies,
    notes: '',
    status: 'not_started',
    isMilestone: t.isMilestone,
    baselineStartDay: t.baselineStartDay,
    baselineEndDay: t.baselineEndDay,
    actualStartDay: t.actualStartDay,
    actualEndDay: t.actualEndDay,
  }));
}

```


---

### `utils/cpm.ts`

```ts
// Critical Path Method (CPM) engine for construction schedules.
//
// Purpose
// -------
// Given a set of tasks with dependencies (FS/SS/FF/SF + lag), compute:
//   1. Early Start (ES)  + Early Finish (EF)   — forward pass
//   2. Late Start  (LS)  + Late Finish  (LF)   — backward pass
//   3. Total Float  (TF)                        — LS − ES (= LF − EF)
//   4. Free Float   (FF)                        — slack before the next successor
//   5. Critical Path                            — tasks with TF ≤ 0
//   6. Resource Leveling                        — if two tasks share a crew and
//                                                 overlap, delay the one with
//                                                 more float. If both are on
//                                                 the critical path, the
//                                                 project end date slides and
//                                                 we surface the conflict.
//
// Why build this alongside scheduleEngine.ts rather than replacing it
// ------------------------------------------------------------------
// `recalculateStartDays` in scheduleEngine.ts is a forward-pass-only resolver.
// Lots of existing screens call it and expect the legacy mutation semantics
// (a task's startDay is PUSHED to meet its earliest constraint). This module
// is side-effect free: it takes tasks in, returns a `CpmResult`, and the
// caller decides whether to apply it. That keeps the old API working while
// the new UI (grid + drag Gantt) consumes the rich CPM output.
//
// Data model contract
// -------------------
// Days are integers, 1-indexed to match the rest of the codebase. A task that
// starts on day 1 with duration 5 has ES=1, EF=5 (inclusive end). A successor
// FS with lag 0 has ES = predecessor.EF + 1. The +1 is the convention the
// existing `recalculateStartDays` already uses — we preserve it so old data
// keeps laying out correctly.
//
//   FS (finish-to-start, default): S.ES ≥ P.EF + lag + 1
//   SS (start-to-start):           S.ES ≥ P.ES + lag
//   FF (finish-to-finish):         S.EF ≥ P.EF + lag  →  S.ES = S.EF − dur + 1
//   SF (start-to-finish, rare):    S.EF ≥ P.ES + lag  →  S.ES = S.EF − dur + 1
//
// (For SS/FF/SF the "+1" convention only applies where a finish meets a start.)

import type { ScheduleTask, DependencyLink } from '@/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface CpmTaskResult {
  id: string;
  es: number;          // early start (day number, 1-indexed)
  ef: number;          // early finish (day number, inclusive)
  ls: number;          // late start
  lf: number;          // late finish
  totalFloat: number;  // LS − ES  (also LF − EF). 0 or less → critical.
  freeFloat: number;   // slack before earliest successor starts slipping
  isCritical: boolean; // totalFloat ≤ 0
}

export interface CpmConflict {
  /** Machine-readable kind so the UI can show different icons / copy. */
  kind: 'cycle' | 'resource_overallocation' | 'resource_delayed_project';
  /** Short human-readable summary. */
  message: string;
  /** Task ids involved in the conflict. */
  taskIds: string[];
  /** Additional structured context for the UI (varies by kind). */
  detail?: Record<string, unknown>;
}

export interface CpmResult {
  /** Per-task CPM fields keyed by task.id. */
  perTask: Map<string, CpmTaskResult>;
  /** Absolute project start day (always 1 in the current model, kept for future). */
  projectStart: number;
  /** Project finish day — max EF across all tasks. */
  projectFinish: number;
  /** Tasks on the critical path, in topological order. */
  criticalPath: string[];
  /** Any DAG cycles, resource conflicts, or unreachable nodes detected. */
  conflicts: CpmConflict[];
  /**
   * Leveled startDays (only present when leveling ran). Callers apply these
   * back onto tasks if they want the engine to own scheduling. We return them
   * separately so the UI can preview / diff before committing.
   */
  leveledStartDays?: Map<string, number>;
}

export interface RunCpmOptions {
  /**
   * When true, delays tasks that share a crew and overlap with tasks that
   * have less float. Default false — leveling changes startDays, so it should
   * be opt-in (the grid view doesn't want it auto-running on every keystroke).
   */
  levelResources?: boolean;
  /**
   * If set, forces the project finish used for the backward pass. Otherwise
   * uses the max EF from the forward pass. Useful when the user has committed
   * to a contract end date and wants to see negative float on tasks that will
   * blow it.
   */
  targetFinishDay?: number;
}

// ---------------------------------------------------------------------------
// Dependency helpers (tolerant of the legacy `dependencies: string[]` shape)
// ---------------------------------------------------------------------------

/**
 * Normalize a task's dependency declarations. Supports the modern
 * `dependencyLinks` array (FS/SS/FF/SF + lag) and falls back to the legacy
 * `dependencies: string[]` which implies FS + 0 lag.
 */
function getLinks(task: ScheduleTask): DependencyLink[] {
  if (task.dependencyLinks && task.dependencyLinks.length > 0) {
    return task.dependencyLinks;
  }
  return (task.dependencies ?? []).map(id => ({
    taskId: id,
    type: 'FS' as const,
    lagDays: 0,
  }));
}

// ---------------------------------------------------------------------------
// Step 1: DAG validation
// ---------------------------------------------------------------------------
//
// Uses DFS with a 3-color marker (white/gray/black) so we can both detect a
// cycle and return the cycle nodes (handy for the UI to highlight). A gray
// node found during DFS means we're revisiting an ancestor → cycle.

export function detectCycles(tasks: ScheduleTask[]): CpmConflict[] {
  const idSet = new Set(tasks.map(t => t.id));
  const color = new Map<string, 'white' | 'gray' | 'black'>();
  tasks.forEach(t => color.set(t.id, 'white'));

  const conflicts: CpmConflict[] = [];
  const parent = new Map<string, string | null>();

  const visit = (id: string): string[] | null => {
    color.set(id, 'gray');
    const task = tasks.find(t => t.id === id);
    if (!task) return null;

    for (const link of getLinks(task)) {
      // Silently skip dangling dep refs — the UI should flag those separately.
      if (!idSet.has(link.taskId)) continue;

      const c = color.get(link.taskId);
      if (c === 'gray') {
        // Found cycle. Walk parents back from `id` to `link.taskId` to
        // reconstruct the cycle path.
        const cycle: string[] = [link.taskId, id];
        let cur: string | null | undefined = parent.get(id);
        while (cur && cur !== link.taskId) {
          cycle.splice(1, 0, cur);
          cur = parent.get(cur);
        }
        return cycle;
      }
      if (c === 'white') {
        parent.set(link.taskId, id);
        const found = visit(link.taskId);
        if (found) return found;
      }
    }

    color.set(id, 'black');
    return null;
  };

  for (const t of tasks) {
    if (color.get(t.id) === 'white') {
      const cycle = visit(t.id);
      if (cycle) {
        conflicts.push({
          kind: 'cycle',
          message: `Dependency cycle detected through ${cycle.length} task(s). Remove one of the links to continue.`,
          taskIds: cycle,
          detail: { cycle },
        });
        // Don't keep hunting — the caller should fix one cycle at a time so
        // we're not spamming them with the same problem recolored.
        break;
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Step 2: Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

function topoSort(tasks: ScheduleTask[]): ScheduleTask[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const indegree = new Map<string, number>();
  const succList = new Map<string, string[]>();

  tasks.forEach(t => {
    indegree.set(t.id, 0);
    succList.set(t.id, []);
  });

  tasks.forEach(t => {
    for (const link of getLinks(t)) {
      if (!byId.has(link.taskId)) continue;
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      succList.get(link.taskId)!.push(t.id);
    }
  });

  const queue: string[] = [];
  indegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const out: ScheduleTask[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    for (const s of succList.get(id) ?? []) {
      const nd = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, nd);
      if (nd === 0) queue.push(s);
    }
  }

  // If the graph has a cycle, out.length < tasks.length. We still return the
  // partial order — callers have already run detectCycles() and shown a
  // warning; the CPM math below will just skip unresolved tasks.
  return out;
}

// ---------------------------------------------------------------------------
// Step 3: Forward pass (ES, EF)
// ---------------------------------------------------------------------------
//
// We respect each task's own `startDay` as a MINIMUM constraint — the user
// may have pinned a task to start no earlier than a specific day (e.g. "crew
// arrives Monday"). The computed ES is max(dependency-required-start, pinned
// start, 1).

function forwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
): Map<string, { es: number; ef: number }> {
  const map = new Map<string, { es: number; ef: number }>();
  const byId = new Map(all.map(t => [t.id, t]));

  for (const task of ordered) {
    const links = getLinks(task);
    const pins = Math.max(1, task.startDay || 1);

    let es = pins;
    for (const link of links) {
      const dep = byId.get(link.taskId);
      if (!dep) continue;
      const depCpm = map.get(dep.id);
      if (!depCpm) continue;

      const lag = link.lagDays || 0;
      const type = (link.type || 'FS') as DepType;

      let required = es;
      switch (type) {
        case 'FS': required = depCpm.ef + lag + 1; break;
        case 'SS': required = depCpm.es + lag; break;
        case 'FF': required = depCpm.ef + lag - task.durationDays + 1; break;
        case 'SF': required = depCpm.es + lag - task.durationDays + 1; break;
      }
      if (required > es) es = required;
    }

    const dur = Math.max(0, task.durationDays || 0);
    const ef = dur === 0 ? es : es + dur - 1; // milestone: duration 0, ES=EF
    map.set(task.id, { es, ef });
  }

  return map;
}

// ---------------------------------------------------------------------------
// Step 4: Backward pass (LS, LF)
// ---------------------------------------------------------------------------
//
// For each task walking reverse-topological order: LF = min over successors
// of the constraint imposed by each link type + lag. Tasks with no successors
// (schedule leaves) have LF = projectFinish.

function backwardPass(
  ordered: ScheduleTask[],
  all: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
  projectFinish: number,
): Map<string, { ls: number; lf: number }> {
  const byId = new Map(all.map(t => [t.id, t]));
  const result = new Map<string, { ls: number; lf: number }>();

  // Pre-compute successor list keyed by predecessor id.
  const successors = new Map<string, Array<{ succ: ScheduleTask; link: DependencyLink }>>();
  all.forEach(t => successors.set(t.id, []));
  all.forEach(t => {
    for (const link of getLinks(t)) {
      if (byId.has(link.taskId)) {
        successors.get(link.taskId)!.push({ succ: t, link });
      }
    }
  });

  // Walk the topo order in reverse.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const task = ordered[i];
    const fwd = forward.get(task.id);
    if (!fwd) continue;

    const dur = Math.max(0, task.durationDays || 0);
    const succs = successors.get(task.id) ?? [];

    // Default: no successors → LF is project finish.
    let lf = projectFinish;

    for (const { succ, link } of succs) {
      const succLate = result.get(succ.id);
      if (!succLate) continue;

      const lag = link.lagDays || 0;
      const type = (link.type || 'FS') as DepType;

      let thisLf = lf;
      switch (type) {
        // FS: succ.LS ≥ this.LF + lag + 1  → this.LF ≤ succ.LS − lag − 1
        case 'FS': thisLf = succLate.ls - lag - 1; break;
        // SS: succ.LS ≥ this.LS + lag      → this.LS ≤ succ.LS − lag
        //                                   this.LF = this.LS + dur − 1
        case 'SS': thisLf = (succLate.ls - lag) + Math.max(0, dur - 1); break;
        // FF: succ.LF ≥ this.LF + lag      → this.LF ≤ succ.LF − lag
        case 'FF': thisLf = succLate.lf - lag; break;
        // SF: succ.LF ≥ this.LS + lag      → this.LS ≤ succ.LF − lag
        case 'SF': thisLf = (succLate.lf - lag) + Math.max(0, dur - 1); break;
      }
      if (thisLf < lf) lf = thisLf;
    }

    const ls = dur === 0 ? lf : lf - dur + 1;
    result.set(task.id, { ls, lf });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 5: Free float
// ---------------------------------------------------------------------------
//
// Free float = how much this task can slip WITHOUT delaying ANY successor's
// early start. Computed only for FS links in this first pass — the other
// link types have messier "earliest successor impact" semantics and the
// pragmatic MS Project convention is to only surface TF for those.

function computeFreeFloat(
  tasks: ScheduleTask[],
  forward: Map<string, { es: number; ef: number }>,
): Map<string, number> {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const successors = new Map<string, Array<{ succ: ScheduleTask; link: DependencyLink }>>();
  tasks.forEach(t => successors.set(t.id, []));
  tasks.forEach(t => {
    for (const link of getLinks(t)) {
      if (byId.has(link.taskId)) {
        successors.get(link.taskId)!.push({ succ: t, link });
      }
    }
  });

  const ff = new Map<string, number>();
  for (const task of tasks) {
    const fwd = forward.get(task.id);
    if (!fwd) { ff.set(task.id, 0); continue; }

    const succs = successors.get(task.id) ?? [];
    if (succs.length === 0) {
      // Leaf tasks — free float conventionally equals total float, but we set
      // it to 0 here and let the caller use TF if they need it for leaves.
      ff.set(task.id, 0);
      continue;
    }

    let minSucc = Infinity;
    for (const { succ, link } of succs) {
      const succFwd = forward.get(succ.id);
      if (!succFwd) continue;
      if ((link.type ?? 'FS') !== 'FS') continue;
      const lag = link.lagDays || 0;
      // succ.ES − lag − 1 is the latest this task can finish; − EF is slack.
      const slack = succFwd.es - lag - 1 - fwd.ef;
      if (slack < minSucc) minSucc = slack;
    }
    ff.set(task.id, minSucc === Infinity ? 0 : Math.max(0, minSucc));
  }
  return ff;
}

// ---------------------------------------------------------------------------
// Step 6: Resource leveling
// ---------------------------------------------------------------------------
//
// Simple single-resource-per-task leveling. Groups tasks by `assignedSubId`
// (falls back to `crew` string) and checks pairwise for calendar overlap.
// Where two tasks overlap, delays the one with MORE float. If neither has
// float, we report a `resource_delayed_project` conflict and push the
// less-critical one (tie-break by shorter duration first, then task id).
//
// Returns new startDays + any conflicts. Caller decides whether to commit.

interface LevelingContext {
  tasks: ScheduleTask[];
  cpm: Map<string, CpmTaskResult>;
}

function resourceKey(t: ScheduleTask): string | null {
  if (t.assignedSubId) return `sub:${t.assignedSubId}`;
  if (t.crew && t.crew.trim()) return `crew:${t.crew.trim().toLowerCase()}`;
  return null;
}

function levelResources(ctx: LevelingContext): { leveled: Map<string, number>; conflicts: CpmConflict[] } {
  const leveled = new Map<string, number>();
  ctx.tasks.forEach(t => leveled.set(t.id, t.startDay));
  const conflicts: CpmConflict[] = [];

  // Group by resource.
  const byResource = new Map<string, ScheduleTask[]>();
  for (const t of ctx.tasks) {
    const key = resourceKey(t);
    if (!key) continue;
    if (!byResource.has(key)) byResource.set(key, []);
    byResource.get(key)!.push(t);
  }

  for (const [resKey, group] of byResource.entries()) {
    if (group.length < 2) continue;

    // Sort by current ES so we process calendar-left-to-right.
    const sorted = [...group].sort((a, b) => {
      const ae = ctx.cpm.get(a.id)?.es ?? a.startDay;
      const be = ctx.cpm.get(b.id)?.es ?? b.startDay;
      return ae - be;
    });

    // Sliding "busy until" cursor. When the next task would overlap, delay it.
    let busyUntil = -Infinity;
    let busyTaskId: string | null = null;

    for (const task of sorted) {
      const start = leveled.get(task.id) ?? task.startDay;
      const end = start + Math.max(0, (task.durationDays || 0) - 1);

      if (start <= busyUntil) {
        // Conflict. Decide whether to delay THIS task or the already-scheduled
        // one, based on which has more float. More float → can afford delay.
        const prev = ctx.cpm.get(busyTaskId!);
        const cur = ctx.cpm.get(task.id);
        const prevFloat = prev?.totalFloat ?? 0;
        const curFloat = cur?.totalFloat ?? 0;

        const delayThis = curFloat >= prevFloat;
        const delayedId = delayThis ? task.id : busyTaskId!;
        const newStart = busyUntil + 1;
        const delayedTask = delayThis ? task : ctx.tasks.find(x => x.id === busyTaskId!);

        if (delayedTask) {
          const origStart = leveled.get(delayedTask.id) ?? delayedTask.startDay;
          leveled.set(delayedTask.id, newStart);
          const delayedFloat = delayThis ? curFloat : prevFloat;
          const projectImpact = delayedFloat <= 0;

          conflicts.push({
            kind: projectImpact ? 'resource_delayed_project' : 'resource_overallocation',
            message: projectImpact
              ? `${delayedTask.title}: resource conflict with no float — delaying pushes the project end date by ${newStart - origStart} day(s).`
              : `${delayedTask.title}: delayed ${newStart - origStart} day(s) to free up "${delayedTask.crew || delayedTask.assignedSubName || 'resource'}".`,
            taskIds: [delayedId, delayThis ? busyTaskId! : task.id],
            detail: {
              resource: resKey,
              originalStart: origStart,
              newStart,
              floatConsumed: delayedFloat,
            },
          });

          // Update busy cursor based on which ended up last.
          const newEnd = newStart + Math.max(0, (delayedTask.durationDays || 0) - 1);
          if (newEnd > busyUntil) {
            busyUntil = newEnd;
            busyTaskId = delayedTask.id;
          }
          // If we delayed `prev`, `task` now owns the earlier slot.
          if (!delayThis) {
            busyUntil = end;
            busyTaskId = task.id;
          }
          continue;
        }
      }

      // No conflict, or we couldn't resolve it — this task takes the slot.
      if (end > busyUntil) {
        busyUntil = end;
        busyTaskId = task.id;
      }
    }
  }

  return { leveled, conflicts };
}

// ---------------------------------------------------------------------------
// One-call orchestration
// ---------------------------------------------------------------------------

export function runCpm(tasks: ScheduleTask[], options: RunCpmOptions = {}): CpmResult {
  const conflicts: CpmConflict[] = [];

  // 1. Cycle detection — bail early if found.
  const cycleConflicts = detectCycles(tasks);
  if (cycleConflicts.length > 0) {
    // Still return empty CPM so the UI can render the tasks; just flag it.
    return {
      perTask: new Map(),
      projectStart: 1,
      projectFinish: 1,
      criticalPath: [],
      conflicts: cycleConflicts,
    };
  }

  // 2. Topo sort.
  const ordered = topoSort(tasks);

  // 3. Forward pass.
  const forward = forwardPass(ordered, tasks);

  // 4. Project finish = max EF, unless caller pinned a target.
  let projectFinish = 1;
  forward.forEach(v => { if (v.ef > projectFinish) projectFinish = v.ef; });
  if (options.targetFinishDay && options.targetFinishDay > 0) {
    projectFinish = options.targetFinishDay;
  }

  // 5. Backward pass.
  const backward = backwardPass(ordered, tasks, forward, projectFinish);

  // 6. Free float.
  const freeFloat = computeFreeFloat(tasks, forward);

  // 7. Assemble per-task results.
  const perTask = new Map<string, CpmTaskResult>();
  for (const task of tasks) {
    const fwd = forward.get(task.id);
    const bwd = backward.get(task.id);
    if (!fwd || !bwd) continue;
    const tf = bwd.ls - fwd.es;
    perTask.set(task.id, {
      id: task.id,
      es: fwd.es,
      ef: fwd.ef,
      ls: bwd.ls,
      lf: bwd.lf,
      totalFloat: tf,
      freeFloat: freeFloat.get(task.id) ?? 0,
      isCritical: tf <= 0,
    });
  }

  // 8. Critical path in topo order.
  const criticalPath = ordered
    .map(t => perTask.get(t.id))
    .filter((r): r is CpmTaskResult => !!r && r.isCritical)
    .map(r => r.id);

  // 9. Optional resource leveling.
  let leveledStartDays: Map<string, number> | undefined;
  if (options.levelResources) {
    const { leveled, conflicts: resConflicts } = levelResources({ tasks, cpm: perTask });
    leveledStartDays = leveled;
    conflicts.push(...resConflicts);
  }

  return {
    perTask,
    projectStart: 1,
    projectFinish,
    criticalPath,
    conflicts,
    leveledStartDays,
  };
}

// ---------------------------------------------------------------------------
// Helpers for the UI layer
// ---------------------------------------------------------------------------

/**
 * Annotates the tasks with their CPM results (isCriticalPath + optional
 * baseline-style fields). Non-destructive — returns a new array. The UI uses
 * this to render the critical-path highlight without threading CpmResult
 * through every component.
 */
export function applyCpmToTasks(tasks: ScheduleTask[], cpm: CpmResult): ScheduleTask[] {
  return tasks.map(t => {
    const r = cpm.perTask.get(t.id);
    if (!r) return t;
    return { ...t, isCriticalPath: r.isCritical };
  });
}

/**
 * Human-readable float summary for the grid's Float column.
 *   0       → "Critical"
 *   n > 0   → "3d slack"
 *   n < 0   → "-2d behind"
 */
export function formatFloat(totalFloat: number): string {
  if (totalFloat === 0) return 'Critical';
  if (totalFloat < 0) return `${totalFloat}d behind`;
  return `${totalFloat}d slack`;
}

/**
 * Returns true iff `candidateDepId` being added as a predecessor to `taskId`
 * would create a cycle. The grid's dependency editor uses this to reject bad
 * links before committing — MS Project's #1 gap (per your spec: "intuitive UI
 * that prevents fatal logic errors").
 */
export function wouldCreateCycle(
  tasks: ScheduleTask[],
  taskId: string,
  candidateDepId: string,
): boolean {
  if (taskId === candidateDepId) return true;

  // DFS from candidateDepId chasing its own predecessors. If we reach taskId,
  // adding this edge closes a loop.
  const byId = new Map(tasks.map(t => [t.id, t]));
  const seen = new Set<string>();
  const stack = [candidateDepId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const task = byId.get(cur);
    if (!task) continue;
    for (const link of getLinks(task)) stack.push(link.taskId);
  }
  return false;
}

```


---

### `utils/scheduleAI.ts`

```ts
// scheduleAI.ts — AI-powered helpers for the Pro scheduler.
//
// The idea: treat the schedule like structured data the AI can reason about.
// We serialize a compact view (no crew sizes, no notes, no internal ids) and
// let Gemini riff on it. Each function returns a typed result + a
// human-readable summary so the UI can show cards without parsing strings.
//
// All calls go through the existing `mageAI` helper (Supabase edge function
// → Gemini) so we inherit caching, rate limiting, and error handling.
//
// Non-goals: perfect answers. AI output is SUGGESTIONS. The user always
// commits the change — we never mutate the schedule for them.

import { mageAI } from '@/utils/mageAI';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';
import { createId } from '@/utils/scheduleEngine';

// ---------------------------------------------------------------------------
// Serializer — turns the schedule into a string Gemini can read cheaply.
// ---------------------------------------------------------------------------
function serializeSchedule(tasks: ScheduleTask[], cpm: CpmResult): string {
  const lines: string[] = [];
  // Map internal ids to human-readable aliases so the AI can cite them.
  const aliasById = new Map<string, string>();
  tasks.forEach((t, i) => aliasById.set(t.id, `T${i + 1}`));

  lines.push(`Project finish: day ${cpm.projectFinish}`);
  lines.push(`Total tasks: ${tasks.length}`);
  lines.push(`Critical path: ${cpm.criticalPath.map(id => aliasById.get(id)).join(' → ')}`);
  lines.push('');
  lines.push('Tasks (alias | name | start | duration | crew | deps | status | progress):');

  for (const t of tasks) {
    const alias = aliasById.get(t.id)!;
    const deps = t.dependencies.map(d => aliasById.get(d) ?? '?').join(',');
    const cpmRow = cpm.perTask.get(t.id);
    const float = cpmRow ? ` float=${cpmRow.totalFloat}` : '';
    const actual = t.actualStartDay != null
      ? ` actualStart=${t.actualStartDay}${t.actualEndDay ? ` actualEnd=${t.actualEndDay}` : ''}`
      : '';
    lines.push(`${alias} | ${t.title} | start=${t.startDay} | dur=${t.durationDays}d | ${t.crew || '-'} | deps=[${deps}] | ${t.status} | ${t.progress}%${float}${actual}`);
  }
  return lines.join('\n');
}

// Reverse-lookup: alias → task id. We'll use this to map AI replies back to
// concrete tasks the UI can act on.
function buildAliasMap(tasks: ScheduleTask[]): { byAlias: Map<string, string>; byId: Map<string, string> } {
  const byAlias = new Map<string, string>();
  const byId = new Map<string, string>();
  tasks.forEach((t, i) => {
    const alias = `T${i + 1}`;
    byAlias.set(alias, t.id);
    byId.set(t.id, alias);
  });
  return { byAlias, byId };
}

// ---------------------------------------------------------------------------
// 1) Risk detector
// ---------------------------------------------------------------------------
// Scans the schedule for real-world PM issues: wrong sequencing, missing
// inspections, no buffer, over-leveraged critical path, stacked weather-
// sensitive tasks, etc. Returns a list of findings the user can accept.

export interface AIRiskFinding {
  id: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  affectedTaskIds: string[];  // resolved from aliases
  suggestion?: string;
}

export interface AIRiskResult {
  findings: AIRiskFinding[];
  summary: string;
  cached?: boolean;
}

export async function aiDetectRisks(tasks: ScheduleTask[], cpm: CpmResult): Promise<AIRiskResult> {
  const { byAlias } = buildAliasMap(tasks);
  const serialized = serializeSchedule(tasks, cpm);
  const schemaHint = {
    summary: 'one-line overall health read',
    findings: [
      {
        severity: 'low|medium|high',
        title: 'short headline',
        detail: 'why this matters in 1-2 sentences',
        affectedAliases: ['T1', 'T5'],
        suggestion: 'concrete fix',
      },
    ],
  };
  const prompt = `You are a construction project manager reviewing a schedule for risks.
Identify real issues in PLAIN CONSTRUCTION TERMS. Focus on: wrong task order,
missing inspections before cover-up, no weather buffer on exterior tasks, too
many critical tasks (fragile plan), subs double-booked, rough-ins not in
correct sequence. Do not list generic advice — cite specific task aliases.

Schedule:
${serialized}

Return up to 6 findings, most important first.`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 1200,
    cacheKey: `risks-${tasks.length}-${cpm.projectFinish}-${cpm.criticalPath.length}`,
    cacheHours: 1,
  });

  if (!res.success || !res.data) {
    return { findings: [], summary: 'AI risk check failed. Try again.', cached: res.cached };
  }

  const raw = res.data as { summary?: string; findings?: Array<{
    severity?: string;
    title?: string;
    detail?: string;
    affectedAliases?: string[];
    suggestion?: string;
  }> };

  const findings: AIRiskFinding[] = (raw.findings ?? []).map((f, i) => ({
    id: createId('risk'),
    severity: (f.severity === 'high' || f.severity === 'medium' || f.severity === 'low')
      ? f.severity
      : 'medium',
    title: f.title || `Finding ${i + 1}`,
    detail: f.detail || '',
    affectedTaskIds: (f.affectedAliases ?? [])
      .map(a => byAlias.get(a))
      .filter((x): x is string => !!x),
    suggestion: f.suggestion,
  }));

  return {
    summary: raw.summary || (findings.length > 0 ? `${findings.length} issues found` : 'Schedule looks clean.'),
    findings,
    cached: res.cached,
  };
}

// ---------------------------------------------------------------------------
// 2) Optimizer — identify compression opportunities
// ---------------------------------------------------------------------------

export interface AIOptimizationIdea {
  id: string;
  title: string;
  detail: string;
  expectedDaysSaved: number;
  affectedTaskIds: string[];
  action: 'parallelize' | 'overlap' | 'resource' | 'split' | 'other';
}

export async function aiOptimizeSchedule(tasks: ScheduleTask[], cpm: CpmResult): Promise<{
  ideas: AIOptimizationIdea[];
  summary: string;
  cached?: boolean;
}> {
  const { byAlias } = buildAliasMap(tasks);
  const serialized = serializeSchedule(tasks, cpm);

  const schemaHint = {
    summary: 'one-line takeaway',
    ideas: [
      {
        title: 'short actionable headline',
        detail: 'explain the how in 1-2 sentences',
        expectedDaysSaved: 3,
        action: 'parallelize|overlap|resource|split|other',
        affectedAliases: ['T3', 'T4'],
      },
    ],
  };

  const prompt = `You are a construction scheduler. Suggest ways to finish the
project earlier WITHOUT extra cost. Focus on: tasks that can run in parallel
but are sequenced, FS links that could be SS+lag, critical-path tasks that
could be split across two crews, padding that could be removed.

Schedule:
${serialized}

Return up to 5 ideas, highest impact first. Be specific — cite aliases.`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 1200,
    cacheKey: `opt-${tasks.length}-${cpm.projectFinish}-${cpm.criticalPath.length}`,
    cacheHours: 1,
  });

  if (!res.success || !res.data) {
    return { ideas: [], summary: 'AI optimizer failed.', cached: res.cached };
  }

  const raw = res.data as { summary?: string; ideas?: Array<{
    title?: string;
    detail?: string;
    expectedDaysSaved?: number;
    action?: string;
    affectedAliases?: string[];
  }> };

  const ideas: AIOptimizationIdea[] = (raw.ideas ?? []).map(i => ({
    id: createId('opt'),
    title: i.title || 'Idea',
    detail: i.detail || '',
    expectedDaysSaved: Number(i.expectedDaysSaved) || 0,
    action: (['parallelize', 'overlap', 'resource', 'split'].includes(String(i.action))
      ? i.action
      : 'other') as AIOptimizationIdea['action'],
    affectedTaskIds: (i.affectedAliases ?? [])
      .map(a => byAlias.get(a))
      .filter((x): x is string => !!x),
  }));

  return {
    summary: raw.summary || `${ideas.length} ideas`,
    ideas,
    cached: res.cached,
  };
}

// ---------------------------------------------------------------------------
// 3) Critical path explainer
// ---------------------------------------------------------------------------

export async function aiExplainCriticalPath(tasks: ScheduleTask[], cpm: CpmResult): Promise<{
  explanation: string;
  cached?: boolean;
}> {
  const { byAlias, byId } = buildAliasMap(tasks);
  const critical = cpm.criticalPath.map(id => {
    const t = tasks.find(x => x.id === id);
    const alias = byId.get(id);
    return t && alias ? `${alias} (${t.title}, ${t.durationDays}d)` : alias;
  }).filter(Boolean).join(' → ');

  const prompt = `Explain why this is the critical path, in plain English, for
a construction site foreman who is not a scheduling expert. Be concrete about
what a delay on each step would cost. Keep it under 150 words.

Critical path: ${critical}
Project finish: day ${cpm.projectFinish}`;

  const res = await mageAI({
    prompt,
    tier: 'fast',
    maxTokens: 400,
    cacheKey: `explain-cp-${cpm.criticalPath.join('-')}-${cpm.projectFinish}`,
    cacheHours: 6,
  });

  if (!res.success) {
    return { explanation: 'AI explainer unavailable right now.', cached: res.cached };
  }
  // This path doesn't use JSON mode — we want narrative prose.
  const text = typeof res.data === 'string' ? res.data : (res.raw ?? '');
  return { explanation: text.trim(), cached: res.cached };
}

// ---------------------------------------------------------------------------
// 4) Delay impact analyzer
// ---------------------------------------------------------------------------

export async function aiDelayImpact(
  tasks: ScheduleTask[],
  cpm: CpmResult,
  taskId: string,
  daysDelay: number,
): Promise<{ explanation: string; projectFinishDelta: number; cached?: boolean }> {
  const t = tasks.find(x => x.id === taskId);
  const row = cpm.perTask.get(taskId);
  if (!t || !row) return { explanation: 'Task not found', projectFinishDelta: 0 };

  // If delay ≤ totalFloat, no impact on project finish. Otherwise finish slips
  // by (delay - float).
  const hardDelay = Math.max(0, daysDelay - Math.max(0, row.totalFloat));

  const serialized = serializeSchedule(tasks, cpm);
  const prompt = `A delay of ${daysDelay} day(s) on "${t.title}" is being considered.
This task has ${row.totalFloat} day(s) of float, so the project finish would slip
by ${hardDelay} day(s). Given the full schedule below, explain in PLAIN ENGLISH
what other tasks get pushed, what the business impact is, and any mitigation
the PM should consider. Under 120 words.

Schedule:
${serialized}`;

  const res = await mageAI({
    prompt,
    tier: 'smart',
    maxTokens: 400,
    cacheKey: `delay-${taskId}-${daysDelay}-${cpm.projectFinish}`,
    cacheHours: 2,
  });

  const text = typeof res.data === 'string' ? res.data : (res.raw ?? 'Analysis unavailable.');
  return { explanation: text.trim(), projectFinishDelta: hardDelay, cached: res.cached };
}

// ---------------------------------------------------------------------------
// 5) Conversational Q&A — "when does drywall start?" / "who's on day 40?"
// ---------------------------------------------------------------------------

export async function aiAskSchedule(
  tasks: ScheduleTask[],
  cpm: CpmResult,
  question: string,
  projectStartDate: Date,
): Promise<{ answer: string; cached?: boolean }> {
  const serialized = serializeSchedule(tasks, cpm);
  const startStr = projectStartDate.toISOString().slice(0, 10);
  const prompt = `Answer the user's question using ONLY the schedule data below.
Be concrete — cite task names, day numbers, and actual calendar dates (project
starts ${startStr}, day N = ${startStr} + (N-1) days). If the answer isn't
derivable from the data, say so clearly. Keep answers under 120 words.

Schedule:
${serialized}

Question: ${question}`;

  const res = await mageAI({
    prompt,
    tier: 'smart',
    maxTokens: 500,
    // No cache — conversational answers shouldn't be reused
  });

  const text = typeof res.data === 'string' ? res.data : (res.raw ?? 'No answer.');
  return { answer: text.trim() };
}

// ---------------------------------------------------------------------------
// 6) Voice/text as-built logging — "we finished the foundation today"
// ---------------------------------------------------------------------------

export interface AIAsBuiltPatch {
  taskId: string;
  taskTitle: string;
  patch: Partial<ScheduleTask>;
  rationale: string;
}

export async function aiLogAsBuilt(
  tasks: ScheduleTask[],
  transcript: string,
  todayDayNumber: number,
): Promise<{ patches: AIAsBuiltPatch[]; summary: string; cached?: boolean }> {
  const { byAlias, byId } = buildAliasMap(tasks);
  const simplified = tasks.map((t, i) => `T${i + 1}: ${t.title} (${t.status}, ${t.progress}% done)`).join('\n');

  const schemaHint = {
    summary: 'what the user logged, in one line',
    updates: [
      {
        alias: 'T3',
        progressPercent: 100,
        markDone: true,
        actualStartToday: false,
        actualEndToday: true,
        rationale: 'user said foundation is finished',
      },
    ],
  };

  const prompt = `The PM said: "${transcript}"
Today is day ${todayDayNumber} of the project.
Parse this into concrete per-task updates. Do NOT invent tasks — only pick from
the list below. If unclear, leave "updates" empty.

Tasks:
${simplified}`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'fast',
    maxTokens: 600,
  });

  if (!res.success || !res.data) {
    return { patches: [], summary: 'Could not parse that.' };
  }

  const raw = res.data as { summary?: string; updates?: Array<{
    alias?: string;
    progressPercent?: number;
    markDone?: boolean;
    actualStartToday?: boolean;
    actualEndToday?: boolean;
    rationale?: string;
  }> };

  const patches: AIAsBuiltPatch[] = [];
  for (const u of raw.updates ?? []) {
    const id = u.alias ? byAlias.get(u.alias) : undefined;
    if (!id) continue;
    const t = tasks.find(x => x.id === id);
    if (!t) continue;
    const patch: Partial<ScheduleTask> = {};
    if (typeof u.progressPercent === 'number') patch.progress = Math.max(0, Math.min(100, u.progressPercent));
    if (u.markDone) { patch.status = 'done'; patch.progress = 100; }
    if (u.actualStartToday) patch.actualStartDay = todayDayNumber;
    if (u.actualEndToday) {
      patch.actualEndDay = todayDayNumber;
      patch.status = 'done';
      patch.progress = 100;
      if (!t.actualStartDay) patch.actualStartDay = t.startDay;
    }
    patches.push({ taskId: id, taskTitle: t.title, patch, rationale: u.rationale || '' });
  }
  return { patches, summary: raw.summary || `${patches.length} update(s) parsed`, cached: res.cached };
}

// ---------------------------------------------------------------------------
// 7) Schedule generator — free-text → full schedule (for empty projects)
// ---------------------------------------------------------------------------

export interface AIGeneratedTask {
  alias: string;
  title: string;
  phase: string;
  durationDays: number;
  deps: string[];
  crew?: string;
  isMilestone?: boolean;
}

export async function aiGenerateSchedule(description: string): Promise<{
  tasks: AIGeneratedTask[];
  summary: string;
  cached?: boolean;
}> {
  const schemaHint = {
    summary: 'one-line summary of the generated schedule',
    tasks: [
      {
        alias: 'T1',
        title: 'clear site',
        phase: 'Site',
        durationDays: 2,
        crew: 'Excavation',
        deps: [],
        isMilestone: false,
      },
    ],
  };

  const prompt = `Generate a realistic construction schedule from this description.
Break the project into 20-40 specific tasks with appropriate durations,
standard construction phases (Site, Foundation, Framing, MEP, Drywall,
Finishes, Inspections, Landscaping, Closeout), real crews, and correct
dependency ordering. Include inspection milestones at cover-up points.
Use T1, T2, T3… aliases. FS-only dependencies for simplicity.

Project description:
${description}`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 3000,
    cacheKey: `gen-${description.slice(0, 80)}`,
    cacheHours: 24,
  });

  if (!res.success || !res.data) {
    return { tasks: [], summary: 'Generator failed.' };
  }
  const raw = res.data as { summary?: string; tasks?: AIGeneratedTask[] };
  const tasks = (raw.tasks ?? []).map(t => ({
    alias: t.alias || '',
    title: t.title || 'Task',
    phase: t.phase || 'General',
    durationDays: Math.max(0, Number(t.durationDays) || 1),
    deps: Array.isArray(t.deps) ? t.deps : [],
    crew: t.crew,
    isMilestone: t.isMilestone || t.durationDays === 0,
  }));
  return { tasks, summary: raw.summary || `Generated ${tasks.length} tasks`, cached: res.cached };
}

// Convert generator output → real ScheduleTask[] with computed startDays.
export function materializeGeneratedTasks(generated: AIGeneratedTask[]): ScheduleTask[] {
  const idByAlias = new Map<string, string>();
  for (const g of generated) idByAlias.set(g.alias, createId('task'));
  const endDayByAlias = new Map<string, number>();
  const startByAlias = new Map<string, number>();

  for (const g of generated) {
    let earliest = 1;
    for (const depAlias of g.deps) {
      const end = endDayByAlias.get(depAlias);
      if (end != null) earliest = Math.max(earliest, end + 1);
    }
    startByAlias.set(g.alias, earliest);
    endDayByAlias.set(g.alias, g.durationDays === 0 ? earliest : earliest + g.durationDays - 1);
  }

  return generated.map(g => {
    const id = idByAlias.get(g.alias)!;
    const startDay = startByAlias.get(g.alias)!;
    const endDay = endDayByAlias.get(g.alias)!;
    const dependencies = g.deps.map(a => idByAlias.get(a)).filter((x): x is string => !!x);
    const task: ScheduleTask = {
      id,
      title: g.title,
      phase: g.phase,
      durationDays: g.durationDays,
      startDay,
      progress: 0,
      crew: g.crew ?? '',
      dependencies,
      notes: '',
      status: 'not_started',
      isMilestone: g.isMilestone || g.durationDays === 0,
      baselineStartDay: startDay,
      baselineEndDay: endDay,
    };
    return task;
  });
}

// ---------------------------------------------------------------------------
// 8) Bulk edit — natural language instruction against a selected subset
// ---------------------------------------------------------------------------
// The user highlights a handful of rows in the grid, types a command like
// "compress each of these by 20%" or "move all of these out by a week, and
// change their crew to Finish Carp". The model returns typed Partial<Task>
// patches for just those tasks. We never let it touch non-selected tasks.

export interface AIBulkPatch {
  taskId: string;
  taskTitle: string;
  patch: Partial<ScheduleTask>;
  rationale: string;
}

export async function aiBulkEdit(
  tasks: ScheduleTask[],
  cpm: CpmResult,
  selectedIds: string[],
  instruction: string,
): Promise<{
  patches: AIBulkPatch[];
  summary: string;
  /** True when the response came from AsyncStorage cache, not the network. */
  fromCache?: boolean;
  /** Populated only on failure or partial-match — 'timeout' | 'network' | etc. */
  errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unknown';
  /** Human-readable detail when errorKind is set (e.g. timeout message). */
  errorDetail?: string;
}> {
  const selSet = new Set(selectedIds);
  const selected = tasks.filter(t => selSet.has(t.id));
  if (selected.length === 0) {
    return { patches: [], summary: 'No tasks selected.' };
  }

  const { byAlias, byId } = buildAliasMap(tasks);
  // Build a focused view of just the selected tasks so the model spends its
  // attention on them. Keep the full alias map so it doesn't hallucinate new
  // ids, and include the full schedule summary so it can reason about
  // downstream effects without proposing changes there.
  const fullContext = serializeSchedule(tasks, cpm);
  const selectedLines = selected.map(t => {
    const alias = byId.get(t.id) ?? t.id;
    return `${alias}: ${t.title} | start=${t.startDay} | dur=${t.durationDays}d | crew=${t.crew || '-'} | phase=${t.phase}`;
  }).join('\n');

  const schemaHint = {
    summary: 'one-line description of what you are doing',
    updates: [
      {
        alias: 'T3',
        durationDays: 4,
        startDay: 12,
        crew: 'Finish Carp',
        phase: 'Finishes',
        progressPercent: 50,
        rationale: 'user asked to compress by 20% and reassign crew',
      },
    ],
  };

  const prompt = `You are editing a construction schedule on behalf of the PM.
ONLY modify these selected tasks (cite them by alias — do not invent new ones):
${selectedLines}

PM instruction: "${instruction}"

Full schedule context (for reasoning, do NOT modify non-selected rows):
${fullContext}

Rules:
- Leave a field unset in your reply if you are not changing it (so the UI
  only shows actual deltas).
- Keep durations >= 0.
- Keep startDay >= 1.
- Never add or remove tasks — only edit the listed ones.
- If the instruction is ambiguous or unsafe, return updates: [] and explain
  in summary.`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 900,
  });

  if (!res.success || !res.data) {
    return {
      patches: [],
      summary: res.error || 'AI could not complete that edit.',
      fromCache: res.fromCache,
      errorKind: res.errorKind,
      errorDetail: res.error,
    };
  }

  const raw = res.data as {
    summary?: string;
    updates?: Array<{
      alias?: string;
      durationDays?: number;
      startDay?: number;
      crew?: string;
      phase?: string;
      progressPercent?: number;
      rationale?: string;
    }>;
  };

  const patches: AIBulkPatch[] = [];
  for (const u of raw.updates ?? []) {
    const id = u.alias ? byAlias.get(u.alias) : undefined;
    if (!id) continue;
    if (!selSet.has(id)) continue; // model tried to edit outside selection — drop
    const t = tasks.find(x => x.id === id);
    if (!t) continue;
    const patch: Partial<ScheduleTask> = {};
    if (typeof u.durationDays === 'number' && u.durationDays >= 0 && u.durationDays !== t.durationDays) {
      patch.durationDays = Math.round(u.durationDays);
    }
    if (typeof u.startDay === 'number' && u.startDay >= 1 && u.startDay !== t.startDay) {
      patch.startDay = Math.round(u.startDay);
    }
    if (typeof u.crew === 'string' && u.crew !== t.crew) patch.crew = u.crew;
    if (typeof u.phase === 'string' && u.phase !== t.phase) patch.phase = u.phase;
    if (typeof u.progressPercent === 'number' && u.progressPercent !== t.progress) {
      patch.progress = Math.max(0, Math.min(100, Math.round(u.progressPercent)));
    }
    if (Object.keys(patch).length === 0) continue;
    patches.push({
      taskId: id,
      taskTitle: t.title,
      patch,
      rationale: u.rationale ?? '',
    });
  }

  return {
    patches,
    summary: raw.summary ?? (patches.length === 0 ? 'No changes proposed.' : `${patches.length} task(s) to update.`),
    fromCache: res.fromCache,
    // Preserve 'validation' kind so UI can show "partial result" banner even on a success
    errorKind: res.errorKind,
    errorDetail: res.error,
  };
}

```


---

### `utils/autoScheduleFromEstimate.ts`

```ts
import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import { createId, buildScheduleFromTasks } from '@/utils/scheduleEngine';
import type { Project, ScheduleTask, ProjectSchedule, DependencyLink, DependencyType, LinkedEstimate } from '@/types';

const SCHEDULE_PHASES = [
  'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
  'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Insulation',
  'Drywall', 'Interior', 'Finishes', 'Landscaping', 'Inspections', 'General',
] as const;

const autoScheduleSchema = z.object({
  tasks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    phase: z.string(),
    duration: z.number(),
    predecessorIds: z.array(z.string()),
    isMilestone: z.boolean(),
    isCriticalPath: z.boolean(),
    crewSize: z.number(),
    wbs: z.string(),
    linkedCategories: z.array(z.string()).optional(),
  })),
});

export interface AutoScheduleResult {
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  linkedItemCount: number;
}

function buildEstimateSummary(estimate: LinkedEstimate): { summary: string; categoryMap: Map<string, string[]> } {
  const byCategory: Record<string, { names: string[]; totalQty: number; totalCost: number; itemIds: string[] }> = {};
  estimate.items.forEach(item => {
    const cat = (item.category || 'general').toLowerCase();
    if (!byCategory[cat]) byCategory[cat] = { names: [], totalQty: 0, totalCost: 0, itemIds: [] };
    byCategory[cat].names.push(item.name);
    byCategory[cat].totalQty += item.quantity || 0;
    byCategory[cat].totalCost += item.lineTotal || 0;
    byCategory[cat].itemIds.push(item.materialId);
  });

  const categoryMap = new Map<string, string[]>();
  const lines: string[] = [];
  Object.entries(byCategory).forEach(([cat, info]) => {
    categoryMap.set(cat, info.itemIds);
    const sample = info.names.slice(0, 3).join(', ');
    lines.push(`- ${cat}: ${info.names.length} items (${sample}${info.names.length > 3 ? '...' : ''}), ~$${Math.round(info.totalCost).toLocaleString()}`);
  });

  return {
    summary: lines.join('\n'),
    categoryMap,
  };
}

export async function generateScheduleFromEstimate(
  project: Project,
  estimate: LinkedEstimate,
): Promise<AutoScheduleResult> {
  if (!estimate || !estimate.items || estimate.items.length === 0) {
    throw new Error('Estimate has no line items to generate a schedule from.');
  }

  const { summary, categoryMap } = buildEstimateSummary(estimate);

  const prompt = `You are a senior construction scheduler. Build a realistic construction schedule for this project based on its estimate line items. Group tasks into logical phases with dependencies.

PROJECT:
Name: ${project.name}
Type: ${project.type}
Square Footage: ${project.squareFootage || 'unspecified'}
Quality Tier: ${project.quality}
Location: ${project.location}

ESTIMATE LINE-ITEM SUMMARY (by material category):
${summary}
Estimate grand total: $${Math.round(estimate.grandTotal).toLocaleString()}

INSTRUCTIONS:
1. Return a JSON object with a "tasks" array.
2. Each task must have: id (string like "t1","t2"), name, phase (one of: ${SCHEDULE_PHASES.join(', ')}), duration (working days, integer), predecessorIds (array of other task ids — FS dependencies), isMilestone (bool), isCriticalPath (bool), crewSize (integer 1-8), wbs (like "1.1","2.3"), linkedCategories (array of estimate category names this task draws from, e.g. ["concrete","lumber"]).
3. Include a "Project Start" milestone (duration 0) and "Project Complete" milestone (duration 0).
4. Generate 15-35 tasks based on scope. Use realistic durations scaled to sqft and grand total.
5. Use category totals to weight durations — heavier categories (concrete/framing/MEP) get more days.
6. Mark tasks on the longest chain as isCriticalPath: true.
7. Link every task to the relevant estimate categories via linkedCategories so we can tie spend to schedule.
8. If the estimate has almost no site-work materials but large finishes, skew the schedule toward interior work.

Output JSON only. No prose.`;

  const aiResult = await mageAI({
    prompt,
    schema: autoScheduleSchema,
    tier: 'smart',
    maxTokens: 2500,
  });

  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI schedule generation failed');
  }

  let parsed: any = aiResult.data;
  if (typeof parsed === 'string') {
    let cleaned = parsed.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    try {
      parsed = JSON.parse(cleaned.trim());
    } catch {
      throw new Error('AI returned invalid JSON');
    }
  }

  const taskArray: any[] = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? []);
  if (!taskArray || taskArray.length === 0) {
    throw new Error('AI returned no tasks');
  }

  // Normalize
  const safeTasks = taskArray.map((t: any, idx: number) => ({
    id: t.id || `t${idx + 1}`,
    name: t.name || t.title || `Task ${idx + 1}`,
    phase: SCHEDULE_PHASES.includes(t.phase) ? t.phase : 'General',
    duration: typeof t.duration === 'number' ? t.duration : 3,
    predecessorIds: Array.isArray(t.predecessorIds) ? t.predecessorIds : [],
    isMilestone: !!t.isMilestone,
    isCriticalPath: !!t.isCriticalPath,
    crewSize: typeof t.crewSize === 'number' ? Math.min(8, Math.max(1, Math.round(t.crewSize))) : 2,
    wbs: t.wbs || `${idx + 1}.0`,
    linkedCategories: Array.isArray(t.linkedCategories) ? t.linkedCategories.map((c: any) => String(c).toLowerCase()) : [],
  }));

  // Build real ScheduleTask objects
  const tasks: ScheduleTask[] = safeTasks.map((t, idx) => {
    const linkedItemIds: string[] = (t.linkedCategories || []).flatMap((cat: string) => categoryMap.get(cat) ?? []);
    const uniqueLinkedIds: string[] = Array.from(new Set(linkedItemIds));
    return {
      id: createId('task'),
      title: t.name,
      phase: t.phase,
      durationDays: Math.max(t.isMilestone ? 0 : 1, t.duration),
      startDay: 1,
      progress: 0,
      crew: `Crew ${idx + 1}`,
      crewSize: t.crewSize,
      dependencies: [],
      dependencyLinks: [],
      notes: '',
      status: 'not_started' as const,
      isMilestone: t.isMilestone,
      wbsCode: t.wbs,
      isCriticalPath: t.isCriticalPath,
      isWeatherSensitive: ['Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing', 'Landscaping'].includes(t.phase),
      linkedEstimateItems: uniqueLinkedIds,
    };
  });

  // Resolve predecessors
  const idMap = new Map<string, string>();
  safeTasks.forEach((t, idx) => idMap.set(t.id, tasks[idx].id));
  for (let i = 0; i < tasks.length; i++) {
    const pid = safeTasks[i].predecessorIds ?? [];
    tasks[i].dependencyLinks = pid
      .filter((p: string) => idMap.has(p))
      .map((p: string) => ({
        taskId: idMap.get(p)!,
        type: 'FS' as DependencyType,
        lagDays: 0,
      }));
    tasks[i].dependencies = tasks[i].dependencyLinks!.map((l: DependencyLink) => l.taskId);
  }

  const scheduleName = `${project.name} Schedule (from Estimate)`;
  const schedule = buildScheduleFromTasks(scheduleName, project.id, tasks);
  const finalSchedule: ProjectSchedule = {
    ...schedule,
    projectId: project.id,
    updatedAt: new Date().toISOString(),
  };

  const linkedItemCount = tasks.reduce((sum, t) => sum + (t.linkedEstimateItems?.length ?? 0), 0);

  return {
    schedule: finalSchedule,
    tasks,
    linkedItemCount,
  };
}

```


---

### `utils/demoSchedule.ts`

```ts
// demoSchedule.ts — seed a realistic, complex residential-construction
// schedule so we can stress-test the CPM engine + Interactive Gantt.
//
// The schedule is based on a ~10-week single-family-home build. It has:
//   * 6 phases (Site → Foundation → Framing → MEP → Finishes → Closeout)
//   * ~35 tasks with real-world dependencies
//   * A few tasks already showing progress + actuals (so you can see the
//     green actual bars + variance badges immediately)
//   * A baseline on every task (so the baseline ghost stripe shows underneath)
//   * One intentional conflict (two tasks share a crew + overlap) so the
//     resource-leveling warning lights up
//
// NOTE: This is a dev helper. In production we'd gate it behind a flag.

import type { ScheduleTask } from '@/types';
import { createId, generateWbsCodes } from './scheduleEngine';

interface SeedSpec {
  alias: string;                   // local alias, used in `deps`
  title: string;
  phase: string;
  durationDays: number;
  deps?: string[];                  // local aliases (resolved below)
  crew?: string;
  crewSize?: number;
  isMilestone?: boolean;
  progress?: number;                // 0-100
  actualStartOffset?: number;       // day number where actual started (1-indexed)
  actualEndOffset?: number;         // day number where actual finished
  status?: ScheduleTask['status'];
  isWeatherSensitive?: boolean;
}

// Tasks in logical build order. `deps` references other entries by alias.
const SPEC: SeedSpec[] = [
  // --- Phase 1: Site prep -------------------------------------------------
  { alias: 'kickoff', title: 'Project kickoff & permits filed', phase: 'Site', durationDays: 0, isMilestone: true, status: 'done', progress: 100, actualStartOffset: 1, actualEndOffset: 1 },
  { alias: 'survey',  title: 'Site survey & staking', phase: 'Site', durationDays: 2, deps: ['kickoff'], crew: 'Surveyor', status: 'done', progress: 100, actualStartOffset: 1, actualEndOffset: 2 },
  { alias: 'clear',   title: 'Clear & grub site',     phase: 'Site', durationDays: 3, deps: ['survey'], crew: 'Excavation', crewSize: 3, status: 'done', progress: 100, actualStartOffset: 3, actualEndOffset: 6, isWeatherSensitive: true },
  { alias: 'erosion', title: 'Erosion control',       phase: 'Site', durationDays: 1, deps: ['clear'], crew: 'Excavation', status: 'done', progress: 100, actualStartOffset: 6, actualEndOffset: 6 },
  { alias: 'tempUt',  title: 'Temporary utilities',   phase: 'Site', durationDays: 2, deps: ['clear'], crew: 'Electric', status: 'done', progress: 100, actualStartOffset: 7, actualEndOffset: 8 },

  // --- Phase 2: Foundation -----------------------------------------------
  { alias: 'excavate', title: 'Excavate footings & basement', phase: 'Foundation', durationDays: 4, deps: ['clear', 'erosion'], crew: 'Excavation', crewSize: 3, status: 'done', progress: 100, actualStartOffset: 7, actualEndOffset: 11 },
  { alias: 'foundFormwork', title: 'Foundation formwork & rebar', phase: 'Foundation', durationDays: 3, deps: ['excavate'], crew: 'Concrete', crewSize: 4, status: 'done', progress: 100, actualStartOffset: 11, actualEndOffset: 14 },
  { alias: 'pourFound', title: 'Pour foundation walls', phase: 'Foundation', durationDays: 2, deps: ['foundFormwork'], crew: 'Concrete', status: 'done', progress: 100, actualStartOffset: 14, actualEndOffset: 15 },
  { alias: 'foundCure', title: 'Foundation cure & strip forms', phase: 'Foundation', durationDays: 3, deps: ['pourFound'], crew: 'Concrete', status: 'in_progress', progress: 65, actualStartOffset: 16 },
  { alias: 'foundInsp', title: 'Foundation inspection', phase: 'Inspections', durationDays: 1, deps: ['foundCure'], isMilestone: false },
  { alias: 'waterproof', title: 'Waterproof foundation', phase: 'Foundation', durationDays: 2, deps: ['foundInsp'], crew: 'Waterproofing' },
  { alias: 'backfill', title: 'Backfill foundation', phase: 'Foundation', durationDays: 2, deps: ['waterproof'], crew: 'Excavation' },
  { alias: 'slabPrep', title: 'Slab prep & vapor barrier', phase: 'Foundation', durationDays: 2, deps: ['backfill'], crew: 'Concrete' },
  { alias: 'pourSlab', title: 'Pour slab', phase: 'Foundation', durationDays: 1, deps: ['slabPrep'], crew: 'Concrete' },

  // --- Phase 3: Framing --------------------------------------------------
  { alias: 'frameFloor1', title: 'Frame 1st floor deck', phase: 'Framing', durationDays: 3, deps: ['pourSlab'], crew: 'Framing', crewSize: 5 },
  { alias: 'frameWalls1', title: 'Frame 1st floor walls', phase: 'Framing', durationDays: 4, deps: ['frameFloor1'], crew: 'Framing', crewSize: 5 },
  { alias: 'frameFloor2', title: 'Frame 2nd floor deck', phase: 'Framing', durationDays: 2, deps: ['frameWalls1'], crew: 'Framing' },
  { alias: 'frameWalls2', title: 'Frame 2nd floor walls', phase: 'Framing', durationDays: 3, deps: ['frameFloor2'], crew: 'Framing' },
  { alias: 'frameRoof',   title: 'Frame roof trusses & sheathing', phase: 'Framing', durationDays: 4, deps: ['frameWalls2'], crew: 'Framing', crewSize: 5, isWeatherSensitive: true },
  { alias: 'frameInsp',   title: 'Rough framing inspection', phase: 'Inspections', durationDays: 1, deps: ['frameRoof'] },
  { alias: 'roofing',     title: 'Install roofing', phase: 'Framing', durationDays: 3, deps: ['frameInsp'], crew: 'Roofing', isWeatherSensitive: true },
  { alias: 'windows',     title: 'Install windows & exterior doors', phase: 'Framing', durationDays: 2, deps: ['frameInsp'], crew: 'Framing' },
  { alias: 'weatherTight', title: 'Weather-tight milestone', phase: 'Framing', durationDays: 0, deps: ['roofing', 'windows'], isMilestone: true },

  // --- Phase 4: MEP rough-in --------------------------------------------
  // Note: plumbing + electrical + HVAC run in parallel — shared crew conflict
  // between plumbing rough-in and HVAC (both using "Mechanical" crew) to
  // trigger the leveling warning.
  { alias: 'plumbRough', title: 'Plumbing rough-in', phase: 'MEP', durationDays: 5, deps: ['weatherTight'], crew: 'Mechanical', crewSize: 2 },
  { alias: 'elecRough',  title: 'Electrical rough-in', phase: 'MEP', durationDays: 5, deps: ['weatherTight'], crew: 'Electric', crewSize: 3 },
  { alias: 'hvacRough',  title: 'HVAC rough-in', phase: 'MEP', durationDays: 4, deps: ['weatherTight'], crew: 'Mechanical', crewSize: 2 },
  { alias: 'mepInsp',    title: 'MEP inspection', phase: 'Inspections', durationDays: 1, deps: ['plumbRough', 'elecRough', 'hvacRough'] },

  // --- Phase 5: Finishes -------------------------------------------------
  { alias: 'insulation',  title: 'Insulation', phase: 'Interior', durationDays: 3, deps: ['mepInsp'], crew: 'Insulation' },
  { alias: 'drywall',     title: 'Hang & finish drywall', phase: 'Drywall', durationDays: 6, deps: ['insulation'], crew: 'Drywall', crewSize: 4 },
  { alias: 'interiorPaint', title: 'Interior paint', phase: 'Finishes', durationDays: 4, deps: ['drywall'], crew: 'Paint' },
  { alias: 'cabinets',    title: 'Install cabinets', phase: 'Finishes', durationDays: 3, deps: ['interiorPaint'], crew: 'Finish Carp' },
  { alias: 'countertops', title: 'Countertops template + install', phase: 'Finishes', durationDays: 5, deps: ['cabinets'], crew: 'Finish Carp' },
  { alias: 'flooring',    title: 'Flooring', phase: 'Finishes', durationDays: 4, deps: ['interiorPaint'], crew: 'Flooring' },
  { alias: 'trim',        title: 'Interior trim & doors', phase: 'Finishes', durationDays: 3, deps: ['flooring'], crew: 'Finish Carp' },
  { alias: 'fixtures',    title: 'Plumbing & electrical fixtures', phase: 'Finishes', durationDays: 2, deps: ['trim', 'countertops'], crew: 'Mechanical' },

  // --- Phase 6: Closeout -------------------------------------------------
  { alias: 'landscaping', title: 'Landscaping', phase: 'Landscaping', durationDays: 4, deps: ['backfill'], crew: 'Landscaping', isWeatherSensitive: true },
  { alias: 'finalClean',  title: 'Final clean', phase: 'Finishes', durationDays: 2, deps: ['fixtures'], crew: 'Cleaning' },
  { alias: 'finalInsp',   title: 'Final inspection & C/O', phase: 'Inspections', durationDays: 1, deps: ['finalClean', 'landscaping'] },
  { alias: 'turnover',    title: 'Client walkthrough & turnover', phase: 'General', durationDays: 0, deps: ['finalInsp'], isMilestone: true },
];

/**
 * Build ~35 realistic tasks with dependencies, baselines, and a handful of
 * actuals pre-filled so the as-built UI shows something interesting on load.
 */
export function seedDemoSchedule(): ScheduleTask[] {
  // First pass: assign ids.
  const idByAlias = new Map<string, string>();
  for (const spec of SPEC) {
    idByAlias.set(spec.alias, createId('task'));
  }

  // Second pass: compute startDays by walking the dependency graph (simple
  // topo, since SPEC is already in dep order).
  const endDayByAlias = new Map<string, number>();
  const startByAlias = new Map<string, number>();

  for (const spec of SPEC) {
    let earliestStart = 1;
    for (const depAlias of spec.deps ?? []) {
      const depEnd = endDayByAlias.get(depAlias);
      if (depEnd != null) earliestStart = Math.max(earliestStart, depEnd + 1);
    }
    startByAlias.set(spec.alias, earliestStart);
    // A milestone (duration=0) ends on the same day it starts.
    const end = spec.durationDays === 0
      ? earliestStart
      : earliestStart + spec.durationDays - 1;
    endDayByAlias.set(spec.alias, end);
  }

  // Third pass: build ScheduleTask objects.
  const tasks: ScheduleTask[] = SPEC.map(spec => {
    const id = idByAlias.get(spec.alias)!;
    const startDay = startByAlias.get(spec.alias)!;
    const endDay = endDayByAlias.get(spec.alias)!;
    const dependencies = (spec.deps ?? [])
      .map(a => idByAlias.get(a))
      .filter((x): x is string => Boolean(x));

    const task: ScheduleTask = {
      id,
      title: spec.title,
      phase: spec.phase,
      durationDays: spec.durationDays,
      startDay,
      progress: spec.progress ?? 0,
      crew: spec.crew ?? '',
      crewSize: spec.crewSize,
      dependencies,
      notes: '',
      status: spec.status ?? 'not_started',
      isMilestone: spec.isMilestone,
      isWeatherSensitive: spec.isWeatherSensitive,
      // Baseline = planned start/end, captured as the "original promise."
      baselineStartDay: startDay,
      baselineEndDay: endDay,
    };

    // As-built values (if pre-filled in the spec). We also nudge a few tasks
    // to show variance: e.g. the clear/grub actually took an extra day so the
    // +1d late badge appears.
    if (spec.actualStartOffset != null) {
      task.actualStartDay = spec.actualStartOffset;
    }
    if (spec.actualEndOffset != null) {
      task.actualEndDay = spec.actualEndOffset;
    }

    return task;
  });

  // Introduce a small, visible variance so the UI is interesting:
  // - "Clear & grub" was supposed to take 3 days (baseline 3-5), but actual
  //   was 3-6 due to rain. We already set actualEndOffset=6 above.
  // - Bump "Foundation formwork" actual start by +1 so it shows a late-start
  //   badge.
  const formwork = tasks.find(t => t.title.startsWith('Foundation formwork'));
  if (formwork && formwork.baselineStartDay != null) {
    formwork.actualStartDay = formwork.baselineStartDay + 1;
  }

  return generateWbsCodes(tasks);
}

```
