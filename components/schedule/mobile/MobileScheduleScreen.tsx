import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Platform, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Bell, Check, ChevronDown, ChevronRight, FolderOpen, CalendarDays, CalendarOff, Download, FileInput, Flag, History, Lock, Mic, RefreshCw, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectRole } from '@/hooks/useProjectRole';
import { supabase } from '@/lib/supabase';
import LockedAccessCard, { FieldSendFailureBanner } from '@/components/LockedAccessCard';
import {
  applyFieldTaskPatches, mergeWrittenStamps, fieldScheduleSettingsChanged, fieldTaskDiff, FIELD_TASK_PATCH_KEYS,
  scheduleWritePathForRole, sendFieldTaskPatches, staleFieldEdits,
  captureFieldSendFailure, mergeFieldSendFailure, pendingFieldRetryPatches, fieldAutoRetryDelayMs,
  planFieldRetry, fieldRetrySupersededNotice, peerScheduleAdopt,
  type FieldSendFailure,
} from '@/utils/fieldScheduleUpdate';
import { projectWriteQueued } from '@/utils/scheduleMerge';
import { getOwnOfflineQueue, onQueueChanged } from '@/utils/offlineQueue';
import type { Project, ProjectSchedule, ScheduleAuditEntry, ScheduleTask } from '@/types';
import { appendAuditToAsyncStorage, buildAuditEntry, summarizeTaskDiff } from '@/utils/scheduleAudit';
import { ScheduleAuditModal } from '@/components/schedule/ScheduleAuditModal';
import { buildScheduleFromTasks, mergeEditedSchedule, createId } from '@/utils/scheduleEngine';
import { stampActuals, todayScheduleDay } from '@/utils/pace/stampActuals';
import { recordDidForYou } from '@/utils/brain/didForYou';
import { liveScheduleCopyFromRow, useLiveSchedule, type LiveScheduleCopy } from '@/hooks/useLiveSchedule';
import {
  runCpm, previewStartDayBasisMigration, startDayBasisAnswerPatch,
  calendarDayToDate, workingDaysBetween, type CpmResult,
} from '@/utils/cpm';
import { StartDayBasisNotice } from '@/components/schedule/StartDayBasisNotice';
import EmptyState from '@/components/EmptyState';
import { AddTaskModal, type NewTaskValues } from '@/components/schedule/AddTaskModal';
import { WeekStrip } from './WeekStrip';
import { MobileGantt } from './MobileGantt';
import { MobileScheduleList } from './MobileScheduleList';
import { TaskDetailSheet } from './TaskDetailSheet';
import { MonthCalendarSheet } from './MonthCalendarSheet';
import { ExportCenterSheet } from './ExportCenterSheet';
import { exportScheduleIcal } from '@/utils/scheduleExportIcal';
import { ProgressTab } from './ProgressTab';
import { TeamTab } from './TeamTab';
import { LivingFloorPlan } from './LivingFloorPlan';
import { PlanZoneEditor } from './PlanZoneEditor';
import { displayText } from '@/utils/formatters';
import { showAlert } from '@/utils/alert';
import { buildShareUrl } from '@/utils/webAppOrigin';
import DatePickerModal from '@/components/DatePickerModal';
import { parseCalendarDay, todayCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import {
  resolveScheduleAnchor, startDayNumberFor,
  captureBaseline, applyBaselineToTasks, getActiveBaseline, withActiveBaselineId,
  baselineFinishDayWorkingScale, finishDriverTitle, pacedScheduleVerdict, planCatchUpToToday,
  taskCalendarRange, scheduledPlacements, startDaySnapBack, followStoredTask,
  UNDATED_SCHEDULE_BODY, UNDATED_SCHEDULE_CTA, UNDATED_SCHEDULE_TITLE,
  verdictToneTokens,
  type CatchUpPlan, type NamedBaseline, type PacedVerdict,
} from '@/utils/scheduleOps';
import { buildOwnerConfidence } from '@/utils/ownerConfidence';

// MISS-08 (runtime audit 2026-09-06): the second sub-tab was labelled
// "4D Model". There is no 3D model behind it and no 3D dependency anywhere in
// the app — no three, expo-gl, expo-three, IFC or glTF in package.json. What
// the tab renders is LivingFloorPlan: a 2D floor-plan image whose drawn zones
// tint by planned schedule status along a date scrubber. In the industry "4D"
// means a BIM model linked to the programme (Navisworks, Synchro, Procore BIM),
// so a GC comparing MAGE tapped it expecting model-linked scheduling — the kind
// of label that gets caught live in a demo.
//
// "Living Plan" is what Schedule Pro on web already calls the identical
// component (components/schedule/tabs/GanttTab.tsx:38), so the two surfaces now
// agree, and the name describes what the screen actually does.
//
// The SubTab KEY stays '4d': it is persisted in component state and referenced
// by TaskDetailSheet's jump-to-plan action. Renaming the key would be a
// behaviour change dressed up as a copy fix.
type SubTab = 'schedule' | '4d' | 'progress' | 'team';
const SUBTABS: [SubTab, string][] = [['schedule', 'Schedule'], ['4d', 'Living Plan'], ['progress', 'Progress'], ['team', 'Team']];

// ---------------------------------------------------------------------------
// The phone's schedule audit entry.
//
// ScheduleAuditModal promises "every CPM-affecting edit" is logged, but the only
// writers were schedule-pro (desktop-only, behind the 900pt gate) and the CO
// reflow. Every date, duration and status change made HERE — the primary
// platform — left no record of who changed it or when, which is the record a
// delay claim is argued from months later. Every write on this screen funnels
// through saveTasks, so the entry is built there, from the task arrays on
// either side of the write.
//
// The summary copies the CO reflow's shape (utils/coScheduleReflowCore.ts):
// what changed, then "finish <before> → <after>" when the finish moved, so the
// row reads as a dated movement on its own when it is attached to a delay.
// ---------------------------------------------------------------------------

/** Derived by saveTasks' own CPM run on every write — a change in it is not an
 *  edit anybody made, and listing it would put "isCriticalPath changed" on
 *  every row. */
const AUDIT_IGNORED_KEYS = new Set(['isCriticalPath']);
/** Fields a status tap or a progress stepper writes (stampActuals included). */
const PROGRESS_KEYS = new Set(['progress', 'status', 'actualStartDate', 'actualEndDate', 'actualStartDay', 'actualEndDay']);

/** What a VIEWER collaborator is told, standing, instead of taps that do
 *  nothing (#25 — a blocked control says why). */
const VIEWER_SCHEDULE_NOTICE = 'You have view-only access to this project, so nothing you change here is saved. Ask the project owner for field or editor access.';
/** What a FIELD collaborator is told BEFORE he taps. The same sentence
 *  schedule-pro prints, so the phone and the laptop promise the same thing. */
const FIELD_SCHEDULE_HINT = 'Field access: progress, status, notes and actual start/finish save. Moving dates, ticking checklist items or changing tasks needs editor access.';
/** …and what he is told after a change this screen could not save. Same
 *  wording as app/schedule-pro.tsx `saveAsField`. */
/** How the row-conflict notice names a field-owned key. */
const ROW_FIELD_KEY_LABEL: Record<string, string> = {
  progress: 'progress', status: 'status', notes: 'notes', title: 'name', crew: 'crew',
  actualStartDate: 'actual start', actualStartDay: 'actual start',
  actualEndDate: 'actual finish', actualEndDay: 'actual finish',
};
/** Task fields TaskDetailSheet keeps as local drafts from the moment it opens
 *  (its % slider, title, crew and notes inputs) — a peer change to one of these
 *  cannot show in the open sheet, so the screen says so. */
const SHEET_DRAFT_KEYS: readonly string[] = ['progress', 'title', 'crew', 'notes'];
const FIELD_NOT_SAVED = (what: string) => `Not saved: ${what}. Field access saves progress, status, notes and actual start/finish only — ask the project owner for editor access to move dates or change tasks.`;

/**
 * Before/after snapshots holding only what really changed. summarizeTaskDiff
 * compares with `===`, so an array or object re-created with the same contents
 * (dependencies, links) would otherwise read as "dependencies changed".
 */
function materialTaskDiff(before: ScheduleTask, after: ScheduleTask): { keys: string[]; after: Record<string, unknown> } {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const snapshot: Record<string, unknown> = { ...b };
  const keys: string[] = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (AUDIT_IGNORED_KEYS.has(k) || b[k] === a[k]) continue;
    if (JSON.stringify(b[k]) === JSON.stringify(a[k])) continue;
    snapshot[k] = a[k];
    keys.push(k);
  }
  return { keys, after: snapshot };
}

function describeMobileScheduleEdit(input: {
  prev: ScheduleTask[];
  next: ScheduleTask[];
  finishBefore: number;
  finishAfter: number;
  /** Renders a CPM finish index — a date when the schedule is dated, a day
   *  number when it is not. Never an invented date. */
  formatFinish: (day: number) => string;
  /** Names a bulk write the user made on purpose ("Brought the plan up to date"). */
  reason?: string;
  user: string;
}): Omit<ScheduleAuditEntry, 'id' | 'at'> | null {
  const { prev, next, finishBefore, finishAfter, formatFinish, reason, user } = input;
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const nextIds = new Set(next.map((t) => t.id));
  const created = next.filter((t) => !prevById.has(t.id));
  const deleted = prev.filter((t) => !nextIds.has(t.id));
  const edited: { task: ScheduleTask; before: ScheduleTask; keys: string[]; after: Record<string, unknown> }[] = [];
  for (const t of next) {
    const before = prevById.get(t.id);
    if (!before || before === t) continue;
    const diff = materialTaskDiff(before, t);
    if (diff.keys.length > 0) edited.push({ task: t, before, ...diff });
  }
  const total = created.length + deleted.length + edited.length;
  if (total === 0) return null;

  const finishMoved = finishBefore !== finishAfter && finishBefore > 0 && finishAfter > 0;
  const finishClause = finishMoved ? ` — finish ${formatFinish(finishBefore)} → ${formatFinish(finishAfter)}` : '';

  if (total === 1 && !reason) {
    if (created.length === 1) {
      const t = created[0];
      return {
        user, taskId: t.id, taskTitle: t.title, kind: 'task_create',
        summary: `Added "${t.title}" (${t.durationDays}d)${finishClause}`,
      };
    }
    if (deleted.length === 1) {
      const t = deleted[0];
      return {
        user, taskId: t.id, taskTitle: t.title, kind: 'task_delete',
        summary: `Removed "${t.title}"${finishClause}`,
      };
    }
    const e = edited[0];
    const kind: ScheduleAuditEntry['kind'] = e.keys.some((k) => k === 'dependencies' || k === 'dependencyLinks')
      ? 'dependency_edit'
      : e.keys.every((k) => PROGRESS_KEYS.has(k)) ? 'progress_update' : 'task_edit';
    const before = e.before as unknown as Record<string, unknown>;
    return {
      user, taskId: e.task.id, taskTitle: e.task.title, kind,
      summary: `${e.task.title}: ${summarizeTaskDiff(before, e.after)}${finishClause}`,
      before,
      after: e.after,
    };
  }

  // A bulk write (the catch-up, its undo). One row, not one per task: the
  // user made one decision, and the finish movement belongs to that decision.
  const parts: string[] = [];
  if (edited.length > 0) parts.push(`${edited.length} task${edited.length === 1 ? '' : 's'} changed`);
  if (created.length > 0) parts.push(`${created.length} added`);
  if (deleted.length > 0) parts.push(`${deleted.length} removed`);
  return {
    user,
    kind: 'reflow',
    summary: `${reason ?? 'Schedule edited'}: ${parts.join(', ')}${finishClause}`,
    before: { projectFinishDay: finishBefore },
    after: {
      projectFinishDay: finishAfter,
      changedTaskIds: edited.map((e) => e.task.id),
      addedTaskIds: created.map((t) => t.id),
      removedTaskIds: deleted.map((t) => t.id),
    },
  };
}

