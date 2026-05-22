// InteractiveGantt — Phase 3 of the MS-Project-style rebuild.
//
// What this component does that the old GanttChart.tsx did not:
//   1. Drag the BODY of any bar horizontally → startDay changes.
//   2. Drag the RIGHT EDGE of any bar → durationDays changes.
//   3. Animated "marching ants" dependency lines drawn between predecessor and
//      successor bars. Red on the critical path, blue elsewhere. They glow
//      when either connected bar is hovered/dragged.
//   4. Smart tooltip follows the finger while dragging: "Pour foundation ·
//      Apr 22 → Apr 24 (+2d)".
//   5. "Today" red vertical line so field teams see where they are.
//   6. Milestone diamonds render for zero-duration tasks.
//   7. Zoom presets: Day (28px/day), Week (8px/day), Month (2px/day).
//
// Design rules we hold to
// -----------------------
//   * Parent owns state. We call `onEdit(taskId, patch)` with the final value
//     at drag-end; during the drag we animate a local overlay so the UI is
//     instant without round-tripping through the CPM engine on every frame.
//   * Cross-platform: uses PanResponder (works on web, iOS, iPadOS, Android)
//     and react-native-svg. No reanimated dependency — strokeDashoffset is
//     animated via Animated.Value which react-native-svg respects.
//   * Side-effect free render: we never mutate props. Bar positions are
//     derived from props every render; dragging writes to a ref+Animated.Value
//     and commits at the end.
//
// Interop with CPM
// ----------------
//   * We accept the CpmResult so we know which tasks are critical, and so
//     successor bars can snap to computed ES on commit. The parent is
//     expected to re-run runCpm() after each onEdit; we just show what we get.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  PanResponder,
  Animated,
  Easing,
  Platform,
  Pressable,
  AccessibilityInfo,
} from 'react-native';
import Svg, { Path, Defs, Marker, Polygon, Line as SvgLine, Rect as SvgRect, Circle as SvgCircle } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ScheduleTask } from '@/types';
import { wouldCreateCycle, type CpmResult } from '@/utils/cpm';
import { colorForTask as canonicalColorForTask } from '@/utils/scheduleColors';
import { useBarLabel } from '@/utils/useBarLabel';
import { getHiddenTaskIds } from '@/utils/summaryRollup';
import { orthogonalArrowPath } from '@/utils/ganttArrowPath';

// Bar fill is trade-driven via the canonical colorForTask() from scheduleColors.
// This delegates so existing internal call sites keep working unchanged.
function colorForTask(task: ScheduleTask): string {
  return canonicalColorForTask(task);
}
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ZoomMode = 'day' | 'week' | 'month';

