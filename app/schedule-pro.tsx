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
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Zap, Activity, Share2, Undo2, Redo2, Columns, Table2, BarChart2, Sparkles, RefreshCcw, Bookmark, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import GridPane from '@/components/schedule/GridPane';
import InteractiveGantt from '@/components/schedule/InteractiveGantt';
import AIAssistantPanel from '@/components/schedule/AIAssistantPanel';
import { runCpm, type CpmResult } from '@/utils/cpm';
import { buildScheduleFromTasks, createId, generateWbsCodes } from '@/utils/scheduleEngine';
import { seedDemoSchedule } from '@/utils/demoSchedule';
import {
  reflowFromActuals,
  captureBaseline,
  applyBaselineToTasks,
  diffAgainstBaseline,
  exportTasksToCsv,
  downloadCsvInBrowser,
  encodeShareToken,
  buildSharePayload,
  type NamedBaseline,
} from '@/utils/scheduleOps';
import type { ScheduleTask, ProjectSchedule } from '@/types';

// Desktop/tablet-landscape breakpoint. Below this we send users to the
// classic mobile experience — the grid is genuinely unusable under 900px.
const GRID_BREAKPOINT = 900;
// Above this we auto-open the split view (grid + gantt side by side). Below,
// we default to grid alone because 1200px of timeline next to a 1170px grid
// means the gantt gets ~30px of width — useless.
const SPLIT_BREAKPOINT = 1600;

type PaneMode = 'grid' | 'split' | 'gantt';

