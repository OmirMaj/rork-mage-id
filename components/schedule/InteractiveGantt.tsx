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
} from 'react-native';
import Svg, { Path, Defs, Marker, Polygon, Line as SvgLine, Rect as SvgRect } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { wouldCreateCycle, type CpmResult } from '@/utils/cpm';

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
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 40;
const BAR_HEIGHT = 24;
const BAR_VERTICAL_PADDING = (ROW_HEIGHT - BAR_HEIGHT) / 2;
const HEADER_HEIGHT = 52;          // month row (22) + day-number row (30)
const LEFT_GUTTER = 240;           // task-name column baked into the scroller
const RESIZE_HANDLE_WIDTH = 10;    // px on the right edge that triggers resize vs move
const MIN_BAR_PX_WIDTH = 14;       // don't let bars collapse below this during drag
const TODAY_COLOR = '#FF3B30';

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
  const { tasks, cpm, projectStartDate, onEdit, onDependencyCreate, initialZoom } = props;

  // --- Zoom -----------------------------------------------------------------
  const [zoom, setZoom] = useState<ZoomMode>(() => {
    if (initialZoom) return initialZoom;
    const span = Math.max(1, cpm.projectFinish);
    if (span > 180) return 'month';
    if (span > 60) return 'week';
    return 'day';
  });
  const pxPerDay = PX_PER_DAY[zoom];

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
      const startDay = isDragging ? dragState.currentStart : task.startDay;
      const duration = isDragging ? dragState.currentDuration : task.durationDays;
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

  // --- Marching ants animation -------------------------------------------
  // A single Animated.Value shared by every dashed arrow. We animate it from
  // 0 → -16 (dash pattern length) in a loop; react-native-svg interpolates
  // strokeDashoffset natively.
  const dashOffset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(dashOffset, {
        toValue: -16,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [dashOffset]);

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

  const endLinkDrag = useCallback(() => {
    setLinkDrag(prev => {
      if (!prev) return null;
      if (prev.hoverTargetId && !prev.invalid) {
        if (onDependencyCreate) {
          onDependencyCreate(prev.sourceTaskId, prev.hoverTargetId);
        } else {
          // Fallback: patch the successor ourselves.
          const target = tasks.find(t => t.id === prev.hoverTargetId);
          if (target && !target.dependencies.includes(prev.sourceTaskId)) {
            onEdit(prev.hoverTargetId, {
              dependencies: [...target.dependencies, prev.sourceTaskId],
            });
          }
        }
      }
      return null;
    });
    linkOriginRef.current = null;
  }, [onDependencyCreate, onEdit, tasks]);

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

  // --- Dependency paths ----------------------------------------------------
  // Draws a right-angle elbow from predecessor's right edge to successor's
  // left edge (FS). For SS we'd go left-to-left; FF right-to-right; SF
  // right-to-left inverted — we only render FS elbows for now and straight
  // lines for other types. Good enough for first pass.
  const dependencyPaths = useMemo(() => {
    const out: Array<{
      id: string;
      d: string;
      critical: boolean;
      highlighted: boolean;
    }> = [];
    for (const succ of bars) {
      const links = succ.task.dependencyLinks && succ.task.dependencyLinks.length > 0
        ? succ.task.dependencyLinks
        : succ.task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
      for (const link of links) {
        const pred = barById.get(link.taskId);
        if (!pred) continue;
        const linkType = link.type ?? 'FS';
        const criticalBoth = pred.isCritical && succ.isCritical;
        const highlighted =
          hoverTaskId === pred.task.id ||
          hoverTaskId === succ.task.id ||
          dragState?.taskId === pred.task.id ||
          dragState?.taskId === succ.task.id;

        // Endpoints
        let x1 = pred.x + pred.w;
        let y1 = pred.y + BAR_HEIGHT / 2;
        let x2 = succ.x;
        let y2 = succ.y + BAR_HEIGHT / 2;
        if (linkType === 'SS') {
          x1 = pred.x;
          x2 = succ.x;
        } else if (linkType === 'FF') {
          x1 = pred.x + pred.w;
          x2 = succ.x + succ.w;
        } else if (linkType === 'SF') {
          x1 = pred.x;
          x2 = succ.x + succ.w;
        }
        // Elbow path: short horizontal stub out, vertical, horizontal in.
        const stubOut = 14;
        const stubIn = 14;
        // If successor is left of predecessor, route above the predecessor to
        // avoid slicing through it.
        const goingForward = x2 >= x1;
        const midX = goingForward
          ? Math.max(x1 + stubOut, x2 - stubIn)
          : x1 + stubOut;
        const d = goingForward
          ? `M ${x1} ${y1} H ${midX} V ${y2} H ${x2 - 3}`
          : `M ${x1} ${y1} H ${midX} V ${pred.y - 8} H ${x2 - stubIn} V ${y2} H ${x2 - 3}`;
        out.push({
          id: `${pred.task.id}->${succ.task.id}`,
          d,
          critical: criticalBoth,
          highlighted,
        });
      }
    }
    return out;
  }, [bars, barById, hoverTaskId, dragState]);

  // --- Today marker -------------------------------------------------------
  const todayX = (todayDayNumber - 1) * pxPerDay;
  const todayVisible = todayX >= 0 && todayX <= timelineWidth;

  // --- Header (days) -------------------------------------------------------
  // Build day ticks. For zoom=day we label every day; week → every 7;
  // month → every 1st of month.
  const headerTicks = useMemo(() => {
    const ticks: Array<{ x: number; label: string; bold?: boolean; month?: string }> = [];
    if (zoom === 'day') {
      for (let d = 1; d <= totalDays; d++) {
        const date = addDays(projectStartDate, d - 1);
        ticks.push({
          x: (d - 1) * pxPerDay,
          label: String(date.getDate()),
          bold: date.getDate() === 1,
          month: date.getDate() === 1 || d === 1 ? fmtMonth(date) : undefined,
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

  // --- Render ---------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>Gantt</Text>
        <View style={styles.zoomGroup}>
          {(['day', 'week', 'month'] as ZoomMode[]).map(z => (
            <TouchableOpacity
              key={z}
              onPress={() => setZoom(z)}
              style={[styles.zoomBtn, zoom === z && styles.zoomBtnActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.zoomBtnText, zoom === z && styles.zoomBtnTextActive]}>
                {z[0].toUpperCase() + z.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.legend}>
          <View style={[styles.legendDot, { backgroundColor: Colors.error }]} />
          <Text style={styles.legendText}>Critical path</Text>
          <View style={[styles.legendDot, { backgroundColor: Colors.primary, marginLeft: 10 }]} />
          <Text style={styles.legendText}>Normal</Text>
        </View>
      </View>

      {/* Body: left task column + scrollable timeline */}
      <View style={styles.body}>
        {/* Left: task names, vertically synced with the timeline rows.
            We render this as its own ScrollView-coupled column. For simplicity
            we use a shared vertical ScrollView that contains both the gutter
            and the timeline side-by-side. The gutter stays fixed horizontally
            because the outer container clips. */}
        <View style={[styles.gutter, { width: LEFT_GUTTER }]}>
          <View style={[styles.gutterHeader, { height: HEADER_HEIGHT }]}>
            <Text style={styles.gutterHeaderText}>Task</Text>
          </View>
          {tasks.map((t, i) => {
            const isCritical = cpm.perTask.get(t.id)?.isCritical;
            const isHovered = hoverTaskId === t.id;
            return (
              <Pressable
                key={t.id}
                onHoverIn={() => setHoverTaskId(t.id)}
                onHoverOut={() => setHoverTaskId(null)}
                style={[
                  styles.gutterRow,
                  { height: ROW_HEIGHT },
                  isHovered && styles.gutterRowHover,
                ]}
              >
                <Text style={styles.gutterIndex}>{i + 1}</Text>
                {isCritical && <View style={styles.criticalDot} />}
                <Text
                  style={[styles.gutterName, isCritical && styles.gutterNameCritical]}
                  numberOfLines={1}
                >
                  {t.title || 'Untitled'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Right: horizontally scrolling timeline. We pair it with a vertical
            ScrollView so long schedules scroll both ways. */}
        <ScrollView
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

              {/* --- Row backgrounds + weekend shading + today line --- */}
              {tasks.map((t, i) => (
                <View
                  key={`bg-${t.id}`}
                  style={[
                    styles.rowBg,
                    {
                      top: HEADER_HEIGHT + i * ROW_HEIGHT,
                      width: timelineWidth,
                      height: ROW_HEIGHT,
                      backgroundColor: i % 2 === 0 ? Colors.surface : Colors.surfaceAlt,
                    },
                  ]}
                />
              ))}

              {/* Vertical gridlines (every day for day-zoom, every week for week, every month for month) */}
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
                    stroke={tick.bold ? 'rgba(60,60,67,0.16)' : 'rgba(60,60,67,0.06)'}
                    strokeWidth={1}
                  />
                ))}
                {todayVisible && (
                  <SvgLine
                    x1={todayX}
                    y1={0}
                    x2={todayX}
                    y2={gridHeight}
                    stroke={TODAY_COLOR}
                    strokeWidth={2}
                    strokeDasharray="4,3"
                  />
                )}
              </Svg>

              {/* --- Dependency arrows with marching ants --- */}
              <Svg
                width={timelineWidth}
                height={gridHeight}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              >
                <Defs>
                  <Marker
                    id="arrowRed"
                    markerWidth={8}
                    markerHeight={8}
                    refX={6}
                    refY={4}
                    orient="auto"
                  >
                    <Polygon points="0,0 8,4 0,8" fill={Colors.error} />
                  </Marker>
                  <Marker
                    id="arrowBlue"
                    markerWidth={8}
                    markerHeight={8}
                    refX={6}
                    refY={4}
                    orient="auto"
                  >
                    <Polygon points="0,0 8,4 0,8" fill={Colors.primary} />
                  </Marker>
                </Defs>

                {dependencyPaths.map(dep => {
                  const color = dep.critical ? Colors.error : Colors.primary;
                  return (
                    <AnimatedPath
                      key={dep.id}
                      d={dep.d}
                      stroke={color}
                      strokeWidth={dep.highlighted ? 2.2 : 1.5}
                      fill="none"
                      strokeDasharray="6,4"
                      strokeDashoffset={dashOffset as unknown as number}
                      markerEnd={`url(#${dep.critical ? 'arrowRed' : 'arrowBlue'})`}
                      opacity={dep.highlighted ? 1 : 0.75}
                    />
                  );
                })}

                {/* Today label pill (rendered in SVG so it scrolls with the timeline) */}
                {todayVisible && (
                  <>
                    <SvgLine
                      x1={todayX}
                      y1={HEADER_HEIGHT - 14}
                      x2={todayX}
                      y2={HEADER_HEIGHT - 14}
                      stroke={TODAY_COLOR}
                    />
                  </>
                )}
              </Svg>

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
                    ? Colors.success
                    : 'rgba(52,199,89,0.55)';  // translucent green for in-progress
                  return (
                    <SvgRect
                      key={`actual-${bar.task.id}`}
                      x={ax}
                      y={bar.y + 2}
                      width={aw}
                      height={BAR_HEIGHT - 4}
                      fill={fillColor}
                      stroke={finished ? Colors.success : 'transparent'}
                      strokeWidth={finished ? 1 : 0}
                      rx={4}
                    />
                  );
                })}
              </Svg>

              {/* --- Bars --- */}
              {bars.map(bar => (
                <BarView
                  key={bar.task.id}
                  bar={bar}
                  isHovered={hoverTaskId === bar.task.id}
                  isDragging={dragState?.taskId === bar.task.id}
                  isLinkTarget={linkDrag?.hoverTargetId === bar.task.id}
                  linkInvalid={!!linkDrag?.invalid && linkDrag.hoverTargetId === bar.task.id}
                  todayDayNumber={todayDayNumber}
                  onHoverIn={() => setHoverTaskId(bar.task.id)}
                  onHoverOut={() => setHoverTaskId(null)}
                  onBeginDrag={(mode, evt) => beginDrag(bar.task, mode, evt)}
                  onMoveDrag={updateDrag}
                  onEndDrag={endDrag}
                  onBeginLink={(evt) => beginLinkDrag(bar.task.id, evt)}
                  onMoveLink={updateLinkDrag}
                  onEndLink={endLinkDrag}
                  onLogStartToday={() => logStartToday(bar.task)}
                  onLogFinishToday={() => logFinishToday(bar.task)}
                />
              ))}

              {/* --- Rubber-band dependency line (Phase 4) --- */}
              {linkDrag && (() => {
                const src = barById.get(linkDrag.sourceTaskId);
                if (!src) return null;
                const x1 = src.x + src.w;
                const y1 = src.y + BAR_HEIGHT / 2;
                const x2 = linkDrag.pointerLocalX;
                const y2 = linkDrag.pointerLocalY;
                const color = linkDrag.invalid ? Colors.error : (linkDrag.hoverTargetId ? Colors.success : Colors.primary);
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

              {/* --- Drag tooltip (floats by bar) --- */}
              {dragState && (() => {
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
            </View>
          </ScrollView>
        </ScrollView>
      </View>

      {/* Footer hints */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Drag middle to move · right edge to resize · blue dot to link · hover for Start/Finish today
          · grey stripe = baseline · green = actual
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
  onHoverIn: () => void;
  onHoverOut: () => void;
  onBeginDrag: (mode: 'move' | 'resize', evt: any) => void;
  onMoveDrag: (evt: any) => void;
  onEndDrag: () => void;
  onBeginLink: (evt: any) => void;
  onMoveLink: (evt: any) => void;
  onEndLink: () => void;
  onLogStartToday: () => void;
  onLogFinishToday: () => void;
}

function BarView({
  bar, isHovered, isDragging, isLinkTarget, linkInvalid, todayDayNumber,
  onHoverIn, onHoverOut,
  onBeginDrag, onMoveDrag, onEndDrag,
  onBeginLink, onMoveLink, onEndLink,
  onLogStartToday, onLogFinishToday,
}: BarViewProps) {
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
  let varianceColor = Colors.textSecondary;
  if (aEnd != null) {
    const v = aEnd - baseEnd;
    if (v > 0) { varianceLabel = `+${v}d late`; varianceColor = Colors.error; }
    else if (v < 0) { varianceLabel = `${v}d early`; varianceColor = Colors.success; }
    else varianceLabel = 'on time';
  } else if (aStart != null) {
    const v = aStart - baseStart;
    if (v > 0) { varianceLabel = `started +${v}d`; varianceColor = Colors.warning; }
    else if (v < 0) { varianceLabel = `started ${v}d early`; varianceColor = Colors.success; }
    else varianceLabel = 'started on time';
  }

  const barColor = bar.isCritical ? Colors.error : Colors.primary;
  const barBg = bar.isCritical ? Colors.errorLight : Colors.primary + '1A';
  const progressColor = bar.isCritical ? Colors.error : Colors.primary;
  const progressPct = Math.max(0, Math.min(1, (bar.task.progress ?? 0) / 100));

  if (bar.isMilestone) {
    // Diamond, centered at bar.x, fills its row vertically.
    const size = BAR_HEIGHT;
    const cx = bar.x;
    const cy = bar.y + BAR_HEIGHT / 2;
    return (
      <View
        style={{
          position: 'absolute',
          left: cx - size / 2,
          top: cy - size / 2,
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '45deg' }],
          backgroundColor: barColor,
          borderRadius: 4,
          shadowColor: barColor,
          shadowOpacity: isHovered || isDragging ? 0.4 : 0.15,
          shadowRadius: isHovered || isDragging ? 6 : 2,
          shadowOffset: { width: 0, height: 1 },
          zIndex: isDragging ? 20 : 2,
        }}
        // @ts-expect-error — RN web pointer events
        onMouseEnter={onHoverIn}
        onMouseLeave={onHoverOut}
        {...responder.panHandlers}
      />
    );
  }

  // Drop-target highlight when a link is being dragged onto us.
  const targetRingColor = linkInvalid ? Colors.error : Colors.success;
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
            borderRadius: 10,
            borderWidth: 2,
            borderColor: targetRingColor,
            backgroundColor: targetRingColor + '22',
            zIndex: 1,
          }}
        />
      )}
    <View
      style={{
        position: 'absolute',
        left: bar.x,
        top: bar.y,
        width: bar.w,
        height: BAR_HEIGHT,
        borderRadius: 6,
        backgroundColor: barBg,
        borderWidth: 1.5,
        borderColor: barColor,
        overflow: 'hidden',
        shadowColor: barColor,
        shadowOpacity: isHovered || isDragging ? 0.35 : 0,
        shadowRadius: isHovered || isDragging ? 8 : 0,
        shadowOffset: { width: 0, height: 1 },
        zIndex: isDragging ? 20 : 2,
        cursor: Platform.OS === 'web' ? 'grab' : undefined,
      } as any}
      // @ts-expect-error — RN web pointer events
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
      {...responder.panHandlers}
    >
      {/* Progress fill */}
      <View
        style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${progressPct * 100}%`,
          backgroundColor: progressColor,
          opacity: 0.35,
        }}
      />
      {/* Title */}
      <View style={styles.barLabel}>
        <Text style={[styles.barLabelText, bar.isCritical && { color: Colors.error }]} numberOfLines={1}>
          {bar.task.title || 'Task'}
        </Text>
      </View>
      {/* Resize handle visual */}
      <View
        style={{
          position: 'absolute',
          right: 0, top: 0, bottom: 0,
          width: RESIZE_HANDLE_WIDTH,
          backgroundColor: isHovered || isDragging ? barColor : 'transparent',
          opacity: isHovered || isDragging ? 0.4 : 0,
          cursor: Platform.OS === 'web' ? 'ew-resize' : undefined,
        } as any}
      />
    </View>

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
          backgroundColor: Colors.primary,
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    gap: 16,
    backgroundColor: Colors.surfaceAlt,
  },
  toolbarTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  zoomGroup: {
    flexDirection: 'row',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 8,
    padding: 2,
  },
  zoomBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  zoomBtnActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  zoomBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  zoomBtnTextActive: {
    color: Colors.text,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },

  body: {
    flex: 1,
    flexDirection: 'row',
  },
  gutter: {
    borderRightWidth: 1,
    borderRightColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  gutterHeader: {
    paddingHorizontal: 12,
    justifyContent: 'flex-end',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  gutterHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  gutterRowHover: {
    backgroundColor: Colors.primary + '0A',
  },
  gutterIndex: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
    width: 20,
  },
  criticalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.error,
  },
  gutterName: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
  },
  gutterNameCritical: {
    color: Colors.error,
    fontWeight: '700',
  },

  timelineScroll: {
    flex: 1,
  },
  timelineHeader: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
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
    color: Colors.textSecondary,
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
    color: Colors.textSecondary,
  },
  dayTextBold: {
    fontWeight: '700',
    color: Colors.text,
  },

  rowBg: {
    position: 'absolute',
    left: 0,
  },

  barLabel: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  barLabelText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
  },

  tooltip: {
    position: 'absolute',
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    maxWidth: 240,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  tooltipTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  tooltipBody: {
    color: '#fff',
    fontSize: 11,
    marginTop: 2,
  },
  tooltipDelta: {
    color: Colors.accentLight,
    fontWeight: '700',
  },

  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    backgroundColor: Colors.surfaceAlt,
  },
  footerText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },

  // As-built hover chips (Phase 5)
  chipBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  chipBtnDone: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  chipBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.text,
  },
});
