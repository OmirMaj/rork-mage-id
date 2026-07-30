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
  Platform, Alert, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, Check, Calendar as CalendarIcon,
  Building2, Hammer, Trees, Home as HomeIcon, Plus, Minus, Trash2, MapPin, PencilRuler,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate, TemplateTask } from '@/constants/scheduleTemplates';
import { PHASE_COLORS } from '@/utils/scheduleEngine';
import { runCpm } from '@/utils/cpm';
import { generateUUID } from '@/utils/generateId';
import type { ScheduleTask } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { displayText } from '@/utils/formatters';

const STEPS = ['Project', 'Tasks', 'Schedule', 'Review'] as const;
type StepIndex = 0 | 1 | 2 | 3;

// Sentinel template id for the "build it yourself" path — starts the task
// list empty instead of seeding a template's tasks.
const SCRATCH_ID = '__scratch__';

// Phases you can cycle through by tapping a task's colour dot. Ordered roughly
// the way a job runs, so tapping forward walks the build sequence.
const PHASE_CYCLE = [
  'General', 'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
  'Plumbing', 'Electrical', 'HVAC', 'Insulation', 'Drywall',
  'Interior', 'Finishes', 'Landscaping', 'Inspections',
];

// The wizard commits a 5-day work week and hands off to Schedule Pro, which
// runs CPM in CALENDAR mode (weekend-aware) whenever a startDate is present.
// We MUST preview + persist through that same calendar math — otherwise a
// raw-day plan re-expands across weekends the instant Pro mounts and the
// finish date jumps (the raw-day→calendar finish-jump bug). Keep this in sync
// with the workingDaysPerWeek written in handleSave.
const WIZARD_WORKING_DAYS_PER_WEEK = 5;