export default function ScheduleProScreen() {
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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const { projects, updateProject } = useProjects();

  const project = useMemo(
    () => projects.find(p => p.id === projectId) ?? null,
    [projects, projectId],
  );

  // Local working copy so the grid feels instant; we debounce persistence.
  // This is where Phase 4's undo stack will live.
  const [workingTasks, setWorkingTasks] = useState<ScheduleTask[]>(
    project?.schedule?.tasks ?? [],
  );
  const [history, setHistory] = useState<ScheduleTask[][]>([]);
  const [future, setFuture] = useState<ScheduleTask[][]>([]);

  // Pane mode: which view(s) to render. Defaults based on width; user can
  // override via the segmented control in the header.
  const [paneMode, setPaneMode] = useState<PaneMode>(() =>
    width >= SPLIT_BREAKPOINT ? 'split' : 'grid',
  );

  // AI assistant drawer (right-side slide-out).
  const [showAI, setShowAI] = useState(false);

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
    setWorkingTasks(project?.schedule?.tasks ?? []);
    setHistory([]);
    setFuture([]);
    setNamedBaselines((project?.schedule?.baselines ?? []) as NamedBaseline[]);
  }, [project?.id]);

  // Mirror baselines into the ref used by schedulePersist. Without this, the
  // next debounced write sees the stale list and silently drops captures.
  useEffect(() => {
    baselinesRef.current = namedBaselines;
  }, [namedBaselines]);

  // -------------------------------------------------------------------------
  // CPM + persistence
  // -------------------------------------------------------------------------

  const cpm: CpmResult = useMemo(() => runCpm(workingTasks), [workingTasks]);

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
  const schedulePersist = useCallback((tasks: ScheduleTask[]) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      if (!project) return;
      const newSchedule = buildScheduleFromTasks(
        project.schedule?.name ?? project.name ?? 'Schedule',
        project.id,
        tasks,
        project.schedule?.baseline ?? null,
      );
      // Preserve named baselines across debounced writes — `buildScheduleFromTasks`
      // rebuilds a fresh schedule object, so without this spread the baselines
      // column would silently vanish on the next keystroke.
      const withBaselines = { ...newSchedule, baselines: baselinesRef.current };
      console.log('[ScheduleProScreen] Persist', {
        tasks: tasks.length,
        baselines: baselinesRef.current.length,
      });
      updateProject(project.id, { schedule: withBaselines });
    }, 500);
  }, [project, updateProject]);

  // Flush on unmount so we never lose an edit to a pending timer.
  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        // One final sync using the latest working copy.
        if (project) {
          const newSchedule = buildScheduleFromTasks(
            project.schedule?.name ?? project.name ?? 'Schedule',
            project.id,
            workingTasks,
            project.schedule?.baseline ?? null,
          );
          updateProject(project.id, {
            schedule: { ...newSchedule, baselines: baselinesRef.current },
          });
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Edit handlers — all go through a single `commit` that snapshots history
  // -------------------------------------------------------------------------

  const commit = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => {
    setWorkingTasks(prev => {
      const next = producer(prev);
      // Push prev to undo stack, clear redo stack.
      setHistory(h => {
        const trimmed = h.length >= 20 ? h.slice(h.length - 19) : h;
        return [...trimmed, prev];
      });
      setFuture([]);
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  const handleEdit = useCallback((taskId: string, patch: Partial<ScheduleTask>) => {
    commit(prev => prev.map(t => (t.id === taskId ? { ...t, ...patch } : t)));
  }, [commit]);

  const handleAddTask = useCallback(() => {
    commit(prev => {
      const newTask: ScheduleTask = {
        id: createId('task'),
        title: 'New task',
        phase: 'General',
        durationDays: 1,
        startDay: prev.length === 0
          ? 1
          : Math.max(...prev.map(t => t.startDay + t.durationDays)),
        progress: 0,
        crew: '',
        dependencies: [],
        notes: '',
        status: 'not_started',
      };
      return generateWbsCodes([...prev, newTask]);
    });
  }, [commit]);

  // Phase 4: create a dependency edge between two tasks via drag in the Gantt.
  // Guards against self-link + cycles are handled in the Gantt before we get
  // the call, so here we just append.
  const handleDependencyCreate = useCallback((fromId: string, toId: string) => {
    commit(prev => prev.map(t => {
      if (t.id !== toId) return t;
      if (t.dependencies.includes(fromId)) return t;
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
  // Named baselines — capture the current plan as a named version, diff later
  // -------------------------------------------------------------------------

  const handleCaptureBaseline = useCallback(() => {
    const defaultName = `v${namedBaselines.length + 1}`;
    const promptMsg = `Name this baseline (e.g. "Signed", "Approved rev 2"):`;
    let name: string | null = defaultName;
    if (Platform.OS === 'web') {
      name = window.prompt?.(promptMsg, defaultName) ?? null;
      if (name == null) return; // user cancelled
    }
    const trimmed = (name || defaultName).trim() || defaultName;
    const snap = captureBaseline(workingTasks, trimmed);
    // Order matters: update the ref first so the `commit` below, which
    // triggers a debounced persist, picks up the new baseline list. Without
    // this, the first-ever capture flushed before the ref effect ran.
    baselinesRef.current = [...baselinesRef.current, snap];
    setNamedBaselines(prev => [...prev, snap]);
    // Apply as the active baseline on each task so variance badges show
    // immediately — the user's mental model of "capture baseline" is "lock in
    // this plan as the target," and having the ghost stripes appear is the
    // fastest visual confirmation that it worked.
    commit(prev => applyBaselineToTasks(prev, snap));
    const msg = `Baseline "${trimmed}" captured. ${workingTasks.length} tasks snapshotted.`;
    if (Platform.OS === 'web') window.alert?.(msg);
    else Alert.alert('Baseline saved', msg);
  }, [namedBaselines.length, workingTasks, commit]);

  const handleCompareBaseline = useCallback(() => {
    if (namedBaselines.length === 0) {
      const msg = 'Capture a baseline first (Baseline button). Then come back here to see what changed against it.';
      if (Platform.OS === 'web') window.alert?.(msg);
      else Alert.alert('No baselines', msg);
      return;
    }
    const latest = namedBaselines[namedBaselines.length - 1];
    const diffs = diffAgainstBaseline(workingTasks, latest);
    if (diffs.length === 0) {
      const msg = `No variance against "${latest.name}" — the plan matches the baseline exactly.`;
      if (Platform.OS === 'web') window.alert?.(msg);
      else Alert.alert('No variance', msg);
      return;
    }
    const top = diffs.slice(0, 8).map(d => {
      const sign = d.endDelta > 0 ? '+' : '';
      return `  • ${d.title}: ${sign}${d.endDelta}d (finish)`;
    }).join('\n');
    const msg = `Variance vs "${latest.name}":\n\n${top}${diffs.length > 8 ? `\n  …and ${diffs.length - 8} more` : ''}`;
    if (Platform.OS === 'web') window.alert?.(msg);
    else Alert.alert('Baseline variance', msg);
  }, [namedBaselines, workingTasks]);

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
  // Share link — base64 payload in URL, no backend
  // -------------------------------------------------------------------------

  const handleShare = useCallback(() => {
    if (!project) return;
    const payload = buildSharePayload(project.name ?? 'Schedule', projectStartDate, workingTasks);
    const token = encodeShareToken(payload);
    let url = `/shared-schedule?t=${token}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      url = `${window.location.origin}${url}`;
      // Try to copy. Not all browsers allow clipboard writes without https;
      // show the URL as a fallback either way so the user can grab it.
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
  }, [project, projectStartDate, workingTasks]);

  // -------------------------------------------------------------------------
  // Undo / Redo (Phase 4 preview — works today for grid edits)
  // -------------------------------------------------------------------------

  const handleUndo = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture(f => [workingTasks, ...f.slice(0, 19)]);
      setWorkingTasks(prev);
      schedulePersist(prev);
      return h.slice(0, -1);
    });
  }, [workingTasks, schedulePersist]);

  const handleRedo = useCallback(() => {
    setFuture(f => {
      if (f.length === 0) return f;
      const next = f[0];
      setHistory(h => [...h, workingTasks].slice(-20));
      setWorkingTasks(next);
      schedulePersist(next);
      return f.slice(1);
    });
  }, [workingTasks, schedulePersist]);

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
        <Zap size={28} color={Colors.primary} />
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
          <ChevronLeft size={20} color={Colors.primary} />
          <Text style={styles.headerBackText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.headerSub}>
            {stats.total} tasks · {stats.critical} on critical path · finish day {stats.finish}
            {stats.conflicts > 0 && ` · ${stats.conflicts} conflict${stats.conflicts === 1 ? '' : 's'}`}
          </Text>
        </View>

        <View style={styles.headerActions}>
          {/* Pane mode segmented control */}
          <View style={styles.paneToggle}>
            <PaneBtn icon={Table2} label="Grid" active={paneMode === 'grid'} onPress={() => setPaneMode('grid')} />
            <PaneBtn icon={Columns} label="Split" active={paneMode === 'split'} onPress={() => setPaneMode('split')} />
            <PaneBtn icon={BarChart2} label="Gantt" active={paneMode === 'gantt'} onPress={() => setPaneMode('gantt')} />
          </View>

          {/* AI first — the headline feature. Highlighted style so it stands out. */}
          <HeaderBtn icon={Sparkles} label="AI" onPress={() => setShowAI(true)} highlighted />
          <HeaderBtn icon={RefreshCcw} label="Reflow" onPress={handleReflow} />
          <HeaderBtn icon={Bookmark} label="Baseline" onPress={handleCaptureBaseline} onLongPress={handleCompareBaseline} />
          <HeaderBtn icon={Download} label="CSV" onPress={handleExportCsv} />
          <HeaderBtn icon={Sparkles} label="Demo" onPress={handleLoadDemo} />
          <HeaderBtn icon={Undo2} label="Undo" onPress={handleUndo} disabled={history.length === 0} />
          <HeaderBtn icon={Redo2} label="Redo" onPress={handleRedo} disabled={future.length === 0} />
          <HeaderBtn
            icon={Activity}
            label="CPM"
            onPress={() => {
              const msg = `Project finish: day ${cpm.projectFinish}\nCritical path: ${cpm.criticalPath.length} task(s)\nConflicts: ${cpm.conflicts.length}`;
              if (Platform.OS === 'web') window.alert?.(msg);
              else Alert.alert('Schedule analysis', msg);
            }}
          />
          <HeaderBtn icon={Share2} label="Share" onPress={handleShare} />
        </View>
      </View>

      {/* Body — renders grid, gantt, or both depending on pane mode */}
      <View style={styles.body}>
        {paneMode !== 'gantt' && (
          <View style={paneMode === 'split' ? styles.paneHalf : styles.paneFull}>
            <GridPane
              tasks={workingTasks}
              projectStartDate={projectStartDate}
              workingDaysPerWeek={workingDaysPerWeek}
              onEdit={handleEdit}
              onAddTask={handleAddTask}
              onDeleteTask={handleDeleteTask}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onBulkDelete={handleBulkDelete}
              onBulkDuplicate={handleBulkDuplicate}
              onBulkShiftDays={handleBulkShiftDays}
              onBulkSetPhase={handleBulkSetPhase}
              onBulkSetCrew={handleBulkSetCrew}
              onBulkAskAI={handleBulkAskAI}
            />
          </View>
        )}
        {paneMode !== 'grid' && (
          <View style={paneMode === 'split' ? styles.paneHalfRight : styles.paneFull}>
            <InteractiveGantt
              tasks={workingTasks}
              cpm={cpm}
              projectStartDate={projectStartDate}
              onEdit={handleEdit}
              onDependencyCreate={handleDependencyCreate}
            />
          </View>
        )}
      </View>

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
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pane toggle button
// ---------------------------------------------------------------------------

function PaneBtn({
  icon: Icon, label, active, onPress,
}: { icon: any; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.paneBtn, active && styles.paneBtnActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Icon size={13} color={active ? Colors.primary : Colors.textSecondary} />
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
  const tint = disabled ? Colors.textMuted : highlighted ? '#fff' : Colors.primary;
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 440 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 12,
  },
  primaryBtnText: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 14 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  headerBack: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
  },
  headerBackText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  headerTitleWrap: { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
  },
  headerBtnDisabled: { backgroundColor: Colors.fillTertiary, opacity: 0.6 },
  headerBtnHighlighted: { backgroundColor: Colors.primary },
  headerBtnText: { fontSize: 12, fontWeight: '700', color: Colors.primary },

  body: {
    flex: 1,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
  },
  paneFull: { flex: 1 },
  paneHalf: { flex: 1, minWidth: 0 },
  paneHalfRight: { flex: 1, minWidth: 0 },

  paneToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 8,
    padding: 2,
    marginRight: 4,
  },
  paneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  paneBtnActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  paneBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  paneBtnTextActive: {
    color: Colors.primary,
  },
});
