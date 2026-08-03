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
import { ChevronLeft, Undo2, Redo2, Download, Mic } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { exportProjectIcs } from '@/utils/icsGenerator';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectRole } from '@/hooks/useProjectRole';
import { useSchedulePresence } from '@/hooks/useSchedulePresence';
import { useLiveSchedule } from '@/hooks/useLiveSchedule';
import { mergeScheduleTasks } from '@/utils/scheduleMerge';
import { PresenceBar } from '@/components/schedule/PresenceBar';
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
import { ScheduleOnRamp } from '@/components/schedule/ScheduleOnRamp';
import ResourceSwimlanes from '@/components/schedule/ResourceSwimlanes';
import VoiceCommandModal from '@/components/VoiceCommandModal';
import ScheduleEditPanel from '@/components/copilot/ScheduleEditPanel';
import { ScheduleHealthBadge, ScheduleHealthDetail } from '@/components/schedule/ScheduleHealthScore';
import { ExportSheet } from '@/components/schedule/ExportSheet';
import { computeScheduleHealthScore } from '@/utils/scheduleHealthScore';
import { EarnedValuePanel } from '@/components/schedule/EarnedValuePanel';
import { buildEarnedValueSnapshot } from '@/utils/scheduleEarnedValue';
import { CriticalPathPanel } from '@/components/schedule/CriticalPathPanel';
import { ScheduleAuditModal } from '@/components/schedule/ScheduleAuditModal';
import { buildCriticalPathExplanation } from '@/utils/floatExplain';
import { WeatherReschedulePrompt } from '@/components/schedule/WeatherReschedulePrompt';
import { getForecastWithFallback, type DayForecast } from '@/utils/weatherService';
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
import { indentTask, outdentTask, moveTask } from '@/utils/outlineOps';
import { appendAuditToAsyncStorage, buildAuditEntry, summarizeTaskDiff } from '@/utils/scheduleAudit';
import { summarizeLeveling, type LevelingSummary } from '@/utils/levelingSummary';
import { stampActuals, todayScheduleDay } from '@/utils/pace/stampActuals';
import { recordDidForYou } from '@/utils/brain/didForYou';
import { rebaseRawToCalendar } from '@/utils/scheduleRebase';
import { LevelingPreviewModal } from '@/components/schedule/LevelingPreviewModal';
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
import { showAlert } from '@/utils/alert';

