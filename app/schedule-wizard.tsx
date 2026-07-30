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
  Platform, Modal, Pressable, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Check,
  Calendar as CalendarIcon, Building2, Hammer, Trees, Home as HomeIcon,
  Plus, Minus, Trash2, MapPin, PencilRuler, X, CornerDownRight, GitBranch,
  Flag, FolderPlus,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import {
  SCHEDULE_TEMPLATES, repairChain, moveTask, removeTaskAt, insertTaskAt,
  readLinkMode, cycleLinkMode, setTaskDuration,
} from '@/constants/scheduleTemplates';
import type { ScheduleTemplate, TemplateTask } from '@/constants/scheduleTemplates';
import { PHASE_COLORS, buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { runCpm } from '@/utils/cpm';
import { generateUUID } from '@/utils/generateId';
import type { ScheduleTask, DependencyLink } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { displayText } from '@/utils/formatters';
import DatePickerModal from '@/components/DatePickerModal';

// Step 3 is the calendar preview. It used to be called "Schedule", which made
// the CTA read "Next: Schedule" inside a screen called Create Schedule.
const STEPS = ['Project', 'Tasks', 'Timeline', 'Review'] as const;
type StepIndex = 0 | 1 | 2 | 3;

// Sentinel template id for the "build it yourself" path — starts the task
// list empty instead of seeding a template's tasks.
const SCRATCH_ID = '__scratch__';

// Phases offered by the per-task phase picker, ordered roughly the way a job
// runs. Must cover every phase the shipped templates use (including MEP) or a
// template task lands on a phase the picker can't show.
const PHASE_OPTIONS = [
  'General', 'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
  'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Insulation', 'Drywall',
  'Interior', 'Finishes', 'Landscaping', 'Inspections',
];

// Below this width the template strip scrolls horizontally (thumb-friendly).
// At or above it we wrap the cards instead — a mouse can't drag a horizontal
// ScrollView and the wheel doesn't scroll it, so on desktop web every card
// past the third was unreachable.
const WRAP_TEMPLATES_WIDTH = 700;

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

function fmtLong(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Parse yyyy-mm-dd as LOCAL noon — `new Date('2026-08-03')` is parsed as UTC
 *  midnight and renders as Aug 2 for anyone west of Greenwich. */
function parseIsoDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

/** Monday of next week — the most common real answer to "when does it start". */
function nextMonday(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
}

/** Human sentence for a row's sequencing, shown on the tappable link chip. */
function sequenceLabel(tasks: readonly TemplateTask[], index: number): string {
  if (index === 0) return 'Starts day 1';
  const mode = readLinkMode(tasks, index);
  const prevName = tasks[index - 1].name.trim() || 'the task above';
  if (mode === 'after') return `After ${prevName}`;
  if (mode === 'with') return `Alongside ${prevName}`;
  if (mode === 'start') return 'Starts day 1';
  const n = tasks[index].predecessorIds.length;
  return `After ${n} task${n === 1 ? '' : 's'}`;
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
  // `template=<id>` opens it with that template's tasks preloaded (Discover →
  // "Start from Template"), so both entry points land in the SAME builder
  // instead of one of them silently creating a project behind your back.
  const { projectId, scratch, template: templateParam } =
    useLocalSearchParams<{ projectId?: string; scratch?: string; template?: string }>();
  const startScratch = scratch === '1' || scratch === 'true';
  const seedTemplateId = useMemo(() => {
    if (startScratch) return SCRATCH_ID;
    if (templateParam && SCHEDULE_TEMPLATES.some(t => t.id === templateParam)) return templateParam;
    return 'kitchen-remodel';
  }, [startScratch, templateParam]);
  const { projects, getProject, updateProject } = useProjects();

  const [step, setStep] = useState<StepIndex>(0);
  const [pickedProjectId, setPickedProjectId] = useState<string>(projectId ?? '');
  const [blockHint, setBlockHint] = useState<string | null>(null);
  const project = useMemo(
    () => (pickedProjectId ? getProject(pickedProjectId) : null),
    [pickedProjectId, getProject],
  );

  const [pickedTemplateId, setPickedTemplateId] = useState<string>(seedTemplateId);
  const template = useMemo(
    () => SCHEDULE_TEMPLATES.find(t => t.id === pickedTemplateId) ?? SCHEDULE_TEMPLATES[0],
    [pickedTemplateId],
  );

  // Editable copy of the template tasks, so the user can tune in step 2
  // without mutating the source template.
  const [tasks, setTasks] = useState<TemplateTask[]>(
    () => (startScratch ? [] : repairChain(template.tasks.map(t => ({ ...t })))),
  );
  // True once the user has touched the task list. Gates the "you'll lose your
  // edits" confirmation on template switch / exit — asking on an untouched
  // template is nagging, not safety.
  const [edited, setEdited] = useState(false);
  // The row that should own the keyboard. Set when a task is created so you
  // can type straight into it instead of hunting for the new row.
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  // Web-safe confirmation. Alert.alert is a literal no-op on React Native Web
  // (react-native-web/dist/exports/Alert: `static alert() {}`), so the
  // overwrite guard used to make the Save button do NOTHING on web.
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [phaseFor, setPhaseFor] = useState<number | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  /** Every task-list write goes through here so `edited` can't drift. */
  const updateTasks = useCallback((next: TemplateTask[] | ((prev: TemplateTask[]) => TemplateTask[])) => {
    setEdited(true);
    setTasks(prev => (typeof next === 'function' ? next(prev) : next));
  }, []);

  // Re-seed tasks when the template changes. Wholesale replacement, so warn
  // first if there's work to lose — the strip sits directly above the task
  // list and is very easy to brush while scrolling.
  const applyTemplate = useCallback((id: string) => {
    setPickedTemplateId(id);
    setEdited(false);
    if (id === SCRATCH_ID) {
      setTasks([]); // blank canvas — the user builds it with "Add task".
    } else {
      const t = SCHEDULE_TEMPLATES.find(x => x.id === id);
      if (t) setTasks(repairChain(t.tasks.map(x => ({ ...x }))));
    }
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handlePickTemplate = useCallback((id: string) => {
    if (id === pickedTemplateId) return;
    if (edited && tasks.length > 0) {
      setConfirm({
        title: 'Replace your task list?',
        message: `You've edited these ${tasks.length} tasks. Switching starting point replaces them.`,
        confirmLabel: 'Replace',
        destructive: true,
        onConfirm: () => applyTemplate(id),
      });
      return;
    }
    applyTemplate(id);
  }, [pickedTemplateId, edited, tasks.length, applyTemplate]);

  // Day 1 of the schedule. This USED to be hard-coded to project.createdAt,
  // which silently dated a brand-new schedule to whenever the project record
  // happened to be made — months in the past for any existing job — with no
  // way to correct it before saving. It's now a real, editable field: the
  // single most consequential number in a schedule shouldn't be a guess.
  const [startIso, setStartIso] = useState<string>(() => toIsoDate(new Date()));
  const startDate = useMemo(() => parseIsoDate(startIso), [startIso]);
  const isoStart = startIso;

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

  const projectEndDate = useMemo(
    () => (totalDays > 0 ? addDays(startDate, totalDays - 1) : startDate),
    [startDate, totalDays],
  );

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

  // Completed steps are tappable — going back to fix a task shouldn't cost
  // three presses of a back arrow.
  const goToStep = useCallback((target: StepIndex) => {
    if (target > step) return;
    setBlockHint(null);
    setStep(target);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [step]);

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
      // Leaving from step 0 discards the whole draft — nothing is written to
      // the project until Save. Confirm rather than dumping the work.
      if (edited && tasks.length > 0) {
        setConfirm({
          title: 'Discard this schedule?',
          message: `${tasks.length} task${tasks.length === 1 ? '' : 's'} haven't been saved to a project yet.`,
          confirmLabel: 'Discard',
          destructive: true,
          onConfirm: () => router.back(),
        });
        return;
      }
      router.back();
      return;
    }
    setStep((step - 1) as StepIndex);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [step, router, edited, tasks.length]);

  // ── Save ───────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!project) return;
    // Map TemplateTask → ScheduleTask. We preserve template ids inside the
    // dependency arrays by translating to fresh UUIDs — Supabase requires
    // UUIDs as primary keys, but the predecessor refs are internal to the
    // schedule JSON so any string works as long as it's consistent.
    const idMap = new Map<string, string>();
    tasks.forEach(t => idMap.set(t.id, generateUUID()));

    const newTasks: ScheduleTask[] = scheduledTasks.map(t => {
      const deps = t.predecessorIds.map(pid => idMap.get(pid) ?? pid);
      const dependencyLinks: DependencyLink[] = deps.map(taskId => ({
        taskId, type: 'FS' as const, lagDays: 0,
      }));
      return {
        id: idMap.get(t.id)!,
        title: t.name.trim() || 'Untitled task',
        phase: t.phase,
        durationDays: t.duration,
        startDay: t.startDay,
        dependencies: deps,
        dependencyLinks,
        crew: '',
        crewSize: t.crewSize,
        isMilestone: t.isMilestone,
        notes: '',
        status: 'not_started',
        progress: 0,
      };
    });

    // Build through the shared engine rather than hand-rolling the schedule
    // object. The hand-rolled version shipped a fake laborAlignmentScore of
    // 100, no healthScore at all (so the schedule showed no health badge
    // anywhere it was listed) and an empty riskItems array. Passing
    // criticalPathDays makes buildScheduleFromTasks SKIP its legacy
    // forward-pass resolver, so our weekend-aware CPM startDays survive
    // untouched — no raw-day re-expansion on the way in.
    const built = buildScheduleFromTasks(
      `${project.name} — Schedule`,
      project.id,
      newTasks,
      null,
      { criticalPathDays: totalDays, startDate: isoStart },
    );

    updateProject(project.id, {
      schedule: {
        ...built,
        // Keep the wizard's own commitments: what the preview showed is what
        // gets stored (the engine defaults to a 3-day buffer we never showed).
        workingDaysPerWeek: WIZARD_WORKING_DAYS_PER_WEEK,
        bufferDays: 0,
      },
    });

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // On phone-width screens the Pro grid is unusable and /schedule-pro just
    // bounces back to the classic schedule — routing there directly avoids a
    // jarring double redirect right after the primary conversion action.
    //
    // The classic schedule defaults to projects[0] and only honours an
    // explicit projectId (+ a `focus` nonce so a repeat visit re-applies it).
    // Without both, finishing the wizard for your second project dropped you
    // on your FIRST project's schedule and the work looked lost.
    if (wideEnoughForPro) {
      router.replace({ pathname: '/schedule-pro' as never, params: { projectId: project.id } as never });
    } else {
      router.replace({
        pathname: '/(tabs)/schedule' as never,
        params: { projectId: project.id, focus: String(Date.now()) } as never,
      });
    }
  }, [project, isoStart, totalDays, scheduledTasks, tasks, updateProject, router, wideEnoughForPro]);

  // Confirmation guard — overwrites an existing schedule.
  const onSavePressed = useCallback(() => {
    if (!project) return;
    const existing = project.schedule?.tasks?.length ?? 0;
    if (existing === 0) {
      handleSave();
      return;
    }
    setConfirm({
      title: 'Replace existing schedule?',
      message: `${project.name} already has a schedule with ${existing} task${existing === 1 ? '' : 's'}. Saving replaces it.`,
      confirmLabel: 'Replace',
      destructive: true,
      onConfirm: handleSave,
    });
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
              <TouchableOpacity
                style={styles.stepItem}
                onPress={() => goToStep(i as StepIndex)}
                disabled={i >= step}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Step ${i + 1}: ${label}${done ? ' (completed, tap to revisit)' : ''}`}
                testID={`wizard-step-${i}`}
              >
                <View
                  style={[
                    styles.stepCircle,
                    active && styles.stepCircleActive,
                    done && styles.stepCircleDone,
                  ]}
                >
                  {done ? (
                    <Check size={14} color={Colors.textOnAccent} strokeWidth={3} />
                  ) : (
                    <Text style={[styles.stepCircleText, active && styles.stepCircleTextActive]}>
                      {i + 1}
                    </Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
              </TouchableOpacity>
              {i < STEPS.length - 1 && (
                <View style={[styles.stepConnector, done && styles.stepConnectorDone]} />
              )}
            </React.Fragment>
          );
        })}
      </View>

      {/* keyboardShouldPersistTaps: the task list is full of TextInputs, and
          without this every tap on "+ Add task" / a chip while the keyboard is
          up is swallowed dismissing the keyboard instead. */}
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
      >
        {step === 0 && (
          <ProjectStep
            projects={projects}
            pickedId={pickedProjectId}
            onPick={setPickedProjectId}
            startDate={startDate}
            projectEndDate={projectEndDate}
            totalDays={totalDays}
            onEditStartDate={() => setDatePickerOpen(true)}
            onQuickStart={(d) => setStartIso(toIsoDate(d))}
            onCreateProject={() => router.replace({ pathname: '/' as never, params: { openCreate: '1' } as never })}
          />
        )}
        {step === 1 && (
          <TasksStep
            activeId={pickedTemplateId}
            templates={SCHEDULE_TEMPLATES}
            onPickTemplate={handlePickTemplate}
            tasks={tasks}
            setTasks={updateTasks}
            totalDays={totalDays}
            endDate={projectEndDate}
            focusTaskId={focusTaskId}
            setFocusTaskId={setFocusTaskId}
            onOpenPhasePicker={setPhaseFor}
          />
        )}
        {step === 2 && (
          <ScheduleStep
            scheduledTasks={scheduledTasks}
            startDate={startDate}
            totalDays={totalDays}
            wideEnoughForPro={wideEnoughForPro}
            onEditStartDate={() => setDatePickerOpen(true)}
          />
        )}
        {step === 3 && project && (
          <ReviewStep
            project={project}
            startingPoint={
              pickedTemplateId === SCRATCH_ID
                ? 'Built from scratch'
                : edited ? `${template.name} (edited)` : template.name
            }
            tasksCount={tasks.length}
            milestoneCount={tasks.filter(t => t.duration === 0).length}
            startDate={startDate}
            endDate={projectEndDate}
            totalDays={totalDays}
            wideEnoughForPro={wideEnoughForPro}
            onEditStartDate={() => setDatePickerOpen(true)}
          />
        )}
      </ScrollView>

      <PhasePickerSheet
        visible={phaseFor !== null}
        current={phaseFor !== null ? tasks[phaseFor]?.phase ?? 'General' : 'General'}
        onClose={() => setPhaseFor(null)}
        onPick={(phase) => {
          const idx = phaseFor;
          setPhaseFor(null);
          if (idx === null) return;
          updateTasks(prev => prev.map((x, i) => (i === idx ? { ...x, phase } : x)));
        }}
      />

      <ConfirmSheet spec={confirm} onDismiss={() => setConfirm(null)} />

      <DatePickerModal
        visible={datePickerOpen}
        value={startIso}
        allowFuture
        title="Schedule start date"
        onClose={() => setDatePickerOpen(false)}
        onChange={(iso) => setStartIso(toIsoDate(new Date(iso)))}
      />

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
              <ChevronRight size={18} color={Colors.textOnAccent} strokeWidth={2.5} />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={onSavePressed}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="wizard-save"
          >
            <Check size={18} color={Colors.textOnAccent} strokeWidth={2.5} />
            <Text style={styles.ctaBtnText}>Save schedule</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Step 1: Pick the project + set day 1 ──────────────────────────
function ProjectStep(props: {
  projects: ReturnType<typeof useProjects>['projects'];
  pickedId: string;
  onPick: (id: string) => void;
  startDate: Date;
  projectEndDate: Date;
  totalDays: number;
  onEditStartDate: () => void;
  onQuickStart: (d: Date) => void;
  onCreateProject: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {
    projects, pickedId, onPick, startDate, projectEndDate, totalDays,
    onEditStartDate, onQuickStart, onCreateProject,
  } = props;
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
                {totalDays > 0
                  ? `${fmtShort(startDate)} – ${fmtShort(projectEndDate)} · ${totalDays} days`
                  : `Starts ${fmtShort(startDate)}`}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <Text style={styles.helper}>Pick a project to build a schedule for.</Text>
      )}

      <StartDateField
        startDate={startDate}
        onEdit={onEditStartDate}
        onQuickStart={onQuickStart}
      />

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
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.helper}>
              A schedule belongs to a job. Create the project first — this
              wizard will be waiting under Schedule.
            </Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={onCreateProject}
              activeOpacity={0.85}
              accessibilityRole="button"
              testID="wizard-create-project"
            >
              <FolderPlus size={16} color={Colors.textOnAccent} strokeWidth={2} />
              <Text style={styles.emptyBtnText}>Create a project</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Day 1 picker ──────────────────────────────────────────────────
// Shown in step 1 and again above the timeline, because "when does this
// start" is the question people re-ask the moment they see the bars.
function StartDateField(props: {
  startDate: Date;
  onEdit: () => void;
  onQuickStart: (d: Date) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { startDate, onEdit, onQuickStart } = props;
  const today = new Date();
  const monday = nextMonday(today);
  const isSame = (a: Date, b: Date) => toIsoDate(a) === toIsoDate(b);

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.sectionLabel}>Start date</Text>
      <TouchableOpacity
        style={styles.dateRow}
        onPress={onEdit}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Schedule starts ${fmtLong(startDate)}. Tap to change.`}
        testID="wizard-start-date"
      >
        <CalendarIcon size={17} color={themeColors.accent} strokeWidth={1.9} />
        <Text style={styles.dateValue}>{fmtLong(startDate)}</Text>
        <Text style={styles.dateChange}>Change</Text>
        <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={2} />
      </TouchableOpacity>
      <View style={styles.quickDateRow}>
        {[
          { label: 'Today', date: today },
          { label: 'Tomorrow', date: addDays(today, 1) },
          { label: 'Next Monday', date: monday },
        ].map(opt => {
          const active = isSame(opt.date, startDate);
          return (
            <TouchableOpacity
              key={opt.label}
              style={[styles.quickDate, active && styles.quickDateActive]}
              onPress={() => onQuickStart(opt.date)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={[styles.quickDateText, active && styles.quickDateTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
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
  totalDays: number;
  endDate: Date;
  focusTaskId: string | null;
  setFocusTaskId: (id: string | null) => void;
  onOpenPhasePicker: (index: number) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const {
    activeId, templates, onPickTemplate, tasks, setTasks, totalDays, endDate,
    focusTaskId, setFocusTaskId, onOpenPhasePicker,
  } = props;
  const scratchActive = activeId === SCRATCH_ID;
  const wrapTemplates = width >= WRAP_TEMPLATES_WIDTH;

  /** Insert a task below `index` (or at the end when index is null) and hand
   *  it the keyboard, so Add → type → Enter → type is one unbroken rhythm. */
  const addTask = useCallback((index: number | null) => {
    const fresh: TemplateTask = {
      id: `custom-${generateUUID()}`,
      name: 'New Task',
      phase: 'General',
      duration: 1,
      predecessorIds: [],
      isMilestone: false,
      isCriticalPath: false,
      crewSize: 1,
    };
    setTasks(prev => insertTaskAt(prev, index === null ? prev.length : index + 1, fresh));
    setFocusTaskId(fresh.id);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [setTasks, setFocusTaskId]);

  const templateCards = (
    <>
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
            accessibilityRole="button"
            accessibilityLabel={`${t.name} template, ${t.taskCount} tasks`}
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
    </>
  );

  return (
    <View style={styles.stepContent}>
      <Text style={styles.sectionLabel}>Choose a starting point</Text>
      {wrapTemplates ? (
        // Desktop web: a horizontal ScrollView can't be dragged with a mouse
        // and doesn't take the wheel, so everything past the third card was
        // simply unreachable. Wrap instead.
        <View style={styles.templateWrap}>{templateCards}</View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.templateScrollContent}
        >
          {templateCards}
        </ScrollView>
      )}

      <View style={styles.tasksHeadRow}>
        <Text style={[styles.sectionLabel, { marginTop: 0 }]}>Tasks ({tasks.length})</Text>
        {tasks.length > 0 && (
          <Text style={styles.tasksHeadTotal}>
            {totalDays} day{totalDays === 1 ? '' : 's'} · ends {fmtShort(endDate)}
          </Text>
        )}
      </View>

      {tasks.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Start with your first task</Text>
          <Text style={styles.helper}>
            List the work in the order it happens — Demo, then Rough Plumbing,
            then Drywall. Each task chains onto the one above it, and you can
            change that on any row. Press return after typing a name to keep
            going.
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => addTask(null)}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="wizard-add-first-task"
          >
            <Plus size={16} color={Colors.textOnAccent} strokeWidth={2} />
            <Text style={styles.emptyBtnText}>Add first task</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.helper}>
          Tap a name to rename · type or step the days · 0 days makes it a
          milestone · tap the sequence chip to run a task alongside the one
          above instead of after it
        </Text>
      )}

      <View style={{ gap: 8 }}>
        {tasks.map((t, idx) => (
          <TaskRow
            key={t.id}
            task={t}
            index={idx}
            tasks={tasks}
            autoFocus={t.id === focusTaskId}
            onFocused={() => setFocusTaskId(null)}
            onRename={(name) => setTasks(prev => prev.map((x, i) => (i === idx ? { ...x, name } : x)))}
            onDuration={(days) => setTasks(prev => setTaskDuration(prev, idx, days))}
            onCycleLink={() => setTasks(prev => cycleLinkMode(prev, idx))}
            onOpenPhase={() => onOpenPhasePicker(idx)}
            onMove={(delta) => setTasks(prev => moveTask(prev, idx, idx + delta))}
            onRemove={() => setTasks(prev => removeTaskAt(prev, idx))}
            onSubmit={() => addTask(idx)}
          />
        ))}
        {tasks.length > 0 && (
          <TouchableOpacity
            style={styles.addTaskBtn}
            onPress={() => addTask(null)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Add task"
            testID="wizard-add-task"
          >
            <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.addTaskBtnText}>Add task</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── One editable task row ─────────────────────────────────────────
function TaskRow(props: {
  task: TemplateTask;
  index: number;
  tasks: TemplateTask[];
  autoFocus: boolean;
  onFocused: () => void;
  onRename: (name: string) => void;
  onDuration: (days: number) => void;
  onCycleLink: () => void;
  onOpenPhase: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onSubmit: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {
    task: t, index: idx, tasks, autoFocus, onFocused, onRename, onDuration,
    onCycleLink, onOpenPhase, onMove, onRemove, onSubmit,
  } = props;
  const phaseColor = PHASE_COLORS[t.phase] ?? PHASE_COLORS.General;
  const mode = readLinkMode(tasks, idx);
  const LinkIcon = mode === 'after' ? CornerDownRight : mode === 'start' ? Flag : GitBranch;
  const first = idx === 0;
  const last = idx === tasks.length - 1;

  return (
    <View style={styles.taskRow}>
      <View style={styles.taskTopRow}>
        <View style={[styles.taskIndex, { backgroundColor: phaseColor + '22', borderColor: phaseColor }]}>
          <Text style={[styles.taskIndexText, { color: phaseColor }]}>{idx + 1}</Text>
        </View>
        <TextInput
          value={t.name}
          onChangeText={onRename}
          onFocus={onFocused}
          autoFocus={autoFocus}
          // Only the just-created row select-alls, so typing replaces the
          // "New Task" placeholder. Doing it on every focus would make one
          // stray keystroke wipe a name the user already typed.
          selectTextOnFocus={autoFocus}
          onSubmitEditing={onSubmit}
          returnKeyType="next"
          style={styles.taskName}
          placeholder="Task name"
          placeholderTextColor={themeColors.textMuted}
          accessibilityLabel={`Task ${idx + 1} name`}
          testID={`task-name-${idx}`}
        />
        <TouchableOpacity
          onPress={() => onMove(-1)}
          disabled={first}
          hitSlop={{ top: 10, right: 4, bottom: 10, left: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Move ${t.name} up`}
          testID={`task-up-${idx}`}
        >
          <ChevronUp size={17} color={first ? themeColors.line : themeColors.textSecondary} strokeWidth={2.25} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onMove(1)}
          disabled={last}
          hitSlop={{ top: 10, right: 4, bottom: 10, left: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Move ${t.name} down`}
          testID={`task-down-${idx}`}
        >
          <ChevronDown size={17} color={last ? themeColors.line : themeColors.textSecondary} strokeWidth={2.25} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 10, right: 8, bottom: 10, left: 6 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${t.name}`}
          testID={`task-remove-${idx}`}
        >
          <Trash2 size={16} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      <View style={styles.taskChipRow}>
        <TouchableOpacity
          style={styles.phaseChip}
          onPress={onOpenPhase}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Phase: ${t.phase}. Tap to change.`}
          testID={`task-phase-${idx}`}
        >
          <View style={[styles.taskDot, { backgroundColor: phaseColor }]} />
          <Text style={styles.chipText} numberOfLines={1}>{t.phase}</Text>
          <ChevronDown size={13} color={themeColors.textMuted} strokeWidth={2} />
        </TouchableOpacity>

        {/* Duration. 0 days = milestone (the model's convention), so stepping
            down to 0 turns the task into one. Typing beats 20 taps of "+". */}
        <View style={styles.durBox}>
          <TouchableOpacity
            onPress={() => onDuration(t.duration - 1)}
            hitSlop={{ top: 10, right: 6, bottom: 10, left: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Shorten ${t.name}`}
            testID={`task-minus-${idx}`}
          >
            <Minus size={15} color={t.duration === 0 ? themeColors.textMuted : themeColors.text} strokeWidth={2.25} />
          </TouchableOpacity>
          <DurationField value={t.duration} onCommit={onDuration} index={idx} />
          <TouchableOpacity
            onPress={() => onDuration(t.duration + 1)}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 6 }}
            accessibilityRole="button"
            accessibilityLabel={`Lengthen ${t.name}`}
            testID={`task-plus-${idx}`}
          >
            <Plus size={15} color={themeColors.text} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.linkChip, first && styles.linkChipStatic]}
          onPress={onCycleLink}
          disabled={first}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`${sequenceLabel(tasks, idx)}. Tap to change how this task is sequenced.`}
          testID={`task-link-${idx}`}
        >
          <LinkIcon size={13} color={themeColors.textSecondary} strokeWidth={2} />
          <Text style={styles.chipText} numberOfLines={1}>{sequenceLabel(tasks, idx)}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Typable day count — 20 days shouldn't cost 20 taps of "+".
 *  Local text state so a cleared field doesn't instantly snap back to "0",
 *  but every parseable keystroke commits immediately: nothing is left
 *  pending, so advancing a step can never silently drop a typed duration. */
function DurationField(props: { value: number; onCommit: (days: number) => void; index: number }) {
  const styles = useThemedStyles(makeStyles);
  const { value, onCommit, index } = props;
  const [text, setText] = useState(String(value));
  React.useEffect(() => { setText(String(value)); }, [value]);

  const commit = () => {
    const n = Number.parseInt(text, 10);
    onCommit(Number.isFinite(n) ? n : value);
  };

  return (
    <TextInput
      value={text}
      onChangeText={(v) => {
        const cleaned = v.replace(/[^0-9]/g, '').slice(0, 3);
        setText(cleaned);
        if (cleaned.length > 0) onCommit(Number.parseInt(cleaned, 10));
      }}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType="number-pad"
      returnKeyType="done"
      selectTextOnFocus
      style={styles.durVal}
      accessibilityLabel="Duration in days"
      testID={`task-duration-${index}`}
    />
  );
}

// ── Phase picker ──────────────────────────────────────────────────
// Replaces tap-the-dot-to-cycle, which needed up to 15 taps on a 10pt target
// to reach the phase you wanted and gave no preview of what came next.
function PhasePickerSheet(props: {
  visible: boolean;
  current: string;
  onClose: () => void;
  onPick: (phase: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { visible, current, onClose, onPick } = props;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Phase</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={19} color={themeColors.textMuted} strokeWidth={1.9} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            {PHASE_OPTIONS.map(p => {
              const active = p === current;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.phaseOption, active && styles.phaseOptionActive]}
                  onPress={() => onPick(p)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  testID={`phase-option-${p}`}
                >
                  <View style={[styles.taskDot, { backgroundColor: PHASE_COLORS[p] ?? PHASE_COLORS.General }]} />
                  <Text style={[styles.phaseOptionText, active && { color: themeColors.accent }]}>{p}</Text>
                  {active && <Check size={16} color={themeColors.accent} strokeWidth={2.5} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Web-safe confirmation ─────────────────────────────────────────
interface ConfirmSpec {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

function ConfirmSheet(props: { spec: ConfirmSpec | null; onDismiss: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { spec, onDismiss } = props;
  return (
    <Modal visible={spec !== null} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.modalOverlay} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>{spec?.title ?? ''}</Text>
          <Text style={[styles.helper, { marginTop: 6, marginBottom: 18 }]}>{spec?.message ?? ''}</Text>
          <TouchableOpacity
            style={[styles.confirmBtn, spec?.destructive && { backgroundColor: themeColors.danger }]}
            onPress={() => { const fn = spec?.onConfirm; onDismiss(); fn?.(); }}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="wizard-confirm"
          >
            <Text style={styles.confirmBtnText}>{spec?.confirmLabel ?? 'Confirm'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onDismiss}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID="wizard-confirm-cancel"
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Step 3: Timeline preview ──────────────────────────────────────
function ScheduleStep(props: {
  scheduledTasks: (TemplateTask & { startDay: number; endDay: number })[];
  startDate: Date;
  totalDays: number;
  wideEnoughForPro: boolean;
  onEditStartDate: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const { scheduledTasks, startDate, totalDays, wideEnoughForPro, onEditStartDate } = props;
  const PX_PER_DAY = 16;
  const WEEK_PX = PX_PER_DAY * 7;
  const gutter = width >= WRAP_TEMPLATES_WIDTH ? 180 : 116;
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const timelineWidth = Math.max(280, weeks * WEEK_PX);

  return (
    <View style={styles.stepContent}>
      <Text style={styles.sectionLabel}>Schedule timeline</Text>
      <Text style={styles.helper}>
        {scheduledTasks.length} task{scheduledTasks.length === 1 ? '' : 's'} · {totalDays} day
        {totalDays === 1 ? '' : 's'} · finishes {fmtShort(addDays(startDate, Math.max(0, totalDays - 1)))}
      </Text>

      <TouchableOpacity
        style={styles.dateRow}
        onPress={onEditStartDate}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Schedule starts ${fmtLong(startDate)}. Tap to change.`}
      >
        <CalendarIcon size={17} color={themeColors.accent} strokeWidth={1.9} />
        <Text style={styles.dateValue}>Starts {fmtLong(startDate)}</Text>
        <Text style={styles.dateChange}>Change</Text>
        <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={2} />
      </TouchableOpacity>

      {/* Fixed name gutter + scrolling bars. Without the gutter every row was
          an unlabelled bar once you scrolled right, and short bars clipped
          their own inline label to nothing. */}
      <View style={styles.timelineFrame}>
        <View style={{ width: gutter }}>
          <View style={styles.timelineHeader} />
          {scheduledTasks.map(t => (
            <View key={t.id} style={styles.timelineRow}>
              <Text style={styles.timelineName} numberOfLines={1}>
                {t.name.trim() || 'Untitled task'}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
          <View style={[styles.timelineWrap, { width: timelineWidth }]}>
            {/* Week-axis header. One cell per WEEK, not per day — the old
                per-day loop rendered hundreds of empty Views on a long job. */}
            <View style={styles.timelineHeader}>
              {Array.from({ length: weeks }).map((_, i) => (
                <View key={i} style={[styles.timelineHeaderCell, { width: WEEK_PX }]}>
                  <Text style={styles.timelineHeaderText}>{fmtShort(addDays(startDate, i * 7))}</Text>
                </View>
              ))}
            </View>
            {scheduledTasks.map((t) => {
              const phaseColor = PHASE_COLORS[t.phase] ?? PHASE_COLORS.General;
              const left = (t.startDay - 1) * PX_PER_DAY;
              const isMilestone = t.duration === 0;
              const barWidth = Math.max(10, (t.endDay - t.startDay + 1) * PX_PER_DAY);
              return (
                <View key={t.id} style={styles.timelineRow}>
                  {isMilestone ? (
                    <View style={[styles.timelineDiamond, { left, backgroundColor: phaseColor }]} />
                  ) : (
                    <View style={[styles.timelineBar, { left, width: barWidth, backgroundColor: phaseColor }]}>
                      {barWidth >= 34 && (
                        <Text style={styles.timelineBarLabel} numberOfLines={1}>{t.duration}d</Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <Text style={[styles.helper, { marginTop: 16 }]}>
        Weekends are skipped — durations are working days on a 5-day week, so a
        10-day task spans two calendar weeks. Diamonds are milestones.
      </Text>
      <Text style={styles.helper}>
        {wideEnoughForPro
          ? 'Saving opens Schedule Pro, where you can drag, resize, and add lag between tasks.'
          : 'Saving opens your schedule, where you can fine-tune dates and durations day by day.'}
      </Text>
    </View>
  );
}

// ── Step 4: Review & save ─────────────────────────────────────────
function ReviewStep(props: {
  project: { id: string; name: string; location?: string };
  /** Honest provenance. The old version resolved SCRATCH_ID through
   *  `find(...) ?? SCHEDULE_TEMPLATES[0]`, so a schedule built entirely from
   *  scratch reviewed as "Kitchen Remodel". */
  startingPoint: string;
  tasksCount: number;
  milestoneCount: number;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  wideEnoughForPro: boolean;
  onEditStartDate: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const {
    project, startingPoint, tasksCount, milestoneCount, startDate, endDate,
    totalDays, wideEnoughForPro, onEditStartDate,
  } = props;
  return (
    <View style={styles.stepContent}>
      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Project</Text>
        <Text style={styles.reviewValue}>{project.name}</Text>
        <Text style={styles.reviewSub}>{displayText(project.location, 'No location set')}</Text>
      </View>
      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Starting point</Text>
        <Text style={styles.reviewValue}>{startingPoint}</Text>
      </View>
      <View style={styles.reviewCard}>
        <Text style={styles.reviewLabel}>Tasks</Text>
        <Text style={styles.reviewValue}>{tasksCount}</Text>
        {milestoneCount > 0 && (
          <Text style={styles.reviewSub}>
            including {milestoneCount} milestone{milestoneCount === 1 ? '' : 's'}
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.reviewCard}
        onPress={onEditStartDate}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Change the schedule start date"
      >
        <View style={styles.reviewHeadRow}>
          <Text style={styles.reviewLabel}>Dates</Text>
          <Text style={styles.dateChange}>Change start</Text>
        </View>
        <Text style={styles.reviewValue}>{totalDays} working-day plan</Text>
        <Text style={styles.reviewSub}>{fmtLong(startDate)} → {fmtLong(endDate)}</Text>
      </TouchableOpacity>
      <Text style={[styles.helper, { marginTop: 8 }]}>
        {wideEnoughForPro
          ? 'Saving creates the schedule and opens Schedule Pro, where you can fine-tune dependencies, dates, and crew assignments.'
          : 'Saving creates the schedule and opens your schedule, where you can fine-tune dependencies, dates, and crew assignments.'}
      </Text>
      <Text style={styles.helper}>
        {`Nothing has been written to ${project.name} yet — Save is what commits it.`}
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
    backgroundColor: t.surfaceAlt,
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
  stepCircleTextActive: { color: Colors.textOnAccent },
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

  // Day 1 — the single most consequential field in a schedule, so it gets a
  // real row rather than a derived caption.
  dateRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    padding: 14,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
  },
  dateValue: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  dateChange: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
  },
  quickDateRow: { flexDirection: 'row' as const, gap: 8 },
  quickDate: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
    alignItems: 'center' as const,
  },
  quickDateActive: { borderColor: t.accent, backgroundColor: t.accent + '12' },
  quickDateText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  quickDateTextActive: { color: t.accent, fontWeight: '700' as const },

  emptyCard: {
    padding: 16,
    gap: 10,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line,
  },
  emptyTitle: {
    fontSize: Type.headline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.2,
  },
  emptyBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 13,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accent,
    marginTop: 2,
  },
  emptyBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnAccent,
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
  templateWrap: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
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
    backgroundColor: t.surfaceAlt,
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

  tasksHeadRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: 24,
  },
  // Live totals while editing — you shouldn't have to advance a step to find
  // out whether the plan you just built is six weeks or six months.
  tasksHeadTotal: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
  },

  taskRow: {
    gap: 10,
    padding: 12,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
  },
  taskTopRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  taskChipRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  taskIndex: {
    width: 22, height: 22, borderRadius: Tokens.radius.xs,
    borderWidth: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  taskIndexText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
  taskDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  chipText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    maxWidth: 160,
  },
  phaseChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  // The sequence chip is the wizard's dependency editor: one tap walks
  // after-previous → alongside-previous → starts-day-1.
  linkChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
    borderStyle: 'dashed' as const,
  },
  linkChipStatic: { borderStyle: 'solid' as const, opacity: 0.75 },
  // Duration stepper — thumb-sized targets so a schedule can be built
  // one-handed on site, with a typable field so 20 days isn't 20 taps.
  durBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: t.line,
  },
  durVal: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    minWidth: 30,
    textAlign: 'center' as const,
    paddingVertical: 3,
  },
  taskName: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    paddingVertical: 2,
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

  timelineFrame: {
    flexDirection: 'row' as const,
    marginTop: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    paddingVertical: 8,
    paddingLeft: 10,
  },
  timelineWrap: {
    paddingRight: 8,
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
    justifyContent: 'center' as const,
  },
  // Sticky name gutter — the bars scroll, the labels don't.
  timelineName: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    fontWeight: '600' as const,
    paddingRight: 10,
  },
  timelineBar: {
    position: 'absolute' as const,
    top: 4,
    height: 20,
    borderRadius: 4,
    paddingHorizontal: 6,
    justifyContent: 'center' as const,
  },
  timelineDiamond: {
    position: 'absolute' as const,
    top: 8,
    width: 12, height: 12,
    transform: [{ rotate: '45deg' }],
  },
  timelineBarLabel: {
    color: Colors.textOnAccent,
    fontSize: 10,
    fontWeight: '700' as const,
  },

  // ── Sheets (phase picker + web-safe confirm) ──────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 24,
  },
  sheet: {
    width: '100%' as const,
    maxWidth: 420,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line,
    padding: 18,
  },
  sheetHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.3,
  },
  phaseOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.md,
  },
  phaseOptionActive: { backgroundColor: t.accent + '10' },
  phaseOptionText: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  confirmBtn: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 14,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accent,
  },
  confirmBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnAccent,
  },
  cancelBtn: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 13,
    marginTop: 8,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
  },
  cancelBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.textSecondary,
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
  reviewHeadRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
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
    color: Colors.textOnAccent,
    letterSpacing: -0.2,
  },
});
