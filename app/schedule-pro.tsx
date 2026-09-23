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
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Platform, Alert, Modal, ActivityIndicator, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Undo2, Redo2, Download, Mic } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import { printHtmlDocument } from '@/utils/platformFile';
import { exportProjectIcs } from '@/utils/icsGenerator';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRole, useProjectRoleState } from '@/hooks/useProjectRole';
import LockedAccessCard, { FieldSendFailureBanner } from '@/components/LockedAccessCard';
import {
  applyFieldTaskPatches, mergeWrittenStamps, fieldScheduleSettingsChanged, fieldTaskDiff, scheduleWritePathForRole,
  sendFieldTaskPatches, staleFieldEdits, type FieldEditRefusal,
  captureFieldSendFailure, mergeFieldSendFailure, pendingFieldRetryPatches, fieldAutoRetryDelayMs,
  planFieldRetry, fieldRetrySupersededNotice,
  type FieldSendFailure,
} from '@/utils/fieldScheduleUpdate';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useSchedulePresence } from '@/hooks/useSchedulePresence';
import { liveScheduleCopyFromRow, useLiveSchedule, type LiveScheduleCopy } from '@/hooks/useLiveSchedule';
import {
  answerScheduleReread, beginScheduleReread, inLocalOrder, nextOwnScheduleStamp, takeStoreScheduleCopy, noteFieldScheduleSave, noteOwnScheduleSave, noteScheduleSocketGap, openScheduleSyncGate,
  projectWriteQueued, queuedScheduleStamps, seedQueuedScheduleStamps, settleScheduleSyncGate, takeScheduleCopy,
  type ScheduleCopy,
} from '@/utils/scheduleMerge';
import { getOwnOfflineQueue, onQueueChanged } from '@/utils/offlineQueue';
import { PresenceBar } from '@/components/schedule/PresenceBar';
import Paywall from '@/components/Paywall';
import { cardSurface } from '@/components/ui';
import GridPane from '@/components/schedule/GridPane';
import InteractiveGantt, { GanttStampBasis } from '@/components/schedule/InteractiveGantt';
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
import { runCpm, workingDaysBetween, dateToCalendarDay, stampCriticalPath, previewStartDayBasisMigration, startDayBasisAnswerPatch, type CpmResult } from '@/utils/cpm';
import { StartDayBasisNotice } from '@/components/schedule/StartDayBasisNotice';
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
import { LevelingPreviewModal } from '@/components/schedule/LevelingPreviewModal';
import { buildScheduleFromTasks, mergeEditedSchedule, createId, generateWbsCodes } from '@/utils/scheduleEngine';
import { seedDemoSchedule } from '@/utils/demoSchedule';
import {
  reflowFromActuals,
  actualCalendarDay,
  reapplyBaselineToTasks,
  readActiveBaselineId,
  resolveActiveBaseline,
  baselineStampedOnTasks,
  activeBaselineAfterChange,
  withActiveBaselineId,
  scheduleProGate,
  baselineFinishDayWorkingScale,
  exportTasksToCsv,
  downloadCsvInBrowser,
  encodeShareToken,
  buildSharePayload,
  ShareTokenTooLargeError,
  tryEncodeShareToken,
  UNDATED_SCHEDULE_BODY,
  UNDATED_SCHEDULE_TITLE,
  type NamedBaseline,
} from '@/utils/scheduleOps';
import { buildShareUrl, buildSnapshotShareUrl } from '@/utils/webAppOrigin';
import { loadSubUpdates } from '@/utils/subScheduleUpdatesStorage';
import { supabase } from '@/lib/supabase';
import type { Project, ScheduleTask, ProjectSchedule } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { copyToClipboard } from '@/utils/clipboard';
/** A server copy as Schedule Pro adopts it: ScheduleCopy plus the active
 *  baseline when the copy says (#86 — undefined = does not say, null = cleared). */
type LiveCopy = ScheduleCopy & { activeBaselineId?: string | null };

/** How the refused-edit notice names a field-owned task key. */
const FIELD_KEY_LABEL: Record<string, string> = {
  progress: 'progress', status: 'status', notes: 'notes',
  actualStartDate: 'actual start', actualStartDay: 'actual start',
  actualEndDate: 'actual finish', actualEndDay: 'actual finish',
};

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

/** The sub daily-update rollup on a task list: a task's progress rises to
 *  the highest progress a sub reported, never falls. Returns `tasks` itself
 *  when nothing rises. */
function withSubRollup(tasks: ScheduleTask[], latestByTask: ReadonlyMap<string, number>): ScheduleTask[] {
  if (latestByTask.size === 0) return tasks;
  let mutated = false;
  const next = tasks.map(t => {
    const rollup = latestByTask.get(t.id);
    if (rollup != null && rollup > (t.progress ?? 0)) {
      mutated = true;
      return { ...t, progress: rollup };
    }
    return t;
  });
  return mutated ? next : tasks;
}