// Mirror of schedule-pro's GRID_BREAKPOINT. Below this width the Pro grid is
// unusable and schedule-pro bounces the user to the classic schedule — so we
// send the wizard's completed hand-off straight to the classic schedule
// instead of routing through a screen that immediately redirects again.
const GRID_BREAKPOINT = 900;

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { canAccess } = useTierAccess();
  // Route to Schedule Pro only when the grid is both usable (wide screen) AND
  // unlocked for this tier. Otherwise land in the classic schedule — the
  // wizard's value is available to every tier, and free users shouldn't finish
  // the flow only to hit a full-screen paywall.
  const wideEnoughForPro = width >= GRID_BREAKPOINT && canAccess('schedule_gantt_pdf');
  // `scratch=1` opens the wizard already on the blank path (Discover →
  // "Blank schedule" routes here) instead of seeding a template's tasks.
  const { projectId, scratch } = useLocalSearchParams<{ projectId?: string; scratch?: string }>();
  const startScratch = scratch === '1' || scratch === 'true';
  const { projects, getProject, updateProject } = useProjects();

  const [step, setStep] = useState<StepIndex>(0);
  const [pickedProjectId, setPickedProjectId] = useState<string>(projectId ?? '');
  const [blockHint, setBlockHint] = useState<string | null>(null);
  const project = useMemo(
    () => (pickedProjectId ? getProject(pickedProjectId) : null),
    [pickedProjectId, getProject],
  );

  const [pickedTemplateId, setPickedTemplateId] = useState<string>(startScratch ? SCRATCH_ID : 'kitchen-remodel');
  const template = useMemo(
    () => SCHEDULE_TEMPLATES.find(t => t.id === pickedTemplateId) ?? SCHEDULE_TEMPLATES[0],
    [pickedTemplateId],
  );

  // Editable copy of the template tasks, so the user can tune in step 2
  // without mutating the source template.
  const [tasks, setTasks] = useState<TemplateTask[]>(
    () => (startScratch ? [] : template.tasks.map(t => ({ ...t }))),
  );

  // Re-seed tasks when the template changes.
  const handlePickTemplate = useCallback((id: string) => {
    setPickedTemplateId(id);
    if (id === SCRATCH_ID) {
      setTasks([]); // blank canvas — the user builds it with "Add task".
    } else {
      const t = SCHEDULE_TEMPLATES.find(x => x.id === id);
      if (t) setTasks(t.tasks.map(x => ({ ...x })));
    }
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

  const isoStart = useMemo(() => toIsoDate(startDate), [startDate]);

  // Compute each task's start/end DAY through the SAME weekend-aware CPM the
  // operational view runs. startDay/endDay are 1-indexed calendar-day offsets
  // from `startDate` (day 1 = startDate), so a task spanning a weekend widens
  // exactly as it will in Schedule Pro — no raw-day→calendar jump on handoff.
  const scheduledTasks = useMemo(() => {
    const cpmTasks: ScheduleTask[] = tasks.map(t => ({
      id: t.id,
      title: t.name,
      phase: t.phase,
      durationDays: t.duration,
      startDay: 1,
      dependencies: t.predecessorIds,
      crew: '',
      crewSize: t.crewSize,
      isMilestone: t.isMilestone,
      notes: '',
      status: 'not_started',
      progress: 0,
    }));
    const result = runCpm(cpmTasks, {
      scheduleStartDate: isoStart,
      workingDaysPerWeek: WIZARD_WORKING_DAYS_PER_WEEK,
    });
    return tasks.map(t => {
      const r = result.perTask.get(t.id);
      const startDay = r?.es ?? 1;
      const endDay = r?.ef ?? startDay + Math.max(0, t.duration - 1);
      return { ...t, startDay, endDay };
    });
  }, [tasks, isoStart]);

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

  function blockReason(s: StepIndex): string {
    if (s === 0) return 'Pick a project to continue.';
    if (s === 1) return 'Add at least one task first.';
    return '';
  }

  // Clear the hint whenever the blocking condition resolves.
  React.useEffect(() => {
    if (canAdvance) setBlockHint(null);
  }, [pickedProjectId, tasks.length, canAdvance]);

  const handleNext = useCallback(() => {
    if (!canAdvance) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setBlockHint(blockReason(step));
      return;
    }
    setBlockHint(null);
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
        workingDaysPerWeek: WIZARD_WORKING_DAYS_PER_WEEK,
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
    // On phone-width screens the Pro grid is unusable and /schedule-pro just
    // bounces back to the classic schedule — routing there directly avoids a
    // jarring double redirect right after the primary conversion action.
    if (wideEnoughForPro) {
      router.replace({ pathname: '/schedule-pro' as never, params: { projectId: project.id } as never });
    } else {
      router.replace('/(tabs)/schedule' as never);
    }
  }, [project, isoStart, totalDays, scheduledTasks, tasks, updateProject, router, wideEnoughForPro]);

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
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
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
            activeId={pickedTemplateId}
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
            wideEnoughForPro={wideEnoughForPro}
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
            wideEnoughForPro={wideEnoughForPro}
          />
        )}
      </ScrollView>

      {/* Bottom CTA. The mock uses a single big primary button; we mirror it. */}
      <View style={[styles.bottomCta, { paddingBottom: insets.bottom + 12 }]}>
        {step < 3 ? (
          <>
            {blockHint ? (
              <Text style={styles.blockHintText}>{blockHint}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.ctaBtn, !canAdvance && styles.ctaBtnDisabled]}
              onPress={handleNext}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAdvance }}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaBtnText}>Next: {STEPS[step + 1]}</Text>
              <ChevronRight size={18} color="#fff" strokeWidth={2.5} />
            </TouchableOpacity>
          </>
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projects, pickedId, onPick, startDate, projectEndDate, totalDays } = props;
  const picked = projects.find(p => p.id === pickedId);

  return (
    <View style={styles.stepContent}>
      {picked ? (
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Building2 size={28} color={themeColors.accent} strokeWidth={1.6} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{picked.name}</Text>
            <View style={styles.heroMetaRow}>
              <MapPin size={13} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.heroMeta}>{displayText(picked.location, 'No location set')}</Text>
            </View>
            <View style={styles.heroMetaRow}>
              <CalendarIcon size={13} color={themeColors.textMuted} strokeWidth={1.75} />
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
              <View style={[styles.projectDot, active && { backgroundColor: themeColors.accent }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.projectName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.projectSub} numberOfLines={1}>
                  {displayText(p.location, 'No location')} · {p.type}
                </Text>
              </View>
              {active && <Check size={18} color={themeColors.accent} strokeWidth={2.5} />}
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
  activeId: string;
  templates: ScheduleTemplate[];
  onPickTemplate: (id: string) => void;
  tasks: TemplateTask[];
  setTasks: (next: TemplateTask[] | ((prev: TemplateTask[]) => TemplateTask[])) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { activeId, templates, onPickTemplate, tasks, setTasks } = props;
  const scratchActive = activeId === SCRATCH_ID;

  return (
    <View style={styles.stepContent}>
      <Text style={styles.sectionLabel}>Choose a starting point</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.templateScrollContent}
      >
        {/* From scratch — a blank task list the user builds themselves. */}
        <TouchableOpacity
          onPress={() => onPickTemplate(SCRATCH_ID)}
          style={[styles.templateCard, styles.scratchCard, scratchActive && styles.templateCardActive]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Start from scratch"
        >
          <View style={[styles.templateIcon, scratchActive && { backgroundColor: themeColors.accent + '15' }]}>
            <PencilRuler size={22} color={scratchActive ? themeColors.accent : themeColors.textSecondary} />
          </View>
          <Text style={[styles.templateName, scratchActive && { color: themeColors.accent }]} numberOfLines={2}>
            From scratch
          </Text>
          <Text style={styles.templateSub}>Build your own</Text>
        </TouchableOpacity>
        {templates.map(t => {
          const Icon = TEMPLATE_ICONS[t.id] ?? Hammer;
          const active = t.id === activeId;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => onPickTemplate(t.id)}
              style={[styles.templateCard, active && styles.templateCardActive]}
              activeOpacity={0.85}
            >
              <View style={[styles.templateIcon, active && { backgroundColor: themeColors.accent + '15' }]}>
                <Icon size={22} color={active ? themeColors.accent : themeColors.textSecondary} />
              </View>
              <Text style={[styles.templateName, active && { color: themeColors.accent }]} numberOfLines={2}>
                {t.name}
              </Text>
              <Text style={styles.templateSub}>{t.taskCount} tasks · {t.typicalDuration}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Tasks ({tasks.length})</Text>
      {tasks.length === 0 ? (
        <Text style={styles.helper}>No tasks yet — add your first below, or pick a template above.</Text>
      ) : (
        <Text style={styles.helper}>
          Tap a name to rename · − / + sets the days · tap the colour dot to change phase · 0 days = milestone
        </Text>
      )}
      <View style={{ gap: 8 }}>
        {tasks.map((t, idx) => {
          const phaseColor = PHASE_COLORS[t.phase] ?? PHASE_COLORS.General;
          return (
            <View key={t.id} style={styles.taskRow}>
              {/* Tap the dot to cycle the phase — no picker modal to fight. */}
              <TouchableOpacity
                onPress={() => setTasks(prev => prev.map((x, i) => {
                  if (i !== idx) return x;
                  const at = PHASE_CYCLE.indexOf(x.phase);
                  return { ...x, phase: PHASE_CYCLE[(at + 1) % PHASE_CYCLE.length] };
                }))}
                hitSlop={{ top: 12, right: 8, bottom: 12, left: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Phase: ${t.phase}. Tap to change.`}
                testID={`task-phase-${idx}`}
              >
                <View style={[styles.taskDot, { backgroundColor: phaseColor }]} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <TextInput
                  value={t.name}
                  onChangeText={(v) => {
                    setTasks(prev => prev.map((x, i) => i === idx ? { ...x, name: v } : x));
                  }}
                  style={styles.taskName}
                  placeholder="Task name"
                  placeholderTextColor={themeColors.textMuted}
                />
                <Text style={styles.taskMeta}>
                  {t.phase} · {t.duration === 0 ? 'milestone' : `${t.duration} day${t.duration === 1 ? '' : 's'}`}
                </Text>
              </View>

              {/* Duration stepper. 0 days = milestone (the model's convention),
                  so stepping down to 0 turns the task into one. */}
              <View style={styles.durBox}>
                <TouchableOpacity
                  onPress={() => setTasks(prev => prev.map((x, i) => {
                    if (i !== idx) return x;
                    const next = Math.max(0, x.duration - 1);
                    return { ...x, duration: next, isMilestone: next === 0 };
                  }))}
                  hitSlop={{ top: 10, right: 6, bottom: 10, left: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Shorten ${t.name}`}
                  testID={`task-minus-${idx}`}
                >
                  <Minus size={15} color={t.duration === 0 ? themeColors.textMuted : themeColors.text} strokeWidth={2.25} />
                </TouchableOpacity>
                <Text style={styles.durVal}>{t.duration === 0 ? '◆' : `${t.duration}d`}</Text>
                <TouchableOpacity
                  onPress={() => setTasks(prev => prev.map((x, i) => {
                    if (i !== idx) return x;
                    const next = Math.min(365, x.duration + 1);
                    return { ...x, duration: next, isMilestone: false };
                  }))}
                  hitSlop={{ top: 10, right: 10, bottom: 10, left: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Lengthen ${t.name}`}
                  testID={`task-plus-${idx}`}
                >
                  <Plus size={15} color={themeColors.text} strokeWidth={2.25} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => setTasks(prev => prev.filter((_, i) => i !== idx))}
                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${t.name}`}
              >
                <Trash2 size={16} color={themeColors.textMuted} strokeWidth={1.75} />
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
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
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
  wideEnoughForPro: boolean;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { scheduledTasks, startDate, totalDays, wideEnoughForPro } = props;
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
        {wideEnoughForPro
          ? 'You can drag, resize, and reorder these tasks in Schedule Pro once you tap Save — this preview keeps the wizard quick.'
          : 'You can fine-tune dates, durations, and dependencies once you tap Save — this preview keeps the wizard quick.'}
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
  wideEnoughForPro: boolean;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { project, template, tasksCount, startDate, endDate, totalDays, wideEnoughForPro } = props;
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
        {wideEnoughForPro
          ? 'Saving creates the schedule and opens Schedule Pro, where you can fine-tune dependencies, dates, and crew assignments.'
          : 'Saving creates the schedule and opens your schedule, where you can fine-tune dependencies, dates, and crew assignments.'}
      </Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  topBarBackBtn: {
    width: 40, height: 40, borderRadius: Tokens.radius.full,
    backgroundColor: t.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1, borderColor: t.line,
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: Type.headline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  topBarPlaceholder: { width: 40 },
  topBarSaveBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
  },
  topBarSaveText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
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
    borderWidth: 1.5, borderColor: t.line,
  },
  stepCircleActive: {
    backgroundColor: t.accent,
    borderColor: t.accent,
  },
  stepCircleDone: {
    backgroundColor: t.accent,
    borderColor: t.accent,
  },
  stepCircleText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.textMuted,
  },
  stepCircleTextActive: { color: '#fff' },
  stepLabel: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontWeight: '600' as const,
  },
  stepLabelActive: { color: t.text },
  stepConnector: {
    flex: 1, height: 2,
    backgroundColor: t.line,
    marginBottom: 18,
  },
  stepConnectorDone: { backgroundColor: t.accent },

  stepContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: t.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
    marginTop: 4,
  },
  helper: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    lineHeight: 19,
  },

  heroCard: {
    flexDirection: 'row' as const,
    gap: 14,
    padding: 14,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line,
  },
  heroIcon: {
    width: 56, height: 56, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '12',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  heroTitle: {
    fontSize: Type.headline.fontSize,
    fontWeight: '800' as const,
    color: t.text,
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
    color: t.textMuted,
  },

  projectRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 12,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
  },
  projectRowActive: {
    borderColor: t.accent,
    backgroundColor: t.accent + '08',
  },
  projectDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: t.line,
  },
  projectName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  projectSub: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },

  templateScrollContent: {
    gap: 10,
    paddingRight: 16,
  },
  templateCard: {
    width: 130,
    padding: 12,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    gap: 8,
  },
  templateCardActive: {
    borderColor: t.accent,
    backgroundColor: t.accent + '08',
  },
  scratchCard: {
    borderStyle: 'dashed' as const,
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
    color: t.text,
  },
  templateSub: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
  },

  taskRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    padding: 12,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
  },
  taskDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  // Duration stepper — thumb-sized targets so a schedule can be built
  // one-handed on site without summoning a keyboard.
  durBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: t.line,
  },
  durVal: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    minWidth: 26,
    textAlign: 'center' as const,
  },
  taskName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    paddingVertical: 0,
  },
  taskMeta: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },
  addTaskBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    padding: 12,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderStyle: 'dashed' as const, borderColor: t.accent + '50',
    backgroundColor: t.accent + '08',
  },
  addTaskBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
  },

  timelineWrap: {
    marginTop: 8,
    paddingVertical: 8,
  },
  timelineHeader: {
    flexDirection: 'row' as const,
    height: 24,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
    marginBottom: 4,
  },
  timelineHeaderCell: {
    alignItems: 'flex-start' as const,
    justifyContent: 'center' as const,
  },
  timelineHeaderText: {
    fontSize: 9,
    color: t.textMuted,
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
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    gap: 4,
  },
  reviewLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: t.textMuted,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
  },
  reviewValue: {
    fontSize: Type.headline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.3,
  },
  reviewSub: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
  },

  bottomCta: {
    position: 'absolute' as const,
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: t.bg,
    borderTopWidth: 1,
    borderTopColor: t.line,
  },
  blockHintText: {
    fontSize: Type.footnote.fontSize,
    color: t.danger,
    textAlign: 'center' as const,
    marginBottom: 8,
    fontWeight: '600' as const,
  },
  ctaBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 16,
    borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent,
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
