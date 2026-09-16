import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Platform } from 'react-native';
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
import type { Project, ProjectSchedule, ScheduleAuditEntry, ScheduleTask } from '@/types';
import { appendAuditToAsyncStorage, buildAuditEntry, summarizeTaskDiff } from '@/utils/scheduleAudit';
import { ScheduleAuditModal } from '@/components/schedule/ScheduleAuditModal';
import { buildScheduleFromTasks, mergeEditedSchedule, createId } from '@/utils/scheduleEngine';
import { stampActuals, todayScheduleDay } from '@/utils/pace/stampActuals';
import { recordDidForYou } from '@/utils/brain/didForYou';
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
  captureBaseline, applyBaselineToTasks,
  baselineFinishDayWorkingScale, finishDriverTitle, pacedScheduleVerdict, planCatchUpToToday,
  taskCalendarRange,
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
    updateProject,
    getPlanSheetsForProject,
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
  const activeBaseline = useMemo<NamedBaseline | null>(() => {
    const list = activeSchedule?.baselines;
    if (!list || list.length === 0) return null;
    // Cast at the boundary, as types/index.ts documents: ProjectSchedule stores
    // baselines structurally to avoid a circular type import.
    return list[list.length - 1] as unknown as NamedBaseline;
  }, [activeSchedule?.baselines]);
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
    if (auditDraft) void appendAuditToAsyncStorage(selectedProject.id, buildAuditEntry(auditDraft));
  }, [selectedProject, activeSchedule, updateProject, anchor.date, auditUser]);

  const onUpdateTask = useCallback((next: ScheduleTask) => {
    // Pace flywheel: this is a full-object sink — `next` spreads the previous
    // task, so it already carries any existing actuals. The stamp (computed
    // from the PREVIOUS task + the NEW status) only adds fields that were
    // unset, so merging it over `next` never overwrites history.
    const prev = tasks.find((t) => t.id === next.id);
    let stamped: ScheduleTask = next;
    if (prev && next.status !== prev.status) {
      const stamp = stampActuals(prev, next.status, todayScheduleDay(activeSchedule?.startDate), new Date().toISOString());
      stamped = { ...next, ...stamp };
      // Morning-brief ledger: a real capture (stamp set an ISO date) is a
      // did-for-you moment. recordDidForYou is G4-safe by contract.
      if (stamp.actualStartDate != null || stamp.actualEndDate != null) {
        recordDidForYou(`Auto-stamped actual dates for ${prev.title}`, selectedProject?.id);
      }
    }
    saveTasks(tasks.map((t) => (t.id === stamped.id ? stamped : t)));
    setDetailTask(stamped);
  }, [tasks, saveTasks, activeSchedule?.startDate, selectedProject?.id]);

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
  }, [catchUp, tasks, saveTasks]);

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
      schedule: {
        ...schedule,
        projectId: selectedProject.id,
        tasks: applyBaselineToTasks(schedule.tasks, snap),
        baselines: [...existing, snap],
        updatedAt: new Date().toISOString(),
      },
    });
    const finishLabel = cpm.projectFinish > 0
      ? calendarDayToDate(planAnchor.date, cpm.projectFinish)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    void appendAuditToAsyncStorage(selectedProject.id, buildAuditEntry({
      user: auditUser,
      kind: 'baseline_capture',
      summary: `Locked the plan as baseline ${snap.name}${finishLabel ? ` — finish ${finishLabel}` : ''}`,
    }));
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [selectedProject, updateProject, auditUser]);

  /** The sheet's button. A first lock is the obvious act; a RE-lock moves the
   *  yardstick every later "behind plan" is measured from, so it asks first. */
  const requestLockPlan = useCallback(() => {
    if (!activeSchedule) return;
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
  }, [activeSchedule, activeBaseline, lockPlan]);

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
    void appendAuditToAsyncStorage(selectedProject.id, buildAuditEntry({
      user: auditUser,
      kind: 'reflow',
      summary: `Start date ${activeSchedule.startDate ? `moved ${activeSchedule.startDate} → ${iso}` : `set to ${iso}`}${finishLabel ? ` — finish ${finishLabel}` : ''}`,
    }));
    // THE MOMENT TO LOCK. A start date plus a task list is the first time this
    // schedule has a finish DATE — the date he is promising. Asked once, here,
    // and only when nothing is locked yet; declining leaves the button in the
    // finish sheet. The locked schedule is `nextSchedule`, not the stale
    // `activeSchedule` (see lockPlan).
    if (nextTasks.length > 0 && (activeSchedule.baselines?.length ?? 0) === 0 && finishLabel) {
      showAlert(
        'Lock this as the plan?',
        `Every task now has a date, and the finish is ${finishLabel} — the date you are promising. Lock it, and later the schedule can say how many days behind or ahead of this plan you are, not just how the pace looks.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Lock the plan', onPress: () => lockPlan(nextSchedule) },
        ],
      );
    }
  }, [selectedProject, activeSchedule, updateProject, auditUser, lockPlan]);

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
            when there's a linked estimate to build from (voice-build needs it). */}
        {hasEstimate && (
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
  workingDaysPerWeek, nonWorkingDates, catchUp, hasDataDate,
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
