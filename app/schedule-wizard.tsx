// app/schedule-wizard.tsx — first-time schedule builder.
//
// Route: /schedule-wizard?projectId=<id>
//
// Why this exists alongside /schedule-pro:
//   • schedule-pro is the operational view — dense Gantt, CPM, baseline,
//     drag/resize, AI assistant, weather closures. Power users live there.
//   • schedule-wizard is the on-ramp — 4 step setup (Project → Tasks →
//     Schedule → Review) modeled on the Apple-app wizard pattern from the
//     UX mock. Once a schedule exists, the wizard hands the user off to
//     schedule-pro for ongoing work.
//
// The split keeps the operational view from being polluted with onboarding
// chrome, and lets first-time users pick a template + fill a few fields
// without confronting the full Gantt.

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, Check, Calendar as CalendarIcon,
  Building2, Hammer, Trees, Home as HomeIcon, Plus, Trash2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate, TemplateTask } from '@/constants/scheduleTemplates';
import { PHASE_COLORS } from '@/utils/scheduleEngine';
import { generateUUID } from '@/utils/generateId';
import type { ScheduleTask } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const STEPS = ['Project', 'Tasks', 'Schedule', 'Review'] as const;
type StepIndex = 0 | 1 | 2 | 3;

const TEMPLATE_ICONS: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  'kitchen-remodel': HomeIcon,
  'bathroom-remodel': HomeIcon,
  'home-addition': Building2,
  'whole-home-renovation': HomeIcon,
  'new-construction': Building2,
  'commercial-buildout': Building2,
  'roofing': Hammer,
  'landscaping': Trees,
};

function fmtShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export default function ScheduleWizardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, getProject, updateProject } = useProjects();

  const [step, setStep] = useState<StepIndex>(0);
  const [pickedProjectId, setPickedProjectId] = useState<string>(projectId ?? '');
  const project = useMemo(
    () => (pickedProjectId ? getProject(pickedProjectId) : null),
    [pickedProjectId, getProject],
  );

  const [pickedTemplateId, setPickedTemplateId] = useState<string>('kitchen-remodel');
  const template = useMemo(
    () => SCHEDULE_TEMPLATES.find(t => t.id === pickedTemplateId) ?? SCHEDULE_TEMPLATES[0],
    [pickedTemplateId],
  );

  // Editable copy of the template tasks, so the user can tune in step 2
  // without mutating the source template.
  const [tasks, setTasks] = useState<TemplateTask[]>(() => template.tasks.map(t => ({ ...t })));

  // Re-seed tasks when the template changes.
  const handlePickTemplate = useCallback((id: string) => {
    setPickedTemplateId(id);
    const t = SCHEDULE_TEMPLATES.find(x => x.id === id);
    if (t) setTasks(t.tasks.map(x => ({ ...x })));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const startDate = useMemo(() => {
    // Default to project createdAt if present, else today. Wizard intentionally
    // doesn't let the user pick a Day-1 date here — that's a Schedule Pro
    // concern. We commit to "today" as a sensible default and let them slide
    // it after via the operational view.
    if (project?.createdAt) {
      const d = new Date(project.createdAt);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }, [project]);

  // Compute startDay for each task by walking dependencies.
  const scheduledTasks = useMemo(() => {
    const map = new Map<string, { startDay: number; endDay: number }>();
    for (const t of tasks) {
      const predEnds = t.predecessorIds
        .map(pid => map.get(pid)?.endDay ?? 0);
      const startDay = predEnds.length > 0 ? Math.max(...predEnds) + 1 : 1;
      const endDay = startDay + Math.max(0, t.duration - 1);
      map.set(t.id, { startDay, endDay });
    }
    return tasks.map(t => {
      const range = map.get(t.id) ?? { startDay: 1, endDay: t.duration };
      return { ...t, startDay: range.startDay, endDay: range.endDay };
    });
  }, [tasks]);

  const totalDays = useMemo(() => {
    if (scheduledTasks.length === 0) return 0;
    return Math.max(...scheduledTasks.map(t => t.endDay));
  }, [scheduledTasks]);

  const projectEndDate = useMemo(() => addDays(startDate, totalDays - 1), [startDate, totalDays]);

  // ── Step navigation ────────────────────────────────────────────
  const canAdvance = useMemo(() => {
    if (step === 0) return !!pickedProjectId;
    if (step === 1) return tasks.length > 0;
    return true;
  }, [step, pickedProjectId, tasks.length]);

  const handleNext = useCallback(() => {
    if (!canAdvance) return;
    if (step < 3) {
      setStep((step + 1) as StepIndex);
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
    }
  }, [step, canAdvance]);

  const handleBack = useCallback(() => {
    if (step === 0) {
      router.back();
      return;
    }
    setStep((step - 1) as StepIndex);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [step, router]);

  // ── Save ───────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!project) return;
    const isoStart = startDate.toISOString().slice(0, 10);
    // Map TemplateTask → ScheduleTask. We preserve template ids inside the
    // dependency arrays by translating to fresh UUIDs — Supabase requires
    // UUIDs as primary keys, but the predecessor refs are internal to the
    // schedule JSON so any string works as long as it's consistent.
    const idMap = new Map<string, string>();
    tasks.forEach(t => idMap.set(t.id, generateUUID()));

    const newTasks: ScheduleTask[] = scheduledTasks.map(t => ({
      id: idMap.get(t.id)!,
      title: t.name,
      phase: t.phase,
      durationDays: t.duration,
      startDay: t.startDay,
      dependencies: t.predecessorIds.map(pid => idMap.get(pid) ?? pid),
      crew: '',
      crewSize: t.crewSize,
      isMilestone: t.isMilestone,
      notes: '',
      status: 'not_started',
      progress: 0,
    }));

    updateProject(project.id, {
      schedule: {
        id: generateUUID(),
        name: `${project.name} — Schedule`,
        projectId: project.id,
        startDate: isoStart,
        workingDaysPerWeek: 5,
        bufferDays: 0,
        tasks: newTasks,
        totalDurationDays: totalDays,
        criticalPathDays: totalDays,
        laborAlignmentScore: 100,
        riskItems: [],
        updatedAt: new Date().toISOString(),
      },
    });

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace({ pathname: '/schedule-pro' as never, params: { projectId: project.id } as never });
  }, [project, startDate, scheduledTasks, tasks, updateProject, router]);

  // Confirmation guard — overwrites an existing schedule.
  const onSavePressed = useCallback(() => {
    if (!project) return;
    const hasExisting = (project.schedule?.tasks?.length ?? 0) > 0;
    if (!hasExisting) {
      handleSave();
      return;
    }
    Alert.alert(
      'Overwrite existing schedule?',
      `${project.name} already has a schedule with ${project.schedule!.tasks.length} tasks. Continuing replaces it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Overwrite', style: 'destructive', onPress: handleSave },
      ],
    );
  }, [project, handleSave]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top bar: back arrow, title, save shortcut. Mirrors the mockup. */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleBack} style={styles.topBarBackBtn} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Create Schedule</Text>
        {step === 3 ? (
          <TouchableOpacity onPress={onSavePressed} style={styles.topBarSaveBtn} accessibilityRole="button" accessibilityLabel="Save schedule">
            <Text style={styles.topBarSaveText}>Save</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.topBarPlaceholder} />
        )}
      </View>

      {/* Step indicator — circles + labels, current step filled in primary. */}
      <View style={styles.stepIndicatorRow}>
        {STEPS.map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <React.Fragment key={label}>
              <View style={styles.stepItem}>
                <View
                  style={[
                    styles.stepCircle,
                    active && styles.stepCircleActive,
                    done && styles.stepCircleDone,
                  ]}
                >
                  {done ? (
                    <Check size={14} color="#fff" strokeWidth={3} />
                  ) : (
                    <Text style={[styles.stepCircleText, active && styles.stepCircleTextActive]}>
                      {i + 1}
                    </Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
              </View>
              {i < STEPS.length - 1 && (
                <View style={[styles.stepConnector, done && styles.stepConnectorDone]} />
              )}
            </React.Fragment>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <ProjectStep
            projects={projects}
            pickedId={pickedProjectId}
            onPick={setPickedProjectId}
            startDate={startDate}
            projectEndDate={projectEndDate}
            totalDays={totalDays}
          />
        )}
        {step === 1 && (
          <TasksStep
            template={template}
            templates={SCHEDULE_TEMPLATES}
            onPickTemplate={handlePickTemplate}
            tasks={tasks}
            setTasks={setTasks}
          />
        )}
        {step === 2 && (
          <ScheduleStep
            scheduledTasks={scheduledTasks}
            startDate={startDate}
            totalDays={totalDays}
          />
        )}
        {step === 3 && project && (
          <ReviewStep
            project={project}
            template={template}
            tasksCount={tasks.length}
            startDate={startDate}
            endDate={projectEndDate}
            totalDays={totalDays}
          />
        )}
      </ScrollView>

      {/* Bottom CTA. The mock uses a single big primary button; we mirror it. */}
      <View style={[styles.bottomCta, { paddingBottom: insets.bottom + 12 }]}>
        {step < 3 ? (
          <TouchableOpacity
            style={[styles.ctaBtn, !canAdvance && styles.ctaBtnDisabled]}
            onPress={handleNext}
            disabled={!canAdvance}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.ctaBtnText}>Next: {STEPS[step + 1]}</Text>
            <ChevronRight size={18} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={onSavePressed}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Check size={18} color="#fff" strokeWidth={2.5} />
            <Text style={styles.ctaBtnText}>Save schedule</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Step 1: Pick the project ──────────────────────────────────────
function ProjectStep(props: {
  projects: ReturnType<typeof useProjects>['projects'];
  pickedId: string;
  onPick: (id: string) => void;
  startDate: Date;
  projectEndDate: Date;
  totalDays: number;
}) {
  const { projects, pickedId, onPick, startDate, projectEndDate, totalDays } = props;
  const picked = projects.find(p => p.id === pickedId);

  return (
    <View style={styles.stepContent}>
      {picked ? (
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Building2 size={28} color={Colors.primary} strokeWidth={1.6} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{picked.name}</Text>
            <View style={styles.heroMetaRow}>
              <Text style={styles.heroMeta}>📍 {picked.location || 'No location set'}</Text>
            </View>
            <View style={styles.heroMetaRow}>
              <CalendarIcon size={13} color={Colors.textMuted} />
              <Text style={styles.heroMeta}>
                {fmtShort(startDate)} – {fmtShort(projectEndDate)}
                {totalDays > 0 ? ` · ${totalDays} days` : ''}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <Text style={styles.helper}>Pick a project to build a schedule for.</Text>
      )}

      <Text style={styles.sectionLabel}>Your projects</Text>
      <View style={{ gap: 8 }}>
        {projects.map(p => {
          const active = p.id === pickedId;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.projectRow, active && styles.projectRowActive]}
              onPress={() => onPick(p.id)}
              activeOpacity={0.85}
            >
              <View style={[styles.projectDot, active && { backgroundColor: Colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.projectName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.projectSub} numberOfLines={1}>
                  {p.location || 'No location'} · {p.type}
                </Text>
              </View>
              {active && <Check size={18} color={Colors.primary} strokeWidth={2.5} />}
            </TouchableOpacity>
          );
        })}
        {projects.length === 0 && (
          <Text style={styles.helper}>No projects yet — create one first.</Text>
        )}
      </View>
    </View>
  );
}

// ── Step 2: Pick a template, tune the task list ───────────────────
function TasksStep(props: {
  template: ScheduleTemplate;
  templates: ScheduleTemplate[];
  onPickTemplate: (id: string) => void;
  tasks: TemplateTask[];
  setTasks: (next: TemplateTask[] | ((prev: TemplateTask[]) => TemplateTask[])) => void;
}) {
  const { template, templates, onPickTemplate, tasks, setTasks } = props;

  return (
    <View style={styles.stepContent}>
      <Text style={styles.sectionLabel}>Start from a template</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.templateScrollContent}
      >
        {templates.map(t => {
          const Icon = TEMPLATE_ICONS[t.id] ?? Hammer;
          const active = t.id === template.id;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => onPickTemplate(t.id)}
              style={[styles.templateCard, active && styles.templateCardActive]}
              activeOpacity={0.85}
            >
              <View style={[styles.templateIcon, active && { backgroundColor: Colors.primary + '15' }]}>
                <Icon size={22} color={active ? Colors.primary : Colors.textSecondary} />
              </View>
              <Text style={[styles.templateName, active && { color: Colors.primary }]} numberOfLines={2}>
                {t.name}
              </Text>
              <Text style={styles.templateSub}>{t.taskCount} tasks · {t.typicalDuration}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Tasks ({tasks.length})</Text>
      <View style={{ gap: 8 }}>
        {tasks.map((t, idx) => {
          const phaseColor = PHASE_COLORS[t.phase] ?? PHASE_COLORS.General;
          return (
            <View key={t.id} style={styles.taskRow}>
              <View style={[styles.taskDot, { backgroundColor: phaseColor }]} />
              <View style={{ flex: 1 }}>
                <TextInput
                  value={t.name}
                  onChangeText={(v) => {
                    setTasks(prev => prev.map((x, i) => i === idx ? { ...x, name: v } : x));
                  }}
                  style={styles.taskName}
                  placeholder="Task name"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.taskMeta}>
                  {t.phase} · {t.duration === 0 ? 'milestone' : `${t.duration}d`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setTasks(prev => prev.filter((_, i) => i !== idx))}
                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Remove task"
              >
                <Trash2 size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
          );
        })}
        <TouchableOpacity
          style={styles.addTaskBtn}
          onPress={() => {
            const fresh: TemplateTask = {
              id: `custom-${Date.now()}`,
              name: 'New Task',
              phase: 'General',
              duration: 1,
              predecessorIds: tasks.length > 0 ? [tasks[tasks.length - 1].id] : [],
              isMilestone: false,
              isCriticalPath: false,
              crewSize: 1,
            };
            setTasks(prev => [...prev, fresh]);
          }}
          activeOpacity={0.85}
        >
          <Plus size={16} color={Colors.primary} />
          <Text style={styles.addTaskBtnText}>Add task</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Step 3: Timeline preview ──────────────────────────────────────
function ScheduleStep(props: {
  scheduledTasks: (TemplateTask & { startDay: number; endDay: number })[];
  startDate: Date;
  totalDays: number;
}) {
  const { scheduledTasks, startDate, totalDays } = props;
  const PX_PER_DAY = 16;
  const timelineWidth = Math.max(320, totalDays * PX_PER_DAY);

  return (
    <View style={styles.stepContent}>
      <Text style={styles.sectionLabel}>Schedule timeline</Text>
      <Text style={styles.helper}>
        {scheduledTasks.length} tasks · {totalDays} days · finishes {fmtShort(addDays(startDate, totalDays - 1))}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={[styles.timelineWrap, { width: timelineWidth }]}>
          {/* Day-axis header */}
          <View style={styles.timelineHeader}>
            {Array.from({ length: totalDays }).map((_, i) => (
              <View key={i} style={[styles.timelineHeaderCell, { width: PX_PER_DAY }]}>
                <Text style={styles.timelineHeaderText}>
                  {(i + 1) % 7 === 1 ? fmtShort(addDays(startDate, i)) : ''}
                </Text>
              </View>
            ))}
          </View>
          {scheduledTasks.map((t) => {
            const phaseColor = PHASE_COLORS[t.phase] ?? PHASE_COLORS.General;
            const left = (t.startDay - 1) * PX_PER_DAY;
            const width = Math.max(8, (t.endDay - t.startDay + 1) * PX_PER_DAY);
            return (
              <View key={t.id} style={styles.timelineRow}>
                <View
                  style={[
                    styles.timelineBar,
                    { left, width, backgroundColor: phaseColor },
                  ]}
                >
                  <Text style={styles.timelineBarLabel} numberOfLines={1}>{t.name}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Text style={[styles.helper, { marginTop: 16 }]}>
        You can drag, resize, and reorder these tasks once you tap Save — this preview keeps the wizard quick.
      </Text>
    </View>
  );
}

// ── Step 4: Review & save ─────────────────────────────────────────
function ReviewStep(props: {
  project: { id: string; name: string; location?: string };
  template: ScheduleTemplate;
  tasksCount: number;
  startDate: Date;
  endDate: Date;
  totalDays: number;
}) {
  const { project, template, tasksCount, startDate, endDate, totalDays } = props;
  return (
    <View style={styles.stepContent}>
      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Project</Text>
        <Text style={styles.reviewValue}>{project.name}</Text>
        <Text style={styles.reviewSub}>{project.location || 'No location set'}</Text>
      </View>
      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Template</Text>
        <Text style={styles.reviewValue}>{template.name}</Text>
      </View>
      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Tasks</Text>
        <Text style={styles.reviewValue}>{tasksCount}</Text>
      </View>
      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Duration</Text>
        <Text style={styles.reviewValue}>{totalDays} days</Text>
        <Text style={styles.reviewSub}>{fmtShort(startDate)} → {fmtShort(endDate)}</Text>
      </View>
      <Text style={[styles.helper, { marginTop: 8 }]}>
        Saving creates the schedule and opens the operational view, where you can fine-tune dependencies, dates, and crew assignments.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  topBarBackBtn: {
    width: 40, height: 40, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: Type.headline.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  topBarPlaceholder: { width: 40 },
  topBarSaveBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
  },
  topBarSaveText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
  },

  stepIndicatorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 4,
  },
  stepItem: {
    alignItems: 'center' as const,
    gap: 6,
  },
  stepCircle: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1.5, borderColor: Colors.borderLight,
  },
  stepCircleActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  stepCircleDone: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  stepCircleText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
  },
  stepCircleTextActive: { color: '#fff' },
  stepLabel: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    fontWeight: '600' as const,
  },
  stepLabelActive: { color: Colors.text },
  stepConnector: {
    flex: 1, height: 2,
    backgroundColor: Colors.borderLight,
    marginBottom: 18,
  },
  stepConnectorDone: { backgroundColor: Colors.primary },

  stepContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: Colors.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
    marginTop: 4,
  },
  helper: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    lineHeight: 19,
  },

  heroCard: {
    flexDirection: 'row' as const,
    gap: 14,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  heroIcon: {
    width: 56, height: 56, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  heroTitle: {
    fontSize: Type.headline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  heroMetaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    marginTop: 3,
  },
  heroMeta: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
  },

  projectRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 12,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  projectRowActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  projectDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.borderLight,
  },
  projectName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  projectSub: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    marginTop: 2,
  },

  templateScrollContent: {
    gap: 10,
    paddingRight: 16,
  },
  templateCard: {
    width: 130,
    padding: 12,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: Colors.cardBorder,
    gap: 8,
  },
  templateCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  templateIcon: {
    width: 38, height: 38, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  templateName: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  templateSub: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
  },

  taskRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    padding: 12,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  taskDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  taskName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
    paddingVertical: 0,
  },
  taskMeta: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    marginTop: 2,
  },
  addTaskBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    padding: 12,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderStyle: 'dashed' as const, borderColor: Colors.primary + '50',
    backgroundColor: Colors.primary + '08',
  },
  addTaskBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
  },

  timelineWrap: {
    marginTop: 8,
    paddingVertical: 8,
  },
  timelineHeader: {
    flexDirection: 'row' as const,
    height: 24,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    marginBottom: 4,
  },
  timelineHeaderCell: {
    alignItems: 'flex-start' as const,
    justifyContent: 'center' as const,
  },
  timelineHeaderText: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '600' as const,
  },
  timelineRow: {
    height: 28,
    position: 'relative' as const,
  },
  timelineBar: {
    position: 'absolute' as const,
    top: 4,
    height: 20,
    borderRadius: 4,
    paddingHorizontal: 6,
    justifyContent: 'center' as const,
  },
  timelineBarLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700' as const,
  },

  reviewCard: {
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: Colors.cardBorder,
    gap: 4,
  },
  reviewLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: Colors.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
  },
  reviewValue: {
    fontSize: Type.headline.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  reviewSub: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
  },

  bottomCta: {
    position: 'absolute' as const,
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  ctaBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 16,
    borderRadius: Tokens.radius.panel,
    backgroundColor: Colors.primary,
  },
  ctaBtnDisabled: {
    opacity: 0.4,
  },
  ctaBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: '#fff',
    letterSpacing: -0.2,
  },
});
