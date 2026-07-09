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
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Platform, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Activity, Share2, Undo2, Redo2, Columns, Table2, BarChart2, RefreshCcw, Bookmark, Download, CalendarX, Settings, Users, FileText, Mic, CalendarPlus, Map as MapIcon, CloudRain } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { exportProjectIcs } from '@/utils/icsGenerator';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import GridPane from '@/components/schedule/GridPane';
import InteractiveGantt from '@/components/schedule/InteractiveGantt';
import { SchedulerTabShell } from '@/components/schedule/SchedulerTabShell';
import AIAssistantPanel from '@/components/schedule/AIAssistantPanel';
import ClosuresModal from '@/components/schedule/ClosuresModal';
import WeatherRescheduleModal from '@/components/schedule/WeatherRescheduleModal';
import ScheduleSettingsMenu from '@/components/schedule/ScheduleSettingsMenu';
import BaselineManagerModal from '@/components/schedule/BaselineManagerModal';
import TaskInspector from '@/components/schedule/TaskInspector';
import { AddTaskModal, type NewTaskValues } from '@/components/schedule/AddTaskModal';
import ResourceSwimlanes from '@/components/schedule/ResourceSwimlanes';
import VoiceCommandModal from '@/components/VoiceCommandModal';
import { ScheduleHealthBadge, ScheduleHealthDetail } from '@/components/schedule/ScheduleHealthScore';
import { ExportSheet } from '@/components/schedule/ExportSheet';
import { computeScheduleHealthScore } from '@/utils/scheduleHealthScore';
import { EarnedValuePanel } from '@/components/schedule/EarnedValuePanel';
import { buildEarnedValueSnapshot } from '@/utils/scheduleEarnedValue';
import { WeatherReschedulePrompt } from '@/components/schedule/WeatherReschedulePrompt';
import { getSimulatedForecast } from '@/utils/weatherService';
import { computeWeatherReschedule, buildWeatherDelayLog, type WeatherRescheduleResult } from '@/utils/weatherReschedule';
import { SubUpdatesPanel } from '@/components/schedule/SubUpdatesPanel';
import { LivingFloorPlan } from '@/components/schedule/mobile/LivingFloorPlan';
import { PlanZoneEditor } from '@/components/schedule/mobile/PlanZoneEditor';
import { exportSchedulePdf, type SchedulePdfPaperSize } from '@/utils/exportSchedulePdf';
import { runCpm, workingDaysBetween, type CpmResult } from '@/utils/cpm';
import {
  emptyHistory,
  pushHistory,
  undo as histUndo,
  redo as histRedo,
  canUndo,
  canRedo,
  type HistoryState,
} from '@/utils/scheduleHistory';
import { resolveCalendarForTask } from '@/utils/scheduleResourceCalendars';
import {
  countStaleLinkedEstimateItems, pruneStaleLinkedEstimateItems,
} from '@/utils/scheduleEarnedValue';
import type { CpmResult as ContextCpmResult } from '@/components/schedule/SchedulerContext';
import { computeSummaryRollup } from '@/utils/summaryRollup';
import { appendAuditToAsyncStorage, buildAuditEntry, summarizeTaskDiff } from '@/utils/scheduleAudit';
import { buildScheduleFromTasks, createId, generateWbsCodes } from '@/utils/scheduleEngine';
import { seedDemoSchedule } from '@/utils/demoSchedule';
import {
  reflowFromActuals,
  applyBaselineToTasks,
  baselineFinishDayWorkingScale,
  exportTasksToCsv,
  downloadCsvInBrowser,
  encodeShareToken,
  buildSharePayload,
  ShareTokenTooLargeError,
  tryEncodeShareToken,
  type NamedBaseline,
} from '@/utils/scheduleOps';
import { loadSubUpdates } from '@/utils/subScheduleUpdatesStorage';
import { supabase } from '@/lib/supabase';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Desktop/tablet-landscape breakpoint. Below this we send users to the
// classic mobile experience — the grid is genuinely unusable under 900px.
const GRID_BREAKPOINT = 900;
// Above this we auto-open the split view (grid + gantt side by side). Below,
// we default to grid alone because 1200px of timeline next to a 1170px grid
// means the gantt gets ~30px of width — useless.
const SPLIT_BREAKPOINT = 1600;

type PaneMode = 'grid' | 'split' | 'gantt' | 'resources' | 'living';

