import React, { useCallback, useMemo, useState } from 'react';
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
import { getSimulatedForecast, getConditionIcon } from '@/utils/weatherService';
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

  const [projectStartDate] = useState<Date>(() => new Date());
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

  const selectedProject = useMemo<Project | null>(() => {
    return projects.find(p => p.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const activeSchedule = useMemo<ProjectSchedule | null>(() => {
    return selectedProject?.schedule ?? null;
  }, [selectedProject]);

  const sortedTasks = useMemo<ScheduleTask[]>(() => {
    if (!activeSchedule) return [];
    return activeSchedule.tasks.slice().sort((a, b) => a.startDay - b.startDay || a.title.localeCompare(b.title));
  }, [activeSchedule]);

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
        // Only apply start day override when no deps are set (deps control start day automatically)
        if (!Number.isNaN(startDayOverride) && startDayOverride > 0 && depLinks.length === 0) {
          updated.startDay = startDayOverride;
        }
        return updated;
      });
      const scheduleName = activeSchedule?.name ?? 'Project Schedule';
      const nextSchedule = buildScheduleFromTasks(scheduleName, selectedProject?.id ?? null, nextTasks, activeSchedule?.baseline);
      saveSchedule(nextSchedule, selectedProject);
    } else {
      const lastTask = sortedTasks[sortedTasks.length - 1];
      const autoLinks: DependencyLink[] = depLinks.length > 0
        ? depLinks
        : (lastTask ? [{ taskId: lastTask.id, type: 'FS' as DependencyType, lagDays: 0 }] : []);
      const autoDepIds = autoLinks.map(l => l.taskId);

      const startDay = autoLinks.length > 0
        ? Math.max(...autoLinks.map(link => {
            const dep = sortedTasks.find(t => t.id === link.taskId);
            return dep ? dep.startDay + dep.durationDays + (link.lagDays || 0) : 1;
          }))
        : (lastTask ? lastTask.startDay + lastTask.durationDays : 1);

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
  }, [activeSchedule, saveSchedule, selectedProject, sortedTasks]);

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
                  </View>
                  {isVerticalGantt ? (
                    <VerticalGantt schedule={activeSchedule} tasks={sortedTasks} projectStartDate={projectStartDate} onTaskPress={setTaskDetailModal} showBaseline={showBaseline} />
                  ) : (
                    <GanttChart schedule={activeSchedule} tasks={sortedTasks} projectStartDate={projectStartDate} onTaskPress={setTaskDetailModal} showBaseline={showBaseline} />
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
        <Modal visible={isQuickAddOpen} transparent animationType="slide" onRequestClose={() => setIsQuickAddOpen(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.bottomSheetOverlay}>
              <Pressable style={{ flex: 1 }} onPress={() => setIsQuickAddOpen(false)} />
              <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}>
                <View style={styles.bottomSheetHandle} />
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Quick Add Task</Text>
                </View>
                <TextInput style={styles.quickAddInput} value={taskDraft.title} onChangeText={handleTaskNameChange} placeholder="Task name..." placeholderTextColor={Colors.textMuted} autoFocus />
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
                Describe your project and we'll generate a complete schedule with phases, tasks, durations, and dependencies.
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
