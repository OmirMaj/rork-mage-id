// app/schedule-wizard.tsx — schedule builder.
//
// Routes:
//   /schedule-wizard                  → template path (pick a starting point)
//   /schedule-wizard?template=<id>    → that template preloaded
//   /schedule-wizard?scratch=1        → DOCUMENT path (see below)
//   …&projectId=<id>                  → project pre-chosen, project step skipped
//
// Why this exists alongside /schedule-pro:
//   • schedule-pro is the operational view — dense Gantt, CPM, baseline,
//     drag/resize, AI assistant, weather closures. Power users live there.
//   • schedule-wizard is the on-ramp. Once a schedule exists, it hands the
//     user off to schedule-pro for ongoing work.
//
// ── The document path (`scratch=1`) ───────────────────────────────────────
// Founder feedback, verbatim: *"when just wanting to create a schedule it
// forces templates to be used. i want you to click new schedule and it creates
// a file and then you add tasks inside of it."*
//
// That was fair. The blank path still opened on "Choose a starting point" with
// a strip of template cards as the first thing on the screen, so even the
// build-it-yourself route read as template-first. The fix is structural, not
// cosmetic:
//   1. `scratch=1` never renders the template strip. The task list IS the
//      screen. Templates survive as one quiet text link under the list.
//   2. The list opens with one empty row already in it — the "file" exists
//      the moment you arrive; you type into it.
//   3. A schedule still has to belong to a project (data model), but with
//      exactly ONE project there is nothing to ask, so the project step is
//      skipped outright. With several, it's one question — "which job is this
//      for?" — and picking answers it and moves on in the same tap.
// The template path is untouched for people who want it.

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
  Flag, FolderPlus, GripVertical, LayoutTemplate, GitMerge,
  Timer,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import {
  SCHEDULE_TEMPLATES, repairChain, moveTask, removeTaskAt, insertTaskAt,
  readLinkMode, setTaskDuration, setPredecessors, predecessorOptions,
  dropTargetIndex, setLags, getLag,
  taskName, sequenceLabel, sequenceDetail, toCpmTasks, remapDependencies,
} from '@/constants/scheduleTemplates';
import type { ScheduleTemplate, TemplateTask } from '@/constants/scheduleTemplates';
import TaskRowDrag, { type TaskDragHandle } from '@/components/schedule/TaskRowDrag';
import PredecessorPicker, { type PredecessorLink } from '@/components/schedule/PredecessorPicker';
import { PHASE_COLORS, buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { runCpm } from '@/utils/cpm';
import { generateUUID } from '@/utils/generateId';
import type { ScheduleTask } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { displayText } from '@/utils/formatters';
import DatePickerModal from '@/components/DatePickerModal';
import {
  saveDraft, loadDraft, clearDraft, isWorthSaving, draftMatchesEntry, savedAgoLabel,
} from '@/utils/scheduleDraft';

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

// Vertical gap between task rows. Shared by the styles below and the
// drag-drop math, which needs real geometry to decide where a row lands.
const TASK_ROW_GAP = 8;

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

/** A fresh, unnamed row. The document path opens with one already in the list
 *  so there is something to type into the moment the screen appears. */
function blankTask(): TemplateTask {
  return {
    id: `custom-${generateUUID()}`,
    name: '',
    phase: 'General',
    duration: 1,
    predecessorIds: [],
    isMilestone: false,
    isCriticalPath: false,
    crewSize: 1,
  };
}

// `taskName` / `sequenceLabel` / `sequenceDetail` used to live here. They moved
// to constants/scheduleTemplates.ts when per-dependency lag landed: a sentence
// that describes a dependency wrongly is a schedule that LOOKS right and isn't,
// and the only way to pin the wording under bun is for it to be importable
// without a bundler. See scripts/validate-schedule-wizard-ux.ts §11.

export default function ScheduleWizardScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { canAccess } = useTierAccess();
  const { isDesktop } = useResponsiveLayout();
  // Route to Schedule Pro only when the grid is both usable (wide screen) AND
  // unlocked for this tier. Otherwise land in the classic schedule — the
  // wizard's value is available to every tier, and free users shouldn't finish
  // the flow only to hit a full-screen paywall.
  const wideEnoughForPro = width >= GRID_BREAKPOINT && canAccess('schedule_gantt_pdf');
  // `scratch=1` opens the DOCUMENT path (Discover → "New schedule" routes
  // here): no template strip, one empty task row waiting, project step skipped
  // when there's nothing to ask. `template=<id>` opens with that template's
  // tasks preloaded (Discover → "Start from Template"), so both entry points
  // land in the SAME builder instead of one of them silently creating a
  // project behind your back.
  const { projectId, scratch, template: templateParam } =
    useLocalSearchParams<{ projectId?: string; scratch?: string; template?: string }>();
  const startScratch = scratch === '1' || scratch === 'true';
  // Derived from the ENTRY, not from the currently-selected template. If the
  // user later takes the quiet "start from a template" link the layout must
  // not suddenly re-arrange itself around a template strip they demoted.
  const documentMode = startScratch;
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
  // The document path opens with ONE empty row already present, so "new
  // schedule" produces a file you type into rather than a call to action.
  const [tasks, setTasks] = useState<TemplateTask[]>(
    () => (startScratch ? [blankTask()] : repairChain(template.tasks.map(t => ({ ...t })))),
  );
  // True once the user has touched the task list. Gates the "you'll lose your
  // edits" confirmation on template switch / exit — asking on an untouched
  // template (or on the seeded blank row, which the user never asked for) is
  // nagging, not safety.
  const [edited, setEdited] = useState(false);
  // The row that should own the keyboard. Set when a task is created so you
  // can type straight into it instead of hunting for the new row.
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  // Web-safe confirmation. Alert.alert is a literal no-op on React Native Web
  // (react-native-web/dist/exports/Alert: `static alert() {}`), so the
  // overwrite guard used to make the Save button do NOTHING on web.
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [phaseFor, setPhaseFor] = useState<number | null>(null);
  // Row whose predecessors are being edited. The multi-predecessor picker is
  // a sheet because the row is already dense — four chips and five buttons.
  const [predFor, setPredFor] = useState<number | null>(null);
  // Secondary, opt-in template browser for the document path.
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // A drag owns the vertical gesture; the ScrollView must not also consume it.
  const [dragging, setDragging] = useState(false);

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
      // Blank canvas. On the document path that means an empty ROW, not an
      // empty screen — backing out of the template browser should put you
      // back where you started, with something to type into.
      setTasks(documentMode ? [blankTask()] : []);
    } else {
      const t = SCHEDULE_TEMPLATES.find(x => x.id === id);
      if (t) setTasks(repairChain(t.tasks.map(x => ({ ...x }))));
    }
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [documentMode]);

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

  // ── Skip the project step when there is nothing to ask ─────────
  // A schedule has to belong to a project — that's the data model, not a
  // preference. But asking "which project?" when the answer is forced is pure
  // ceremony standing between "new schedule" and typing a task. So: if the
  // caller named a project, or the user has exactly one, select it and open
  // straight on the task list. Step 1 stays tappable in the indicator, so
  // changing your mind is one tap, not a re-run of the wizard.
  //
  // Runs as an effect rather than a useState initialiser because projects
  // hydrate from AsyncStorage — on first paint `projects` is still empty.
  const skippedProjectStep = useRef(false);
  React.useEffect(() => {
    if (skippedProjectStep.current || step !== 0) return;
    const forced = projectId || (projects.length === 1 ? projects[0].id : '');
    if (!forced) return;
    skippedProjectStep.current = true;
    setPickedProjectId(forced);
    setStep(1);
  }, [projects, projectId, step]);

  // Day 1 of the schedule. This USED to be hard-coded to project.createdAt,
  // which silently dated a brand-new schedule to whenever the project record
  // happened to be made — months in the past for any existing job — with no
  // way to correct it before saving. It's now a real, editable field: the
  // single most consequential number in a schedule shouldn't be a guess.
  const [startIso, setStartIso] = useState<string>(() => toIsoDate(new Date()));
  const startDate = useMemo(() => parseIsoDate(startIso), [startIso]);
  const isoStart = startIso;

  // ── Autosave ──────────────────────────────────────────────────────────────
  // The wizard presents itself as creating a FILE, but nothing was written
  // until Save — so backgrounding the app mid-build lost the whole thing.
  // A file you can lose isn't a file.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const restoreCheckedRef = useRef(false);

  // Restore once, on first mount, before the user starts typing over it.
  useEffect(() => {
    if (restoreCheckedRef.current) return;
    restoreCheckedRef.current = true;
    let cancelled = false;
    (async () => {
      const draft = await loadDraft(Date.now());
      if (cancelled || !draft) return;
      // Never resume one job's draft inside another job.
      if (!draftMatchesEntry(draft, projectId ?? '')) return;
      // On the blank path (scratch=1) never restore a template draft — a user
      // who backgrounded a kitchen-remodel session and then taps "New schedule"
      // should land on a blank canvas, not somebody else's task list.
      if (documentMode && draft.templateId !== SCRATCH_ID) return;
      setTasks(repairChain(draft.tasks));
      if (draft.projectId) setPickedProjectId(draft.projectId);
      if (draft.startIso) setStartIso(draft.startIso);
      if (draft.templateId) setPickedTemplateId(draft.templateId);
      setSavedAt(draft.savedAt);
      setRestored(true);
      setEdited(true);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Debounced write on every meaningful change. isWorthSaving keeps the
  // wizard's own seeded blank row from being persisted as "work".
  useEffect(() => {
    if (!isWorthSaving(tasks)) return;
    const handle = setTimeout(() => {
      const now = Date.now();
      void saveDraft({ projectId: pickedProjectId, templateId: pickedTemplateId, startIso, tasks, nowMs: now });
      setSavedAt(now);
    }, 700);
    return () => clearTimeout(handle);
  }, [tasks, pickedProjectId, pickedTemplateId, startIso]);

  /** Throw the draft away and start clean (the restore banner's escape hatch). */
  const discardDraft = useCallback(() => {
    void clearDraft();
    setRestored(false);
    setSavedAt(null);
    setTasks(documentMode ? [blankTask()] : []);
    setEdited(false);
  }, [documentMode]);

  // Compute each task's start/end DAY through the SAME weekend-aware CPM the
  // operational view runs. startDay/endDay are 1-indexed calendar-day offsets
  // from `startDate` (day 1 = startDate), so a task spanning a weekend widens
  // exactly as it will in Schedule Pro — no raw-day→calendar jump on handoff.
  //
  // `toCpmTasks` is shared with the validator and (via `remapDependencies`)
  // with handleSave, so the dependency links this preview is drawn from — lag
  // and all — are the same ones that get persisted. A schedule that previews
  // 3 days longer saves 3 days longer.
  const scheduledTasks = useMemo(() => {
    const result = runCpm(toCpmTasks(tasks), {
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
  // At least one task with a NAME. The document path seeds an empty row so
  // there's something to type into; that row must not double as a free pass
  // to the timeline, or you'd save a plan whose only entry is "Untitled task".
  const namedTaskCount = useMemo(
    () => tasks.filter(t => t.name.trim().length > 0).length,
    [tasks],
  );

  const canAdvance = useMemo(() => {
    if (step === 0) return !!pickedProjectId;
    if (step === 1) return namedTaskCount > 0;
    return true;
  }, [step, pickedProjectId, namedTaskCount]);

  // Memoised rather than a plain function: it now reads `tasks`, and handleNext
  // captures it — as a bare declaration the captured copy would go stale and
  // show the wrong reason (deleting the last row still said "name a task").
  const blockReason = useMemo(() => {
    if (step === 0) return 'Pick a project to continue.';
    if (step === 1) {
      return tasks.length === 0
        ? 'Add at least one task first.'
        : 'Give at least one task a name first.';
    }
    return '';
  }, [step, tasks.length]);

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
  }, [pickedProjectId, namedTaskCount, canAdvance]);

  const handleNext = useCallback(() => {
    if (!canAdvance) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setBlockHint(blockReason);
      return;
    }
    setBlockHint(null);
    if (step < 3) {
      setStep((step + 1) as StepIndex);
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
    }
  }, [step, canAdvance, blockReason]);

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
      // Both halves from ONE source, remapped together. `lagDays` used to be
      // hard-coded 0 here, which silently threw away every offset the preview
      // had just scheduled around — the saved plan was shorter than the one
      // the user approved.
      const { dependencies: deps, dependencyLinks } =
        remapDependencies(t, pid => idMap.get(pid) ?? pid);
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
    // Committed — the draft has done its job.
    void clearDraft();
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
        <Text style={styles.topBarTitle}>{documentMode ? 'New schedule' : 'Create Schedule'}</Text>
        {step === 3 || (isDesktop && step === 1) ? (
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

      {/* 7c — Desktop two-pane: tasks left, live Gantt right. TasksStep manages
          its own paired ScrollViews; the outer ScrollView handles all other steps
          and the phone flow unchanged. */}
      {isDesktop && step === 1 ? (
        <TasksStep
          activeId={pickedTemplateId}
          templates={SCHEDULE_TEMPLATES}
          onPickTemplate={handlePickTemplate}
          documentMode={documentMode}
          documentTitle={project ? `${project.name} schedule` : 'New schedule'}
          startDate={startDate}
          onEditProject={() => goToStep(0)}
          onBrowseTemplates={() => setTemplateSheetOpen(true)}
          onEditStartDate={() => setDatePickerOpen(true)}
          onQuickStart={(d) => setStartIso(toIsoDate(d))}
          tasks={tasks}
          setTasks={updateTasks}
          totalDays={totalDays}
          endDate={projectEndDate}
          focusTaskId={focusTaskId}
          setFocusTaskId={setFocusTaskId}
          onOpenPhasePicker={setPhaseFor}
          onOpenPredecessors={setPredFor}
          onDraggingChange={setDragging}
          savedAt={savedAt}
          restored={restored}
          onDiscardDraft={discardDraft}
          scheduledTasks={scheduledTasks}
          isDesktop={isDesktop}
          wideEnoughForPro={wideEnoughForPro}
        />
      ) : (
        /* keyboardShouldPersistTaps: the task list is full of TextInputs, and
           without this every tap on "+ Add task" / a chip while the keyboard is
           up is swallowed dismissing the keyboard instead. */
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          // A row being dragged owns the vertical gesture. Leaving the
          // ScrollView live means the list scrolls under the finger and the
          // drop lands nowhere near where it was aimed.
          scrollEnabled={!dragging}
        >
          {step === 0 && (
            <ProjectStep
              projects={projects}
              pickedId={pickedProjectId}
              // On the document path picking the job IS the whole step, so
              // answering it advances — no "Next" to hunt for.
              onPick={(id) => {
                setPickedProjectId(id);
                if (documentMode) {
                  setStep(1);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }
              }}
              documentMode={documentMode}
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
              documentMode={documentMode}
              documentTitle={project ? `${project.name} schedule` : 'New schedule'}
              startDate={startDate}
              onEditProject={() => goToStep(0)}
              onBrowseTemplates={() => setTemplateSheetOpen(true)}
              onEditStartDate={() => setDatePickerOpen(true)}
              onQuickStart={(d) => setStartIso(toIsoDate(d))}
              tasks={tasks}
              setTasks={updateTasks}
              totalDays={totalDays}
              endDate={projectEndDate}
              focusTaskId={focusTaskId}
              setFocusTaskId={setFocusTaskId}
              onOpenPhasePicker={setPhaseFor}
              onOpenPredecessors={setPredFor}
              onDraggingChange={setDragging}
              savedAt={savedAt}
              restored={restored}
              onDiscardDraft={discardDraft}
              scheduledTasks={scheduledTasks}
              isDesktop={isDesktop}
              wideEnoughForPro={wideEnoughForPro}
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
      )}

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

      {/* Mounted only while open so its draft selection is seeded from props
          at mount — no effect syncing state to props, no stale checkboxes. */}
      {predFor !== null && (() => {
        const idx = predFor;
        const task = tasks[idx];
        if (!task) return null;
        // Map wizard TemplateTask state to PredecessorPicker's public interface.
        const options = predecessorOptions(tasks, idx);
        const candidates = options.map((t, i) => ({
          id: t.id,
          label: `${i + 1}. ${taskName(t)}`,
          phase: t.phase,
        }));
        const value: PredecessorLink[] = task.predecessorIds.map(id => ({
          taskId: id,
          type: 'FS' as const,
          lagDays: task.lags?.[id] ?? 0,
        }));
        const prevTask = idx > 0 ? tasks[idx - 1] : null;
        const prevLinks: PredecessorLink[] | undefined = prevTask
          ? prevTask.predecessorIds.map(id => ({
            taskId: id,
            type: 'FS' as const,
            lagDays: prevTask.lags?.[id] ?? 0,
          }))
          : undefined;
        return (
          <PredecessorPicker
            key={`pred-${idx}`}
            taskLabel={taskName(task)}
            candidates={candidates}
            value={value}
            prevLinks={prevLinks}
            onClose={() => setPredFor(null)}
            onChange={(links) => {
              setPredFor(null);
              const ids = links.map(l => l.taskId);
              const lags: Record<string, number> = {};
              for (const l of links) {
                if (l.lagDays !== 0) lags[l.taskId] = l.lagDays;
              }
              // setPredecessors ends in repairChain, exactly like every other
              // write — the picker gets no special dispensation. setLags then
              // re-derives the offsets from whatever predecessors SURVIVED that
              // repair, so an id the picker offered but repairChain rejected
              // can't leave an offset behind.
              updateTasks(prev => setLags(setPredecessors(prev, idx, ids), idx, lags));
            }}
          />
        );
      })()}

      <TemplateSheet
        visible={templateSheetOpen}
        templates={SCHEDULE_TEMPLATES}
        activeId={pickedTemplateId}
        onClose={() => setTemplateSheetOpen(false)}
        onPick={(id) => {
          setTemplateSheetOpen(false);
          handlePickTemplate(id);
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

      {/* Bottom CTA. The mock uses a single big primary button; we mirror it.
          On desktop step 1 (two-pane) the user can save directly — the Gantt
          is always visible so they don't need to advance through Timeline/Review. */}
      <View style={[styles.bottomCta, { paddingBottom: insets.bottom + 12 }]}>
        {step === 3 || (isDesktop && step === 1) ? (
          <>
            {blockHint ? (
              <Text style={styles.blockHintText}>{blockHint}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.ctaBtn, !canAdvance && styles.ctaBtnDisabled]}
              onPress={onSavePressed}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAdvance }}
              testID="wizard-save"
            >
              <Check size={18} color={Colors.textOnAccent} strokeWidth={2.5} />
              <Text style={styles.ctaBtnText}>Save schedule</Text>
            </TouchableOpacity>
          </>
        ) : step < 3 ? (
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
        ) : null}
      </View>
    </View>
  );
}

// ── Step 1: Pick the project + set day 1 ──────────────────────────
//
// On the document path this step is usually SKIPPED entirely (one project ⇒
// nothing to ask). When it does appear it's a single question — "which job is
// this for?" — and answering it advances, so it reads as a question rather
// than a gate. Start date moves to the document header on the task list, where
// it's visible while you work instead of buried behind a step you walked past.
function ProjectStep(props: {
  projects: ReturnType<typeof useProjects>['projects'];
  pickedId: string;
  onPick: (id: string) => void;
  documentMode: boolean;
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
    projects, pickedId, onPick, documentMode, startDate, projectEndDate, totalDays,
    onEditStartDate, onQuickStart, onCreateProject,
  } = props;
  const picked = projects.find(p => p.id === pickedId);

  if (documentMode) {
    return (
      <View style={styles.stepContent}>
        <Text style={styles.askTitle}>Which job is this for?</Text>
        <Text style={styles.helper}>
          A schedule lives on a project. Pick one and start adding tasks — you
          can change the start date from the task list.
        </Text>
        <View style={{ gap: 8, marginTop: 4 }}>
          {projects.map(p => (
            <TouchableOpacity
              key={p.id}
              style={[styles.projectRow, p.id === pickedId && styles.projectRowActive]}
              onPress={() => onPick(p.id)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Build a schedule for ${p.name}`}
              testID={`wizard-project-${p.id}`}
            >
              <View style={[styles.projectDot, p.id === pickedId && { backgroundColor: themeColors.accent }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.projectName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.projectSub} numberOfLines={1}>
                  {displayText(p.location, 'No location')} · {p.type}
                </Text>
              </View>
              <ChevronRight size={17} color={themeColors.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          ))}
          {projects.length === 0 && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No projects yet</Text>
              <Text style={styles.helper}>
                A schedule belongs to a job. Create the project first — this
                builder will be waiting under Schedule.
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

// ── Step 2: The task list ─────────────────────────────────────────
//
// Two layouts, one component:
//   • template mode — "Choose a starting point" strip, then the list. The
//     original screen, unchanged.
//   • document mode (`scratch=1`) — the list IS the screen. No strip; the
//     document title, an empty row waiting for a name, and Add task. Templates
//     survive as a single text link BELOW the list, easy to ignore.
function TasksStep(props: {
  activeId: string;
  templates: ScheduleTemplate[];
  onPickTemplate: (id: string) => void;
  documentMode: boolean;
  documentTitle: string;
  startDate: Date;
  onEditProject: () => void;
  onBrowseTemplates: () => void;
  onEditStartDate: () => void;
  onQuickStart: (d: Date) => void;
  tasks: TemplateTask[];
  setTasks: (next: TemplateTask[] | ((prev: TemplateTask[]) => TemplateTask[])) => void;
  totalDays: number;
  endDate: Date;
  focusTaskId: string | null;
  setFocusTaskId: (id: string | null) => void;
  onOpenPhasePicker: (index: number) => void;
  onOpenPredecessors: (index: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  /** Autosave: epoch ms of the last write, null before the first one. */
  savedAt: number | null;
  /** True when this session resumed a draft from storage. */
  restored: boolean;
  onDiscardDraft: () => void;
  /** CPM-scheduled tasks for the live Gantt preview (desktop two-pane). */
  scheduledTasks: (TemplateTask & { startDay: number; endDay: number })[];
  /** True when the screen is wide enough for side-by-side panes. */
  isDesktop: boolean;
  wideEnoughForPro: boolean;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const {
    activeId, templates, onPickTemplate, documentMode, documentTitle, startDate,
    onEditProject, onBrowseTemplates, onEditStartDate, onQuickStart,
    tasks, setTasks, totalDays, endDate,
    focusTaskId, setFocusTaskId, onOpenPhasePicker, onOpenPredecessors,
    onDraggingChange, savedAt, restored, onDiscardDraft,
    scheduledTasks, isDesktop, wideEnoughForPro,
  } = props;
  const scratchActive = activeId === SCRATCH_ID;
  const wrapTemplates = width >= WRAP_TEMPLATES_WIDTH;
  const activeTemplate = templates.find(t => t.id === activeId);

  /** Insert a task below `index` (or at the end when index is null) and hand
   *  it the keyboard, so Add → type → Enter → type is one unbroken rhythm.
   *  Unnamed on purpose: a placeholder beats a literal "New Task" you have to
   *  delete before you can type. */
  const addTask = useCallback((index: number | null) => {
    const fresh = blankTask();
    setTasks(prev => insertTaskAt(prev, index === null ? prev.length : index + 1, fresh));
    setFocusTaskId(fresh.id);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [setTasks, setFocusTaskId]);

  // ── Drag-to-reorder ────────────────────────────────────────────
  // Heights live in a ref, keyed by task ID rather than by row position:
  //   • a ref, because onLayout fires constantly and re-rendering the list to
  //     record a height it already had would fight the keyboard;
  //   • keyed by ID, because a reorder renumbers every row below the move, and
  //     a positional cache would then hand the NEXT drag the wrong geometry.
  const heightsRef = useRef<Record<string, number>>({});
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const dragFromRef = useRef<number | null>(null);
  const dragToRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragHeight, setDragHeight] = useState(0);

  /** Current heights in list order — what the drop math wants. */
  const rowHeights = useCallback(
    () => tasksRef.current.map(t => heightsRef.current[t.id] ?? 0),
    [],
  );

  React.useEffect(() => {
    const live = new Set(tasks.map(t => t.id));
    for (const id of Object.keys(heightsRef.current)) {
      if (!live.has(id)) delete heightsRef.current[id];
    }
  }, [tasks]);

  const handleMeasure = useCallback((i: number, h: number) => {
    const id = tasksRef.current[i]?.id;
    if (id) heightsRef.current[id] = h;
  }, []);

  const handleGrab = useCallback((i: number) => {
    dragFromRef.current = i;
    dragToRef.current = i;
    setDragIndex(i);
    setDropIndex(i);
    setDragHeight(rowHeights()[i] ?? 0);
    onDraggingChange(true);
  }, [onDraggingChange, rowHeights]);

  const handleDrag = useCallback((dy: number) => {
    const from = dragFromRef.current;
    if (from === null) return;
    const next = dropTargetIndex(from, dy, rowHeights(), TASK_ROW_GAP);
    if (next === dragToRef.current) return;
    dragToRef.current = next;
    setDropIndex(next);
    // A tick each time the row crosses a boundary — the drop is then something
    // you feel land rather than something you have to watch.
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [rowHeights]);

  const handleDrop = useCallback(() => {
    const from = dragFromRef.current;
    const to = dragToRef.current;
    dragFromRef.current = null;
    dragToRef.current = null;
    setDragIndex(null);
    setDropIndex(null);
    onDraggingChange(false);
    if (from === null || to === null || from === to) return;
    // moveTask → repairChain. A drag is the up/down arrows, just faster: it
    // cannot reach a state the arrows can't, so the mid-list move that used to
    // orphan every successor of the moved row can't come back through here.
    setTasks(prev => moveTask(prev, from, to));
  }, [setTasks, onDraggingChange]);

  // Built only on the template path — the document path never renders the
  // strip, and there's no point constructing nine cards to throw away.
  const templateCards = documentMode ? null : (
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

  // The task list + inline date pane — shared by both phone (single-column) and
  // desktop left pane. Extracted so the two-pane layout can place it in a View
  // with a fixed left flex without duplicating the JSX.
  const taskListPane = (
    <View style={isDesktop ? styles.desktopLeftPane : styles.stepContent}>
      {documentMode ? (
        // The "file" header. Says what this document is and which job it
        // belongs to, without asking anything.
        <View style={styles.docHead}>
          <Text style={styles.docTitle} numberOfLines={2}>{documentTitle}</Text>
          <View style={styles.docMetaRow}>
            <CalendarIcon size={12} color={themeColors.textMuted} strokeWidth={1.9} />
            <Text style={styles.docMeta}>Starts {fmtShort(startDate)}</Text>
            <Text style={styles.docMeta}>·</Text>
            <TouchableOpacity
              onPress={onEditProject}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 4 }}
              accessibilityRole="button"
              accessibilityLabel="Change the project or start date for this schedule"
              testID="wizard-doc-settings"
            >
              <Text style={styles.docMetaLink}>Change project or date</Text>
            </TouchableOpacity>
            {savedAt != null ? (
              <>
                <Text style={styles.docMeta}>·</Text>
                <Text style={styles.docMeta}>{savedAgoLabel(savedAt, Date.now())}</Text>
              </>
            ) : null}
          </View>
          {restored ? (
            // Autosave restored work from a previous session. Say so plainly
            // and give an obvious way out — silently resurrecting a draft the
            // user has moved on from is its own kind of data loss.
            <View style={styles.restoreRow}>
              <Text style={styles.restoreText}>Picked up where you left off.</Text>
              <TouchableOpacity
                onPress={onDiscardDraft}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Discard the restored draft and start a fresh schedule"
                testID="wizard-discard-draft"
              >
                <Text style={styles.docMetaLink}>Start fresh</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>Choose a starting point</Text>
          {wrapTemplates ? (
            // Desktop web: a horizontal ScrollView can't be dragged with a
            // mouse and doesn't take the wheel, so everything past the third
            // card was simply unreachable. Wrap instead.
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
        </>
      )}

      {/* 7b — Inline start date. Visible in the Tasks step so the user can set
          the CPM anchor here without having to advance to Timeline. The Timeline
          step (Step 3) still shows and allows date changes too. */}
      <StartDateField
        startDate={startDate}
        onEdit={onEditStartDate}
        onQuickStart={onQuickStart}
      />

      <View style={[styles.tasksHeadRow, documentMode && styles.tasksHeadRowTight]}>
        <Text style={[styles.sectionLabel, { marginTop: 0 }]}>Tasks ({tasks.length})</Text>
        {tasks.length > 0 && (
          <Text style={styles.tasksHeadTotal}>
            {totalDays} day{totalDays === 1 ? '' : 's'} · ends {fmtShort(endDate)}
          </Text>
        )}
      </View>

      {tasks.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>This schedule is empty</Text>
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
            <Text style={styles.emptyBtnText}>Add a task</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.helper}>
          Name + duration is enough · tap Refine ▾ to set phase or sequence ·
          drag the handle or use arrows to reorder · 0 days = milestone
        </Text>
      )}

      <View style={{ gap: TASK_ROW_GAP }}>
        {tasks.map((t, idx) => (
          <TaskRowDrag
            key={t.id}
            index={idx}
            activeIndex={dragIndex}
            targetIndex={dropIndex}
            activeHeight={dragHeight}
            gap={TASK_ROW_GAP}
            onMeasure={handleMeasure}
            onGrab={handleGrab}
            onDrag={handleDrag}
            onDrop={handleDrop}
          >
            {(handle) => (
              <TaskRow
                task={t}
                index={idx}
                tasks={tasks}
                dragHandle={handle}
                autoFocus={t.id === focusTaskId}
                onFocused={() => setFocusTaskId(null)}
                onRename={(name) => setTasks(prev => prev.map((x, i) => (i === idx ? { ...x, name } : x)))}
                onDuration={(days) => setTasks(prev => setTaskDuration(prev, idx, days))}
                onOpenPredecessors={() => onOpenPredecessors(idx)}
                onOpenPhase={() => onOpenPhasePicker(idx)}
                onMove={(delta) => setTasks(prev => moveTask(prev, idx, idx + delta))}
                onRemove={() => setTasks(prev => removeTaskAt(prev, idx))}
                onSubmit={() => addTask(idx)}
              />
            )}
          </TaskRowDrag>
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

      {documentMode && (
        // Deliberately the LAST thing on the screen, in body-text weight, with
        // no card around it. Templates are available; they are not the offer.
        <TouchableOpacity
          style={styles.templateLink}
          onPress={onBrowseTemplates}
          activeOpacity={0.7}
          accessibilityRole="button"
          testID="wizard-template-link"
        >
          <LayoutTemplate size={14} color={themeColors.textMuted} strokeWidth={1.9} />
          <Text style={styles.templateLinkText}>
            {scratchActive
              ? 'or start from a template'
              : `Started from ${activeTemplate?.name ?? 'a template'} — change`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // 7c — Desktop two-pane: task list left, live timeline right.
  // On phone the stepped flow is untouched — taskListPane IS the render.
  if (isDesktop) {
    return (
      <View style={styles.desktopTwoPaneRow}>
        <ScrollView
          style={{ flex: 1.2 }}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          // dragIndex !== null means a row is being dragged — disable scroll
          // while it's active so the list doesn't scroll under the finger.
          scrollEnabled={dragIndex === null}
        >
          {taskListPane}
        </ScrollView>

        {/* Right pane: live Gantt — updates as tasks/dates change. */}
        <ScrollView
          style={styles.desktopRightPane}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          <ScheduleStep
            scheduledTasks={scheduledTasks}
            startDate={startDate}
            totalDays={totalDays}
            wideEnoughForPro={wideEnoughForPro}
            onEditStartDate={onEditStartDate}
            hideDateRow
          />
        </ScrollView>
      </View>
    );
  }

  return taskListPane;
}

// ── One editable task row ─────────────────────────────────────────
function TaskRow(props: {
  task: TemplateTask;
  index: number;
  tasks: TemplateTask[];
  dragHandle: TaskDragHandle;
  autoFocus: boolean;
  onFocused: () => void;
  onRename: (name: string) => void;
  onDuration: (days: number) => void;
  onOpenPredecessors: () => void;
  onOpenPhase: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onSubmit: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {
    task: t, index: idx, tasks, dragHandle, autoFocus, onFocused, onRename,
    onDuration, onOpenPredecessors, onOpenPhase, onMove, onRemove, onSubmit,
  } = props;
  const phaseColor = PHASE_COLORS[t.phase] ?? PHASE_COLORS.General;
  const mode = readLinkMode(tasks, idx);
  // A row carrying an offset is NOT the same relationship as a plain link, so
  // it doesn't get to wear the plain link's icon — otherwise "Alongside Demo"
  // and "2 days after Demo" are visually identical at a glance down the list.
  const offset = t.predecessorIds.some(p => getLag(t, p) !== 0);
  const LinkIcon =
    offset ? Timer :
    mode === 'after' ? CornerDownRight :
    mode === 'start' ? Flag :
    mode === 'with' ? GitBranch :
    GitMerge; // 'custom' — waits on a set of upstream tasks
  const first = idx === 0;
  const last = idx === tasks.length - 1;

  // 7a — per-row "Refine ▾" disclosure. Local state; collapses when a new
  // row is added so the list stays compact as the user types through it.
  const [refined, setRefined] = useState(false);

  return (
    <View style={[styles.taskRow, dragHandle.dragging && styles.taskRowDragging]}>
      {/* Top row: drag handle · name · duration stepper · up/down · remove */}
      <View style={styles.taskTopRow}>
        {/* Grab area. The number badge doubles as the grip so the row doesn't
            grow a sixth control; PanResponder is scoped to THIS view so the
            name field and the page scroll keep working normally. */}
        <View
          {...dragHandle.panHandlers}
          style={[styles.dragHandle, dragHandle.webStyle]}
          accessible
          accessibilityLabel={`Task ${idx + 1} of ${tasks.length}. Drag to reorder.`}
          testID={`task-drag-${idx}`}
        >
          <GripVertical size={14} color={themeColors.textMuted} strokeWidth={1.9} />
          <View style={[styles.taskIndex, { backgroundColor: phaseColor + '22', borderColor: phaseColor }]}>
            <Text style={[styles.taskIndexText, { color: phaseColor }]}>{idx + 1}</Text>
          </View>
        </View>
        <TextInput
          value={t.name}
          onChangeText={onRename}
          onFocus={onFocused}
          autoFocus={autoFocus}
          // Only the just-created row select-alls. Doing it on every focus
          // would make one stray keystroke wipe a name the user already typed.
          selectTextOnFocus={autoFocus}
          onSubmitEditing={onSubmit}
          returnKeyType="next"
          style={styles.taskName}
          placeholder="Task name"
          placeholderTextColor={themeColors.textMuted}
          accessibilityLabel={`Task ${idx + 1} name`}
          testID={`task-name-${idx}`}
        />

        {/* Duration stepper — always visible; phase/sequence move under Refine. */}
        <View style={styles.durBox}>
          <TouchableOpacity
            onPress={() => onDuration(t.duration - 1)}
            hitSlop={{ top: 10, right: 6, bottom: 10, left: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Shorten ${taskName(t)}`}
            testID={`task-minus-${idx}`}
          >
            <Minus size={15} color={t.duration === 0 ? themeColors.textMuted : themeColors.text} strokeWidth={2.25} />
          </TouchableOpacity>
          <DurationField value={t.duration} onCommit={onDuration} index={idx} />
          <TouchableOpacity
            onPress={() => onDuration(t.duration + 1)}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 6 }}
            accessibilityRole="button"
            accessibilityLabel={`Lengthen ${taskName(t)}`}
            testID={`task-plus-${idx}`}
          >
            <Plus size={15} color={themeColors.text} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => onMove(-1)}
          disabled={first}
          hitSlop={{ top: 10, right: 4, bottom: 10, left: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Move ${taskName(t)} up`}
          testID={`task-up-${idx}`}
        >
          <ChevronUp size={17} color={first ? themeColors.line : themeColors.textSecondary} strokeWidth={2.25} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onMove(1)}
          disabled={last}
          hitSlop={{ top: 10, right: 4, bottom: 10, left: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Move ${taskName(t)} down`}
          testID={`task-down-${idx}`}
        >
          <ChevronDown size={17} color={last ? themeColors.line : themeColors.textSecondary} strokeWidth={2.25} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 10, right: 8, bottom: 10, left: 6 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${taskName(t)}`}
          testID={`task-remove-${idx}`}
        >
          <Trash2 size={16} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      {/* 7a — Refine ▾ disclosure. Phase + sequence live here; not required to
          add a task or advance a step. Opens per-row, collapses independently. */}
      <TouchableOpacity
        style={styles.refineToggle}
        onPress={() => setRefined(r => !r)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={refined ? 'Collapse refine options' : 'Expand refine options: phase and sequence'}
        testID={`task-refine-${idx}`}
      >
        <Text style={styles.refineToggleText}>Refine</Text>
        {refined
          ? <ChevronUp size={13} color={themeColors.textMuted} strokeWidth={2} />
          : <ChevronDown size={13} color={themeColors.textMuted} strokeWidth={2} />}
      </TouchableOpacity>

      {refined && (
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

          {/* Sequence chip. Opens the multi-predecessor picker so any subset of
              earlier rows can be expressed — not just three fixed states. */}
          <TouchableOpacity
            style={[styles.linkChip, first && styles.linkChipStatic]}
            onPress={onOpenPredecessors}
            disabled={first}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={
              first
                ? 'This is the first task, so it starts on day 1.'
                : `${sequenceDetail(tasks, t.predecessorIds, t.lags)}. Tap to choose which tasks this one waits on, and how long after each.`
            }
            testID={`task-link-${idx}`}
          >
            <LinkIcon size={13} color={themeColors.textSecondary} strokeWidth={2} />
            <Text style={styles.chipText} numberOfLines={1}>{sequenceLabel(tasks, idx)}</Text>
          </TouchableOpacity>
        </View>
      )}
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

// ── Template browser (document path, opt-in) ──────────────────────
// The template strip used to be the first thing on this step even when the
// user explicitly asked for a blank schedule. It lives here now: reachable in
// one tap from a text link under the list, invisible until asked for.
function TemplateSheet(props: {
  visible: boolean;
  templates: ScheduleTemplate[];
  activeId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { visible, templates, activeId, onClose, onPick } = props;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Start from a template</Text>
              <Text style={styles.sheetSub}>Replaces the tasks you have now</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={19} color={themeColors.textMuted} strokeWidth={1.9} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={[styles.predOption, activeId === SCRATCH_ID && styles.predOptionActive]}
              onPress={() => onPick(SCRATCH_ID)}
              activeOpacity={0.7}
              accessibilityRole="button"
              testID="template-option-scratch"
            >
              <PencilRuler size={17} color={activeId === SCRATCH_ID ? themeColors.accent : themeColors.textMuted} strokeWidth={1.9} />
              <View style={{ flex: 1 }}>
                <Text style={styles.predOptionText}>Empty schedule</Text>
                <Text style={styles.templateSub}>Build your own</Text>
              </View>
              {activeId === SCRATCH_ID && <Check size={16} color={themeColors.accent} strokeWidth={2.5} />}
            </TouchableOpacity>
            {templates.map(tpl => {
              const Icon = TEMPLATE_ICONS[tpl.id] ?? Hammer;
              const active = tpl.id === activeId;
              return (
                <TouchableOpacity
                  key={tpl.id}
                  style={[styles.predOption, active && styles.predOptionActive]}
                  onPress={() => onPick(tpl.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  testID={`template-option-${tpl.id}`}
                >
                  <Icon size={17} color={active ? themeColors.accent : themeColors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.predOptionText}>{tpl.name}</Text>
                    <Text style={styles.templateSub}>{tpl.taskCount} tasks · {tpl.typicalDuration}</Text>
                  </View>
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
  hideDateRow?: boolean;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const { scheduledTasks, startDate, totalDays, wideEnoughForPro, onEditStartDate, hideDateRow } = props;
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

      {!hideDateRow && (
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
      )}

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
  // "Which job is this for?" — a question, not a step header. Used only on
  // the document path, where this screen is the single thing being asked.
  askTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.3,
  },

  // ── Document header ───────────────────────────────────────────
  // Stands in for the whole project step once it's been skipped: says what
  // this file is, which job owns it, and when it starts — all editable, none
  // of it blocking.
  docHead: { gap: 4, marginBottom: 4 },
  docTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: t.text,
    letterSpacing: -0.5,
  },
  docMetaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  docMeta: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
  },
  restoreRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 6,
  },
  restoreText: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
  },
  docMetaLink: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
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
    backgroundColor: t.accentFill,
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
  // No template strip above it on the document path, so the list starts high.
  tasksHeadRowTight: { marginTop: 8 },
  // Templates as a footnote, not an offer: text weight, no card, last thing
  // on the screen.
  templateLink: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 14,
    marginTop: 4,
  },
  templateLinkText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textMuted,
    textDecorationLine: 'underline' as const,
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
  // Lifted off the list while dragged, so it's obvious which row is moving.
  taskRowDragging: {
    borderColor: t.accent,
    backgroundColor: t.surfaceAlt,
  },
  // The grip + number badge, together, are the grab area. Vertical padding
  // makes it a real touch target without changing the row's height.
  dragHandle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
    paddingVertical: 6,
    paddingRight: 2,
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
  // 7a — "Refine ▾" per-row disclosure toggle. Compact so it reads as a
  // secondary action rather than competing with Name/Duration for attention.
  refineToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  refineToggleText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: t.textMuted,
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

  // 7c — Desktop two-pane layout: task list (left, flex 1.2) + live Gantt
  // (right, flex 1). Both panes scroll independently. On phone this is unused
  // and the phone stepped flow is unchanged.
  desktopTwoPaneRow: {
    flexDirection: 'row' as const,
    flex: 1,
  },
  desktopLeftPane: {
    flex: 1,
    paddingHorizontal: Tokens.spacing.md,
    paddingTop: 12,
    gap: 12,
  },
  desktopRightPane: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: t.line,
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
  sheetSub: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },

  // ── Shared option row styles — used by TemplateSheet ────────────
  // (PredecessorPicker has its own copy of these in components/schedule/PredecessorPicker.tsx)
  predOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.md,
  },
  predOptionActive: { backgroundColor: t.accent + '10' },
  predOptionText: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
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
    backgroundColor: t.accentFill,
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
    backgroundColor: t.accentFill,
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