export default function ScheduleProScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  // Re-read tier access inside the inner so the PDF handler can guard
  // on the narrower `schedule_gantt_pdf` feature flag directly (the outer
  // gate covers full Schedule Pro access — this is the export-specific
  // gate should we split the bundle in the future).
  const { canAccess } = useTierAccess();
  const { user } = useAuth();

  const {
    projects,
    updateProject,
    getInvoicesForProject,
    getPlanSheetsForProject,
    getPlanZonesForProject,
    getPinsForPlan,
    getPhotosForProject,
  } = useProjects();

  const project = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId],
  );

  // Local working copy so the grid feels instant; we debounce persistence.
  // The undo/redo stacks live in a single HistoryState via the pure,
  // unit-tested reducer in @/utils/scheduleHistory. `workingTasks` is the
  // live present — deriving it (rather than a separate useState) guarantees
  // the task state and the undo stacks can never drift out of sync.
  const [hist, setHist] = useState<HistoryState<ScheduleTask[]>>(
    () => emptyHistory(project?.schedule?.tasks ?? []),
  );
  const workingTasks = hist.present;

  // Pane mode: which view(s) to render. Defaults based on width; user can
  // override via the segmented control in the header.
  const [paneMode, setPaneMode] = useState<PaneMode>(() =>
    width >= SPLIT_BREAKPOINT ? 'split' : 'grid',
  );
  // Bumped on every paneMode-button press. SchedulerTabShell uses this to
  // force the active tab back to 'gantt' whenever the user clicks Grid /
  // Split / Gantt in the top toolbar — so the user sees the sub-mode change
  // even if they were on Board / List / Dashboard.
  const [paneModeNonce, setPaneModeNonce] = useState(0);
  const setPaneModeAndForceGantt = useCallback((mode: PaneMode) => {
    setPaneMode(mode);
    if (mode !== 'resources') setPaneModeNonce(n => n + 1);
  }, []);

  // AI assistant drawer (right-side slide-out).
  const [showAI, setShowAI] = useState(false);
  const [showClosures, setShowClosures] = useState(false);
  const [showWeather, setShowWeather] = useState(false);
  const [weatherResult, setWeatherResult] = useState<WeatherRescheduleResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showBaselineManager, setShowBaselineManager] = useState(false);
  // Voice → schedule mutations. Tap mic, speak ("push framing by 3 days"),
  // executor mutates via handleEdit. Closes the loop on the field-side
  // wedge — Houzz Pro is the only competitor with voice-to-schedule and
  // theirs only creates, doesn't mutate.
  const [showVoice, setShowVoice] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [exportSheetOpen, setExportSheetOpen] = useState(false);
  // Add Task modal — replaces the silent "create a task called 'New task'
  // with defaults" flow. Opens from the SchedulerHeader's "+ Add Task"
  // button (and any other onAddTask caller).
  const [showAddTask, setShowAddTask] = useState(false);
  const [showLivingPlanEditor, setShowLivingPlanEditor] = useState(false);

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
    // Full reload for a new project — reset the undo/redo stacks entirely.
    setHist(emptyHistory(project?.schedule?.tasks ?? []));
    setNamedBaselines((project?.schedule?.baselines ?? []) as NamedBaseline[]);
  }, [project?.id]);

  // Mirror baselines into the ref used by schedulePersist. Without this, the
  // next debounced write sees the stale list and silently drops captures.
  useEffect(() => {
    baselinesRef.current = namedBaselines;
  }, [namedBaselines]);

  // Mirror workingTasks into a ref so the unmount-flush closure (which only
  // re-binds on cpm.projectFinish changes) always reads the latest copy.
  // Addresses audit bug #7 — the closure-staleness race where a final
  // keystroke between the last debounce timer and unmount could be lost.
  useEffect(() => {
    workingTasksRef.current = workingTasks;
  }, [workingTasks]);

  // -------------------------------------------------------------------------
  // CPM + persistence
  // -------------------------------------------------------------------------

  // CPM honors anchors (via scheduleStartDate) and the user-configured
  // critical-float threshold so "near-critical" tasks can glow red too.
  const scheduleStartIso = project?.schedule?.startDate;
  const criticalFloatThresholdDays = project?.schedule?.criticalFloatThresholdDays ?? 0;
  // Summary rollup — derive summary-row dates/progress from their children
  // before running CPM. This keeps the WBS tree honest: editing a child
  // auto-updates the summary's span, the same way MS Project's outline does.
  const rolledTasks = useMemo(() => computeSummaryRollup(workingTasks), [workingTasks]);
  // v2.2c — per-task calendar map for tasks with resourceIds that resolve
  // to a non-project calendar. Tasks not in the map fall back to the
  // project-level workingDaysPerWeek + nonWorkingDates inside runCpm.
  const taskCalendars = useMemo(() => {
    if (!project?.schedule) return undefined;
    const map = new Map<string, { workingDaysPerWeek: number; closures: string[] }>();
    for (const task of rolledTasks) {
      if (!task.resourceIds || task.resourceIds.length === 0) continue;
      const resolved = resolveCalendarForTask(task, project.schedule);
      // Only add when it differs from project default — keeps map small
      // and lets the engine's project-level path stay hot.
      if (resolved.source !== 'project') {
        map.set(task.id, {
          workingDaysPerWeek: resolved.workingDaysPerWeek,
          closures: resolved.closures,
        });
      }
    }
    return map.size > 0 ? map : undefined;
  }, [rolledTasks, project?.schedule]);

  const cpm: CpmResult = useMemo(
    () => runCpm(rolledTasks, {
      scheduleStartDate: scheduleStartIso,
      criticalFloatThresholdDays,
      // v2.2b — thread project calendar so EF/LS skip weekends + closures.
      workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
      nonWorkingDates: project?.schedule?.nonWorkingDates,
      // v2.2c — per-task calendar overrides for resource-assigned tasks.
      taskCalendars,
    }),
    [
      rolledTasks,
      scheduleStartIso,
      criticalFloatThresholdDays,
      project?.schedule?.workingDaysPerWeek,
      project?.schedule?.nonWorkingDates,
      taskCalendars,
    ],
  );

  // Active baseline finish day — the "as-planned" finish we measure slip
  // against. Convention matches BaselineManagerModal's `activeBaselineId`
  // (the most recently captured baseline is the active one).
  //
  // Baseline rows persist a RAW endDay (startDay + dur - 1, no weekend/closure
  // skipping — see captureBaseline). Taking max(endDay) directly would put the
  // baseline finish on a different scale than the working-day-aware
  // cpm.projectFinish, fabricating phantom slip on the default 5-day week even
  // for an UNCHANGED schedule right after capture. Instead we re-derive the
  // finish in WORKING-DAY space using the SAME calendar the live CPM uses. This
  // also corrects baselines already persisted with a raw endDay (the recompute
  // ignores the raw endDay's scale, deriving duration from it). Null when no
  // baseline exists.
  const baselineFinishDay = useMemo<number | null>(() => {
    const active = namedBaselines.length > 0
      ? namedBaselines[namedBaselines.length - 1]
      : null;
    if (!active) return null;
    return baselineFinishDayWorkingScale(active, {
      scheduleStartDate: scheduleStartIso,
      workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
      nonWorkingDates: project?.schedule?.nonWorkingDates,
      taskCalendars,
    });
  }, [
    namedBaselines,
    scheduleStartIso,
    project?.schedule?.workingDaysPerWeek,
    project?.schedule?.nonWorkingDates,
    taskCalendars,
  ]);

  // SchedulerContext-shaped CPM summary for the tab shell's SchedulerProvider.
  // Maps from the richer utils/cpm CpmResult to the leaner context shape.
  // slipDaysVsBaseline = current CPM finish minus the active baseline finish,
  // measured in WORKING days on the project calendar (so a weekend between
  // the two finishes doesn't inflate the number). Positive = behind/slip,
  // negative = ahead. When there is no baseline to compare against we report
  // null so consumers can render a neutral "No baseline" state rather than
  // fabricating "On baseline."
  const contextCpm = useMemo<ContextCpmResult>(() => {
    const slip = baselineFinishDay == null
      ? null
      : workingDaysBetween(baselineFinishDay, cpm.projectFinish, {
          scheduleStartDate: scheduleStartIso,
          workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
          nonWorkingDates: project?.schedule?.nonWorkingDates,
        });
    return {
      criticalPathDays: cpm.projectFinish,
      slipDaysVsBaseline: slip,
      criticalTaskIds: cpm.criticalPath,
    };
  }, [
    cpm.projectFinish,
    cpm.criticalPath,
    baselineFinishDay,
    scheduleStartIso,
    project?.schedule?.workingDaysPerWeek,
    project?.schedule?.nonWorkingDates,
  ]);

  // v2.3 wedge B — sub daily updates → master task.progress rollup.
  // Max-only guard: never decrease (a GC who set 80% locally shouldn't
  // see it drop because a sub said 60%). The SubUpdatesPanel shows the
  // underlying updates as the source of truth; this effect just keeps
  // the Gantt bar honest.
  //
  // Loads sub updates once per project — the functional setHist updater
  // reads the latest task state (h.present) without needing workingTasks in
  // deps. The `mutated` flag short-circuits no-op renders so the effect
  // is cheap even when there are no new updates.
  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    void (async () => {
      const subUpdates = await loadSubUpdates(project.id);
      if (cancelled || subUpdates.length === 0) return;
      // Latest update per task wins (highest progressPercent).
      const latestByTask = new Map<string, number>();
      for (const u of subUpdates) {
        const prev = latestByTask.get(u.taskId) ?? 0;
        if (u.progressPercent > prev) latestByTask.set(u.taskId, u.progressPercent);
      }
      // Non-undoable refresh (progress rolled up from sub updates): replace
      // the present in place without touching the undo/redo stacks — matches
      // the pre-reducer behavior which bypassed the history snapshot.
      setHist(h => {
        const prev = h.present;
        let mutated = false;
        const next = prev.map(t => {
          const rollup = latestByTask.get(t.id);
          if (rollup != null && rollup > (t.progress ?? 0)) {
            mutated = true;
            return { ...t, progress: rollup };
          }
          return t;
        });
        return mutated ? { ...h, present: next } : h;
      });
    })();
    return () => { cancelled = true; };
  }, [project?.id]);

  // Schedule health score — pure compute over current tasks + cpm.
  // Cheap to recompute on every edit.
  const healthScore = useMemo(
    () => computeScheduleHealthScore({ tasks: rolledTasks, cpm }),
    [rolledTasks, cpm],
  );

  // Earned-value snapshot — turns the linked-estimate per-task carry into
  // PV/EV/SPI. The day-cursor approximates "today" relative to project
  // start so PV is the rolling sum of "should be earned by now."
  const dayCursor = useMemo(() => {
    if (!project?.createdAt) return 1;
    const start = new Date(project.createdAt).getTime();
    const now = Date.now();
    if (now <= start) return 1;
    return Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1;
  }, [project?.createdAt]);
  // Project invoices feed the Actual Cost leg of EVM (CPI calc).
  const projectInvoices = useMemo(
    () => project?.id ? getInvoicesForProject(project.id) : [],
    [project?.id, getInvoicesForProject],
  );
  const evSnapshot = useMemo(
    () => buildEarnedValueSnapshot(
      rolledTasks,
      project?.linkedEstimate ?? undefined,
      { dayCursor, invoices: projectInvoices },
    ),
    [rolledTasks, project?.linkedEstimate, dayCursor, projectInvoices],
  );

  // v2.4 (audit Item 5) — Count stale linkedEstimateItems references so
  // the cleanup banner can surface when > 0. Cheap O(N tasks × M refs);
  // memoized over the same deps as evSnapshot.
  const staleEstimateRefCount = useMemo(
    () => countStaleLinkedEstimateItems(rolledTasks, project?.linkedEstimate ?? undefined),
    [rolledTasks, project?.linkedEstimate],
  );

  const handleCleanupStaleRefs = useCallback(() => {
    if (!project?.linkedEstimate || staleEstimateRefCount === 0) return;
    Alert.alert(
      'Clean up stale estimate references?',
      `${staleEstimateRefCount} reference${staleEstimateRefCount === 1 ? '' : 's'} on schedule tasks point to estimate items that no longer exist. Cleaning up will remove the dead IDs from each task's linkedEstimateItems. The tasks themselves keep working — they just won't carry budget from those missing items.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clean up',
          style: 'destructive',
          onPress: () => {
            const { cleanedTasks, removed } = pruneStaleLinkedEstimateItems(
              workingTasks,
              project.linkedEstimate ?? undefined,
            );
            // Non-undoable maintenance edit (matches pre-reducer behavior,
            // which set workingTasks directly without a history snapshot).
            setHist(h => ({ ...h, present: cleanedTasks }));
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Toast handled by the cleanup banner re-rendering with count=0
            // — no extra UI needed.
            void removed;
          },
        },
      ]
    );
  }, [project, staleEstimateRefCount, workingTasks]);

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
  // Ref-mirror of workingTasks used by the unmount-flush cleanup. The
  // cleanup only re-binds when cpm.projectFinish changes, so without this
  // ref a keystroke applied after the most recent debounce timer but
  // before unmount could be lost (audit bug #7). Sync useEffect lives
  // alongside the baselinesRef sync above.
  const workingTasksRef = React.useRef<ScheduleTask[]>([]);
  const schedulePersist = useCallback((tasks: ScheduleTask[]) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      if (!project) return;
      const newSchedule = buildScheduleFromTasks(
        project.schedule?.name ?? project.name ?? 'Schedule',
        project.id,
        tasks,
        project.schedule?.baseline ?? null,
        { criticalPathDays: cpm.projectFinish }, // v2.1: engine-true value
      );
      // Preserve named baselines across debounced writes — `buildScheduleFromTasks`
      // rebuilds a fresh schedule object, so without this spread the baselines
      // column would silently vanish on the next keystroke.
      const withBaselines = {
        ...newSchedule,
        // Preserve the project's existing start anchor across debounced rebuilds.
        startDate: project.schedule?.startDate ?? newSchedule.startDate,
        baselines: baselinesRef.current,
        // Preserve schedule-level settings that buildScheduleFromTasks doesn't
        // know about — closures, critical threshold, resource pool, scenarios.
        nonWorkingDates: project.schedule?.nonWorkingDates,
        criticalFloatThresholdDays: project.schedule?.criticalFloatThresholdDays,
        resources: project.schedule?.resources,
        scenarios: project.schedule?.scenarios,
        activeScenarioId: project.schedule?.activeScenarioId,
        weatherDelayLog: project.schedule?.weatherDelayLog,
      };
      console.log('[ScheduleProScreen] Persist', {
        tasks: tasks.length,
        baselines: baselinesRef.current.length,
      });
      updateProject(project.id, { schedule: withBaselines });
    }, 500);
  }, [project, updateProject, cpm.projectFinish]);

  // Flush on unmount so we never lose an edit to a pending timer.
  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        // One final sync using the latest working copy. Read tasks via
        // workingTasksRef (synced in a separate useEffect) instead of
        // closing over the workingTasks state variable — this closes the
        // narrow audit-bug-#7 race where a final keystroke between the
        // last debounce timer and unmount could be lost.
        if (project) {
          const newSchedule = buildScheduleFromTasks(
            project.schedule?.name ?? project.name ?? 'Schedule',
            project.id,
            workingTasksRef.current,
            project.schedule?.baseline ?? null,
            { criticalPathDays: cpm.projectFinish }, // v2.1: engine-true value
          );
          updateProject(project.id, {
            schedule: {
              ...newSchedule,
              startDate: project.schedule?.startDate ?? newSchedule.startDate,
              baselines: baselinesRef.current,
              nonWorkingDates: project.schedule?.nonWorkingDates,
              criticalFloatThresholdDays: project.schedule?.criticalFloatThresholdDays,
              resources: project.schedule?.resources,
              scenarios: project.schedule?.scenarios,
              activeScenarioId: project.schedule?.activeScenarioId,
              weatherDelayLog: project.schedule?.weatherDelayLog,
            },
          });
        }
      }
    };
  // cpm.projectFinish in deps so the unmount-flush closure captures the
  // engine-true value. workingTasks read via workingTasksRef.current (mirror
  // synced above) — closes audit bug #7. project/updateProject are stable
  // for the lifetime of this project's mount; capturing them at the last
  // re-bind is correct (we want to write to the project we were editing).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpm.projectFinish]);

  // -------------------------------------------------------------------------
  // Edit handlers — all go through a single `commit` that snapshots history
  // -------------------------------------------------------------------------

  const commit = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => {
    setHist(h => {
      const next = producer(h.present);
      schedulePersist(next);
      // pushHistory snapshots the old present onto `past` (bounded to 20) and
      // clears the redo stack — a new edit always invalidates redo.
      return pushHistory(h, next, 20);
    });
  }, [schedulePersist]);

  const handleEdit = useCallback((taskId: string, patch: Partial<ScheduleTask>) => {
    // Log to the audit before applying so we have the "before" snapshot.
    const before = workingTasks.find(t => t.id === taskId);
    if (before && project?.id) {
      const isLogicChange = 'dependencies' in patch || 'dependencyLinks' in patch;
      const isProgressChange = 'progress' in patch && patch.progress !== before.progress;
      const entry = buildAuditEntry({
        user: user?.email ?? user?.name ?? 'anonymous',
        taskId,
        taskTitle: before.title,
        kind: isLogicChange ? 'dependency_edit'
          : isProgressChange ? 'progress_update'
          : 'task_edit',
        summary: summarizeTaskDiff(before as unknown as Record<string, unknown>, { ...before, ...patch } as unknown as Record<string, unknown>),
        before: before as unknown as Record<string, unknown>,
        after: { ...before, ...patch } as unknown as Record<string, unknown>,
      });
      void appendAuditToAsyncStorage(project.id, entry);
    }
    commit(prev => prev.map(t => (t.id === taskId ? { ...t, ...patch } : t)));
  }, [commit, workingTasks, project?.id, user]);

  // 14-day forecast keyed off project start. Used for the weather-aware
  // reschedule prompt — surfaces tasks that hit un-workable days.
  const forecast = useMemo(
    () => getSimulatedForecast(projectStartDate, 14),
    [projectStartDate],
  );

  // Weather reschedule — compute the forecast's impact on weather-sensitive
  // tasks (and the cascade) and open the preview. todayDay pins work already
  // underway so we only reschedule the future.
  const openWeatherReschedule = useCallback(() => {
    const todayDay = Math.max(1, Math.floor((Date.now() - projectStartDate.getTime()) / 86400000) + 1);
    const result = computeWeatherReschedule(workingTasks, projectStartDate, forecast, { todayDay });
    setWeatherResult(result);
    setShowWeather(true);
  }, [workingTasks, projectStartDate, forecast]);

  // Apply the proposed reschedule: commit the cascaded startDays AND append a
  // delay-day log entry, in ONE write (mirrors the unmount-flush) so the
  // debounced keystroke-persist can't race the log. Snapshots history for undo.
  const applyWeatherReschedule = useCallback(() => {
    if (!project || !weatherResult) return;
    const next = weatherResult.tasks;
    // Undoable: snapshot the current present onto the undo stack, then set the
    // cascaded tasks as the new present (redo stack cleared by pushHistory).
    setHist(h => pushHistory(h, next, 20));
    const rebuilt = buildScheduleFromTasks(
      project.schedule?.name ?? project.name ?? 'Schedule',
      project.id,
      next,
      project.schedule?.baseline ?? null,
      { criticalPathDays: cpm.projectFinish },
    );
    const logEntry = buildWeatherDelayLog(weatherResult, () => createId('weather'));
    updateProject(project.id, {
      schedule: {
        ...rebuilt,
        startDate: project.schedule?.startDate ?? rebuilt.startDate,
        baselines: baselinesRef.current,
        nonWorkingDates: project.schedule?.nonWorkingDates,
        criticalFloatThresholdDays: project.schedule?.criticalFloatThresholdDays,
        resources: project.schedule?.resources,
        scenarios: project.schedule?.scenarios,
        activeScenarioId: project.schedule?.activeScenarioId,
        weatherDelayLog: logEntry
          ? [...(project.schedule?.weatherDelayLog ?? []), logEntry]
          : project.schedule?.weatherDelayLog,
      },
    });
    setShowWeather(false);
  }, [project, weatherResult, updateProject, cpm.projectFinish]);

  // Bulk push handler — moves multiple tasks in a single commit. Each
  // task's startDay shifts by deltaDays; CPM cascades successors via the
  // existing recompute on rolledTasks.
  const handleWeatherPush = useCallback((patches: { taskId: string; deltaDays: number }[]) => {
    commit(prev => prev.map(t => {
      const p = patches.find(x => x.taskId === t.id);
      if (!p) return t;
      return { ...t, startDay: Math.max(1, t.startDay + p.deltaDays) };
    }));
  }, [commit]);

  // Voice → mutation adapter. The voice executor calls these; CPM re-runs
  // on each commit so successors ripple automatically. Each mutation is
  // a single `commit()` so undo/redo treats voice edits identically to
  // manual ones.
  const voiceUpdateFunctions = useMemo(() => ({
    handleProgressUpdate: (task: ScheduleTask, progress: number) => {
      handleEdit(task.id, { progress });
    },
    onAddNote: (task: ScheduleTask, note: string) => {
      const existing = task.notes ? `${task.notes}\n` : '';
      handleEdit(task.id, { notes: `${existing}${note}` });
    },
    onRescheduleTask: (
      task: ScheduleTask,
      args: { newStartDay?: number; deltaDays?: number; newDurationDays?: number },
    ) => {
      const patch: Partial<ScheduleTask> = {};
      if (typeof args.newStartDay === 'number') {
        patch.startDay = Math.max(1, args.newStartDay);
      } else if (typeof args.deltaDays === 'number') {
        patch.startDay = Math.max(1, task.startDay + args.deltaDays);
      }
      if (typeof args.newDurationDays === 'number') {
        patch.durationDays = Math.max(1, args.newDurationDays);
      }
      handleEdit(task.id, patch);
    },
    onAssignCrew: (task: ScheduleTask, crew: string) => {
      handleEdit(task.id, { crew });
    },
  }), [handleEdit]);

  // Opens the Add Task modal. The actual commit happens in
  // handleCommitAddTask once the user submits the form.
  const handleAddTask = useCallback(() => {
    setShowAddTask(true);
  }, []);

  // Called by AddTaskModal when the user clicks "Create task". Builds
  // the new task using whatever the user supplied + sensible defaults
  // for anything omitted. Also patches any successor tasks named in the
  // form to depend on the new task. Closes the modal on success.
  const handleCommitAddTask = useCallback((values: NewTaskValues) => {
    commit(prev => {
      // Convert optional ISO start date → day number on the project
      // calendar. Mirrors GridPane.dateToDayNumber so add-task and inline
      // edit both round-trip to the same day.
      let startDay: number;
      if (values.startIso) {
        const [y, m, d] = values.startIso.split('-').map(n => parseInt(n, 10));
        const target = new Date(y, m - 1, d);
        const base = new Date(projectStartDate.getFullYear(), projectStartDate.getMonth(), projectStartDate.getDate());
        if (target <= base) {
          startDay = 1;
        } else if (workingDaysPerWeek >= 7) {
          startDay = Math.floor((target.getTime() - base.getTime()) / 86400000) + 1;
        } else {
          let count = 1;
          const cur = new Date(base);
          while (cur < target) {
            cur.setDate(cur.getDate() + 1);
            const dow = cur.getDay();
            if (dow !== 0 && dow !== 6) count++;
          }
          startDay = count;
        }
      } else {
        startDay = prev.length === 0
          ? 1
          : Math.max(...prev.map(t => t.startDay + t.durationDays));
      }

      const newId = createId('task');
      const newTask: ScheduleTask = {
        id: newId,
        title: values.title,
        phase: 'General',
        tradeKey: values.tradeKey,
        durationDays: values.durationDays,
        startDay,
        progress: 0,
        crew: values.crew ?? '',
        dependencies: values.predecessorIds ?? [],
        notes: values.notes ?? '',
        status: 'not_started',
      };

      // Successor wiring: patch the named successor tasks so they list
      // the new task as one of their predecessors. We do this in the same
      // commit() pass so undo treats it as a single step.
      const succSet = new Set(values.successorIds ?? []);
      const patched = prev.map(t => {
        if (!succSet.has(t.id)) return t;
        // Audit bug #8: check both legacy `dependencies` and the newer
        // `dependencyLinks` array so we don't silently duplicate an edge
        // that already exists in only one of them. The CPM engine prefers
        // dependencyLinks when both are present (cpm.ts:185).
        if (t.dependencies.includes(newId)) return t;
        if ((t.dependencyLinks ?? []).some(l => l.taskId === newId)) return t;
        return { ...t, dependencies: [...t.dependencies, newId] };
      });

      return generateWbsCodes([...patched, newTask]);
    });
    setShowAddTask(false);
  }, [commit, projectStartDate, workingDaysPerWeek]);

  // Phase 4: create a dependency edge between two tasks via drag in the Gantt.
  // Guards against self-link + cycles are handled in the Gantt before we get
  // the call, so here we just append.
  const handleDependencyCreate = useCallback((fromId: string, toId: string) => {
    commit(prev => prev.map(t => {
      if (t.id !== toId) return t;
      // Audit bug #8: check both arrays before adding so a Gantt-drag
      // can't duplicate an edge already in dependencyLinks (cpm.ts:185
      // prefers dependencyLinks when both are populated).
      if (t.dependencies.includes(fromId)) return t;
      if ((t.dependencyLinks ?? []).some(l => l.taskId === fromId)) return t;
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

  // Task-path focus. When set, the gantt dims everyone not on this task's
  // predecessor chain and the grid highlights the same row. Clicking a bar
  // toggles; Escape (or re-clicking the same bar) clears. Shared between
  // panes so the two views stay in lock-step.
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);

  // Pre-fill start date for the Add Task modal when the user double-taps an
  // empty day on the Gantt timeline. Cleared after the modal closes (cancel
  // or create) so the toolbar "Add Task" button never inherits a stale day.
  const [prefillStart, setPrefillStart] = useState<string | undefined>(undefined);

  // Converts a 1-based day number (from InteractiveGantt's double-tap handler)
  // to a yyyy-mm-dd ISO string that AddTaskModal's defaultStartDate accepts,
  // then opens the modal. Day 1 = projectStartDate.
  const handleAddTaskAtDay = useCallback((dayNumber: number) => {
    const target = new Date(
      projectStartDate.getFullYear(),
      projectStartDate.getMonth(),
      projectStartDate.getDate() + (dayNumber - 1),
    );
    const iso = target.toISOString().slice(0, 10);
    setPrefillStart(iso);
    handleAddTask();
  }, [projectStartDate, handleAddTask]);

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
  // Named baselines — capture / switch / compare via BaselineManagerModal.
  // The previous tap=capture / long-press=compare-against-latest affordance
  // collapsed multi-baseline workflows into one shortcut. The modal exposes
  // all the moves users actually take (rename, delete, compare A vs B,
  // activate as overlay) — see components/schedule/BaselineManagerModal.tsx.
  // -------------------------------------------------------------------------

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
  // .ics calendar export — "Add to Calendar" button
  // -------------------------------------------------------------------------
  // Builds an iCalendar file from every task + milestone + invoice due
  // date + warranty end date and shares it via the native share sheet
  // (iOS/Android Calendar.app prompts to subscribe, Google Calendar /
  // Outlook on web imports). Sidesteps the unbuilt Google Calendar OAuth
  // path with a 1-tap user-driven import that works in every calendar
  // app. Closes the audit's #1 sub-1-hour quick win.
  const handleExportIcs = useCallback(async () => {
    if (!project) return;
    try {
      // exportProjectIcs reads tasks from project.schedule.tasks, so we
      // splice the in-memory working tasks onto a shallow project clone
      // — keeps the user's unsaved edits in the exported .ics without
      // mutating state.
      const liveProject = {
        ...project,
        schedule: {
          ...(project.schedule ?? { startDate: new Date().toISOString().slice(0, 10) }),
          tasks: workingTasks,
        },
      } as typeof project;
      const result = await exportProjectIcs({
        project: liveProject,
        invoices: [],
        warranties: [],
      });
      if (Platform.OS === 'web') {
        Alert.alert('Calendar ready', `Downloaded a .ics file with ${result.eventCount} event(s). Open it to import into Apple/Google/Outlook Calendar.`);
      }
      // Native already opens the share sheet from inside exportProjectIcs.
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }, [project, workingTasks]);

  // PDF export — gated on Pro tier. Uses expo-print under the hood to render
  // a styled HTML document → PDF → native share sheet (or browser print
  // dialog on web). Rolled-up tasks (summaries) are used so WBS bars show
  // the combined span, matching what the user sees on-screen.
  //
  // When baselines exist, we pop a picker so the PM can export a variance
  // report. Skipping ("Current plan only") reverts to the classic single-
  // plan export. No picker appears if there are no baselines.
  const runPdfExport = useCallback(async (
    baseline?: NamedBaseline,
    paperSize: SchedulePdfPaperSize = 'a3',
  ) => {
    try {
      await exportSchedulePdf({
        projectName: project?.name ?? 'Schedule',
        scheduleStartIso: project?.schedule?.startDate,
        tasks: rolledTasks,
        cpm,
        baseline,
        paperSize,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (Platform.OS === 'web') window.alert?.(`PDF export failed: ${msg}`);
      else Alert.alert('PDF export failed', msg);
    }
  }, [project?.name, project?.schedule?.startDate, rolledTasks, cpm]);

  // Paper-size picker → baseline picker → export. Keeps the dialog stack
  // shallow on mobile (Alert can't nest deeply) by routing through a
  // single chooser. Web confirms inline.
  const promptPaperSize = useCallback(async (then: (size: SchedulePdfPaperSize) => void | Promise<void>) => {
    if (Platform.OS === 'web') {
      const msg = 'Pick paper size:\n\nOK → Arch D (24×36, field-grade)\nCancel → A3 (default)';
      const yes = window.confirm?.(msg);
      then(yes ? 'arch_d' : 'a3');
      return;
    }
    Alert.alert(
      'Paper size',
      'Pick the paper size for this PDF.',
      [
        { text: 'A3 (default)', onPress: () => { void then('a3'); } },
        { text: 'Letter', onPress: () => { void then('letter'); } },
        { text: 'Arch D — 24×36', onPress: () => { void then('arch_d'); } },
        { text: 'Arch E — 36×48', onPress: () => { void then('arch_e'); } },
        { text: 'Cancel', style: 'cancel' as const },
      ],
      { cancelable: true },
    );
  }, []);

  const handleExportPdf = useCallback(async () => {
    if (!canAccess('schedule_gantt_pdf')) {
      Alert.alert('Pro feature', 'PDF export is available on the Pro plan. Upgrade to unlock it.');
      return;
    }
    if (namedBaselines.length === 0) {
      await promptPaperSize(size => { void runPdfExport(undefined, size); });
      return;
    }
    // Offer the most-recent baseline as the default compare target. Show
    // "Current only" as a secondary option so the classic export stays
    // one tap away. We cap the picker at the last 3 baselines — older
    // ones are rarely the interesting comparison.
    const recent = namedBaselines.slice(-3).reverse();
    if (Platform.OS === 'web') {
      const msg = `Compare against a baseline?\n\nOK → ${recent[0]?.name ?? 'most recent'}\nCancel → current plan only`;
      const yes = window.confirm?.(msg);
      await promptPaperSize(size => { void runPdfExport(yes ? recent[0] : undefined, size); });
      return;
    }
    Alert.alert(
      'Export PDF',
      'Include baseline variance in the export?',
      [
        { text: 'Current plan only', onPress: () => { void promptPaperSize(size => { void runPdfExport(undefined, size); }); } },
        ...recent.map(b => ({
          text: `vs ${b.name}`,
          onPress: () => { void promptPaperSize(size => { void runPdfExport(b, size); }); },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
      { cancelable: true },
    );
  }, [canAccess, namedBaselines, runPdfExport, promptPaperSize]);

  // -------------------------------------------------------------------------
  // Share link — base64 payload in URL, no backend
  // -------------------------------------------------------------------------

  const handleShare = useCallback(async () => {
    if (!project) return;
    const payload = buildSharePayload(
      project.name ?? 'Schedule',
      projectStartDate,
      workingTasks,
      { projectId: project.id },
    );
    // v2.4 (audit Item 6) — Try inline first; on oversize, write a
    // server-side snapshot and use the short row-id token instead.
    // Replaces the v2.3 P1 throw-on-oversize behavior with a graceful
    // fallback that produces a working URL for any schedule size.
    const result = tryEncodeShareToken(payload);
    let url: string;
    if (result.kind === 'inline') {
      url = `/shared-schedule?t=${result.token}`;
    } else {
      // Oversize — write snapshot to shared_schedule_snapshots. Anyone
      // with the resulting UUID-in-URL can fetch via the
      // fetch_shared_schedule SECURITY DEFINER RPC for 30 days
      // (default TTL on the table).
      const { data, error } = await supabase
        .from('shared_schedule_snapshots')
        .insert({
          user_id: user?.id,
          project_id: project.id,
          payload,
          task_count: payload.tasks.length,
        })
        .select('id')
        .single();
      if (error || !data) {
        Alert.alert(
          'Could not save snapshot',
          `Schedule has ${workingTasks.length} tasks (URL fallback). ${error?.message ?? 'Network error — try again in a moment.'}`,
        );
        return;
      }
      url = `/shared-schedule?s=${data.id}`;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      url = `${window.location.origin}${url}`;
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
  }, [project, projectStartDate, workingTasks, user?.id]);

  // -------------------------------------------------------------------------
  // AirPrint — Task 17. Renders a minimal HTML task-list via expo-print.
  // A follow-up can route through the existing PDF generator for a
  // fully-styled Gantt print; this version works end-to-end today.
  // -------------------------------------------------------------------------

  const handleAirPrint = useCallback(async () => {
    try {
      const Print = await import('expo-print');
      const pName = project?.name ?? 'Schedule';
      const safeTasks = workingTasks;
      const html = `
        <html><head><meta charset="utf-8"><title>${escapeHtml(pName)} schedule</title>
        <style>
          body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          p.sub { color: #666; font-size: 11px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th { text-align: left; padding: 6px 8px; background: #f3f3f3; border-bottom: 2px solid #ddd; }
          th.r { text-align: right; }
          td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
          td.r { text-align: right; }
        </style>
        </head>
        <body>
          <h1>${escapeHtml(pName)}</h1>
          <p class="sub">Schedule print from MAGE ID &nbsp;·&nbsp; ${new Date().toLocaleDateString()}</p>
          <table>
            <thead><tr>
              <th>#</th>
              <th>Task</th>
              <th>Phase</th>
              <th class="r">Duration</th>
              <th class="r">% Done</th>
              <th>Crew</th>
            </tr></thead>
            <tbody>
              ${safeTasks.map((t, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(t.title ?? '')}${t.isMilestone ? ' <span style="background:#fef3c7;color:#b45309;font-size:9px;padding:1px 4px;border-radius:3px;font-weight:600">M</span>' : ''}${t.isCriticalPath ? ' <span style="background:#fee2e2;color:#b91c1c;font-size:9px;padding:1px 4px;border-radius:3px;font-weight:600">CP</span>' : ''}</td>
                  <td>${escapeHtml(t.phase ?? '—')}</td>
                  <td class="r">${t.durationDays ?? 0}d</td>
                  <td class="r">${Math.round(t.progress ?? 0)}%</td>
                  <td>${escapeHtml(t.crew ?? '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body></html>`;
      await Print.printAsync({ html });
    } catch (e) {
      console.error('AirPrint failed', e);
    }
  }, [project?.name, workingTasks]);

  // -------------------------------------------------------------------------
  // Undo / Redo (Phase 4 preview — works today for grid edits)
  // -------------------------------------------------------------------------

  const handleUndo = useCallback(() => {
    setHist(h => {
      const n = histUndo(h);
      if (n === h) return h; // nothing to undo — don't persist a no-op
      schedulePersist(n.present);
      return n;
    });
  }, [schedulePersist]);

  const handleRedo = useCallback(() => {
    setHist(h => {
      const n = histRedo(h);
      if (n === h) return h; // nothing to redo — don't persist a no-op
      schedulePersist(n.present);
      return n;
    });
  }, [schedulePersist]);

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

  // Escape clears task-path focus. Separate effect because it's single-key
  // (no mod required) and must skip input fields so typing Escape while
  // editing a cell doesn't double-dismiss.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (inInput) return;
      if (focusedTaskId) {
        e.preventDefault();
        setFocusedTaskId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedTaskId]);

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
        <MageAIMark size={28} color={themeColors.accent} />
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
          <ChevronLeft size={20} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.headerBackText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {stats.total} tasks · {stats.critical} on critical path · finish day {stats.finish}
            {stats.conflicts > 0 && ` · ${stats.conflicts} conflict${stats.conflicts === 1 ? '' : 's'}`}
          </Text>
        </View>

        <View style={styles.headerActions}>
          {/* Pane mode segmented control */}
          <View style={styles.paneToggle}>
            <PaneBtn icon={Table2} label="Grid" active={paneMode === 'grid'} onPress={() => setPaneModeAndForceGantt('grid')} />
            <PaneBtn icon={Columns} label="Split" active={paneMode === 'split'} onPress={() => setPaneModeAndForceGantt('split')} />
            <PaneBtn icon={BarChart2} label="Gantt" active={paneMode === 'gantt'} onPress={() => setPaneModeAndForceGantt('gantt')} />
            <PaneBtn
              icon={Users}
              label="Lanes"
              active={paneMode === 'resources'}
              // Toggle: clicking Lanes again returns to the regular tab shell
              // (defaulting to the Gantt sub-mode) so the user has a one-tap
              // escape from the Lanes view instead of having to find one of
              // the Grid/Split/Gantt buttons.
              onPress={() => setPaneMode(paneMode === 'resources' ? 'gantt' : 'resources')}
            />
            <PaneBtn
              icon={MapIcon}
              label="Living Plan"
              active={paneMode === 'living'}
              onPress={() => setPaneMode(paneMode === 'living' ? 'gantt' : 'living')}
            />
          </View>

          {/* AI first — the headline value-prop. Highlighted so it stands out.
              The "+ Add Task" affordance now lives inline in the SchedulerHeader
              between VIEW and Export (Phase 27 audit feedback), so it's removed
              from this toolbar to avoid two Add-Task buttons on the same row. */}
          <HeaderBtn icon={MageAIMark} label="AI" onPress={() => setShowAI(true)} highlighted />
          <HeaderBtn icon={Mic} label="Voice" onPress={() => setShowVoice(true)} />
          <ScheduleHealthBadge result={healthScore} onPress={() => setShowHealth(true)} size="compact" />
          <HeaderBtn icon={RefreshCcw} label="Reflow" onPress={handleReflow} />
          <HeaderBtn icon={Bookmark} label="Baseline" onPress={() => setShowBaselineManager(true)} />
          <HeaderBtn icon={Download} label="CSV" onPress={handleExportCsv} />
          <HeaderBtn icon={CalendarPlus} label="iCal" onPress={() => { void handleExportIcs(); }} />
          <HeaderBtn icon={FileText} label="PDF" onPress={handleExportPdf} />
          <HeaderBtn icon={MageAIMark} label="Demo" onPress={handleLoadDemo} />
          <HeaderBtn icon={Undo2} label="Undo" onPress={handleUndo} disabled={!canUndo(hist)} />
          <HeaderBtn icon={Redo2} label="Redo" onPress={handleRedo} disabled={!canRedo(hist)} />
          <HeaderBtn
            icon={Activity}
            label="CPM"
            onPress={() => {
              const msg = `Project finish: day ${cpm.projectFinish}\nCritical path: ${cpm.criticalPath.length} task(s)\nConflicts: ${cpm.conflicts.length}`;
              if (Platform.OS === 'web') window.alert?.(msg);
              else Alert.alert('Schedule analysis', msg);
            }}
          />
          <HeaderBtn icon={CloudRain} label="Weather" onPress={openWeatherReschedule} />
          <HeaderBtn icon={CalendarX} label="Closures" onPress={() => setShowClosures(true)} />
          <HeaderBtn icon={Settings} label="Settings" onPress={() => setShowSettings(true)} />
          <HeaderBtn icon={Share2} label="Share" onPress={handleShare} />
        </View>
      </View>

      {/* Earned-value rollup — only renders when there's a linked estimate
          with budget-bearing items, otherwise zero-gracefully hides. */}
      {evSnapshot.totalBudget > 0 && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <EarnedValuePanel snapshot={evSnapshot} tasks={rolledTasks} />
        </View>
      )}

      {/* v2.4 (audit Item 5) — Surface stale linkedEstimateItems refs +
          offer one-tap cleanup. Hidden when count is 0 (typical case). */}
      {staleEstimateRefCount > 0 && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <TouchableOpacity
            onPress={handleCleanupStaleRefs}
            style={[styles.cleanupBanner]}
            testID="cleanup-stale-estimate-refs"
          >
            <Text style={styles.cleanupBannerText}>
              {staleEstimateRefCount} stale estimate reference{staleEstimateRefCount === 1 ? '' : 's'} found · tap to clean up
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sub Schedule Collab — surfaces a tile when subs have posted
          daily updates via the shared URL. Hidden when nothing's been
          posted yet (component returns null). */}
      {project?.id && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <SubUpdatesPanel
            projectId={project.id}
            tasks={rolledTasks}
          />
        </View>
      )}

      {/* Weather-aware reschedule prompt — silent when forecast is clean,
          banner when weather-sensitive tasks land on un-workable days. */}
      <WeatherReschedulePrompt
        tasks={rolledTasks}
        forecasts={forecast}
        projectStartDate={projectStartDate}
        onPushTasks={handleWeatherPush}
      />

      {/* Body — Phase 27: the new SchedulerTabShell (7-tab nav + SchedulerHeader +
          active tab content) replaces the old manual paneMode grid/gantt/split
          rendering. Resource swimlanes are a separate mode that lives outside
          the tab shell since they are a different axis entirely. */}
      {paneMode === 'living' ? (() => {
        const planSheets = getPlanSheetsForProject(project.id).filter((s) => !s.superseded);
        const firstSheet = planSheets[0] ?? null;
        const zones = getPlanZonesForProject(project.id).filter(
          (z) => firstSheet ? z.planSheetId === firstSheet.id : false,
        );
        const pins = firstSheet ? getPinsForPlan(firstSheet.id) : [];
        const photos = getPhotosForProject(project.id);
        const photoById = (photoId: string) => { const p = photos.find((ph) => ph.id === photoId); return p ? { uri: p.uri, createdAt: p.createdAt } : undefined; };
        return (
          <View style={styles.body}>
            <View style={styles.paneFull}>
              <LivingFloorPlan
                project={project}
                planSheetId={firstSheet?.id ?? ''}
                zones={zones}
                pins={pins}
                photoById={photoById}
                imageUri={firstSheet?.imageUri ?? ''}
                imageW={firstSheet?.width}
                imageH={firstSheet?.height}
                onEdit={() => setShowLivingPlanEditor(true)}
                onAddPlan={() => router.push('/plans' as never)}
              />
            </View>
          </View>
        );
      })() : paneMode === 'resources' ? (
        <View style={styles.body}>
          <View style={styles.paneFull}>
            <ResourceSwimlanes
              tasks={rolledTasks}
              resources={project?.schedule?.resources}
              projectStartDate={projectStartDate}
              projectName={project?.name}
            />
          </View>
        </View>
      ) : (
        <View style={styles.tabShellBody}>
          <SchedulerTabShell
            schedule={{
              ...(project?.schedule ?? {} as import('@/types').ProjectSchedule),
              id: project?.schedule?.id ?? project?.id ?? '',
              projectId: project?.id ?? '',
              name: project?.schedule?.name ?? project?.name ?? 'Schedule',
              tasks: rolledTasks,
              // Fall back to the project's createdAt-derived start so the
              // SchedulerHeader's START / FINISH KPIs don't show "—" when
              // a schedule exists but has no explicit startDate set.
              startDate: project?.schedule?.startDate
                ?? projectStartDate.toISOString().slice(0, 10),
              totalDurationDays: cpm.projectFinish,
              healthScore: healthScore.score,
            }}
            contextCpm={contextCpm}
            projectName={project?.name ?? 'Schedule'}
            onExportPress={() => setExportSheetOpen(true)}
            onBaselinePress={() => setShowBaselineManager(true)}
            ganttPaneMode={paneMode}
            paneModeNonce={paneModeNonce}
            projectStartDate={projectStartDate}
            workingDaysPerWeek={workingDaysPerWeek}
            nonWorkingDates={project?.schedule?.nonWorkingDates}
            utilsCpm={cpm}
            resources={project?.schedule?.resources}
            onEdit={handleEdit}
            onAddTask={handleAddTask}
            onAddTaskAtDay={handleAddTaskAtDay}
            onDeleteTask={handleDeleteTask}
            onDependencyCreate={handleDependencyCreate}
            focusedTaskId={focusedTaskId}
            onFocusTask={setFocusedTaskId}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onBulkDelete={handleBulkDelete}
            onBulkDuplicate={handleBulkDuplicate}
            onBulkShiftDays={handleBulkShiftDays}
            onBulkSetPhase={handleBulkSetPhase}
            onBulkSetCrew={handleBulkSetCrew}
            onBulkAskAI={handleBulkAskAI}
          />
          {/* Task inspector — right-docked sibling to the tab shell. Appears
              when a task has focus (click a bar). Escape clears focus (handled
              in the keyboard effect above). Modals stay at screen level so they
              are unaffected by tab switching. */}
          {focusedTaskId && (() => {
            const focusedTask = rolledTasks.find(t => t.id === focusedTaskId) ?? null;
            return (
              <TaskInspector
                task={focusedTask}
                allTasks={rolledTasks}
                cpm={cpm}
                projectStartDate={projectStartDate}
                onClose={() => setFocusedTaskId(null)}
                onEdit={handleEdit}
              />
            );
          })()}
        </View>
      )}

      {/* Closures (non-working dates) editor. */}
      <ClosuresModal
        visible={showClosures}
        value={project?.schedule?.nonWorkingDates ?? []}
        scheduleStartIso={project?.schedule?.startDate}
        workingDaysPerWeek={workingDaysPerWeek}
        onClose={() => setShowClosures(false)}
        onApply={(next) => {
          if (!project) return;
          updateProject(project.id, {
            schedule: {
              ...(project.schedule as ProjectSchedule),
              nonWorkingDates: next,
            },
          });
          setShowClosures(false);
        }}
      />

      {/* Weather-driven reschedule — preview the forecast's impact on
          weather-sensitive tasks + cascade, then apply in one tap. */}
      <WeatherRescheduleModal
        visible={showWeather}
        result={weatherResult}
        projectStartDate={projectStartDate}
        onClose={() => setShowWeather(false)}
        onApply={applyWeatherReschedule}
      />

      {/* Voice → schedule mutations. The modal handles transcription +
          parsing + executor; we provide the update functions. CPM re-runs
          on every commit so successors ripple automatically. */}
      <VoiceCommandModal
        visible={showVoice}
        onClose={() => setShowVoice(false)}
        tasks={workingTasks}
        projectName={project?.name ?? 'Schedule'}
        projectId={project?.id ?? ''}
        updateFunctions={voiceUpdateFunctions}
      />

      {/* Schedule health score detail. Tap a flagged task → opens it
          in the inspector. (Inspector wiring uses an existing dispatch
          to setSelectedTaskId, hooked elsewhere — passing a no-op for
          now keeps the modal self-contained.) */}
      <ScheduleHealthDetail
        visible={showHealth}
        onClose={() => setShowHealth(false)}
        result={healthScore}
      />

      {/* Multi-baseline manager — capture, switch, compare named baselines.
          P6 / Asta parity replacing the old "tap to capture / long-press to
          compare against latest" affordance which only allowed a single
          baseline workflow. */}
      <BaselineManagerModal
        visible={showBaselineManager}
        onClose={() => setShowBaselineManager(false)}
        baselines={namedBaselines}
        workingTasks={workingTasks}
        activeBaselineId={namedBaselines.length > 0 ? namedBaselines[namedBaselines.length - 1].id : null}
        onBaselinesChange={(next) => {
          baselinesRef.current = next;
          setNamedBaselines(next);
          // No commit here — baselines aren't tasks; the commit happens
          // through the persist debounce that picks up baselinesRef.
          if (project) {
            updateProject(project.id, {
              schedule: {
                ...(project.schedule as ProjectSchedule),
                baselines: next,
              },
            });
          }
        }}
        onActivate={(baseline) => {
          commit(prev => applyBaselineToTasks(prev, baseline));
        }}
      />

      {/* Schedule settings (critical threshold + working days per week). */}
      <ScheduleSettingsMenu
        visible={showSettings}
        criticalFloatThresholdDays={criticalFloatThresholdDays}
        workingDaysPerWeek={workingDaysPerWeek}
        onClose={() => setShowSettings(false)}
        onApply={(patch) => {
          if (!project) return;
          updateProject(project.id, {
            schedule: {
              ...(project.schedule as ProjectSchedule),
              criticalFloatThresholdDays: patch.criticalFloatThresholdDays,
              workingDaysPerWeek: patch.workingDaysPerWeek,
            },
          });
          setShowSettings(false);
        }}
      />

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
        linkedEstimate={project?.linkedEstimate ?? null}
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

      {/* Export sheet — five-option bottom sheet (PDF / CSV / Share / iCal / Print).
          PDF/CSV/Share reuse existing handlers; iCal + AirPrint wired in tasks 16-17. */}
      <ExportSheet
        visible={exportSheetOpen}
        onClose={() => setExportSheetOpen(false)}
        onExportPdf={() => { void handleExportPdf(); }}
        onExportCsv={handleExportCsv}
        onShareLink={handleShare}
        onExportIcal={() => {
          if (project) {
            // Inline import keeps the iCal generator out of the initial bundle.
            void import('@/utils/scheduleExportIcal').then(m =>
              m.exportScheduleIcal({ project }),
            );
          }
        }}
        onAirPrint={() => { void handleAirPrint(); }}
      />

      {/* Add Task modal — opens from any onAddTask caller (toolbar
          button, GridPane footer, phone FAB). */}
      <AddTaskModal
        visible={showAddTask}
        onCancel={() => { setShowAddTask(false); setPrefillStart(undefined); }}
        onCreate={(values) => { handleCommitAddTask(values); setPrefillStart(undefined); }}
        tasks={workingTasks}
        defaultStartDate={prefillStart}
      />

      {/* Living Plan zone editor (full-screen modal) */}
      {showLivingPlanEditor && (() => {
        const planSheets = getPlanSheetsForProject(project.id).filter((s) => !s.superseded);
        const firstSheet = planSheets[0] ?? null;
        if (!firstSheet) return null;
        return (
          <Modal visible animationType="slide" onRequestClose={() => setShowLivingPlanEditor(false)}>
            <PlanZoneEditor
              project={project}
              planSheetId={firstSheet.id}
              imageUri={firstSheet.imageUri}
              imageW={firstSheet.width}
              imageH={firstSheet.height}
              onClose={() => setShowLivingPlanEditor(false)}
            />
          </Modal>
        );
      })()}
    </View>
  );
}