export default function ScheduleProScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const goBack = useSafeBack();
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  // Own tier OR the collaborator grant on THIS job (#91): an invited foreman
  // on a free account opens the GC's plan, not a Pro paywall. Without a
  // projectId (sidebar, search) it is the viewer's own tier, as before.
  const { canAccess } = useProjectAccess(gateProjectId || undefined);
  const roleState = useProjectRoleState(gateProjectId || undefined);
  const gate = scheduleProGate({
    canAccess: canAccess('schedule_gantt_pdf'),
    hasProjectId: !!gateProjectId,
    roleLoading: roleState.isLoading,
    roleError: roleState.isError,
    role: roleState.role,
  });
  if (gate === 'open') return <ScheduleProScreenInner />;
  if (gate === 'loading') {
    return (
      <View style={styles.gateWrap} testID="schedule-pro-gate-loading">
        <ActivityIndicator color={themeColors.accent} />
      </View>
    );
  }
  if (gate === 'error' || gate === 'no_access') {
    return (
      <View style={styles.gateWrap} testID={`schedule-pro-gate-${gate}`}>
        <Text style={styles.gateTitle}>{gate === 'error' ? 'Couldn’t check your access' : 'You don’t have access to this schedule'}</Text>
        <Text style={styles.gateBody}>
          {gate === 'error'
            ? 'Your access to this project could not be read, so Schedule Pro stays closed rather than guessing. Check your connection and try again.'
            : 'You are not on this project’s team, so its schedule does not open for you. Ask the project owner to invite you.'}
        </Text>
        <View style={styles.gateActions}>
          {gate === 'error' ? (
            <TouchableOpacity style={styles.gateBtn} onPress={() => { void roleState.refetch(); }} accessibilityRole="button" accessibilityLabel="Try again">
              <Text style={styles.gateBtnText}>Try again</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.gateBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.gateBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  return (
    <Paywall
      visible={true}
      feature="Schedule Pro (Gantt + PDF Export)"
      requiredTier="pro"
      onClose={goBack}
    />
  );
}

function ScheduleProScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Not router.back(): schedule-pro is deep-linkable (`mageid://schedule-pro`,
  // and app.mageid.app/schedule-pro in a fresh tab, which is exactly where the
  // narrow gate below fires). On a first route expo-router's back is an
  // unhandled GO_BACK and the control silently does nothing — see
  // hooks/useSafeBack.ts (audit UX-F18).
  const goBack = useSafeBack();
  const { width } = useWindowDimensions();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { user } = useAuth();

  const {
    projects,
    updateProject: updateProjectRaw,
    absorbServerSchedule,
    isProjectSyncUnconfirmed,
    onProjectSyncSettled,
    getInvoicesForProject,
    getPlanSheetsForProject,
    getPlanZonesForProject,
    getPinsForPlan,
    getPhotosForProject,
    getDailyReportsForProject,
  } = useProjects();

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  // Re-read access inside the inner so the PDF handler can guard on the
  // narrower `schedule_gantt_pdf` feature flag directly (the outer gate covers
  // full Schedule Pro access — this is the export-specific gate should we split
  // the bundle in the future). Project-scoped (#91): own tier OR the grant on
  // the project on screen, so the foreman's export is not refused as "Pro".
  const { canAccess } = useProjectAccess(projectId || undefined);

  const project = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId],
  );

  // WHERE THIS SCREEN'S SCHEDULE WRITES GO, by the caller's role (#25).
  //
  //   owner / editor (and null while the role loads, so they never see a
  //   read-only flash) → updateProject, the projects-row PATCH.
  //   viewer → nowhere; every updateProject(...) below is a no-op.
  //   field  → the field_update_schedule_tasks RPC. The row PATCH is refused by
  //   projects_update for field users with 200 + 0 rows, so a foreman's drag
  //   or progress edit looked saved here and was gone on his next reload. The
  //   RPC saves progress, status, notes and actual start/finish ONLY; anything
  //   else he changed (dates, durations, links, tasks added or removed,
  //   settings) is NOT saved, the working copy is put back to what the server
  //   holds, and the notice below says so instead of letting it vanish later.
  const role = useProjectRole(projectId);
  const writePath = scheduleWritePathForRole(role ?? project?.myRole);
  const [fieldNotice, setFieldNotice] = useState<string | null>(null);
  // A refusal on one project is not news on the next: the notice belongs to
  // the project it was about (the picker can switch projects in place).
  useEffect(() => { setFieldNotice(null); }, [projectId]);
  // A field send that did not reach the server (#138): its own plain banner
  // with Retry — the phone schedule's exact behaviour
  // (MobileScheduleScreen), pinned together by validate-field-schedule-update.
  const [fieldFailure, setFieldFailure] = useState<FieldSendFailure | null>(null);
  const autoRetryAttemptRef = React.useRef(0);
  useEffect(() => { setFieldFailure(null); autoRetryAttemptRef.current = 0; }, [projectId]);
  // Latest projects for the async field save — the closure that fires can
  // predate the render that holds the edit it is diffing against.
  const projectsRef = React.useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  // Set once setHist exists (declared below); the field save uses it to put the
  // working copy back to what the server accepted.
  const resetWorkingTasksRef = React.useRef<((tasks: ScheduleTask[]) => void) | null>(null);
  // When this screen may take a schedule copy from elsewhere — see
  // utils/scheduleMerge.ts. While it has an unwritten edit or a write still
  // leaving it takes no server copy (no merge, no rebase); once quiet it
  // adopts the server's copy whole. A copy another writer on this device put
  // in ProjectContext is taken as soon as no edit of the screen is waiting. 357d0a34 merged every realtime echo against a
  // baseline it moved to its own save, so the echo of the save before read as
  // a peer's change and a drag made ~1 s after the last one snapped back; the
  // 3-way tracker that followed never converged. Every row save is stamped
  // (schedule.updatedAt) and noted here BEFORE it reaches updateProject, which
  // is how its echo is told from anyone else's.
  const syncGateRef = React.useRef(openScheduleSyncGate(project?.id, project?.schedule?.updatedAt ?? null));
  // The last copy the screen knows the server holds (the load, or the last
  // one adopted) — the field-refusal notice reads it to tell the values the GC
  // changed HERE from ones his stale copy merely carried.
  const lastServerTasksRef = React.useRef<ScheduleTask[]>(project?.schedule?.tasks ?? []);
  // Set below once the persist state exists: re-checks for quiet and adopts
  // a parked copy.
  const settleSyncRef = React.useRef<() => void>(() => {});
  // The debounced persist, for handlers declared above it.
  const schedulePersistRef = React.useRef<(tasks: ScheduleTask[]) => void>(() => {});
  // Sub daily-update progress per task (the rollup effect below). Display
  // only, max-wins — re-applied to every copy the screen adopts.
  const subRollupRef = React.useRef<Map<string, number>>(new Map());
  // Field saves between the persist timer and the RPC's answer: busy.
  const fieldSavesInFlightRef = React.useRef(0);
  // `serverBase`: a retry's fresh read of the row (#138) — diffed against and
  // applied over THAT, not this screen's copy, which may predate it.
  const saveAsField = useCallback(async (id: string, updates: Partial<Project>, serverBase?: ScheduleTask[]) => {
    fieldSavesInFlightRef.current += 1;
    noteFieldScheduleSave(syncGateRef.current);
    try {
      const current = projectsRef.current.find(p => p.id === id);
      const currentSchedule = current?.schedule;
      if (!currentSchedule) return;
      const baseTasks = serverBase ?? currentSchedule.tasks ?? [];
      const { patches, blocked } = updates.schedule?.tasks
        ? fieldTaskDiff(baseTasks, updates.schedule.tasks)
        : { patches: [], blocked: [] };
      const settingsChanged = Object.keys(updates).some(k => k !== 'schedule')
        || fieldScheduleSettingsChanged(currentSchedule, updates.schedule);
      let accepted = baseTasks;
      let failure: string | null = null;
      if (patches.length > 0) {
        const sent = await sendFieldTaskPatches(supabase, id, patches);
        if (sent.ok) {
          accepted = applyFieldTaskPatches(baseTasks, patches);
          accepted = mergeWrittenStamps(accepted, sent.stamps); // #87: the server's own stamps
          // A task the owner deleted meanwhile was skipped by the server — no
          // history row for it.
          const landed = patches.filter(p => !sent.missing.includes(p.id));
          // Local copy = what the server now holds. The row PATCH this also
          // enqueues is refused for field (0 rows, nothing written).
          updateProjectRaw(id, { schedule: { ...currentSchedule, tasks: accepted, updatedAt: new Date().toISOString() } });
          // The field audit row is written HERE, after the server said yes, and
          // only for what it took. handleEdit used to write it at the tap —
          // before the RPC — so an offline or refused save still left
          // "Framing → 60%" in the append-only schedule_audit_log, a record of
          // progress that never saved, which a delay claim could be argued from.
          const who = user?.email ?? user?.name ?? 'anonymous';
          for (const p of landed) {
            const b = baseTasks.find(t => t.id === p.id);
            const a = accepted.find(t => t.id === p.id);
            if (!b || !a) continue;
            void appendAuditToAsyncStorage(id, buildAuditEntry({
              user: who,
              taskId: p.id,
              taskTitle: b.title,
              kind: 'progress' in p && p.progress !== b.progress ? 'progress_update' : 'task_edit',
              summary: summarizeTaskDiff(b as unknown as Record<string, unknown>, a as unknown as Record<string, unknown>),
              before: b as unknown as Record<string, unknown>,
              after: a as unknown as Record<string, unknown>,
            }));
          }
        } else {
          failure = sent.message;
          // Kept in memory for Retry — see captureFieldSendFailure for why
          // this is not the offline queue.
          const captured = captureFieldSendFailure(id, baseTasks, patches, sent);
          setFieldFailure(prev => mergeFieldSendFailure(prev, captured));
        }
      }
      if (!failure && blocked.length === 0 && !settingsChanged) {
        // A clean save clears an earlier refusal — it is no longer true.
        if (patches.length > 0) setFieldNotice(null);
        if (patches.length > 0) autoRetryAttemptRef.current = 0;
      } else {
        resetWorkingTasksRef.current?.(accepted);
        const what = blocked.length > 0
          ? `changes to ${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? ` and ${blocked.length - 3} more` : ''}`
          : settingsChanged ? 'schedule settings' : '';
        // The padlock card carries ONLY what access refused; a send failure
        // has its own banner (fieldFailure) — both show when both happened.
        if (what) setFieldNotice(`Not saved: ${what}. Field access saves progress, status, notes and actual start/finish only — ask the project owner for editor access to move dates or change tasks.`);
      }
    } finally {
      fieldSavesInFlightRef.current -= 1;
      // The RPC answered: its echo (or one parked meanwhile) may now be taken.
      settleSyncRef.current();
    }
  }, [updateProjectRaw, user]);
  // #25, the second writer, owner side. The server keeps a field value newer
  // than the one this screen's edit was built on (migration 20260917160000's
  // trigger; updateProject applies the same rule locally). Without this, the
  // GC's change to a task the foreman had updated looked saved here and was
  // gone on the next load. So the row save asks first which values will be
  // refused, and hands them to the screen (declared below, where the working
  // copy lives) to put back and — when he changed them HERE — to say so.
  const [fieldConflictNotice, setFieldConflictNotice] = useState<string | null>(null);
  useEffect(() => { setFieldConflictNotice(null); }, [projectId]);
  const onFieldRefusalsRef = React.useRef<((refused: FieldEditRefusal[], kept: ScheduleTask[], sent: ScheduleTask[]) => void) | null>(null);
  const saveAsRow = useCallback((id: string, rawUpdates: Partial<Project>) => {
    const keptTasks = projectsRef.current.find(p => p.id === id)?.schedule?.tasks ?? [];
    // Every schedule save gets its own stamp, strictly after the last one —
    // some write sites here spread the stored schedule and would resend ITS
    // updatedAt, and two saves sharing a stamp cannot be told apart when
    // their echoes come back (utils/scheduleMerge.ts).
    const stamp = rawUpdates.schedule ? nextOwnScheduleStamp(syncGateRef.current) : null;
    const updates: Partial<Project> = rawUpdates.schedule && stamp
      ? { ...rawUpdates, schedule: { ...rawUpdates.schedule, updatedAt: stamp } }
      : rawUpdates;
    const sentTasks = updates.schedule?.tasks;
    const refused = sentTasks ? staleFieldEdits(keptTasks, sentTasks) : [];
    if (stamp) noteOwnScheduleSave(syncGateRef.current, stamp);
    updateProjectRaw(id, updates);
    if (sentTasks && refused.length > 0) onFieldRefusalsRef.current?.(refused, keptTasks, sentTasks);
  }, [updateProjectRaw]);
  // Re-send what did not land (#138) — the same rule as the phone: READ the
  // row first and decide against the server's copy (planFieldRetry), because
  // a device that had no signal cannot have received the GC's newer edit and
  // the RPC stamps what it takes with the server clock. A key goes out only
  // while the server still holds the value and stamp this device had when the
  // send failed; one changed elsewhere is dropped and he is told so. No read:
  // nothing is sent, the failure stays for the next try. The send goes through
  // saveAsField (diffed against and applied over the read, audited, reported).
  const fieldFailureRef = React.useRef<FieldSendFailure | null>(null);
  fieldFailureRef.current = fieldFailure;
  const retryInFlightRef = React.useRef(false);
  const retryFieldSend = useCallback(() => {
    const f = fieldFailureRef.current;
    if (!f || retryInFlightRef.current) return;
    if (writePath !== 'field_rpc') { setFieldFailure(null); return; }
    retryInFlightRef.current = true;
    void (async () => {
      try {
        const plan = await planFieldRetry(f, async () => {
          const { data, error } = await supabase.from('projects').select('schedule').eq('id', f.projectId).maybeSingle();
          if (error) return null;
          const fresh = (data as { schedule?: { tasks?: ScheduleTask[] } } | null)?.schedule?.tasks;
          return Array.isArray(fresh) ? fresh : null;
        });
        // A new object re-arms the backoff timer; the same failure, still held.
        if (!plan.read) { setFieldFailure(cur => (cur === f ? { ...f } : cur)); return; }
        const notice = plan.superseded.length > 0 ? fieldRetrySupersededNotice(f.projectId, plan.superseded) : null;
        setFieldFailure(cur => (cur === f ? notice : cur));
        if (plan.patches.length === 0) {
          // Nothing to send — take the newer server copy through the screen's
          // own quiet-time re-read, the path a socket gap uses.
          noteScheduleSocketGap(syncGateRef.current);
          settleSyncRef.current();
          return;
        }
        const current = projectsRef.current.find(p => p.id === f.projectId)?.schedule;
        if (!current) return;
        await saveAsField(f.projectId, { schedule: { ...current, tasks: applyFieldTaskPatches(plan.serverTasks, plan.patches) } }, plan.serverTasks);
      } finally {
        retryInFlightRef.current = false;
      }
    })();
  }, [writePath, saveAsField]);
  const dismissFieldFailure = useCallback(() => { setFieldFailure(null); autoRetryAttemptRef.current = 0; }, []);
  // No signal: re-send by itself while the screen is open — on a backoff, and
  // at once when the app returns to the foreground (no NetInfo in this app).
  useEffect(() => {
    if (!fieldFailure?.offline) return;
    const h = setTimeout(() => { autoRetryAttemptRef.current += 1; retryFieldSend(); }, fieldAutoRetryDelayMs(autoRetryAttemptRef.current));
    return () => clearTimeout(h);
  }, [fieldFailure, retryFieldSend]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && fieldFailureRef.current?.offline) retryFieldSend();
    });
    return () => sub.remove();
  }, [retryFieldSend]);
  const fieldFailureShown = useMemo<FieldSendFailure | null>(() => {
    if (!fieldFailure) return null;
    if (!fieldFailure.retryable) return fieldFailure;
    return pendingFieldRetryPatches(fieldFailure, project?.schedule?.tasks ?? []).length > 0 ? fieldFailure : null;
  }, [fieldFailure, project?.schedule?.tasks]);
  const updateProject = useMemo<typeof updateProjectRaw>(
    () => (writePath === 'row'
      ? saveAsRow
      : writePath === 'field_rpc'
        ? (id, updates) => { void saveAsField(id, updates); }
        : () => {}),
    [writePath, updateProjectRaw, saveAsField, saveAsRow],
  );
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;

  // Local working copy so the grid feels instant; we debounce persistence.
  // The undo/redo stacks live in a single HistoryState via the pure,
  // unit-tested reducer in @/utils/scheduleHistory. `workingTasks` is the
  // live present — deriving it (rather than a separate useState) guarantees
  // the task state and the undo stacks can never drift out of sync.
  const [hist, setHist] = useState<HistoryState<ScheduleTask[]>>(
    () => emptyHistory(project?.schedule?.tasks ?? []),
  );
  const workingTasks = hist.present;
  useEffect(() => {
    resetWorkingTasksRef.current = (tasks) => setHist(emptyHistory(tasks));
  }, []);
  // The row save found field values the server will keep over this edit (see
  // saveAsRow). Put the kept values back in the working copy — only where the
  // screen still holds the refused value, so a keystroke since the save is not
  // stepped on — and report the ones the GC changed on THIS screen (they
  // differ from the last server copy it absorbed). A refused value he never
  // touched is just his stale copy catching up: it updates without a notice.
  useEffect(() => {
    onFieldRefusalsRef.current = (refused, kept, sent) => {
      const keptById = new Map(kept.map(t => [t.id, t] as const));
      const sentById = new Map(sent.map(t => [t.id, t] as const));
      const baseById = new Map(lastServerTasksRef.current.map(t => [t.id, t] as const));
      const val = (t: ScheduleTask | undefined, k: string) => (t as unknown as Record<string, unknown> | undefined)?.[k];
      const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      setHist(h => {
        let changed = false;
        const present = h.present.map((t) => {
          const mine = refused.filter(r => r.taskId === t.id && eq(val(t, r.key), val(sentById.get(t.id), r.key)));
          if (mine.length === 0) return t;
          const k0 = keptById.get(t.id);
          const next = { ...(t as unknown as Record<string, unknown>) };
          for (const r of mine) {
            const v = val(k0, r.key);
            if (v === undefined) delete next[r.key]; else next[r.key] = v;
          }
          const keptStamps = val(k0, 'fieldEditedAt');
          if (keptStamps !== undefined) next.fieldEditedAt = keptStamps;
          changed = true;
          return next as unknown as ScheduleTask;
        });
        return changed ? { ...h, present } : h;
      });
      const reported = refused.filter(r => !eq(val(sentById.get(r.taskId), r.key), val(baseById.get(r.taskId), r.key)));
      if (reported.length === 0) return;
      const first = reported[0];
      const title = sentById.get(first.taskId)?.title || 'A task';
      const when = new Date(first.fieldEditedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const what = FIELD_KEY_LABEL[first.key] ?? first.key;
      // Neutral about WHO: any stamp this runtime did not mint reads as
      // someone else's — the foreman's RPC, but equally the GC's own phone or
      // a PM on editor access. Naming the field would be a guess shown as fact.
      const more = reported.length > 1 ? ` ${reported.length - 1} other change${reported.length > 2 ? 's were' : ' was'} kept the same way.` : '';
      setFieldConflictNotice(`${title}'s ${what} was updated elsewhere — in the field or on another device — at ${when}, after this screen loaded, so your change was not saved. It now shows that value — change it again if yours is right.${more}`);
    };
  }, []);

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
  // WHICH baseline is the yardstick (#137). Activate on an older baseline
  // used to re-stamp the Gantt's ghost bars from it while the ACTIVE chip and
  // the header slip stayed on the newest, so two "late"s showed at once. The
  // id is persisted on the schedule (activeBaselineId) with the task baselines
  // in the same save, and every reader resolves it via resolveActiveBaseline.
  // Ref for the persist closures (like baselinesRef), state for rendering.
  const activeBaselineIdRef = React.useRef<string | undefined>(readActiveBaselineId(project?.schedule));
  const [activeBaselineId, setActiveBaselineIdState] = useState<string | undefined>(() => readActiveBaselineId(project?.schedule));
  const setActiveBaselineId = useCallback((id: string | undefined) => {
    activeBaselineIdRef.current = id;
    setActiveBaselineIdState(id);
  }, []);
  // Adopt the stored id when IT changes (a project switch, a refetch carrying
  // the phone's lock) — keyed on the value, so a re-render that carries the
  // same stale id cannot undo an activation still waiting in the debounce.
  const storedActiveBaselineId = readActiveBaselineId(project?.schedule);
  const activeIdProjectRef = React.useRef(project?.id);
  useEffect(() => {
    // An Activate still waiting in the persist debounce is this screen's
    // newest word on the yardstick (#86): a store change that lands inside
    // that window (another screen on this device absorbing a peer copy) must
    // not take it back. The persist writes this screen's id, the store then
    // carries it and this effect agrees. A project switch always adopts.
    const switched = activeIdProjectRef.current !== project?.id;
    activeIdProjectRef.current = project?.id;
    if (!switched && persistPendingRef.current) return;
    setActiveBaselineId(storedActiveBaselineId);
  // persistPendingRef is a ref, read at the moment the stored id changes.
  }, [project?.id, storedActiveBaselineId, setActiveBaselineId]);
  const activeBaseline = useMemo(
    () => resolveActiveBaseline(namedBaselines, activeBaselineId),
    [namedBaselines, activeBaselineId],
  );

  // Resync when the project changes (e.g. user switches projects in classic
  // screen and comes back). Only reset if the project identity itself changed.
  useEffect(() => {
    // Full reload for a new project — reset the undo/redo stacks entirely.
    setHist(emptyHistory(project?.schedule?.tasks ?? []));
    // A new gate for the loaded copy. The project's own save stamps live in
    // module scope, so a remount still knows the saves its previous mount
    // left in the sync debounce or on the wire.
    syncGateRef.current = openScheduleSyncGate(project?.id, project?.schedule?.updatedAt ?? null);
    lastServerTasksRef.current = project?.schedule?.tasks ?? [];
    setNamedBaselines((project?.schedule?.baselines ?? []) as NamedBaseline[]);
  }, [project?.id]);

  // Whether this project has a write in the offline queue (busy), kept
  // current from the queue's change events. Busy until the first read says
  // otherwise, and busy from the moment a change is signalled until it is
  // read — a write that just queued must not look settled. The first read
  // also seeds the stamps of saves queued before this mount (a page reloaded
  // offline): they are this device's when they replay, not a peer's.
  const queueBusyRef = React.useRef(true);
  useEffect(() => {
    const pid = project?.id;
    if (!pid) { queueBusyRef.current = false; return; }
    let disposed = false;
    let seq = 0;
    let seeded = false;
    const refresh = () => {
      const mine = ++seq;
      queueBusyRef.current = true;
      void getOwnOfflineQueue().then((queue) => {
        if (disposed || mine !== seq) return;
        if (!seeded) { seeded = true; seedQueuedScheduleStamps(syncGateRef.current, queuedScheduleStamps(queue, pid)); }
        queueBusyRef.current = projectWriteQueued(queue, pid);
        settleSyncRef.current();
      }).catch(() => {
        // Unreadable queue: judge by the sync state alone rather than never
        // taking another copy.
        if (disposed || mine !== seq) return;
        queueBusyRef.current = false;
        settleSyncRef.current();
      });
    };
    refresh();
    const unsubscribe = onQueueChanged(refresh);
    return () => { disposed = true; unsubscribe(); };
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

  // Mirror workingTasks into a ref so the unmount-flush closure (bound once,
  // at mount) always reads the latest copy.
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
  //
  // TWO PASSES. The first CPM run tells us where each CHILD is actually
  // scheduled; the rollup spans that rather than the child's authored pin (a
  // summary over a task its predecessor had pushed used to span the wrong
  // window entirely); the live `cpm` below then runs on the rolled result. The
  // engine is O(V+E) over a few dozen rows, so the second run is free next to
  // the render it feeds.
  const summaryScale = useMemo(() => ({
    scheduleStartDate: scheduleStartIso,
    workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
    nonWorkingDates: project?.schedule?.nonWorkingDates,
  }), [scheduleStartIso, project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates]);

  // v2.2c — per-task calendar map for tasks with resourceIds that resolve
  // to a non-project calendar. Tasks not in the map fall back to the
  // project-level workingDaysPerWeek + nonWorkingDates inside runCpm.
  //
  // Built from `workingTasks`, NOT from `rolledTasks`, for two reasons: the
  // rollup only rewrites summary rows' derived dates (the id set and every
  // `resourceIds` are identical), and the LOCATING pass below needs the map
  // too. Deriving it from the rolled list made that impossible without a
  // render cycle, so the first pass ran calendar-blind and a task on a
  // Mon-Sat resource calendar got located on the project's Mon-Fri one —
  // then the summary bar was rolled onto that wrong window while the child
  // bar beside it was drawn on the right one (2026-09-11 review).
  const taskCalendars = useMemo(() => {
    if (!project?.schedule) return undefined;
    const map = new Map<string, { workingDaysPerWeek: number; closures: string[] }>();
    for (const task of workingTasks) {
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
  }, [workingTasks, project?.schedule]);

  const rolledTasks = useMemo(() => {
    const hasSummary = workingTasks.some(t => t.isSummary);
    if (!hasSummary) return computeSummaryRollup(workingTasks);
    const firstPass = runCpm(workingTasks, {
      scheduleStartDate: scheduleStartIso,
      criticalFloatThresholdDays,
      workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
      nonWorkingDates: project?.schedule?.nonWorkingDates,
      taskCalendars,
    });
    // A cycle makes perTask empty; fall back to the authored pins rather than
    // rolling every summary onto day 1.
    if (firstPass.perTask.size === 0) return computeSummaryRollup(workingTasks);
    return computeSummaryRollup(workingTasks, {
      scheduled: firstPass.perTask,
      scale: summaryScale,
    });
  }, [workingTasks, scheduleStartIso, criticalFloatThresholdDays, project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates, summaryScale, taskCalendars]);

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
    const active = activeBaseline;
    if (!active) return null;
    return baselineFinishDayWorkingScale(active, {
      scheduleStartDate: scheduleStartIso,
      workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
      nonWorkingDates: project?.schedule?.nonWorkingDates,
      taskCalendars,
    });
  }, [
    activeBaseline,
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
    subRollupRef.current = new Map();
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
      // Kept for every server copy the screen adopts later: adopted whole, it
      // would otherwise drop the rollup off the bars.
      subRollupRef.current = latestByTask;
      // Non-undoable refresh (progress rolled up from sub updates): replace
      // the present in place without touching the undo/redo stacks — matches
      // the pre-reducer behavior which bypassed the history snapshot.
      setHist(h => {
        const next = withSubRollup(h.present, latestByTask);
        return next === h.present ? h : { ...h, present: next };
      });
    })();
    return () => { cancelled = true; };
  }, [project?.id]);

  // Schedule health score — pure compute over current tasks + cpm.
  // Cheap to recompute on every edit.
  const healthScore = useMemo(
    () => computeScheduleHealthScore({
      tasks: rolledTasks,
      cpm,
      // CPLI (DCMA #13) needs this to put the working-ordinal baseline and the
      // calendar-index forecast on one scale.
      calendar: {
        scheduleStartDate: scheduleStartIso,
        workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
        nonWorkingDates: project?.schedule?.nonWorkingDates,
      },
    }),
    [rolledTasks, cpm, scheduleStartIso, project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates],
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
            // SAVED like any edit: it used to change only the screen, so it
            // was never written, and the next server copy the screen adopts
            // put the dead ids back.
            setHist(h => ({ ...h, present: cleanedTasks }));
            schedulePersistRef.current(cleanedTasks);
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

  // Today as a CALENDAR day index — day 1 is projectStartDate and every calendar
  // day advances it by one. This is the right scale: it is what the Gantt axis,
  // the printable one-pager's axis and every cpm.es/ef are on. (It reads as a
  // defect next to a bar drawn from a WORKING ordinal, which is what the Gantt
  // used to do — the fix belonged on the bars, not here.)
  const todayDayNumber = useMemo(() => (
    Math.max(1, dateToCalendarDay(projectStartDate, new Date()))
  ), [projectStartDate]);

  /**
   * Debounced persist. Every keystroke-level edit lands in workingTasks;
   * we only push to the global store every 500ms of quiet, OR when the user
   * navigates away. This keeps typing snappy even in a large schedule.
   */
  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // True between schedulePersist and its timer firing. persistTimer.current is
  // never cleared after it fires, so it cannot answer "is a save still
  // waiting?" — the live-sync gate's "busy" and the unmount flush both need
  // to know.
  const persistPendingRef = React.useRef(false);
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
  // cleanup is bound once, at mount, so without this
  // ref a keystroke applied after the most recent debounce timer but
  // before unmount could be lost (audit bug #7). Sync useEffect lives
  // alongside the baselinesRef sync above.
  const workingTasksRef = React.useRef<ScheduleTask[]>([]);
  // Ref-mirror of the live CPM result. The debounced persist below fires up to
  // 500ms after the edit that scheduled it, and the closure that fires is the
  // one that existed when the LAST call was made — i.e. before React re-rendered
  // with the new `cpm`. Reading the ref inside the timer means the flags we
  // persist are the ones the engine computed for the tasks we are persisting.
  const cpmRef = React.useRef<CpmResult | null>(null);
  useEffect(() => { cpmRef.current = cpm; }, [cpm]);
  const schedulePersist = useCallback((tasks: ScheduleTask[]) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistPendingRef.current = true;
    persistTimer.current = setTimeout(() => {
      persistPendingRef.current = false;
      if (!project) return;
      // Stamp the ENGINE's critical path onto the rows we are about to write.
      // ScheduleTask.isCriticalPath is what the client portal, the schedule PDF,
      // the .ics invite and the AI risk reasoning all read, and nothing in this
      // screen ever refreshed it — it stayed whatever the AI generator or a
      // template guessed at creation. See stampCriticalPath in utils/cpm.ts.
      const liveCpm = cpmRef.current;
      const stamped = liveCpm ? stampCriticalPath(tasks, liveCpm) : tasks;
      const newSchedule = buildScheduleFromTasks(
        project.schedule?.name ?? project.name ?? 'Schedule',
        project.id,
        stamped,
        project.schedule?.baseline ?? null,
        { criticalPathDays: cpm.projectFinish }, // v2.1: engine-true value
      );
      // Take ONLY the freshly derived scalars off the rebuild and keep every
      // sidecar field the existing schedule already carries —
      // `mergeEditedSchedule` is the one place that list is maintained, and its
      // docstring names what a naive `{ ...built }` drops. This site used to
      // enumerate seven of those fields by hand and miss the rest:
      // workingDaysPerWeek and bufferDays were reset to
      // buildScheduleFromTasks' hardcoded 5 / 3 on every keystroke (so a
      // 6-day-week project silently reverted to Mon-Fri), and
      // resourceCalendars / fragnets / weatherAlerts were dropped outright.
      // It is also what keeps `startDayBasis` — the user's answer to the legacy
      // day-scale question — off the rebuild's hands: `mergeEditedSchedule`
      // takes it from `existing`, so a keystroke can never claim a scale nobody
      // confirmed. (buildScheduleFromTasks does not emit the field at all; see
      // the note at its return statement for why that was tried and reverted.)
      // `startDate` still comes from the ref, not from `existing` — the
      // settings Apply handler writes that ref eagerly so a debounce firing
      // between it and updateProject uses the anchor the user just picked.
      const merged = project.schedule
        ? mergeEditedSchedule(project.schedule as ProjectSchedule, newSchedule, {
            startDate: startDateRef.current,
            projectId: project.id,
          })
        : newSchedule;
      const withBaselines = withActiveBaselineId({
        ...merged,
        // The ref is fresher than project.schedule.baselines: a capture and a
        // keystroke can land inside the same debounce window.
        baselines: baselinesRef.current,
      }, activeBaselineIdRef.current);
      console.log('[ScheduleProScreen] Persist', {
        tasks: tasks.length,
        baselines: baselinesRef.current.length,
      });
      updateProject(project.id, { schedule: withBaselines });
      // A row save is now ProjectContext's sync (busy until it reports); a
      // viewer's is nothing — then a copy parked meanwhile is taken now.
      settleSyncRef.current();
    }, 500);
  }, [project, updateProject, cpm.projectFinish]);
  useEffect(() => { schedulePersistRef.current = schedulePersist; }, [schedulePersist]);

  // Flush on unmount so we never lose an edit to a pending timer.
  //
  // UNMOUNT ONLY (deps []). It used to re-bind on [cpm.projectFinish] so its
  // closure held the live finish — but then its CLEANUP ran on every finish
  // change, not just on unmount: it cleared the pending persist of the very
  // edit that moved the finish and wrote workingTasksRef.current, which still
  // held the PREVIOUS copy (passive cleanups run before the mirror effect
  // updates it). A drag that moved the finish date was not saved until the
  // next edit, and lost if the tab closed; an idle second tab wrote its stale
  // copy back whenever a peer's change moved its finish. Everything the flush
  // needs is now read through refs at unmount, and it writes only when an
  // edit is actually waiting (persistPendingRef) — a flush with nothing
  // waiting is a whole-schedule write of values the server already has, or a
  // peer's, stamped as this screen's.
  const flushProjectRef = React.useRef(project);
  const flushUpdateProjectRef = React.useRef(updateProject);
  useEffect(() => {
    flushProjectRef.current = project;
    flushUpdateProjectRef.current = updateProject;
  }, [project, updateProject]);
  useEffect(() => {
    return () => {
      if (!persistPendingRef.current) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistPendingRef.current = false;
      // One final sync using the latest working copy. Read tasks via
      // workingTasksRef (synced in a separate useEffect) instead of
      // closing over the workingTasks state variable — this closes the
      // narrow audit-bug-#7 race where a final keystroke between the
      // last debounce timer and unmount could be lost.
      const project = flushProjectRef.current;
      if (project) {
        const liveCpm = cpmRef.current;
        const stampedOnUnmount = liveCpm
          ? stampCriticalPath(workingTasksRef.current, liveCpm)
          : workingTasksRef.current;
        const newSchedule = buildScheduleFromTasks(
          project.schedule?.name ?? project.name ?? 'Schedule',
          project.id,
          stampedOnUnmount,
          project.schedule?.baseline ?? null,
          { criticalPathDays: liveCpm?.projectFinish }, // v2.1: engine-true value
        );
        // Same merge rule as the debounced persist above — see the note
        // there for what hand-enumerating the sidecar fields used to lose.
        const mergedOnUnmount = project.schedule
          ? mergeEditedSchedule(project.schedule as ProjectSchedule, newSchedule, {
              startDate: startDateRef.current,
              projectId: project.id,
            })
          : newSchedule;
        flushUpdateProjectRef.current(project.id, {
          schedule: withActiveBaselineId({ ...mergedOnUnmount, baselines: baselinesRef.current }, activeBaselineIdRef.current),
        });
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Phase 2 — live sync + presence
  // -------------------------------------------------------------------------
  const collabSelf = useMemo(
    () => (user?.id ? { userId: user.id, name: ((user as { email?: string }).email) ?? 'Collaborator' } : null),
    [user?.id],
  );
  const { peers: schedulePeers, setSelectedTask: setPresenceTask } = useSchedulePresence(project?.id, collabSelf);
  const livePeerProjectId = project?.id;
  // Busy: an edit waiting on the persist debounce, a field RPC out, a sync of
  // this project waiting or on the wire in ProjectContext, or a write of it in
  // the offline queue. While busy the screen takes no copy from elsewhere.
  const syncBusy = useCallback(() => (
    persistPendingRef.current
    || fieldSavesInFlightRef.current > 0
    || (livePeerProjectId ? isProjectSyncUnconfirmed(livePeerProjectId) : false)
    || queueBusyRef.current
  ), [livePeerProjectId, isProjectSyncUnconfirmed]);
  // Adopt a server copy WHOLE: the grid, its named baselines (every save
  // writes baselinesRef back, so one captured elsewhere — a CO reflow's
  // "Pre-CO" snapshot — must reach it first), the copy ProjectContext holds
  // (so every other screen that writes project.schedule sends what the grid
  // shows, and the field stamps every owner save is judged against are the
  // server's), and the refusal notice's "server" base. Not an edit: no undo
  // entry, no save. Never called while the screen has an edit it has not
  // handed over, so nothing unsaved is lost. `fromServer` false: ProjectContext's
  // own copy with a sync still out (another writer on this device) — shown,
  // but not the server's yet, so neither base moves and the store already
  // holds it.
  const adoptServerCopy = useCallback((copy: LiveCopy, fromServer: boolean = true) => {
    setHist((h) => {
      // Whole in content, in the grid's own row order (inLocalOrder has why).
      const shown = withSubRollup(inLocalOrder(copy.tasks, h.present), subRollupRef.current);
      return JSON.stringify(shown) === JSON.stringify(h.present) ? h : { ...h, present: shown };
    });
    if (Array.isArray(copy.baselines)) {
      const next = copy.baselines as NamedBaseline[];
      if (JSON.stringify(next) !== JSON.stringify(baselinesRef.current)) {
        baselinesRef.current = next;
        setNamedBaselines(next);
      }
    }
    // The active baseline rides with the copy (#86). Without it this screen
    // took a phone lock's baselines but kept its own activeBaselineIdRef, and
    // its next persist put the old active id back over the phone's lock.
    // `undefined` = a copy that does not say (the ScheduleCopy shape of an
    // older caller) → left alone; `null` = cleared.
    if (copy.activeBaselineId !== undefined) {
      const nextId = copy.activeBaselineId ?? undefined;
      if (nextId !== activeBaselineIdRef.current) setActiveBaselineId(nextId);
    }
    if (!fromServer) return;
    lastServerTasksRef.current = copy.tasks;
    if (livePeerProjectId) {
      absorbServerSchedule(livePeerProjectId, copy.tasks, {
        stamp: copy.stamp,
        baselines: copy.baselines,
        ...(copy.activeBaselineId !== undefined ? { activeBaselineId: copy.activeBaselineId } : {}),
      });
    }
  }, [livePeerProjectId, absorbServerSchedule, setActiveBaselineId]);
  // Re-check for quiet: take a parked copy, or do the re-read the gate owes —
  // once after mount (the copy it opened on may be stale; the channel only
  // hears events from its join) and after every socket gap.
  const settleSync = useCallback(() => {
    const gate = syncGateRef.current;
    if (syncBusy()) return;
    const parked = settleScheduleSyncGate(gate, false);
    if (parked) adoptServerCopy(parked);
    if (!livePeerProjectId) return;
    const read = beginScheduleReread(gate);
    if (!read) return;
    const pid = livePeerProjectId;
    const answered = (answer: LiveCopy | null) => {
      if (syncGateRef.current !== gate) return;
      // answerScheduleReread (utils/scheduleMerge.ts) drops an answer a save
      // or an adopted copy may have overtaken while it was out — a colleague's
      // event adopted inside the round trip must not be replaced by an older
      // read — and says when to read again.
      const { adopt, readAgain } = answerScheduleReread(gate, read, answer, syncBusy());
      // The gate hands back the same object it was given, so the copy keeps
      // its activeBaselineId (ScheduleCopy's type just does not name it).
      if (adopt) adoptServerCopy(adopt);
      if (readAgain) settleSyncRef.current();
    };
    void Promise.resolve(supabase.from('projects').select('schedule').eq('id', pid).maybeSingle()).then(({ data, error }) => {
      // Read the same way as a live event, active baseline included (#86).
      answered(error ? null : liveScheduleCopyFromRow((data as { schedule?: unknown } | null)?.schedule));
    }, () => answered(null));
  }, [syncBusy, adoptServerCopy, livePeerProjectId]);
  useEffect(() => { settleSyncRef.current = settleSync; }, [settleSync]);
  // A sync of this project reported: maybe quiet now.
  useEffect(() => onProjectSyncSettled(() => settleSyncRef.current()), [onProjectSyncSettled]);

  // A realtime event: placed in time by its save stamp, taken whole only
  // while the screen is quiet, parked while it is busy, ignored when it is
  // older than a save of this screen (utils/scheduleMerge.ts has the rule).
  const onPeerSchedule = useCallback((incoming: LiveScheduleCopy) => {
    const copy = takeScheduleCopy(syncGateRef.current, incoming, 'echo', syncBusy());
    if (copy) adoptServerCopy(copy);
  }, [syncBusy, adoptServerCopy]);
  // The socket came back after a drop: the events in the gap are gone. Re-read
  // the row once the screen is quiet.
  const onLiveGap = useCallback(() => {
    noteScheduleSocketGap(syncGateRef.current);
    settleSyncRef.current();
  }, []);
  useLiveSchedule(project?.id, onPeerSchedule, onLiveGap);

  // #25, the second writer, owner side. A copy reaching project.schedule from
  // outside this screen — the foreground refetch (field progress saved while
  // the phone was in a pocket), the re-pull after the offline queue drains,
  // and ANOTHER WRITER ON THIS DEVICE (a client's portal approval reflowing a
  // CO, a schedule accepted on a screen pushed over this one) — is adopted
  // whole unless the screen has an edit it has not handed over yet (parked
  // then; the save that follows drops it). It used to wait for every sync of
  // the project to report, and dropped the copy meanwhile: the other writer's
  // own sync made the screen "busy", so its change never showed and the GC's
  // next drag overwrote it (takeStoreScheduleCopy has the rule). Skipped: this
  // screen's own write as the store took it, and a copy it adopted itself.
  //
  // `rowSavesAtRender`: a save noted after the render that holds this copy
  // (the persist timer firing before this effect flushes) is newer than it —
  // the copy must not replace the working copy that save was built from.
  const rowSavesAtRender = syncGateRef.current.rowSaves;
  useEffect(() => {
    const incoming = project?.schedule;
    if (!incoming?.tasks) return;
    const gate = syncGateRef.current;
    if (gate.rowSaves !== rowSavesAtRender) return;
    const settled = !syncBusy();
    const copy = takeStoreScheduleCopy(gate, {
      tasks: incoming.tasks,
      stamp: typeof incoming.updatedAt === 'string' ? incoming.updatedAt : null,
      baselines: Array.isArray(incoming.baselines) ? incoming.baselines : undefined,
    }, persistPendingRef.current || fieldSavesInFlightRef.current > 0, settled);
    if (copy) adoptServerCopy(copy, settled);
  // Runs when the stored copy changes; syncBusy / adoptServerCopy are read
  // at that moment and changing identity is not a new copy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.schedule?.tasks, project?.schedule?.updatedAt, project?.schedule?.baselines]);

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
      // No retro start (audit #141): a task closed with no recorded start keeps
      // an EMPTY start — the same rule as the daily report — rather than a planned
      // day nobody observed. Pace samples need both stamps, so it is skipped there.
      const stamp = stampActuals(before, patch.status, todayScheduleDay(startDateRef.current), new Date().toISOString(), { retroStartFromPlanned: false });
      effective = { ...stamp, ...patch };
      // Morning-brief ledger: a real capture (stamp set an ISO date) is a
      // did-for-you moment. recordDidForYou is G4-safe by contract.
      if (stamp.actualStartDate != null || stamp.actualEndDate != null) {
        recordDidForYou(`Auto-stamped actual dates for ${before.title}`, project?.id);
      }
    }
    // Log to the audit before applying so we have the "before" snapshot.
    // Row write path only. On field access nothing here has saved yet: the
    // RPC runs at the debounced persist and may fail offline or be refused,
    // so saveAsField writes the field audit row once the server has taken the
    // change (and a date / dependency edit it refuses is never logged).
    const auditable = writePath === 'row';
    if (before && project?.id && auditable) {
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
  }, [commit, workingTasks, project?.id, user, writePath]);

  // Small helper so task create/delete can drop audit entries the same way
  // handleEdit does — builds the entry and enqueues the AsyncStorage append.
  //
  // Only on the row write path. Its callers (add, delete, the start-day-basis
  // reflow) are all edits the field RPC refuses; on field / viewer access the
  // change is reported blocked and the working copy reset, so an entry here
  // would put "Deleted task…" into the append-only schedule_audit_log for a
  // deletion that never happened — the false record a delay claim must not be
  // argued from (same gate as MobileScheduleScreen).
  const writeAudit = useCallback((entry: Parameters<typeof buildAuditEntry>[0]) => {
    if (!project?.id || writePath !== 'row') return;
    void appendAuditToAsyncStorage(project.id, buildAuditEntry(entry));
  }, [project?.id, writePath]);

  // -------------------------------------------------------------------------
  // Legacy day-scale disclosure (the utils/scheduleRebase.ts population)
  // -------------------------------------------------------------------------
  // This screen's settings Apply handler is where the deleted
  // `rebaseRawToCalendar` fired most often, so it is the screen most likely to
  // be looking at a schedule whose stored `startDay` values were rewritten onto
  // the CALENDAR-INDEX scale and are now being converted a second time. The
  // decision is entirely inside `previewStartDayBasisMigration` — this screen
  // only renders it and persists the answer.
  //
  // Reads the PERSISTED tasks, not `workingTasks`: the question is about what is
  // on disk, and it must not change shape while the user is mid-edit.
  const startDayBasisPreview = useMemo(
    () => previewStartDayBasisMigration({
      tasks: project?.schedule?.tasks ?? [],
      startDate: project?.schedule?.startDate,
      workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
      nonWorkingDates: project?.schedule?.nonWorkingDates,
      startDayBasis: project?.schedule?.startDayBasis,
    }),
    [project?.schedule],
  );

  /**
   * Write the answer — and the tasks, when the answer is yes — in ONE
   * updateProject, exactly like applyWeatherReschedule. NOT through
   * `commit()`: that route persists on a 500ms debounce whose closure would
   * still hold the pre-flag `project.schedule`, and merging that stale
   * `existing` would drop the very flag this write exists to set. The undo
   * snapshot is pushed directly so Undo still reverses a re-anchor.
   */
  const answerStartDayBasis = useCallback((accept: boolean) => {
    if (!project?.schedule) return;
    const existing = project.schedule as ProjectSchedule;
    // All of the policy — what a yes writes, what a no writes, and the fact
    // that a yes built on a stale preview writes nothing — is in the patch.
    const patch = startDayBasisAnswerPatch(startDayBasisPreview, accept, existing);
    if (patch.tasks) setHist(h => pushHistory(h, patch.tasks!, 20));
    updateProject(project.id, {
      schedule: { ...existing, ...patch, updatedAt: new Date().toISOString() },
    });
    writeAudit({
      user: user?.email ?? user?.name ?? 'anonymous',
      kind: 'reflow',
      summary: patch.tasks
        ? `Re-anchored ${startDayBasisPreview.report.wouldRemapTaskCount} task(s) off the legacy calendar-index scale — finish ${startDayBasisPreview.storedFinishDay} → ${startDayBasisPreview.remappedFinishDay}`
        : 'Kept the stored start days as authored (legacy day-scale notice declined)',
    });
  }, [project, updateProject, startDayBasisPreview, writeAudit, user?.email, user?.name]);

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
    // Same merge rule as schedulePersist — see the note there.
    const mergedWeather = project.schedule
      ? mergeEditedSchedule(project.schedule as ProjectSchedule, rebuilt, {
          startDate: startDateRef.current,
          projectId: project.id,
        })
      : rebuilt;
    updateProject(project.id, {
      schedule: withActiveBaselineId({
        ...mergedWeather,
        baselines: baselinesRef.current,
        weatherDelayLog: logEntry
          ? [...(project.schedule?.weatherDelayLog ?? []), logEntry]
          : project.schedule?.weatherDelayLog,
      }, activeBaselineIdRef.current),
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
    // The weather modal is a native <Modal> and is dismissing on this same
    // tick. On iOS, presenting an alert while a modal tears down can silently
    // fail to present at all — the same trap useEntityNavigation's `fromSheet`
    // option exists for. Let the dismissal finish first.
    const ask = () => showAlert(
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
    if (Platform.OS === 'ios') setTimeout(ask, 350); else ask();
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
      // The demo's actuals are calendar indices on THIS schedule's calendar (#50).
      commit(() => seedDemoSchedule(summaryScale));
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
  }, [commit, workingTasks.length, summaryScale]);

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
    // A start OR a finish counts: since #141 a task finished without a
    // recorded start carries actualEndDay alone, and reflowFromActuals
    // cascades from it (utils/scheduleOps.ts span()).
    // The day number OR the recorded date (#89): Home's Quick Field Update and
    // the mic used to stamp only the date, and a task he finished there must
    // not read as "no actual logged".
    const withActuals = workingTasks.filter(t => actualCalendarDay(t, 'start', summaryScale.scheduleStartDate) != null
      || actualCalendarDay(t, 'end', summaryScale.scheduleStartDate) != null);
    if (withActuals.length === 0) {
      const msg = 'No tasks have an actual start or finish logged yet. Log an actual on at least one task, then reflow to cascade the delta to downstream work.';
      if (Platform.OS === 'web') window.alert?.(msg);
      else showAlert('Nothing to reflow', msg);
      return;
    }
    // Actuals are CALENDAR indices (utils/pace/stampActuals.ts); the reflow
    // reads them back as working ordinals on this schedule's own calendar.
    const next = reflowFromActuals(workingTasks, summaryScale);
    const changedCount = next.filter((t, i) => t.startDay !== workingTasks[i].startDay).length;
    commit(() => next);
    const msg = changedCount === 0
      ? 'Everything is on track — no downstream shifts needed.'
      : `Pushed ${changedCount} task${changedCount === 1 ? '' : 's'} based on actuals. Undo if this looks off.`;
    if (Platform.OS === 'web') window.alert?.(msg);
    else showAlert('Reflow complete', msg);
  }, [workingTasks, commit, summaryScale]);

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
    // Pass the engine's conflicts too — they carry the WHY (resource,
    // counterpart task, working days delayed, float consumed, whether the
    // finish moves). Dropping them left the preview printing a bare
    // "Day 12 → 19" for a decision the superintendent has to approve.
    const summary = leveled
      ? summarizeLeveling(rolledTasks, leveled, leveledResult.conflicts)
      : null;
    if (!leveled || !summary || summary.shiftedCount === 0) {
      // Leveling only resolves crew / subcontractor scheduling conflicts. Be
      // honest instead of claiming "every crew is within capacity" — a Workload
      // heatmap can still show resource-capacity overloads the leveler doesn't
      // act on (those are resolved by reassigning or rescheduling manually).
      const msg = 'Nothing to auto-level — leveling shifts overlapping crew and subcontractor work, and none was found to move.';
      if (Platform.OS === 'web') window.alert?.(msg); else showAlert('Fix overloads', msg);
      return;
    }
    // `leveledResult.projectFinish` is the UNLEVELLED finish — runCpm fixes it at
    // step 4 and levels at step 9 — so this delta used to be structurally zero
    // for every possible input and the modal printed "finish unchanged" in every
    // case, including the reproduced one (three 5-day tasks on one crew) where
    // applying moved the finish from day 5 to day 19. `leveledProjectFinish` is
    // the forward pass re-run on the levelled startDays.
    const postLevelFinish = leveledResult.leveledProjectFinish ?? leveledResult.projectFinish;
    setLevelingPreview({ summary, leveled, finishDelta: postLevelFinish - cpm.projectFinish });
  }, [rolledTasks, scheduleStartIso, criticalFloatThresholdDays, project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates, taskCalendars, cpm.projectFinish]);

  const applyLeveling = useCallback(() => {
    const p = levelingPreview;
    if (!p) return;
    // Skip summary rows — their startDay is derived from children (rollup), not
    // user-owned, so we never write a leveled value back onto them.
    commit(prev => prev.map(t => (!t.isSummary && p.leveled.has(t.id)) ? { ...t, startDay: p.leveled.get(t.id)! } : t));
    // Row write path only: leveling moves start days, which the field RPC
    // refuses — the shift is reported blocked and reset, so no audit row.
    if (project?.id && writePath === 'row') {
      void appendAuditToAsyncStorage(project.id, buildAuditEntry({
        user: user?.email ?? user?.name ?? 'anonymous',
        kind: 'reflow',
        summary: `Resource leveling: ${p.summary.shiftedCount} task(s) shifted`,
      }));
    }
    setLevelingPreview(null);
  }, [levelingPreview, commit, project?.id, user?.email, user?.name, writePath]);

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
    // Pass the schedule's REAL calendar. exportTasksToCsv defaults to a 5-day
    // week, so a 6- or 7-day project silently exported dates that skipped
    // weekends it actually works — the CSV disagreeing with the grid beside it.
    const csv = exportTasksToCsv(
      workingTasks,
      projectStartDate,
      project?.schedule?.workingDaysPerWeek,
      project?.schedule?.nonWorkingDates,
    );
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
      // An undated schedule contributes NO events (icsGenerator refuses to
      // date tasks off today — SCHED-NO-ANCHOR), so "0 event(s)" on web and
      // total silence on native would be the only signal that a 20-task plan
      // exported nothing. Say why, on both platforms.
      if (result.scheduleSkip.undatedSchedule) {
        const n = result.scheduleSkip.skippedTaskCount;
        showAlert(
          UNDATED_SCHEDULE_TITLE,
          `${n} task${n === 1 ? '' : 's'} could not be exported. ${UNDATED_SCHEDULE_BODY}`,
        );
        return;
      }
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
        // The PDF mixes calendar indices (cpm) with working ordinals (the
        // baseline snapshot); without the calendar it cannot lift one onto
        // the other and the baseline ghost bar drifts left by every weekend.
        workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
        nonWorkingDates: project?.schedule?.nonWorkingDates,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (Platform.OS === 'web') window.alert?.(`PDF export failed: ${msg}`);
      else showAlert('PDF export failed', msg);
    }
  }, [project?.name, project?.schedule?.startDate, project?.schedule?.workingDaysPerWeek,
      project?.schedule?.nonWorkingDates, rolledTasks, cpm]);

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
      {
        projectId: project.id,
        // Ship the calendar. Without it the viewer ran CPM on a 7-day week and
        // showed the client a different critical path and different dates from
        // the ones on this screen.
        workingDaysPerWeek: project.schedule?.workingDaysPerWeek,
        nonWorkingDates: project.schedule?.nonWorkingDates,
      },
    );
    // v2.4 (audit Item 6) — Try inline first; on oversize, write a
    // server-side snapshot and use the short row-id token instead.
    // Replaces the v2.3 P1 throw-on-oversize behavior with a graceful
    // fallback that produces a working URL for any schedule size.
    const result = tryEncodeShareToken(payload);
    // The host is resolved ONCE, here, and both branches below produce an
    // absolute URL. Previously the path was built bare and made absolute only
    // inside the `Platform.OS === 'web'` branch further down — which has no
    // else — so a native share handed the GC the string `/shared-schedule?t=…`
    // with no host at all, under the words "Open this URL in a laptop browser".
    const webOrigin = Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : null;
    let url: string;
    if (result.kind === 'inline') {
      url = buildShareUrl('shared-schedule', result.token, webOrigin);
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
      // The snapshot variant keys on `?s=<row id>` rather than `?t=<token>`.
      url = buildSnapshotShareUrl('shared-schedule', data.id, webOrigin);
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Audit #31 — this used to be `navigator.clipboard?.writeText(url)`
      // followed by an unconditional "copied to clipboard" alert. Both of
      // its failure modes lied to the user: the un-awaited Promise rejected
      // AFTER the synchronous try/catch had already exited (so the catch
      // never ran), and in a non-secure context — plain http:// over a
      // jobsite LAN, or an embedded iframe — `navigator.clipboard` is
      // undefined entirely, so the optional chain short-circuited without
      // throwing at all. Either way the window.prompt fallback below was
      // unreachable in exactly the situations it was written for, and the
      // GC pasted stale clipboard content instead of a base64 share token
      // they have no way to retype. copyToClipboard() awaits the write,
      // falls back to execCommand('copy') on non-secure origins, and
      // returns an honest boolean.
      const ok = await copyToClipboard(url);
      if (ok) {
        window.alert?.(`Share link copied to clipboard.\n\n${url}`);
      } else {
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
      // Feed the LIVE CPM rows: they supply both the bar geometry (the print's
      // axis is calendar days, and es/ef are the only calendar-scale dates we
      // have) and the red critical bars. Without them the printout drew bars
      // from working-scale startDays on a calendar axis and coloured them from
      // task.isCriticalPath — a flag the AI generator writes and nothing
      // refreshes — so the client's copy showed a guessed critical path.
      const cpmRowsForPrint = new Map(
        [...cpm.perTask.entries()].map(([id, r]) => [id, { es: r.es, ef: r.ef, isCritical: r.isCritical }]),
      );
      const html = buildPrintableGanttHtml(rolledTasks, {
        projectName: project?.name ?? 'Schedule',
        todayDayNumber,
        totalDays: cpm.projectFinish,
        cpmByTaskId: cpmRowsForPrint,
      });
      // Print.printAsync has the same web shim as printToFileAsync — it calls
      // window.print() and ignores `html`, so on web this printed the scheduler
      // SCREEN instead of the fit-to-page Gantt one-pager just built above.
      await printHtmlDocument(html);
    } catch (e) {
      console.error('AirPrint failed', e);
    }
  }, [project?.name, rolledTasks, todayDayNumber, cpm.projectFinish, cpm.perTask]);

  // -------------------------------------------------------------------------
  // Undo / Redo (Phase 4 preview — works today for grid edits)
  // -------------------------------------------------------------------------

  // History holds task arrays only, so an undo or redo that crosses an
  // Activate puts the OTHER baseline's dates back on the tasks. The active id
  // follows the restored tasks (baselineStampedOnTasks, #137) — set before the
  // persist, which reads the ref — so the chip, the slip and the ghost bars
  // never measure from two baselines after a Cmd+Z.
  const followRestoredBaseline = useCallback((tasks: ScheduleTask[]) => {
    const current = activeBaselineIdRef.current;
    const stamped = baselineStampedOnTasks(tasks, baselinesRef.current, current);
    if (stamped === undefined) return;
    if (resolveActiveBaseline(baselinesRef.current, current)?.id === stamped) return;
    setActiveBaselineId(stamped);
  }, [setActiveBaselineId]);

  const handleUndo = useCallback(() => {
    setHist(h => {
      const n = histUndo(h);
      if (n === h) return h; // nothing to undo — don't persist a no-op
      followRestoredBaseline(n.present);
      schedulePersist(n.present);
      return n;
    });
  }, [schedulePersist, followRestoredBaseline]);

  const handleRedo = useCallback(() => {
    setHist(h => {
      const n = histRedo(h);
      if (n === h) return h; // nothing to redo — don't persist a no-op
      followRestoredBaseline(n.present);
      schedulePersist(n.present);
      return n;
    });
  }, [schedulePersist, followRestoredBaseline]);

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
  // Early returns — screen too narrow, or no project
  // -------------------------------------------------------------------------
  //
  // The width gate deliberately runs FIRST, which is the one way Schedule Pro
  // is treated differently from the other project-scoped screens. This screen
  // is unusable below GRID_BREAKPOINT, so making a phone user pick a project
  // before telling them to go use the classic schedule is a step that leads
  // nowhere. Narrow ⇒ hand them the classic schedule immediately; only on a
  // surface that can actually render the grid do we ask which job to open.

  // No insets.top in this branch: unlike the two below it, this one keeps the
  // native header (title 'Schedule Pro'), which already sits under the status
  // bar. Adding insets.top on top of it pushed the message a further ~59pt down
  // an otherwise blank screen.
  if (width < GRID_BREAKPOINT) {
    return (
      <View style={[styles.container, styles.narrowGate, { paddingTop: 28 }]}>
        <Stack.Screen options={{ title: 'Schedule Pro' }} />
        <MageAIMark size={28} color={themeColors.accent} />
        <Text style={styles.emptyTitle}>Best on a bigger screen</Text>
        {/* This used to say "built for laptops and iPad" — hands-on UI pass
            2026-09-07, finding 5. app.json sets ios.supportsTablet:false, so
            there is no iPad build: a contractor who followed that advice got
            iPhone compatibility mode, hit this same width gate, and read the
            same sentence again. Name the two surfaces that actually exist, and
            say what the classic schedule still does so the redirect reads as a
            route rather than a refusal. */}
        <Text style={styles.emptyBody}>
          Schedule Pro is a spreadsheet: dependency columns, float, baselines and
          a Gantt side by side. It needs about {GRID_BREAKPOINT}pt of width to
          put a task on one row, which means a laptop or a desktop browser at
          app.mageid.app.
        </Text>
        <Text style={styles.emptyBody}>
          On this phone the classic schedule runs the same project — tasks,
          dates, drag to reschedule, weather days — in a layout built for it.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          // The copy directly above promises "the classic schedule runs the
          // SAME project" — so it has to be told which one.
          onPress={() => router.replace({ pathname: '/(tabs)/schedule', params: { projectId: projectId, focus: String(Date.now()) } } as any)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Open classic schedule"
          testID="schedule-pro-open-classic"
        >
          <Text style={styles.primaryBtnText}>Open classic schedule</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={goBack}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="schedule-pro-narrow-back"
        >
          <Text style={styles.secondaryBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="SCHEDULE PRO · MAGE ID" title="Schedule Pro" />
        <ToolProjectPicker
          toolName="Schedule Pro"
          message="Schedule Pro drives the CPM grid, float and baselines for one project at a time."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<MageAIMark size={30} color={themeColors.accent} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Build or import a schedule so there are tasks to sequence.',
            'Open Schedule Pro to set dependencies, float and baselines.',
          ]}
        />
      </View>
    );
  }

  if (workingTasks.length === 0 && !dismissedOnRamp) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.headerBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ChevronLeft size={20} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.headerBackText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
          </View>
        </View>
        <ScheduleOnRamp
          hasEstimate={!!project.linkedEstimate}
          canBuildByVoice
          onPick={(path) => {
            switch (path) {
              case 'estimate':
                router.push({ pathname: '/generative-setup', params: { projectId: project.id } } as never);
                break;
              case 'interview':
                router.push({ pathname: '/schedule-builder', params: { projectId: project.id } } as never);
                break;
              case 'blank':
                setDismissedOnRamp(true);
                break;
              case 'template':
                router.push({ pathname: '/schedule-wizard', params: { projectId: project.id } } as never);
                break;
              case 'voice':
                setEditOpen(true);
                break;
              case 'example':
                handleLoadDemo();
                break;
              case 'manual':
                setDismissedOnRamp(true);
                handleAddTask();
                break;
              default: {
                const _exhaustive: never = path;
                void _exhaustive;
                break;
              }
            }
          }}
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
        <TouchableOpacity onPress={goBack} style={styles.headerBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
          {/* Legacy day-scale disclosure. Renders null for every schedule that
              is fine, so it is mounted unconditionally. Above the tab shell:
              the finish date it is talking about is the one in the header KPIs
              directly below it. */}
          {writePath === 'field_rpc' ? (
            fieldNotice ? (
              <LockedAccessCard
                what="Date and task editing"
                detail={fieldNotice}
                style={{ marginHorizontal: 16, marginTop: 8 }}
              />
            ) : (
              <Text style={[styles.headerBtnHint, { marginHorizontal: 16, marginTop: 8 }]} testID="schedule-field-access-hint">
                Field access: progress, status, notes and actual start/finish save. Moving dates or changing tasks needs editor access.
              </Text>
            )
          ) : null}
          {writePath === 'field_rpc' && fieldFailureShown ? (
            <FieldSendFailureBanner
              message={fieldFailureShown.message}
              onRetry={fieldFailureShown.retryable ? retryFieldSend : undefined}
              onDismiss={dismissFieldFailure}
              autoRetrying={fieldFailureShown.offline}
              style={{ marginHorizontal: 16, marginTop: 8 }}
            />
          ) : null}
          {writePath === 'row' && fieldConflictNotice ? (
            <View style={styles.fieldConflict} testID="schedule-field-conflict-notice" accessibilityRole="alert">
              <Text style={styles.fieldConflictText}>{fieldConflictNotice}</Text>
              <TouchableOpacity onPress={() => setFieldConflictNotice(null)} accessibilityRole="button" accessibilityLabel="Dismiss notice" hitSlop={8}>
                <Text style={styles.fieldConflictDismiss}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <StartDayBasisNotice
            preview={startDayBasisPreview}
            projectStartDate={project?.schedule?.startDate ? projectStartDate : null}
            onAnswer={answerStartDayBasis}
            style={{ marginHorizontal: 16, marginTop: 8 }}
          />
          {/* The Gantt's Start today / Finish today count from the schedule's
              REAL start (undefined when undated → date-only stamps). The shell
              below only carries the createdAt-backfilled display start. */}
          <GanttStampBasis.Provider value={scheduleStartIso}>
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
                      tasks={project.schedule?.tasks ?? []}
                      scheduleStartDate={project.schedule?.startDate}
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
          </GanttStampBasis.Provider>
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
        projectStartDate={projectStartDate}
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
        dayScale={summaryScale}
        activeBaselineId={activeBaseline?.id ?? null}
        onBaselinesChange={(next) => {
          // Deleting the ACTIVE baseline clears the id and makes the newest
          // remaining one the yardstick — and its dates must go back on the
          // tasks, or the ghost bars keep measuring from the deleted one.
          const prevList = baselinesRef.current;
          const after = activeBaselineAfterChange(activeBaselineIdRef.current, prevList, next);
          baselinesRef.current = next;
          setNamedBaselines(next);
          setActiveBaselineId(after.activeBaselineId);
          // A capture (the list grew) is followed by onActivate(snap), which
          // re-stamps the tasks itself — only a DELETE re-applies here.
          if (after.reapply && next.length < prevList.length) {
            // Tasks + baselines + id go out together through the persist.
            commit(prev => reapplyBaselineToTasks(prev, after.active));
            return;
          }
          // No commit here — baselines aren't tasks; the commit happens
          // through the persist debounce that picks up baselinesRef.
          if (project) {
            updateProject(project.id, {
              schedule: withActiveBaselineId({
                ...(project.schedule as ProjectSchedule),
                baselines: next,
              }, after.activeBaselineId),
            });
          }
        }}
        onActivate={(baseline) => {
          // ONE save: the id rides the same debounced persist as the task
          // baselines this commit writes, so the chip, the slip and the ghost
          // bars can never be left pointing at two baselines.
          setActiveBaselineId(baseline.id);
          commit(prev => reapplyBaselineToTasks(prev, baseline));
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
          // NO rebaseRawToCalendar here any more, and that is the fix, not an
          // omission.
          //
          // That helper existed to survive the CPM "mode flip": a schedule with
          // no startDate ran the engine in raw-day mode where startDay is a
          // working-day ordinal, and the moment a startDate appeared the engine
          // re-read those same numbers as CALENDAR indices — the 2026-07-12
          // finish-jump bug. Its compensation was to rewrite every startDay from
          // ordinal to calendar index at the transition.
          //
          // The engine no longer misreads them: forwardPass converts the stored
          // working ordinal to a calendar index itself, in both modes (the
          // converter is the identity with no startDate). So the ordinals now
          // survive the transition untouched — and re-mapping them first would
          // make the engine convert an already-converted number. Measured on
          // A(10)->B(10)->C(5) chained at ordinals 1/11/21 from Mon 2026-03-02
          // on a 5-day week: without the rebase the finish is Fri Apr 3, exactly
          // as it was before this change; WITH it the finish inflates to Wed
          // Apr 15, twelve calendar days late.
          //
          // See handoff notes — the same call still needs removing from
          // app/(tabs)/schedule/index.tsx and
          // components/schedule/mobile/MobileScheduleScreen.tsx.
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
  // The entry gate's non-paywall states (#91): loading, a failed role read,
  // no access to the job named in the link.
  gateWrap: { flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  gateTitle: { fontSize: Type.headline.fontSize, fontWeight: '700', color: t.text, textAlign: 'center' },
  gateBody: { fontSize: Type.subhead.fontSize, color: t.textSecondary, textAlign: 'center', maxWidth: 420, lineHeight: 20 },
  gateActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  gateBtn: { ...cardSurface(t, { radius: 'md', pad: 'none' }), paddingHorizontal: 16, paddingVertical: 10 },
  gateBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.accent },

  // Top-aligned, not vertically centred: centring four lines on a 900pt-tall
  // phone left the top half of the screen blank, which reads as a screen that
  // failed to load rather than one that is redirecting you (hands-on UI pass
  // 2026-09-07, finding 5).
  narrowGate: { alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: t.text, marginTop: 8 },
  emptyBody: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 440 },
  primaryBtn: {
    backgroundColor: t.accentFill,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: Tokens.radius.md, marginTop: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: Type.bodyCompact.fontSize },
  secondaryBtnText: { color: t.textSecondary, fontWeight: '600', fontSize: Type.bodyCompact.fontSize },

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
  headerTitle: { ...Type.serifHeadline, color: t.text },
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
  // A GC edit the server refused because the field set that value later.
  fieldConflict: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginHorizontal: 16, marginTop: 8, padding: 10,
    borderRadius: Tokens.radius.sm, backgroundColor: t.warningSoft,
  },
  fieldConflictText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.warningLabel },
  fieldConflictDismiss: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent },

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