// Desktop/tablet-landscape breakpoint. Below this we send users to the
// classic mobile experience — the grid is genuinely unusable under 900px.
// These breakpoints compare useWindowDimensions().width, which is only honest
// because this route is in DESKTOP_SHELL_EXEMPT (app/_layout.tsx) and renders
// full-bleed — window width === content width. Keep it exempt (it's a
// full-takeover editor with its own Back header), or convert these gates to
// effective content width (window − sidebar) before un-exempting.
const GRID_BREAKPOINT = 900;
// Above this we auto-open the split view (grid + gantt side by side). Below,
// we default to grid alone because 1200px of timeline next to a 1170px grid
// means the gantt gets ~30px of width — useless.
const SPLIT_BREAKPOINT = 1600;

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
    updateProject: updateProjectRaw,
    getInvoicesForProject,
    getPlanSheetsForProject,
    getPlanZonesForProject,
    getPinsForPlan,
    getPhotosForProject,
    getDailyReportsForProject,
  } = useProjects();

  // Viewer collaborators can't persist schedule edits — guard the writer at the
  // source so every updateProject(...) in this screen is a no-op for viewers
  // (Supabase RLS also denies their UPDATE). role is null while loading, so
  // owners/editors keep editing without a read-only flash.
  const role = useProjectRole(projectId);
  const canEdit = role !== 'viewer';
  const updateProject = useMemo<typeof updateProjectRaw>(
    () => (canEdit ? updateProjectRaw : () => {}),
    [canEdit, updateProjectRaw],
  );

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
  // Last-known SERVER schedule tasks — the baseline for the Phase 2 3-way
  // live-sync merge. Updated on project switch, and on every realtime receive.
  const baselineRef = React.useRef<ScheduleTask[]>(project?.schedule?.tasks ?? []);

  // The view-switcher now lives inside the Timeline tab (GanttTab owns all
  // five layouts). We only derive the tab's opening layout from width below.

  // AI assistant drawer (right-side slide-out).
  const [showAI, setShowAI] = useState(false);
  // Conversational schedule editor (MAGE Copilot) — the "say the change, see
  // the CPM ripple, apply through this screen's commit()" flow. Opened by the
  // toolbar "Voice" button; distinct from the AIAssistantPanel drawer ("AI").
  const [editOpen, setEditOpen] = useState(false);
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
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [dismissedOnRamp, setDismissedOnRamp] = useState(false);
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
    baselineRef.current = project?.schedule?.tasks ?? [];
    setNamedBaselines((project?.schedule?.baselines ?? []) as NamedBaseline[]);
  }, [project?.id]);

  // Mirror baselines into the ref used by schedulePersist. Without this, the
  // next debounced write sees the stale list and silently drops captures.
  useEffect(() => {
    baselinesRef.current = namedBaselines;
  }, [namedBaselines]);

  // Mirror the schedule's start anchor into a ref for the same reason.
  // schedulePersist must NEVER fall back to buildScheduleFromTasks' today
  // default — that silently stamped dateless schedules with today's date on
  // their first edit, flipping the CPM from raw-day to calendar mode and
  // jumping the finish date (the 2026-07-12 finish-jump bug). The settings
  // Apply handler writes this ref eagerly so a rebase commit's debounced
  // persist can't race the project-state update and clobber the new anchor.
  useEffect(() => {
    startDateRef.current = project?.schedule?.startDate;
  }, [project?.schedule?.startDate]);

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
    showAlert(
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
  const projectStartDate = useMemo(() => (
    project?.schedule?.startDate ? new Date(project.schedule.startDate + 'T00:00:00')
    : project?.createdAt ? new Date(project.createdAt)
    : new Date()
  ), [project?.schedule?.startDate, project?.createdAt]);

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
  // Ref-mirror of the schedule's start anchor. Persist writes read THIS —
  // never buildScheduleFromTasks' today-default — so a schedule that has no
  // startDate keeps having none (raw-day CPM mode stays stable). Sync
  // useEffect lives alongside the baselinesRef sync above; the settings
  // Apply handler also writes it eagerly to beat the debounced persist.
  const startDateRef = React.useRef<string | undefined>(undefined);
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
        // Preserve the project's existing start anchor across debounced
        // rebuilds — via the ref, and with NO today-fallback: a schedule
        // without an anchor must stay anchorless or its CPM flips from
        // raw-day to calendar mode and the finish date silently jumps.
        startDate: startDateRef.current,
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
              // Same no-today-fallback rule as the debounced persist above.
              startDate: startDateRef.current,
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
  // Phase 2 — live sync + presence
  // -------------------------------------------------------------------------
  const collabSelf = useMemo(
    () => (user?.id ? { userId: user.id, name: ((user as { email?: string }).email) ?? 'Collaborator' } : null),
    [user?.id],
  );
  const { peers: schedulePeers, setSelectedTask: setPresenceTask } = useSchedulePresence(project?.id, collabSelf);
  const onPeerSchedule = useCallback((incoming: ScheduleTask[]) => {
    const merged = mergeScheduleTasks(baselineRef.current, incoming, workingTasksRef.current);
    baselineRef.current = incoming;
    // Apply a peer's change to the local PRESENT only — no persist (they already
    // saved it), no undo entry. Skip when the merge is a no-op: that's the echo
    // of my own write, which just refreshed the baseline above.
    if (JSON.stringify(merged) !== JSON.stringify(workingTasksRef.current)) {
      setHist((s) => ({ ...s, present: merged }));
    }
  }, []);
  useLiveSchedule(project?.id, onPeerSchedule);

  // -------------------------------------------------------------------------
  // Edit handlers — all go through a single `commit` that snapshots history
  // -------------------------------------------------------------------------

  const commit = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => {
    setHist(h => {
      const next = producer(h.present);
      // Boundary no-ops (Move up on the top row, Indent on row 1, etc.) return
      // the same array reference. Skip persist + history for those — otherwise
      // pushHistory would clear the redo stack and record a phantom undo step.
      if (next === h.present) return h;
      schedulePersist(next);
      // pushHistory snapshots the old present onto `past` (bounded to 20) and
      // clears the redo stack — a new edit always invalidates redo.
      return pushHistory(h, next, 20);
    });
  }, [schedulePersist]);

  const handleEdit = useCallback((taskId: string, patch: Partial<ScheduleTask>) => {
    const before = workingTasks.find(t => t.id === taskId);
    // Pace flywheel: status transitions auto-stamp as-built days. The stamp
    // sits UNDER the incoming patch, so the Gantt's explicit Start/Finish-
    // today values always win, and stampActuals never touches already-set
    // actuals. Basis: todayScheduleDay(schedule.startDate) — the ONE shared
    // basis every stamping sink uses. NOT this screen's todayDayNumber render
    // memo: its createdAt fallback would stamp real-elapsed days on a
    // startDate-less schedule, a basis no task.startDay shares (pace-book
    // poison). Null basis (no startDate) ⇒ stampActuals records ISO dates
    // only, never invented day numbers. startDateRef mirrors the schedule's
    // startDate eagerly (the settings Apply handler writes it ahead of the
    // debounced persist), so it is the freshest source at call time.
    let effective: Partial<ScheduleTask> = patch;
    if (before && patch.status !== undefined && patch.status !== before.status) {
      const stamp = stampActuals(before, patch.status, todayScheduleDay(startDateRef.current), new Date().toISOString());
      effective = { ...stamp, ...patch };
      // Morning-brief ledger: a real capture (stamp set an ISO date) is a
      // did-for-you moment. recordDidForYou is G4-safe by contract.
      if (stamp.actualStartDate != null || stamp.actualEndDate != null) {
        recordDidForYou(`Auto-stamped actual dates for ${before.title}`, project?.id);
      }
    }
    // Log to the audit before applying so we have the "before" snapshot.
    if (before && project?.id) {
      const isLogicChange = 'dependencies' in effective || 'dependencyLinks' in effective;
      const isProgressChange = 'progress' in effective && effective.progress !== before.progress;
      const entry = buildAuditEntry({
        user: user?.email ?? user?.name ?? 'anonymous',
        taskId,
        taskTitle: before.title,
        kind: isLogicChange ? 'dependency_edit'
          : isProgressChange ? 'progress_update'
          : 'task_edit',
        summary: summarizeTaskDiff(before as unknown as Record<string, unknown>, { ...before, ...effective } as unknown as Record<string, unknown>),
        before: before as unknown as Record<string, unknown>,
        after: { ...before, ...effective } as unknown as Record<string, unknown>,
      });
      void appendAuditToAsyncStorage(project.id, entry);
    }
    commit(prev => prev.map(t => (t.id === taskId ? { ...t, ...effective } : t)));
  }, [commit, workingTasks, project?.id, user]);

  // Small helper so task create/delete can drop audit entries the same way
  // handleEdit does — builds the entry and enqueues the AsyncStorage append.
  const writeAudit = useCallback((entry: Parameters<typeof buildAuditEntry>[0]) => {
    if (!project?.id) return;
    void appendAuditToAsyncStorage(project.id, buildAuditEntry(entry));
  }, [project?.id]);

  // 14-day forecast keyed off project start. Drives the weather-aware
  // reschedule prompt AND the delay-day log written by applyWeatherReschedule
  // below — which is exactly why this must attempt the REAL API rather than
  // calling getSimulatedForecast(): weatherDelayLog is delay documentation,
  // and buildWeatherDelayLog refuses to write an entry with no live evidence.
  //
  // Prefers the project's geocoded lat/lng (far more accurate on rural sites
  // than a free-text address), falling back to the location string. With no
  // EXPO_PUBLIC_OPENWEATHER_API_KEY every day comes back source:'simulated',
  // the reschedule modal says so, and nothing is logged.
  const [forecast, setForecast] = useState<DayForecast[]>([]);
  useEffect(() => {
    let cancelled = false;
    setForecast([]);
    void getForecastWithFallback(
      {
        city: project?.location,
        latitude: project?.locationLatitude,
        longitude: project?.locationLongitude,
      },
      projectStartDate,
      14,
    ).then((days) => {
      if (!cancelled) setForecast(days);
    });
    return () => { cancelled = true; };
  }, [projectStartDate, project?.location, project?.locationLatitude, project?.locationLongitude]);

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
        // Same no-today-fallback rule as schedulePersist — a weather re-plan
        // must not stamp an anchor onto a dateless schedule.
        startDate: startDateRef.current,
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

    // A weather delay-day log entry proves WHAT happened. It does not start the
    // notice clock, and unusually-severe weather is excusable time under most
    // contracts only if you actually claim it in the window. Offer the one tap
    // that turns the log entry into a tracked delay event with this record
    // already attached as evidence.
    //
    // Only offered when buildWeatherDelayLog returned an entry — it returns null
    // when no delay day had a LIVE forecast behind it, and a delay event built
    // on simulated weather would be evidence of nothing.
    if (!logEntry) return;
    // `dates` is the LIVE-evidenced list and buildWeatherDelayLog returns null
    // when it is empty, so [0] is always present; the slice is a belt-and-braces
    // guard that also keeps this a YYYY-MM-DD string for the notice clock's
    // noon-anchored parse.
    const firstObserved = logEntry.dates[0] ?? logEntry.appliedAt.slice(0, 10);
    showAlert(
      'Log this as a delay event?',
      `${logEntry.projectSlipDays} day${logEntry.projectSlipDays === 1 ? '' : 's'} of slip is on the schedule. ` +
      'Logging it starts your contract\u2019s written-notice clock and attaches this weather record as evidence.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Log it',
          onPress: () => router.push({
            pathname: '/delay-events',
            params: {
              projectId: project.id,
              autoLog: '1',
              cause: 'weather',
              firstObservedDate: firstObserved,
              claimedDays: String(logEntry.projectSlipDays),
              description:
                `Weather delay \u2014 ${logEntry.dates.length} evidenced day${logEntry.dates.length === 1 ? '' : 's'}` +
                `${logEntry.condition ? ` (${logEntry.condition})` : ''}. ` +
                `${logEntry.projectSlipDays} day${logEntry.projectSlipDays === 1 ? '' : 's'} of project slip.` +
                (logEntry.source === 'mixed'
                  ? ' Some delay days came from simulated weather and are excluded from the evidenced dates.'
                  : ''),
              evidenceKind: 'weather_log',
              evidenceId: logEntry.id,
              evidenceAt: logEntry.appliedAt,
            },
          }),
        },
      ],
    );
  }, [project, weatherResult, updateProject, cpm.projectFinish, router]);

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

  // Bulk-create tasks in ONE undo step. Used by the grid's ghost row, paste,
  // and insert-anywhere. atIndex undefined → append; atIndex given → splice at
  // that array position. Returns the new ids in creation order (callers focus
  // the first). startDay stacks sequentially so a pasted list lays out in order.
  const handleAddTasks = useCallback(
    (partials: { title: string; durationDays?: number; phase?: string }[], atIndex?: number): string[] => {
      if (partials.length === 0) return []; // never touch history for an empty batch
      // Generate ids in the OUTER scope so the return is reliable: the commit
      // producer runs inside a setState updater, which React may not execute
      // synchronously — so we can't collect ids from inside it and return them.
      // Insert-anywhere focuses the new row by this returned id.
      const newIds = partials.map(() => createId('task'));
      commit(prev => {
        let runningFinish = prev.reduce((m, t) => Math.max(m, t.startDay + t.durationDays), 0);
        const built: ScheduleTask[] = partials.map((p, i) => {
          const durationDays = p.durationDays ?? 1;
          const startDay = runningFinish > 0 ? runningFinish : 1;
          runningFinish = startDay + durationDays;
          return {
            id: newIds[i],
            title: p.title,
            phase: p.phase ?? 'General',
            durationDays,
            startDay,
            progress: 0,
            crew: '',
            dependencies: [],
            notes: '',
            status: 'not_started',
          };
        });
        const next = atIndex === undefined
          ? [...prev, ...built]
          : [...prev.slice(0, atIndex), ...built, ...prev.slice(atIndex)];
        return generateWbsCodes(next);
      });
      writeAudit({
        user: user?.email ?? user?.name ?? 'anonymous',
        kind: 'task_create',
        summary: partials.length === 1 ? `Added task "${partials[0].title || 'Untitled'}"` : `Added ${partials.length} tasks`,
      });
      return newIds;
    },
    [commit, writeAudit, user?.email, user?.name],
  );

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
      showAlert(
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
    const deletedTitle = workingTasks.find(t => t.id === taskId)?.title ?? 'Untitled';
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
    writeAudit({ user: user?.email ?? user?.name ?? 'anonymous', kind: 'task_delete', taskId, summary: `Deleted task "${deletedTitle}"` });
  }, [commit, writeAudit, workingTasks, user?.email, user?.name]);

  // Outline authoring + reorder — indent/outdent set parentId/outlineLevel,
  // reorder swaps array position (task order IS array position). Both flow
  // through the same undo-aware commit() so undo/redo + persist stay intact.
  const handleOutline = useCallback((id: string, dir: 'indent' | 'outdent') => {
    commit(prev => (dir === 'indent' ? indentTask(prev, id) : outdentTask(prev, id)));
  }, [commit]);
  const handleReorder = useCallback((id: string, delta: number) => {
    commit(prev => moveTask(prev, id, delta));
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
  // Per-task soft-lock: broadcast the single selected task into presence so
  // peers see which task I'm on, and map ids->titles so their selections render
  // as "who's editing what" in the PresenceBar.
  const mySelectedTaskId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  useEffect(() => { setPresenceTask(mySelectedTaskId ?? null); }, [mySelectedTaskId, setPresenceTask]);
  const taskTitleById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of workingTasks) m[t.id] = t.title;
    return m;
  }, [workingTasks]);

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
      else showAlert('Nothing to reflow', msg);
      return;
    }
    const next = reflowFromActuals(workingTasks);
    const changedCount = next.filter((t, i) => t.startDay !== workingTasks[i].startDay).length;
    commit(() => next);
    const msg = changedCount === 0
      ? 'Everything is on track — no downstream shifts needed.'
      : `Pushed ${changedCount} task${changedCount === 1 ? '' : 's'} based on actuals. Undo if this looks off.`;
    if (Platform.OS === 'web') window.alert?.(msg);
    else showAlert('Reflow complete', msg);
  }, [workingTasks, commit]);

  // Critical-path / conflict summary — moved out of the toolbar into the
  // "More" overflow menu (Phase 1 front-door). Extracted to a named callback
  // so the menu item can invoke it.
  const showCpmAnalysis = useCallback(() => { setShowCriticalPath(true); }, []);

  // -------------------------------------------------------------------------
  // Fix overloads — run the resource-leveling engine, preview the shifts,
  // then apply them undoably. handleFixOverloads runs the pure leveler and
  // opens the preview; applyLeveling commits the leveled startDays in one
  // undo step and logs a reflow audit entry.
  // -------------------------------------------------------------------------
  const [levelingPreview, setLevelingPreview] = useState<{ summary: LevelingSummary; leveled: Map<string, number>; finishDelta: number } | null>(null);

  const handleFixOverloads = useCallback(() => {
    // Run leveling under the SAME calendar options as the live `cpm` so the
    // previewed finish delta is apples-to-apples — without these, the leveled
    // finish is in raw days while cpm.projectFinish is in calendar days, and
    // the delta (and the modal's "+N days / unchanged") would be meaningless.
    const leveledResult = runCpm(rolledTasks, {
      levelResources: true,
      scheduleStartDate: scheduleStartIso,
      criticalFloatThresholdDays,
      workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
      nonWorkingDates: project?.schedule?.nonWorkingDates,
      taskCalendars,
    });
    const leveled = leveledResult.leveledStartDays;
    // Compare against rolledTasks — the same snapshot the leveled map came
    // from — so summary rows (whose startDay is a derived min-of-children) do
    // not register phantom shifts against the raw working array.
    const summary = leveled ? summarizeLeveling(rolledTasks, leveled) : null;
    if (!leveled || !summary || summary.shiftedCount === 0) {
      // Leveling only resolves crew / subcontractor scheduling conflicts. Be
      // honest instead of claiming "every crew is within capacity" — a Workload
      // heatmap can still show resource-capacity overloads the leveler doesn't
      // act on (those are resolved by reassigning or rescheduling manually).
      const msg = 'Nothing to auto-level — leveling shifts overlapping crew and subcontractor work, and none was found to move.';
      if (Platform.OS === 'web') window.alert?.(msg); else showAlert('Fix overloads', msg);
      return;
    }
    setLevelingPreview({ summary, leveled, finishDelta: leveledResult.projectFinish - cpm.projectFinish });
  }, [rolledTasks, scheduleStartIso, criticalFloatThresholdDays, project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates, taskCalendars, cpm.projectFinish]);

  const applyLeveling = useCallback(() => {
    const p = levelingPreview;
    if (!p) return;
    // Skip summary rows — their startDay is derived from children (rollup), not
    // user-owned, so we never write a leveled value back onto them.
    commit(prev => prev.map(t => (!t.isSummary && p.leveled.has(t.id)) ? { ...t, startDay: p.leveled.get(t.id)! } : t));
    if (project?.id) {
      void appendAuditToAsyncStorage(project.id, buildAuditEntry({
        user: user?.email ?? user?.name ?? 'anonymous',
        kind: 'reflow',
        summary: `Resource leveling: ${p.summary.shiftedCount} task(s) shifted`,
      }));
    }
    setLevelingPreview(null);
  }, [levelingPreview, commit, project?.id, user?.email, user?.name]);

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
      showAlert('CSV ready', `Copy the text below:\n\n${csv.slice(0, 600)}${csv.length > 600 ? '…' : ''}`);
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
        showAlert('Calendar ready', `Downloaded a .ics file with ${result.eventCount} event(s). Open it to import into Apple/Google/Outlook Calendar.`);
      }
      // Native already opens the share sheet from inside exportProjectIcs.
    } catch (err) {
      showAlert('Export failed', err instanceof Error ? err.message : 'Unknown error');
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
      else showAlert('PDF export failed', msg);
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
    showAlert(
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
      showAlert('Pro feature', 'PDF export is available on the Pro plan. Upgrade to unlock it.');
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
    showAlert(
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
        showAlert(
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
      showAlert(
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
      const { buildPrintableGanttHtml } = await import('@/utils/printableGanttHtml');
      // A real fit-to-page Gantt one-pager (bars, FS dependency arrows, milestone
      // diamonds, red critical path, today line) — not a plain table. Feed the
      // SAME rolledTasks the on-screen Gantt draws (summary spans are rolled up
      // at render, not persisted) so the printout matches the screen.
      const html = buildPrintableGanttHtml(rolledTasks, {
        projectName: project?.name ?? 'Schedule',
        todayDayNumber,
        totalDays: cpm.projectFinish,
      });
      await Print.printAsync({ html });
    } catch (e) {
      console.error('AirPrint failed', e);
    }
  }, [project?.name, rolledTasks, todayDayNumber, cpm.projectFinish]);

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

  if (workingTasks.length === 0 && !dismissedOnRamp) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ChevronLeft size={20} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.headerBackText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
          </View>
        </View>
        <ScheduleOnRamp
          onAnswerQuestions={() => router.push({ pathname: '/schedule-builder', params: { projectId: project.id } } as never)}
          onBuildWithAI={() => router.push({ pathname: '/generative-setup', params: { projectId: project.id } } as never)}
          onStartFromTemplate={() => router.push({ pathname: '/schedule-wizard', params: { projectId: project.id } } as never)}
          onAddManually={() => { setDismissedOnRamp(true); handleAddTask(); }}
          onLoadExample={handleLoadDemo}
        />
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
          {/* AI first — the headline value-prop. Highlighted so it stands out.
              The "+ Add Task" affordance now lives inline in the SchedulerHeader
              between VIEW and Export (Phase 27 audit feedback), so it's removed
              from this toolbar to avoid two Add-Task buttons on the same row. */}
          <HeaderBtn icon={MageAIMark} label="AI" onPress={() => setShowAI(true)} highlighted />
          <HeaderBtn icon={Mic} label="Voice" onPress={() => setEditOpen(true)} />
          <ScheduleHealthBadge result={healthScore} onPress={() => setShowHealth(true)} size="compact" />
          <HeaderBtn icon={Undo2} label="Undo" onPress={handleUndo} disabled={!canUndo(hist)} shortcutHint="⌘Z" />
          <HeaderBtn icon={Redo2} label="Redo" onPress={handleRedo} disabled={!canRedo(hist)} shortcutHint="⇧⌘Z" />
          <HeaderBtn icon={Download} label="Export" onPress={() => setExportSheetOpen(true)} />
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
        dailyReports={projectId ? getDailyReportsForProject(projectId) : undefined}
      />

      {/* Copilot edit bar — desktop parity with the mobile "Tell me what to
          change" bar. Tapping opens the ScheduleEditPanel (already mounted
          below). Presentation-only; no new wiring needed. */}
      <TouchableOpacity
        onPress={() => setEditOpen(true)}
        style={styles.copilotDesktopBar}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Tell me what to change"
      >
        <Mic size={16} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.copilotDesktopBarText}>Tell me what to change</Text>
      </TouchableOpacity>

      {/* Body — Phase 27: the SchedulerTabShell (tab nav + SchedulerHeader +
          active tab content) is the single body. The Timeline tab owns all
          five layouts (Grid · Split · Gantt · Lanes · Living Plan); Lanes and
          Living Plan render via the render-props below so their data-fetching
          stays here in the screen. */}
      {(
        <View style={styles.tabShellBody}>
          {schedulePeers.length > 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 6, alignItems: 'flex-end' }}>
              <PresenceBar peers={schedulePeers} taskTitleById={taskTitleById} />
            </View>
          ) : null}
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
            actions={{
              onAddTask: handleAddTask,
              onImport: () => router.push(`/schedule-import?projectId=${project.id}`),
              onReflow: handleReflow,
              onClosures: () => setShowClosures(true),
              onCriticalPath: showCpmAnalysis,
              onLevelResources: handleFixOverloads,
              onHistory: () => setShowAudit(true),
              onBaseline: () => setShowBaselineManager(true),
              onWeather: openWeatherReschedule,
              onExport: () => setExportSheetOpen(true),
              onShare: handleShare,
              onAI: () => setShowAI(true),
            }}
            initialLayout="split"
            renderLanes={() => (
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
            )}
            renderLiving={() => {
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
            }}
            projectStartDate={projectStartDate}
            workingDaysPerWeek={workingDaysPerWeek}
            nonWorkingDates={project?.schedule?.nonWorkingDates}
            utilsCpm={cpm}
            resources={project?.schedule?.resources}
            onFixOverloads={handleFixOverloads}
            onEdit={handleEdit}
            onAddTask={handleAddTask}
            onAddTasks={handleAddTasks}
            onAddTaskAtDay={handleAddTaskAtDay}
            onDeleteTask={handleDeleteTask}
            onOutline={handleOutline}
            onReorder={handleReorder}
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

      {/* Fix overloads — preview the resource-leveling shifts, apply undoably. */}
      {levelingPreview !== null && (
        <LevelingPreviewModal
          visible
          summary={levelingPreview.summary}
          projectFinishDelta={levelingPreview.finishDelta}
          onApply={applyLeveling}
          onClose={() => setLevelingPreview(null)}
        />
      )}

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

      {/* Conversational schedule editor — say the change, preview the CPM
          ripple, apply through this screen's own commit() (so it lands on the
          same undo/audit stack as a manual edit). */}
      {project && (
        <ScheduleEditPanel
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          projectId={project.id}
          tasks={workingTasks}
          commit={commit}
          cpmOptions={{
            scheduleStartDate: scheduleStartIso,
            criticalFloatThresholdDays,
            workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
            nonWorkingDates: project?.schedule?.nonWorkingDates,
            taskCalendars,
          }}
        />
      )}

      {/* Schedule health score detail. Tap a flagged task → opens it
          in the inspector. (Inspector wiring uses an existing dispatch
          to setSelectedTaskId, hooked elsewhere — passing a no-op for
          now keeps the modal self-contained.) */}
      <ScheduleHealthDetail
        visible={showHealth}
        onClose={() => setShowHealth(false)}
        result={healthScore}
      />

      {/* Critical-path / float explanation — replaces the old raw "Schedule
          analysis" Alert. Says, per task, "on the critical path" or "can slip
          N days". Building the explanation each render is a cheap pure map. */}
      <CriticalPathPanel
        visible={showCriticalPath}
        explanation={buildCriticalPathExplanation(cpm, rolledTasks)}
        onClose={() => setShowCriticalPath(false)}
      />

      {/* Schedule audit-log viewer — read UI over the append-only history
          written on every CPM-affecting edit. Grouped by day, newest first. */}
      <ScheduleAuditModal
        visible={showAudit}
        projectId={project?.id ?? ''}
        onClose={() => setShowAudit(false)}
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
        startDate={project?.schedule?.startDate}
        onClose={() => setShowSettings(false)}
        onApply={(patch) => {
          if (!project) return;
          const prevStart = project.schedule?.startDate;
          const nextStart = patch.startDate ?? prevStart;
          // First explicit anchor on a raw-day schedule: its startDay values
          // are working-day ordinals, so re-map them onto the calendar or the
          // CPM mode flip would silently inflate every multi-day chain (the
          // finish-jump bug). Runs through commit() = one undoable step.
          if (!prevStart && nextStart && workingTasks.length > 0) {
            const rebased = rebaseRawToCalendar(
              workingTasks, nextStart, patch.workingDaysPerWeek,
              project.schedule?.nonWorkingDates,
            );
            if (rebased !== workingTasks) {
              const moved = rebased.filter((t, i) => t.startDay !== workingTasks[i].startDay).length;
              commit(() => rebased);
              writeAudit({
                user: user?.email ?? user?.name ?? 'anonymous',
                kind: 'reflow',
                summary: `Set start date ${nextStart} — re-anchored ${moved} task(s) onto the working-day calendar`,
              });
            }
          }
          // Eager ref write: the rebase commit above schedules a debounced
          // persist whose closure may predate the updateProject below —
          // without this it would write the OLD (undefined) anchor back.
          startDateRef.current = nextStart;
          updateProject(project.id, {
            schedule: {
              ...(project.schedule as ProjectSchedule),
              criticalFloatThresholdDays: patch.criticalFloatThresholdDays,
              workingDaysPerWeek: patch.workingDaysPerWeek,
              startDate: nextStart,
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
        onExportIcal={() => { void handleExportIcs(); }}
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
// Small header-button subcomponent (keeps the header JSX tidy)
// ---------------------------------------------------------------------------

function HeaderBtn({
  icon: Icon, label, onPress, onLongPress, disabled, highlighted, shortcutHint,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  highlighted?: boolean;
  /** Optional keyboard shortcut string shown next to the label on web (e.g. "⌘Z"). */
  shortcutHint?: string;
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
      {shortcutHint && Platform.OS === 'web' && (
        <Text style={[styles.headerBtnHint, { color: disabled ? themeColors.textMuted : themeColors.textSecondary }]}>
          {shortcutHint}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Overflow "More" menu row
// ---------------------------------------------------------------------------

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
  // Disabled state: stronger contrast reduction (opacity 0.35) so the button
  // reads clearly as unavailable rather than just slightly faded.
  headerBtnDisabled: { backgroundColor: t.surfaceAlt, opacity: 0.35 },
  headerBtnHighlighted: { backgroundColor: t.accent },
  headerBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent },
  // Keyboard shortcut hint shown next to label on web only.
  headerBtnHint: { fontSize: Type.caption2.fontSize, fontWeight: '500', color: t.textSecondary },

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

  copilotDesktopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: t.accentSoft,
    borderRadius: Tokens.radius.full,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: t.accent,
  },
  copilotDesktopBarText: {
    flex: 1,
    ...Type.subheadEmphasized,
    color: t.accent,
  },

});