// Mobile-native "Schedule Pro" — touch-first gantt + task-detail sheet +
// sub-tabs, rendered on phones (web/tablet keep the desktop schedule screen).
export function MobileScheduleScreen({ consumedFocusRef: sharedFocusRef }: { consumedFocusRef?: React.MutableRefObject<string | null> } = {}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    projects,
    updateProject: updateProjectRaw,
    getPlanSheetsForProject,
    absorbServerSchedule,
  } = useProjects();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  // Same actor string schedule-pro writes, so the History viewer attributes a
  // phone edit and a laptop edit to the same person.
  const auditUser = user?.email ?? user?.name ?? 'anonymous';

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.id ?? null);

  // Honor a projectId passed by callers (e.g. project-detail's "Open Full
  // Schedule") — without this the tab keeps whichever project was last
  // active here, which reads as "my schedule vanished" (P0 sim-audit bug).
  // The `focus` nonce distinguishes a fresh navigation from the tab's sticky
  // params: each arrival mints a new nonce, so re-opening from the same
  // project re-applies, while plain tab presses (stale nonce) never yank the
  // selection away from a project the user cycled to manually.
  const { projectId: routeProjectId, focus: routeFocus } =
    useLocalSearchParams<{ projectId?: string; focus?: string }>();
  // Shared with the desktop sibling via the parent wrapper so a nonce already
  // consumed on one surface stays consumed after a breakpoint remount — a
  // fresh local ref would re-yank a manually-cycled project back to the CTA's
  // projectId. Falls back to a local ref if rendered standalone.
  const localFocusRef = useRef<string | null>(null);
  const consumedFocusRef = sharedFocusRef ?? localFocusRef;
  useEffect(() => {
    if (!routeProjectId) return;
    const nonce = `${routeProjectId}:${routeFocus ?? ''}`;
    if (consumedFocusRef.current === nonce) return;
    if (!projects.some((p) => p.id === routeProjectId)) return;
    consumedFocusRef.current = nonce;
    setSelectedProjectId(routeProjectId);
  }, [routeProjectId, routeFocus, projects, consumedFocusRef]);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [tab, setTab] = useState<SubTab>('schedule');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [detailTask, setDetailTask] = useState<ScheduleTask | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [scheduleView, setScheduleView] = useState<'list' | 'timeline'>('list');
  const [addPrefillDate, setAddPrefillDate] = useState<string | undefined>(undefined);
  const [showZoneEditor, setShowZoneEditor] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  const activeSchedule = selectedProject?.schedule ?? null;
  // Voice-build generates the schedule FROM the linked estimate — without one the
  // Copilot interview would run and then dead-end at "Build it". Gate the voice
  // entries on it so estimate-less projects only see the manual path.
  const hasEstimate = !!selectedProject?.linkedEstimate;
  const tasks = useMemo(() => activeSchedule?.tasks ?? [], [activeSchedule]);
  // THE anchor rule (utils/scheduleOps.resolveScheduleAnchor). This used to be
  // `activeSchedule?.startDate ?? todayCalendarDay()`, and 2 of the 3 real
  // schedules have no startDate — so every task on them was drawn from TODAY
  // and moved forward one day, every day: Henderson's 'Layout & Design Review'
  // read Sep 8–12 on Sunday and Sep 9–13 on Monday, with nothing on screen
  // saying the anchor was invented (runtime audit SCHED-NO-ANCHOR).
  // `anchor.iso` is null when undated; the surfaces below either print the
  // WORKING-DAY numbers instead or are replaced by the "set a start date"
  // banner. Nothing here substitutes a date the user did not choose.
  const anchor = useMemo(() => resolveScheduleAnchor(activeSchedule), [activeSchedule]);
  const isUndated = !!activeSchedule && tasks.length > 0 && !anchor.dated;
  // Only for the two RELATIVE surfaces that cannot render without an origin
  // (Progress' milestone column, the Living Plan's "today" index) — always
  // under the banner. See the report note: both should take `string | null`.
  const previewStartDate = anchor.iso ?? anchor.unanchoredPreviewIso;

  // ─────────────────────────────────────────────────────────────────────────
  // WHERE THIS SCREEN'S SCHEDULE WRITES GO, by the caller's role (#25).
  //
  //   owner / editor (and null while the role loads, so they never see a
  //   read-only flash) → updateProject, the projects-row PATCH.
  //   viewer → nowhere; every updateProject(...) below is a no-op that raises
  //   the standing notice instead of looking like it worked.
  //   field  → the field_update_schedule_tasks RPC. projects_update refuses the
  //   row PATCH for a field collaborator with 200 + 0 rows, so on THE PRIMARY
  //   PLATFORM his progress tap, his status change and his stamped actuals
  //   looked saved here and were gone on the next reload, with nothing said.
  //   The RPC saves progress, status, notes and actual start/finish ONLY;
  //   anything else this screen writes — the start date (applyStartDate), the
  //   baseline lock (lockPlan), the start-day-basis answer (answerStartDayBasis),
  //   a date/duration/dependency edit or an added or removed task (saveTasks) —
  //   is NOT saved, and the notice below says which, rather than letting it
  //   vanish on his next reload.
  //
  // Same shape as app/schedule-pro.tsx `saveAsField`; the two screens must
  // stay in step (scripts/validate-field-schedule-update.ts pins both).
  // ─────────────────────────────────────────────────────────────────────────
  const role = useProjectRole(selectedProject?.id);
  const writePath = scheduleWritePathForRole(role ?? selectedProject?.myRole);
  const [fieldNotice, setFieldNotice] = useState<string | null>(null);
  // Owner/editor side of #25 on this screen: a change made in the open task
  // sheet that the server will not keep (see saveAsRow).
  const [rowConflictNotice, setRowConflictNotice] = useState<string | null>(null);
  // A refusal on one project is not news on the next — the picker switches
  // projects in place (same reset as schedule-pro's).
  useEffect(() => { setFieldNotice(null); setRowConflictNotice(null); }, [selectedProject?.id]);
  // A field send that did not reach the server (#138) — no signal, or the
  // server said no. Its own plain banner with Retry, NOT the padlock card:
  // "Date and task editing is hidden on field access" over a lost connection
  // read as a permissions problem, and nothing ever re-sent his tap.
  const [fieldFailure, setFieldFailure] = useState<FieldSendFailure | null>(null);
  const autoRetryAttemptRef = useRef(0);
  useEffect(() => { setFieldFailure(null); autoRetryAttemptRef.current = 0; }, [selectedProject?.id]);
  // The field keys the task sheet's CURRENT change touched, set by
  // onUpdateTask around its saveTasks call so saveAsRow can tell a value he
  // changed from one the sheet merely carried in from when it opened.
  const sheetTouchedRef = useRef<{ taskId: string; keys: string[] } | null>(null);
  // Latest projects for the async field save — the closure that fires can
  // predate the render that holds the edit it is diffing against.
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  // `serverBase`: a retry's fresh read of the row (#138) — diffed against and
  // applied over THAT, not this device's copy, which may predate it.
  const saveAsField = useCallback(async (id: string, updates: Partial<Project>, serverBase?: ScheduleTask[]) => {
    const currentSchedule = projectsRef.current.find((p) => p.id === id)?.schedule;
    if (!currentSchedule) return;
    const baseTasks = serverBase ?? currentSchedule.tasks ?? [];
    const { patches, blocked } = updates.schedule?.tasks
      ? fieldTaskDiff(baseTasks, updates.schedule.tasks)
      : { patches: [], blocked: [] };
    const settingsChanged = Object.keys(updates).some((k) => k !== 'schedule')
      || fieldScheduleSettingsChanged(currentSchedule, updates.schedule);
    let accepted = baseTasks;
    let failure: string | null = null;
    if (patches.length > 0) {
      const sent = await sendFieldTaskPatches(supabase, id, patches);
      if (sent.ok) {
        accepted = applyFieldTaskPatches(baseTasks, patches);
        // With the stamps the RPC wrote (#87), so a retry after a later failed
        // send still finds the server holding what this device holds.
        accepted = mergeWrittenStamps(accepted, sent.stamps);
        // Local copy = what the server now holds. The row PATCH this also
        // enqueues is refused for field (0 rows, nothing written).
        updateProjectRaw(id, { schedule: { ...currentSchedule, tasks: accepted, updatedAt: new Date().toISOString() } });
      } else {
        failure = sent.message;
        // Kept in memory for Retry (and the automatic re-send while offline)
        // — see captureFieldSendFailure for why this is not the offline queue.
        const captured = captureFieldSendFailure(id, baseTasks, patches, sent);
        setFieldFailure((prev) => mergeFieldSendFailure(prev, captured));
      }
    }
    if (failure || blocked.length > 0 || settingsChanged) {
      // The one working copy this screen keeps outside `projects` is the open
      // task sheet — put it back to what the server accepted so the row it
      // shows can never read as saved.
      setDetailTask((t) => (t ? accepted.find((x) => x.id === t.id) ?? null : t));
      const what = blocked.length > 0
        ? `changes to ${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? ` and ${blocked.length - 3} more` : ''}`
        : settingsChanged ? 'schedule settings' : '';
      // The padlock card carries ONLY what access refused; a send failure has
      // its own banner (fieldFailure) — both show when both happened.
      if (what) setFieldNotice(FIELD_NOT_SAVED(what));
    } else {
      // Everything he changed was saved — a stale refusal must not linger over
      // an edit that did land.
      setFieldNotice(null);
      autoRetryAttemptRef.current = 0;
    }
  }, [updateProjectRaw]);
  // The row save. The list is built from `projects`, but the open task sheet
  // is its own copy, taken when it opened: a refetch or realtime event that
  // lands while it is open brings a newer field value (the foreman's 60%)
  // the sheet never saw, and updateProject's stampFieldEdits puts that value
  // back over the sheet's — correctly, the trigger would too. Nothing on the
  // iPhone said so: the list showed the server's value while the sheet still
  // showed his. Now the sheet catches up to what is kept, and when the value
  // was one he changed in the sheet just now, the notice says his change was
  // not saved.
  const saveAsRow = useCallback((id: string, updates: Partial<Project>) => {
    const kept = projectsRef.current.find((p) => p.id === id)?.schedule?.tasks ?? [];
    const sent = updates.schedule?.tasks;
    const refused = sent ? staleFieldEdits(kept, sent) : [];
    updateProjectRaw(id, updates);
    if (refused.length === 0) return;
    const keptById = new Map(kept.map((t) => [t.id, t] as const));
    setDetailTask((t) => {
      if (!t) return t;
      const mine = refused.filter((r) => r.taskId === t.id);
      if (mine.length === 0) return t;
      const k0 = keptById.get(t.id) as unknown as Record<string, unknown> | undefined;
      const next = { ...(t as unknown as Record<string, unknown>) };
      for (const r of mine) {
        if (k0 && r.key in k0) next[r.key] = k0[r.key]; else delete next[r.key];
      }
      if (k0?.fieldEditedAt !== undefined) next.fieldEditedAt = k0.fieldEditedAt;
      return next as unknown as ScheduleTask;
    });
    const touched = sheetTouchedRef.current;
    const reported = refused.filter((r) => touched?.taskId === r.taskId && touched.keys.includes(r.key));
    if (reported.length === 0) return;
    const first = reported[0];
    const title = keptById.get(first.taskId)?.title || 'This task';
    const when = new Date(first.fieldEditedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const what = ROW_FIELD_KEY_LABEL[first.key] ?? first.key;
    // Neutral about who: a stamp this device did not mint may be the foreman's
    // or the GC's own other device.
    setRowConflictNotice(`${title}'s ${what} was updated elsewhere — in the field or on another device — at ${when}, after you opened it, so your change was not saved. It now shows that value — change it again if yours is right.`);
  }, [updateProjectRaw]);
  // Re-send what did not land (#138). The row is READ FIRST and the decision is
  // made against the server's copy (planFieldRetry): a phone that had no
  // signal cannot have received the GC's newer edit, and the RPC stamps what
  // it takes with the server clock, so a re-send decided on this device's copy
  // would overwrite that edit. A key goes out only while the server still holds
  // the value and stamp this device had when the send failed; one changed
  // elsewhere is dropped and he is told so. No read (still offline): nothing is
  // sent and the failure stays for the next try. The send goes through
  // saveAsField, diffed against and applied over the read, like the original.
  const fieldFailureRef = useRef<FieldSendFailure | null>(null);
  fieldFailureRef.current = fieldFailure;
  const retryInFlightRef = useRef(false);
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
        if (!plan.read) { setFieldFailure((cur) => (cur === f ? { ...f } : cur)); return; }
        // Anything folded in while the read was out stays for its own retry. A
        // value dropped because it changed elsewhere is said, not swallowed.
        const notice = plan.superseded.length > 0 ? fieldRetrySupersededNotice(f.projectId, plan.superseded) : null;
        setFieldFailure((cur) => (cur === f ? notice : cur));
        absorbServerSchedule(f.projectId, plan.serverTasks);
        if (plan.patches.length === 0) return;
        const current = projectsRef.current.find((p) => p.id === f.projectId)?.schedule;
        if (!current) return;
        await saveAsField(f.projectId, { schedule: { ...current, tasks: applyFieldTaskPatches(plan.serverTasks, plan.patches) } }, plan.serverTasks);
      } finally {
        retryInFlightRef.current = false;
      }
    })();
  }, [writePath, saveAsField, absorbServerSchedule]);
  const dismissFieldFailure = useCallback(() => { setFieldFailure(null); autoRetryAttemptRef.current = 0; }, []);
  // A retryable failure whose every key has since been saved or superseded is
  // no longer news — nothing is waiting to go. A refusal stays until read.
  const fieldFailureShown = useMemo<FieldSendFailure | null>(() => {
    if (!fieldFailure) return null;
    if (!fieldFailure.retryable) return fieldFailure;
    return pendingFieldRetryPatches(fieldFailure, tasks).length > 0 ? fieldFailure : null;
  }, [fieldFailure, tasks]);
  // No signal: re-send by itself while the screen is open — on a backoff, and
  // at once when the app comes back to the foreground. (There is no NetInfo
  // in this app: it is a native module and would need a new build.)
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
  const updateProject = useMemo<typeof updateProjectRaw>(
    () => (writePath === 'row'
      ? saveAsRow
      : writePath === 'field_rpc'
        ? (id, updates) => { void saveAsField(id, updates); }
        : () => { setFieldNotice(VIEWER_SCHEDULE_NOTICE); }),
    [writePath, updateProjectRaw, saveAsField, saveAsRow],
  );
  // ── LIVE: the foreman's save reaches this phone while it is open (audit #140).
  // Schedule Pro (web) was the only subscriber, so the GC's iPhone kept the
  // old percent and verdict until the app went to the background. The list is
  // built straight from `projects`, so absorbing into the shared copy is the
  // whole job — no working copy, no debounce, none of Schedule Pro's merge.
  // absorbServerSchedule does the field-key 3-way merge, so an echo of this
  // phone's own older save cannot undo a newer one. projects_select admits
  // collaborators (is_project_collaborator), so a field seat receives it too.
  // The 'schedule-tab' scope gives this mount its OWN channel: realtime-js
  // hands back the existing channel for a matching topic, and Schedule Pro
  // pushed over this tab for the same job would otherwise share it and tear
  // it down on unmount (hooks/useLiveSchedule.ts).
  const liveProjectId = selectedProject?.id;
  // THE WHOLE COPY, not only its tasks (#86): the baseline list and the active
  // baseline ride along. Tasks-only kept this phone's [v1]/v1 after the GC
  // captured and activated v2 on the web, and his next nudge here wrote
  // [v1]/v1 back over the row — v2 deleted, "behind plan" measured from v1
  // again. absorbServerSchedule takes them only while this project has no
  // unconfirmed write of its own, so a lock made here that is still leaving is
  // never lost to a peer echo.
  // ...and only while this project has NOTHING in the offline queue either.
  // A write that answered 'queued' has left the debounce and in-flight maps
  // absorbServerSchedule checks, so a whole copy taken then would replace the
  // tasks he edited with no signal, and his next nudge would queue the server
  // copy behind them — his offline edits gone when it lands last. Busy until
  // the first read says otherwise, and from the moment a change is signalled
  // until it is read (the same rule as Schedule Pro's queueBusyRef). A busy
  // project takes the tasks-only 3-way merge (peerScheduleAdopt).
  const queueBusyRef = useRef(true);
  useEffect(() => {
    const pid = liveProjectId;
    if (!pid) { queueBusyRef.current = false; return; }
    let disposed = false;
    let seq = 0;
    const refresh = () => {
      const mine = ++seq;
      queueBusyRef.current = true;
      void getOwnOfflineQueue().then((queue) => {
        if (disposed || mine !== seq) return;
        queueBusyRef.current = projectWriteQueued(queue, pid);
      }).catch(() => {
        // Unreadable queue: stay on the tasks-only merge, which never drops a
        // local edit — only the baselines wait for a later copy.
        if (disposed || mine !== seq) return;
        queueBusyRef.current = true;
      });
    };
    refresh();
    const unsubscribe = onQueueChanged(refresh);
    return () => { disposed = true; unsubscribe(); };
  }, [liveProjectId]);
  const onPeerSchedule = useCallback((copy: LiveScheduleCopy) => {
    if (liveProjectId) {
      absorbServerSchedule(liveProjectId, copy.tasks, peerScheduleAdopt(copy, queueBusyRef.current));
    }
  }, [liveProjectId, absorbServerSchedule]);
  // Realtime does not replay what it missed while the socket was down (a
  // pocketed phone, a dead zone on site) — re-read the row once it rejoins.
  const onLiveGap = useCallback(() => {
    const pid = liveProjectId;
    if (!pid) return;
    void (async () => {
      try {
        const { data } = await supabase.from('projects').select('schedule').eq('id', pid).maybeSingle();
        // The whole schedule column, read the same way as a live event (#86).
        const fresh = liveScheduleCopyFromRow((data as { schedule?: unknown } | null)?.schedule);
        if (fresh) absorbServerSchedule(pid, fresh.tasks, peerScheduleAdopt(fresh, queueBusyRef.current));
      } catch {
        // Offline again — the next rejoin or the foreground refetch catches up.
      }
    })();
  }, [liveProjectId, absorbServerSchedule]);
  useLiveSchedule(liveProjectId, onPeerSchedule, onLiveGap, 'schedule-tab');

  // A plain notice for things that are not refusals: a dragged bar the engine
  // put back (and why), or a peer change to the task open in the sheet.
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  useEffect(() => { setScheduleNotice(null); }, [selectedProject?.id]);

  // Keep the open task sheet in step with the stored task. It holds its own
  // copy, so a realtime save by the foreman used to change the list row while
  // the sheet above it still showed the old status and dates until he saved
  // over them. Fields he has not changed follow the stored copy
  // (followStoredTask); his own in-flight change keeps its value.
  const detailTaskRef = useRef(detailTask);
  detailTaskRef.current = detailTask;
  const prevStoredTasksRef = useRef(tasks);
  useEffect(() => {
    const prevList = prevStoredTasksRef.current;
    prevStoredTasksRef.current = tasks;
    const open = detailTaskRef.current;
    if (!open || prevList === tasks) return;
    const { task: followed, peerChangedKeys } = followStoredTask(
      open,
      prevList.find((t) => t.id === open.id),
      tasks.find((t) => t.id === open.id),
    );
    if (followed === open) return;
    setDetailTask(followed);
    // The sheet keeps its own drafts of these (the % slider, title, crew,
    // notes) from the moment it opened, so it cannot show the new value
    // itself — say so rather than let the slider contradict the row.
    const drafted = peerChangedKeys.filter((k) => SHEET_DRAFT_KEYS.includes(k));
    if (drafted.length > 0) {
      const what = drafted.map((k) => ROW_FIELD_KEY_LABEL[k] ?? k).join(', ');
      setScheduleNotice(`${followed.title || 'This task'} was updated elsewhere while it was open (${what}). The list shows the new value — close and reopen the task to edit from it.`);
    }
  }, [tasks]);

  /**
   * Why the two WHOLE-PLAN actions (bring the plan up to date, lock the plan)
   * cannot run on this access, or null when they can. Both are dates and
   * settings from end to end — the field RPC carries neither — and both confirm
   * themselves out loud, so they are refused before the confirmation rather
   * than announcing a move the server dropped.
   */
  const wholePlanWriteBlocked = useMemo<string | null>(() => {
    if (writePath === 'row') return null;
    return writePath === 'field_rpc'
      ? 'Field access can’t move schedule dates or lock a plan. Your progress, status, notes and actual start/finish still save — ask the project owner for editor access to do this.'
      : VIEWER_SCHEDULE_NOTICE;
  }, [writePath]);

  const [showExport, setShowExport] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);

  // Legacy day-scale disclosure — the `utils/scheduleRebase.ts` population.
  // This screen's own `applyStartDate` used to be one of the three call sites
  // that rewrote every `startDay` onto the calendar scale, so a schedule that
  // got its anchor HERE is a candidate. The decision lives entirely in
  // `previewStartDayBasisMigration`; this screen renders it and persists the
  // answer. Reads the persisted tasks, which on this screen is `tasks`.
  const startDayBasisPreview = useMemo(
    () => previewStartDayBasisMigration({
      tasks,
      startDate: activeSchedule?.startDate,
      workingDaysPerWeek: activeSchedule?.workingDaysPerWeek,
      nonWorkingDates: activeSchedule?.nonWorkingDates,
      startDayBasis: activeSchedule?.startDayBasis,
    }),
    [tasks, activeSchedule?.startDate, activeSchedule?.workingDaysPerWeek,
     activeSchedule?.nonWorkingDates, activeSchedule?.startDayBasis],
  );
  /**
   * One write for both halves of the answer. NOT `saveTasks`: that routes
   * through buildScheduleFromTasks + mergeEditedSchedule, which preserves the
   * EXISTING (absent) `startDayBasis` by design — correct for an edit, wrong
   * for the one write whose entire purpose is to set it. Declining stamps the
   * flag and touches no task, which is what stops the question returning.
   */
  const answerStartDayBasis = useCallback((accept: boolean) => {
    if (!selectedProject || !activeSchedule) return;
    // The whole policy is in the patch (utils/cpm.startDayBasisAnswerPatch).
    updateProject(selectedProject.id, {
      schedule: {
        ...activeSchedule,
        projectId: selectedProject.id,
        ...startDayBasisAnswerPatch(startDayBasisPreview, accept, activeSchedule),
        updatedAt: new Date().toISOString(),
      },
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [selectedProject, activeSchedule, startDayBasisPreview, updateProject]);
  const reportCpm = useMemo(
    // No anchor ⇒ NO scheduleStartDate: runCpm then stays in raw-day mode.
    // Passing today here flipped an undated schedule into calendar mode, which
    // is the finish-jump bug (a 33-day plan reporting 43).
    () => runCpm(tasks, { scheduleStartDate: anchor.iso ?? undefined, workingDaysPerWeek: activeSchedule?.workingDaysPerWeek, nonWorkingDates: activeSchedule?.nonWorkingDates }),
    [tasks, anchor.iso, activeSchedule?.workingDaysPerWeek, activeSchedule?.nonWorkingDates],
  );

  // ───────────────────────────────────────────────────────────────────────
  // THE ANSWER THE PHONE NEVER GAVE: what date do we finish, and are we behind?
  //
  // Every input below already existed on this screen; none of it was rendered.
  // The desktop prints this from SchedulerHeader/DashboardTab, both of which
  // mount only inside schedule-pro, which shows "Best on a bigger screen"
  // under 900pt — so on the primary platform the one number a GC is asked for
  // on every Monday owner call was the one number the app would not print.
  // ───────────────────────────────────────────────────────────────────────

  /** The schedule's calendar, in the shape cpm/scheduleOps helpers want. */
  const scheduleCalendar = useMemo(() => ({
    scheduleStartDate: anchor.iso ?? undefined,
    workingDaysPerWeek: activeSchedule?.workingDaysPerWeek,
    nonWorkingDates: activeSchedule?.nonWorkingDates,
  }), [anchor.iso, activeSchedule?.workingDaysPerWeek, activeSchedule?.nonWorkingDates]);

  /**
   * Where the engine placed each task (es/ef, calendar indices). The list and
   * the timeline draw THESE, not the stored startDay pin (audit #51): the
   * verdict and finish above already come from this same run, so the screen
   * gives one answer.
   */
  // reportCpm runs dated only when the schedule has an anchor; undated it is in
  // raw-day mode and es/ef are WORKING counts — the flag carries that scale to
  // the list and the timeline so an undated bar is walked, not drawn raw.
  const placementsDated = !!anchor.iso;
  const placements = useMemo(() => scheduledPlacements(reportCpm, placementsDated), [reportCpm, placementsDated]);

  /**
   * TODAY as a CALENDAR index on this schedule's anchor — null when the
   * schedule is undated, which is the state 2 of the 3 real production
   * schedules are in. Null means there is no "today" to measure against, and
   * every consumer below says so rather than substituting one.
   */
  const todayCalendarIndex = useMemo(
    () => todayScheduleDay(anchor.iso ?? undefined),
    [anchor.iso],
  );

  /**
   * The projected finish, rendered from the ENGINE's own number.
   * `calendarDayToDate`, not `addWorkingDays`: cpm.projectFinish is a CALENDAR
   * index (utils/cpm.ts "THE TWO DAY-NUMBER SCALES"), and walking it as a
   * working ordinal adds about two days per weekend it spans.
   */
  const finishDateLabel = useMemo(() => {
    if (!anchor.date || tasks.length === 0 || reportCpm.projectFinish <= 0) return '—';
    return calendarDayToDate(anchor.date, reportCpm.projectFinish)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, [anchor.date, tasks.length, reportCpm.projectFinish]);

  /**
   * Slip vs the active baseline — derived EXACTLY as schedule-pro derives it
   * (baselineFinishDayWorkingScale + workingDaysBetween off the last entry of
   * `baselines[]`), so the phone and the laptop can never quote two different
   * slips for the same job. Null when no baseline was ever captured, which on
   * a phone-only account used to be always (the only capture was desktop-only);
   * lockPlan below is the phone's own capture. The verdict handles null by
   * falling back to pace.
   */
  // The schedule's NAMED active baseline (#137) — the one the web Baseline
  // manager activated — else the newest lock. One resolver for every reader,
  // so the phone, Schedule Pro and the tab can never measure from two.
  const activeBaseline = useMemo<NamedBaseline | null>(
    () => getActiveBaseline(activeSchedule),
    [activeSchedule],
  );
  const baselineFinishDay = useMemo<number | null>(
    () => (activeBaseline ? baselineFinishDayWorkingScale(activeBaseline, scheduleCalendar) : null),
    [activeBaseline, scheduleCalendar],
  );
  const slipDaysVsBaseline = useMemo<number | null>(() => {
    if (baselineFinishDay == null) return null;
    return workingDaysBetween(baselineFinishDay, reportCpm.projectFinish, scheduleCalendar);
  }, [baselineFinishDay, scheduleCalendar, reportCpm.projectFinish]);
  /** The locked plan's own finish, as a date — what "behind plan" is measured
   *  from. Null when undated: an index with no anchor is not a date. */
  const baselineFinishLabel = useMemo(() => {
    if (!anchor.date || baselineFinishDay == null) return null;
    return calendarDayToDate(anchor.date, baselineFinishDay)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, [anchor.date, baselineFinishDay]);

  /**
   * The pace read, from the same function the owner-facing surfaces use. Only
   * its schedule half is read here, so the billing inputs are deliberately
   * empty — passing the real change orders/invoices would change nothing on
   * this screen and would drag two more contexts into it.
   */
  const pace = useMemo(() => {
    if (!selectedProject || tasks.length === 0) return null;
    const oc = buildOwnerConfidence({
      project: selectedProject, changeOrders: [], invoices: [], nowMs: Date.now(),
    });
    return { status: oc.status, pctComplete: oc.pctComplete };
  }, [selectedProject, tasks.length]);

  // `new Date(t.deadline).getTime() < Date.now()` was wrong twice over: a
  // 'YYYY-MM-DD' deadline parses as UTC MIDNIGHT, so west of Greenwich a task
  // due today read as overdue from the moment the screen opened; and comparing
  // against the current INSTANT made "due today" overdue at one minute past
  // midnight anyway. A deadline is a calendar day — it is late once the day
  // itself has passed, which is what comparing local midnights says.
  const overdueCount = useMemo(() => {
    const todayMidnight = parseCalendarDay(todayCalendarDay())?.getTime() ?? Date.now();
    return tasks.filter((t) => {
      if (t.status === 'done' || !t.deadline) return false;
      const due = parseCalendarDay(t.deadline);
      return due != null && due.getTime() < todayMidnight;
    }).length;
  }, [tasks]);

  const verdict = useMemo<PacedVerdict>(() => pacedScheduleVerdict({
    slipDaysVsBaseline,
    finishDateLabel,
    // The task whose finish IS the finish — not the last id in criticalPath,
    // which is only topological order (see finishDriverTitle).
    criticalDriverTitle: finishDriverTitle(tasks, {
      perTask: reportCpm.perTask,
      projectFinish: reportCpm.projectFinish,
      criticalTaskIds: reportCpm.criticalPath,
    }),
    overdueCount,
    pace: pace?.status ?? null,
    pctComplete: pace?.pctComplete ?? 0,
  }), [slipDaysVsBaseline, finishDateLabel, tasks, reportCpm, overdueCount, pace]);

  /**
   * "Bring the plan up to date" — the preview, computed for the strip's
   * behind-count as well as the sheet. Null when there is no data date: an
   * undated schedule has no today, so the action is disabled with that reason
   * rather than silently doing nothing.
   */
  const catchUp = useMemo<CatchUpPlan | null>(() => {
    if (todayCalendarIndex == null || tasks.length === 0) return null;
    return planCatchUpToToday(tasks, { todayCalendarIndex, calendar: scheduleCalendar });
  }, [tasks, todayCalendarIndex, scheduleCalendar]);

  const [showFinishSheet, setShowFinishSheet] = useState(false);

  /**
   * The tasks as of the LATEST render, for the audit diff only. The catch-up's
   * Undo button runs a `saveTasks` captured before the catch-up was written, so
   * its closed-over `tasks` IS the array it restores — diffing that against
   * itself logged nothing, and the undo (which moves every date back) left no
   * row. The ref holds what is actually on disk when the button is tapped.
   */
  const latestTasksRef = useRef(tasks);
  latestTasksRef.current = tasks;

  const saveTasks = useCallback((nextTasks: ScheduleTask[], opts: { reason?: string } = {}) => {
    if (!selectedProject) return;
    const name = activeSchedule?.name ?? `${selectedProject.name} Schedule`;
    // Mobile Pro is a MANUAL scheduler — startDay is user-authoritative (drag +
    // steppers). Run CPM ONLY to refresh critical-path flags (which tasks sit on
    // the longest dependency chain) + the engine-true project finish, then keep
    // each task's manual startDay. Passing criticalPathDays makes
    // buildScheduleFromTasks skip its forward-pass resolver, so manual positions
    // stick even for dependent tasks and day-0 isn't clamped to day-1.
    // CPM runs on the schedule's OWN calendar (anchor + working week +
    // closures) so the stored finish agrees with every other surface — a raw
    // 7-day run here used to disagree with the calendar-aware numbers the
    // export/report path computes (sim-audit #2).
    const cpm = runCpm(nextTasks, {
      scheduleStartDate: activeSchedule?.startDate,
      workingDaysPerWeek: activeSchedule?.workingDaysPerWeek,
      nonWorkingDates: activeSchedule?.nonWorkingDates,
    });
    // The audit row, built from the arrays on both sides of THIS write (see
    // describeMobileScheduleEdit). The "before" finish is run on the same
    // calendar as the "after" one so the two numbers are comparable.
    const prevTasks = latestTasksRef.current;
    const cpmBefore = runCpm(prevTasks, {
      scheduleStartDate: activeSchedule?.startDate,
      workingDaysPerWeek: activeSchedule?.workingDaysPerWeek,
      nonWorkingDates: activeSchedule?.nonWorkingDates,
    });
    const auditDraft = describeMobileScheduleEdit({
      prev: prevTasks,
      next: nextTasks,
      finishBefore: cpmBefore.projectFinish,
      finishAfter: cpm.projectFinish,
      formatFinish: (day) => (anchor.date
        ? calendarDayToDate(anchor.date, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : `day ${day}`),
      reason: opts.reason,
      user: auditUser,
    });
    const critical = new Set(cpm.criticalPath);
    const flagged = nextTasks.map((t) => (critical.has(t.id) !== !!t.isCriticalPath ? { ...t, isCriticalPath: critical.has(t.id) } : t));
    // startDate policy (finish-jump bug): an EXISTING schedule keeps its
    // anchor exactly — including "no anchor" (retro-stamping today flips CPM
    // raw-day → calendar mode and the finish jumps). Only schedule CREATION
    // (first task on a project with no schedule yet) anchors at today.
    // Creating a schedule NOW is a real user act, so day 1 is today. An
    // existing schedule keeps its own anchor — including "none".
    const creationAnchor = activeSchedule ? activeSchedule.startDate : todayCalendarDay();
    const next = buildScheduleFromTasks(name, selectedProject.id, flagged, activeSchedule?.baseline ?? null, {
      ...(creationAnchor ? { startDate: creationAnchor } : {}),
      criticalPathDays: cpm.projectFinish,
    });
    // Merge the freshly-derived scalars onto the EXISTING schedule so every
    // sidecar field survives (nonWorkingDates, scenarios, activeScenarioId,
    // criticalFloatThresholdDays, resources, resourceCalendars, fragnets,
    // baselines[], weatherAlerts, weatherDelayLog) and bufferDays /
    // workingDaysPerWeek aren't reset to buildScheduleFromTasks' hardcoded
    // defaults — a naive `{ ...next }` write silently wiped all of these on
    // every task edit, and (post the calendar-aware CPM fix) it also fed
    // nonWorkingDates into the finish computation and then dropped it. On
    // schedule CREATION (no activeSchedule) there is nothing to preserve, so
    // `next` is written as-is (it already carries the creation anchor).
    const merged = activeSchedule
      ? mergeEditedSchedule(activeSchedule, next, { projectId: selectedProject.id })
      : { ...next, projectId: selectedProject.id, updatedAt: new Date().toISOString() };
    updateProject(selectedProject.id, { schedule: merged });
    // The audit row describes THIS write, so it is only written when this write
    // is the one that lands. On field access the server merges a subset (and
    // refuses the rest) and on view-only nothing is written at all — a local row
    // saying "finish Mar 3 → Mar 14" for a change the database dropped is
    // exactly the false record a delay claim must not be argued from.
    if (auditDraft && writePath === 'row') void appendAuditToAsyncStorage(selectedProject.id, buildAuditEntry(auditDraft));
  }, [selectedProject, activeSchedule, updateProject, writePath, anchor.date, auditUser]);

  const onUpdateTask = useCallback((next: ScheduleTask) => {
    // Pace flywheel: this is a full-object sink — `next` spreads the previous
    // task, so it already carries any existing actuals. The stamp (computed
    // from the PREVIOUS task + the NEW status) only adds fields that were
    // unset, so merging it over `next` never overwrites history.
    const prev = tasks.find((t) => t.id === next.id);
    let stamped: ScheduleTask = next;
    if (prev && next.status !== prev.status) {
      // No retro start (audit #141): a task closed with no recorded start keeps
      // an EMPTY start — the same rule as the daily report — rather than a planned
      // day nobody observed. Pace samples need both stamps, so it is skipped there.
      const stamp = stampActuals(prev, next.status, todayScheduleDay(activeSchedule?.startDate), new Date().toISOString(), { retroStartFromPlanned: false });
      stamped = { ...next, ...stamp };
      // Morning-brief ledger: a real capture (stamp set an ISO date) is a
      // did-for-you moment. recordDidForYou is G4-safe by contract.
      if (stamp.actualStartDate != null || stamp.actualEndDate != null) {
        recordDidForYou(`Auto-stamped actual dates for ${prev.title}`, selectedProject?.id);
      }
    }
    // The sheet first, THEN the save: saveAsRow may put a refused value back
    // into the sheet, and a setDetailTask(stamped) after it would undo that.
    setDetailTask(stamped);
    const shown = detailTask?.id === stamped.id ? detailTask as unknown as Record<string, unknown> : null;
    const sr = stamped as unknown as Record<string, unknown>;
    sheetTouchedRef.current = shown
      ? { taskId: stamped.id, keys: FIELD_TASK_PATCH_KEYS.filter((k) => JSON.stringify(shown[k] ?? null) !== JSON.stringify(sr[k] ?? null)) }
      : null;
    try {
      saveTasks(tasks.map((t) => (t.id === stamped.id ? stamped : t)));
    } finally {
      sheetTouchedRef.current = null;
    }
    // A drag or ± stepper moved the pin earlier than the predecessors allow:
    // the bar is drawn where the ENGINE puts it, so it snaps back. Say why
    // (a blocked control says why) instead of looking like the drag was lost.
    if (prev && stamped.startDay !== prev.startDay && writePath === 'row') {
      const nextTasks = tasks.map((t) => (t.id === stamped.id ? stamped : t));
      const snap = startDaySnapBack(nextTasks, stamped.id, runCpm(nextTasks, scheduleCalendar), scheduleCalendar);
      if (snap) {
        const fmtDay = (d: number) => (anchor.date
          ? calendarDayToDate(anchor.date, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : `day ${d}`);
        const who = snap.waitsOn ? `it waits on ${snap.waitsOn}` : 'its links and constraints hold it later';
        setScheduleNotice(`${stamped.title || 'This task'} can’t start ${fmtDay(snap.requestedCalendarDay)} — ${who}, so it stays on ${fmtDay(snap.scheduledCalendarDay)}. To bring it earlier, shorten or unlink ${snap.waitsOn ?? 'what it depends on'}.`);
      } else {
        setScheduleNotice(null);
      }
    }
  }, [tasks, saveTasks, activeSchedule?.startDate, selectedProject?.id, detailTask, writePath, scheduleCalendar, anchor.date]);

  const onCreate = useCallback((values: NewTaskValues) => {
    // startDay is 1-indexed to MATCH the desktop + CPM engine (day 1 = schedule
    // start). Legacy mobile-created tasks stored 0-indexed self-correct on their
    // next edit; we intentionally do NOT mutate stored data (can't safely tell a
    // 0-indexed mobile task apart from a 1-indexed desktop one).
    // parseCalendarDay, not new Date(): a bare 'YYYY-MM-DD' parses as UTC
  // midnight and floors to the PREVIOUS local day at negative offsets, so every
  // date here rendered a day early. Same fix as MobileGantt / TaskDetailSheet /
  // SchedulerHeader / MobileScheduleList.
    const base = anchor.date ?? null;
    let startDay: number;
    // UX-F2: AddTaskModal hands back a bare 'YYYY-MM-DD'; new Date() of that
    // is UTC midnight and lands on the previous local day west of Greenwich,
    // so a task picked for Monday used to get Sunday's day number.
    // With NO anchor there is no map from a calendar date to a day number at
    // all, so the pick is refused out loud rather than silently resolved
    // against today (SCHED-NO-ANCHOR).
    const target = values.startIso ? parseCalendarDay(values.startIso) : null;
    if (target && !base) {
      showAlert(UNDATED_SCHEDULE_TITLE, 'Set the schedule\u2019s start date first \u2014 without it a calendar date has no day number. The task will be added after the last one.');
    }
    if (target && base) {
      // B4 review A9: startDay is a WORKING-day number (the CPM engine,
      // getTaskDateRange and the desktop grid all walk addWorkingDays from
      // the anchor), so the picked date is converted with the inverse walk —
      // not `round((target - base) / MS_DAY) + 1`, which handed a task picked
      // for the second Monday of a 5-day-week schedule startDay 8 and drew it
      // on the Wednesday after. A pick on a closed day starts the next
      // working day, as the desktop scheduler does.
      startDay = startDayNumberFor(base, target, activeSchedule?.workingDaysPerWeek, activeSchedule?.nonWorkingDates);
    } else {
      startDay = tasks.length === 0 ? 1 : Math.max(...tasks.map((t) => (t.startDay ?? 1) + Math.max(1, t.durationDays || 1)));
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
  }, [tasks, saveTasks, anchor.date, activeSchedule?.workingDaysPerWeek, activeSchedule?.nonWorkingDates]);

  const onDeleteTask = useCallback((id: string) => {
    saveTasks(tasks.filter((t) => t.id !== id));
    setDetailTask(null);
  }, [tasks, saveTasks]);

  /**
   * Apply the catch-up. Same preview → apply → undo shape the desktop already
   * uses for Fix overloads and CO reflow: the sheet states the finish before
   * and after BEFORE anything is written, and the confirmation hands back a
   * one-tap Undo that restores the exact task array we started from (saveTasks
   * re-runs CPM on it, so the stored finish scalar goes back too).
   */
  const applyCatchUp = useCallback(() => {
    if (!catchUp || catchUp.changes.length === 0) return;
    // A catch-up re-dates every task that is behind — dates end to end, so
    // there is no field-access version of it. Refused BEFORE the confirmation,
    // or the alert below would announce a move the server never made (#25).
    if (wholePlanWriteBlocked) { showAlert('Schedule not changed', wholePlanWriteBlocked); setShowFinishSheet(false); return; }
    const before = tasks;
    saveTasks(catchUp.tasks, { reason: 'Brought the plan up to date' });
    setShowFinishSheet(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const moved = catchUp.changes.length;
    showAlert(
      'Plan brought up to date',
      `${moved} task${moved === 1 ? '' : 's'} re-dated so the work that is left starts today. Finished work kept its actual dates, and nothing moved earlier.`,
      [
        { text: 'Undo', style: 'cancel', onPress: () => saveTasks(before, { reason: 'Undid "Bring the plan up to date"' }) },
        { text: 'Keep it' },
      ],
    );
  }, [catchUp, tasks, saveTasks, wholePlanWriteBlocked]);

  const openAddAt = useCallback((iso: string) => {
    setAddPrefillDate(iso);
    setShowAdd(true);
  }, []);

  /**
   * Give an undated schedule a real anchor — the fix the banner offers.
   *
   * Mirrors app/(tabs)/schedule/index.tsx setProjectStartDate exactly.
   *
   * There used to be a `rebaseRawToCalendar` call here. It existed because the
   * CPM engine read `ScheduleTask.startDay` as a CALENDAR index: assigning the
   * first anchor flipped the engine out of raw-day mode and every stored
   * working-day ordinal silently reinterpreted as a calendar day, inflating
   * each multi-day chain (the finish-jump bug, 33 → 43 live on a 20-task
   * schedule).
   *
   * 2026-09-11: the engine now converts at its own `pins` line — `startDay` is
   * a WORKING ORDINAL on both sides of the flip, so there is nothing to
   * re-map. Re-mapping anyway DOUBLE-converts, and this screen writes the
   * result through `updateProject`, so the corruption is persisted rather than
   * merely displayed. Measured on A(10)->B(10)->C(5) authored at ordinals
   * 1/11/21, 5-day week from Mon 2026-03-02: startDays 1,11,21 became 1,15,29
   * and the finish moved Fri Apr 3 → Wed Apr 15.
   *
   * The scalars are still refreshed against the new anchor so the header does
   * not read a stale finish until the next edit.
   */
  /**
   * Lock a plan as the baseline — the phone's own capture.
   *
   * Before this, a GC who built his schedule on his iPhone could never lock
   * one: the only captures lived in schedule-pro and the tablet/web tab, and
   * both are unreachable under 900pt. `baselines[]` stayed empty, so
   * slipDaysVsBaseline was null forever and "behind plan" could not be said.
   *
   * It writes what the READERS read, not the legacy singular
   * `schedule.baseline` (`scheduleEngine.saveBaseline`), which no KPI, verdict
   * or health check looks at:
   *   * `baselines[]` via captureBaseline with the schedule calendar — the
   *     exact call BaselineManagerModal and the CO reflow make, so a phone lock
   *     and a laptop lock are one comparable history, and the slip right after
   *     locking is zero rather than a phantom;
   *   * each task's baselineStartDay/baselineEndDay via applyBaselineToTasks,
   *     which the health score's baseline_drift and CPLI checks filter on.
   *
   * Takes the schedule explicitly because the start-date prompt calls it with
   * the schedule it has JUST written, before this render's `activeSchedule`
   * has caught up — locking the stale one would erase the start date.
   */
  const lockPlan = useCallback((schedule: ProjectSchedule) => {
    if (!selectedProject || schedule.tasks.length === 0) return;
    const planAnchor = resolveScheduleAnchor(schedule);
    // An undated plan has no finish DATE to promise; the UI disables the lock
    // and says so, and this refuses rather than trusting every caller to.
    if (!planAnchor.dated || !planAnchor.date) return;
    const scale = {
      scheduleStartDate: planAnchor.iso ?? undefined,
      workingDaysPerWeek: schedule.workingDaysPerWeek,
      nonWorkingDates: schedule.nonWorkingDates,
    };
    const cpm = runCpm(schedule.tasks, scale);
    const existing = schedule.baselines ?? [];
    const snap = captureBaseline(schedule.tasks, `v${existing.length + 1}`, 'Locked from the phone schedule', {
      scale, cpm, capturedBy: auditUser,
    });
    updateProject(selectedProject.id, {
      // The lock becomes THE yardstick (#137): named, so an older baseline
      // activated on the web does not stay active over the one just locked.
      schedule: withActiveBaselineId({
        ...schedule,
        projectId: selectedProject.id,
        tasks: applyBaselineToTasks(schedule.tasks, snap),
        baselines: [...existing, snap],
        updatedAt: new Date().toISOString(),
      }, snap.id),
    });
    const finishLabel = cpm.projectFinish > 0
      ? calendarDayToDate(planAnchor.date, cpm.projectFinish)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    // Only when the lock is actually written (see saveTasks): the field RPC
    // refuses `baselines`, so on field or view-only access this row would
    // record a baseline the server never took.
    if (writePath === 'row') {
      void appendAuditToAsyncStorage(selectedProject.id, buildAuditEntry({
        user: auditUser,
        kind: 'baseline_capture',
        summary: `Locked the plan as baseline ${snap.name}${finishLabel ? ` — finish ${finishLabel}` : ''}`,
      }));
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [selectedProject, updateProject, writePath, auditUser]);

  /** The sheet's button. A first lock is the obvious act; a RE-lock moves the
   *  yardstick every later "behind plan" is measured from, so it asks first. */
  const requestLockPlan = useCallback(() => {
    if (!activeSchedule) return;
    // Access first, so nobody confirms a re-lock that the server refuses (#25).
    if (wholePlanWriteBlocked) { showAlert('Plan not locked', wholePlanWriteBlocked); return; }
    if (!activeBaseline) { lockPlan(activeSchedule); return; }
    const lockedOn = new Date(activeBaseline.savedAt)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    showAlert(
      'Re-lock the plan?',
      `Slip is measured from the newest lock. ${activeBaseline.name} (locked ${lockedOn}) stays in the baseline history, but "behind plan" will count from today's dates instead.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Re-lock', onPress: () => lockPlan(activeSchedule) },
      ],
    );
  }, [activeSchedule, activeBaseline, lockPlan, wholePlanWriteBlocked]);

  const [showHistory, setShowHistory] = useState(false);

  const applyStartDate = useCallback((pickedIso: string) => {
    if (!selectedProject || !activeSchedule) return;
    const day = parseCalendarDay(pickedIso);
    if (!day) { showAlert('Invalid date', 'Pick a day from the calendar.'); return; }
    const iso = toCalendarDayString(day);
    const nextTasks = activeSchedule.tasks;
    const cpm = runCpm(nextTasks, {
      scheduleStartDate: iso,
      workingDaysPerWeek: activeSchedule.workingDaysPerWeek,
      nonWorkingDates: activeSchedule.nonWorkingDates,
    });
    const nextSchedule: ProjectSchedule = {
      ...activeSchedule,
      projectId: selectedProject.id,
      tasks: nextTasks,
      startDate: iso,
      totalDurationDays: cpm.projectFinish,
      criticalPathDays: cpm.projectFinish,
      updatedAt: new Date().toISOString(),
    };
    updateProject(selectedProject.id, { schedule: nextSchedule });
    setShowStartDatePicker(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Moving the anchor moves every calendar date on the job — log it.
    const finishLabel = cpm.projectFinish > 0
      ? calendarDayToDate(day, cpm.projectFinish).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    // Same rule as saveTasks/lockPlan: the anchor is a schedule setting the
    // field RPC refuses, so only an owner/editor write gets a row.
    if (writePath === 'row') {
      void appendAuditToAsyncStorage(selectedProject.id, buildAuditEntry({
        user: auditUser,
        kind: 'reflow',
        summary: `Start date ${activeSchedule.startDate ? `moved ${activeSchedule.startDate} → ${iso}` : `set to ${iso}`}${finishLabel ? ` — finish ${finishLabel}` : ''}`,
      }));
    }
    // THE MOMENT TO LOCK. A start date plus a task list is the first time this
    // schedule has a finish DATE — the date he is promising. Asked once, here,
    // and only when nothing is locked yet; declining leaves the button in the
    // finish sheet. The locked schedule is `nextSchedule`, not the stale
    // `activeSchedule` (see lockPlan).
    // …and only when the anchor above was actually written: offering to lock a
    // start date the server refused would promise a finish nobody holds.
    if (writePath === 'row' && nextTasks.length > 0 && (activeSchedule.baselines?.length ?? 0) === 0 && finishLabel) {
      showAlert(
        'Lock this as the plan?',
        `Every task now has a date, and the finish is ${finishLabel} — the date you are promising. Lock it, and later the schedule can say how many days behind or ahead of this plan you are, not just how the pace looks.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Lock the plan', onPress: () => lockPlan(nextSchedule) },
        ],
      );
    }
  }, [selectedProject, activeSchedule, updateProject, writePath, auditUser, lockPlan]);

  // Explicit project picker (sim-audit #11): tapping the title used to
  // silently CYCLE through projects — zero affordance, and with several
  // projects it read as "my schedule changed by itself". The chevron now
  // opens a bottom sheet listing every project, current one checked.
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  if (!selectedProject) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <EmptyState
          icon={<FolderOpen size={36} color={colors.accent} strokeWidth={1.75} />}
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
        <TouchableOpacity
          style={{ flex: 1, minWidth: 0 }}
          activeOpacity={0.7}
          onPress={() => { if (projects.length > 1) setShowProjectPicker(true); }}
          disabled={projects.length < 2}
          accessibilityRole="button"
          accessibilityLabel={`Schedule for ${selectedProject.name}. ${projects.length > 1 ? 'Tap to switch project.' : ''}`}
          testID="schedule-project-switcher"
        >
          <View style={styles.titleRow}>
            <Text style={styles.projName} numberOfLines={1}>{selectedProject.name}</Text>
            {projects.length > 1 && <ChevronDown size={18} color={colors.text} strokeWidth={1.75} />}
          </View>
          {!!displayText(selectedProject.location) && <Text style={styles.loc} numberOfLines={1}>{displayText(selectedProject.location)}</Text>}
        </TouchableOpacity>
        {/* MAGE Copilot — the flagship phone-create path: speak the scope, the
            AI asks grounded clarifying questions, then builds the schedule.
            Accent-tinted so it reads as the primary "make one" action. Only shown
            when there's a linked estimate to build from (voice-build needs it)
            AND the job has no tasks yet (#52): on a running schedule this
            one-tap "make one" built a brand-new plan whose Accept replaced the
            live one. A rebuild still exists (Copilot hub, the Schedule tab), and
            schedule-review's Accept now says what a replace loses first. */}
        {hasEstimate && tasks.length === 0 && (
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push(`/copilot?capabilityId=schedule&projectId=${selectedProject.id}`)} accessibilityLabel="Build schedule by voice" testID="open-copilot-schedule">
            <Mic size={19} color={colors.accent} strokeWidth={2} />
          </TouchableOpacity>
        )}
        {/* Jump-to-date and Export both PRINT calendar days. With no anchor
            there are none, so the affordance becomes the fix: it opens the
            start-date picker rather than a month grid drawn from today or an
            .ics that writes drifting dates into the GC's real calendar. */}
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => (isUndated ? setShowStartDatePicker(true) : setShowCalendar(true))}
          accessibilityLabel={isUndated ? UNDATED_SCHEDULE_CTA : 'Jump to date'}
          testID="open-calendar"
        >
          <CalendarDays size={19} color={isUndated ? colors.warningLabel : colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        {/* Import Excel / MS Project schedule. This is the ONLY phone entry to
            the Schedule Import feature — Schedule Pro (its desktop home) shows a
            "best on a bigger screen" redirect on phones, so without this button
            the feature is unreachable on iOS (the primary target). */}
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push(`/schedule-import?projectId=${selectedProject.id}`)} accessibilityLabel="Import schedule" testID="open-schedule-import">
          <FileInput size={19} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => (isUndated ? setShowStartDatePicker(true) : setShowExport(true))}
          accessibilityLabel={isUndated ? UNDATED_SCHEDULE_CTA : 'Export schedule'}
          testID="open-export"
          disabled={tasks.length === 0}
        >
          <Download size={19} color={tasks.length === 0 ? colors.textMuted : isUndated ? colors.warningLabel : colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/notifications-inbox' as never)} accessibilityLabel="Notifications">
          <Bell size={19} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      {/* THE VERDICT LINE. One tap opens what is driving the date and the
          "bring the plan up to date" action. Hidden only when there is no
          schedule to have a verdict about. */}
      {tasks.length > 0 && (
        <TouchableOpacity
          style={[styles.verdictBar, { backgroundColor: colors[verdictToneTokens(verdict.tone).soft] }]}
          activeOpacity={0.8}
          onPress={() => setShowFinishSheet(true)}
          accessibilityRole="button"
          accessibilityLabel={`${verdict.headline}. ${verdict.detail} Tap for what is driving the date.`}
          testID="schedule-verdict-bar"
        >
          <View style={[styles.verdictDot, { backgroundColor: colors[verdictToneTokens(verdict.tone).ink] }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.verdictHeadline, { color: colors[verdictToneTokens(verdict.tone).ink] }]} numberOfLines={2}>
              {verdict.headline}
            </Text>
            {!!verdict.detail && <Text style={styles.verdictDetail} numberOfLines={2}>{verdict.detail}</Text>}
          </View>
          <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
        </TouchableOpacity>
      )}

      <WeekStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <View style={styles.subtabs}>
        {SUBTABS.map(([k, label]) => (
          <TouchableOpacity key={k} style={styles.subtab} onPress={() => setTab(k)}>
            <Text style={[styles.subtabText, tab === k ? { color: colors.accent } : null]}>{label}</Text>
            {tab === k && <View style={[styles.subtabBar, { backgroundColor: colors.accent }]} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* WHAT YOUR ACCESS SAVES (#25). Stated BEFORE he taps, because a
          refusal that only arrives after the edit is the silent-drop bug in a
          politer coat. The card replaces the hint the moment something was
          actually refused, carrying that refusal's own wording. */}
      {writePath === 'none' ? (
        <LockedAccessCard
          what="Schedule editing"
          detail={VIEWER_SCHEDULE_NOTICE}
          style={{ marginHorizontal: 16, marginTop: 10 }}
        />
      ) : writePath === 'row' && rowConflictNotice ? (
        <View style={styles.rowConflict} testID="schedule-row-conflict-notice" accessibilityRole="alert">
          <Text style={styles.rowConflictText}>{rowConflictNotice}</Text>
          <TouchableOpacity onPress={() => setRowConflictNotice(null)} accessibilityRole="button" accessibilityLabel="Dismiss notice" hitSlop={8}>
            <Text style={styles.rowConflictDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : writePath === 'field_rpc' ? (
        fieldNotice ? (
          <LockedAccessCard
            what="Date and task editing"
            detail={fieldNotice}
            style={{ marginHorizontal: 16, marginTop: 10 }}
          />
        ) : (
          <Text style={styles.fieldAccessHint} testID="schedule-field-access-hint">{FIELD_SCHEDULE_HINT}</Text>
        )
      ) : null}
      {writePath === 'field_rpc' && fieldFailureShown ? (
        <FieldSendFailureBanner
          message={fieldFailureShown.message}
          onRetry={fieldFailureShown.retryable ? retryFieldSend : undefined}
          onDismiss={dismissFieldFailure}
          autoRetrying={fieldFailureShown.offline}
          style={{ marginHorizontal: 16, marginTop: 10 }}
        />
      ) : null}
      {scheduleNotice ? (
        <View style={styles.rowConflict} testID="schedule-snap-notice" accessibilityRole="alert">
          <Text style={styles.rowConflictText}>{scheduleNotice}</Text>
          <TouchableOpacity onPress={() => setScheduleNotice(null)} accessibilityRole="button" accessibilityLabel="Dismiss notice" hitSlop={8}>
            <Text style={styles.rowConflictDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Legacy day-scale disclosure. Renders null for every schedule that is
          fine. Sits with the undated banner because both are statements about
          the schedule as a whole, not about one tab. */}
      <StartDayBasisNotice
        preview={startDayBasisPreview}
        projectStartDate={anchor.dated && anchor.iso ? (parseCalendarDay(anchor.iso) ?? null) : null}
        onAnswer={answerStartDayBasis}
        style={{ marginHorizontal: 16, marginTop: 10 }}
      />

      {/* SCHED-NO-ANCHOR: say it, don't invent it. Rendered above the sub-tab
          content so it is present on Schedule, Living Plan, Progress and Team — the
          undated-ness is a property of the schedule, not of one tab. */}
      {isUndated && (
        <TouchableOpacity
          style={styles.undatedBanner}
          activeOpacity={0.8}
          onPress={() => setShowStartDatePicker(true)}
          accessibilityRole="button"
          accessibilityLabel={`${UNDATED_SCHEDULE_TITLE}. ${UNDATED_SCHEDULE_CTA}.`}
          testID="schedule-undated-banner"
        >
          <CalendarOff size={16} color={colors.warningLabel} strokeWidth={1.9} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.undatedTitle}>{UNDATED_SCHEDULE_TITLE}</Text>
            <Text style={styles.undatedBody}>{UNDATED_SCHEDULE_BODY}</Text>
          </View>
          <Text style={styles.undatedCta}>{UNDATED_SCHEDULE_CTA}</Text>
        </TouchableOpacity>
      )}

      {tab === 'schedule' ? (
        tasks.length === 0 ? (
          hasEstimate ? (
            <EmptyState
              icon={<Mic size={36} color={colors.accent} strokeWidth={1.75} />}
              title="No schedule yet"
              message="Say the scope out loud — MAGE asks a few grounded questions, then builds the schedule for you. Or add work packages by hand."
              actionLabel="Build by voice"
              onAction={() => router.push(`/copilot?capabilityId=schedule&projectId=${selectedProject.id}`)}
              secondaryLabel="Add manually"
              onSecondaryAction={() => setShowAdd(true)}
            />
          ) : (
            <EmptyState
              icon={<FolderOpen size={36} color={colors.accent} strokeWidth={1.75} />}
              title="No schedule yet"
              message="Add work packages to start building the schedule. Add an estimate first to build it by voice."
              actionLabel="New Work Package"
              onAction={() => setShowAdd(true)}
            />
          )
        ) : (
          <>
            {/* The timeline is a CALENDAR drawing — its columns are dates and
                its today-line is a date. With no anchor every column would be
                counted off from today, so the toggle is withheld and the list
                (which can honestly print 'Day 6 – 10') is the only view. */}
            {!isUndated && (
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
            )}
            {isUndated || scheduleView === 'list' ? (
              <MobileScheduleList
                tasks={tasks}
                startDate={anchor.iso}
                workingDaysPerWeek={activeSchedule?.workingDaysPerWeek}
                nonWorkingDates={activeSchedule?.nonWorkingDates}
                placements={placements}
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
                startDate={anchor.iso ?? anchor.unanchoredPreviewIso}
                workingDaysPerWeek={activeSchedule?.workingDaysPerWeek}
                nonWorkingDates={activeSchedule?.nonWorkingDates}
                placements={placements}
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
        // previewStartDate + the banner above: ProgressTab's milestone column
        // still prints a calendar day. It should take `string | null` and
        // print `taskWorkingDayLabel` when undated — see the wave report.
        <ProgressTab
          tasks={tasks}
          startDate={previewStartDate}
          workingDaysPerWeek={activeSchedule?.workingDaysPerWeek}
          nonWorkingDates={activeSchedule?.nonWorkingDates}
          // "% complete" without a date answers half the question. The same
          // verdict the header carries leads this tab, computed once above.
          verdict={verdict}
          finishDateLabel={finishDateLabel}
          onPressVerdict={() => setShowFinishSheet(true)}
        />
      ) : tab === 'team' ? (
        <TeamTab tasks={tasks} onPressTask={setDetailTask} />
      ) : (
        <LivingFloorPlanContainer project={selectedProject} onShowEditor={() => setShowZoneEditor(true)} />
      )}

      <TaskDetailSheet
        visible={!!detailTask}
        task={detailTask}
        allTasks={tasks}
        startDate={anchor.iso}
        workingDaysPerWeek={activeSchedule?.workingDaysPerWeek}
        nonWorkingDates={activeSchedule?.nonWorkingDates}
        onClose={() => setDetailTask(null)}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        writePath={writePath}
        // The list row's own placement (#88): the sheet prints and steps from
        // the engine's dates, not the stored pin.
        placements={placements}
      />
      <AddTaskModal visible={showAdd} onCancel={() => { setShowAdd(false); setAddPrefillDate(undefined); }} onCreate={onCreate} tasks={tasks} defaultStartDate={addPrefillDate} />

      <ProjectPickerSheet
        visible={showProjectPicker}
        projects={projects}
        selectedProjectId={selectedProject.id}
        onSelect={(id) => { setSelectedProjectId(id); setShowProjectPicker(false); }}
        onClose={() => setShowProjectPicker(false)}
      />

      <MonthCalendarSheet
        visible={showCalendar && !isUndated}
        selectedDate={selectedDate}
        tasks={tasks}
        startDateIso={anchor.iso ?? anchor.unanchoredPreviewIso}
        workingDaysPerWeek={activeSchedule?.workingDaysPerWeek}
        nonWorkingDates={activeSchedule?.nonWorkingDates}
        onSelect={setSelectedDate}
        onClose={() => setShowCalendar(false)}
      />

      <FinishDateSheet
        visible={showFinishSheet}
        onClose={() => setShowFinishSheet(false)}
        verdict={verdict}
        finishDateLabel={finishDateLabel}
        tasks={tasks}
        cpm={reportCpm}
        anchorDate={anchor.date}
        workingDaysPerWeek={activeSchedule?.workingDaysPerWeek}
        nonWorkingDates={activeSchedule?.nonWorkingDates}
        catchUp={catchUp}
        hasDataDate={todayCalendarIndex != null}
        // A blocked control says why: on field / view-only access the two
        // whole-plan buttons are disabled with the reason on them, not left
        // live to fail after the tap (#25).
        writeBlockedReason={wholePlanWriteBlocked}
        onSetStartDate={() => { setShowFinishSheet(false); setShowStartDatePicker(true); }}
        onApplyCatchUp={applyCatchUp}
        onPressTask={(t) => { setShowFinishSheet(false); setDetailTask(t); }}
        activeBaseline={activeBaseline}
        baselineFinishLabel={baselineFinishLabel}
        onLockPlan={requestLockPlan}
        // Close first, then open: presenting a second Modal over a dismissing
        // one is the iOS stacking bug (same order as onSetStartDate).
        onShowHistory={() => { setShowFinishSheet(false); setShowHistory(true); }}
      />

      <ScheduleAuditModal
        visible={showHistory}
        projectId={selectedProject.id}
        onClose={() => setShowHistory(false)}
      />

      <ExportCenterSheet
        visible={showExport && !isUndated}
        onClose={() => setShowExport(false)}
        project={selectedProject}
        tasks={tasks}
        startDateIso={anchor.iso ?? anchor.unanchoredPreviewIso}
        cpm={reportCpm}
        // The ACTIVE named baseline first — the one the verdict measures slip
        // from. The legacy singular `baseline` stores an exclusive endDay
        // (startDay + duration) that the report reads as inclusive; it stays
        // only as the fallback for a schedule locked before baselines[].
        baseline={activeBaseline ?? activeSchedule?.baseline ?? null}
        canLockPlan={!activeBaseline && tasks.length > 0}
        onLockPlan={() => { setShowExport(false); requestLockPlan(); }}
        nonWorkingDates={activeSchedule?.nonWorkingDates}
        onExportIcal={() => { void exportScheduleIcal({ project: selectedProject }); }}
      />

      {/* The one place an anchor is chosen on the phone. allowFuture: a
          schedule almost always starts on a future or past real day, and the
          picker blocks the future by default. */}
      <DatePickerModal
        visible={showStartDatePicker}
        value={anchor.iso ?? ''}
        title="Schedule start date"
        allowFuture
        onClose={() => setShowStartDatePicker(false)}
        onChange={(iso) => applyStartDate(iso.slice(0, 10))}
      />

      {/* Living Floor Plan zone editor (full-screen modal) */}
      <Modal visible={showZoneEditor} animationType="slide" onRequestClose={() => setShowZoneEditor(false)}>
        {(() => {
          const planSheets = getPlanSheetsForProject(selectedProject.id).filter((s) => !s.superseded);
          const firstSheet = planSheets[0] ?? null;
          if (!firstSheet) return null;
          return (
            <PlanZoneEditor
              project={selectedProject}
              planSheetId={firstSheet.id}
              imageUri={firstSheet.imageUri}
              imageW={firstSheet.width}
              imageH={firstSheet.height}
              onClose={() => setShowZoneEditor(false)}
            />
          );
        })()}
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// FinishDateSheet — "when do we finish, who is driving it, and what happens if
// I bring the plan up to date?"
//
// Three sections, in the order a GC asks them:
//   1. the date, and the verdict about it;
//   2. the critical chain — "who is driving my date" is one tap, not a laptop;
//   3. the catch-up, previewed BEFORE it is written (finish before → after),
//      and disabled with its reason on an undated schedule, where there is no
//      today to catch up to.
// ---------------------------------------------------------------------------

function FinishDateSheet({
  visible, onClose, verdict, finishDateLabel, tasks, cpm, anchorDate,
  workingDaysPerWeek, nonWorkingDates, catchUp, hasDataDate, writeBlockedReason,
  onSetStartDate, onApplyCatchUp, onPressTask,
  activeBaseline, baselineFinishLabel, onLockPlan, onShowHistory,
}: {
  visible: boolean;
  onClose: () => void;
  verdict: PacedVerdict;
  finishDateLabel: string;
  tasks: ScheduleTask[];
  cpm: CpmResult;
  anchorDate: Date | null;
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
  catchUp: CatchUpPlan | null;
  hasDataDate: boolean;
  /** Why this access cannot re-date or lock the plan, or null when it can. */
  writeBlockedReason: string | null;
  onSetStartDate: () => void;
  onApplyCatchUp: () => void;
  onPressTask: (task: ScheduleTask) => void;
  activeBaseline: NamedBaseline | null;
  baselineFinishLabel: string | null;
  onLockPlan: () => void;
  onShowHistory: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const chain = useMemo(
    () => cpm.criticalPath
      .map((id) => byId.get(id))
      .filter((t): t is ScheduleTask => !!t)
      .sort((a, b) => (a.startDay ?? 1) - (b.startDay ?? 1)),
    [cpm.criticalPath, byId],
  );

  /** The finish the catch-up would produce. Computed only while the sheet is
   *  open — it is a second full CPM run, and the schedule surface already runs
   *  one on every render. */
  const afterFinishLabel = useMemo(() => {
    if (!visible || !catchUp || catchUp.changes.length === 0 || !anchorDate) return null;
    const after = runCpm(catchUp.tasks, {
      scheduleStartDate: anchorDate ? toCalendarDayString(anchorDate) : undefined,
      workingDaysPerWeek,
      nonWorkingDates,
    });
    if (after.projectFinish <= 0) return null;
    return calendarDayToDate(anchorDate, after.projectFinish)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, [visible, catchUp, anchorDate, workingDaysPerWeek, nonWorkingDates]);

  const behindCount = catchUp?.behindIds.length ?? 0;
  const changeCount = catchUp?.changes.length ?? 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 16 }]} testID="schedule-finish-sheet">
        <View style={styles.pickerGrab} />
        <View style={styles.pickerHead}>
          <Text style={styles.pickerTitle}>Finish date</Text>
          <TouchableOpacity onPress={onClose} style={styles.pickerClose} accessibilityRole="button" accessibilityLabel="Close">
            <X size={18} color={colors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          <View style={[styles.finishHero, { backgroundColor: colors[verdictToneTokens(verdict.tone).soft] }]}>
            <Text style={[styles.finishDate, { color: colors[verdictToneTokens(verdict.tone).ink] }]}>
              {finishDateLabel === '—' ? 'No finish date' : finishDateLabel}
            </Text>
            <Text style={styles.finishVerdict}>{verdict.headline}</Text>
            {!!verdict.detail && <Text style={styles.finishDetail}>{verdict.detail}</Text>}
          </View>

          <Text style={styles.section}>WHAT IS DRIVING THE DATE</Text>
          <View style={styles.finishCard}>
            {chain.length === 0 ? (
              <Text style={styles.finishEmpty}>
                No critical chain yet — link the work packages that have to happen in order and the driver appears here.
              </Text>
            ) : chain.map((t, i) => {
              // Undated schedules print the WORKING-DAY number instead of a
              // date. Nothing here invents an anchor (THE anchor rule).
              const label = anchorDate
                ? taskCalendarRange(t, anchorDate, workingDaysPerWeek, nonWorkingDates).end
                    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : `Day ${t.startDay + Math.max(0, (t.durationDays || 1) - 1)}`;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.prowRow, i > 0 ? styles.rowDivider : null]}
                  activeOpacity={0.7}
                  onPress={() => onPressTask(t)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.title}, ends ${label}. Open task.`}
                  testID={`finish-driver-${t.id}`}
                >
                  <Flag size={14} color={colors.accent} strokeWidth={2} />
                  <Text style={styles.prowName} numberOfLines={1}>{t.title}</Text>
                  <Text style={styles.prowMeta}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.section}>BRING THE PLAN UP TO DATE</Text>
          <View style={styles.finishCard}>
            {!hasDataDate ? (
              <>
                {/* A blocked button says why, and offers the one fix. */}
                <Text style={styles.finishEmpty}>
                  {UNDATED_SCHEDULE_TITLE}, so there is no “today” to catch up to — day numbers alone cannot say what is late.
                </Text>
                <TouchableOpacity
                  style={[styles.finishBtn, styles.finishBtnDisabled]}
                  disabled
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  accessibilityLabel={`Bring the plan up to date. Unavailable: ${UNDATED_SCHEDULE_TITLE}.`}
                  testID="catch-up-disabled"
                >
                  <RefreshCw size={16} color={colors.textMuted} strokeWidth={2} />
                  <Text style={[styles.finishBtnText, { color: colors.textMuted }]}>Bring the plan up to date</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.finishLink}
                  activeOpacity={0.7}
                  onPress={onSetStartDate}
                  accessibilityRole="button"
                  accessibilityLabel={UNDATED_SCHEDULE_CTA}
                  testID="catch-up-set-start-date"
                >
                  <Text style={styles.finishLinkText}>{UNDATED_SCHEDULE_CTA}</Text>
                </TouchableOpacity>
              </>
            ) : writeBlockedReason ? (
              <>
                {/* The same shape as the undated refusal: the reason, then the
                    button it applies to, disabled and labelled with it. */}
                <Text style={styles.finishEmpty}>{writeBlockedReason}</Text>
                <TouchableOpacity
                  style={[styles.finishBtn, styles.finishBtnDisabled]}
                  disabled
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  accessibilityLabel={`Bring the plan up to date. Unavailable: ${writeBlockedReason}`}
                  testID="catch-up-blocked-by-access"
                >
                  <RefreshCw size={16} color={colors.textMuted} strokeWidth={2} />
                  <Text style={[styles.finishBtnText, { color: colors.textMuted }]}>Bring the plan up to date</Text>
                </TouchableOpacity>
              </>
            ) : changeCount === 0 ? (
              <Text style={styles.finishEmpty}>
                Nothing is behind as of today — the plan already matches the field.
              </Text>
            ) : (
              <>
                <Text style={styles.finishBody}>
                  {behindCount > 0
                    ? `${behindCount} task${behindCount === 1 ? '' : 's'} still owe${behindCount === 1 ? 's' : ''} work that should already be done.`
                    : 'Work downstream of what has actually happened has not been re-dated yet.'}
                  {' '}Starting what is left today moves {changeCount} task{changeCount === 1 ? '' : 's'}
                  {afterFinishLabel && finishDateLabel !== '—'
                    ? ` and the finish ${finishDateLabel} → ${afterFinishLabel}.`
                    : '.'}
                </Text>
                <Text style={styles.finishNote}>
                  Finished work keeps its actual dates. Nothing is ever pulled earlier.
                </Text>
                <TouchableOpacity
                  style={styles.finishBtn}
                  activeOpacity={0.85}
                  onPress={onApplyCatchUp}
                  accessibilityRole="button"
                  accessibilityLabel="Bring the plan up to date"
                  testID="catch-up-apply"
                >
                  <RefreshCw size={16} color={colors.accentLabel} strokeWidth={2} />
                  <Text style={styles.finishBtnText}>Bring the plan up to date</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* THE PLAN THIS IS MEASURED AGAINST. Without a lock there is no
              "behind plan", only pace — this is where the phone gets one. */}
          <Text style={styles.section}>THE PLAN YOU ARE MEASURED AGAINST</Text>
          <View style={styles.finishCard}>
            {!hasDataDate ? (
              <>
                {/* A blocked button says why. */}
                <Text style={styles.finishEmpty}>
                  {UNDATED_SCHEDULE_TITLE}, so there is no finish date to lock as the plan yet.
                </Text>
                <TouchableOpacity
                  style={[styles.finishBtn, styles.finishBtnDisabled]}
                  disabled
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  accessibilityLabel={`Lock this plan as the baseline. Unavailable: ${UNDATED_SCHEDULE_TITLE}.`}
                  testID="lock-plan-disabled"
                >
                  <Lock size={16} color={colors.textMuted} strokeWidth={2} />
                  <Text style={[styles.finishBtnText, { color: colors.textMuted }]}>Lock this plan as the baseline</Text>
                </TouchableOpacity>
              </>
            ) : writeBlockedReason ? (
              <>
                <Text style={styles.finishEmpty}>{writeBlockedReason}</Text>
                <TouchableOpacity
                  style={[styles.finishBtn, styles.finishBtnDisabled]}
                  disabled
                  accessibilityRole="button"
                  accessibilityState={{ disabled: true }}
                  accessibilityLabel={`Lock this plan as the baseline. Unavailable: ${writeBlockedReason}`}
                  testID="lock-plan-blocked-by-access"
                >
                  <Lock size={16} color={colors.textMuted} strokeWidth={2} />
                  <Text style={[styles.finishBtnText, { color: colors.textMuted }]}>Lock this plan as the baseline</Text>
                </TouchableOpacity>
                {!!activeBaseline && (
                  <Text style={styles.finishNote}>
                    {`${activeBaseline.name}, locked ${new Date(activeBaseline.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    {baselineFinishLabel ? ` — planned finish ${baselineFinishLabel}.` : '.'}
                  </Text>
                )}
              </>
            ) : !activeBaseline ? (
              <>
                <Text style={styles.finishBody}>
                  No plan is locked, so this schedule can only read pace — it cannot say how many days behind or ahead of plan you are.
                </Text>
                <Text style={styles.finishNote}>
                  Locking records every task’s dates{finishDateLabel !== '—' ? ` and the ${finishDateLabel} finish` : ''} as the plan later dates are compared with.
                </Text>
                <TouchableOpacity
                  style={styles.finishBtn}
                  activeOpacity={0.85}
                  onPress={onLockPlan}
                  accessibilityRole="button"
                  accessibilityLabel="Lock this plan as the baseline"
                  testID="lock-plan"
                >
                  <Lock size={16} color={colors.accentLabel} strokeWidth={2} />
                  <Text style={styles.finishBtnText}>Lock this plan as the baseline</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.finishBody}>
                  {`${activeBaseline.name}, locked ${new Date(activeBaseline.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                  {baselineFinishLabel ? ` — planned finish ${baselineFinishLabel}.` : '.'}
                </Text>
                <TouchableOpacity
                  style={styles.finishLink}
                  activeOpacity={0.7}
                  onPress={onLockPlan}
                  accessibilityRole="button"
                  accessibilityLabel="Re-lock with today's plan"
                  testID="relock-plan"
                >
                  <Text style={styles.finishLinkAccent}>Re-lock with today’s plan</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          <TouchableOpacity
            style={[styles.prowRow, styles.historyRow]}
            activeOpacity={0.7}
            onPress={onShowHistory}
            accessibilityRole="button"
            accessibilityLabel="Schedule history. Every change, who made it, and when."
            testID="open-schedule-history"
          >
            <History size={16} color={colors.textSecondary} strokeWidth={2} />
            <Text style={styles.prowName}>Schedule history</Text>
            <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ProjectPickerSheet — explicit "switch project" bottom sheet (the app's
// sheet idiom: backdrop + grab handle + slide-up panel, same as
// MonthCalendarSheet). Replaces the old tap-to-cycle title behavior.
// ---------------------------------------------------------------------------

function ProjectPickerSheet({ visible, projects, selectedProjectId, onSelect, onClose }: {
  visible: boolean;
  projects: Project[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const pick = (id: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    onSelect(id);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 16 }]} testID="schedule-project-picker">
        <View style={styles.pickerGrab} />
        <View style={styles.pickerHead}>
          <Text style={styles.pickerTitle}>Switch project</Text>
          <TouchableOpacity onPress={onClose} style={styles.pickerClose} accessibilityRole="button" accessibilityLabel="Close">
            <X size={18} color={colors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {projects.map((p, i) => {
            const active = p.id === selectedProjectId;
            const taskCount = p.schedule?.tasks?.length ?? 0;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.pickerRow, i > 0 ? styles.pickerRowDivider : null]}
                activeOpacity={0.7}
                onPress={() => pick(p.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`schedule-pick-project-${p.id}`}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.pickerRowName, active ? { color: colors.accent } : null]} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.pickerRowMeta} numberOfLines={1}>
                    {taskCount > 0 ? `${taskCount} task${taskCount === 1 ? '' : 's'}` : 'No schedule yet'}
                    {displayText(p.location) ? ` · ${displayText(p.location)}` : ''}
                  </Text>
                </View>
                {active && <Check size={18} color={colors.accent} strokeWidth={2.2} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Living Floor Plan container — resolves the first non-superseded plan sheet
// for the project and wires the LivingFloorPlan component.
// ---------------------------------------------------------------------------

function LivingFloorPlanContainer({
  project,
  onShowEditor,
}: {
  project: Project;
  onShowEditor: () => void;
}) {
  const router = useRouter();
  const {
    getPlanSheetsForProject,
    getPlanZonesForProject,
    getPinsForPlan,
    getPhotosForProject,
    settings,
  } = useProjects();

  const planSheets = getPlanSheetsForProject(project.id).filter((s) => !s.superseded);
  const firstSheet = planSheets[0] ?? null;

  const zones = getPlanZonesForProject(project.id).filter(
    (z) => firstSheet ? z.planSheetId === firstSheet.id : false,
  );
  const pins = firstSheet ? getPinsForPlan(firstSheet.id) : [];
  const photos = getPhotosForProject(project.id);
  const photoById = (photoId: string) => { const p = photos.find((ph) => ph.id === photoId); return p ? { uri: p.uri, createdAt: p.createdAt } : undefined; };

  // Hand the homeowner a link to their own floor plan. Same magic-link idiom
  // as "Share photo timeline" on project-detail: a client-safe payload
  // (buildPlanSharePayload strips everything internal) base64'd into the URL,
  // no login for the recipient. See utils/planShareToken.ts.
  const handleShare = useCallback(async () => {
    if (!firstSheet) {
      showAlert('Share floor plan', 'Add a floor plan first, then draw the rooms you want your client to see.');
      return;
    }
    if (zones.length === 0) {
      showAlert('Share floor plan', 'Draw at least one zone (tap "Edit zones") so there’s something for your client to watch fill in.');
      return;
    }
    const { buildPlanSharePayload, encodePlanShareToken, PLAN_SHARE_MAX_PHOTOS } =
      await import('@/utils/planShareToken');
    const { payload, droppedLocal, droppedExcess, planNotSynced } = buildPlanSharePayload({
      projectName: project.name ?? 'Project',
      gcName: settings?.branding?.companyName,
      scheduleStartDate: project.schedule?.startDate,
      sheet: firstSheet,
      zones,
      tasks: project.schedule?.tasks ?? [],
      pins,
      photos,
    });
    if (planNotSynced) {
      showAlert('Share floor plan', 'This plan hasn’t synced yet, so the link would open blank. Wait until the offline-sync pill shows "Synced," then try again.');
      return;
    }
    const token = encodePlanShareToken(payload);
    const url = buildShareUrl('shared-plan', token,
      Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null);
    const ok = await (await import('@/utils/clipboard')).copyToClipboard(url);
    const extras: string[] = [];
    if (droppedLocal > 0) extras.push(`${droppedLocal} photo${droppedLocal === 1 ? '' : 's'} skipped (not yet synced)`);
    if (droppedExcess > 0) extras.push(`oldest ${droppedExcess} trimmed (cap ${PLAN_SHARE_MAX_PHOTOS})`);
    const detail = extras.length > 0 ? `\n\n${extras.join(' · ')}` : '';
    if (ok) {
      showAlert('Floor plan link copied', `Paste it into a text or email. Your client sees rooms, trades, and photos — never costs or task detail.${detail}`);
    } else {
      showAlert('Floor plan link', `${url}${detail}`);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [firstSheet, zones, project, settings?.branding?.companyName, pins, photos]);

  return (
    <LivingFloorPlan
      tasks={project.schedule?.tasks ?? []}
      scheduleStartDate={project.schedule?.startDate}
      workingDaysPerWeek={project.schedule?.workingDaysPerWeek}
      nonWorkingDates={project.schedule?.nonWorkingDates}
      planSheetId={firstSheet?.id ?? ''}
      zones={zones}
      pins={pins}
      photoById={photoById}
      imageUri={firstSheet?.imageUri ?? ''}
      imageW={firstSheet?.width}
      imageH={firstSheet?.height}
      onEdit={onShowEditor}
      onShare={() => { void handleShare(); }}
      onAddPlan={() => router.push('/plans' as never)}
    />
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
  // Verdict strip — the finish date + "are we behind", directly under the
  // project name. Tinted by tone from the theme's label/soft pairs.
  verdictBar: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9,
    marginHorizontal: 16, marginTop: 2, marginBottom: 2,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: Tokens.radius.md,
  },
  verdictDot: { width: 8, height: 8, borderRadius: Tokens.radius.full },
  verdictHeadline: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  verdictDetail: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginTop: 2 },
  // Finish-date sheet
  finishHero: { borderRadius: Tokens.radius.lg, padding: 14, marginBottom: 16 },
  finishDate: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, letterSpacing: -0.5 },
  finishVerdict: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text, marginTop: 4 },
  finishDetail: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginTop: 3 },
  section: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 },
  // cardSurface, not a hand-rolled recipe (validate-ui-adoption's ratchet):
  // one definition of what a card looks like, squircle corners included.
  finishCard: { ...cardSurface(t, { radius: 'lg', pad: 14 }), marginBottom: 16 },
  finishEmpty: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontWeight: '600' as const },
  finishBody: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const, lineHeight: 19 },
  finishNote: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const, marginTop: 6 },
  finishBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    marginTop: 12, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: t.accentSoft,
  },
  finishBtnDisabled: { backgroundColor: t.surfaceAlt },
  finishBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.accentLabel },
  finishLink: { alignItems: 'center' as const, paddingVertical: 10 },
  finishLinkText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.warningLabel },
  finishLinkAccent: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accentLabel },
  historyRow: { paddingHorizontal: 4, marginBottom: 8 },
  prowRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 9, paddingVertical: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  prowName: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  prowMeta: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  // Undated-schedule disclosure. Warning-tinted, not danger: nothing is
  // broken, a field is missing and one tap fills it in.
  undatedBanner: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    marginHorizontal: 16, marginTop: 10, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md, backgroundColor: t.warningSoft,
  },
  // The standing field-access line. Muted, not a warning: field access is a
  // setting the GC turned on, not a fault (LockedAccessCard's tone).
  rowConflict: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10,
    marginHorizontal: 16, marginTop: 10, padding: 10,
    borderRadius: Tokens.radius.sm, backgroundColor: t.warningSoft,
  },
  rowConflictText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.warningLabel },
  rowConflictDismiss: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },
  fieldAccessHint: {
    fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textMuted,
    marginHorizontal: 16, marginTop: 10, lineHeight: 17,
  },
  undatedTitle: { fontSize: 13.5, fontWeight: '800' as const, color: t.warningLabel },
  undatedBody: { fontSize: 12, fontWeight: '600' as const, color: t.textSecondary, marginTop: 2 },
  undatedCta: { fontSize: 12.5, fontWeight: '800' as const, color: t.warningLabel },
  // Project picker sheet (idiom shared with MonthCalendarSheet)
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 16 },
  pickerGrab: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginBottom: 12 },
  pickerHead: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: 4 },
  pickerTitle: { flex: 1, fontSize: 17, fontWeight: '800' as const, color: t.text },
  pickerClose: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 17, backgroundColor: t.surfaceAlt },
  pickerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 13 },
  pickerRowDivider: { borderTopWidth: 1, borderTopColor: t.line },
  pickerRowName: { fontSize: 15, fontWeight: '700' as const, color: t.text },
  pickerRowMeta: { fontSize: 12, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
});