export interface InteractiveGanttProps {
  tasks: ScheduleTask[];
  cpm: CpmResult;
  projectStartDate: Date;
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
  /** Notify parent when the user requests a new dependency via drag (Phase 4). */
  onDependencyCreate?: (fromId: string, toId: string) => void;
  /** Forced initial zoom. Defaults to 'day' unless the project exceeds 90 days. */
  initialZoom?: ZoomMode;
  /**
   * Timeline-only mode. When true, the task-name gutter is hidden — the caller
   * (typically the Schedule Pro split view) is already showing task names in a
   * spreadsheet to the left, so repeating them here makes the layout feel
   * stacked and redundant. Row heights still match (40px) so the parent can
   * align the two panes visually.
   */
  compact?: boolean;
  /**
   * Layout mode. `'desktop'` (default) is the full toolbar + 240px gutter.
   * `'phone'` is the Task 18 single-pane fallback: no toolbar, a narrow 90px
   * sticky task-name gutter on the left, and the same horizontal-scroll
   * timeline body on the right. Bars and dependencies render identically;
   * we only compress the chrome.
   */
  mode?: 'desktop' | 'phone';
  /**
   * The "pathed" task. When set, the gantt dims every bar that is NOT part of
   * the focused task's driving-predecessor chain (ancestors walked through
   * dependencyLinks/legacy dependencies). Empty/null = no highlight, all bars
   * render normally. Pairs with `onFocusTask` so the parent owns the state
   * (so the Grid can highlight the same row simultaneously).
   */
  focusedTaskId?: string | null;
  /** Fires when the user clicks a bar. Pass the id, or null to clear focus. */
  onFocusTask?: (id: string | null) => void;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 56;             // 2-line gutter rows (title + date range / duration) — matches the mockup's premium row layout
const BAR_HEIGHT = 26;
const BAR_VERTICAL_PADDING = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const HEADER_HEIGHT = 56;          // month row (24) + day-number row (32)
const LEFT_GUTTER = 240;           // task-name column baked into the scroller
const RESIZE_HANDLE_WIDTH = 10;    // px on the right edge that triggers resize vs move
const MIN_BAR_PX_WIDTH = 14;       // don't let bars collapse below this during drag
// TODAY_COLOR removed — today line now uses Colors.pillLate (#FF5A51) with a
// labeled pill (Task 7 restyle). The old indigo SVG halo is gone.
// Soft weekend column tint — Apple-app convention is to whisper, not shout.
// Slate at ~3% over the surface gives a barely-perceptible Sat/Sun band.
const WEEKEND_TINT = 'rgba(60,60,67,0.025)';
// Bar visual primitives — used inside the bar render below to give the
// premium look (soft fill + colored accent stripe + restrained border).
const BAR_RADIUS = 6;
const BAR_ACCENT_WIDTH = 3;

const PX_PER_DAY: Record<ZoomMode, number> = {
  day: 28,
  week: 8,
  month: 2,
};

// ---------------------------------------------------------------------------
// Date helpers (1-indexed inclusive day numbering — matches the rest of the app)
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtShort(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtMonth(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InteractiveGantt(props: InteractiveGanttProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tasks: tasksRaw, cpm, projectStartDate, onEdit, onDependencyCreate, initialZoom, compact, mode, focusedTaskId, onFocusTask } = props;
  const isPhone = mode === 'phone';
  // Filter rows belonging to collapsed summaries. CPM still honored them (we
  // received the pre-rolled set); we only hide them visually so the gantt
  // stays uncluttered while the user is focused on top-level phases.
  const tasks = useMemo(() => {
    // Defensive: filter out any null/undefined entries that may have slipped
    // in via a malformed Supabase row or an in-flight optimistic update.
    // Without this, downstream `task.startDay` access in bars.map crashes
    // the whole Gantt the moment a single bad row is in the array.
    const cleaned = tasksRaw.filter((t): t is ScheduleTask => !!t && typeof t.id === 'string');
    const hidden = getHiddenTaskIds(cleaned);
    return cleaned.filter(t => !hidden.has(t.id));
  }, [tasksRaw]);
  // Left gutter width: phones get a compressed 90px sticky col (single-line
  // names), split-view (compact) hides the gutter entirely (the GridPane to
  // the left already shows names), desktop standalone uses the full 240px
  // two-line gutter.
  const leftGutter = isPhone ? 90 : compact ? 0 : LEFT_GUTTER;

  // --- Zoom -----------------------------------------------------------------
  // Continuous zoom: pxPerDay is the single source of truth. The `zoom`
  // density tier (day / week / month) is derived so header ticks, tail
  // padding, and gridline spacing still pick sensible labels at any slider
  // position. Keeping the tier as a derived value lets old call sites (and
  // the Day/Week/Month preset chips) treat this as three discrete modes
  // while power users get continuous scaling via the slider.
  const [pxPerDay, setPxPerDay] = useState<number>(() => {
    const mode: ZoomMode = initialZoom ?? (() => {
      const span = Math.max(1, cpm.projectFinish);
      if (span > 180) return 'month';
      if (span > 60) return 'week';
      return 'day';
    })();
    return PX_PER_DAY[mode];
  });
  const zoom: ZoomMode = pxPerDay >= 16 ? 'day' : pxPerDay >= 6 ? 'week' : 'month';
  const setZoom = useCallback((z: ZoomMode) => setPxPerDay(PX_PER_DAY[z]), []);

  // Animated sliding pill for the Day/Week/Month segmented control. The pill
  // smoothly translates between segments instead of snapping background-color
  // — that's the difference between an iOS-style segmented control and a row
  // of toggled buttons. We drive `segmentAnim` from `zoom` and interpolate to
  // a translateX. Spring physics for the actual UIKit feel.
  const SEGMENT_WIDTH = 56;
  const segmentAnim = useRef(new Animated.Value(zoom === 'day' ? 0 : zoom === 'week' ? 1 : 2)).current;
  useEffect(() => {
    Animated.spring(segmentAnim, {
      toValue: zoom === 'day' ? 0 : zoom === 'week' ? 1 : 2,
      useNativeDriver: true,
      speed: 22,
      bounciness: 8,
    }).start();
  }, [zoom, segmentAnim]);

  // --- Derived totals -------------------------------------------------------
  // Always render at least ~30 days to the right of project finish so users can
  // visually extend, and always start at day 1 (project start).
  const totalDays = useMemo(() => {
    const lastEf = cpm.projectFinish || 1;
    const tail = zoom === 'month' ? 60 : zoom === 'week' ? 30 : 14;
    return Math.max(30, lastEf + tail);
  }, [cpm.projectFinish, zoom]);

  const timelineWidth = totalDays * pxPerDay;
  const gridHeight = HEADER_HEIGHT + tasks.length * ROW_HEIGHT;

  // Today's offset in day coordinates (1-indexed). Can be negative (project
  // starts in the future) or > totalDays (project is ancient history).
  const todayDayNumber = useMemo(() => {
    const now = new Date();
    // "Day 1" is projectStartDate. So today = daysBetween + 1.
    return daysBetween(projectStartDate, now) + 1;
  }, [projectStartDate]);

  // Convert an ISO date (YYYY-MM-DD) to our 1-indexed day number. Returns
  // null if the date is unparseable. Used for anchor markers and deadline
  // chevrons.
  const isoToDayLocal = useCallback((iso: string | undefined): number | null => {
    if (!iso) return null;
    const parsed = Date.parse(iso + 'T00:00:00');
    if (!Number.isFinite(parsed)) return null;
    const d = new Date(parsed);
    return daysBetween(projectStartDate, d) + 1;
  }, [projectStartDate]);

  // --- Scroll refs (for Fit / Today / Focus toolbar buttons) --------------
  const hScrollRef = useRef<ScrollView | null>(null);

  // --- Hover / drag state --------------------------------------------------
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    taskId: string;
    mode: 'move' | 'resize';
    originalStart: number;
    originalDuration: number;
    currentStart: number;
    currentDuration: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);

  // Phase 4: dependency-creation drag state. Separate from bar move/resize
  // because the gesture starts on a small handle, not the bar body, and it
  // needs to render a rubber-band line through release.
  const [linkDrag, setLinkDrag] = useState<{
    sourceTaskId: string;
    pointerLocalX: number;   // coords in the timeline's local space
    pointerLocalY: number;
    hoverTargetId: string | null;
    invalid: boolean;        // cycle or self-link → render red
  } | null>(null);
  const linkOriginRef = useRef<{ pageX: number; pageY: number; originX: number; originY: number } | null>(null);

  // --- Derived bar geometry ------------------------------------------------
  // During a drag, the active bar uses dragState values; everyone else uses
  // props. This lets the parent avoid re-running CPM 60 times/second.
  const bars = useMemo(() => {
    return tasks.map((task, index) => {
      const isDragging = dragState?.taskId === task.id;
      // Defaults for tasks missing startDay / durationDays (legacy rows, in-
      // flight optimistic updates). Without these `task.startDay` may be
      // undefined and `undefined * pxPerDay` produces NaN bar geometry.
      const taskStartDay = task.startDay ?? 1;
      const taskDuration = task.durationDays ?? 1;
      const startDay = isDragging ? dragState.currentStart : taskStartDay;
      const duration = isDragging ? dragState.currentDuration : taskDuration;
      const isMilestone = task.isMilestone || duration === 0;
      const cpmRow = cpm.perTask.get(task.id);
      const isCritical = !!cpmRow?.isCritical;
      const x = (startDay - 1) * pxPerDay;
      const w = Math.max(
        isMilestone ? 0 : MIN_BAR_PX_WIDTH,
        duration * pxPerDay,
      );
      const y = HEADER_HEIGHT + index * ROW_HEIGHT + BAR_VERTICAL_PADDING;
      return { task, index, startDay, duration, isMilestone, isCritical, x, y, w, cpmRow };
    });
  }, [tasks, dragState, cpm, pxPerDay]);

  // Quick lookup for dependency drawing.
  const barById = useMemo(() => {
    const m = new Map<string, (typeof bars)[number]>();
    bars.forEach(b => m.set(b.task.id, b));
    return m;
  }, [bars]);

  // --- Task path (driving predecessors) -----------------------------------
  // Given a focused task, walk its dependency graph backward so every bar
  // that feeds into it (direct or transitive) can render at full brightness
  // while unrelated bars dim to a ghost. MAGE calls this the "task path"
  // rather than MSP's "task inspector" — same idea, different branding.
  // Reads both the new typed links (dependencyLinks) and the legacy string
  // array so old schedules keep working.
  const taskPathIds = useMemo(() => {
    if (!focusedTaskId) return null;
    const byId = new Map(tasksRaw.map(t => [t.id, t]));
    const visited = new Set<string>([focusedTaskId]);
    const queue: string[] = [focusedTaskId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const t = byId.get(cur);
      if (!t) continue;
      const predIds: string[] = [];
      if (t.dependencyLinks && t.dependencyLinks.length > 0) {
        for (const link of t.dependencyLinks) predIds.push(link.taskId);
      } else if (t.dependencies) {
        for (const d of t.dependencies) predIds.push(d);
      }
      for (const pid of predIds) {
        if (!visited.has(pid)) {
          visited.add(pid);
          queue.push(pid);
        }
      }
    }
    return visited;
  }, [focusedTaskId, tasksRaw]);

  // --- Reduce-motion guard (Task 4) ----------------------------------------
  // Read the system accessibility preference and subscribe to changes so the
  // marching-ants animation is skipped when the user has opted out of motion.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(enabled),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  // --- Marching ants animation (Task 4) ------------------------------------
  // Calm 1.4s linear loop animating strokeDashoffset 0 → -7 (matches the
  // "4 3" dash period of 7). Loop is skipped entirely when reduce-motion
  // is enabled.
  //
  // useNativeDriver MUST be false here: strokeDashoffset is an SVG prop,
  // and the native animated driver only supports a whitelist of layout/
  // transform/opacity props — it cannot drive SVG attributes. Setting it
  // true throws "property strokeDashoffset is not supported by native
  // animated module" (or silently freezes the dashes). The JS driver
  // updates the value each frame, which react-native-svg picks up. (The
  // pre-redesign code correctly used false here too.)
  const dashOffset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(dashOffset, {
        toValue: -7,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [dashOffset, reduceMotion]);

  // --- Drag machinery ------------------------------------------------------
  // We use a PanResponder per-bar (bound via onStartShouldSetResponder pattern
  // in the child). For perf it's one object per bar; that's fine because we
  // never have thousands of tasks on screen.
  const startPointer = useRef<{ x: number; y: number; startDay: number; duration: number } | null>(null);

  const beginDrag = useCallback((task: ScheduleTask, mode: 'move' | 'resize', evt: any) => {
    const { pageX, pageY } = evt.nativeEvent;
    startPointer.current = {
      x: pageX,
      y: pageY,
      startDay: task.startDay,
      duration: task.durationDays,
    };
    setDragState({
      taskId: task.id,
      mode,
      originalStart: task.startDay,
      originalDuration: task.durationDays,
      currentStart: task.startDay,
      currentDuration: task.durationDays,
      pointerX: pageX,
      pointerY: pageY,
    });
  }, []);

  const updateDrag = useCallback((evt: any) => {
    if (!startPointer.current) return;
    const { pageX, pageY } = evt.nativeEvent;
    const dx = pageX - startPointer.current.x;
    const deltaDays = Math.round(dx / pxPerDay);
    setDragState(prev => {
      if (!prev) return prev;
      if (prev.mode === 'move') {
        const nextStart = Math.max(1, startPointer.current!.startDay + deltaDays);
        return { ...prev, currentStart: nextStart, pointerX: pageX, pointerY: pageY };
      }
      // resize — only duration changes; clamp at 0 (milestone) min
      const nextDuration = Math.max(0, startPointer.current!.duration + deltaDays);
      return { ...prev, currentDuration: nextDuration, pointerX: pageX, pointerY: pageY };
    });
  }, [pxPerDay]);

  const endDrag = useCallback(() => {
    setDragState(prev => {
      if (!prev) return null;
      const patch: Partial<ScheduleTask> = {};
      if (prev.mode === 'move' && prev.currentStart !== prev.originalStart) {
        patch.startDay = prev.currentStart;
      } else if (prev.mode === 'resize' && prev.currentDuration !== prev.originalDuration) {
        patch.durationDays = prev.currentDuration;
        if (prev.currentDuration === 0) patch.isMilestone = true;
        else if (prev.originalDuration === 0 && prev.currentDuration > 0) patch.isMilestone = false;
      }
      if (Object.keys(patch).length > 0) {
        onEdit(prev.taskId, patch);
      }
      return null;
    });
    startPointer.current = null;
  }, [onEdit]);

  // --- Phase 4: drag-to-create dependencies -------------------------------
  // Hit-test: given pointer coords in timeline-local space, return the id of
  // the bar under it, or null. We don't care about pixel-perfect — we expand
  // the row hitbox to the full row height so sloppy drops still work.
  const hitTestBar = useCallback((localX: number, localY: number): string | null => {
    for (const b of bars) {
      const top = HEADER_HEIGHT + b.index * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (localY < top || localY > bottom) continue;
      // Match within the whole row left-of-bar-center to be forgiving; on miss
      // we still need something within the bar's horizontal footprint.
      if (localX >= b.x - 4 && localX <= b.x + Math.max(b.w, MIN_BAR_PX_WIDTH) + 4) {
        return b.task.id;
      }
    }
    return null;
  }, [bars]);

  const beginLinkDrag = useCallback((sourceTaskId: string, evt: any) => {
    const { pageX, pageY, locationX, locationY } = evt.nativeEvent;
    const src = barById.get(sourceTaskId);
    if (!src) return;
    // We store the origin in timeline-local coords. Since PanResponder gives
    // us pageX, we derive local by subtracting the delta between first page
    // position and the bar's known local position.
    const originLocalX = src.x + src.w;
    const originLocalY = src.y + BAR_HEIGHT / 2;
    linkOriginRef.current = {
      pageX, pageY,
      originX: originLocalX,
      originY: originLocalY,
    };
    setLinkDrag({
      sourceTaskId,
      pointerLocalX: originLocalX,
      pointerLocalY: originLocalY,
      hoverTargetId: null,
      invalid: false,
    });
  }, [barById]);

  const updateLinkDrag = useCallback((evt: any) => {
    if (!linkOriginRef.current) return;
    const { pageX, pageY } = evt.nativeEvent;
    const dx = pageX - linkOriginRef.current.pageX;
    const dy = pageY - linkOriginRef.current.pageY;
    const localX = linkOriginRef.current.originX + dx;
    const localY = linkOriginRef.current.originY + dy;
    setLinkDrag(prev => {
      if (!prev) return prev;
      const target = hitTestBar(localX, localY);
      let invalid = false;
      if (target) {
        if (target === prev.sourceTaskId) invalid = true;
        else if (wouldCreateCycle(tasks, target, prev.sourceTaskId)) invalid = true;
      }
      return {
        ...prev,
        pointerLocalX: localX,
        pointerLocalY: localY,
        hoverTargetId: target,
        invalid,
      };
    });
  }, [hitTestBar, tasks]);

  // Pending link — set when drag-to-link completes successfully. The popover
  // asks the user to pick FS/SS/FF/SF + a lag. This is the MS Project
  // semantics that was missing: defaulting to FS+0 obscures real logic like
  // "pour cures 3 days before tile can start" (FS+3).
  const [pendingLink, setPendingLink] = useState<{
    fromId: string;
    toId: string;
    x: number;
    y: number;
  } | null>(null);

  const endLinkDrag = useCallback(() => {
    setLinkDrag(prev => {
      if (!prev) return null;
      if (prev.hoverTargetId && !prev.invalid) {
        // Pop a menu so the user picks FS/SS/FF/SF + lag. The commit happens
        // from the menu, not here.
        setPendingLink({
          fromId: prev.sourceTaskId,
          toId: prev.hoverTargetId,
          x: prev.pointerLocalX,
          y: prev.pointerLocalY,
        });
      }
      return null;
    });
    linkOriginRef.current = null;
  }, []);

  const commitPendingLink = useCallback((type: 'FS' | 'SS' | 'FF' | 'SF', lagDays: number) => {
    if (!pendingLink) return;
    const { fromId, toId } = pendingLink;
    const target = tasks.find(t => t.id === toId);
    if (!target) { setPendingLink(null); return; }
    // Build dependencyLinks[], upgrading legacy deps if needed.
    const existing = target.dependencyLinks && target.dependencyLinks.length > 0
      ? target.dependencyLinks
      : target.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
    // Replace any existing link with same fromId (editing via re-drag), else append.
    const without = existing.filter(l => l.taskId !== fromId);
    const nextLinks = [...without, { taskId: fromId, type, lagDays }];
    // Keep dependencies[] as a simple predecessor id list for legacy code.
    const nextDeps = Array.from(new Set([...target.dependencies, fromId]));
    if (onDependencyCreate) {
      onDependencyCreate(fromId, toId);
    }
    onEdit(toId, {
      dependencies: nextDeps,
      dependencyLinks: nextLinks,
    });
    setPendingLink(null);
  }, [pendingLink, tasks, onDependencyCreate, onEdit]);

  // --- Phase 5: as-built quick actions ------------------------------------
  const logStartToday = useCallback((task: ScheduleTask) => {
    const now = new Date();
    onEdit(task.id, {
      actualStartDay: todayDayNumber,
      actualStartDate: now.toISOString(),
      status: task.status === 'not_started' ? 'in_progress' : task.status,
    });
  }, [onEdit, todayDayNumber]);

  const logFinishToday = useCallback((task: ScheduleTask) => {
    const now = new Date();
    const patch: Partial<ScheduleTask> = {
      actualEndDay: todayDayNumber,
      actualEndDate: now.toISOString(),
      status: 'done',
      progress: 100,
    };
    if (task.actualStartDay == null) {
      patch.actualStartDay = task.startDay;
      patch.actualStartDate = now.toISOString();
    }
    onEdit(task.id, patch);
  }, [onEdit, todayDayNumber]);

  // One PanResponder for the whole timeline body. We decide move vs resize
  // based on where the gesture started relative to the bar's right edge.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false, // bars themselves claim gestures via Pressable + onLongPress won't work for drag; we use touch-down handler below
      onMoveShouldSetPanResponder: () => false,
    }),
  ).current;

  // --- Last milestone ID (project completion = red diamond) ----------------
  const lastMilestoneId = useMemo(() => {
    return tasks
      .filter(t => t.isMilestone || t.durationDays === 0)
      .reduce<{ id: string; day: number } | null>((latest, t) => {
        const day = t.startDay ?? 0;
        if (!latest || day > latest.day) return { id: t.id, day };
        return latest;
      }, null)?.id ?? null;
  }, [tasks]);

  // --- Dependency paths (Task 3 restyle) ----------------------------------------
  // Arrows are hidden unless a bar is focused (focusedTaskId != null). When
  // focused, only the one-hop neighbors of the focused task are rendered:
  // arrows where from === focusedTaskId OR to === focusedTaskId.
  // Path geometry uses orthogonalArrowPath() from ganttArrowPath.ts.
  const dependencyPaths = useMemo(() => {
    // No focus → no arrows rendered.
    if (focusedTaskId == null) return [];
    const out: {
      id: string;
      d: string;
      critical: boolean;
    }[] = [];
    for (const succ of bars) {
      const links = succ.task.dependencyLinks && succ.task.dependencyLinks.length > 0
        ? succ.task.dependencyLinks
        : succ.task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
      for (const link of links) {
        const pred = barById.get(link.taskId);
        if (!pred) continue;
        // One-hop filter: only show arrows connected to the focused bar.
        if (pred.task.id !== focusedTaskId && succ.task.id !== focusedTaskId) continue;
        const criticalBoth = pred.isCritical && succ.isCritical;
        // Orthogonal path: pred right-edge → succ left-edge, both at bar midpoint Y.
        const d = orthogonalArrowPath(
          { x: pred.x + pred.w, y: pred.y + BAR_HEIGHT / 2 },
          { x: succ.x,          y: succ.y + BAR_HEIGHT / 2 },
        );
        out.push({ id: `${pred.task.id}->${succ.task.id}`, d, critical: criticalBoth });
      }
    }
    return out;
  }, [bars, barById, focusedTaskId]);

  // --- Today marker -------------------------------------------------------
  const todayX = (todayDayNumber - 1) * pxPerDay;
  const todayVisible = todayX >= 0 && todayX <= timelineWidth;

  // --- Header (days) -------------------------------------------------------
  // Build day ticks. For zoom=day we label every day; week → every 7;
  // month → every 1st of month.
  const headerTicks = useMemo(() => {
    const ticks: { x: number; label: string; bold?: boolean; month?: string; isWeekend?: boolean }[] = [];
    if (zoom === 'day') {
      for (let d = 1; d <= totalDays; d++) {
        const date = addDays(projectStartDate, d - 1);
        const dow = date.getDay();
        ticks.push({
          x: (d - 1) * pxPerDay,
          label: String(date.getDate()),
          bold: date.getDate() === 1,
          month: date.getDate() === 1 || d === 1 ? fmtMonth(date) : undefined,
          isWeekend: dow === 0 || dow === 6,
        });
      }
    } else if (zoom === 'week') {
      for (let d = 1; d <= totalDays; d += 7) {
        const date = addDays(projectStartDate, d - 1);
        ticks.push({
          x: (d - 1) * pxPerDay,
          label: fmtShort(date),
          month: d === 1 || date.getDate() <= 7 ? fmtMonth(date) : undefined,
        });
      }
    } else {
      // month
      let d = 1;
      while (d <= totalDays) {
        const date = addDays(projectStartDate, d - 1);
        ticks.push({
          x: (d - 1) * pxPerDay,
          label: fmtMonth(date),
          month: fmtMonth(date),
          bold: true,
        });
        // jump to next month's first
        const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
        d += Math.max(1, daysBetween(date, nextMonth));
      }
    }
    return ticks;
  }, [zoom, totalDays, projectStartDate, pxPerDay]);

  // Pinch-to-zoom on web. Apple convention: cmd+scroll (Mac) / ctrl+scroll
  // (other) zooms the chart timeline. We preventDefault so the browser
  // doesn't try to zoom the whole page. deltaY < 0 (scroll up) zooms in;
  // > 0 zooms out. The 1.5 step is small enough to feel like a continuous
  // zoom but big enough that the user reaches the boundary in a few flicks.
  // Native is currently served by the +/− stepper buttons in the toolbar;
  // adding PinchGestureHandler would require wrapping the entire timeline
  // in a gesture-handler tree which is a separate refactor.
  const handleWheelZoom = useCallback((e: any) => {
    if (Platform.OS !== 'web') return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault?.();
    const dy = e.deltaY ?? 0;
    if (dy === 0) return;
    const step = dy > 0 ? -1.5 : 1.5;
    setPxPerDay(prev => Math.max(1, Math.min(40, prev + step)));
  }, []);

  // --- Render ---------------------------------------------------------------
  return (
    <View
      style={[styles.container, isPhone && styles.containerPhone]}
      {...(Platform.OS === 'web' ? ({ onWheel: handleWheelZoom } as any) : {})}
    >
      {/* Toolbar — hidden on phone; zoom/Fit/Today live in the parent shell
          on small screens to reclaim vertical space for the bars. */}
      {!isPhone && (
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>Gantt</Text>
        {/* iOS-style segmented control with a sliding pill behind the active
            segment. The pill is an Animated.View that translates between the
            three positions on `zoom` change — feels live the way UIKit's
            UISegmentedControl does, instead of snapping background colors. */}
        <View style={styles.zoomGroup}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.zoomPill,
              {
                width: SEGMENT_WIDTH,
                transform: [{
                  translateX: segmentAnim.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: [0, SEGMENT_WIDTH, SEGMENT_WIDTH * 2],
                  }),
                }],
              },
            ]}
          />
          {(['day', 'week', 'month'] as ZoomMode[]).map(z => (
            <TouchableOpacity
              key={z}
              onPress={() => setZoom(z)}
              style={[styles.zoomBtn, { width: SEGMENT_WIDTH }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.zoomBtnText, zoom === z && styles.zoomBtnTextActive]}>
                {z[0].toUpperCase() + z.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* Continuous zoom slider. Web renders a native range input so the
            user can dial in any density between month-overview (1px/day) and
            detail view (40px/day). Native falls back to −/+ stepper buttons
            (Reanimated slider is overkill for a toolbar control). */}
        {Platform.OS === 'web' ? (
          <View style={styles.zoomSliderWrap}>
            {React.createElement('input' as any, {
              type: 'range',
              min: 1,
              max: 40,
              step: 1,
              value: Math.round(pxPerDay),
              onChange: (e: any) => setPxPerDay(Number(e.target.value) || 1),
              style: { width: 120, cursor: 'pointer' },
              'aria-label': 'Zoom',
            })}
            <Text style={styles.zoomSliderValue}>{Math.round(pxPerDay)}px/d</Text>
          </View>
        ) : (
          <View style={styles.zoomSliderWrap}>
            <TouchableOpacity
              onPress={() => setPxPerDay(v => Math.max(1, v - 2))}
              style={styles.zoomStepBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.zoomStepBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.zoomSliderValue}>{Math.round(pxPerDay)}px/d</Text>
            <TouchableOpacity
              onPress={() => setPxPerDay(v => Math.min(40, v + 2))}
              style={styles.zoomStepBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.zoomStepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Fit / Today / Focus navigation. These don't change zoom — they
            scroll the timeline to a useful x offset. "Fit" auto-picks the
            zoom that puts the whole project on screen; Today snaps to the
            red line; Focus centers on the selected row's bar. */}
        <View style={styles.navGroup}>
          <TouchableOpacity
            onPress={() => {
              // Fit: compute exact pxPerDay so the full project spans the
              // (approximate) viewport. Clamp into the slider range so the
              // slider UI stays in sync with the derived scale.
              const viewport = 800;
              const span = Math.max(1, cpm.projectFinish);
              const pxDay = Math.max(1, Math.min(40, Math.round(viewport / span)));
              setPxPerDay(pxDay);
              hScrollRef.current?.scrollTo({ x: 0, animated: true });
            }}
            style={styles.navBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.navBtnText}>Fit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              const x = Math.max(0, (todayDayNumber - 3) * pxPerDay);
              hScrollRef.current?.scrollTo({ x, animated: true });
            }}
            style={styles.navBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.navBtnText}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (!hoverTaskId) return;
              const b = barById.get(hoverTaskId);
              if (!b) return;
              const x = Math.max(0, b.x - 80);
              hScrollRef.current?.scrollTo({ x, animated: true });
            }}
            style={[styles.navBtn, !hoverTaskId && styles.navBtnDisabled]}
            activeOpacity={0.7}
          >
            <Text style={styles.navBtnText}>Focus</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendStripe, { backgroundColor: themeColors.danger }]} />
            <Text style={styles.legendText}>Critical</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendStripe, { backgroundColor: themeColors.accent }]} />
            <Text style={styles.legendText}>Normal</Text>
          </View>
        </View>
      </View>
      )}

      {/* Body: left task column + scrollable timeline */}
      <View style={styles.body}>
        {/* Left: task names, vertically synced with the timeline rows.
            We render this as its own ScrollView-coupled column. For simplicity
            we use a shared vertical ScrollView that contains both the gutter
            and the timeline side-by-side. The gutter stays fixed horizontally
            because the outer container clips. */}
        {leftGutter > 0 && (
        <View style={[styles.gutter, { width: leftGutter }, isPhone && styles.gutterPhone]}>
          <View style={[styles.gutterHeader, { height: HEADER_HEIGHT }]}>
            <Text style={styles.gutterHeaderText}>{isPhone ? 'TASK' : 'Task'}</Text>
          </View>
          {tasks.map((t, i) => {
            const isCritical = cpm.perTask.get(t.id)?.isCritical;
            const isHovered = hoverTaskId === t.id;
            const phaseColor = colorForTask(t);
            // Task 5: focused row tint — #eff6ff background + #1e40af bold name.
            // Skip in compact (gutter is hidden) and phone (gutter is compressed;
            // the tint would conflict with gutterPhone background color).
            const isFocusedRow = !compact && !isPhone && focusedTaskId === t.id;
            if (isPhone) {
              // Phone: single-line compressed row. "T1 Pour foundation" so the
              // 90px column still resolves the visual mapping bar → name even
              // when titles are long. The bars to the right carry the date /
              // duration context, so we drop the subtitle here.
              return (
                <View
                  key={t.id}
                  style={[
                    styles.gutterRow,
                    styles.gutterRowPhone,
                    { height: ROW_HEIGHT },
                  ]}
                >
                  <View style={[styles.phaseDot, { backgroundColor: phaseColor }]} />
                  <Text
                    style={[styles.gutterName, styles.gutterNamePhone, isCritical && styles.gutterNameCritical]}
                    numberOfLines={1}
                  >
                    T{i + 1} {t.title || 'Untitled'}
                  </Text>
                </View>
              );
            }
            // Compact date label — "Mar 20 → Mar 24" style. startDay is a
            // 1-indexed offset from projectStartDate (Day 1), durationDays is
            // the count, so end is start + duration - 1.
            const durationDays = t.durationDays ?? 0;
            const start = addDays(projectStartDate, t.startDay - 1);
            const end = addDays(projectStartDate, t.startDay + durationDays - 2);
            const dateRange = durationDays > 0
              ? `${fmtShort(start)} → ${fmtShort(end)}`
              : fmtShort(start);
            const durationLabel = durationDays === 0 ? 'milestone' : `${durationDays}d`;
            return (
              <Pressable
                key={t.id}
                onHoverIn={() => setHoverTaskId(t.id)}
                onHoverOut={() => setHoverTaskId(null)}
                style={[
                  styles.gutterRow,
                  { height: ROW_HEIGHT },
                  isHovered && styles.gutterRowHover,
                  // Task 5: blue tint when this row is the focused task.
                  isFocusedRow && styles.gutterRowFocused,
                ]}
              >
                <Text style={styles.gutterIndex}>{i + 1}</Text>
                <View style={[styles.phaseDot, { backgroundColor: phaseColor }]} />
                <View style={styles.gutterTextCol}>
                  <View style={styles.gutterTitleRow}>
                    <Text
                      style={[
                        styles.gutterName,
                        isCritical && styles.gutterNameCritical,
                        // Task 5: override color+weight when row is focused.
                        // Applied after critical so focused-critical stays consistent.
                        isFocusedRow && !isCritical && styles.gutterNameFocused,
                      ]}
                      numberOfLines={1}
                    >
                      {t.title || 'Untitled'}
                    </Text>
                    {isCritical && <View style={styles.criticalDot} />}
                  </View>
                  <Text style={styles.gutterSubtitle} numberOfLines={1}>
                    {dateRange ? `${dateRange} · ${durationLabel}` : durationLabel}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        )}

        {/* Right: horizontally scrolling timeline. We pair it with a vertical
            ScrollView so long schedules scroll both ways. */}
        <ScrollView
          ref={hScrollRef}
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={{ minWidth: timelineWidth }}
          style={styles.timelineScroll}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ height: gridHeight, width: timelineWidth }}
            showsVerticalScrollIndicator
          >
            <View style={{ width: timelineWidth, height: gridHeight }}>
              {/* --- Header --- */}
              <View style={[styles.timelineHeader, { width: timelineWidth, height: HEADER_HEIGHT }]}>
                {/* Month row */}
                <View style={styles.timelineHeaderRow}>
                  {headerTicks
                    .filter(t => t.month)
                    .map((t, i) => (
                      <View key={`m-${i}-${t.x}`} style={[styles.monthCell, { left: t.x }]}>
                        <Text style={styles.monthText}>{t.month}</Text>
                      </View>
                    ))}
                </View>
                {/* Day row */}
                <View style={styles.timelineHeaderRow}>
                  {headerTicks.map((t, i) => (
                    <View key={`d-${i}-${t.x}`} style={[styles.dayCell, { left: t.x }]}>
                      <Text style={[styles.dayText, t.bold && styles.dayTextBold]}>
                        {t.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* --- Row backgrounds: clean, no zebra striping. The old zebra
                  alternation read as "Excel grid" — Apple-app convention is a
                  single uniform surface with hairline separators between
                  rows, so the bars themselves carry the visual rhythm. --- */}
              {tasks.map((t, i) => (
                <View
                  key={`bg-${t.id}`}
                  style={[
                    styles.rowBg,
                    {
                      top: HEADER_HEIGHT + i * ROW_HEIGHT,
                      width: timelineWidth,
                      height: ROW_HEIGHT,
                      backgroundColor: themeColors.surface,
                      borderBottomWidth: i < tasks.length - 1 ? 1 : 0,
                      borderBottomColor: 'rgba(60,60,67,0.045)',
                    },
                  ]}
                />
              ))}

              {/* Weekend tint columns — only at day-zoom densities where Sat/Sun
                  are individually visible. At week/month zoom the tint becomes
                  noisy stripes, so we skip it. */}
              {pxPerDay >= 8 && headerTicks.map((tick, i) => {
                if (!tick.isWeekend) return null;
                return (
                  <View
                    key={`wk-${i}`}
                    style={{
                      position: 'absolute',
                      left: tick.x,
                      top: HEADER_HEIGHT,
                      width: pxPerDay,
                      height: gridHeight - HEADER_HEIGHT,
                      backgroundColor: WEEKEND_TINT,
                      pointerEvents: 'none',
                    }}
                  />
                );
              })}

              {/* Vertical gridlines + today marker. Hairline below, slightly
                  more visible at major ticks (week/month boundaries). */}
              <Svg
                width={timelineWidth}
                height={gridHeight}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                {headerTicks.map((tick, i) => (
                  <SvgLine
                    key={`gl-${i}`}
                    x1={tick.x}
                    y1={HEADER_HEIGHT}
                    x2={tick.x}
                    y2={gridHeight}
                    stroke={tick.bold ? 'rgba(60,60,67,0.10)' : 'rgba(60,60,67,0.035)'}
                    strokeWidth={1}
                  />
                ))}
                {/* Today line is rendered as a positioned View below (with label pill),
                    so no SVG lines needed here. */}
              </Svg>

              {/* --- Dependency arrows (Task 3): orthogonal, focused only --- */}
              <Svg
                width={timelineWidth}
                height={gridHeight}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                <Defs>
                  {/* Small 5x5 arrowheads — one gray (normal), one red (critical). */}
                  <Marker
                    id="gantt-head"
                    markerWidth={5}
                    markerHeight={5}
                    refX={5}
                    refY={2.5}
                    orient="auto"
                  >
                    <Polygon points="0 0, 5 2.5, 0 5" fill="#374151" />
                  </Marker>
                  <Marker
                    id="gantt-head-crit"
                    markerWidth={5}
                    markerHeight={5}
                    refX={5}
                    refY={2.5}
                    orient="auto"
                  >
                    <Polygon points="0 0, 5 2.5, 0 5" fill="#b91c1c" />
                  </Marker>
                </Defs>

                {dependencyPaths.map(dep => {
                  const stroke = dep.critical ? '#b91c1c' : '#374151';
                  return (
                    <AnimatedPath
                      key={dep.id}
                      d={dep.d}
                      stroke={stroke}
                      strokeWidth={1.25}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={reduceMotion ? undefined : '4 3'}
                      strokeDashoffset={reduceMotion ? 0 : (dashOffset as unknown as number)}
                      fill="none"
                      markerEnd={`url(#${dep.critical ? 'gantt-head-crit' : 'gantt-head'})`}
                    />
                  );
                })}

                {/* Today line/label rendered as positioned Views below, not in SVG. */}
              </Svg>

              {/* --- Selection decorations: dashed ring + circle handles (Task 5) ---
                  Rendered in a dedicated SVG layer so coordinates match the arrow
                  layer above (both use the same timeline-local origin). We use the
                  same SVG layer approach so z-index sits above dependency arrows but
                  below the interactive bar Views. Only drawn for the focused task bar.
                  The spec's "date-range tooltip" is intentionally NOT a second hover
                  card here — the existing rich hover card already fires for focused-at-
                  rest bars via hoverTaskId. We add only the small dark pill, and only
                  while the focused bar is being dragged (live feedback during move). */}
              {focusedTaskId != null && (() => {
                const focusedBar = barById.get(focusedTaskId);
                if (!focusedBar || focusedBar.isMilestone || focusedBar.task.isSummary) return null;
                const ringX = focusedBar.x - 2;
                const ringY = focusedBar.y + (BAR_HEIGHT - 20) / 2 - 2;
                const ringW = focusedBar.w + 4;
                const ringH = 20 + 4;
                const barMidY = focusedBar.y + (BAR_HEIGHT - 20) / 2 + 10;
                return (
                  <Svg
                    width={timelineWidth}
                    height={gridHeight}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                  >
                    {/* Dashed selection ring ~2px outside the bar */}
                    <SvgRect
                      x={ringX}
                      y={ringY}
                      width={ringW}
                      height={ringH}
                      rx={6}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                    />
                    {/* Left edge handle */}
                    <SvgCircle
                      cx={focusedBar.x}
                      cy={barMidY}
                      r={4}
                      fill="#fff"
                      stroke="#2563eb"
                      strokeWidth={1.5}
                    />
                    {/* Right edge handle */}
                    <SvgCircle
                      cx={focusedBar.x + focusedBar.w}
                      cy={barMidY}
                      r={4}
                      fill="#fff"
                      stroke="#2563eb"
                      strokeWidth={1.5}
                    />
                  </Svg>
                );
              })()}

              {/* --- Baseline ghost bars (Phase 5) --- */}
              {/* Rendered BEHIND planned bars so they show through as a dashed
                  silhouette of what was originally promised. Drawn in SVG so
                  they don't steal pointer events. */}
              <Svg
                width={timelineWidth}
                height={gridHeight}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                {bars.map(bar => {
                  const bStart = bar.task.baselineStartDay;
                  const bEnd = bar.task.baselineEndDay;
                  if (bStart == null || bEnd == null) return null;
                  const bx = (bStart - 1) * pxPerDay;
                  const bw = Math.max(MIN_BAR_PX_WIDTH, (bEnd - bStart + 1) * pxPerDay);
                  return (
                    <SvgRect
                      key={`baseline-${bar.task.id}`}
                      x={bx}
                      y={bar.y + BAR_HEIGHT - 6}
                      width={bw}
                      height={4}
                      fill="rgba(60,60,67,0.35)"
                      rx={1}
                    />
                  );
                })}

                {/* --- Actual overlay bars (Phase 5) --- */}
                {bars.map(bar => {
                  const aStart = bar.task.actualStartDay;
                  const aEnd = bar.task.actualEndDay ?? todayDayNumber;
                  if (aStart == null) return null;
                  const ax = (aStart - 1) * pxPerDay;
                  const aw = Math.max(MIN_BAR_PX_WIDTH, (aEnd - aStart + 1) * pxPerDay);
                  const finished = bar.task.actualEndDay != null;
                  const fillColor = finished
                    ? themeColors.success
                    : 'rgba(52,199,89,0.55)';  // translucent green for in-progress
                  return (
                    <SvgRect
                      key={`actual-${bar.task.id}`}
                      x={ax}
                      y={bar.y + 2}
                      width={aw}
                      height={BAR_HEIGHT - 4}
                      fill={fillColor}
                      stroke={finished ? themeColors.success : 'transparent'}
                      strokeWidth={finished ? 1 : 0}
                      rx={4}
                    />
                  );
                })}
              </Svg>

              {/* --- Deadline chevrons (MAGE "due-by" markers) --- */}
              {/* A deadline is a soft limit (no CPM effect). We draw a red
                  downward chevron pointing at the end-of-day column of the
                  deadline date, aligned to the task's row. The chevron sits
                  slightly above the bar so it reads as "target" rather than
                  "finish". Intentionally different visual from MSP's green
                  arrow to avoid trade-dress overlap. */}
              <Svg
                width={timelineWidth}
                height={gridHeight}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                {bars.map(bar => {
                  const d = isoToDayLocal(bar.task.deadline);
                  if (d == null) return null;
                  const cx = (d - 1) * pxPerDay + pxPerDay / 2;
                  const cy = bar.y - 2;
                  const path = `M ${cx - 6} ${cy} L ${cx + 6} ${cy} L ${cx} ${cy + 8} Z`;
                  const overdue = bar.cpmRow && bar.cpmRow.ef > d;
                  const color = overdue ? themeColors.danger : Colors.warning;
                  return (
                    <Path
                      key={`deadline-${bar.task.id}`}
                      d={path}
                      fill={color}
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  );
                })}
              </Svg>

              {/* --- Today line + label pill --- */}
              {todayVisible && (
                <>
                  <View style={[styles.todayLine, { left: todayX }]} />
                  <View style={[styles.todayLabel, { left: todayX }]}>
                    <Text style={styles.todayLabelText}>
                      {`TODAY · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}`}
                    </Text>
                  </View>
                </>
              )}

              {/* --- Bars --- */}
              {bars.map(bar => {
                // When a task-path focus is active, dim everything not in the
                // predecessor chain. The focused bar itself always stays
                // bright; the pathed ancestors render normally; everyone
                // else fades to a ghost so the user's eye tracks the chain.
                const inPath = !taskPathIds || taskPathIds.has(bar.task.id);
                const isFocusedBar = focusedTaskId === bar.task.id;
                return (
                  <BarView
                    key={bar.task.id}
                    bar={bar}
                    isHovered={hoverTaskId === bar.task.id}
                    isDragging={dragState?.taskId === bar.task.id}
                    isLinkTarget={linkDrag?.hoverTargetId === bar.task.id}
                    linkInvalid={!!linkDrag?.invalid && linkDrag.hoverTargetId === bar.task.id}
                    todayDayNumber={todayDayNumber}
                    dimmed={!inPath}
                    isFocusTarget={isFocusedBar}
                    isLastMilestone={bar.isMilestone && bar.task.id === lastMilestoneId}
                    onHoverIn={() => setHoverTaskId(bar.task.id)}
                    onHoverOut={() => setHoverTaskId(null)}
                    onBeginDrag={(mode, evt) => beginDrag(bar.task, mode, evt)}
                    onMoveDrag={updateDrag}
                    onEndDrag={endDrag}
                    onBeginLink={(evt) => beginLinkDrag(bar.task.id, evt)}
                    onMoveLink={updateLinkDrag}
                    onEndLink={endLinkDrag}
                    onFocus={() => onFocusTask?.(isFocusedBar ? null : bar.task.id)}
                    onLogStartToday={() => logStartToday(bar.task)}
                    onLogFinishToday={() => logFinishToday(bar.task)}
                  />
                );
              })}

              {/* --- Rubber-band dependency line (Phase 4) --- */}
              {linkDrag && (() => {
                const src = barById.get(linkDrag.sourceTaskId);
                if (!src) return null;
                const x1 = src.x + src.w;
                const y1 = src.y + BAR_HEIGHT / 2;
                const x2 = linkDrag.pointerLocalX;
                const y2 = linkDrag.pointerLocalY;
                const color = linkDrag.invalid ? themeColors.danger : (linkDrag.hoverTargetId ? themeColors.success : themeColors.accent);
                return (
                  <Svg
                    width={timelineWidth}
                    height={gridHeight}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                  >
                    <Path
                      d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
                      stroke={color}
                      strokeWidth={2.5}
                      fill="none"
                      strokeDasharray="5,4"
                    />
                    <SvgRect
                      x={x2 - 5}
                      y={y2 - 5}
                      width={10}
                      height={10}
                      fill={color}
                      stroke="#fff"
                      strokeWidth={2}
                      rx={5}
                    />
                  </Svg>
                );
              })()}

              {/* --- Pending link type popover --- */}
              {/* After a drag-to-link gesture, the user picks the exact
                  dependency semantics. Defaults to FS+0 but exposes SS/FF/SF
                  and a lag stepper. This is the canonical MS Project
                  workflow — without it every link reads as "then", which
                  misses logic like "cure concrete before tile" (FS+3). */}
              {pendingLink && (() => {
                const fromBar = barById.get(pendingLink.fromId);
                const toBar = barById.get(pendingLink.toId);
                const tipX = Math.max(4, Math.min(timelineWidth - 260, pendingLink.x - 130));
                const tipY = Math.max(HEADER_HEIGHT + 4, pendingLink.y - 120);
                return (
                  <View style={[styles.linkPopover, { left: tipX, top: tipY }]}>
                    <Text style={styles.linkPopoverTitle} numberOfLines={1}>
                      {fromBar?.task.title || '…'} → {toBar?.task.title || '…'}
                    </Text>
                    <View style={styles.linkTypeRow}>
                      {(['FS', 'SS', 'FF', 'SF'] as const).map(t => (
                        <TouchableOpacity
                          key={t}
                          style={styles.linkTypeBtn}
                          onPress={() => commitPendingLink(t, 0)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.linkTypeLabel}>{t}</Text>
                          <Text style={styles.linkTypeHelp}>
                            {t === 'FS' ? 'then' : t === 'SS' ? 'start together' : t === 'FF' ? 'end together' : 'start→end'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.linkLagRow}>
                      <Text style={styles.linkLagLabel}>Lag (days)</Text>
                      {[-3, -1, 0, 1, 3, 7].map(n => (
                        <TouchableOpacity
                          key={n}
                          style={styles.linkLagBtn}
                          onPress={() => commitPendingLink('FS', n)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.linkLagText}>{n > 0 ? `+${n}` : n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity
                      style={styles.linkCancel}
                      onPress={() => setPendingLink(null)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.linkCancelText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}

              {/* --- Drag ghost: dashed outline at the bar's ORIGINAL position
                  while the user is dragging it. Mirrors a Mail/Reminders-
                  style "where was this?" affordance — the user always sees
                  both the source position (ghost) and the proposed drop
                  position (the live bar following the cursor). Disappears
                  the instant the drop commits. --- */}
              {dragState && (() => {
                const bar = barById.get(dragState.taskId);
                if (!bar) return null;
                const origX = (dragState.originalStart - 1) * pxPerDay;
                const origW = Math.max(
                  MIN_BAR_PX_WIDTH,
                  Math.max(0, dragState.originalDuration) * pxPerDay,
                );
                // Skip rendering if the bar hasn't actually moved yet — would
                // just sit underneath the live bar and read as a stuck pixel.
                const moved = dragState.currentStart !== dragState.originalStart
                  || dragState.currentDuration !== dragState.originalDuration;
                if (!moved) return null;
                return (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: origX,
                      top: bar.y,
                      width: origW,
                      height: BAR_HEIGHT,
                      borderRadius: BAR_RADIUS,
                      borderWidth: 1.5,
                      borderStyle: 'dashed',
                      borderColor: 'rgba(60,60,67,0.32)',
                      backgroundColor: 'rgba(60,60,67,0.035)',
                      zIndex: 5,
                    }}
                  />
                );
              })()}

              {/* --- Rich hover preview card --- */}
              {/* Apple-app-style hover affordance: when the cursor sits on a
                  bar (and we're not actively dragging or wiring a link), a
                  glassy card floats above the bar with the full task brief
                  — title, dates, duration, % complete with progress bar,
                  predecessor count, assigned crew, status. Replaces the
                  thin black pill that only fired during drag. */}
              {hoverTaskId && !dragState && !pendingLink && (() => {
                const bar = barById.get(hoverTaskId);
                if (!bar) return null;
                const t = bar.task;
                const startDate = addDays(projectStartDate, t.startDay - 1);
                const finishDate = addDays(
                  projectStartDate,
                  t.startDay + Math.max(0, t.durationDays - 1) - 1,
                );
                const cardWidth = 268;
                const tipX = Math.max(4, Math.min(timelineWidth - cardWidth - 4, bar.x));
                // Float above the bar; if too close to the timeline header, drop below.
                const above = bar.y - HEADER_HEIGHT > 110;
                const tipY = above ? bar.y - 110 : bar.y + BAR_HEIGHT + 8;
                const depCount = (t.dependencyLinks?.length ?? t.dependencies.length ?? 0);
                const progressPct = Math.max(0, Math.min(100, t.progress ?? 0));
                const accent = bar.isCritical ? themeColors.danger : themeColors.accent;
                const statusLabel = t.status === 'done' ? 'Complete'
                  : t.status === 'in_progress' ? 'In Progress'
                  : t.status === 'on_hold' ? 'On Hold'
                  : 'Not started';
                return (
                  <View
                    style={[styles.hoverCard, { left: tipX, top: tipY, width: cardWidth }]}
                    pointerEvents="none"
                  >
                    <View style={styles.hoverCardHeader}>
                      <View style={[styles.hoverCardAccent, { backgroundColor: accent }]} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.hoverCardTitle} numberOfLines={1}>
                          {t.title || 'Untitled task'}
                        </Text>
                        {t.phase ? (
                          <Text style={styles.hoverCardPhase} numberOfLines={1}>
                            {t.phase}
                          </Text>
                        ) : null}
                      </View>
                      {bar.isCritical ? (
                        <View style={styles.hoverCardCriticalPill}>
                          <Text style={styles.hoverCardCriticalText}>Critical</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.hoverCardDateRow}>
                      <Text style={styles.hoverCardDateText}>
                        {fmtShort(startDate)} → {fmtShort(finishDate)}
                      </Text>
                      <Text style={styles.hoverCardDuration}>
                        {t.durationDays}d
                      </Text>
                    </View>
                    {/* Progress bar */}
                    <View style={styles.hoverCardProgressTrack}>
                      <View style={[
                        styles.hoverCardProgressFill,
                        { width: `${progressPct}%`, backgroundColor: accent },
                      ]} />
                    </View>
                    <View style={styles.hoverCardMetaRow}>
                      <View style={styles.hoverCardMeta}>
                        <Text style={styles.hoverCardMetaLabel}>Status</Text>
                        <Text style={styles.hoverCardMetaValue}>{statusLabel}</Text>
                      </View>
                      <View style={styles.hoverCardMeta}>
                        <Text style={styles.hoverCardMetaLabel}>Progress</Text>
                        <Text style={styles.hoverCardMetaValue}>{progressPct}%</Text>
                      </View>
                      <View style={styles.hoverCardMeta}>
                        <Text style={styles.hoverCardMetaLabel}>Predecessors</Text>
                        <Text style={styles.hoverCardMetaValue}>{depCount}</Text>
                      </View>
                    </View>
                    {(t.crew || t.assignedSubName) ? (
                      <Text style={styles.hoverCardCrew} numberOfLines={1}>
                        {t.crew || t.assignedSubName}
                      </Text>
                    ) : null}
                  </View>
                );
              })()}

              {/* --- Drag tooltip (floats by bar) ---
                  Shown for non-focused dragging bars. For the focused bar we show
                  the compact selection pill below instead (Task 5). */}
              {dragState && dragState.taskId !== focusedTaskId && (() => {
                const bar = barById.get(dragState.taskId);
                if (!bar) return null;
                const startDate = addDays(projectStartDate, dragState.currentStart - 1);
                const finishDate = addDays(
                  projectStartDate,
                  dragState.currentStart + Math.max(0, dragState.currentDuration - 1) - 1,
                );
                const deltaStart = dragState.currentStart - dragState.originalStart;
                const deltaDur = dragState.currentDuration - dragState.originalDuration;
                const tipX = Math.max(4, Math.min(timelineWidth - 220, bar.x));
                const tipY = Math.max(HEADER_HEIGHT + 4, bar.y - 44);
                return (
                  <View style={[styles.tooltip, { left: tipX, top: tipY }]} pointerEvents="none">
                    <Text style={styles.tooltipTitle} numberOfLines={1}>{bar.task.title || 'Task'}</Text>
                    <Text style={styles.tooltipBody}>
                      {fmtShort(startDate)} → {fmtShort(finishDate)}
                      {dragState.mode === 'move' && deltaStart !== 0 && (
                        <Text style={styles.tooltipDelta}> ({deltaStart > 0 ? '+' : ''}{deltaStart}d)</Text>
                      )}
                      {dragState.mode === 'resize' && deltaDur !== 0 && (
                        <Text style={styles.tooltipDelta}> ({deltaDur > 0 ? '+' : ''}{deltaDur}d dur)</Text>
                      )}
                    </Text>
                  </View>
                );
              })()}

              {/* --- Selection drag pill (Task 5): small dark pill above the focused
                  bar while it is being dragged. Replaces the generic tooltip above
                  for the focused bar case. We show "May 19 → May 26 · 6d" without
                  the title/delta lines — the dashed ring already signals "this is
                  the selected task". Clamped so it never clips past the timeline. */}
              {dragState && focusedTaskId != null && dragState.taskId === focusedTaskId && (() => {
                const bar = barById.get(dragState.taskId);
                if (!bar || bar.isMilestone || bar.task.isSummary) return null;
                const startDate = addDays(projectStartDate, dragState.currentStart - 1);
                const finishDate = addDays(
                  projectStartDate,
                  dragState.currentStart + Math.max(0, dragState.currentDuration - 1) - 1,
                );
                const startLabel = fmtShort(startDate);
                const endLabel = fmtShort(finishDate);
                const dur = Math.max(0, dragState.currentDuration);
                // Estimate pill width at ~11px/char. Clamp so right edge doesn't clip.
                const pillW = (startLabel + endLabel + ` · ${dur}d`).length * 7 + 16;
                const clampedLeft = Math.max(4, Math.min(timelineWidth - pillW - 4, bar.x));
                return (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: clampedLeft,
                      top: bar.y - 22,
                      backgroundColor: '#111827',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 4,
                      zIndex: 20,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '500' }}>
                      {startLabel} → {endLabel} · {dur}d
                    </Text>
                  </View>
                );
              })()}
            </View>
          </ScrollView>
        </ScrollView>
      </View>

      {/* Footer hints — tightened from the verbose comma-soup so the band
          reads at a glance instead of needing to be parsed. */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Drag to move · right edge to resize · blue dot to link · grey stripe = baseline · green = actual
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BarView — a single Gantt bar, with drag-move and right-edge drag-resize.
// ---------------------------------------------------------------------------

interface BarViewProps {
  bar: {
    task: ScheduleTask;
    index: number;
    startDay: number;
    duration: number;
    isMilestone: boolean;
    isCritical: boolean;
    x: number;
    y: number;
    w: number;
    cpmRow: ReturnType<CpmResult['perTask']['get']>;
  };
  isHovered: boolean;
  isDragging: boolean;
  isLinkTarget: boolean;
  linkInvalid: boolean;
  todayDayNumber: number;
  /** When true, render at reduced opacity — outside current task-path focus. */
  dimmed?: boolean;
  /** When true, this bar is the focused task head (MAGE accent outline). */
  isFocusTarget?: boolean;
  /** When true, this milestone is the latest-dated one (project completion = red). */
  isLastMilestone?: boolean;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onBeginDrag: (mode: 'move' | 'resize', evt: any) => void;
  onMoveDrag: (evt: any) => void;
  onEndDrag: () => void;
  onBeginLink: (evt: any) => void;
  onMoveLink: (evt: any) => void;
  onEndLink: () => void;
  onFocus?: () => void;
  onLogStartToday: () => void;
  onLogFinishToday: () => void;
}

function BarView({
  bar, isHovered, isDragging, isLinkTarget, linkInvalid, todayDayNumber,
  dimmed, isFocusTarget, isLastMilestone,
  onHoverIn, onHoverOut,
  onBeginDrag, onMoveDrag, onEndDrag,
  onBeginLink, onMoveLink, onEndLink,
  onFocus,
  onLogStartToday, onLogFinishToday,
}: BarViewProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Decide whether a touch at offsetX is on the body (move) or right edge (resize).
  const pickMode = (offsetX: number, width: number): 'move' | 'resize' => {
    if (bar.isMilestone) return 'move';
    return offsetX >= width - RESIZE_HANDLE_WIDTH ? 'resize' : 'move';
  };

  // One PanResponder per bar. onStartShouldSet = true so it grabs the
  // gesture the instant the user touches it (beats ScrollView's capture).
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const { locationX } = evt.nativeEvent;
        const mode = pickMode(locationX, bar.w);
        onBeginDrag(mode, evt);
      },
      onPanResponderMove: (evt) => {
        onMoveDrag(evt);
      },
      onPanResponderRelease: () => onEndDrag(),
      onPanResponderTerminate: () => onEndDrag(),
    }),
  ).current;

  // Separate PanResponder for the dependency handle dot. It floats just off
  // the bar's right edge on hover and drags to any other bar.
  const linkResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => onBeginLink(evt),
      onPanResponderMove: (evt) => onMoveLink(evt),
      onPanResponderRelease: () => onEndLink(),
      onPanResponderTerminate: () => onEndLink(),
    }),
  ).current;

  // --- Variance calc for as-built badge (Phase 5) ------------------------
  // Compare actual dates to baseline (if present) or planned (as fallback).
  // +N = late, -N = early.
  const baseStart = bar.task.baselineStartDay ?? bar.task.startDay;
  const baseEnd = bar.task.baselineEndDay ?? (bar.task.startDay + Math.max(0, bar.task.durationDays - 1));
  const aStart = bar.task.actualStartDay;
  const aEnd = bar.task.actualEndDay;
  let varianceLabel: string | null = null;
  let varianceColor = themeColors.textSecondary;
  if (aEnd != null) {
    const v = aEnd - baseEnd;
    if (v > 0) { varianceLabel = `+${v}d late`; varianceColor = themeColors.danger; }
    else if (v < 0) { varianceLabel = `${v}d early`; varianceColor = themeColors.success; }
    else varianceLabel = 'on time';
  } else if (aStart != null) {
    const v = aStart - baseStart;
    if (v > 0) { varianceLabel = `started +${v}d`; varianceColor = Colors.warning; }
    else if (v < 0) { varianceLabel = `started ${v}d early`; varianceColor = themeColors.success; }
    else varianceLabel = 'started on time';
  }

  // Trade-driven fill via colorForTask() (canonical scheduleColors palette).
  // Critical-path is conveyed via the red gutter dot + red arrow lines —
  // putting an outline on the bar itself made dense schedules where every task
  // is critical (a common case) read as rectangular "loops" enclosing each bar.
  const barColor = colorForTask(bar.task);
  const progressPct = Math.max(0, Math.min(1, (bar.task.progress ?? 0) / 100));

  // Width-aware label — full title+id when wide, abbreviated when narrow.
  // useBarLabel is a plain function (not a React hook), so calling it here is safe.
  const barLabelResult = useBarLabel(bar.w, {
    id: bar.task.id,
    title: bar.task.title ?? '',
    progress: bar.task.progress ?? 0,
    displayId: `T${bar.index + 1}`,
  });

  // Summary bars: rendered as a dark span with inverted "fangs" at each end
  // — visually distinct from normal bars so WBS parents read differently.
  // We don't allow drag/resize on summaries (their span is derived from
  // children) — just a hover affordance.
  if (bar.task.isSummary) {
    const fang = 6;
    return (
      <>
        <View
          style={{
            position: 'absolute',
            left: bar.x,
            top: bar.y + 4,
            width: bar.w,
            height: 6,
            backgroundColor: themeColors.text,
            borderRadius: 1,
            zIndex: 3,
          }}
          // @ts-expect-error — RN web pointer events
          onMouseEnter={onHoverIn}
          onMouseLeave={onHoverOut}
        />
        {/* Left fang */}
        <View
          style={{
            position: 'absolute',
            left: bar.x,
            top: bar.y + 10,
            width: 0,
            height: 0,
            borderStyle: 'solid',
            borderTopWidth: fang,
            borderLeftWidth: fang,
            borderRightWidth: 0,
            borderBottomWidth: 0,
            borderTopColor: themeColors.text,
            borderLeftColor: themeColors.text,
            borderRightColor: 'transparent',
            borderBottomColor: 'transparent',
            zIndex: 3,
          } as any}
        />
        {/* Right fang */}
        <View
          style={{
            position: 'absolute',
            left: bar.x + bar.w - fang,
            top: bar.y + 10,
            width: 0,
            height: 0,
            borderStyle: 'solid',
            borderTopWidth: fang,
            borderRightWidth: fang,
            borderLeftWidth: 0,
            borderBottomWidth: 0,
            borderTopColor: themeColors.text,
            borderRightColor: themeColors.text,
            borderLeftColor: 'transparent',
            borderBottomColor: 'transparent',
            zIndex: 3,
          } as any}
        />
      </>
    );
  }

  if (bar.isMilestone) {
    // Diamond, centered at bar.x, fills its row vertically.
    // Project-completion milestone (the last-dated one) renders in red (#FF5A51)
    // to signal "end of project". All other milestones use the task's trade color.
    const size = BAR_HEIGHT;
    const cx = bar.x;
    const cy = bar.y + BAR_HEIGHT / 2;
    const milestoneColor = isLastMilestone ? Colors.pillLate : barColor;
    return (
      <View
        {...(Platform.OS === 'web' && onFocus ? ({ onClick: (e: any) => { if (isDragging) return; e?.stopPropagation?.(); onFocus(); } } as any) : {})}
        style={{
          position: 'absolute',
          left: cx - size / 2,
          top: cy - size / 2,
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '45deg' }],
          backgroundColor: milestoneColor,
          borderRadius: 4,
          borderWidth: isFocusTarget ? 2 : 0,
          borderColor: themeColors.accent,
          opacity: dimmed ? 0.25 : 1,
          shadowColor: isLastMilestone ? Colors.pillLate : (isFocusTarget ? Colors.accent : milestoneColor),
          shadowOpacity: isLastMilestone ? 0.5 : (isFocusTarget ? 0.6 : (isHovered || isDragging ? 0.4 : 0.15)),
          shadowRadius: isLastMilestone ? 6 : (isFocusTarget ? 8 : (isHovered || isDragging ? 6 : 2)),
          shadowOffset: { width: 0, height: 1 },
          zIndex: isDragging ? 20 : (isFocusTarget ? 10 : 2),
        }}
        onPointerEnter={onHoverIn as any}
        onPointerLeave={onHoverOut as any}
        {...responder.panHandlers}
      />
    );
  }

  // Drop-target highlight when a link is being dragged onto us.
  const targetRingColor = linkInvalid ? themeColors.danger : themeColors.success;
  const showTargetRing = isLinkTarget;

  return (
    <>
      {/* Drop-target glow (rendered BEHIND the bar) */}
      {showTargetRing && (
        <View
          style={{
            position: 'absolute',
            left: bar.x - 4,
            top: bar.y - 4,
            width: bar.w + 8,
            height: BAR_HEIGHT + 8,
            borderRadius: Tokens.radius.md,
            borderWidth: 2,
            borderColor: targetRingColor,
            backgroundColor: targetRingColor + '22',
            zIndex: 1,
          }}
        />
      )}
    <View
      {...(Platform.OS === 'web' && onFocus ? ({ onClick: (e: any) => {
        if (isDragging) return;
        e?.stopPropagation?.();
        onFocus();
      } } as any) : {})}
      // Task 2 flat bar restyle: solid fill, borderRadius 4, critical outline,
      // done opacity, name+days label.
      style={{
        position: 'absolute',
        left: bar.x,
        top: bar.y + (BAR_HEIGHT - 20) / 2,
        width: bar.w,
        height: 20,
        borderRadius: 4,
        backgroundColor: barColor,
        borderWidth: bar.isCritical ? 1 : 0,
        borderColor: bar.isCritical ? '#7f1d1d' : 'transparent',
        overflow: 'hidden',
        opacity: bar.task.status === 'done' ? 0.5 : (dimmed ? 0.28 : 1),
        shadowColor: '#000',
        shadowOpacity: isFocusTarget ? 0.35 : (isHovered || isDragging ? 0.30 : 0.30),
        shadowRadius: isFocusTarget ? 6 : 3,
        shadowOffset: { width: 0, height: 1 },
        zIndex: isDragging ? 20 : (isFocusTarget ? 10 : 2),
        cursor: Platform.OS === 'web' ? 'grab' : undefined,
      } as any}
      onPointerEnter={onHoverIn as any}
      onPointerLeave={onHoverOut as any}
      {...responder.panHandlers}
    >
      {/* Focus ring — only when this bar is the selected one. */}
      {isFocusTarget && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: themeColors.accent,
          }}
          pointerEvents="none"
        />
      )}
      {/* Progress fill — white at 22% opacity, full height, left-anchored. */}
      {progressPct > 0 && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${progressPct * 100}%`,
            backgroundColor: 'rgba(255,255,255,0.22)',
            borderTopLeftRadius: 4,
            borderBottomLeftRadius: 4,
          }}
          pointerEvents="none"
        />
      )}
      {/* Task 2 label: name · Nd (+ ✓ when done). White, 11pt semi-bold. */}
      <View style={styles.barLabel}>
        <Text
          style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '600' }}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {(bar.task.title || 'Task')} · {bar.duration}d{bar.task.status === 'done' ? ' ✓' : ''}
        </Text>
      </View>
      {/* Resize handle visual — subtle indicator on hover, no colored bar. */}
      <View
        style={{
          position: 'absolute',
          right: 0, top: 4, bottom: 4,
          width: RESIZE_HANDLE_WIDTH,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isHovered || isDragging ? 1 : 0,
          cursor: Platform.OS === 'web' ? 'ew-resize' : undefined,
        } as any}
        pointerEvents="none"
      >
        <View style={{
          width: 2,
          height: BAR_HEIGHT - 12,
          borderRadius: 1,
          backgroundColor: barColor,
          opacity: 0.55,
        }} />
      </View>
    </View>

    {/* Outside label — narrow bars: name floats right in muted color */}
    {barLabelResult.outsideText !== '' && (
      <View
        style={{
          position: 'absolute',
          left: bar.x + bar.w,
          top: bar.y + (BAR_HEIGHT - 20) / 2,
          height: 20,
          justifyContent: 'center',
          paddingLeft: 4,
          zIndex: 2,
        }}
        pointerEvents="none"
      >
        <Text style={styles.barOutsideName} numberOfLines={1}>
          {barLabelResult.outsideText}
        </Text>
      </View>
    )}

    {/* --- Resource avatar: 18px circle with crew's first initial.
        Floats at the right end of each bar when the task has a crew assigned.
        Skip on hover state — the link handle and chips take that slot. --- */}
    {!isHovered && (() => {
      const crewInitial = (bar.task.crew ?? '').trim().charAt(0).toUpperCase();
      if (!crewInitial) return null;
      return (
        <View
          pointerEvents="none"
          style={[styles.avatar, {
            left: bar.x + bar.w + 4,
            top: bar.y + (BAR_HEIGHT - 18) / 2,
          }]}
        >
          <Text style={styles.avatarText}>{crewInitial}</Text>
        </View>
      );
    })()}

    {/* --- Link handle (Phase 4): floats just off the right edge on hover.
        Drag it onto another bar to create a dependency. --- */}
    {isHovered && !isDragging && (
      <View
        style={{
          position: 'absolute',
          left: bar.x + bar.w + 6,
          top: bar.y + BAR_HEIGHT / 2 - 7,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: themeColors.accent,
          borderWidth: 2,
          borderColor: '#fff',
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          zIndex: 15,
          cursor: Platform.OS === 'web' ? 'crosshair' : undefined,
        } as any}
        {...linkResponder.panHandlers}
      />
    )}

    {/* --- As-built action chip (Phase 5) --- */}
    {isHovered && !isDragging && (
      <View
        style={{
          position: 'absolute',
          left: bar.x,
          top: bar.y - 28,
          flexDirection: 'row',
          gap: 4,
          zIndex: 16,
        }}
      >
        {bar.task.actualStartDay == null && (
          <TouchableOpacity
            onPress={onLogStartToday}
            style={styles.chipBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.chipBtnText}>▶ Start today</Text>
          </TouchableOpacity>
        )}
        {bar.task.actualEndDay == null && (
          <TouchableOpacity
            onPress={onLogFinishToday}
            style={[styles.chipBtn, styles.chipBtnDone]}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipBtnText, { color: '#fff' }]}>✓ Finish today</Text>
          </TouchableOpacity>
        )}
      </View>
    )}

    {/* --- Variance badge (Phase 5) --- */}
    {varianceLabel && (
      <View
        style={{
          position: 'absolute',
          left: bar.x + bar.w + 8,
          top: bar.y + BAR_HEIGHT / 2 - 8,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: varianceColor + '22',
          zIndex: 3,
        }}
        pointerEvents="none"
      >
        <Text style={{ fontSize: 10, fontWeight: '700', color: varianceColor }}>
          {varianceLabel}
        </Text>
      </View>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Animated Path wrapper
// ---------------------------------------------------------------------------

const AnimatedPath = Animated.createAnimatedComponent(Path);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
    gap: 16,
    backgroundColor: Colors.surfaceAlt,
  },
  toolbarTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700',
    color: t.text,
  },
  zoomGroup: {
    flexDirection: 'row',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.sm,
    padding: 2,
    position: 'relative',
  },
  // The animated white pill that sits behind the active segment. Soft shadow
  // + 1px hairline border give it the lifted-tile feel iOS uses.
  zoomPill: {
    position: 'absolute',
    top: 2,
    left: 2,
    bottom: 2,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.xs,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.05)',
  },
  zoomBtn: {
    paddingVertical: 5,
    borderRadius: Tokens.radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnActive: {
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  zoomBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600',
    color: t.textSecondary,
  },
  zoomBtnTextActive: {
    color: t.text,
  },
  zoomSliderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  zoomStepBtn: {
    width: 22,
    height: 22,
    borderRadius: 4,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomStepBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700',
    color: t.text,
  },
  zoomSliderValue: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600',
    color: t.textSecondary,
    minWidth: 48,
    textAlign: 'center',
  },
  navGroup: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 8,
  },
  navBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.surfaceAlt,
  },
  navBtnDisabled: {
    opacity: 0.4,
  },
  navBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600',
    color: t.text,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Mirror the new bar treatment — short colored stripe instead of a dot.
  // Keeps the legend visually consistent with what's actually on the chart.
  legendStripe: {
    width: 3,
    height: 14,
    borderRadius: 1.5,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  body: {
    flex: 1,
    flexDirection: 'row',
  },
  gutter: {
    borderRightWidth: 1,
    borderRightColor: t.line,
    backgroundColor: t.surface,
  },
  gutterHeader: {
    paddingHorizontal: 12,
    justifyContent: 'flex-end',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  gutterHeaderText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: t.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  gutterRowHover: {
    backgroundColor: t.accent + '0A',
  },
  // Task 5: selected row tint — #eff6ff background, blue-950 name + bold.
  // Only applied in desktop (full-gutter) mode; compact and phone skip it.
  gutterRowFocused: {
    backgroundColor: '#eff6ff',
  },
  gutterNameFocused: {
    color: '#1e40af',
    fontWeight: '600' as const,
  },
  gutterIndex: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontWeight: '600',
    width: 20,
  },
  criticalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.danger,
  },
  // Phase-colored dot leading the row name. Same hue as the task bar so the
  // GC can flick between the table and the timeline without re-orienting.
  phaseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gutterTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  gutterTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  gutterName: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  gutterNameCritical: {
    color: t.danger,
    fontWeight: '700',
  },
  gutterSubtitle: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontWeight: '500' as const,
  },

  // ---- Phone overrides (Task 18) ----
  containerPhone: {
    borderWidth: 0,
    borderRadius: 0,
  },
  gutterPhone: {
    backgroundColor: Colors.background,
  },
  gutterRowPhone: {
    paddingHorizontal: 6,
    gap: 5,
  },
  gutterNamePhone: {
    fontSize: 11,
    fontWeight: '600' as const,
  },

  timelineScroll: {
    flex: 1,
  },
  timelineHeader: {
    borderBottomWidth: 1,
    borderBottomColor: t.line,
    backgroundColor: Colors.surfaceAlt,
  },
  timelineHeaderRow: {
    height: HEADER_HEIGHT / 2,
    position: 'relative',
  },
  monthCell: {
    position: 'absolute',
    top: 0,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  monthText: {
    fontSize: 10,
    fontWeight: '700',
    color: t.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dayCell: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    minWidth: 24,
    paddingTop: 6,
  },
  dayText: {
    fontSize: 10,
    color: t.textSecondary,
  },
  dayTextBold: {
    fontWeight: '700',
    color: t.text,
  },

  rowBg: {
    position: 'absolute',
    left: 0,
  },

  // Labeled TODAY line — replaces the old SVG halo stripe. The pill label
  // floats in the header zone above the bars and the line extends through
  // the full grid body. Colors.pillLate (#FF5A51) carries enough urgency to
  // read as "now" without feeling like an error state.
  todayLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: Colors.pillLate,
    zIndex: 5,
    pointerEvents: 'none',
  } as any,
  todayLabel: {
    position: 'absolute',
    top: -1,
    backgroundColor: Colors.pillLate,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    zIndex: 6,
    transform: [{ translateX: -30 }],
    pointerEvents: 'none',
  } as any,
  todayLabelText: {
    fontSize: 8,
    color: '#0B0D10',
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  barLabel: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  barLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(11,13,16,0.85)',
    zIndex: 1,
  },
  barOutsideName: {
    fontSize: 10,
    color: Colors.textMuted,
    marginLeft: 6,
  },

  tooltip: {
    position: 'absolute',
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.xs,
    maxWidth: 240,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  tooltipTitle: {
    color: '#fff',
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
  },
  tooltipBody: {
    color: '#fff',
    fontSize: Type.caption2.fontSize,
    marginTop: 2,
  },
  tooltipDelta: {
    color: Colors.accentLight,
    fontWeight: '700',
  },
  linkPopover: {
    position: 'absolute',
    width: 260,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    zIndex: 1001,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  linkPopoverTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: t.text,
    marginBottom: 8,
  },
  linkTypeRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
  },
  linkTypeBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
  },
  linkTypeLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: t.accent,
  },
  linkTypeHelp: {
    fontSize: 9,
    color: t.textSecondary,
    marginTop: 1,
  },
  linkLagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  linkLagLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: t.textSecondary,
    marginRight: 4,
  },
  linkLagBtn: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: t.surfaceAlt,
  },
  linkLagText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600',
    color: t.text,
  },
  linkCancel: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  linkCancelText: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
  },

  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: t.line,
    backgroundColor: Colors.surfaceAlt,
  },
  footerText: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    fontStyle: 'italic',
  },

  // Rich hover preview card (Apple-app-style glassy panel) — replaces the
  // thin black drag-only tooltip with a full mini-brief on hover. Subtle
  // shadow + 1px border, no heavy outlines, generous interior padding so
  // the metadata reads as a card not a pill.
  hoverCard: {
    position: 'absolute',
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: t.line,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    zIndex: 999,
    gap: 8,
  },
  hoverCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  hoverCardAccent: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 26,
    borderRadius: 1.5,
  },
  hoverCardTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700',
    color: t.text,
    letterSpacing: -0.2,
  },
  hoverCardPhase: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    fontWeight: '500',
    marginTop: 2,
  },
  hoverCardCriticalPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: Colors.errorLight,
    alignSelf: 'flex-start',
  },
  hoverCardCriticalText: {
    fontSize: 10,
    fontWeight: '700',
    color: t.danger,
    letterSpacing: 0.2,
  },
  hoverCardDateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  hoverCardDateText: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    fontWeight: '600',
  },
  hoverCardDuration: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '600',
  },
  hoverCardProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaceAlt,
    overflow: 'hidden',
  },
  hoverCardProgressFill: {
    height: 4,
    borderRadius: 2,
  },
  hoverCardMetaRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 2,
  },
  hoverCardMeta: {
    flex: 1,
    minWidth: 0,
  },
  hoverCardMetaLabel: {
    fontSize: 10,
    color: t.textMuted,
    fontWeight: '500',
    letterSpacing: 0.2,
    textTransform: 'uppercase' as const,
  },
  hoverCardMetaValue: {
    fontSize: Type.caption1.fontSize,
    color: t.text,
    fontWeight: '700',
    marginTop: 2,
  },
  hoverCardCrew: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    fontWeight: '500',
    fontStyle: 'italic',
  },

  // Resource avatar — 18px circle with crew initial (Overlay 4)
  avatar: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    zIndex: 3,
  },
  avatarText: {
    fontSize: 8,
    color: Colors.text,
    fontWeight: '700',
  },

  // As-built hover chips (Phase 5)
  chipBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  chipBtnDone: {
    backgroundColor: t.success,
    borderColor: t.success,
  },
  chipBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: t.text,
  },
});