// ---------------------------------------------------------------------------
// HTML escape helper — used by handleAirPrint above.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Pane toggle button
// ---------------------------------------------------------------------------

function PaneBtn({
  icon: Icon, label, active, onPress,
}: { icon: any; label: string; active: boolean; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={[styles.paneBtn, active && styles.paneBtnActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Icon size={13} color={active ? themeColors.accent : themeColors.textSecondary} />
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tint = disabled ? themeColors.textMuted : highlighted ? '#fff' : themeColors.accent;
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: t.text, marginTop: 8 },
  emptyBody: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 440 },
  primaryBtn: {
    backgroundColor: t.accent,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: Tokens.radius.md, marginTop: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: Type.bodyCompact.fontSize },

  // v2.4 — cleanup banner for stale linkedEstimateItems refs.
  // Uses accent-soft palette (attention without alarm) to match the
  // file's existing soft-banner pattern.
  cleanupBanner: {
    backgroundColor: t.accentSoft,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: t.accent,
  },
  cleanupBannerText: {
    color: t.accentLabel,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
    backgroundColor: t.surface,
  },
  headerBack: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
  },
  headerBackText: { color: t.accent, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' },
  headerTitleWrap: { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text },
  headerSub: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '12',
  },
  headerBtnDisabled: { backgroundColor: t.surfaceAlt, opacity: 0.6 },
  headerBtnHighlighted: { backgroundColor: t.accent },
  headerBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent },

  body: {
    flex: 1,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
  },
  // Phase 27: tab shell + inspector side-by-side. No padding here — the
  // shell renders its own internal padding. Inspector floats to the right.
  tabShellBody: {
    flex: 1,
    flexDirection: 'row',
  },
  paneFull: { flex: 1 },
  // Split-view ratios. The grid's compact column set is ~900px wide at its
  // natural size; the gantt (now without a duplicated task column) benefits
  // from extra room for the timeline, so we bias a little wider to the right.
  paneHalf: { flex: 1, minWidth: 440 },
  paneHalfRight: { flex: 1.4, minWidth: 0 },

  paneToggle: {
    flexDirection: 'row',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.sm,
    padding: 2,
    marginRight: 4,
  },
  paneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Tokens.radius.xs,
  },
  paneBtnActive: {
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  paneBtnText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: t.textSecondary,
  },
  paneBtnTextActive: {
    color: t.accent,
  },
});
